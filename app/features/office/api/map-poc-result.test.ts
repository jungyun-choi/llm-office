import assert from "node:assert/strict";
import test from "node:test";

import type { PocRunResultDto } from "./poc-contract";
import { mapExecutionInfo } from "./map-poc-result";

test("execution mapping preserves runtime counts for the result UI", () => {
  const execution: PocRunResultDto["execution"] = {
    kind: "agent",
    dataRoute: "external-opencode-zen",
    label: "OpenCode Zen 합성 POC 런타임",
    model: "opencode/deepseek-v4-flash-free",
    localOnly: false,
    cliProcesses: 1,
    modelTurns: 1,
    durationMs: 12_000,
  };

  assert.deepEqual(mapExecutionInfo(execution, 5), {
    label: execution.label,
    dataRoute: execution.dataRoute,
    dataRouteLabel: "OpenCode Zen · 합성 스냅샷만 전송",
    cliProcesses: 1,
    modelTurns: 1,
    roleOutputCount: 5,
    fallbackReason: undefined,
  });
});
