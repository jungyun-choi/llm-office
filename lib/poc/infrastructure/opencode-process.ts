import path from "node:path";
import type { Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import type { OpenCodeRuntimeConfig } from "./opencode-runtime-config";
import { PocRunnerError } from "../domain/poc-errors";
import { executeSecureCli, type SecureCliProcessResult } from "./secure-cli-process";
import { stageSyntheticRuntimeWorkspace } from "./synthetic-runtime-workspace";

const MAX_MODEL_CATALOG_BYTES = 16 * 1_024 * 1_024;
const MAX_MODEL_CATALOG_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const ZEN_API_URL = "https://opencode.ai/zen/v1";

function minimalEnvironment(
  executable: string,
  runtimeDirectory: string,
  config: OpenCodeRuntimeConfig,
  stagedConfigPath: string,
  stagedModelCatalogPath: string | undefined,
): NodeJS.ProcessEnv {
  const zenProfile = config.profile === "zen";
  return {
    PATH: [path.dirname(executable), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].join(":"),
    HOME: runtimeDirectory,
    XDG_CONFIG_HOME: config.configDirectory ?? path.join(runtimeDirectory, "config"),
    XDG_DATA_HOME: config.dataDirectory ?? path.join(runtimeDirectory, "data"),
    XDG_CACHE_HOME: config.cacheDirectory ?? path.join(runtimeDirectory, "cache"),
    XDG_STATE_HOME: path.join(runtimeDirectory, "state"),
    TMPDIR: path.join(runtimeDirectory, "tmp"),
    LANG: "C.UTF-8",
    NO_COLOR: "1",
    NO_PROXY: "127.0.0.1,localhost",
    OPENCODE_CONFIG: stagedConfigPath,
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      share: "disabled",
      autoupdate: false,
      instructions: [],
      plugin: [],
      mcp: {},
      permission: { "*": "deny" },
    }),
    AI_OFFICE_OPENCODE_MODEL: config.model,
    OPENCODE_DISABLE_CLAUDE_CODE: "1",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
    OPENCODE_DISABLE_LSP_DOWNLOAD: "1",
    OPENCODE_DISABLE_MODELS_FETCH: zenProfile ? "1" : undefined,
    OPENCODE_DISABLE_PROJECT_CONFIG: zenProfile ? "1" : undefined,
    OPENCODE_MODELS_PATH: stagedModelCatalogPath,
    NODE_ENV: "production",
  };
}

function processArguments(
  config: OpenCodeRuntimeConfig,
  workspace: string,
  requestFile: string,
): string[] {
  return [
    "run",
    "Use only the attached untrusted request snapshot. Do not call tools. Return the required JSON object.",
    "--pure",
    "--model",
    config.model,
    "--agent",
    "orchestrator",
    "--format",
    "json",
    "--dir",
    workspace,
    "--title",
    "AI Office synthetic POC",
    "--file",
    requestFile,
  ];
}

export async function executeOpenCodeProcess(
  executable: string,
  runtimeDirectory: string,
  config: OpenCodeRuntimeConfig,
  prompt: string,
  signal?: AbortSignal,
): Promise<SecureCliProcessResult> {
  const { writeFile } = await import("node:fs/promises");
  if (!(await hasSafeZenGlobalConfig(config))) throw new PocRunnerError("unavailable");
  const stagedModelCatalogPath = await stageTrustedModelCatalog(config, runtimeDirectory);
  const workspace = await stageSyntheticRuntimeWorkspace(runtimeDirectory, config);
  const stagedConfigPath = path.join(workspace, "opencode.json");
  const requestFile = path.join(workspace, "request-data.txt");
  await writeFile(requestFile, prompt, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return executeSecureCli({
    executable,
    args: processArguments(config, workspace, requestFile),
    cwd: workspace,
    env: minimalEnvironment(
      executable,
      runtimeDirectory,
      config,
      stagedConfigPath,
      stagedModelCatalogPath,
    ),
    timeoutMs: config.timeoutMs,
    stdoutLimitBytes: config.stdoutLimitBytes,
    stderrLimitBytes: config.stderrLimitBytes,
    signal,
  });
}

export async function hasUsableModelCatalog(
  config: OpenCodeRuntimeConfig,
): Promise<boolean> {
  if (config.profile !== "zen") return true;
  return Boolean(await readTrustedModelCatalog(config));
}

async function stageTrustedModelCatalog(
  config: OpenCodeRuntimeConfig,
  runtimeDirectory: string,
): Promise<string | undefined> {
  if (config.profile !== "zen") return undefined;
  const content = await readTrustedModelCatalog(config);
  if (!content) throw new PocRunnerError("unavailable");
  const { writeFile } = await import("node:fs/promises");
  const target = path.join(runtimeDirectory, "models.json");
  await writeFile(target, content, { flag: "wx", mode: 0o600 });
  return target;
}

export async function hasSafeZenGlobalConfig(
  config: OpenCodeRuntimeConfig,
): Promise<boolean> {
  if (config.profile !== "zen") return true;
  if (!config.configDirectory) return false;
  const configRoot = path.join(config.configDirectory, "opencode");
  if (await containsUnsafeGlobalAssets(configRoot)) return false;
  const configFile = path.join(configRoot, "opencode.json");
  if (!(await fileExists(configFile))) return true;
  try {
    const { readFile } = await import("node:fs/promises");
    const value: unknown = JSON.parse(await readFile(configFile, "utf8"));
    return isSafeGlobalConfig(value);
  } catch {
    return false;
  }
}

async function readTrustedModelCatalog(
  config: OpenCodeRuntimeConfig,
): Promise<Buffer | undefined> {
  if (!config.modelCatalogPath) return undefined;
  const { constants } = await import("node:fs");
  const { open } = await import("node:fs/promises");
  let file: FileHandle | undefined;
  try {
    file = await open(config.modelCatalogPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!isTrustedCatalogFile(stat)) return undefined;
    const content = await file.readFile();
    const catalog: unknown = JSON.parse(content.toString("utf8"));
    return catalogContainsFreeZenModel(catalog, config.model) ? content : undefined;
  } catch {
    return undefined;
  } finally {
    await file?.close();
  }
}

function catalogContainsFreeZenModel(catalog: unknown, fullModelId: string): boolean {
  if (!isRecord(catalog)) return false;
  const [providerId, modelId] = fullModelId.split("/", 2);
  const provider = catalog[providerId];
  if (!isRecord(provider) || !isRecord(provider.models)) return false;
  const model = provider.models[modelId];
  return (
    provider.api === ZEN_API_URL &&
    provider.npm === "@ai-sdk/openai-compatible" &&
    isRecord(model) &&
    model.id === modelId &&
    !("provider" in model) &&
    hasZeroCost(model.cost) &&
    optionalZeroCost(model.tiers) &&
    optionalZeroCost(model.context_over_200k)
  );
}

function isTrustedCatalogFile(file: Stats): boolean {
  const ownedByProcess = typeof process.getuid !== "function" || file.uid === process.getuid();
  const recent = Date.now() - file.mtimeMs <= MAX_MODEL_CATALOG_AGE_MS;
  return file.isFile() && ownedByProcess && (file.mode & 0o022) === 0 &&
    file.size <= MAX_MODEL_CATALOG_BYTES && recent;
}

function hasZeroCost(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return value.input === 0 && value.output === 0 && allNumbersAreZero(value);
}

function optionalZeroCost(value: unknown): boolean {
  return value === undefined || allNumbersAreZero(value);
}

function allNumbersAreZero(value: unknown): boolean {
  if (typeof value === "number") return value === 0;
  if (Array.isArray(value)) return value.every(allNumbersAreZero);
  if (!isRecord(value)) return false;
  return Object.values(value).every(allNumbersAreZero);
}

function isSafeGlobalConfig(value: unknown): boolean {
  if (!isRecord(value)) return false;
  for (const unsafeKey of ["instructions", "mcp", "permission", "tools", "command"]) {
    if (unsafeKey in value) return false;
  }
  const agents = value.agent;
  const providers = value.provider;
  if (isRecord(agents) && "orchestrator" in agents) return false;
  return !isRecord(providers) || !("opencode" in providers);
}

async function containsUnsafeGlobalAssets(configRoot: string): Promise<boolean> {
  const candidates = [
    "AGENTS.md",
    "opencode.jsonc",
    "config.json",
    "config.jsonc",
    "agents",
    "commands",
    "skills",
    "plugins",
  ];
  for (const candidate of candidates) {
    if (await pathExists(path.join(configRoot, candidate))) return true;
  }
  return false;
}

async function fileExists(candidate: string): Promise<boolean> {
  try {
    const { lstat } = await import("node:fs/promises");
    return (await lstat(candidate)).isFile();
  } catch {
    return false;
  }
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    const { lstat } = await import("node:fs/promises");
    await lstat(candidate);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
