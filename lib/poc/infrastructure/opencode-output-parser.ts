import { pocModelOutputSchema, type PocModelOutput } from "../domain/poc-schema";
import { PocRunnerError } from "../domain/poc-errors";
import { findLastValidJsonObject } from "./json-object-parser";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEvent(line: string): JsonRecord | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isErrorEvent(event: JsonRecord): boolean {
  if (event.type === "error") {
    return true;
  }
  return isRecord(event.part) && event.part.type === "error";
}

function textFromEvent(event: JsonRecord): string | undefined {
  if (event.type !== "text" || !isRecord(event.part)) {
    return undefined;
  }
  return typeof event.part.text === "string" ? event.part.text : undefined;
}

function collectModelText(stdout: string): string {
  const events = stdout.split(/\r?\n/u).map(parseEvent).filter(Boolean) as JsonRecord[];
  if (events.some(isErrorEvent)) {
    throw new PocRunnerError("model_error");
  }

  const text = events.map(textFromEvent).filter(Boolean).join("");
  if (!text) {
    throw new PocRunnerError("invalid_output");
  }
  return text;
}

export function parseOpenCodeOutput(stdout: string): PocModelOutput {
  const modelText = collectModelText(stdout);
  const output = findLastValidJsonObject(modelText, (value) =>
    pocModelOutputSchema.parse(value),
  );
  if (!output) {
    throw new PocRunnerError("invalid_output");
  }
  return output;
}
