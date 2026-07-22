import { JobError } from "../domain/job-errors";
import type { JobRecord } from "../domain/job-types";
import type { JobRuntimeConfig } from "./job-config";

const REQUEST_TIMEOUT_MS = 30_000;

export interface PullRequestReference {
  pullRequestUrl?: string;
  pullRequestNumber?: number;
  pullRequestError?: string;
}

export class GitHubPullRequestClient {
  constructor(private readonly config: JobRuntimeConfig) {}

  async create(job: JobRecord, signal?: AbortSignal): Promise<PullRequestReference> {
    if (job.pullRequestUrl && job.pullRequestNumber) {
      return {
        pullRequestUrl: job.pullRequestUrl,
        pullRequestNumber: job.pullRequestNumber,
      };
    }
    if (!this.config.githubToken) {
      return { pullRequestError: "GitHub 토큰이 없어 PR을 자동 생성하지 못했습니다." };
    }
    if (!job.branchName) {
      return { pullRequestError: "게시 브랜치를 확인하지 못해 PR을 자동 생성하지 못했습니다." };
    }
    try {
      const response = await requestJson(
        `${this.config.githubApiBase}/pulls`,
        "POST",
        this.config.githubToken,
        {
          title: bounded(job.analysis?.brief.title ?? `AI Office ${job.id.slice(0, 8)}`, 240),
          head: job.branchName,
          base: this.config.githubBaseBranch,
          body: bounded([
            "AI Office에서 생성한 구현 결과입니다.",
            "",
            `업무 ID: ${job.id}`,
            job.analysis?.brief.objective ? `목표: ${job.analysis.brief.objective}` : "",
          ].filter(Boolean).join("\n"), 8_000),
        },
        signal,
      );
      const pullRequestUrl = readHttpsUrl(response.html_url);
      const pullRequestNumber = readPositiveInteger(response.number);
      if (!pullRequestUrl || !pullRequestNumber) throw new Error("invalid pull request response");
      return { pullRequestUrl, pullRequestNumber };
    } catch {
      return { pullRequestError: "원격 브랜치는 게시됐지만 PR 자동 생성에 실패했습니다." };
    }
  }

  async merge(job: JobRecord, signal?: AbortSignal): Promise<void> {
    if (!this.config.githubToken) {
      throw githubError("GITHUB_TOKEN_MISSING", "GitHub 토큰이 없어 PR을 머지할 수 없습니다.", false);
    }
    const number = readPositiveInteger(job.pullRequestNumber);
    if (!number || !job.pullRequestUrl) {
      throw githubError("PULL_REQUEST_MISSING", "머지할 PR 정보를 확인하지 못했습니다.", false);
    }
    let response: Record<string, unknown>;
    try {
      response = await requestJson(
        `${this.config.githubApiBase}/pulls/${number}/merge`,
        "PUT",
        this.config.githubToken,
        {
          commit_title: bounded(job.analysis?.brief.title ?? `AI Office ${job.id.slice(0, 8)}`, 240),
          merge_method: "merge",
        },
        signal,
      );
    } catch (error) {
      if (signal?.aborted) {
        throw githubError("JOB_CANCELED", "PR 머지가 취소되었습니다.", true);
      }
      throw githubError("PULL_REQUEST_MERGE_FAILED", "GitHub에서 PR 머지를 완료하지 못했습니다.", true);
    }
    if (response.merged !== true) {
      throw githubError("PULL_REQUEST_NOT_MERGED", "PR이 아직 머지 가능한 상태가 아닙니다. GitHub 리뷰 상태를 확인해 주세요.", true);
    }
  }
}

async function requestJson(
  url: string,
  method: "POST" | "PUT",
  token: string,
  body: Record<string, unknown>,
  parentSignal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  parentSignal?.addEventListener("abort", abort, { once: true });
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "ai-office-company-server",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`github http ${response.status}`);
    const parsed: unknown = await response.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid github response");
    }
    return parsed as Record<string, unknown>;
  } finally {
    clearTimeout(timeoutId);
    parentSignal?.removeEventListener("abort", abort);
  }
}

function readPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function readHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function bounded(value: string, limit: number): string {
  return value.replace(/[\u0000-\u001F\u007F]/gu, " ").trim().slice(0, limit);
}

function githubError(code: string, message: string, retryable: boolean): JobError {
  return new JobError(code, message, 502, retryable, { stage: "publishing" });
}
