import { ZodError, type ZodType } from "zod";
import { JobError } from "../domain/job-errors";

const MAX_BODY_BYTES = 8 * 1_024;

export async function parseJsonBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  requireJsonContentType(request);
  const body = await readLimitedBody(request);
  try {
    return schema.parse(JSON.parse(body));
  } catch (error) {
    if (error instanceof JobError) throw error;
    const details = error instanceof ZodError
      ? error.issues.map(({ path, message }) => ({ path, message }))
      : undefined;
    throw new JobError("INVALID_REQUEST", "요청 JSON을 확인해 주세요.", 400, false, details);
  }
}

export function jobJsonResponse(
  value: unknown,
  status: number,
  correlationId: string,
  headers?: HeadersInit,
): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
      "x-correlation-id": correlationId,
      ...headers,
    },
  });
}

export function jobErrorResponse(
  error: unknown,
  correlationId = crypto.randomUUID(),
): Response {
  const known = error instanceof JobError ? error : undefined;
  const status = known?.status ?? 500;
  return jobJsonResponse(
    {
      error: {
        code: known?.code ?? "INTERNAL_ERROR",
        message: known?.message ?? "요청을 처리하지 못했습니다.",
        retryable: known?.retryable ?? false,
        correlationId,
        ...(known?.details ? { details: sanitizeDetails(known.details) } : {}),
      },
    },
    status,
    correlationId,
    status === 429 ? { "retry-after": "5" } : undefined,
  );
}

function requireJsonContentType(request: Request): void {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;|$)/iu.test(contentType)) {
    throw new JobError("UNSUPPORTED_MEDIA_TYPE", "application/json만 지원합니다.", 415, false);
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
    if (error instanceof JobError) throw error;
    throw new JobError("INVALID_ENCODING", "UTF-8 JSON만 지원합니다.", 400, false);
  }
}

function payloadTooLarge(): JobError {
  return new JobError("PAYLOAD_TOO_LARGE", "요청 본문은 8 KiB 이하여야 합니다.", 413, false);
}

function sanitizeDetails(details: unknown): unknown {
  if (!Array.isArray(details)) return undefined;
  return details.slice(0, 20).map((detail) => {
    if (!detail || typeof detail !== "object") return { message: "invalid input" };
    const candidate = detail as { path?: unknown; message?: unknown };
    return {
      path: Array.isArray(candidate.path)
        ? candidate.path.filter((item) => typeof item === "string" || typeof item === "number").slice(0, 8)
        : [],
      message: typeof candidate.message === "string"
        ? candidate.message.replace(/[\u0000-\u001F\u007F]/gu, "").slice(0, 240)
        : "invalid input",
    };
  });
}
