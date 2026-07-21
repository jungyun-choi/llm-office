import { pocRunService } from "../application/poc-run.service";
import type { PocCapabilities } from "../domain/poc-types";
import {
  getAgentTimeoutMs,
  getConfiguredAgentRuntime,
  isLocalRunnerEnabled,
} from "../infrastructure/runtime-registry";
import { enforcePocRateLimit } from "./rate-limiter";
import { errorResponse, jsonResponse, parsePocRequest } from "./poc-http";

export async function handleLocalPocRun(request: Request): Promise<Response> {
  let correlationId = crypto.randomUUID();
  try {
    enforcePocRateLimit(request);
    const context = await parsePocRequest(request);
    correlationId = context.correlationId;
    const result = await pocRunService.execute(context.input, {
      idempotencyKey: context.idempotencyKey,
      signal: request.signal,
    });
    return jsonResponse(result, 200, correlationId);
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}

export async function localCapabilities(bridgeToken?: string): Promise<PocCapabilities> {
  const enabled = isLocalRunnerEnabled();
  const runtime = enabled ? getConfiguredAgentRuntime() : undefined;
  return {
    apiVersion: "v1",
    environment: "local",
    agentRuntime: {
      enabled,
      available: runtime ? await runtime.isAvailable() : false,
      label: runtime?.label ?? "안전한 데모 엔진",
      singleFlight: true,
      timeoutMs: getAgentTimeoutMs(),
      progressMode: "indeterminate-then-stages",
    },
    fallback: { available: true, deterministic: true },
    dataPolicy: {
      syntheticRepositoryOnly: true,
      acceptsCompanyData: false,
      externalModelReceivesSyntheticSnapshot:
        process.env.AI_OFFICE_AGENT_RUNTIME === "codex",
    },
    ...(bridgeToken ? { bridgeToken } : {}),
  };
}
