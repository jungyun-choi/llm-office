import { PocError } from "../domain/poc-errors";
import type { PocCapabilities } from "../domain/poc-types";
import { errorResponse, jsonResponse, parsePocRequest } from "./poc-http";

const BRIDGE_BASE_URL = "http://127.0.0.1:4317/api/v1/poc";
const CAPABILITY_TIMEOUT_MS = 1_500;
const BRIDGE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/u;

interface BridgeCapabilities extends PocCapabilities {
  bridgeToken: string;
}

export function isLocalPocProxyEnabled(): boolean {
  return process.env.NODE_ENV !== "production" &&
    process.env.AI_OFFICE_LOCAL_PROXY_ENABLED === "1";
}

export async function proxyLocalPocCapabilities(): Promise<Response> {
  const correlationId = crypto.randomUUID();
  try {
    const capabilities = await readBridgeCapabilities();
    const browserSafeCapabilities: Partial<BridgeCapabilities> = { ...capabilities };
    delete browserSafeCapabilities.bridgeToken;
    return jsonResponse(browserSafeCapabilities, 200, correlationId);
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}

export async function proxyLocalPocRun(request: Request): Promise<Response> {
  let correlationId = crypto.randomUUID();
  try {
    const context = await parsePocRequest(request);
    correlationId = context.correlationId;
    const capabilities = await readBridgeCapabilities();
    if (!capabilities.agentRuntime.enabled || !capabilities.agentRuntime.available) {
      throw localRunnerUnavailable();
    }

    const response = await fetch(`${BRIDGE_BASE_URL}/runs`, {
      method: "POST",
      cache: "no-store",
      credentials: "omit",
      headers: {
        "content-type": "application/json",
        "idempotency-key": context.idempotencyKey,
        "x-ai-office-bridge-token": capabilities.bridgeToken,
        "x-correlation-id": context.correlationId,
      },
      body: JSON.stringify(context.input),
      signal: request.signal,
    });
    const payload = await readJson(response);
    return jsonResponse(payload, response.status, correlationId);
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}

async function readBridgeCapabilities(): Promise<BridgeCapabilities> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CAPABILITY_TIMEOUT_MS);
  try {
    const response = await fetch(`${BRIDGE_BASE_URL}/capabilities`, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
    });
    if (!response.ok) throw localRunnerUnavailable();
    const payload = await readJson(response);
    if (!isBridgeCapabilities(payload)) throw localRunnerUnavailable();
    return payload;
  } catch (error) {
    if (error instanceof PocError) throw error;
    throw localRunnerUnavailable();
  } finally {
    clearTimeout(timeoutId);
  }
}

function isBridgeCapabilities(value: unknown): value is BridgeCapabilities {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BridgeCapabilities>;
  return candidate.apiVersion === "v1" &&
    candidate.environment === "local" &&
    typeof candidate.bridgeToken === "string" &&
    BRIDGE_TOKEN_PATTERN.test(candidate.bridgeToken) &&
    Boolean(candidate.agentRuntime) &&
    typeof candidate.agentRuntime?.enabled === "boolean" &&
    typeof candidate.agentRuntime?.available === "boolean";
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    throw new PocError("INVALID_BRIDGE_RESPONSE", "로컬 POC 응답을 확인하지 못했습니다.", 502, true);
  }
}

function localRunnerUnavailable(): PocError {
  return new PocError(
    "LOCAL_RUNNER_UNAVAILABLE",
    "로컬 Synthetic POC runner에 연결하지 못했습니다.",
    503,
    true,
  );
}
