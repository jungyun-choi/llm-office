import type { AgentRuntime } from "../application/ports/agent-runtime";
import { CodexCliRuntime } from "./codex-cli-runtime";
import { OpenCodeCliRuntime } from "./opencode-poc-runner";

export function isLocalRunnerEnabled(): boolean {
  const runtime = process.env.AI_OFFICE_AGENT_RUNTIME;
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.AI_OFFICE_LOCAL_RUNNER_ENABLED === "1" &&
    (runtime === "codex" || runtime === "opencode")
  );
}

export function getConfiguredAgentRuntime(): AgentRuntime {
  if (process.env.AI_OFFICE_AGENT_RUNTIME === "opencode") {
    return new OpenCodeCliRuntime();
  }
  if (process.env.AI_OFFICE_AGENT_RUNTIME !== "codex") {
    throw new Error("A local agent runtime must be explicitly selected");
  }
  return new CodexCliRuntime();
}

export function getAgentTimeoutMs(): number {
  const parsed = Number(process.env.AI_OFFICE_AGENT_TIMEOUT_MS ?? 120_000);
  if (!Number.isFinite(parsed)) return 120_000;
  return Math.min(180_000, Math.max(30_000, Math.round(parsed)));
}
