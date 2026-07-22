import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import test from "node:test";

import { PocRunService } from "../lib/poc/application/poc-run.service";
import { PocError, PocRunnerError } from "../lib/poc/domain/poc-errors";
import { localCapabilities } from "../lib/poc/http/local-poc-controller";
import { runDemoPoc } from "../lib/poc/infrastructure/demo-poc-runner";
import {
  assertSafeCompanyModelOutput,
} from "../lib/poc/infrastructure/company-output-boundary";
import {
  hasConfiguredIssuePublisher,
  loadExtensionIssuePublisher,
} from "../lib/poc/infrastructure/extension-issue-publisher";
import {
  loadExtensionSimulatorSource,
} from "../lib/poc/infrastructure/extension-source-loader";

const SOURCE_CONTRACT_VERSION = "ai-office-company-source-v1";
const ISSUE_CONTRACT_VERSION = "ai-office-company-issue-v1";
const SOURCE_IMPORT_COUNTER = "__AI_OFFICE_TEST_SOURCE_IMPORTS__";
const SOURCE_IMPORT_URL = "__AI_OFFICE_TEST_SOURCE_IMPORT_URL__";
const ISSUE_FACTORY_COUNTER = "__AI_OFFICE_TEST_ISSUE_FACTORIES__";
const ISSUE_PUBLISH_COUNTER = "__AI_OFFICE_TEST_ISSUE_PUBLISHES__";

const COMPANY_ENVIRONMENT = [
  "NODE_ENV",
  "AI_OFFICE_LOCAL_RUNNER_ENABLED",
  "AI_OFFICE_AGENT_RUNTIME",
  "AI_OFFICE_OPENCODE_PROFILE",
  "AI_OFFICE_NIKE_ROOT",
  "AI_OFFICE_EXTENSION_MODULE",
  "AI_OFFICE_EXTENSION_MODULE_SHA256",
  "AI_OFFICE_ISSUE_PUBLISHER_MODULE",
  "AI_OFFICE_ISSUE_PUBLISHER_MODULE_SHA256",
  "AI_OFFICE_COMPANY_DATA_ACK",
  "AI_OFFICE_COMPANY_ACCESS_CONTROL_ACK",
  "AI_OFFICE_TRUSTED_PROXY_SECRET",
  "AI_OFFICE_COMPANY_ALLOWED_USER",
] as const;

test("trusted company source accepts an owned, pinned extension and verified snapshot", async () => {
  const previous = captureEnvironment(COMPANY_ENVIRONMENT);
  const fixture = await createSourceFixture();
  try {
    configureSourceFixture(fixture);
    const source = await loadExtensionSimulatorSource();
    const context = await source.resolve();

    assert.equal(source.id, "nike-simulator");
    assert.equal(context.sourceId, source.id);
    assert.equal(context.workingDirectory, fixture.workingDirectory);
    assert.equal(context.outputSchemaPath, fixture.outputSchemaPath);
    assert.equal(context.snapshot, fixture.snapshot);
    assert.equal(context.snapshotDigest, sha256(fixture.snapshot));
    assert.equal(globalCounter(SOURCE_IMPORT_COUNTER), 1);
    const importedUrl = globalValue(SOURCE_IMPORT_URL);
    assert.equal(typeof importedUrl, "string");
    assert.match(importedUrl as string, /ai-office-trusted-extension-/u);
    assert.ok(!(importedUrl as string).includes(fixture.root));
  } finally {
    clearGlobalCounter(SOURCE_IMPORT_COUNTER);
    clearGlobalCounter(SOURCE_IMPORT_URL);
    restoreEnvironment(previous);
    await fixture.remove();
  }
});

test("trusted source rejects relative, escaped, linked, writable, unpinned, and wrong-contract modules without disclosure", async (t) => {
  await t.test("relative module path", async () => {
    const fixture = await createSourceFixture();
    await withCompanyEnvironment(async () => {
      configureSourceFixture(fixture);
      process.env.AI_OFFICE_EXTENSION_MODULE = "relative-company-extension.mjs";
      await assertUnavailableWithoutDisclosure(
        () => loadExtensionSimulatorSource(),
        [fixture.root, "relative-company-extension.mjs"],
      );
    });
    await fixture.remove();
  });

  await t.test("module outside configured root", async () => {
    const fixture = await createSourceFixture();
    const outsideModule = path.join(fixture.base, "outside-secret-extension.mjs");
    const content = renderSourceModule(fixture);
    await writeFile(outsideModule, content, { encoding: "utf8", mode: 0o600 });
    await withCompanyEnvironment(async () => {
      configureSourceFixture(fixture);
      process.env.AI_OFFICE_EXTENSION_MODULE = outsideModule;
      process.env.AI_OFFICE_EXTENSION_MODULE_SHA256 = sha256(content);
      await assertUnavailableWithoutDisclosure(
        () => loadExtensionSimulatorSource(),
        [fixture.root, outsideModule, "outside-secret-extension"],
      );
    });
    await fixture.remove();
  });

  await t.test("symbolic link module", async () => {
    const fixture = await createSourceFixture();
    const linkedModule = path.join(fixture.root, "linked-secret-extension.mjs");
    await symlink(fixture.modulePath, linkedModule);
    await withCompanyEnvironment(async () => {
      configureSourceFixture(fixture);
      process.env.AI_OFFICE_EXTENSION_MODULE = linkedModule;
      await assertUnavailableWithoutDisclosure(
        () => loadExtensionSimulatorSource(),
        [fixture.root, linkedModule, "linked-secret-extension"],
      );
    });
    await fixture.remove();
  });

  await t.test("group or world writable module", async () => {
    const fixture = await createSourceFixture();
    await chmod(fixture.modulePath, 0o666);
    await withCompanyEnvironment(async () => {
      configureSourceFixture(fixture);
      await assertUnavailableWithoutDisclosure(
        () => loadExtensionSimulatorSource(),
        [fixture.root, fixture.modulePath],
      );
    });
    await fixture.remove();
  });

  await t.test("module digest mismatch", async () => {
    const fixture = await createSourceFixture();
    await withCompanyEnvironment(async () => {
      configureSourceFixture(fixture);
      process.env.AI_OFFICE_EXTENSION_MODULE_SHA256 = "0".repeat(64);
      await assertUnavailableWithoutDisclosure(
        () => loadExtensionSimulatorSource(),
        [fixture.root, fixture.modulePath, fixture.snapshot],
      );
    });
    await fixture.remove();
  });

  await t.test("missing module digest", async () => {
    const fixture = await createSourceFixture();
    await withCompanyEnvironment(async () => {
      configureSourceFixture(fixture);
      delete process.env.AI_OFFICE_EXTENSION_MODULE_SHA256;
      await assertUnavailableWithoutDisclosure(
        () => loadExtensionSimulatorSource(),
        [fixture.root, fixture.modulePath, fixture.snapshot],
      );
    });
    await fixture.remove();
  });

  await t.test("contract version mismatch", async () => {
    const fixture = await createSourceFixture({
      contractVersion: "ai-office-company-source-v0-secret",
    });
    await withCompanyEnvironment(async () => {
      configureSourceFixture(fixture);
      await assertUnavailableWithoutDisclosure(
        () => loadExtensionSimulatorSource(),
        [fixture.root, fixture.modulePath, "source-v0-secret"],
      );
    });
    await fixture.remove();
  });
});

test("trusted source rejects a forged snapshot digest without disclosing snapshot or paths", async () => {
  const fixture = await createSourceFixture({ snapshotDigest: "f".repeat(64) });
  await withCompanyEnvironment(async () => {
    configureSourceFixture(fixture);
    const source = await loadExtensionSimulatorSource();
    await assertUnavailableWithoutDisclosure(
      () => source.resolve(),
      [fixture.root, fixture.outputSchemaPath, fixture.snapshot],
    );
  });
  await fixture.remove();
});

test("company output boundary permits relative evidence and rejects secrets, host paths, and stack traces", () => {
  const safeOutput = structuredClone(runDemoPoc("read buffer 크기를 조정해 주세요").output);
  safeOutput.roleOutputs[0].evidence = [
    ".LLM/DLD/read-buffer.md: 상세 스펙",
    "common/framework/buffer.hpp: 공통 인터페이스",
    "FTL/topview/read-flow.svg: 패킷 흐름",
  ];
  assert.doesNotThrow(() => assertSafeCompanyModelOutput(safeOutput));

  const prohibited = [
    "api_key=super-secret-company-key",
    "/Users/engineer/work/nike_nvme/private.md",
    String.raw`C:\Users\engineer\nike_nvme\private.md`,
    String.raw`\\fileserver\secret-share\nike_nvme\private.md`,
    "Error: failed\n    at analyze (company-turn.ts:42:7)",
  ];
  for (const value of prohibited) {
    const output = structuredClone(safeOutput);
    output.roleOutputs[0].summary = value;
    assert.throws(
      () => assertSafeCompanyModelOutput(output),
      (error) => error instanceof PocRunnerError &&
        error.reason === "invalid_output" &&
        error.message === "invalid_output" &&
        !error.message.includes(value),
    );
  }
});

test("legacy PocRunService blocks company extensions before importing their module", async () => {
  const previous = captureEnvironment(COMPANY_ENVIRONMENT);
  const fixture = await createSourceFixture();
  try {
    configureSourceFixture(fixture);
    Reflect.set(process.env, "NODE_ENV", "development");
    process.env.AI_OFFICE_LOCAL_RUNNER_ENABLED = "1";
    process.env.AI_OFFICE_AGENT_RUNTIME = "opencode";
    process.env.AI_OFFICE_OPENCODE_PROFILE = "company";
    process.env.AI_OFFICE_COMPANY_DATA_ACK = "protected-internal-only";
    process.env.AI_OFFICE_COMPANY_ACCESS_CONTROL_ACK = "authenticated-private-server";
    process.env.AI_OFFICE_TRUSTED_PROXY_SECRET = "p".repeat(43);
    process.env.AI_OFFICE_COMPANY_ALLOWED_USER = "jungyun.choi";

    const legacyCapabilities = await localCapabilities();
    assert.equal(legacyCapabilities.agentRuntime.enabled, false);
    assert.equal(legacyCapabilities.dataPolicy.acceptsCompanyData, false);
    assert.equal(globalCounter(SOURCE_IMPORT_COUNTER), 0);

    const service = new PocRunService();
    await assert.rejects(
      service.execute(
        { prompt: "read buffer 파라미터 변경을 분석해 주세요", executionMode: "auto" },
        { idempotencyKey: crypto.randomUUID() },
      ),
      (error) => error instanceof PocError &&
        error.code === "LOCAL_RUNTIME_DISABLED" &&
        !error.message.includes(fixture.root),
    );
    assert.equal(globalCounter(SOURCE_IMPORT_COUNTER), 0);
  } finally {
    clearGlobalCounter(SOURCE_IMPORT_COUNTER);
    restoreEnvironment(previous);
    await fixture.remove();
  }
});

test("issue publisher adapter validation never calls publish", async () => {
  const previous = captureEnvironment(COMPANY_ENVIRONMENT);
  const fixture = await createIssueFixture();
  try {
    process.env.AI_OFFICE_NIKE_ROOT = fixture.root;
    process.env.AI_OFFICE_ISSUE_PUBLISHER_MODULE = fixture.modulePath;
    process.env.AI_OFFICE_ISSUE_PUBLISHER_MODULE_SHA256 = fixture.moduleDigest;

    assert.equal(await hasConfiguredIssuePublisher(), true);
    assert.equal(globalCounter(ISSUE_FACTORY_COUNTER), 0);
    assert.equal(globalCounter(ISSUE_PUBLISH_COUNTER), 0);

    const publisher = await loadExtensionIssuePublisher();
    assert.equal(typeof publisher.publish, "function");
    assert.equal(globalCounter(ISSUE_FACTORY_COUNTER), 1);
    assert.equal(globalCounter(ISSUE_PUBLISH_COUNTER), 0);
  } finally {
    clearGlobalCounter(ISSUE_FACTORY_COUNTER);
    clearGlobalCounter(ISSUE_PUBLISH_COUNTER);
    restoreEnvironment(previous);
    await fixture.remove();
  }
});

interface SourceFixture {
  base: string;
  root: string;
  workingDirectory: string;
  outputSchemaPath: string;
  modulePath: string;
  moduleDigest: string;
  snapshot: string;
  remove(): Promise<void>;
}

async function createSourceFixture(options: {
  contractVersion?: string;
  snapshotDigest?: string;
} = {}): Promise<SourceFixture> {
  const temporaryRoot = await realpath(os.tmpdir());
  const base = await mkdtemp(path.join(temporaryRoot, "ai-office-company-source-"));
  const root = path.join(base, "nike_nvme");
  const workingDirectory = path.join(root, "FTL");
  const outputSchemaPath = path.join(root, ".LLM", "ai-office-output.schema.json");
  const modulePath = path.join(root, "deps", "ai-office-source.mjs");
  const snapshot = "COMPANY_SNAPSHOT_SENTINEL_7f13\ncommon/framework\nFTL/read-buffer\n";
  await Promise.all([
    mkdir(workingDirectory, { recursive: true, mode: 0o700 }),
    mkdir(path.dirname(outputSchemaPath), { recursive: true, mode: 0o700 }),
    mkdir(path.dirname(modulePath), { recursive: true, mode: 0o700 }),
  ]);
  await writeFile(outputSchemaPath, "{}\n", { encoding: "utf8", mode: 0o600 });

  const partial = {
    base,
    root,
    workingDirectory,
    outputSchemaPath,
    modulePath,
    snapshot,
  };
  const content = renderSourceModule(partial, options);
  await writeFile(modulePath, content, { encoding: "utf8", mode: 0o600 });
  return {
    ...partial,
    moduleDigest: sha256(content),
    remove: () => rm(base, { recursive: true, force: true }),
  };
}

function renderSourceModule(
  fixture: Pick<
    SourceFixture,
    "root" | "workingDirectory" | "outputSchemaPath" | "snapshot"
  >,
  options: { contractVersion?: string; snapshotDigest?: string } = {},
): string {
  const context = {
    sourceId: "nike-simulator",
    displayName: "Nike NVMe simulator",
    workingDirectory: fixture.workingDirectory,
    outputSchemaPath: fixture.outputSchemaPath,
    policyNotice: "Approved internal snapshot for analysis only.",
    snapshot: fixture.snapshot,
    snapshotDigest: options.snapshotDigest ?? sha256(fixture.snapshot),
  };
  return [
    `export const contractVersion = ${JSON.stringify(options.contractVersion ?? SOURCE_CONTRACT_VERSION)};`,
    `globalThis[${JSON.stringify(SOURCE_IMPORT_COUNTER)}] = (globalThis[${JSON.stringify(SOURCE_IMPORT_COUNTER)}] ?? 0) + 1;`,
    `globalThis[${JSON.stringify(SOURCE_IMPORT_URL)}] = import.meta.url;`,
    "export function createSimulatorSource() {",
    "  return {",
    '    id: "nike-simulator",',
    `    async resolve() { return ${JSON.stringify(context)}; },`,
    "  };",
    "}",
    "",
  ].join("\n");
}

async function createIssueFixture(): Promise<{
  root: string;
  modulePath: string;
  moduleDigest: string;
  remove(): Promise<void>;
}> {
  const temporaryRoot = await realpath(os.tmpdir());
  const base = await mkdtemp(path.join(temporaryRoot, "ai-office-company-issue-"));
  const root = path.join(base, "nike_nvme");
  const modulePath = path.join(root, "deps", "ai-office-issue-publisher.mjs");
  await mkdir(path.dirname(modulePath), { recursive: true, mode: 0o700 });
  const content = [
    `export const contractVersion = ${JSON.stringify(ISSUE_CONTRACT_VERSION)};`,
    "export function createIssuePublisher() {",
    `  globalThis[${JSON.stringify(ISSUE_FACTORY_COUNTER)}] = (globalThis[${JSON.stringify(ISSUE_FACTORY_COUNTER)}] ?? 0) + 1;`,
    "  return {",
    "    async publish() {",
    `      globalThis[${JSON.stringify(ISSUE_PUBLISH_COUNTER)}] = (globalThis[${JSON.stringify(ISSUE_PUBLISH_COUNTER)}] ?? 0) + 1;`,
    '      return { issueUrl: "https://example.invalid/issues/1" };',
    "    },",
    "  };",
    "}",
    "",
  ].join("\n");
  await writeFile(modulePath, content, { encoding: "utf8", mode: 0o600 });
  return {
    root,
    modulePath,
    moduleDigest: sha256(content),
    remove: () => rm(base, { recursive: true, force: true }),
  };
}

function configureSourceFixture(fixture: SourceFixture): void {
  process.env.AI_OFFICE_NIKE_ROOT = fixture.root;
  process.env.AI_OFFICE_EXTENSION_MODULE = fixture.modulePath;
  process.env.AI_OFFICE_EXTENSION_MODULE_SHA256 = fixture.moduleDigest;
}

async function withCompanyEnvironment(operation: () => Promise<void>): Promise<void> {
  const previous = captureEnvironment(COMPANY_ENVIRONMENT);
  try {
    await operation();
  } finally {
    clearGlobalCounter(SOURCE_IMPORT_COUNTER);
    clearGlobalCounter(SOURCE_IMPORT_URL);
    restoreEnvironment(previous);
  }
}

async function assertUnavailableWithoutDisclosure(
  operation: () => Promise<unknown>,
  prohibited: string[],
): Promise<void> {
  let observed: unknown;
  try {
    await operation();
  } catch (error) {
    observed = error;
  }
  assert.ok(observed instanceof PocRunnerError);
  assert.equal(observed.reason, "unavailable");
  assert.equal(observed.message, "unavailable");
  const publicError = `${observed.name}: ${observed.message}`;
  for (const value of prohibited) {
    assert.ok(!publicError.includes(value), `error disclosed prohibited value: ${value}`);
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function globalCounter(name: string): number {
  const value = globalValue(name);
  return typeof value === "number" ? value : 0;
}

function globalValue(name: string): unknown {
  return (globalThis as unknown as Record<string, unknown>)[name];
}

function clearGlobalCounter(name: string): void {
  delete (globalThis as unknown as Record<string, unknown>)[name];
}

function captureEnvironment<const T extends readonly string[]>(
  names: T,
): Record<T[number], string | undefined> {
  return Object.fromEntries(names.map((name) => [name, process.env[name]])) as Record<
    T[number],
    string | undefined
  >;
}

function restoreEnvironment(previous: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
