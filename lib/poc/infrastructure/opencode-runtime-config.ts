import path from "node:path";

const DEFAULT_INTERNAL_MODEL = "ollama/qwen2.5-coder:3b";
const DEFAULT_ZEN_MODEL = "opencode/deepseek-v4-flash-free";
const DEFAULT_TIMEOUT_MS = 120_000;
const MIN_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 180_000;
const MODEL_PATTERN = /^[a-z0-9_.-]+\/[a-z0-9_.:-]+$/iu;
const FREE_ZEN_MODELS = new Set([
  "opencode/big-pickle",
  "opencode/deepseek-v4-flash-free",
  "opencode/mimo-v2.5-free",
  "opencode/nemotron-3-ultra-free",
  "opencode/north-mini-code-free",
]);

export type OpenCodeProfile = "internal" | "zen";

export interface OpenCodeRuntimeConfig {
  enabled: boolean;
  profile: OpenCodeProfile;
  model: string;
  configPath: string;
  modelCatalogPath?: string;
  homeDirectory?: string;
  configDirectory?: string;
  dataDirectory?: string;
  cacheDirectory?: string;
  repositoryRoot: string;
  runtimeLabel: string;
  dataRoute: "external-opencode-zen" | "internal-opencode";
  timeoutMs: number;
  stdoutLimitBytes: number;
  stderrLimitBytes: number;
}

function sharedZenStateAcknowledged(profile: OpenCodeProfile): boolean {
  return profile !== "zen" ||
    process.env.AI_OFFICE_ZEN_SHARED_STATE_ACK === "synthetic-only";
}

function boundedTimeout(value: string | undefined): number {
  const parsed = Number(value ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(parsed)));
}

function configuredProfile(value: string | undefined): OpenCodeProfile {
  if (!value || value === "internal") return "internal";
  if (value === "zen") return value;
  throw new Error("AI_OFFICE_OPENCODE_PROFILE must be internal or zen");
}

function configuredModel(value: string | undefined, profile: OpenCodeProfile): string {
  const fallback = profile === "zen" ? DEFAULT_ZEN_MODEL : DEFAULT_INTERNAL_MODEL;
  const model = value || fallback;
  if (!MODEL_PATTERN.test(model)) throw new Error("AI_OFFICE_OPENCODE_MODEL is invalid");
  if (profile === "zen" && !FREE_ZEN_MODELS.has(model)) {
    throw new Error("The Zen POC only permits an allowlisted free model");
  }
  if (profile === "internal" && !model.startsWith("ollama/")) {
    throw new Error("The internal OpenCode profile only permits the local Ollama provider");
  }
  return model;
}

function zenHomeDirectory(profile: OpenCodeProfile, repositoryRoot: string): string | undefined {
  if (profile !== "zen") return undefined;
  const homeDirectory = process.env.AI_OFFICE_OPENCODE_HOME ?? process.env.HOME;
  if (!homeDirectory || !path.isAbsolute(homeDirectory)) {
    throw new Error("The Zen profile requires an absolute OpenCode home directory");
  }
  const normalized = path.normalize(homeDirectory);
  const relative = path.relative(repositoryRoot, normalized);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error("The OpenCode home directory must remain outside the repository");
  }
  return normalized;
}

function zenStateDirectory(
  configured: string | undefined,
  fallback: string | undefined,
  repositoryRoot: string,
): string | undefined {
  if (!fallback) return undefined;
  const directory = path.normalize(configured ?? fallback);
  if (!path.isAbsolute(directory)) throw new Error("OpenCode state paths must be absolute");
  const relative = path.relative(repositoryRoot, directory);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error("OpenCode state must remain outside the repository");
  }
  return directory;
}

export function getOpenCodeRuntimeConfig(): OpenCodeRuntimeConfig {
  const profile = configuredProfile(process.env.AI_OFFICE_OPENCODE_PROFILE);
  const repositoryRoot = path.resolve(process.cwd(), "poc", "simulator");
  const homeDirectory = zenHomeDirectory(profile, repositoryRoot);
  const configDirectory = zenStateDirectory(
    profile === "zen" ? process.env.XDG_CONFIG_HOME : undefined,
    homeDirectory ? path.join(homeDirectory, ".config") : undefined,
    repositoryRoot,
  );
  const dataDirectory = zenStateDirectory(
    profile === "zen" ? process.env.XDG_DATA_HOME : undefined,
    homeDirectory ? path.join(homeDirectory, ".local", "share") : undefined,
    repositoryRoot,
  );
  const cacheDirectory = zenStateDirectory(
    profile === "zen" ? process.env.XDG_CACHE_HOME : undefined,
    homeDirectory ? path.join(homeDirectory, ".cache") : undefined,
    repositoryRoot,
  );
  return {
    enabled:
      process.env.AI_OFFICE_LOCAL_RUNNER_ENABLED === "1" &&
      process.env.AI_OFFICE_AGENT_RUNTIME === "opencode" &&
      sharedZenStateAcknowledged(profile),
    profile,
    model: configuredModel(process.env.AI_OFFICE_OPENCODE_MODEL, profile),
    configPath: path.join(
      repositoryRoot,
      profile === "zen" ? "opencode.json" : "opencode.internal.json",
    ),
    modelCatalogPath: cacheDirectory
      ? path.join(cacheDirectory, "opencode", "models.json")
      : undefined,
    homeDirectory,
    configDirectory,
    dataDirectory,
    cacheDirectory,
    repositoryRoot,
    runtimeLabel: profile === "zen" ? "OpenCode Zen 합성 POC 런타임" : "사내 OpenCode 런타임",
    dataRoute: profile === "zen" ? "external-opencode-zen" : "internal-opencode",
    timeoutMs: boundedTimeout(process.env.AI_OFFICE_AGENT_TIMEOUT_MS),
    stdoutLimitBytes: 512 * 1_024,
    stderrLimitBytes: 64 * 1_024,
  };
}
