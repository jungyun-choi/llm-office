import {
  pocCapabilitiesSchema,
  pocErrorResponseSchema,
  pocRunResultSchema,
  type PocRunResultDto,
} from "./poc-contract";

export type PocConnectionMode = "checking" | "codex" | "opencode" | "demo";

export interface PocEndpoint {
  kind: "local" | "hosted";
  baseUrl: string;
  connectionMode: PocConnectionMode;
  requestTimeoutMs: number;
  bridgeToken?: string;
}

export interface PocRunOutcome {
  result: PocRunResultDto;
  usedHostedFallback: boolean;
}

const LOCAL_POC_BASE = "http://127.0.0.1:4317/api/v1/poc";
const HOSTED_POC_BASE = "/api/v1/poc";
const HOSTED_REQUEST_TIMEOUT_MS = 15_000;

export function hostedPocEndpoint(): PocEndpoint {
  return {
    kind: "hosted",
    baseUrl: HOSTED_POC_BASE,
    connectionMode: "demo",
    requestTimeoutMs: HOSTED_REQUEST_TIMEOUT_MS,
  };
}

export async function probeLocalPocEndpoint(signal: AbortSignal): Promise<PocEndpoint> {
  const response = await fetch(`${LOCAL_POC_BASE}/capabilities`, {
    method: "GET",
    cache: "no-store",
    credentials: "omit",
    signal,
  });
  if (!response.ok) return hostedPocEndpoint();
  const parsed = pocCapabilitiesSchema.safeParse(await readJson(response));
  if (!parsed.success || !parsed.data.agentRuntime.enabled || !parsed.data.agentRuntime.available) {
    return hostedPocEndpoint();
  }
  return {
    kind: "local",
    baseUrl: LOCAL_POC_BASE,
    connectionMode: runtimeMode(parsed.data.agentRuntime.label),
    requestTimeoutMs: Math.min(190_000, parsed.data.agentRuntime.timeoutMs + 8_000),
    bridgeToken: parsed.data.bridgeToken,
  };
}

export async function runPocRequest(
  endpoint: PocEndpoint,
  prompt: string,
  signal: AbortSignal,
): Promise<PocRunOutcome> {
  const requestIds = createRequestIds();
  try {
    return { result: await postRun(endpoint, prompt, requestIds, signal), usedHostedFallback: false };
  } catch (error) {
    if (signal.aborted || endpoint.kind === "hosted") throw error;
    const result = await postRun(hostedPocEndpoint(), prompt, requestIds, signal);
    return { result, usedHostedFallback: true };
  }
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
  if (endpoint.kind === "local" && endpoint.bridgeToken) {
    headers.set("X-AI-Office-Bridge-Token", endpoint.bridgeToken);
  }
  const response = await fetchWithDeadline(`${endpoint.baseUrl}/runs`, {
    method: "POST",
    cache: "no-store",
    credentials: endpoint.kind === "local" ? "omit" : "same-origin",
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

class PocClientError extends Error {
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
