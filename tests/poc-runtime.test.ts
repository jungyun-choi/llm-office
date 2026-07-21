import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runHostedPoc } from "../lib/poc/application/hosted-poc-run.service";
import { PocError, PocRunnerError } from "../lib/poc/domain/poc-errors";
import { runDemoPoc } from "../lib/poc/infrastructure/demo-poc-runner";
import { isLocalRunnerEnabled } from "../lib/poc/infrastructure/runtime-registry";
import { parseOpenCodeOutput } from "../lib/poc/infrastructure/opencode-output-parser";
import { pocSingleFlight } from "../lib/poc/infrastructure/single-flight";
import { parsePocRequest } from "../lib/poc/http/poc-http";

test("OpenCode parser accepts braces in JSON strings and rejects error events", () => {
  const output = runDemoPoc("write buffer 기능을 추가해 주세요").output;
  output.brief.issueDraft.body += '\nbrace { inside } and quote "inside"';
  const event = JSON.stringify({
    type: "text",
    part: { text: JSON.stringify(output) },
  });
  assert.equal(parseOpenCodeOutput(event).roleOutputs.length, 5);
  assert.throws(
    () => parseOpenCodeOutput(JSON.stringify({ type: "error", error: "hidden" })),
    (error) => error instanceof PocRunnerError && error.reason === "model_error",
  );
});

test("request parser streams UTF-8 JSON and rejects bodies above 8 KiB", async () => {
  const request = jsonRequest(JSON.stringify({ prompt: "합성 workload 기능을 추가해 주세요" }));
  const parsed = await parsePocRequest(request);
  assert.equal(parsed.input.executionMode, "auto");

  const oversized = jsonRequest(`{"prompt":"${"x".repeat(9_000)}"}`);
  await assert.rejects(
    parsePocRequest(oversized),
    (error) => error instanceof PocError && error.code === "PAYLOAD_TOO_LARGE",
  );
});

test("single-flight reuses identical idempotency and rejects conflicts", async () => {
  const key = `test-${crypto.randomUUID()}`;
  let release: ((value: string) => void) | undefined;
  let calls = 0;
  const operation = () => {
    calls += 1;
    return new Promise<string>((resolve) => {
      release = resolve;
    });
  };
  const first = pocSingleFlight.run(key, "fingerprint-a", operation);
  const duplicate = pocSingleFlight.run(key, "fingerprint-a", operation);
  await assert.rejects(
    pocSingleFlight.run(key, "fingerprint-b", operation),
    (error) => error instanceof PocError && error.status === 409,
  );
  await assert.rejects(
    pocSingleFlight.run(`other-${crypto.randomUUID()}`, "fingerprint-c", operation),
    (error) => error instanceof PocError && error.status === 429,
  );
  release?.("complete");
  assert.equal(await first, "complete");
  assert.equal(await duplicate, "complete");
  assert.equal(calls, 1);
});

test("local runtime is opt-in and production is always denied", () => {
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    enabled: process.env.AI_OFFICE_LOCAL_RUNNER_ENABLED,
    runtime: process.env.AI_OFFICE_AGENT_RUNTIME,
  };
  try {
    delete process.env.AI_OFFICE_LOCAL_RUNNER_ENABLED;
    delete process.env.AI_OFFICE_AGENT_RUNTIME;
    Reflect.set(process.env, "NODE_ENV", "development");
    assert.equal(isLocalRunnerEnabled(), false);
    process.env.AI_OFFICE_LOCAL_RUNNER_ENABLED = "1";
    process.env.AI_OFFICE_AGENT_RUNTIME = "codex";
    assert.equal(isLocalRunnerEnabled(), true);
    Reflect.set(process.env, "NODE_ENV", "production");
    assert.equal(isLocalRunnerEnabled(), false);
  } finally {
    restoreEnvironment("NODE_ENV", previous.nodeEnv);
    restoreEnvironment("AI_OFFICE_LOCAL_RUNNER_ENABLED", previous.enabled);
    restoreEnvironment("AI_OFFICE_AGENT_RUNTIME", previous.runtime);
  }
});

test("hosted workflow always returns deterministic provider-neutral output", async () => {
  const result = await runHostedPoc({
    prompt: "합성 workload 기능을 추가해 주세요",
    executionMode: "auto",
  });
  assert.equal(result.execution.dataRoute, "deterministic");
  assert.equal(result.execution.cliProcesses, 0);
  assert.deepEqual(
    result.roleOutputs.map(({ role }) => role),
    ["research", "framework", "estimate", "test", "git"],
  );
});

test("Codex adapter pins version, stdin, tool denial, and synthetic boundary", async () => {
  const source = await readFile(
    new URL("../lib/poc/infrastructure/codex-cli-runtime.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /codex-cli 0\.144\.6/);
  assert.match(source, /stdinText: buildPrompt/);
  assert.match(source, /args\.push\("-"\)/);
  assert.match(source, /"--strict-config"/);
  assert.match(source, /"shell_tool"/);
  assert.match(source, /"unified_exec"/);
  assert.match(source, /actualRoot !== expectedRoot \|\| actualSchema !== expectedSchema/);
  assert.doesNotMatch(source, /args\.push\(buildPrompt/);
});

test("bridge source enforces loopback, exact origins, session token, and Host", async () => {
  const source = await readFile(
    new URL("../scripts/poc-bridge.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /const HOST = "127\.0\.0\.1"/);
  assert.match(source, /http:\/\/localhost:3000/);
  assert.match(source, /http:\/\/127\.0\.0\.1:3000/);
  assert.match(source, /isLoopbackRequest\(request\)/);
  assert.match(source, /isAllowedHost\(request\.headers\.host\)/);
  assert.match(source, /randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(source, /timingSafeEqual\(expectedBytes, candidateBytes\)/);
  assert.match(source, /x-ai-office-bridge-token/);
  assert.match(source, /MAX_BODY_BYTES = 8 \* 1_024/);
  assert.match(source, /request\.pause\(\)/);
  assert.match(source, /status: oversized \? 413 : 400/);
  assert.doesNotMatch(source, /request\.destroy\(\)/);
});

test("secure CLI source aborts early and terminates the process group", async () => {
  const source = await readFile(
    new URL("../lib/poc/infrastructure/secure-cli-process.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /options\.signal\?\.aborted/);
  assert.match(source, /detached: process\.platform !== "win32"/);
  assert.match(source, /process\.kill\(-child\.pid, signal\)/);
  assert.match(source, /removeEventListener\("abort", onAbort\)/);
  assert.match(source, /clearTimeout\(killTimer\)/);
});

function jsonRequest(body: string): Request {
  const bytes = new TextEncoder().encode(body);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const midpoint = Math.floor(bytes.byteLength / 2);
      controller.enqueue(bytes.slice(0, midpoint));
      controller.enqueue(bytes.slice(midpoint));
      controller.close();
    },
  });
  return new Request("http://localhost/api/v1/poc/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
