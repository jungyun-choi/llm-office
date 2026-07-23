import { z } from "zod";

import type {
  OfficeCapabilities,
  OfficeAnalysisPreview,
  OfficeAnalysisHistoryEntry,
  OfficeAnalysisHistoryPreview,
  OfficeAnalysisStage,
  OfficeChangedFile,
  OfficeCodingPlan,
  OfficeCodingResult,
  OfficeCodingTest,
  OfficeDevelopmentQuestion,
  OfficeDevelopmentPart,
  OfficeDifficultyAssessment,
  OfficeJob,
  OfficeJobActions,
  OfficeJobError,
  OfficeJobEvent,
  OfficeJobState,
  OrbitIntakeBrief,
} from "../types";

const recordSchema = z.record(z.string(), z.unknown());
const jobStateSchema = z.enum([
  "queued",
  "analyzing",
  "awaiting_coding_approval",
  "coding_queued",
  "coding",
  "testing",
  "awaiting_development_input",
  "changes_ready",
  "publishing",
  "review_pending",
  "merging",
  "completed",
  "failed",
  "canceled",
]);
const testStatusSchema = z.enum(["not_run", "pending", "running", "passed", "failed", "skipped", "unknown"]);
const analysisStageStatusSchema = z.enum(["pending", "running", "completed", "failed"]);
const analysisStageIdSchema = z.enum(["orchestrator", "research", "framework", "estimate", "test", "git"]);
const analysisStagePhaseSchema = z.enum(["preparing_context", "calling_model", "validating_output"]);
const developmentRoleSchema = z.enum(["lead", "implementation", "verification", "git"]);
const developmentResumeStageSchema = z.enum(["implementation", "verification", "git"]);
const developmentQuestionStatusSchema = z.enum(["open", "answered"]);
const developmentPartSchema = z.enum(["claude", "opencode"]);
const MAX_DIFF_LENGTH = 60_000;
const MAX_OUTPUT_LENGTH = 16_000;

export function parseJobsPayload(payload: unknown): {
  jobs: readonly OfficeJob[];
  capabilities?: OfficeCapabilities;
} {
  if (Array.isArray(payload)) return { jobs: parseJobArray(payload, "summary") };
  const record = parseRecord(payload, "업무 목록 응답 형식이 올바르지 않습니다.");
  const jobs = parseJobArray(record.jobs ?? record.items ?? [], "summary");
  const capabilities = record.capabilities ? parseCapabilities(record.capabilities) : undefined;
  return { jobs, capabilities };
}

export function parseJobPayload(payload: unknown): OfficeJob {
  const record = parseRecord(payload, "업무 응답 형식이 올바르지 않습니다.");
  return normalizeJob(record.job ?? record, "full");
}

export function parseCapabilities(payload: unknown): OfficeCapabilities {
  const record = parseRecord(payload, "서버 기능 응답 형식이 올바르지 않습니다.");
  const source = asRecord(record.capabilities) ?? record;
  const publishing = asRecord(source.publishing);
  const coding = asRecord(source.coding);
  const codingRuntimes = asRecord(source.codingRuntimes ?? source.coding_runtimes)
    ?? (coding && asRecord(coding.runtimes));
  return {
    canCommit: publishing
      ? readBoolean(publishing, ["commitAvailable", "commit"], true)
      : readBoolean(source, ["canCommit", "commit", "publishCommit"], true),
    canPush: publishing
      ? readBoolean(publishing, ["pushEnabled", "push"], false)
      : readBoolean(source, ["canPush", "push", "publishPush"], false),
    analysisRuntimeLabel: readNestedString(source, ["analysisRuntimeLabel", "analysisRuntime", "analysis"]),
    codingRuntimeLabel: readNestedString(source, ["codingRuntimeLabel", "codingRuntime", "coding"]),
    codingRuntimes: codingRuntimes ? {
      claude: readNestedString(codingRuntimes, ["claude"]),
      opencode: readNestedString(codingRuntimes, ["opencode", "openCode"]),
    } : undefined,
  };
}

function parseJobArray(
  value: unknown,
  detailLevel: NonNullable<OfficeJob["detailLevel"]>,
): readonly OfficeJob[] {
  if (!Array.isArray(value)) throw new JobContractError("업무 목록이 배열이 아닙니다.");
  return value.map((job) => normalizeJob(job, detailLevel));
}

function normalizeJob(
  value: unknown,
  detailLevel: NonNullable<OfficeJob["detailLevel"]>,
): OfficeJob {
  const record = parseRecord(value, "업무 항목 형식이 올바르지 않습니다.");
  const id = readString(record, ["id", "jobId", "job_id"]);
  const state = parseJobState(record.state ?? record.status);
  if (!id || !state) throw new JobContractError("업무 식별자 또는 상태가 없습니다.");
  const codingPacket = asRecord(record.codingPacket ?? record.coding_packet);
  const developmentAssignment = asRecord(record.developmentAssignment ?? record.development_assignment);
  const coding = normalizeCoding(record.coding ?? record.codingResult ?? record.coding_result);
  const analysis = unwrapAnalysis(record.analysis ?? record.result);
  const analysisRecord = asRecord(analysis);
  return {
    id,
    prompt: readString(record, ["prompt", "request", "title"]) ?? "내용이 보호된 업무",
    intakeBrief: normalizeIntakeBrief(record.intakeBrief ?? record.intake_brief),
    state,
    createdAt: readString(record, ["createdAt", "created_at", "submittedAt"]) ?? new Date(0).toISOString(),
    updatedAt: readString(record, ["updatedAt", "updated_at"]),
    queuePosition: readNumber(record, ["queuePosition", "queue_position"]),
    detailLevel,
    analysis,
    analysisRunId: analysisRecord ? readString(analysisRecord, ["runId", "run_id"]) : undefined,
    analysisPreview: normalizeAnalysisPreview(record.analysisPreview ?? record.analysis_preview),
    analysisHistory: normalizeAnalysisHistory(record.analysisHistory ?? record.analysis_history),
    analysisHistoryPreviews: normalizeAnalysisHistoryPreviews(
      record.analysisHistoryPreviews ?? record.analysis_history_previews,
    ),
    analysisStages: normalizeAnalysisStages(record.analysisStages ?? record.analysis_stages),
    coding: coding && !coding.baseSha
      ? { ...coding, baseSha: codingPacket && readString(codingPacket, ["sourceCommit", "source_commit"]) }
      : coding,
    codingPlan: normalizeCodingPlan(codingPacket),
    difficultyAssessment: normalizeDifficultyAssessment(
      record.difficultyAssessment ?? record.difficulty_assessment ?? record.difficulty,
    ),
    developmentPart: parseDevelopmentPart(
      record.developmentPart
        ?? record.development_part
        ?? developmentAssignment?.part
        ?? developmentAssignment?.developmentPart,
    ),
    error: normalizeError(record.error),
    developmentQuestion: normalizeDevelopmentQuestion(
      record.developmentQuestion ?? record.development_question,
    ),
    events: normalizeEvents(record.events),
    actions: normalizeActions(record.actions),
    version: readNumber(record, ["version"]),
    codingPacketDigest: readString(record, ["codingPacketDigest", "coding_packet_digest"])
      ?? readDigest(codingPacket),
  };
}

function normalizeDifficultyAssessment(value: unknown): OfficeDifficultyAssessment | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const score = Math.min(5, Math.max(1, value));
    return { level: difficultyLevelFromScore(score), score };
  }
  if (typeof value === "string") {
    const level = parseDifficultyLevel(value);
    return level ? { level } : undefined;
  }
  const record = asRecord(value);
  if (!record) return undefined;
  const score = readNumber(record, ["score", "overallScore", "overall_score"]);
  const level = parseDifficultyLevel(readString(record, ["level", "grade", "category"]))
    ?? (score !== undefined ? difficultyLevelFromScore(score) : undefined);
  if (!level) return undefined;
  const summary = readString(record, ["summary", "rationale", "reason"]);
  return {
    level,
    score: score === undefined ? undefined : Math.min(5, Math.max(1, score)),
    summary: summary ? redactAbsolutePaths(summary).slice(0, 500) : undefined,
    recommendedPart: parseDevelopmentPart(
      record.recommendedPart ?? record.recommended_part ?? record.recommendation,
    ),
  };
}

function parseDifficultyLevel(value: unknown): OfficeDifficultyAssessment["level"] | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["easy", "low", "simple", "쉬움", "낮음"].includes(normalized)) return "easy";
  if (["normal", "medium", "moderate", "보통", "중간"].includes(normalized)) return "normal";
  if (["hard", "high", "difficult", "어려움", "높음"].includes(normalized)) return "hard";
  if (["critical", "very_high", "very-high", "complex", "매우 어려움", "최상"].includes(normalized)) return "critical";
  return undefined;
}

function difficultyLevelFromScore(score: number): OfficeDifficultyAssessment["level"] {
  if (score <= 2) return "easy";
  if (score <= 3) return "normal";
  if (score <= 4) return "hard";
  return "critical";
}

function parseDevelopmentPart(value: unknown): OfficeDevelopmentPart | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replaceAll("_", "-");
  if (["claude", "part-1", "development-1", "개발1", "개발-1"].includes(normalized)) return "claude";
  if (["opencode", "open-code", "part-2", "development-2", "개발2", "개발-2"].includes(normalized)) return "opencode";
  const parsed = developmentPartSchema.safeParse(normalized);
  return parsed.success ? parsed.data : undefined;
}

function normalizeIntakeBrief(value: unknown): OrbitIntakeBrief | undefined {
  const record = asRecord(value);
  if (!record || record.version !== "1") return undefined;
  const objective = readString(record, ["objective"]);
  if (!objective) return undefined;
  return {
    version: "1",
    objective: objective.slice(0, 500),
    currentAndExpectedBehavior: readString(record, ["currentAndExpectedBehavior", "current_and_expected_behavior"])?.slice(0, 700),
    repositoryContext: readString(record, ["repositoryContext", "repository_context"])?.slice(0, 700),
    acceptanceAndTests: readString(record, ["acceptanceAndTests", "acceptance_and_tests"])?.slice(0, 700),
    assumptions: normalizeBoundedStrings(record.assumptions, 4, 240),
  };
}

function normalizeCodingPlan(value: Record<string, unknown> | undefined): OfficeCodingPlan | undefined {
  if (!value) return undefined;
  const brief = asRecord(value.brief);
  const objective = brief && readString(brief, ["objective"]);
  const scope = brief ? normalizeBoundedStrings(brief.scope, 16, 600) : [];
  const allowedPaths = normalizeBoundedStrings(value.allowedPaths ?? value.allowed_paths, 32, 240)
    .map(safeRepoPath);
  if (!objective && scope.length === 0 && allowedPaths.length === 0) return undefined;
  return {
    objective: objective ? redactAbsolutePaths(objective).slice(0, 1_000) : undefined,
    scope,
    allowedPaths,
  };
}

function normalizeBoundedStrings(value: unknown, limit: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    .slice(0, limit)
    .map((entry) => redactAbsolutePaths(entry).slice(0, maxLength));
}

function normalizeAnalysisPreview(value: unknown): OfficeAnalysisPreview | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const jobId = readString(record, ["jobId", "job_id"]);
  const runId = readString(record, ["runId", "run_id"]);
  const title = readString(record, ["title"]);
  const objective = readString(record, ["objective", "summary"]);
  const completedAt = readString(record, ["completedAt", "completed_at"]);
  return jobId && runId && title && objective && completedAt
    ? { jobId, runId, title, objective, completedAt }
    : undefined;
}

function normalizeAnalysisStages(value: unknown): readonly OfficeAnalysisStage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const record = asRecord(entry);
    if (!record) return [];
    const id = analysisStageIdSchema.safeParse(record.id);
    const status = analysisStageStatusSchema.safeParse(record.status);
    const phase = analysisStagePhaseSchema.safeParse(record.phase);
    if (!id.success || !status.success) return [];
    return [{
      id: id.data,
      status: status.data,
      phase: phase.success ? phase.data : undefined,
      startedAt: readString(record, ["startedAt", "started_at"]),
      updatedAt: readString(record, ["updatedAt", "updated_at", "heartbeatAt", "heartbeat_at"]),
      completedAt: readString(record, ["completedAt", "completed_at"]),
      attempt: readNumber(record, ["attempt"]),
      summary: readString(record, ["summary"]),
    }];
  });
}

function normalizeCoding(value: unknown): OfficeCodingResult | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const rawDiff = readString(record, ["diff", "boundedDiff", "patch"]);
  const diff = rawDiff ? redactAbsolutePaths(rawDiff).slice(0, MAX_DIFF_LENGTH) : undefined;
  const rawSummary = readString(record, ["summary", "output"]);
  const publishMode = readString(record, ["publishMode", "publish_mode"]);
  const changedFiles = normalizeChangedFiles(record.changedFiles ?? record.changed_files);
  return {
    runtimeLabel: readString(record, ["runtimeLabel", "runtime_label", "profile"]),
    model: readString(record, ["model"]),
    branchName: readString(record, ["branchName", "branch_name", "branch"]),
    baseSha: readString(record, ["baseSha", "base_sha"]),
    changedFiles,
    changedFileCount: readNumber(record, ["changedFileCount", "changed_file_count"])
      ?? changedFiles.length,
    diff,
    diffTruncated: readBoolean(record, ["diffTruncated", "diff_truncated"], false)
      || Boolean(rawDiff && rawDiff.length > MAX_DIFF_LENGTH),
    summary: rawSummary ? redactAbsolutePaths(rawSummary).slice(0, 1_200) : undefined,
    test: normalizeTest(record.test ?? record.tests),
    commitSha: readString(record, ["commitSha", "commit_sha"]),
    pushed: readBoolean(record, ["pushed"], false) || publishMode === "commit_and_push",
    changesDigest: readString(record, ["changesDigest", "changes_digest"]),
    pullRequestUrl: readHttpsUrl(record, ["pullRequestUrl", "pull_request_url"]),
    pullRequestNumber: readNumber(record, ["pullRequestNumber", "pull_request_number"]),
    pullRequestError: readString(record, ["pullRequestError", "pull_request_error"]),
    reviewFeedback: readString(record, ["reviewFeedback", "review_feedback"]),
    reviewRound: readNumber(record, ["reviewRound", "review_round"]) ?? 0,
    issueUrl: readHttpsUrl(record, ["issueUrl", "issue_url"]),
    issueError: readString(record, ["issueError", "issue_error"]),
  };
}

function normalizeActions(value: unknown): OfficeJobActions {
  const record = asRecord(value);
  return {
    approveCoding: record ? readBoolean(record, ["approveCoding", "approve_coding"], false) : false,
    cancel: record ? readBoolean(record, ["cancel"], false) : false,
    retry: record ? readBoolean(record, ["retry"], false) : false,
    publishCommit: record ? readBoolean(record, ["publishCommit", "publish_commit"], false) : false,
    publishAndPush: record ? readBoolean(record, ["publishAndPush", "publish_and_push"], false) : false,
    requestChanges: record ? readBoolean(record, ["requestChanges", "request_changes"], false) : false,
    mergePr: record ? readBoolean(record, ["mergePr", "merge_pr"], false) : false,
    answerDevelopmentQuestion: record
      ? readBoolean(record, ["answerDevelopmentQuestion", "answer_development_question"], false)
      : false,
    requestReanalysis: record
      ? readBoolean(record, ["requestReanalysis", "request_reanalysis"], false)
      : false,
  };
}

function normalizeAnalysisHistory(value: unknown): readonly OfficeAnalysisHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const record = asRecord(entry);
    const feedback = record && readString(record, ["feedback"]);
    const archivedAt = record && readString(record, ["archivedAt", "archived_at"]);
    if (!record || !record.result || !feedback || !archivedAt) return [];
    return [{ result: record.result, feedback: feedback.slice(0, 4_000), archivedAt }];
  });
}

function normalizeAnalysisHistoryPreviews(value: unknown): readonly OfficeAnalysisHistoryPreview[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const preview = normalizeAnalysisPreview(entry);
    const record = asRecord(entry);
    const feedback = record && readString(record, ["feedback"]);
    const archivedAt = record && readString(record, ["archivedAt", "archived_at"]);
    return preview && feedback && archivedAt ? [{ ...preview, feedback, archivedAt }] : [];
  });
}

function normalizeDevelopmentQuestion(value: unknown): OfficeDevelopmentQuestion | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const id = readString(record, ["id"]);
  const raisedBy = developmentRoleSchema.safeParse(record.raisedBy ?? record.raised_by);
  const resumeStage = developmentResumeStageSchema.safeParse(record.resumeStage ?? record.resume_stage);
  const status = developmentQuestionStatusSchema.safeParse(record.status);
  const title = readString(record, ["title"]);
  const question = readString(record, ["question"]);
  const context = readString(record, ["context"]);
  const createdAt = readString(record, ["createdAt", "created_at"]);
  if (!id || !raisedBy.success || !resumeStage.success || !status.success || !title || !question || !context || !createdAt) {
    return undefined;
  }
  return {
    id,
    raisedBy: raisedBy.data,
    title: redactAbsolutePaths(title).slice(0, 180),
    question: redactAbsolutePaths(question).slice(0, 1_200),
    context: redactAbsolutePaths(context).slice(0, 1_600),
    evidence: normalizeBoundedStrings(record.evidence, 8, 500),
    attempted: normalizeBoundedStrings(record.attempted, 8, 500),
    resumeStage: resumeStage.data,
    status: status.data,
    createdAt,
    answer: readString(record, ["answer"])?.slice(0, 4_000),
    answeredAt: readString(record, ["answeredAt", "answered_at"]),
  };
}

function normalizeChangedFiles(value: unknown): readonly OfficeChangedFile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === "string") return [{ path: safeRepoPath(entry) }];
    const record = asRecord(entry);
    const path = record && readString(record, ["path", "file", "name"]);
    return path ? [{ path: safeRepoPath(path), status: readString(record, ["status", "changeType"]) }] : [];
  });
}

function normalizeTest(value: unknown): OfficeCodingTest | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const parsedStatus = testStatusSchema.safeParse(record.status);
  const output = readString(record, ["output", "log"]);
  return {
    status: parsedStatus.success ? parsedStatus.data : "unknown",
    command: readString(record, ["command"]),
    output: output ? redactAbsolutePaths(output).slice(0, MAX_OUTPUT_LENGTH) : undefined,
  };
}

function normalizeError(value: unknown): OfficeJobError | undefined {
  if (typeof value === "string") return { message: value };
  const record = asRecord(value);
  if (!record) return undefined;
  const message = readString(record, ["message", "safeMessage", "safe_message"]);
  if (!message) return undefined;
  return {
    code: readString(record, ["code"]),
    message,
    retryable: readOptionalBoolean(record, ["retryable"]),
    stage: parseErrorStage(record.stage),
  };
}

function parseErrorStage(value: unknown): OfficeJobError["stage"] {
  return value === "analysis" || value === "coding" || value === "testing"
    || value === "publishing" || value === "queue" ? value : undefined;
}

function normalizeEvents(value: unknown): readonly OfficeJobEvent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const record = asRecord(entry);
    if (!record) return [];
    return [{
      id: readString(record, ["id"]),
      type: readString(record, ["type"]),
      message: readString(record, ["message"]),
      createdAt: readString(record, ["createdAt", "created_at", "timestamp"]),
      agentId: readString(record, ["agentId", "agent_id", "role"]),
    }];
  });
}

function unwrapAnalysis(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) return value;
  return record.raw ?? record.result ?? record.output ?? value;
}

function readDigest(value: unknown): string | undefined {
  const record = asRecord(value);
  return record ? readString(record, ["digest", "artifactDigest", "artifact_digest"]) : undefined;
}

function parseJobState(value: unknown): OfficeJobState | undefined {
  const parsed = jobStateSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function parseRecord(value: unknown, message: string): Record<string, unknown> {
  const parsed = recordSchema.safeParse(value);
  if (!parsed.success) throw new JobContractError(message);
  return parsed.data;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  const parsed = recordSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function readString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) if (typeof record[key] === "string" && record[key]) return record[key];
  return undefined;
}

function readHttpsUrl(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  const value = readString(record, keys);
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function readNumber(record: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) if (typeof record[key] === "number" && Number.isFinite(record[key])) return record[key];
  return undefined;
}

function readOptionalBoolean(record: Record<string, unknown>, keys: readonly string[]): boolean | undefined {
  for (const key of keys) if (typeof record[key] === "boolean") return record[key];
  return undefined;
}

function readBoolean(record: Record<string, unknown>, keys: readonly string[], fallback: boolean): boolean {
  return readOptionalBoolean(record, keys) ?? fallback;
}

function readNestedString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  const direct = readString(record, keys);
  if (direct) return direct;
  for (const key of keys) {
    const nested = asRecord(record[key]);
    const label = nested && readString(nested, ["label", "runtimeLabel", "model"]);
    if (label) return label;
  }
  return undefined;
}

function safeRepoPath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  if (!normalized.startsWith("/") && !/^[A-Za-z]:\//u.test(normalized)) return normalized;
  const parts = normalized.split("/").filter(Boolean);
  return `…/${parts.slice(-3).join("/")}`;
}

function redactAbsolutePaths(value: string): string {
  return value
    .replace(/\/(?:Users|home|tmp|var\/folders)\/[^\s"']+/gu, "[workspace-path]")
    .replace(/[A-Za-z]:\\[^\s"']+/gu, "[workspace-path]");
}

export class JobContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobContractError";
  }
}
