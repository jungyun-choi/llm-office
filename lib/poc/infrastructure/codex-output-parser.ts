import { pocModelOutputSchema, type PocModelOutput } from "../domain/poc-schema";
import { PocRunnerError } from "../domain/poc-errors";
import { findLastValidJsonObject } from "./json-object-parser";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLines(stdout: string): JsonRecord[] {
  return stdout
    .split(/\r?\n/u)
    .map((line) => {
      try {
        const parsed: unknown = JSON.parse(line);
        return isRecord(parsed) ? parsed : undefined;
      } catch {
        return undefined;
      }
    })
    .filter((event): event is JsonRecord => Boolean(event));
}

function isFailure(event: JsonRecord): boolean {
  return event.type === "error" || event.type === "turn.failed";
}

function agentMessage(event: JsonRecord): string | undefined {
  if (event.type !== "item.completed" || !isRecord(event.item)) return undefined;
  if (event.item.type !== "agent_message") return undefined;
  return typeof event.item.text === "string" ? event.item.text : undefined;
}

export function parseCodexOutput(stdout: string): {
  output: PocModelOutput;
  modelTurns: number;
} {
  const events = parseLines(stdout);
  if (events.some(isFailure)) throw new PocRunnerError("model_error");
  const text = events.map(agentMessage).filter(Boolean).join("\n");
  const output = findLastValidJsonObject(text, (value) => pocModelOutputSchema.parse(value));
  if (!output) throw new PocRunnerError("invalid_output");
  const modelTurns = Math.max(
    1,
    events.filter((event) => event.type === "turn.completed").length,
  );
  return { output, modelTurns };
}
