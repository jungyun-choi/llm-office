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
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import test from "node:test";
import type { AgentRuntimeProgress } from "../lib/poc/application/ports/agent-runtime";
import { PocRunnerError } from "../lib/poc/domain/poc-errors";
import { runDemoPoc } from "../lib/poc/infrastructure/demo-poc-runner";
import {
  COMPANY_TURN_TIMEOUT_MS,
  getOpenCodeRuntimeConfig,
} from "../lib/poc/infrastructure/opencode-runtime-config";
import {
  findOpenCodeExecutable,
  isTrustedOpenCodeExecutable,
  OpenCodeCliRuntime,
} from "../lib/poc/infrastructure/opencode-poc-runner";
import { hasTrustedCompanyAuth } from "../lib/poc/infrastructure/company-turn-executor";
import { CompanyOrbitQuestionGenerator } from "../lib/office-jobs/infrastructure/company-orbit-question-generator";

const COMPANY_ENVIRONMENT_NAMES = [
  "NODE_ENV",
  "AI_OFFICE_LOCAL_RUNNER_ENABLED",
  "AI_OFFICE_AGENT_RUNTIME",
  "AI_OFFICE_OPENCODE_PROFILE",
  "AI_OFFICE_OPENCODE_BIN",
  "AI_OFFICE_OPENCODE_MODEL",
  "AI_OFFICE_COMPANY_AUTH_FILE",
  "AI_OFFICE_COMPANY_PROVIDER_ALLOWLIST",
  "AI_OFFICE_COMPANY_SNAPSHOT_MAX_BYTES",
  "AI_OFFICE_MODEL_ORCHESTRATOR",
  "AI_OFFICE_MODEL_RESEARCH",
  "AI_OFFICE_MODEL_FRAMEWORK",
  "AI_OFFICE_MODEL_ESTIMATE",
  "AI_OFFICE_MODEL_TEST",
  "AI_OFFICE_MODEL_GIT",
  "AI_OFFICE_DEPLOYMENT_MODE",
  "AI_OFFICE_INTERNAL_EXECUTION_ACK",
  "ANTHROPIC_API_KEY",
] as const;

const ROLE_ORDER = ["research", "framework", "estimate", "test", "git", "orchestrator"] as const;
const ROLE_MODELS = {
  research: "codemate/CompanyGeneral",
  framework: "codemate/CodeLLMPro",
  estimate: "codemate/CompanyGeneral",
  test: "codemate/CodeLLMPro",
  git: "codemate/CodeLLMPro",
  orchestrator: "codemate/CompanyGeneral",
} as const;
const DISABLED_COMPANY_TOOLS = [
  "apply_patch",
  "bash",
  "codesearch",
  "edit",
  "glob",
  "grep",
  "list",
  "lsp",
  "patch",
  "question",
  "read",
  "skill",
  "task",
  "todowrite",
  "webfetch",
  "websearch",
  "write",
] as const;

test("company profile requires explicit auth and allowlisted role models", () => {
  const previous = captureEnvironment(COMPANY_ENVIRONMENT_NAMES);
  try {
    configureCompanyEnvironment(path.join(os.tmpdir(), "company-auth.json"));
    const config = getOpenCodeRuntimeConfig();
    assert.equal(config.profile, "company");
    assert.equal(config.model, "codemate/CodeLLMPro");
    assert.equal(config.timeoutMs, COMPANY_TURN_TIMEOUT_MS);
    assert.deepEqual(config.companyProviderAllowlist, ["codemate"]);
    assert.deepEqual(config.companyRoleModels, ROLE_MODELS);
    process.env.AI_OFFICE_COMPANY_PROVIDER_ALLOWLIST = "codemate,codemate";
    assert.deepEqual(getOpenCodeRuntimeConfig().companyProviderAllowlist, ["codemate"]);
    process.env.AI_OFFICE_COMPANY_PROVIDER_ALLOWLIST = "codemate,outside";
    assert.throws(getOpenCodeRuntimeConfig, /only codemate/u);
    process.env.AI_OFFICE_COMPANY_PROVIDER_ALLOWLIST = "codemate";

    delete process.env.AI_OFFICE_COMPANY_AUTH_FILE;
    assert.throws(getOpenCodeRuntimeConfig, /must be an absolute path/u);
    process.env.AI_OFFICE_COMPANY_AUTH_FILE = "relative/auth.json";
    assert.throws(getOpenCodeRuntimeConfig, /must be an absolute path/u);
    process.env.AI_OFFICE_COMPANY_AUTH_FILE = path.join(os.tmpdir(), "company-auth.json");
    process.env.AI_OFFICE_MODEL_TEST = "outside/CodeLLMPro";
    assert.throws(getOpenCodeRuntimeConfig, /allowlisted provider/u);

    process.env.AI_OFFICE_MODEL_TEST = ROLE_MODELS.test;
    Reflect.set(process.env, "NODE_ENV", "production");
    delete process.env.AI_OFFICE_DEPLOYMENT_MODE;
    delete process.env.AI_OFFICE_INTERNAL_EXECUTION_ACK;
    assert.equal(getOpenCodeRuntimeConfig().enabled, false);
    process.env.AI_OFFICE_DEPLOYMENT_MODE = "internal";
    process.env.AI_OFFICE_INTERNAL_EXECUTION_ACK = "on-prem-only";
    assert.equal(getOpenCodeRuntimeConfig().enabled, true);
  } finally {
    restoreEnvironment(previous);
  }
});

test("company executable trust accepts service-owned or root-owned immutable files", () => {
  const serviceUid = typeof process.getuid === "function" ? process.getuid() : 501;
  assert.equal(isTrustedOpenCodeExecutable({ uid: serviceUid, mode: 0o100700 }), true);
  assert.equal(isTrustedOpenCodeExecutable({ uid: 0, mode: 0o100755 }), true);
  assert.equal(isTrustedOpenCodeExecutable({ uid: 0, mode: 0o100775 }), false);
  assert.equal(isTrustedOpenCodeExecutable({ uid: serviceUid + 1, mode: 0o100755 }), false);
});

test("company profile never falls back to HOME or PATH for OpenCode", async () => {
  const previous = captureEnvironment(COMPANY_ENVIRONMENT_NAMES);
  try {
    configureCompanyEnvironment(path.join(os.tmpdir(), "company-auth.json"));
    delete process.env.AI_OFFICE_OPENCODE_BIN;
    assert.equal(await findOpenCodeExecutable(), undefined);
  } finally {
    restoreEnvironment(previous);
  }
});

test("company auth rejects unsafe files and materializes only codemate", async () => {
  const previous = captureEnvironment(COMPANY_ENVIRONMENT_NAMES);
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "company-auth-test-"));
  try {
    const authFile = path.join(temporaryRoot, "auth.json");
    configureCompanyEnvironment(authFile);
    await writeCompanyAuth(authFile, "company-secret");
    let config = getOpenCodeRuntimeConfig();
    assert.equal(await hasTrustedCompanyAuth(config), true);

    await chmod(authFile, 0o644);
    assert.equal(await hasTrustedCompanyAuth(config), false);
    await writeCompanyAuth(authFile, "company-secret");
    await writeFile(authFile, JSON.stringify({
      codemate: { type: "api", key: "company-secret" },
      unapproved: { type: "api", key: "must-not-be-staged" },
    }), { mode: 0o600 });
    assert.equal(await hasTrustedCompanyAuth(config), false);
    await writeCompanyAuth(authFile, "company-secret");
    await writeFile(authFile, JSON.stringify({ other: { type: "api", key: "wrong" } }), {
      mode: 0o600,
    });
    assert.equal(await hasTrustedCompanyAuth(config), false);
    await writeCompanyAuth(authFile, "1234567");
    assert.equal(await hasTrustedCompanyAuth(config), false);

    const trustedTarget = path.join(temporaryRoot, "trusted-target.json");
    await writeCompanyAuth(trustedTarget, "company-secret");
    await rm(authFile);
    await symlink(trustedTarget, authFile);
    config = getOpenCodeRuntimeConfig();
    assert.equal(await hasTrustedCompanyAuth(config), false);
  } finally {
    restoreEnvironment(previous);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("company Orbit generates request-specific questions through the isolated OpenCode turn", async () => {
  const previous = captureEnvironment(COMPANY_ENVIRONMENT_NAMES);
  const trustedTestRoot = await realpath(os.homedir());
  const temporaryRoot = await mkdtemp(path.join(trustedTestRoot, ".company-orbit-test-"));
  try {
    const executable = path.join(temporaryRoot, "bin", "opencode");
    const authFile = path.join(temporaryRoot, "service-auth.json");
    await writeCompanyAuth(authFile, "company-secret-value");
    await writeFakeOrbitOpenCode(executable);
    configureCompanyEnvironment(authFile, executable);

    const result = await new CompanyOrbitQuestionGenerator().generate("Read buffer를 2MB로 늘려 주세요");

    assert.equal(result.source, "company-opencode");
    assert.equal(result.model, ROLE_MODELS.orchestrator);
    assert.deepEqual(result.questions.map(({ id }) => id), ["behavior", "acceptance"]);
  } finally {
    restoreEnvironment(previous);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("company OpenCode runs isolated 5+1 turns and stops on the first failure", async () => {
  const previous = captureEnvironment(COMPANY_ENVIRONMENT_NAMES);
  const trustedTestRoot = await realpath(os.homedir());
  const temporaryRoot = await mkdtemp(path.join(trustedTestRoot, ".company-runtime-test-"));
  try {
    const executable = path.join(temporaryRoot, "bin", "opencode");
    const authFile = path.join(temporaryRoot, "service-auth.json");
    const captureRoot = path.join(temporaryRoot, "captures");
    const counterFile = path.join(temporaryRoot, "counter.txt");
    const failureFile = path.join(temporaryRoot, "failure-role.txt");
    await mkdir(captureRoot, { mode: 0o700 });
    await writeCompanyAuth(authFile, "company-secret-value");
    await writeFile(counterFile, "0", { mode: 0o600 });
    await writeFile(failureFile, "", { mode: 0o600 });
    await writeFakeOpenCode(executable, captureRoot, counterFile, failureFile);
    configureCompanyEnvironment(authFile, executable);
    process.env.ANTHROPIC_API_KEY = "must-not-reach-company-child";

    const progress: AgentRuntimeProgress[] = [];
    const runtime = new OpenCodeCliRuntime();
    assert.equal(await runtime.isAvailable(), true);
    const source = companySource();
    const result = await runtime.execute({
      featureRequest: "COMPANY_REQUEST_SENTINEL buffer policy 변경",
      source,
      onProgress: (event) => progress.push(event),
    });

    assert.equal(result.dataRoute, "internal-opencode");
    assert.equal(result.metrics.cliProcesses, 6);
    assert.equal(result.metrics.modelTurns, 6);
    assert.deepEqual(result.output.roleOutputs.map(({ role }) => role), ROLE_ORDER.slice(0, 5));
    assert.deepEqual(
      progress.filter(({ status }) => status === "completed").map(({ role }) => role),
      ROLE_ORDER,
    );
    const successfulCaptures = await readCaptures(captureRoot);
    assert.equal(successfulCaptures.length, 6);
    await assertSecureInvocations(successfulCaptures, source.snapshot);

    await rm(captureRoot, { recursive: true, force: true });
    await mkdir(captureRoot, { mode: 0o700 });
    await writeFile(counterFile, "0", "utf8");
    await writeFile(failureFile, "estimate", "utf8");
    const failedProgress: AgentRuntimeProgress[] = [];
    await assert.rejects(
      runtime.execute({
        featureRequest: "COMPANY_REQUEST_SENTINEL 실패 흐름",
        source,
        onProgress: (event) => failedProgress.push(event),
      }),
      (error) => error instanceof PocRunnerError && error.reason === "model_error",
    );
    const failedCaptures = await readCaptures(captureRoot);
    assert.deepEqual(failedCaptures.map(({ role }) => role), ["research", "framework", "estimate"]);
    assert.deepEqual(
      failedProgress.filter(({ status }) => status === "completed").map(({ role }) => role),
      ["research", "framework"],
    );
    assert.deepEqual(
      failedProgress.filter(({ status }) => status === "failed").map(({ role }) => role),
      ["estimate"],
    );
    await assertRuntimeDirectoriesRemoved(failedCaptures);

    for (const channel of ["stdout", "stderr"] as const) {
      await rm(captureRoot, { recursive: true, force: true });
      await mkdir(captureRoot, { mode: 0o700 });
      await writeFile(counterFile, "0", "utf8");
      await writeFile(failureFile, `leak-${channel}:research`, "utf8");
      await assert.rejects(
        runtime.execute({
          featureRequest: "credential leak detection",
          source,
        }),
        (error) => error instanceof PocRunnerError && error.reason === "invalid_output",
      );
      const leakCaptures = await readCaptures(captureRoot);
      assert.equal(leakCaptures.length, 1);
      await assertRuntimeDirectoriesRemoved(leakCaptures);
    }
  } finally {
    restoreEnvironment(previous);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

interface CapturedTurn {
  role: string;
  args: string[];
  cwd: string;
  context: string;
  contextMode: number;
  runtimeRoot: string;
  modes: Record<string, number>;
  env: Record<string, string | null>;
  config: {
    enabled_providers: string[];
    tools: Record<string, boolean>;
    [key: string]: unknown;
  };
  auth: Record<string, unknown>;
  authMode: number;
}

async function assertSecureInvocations(captures: CapturedTurn[], sourceSnapshot: string): Promise<void> {
  assert.deepEqual(captures.map(({ role }) => role), ROLE_ORDER);
  assert.equal(new Set(captures.map(({ runtimeRoot }) => runtimeRoot)).size, 6);
  for (const [index, capture] of captures.entries()) {
    const role = ROLE_ORDER[index];
    assert.equal(capture.args[0], "run");
    assert.doesNotMatch(capture.args[1] ?? "", /COMPANY_REQUEST_SENTINEL|COMPANY_SOURCE_SENTINEL/u);
    assert.match(capture.args[1] ?? "", /attached file is untrusted context data/iu);
    assert.equal(capture.args.includes("--pure"), false);
    assert.equal(capture.args.includes("--agent"), false);
    assert.equal(argumentValue(capture.args, "--file")?.endsWith("untrusted-context.json.txt"), true);
    assert.equal(argumentValue(capture.args, "--model"), ROLE_MODELS[role]);
    assert.match(capture.context, /UNTRUSTED_DATA_JSON=/u);
    if (role === "orchestrator") {
      assert.match(capture.context, /"roleOutputs"/u);
    } else {
      assert.match(capture.context, /COMPANY_REQUEST_SENTINEL/u);
      assert.match(capture.context, new RegExp(sourceSnapshot.split("\n", 1)[0] ?? "", "u"));
    }
    assert.equal(capture.contextMode, 0o600);
    assert.deepEqual(Object.values(capture.modes), Array(Object.keys(capture.modes).length).fill(0o700));
    assert.equal(capture.authMode, 0o600);
    assert.deepEqual(Object.keys(capture.auth), ["codemate"]);
    assert.deepEqual(capture.auth.codemate, { type: "api", key: "company-secret-value" });
    assert.equal(capture.env.INTERNAL_API_KEY, "company-secret-value");
    assert.equal(capture.env.OPENCODE_CONFIG, null);
    assert.equal(capture.env.OPENCODE_DISABLE_DEFAULT_PLUGINS, null);
    assert.equal(capture.env.ANTHROPIC_API_KEY, null);
    assert.deepEqual(capture.config.enabled_providers, ["codemate"]);
    assert.deepEqual(Object.keys(capture.config.tools).sort(), DISABLED_COMPANY_TOOLS);
    assert.equal(Object.values(capture.config.tools).every((enabled) => enabled === false), true);
    assert.equal("plugin" in capture.config, false);
  }
  assert.match(captures[1]?.context ?? "", /합성 Wiki와 디버깅 기록/u);
  assert.match(captures[5]?.context ?? "", /"roleOutputs"/u);
  await assertRuntimeDirectoriesRemoved(captures);
}

async function assertRuntimeDirectoriesRemoved(captures: CapturedTurn[]): Promise<void> {
  for (const { runtimeRoot } of captures) await assert.rejects(access(runtimeRoot));
}

async function readCaptures(captureRoot: string): Promise<CapturedTurn[]> {
  const names = (await readdir(captureRoot)).sort((left, right) =>
    Number(left.split("-", 1)[0]) - Number(right.split("-", 1)[0]));
  return Promise.all(names.map(async (name) =>
    JSON.parse(await readFile(path.join(captureRoot, name), "utf8")) as CapturedTurn));
}

async function writeFakeOpenCode(
  executable: string,
  captureRoot: string,
  counterFile: string,
  failureFile: string,
): Promise<void> {
  const demo = runDemoPoc("합성 read buffer 기능을 분석해 주세요").output;
  const outputs = Object.fromEntries(ROLE_ORDER.map((role) => [
    role,
    role === "orchestrator"
      ? demo.brief
      : demo.roleOutputs.find((candidate) => candidate.role === role),
  ]));
  const source = [
    `#!${process.execPath}`,
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    "const args = process.argv.slice(2);",
    'if (args.length === 1 && args[0] === "--version") { process.stdout.write("1.4.3\\n"); process.exit(0); }',
    `const roles = ${JSON.stringify(ROLE_ORDER)};`,
    `const outputs = ${JSON.stringify(outputs)};`,
    `const counterFile = ${JSON.stringify(counterFile)};`,
    `const captureRoot = ${JSON.stringify(captureRoot)};`,
    `const failureFile = ${JSON.stringify(failureFile)};`,
    'const index = Number(fs.readFileSync(counterFile, "utf8"));',
    "const role = roles[index];",
    'fs.writeFileSync(counterFile, String(index + 1), { mode: 0o600 });',
    'const valueAfter = (name) => args[args.indexOf(name) + 1];',
    'const contextPath = valueAfter("--file");',
    'const authPath = path.join(process.env.XDG_DATA_HOME, "opencode", "auth.json");',
    'const runtimeRoot = path.dirname(process.env.HOME);',
    "const mode = (candidate) => fs.statSync(candidate).mode & 0o777;",
    "const capture = {",
    "  role, args, cwd: process.cwd(), runtimeRoot,",
    '  context: fs.readFileSync(contextPath, "utf8"), contextMode: mode(contextPath),',
    "  modes: { root: mode(runtimeRoot), home: mode(process.env.HOME), config: mode(process.env.XDG_CONFIG_HOME), data: mode(process.env.XDG_DATA_HOME), cache: mode(process.env.XDG_CACHE_HOME), state: mode(process.env.XDG_STATE_HOME), tmp: mode(process.env.TMPDIR), workspace: mode(process.cwd()) },",
    "  env: { INTERNAL_API_KEY: process.env.INTERNAL_API_KEY || null, OPENCODE_CONFIG: process.env.OPENCODE_CONFIG || null, OPENCODE_DISABLE_DEFAULT_PLUGINS: process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS || null, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || null },",
    '  config: JSON.parse(process.env.OPENCODE_CONFIG_CONTENT), auth: JSON.parse(fs.readFileSync(authPath, "utf8")), authMode: mode(authPath),',
    "};",
    'fs.writeFileSync(path.join(captureRoot, `${index}-${role}.json`), JSON.stringify(capture), { mode: 0o600 });',
    'const behavior = fs.readFileSync(failureFile, "utf8").trim();',
    'if (behavior === role) { process.exit(7); }',
    'if (behavior === `leak-stdout:${role}`) { process.stdout.write(process.env.INTERNAL_API_KEY); process.exit(0); }',
    'if (behavior === `leak-stderr:${role}`) { process.stderr.write(process.env.INTERNAL_API_KEY); process.stdout.write(JSON.stringify({ type: "text", part: { type: "text", text: JSON.stringify(outputs[role]) } })); process.exit(0); }',
    'process.stdout.write(JSON.stringify({ type: "text", part: { type: "text", text: JSON.stringify(outputs[role]) } }));',
  ].join("\n");
  await mkdir(path.dirname(executable), { recursive: true, mode: 0o700 });
  await writeFile(executable, source, { mode: 0o700 });
  await chmod(executable, 0o700);
}

async function writeFakeOrbitOpenCode(executable: string): Promise<void> {
  const output = {
    questions: [
      {
        id: "behavior",
        prompt: "현재 제한과 목표 제한은 각각 얼마인가요?",
        hint: "동작 차이를 확정합니다.",
        placeholder: "예: 현재 1MB, 목표 2MB",
      },
      {
        id: "acceptance",
        prompt: "기존 동작 중 반드시 보존할 회귀 기준은 무엇인가요?",
        hint: "완료 기준을 확정합니다.",
        placeholder: "예: 기존 1MB 결과 유지",
      },
    ],
  };
  const source = [
    `#!${process.execPath}`,
    'const fs = require("node:fs");',
    "const args = process.argv.slice(2);",
    'if (args.length === 1 && args[0] === "--version") { process.stdout.write("1.4.3\\n"); process.exit(0); }',
    'const contextPath = args[args.indexOf("--file") + 1];',
    'const context = fs.readFileSync(contextPath, "utf8");',
    'if (!context.includes("Read buffer") || !context.includes("UNTRUSTED_DATA_JSON=")) process.exit(8);',
    `const output = ${JSON.stringify(output)};`,
    'process.stdout.write(JSON.stringify({ type: "text", part: { type: "text", text: JSON.stringify(output) } }));',
  ].join("\n");
  await mkdir(path.dirname(executable), { recursive: true, mode: 0o700 });
  await writeFile(executable, source, { mode: 0o700 });
  await chmod(executable, 0o700);
}

async function writeCompanyAuth(authFile: string, key: string): Promise<void> {
  await writeFile(authFile, JSON.stringify({
    codemate: { type: "api", key },
  }), { mode: 0o600 });
  await chmod(authFile, 0o600);
  assert.equal((await stat(authFile)).mode & 0o777, 0o600);
}

function configureCompanyEnvironment(authFile: string, executable?: string): void {
  Reflect.set(process.env, "NODE_ENV", "test");
  process.env.AI_OFFICE_LOCAL_RUNNER_ENABLED = "1";
  process.env.AI_OFFICE_AGENT_RUNTIME = "opencode";
  process.env.AI_OFFICE_OPENCODE_PROFILE = "company";
  process.env.AI_OFFICE_OPENCODE_MODEL = "codemate/CodeLLMPro";
  process.env.AI_OFFICE_COMPANY_AUTH_FILE = authFile;
  process.env.AI_OFFICE_COMPANY_PROVIDER_ALLOWLIST = "codemate";
  process.env.AI_OFFICE_MODEL_ORCHESTRATOR = ROLE_MODELS.orchestrator;
  process.env.AI_OFFICE_MODEL_RESEARCH = ROLE_MODELS.research;
  process.env.AI_OFFICE_MODEL_FRAMEWORK = ROLE_MODELS.framework;
  process.env.AI_OFFICE_MODEL_ESTIMATE = ROLE_MODELS.estimate;
  process.env.AI_OFFICE_MODEL_TEST = ROLE_MODELS.test;
  process.env.AI_OFFICE_MODEL_GIT = ROLE_MODELS.git;
  if (executable) process.env.AI_OFFICE_OPENCODE_BIN = executable;
}

function companySource() {
  return {
    sourceId: "company-simulator-source",
    displayName: "Company SSD/UFS Simulator",
    workingDirectory: "/company/simulator",
    outputSchemaPath: "/company/contracts/poc-output.schema.json",
    policyNotice: "company-internal source",
    snapshot: "COMPANY_SOURCE_SENTINEL\n.LLM/DLD/read-buffer.md\ncommon/FTL/FIL/HIL TopView",
    snapshotDigest: "c".repeat(64),
  };
}

function argumentValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function captureEnvironment(
  names: readonly string[],
): Record<string, string | undefined> {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreEnvironment(values: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
