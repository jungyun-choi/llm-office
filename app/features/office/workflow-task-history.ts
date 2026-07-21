import type { AgentId, OfficeResult, OfficeTask, OfficeTaskStatus } from "./types";

const MAX_TERMINAL_HISTORY = 20;
const MAX_ACTIVE_TASKS = 10;
const TASK_STATUSES = new Set<OfficeTaskStatus>(["pending", "running", "completed", "failed"]);
const AGENT_IDS = new Set<AgentId>(["orchestrator", "research", "framework", "estimate", "test", "git"]);

export function pruneOfficeTasks(tasks: readonly OfficeTask[]): readonly OfficeTask[] {
  const terminalTasks = tasks.filter(isTerminalTask);
  const activeIdsToKeep = new Set(
    tasks.filter((task) => !isTerminalTask(task)).slice(0, MAX_ACTIVE_TASKS).map((task) => task.id),
  );
  const terminalIdsToKeep = new Set(
    terminalTasks.slice(-MAX_TERMINAL_HISTORY).map((task) => task.id),
  );
  return tasks.filter((task) => isTerminalTask(task)
    ? terminalIdsToKeep.has(task.id)
    : activeIdsToKeep.has(task.id));
}

export function serializeOfficeTasks(tasks: readonly OfficeTask[]): string {
  return JSON.stringify(pruneOfficeTasks(tasks));
}

export function restoreOfficeTasks(raw: string | null): readonly OfficeTask[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return pruneOfficeTasks(parsed.flatMap(readOfficeTask));
  } catch {
    return [];
  }
}

function readOfficeTask(value: unknown): readonly OfficeTask[] {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || typeof value.request !== "string"
    || typeof value.submittedAt !== "string"
    || typeof value.status !== "string"
    || !TASK_STATUSES.has(value.status as OfficeTaskStatus)) return [];

  const status = value.status === "running" ? "pending" : value.status as OfficeTaskStatus;
  const result = isOfficeResult(value.result) ? value.result : undefined;
  const errorMessage = typeof value.errorMessage === "string" ? value.errorMessage : undefined;
  const errorAgentIds = Array.isArray(value.errorAgentIds)
    ? value.errorAgentIds.filter((agentId): agentId is AgentId => typeof agentId === "string" && AGENT_IDS.has(agentId as AgentId))
    : [];

  return [{
    id: value.id,
    request: value.request,
    submittedAt: value.submittedAt,
    status,
    ...(result ? { result } : {}),
    ...(errorMessage ? { errorMessage } : {}),
    ...(errorAgentIds.length > 0 ? { errorAgentIds } : {}),
  }];
}

function isTerminalTask(task: OfficeTask): boolean {
  return task.status === "completed" || task.status === "failed";
}

function isOfficeResult(value: unknown): value is OfficeResult {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.request === "string"
    && typeof value.title === "string"
    && typeof value.summary === "string"
    && typeof value.gitIssueTitle === "string"
    && typeof value.createdAt === "string"
    && Array.isArray(value.sections)
    && Array.isArray(value.roleOutputs)
    && Array.isArray(value.workItems)
    && Array.isArray(value.notices)
    && isRecord(value.issueDraft)
    && isRecord(value.engine);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
