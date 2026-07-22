import os from "node:os";
import path from "node:path";
import type { ClaudeProfile } from "../domain/job-types";

const SYNTHETIC_ALLOWED_ROOTS = [
  "poc/simulator/src",
  "poc/simulator/tests",
  "poc/simulator/config",
] as const;
const DEFAULT_ALLOWED_PATHS = SYNTHETIC_ALLOWED_ROOTS.join(",");
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_ACTIVE_JOBS = 50;
const DEFAULT_GITHUB_API_BASE = "https://github.samsungds.net/api/v3/repos/LOUVRE/nike_nvme";
const MODEL_PATTERN = /^[a-zA-Z0-9_.:/-]{1,160}$/u;
const RELATIVE_PATH_PATTERN = /^[a-zA-Z0-9._/-]{1,240}$/u;
const GIT_REF_PATTERN = /^[a-zA-Z0-9._/-]{1,160}$/u;
export const BUNDLED_EXECUTOR_VERSION = "bundled-synthetic-v2";
export const SYNTHETIC_TEST_COMMAND_ID = "python-unittest-isolated-v1";

export interface JobRuntimeConfig {
  dataDirectory: string;
  databasePath: string;
  worktreeDirectory: string;
  repositoryRoot: string;
  allowedPaths: string[];
  profile: ClaudeProfile;
  codingRequested: boolean;
  codingEnabled: boolean;
  configurationError?: string;
  claudeExecutable?: string;
  claudeModel: string;
  claudeTimeoutMs: number;
  claudeStdoutLimitBytes: number;
  claudeStderrLimitBytes: number;
  diffLimitBytes: number;
  testOutputLimitBytes: number;
  maxActiveJobs: number;
  pushEnabled: boolean;
  githubToken?: string;
  githubApiBase: string;
  githubBaseBranch: string;
  internalExecutionAcknowledged: boolean;
}

export function getJobRuntimeConfig(): JobRuntimeConfig {
  const profile = parseProfile(process.env.AI_OFFICE_CLAUDE_PROFILE);
  const dataDirectory = absoluteOrDefault(
    process.env.AI_OFFICE_DATA_DIR,
    path.join(os.homedir(), ".ai-office"),
  );
  const repositoryRoot = absoluteOrDefault(
    process.env.AI_OFFICE_CODING_REPO,
    process.cwd(),
  );
  const allowedPaths = parseAllowedPaths(
    process.env.AI_OFFICE_CODING_ALLOWED_PATHS ?? DEFAULT_ALLOWED_PATHS,
  );
  const internalExecutionAcknowledged =
    process.env.AI_OFFICE_INTERNAL_EXECUTION_ACK === "on-prem-only";
  const configurationError = policyError({
    profile,
    configuredProfile: process.env.AI_OFFICE_CLAUDE_PROFILE,
    dataDirectory,
    repositoryRoot,
    allowedPaths,
    internalExecutionAcknowledged,
  });
  const codingRequested = process.env.AI_OFFICE_CODING_ENABLED === "1";

  return {
    dataDirectory,
    databasePath: path.join(dataDirectory, "jobs.sqlite"),
    worktreeDirectory: path.join(dataDirectory, "worktrees"),
    repositoryRoot,
    allowedPaths,
    profile,
    codingRequested,
    codingEnabled: codingRequested && !configurationError,
    configurationError,
    claudeExecutable: parseAbsoluteExecutable(process.env.AI_OFFICE_CLAUDE_BIN),
    claudeModel: parseModel(process.env.AI_OFFICE_CLAUDE_MODEL),
    claudeTimeoutMs: boundedNumber(
      process.env.AI_OFFICE_CLAUDE_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      30_000,
      900_000,
    ),
    claudeStdoutLimitBytes: 768 * 1_024,
    claudeStderrLimitBytes: 128 * 1_024,
    diffLimitBytes: 768 * 1_024,
    testOutputLimitBytes: 256 * 1_024,
    maxActiveJobs: boundedNumber(
      process.env.AI_OFFICE_MAX_ACTIVE_JOBS,
      DEFAULT_MAX_ACTIVE_JOBS,
      1,
      500,
    ),
    pushEnabled: process.env.AI_OFFICE_GIT_PUSH_ENABLED === "1",
    githubToken: readSecret(process.env.AI_OFFICE_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN),
    githubApiBase: parseGithubApiBase(process.env.AI_OFFICE_GITHUB_API_BASE),
    githubBaseBranch: parseGitRef(process.env.AI_OFFICE_GITHUB_BASE_BRANCH),
    internalExecutionAcknowledged,
  };
}

export function canProxyJobsInCurrentDeployment(): boolean {
  if (process.env.AI_OFFICE_LOCAL_PROXY_ENABLED !== "1") return false;
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.AI_OFFICE_DEPLOYMENT_MODE === "internal" &&
    process.env.AI_OFFICE_INTERNAL_EXECUTION_ACK === "on-prem-only";
}

function parseProfile(value: string | undefined): ClaudeProfile {
  if (!value || value === "synthetic") return "synthetic";
  if (value === "internal") return "internal";
  return "synthetic";
}

function parseAllowedPaths(value: string): string[] {
  const paths = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  const normalized = paths.map(normalizeAllowedPath);
  return [...new Set(normalized.length > 0 ? normalized : SYNTHETIC_ALLOWED_ROOTS)];
}

function normalizeAllowedPath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/$/u, "");
  if (
    !RELATIVE_PATH_PATTERN.test(normalized) ||
    path.posix.isAbsolute(normalized) ||
    normalized.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    return "__invalid__";
  }
  return normalized;
}

function policyError(input: {
  profile: ClaudeProfile;
  configuredProfile: string | undefined;
  dataDirectory: string;
  repositoryRoot: string;
  allowedPaths: string[];
  internalExecutionAcknowledged: boolean;
}): string | undefined {
  if (
    input.configuredProfile !== undefined &&
    input.configuredProfile !== "synthetic" &&
    input.configuredProfile !== "internal"
  ) return "Claude profile must be synthetic or internal";
  if (input.allowedPaths.includes("__invalid__")) return "invalid allowed path";
  if (isFilesystemWithin(input.repositoryRoot, input.dataDirectory)) {
    return "AI Office data directory must be outside the target repository";
  }
  if (input.profile === "internal" && !input.internalExecutionAcknowledged) {
    return "internal execution acknowledgement is required";
  }
  if (input.profile === "internal") {
    return "bundled LocalJobExecutor is synthetic-only";
  }
  if (
    process.env.NODE_ENV === "production" &&
    (process.env.AI_OFFICE_DEPLOYMENT_MODE !== "internal" ||
      !input.internalExecutionAcknowledged)
  ) {
    return "production execution requires the internal on-prem acknowledgement";
  }
  if (input.profile !== "synthetic") return undefined;
  const currentRoot = path.resolve(process.cwd());
  if (path.resolve(input.repositoryRoot) !== currentRoot) {
    return "synthetic profile cannot target another repository";
  }
  if (!input.allowedPaths.every((entry) =>
    SYNTHETIC_ALLOWED_ROOTS.some((root) => isWithin(root, entry)))) {
    return "synthetic profile is restricted to simulator source, tests, and config";
  }
  return undefined;
}

function isWithin(parent: string, candidate: string): boolean {
  return candidate === parent || candidate.startsWith(`${parent}/`);
}

function isFilesystemWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function parseModel(value: string | undefined): string {
  return value && MODEL_PATTERN.test(value) ? value : "sonnet";
}

function parseGithubApiBase(value: string | undefined): string {
  const candidate = value ?? DEFAULT_GITHUB_API_BASE;
  try {
    const parsed = new URL(candidate);
    if (
      parsed.protocol !== "https:" || parsed.username || parsed.password ||
      parsed.search || parsed.hash || !/\/repos\/[^/]+\/[^/]+\/?$/u.test(parsed.pathname)
    ) return DEFAULT_GITHUB_API_BASE;
    return parsed.toString().replace(/\/$/u, "");
  } catch {
    return DEFAULT_GITHUB_API_BASE;
  }
}

function parseGitRef(value: string | undefined): string {
  if (!value || !GIT_REF_PATTERN.test(value) || value.includes("..") || value.startsWith("/")) {
    return "develop";
  }
  return value;
}

function readSecret(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length <= 8_192 ? trimmed : undefined;
}

function parseAbsoluteExecutable(value: string | undefined): string | undefined {
  return value && path.isAbsolute(value) ? path.normalize(value) : undefined;
}

function absoluteOrDefault(value: string | undefined, fallback: string): string {
  return value && path.isAbsolute(value) ? path.normalize(value) : path.resolve(fallback);
}

function boundedNumber(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(parsed)));
}
