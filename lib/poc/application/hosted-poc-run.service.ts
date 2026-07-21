import type { CreatePocRunInput } from "../domain/poc-schema";
import type { PocRunResult } from "../domain/poc-types";
import { runDemoPoc } from "../infrastructure/demo-poc-runner";
import { buildPocRunResult } from "./poc-result-builder";

export async function runHostedPoc(input: CreatePocRunInput): Promise<PocRunResult> {
  const requestedAt = new Date().toISOString();
  const runner = runDemoPoc(input.prompt, "disabled");
  return buildPocRunResult(runner, requestedAt, new Date().toISOString());
}
