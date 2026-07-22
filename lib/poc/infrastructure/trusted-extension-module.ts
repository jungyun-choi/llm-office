import { createHash } from "node:crypto";
import { constants as fsConstants, type Stats } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PocRunnerError } from "../domain/poc-errors";

const MAX_EXTENSION_BYTES = 2 * 1_024 * 1_024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const STAGING_PREFIX = "ai-office-trusted-extension-";

interface TrustedExtensionOptions {
  modulePathEnvironment: string;
  moduleDigestEnvironment: string;
}

const importCache = new Map<string, Promise<Record<string, unknown>>>();

export async function importTrustedCompanyExtension(
  options: TrustedExtensionOptions,
): Promise<Record<string, unknown>> {
  const cacheKey = extensionCacheKey(options);
  const existing = importCache.get(cacheKey);
  if (existing) return existing;
  const pending = importTrustedCompanyExtensionOnce(options);
  importCache.set(cacheKey, pending);
  try {
    return await pending;
  } catch (error) {
    importCache.delete(cacheKey);
    if (error instanceof PocRunnerError) throw error;
    throw new PocRunnerError("unavailable");
  }
}

export async function hasTrustedCompanyExtension(
  options: TrustedExtensionOptions,
): Promise<boolean> {
  try {
    await validateTrustedCompanyExtension(options);
    return true;
  } catch {
    return false;
  }
}

async function validateTrustedCompanyExtension(
  options: TrustedExtensionOptions,
): Promise<Buffer> {
  const configuredRoot = process.env.AI_OFFICE_NIKE_ROOT;
  const configuredModule = process.env[options.modulePathEnvironment];
  if (
    !configuredRoot ||
    !configuredModule ||
    !path.isAbsolute(configuredRoot) ||
    !path.isAbsolute(configuredModule) ||
    path.extname(configuredModule) !== ".mjs"
  ) {
    throw new PocRunnerError("unavailable");
  }

  const { lstat, open, realpath } = await import("node:fs/promises");
  const normalizedRoot = path.normalize(configuredRoot);
  const root = await realpath(configuredRoot);
  const rootStat = await lstat(normalizedRoot);
  const normalizedModule = path.normalize(configuredModule);
  const modulePath = await realpath(normalizedModule);
  const linkStat = await lstat(normalizedModule);
  if (
    rootStat.isSymbolicLink() ||
    normalizedRoot !== root ||
    !rootStat.isDirectory() ||
    !trustedOwnerAndMode(rootStat) ||
    linkStat.isSymbolicLink() ||
    normalizedModule !== modulePath ||
    !isInside(root, modulePath)
  ) {
    throw new PocRunnerError("unavailable");
  }

  const file = await open(modulePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!isTrustedExtensionFile(stat)) throw new PocRunnerError("unavailable");
    const content = await file.readFile();
    const configuredDigest = process.env[options.moduleDigestEnvironment];
    if (
      !configuredDigest ||
      !SHA256_PATTERN.test(configuredDigest) ||
      sha256(content) !== configuredDigest
    ) {
      throw new PocRunnerError("unavailable");
    }
    return content;
  } finally {
    await file.close();
  }
}

function isTrustedExtensionFile(stat: Stats): boolean {
  return stat.isFile() && trustedOwnerAndMode(stat) &&
    stat.size > 0 && stat.size <= MAX_EXTENSION_BYTES;
}

function trustedOwnerAndMode(stat: Stats): boolean {
  const trustedOwner = typeof process.getuid !== "function" ||
    stat.uid === process.getuid() || stat.uid === 0;
  return trustedOwner && (stat.mode & 0o022) === 0;
}

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function importTrustedCompanyExtensionOnce(
  options: TrustedExtensionOptions,
): Promise<Record<string, unknown>> {
  const content = await validateTrustedCompanyExtension(options);
  const stage = await stageVerifiedExtension(content);
  try {
    const imported: unknown = await import(/* @vite-ignore */ pathToFileURL(stage.modulePath).href);
    if (!isRecord(imported)) throw new PocRunnerError("unavailable");
    return imported;
  } finally {
    await removeVerifiedExtensionStage(stage.root);
  }
}

function extensionCacheKey(options: TrustedExtensionOptions): string {
  return [
    options.modulePathEnvironment,
    process.env.AI_OFFICE_NIKE_ROOT ?? "",
    process.env[options.modulePathEnvironment] ?? "",
    process.env[options.moduleDigestEnvironment] ?? "",
  ].join("\u0000");
}

async function stageVerifiedExtension(
  content: Buffer,
): Promise<{ root: string; modulePath: string }> {
  const { chmod, mkdtemp, realpath, writeFile } = await import("node:fs/promises");
  const temporaryRoot = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(temporaryRoot, STAGING_PREFIX));
  if (path.dirname(root) !== temporaryRoot || !path.basename(root).startsWith(STAGING_PREFIX)) {
    throw new PocRunnerError("unavailable");
  }
  await chmod(root, 0o700);
  const modulePath = path.join(root, "extension.mjs");
  try {
    await writeFile(modulePath, content, { flag: "wx", mode: 0o600 });
    return { root, modulePath };
  } catch (error) {
    await removeVerifiedExtensionStage(root);
    throw error;
  }
}

async function removeVerifiedExtensionStage(root: string): Promise<void> {
  const { realpath, rm } = await import("node:fs/promises");
  const temporaryRoot = await realpath(os.tmpdir());
  if (
    path.dirname(root) === temporaryRoot &&
    path.basename(root).startsWith(STAGING_PREFIX)
  ) {
    await rm(root, { recursive: true, force: true });
  }
}
