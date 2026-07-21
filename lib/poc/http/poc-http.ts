import { ZodError } from "zod";
import { createPocRunSchema, type CreatePocRunInput } from "../domain/poc-schema";
import { PocError } from "../domain/poc-errors";

const MAX_BODY_BYTES = 8 * 1_024;
const ID_KEY_PATTERN = /^[a-zA-Z0-9._:-]{8,128}$/u;

export interface PocRequestContext {
  input: CreatePocRunInput;
  correlationId: string;
  idempotencyKey: string;
}

export async function parsePocRequest(request: Request): Promise<PocRequestContext> {
  requireJsonContentType(request);
  const body = await readLimitedBody(request);
  try {
    return {
      input: createPocRunSchema.parse(JSON.parse(body)),
      correlationId: safeHeaderId(request.headers.get("x-correlation-id")),
      idempotencyKey: safeHeaderId(request.headers.get("idempotency-key")),
    };
  } catch (error) {
    if (error instanceof PocError) throw error;
    const details = error instanceof ZodError ? error.issues.map(({ path, message }) => ({ path, message })) : undefined;
    throw new PocError("INVALID_REQUEST", "요청 JSON을 확인해 주세요.", 400, false, details);
  }
}

function requireJsonContentType(request: Request): void {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;|$)/iu.test(contentType)) {
    throw new PocError("UNSUPPORTED_MEDIA_TYPE", "application/json만 지원합니다.", 415, false);
  }
}

async function readLimitedBody(request: Request): Promise<string> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) throw payloadTooLarge();
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw payloadTooLarge();
      }
      body += decoder.decode(value, { stream: true });
    }
    return body + decoder.decode();
  } catch (error) {
    if (error instanceof PocError) throw error;
    throw new PocError("INVALID_ENCODING", "UTF-8 JSON만 지원합니다.", 400, false);
  }
}

function payloadTooLarge(): PocError {
  return new PocError("PAYLOAD_TOO_LARGE", "요청 본문은 8 KiB 이하여야 합니다.", 413, false);
}

function safeHeaderId(value: string | null): string {
  if (value && ID_KEY_PATTERN.test(value)) return value;
  return crypto.randomUUID();
}

export function jsonResponse(
  value: unknown,
  status: number,
  correlationId: string,
  extraHeaders?: HeadersInit,
): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
      "x-correlation-id": correlationId,
      ...extraHeaders,
    },
  });
}

export function errorResponse(error: unknown, correlationId = crypto.randomUUID()): Response {
  const known = error instanceof PocError ? error : undefined;
  const status = known?.status ?? 500;
  return jsonResponse(
    {
      error: {
        code: known?.code ?? "INTERNAL_ERROR",
        message: known?.message ?? "요청을 처리하지 못했습니다.",
        retryable: known?.retryable ?? false,
        correlationId,
        ...(known?.details ? { details: known.details } : {}),
      },
    },
    status,
    correlationId,
    status === 429 ? { "retry-after": "5" } : undefined,
  );
}
