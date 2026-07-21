import assert from "node:assert/strict";
import test from "node:test";

import type { PocCapabilitiesDto } from "./poc-contract";
import { PocClientError, resolvePocEndpoint } from "./poc-client";

const HOSTED_CAPABILITIES = {
  apiVersion: "v1",
  environment: "hosted",
  agentRuntime: {
    enabled: false,
    available: false,
    label: "Hosted deterministic demo",
    singleFlight: true,
    timeoutMs: 15_000,
    progressMode: "indeterminate-then-stages",
  },
  fallback: { available: true, deterministic: true },
  dataPolicy: {
    syntheticRepositoryOnly: true,
    acceptsCompanyData: false,
    externalModelReceivesSyntheticSnapshot: false,
  },
} satisfies PocCapabilitiesDto;

test("hosted capability resolves to the same-origin demo endpoint", () => {
  assert.deepEqual(resolvePocEndpoint(HOSTED_CAPABILITIES), {
    kind: "hosted",
    baseUrl: "/api/v1/poc",
    connectionMode: "demo",
    requestTimeoutMs: 15_000,
  });
});

test("local Zen capability resolves to the same-origin local endpoint", () => {
  const capabilities = localCapabilities({ enabled: true, available: true });

  assert.deepEqual(resolvePocEndpoint(capabilities), {
    kind: "local",
    baseUrl: "/api/v1/poc",
    connectionMode: "opencode",
    requestTimeoutMs: 128_000,
  });
});

test("local capability fails closed when its runtime is unavailable", () => {
  const capabilities = localCapabilities({ enabled: true, available: false });

  assert.throws(
    () => resolvePocEndpoint(capabilities),
    (error) => error instanceof PocClientError && error.code === "LOCAL_RUNTIME_UNAVAILABLE",
  );
});

function localCapabilities(
  availability: Pick<PocCapabilitiesDto["agentRuntime"], "available" | "enabled">,
): PocCapabilitiesDto {
  return {
    ...HOSTED_CAPABILITIES,
    environment: "local",
    agentRuntime: {
      ...HOSTED_CAPABILITIES.agentRuntime,
      ...availability,
      label: "OpenCode Zen",
      timeoutMs: 120_000,
    },
    dataPolicy: {
      ...HOSTED_CAPABILITIES.dataPolicy,
      externalModelReceivesSyntheticSnapshot: true,
    },
  };
}
