import type { WorkflowStatus } from "./types";

export function calculateWorkflowElapsedSeconds(
  status: WorkflowStatus,
  startedAtMs: number | null,
  nowMs: number,
): number {
  if (status !== "running" || startedAtMs === null) return 0;
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(nowMs)) return 0;
  return Math.max(0, Math.floor((nowMs - startedAtMs) / 1_000));
}

export function formatWorkflowElapsedTime(totalSeconds: number): string {
  const safeSeconds = Number.isFinite(totalSeconds)
    ? Math.max(0, Math.floor(totalSeconds))
    : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
