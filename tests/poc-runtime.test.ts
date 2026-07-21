import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runHostedPoc } from "../lib/poc/application/hosted-poc-run.service";
import { PocRunService } from "../lib/poc/application/poc-run.service";
import type { OpenCodeRuntimeConfig } from "../lib/poc/infrastructure/opencode-runtime-config";
import { PocError, PocRunnerError } from "../lib/poc/domain/poc-errors";
import { runDemoPoc } from "../lib/poc/infrastructure/demo-poc-runner";
import { OpenCodeCliRuntime } from "../lib/poc/infrastructure/opencode-poc-runner";
import {
  executeOpenCodeProcess,
  hasSafeZenGlobalConfig,
  hasUsableModelCatalog,
} from "../lib/poc/infrastructure/opencode-process";
import { getOpenCodeRuntimeConfig } from "../lib/poc/infrastructure/opencode-runtime-config";
import { isLocalRunnerEnabled } from "../lib/poc/infrastructure/runtime-registry";
import { parseOpenCodeOutput } from "../lib/poc/infrastructure/opencode-output-parser";
import { pocSingleFlight } from "../lib/poc/infrastructure/single-flight";
import { stageSyntheticRuntimeWorkspace } from "../lib/poc/infrastructure/synthetic-runtime-workspace";
import { assertSyntheticSourceBoundary } from "../lib/poc/infrastructure/synthetic-source-boundary";
import { SyntheticSimulatorSource } from "../lib/poc/infrastructure/synthetic-simulator-source";
import { parsePocRequest } from "../lib/poc/http/poc-http";
import {
  isLocalPocProxyEnabled,
  proxyLocalPocCapabilities,
  proxyLocalPocRun,
} from "../lib/poc/http/local-poc-proxy";

const SYNTHETIC_REPOSITORY_ROOT = fileURLToPath(
  new URL("../poc/simulator", import.meta.url),
);
const ZEN_MODEL = "opencode/deepseek-v4-flash-free";
const ZEN_MODEL_ID = "deepseek-v4-flash-free";

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

test("local automatic execution fails closed while explicit demo remains deterministic", async () => {
  const previous = captureEnvironment([
    "NODE_ENV",
    "AI_OFFICE_LOCAL_RUNNER_ENABLED",
    "AI_OFFICE_AGENT_RUNTIME",
  ]);
  try {
    Reflect.set(process.env, "NODE_ENV", "development");
    delete process.env.AI_OFFICE_LOCAL_RUNNER_ENABLED;
    delete process.env.AI_OFFICE_AGENT_RUNTIME;
    const service = new PocRunService();
    await assert.rejects(
      service.execute(
        { prompt: "합성 workload 기능을 추가해 주세요", executionMode: "auto" },
        { idempotencyKey: crypto.randomUUID() },
      ),
      (error) => error instanceof PocError && error.code === "LOCAL_RUNTIME_DISABLED",
    );
    const demo = await service.execute(
      { prompt: "합성 workload 기능을 추가해 주세요", executionMode: "demo" },
      { idempotencyKey: crypto.randomUUID() },
    );
    assert.equal(demo.execution.dataRoute, "deterministic");
  } finally {
    restoreCapturedEnvironment(previous);
  }
});

test("same-origin proxy keeps the bridge token server-side", async () => {
  const previousEnvironment = captureEnvironment([
    "NODE_ENV",
    "AI_OFFICE_LOCAL_PROXY_ENABLED",
  ]);
  const originalFetch = globalThis.fetch;
  const bridgeToken = "a".repeat(43);
  let forwardedToken: string | null = null;
  const capabilities = {
    apiVersion: "v1",
    environment: "local",
    bridgeToken,
    agentRuntime: {
      enabled: true,
      available: true,
      label: "OpenCode Zen",
      singleFlight: true,
      timeoutMs: 120_000,
      progressMode: "indeterminate-then-stages",
    },
    fallback: { available: true, deterministic: true },
    dataPolicy: {
      syntheticRepositoryOnly: true,
      acceptsCompanyData: false,
      externalModelReceivesSyntheticSnapshot: true,
    },
  };
  try {
    Reflect.set(process.env, "NODE_ENV", "development");
    process.env.AI_OFFICE_LOCAL_PROXY_ENABLED = "1";
    assert.equal(isLocalPocProxyEnabled(), true);
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/capabilities")) return Response.json(capabilities);
      forwardedToken = new Headers(init?.headers).get("x-ai-office-bridge-token");
      return Response.json({ accepted: true });
    };

    const capabilityResponse = await proxyLocalPocCapabilities();
    const browserPayload = await capabilityResponse.json() as Record<string, unknown>;
    assert.equal("bridgeToken" in browserPayload, false);

    const runResponse = await proxyLocalPocRun(jsonRequest(JSON.stringify({
      prompt: "합성 queue depth 파라미터를 정리해 줘",
      executionMode: "auto",
    })));
    assert.equal(runResponse.status, 200);
    assert.equal(forwardedToken, bridgeToken);

    Reflect.set(process.env, "NODE_ENV", "production");
    assert.equal(isLocalPocProxyEnabled(), false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreCapturedEnvironment(previousEnvironment);
  }
});

test("Zen profile allows only free OpenCode models and uses the shared timeout", async () => {
  const names = [
    "AI_OFFICE_OPENCODE_PROFILE",
    "AI_OFFICE_OPENCODE_MODEL",
    "AI_OFFICE_AGENT_TIMEOUT_MS",
    "AI_OFFICE_OPENCODE_TIMEOUT_MS",
    "AI_OFFICE_LOCAL_RUNNER_ENABLED",
    "AI_OFFICE_AGENT_RUNTIME",
    "AI_OFFICE_ZEN_SHARED_STATE_ACK",
  ] as const;
  const previous = captureEnvironment(names);
  try {
    process.env.AI_OFFICE_OPENCODE_PROFILE = "zen";
    process.env.AI_OFFICE_AGENT_TIMEOUT_MS = "45000";
    process.env.AI_OFFICE_OPENCODE_TIMEOUT_MS = "160000";
    process.env.AI_OFFICE_LOCAL_RUNNER_ENABLED = "1";
    process.env.AI_OFFICE_AGENT_RUNTIME = "opencode";
    delete process.env.AI_OFFICE_ZEN_SHARED_STATE_ACK;
    delete process.env.AI_OFFICE_OPENCODE_MODEL;
    assert.equal(getOpenCodeRuntimeConfig().enabled, false);
    process.env.AI_OFFICE_ZEN_SHARED_STATE_ACK = "synthetic-only";
    const config = getOpenCodeRuntimeConfig();
    assert.equal(config.enabled, true);
    assert.equal(config.model, ZEN_MODEL);
    assert.equal(config.dataRoute, "external-opencode-zen");
    assert.equal(config.timeoutMs, 45_000);
    assert.match(config.configPath, /opencode\.json$/u);
    process.env.AI_OFFICE_OPENCODE_MODEL = "opencode/mimo-v2.5-free";
    assert.equal(getOpenCodeRuntimeConfig().model, "opencode/mimo-v2.5-free");
    process.env.AI_OFFICE_OPENCODE_MODEL = "opencode/gpt-5.6-sol";
    assert.throws(getOpenCodeRuntimeConfig, /only permits an allowlisted free model/u);
    process.env.AI_OFFICE_OPENCODE_MODEL = "anthropic/claude-sonnet-4-5";
    assert.throws(getOpenCodeRuntimeConfig, /only permits an allowlisted free model/u);
  } finally {
    restoreCapturedEnvironment(previous);
  }

  const profile = JSON.parse(
    await readFile(new URL("../poc/simulator/opencode.json", import.meta.url), "utf8"),
  ) as Record<string, unknown>;
  assert.equal("enabled_providers" in profile, false);
  assert.equal(profile.share, "disabled");
  assert.equal(profile.snapshot, false);
  assert.deepEqual(profile.plugin, []);
  assert.deepEqual(profile.instructions, []);
  assert.doesNotMatch(JSON.stringify(profile), /api[_-]?key|credential|token/iu);
});

test("OpenCode configuration bounds timeouts and rejects unsafe profile state paths", () => {
  const names = [
    "AI_OFFICE_OPENCODE_PROFILE",
    "AI_OFFICE_OPENCODE_MODEL",
    "AI_OFFICE_OPENCODE_HOME",
    "AI_OFFICE_AGENT_TIMEOUT_MS",
    "HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
  ] as const;
  const previous = captureEnvironment(names);
  try {
    delete process.env.AI_OFFICE_OPENCODE_PROFILE;
    delete process.env.AI_OFFICE_OPENCODE_MODEL;
    assert.equal(getOpenCodeRuntimeConfig().profile, "internal");
    assert.equal(getOpenCodeRuntimeConfig().model, "ollama/qwen2.5-coder:3b");

    process.env.AI_OFFICE_OPENCODE_MODEL = "opencode/deepseek-v4-flash-free";
    assert.throws(getOpenCodeRuntimeConfig, /only permits the local Ollama provider/u);
    process.env.AI_OFFICE_OPENCODE_PROFILE = "unsupported";
    assert.throws(getOpenCodeRuntimeConfig, /must be internal or zen/u);

    process.env.AI_OFFICE_OPENCODE_PROFILE = "zen";
    delete process.env.AI_OFFICE_OPENCODE_MODEL;
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_DATA_HOME;
    delete process.env.XDG_CACHE_HOME;
    process.env.AI_OFFICE_OPENCODE_HOME = SYNTHETIC_REPOSITORY_ROOT;
    assert.throws(getOpenCodeRuntimeConfig, /must remain outside the repository/u);

    process.env.AI_OFFICE_OPENCODE_HOME = path.join(os.tmpdir(), "ai-office-config-home");
    process.env.XDG_CONFIG_HOME = "relative-config";
    assert.throws(getOpenCodeRuntimeConfig, /state paths must be absolute/u);
    delete process.env.XDG_CONFIG_HOME;

    process.env.AI_OFFICE_AGENT_TIMEOUT_MS = "1";
    assert.equal(getOpenCodeRuntimeConfig().timeoutMs, 30_000);
    process.env.AI_OFFICE_AGENT_TIMEOUT_MS = "999999";
    assert.equal(getOpenCodeRuntimeConfig().timeoutMs, 180_000);
    process.env.AI_OFFICE_AGENT_TIMEOUT_MS = "not-a-number";
    assert.equal(getOpenCodeRuntimeConfig().timeoutMs, 120_000);
  } finally {
    restoreCapturedEnvironment(previous);
  }
});

test("Zen model catalog accepts only a fresh, owner-controlled zero-cost model", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ai-office-catalog-test-"));
  try {
    const config = createZenRuntimeConfig(temporaryRoot);
    const catalogPath = config.modelCatalogPath;
    assert.ok(catalogPath);
    await writeZenCatalog(catalogPath, 0);

    assert.equal(await hasUsableModelCatalog(config), true);

    await chmod(catalogPath, 0o622);
    assert.equal(await hasUsableModelCatalog(config), false);

    await chmod(catalogPath, 0o600);
    assert.equal(await hasUsableModelCatalog(config), true);

    const staleTime = new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000);
    await utimes(catalogPath, staleTime, staleTime);
    assert.equal(await hasUsableModelCatalog(config), false);

    await writeFile(catalogPath, JSON.stringify(createZenCatalog(0)), "utf8");
    assert.equal(await hasUsableModelCatalog(config), true);

    await writeFile(catalogPath, JSON.stringify(createZenCatalog(0.01)), "utf8");
    assert.equal(await hasUsableModelCatalog(config), false);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("Zen rejects unsafe global OpenCode configuration and extension assets", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ai-office-global-config-test-"));
  try {
    const config = createZenRuntimeConfig(temporaryRoot);
    const configRoot = path.join(config.configDirectory!, "opencode");
    const configPath = path.join(configRoot, "opencode.json");
    await mkdir(configRoot, { recursive: true, mode: 0o700 });

    assert.equal(await hasSafeZenGlobalConfig(config), true);
    await writeFile(configPath, JSON.stringify({ theme: "system" }), { mode: 0o600 });
    assert.equal(await hasSafeZenGlobalConfig(config), true);

    for (const unsafeConfig of [
      { instructions: [] },
      { mcp: {} },
      { agent: { orchestrator: { prompt: "override" } } },
      { provider: { opencode: { options: { apiKey: "not-a-real-key" } } } },
    ]) {
      await writeFile(configPath, JSON.stringify(unsafeConfig), "utf8");
      assert.equal(await hasSafeZenGlobalConfig(config), false);
    }

    await rm(configPath);
    await mkdir(path.join(configRoot, "skills"));
    assert.equal(await hasSafeZenGlobalConfig(config), false);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("Synthetic runtime workspace copies only pinned policy files with restrictive modes", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ai-office-workspace-test-"));
  try {
    const runtimeDirectory = path.join(temporaryRoot, "runtime");
    await mkdir(runtimeDirectory, { mode: 0o700 });
    const config = createZenRuntimeConfig(temporaryRoot);
    const workspace = await stageSyntheticRuntimeWorkspace(runtimeDirectory, config);
    const copiedFiles = [
      "AGENTS.md",
      "contracts/poc-output.schema.json",
      "opencode.json",
      "prompts/orchestrator.md",
      "prompts/research.md",
      "prompts/framework.md",
      "prompts/estimate.md",
      "prompts/test.md",
      "prompts/git.md",
    ];

    for (const relativePath of copiedFiles) {
      const stagedPath = path.join(workspace, relativePath);
      const sourcePath = relativePath === "opencode.json"
        ? config.configPath
        : path.join(config.repositoryRoot, relativePath);
      assert.deepEqual(await readFile(stagedPath), await readFile(sourcePath));
      assert.equal((await stat(stagedPath)).mode & 0o777, 0o600);
    }
    await assert.rejects(access(path.join(workspace, "src", "simulator.py")));
    await assert.rejects(access(path.join(workspace, "wiki", "architecture.md")));

    const tamperedConfigPath = path.join(temporaryRoot, "tampered-opencode.json");
    await writeFile(
      tamperedConfigPath,
      `${await readFile(config.configPath, "utf8")}\n`,
      { mode: 0o600 },
    );
    const secondRuntimeDirectory = path.join(temporaryRoot, "tampered-runtime");
    await mkdir(secondRuntimeDirectory, { mode: 0o700 });
    await assert.rejects(
      stageSyntheticRuntimeWorkspace(secondRuntimeDirectory, {
        ...config,
        configPath: tamperedConfigPath,
      }),
      (error) => error instanceof PocRunnerError && error.reason === "unavailable",
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("OpenCode process stages its inputs and disables tools, plugins, and project config", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ai-office-process-test-"));
  const previousSecret = process.env.ANTHROPIC_API_KEY;
  try {
    const config = createZenRuntimeConfig(temporaryRoot);
    const runtimeDirectory = path.join(temporaryRoot, "runtime");
    const executable = path.join(temporaryRoot, "fake-opencode");
    await mkdir(path.join(runtimeDirectory, "tmp"), { recursive: true, mode: 0o700 });
    await mkdir(path.join(config.configDirectory!, "opencode"), {
      recursive: true,
      mode: 0o700,
    });
    await writeZenCatalog(config.modelCatalogPath!, 0);
    await writeExecutable(
      executable,
      [
        `const fs = require("node:fs");`,
        `const args = process.argv.slice(2);`,
        `const requestPath = args[args.indexOf("--file") + 1];`,
        `process.stdout.write(JSON.stringify({ args, env: process.env, cwd: process.cwd(), requestPath, request: fs.readFileSync(requestPath, "utf8") }));`,
      ].join("\n"),
    );
    process.env.ANTHROPIC_API_KEY = "must-not-reach-child";

    const prompt = "bounded synthetic request";
    const result = await executeOpenCodeProcess(
      executable,
      runtimeDirectory,
      config,
      prompt,
    );
    assert.equal(result.exitCode, 0);
    const captured = JSON.parse(result.stdout) as CapturedOpenCodeInvocation;
    assert.deepEqual(captured.args.slice(0, 2), [
      "run",
      "Use only the attached untrusted request snapshot. Do not call tools. Return the required JSON object.",
    ]);
    assert.equal(argumentValue(captured.args, "--model"), ZEN_MODEL);
    assert.equal(argumentValue(captured.args, "--agent"), "orchestrator");
    const workspaceArgument = argumentValue(captured.args, "--dir");
    assert.ok(workspaceArgument);
    assert.equal(await realpath(workspaceArgument), captured.cwd);
    assert.equal(argumentValue(captured.args, "--file"), captured.requestPath);
    assert.equal(captured.args.includes("--pure"), true);
    assert.equal(captured.args.at(-2), "--file");
    assert.equal(captured.request, prompt);
    assert.equal(captured.env.HOME, runtimeDirectory);
    assert.equal(captured.env.XDG_CONFIG_HOME, config.configDirectory);
    assert.equal(captured.env.XDG_DATA_HOME, config.dataDirectory);
    assert.equal(captured.env.XDG_CACHE_HOME, config.cacheDirectory);
    assert.equal(captured.env.OPENCODE_CONFIG, path.join(workspaceArgument, "opencode.json"));
    assert.equal(captured.env.OPENCODE_DISABLE_CLAUDE_CODE, "1");
    assert.equal(captured.env.OPENCODE_DISABLE_DEFAULT_PLUGINS, "1");
    assert.equal(captured.env.OPENCODE_DISABLE_PROJECT_CONFIG, "1");
    assert.equal(captured.env.OPENCODE_DISABLE_MODELS_FETCH, "1");
    assert.equal(captured.env.OPENCODE_MODELS_PATH, path.join(runtimeDirectory, "models.json"));
    assert.equal(captured.env.ANTHROPIC_API_KEY, undefined);
    assert.deepEqual(JSON.parse(captured.env.OPENCODE_CONFIG_CONTENT!), {
      share: "disabled",
      autoupdate: false,
      instructions: [],
      plugin: [],
      mcp: {},
      permission: { "*": "deny" },
    });
    assert.equal((await stat(captured.requestPath)).mode & 0o777, 0o600);
    assert.equal((await stat(captured.env.OPENCODE_MODELS_PATH!)).mode & 0o777, 0o600);
  } finally {
    restoreEnvironment("ANTHROPIC_API_KEY", previousSecret);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("OpenCode runtime uses one fake CLI turn and replaces raw Zen input with a synthetic scenario", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ai-office-runner-test-"));
  const environmentNames = [
    "AI_OFFICE_OPENCODE_BIN",
    "AI_OFFICE_OPENCODE_PROFILE",
    "AI_OFFICE_OPENCODE_MODEL",
    "AI_OFFICE_LOCAL_RUNNER_ENABLED",
    "AI_OFFICE_AGENT_RUNTIME",
    "AI_OFFICE_ZEN_SHARED_STATE_ACK",
    "HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
  ] as const;
  const previous = captureEnvironment(environmentNames);
  try {
    const executable = path.join(temporaryRoot, "bin", "opencode");
    const capturePath = path.join(temporaryRoot, "invocation.json");
    const behaviorPath = path.join(temporaryRoot, "behavior.txt");
    const homeDirectory = path.join(temporaryRoot, "home");
    const configDirectory = path.join(temporaryRoot, "xdg-config");
    const dataDirectory = path.join(temporaryRoot, "xdg-data");
    const cacheDirectory = path.join(temporaryRoot, "xdg-cache");
    await writeZenCatalog(path.join(cacheDirectory, "opencode", "models.json"), 0);
    await mkdir(path.join(configDirectory, "opencode"), { recursive: true, mode: 0o700 });
    const event = JSON.stringify({
      type: "text",
      part: { text: JSON.stringify(runDemoPoc("queue depth").output) },
    });
    await writeFile(behaviorPath, "success", { mode: 0o600 });
    await writeExecutable(
      executable,
      [
        `const fs = require("node:fs");`,
        `const args = process.argv.slice(2);`,
        `if (args.length === 1 && args[0] === "--version") {`,
        `  process.stdout.write("1.4.3\\n");`,
        `} else {`,
        `  const behavior = fs.readFileSync(${JSON.stringify(behaviorPath)}, "utf8");`,
        `  if (behavior === "fail") { process.exitCode = 7; }`,
        `  else if (behavior === "invalid") { process.stdout.write("not-json"); }`,
        `  else {`,
        `  const requestPath = args[args.indexOf("--file") + 1];`,
        `  fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({ args, env: process.env, cwd: process.cwd(), request: fs.readFileSync(requestPath, "utf8") }), { mode: 0o600 });`,
        `  process.stdout.write(${JSON.stringify(event)});`,
        `  }`,
        `}`,
      ].join("\n"),
    );

    process.env.AI_OFFICE_OPENCODE_BIN = executable;
    process.env.AI_OFFICE_OPENCODE_PROFILE = "zen";
    delete process.env.AI_OFFICE_OPENCODE_MODEL;
    process.env.AI_OFFICE_LOCAL_RUNNER_ENABLED = "1";
    process.env.AI_OFFICE_AGENT_RUNTIME = "opencode";
    process.env.AI_OFFICE_ZEN_SHARED_STATE_ACK = "synthetic-only";
    process.env.HOME = homeDirectory;
    process.env.XDG_CONFIG_HOME = configDirectory;
    process.env.XDG_DATA_HOME = dataDirectory;
    process.env.XDG_CACHE_HOME = cacheDirectory;

    const source = await new SyntheticSimulatorSource().resolve();
    const runtime = new OpenCodeCliRuntime();
    assert.equal(await runtime.isAvailable(), true);
    const request = {
      featureRequest: "TOP SECRET customer queue depth 37",
      source,
    };
    const result = await runtime.execute(request);
    assert.equal(result.kind, "agent");
    assert.equal(result.dataRoute, "external-opencode-zen");
    assert.equal(result.model, ZEN_MODEL);
    assert.deepEqual(result.metrics.cliProcesses, 1);
    assert.deepEqual(result.metrics.modelTurns, 1);
    assert.equal(result.output.roleOutputs.length, 5);

    const captured = JSON.parse(await readFile(capturePath, "utf8")) as CapturedOpenCodeInvocation;
    assert.match(captured.request, /For Synthetic FlashSim only/u);
    assert.match(captured.request, /bounded queue-depth parameter/u);
    assert.doesNotMatch(captured.request, /TOP SECRET|customer|37/u);
    assert.match(captured.request, new RegExp(source.snapshotDigest, "u"));
    await assert.rejects(access(captured.cwd));

    await writeFile(behaviorPath, "fail", "utf8");
    await assert.rejects(
      runtime.execute(request),
      (error) => error instanceof PocRunnerError && error.reason === "model_error",
    );
    await writeFile(behaviorPath, "invalid", "utf8");
    await assert.rejects(
      runtime.execute(request),
      (error) => error instanceof PocRunnerError && error.reason === "invalid_output",
    );
    await writeFile(behaviorPath, "success", "utf8");
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      runtime.execute({ ...request, signal: controller.signal }),
      (error) => error instanceof PocRunnerError && error.reason === "aborted",
    );
  } finally {
    restoreCapturedEnvironment(previous);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("agent runtimes reject anything but the canonical Synthetic FlashSim snapshot", async () => {
  const source = await new SyntheticSimulatorSource().resolve();
  await assert.doesNotReject(assertSyntheticSourceBoundary(source));
  await assert.rejects(
    assertSyntheticSourceBoundary({ ...source, sourceId: "internal-repository" }),
    (error) => error instanceof PocRunnerError && error.reason === "unavailable",
  );
  await assert.rejects(
    assertSyntheticSourceBoundary({ ...source, snapshot: `${source.snapshot}\ncompany data` }),
    (error) => error instanceof PocRunnerError && error.reason === "unavailable",
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
  assert.match(source, /assertSyntheticSourceBoundary\(request\.source\)/);
  assert.doesNotMatch(source, /args\.push\(buildPrompt/);
});

test("bridge source enforces loopback, rejects browser origins, and requires token plus Host", async () => {
  const source = await readFile(
    new URL("../scripts/poc-bridge.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /const HOST = "127\.0\.0\.1"/);
  assert.match(source, /if \(origin\)/);
  assert.match(source, /bridgeError\("ORIGIN_DENIED", 403\)/);
  assert.doesNotMatch(source, /access-control-allow-origin/iu);
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

function captureEnvironment<const T extends readonly string[]>(
  names: T,
): Map<T[number], string | undefined> {
  return new Map(names.map((name) => [name, process.env[name]]));
}

function restoreCapturedEnvironment(values: ReadonlyMap<string, string | undefined>): void {
  for (const [name, value] of values) restoreEnvironment(name, value);
}

interface CapturedOpenCodeInvocation {
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  request: string;
  requestPath: string;
}

function createZenRuntimeConfig(
  temporaryRoot: string,
  overrides: Partial<OpenCodeRuntimeConfig> = {},
): OpenCodeRuntimeConfig {
  const cacheDirectory = path.join(temporaryRoot, "cache");
  return {
    enabled: true,
    profile: "zen",
    model: ZEN_MODEL,
    configPath: path.join(SYNTHETIC_REPOSITORY_ROOT, "opencode.json"),
    modelCatalogPath: path.join(cacheDirectory, "opencode", "models.json"),
    homeDirectory: path.join(temporaryRoot, "home"),
    configDirectory: path.join(temporaryRoot, "config"),
    dataDirectory: path.join(temporaryRoot, "data"),
    cacheDirectory,
    repositoryRoot: SYNTHETIC_REPOSITORY_ROOT,
    runtimeLabel: "OpenCode Zen test runtime",
    dataRoute: "external-opencode-zen",
    timeoutMs: 30_000,
    stdoutLimitBytes: 512 * 1_024,
    stderrLimitBytes: 64 * 1_024,
    ...overrides,
  };
}

function createZenCatalog(cost: number): Record<string, unknown> {
  return {
    opencode: {
      api: "https://opencode.ai/zen/v1",
      npm: "@ai-sdk/openai-compatible",
      models: {
        [ZEN_MODEL_ID]: {
          id: ZEN_MODEL_ID,
          cost: { input: cost, output: cost },
        },
      },
    },
  };
}

async function writeZenCatalog(catalogPath: string, cost: number): Promise<void> {
  await mkdir(path.dirname(catalogPath), { recursive: true, mode: 0o700 });
  await writeFile(catalogPath, JSON.stringify(createZenCatalog(cost)), {
    mode: 0o600,
  });
}

async function writeExecutable(executable: string, body: string): Promise<void> {
  await mkdir(path.dirname(executable), { recursive: true, mode: 0o700 });
  await writeFile(executable, `#!${process.execPath}\n${body}\n`, { mode: 0o700 });
}

function argumentValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}
