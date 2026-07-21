import type { SimulatorSourceContext } from "../application/ports/simulator-source";
import { PocRunnerError } from "../domain/poc-errors";
import { SyntheticSimulatorSource } from "./synthetic-simulator-source";

export async function assertSyntheticSourceBoundary(
  source: SimulatorSourceContext,
): Promise<void> {
  const expected = await new SyntheticSimulatorSource().resolve();
  const matchesCanonicalSource =
    source.sourceId === expected.sourceId &&
    source.workingDirectory === expected.workingDirectory &&
    source.outputSchemaPath === expected.outputSchemaPath &&
    source.snapshotDigest === expected.snapshotDigest &&
    source.snapshot === expected.snapshot;
  if (!matchesCanonicalSource) throw new PocRunnerError("unavailable");
}
