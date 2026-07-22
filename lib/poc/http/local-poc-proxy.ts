import { PocError } from "../domain/poc-errors";
import type { PocCapabilities } from "../domain/poc-types";
import { errorResponse, jsonResponse, parsePocRequest } from "./poc-http";

const CAPABILITY_TIMEOUT_MS = 8_000;
const BRIDGE_START_RETRY_DELAYS_MS = [300, 700] as const;
const BRIDGE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/u;

interface CapabilityResult {
  response: Response;
  payload: unknown;
}

export function isLocalPocProxyEnabled(): boolean {
  if (process.env.AI_OFFICE_LOCAL_PROXY_ENABLED !== "1") return false;
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.AI_OFFICE_DEPLOYMENT_MODE === "internal" &&
    process.env.AI_OFFICE_INTERNAL_EXECUTION_ACK === "on-prem-only";
}

export async function proxyLocalPocCapabilities(): Promise<Response> {
  const correlationId = crypto.randomUUID();
  try {
    const bridgeToken = requireConfiguredBridgeToken();
    const result = await readBridgeCapabilities(bridgeToken);
    if (result.response.ok && !isBridgeCapabilities(result.payload)) {
      throw invalidBridgeResponse();
    }
    return jsonResponse(result.payload, result.response.status, correlationId, safeResponseHeaders(result.response));
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}

export async function proxyLocalPocRun(request: Request): Promise<Response> {
  let correlationId = crypto.randomUUID();
  try {
    const bridgeToken = requireConfiguredBridgeToken();
    const context = await parsePocRequest(request);
    correlationId = context.correlationId;
    const capabilityResult = await readBridgeCapabilities(bridgeToken);
    if (!capabilityResult.response.ok) {
      return jsonResponse(
        capabilityResult.payload,
        capabilityResult.response.status,
        correlationId,
        safeResponseHeaders(capabilityResult.response),
      );
    }
    if (!isBridgeCapabilities(capabilityResult.payload)) throw invalidBridgeResponse();
    if (
      !capabilityResult.payload.agentRuntime.enabled ||
      !capabilityResult.payload.agentRuntime.available
    ) {
      throw localRunnerUnavailable();
    }

    const response = await fetch(`${bridgeBaseUrl()}/runs`, {
      method: "POST",
      cache: "no-store",
      credentials: "omit",
      headers: {
        "content-type": "application/json",
        "idempotency-key": context.idempotencyKey,
        "x-ai-office-bridge-token": bridgeToken,
        "x-correlation-id": context.correlationId,
      },
      body: JSON.stringify(context.input),
      signal: request.signal,
    });
    const payload = await readJson(response);
    return jsonResponse(payload, response.status, correlationId, safeResponseHeaders(response));
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}

function requireConfiguredBridgeToken(): string {
  const token = process.env.AI_OFFICE_BRIDGE_TOKEN;
  if (token && BRIDGE_TOKEN_PATTERN.test(token)) return token;
  throw new PocError(
    "BRIDGE_TOKEN_MISSING",
    "서버의 실행 브리지 인증이 구성되지 않았습니다.",
    503,
    false,
  );
}

async function readBridgeCapabilities(bridgeToken: string): Promise<CapabilityResult> {
  for (let attempt = 0; attempt <= BRIDGE_START_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetchBridgeCapabilities(bridgeToken);
      return { response, payload: await readJson(response) };
    } catch (error) {
      if (
        error instanceof PocError ||
        isAbortError(error) ||
        attempt === BRIDGE_START_RETRY_DELAYS_MS.length
      ) {
        if (error instanceof PocError) throw error;
        throw localRunnerUnavailable();
      }
      await delay(BRIDGE_START_RETRY_DELAYS_MS[attempt]);
    }
  }
  throw localRunnerUnavailable();
}

async function fetchBridgeCapabilities(bridgeToken: string): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CAPABILITY_TIMEOUT_MS);
  try {
    return await fetch(`${bridgeBaseUrl()}/capabilities`, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      headers: { "x-ai-office-bridge-token": bridgeToken },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function bridgeBaseUrl(): string {
  const configured = Number(process.env.AI_OFFICE_BRIDGE_PORT ?? 4317);
  const port = Number.isInteger(configured) && configured >= 1_024 && configured <= 65_535
    ? configured
    : 4317;
  return `http://127.0.0.1:${port}/api/v1/poc`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isBridgeCapabilities(value: unknown): value is PocCapabilities {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<PocCapabilities>;
  return candidate.apiVersion === "v1" &&
    candidate.environment === "local" &&
    !("bridgeToken" in candidate) &&
    Boolean(candidate.agentRuntime) &&
    typeof candidate.agentRuntime?.enabled === "boolean" &&
    typeof candidate.agentRuntime?.available === "boolean";
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    throw invalidBridgeResponse();
  }
}

function safeResponseHeaders(response: Response): HeadersInit {
  const headers: Record<string, string> = {};
  for (const name of ["retry-after", "x-idempotent-replay"] as const) {
    const value = response.headers.get(name);
    if (value) headers[name] = value;
  }
  return headers;
}

function invalidBridgeResponse(): PocError {
  return new PocError(
    "INVALID_BRIDGE_RESPONSE",
    "로컬 POC 응답을 확인하지 못했습니다.",
    502,
    true,
  );
}

function localRunnerUnavailable(): PocError {
  return new PocError(
    "LOCAL_RUNNER_UNAVAILABLE",
    "로컬 Synthetic POC runner에 연결하지 못했습니다.",
    503,
    true,
  );
}
