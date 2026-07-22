import type { PocRunResult } from "../../poc/domain/poc-types";

export const JOB_STATES = [
  "queued",
  "analyzing",
  "awaiting_coding_approval",
  "coding_queued",
  "coding",
  "testing",
  "changes_ready",
  "publishing",
  "review_pending",
  "merging",
  "completed",
  "failed",
  "canceled",
] as const;

export type JobState = (typeof JOB_STATES)[number];
export type JobExecutionMode = "auto" | "demo";
export type ClaudeProfile = "synthetic" | "internal";
export type PublishMode = "commit" | "commit_and_push";
export type TestStatus = "not_run" | "passed" | "failed";
export type AnalysisStageId = "orchestrator" | "research" | "framework" | "estimate" | "test" | "git";
export type AnalysisStageStatus = "pending" | "running" | "completed" | "failed";

export interface AnalysisStage {
  id: AnalysisStageId;
  status: AnalysisStageStatus;
  phase?: "preparing_context" | "calling_model" | "validating_output";
  attempt?: number;
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
  summary?: string;
}

export interface ChangeManifestEntry {
  path: string;
  type: "file" | "deletion";
  mode?: number;
  size?: number;
  sha256?: string;
}

export interface CodingExecutionPolicy {
  repositoryFingerprint: string;
  profile: ClaudeProfile;
  model: string;
  executorVersion: string;
  testCommandId: string;
  allowedPaths: string[];
}

export interface JobErrorSnapshot {
  code: string;
  message: string;
  retryable: boolean;
  stage: "analysis" | "coding" | "testing" | "publishing" | "queue";
}

export interface OrbitIntakeBrief {
  version: "1";
  objective: string;
  currentAndExpectedBehavior?: string;
  repositoryContext?: string;
  acceptanceAndTests?: string;
  assumptions: string[];
}

export interface CodingPacket {
  schemaVersion: "1";
  digest: string;
  generatedAt: string;
  sourceCommit: string;
  allowedPaths: string[];
  request: {
    originalIncluded: boolean;
    normalizedFeature: string;
  };
  intakeBrief?: OrbitIntakeBrief;
  brief: PocRunResult["brief"];
  roleOutputs: PocRunResult["roleOutputs"];
  analysisRunId: string;
  executionPolicy: CodingExecutionPolicy;
}

export interface JobEvent {
  id: number;
  kind: "state" | "error" | "action" | "recovery";
  state: JobState;
  message: string;
  createdAt: string;
}

export interface JobRecord {
  id: string;
  idempotencyKey: string;
  requestFingerprint: string;
  prompt: string;
  intakeBrief?: OrbitIntakeBrief;
  executionMode: JobExecutionMode;
  state: JobState;
  version: number;
  queueOrder?: number;
  createdAt: string;
  updatedAt: string;
  analysis?: PocRunResult;
  analysisStages: AnalysisStage[];
  codingPacket?: CodingPacket;
  baseSha?: string;
  worktreePath?: string;
  branchName?: string;
  claudeModel?: string;
  claudeOutput?: string;
  changedFiles: string[];
  diff?: string;
  diffTruncated: boolean;
  changesDigest?: string;
  changesManifest?: ChangeManifestEntry[];
  testStatus: TestStatus;
  testOutput?: string;
  testOutputTruncated: boolean;
  requestedPublishMode?: PublishMode;
  commitSha?: string;
  pullRequestUrl?: string;
  pullRequestNumber?: number;
  pullRequestError?: string;
  reviewFeedback?: string;
  reviewRound: number;
  issueUrl?: string;
  issueError?: string;
  error?: JobErrorSnapshot;
  cancelRequested: boolean;
  attempts: number;
}

export interface JobActionRecord {
  jobId: string;
  idempotencyKey: string;
  fingerprint: string;
}

export interface JobListQuery {
  limit: number;
  offset: number;
}

export interface AnalysisPreview {
  jobId: string;
  runId: string;
  title: string;
  objective: string;
  completedAt: string;
}

export interface JobListRecord {
  id: string;
  prompt: string;
  executionMode: JobExecutionMode;
  state: JobState;
  version: number;
  createdAt: string;
  updatedAt: string;
  queuePosition?: number;
  analysisPreview?: AnalysisPreview;
  analysisStages: AnalysisStage[];
  codingPacketDigest?: string;
  branchName?: string;
  claudeModel?: string;
  changedFileCount: number;
  diffTruncated: boolean;
  changesDigest?: string;
  testStatus: TestStatus;
  testOutputTruncated: boolean;
  requestedPublishMode?: PublishMode;
  commitSha?: string;
  pullRequestUrl?: string;
  pullRequestNumber?: number;
  pullRequestError?: string;
  reviewRound: number;
  issueUrl?: string;
  issueError?: string;
  error?: JobErrorSnapshot;
}

export interface JobListResult {
  jobs: JobListRecord[];
  total: number;
}

export interface JobQueueStats {
  active: number;
  queued: number;
}

export interface JobDto {
  id: string;
  state: JobState;
  version: number;
  prompt: string;
  intakeBrief?: OrbitIntakeBrief;
  executionMode: JobExecutionMode;
  createdAt: string;
  updatedAt: string;
  queuePosition?: number;
  analysis?: PocRunResult;
  analysisStages: AnalysisStage[];
  codingPacket?: CodingPacket;
  coding: {
    profile: ClaudeProfile;
    enabled: boolean;
    model?: string;
    branch?: string;
    output?: string;
    changedFiles: string[];
    diff?: string;
    diffTruncated: boolean;
    changesDigest?: string;
    test: {
      status: TestStatus;
      output?: string;
      truncated: boolean;
    };
    commitSha?: string;
    publishMode?: PublishMode;
    pullRequestUrl?: string;
    pullRequestNumber?: number;
    pullRequestError?: string;
    reviewFeedback?: string;
    reviewRound: number;
    issueUrl?: string;
    issueError?: string;
  };
  error?: JobErrorSnapshot;
  actions: {
    approveCoding: boolean;
    cancel: boolean;
    retry: boolean;
    publishCommit: boolean;
    publishAndPush: boolean;
    requestChanges: boolean;
    mergePr: boolean;
  };
  events: JobEvent[];
}

export interface JobListItemDto {
  id: string;
  state: JobState;
  version: number;
  prompt: string;
  executionMode: JobExecutionMode;
  createdAt: string;
  updatedAt: string;
  queuePosition?: number;
  analysisPreview?: AnalysisPreview;
  analysisStages: AnalysisStage[];
  codingPacketDigest?: string;
  coding: {
    profile: ClaudeProfile;
    enabled: boolean;
    model?: string;
    branch?: string;
    changedFileCount: number;
    diffTruncated: boolean;
    changesDigest?: string;
    test: {
      status: TestStatus;
      truncated: boolean;
    };
    commitSha?: string;
    publishMode?: PublishMode;
    pullRequestUrl?: string;
    pullRequestNumber?: number;
    pullRequestError?: string;
    reviewRound: number;
    issueUrl?: string;
    issueError?: string;
  };
  error?: JobErrorSnapshot;
  actions: JobDto["actions"];
}

export interface JobCapabilities {
  apiVersion: "v1";
  environment: "local";
  queue: {
    persistent: true;
    storage: "sqlite";
    discipline: "lane-fifo";
    maxActiveJobs: number;
    activeJobs: number;
    queuedJobs: number;
  };
  analysis: {
    enabled: boolean;
    available: boolean;
    label: string;
  };
  coding: {
    enabled: boolean;
    available: boolean;
    profile: ClaudeProfile;
    model: string;
    allowedPaths: string[];
    timeoutMs: number;
    allowedTools: readonly ["Read", "Edit", "Write", "Glob", "Grep"];
  };
  publishing: {
    commitAvailable: boolean;
    pushEnabled: boolean;
  };
  dataPolicy: {
    profile: ClaudeProfile;
    syntheticOnly: boolean;
    acceptsCompanyData: boolean;
    rawBrowserPromptSentToClaude: boolean;
  };
}

export interface JobRepository {
  close(): void;
  recoverInterruptedJobs(now: string): void;
  create(record: JobRecord): JobRecord;
  get(id: string): JobRecord | undefined;
  findByIdempotencyKey(key: string): JobRecord | undefined;
  list(query: JobListQuery): JobListResult;
  stats(): JobQueueStats;
  nextRunnable(states?: readonly JobState[]): JobRecord | undefined;
  queuePosition(id: string): number | undefined;
  nextQueueOrder(): number;
  update(id: string, expectedVersion: number, patch: Partial<JobRecord>): JobRecord;
  updateWithAction(
    id: string,
    expectedVersion: number,
    patch: Partial<JobRecord>,
    action: JobActionRecord,
  ): JobRecord;
  appendEvent(jobId: string, event: Omit<JobEvent, "id">): JobEvent;
  listEvents(jobId: string, limit: number): JobEvent[];
  findAction(jobId: string, idempotencyKey: string): JobActionRecord | undefined;
  recordAction(action: JobActionRecord): void;
}
