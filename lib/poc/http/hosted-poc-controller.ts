import { runHostedPoc } from "../application/hosted-poc-run.service";
import type { PocCapabilities } from "../domain/poc-types";
import { enforcePocRateLimit } from "./rate-limiter";
import { errorResponse, jsonResponse, parsePocRequest } from "./poc-http";

export async function handleHostedPocRun(request: Request): Promise<Response> {
  let correlationId = crypto.randomUUID();
  try {
    enforcePocRateLimit(request);
    const context = await parsePocRequest(request);
    correlationId = context.correlationId;
    return jsonResponse(await runHostedPoc(context.input), 200, correlationId);
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}

export function hostedCapabilities(): PocCapabilities {
  return {
    apiVersion: "v1",
    environment: "hosted",
    agentRuntime: {
      enabled: false,
      available: false,
      label: "로컬 브리지 필요",
      singleFlight: true,
      timeoutMs: 120_000,
      progressMode: "indeterminate-then-stages",
    },
    fallback: { available: true, deterministic: true },
    dataPolicy: {
      syntheticRepositoryOnly: true,
      acceptsCompanyData: false,
      externalModelReceivesSyntheticSnapshot: false,
    },
  };
}
