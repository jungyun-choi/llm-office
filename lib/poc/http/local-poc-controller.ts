import { pocRunService } from "../application/poc-run.service";
import type { PocCapabilities } from "../domain/poc-types";
import {
  getAgentTimeoutMs,
  getConfiguredAgentRuntime,
  configuredRuntimeUsesExternalModel,
  isLocalRunnerEnabled,
} from "../infrastructure/runtime-registry";
import {
  hasConfiguredExtensionSource,
  isCompanyDataAccessAcknowledged,
} from "../infrastructure/extension-source-loader";
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

export interface LocalCapabilitiesOptions {
  allowCompanyExtensions?: boolean;
}

export async function localCapabilities(
  bridgeToken?: string,
  options: LocalCapabilitiesOptions = {},
): Promise<PocCapabilities> {
  const companyRequested = isCompanyOpenCodeRequested();
  const companyAllowed = options.allowCompanyExtensions === true &&
    isCompanyDataAccessAcknowledged();
  let enabled = isLocalRunnerEnabled() && (!companyRequested || companyAllowed);
  let available = false;
  let label = companyRequested
    ? "사내 company 분석은 Job API 전용"
    : "안전한 데모 엔진";
  let timeoutMs = 120_000;
  let externalModelReceivesSyntheticSnapshot = false;
  const sourceAvailable = companyRequested && companyAllowed
    ? await hasConfiguredExtensionSource()
    : !companyRequested;
  if (enabled) {
    try {
      const runtime = getConfiguredAgentRuntime();
      available = await runtime.isAvailable() && sourceAvailable;
      label = runtime.label;
      timeoutMs = getAgentTimeoutMs();
      externalModelReceivesSyntheticSnapshot = configuredRuntimeUsesExternalModel();
    } catch {
      enabled = false;
      available = false;
    }
  }
  return {
    apiVersion: "v1",
    environment: "local",
    agentRuntime: {
      enabled,
      available,
      label,
      singleFlight: true,
      timeoutMs,
      progressMode: "indeterminate-then-stages",
    },
    fallback: { available: true, deterministic: true },
    dataPolicy: {
      syntheticRepositoryOnly: !companyRequested,
      acceptsCompanyData: companyRequested && companyAllowed && available,
      externalModelReceivesSyntheticSnapshot,
    },
    ...(bridgeToken ? { bridgeToken } : {}),
  };
}

function isCompanyOpenCodeRequested(): boolean {
  return process.env.AI_OFFICE_AGENT_RUNTIME === "opencode" &&
    process.env.AI_OFFICE_OPENCODE_PROFILE === "company";
}
