import type { AgentRuntimeResult } from "./ports/agent-runtime";
import type { CreatePocRunInput } from "../domain/poc-schema";
import { PocError, PocRunnerError } from "../domain/poc-errors";
import type { PocRunResult } from "../domain/poc-types";
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
    if (!isLocalRunnerEnabled()) throw localRuntimeError("disabled");

    const runtime = getConfiguredAgentRuntime();
    if (!(await runtime.isAvailable())) throw localRuntimeError("unavailable");
    const source = await new SyntheticSimulatorSource().resolve();
    try {
      return await runtime.execute({ featureRequest: input.prompt, source, signal });
    } catch (error) {
      throw mapRuntimeError(error);
    }
  }
}

function mapRuntimeError(error: unknown): PocError {
  if (!(error instanceof PocRunnerError)) return localRuntimeError("model_error");
  return localRuntimeError(error.reason);
}

function localRuntimeError(
  reason: "disabled" | PocRunnerError["reason"],
): PocError {
  if (reason === "aborted") {
    return new PocError("REQUEST_ABORTED", "요청 연결이 종료되었습니다.", 408, true);
  }
  if (reason === "timeout") {
    return new PocError("LOCAL_RUNTIME_TIMEOUT", "로컬 모델 응답 시간이 초과되었습니다.", 504, true);
  }
  if (reason === "disabled") {
    return new PocError("LOCAL_RUNTIME_DISABLED", "로컬 모델 런타임이 꺼져 있습니다.", 503, false);
  }
  if (reason === "unavailable") {
    return new PocError("LOCAL_RUNTIME_UNAVAILABLE", "로컬 모델 런타임을 사용할 수 없습니다.", 503, true);
  }
  if (reason === "invalid_output") {
    return new PocError("LOCAL_RUNTIME_INVALID_OUTPUT", "모델 결과 형식이 올바르지 않습니다.", 502, true);
  }
  return new PocError("LOCAL_RUNTIME_FAILED", "로컬 모델 실행에 실패했습니다.", 502, true);
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
