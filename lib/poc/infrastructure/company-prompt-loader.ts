import path from "node:path";
import { constants as fsConstants } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SequentialAnalysisRole } from "../application/sequential-agent-runtime";
import { PocRunnerError } from "../domain/poc-errors";

const MAX_PROMPT_BYTES = 16 * 1_024;
const PROMPT_ROOT = fileURLToPath(new URL("../../../poc/company-prompts/", import.meta.url));
const PROMPT_FILES: Record<SequentialAnalysisRole, string> = {
  research: "research.md",
  framework: "framework.md",
  estimate: "estimate.md",
  test: "test.md",
  git: "git.md",
  orchestrator: "orchestrator.md",
};

export async function loadCompanyPrompt(role: SequentialAnalysisRole): Promise<string> {
  return loadTrustedCompanyPrompt(PROMPT_FILES[role]);
}

export async function loadCompanyOrbitPrompt(): Promise<string> {
  return loadTrustedCompanyPrompt("orbit.md");
}

async function loadTrustedCompanyPrompt(filename: string): Promise<string> {
  const { open } = await import("node:fs/promises");
  const promptPath = path.join(PROMPT_ROOT, filename);
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    file = await open(promptPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const metadata = await file.stat();
    const trustedOwner = metadata.uid === 0 ||
      typeof process.getuid !== "function" || metadata.uid === process.getuid();
    if (
      !metadata.isFile() ||
      !trustedOwner ||
      (metadata.mode & 0o022) !== 0 ||
      metadata.size < 1 ||
      metadata.size > MAX_PROMPT_BYTES
    ) {
      throw new PocRunnerError("unavailable");
    }
    const bytes = Buffer.alloc(metadata.size);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== metadata.size) throw new PocRunnerError("unavailable");
    const prompt = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
    if (!prompt) throw new PocRunnerError("unavailable");
    return prompt;
  } catch (error) {
    if (error instanceof PocRunnerError) throw error;
    throw new PocRunnerError("unavailable");
  } finally {
    await file?.close();
  }
}
