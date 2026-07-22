import type { AgentRuntimeProgressCallback, AgentRuntimeResult } from "./ports/agent-runtime";
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
import {
  isCompanyDataAccessAcknowledged,
  loadExtensionSimulatorSource,
} from "../infrastructure/extension-source-loader";
import { hasConfiguredIssuePublisher } from "../infrastructure/extension-issue-publisher";
import { assertSafeCompanyModelOutput } from "../infrastructure/company-output-boundary";
import { buildPocRunResult } from "./poc-result-builder";

export interface PocRunOptions {
  idempotencyKey: string;
  signal?: AbortSignal;
  onProgress?: AgentRuntimeProgressCallback;
}

export interface PocRunServiceOptions {
  allowCompanyExtensions?: boolean;
}

interface SelectedRunner {
  result: AgentRuntimeResult;
  companyData: boolean;
}

export class PocRunService {
  private readonly allowCompanyExtensions: boolean;

  constructor(options: PocRunServiceOptions = {}) {
    this.allowCompanyExtensions = options.allowCompanyExtensions === true;
  }

  async execute(input: CreatePocRunInput, options: PocRunOptions): Promise<PocRunResult> {
    const fingerprint = await requestFingerprint(input);
    return pocSingleFlight.run(options.idempotencyKey, fingerprint, () =>
      this.executeOnce(input, options.signal, options.onProgress),
    );
  }

  private async executeOnce(
    input: CreatePocRunInput,
    signal?: AbortSignal,
    onProgress?: AgentRuntimeProgressCallback,
  ): Promise<PocRunResult> {
    const requestedAt = new Date().toISOString();
    const selected = await this.selectRunner(input, signal, onProgress);
    const completedAt = new Date().toISOString();
    const result = buildPocRunResult(selected.result, requestedAt, completedAt);
    if (!selected.companyData) return result;
    const issuePublisherReady = await hasConfiguredIssuePublisher();
    return {
      ...result,
      notices: [
        "승인된 사내 저장소 스냅샷과 사내 OpenCode company 런타임만 사용했습니다.",
        "분석 에이전트는 코드를 수정하지 않았습니다.",
        issuePublisherReady
          ? "Git 이슈 어댑터 파일의 경계 검증은 통과했지만, digest 기반 사람 승인 기능이 연결되기 전까지 자동 등록은 잠겨 있습니다."
          : "Git 이슈는 등록되지 않았으며 검토 가능한 초안만 준비했습니다.",
      ],
    };
  }

  private async selectRunner(
    input: CreatePocRunInput,
    signal?: AbortSignal,
    onProgress?: AgentRuntimeProgressCallback,
  ): Promise<SelectedRunner> {
    if (input.executionMode === "demo") {
      return { result: runDemoPoc(input.prompt), companyData: false };
    }
    if (!isLocalRunnerEnabled()) throw localRuntimeError("disabled");

    const companyData = isCompanyOpenCodeRequested();
    if (
      companyData &&
      (!this.allowCompanyExtensions || !isCompanyDataAccessAcknowledged())
    ) {
      throw localRuntimeError("disabled");
    }

    try {
      const runtime = getConfiguredAgentRuntime();
      if (!(await runtime.isAvailable())) throw new PocRunnerError("unavailable");
      const source = await (companyData
        ? await loadExtensionSimulatorSource()
        : new SyntheticSimulatorSource()).resolve({
          featureRequest: input.prompt,
          signal,
        });
      const result = await runtime.execute({
        featureRequest: input.prompt,
        source,
        signal,
        onProgress,
      });
      if (companyData) assertSafeCompanyModelOutput(result.output);
      return {
        result,
        companyData,
      };
    } catch (error) {
      throw mapRuntimeError(error);
    }
  }
}

function isCompanyOpenCodeRequested(): boolean {
  return process.env.AI_OFFICE_AGENT_RUNTIME === "opencode" &&
    process.env.AI_OFFICE_OPENCODE_PROFILE === "company";
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
