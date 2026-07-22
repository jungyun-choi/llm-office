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
  if (isRecord(event.part) && typeof event.part.text === "string") {
    if (event.type === "text" || event.part.type === "text") return event.part.text;
  }
  if (event.type === "text" && typeof event.text === "string") return event.text;
  return undefined;
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

function normalizeStructuredRisk(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const keys = Object.keys(value);
  if (
    keys.length !== 2
    || !keys.includes("risk")
    || !keys.includes("mitigation")
    || typeof value.risk !== "string"
    || typeof value.mitigation !== "string"
  ) {
    return value;
  }

  const risk = value.risk
    .replace(/\s*;\s*mitigation\s*:.*$/iu, "")
    .trim();
  const mitigation = value.mitigation.trim();
  if (!risk || !mitigation) {
    return value;
  }

  const separator = /[.!?]$/u.test(risk) ? "" : ".";
  return `${risk}${separator} Mitigation: ${mitigation}`;
}

function normalizeOpenCodeOutput(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.brief) || !Array.isArray(value.brief.risks)) {
    return value;
  }

  return {
    ...value,
    brief: {
      ...value.brief,
      risks: value.brief.risks.map(normalizeStructuredRisk),
    },
  };
}

export function parseOpenCodeOutput(stdout: string): PocModelOutput {
  const parsed = pocModelOutputSchema.safeParse(
    normalizeOpenCodeOutput(parseOpenCodeEventValue(stdout)),
  );
  if (!parsed.success) throw new PocRunnerError("invalid_output");
  return parsed.data;
}

/** Parse OpenCode JSONL events without imposing a turn-specific output schema. */
export function parseOpenCodeEventValue(stdout: string): unknown {
  const modelText = collectModelText(stdout);
  const output = findLastValidJsonObject(modelText, (value) => value);
  if (output === undefined) throw new PocRunnerError("invalid_output");
  return output;
}
