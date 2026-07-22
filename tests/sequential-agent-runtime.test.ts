import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { runSequentialAgentRuntime } from "../lib/poc/application/sequential-agent-runtime";
import type { AgentRuntimeProgress } from "../lib/poc/application/ports/agent-runtime";
import { PocRunnerError } from "../lib/poc/domain/poc-errors";
import { runDemoPoc } from "../lib/poc/infrastructure/demo-poc-runner";

const demoOutput = runDemoPoc("합성 read buffer 기능을 추가해 주세요").output;
const source = {
  sourceId: "test-source",
  displayName: "Synthetic Test",
  workingDirectory: "/synthetic/test",
  outputSchemaPath: "/synthetic/test/schema.json",
  policyNotice: "test only",
  snapshot: "README.md\nSynthetic simulator snapshot",
  snapshotDigest: "a".repeat(64),
};

describe("vendor-neutral 5+1 sequential analysis", () => {
  test("runs five specialists then orchestrator with validated prior context and progress", async () => {
    const calls: Array<{ role: string; prompt: string }> = [];
    const progress: AgentRuntimeProgress[] = [];
    const result = await runSequentialAgentRuntime({
      featureRequest: "회사 기능 요청",
      source,
      onProgress: (event) => progress.push(event),
    }, {
      runtimeId: "company-test",
      runtimeLabel: "사내 OpenCode company",
      model: "company/CodeLLMPro",
      promptFor: async (role) => `approved prompt for ${role}`,
      executor: {
        execute: async ({ role, prompt }) => {
          calls.push({ role, prompt });
          const output = role === "orchestrator"
            ? demoOutput.brief
            : demoOutput.roleOutputs.find((candidate) => candidate.role === role);
          return { output, durationMs: 10 };
        },
      },
    });

    assert.deepEqual(calls.map(({ role }) => role), [
      "research", "framework", "estimate", "test", "git", "orchestrator",
    ]);
    assert.match(calls[1]?.prompt ?? "", /합성 Wiki와 디버깅 기록/u);
    assert.match(calls[5]?.prompt ?? "", /"roleOutputs"/u);
    assert.equal(result.metrics.cliProcesses, 6);
    assert.equal(result.metrics.modelTurns, 6);
    assert.deepEqual(result.output.roleOutputs.map(({ role }) => role), [
      "research", "framework", "estimate", "test", "git",
    ]);
    assert.equal(progress[0]?.phase, "preparing_context");
    assert.deepEqual(
      progress.filter(({ status }) => status === "completed").map(({ role }) => role),
      ["research", "framework", "estimate", "test", "git", "orchestrator"],
    );
  });

  test("stops after the first failed role and reports that role only", async () => {
    const calls: string[] = [];
    const progress: AgentRuntimeProgress[] = [];

    await assert.rejects(
      runSequentialAgentRuntime({
        featureRequest: "실패 흐름 확인",
        source,
        onProgress: (event) => progress.push(event),
      }, {
        runtimeId: "company-test",
        runtimeLabel: "사내 OpenCode company",
        model: "company/CodeLLMPro",
        promptFor: async (role) => `approved prompt for ${role}`,
        executor: {
          execute: async ({ role }) => {
            calls.push(role);
            if (role === "estimate") throw new PocRunnerError("timeout");
            return {
              output: demoOutput.roleOutputs.find((candidate) => candidate.role === role),
              durationMs: 10,
            };
          },
        },
      }),
      (error) => error instanceof PocRunnerError && error.reason === "timeout",
    );

    assert.deepEqual(calls, ["research", "framework", "estimate"]);
    assert.deepEqual(
      progress.filter(({ status }) => status === "failed").map(({ role }) => role),
      ["estimate"],
    );
    assert.equal(progress.some(({ role }) => role === "test"), false);
  });
});
