import path from "node:path";
import type {
  SimulatorSource,
  SimulatorSourceContext,
} from "../application/ports/simulator-source";
import { PocRunnerError } from "../domain/poc-errors";

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export class InternalRepoSource implements SimulatorSource {
  readonly id = "internal-repository";

  constructor(
    private readonly configuredRoot: string,
    private readonly allowedRoots: string[],
    private readonly outputSchemaPath: string,
    private readonly snapshotFactory: (root: string) => Promise<{
      content: string;
      digest: string;
    }>,
  ) {}

  async resolve(): Promise<SimulatorSourceContext> {
    const { realpath } = await import("node:fs/promises");
    const workingDirectory = await realpath(this.configuredRoot);
    const allowlist = await Promise.all(this.allowedRoots.map((root) => realpath(root)));
    const schemaPath = await realpath(this.outputSchemaPath);

    if (!allowlist.some((root) => isInside(root, workingDirectory))) {
      throw new PocRunnerError("unavailable");
    }

    const snapshot = await this.snapshotFactory(workingDirectory);

    return {
      sourceId: this.id,
      displayName: path.basename(workingDirectory),
      workingDirectory,
      outputSchemaPath: schemaPath,
      policyNotice: "승인된 사내 저장소 allowlist와 사내 모델 정책을 따라야 합니다.",
      snapshot: snapshot.content,
      snapshotDigest: snapshot.digest,
    };
  }
}
