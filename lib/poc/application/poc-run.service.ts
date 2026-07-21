import type { AgentRuntimeResult } from "./ports/agent-runtime";
import type { CreatePocRunInput } from "../domain/poc-schema";
import { PocError, PocRunnerError } from "../domain/poc-errors";
import type { PocFallbackReason, PocRunResult } from "../domain/poc-types";
import { runDemoPoc } from "../infrastructure/demo-poc-runner";
import {
  getConfiguredAgentRuntime,
  isLocalRunnerEnabled,
} from "../infrastructure/runtime-registry";
import { pocSingleFlight } from "../infrastructure/single-flight";
import { SyntheticSimulatorSource } from "../infrastructure/synthetic-simulator-source";
import { buildPocRunResult } from "./poc-result-builder";

export interface PocRunOptions {
  idempotencyKey: string;
  signal?: AbortSignal;
}

export class PocRunService {
  async execute(input: CreatePocRunInput, options: PocRunOptions): Promise<PocRunResult> {
    const fingerprint = await requestFingerprint(input);
    return pocSingleFlight.run(options.idempotencyKey, fingerprint, () =>
      this.executeOnce(input, options.signal),
    );
  }

  private async executeOnce(
    input: CreatePocRunInput,
    signal?: AbortSignal,
  ): Promise<PocRunResult> {
    const requestedAt = new Date().toISOString();
    const runner = await this.selectRunner(input, signal);
    const completedAt = new Date().toISOString();
    return buildPocRunResult(runner, requestedAt, completedAt);
  }

  private async selectRunner(
    input: CreatePocRunInput,
    signal?: AbortSignal,
  ): Promise<AgentRuntimeResult> {
    if (input.executionMode === "demo") return runDemoPoc(input.prompt);
    if (!isLocalRunnerEnabled()) return runDemoPoc(input.prompt, "disabled");

    const runtime = getConfiguredAgentRuntime();
    if (!(await runtime.isAvailable())) return runDemoPoc(input.prompt, "unavailable");
    const source = await new SyntheticSimulatorSource().resolve();
    const startedAt = Date.now();
    try {
      return await runtime.execute({ featureRequest: input.prompt, source, signal });
    } catch (error) {
      return fallbackAfterRuntimeError(error, input.prompt, Date.now() - startedAt);
    }
  }
}

function fallbackAfterRuntimeError(
  error: unknown,
  prompt: string,
  durationMs: number,
): AgentRuntimeResult {
  if (error instanceof PocRunnerError && error.reason === "aborted") {
    throw new PocError("REQUEST_ABORTED", "요청 연결이 종료되었습니다.", 408, true);
  }
  const reason: PocFallbackReason = mapFallbackReason(error);
  const fallback = runDemoPoc(prompt, reason);
  fallback.metrics = { cliProcesses: 1, modelTurns: 1, durationMs };
  if (process.env.AI_OFFICE_AGENT_RUNTIME === "codex") {
    fallback.dataRoute = "external-openai";
    fallback.runtimeLabel = "안전한 데모 엔진 (Codex 실패 후)";
  } else if (process.env.AI_OFFICE_AGENT_RUNTIME === "opencode") {
    fallback.dataRoute = "internal-opencode";
  }
  return fallback;
}

function mapFallbackReason(error: unknown): PocFallbackReason {
  if (!(error instanceof PocRunnerError)) return "model_error";
  if (error.reason === "aborted") return "model_error";
  return error.reason;
}

async function requestFingerprint(input: CreatePocRunInput): Promise<string> {
  const normalized = JSON.stringify({
    prompt: input.prompt.replace(/\s+/gu, " ").trim(),
    executionMode: input.executionMode,
  });
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const pocRunService = new PocRunService();
