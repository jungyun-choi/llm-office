import path from "node:path";
import type {
  SimulatorSource,
  SimulatorSourceContext,
} from "../application/ports/simulator-source";
import { PocRunnerError } from "../domain/poc-errors";

const SNAPSHOT_FILES = [
  "README.md",
  "wiki/architecture.md",
  "wiki/conventions.md",
  "wiki/debugging-history.md",
  "config/device.json",
  "src/simulator.py",
  "tests/test_simulator.py",
] as const;
const RUNTIME_POLICY_FILES = [
  "AGENTS.md",
  "contracts/poc-output.schema.json",
  "opencode.json",
  "opencode.internal.json",
  "prompts/orchestrator.md",
  "prompts/research.md",
  "prompts/framework.md",
  "prompts/estimate.md",
  "prompts/test.md",
  "prompts/git.md",
] as const;
const MAX_SNAPSHOT_BYTES = 64 * 1_024;
const MAX_POLICY_BYTES = 32 * 1_024;
const EXPECTED_SNAPSHOT_DIGEST =
  "706661bd0c6e10a5816b2faefcfcc63b7005382d380254fee8cb0cf5c1042f56";
const EXPECTED_POLICY_DIGEST =
  "9169a0a1e0b7411c263cc0121a321ac42e3972ac9645948511900cdb0b775381";

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export class SyntheticSimulatorSource implements SimulatorSource {
  readonly id = "synthetic-flashsim";

  async resolve(): Promise<SimulatorSourceContext> {
    const { realpath } = await import("node:fs/promises");
    const workspaceRoot = await realpath(process.cwd());
    const expectedRoot = path.join(workspaceRoot, "poc", "simulator");
    const workingDirectory = await realpath(expectedRoot);
    const outputSchemaPath = await realpath(
      path.join(workingDirectory, "contracts", "poc-output.schema.json"),
    );

    if (!isInside(expectedRoot, workingDirectory) || !isInside(workingDirectory, outputSchemaPath)) {
      throw new PocRunnerError("unavailable");
    }

    await assertRuntimePolicyAssets(workingDirectory);
    const snapshot = await createSnapshot(workingDirectory);
    const snapshotDigest = await digest(snapshot);
    if (snapshotDigest !== EXPECTED_SNAPSHOT_DIGEST) {
      throw new PocRunnerError("unavailable");
    }

    return {
      sourceId: this.id,
      displayName: "Synthetic FlashSim",
      workingDirectory,
      outputSchemaPath,
      policyNotice: "합성 저장소만 읽을 수 있으며 코드 수정과 외부 등록은 금지됩니다.",
      snapshot,
      snapshotDigest,
    };
  }
}

async function createSnapshot(workingDirectory: string): Promise<string> {
  return createFileBundle(workingDirectory, SNAPSHOT_FILES, MAX_SNAPSHOT_BYTES);
}

async function assertRuntimePolicyAssets(workingDirectory: string): Promise<void> {
  const bundle = await createFileBundle(
    workingDirectory,
    RUNTIME_POLICY_FILES,
    MAX_POLICY_BYTES,
  );
  if (await digest(bundle) !== EXPECTED_POLICY_DIGEST) {
    throw new PocRunnerError("unavailable");
  }
}

async function createFileBundle(
  workingDirectory: string,
  relativePaths: readonly string[],
  maxBytes: number,
): Promise<string> {
  const { lstat, readFile, realpath } = await import("node:fs/promises");
  const sections: string[] = [];
  let totalBytes = 0;

  for (const relativePath of relativePaths) {
    const candidate = path.join(workingDirectory, relativePath);
    const resolved = await realpath(candidate);
    const fileStat = await lstat(candidate);
    if (!isInside(workingDirectory, resolved) || fileStat.isSymbolicLink()) {
      throw new PocRunnerError("unavailable");
    }
    const content = await readFile(resolved, "utf8");
    totalBytes += Buffer.byteLength(content, "utf8");
    if (totalBytes > maxBytes) throw new PocRunnerError("unavailable");
    sections.push(`--- ${relativePath} ---\n${content}`);
  }
  return sections.join("\n\n");
}

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
