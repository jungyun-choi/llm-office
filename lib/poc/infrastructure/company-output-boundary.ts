import { PocRunnerError } from "../domain/poc-errors";
import type { PocModelOutput } from "../domain/poc-schema";

const PROBABLE_SECRET =
  /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|authorization\s*:\s*bearer\s+\S+|\bAKIA[0-9A-Z]{16}\b|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}\b|(?:api[_-]?key|password|secret|token)\s*[=:]\s*\S{8,})/iu;
const UNIX_ABSOLUTE_PATH =
  /(?:^|[\s("'`])\/(?!\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*/u;
const WINDOWS_ABSOLUTE_PATH =
  /(?:^|[\s("'`])(?:[A-Za-z]:[\\/]|\\\\[A-Za-z0-9._$-]+\\)[^\s"'`<>|]+/u;
const FILE_URL = /\bfile:\/\/[^\s"'`]+/iu;
const STACK_TRACE =
  /(?:^|\n)\s*at\s+(?:async\s+)?(?:[^\n(]+\s+)?\(?[^()\n]+:\d+:\d+\)?/u;
const PROHIBITED_CONTROL =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u;

/**
 * Company model output is persisted in SQLite and returned by the Job API.
 * Reject it as a whole if any nested string resembles a credential, host path,
 * stack trace, or hidden control sequence. The caller maps this to the public
 * invalid-output error without preserving the rejected value.
 */
export function assertSafeCompanyModelOutput(output: PocModelOutput): void {
  assertSafeCompanyOutputValue(output);
}

export function assertSafeCompanyOutputValue(output: unknown): void {
  for (const value of nestedStrings(output)) {
    if (!isSafeCompanyOutputText(value)) throw new PocRunnerError("invalid_output");
  }
}

export function isSafeCompanyOutputText(value: string): boolean {
  return !PROHIBITED_CONTROL.test(value) &&
    !PROBABLE_SECRET.test(value) &&
    !UNIX_ABSOLUTE_PATH.test(value) &&
    !WINDOWS_ABSOLUTE_PATH.test(value) &&
    !FILE_URL.test(value) &&
    !STACK_TRACE.test(value);
}

function* nestedStrings(value: unknown): Generator<string> {
  if (typeof value === "string") {
    yield value;
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) yield* nestedStrings(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const item of Object.values(value as Record<string, unknown>)) {
    yield* nestedStrings(item);
  }
}
