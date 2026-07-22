import type { AgentRuntime } from "../application/ports/agent-runtime";
import { CodexCliRuntime } from "./codex-cli-runtime";
import { OpenCodeCliRuntime } from "./opencode-poc-runner";
import { getOpenCodeRuntimeConfig } from "./opencode-runtime-config";

export function isLocalRunnerEnabled(): boolean {
  const runtime = process.env.AI_OFFICE_AGENT_RUNTIME;
  return (
    process.env.AI_OFFICE_LOCAL_RUNNER_ENABLED === "1" &&
    (runtime === "codex" || runtime === "opencode") &&
    productionRuntimeAllowed(runtime)
  );
}

function productionRuntimeAllowed(runtime: string | undefined): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const profile = process.env.AI_OFFICE_OPENCODE_PROFILE;
  return runtime === "opencode" &&
    (profile === "internal" || profile === "company") &&
    process.env.AI_OFFICE_DEPLOYMENT_MODE === "internal" &&
    process.env.AI_OFFICE_INTERNAL_EXECUTION_ACK === "on-prem-only";
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

export function configuredRuntimeUsesExternalModel(): boolean {
  if (process.env.AI_OFFICE_AGENT_RUNTIME === "codex") return true;
  if (process.env.AI_OFFICE_AGENT_RUNTIME !== "opencode") return false;
  return getOpenCodeRuntimeConfig().dataRoute === "external-opencode-zen";
}
