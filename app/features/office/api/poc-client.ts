import {
  pocCapabilitiesSchema,
  pocErrorResponseSchema,
  pocRunResultSchema,
  type PocCapabilitiesDto,
  type PocRunResultDto,
} from "./poc-contract";

export type PocConnectionMode = "checking" | "codex" | "opencode" | "demo" | "disconnected";

export interface PocEndpoint {
  kind: "local" | "hosted";
  baseUrl: string;
  connectionMode: PocConnectionMode;
  requestTimeoutMs: number;
}

const POC_API_BASE = "/api/v1/poc";
const CAPABILITIES_REQUEST_TIMEOUT_MS = 2_500;
const HOSTED_REQUEST_TIMEOUT_MS = 15_000;

export function hostedPocEndpoint(): PocEndpoint {
  return {
    kind: "hosted",
    baseUrl: POC_API_BASE,
    connectionMode: "demo",
    requestTimeoutMs: HOSTED_REQUEST_TIMEOUT_MS,
  };
}

export function resolvePocEndpoint(capabilities: PocCapabilitiesDto): PocEndpoint {
  if (capabilities.environment === "hosted") return hostedPocEndpoint();
  if (!capabilities.agentRuntime.enabled || !capabilities.agentRuntime.available) {
    throw new PocClientError(
      "LOCAL_RUNTIME_UNAVAILABLE",
      "로컬 POC 실행기가 준비되지 않았습니다. PC의 실행기 상태를 확인해 주세요.",
    );
  }
  return {
    kind: "local",
    baseUrl: POC_API_BASE,
    connectionMode: runtimeMode(capabilities.agentRuntime.label),
    requestTimeoutMs: Math.min(190_000, capabilities.agentRuntime.timeoutMs + 8_000),
  };
}

export async function probePocEndpoint(signal: AbortSignal): Promise<PocEndpoint> {
  let response: Response;
  try {
    response = await fetchWithDeadline(`${POC_API_BASE}/capabilities`, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    }, signal, CAPABILITIES_REQUEST_TIMEOUT_MS);
  } catch (error) {
    if (isPocAbortError(error) || error instanceof PocClientError) throw error;
    throw new PocClientError(
      "CAPABILITIES_UNAVAILABLE",
      "POC 실행 환경을 확인하지 못했습니다. 연결 상태를 확인해 주세요.",
    );
  }
  const payload = await readJson(response);
  if (!response.ok) throw createResponseError(response.status, payload);
  const parsed = pocCapabilitiesSchema.safeParse(payload);
  if (!parsed.success) {
    throw new PocClientError("INVALID_CAPABILITIES", "POC 실행 환경 응답을 확인하지 못했습니다.");
  }
  return resolvePocEndpoint(parsed.data);
}

export async function runPocRequest(
  endpoint: PocEndpoint,
  prompt: string,
  signal: AbortSignal,
): Promise<PocRunResultDto> {
  const requestIds = createRequestIds();
  return postRun(endpoint, prompt, requestIds, signal);
}

interface RequestIds {
  idempotencyKey: string;
  correlationId: string;
}

async function postRun(
  endpoint: PocEndpoint,
  prompt: string,
  requestIds: RequestIds,
  parentSignal: AbortSignal,
): Promise<PocRunResultDto> {
  const headers = new Headers({
    "Content-Type": "application/json",
    "Idempotency-Key": requestIds.idempotencyKey,
    "X-Correlation-Id": requestIds.correlationId,
  });
  const response = await fetchWithDeadline(`${endpoint.baseUrl}/runs`, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers,
    body: JSON.stringify({ prompt, executionMode: "auto" }),
  }, parentSignal, endpoint.requestTimeoutMs);
  const payload = await readJson(response);
  if (!response.ok) throw createResponseError(response.status, payload);
  const parsed = pocRunResultSchema.safeParse(payload);
  if (!parsed.success) throw new PocClientError("INVALID_RESPONSE", "결과 형식을 확인하지 못했습니다.");
  return parsed.data;
}

async function fetchWithDeadline(
  url: string,
  init: RequestInit,
  parentSignal: AbortSignal,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const abortRequest = () => controller.abort();
  if (parentSignal.aborted) throw createAbortError();
  parentSignal.addEventListener("abort", abortRequest, { once: true });
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (parentSignal.aborted) throw createAbortError();
    if (timedOut) throw new PocClientError("REQUEST_TIMEOUT", "응답 대기 시간이 길어졌습니다.");
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    parentSignal.removeEventListener("abort", abortRequest);
  }
}

export class PocClientError extends Error {
  constructor(readonly code: string, message: string, readonly status?: number) {
    super(message);
    this.name = "PocClientError";
  }
}

function createResponseError(status: number, payload: unknown): PocClientError {
  const parsed = pocErrorResponseSchema.safeParse(payload);
  return new PocClientError(
    parsed.success ? parsed.data.error.code : "REQUEST_FAILED",
    parsed.success ? parsed.data.error.message : "요청을 처리하지 못했습니다.",
    status,
  );
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    return undefined;
  }
}

function runtimeMode(label: string): PocConnectionMode {
  return /opencode/iu.test(label) ? "opencode" : "codex";
}

function createRequestIds(): RequestIds {
  return { idempotencyKey: crypto.randomUUID(), correlationId: crypto.randomUUID() };
}

function createAbortError(): DOMException {
  return new DOMException("Request aborted", "AbortError");
}

export function isPocAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
