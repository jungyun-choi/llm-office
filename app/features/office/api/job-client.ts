import { createRequestId } from "./poc-client";
import { parseCapabilities, parseJobPayload, parseJobsPayload } from "./job-contract";
import { parseOrbitQuestionSet, type OrbitQuestionSet } from "../orbit-intake";
import type {
  OfficeCapabilities,
  OfficeJob,
  OfficeJobAction,
  OfficeRequestInput,
  PublishMode,
} from "../types";

const JOBS_API_BASE = "/api/v1/jobs";
const REQUEST_TIMEOUT_MS = 12_000;
const ACTION_REQUEST_TIMEOUT_MS = 45_000;
const ORBIT_REQUEST_TIMEOUT_MS = 105_000;

export async function listOfficeJobs(signal: AbortSignal): Promise<{
  jobs: readonly OfficeJob[];
  capabilities?: OfficeCapabilities;
}> {
  const payload = await requestJson(`${JOBS_API_BASE}?limit=100&offset=0`, { method: "GET" }, signal);
  return parseJobsPayload(payload);
}

export async function getOfficeJob(jobId: string, signal: AbortSignal): Promise<OfficeJob> {
  const payload = await requestJson(
    `${JOBS_API_BASE}/${encodeURIComponent(jobId)}`,
    { method: "GET" },
    signal,
  );
  return parseJobPayload(payload);
}

export async function getOfficeJobCapabilities(signal: AbortSignal): Promise<OfficeCapabilities> {
  const payload = await requestJson(`${JOBS_API_BASE}/capabilities`, { method: "GET" }, signal);
  return parseCapabilities(payload);
}

export async function createOfficeJob(input: OfficeRequestInput, signal: AbortSignal): Promise<OfficeJob> {
  const payload = await requestJson(JOBS_API_BASE, {
    method: "POST",
    headers: createMutationHeaders(),
    body: JSON.stringify({
      prompt: input.request,
      executionMode: "auto",
      ...(input.intakeBrief ? { intakeBrief: input.intakeBrief } : {}),
    }),
  }, signal);
  return parseJobPayload(payload);
}

export async function requestOrbitQuestions(
  request: string,
  signal: AbortSignal,
): Promise<OrbitQuestionSet> {
  const payload = await requestJson(`${JOBS_API_BASE}/intake/questions`, {
    method: "POST",
    headers: new Headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ request }),
  }, signal, ORBIT_REQUEST_TIMEOUT_MS);
  return parseOrbitQuestionSet(payload);
}

export async function runOfficeJobAction(
  job: OfficeJob,
  action: OfficeJobAction,
  mode: PublishMode | undefined,
  feedback: string | undefined,
  signal: AbortSignal,
): Promise<OfficeJob> {
  if (action === "answer_development_question" && !job.developmentQuestion?.id) {
    throw new JobClientError("QUESTION_NOT_AVAILABLE", "답변할 개발팀 질문을 찾지 못했습니다.");
  }
  if (action === "request_reanalysis" && !job.analysisRunId) {
    throw new JobClientError("ANALYSIS_NOT_AVAILABLE", "추가 분석할 최신 결과를 찾지 못했습니다.");
  }
  const artifactDigest = action === "approve_coding"
    ? job.codingPacketDigest
    : action === "publish_changes" || action === "merge_pr"
      ? job.coding?.changesDigest
      : undefined;
  const body = {
    action,
    ...(mode ? { mode } : {}),
    ...(feedback ? { feedback } : {}),
    ...(job.version === undefined ? {} : { expectedVersion: job.version }),
    ...(artifactDigest ? { artifactDigest } : {}),
    ...(action === "answer_development_question"
      ? { questionId: job.developmentQuestion?.id }
      : {}),
    ...(action === "request_reanalysis" ? { analysisRunId: job.analysisRunId } : {}),
  };
  const payload = await requestJson(`${JOBS_API_BASE}/${encodeURIComponent(job.id)}/actions`, {
    method: "POST",
    headers: createMutationHeaders(),
    body: JSON.stringify(body),
  }, signal, ACTION_REQUEST_TIMEOUT_MS);
  return parseJobPayload(payload);
}

function createMutationHeaders(): Headers {
  return new Headers({
    "Content-Type": "application/json",
    "Idempotency-Key": createRequestId(),
  });
}

async function requestJson(
  url: string,
  init: RequestInit,
  parentSignal: AbortSignal,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  parentSignal.addEventListener("abort", abort, { once: true });
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });
    const payload = await readJson(response);
    if (!response.ok) throw createRequestError(response.status, payload);
    return payload;
  } catch (error) {
    if (parentSignal.aborted) throw new DOMException("Request aborted", "AbortError");
    if (error instanceof JobClientError) throw error;
    throw new JobClientError("SERVER_UNAVAILABLE", "단일 서버에 연결하지 못했습니다. 서버 상태를 확인해 주세요.");
  } finally {
    globalThis.clearTimeout(timeoutId);
    parentSignal.removeEventListener("abort", abort);
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    return undefined;
  }
}

function createRequestError(status: number, payload: unknown): JobClientError {
  const message = readErrorMessage(payload) ?? "업무 요청을 처리하지 못했습니다.";
  return new JobClientError(`HTTP_${status}`, message, status);
}

function readErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const error = Reflect.get(payload, "error");
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return undefined;
  const message = Reflect.get(error, "message");
  return typeof message === "string" ? message : undefined;
}

export class JobClientError extends Error {
  constructor(readonly code: string, message: string, readonly status?: number) {
    super(message);
    this.name = "JobClientError";
  }
}
