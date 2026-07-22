import { createHash } from "node:crypto";
import path from "node:path";

import type {
  SimulatorSource,
  SimulatorSourceContext,
  SimulatorSourceRequest,
} from "../application/ports/simulator-source";
import { PocRunnerError } from "../domain/poc-errors";
import {
  hasTrustedCompanyExtension,
  importTrustedCompanyExtension,
} from "./trusted-extension-module";

const SOURCE_EXTENSION = {
  modulePathEnvironment: "AI_OFFICE_EXTENSION_MODULE",
  moduleDigestEnvironment: "AI_OFFICE_EXTENSION_MODULE_SHA256",
} as const;
const DEFAULT_MAX_SNAPSHOT_BYTES = 4 * 1_024 * 1_024;
const MAX_SNAPSHOT_BYTES = 16 * 1_024 * 1_024;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const ID_PATTERN = /^[a-zA-Z0-9._:-]{1,160}$/u;
const SOURCE_CONTRACT_VERSION = "ai-office-company-source-v1";
const TRUSTED_PROXY_SECRET_PATTERN = /^[A-Za-z0-9_-]{43,128}$/u;
const TRUSTED_USER_PATTERN = /^[a-zA-Z0-9@._+-]{1,128}$/u;
const PROBABLE_SOURCE_SECRET =
  /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|authorization\s*:\s*bearer\s+\S+|\bAKIA[0-9A-Z]{16}\b|(?:api[_-]?key|password|secret|token)\s*[=:]\s*\S{8,})/iu;
const PROHIBITED_SOURCE_CONTROL =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u;

type SourceFactory = () => SimulatorSource | Promise<SimulatorSource>;

export async function loadExtensionSimulatorSource(): Promise<SimulatorSource> {
  try {
    const imported = await importTrustedCompanyExtension(SOURCE_EXTENSION);
    if (imported.contractVersion !== SOURCE_CONTRACT_VERSION) {
      throw new PocRunnerError("unavailable");
    }
    const factory = imported.createSimulatorSource;
    if (typeof factory !== "function") throw new PocRunnerError("unavailable");
    const source = await (factory as SourceFactory)();
    if (!isSimulatorSource(source)) throw new PocRunnerError("unavailable");
    return new ValidatedCompanySource(source);
  } catch (error) {
    if (error instanceof PocRunnerError) throw error;
    throw new PocRunnerError("unavailable");
  }
}

export async function hasConfiguredExtensionSource(): Promise<boolean> {
  if (!(await hasTrustedCompanyExtension(SOURCE_EXTENSION))) return false;
  try {
    const imported = await importTrustedCompanyExtension(SOURCE_EXTENSION);
    return imported.contractVersion === SOURCE_CONTRACT_VERSION &&
      typeof imported.createSimulatorSource === "function";
  } catch {
    return false;
  }
}

export function isCompanyDataAccessAcknowledged(): boolean {
  return process.env.AI_OFFICE_COMPANY_DATA_ACK === "protected-internal-only" &&
    process.env.AI_OFFICE_COMPANY_ACCESS_CONTROL_ACK === "authenticated-private-server" &&
    TRUSTED_PROXY_SECRET_PATTERN.test(process.env.AI_OFFICE_TRUSTED_PROXY_SECRET ?? "") &&
    TRUSTED_USER_PATTERN.test(process.env.AI_OFFICE_COMPANY_ALLOWED_USER ?? "");
}

class ValidatedCompanySource implements SimulatorSource {
  readonly id: string;

  constructor(private readonly source: SimulatorSource) {
    this.id = source.id;
  }

  async resolve(request?: SimulatorSourceRequest): Promise<SimulatorSourceContext> {
    try {
      const context = await this.source.resolve(request);
      return await validateSourceContext(this.id, context);
    } catch (error) {
      if (error instanceof PocRunnerError) throw error;
      throw new PocRunnerError("unavailable");
    }
  }
}

async function validateSourceContext(
  sourceId: string,
  context: SimulatorSourceContext,
): Promise<SimulatorSourceContext> {
  const configuredRoot = process.env.AI_OFFICE_NIKE_ROOT;
  if (!configuredRoot || !path.isAbsolute(configuredRoot)) {
    throw new PocRunnerError("unavailable");
  }
  if (
    !ID_PATTERN.test(sourceId) ||
    sourceId === "synthetic-flashsim" ||
    context.sourceId !== sourceId ||
    !safeText(context.displayName, 160) ||
    !safeText(context.policyNotice, 1_000) ||
    !path.isAbsolute(context.workingDirectory) ||
    !path.isAbsolute(context.outputSchemaPath) ||
    typeof context.snapshot !== "string" ||
    !context.snapshot ||
    !DIGEST_PATTERN.test(context.snapshotDigest)
  ) {
    throw new PocRunnerError("unavailable");
  }

  const { lstat, realpath } = await import("node:fs/promises");
  const configuredRootStat = await lstat(path.normalize(configuredRoot));
  const workingDirectoryStat = await lstat(path.normalize(context.workingDirectory));
  const configuredSchemaStat = await lstat(path.normalize(context.outputSchemaPath));
  const root = await realpath(configuredRoot);
  const workingDirectory = await realpath(context.workingDirectory);
  const outputSchemaPath = await realpath(context.outputSchemaPath);
  const schemaStat = await lstat(outputSchemaPath);
  if (
    configuredRootStat.isSymbolicLink() ||
    path.normalize(configuredRoot) !== root ||
    !configuredRootStat.isDirectory() ||
    !trustedOwnerAndMode(configuredRootStat) ||
    workingDirectoryStat.isSymbolicLink() ||
    path.normalize(context.workingDirectory) !== workingDirectory ||
    !workingDirectoryStat.isDirectory() ||
    !trustedOwnerAndMode(workingDirectoryStat) ||
    configuredSchemaStat.isSymbolicLink() ||
    path.normalize(context.outputSchemaPath) !== outputSchemaPath ||
    !isInside(root, workingDirectory) ||
    !isInside(root, outputSchemaPath) ||
    !schemaStat.isFile() ||
    !trustedOwnerAndMode(schemaStat)
  ) {
    throw new PocRunnerError("unavailable");
  }

  const snapshotBytes = Buffer.byteLength(context.snapshot, "utf8");
  if (
    snapshotBytes > configuredSnapshotLimit() ||
    PROBABLE_SOURCE_SECRET.test(context.snapshot) ||
    PROHIBITED_SOURCE_CONTROL.test(context.snapshot)
  ) {
    throw new PocRunnerError("unavailable");
  }
  const observedDigest = createHash("sha256").update(context.snapshot, "utf8").digest("hex");
  if (observedDigest !== context.snapshotDigest) throw new PocRunnerError("unavailable");

  return {
    ...context,
    workingDirectory,
    outputSchemaPath,
  };
}

function configuredSnapshotLimit(): number {
  const value = Number(process.env.AI_OFFICE_COMPANY_SNAPSHOT_MAX_BYTES ?? DEFAULT_MAX_SNAPSHOT_BYTES);
  if (!Number.isFinite(value)) return DEFAULT_MAX_SNAPSHOT_BYTES;
  return Math.min(MAX_SNAPSHOT_BYTES, Math.max(64 * 1_024, Math.round(value)));
}

function isSimulatorSource(value: unknown): value is SimulatorSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<SimulatorSource>;
  return typeof candidate.id === "string" && typeof candidate.resolve === "function";
}

function safeText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength &&
    !/[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u.test(value);
}

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function trustedOwnerAndMode(stat: { uid: number; mode: number }): boolean {
  const trustedOwner = typeof process.getuid !== "function" ||
    stat.uid === process.getuid() || stat.uid === 0;
  return trustedOwner && (stat.mode & 0o022) === 0;
}
