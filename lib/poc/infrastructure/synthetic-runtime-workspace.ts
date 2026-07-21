import path from "node:path";
import type { FileHandle } from "node:fs/promises";
import type { OpenCodeRuntimeConfig } from "./opencode-runtime-config";
import { PocRunnerError } from "../domain/poc-errors";

const SUPPORT_FILES = [
  "AGENTS.md",
  "contracts/poc-output.schema.json",
  "prompts/orchestrator.md",
  "prompts/research.md",
  "prompts/framework.md",
  "prompts/estimate.md",
  "prompts/test.md",
  "prompts/git.md",
] as const;
const STAGED_POLICY_FILES = [
  "AGENTS.md",
  "contracts/poc-output.schema.json",
  "opencode.json",
  "prompts/orchestrator.md",
  "prompts/research.md",
  "prompts/framework.md",
  "prompts/estimate.md",
  "prompts/test.md",
  "prompts/git.md",
] as const;
const EXPECTED_ZEN_POLICY_DIGEST =
  "c7a12f25fe61962e10956d0f0890ad606898cb86bbccf3ddc82a5be8831b73f4";
const MAX_POLICY_FILE_BYTES = 64 * 1_024;

export async function stageSyntheticRuntimeWorkspace(
  runtimeDirectory: string,
  config: OpenCodeRuntimeConfig,
): Promise<string> {
  const { mkdir } = await import("node:fs/promises");
  const workspace = path.join(runtimeDirectory, "synthetic-flashsim");
  await mkdir(workspace, { mode: 0o700 });
  for (const relativePath of SUPPORT_FILES) {
    await stageFile(config.repositoryRoot, relativePath, workspace, relativePath);
  }
  await stageAbsoluteFile(config.configPath, workspace, "opencode.json");
  if (config.profile === "zen") await assertStagedZenPolicy(workspace);
  return workspace;
}

async function stageFile(
  sourceRoot: string,
  sourceRelativePath: string,
  targetRoot: string,
  targetRelativePath: string,
): Promise<void> {
  await stageAbsoluteFile(
    path.join(sourceRoot, sourceRelativePath),
    targetRoot,
    targetRelativePath,
  );
}

async function stageAbsoluteFile(
  sourcePath: string,
  targetRoot: string,
  targetRelativePath: string,
): Promise<void> {
  const { constants } = await import("node:fs");
  const { mkdir, open, writeFile } = await import("node:fs/promises");
  let source: FileHandle | undefined;
  try {
    source = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await source.stat();
    if (!stat.isFile() || stat.size > MAX_POLICY_FILE_BYTES) throw unavailable();
    const targetPath = path.join(targetRoot, targetRelativePath);
    await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
    await writeFile(targetPath, await source.readFile(), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error instanceof PocRunnerError) throw error;
    throw unavailable();
  } finally {
    await source?.close();
  }
}

async function assertStagedZenPolicy(workspace: string): Promise<void> {
  const { readFile } = await import("node:fs/promises");
  const sections: string[] = [];
  for (const relativePath of STAGED_POLICY_FILES) {
    const content = await readFile(path.join(workspace, relativePath), "utf8");
    sections.push(`--- ${relativePath} ---\n${content}`);
  }
  if (await digest(sections.join("\n\n")) !== EXPECTED_ZEN_POLICY_DIGEST) {
    throw unavailable();
  }
}

async function digest(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function unavailable(): PocRunnerError {
  return new PocRunnerError("unavailable");
}
