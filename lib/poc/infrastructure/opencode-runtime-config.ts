import path from "node:path";

const DEFAULT_MODEL = "ollama/qwen2.5-coder:3b";
const DEFAULT_TIMEOUT_MS = 120_000;
const MIN_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 180_000;
const MODEL_PATTERN = /^[a-z0-9_.-]+\/[a-z0-9_.:-]+$/iu;

export interface OpenCodeRuntimeConfig {
  enabled: boolean;
  model: string;
  repositoryRoot: string;
  timeoutMs: number;
  stdoutLimitBytes: number;
  stderrLimitBytes: number;
}

function boundedTimeout(value: string | undefined): number {
  const parsed = Number(value ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(parsed)));
}

function configuredModel(value: string | undefined): string {
  if (!value || !MODEL_PATTERN.test(value)) {
    return DEFAULT_MODEL;
  }
  return value;
}

export function getOpenCodeRuntimeConfig(): OpenCodeRuntimeConfig {
  return {
    enabled:
      process.env.AI_OFFICE_LOCAL_RUNNER_ENABLED === "1" &&
      process.env.AI_OFFICE_AGENT_RUNTIME === "opencode",
    model: configuredModel(process.env.AI_OFFICE_OPENCODE_MODEL),
    repositoryRoot: path.resolve(process.cwd(), "poc", "simulator"),
    timeoutMs: boundedTimeout(process.env.AI_OFFICE_OPENCODE_TIMEOUT_MS),
    stdoutLimitBytes: 512 * 1_024,
    stderrLimitBytes: 64 * 1_024,
  };
}

export function isHostedEnvironment(): boolean {
  return process.env.NODE_ENV === "production" &&
    process.env.AI_OFFICE_LOCAL_RUNNER_ENABLED !== "1";
}
