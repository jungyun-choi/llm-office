import { PocError } from "../../poc/domain/poc-errors";
import { localCapabilities } from "../../poc/http/local-poc-controller";
import { toSyntheticFeatureRequest } from "../../poc/infrastructure/synthetic-feature-request";
import { JobError, jobNotFound, staleJobVersion } from "../domain/job-errors";
import type { CreateJobInput, JobActionInput } from "../domain/job-schema";
import type {
  CodingPacket,
  JobCapabilities,
  JobDto,
  JobErrorSnapshot,
  JobListItemDto,
  JobListQuery,
  JobListRecord,
  JobRecord,
  JobRepository,
  JobState,
} from "../domain/job-types";
import type { JobExecutionPort } from "./job-execution.port";
import type { JobRuntimeConfig } from "../infrastructure/job-config";
import {
  BUNDLED_EXECUTOR_VERSION,
  SYNTHETIC_TEST_COMMAND_ID,
} from "../infrastructure/job-config";

const TERMINAL_STATES = new Set<JobState>(["completed", "failed", "canceled"]);
const RUNNING_STATES = new Set<JobState>(["analyzing", "coding", "testing", "publishing"]);

export interface JobListDto {
  items: JobListItemDto[];
  total: number;
  limit: number;
  offset: number;
}

export class JobService {
  private wakeHandler: () => void = () => undefined;
  private abortHandler: (jobId: string) => void = () => undefined;

  constructor(
    private readonly repository: JobRepository,
    private readonly executor: JobExecutionPort,
    private readonly config: JobRuntimeConfig,
  ) {}

  setQueueHandlers(wake: () => void, abort: (jobId: string) => void): void {
    this.wakeHandler = wake;
    this.abortHandler = abort;
  }

  async create(
    input: CreateJobInput,
    idempotencyKey: string,
  ): Promise<{ job: JobDto; duplicate: boolean }> {
    const fingerprint = await digest(JSON.stringify({
      prompt: normalizeWhitespace(input.prompt),
      executionMode: input.executionMode,
    }));
    const existing = this.repository.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) {
        throw new JobError(
          "IDEMPOTENCY_CONFLICT",
          "같은 Idempotency-Key가 다른 요청에 사용되었습니다.",
          409,
          false,
        );
      }
      return { job: this.toDto(existing), duplicate: true };
    }
    const stats = this.repository.stats();
    if (stats.active >= this.config.maxActiveJobs) {
      throw new JobError(
        "JOB_QUEUE_FULL",
        "업무 대기열이 가득 찼습니다. 완료 후 다시 시도해 주세요.",
        429,
        true,
      );
    }
    const now = new Date().toISOString();
    const record: JobRecord = {
      id: crypto.randomUUID(),
      idempotencyKey,
      requestFingerprint: fingerprint,
      prompt: input.prompt,
      executionMode: input.executionMode,
      state: "queued",
      version: 1,
      queueOrder: this.repository.nextQueueOrder(),
      createdAt: now,
      updatedAt: now,
      changedFiles: [],
      analysisStages: initialAnalysisStages(),
      diffTruncated: false,
      testStatus: "not_run",
      testOutputTruncated: false,
      cancelRequested: false,
      attempts: 0,
    };
    this.repository.create(record);
    this.repository.appendEvent(record.id, {
      kind: "state",
      state: record.state,
      message: "분석 사무실 대기열에 업무를 등록했습니다.",
      createdAt: now,
    });
    this.wakeHandler();
    return { job: this.toDto(record), duplicate: false };
  }

  get(jobId: string): JobDto {
    const record = this.repository.get(jobId);
    if (!record) throw jobNotFound();
    return this.toDto(record);
  }

  list(query: JobListQuery): JobListDto {
    const result = this.repository.list(query);
    return {
      items: result.jobs.map((job) => this.toListDto(job)),
      total: result.total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async act(
    jobId: string,
    input: JobActionInput,
    idempotencyKey: string,
  ): Promise<{ job: JobDto; duplicate: boolean }> {
    const fingerprint = await digest(JSON.stringify(input));
    const prior = this.repository.findAction(jobId, idempotencyKey);
    if (prior) {
      if (prior.fingerprint !== fingerprint) {
        throw new JobError(
          "IDEMPOTENCY_CONFLICT",
          "같은 Idempotency-Key가 다른 작업에 사용되었습니다.",
          409,
          false,
        );
      }
      return { job: this.get(jobId), duplicate: true };
    }
    const current = this.requireVersion(jobId, input.expectedVersion);
    let patch: Partial<JobRecord>;
    if (input.action === "approve_coding") patch = this.approveCoding(current, input.artifactDigest);
    else if (input.action === "publish_changes") {
      patch = this.queuePublishing(current, input.artifactDigest, input.mode);
    } else if (input.action === "cancel") patch = this.cancel(current);
    else patch = this.retry(current);

    const next = this.repository.updateWithAction(
      jobId,
      current.version,
      patch,
      { jobId, idempotencyKey, fingerprint },
    );
    this.repository.appendEvent(jobId, {
      kind: "action",
      state: next.state,
      message: actionMessage(input.action),
      createdAt: next.updatedAt,
    });
    if (RUNNING_STATES.has(current.state) && input.action === "cancel") {
      this.abortHandler(jobId);
    } else if (["coding_queued", "queued", "publishing"].includes(next.state)) {
      this.wakeHandler();
    }
    return { job: this.toDto(next), duplicate: false };
  }

  async capabilities(): Promise<JobCapabilities> {
    const [analysis, claudeAvailable] = await Promise.all([
      localCapabilities(),
      this.executor.isClaudeAvailable(),
    ]);
    const stats = this.repository.stats();
    return {
      apiVersion: "v1",
      environment: "local",
      queue: {
        persistent: true,
        storage: "sqlite",
        discipline: "fifo",
        maxActiveJobs: this.config.maxActiveJobs,
        activeJobs: stats.active,
        queuedJobs: stats.queued,
      },
      analysis: {
        enabled: analysis.agentRuntime.enabled,
        available: analysis.agentRuntime.available,
        label: analysis.agentRuntime.label,
      },
      coding: {
        enabled: this.config.codingEnabled,
        available: claudeAvailable,
        profile: this.config.profile,
        model: this.config.claudeModel,
        allowedPaths: [...this.config.allowedPaths],
        timeoutMs: this.config.claudeTimeoutMs,
        allowedTools: ["Read", "Edit", "Write", "Glob", "Grep"],
      },
      publishing: {
        commitAvailable: this.config.codingEnabled,
        pushEnabled: this.config.codingEnabled && this.config.pushEnabled,
      },
      dataPolicy: {
        profile: this.config.profile,
        syntheticOnly: this.config.profile === "synthetic",
        acceptsCompanyData: this.config.profile === "internal" &&
          this.config.internalExecutionAcknowledged,
        rawBrowserPromptSentToClaude: this.config.profile === "internal" &&
          this.config.internalExecutionAcknowledged,
      },
    };
  }

  async buildCodingPacket(job: JobRecord, analysis: NonNullable<JobRecord["analysis"]>): Promise<CodingPacket> {
    if (!job.baseSha) throw new JobError("BASE_SHA_MISSING", "Git 기준점을 확인하지 못했습니다.", 500, true);
    const originalIncluded = this.config.profile === "internal" &&
      this.config.internalExecutionAcknowledged;
    const packetWithoutDigest = {
      schemaVersion: "1" as const,
      generatedAt: new Date().toISOString(),
      sourceCommit: job.baseSha,
      allowedPaths: [...this.config.allowedPaths],
      request: {
        originalIncluded,
        normalizedFeature: originalIncluded
          ? job.prompt
          : toSyntheticFeatureRequest(job.prompt),
      },
      brief: analysis.brief,
      roleOutputs: analysis.roleOutputs,
      analysisRunId: analysis.runId,
      executionPolicy: {
        repositoryFingerprint: await repositoryFingerprint(this.config.repositoryRoot),
        profile: this.config.profile,
        model: this.config.claudeModel,
        executorVersion: BUNDLED_EXECUTOR_VERSION,
        testCommandId: SYNTHETIC_TEST_COMMAND_ID,
        allowedPaths: [...this.config.allowedPaths],
      },
    };
    return {
      ...packetWithoutDigest,
      digest: await digest(JSON.stringify(packetWithoutDigest)),
    };
  }

  toDto(record: JobRecord): JobDto {
    return {
      id: record.id,
      state: record.state,
      version: record.version,
      prompt: record.prompt,
      executionMode: record.executionMode,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      queuePosition: this.repository.queuePosition(record.id),
      analysis: record.analysis,
      analysisStages: record.analysisStages,
      codingPacket: record.codingPacket,
      coding: {
        profile: this.config.profile,
        enabled: this.config.codingEnabled,
        model: record.claudeModel ?? this.config.claudeModel,
        branch: record.branchName,
        output: record.claudeOutput,
        changedFiles: [...record.changedFiles],
        diff: record.diff,
        diffTruncated: record.diffTruncated,
        changesDigest: record.changesDigest,
        test: {
          status: record.testStatus,
          output: record.testOutput,
          truncated: record.testOutputTruncated,
        },
        commitSha: record.commitSha,
        publishMode: record.requestedPublishMode,
      },
      error: record.error,
      actions: this.availableActions(record, record.queueOrder !== undefined),
      events: this.repository.listEvents(record.id, 50),
    };
  }

  toListDto(record: JobListRecord): JobListItemDto {
    return {
      id: record.id,
      state: record.state,
      version: record.version,
      prompt: record.prompt,
      executionMode: record.executionMode,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      queuePosition: record.queuePosition,
      analysisPreview: record.analysisPreview,
      analysisStages: record.analysisStages,
      codingPacketDigest: record.codingPacketDigest,
      coding: {
        profile: this.config.profile,
        enabled: this.config.codingEnabled,
        model: record.claudeModel ?? this.config.claudeModel,
        branch: record.branchName,
        changedFileCount: record.changedFileCount,
        diffTruncated: record.diffTruncated,
        changesDigest: record.changesDigest,
        test: {
          status: record.testStatus,
          truncated: record.testOutputTruncated,
        },
        commitSha: record.commitSha,
        publishMode: record.requestedPublishMode,
      },
      error: record.error,
      actions: this.availableActions(record, record.queuePosition !== undefined),
    };
  }

  private availableActions(
    record: Pick<JobRecord, "state" | "testStatus" | "diffTruncated" | "error">,
    queuedForExecution: boolean,
  ): JobDto["actions"] {
    const testPassed = record.testStatus === "passed";
    return {
      approveCoding: record.state === "awaiting_coding_approval" && this.config.codingEnabled,
      cancel: !TERMINAL_STATES.has(record.state) &&
        !(record.state === "publishing" && !queuedForExecution),
      retry: (record.state === "failed" && Boolean(record.error?.retryable)) ||
        (record.state === "changes_ready" && !testPassed) || record.state === "canceled",
      publishCommit: record.state === "changes_ready" && testPassed && !record.diffTruncated,
      publishAndPush: record.state === "changes_ready" && testPassed &&
        !record.diffTruncated && this.config.pushEnabled,
    };
  }

  private requireVersion(jobId: string, expectedVersion: number): JobRecord {
    const current = this.repository.get(jobId);
    if (!current) throw jobNotFound();
    if (current.version !== expectedVersion) throw staleJobVersion();
    return current;
  }

  private approveCoding(current: JobRecord, artifactDigest: string): Partial<JobRecord> {
    if (current.state !== "awaiting_coding_approval" || !current.codingPacket) {
      throw invalidAction("이 업무는 현재 코딩 승인을 받을 수 없습니다.");
    }
    if (!this.config.codingEnabled) {
      throw new JobError(
        "CODING_DISABLED",
        this.config.configurationError ?? "Claude 코딩 기능이 비활성화되어 있습니다.",
        503,
        false,
      );
    }
    if (current.codingPacket.digest !== artifactDigest) throw artifactConflict();
    return {
      state: "coding_queued",
      queueOrder: this.repository.nextQueueOrder(),
      updatedAt: new Date().toISOString(),
      error: undefined,
      cancelRequested: false,
    };
  }

  private queuePublishing(
    current: JobRecord,
    artifactDigest: string,
    mode: "commit" | "commit_and_push",
  ): Partial<JobRecord> {
    if (current.state !== "changes_ready" || current.testStatus !== "passed") {
      throw invalidAction("테스트를 통과해 검토 준비가 된 변경만 게시할 수 있습니다.");
    }
    if (current.diffTruncated) {
      throw new JobError(
        "DIFF_TRUNCATED",
        "전체 Diff를 검토할 수 없어 게시를 허용하지 않습니다.",
        409,
        false,
      );
    }
    if (!current.changesDigest || current.changesDigest !== artifactDigest) {
      throw artifactConflict();
    }
    if (mode === "commit_and_push" && !this.config.pushEnabled) {
      throw new JobError("PUSH_DISABLED", "Git push가 비활성화되어 있습니다.", 403, false);
    }
    return {
      state: "publishing",
      queueOrder: this.repository.nextQueueOrder(),
      requestedPublishMode: mode,
      updatedAt: new Date().toISOString(),
      error: undefined,
      cancelRequested: false,
    };
  }

  private cancel(current: JobRecord): Partial<JobRecord> {
    if (TERMINAL_STATES.has(current.state)) {
      return { updatedAt: new Date().toISOString() };
    }
    if (current.state === "publishing" && current.queueOrder === undefined) {
      throw invalidAction("게시가 시작된 뒤에는 취소할 수 없습니다.");
    }
    const running = RUNNING_STATES.has(current.state) && current.queueOrder === undefined;
    return {
      state: running ? current.state : "canceled",
      queueOrder: undefined,
      cancelRequested: running,
      updatedAt: new Date().toISOString(),
    };
  }

  private retry(current: JobRecord): Partial<JobRecord> {
    const failedRetry = current.state === "failed" && current.error?.retryable;
    const failedTests = current.state === "changes_ready" && current.testStatus === "failed";
    if (!failedRetry && !failedTests && current.state !== "canceled") {
      throw invalidAction("이 업무는 현재 다시 시도할 수 없습니다.");
    }
    let state: JobState = "queued";
    if (
      failedRetry &&
      current.error?.stage === "publishing" &&
      current.requestedPublishMode
    ) state = "publishing";
    else if (current.analysis && (failedRetry || failedTests)) state = "coding_queued";
    else if (current.analysis) state = "awaiting_coding_approval";
    return {
      state,
      queueOrder: state === "awaiting_coding_approval"
        ? undefined
        : this.repository.nextQueueOrder(),
      updatedAt: new Date().toISOString(),
      error: undefined,
      cancelRequested: false,
      testStatus: state === "coding_queued" ? "not_run" : current.testStatus,
      testOutput: state === "coding_queued" ? undefined : current.testOutput,
      testOutputTruncated: state === "coding_queued" ? false : current.testOutputTruncated,
      analysisStages: state === "queued"
        ? current.analysisStages.map(({ id }) => ({ id, status: "pending" }))
        : current.analysisStages,
    };
  }
}

export function toErrorSnapshot(
  error: unknown,
  stage: JobErrorSnapshot["stage"],
): JobErrorSnapshot {
  if (error instanceof JobError) {
    return { code: error.code, message: error.message, retryable: error.retryable, stage };
  }
  if (error instanceof PocError) {
    return { code: error.code, message: error.message, retryable: error.retryable, stage };
  }
  return {
    code: "JOB_EXECUTION_FAILED",
    message: "업무 실행 중 오류가 발생했습니다.",
    retryable: true,
    stage,
  };
}

function invalidAction(message: string): JobError {
  return new JobError("INVALID_JOB_ACTION", message, 409, false);
}

function artifactConflict(): JobError {
  return new JobError(
    "ARTIFACT_DIGEST_MISMATCH",
    "검토한 결과물과 현재 결과물이 다릅니다. 최신 내용을 확인해 주세요.",
    409,
    false,
  );
}

function actionMessage(action: JobActionInput["action"]): string {
  if (action === "approve_coding") return "사용자가 Claude 코딩을 승인했습니다.";
  if (action === "publish_changes") return "사용자가 변경 게시를 승인했습니다.";
  if (action === "cancel") return "사용자가 업무 취소를 요청했습니다.";
  return "사용자가 업무 재시도를 요청했습니다.";
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

async function digest(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function initialAnalysisStages(): JobRecord["analysisStages"] {
  return (["research", "framework", "estimate", "test", "git", "orchestrator"] as const)
    .map((id) => ({ id, status: "pending" }));
}

async function repositoryFingerprint(repositoryRoot: string): Promise<string> {
  const { realpath } = await import("node:fs/promises");
  return digest(await realpath(repositoryRoot));
}
