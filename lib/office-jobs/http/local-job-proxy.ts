import { JobError } from "../domain/job-errors";
import { jobErrorResponse, jobJsonResponse } from "./job-http";
import { timingSafeEqual } from "node:crypto";

const CAPABILITY_TIMEOUT_MS = 8_000;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_REQUEST_BYTES = 8 * 1_024;
const MAX_RESPONSE_BYTES = 4 * 1_024 * 1_024;
const BRIDGE_START_RETRY_DELAYS_MS = [300, 700] as const;
const BRIDGE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/u;
const TRUSTED_PROXY_SECRET_PATTERN = /^[A-Za-z0-9_-]{43,128}$/u;
const TRUSTED_USER_PATTERN = /^[a-zA-Z0-9@._+-]{1,128}$/u;

export async function proxyLocalJobCapabilities(request: Request): Promise<Response> {
  const correlationId = safeRequestId(request.headers.get("x-correlation-id"));
  try {
    assertProxyExecutionAllowed();
    assertCompanyRequestAuthorized(request);
    assertSameOrigin(request);
    const bridgeToken = requireConfiguredBridgeToken();
    const response = await fetchBridgeWithStartupRetry(
      "/api/v1/jobs/capabilities",
      {
        method: "GET",
        cache: "no-store",
        credentials: "omit",
        headers: createBridgeHeaders(request, bridgeToken, correlationId),
        signal: request.signal,
      },
      CAPABILITY_TIMEOUT_MS,
    );
    const payload = removeBridgeToken(await readLimitedJson(response));
    return jobJsonResponse(payload, response.status, correlationId, safeResponseHeaders(response));
  } catch (error) {
    return jobErrorResponse(toProxyError(error), correlationId);
  }
}

export async function proxyLocalJobRequest(
  request: Request,
  bridgePath: string,
): Promise<Response> {
  const correlationId = safeRequestId(request.headers.get("x-correlation-id"));
  try {
    assertProxyExecutionAllowed();
    assertCompanyRequestAuthorized(request);
    assertSameOrigin(request);
    const bridgeToken = requireConfiguredBridgeToken();
    const body = request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await readLimitedRequestBody(request);
    const response = await fetchBridgeWithStartupRetry(bridgePath, {
      method: request.method,
      cache: "no-store",
      credentials: "omit",
      headers: createBridgeHeaders(request, bridgeToken, correlationId),
      body,
      signal: request.signal,
    });
    const payload = await readLimitedJson(response);
    return jobJsonResponse(payload, response.status, correlationId, safeResponseHeaders(response));
  } catch (error) {
    return jobErrorResponse(toProxyError(error), correlationId);
  }
}

export function isProductionExecutionAcknowledged(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment.NODE_ENV !== "production" || (
    environment.AI_OFFICE_DEPLOYMENT_MODE === "internal" &&
    environment.AI_OFFICE_INTERNAL_EXECUTION_ACK === "on-prem-only"
  );
}

function assertProxyExecutionAllowed(): void {
  if (process.env.AI_OFFICE_LOCAL_PROXY_ENABLED !== "1") {
    throw new JobError(
      "LOCAL_JOB_PROXY_DISABLED",
      "단일 서버 업무 브리지가 비활성화되어 있습니다.",
      503,
      false,
    );
  }
  if (!isProductionExecutionAcknowledged()) {
    throw new JobError(
      "PRODUCTION_EXECUTION_DENIED",
      "운영 환경에서는 internal 배포와 on-prem 실행 확인이 모두 필요합니다.",
      503,
      false,
    );
  }
}

function requireConfiguredBridgeToken(): string {
  const token = process.env.AI_OFFICE_BRIDGE_TOKEN;
  if (token && BRIDGE_TOKEN_PATTERN.test(token)) return token;
  throw new JobError(
    "BRIDGE_TOKEN_MISSING",
    "서버의 실행 브리지 인증이 구성되지 않았습니다.",
    503,
    false,
  );
}

function assertCompanyRequestAuthorized(request: Request): void {
  const protectedDeployment = process.env.NODE_ENV === "production" ||
    process.env.AI_OFFICE_OPENCODE_PROFILE === "company";
  if (!protectedDeployment) return;
  const configuredSecret = process.env.AI_OFFICE_TRUSTED_PROXY_SECRET;
  const configuredUser = process.env.AI_OFFICE_COMPANY_ALLOWED_USER;
  const presentedSecret = request.headers.get("x-ai-office-trusted-proxy");
  const presentedUser = request.headers.get("x-ai-office-user");
  if (
    !configuredSecret ||
    !TRUSTED_PROXY_SECRET_PATTERN.test(configuredSecret) ||
    !configuredUser ||
    !TRUSTED_USER_PATTERN.test(configuredUser) ||
    !presentedSecret ||
    !presentedUser ||
    !safeEqual(presentedSecret, configuredSecret) ||
    !safeEqual(presentedUser, configuredUser)
  ) {
    throw new JobError(
      "COMPANY_ACCESS_DENIED",
      "인증된 사내 개인 서버를 통해서만 회사 업무에 접근할 수 있습니다.",
      401,
      false,
    );
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes);
}

function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(request.url).origin;
  } catch {
    throw invalidOrigin();
  }
  if (origin !== expectedOrigin) throw invalidOrigin();
}

function invalidOrigin(): JobError {
  return new JobError(
    "ORIGIN_DENIED",
    "같은 AI Office 주소에서 보낸 요청만 허용합니다.",
    403,
    false,
  );
}

async function fetchBridgeWithStartupRetry(
  path: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  for (let attempt = 0; attempt <= BRIDGE_START_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await fetchBridge(path, init, timeoutMs);
    } catch (error) {
      if (
        !(error instanceof JobError) ||
        error.code !== "LOCAL_JOB_BRIDGE_UNAVAILABLE" ||
        attempt === BRIDGE_START_RETRY_DELAYS_MS.length
      ) {
        throw error;
      }
      await delay(BRIDGE_START_RETRY_DELAYS_MS[attempt]);
    }
  }
  throw bridgeUnavailable();
}

async function fetchBridge(
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  if (!path.startsWith("/api/v1/jobs")) throw invalidBridgeResponse();
  const controller = new AbortController();
  const abort = () => controller.abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${bridgeBaseUrl()}${path}`, { ...init, signal: controller.signal });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw bridgeUnavailable();
  } finally {
    clearTimeout(timeoutId);
    init.signal?.removeEventListener("abort", abort);
  }
}

function bridgeBaseUrl(): string {
  const configured = Number(process.env.AI_OFFICE_BRIDGE_PORT ?? 4317);
  const port = Number.isInteger(configured) && configured >= 1_024 && configured <= 65_535
    ? configured
    : 4317;
  return `http://127.0.0.1:${port}`;
}

function createBridgeHeaders(
  request: Request,
  bridgeToken: string,
  correlationId: string,
): Headers {
  const headers = new Headers({
    "x-ai-office-bridge-token": bridgeToken,
    "x-correlation-id": correlationId,
  });
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const idempotencyKey = request.headers.get("idempotency-key");
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
  return headers;
}

async function readLimitedRequestBody(request: Request): Promise<ArrayBuffer> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_REQUEST_BYTES) throw payloadTooLarge();
  if (!request.body) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw payloadTooLarge();
    }
    chunks.push(value);
  }
  const result = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result.buffer;
}

async function readLimitedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) throw invalidBridgeResponse();
  if (!response.body) throw invalidBridgeResponse();
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw invalidBridgeResponse();
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } catch (error) {
    if (error instanceof JobError) throw error;
    throw invalidBridgeResponse();
  }
}

function safeResponseHeaders(response: Response): HeadersInit {
  const headers: Record<string, string> = {};
  for (const name of ["location", "retry-after", "x-idempotent-replay"] as const) {
    const value = response.headers.get(name);
    if (value) headers[name] = value;
  }
  return headers;
}

function removeBridgeToken(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const safePayload = { ...(payload as Record<string, unknown>) };
  delete safePayload.bridgeToken;
  return safePayload;
}

function safeRequestId(value: string | null): string {
  return value && /^[a-zA-Z0-9._:-]{8,128}$/u.test(value) ? value : crypto.randomUUID();
}

function payloadTooLarge(): JobError {
  return new JobError("PAYLOAD_TOO_LARGE", "요청 본문은 8 KiB 이하여야 합니다.", 413, false);
}

function invalidBridgeResponse(): JobError {
  return new JobError(
    "INVALID_JOB_BRIDGE_RESPONSE",
    "단일 서버 업무 브리지 응답을 확인하지 못했습니다.",
    502,
    true,
  );
}

function bridgeUnavailable(): JobError {
  return new JobError(
    "LOCAL_JOB_BRIDGE_UNAVAILABLE",
    "단일 서버 업무 브리지에 연결하지 못했습니다.",
    503,
    true,
  );
}

function toProxyError(error: unknown): unknown {
  if (error instanceof JobError) return error;
  if (isAbortError(error)) return bridgeUnavailable();
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
