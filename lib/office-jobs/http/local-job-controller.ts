import { JobError } from "../domain/job-errors";
import {
  createJobSchema,
  jobActionSchema,
  listJobsQuerySchema,
  parseCorrelationId,
  parseIdempotencyKey,
} from "../domain/job-schema";
import type { JobService } from "../application/job-service";
import { jobErrorResponse, jobJsonResponse, parseJsonBody } from "./job-http";

export class LocalJobController {
  constructor(private readonly service: JobService) {}

  async create(request: Request): Promise<Response> {
    const correlationId = parseCorrelationId(request.headers.get("x-correlation-id"));
    try {
      const input = await parseJsonBody(request, createJobSchema);
      const result = await this.service.create(
        input,
        parseIdempotencyKey(request.headers.get("idempotency-key")),
      );
      return jobJsonResponse(result.job, result.duplicate ? 200 : 202, correlationId, {
        location: `/api/v1/jobs/${result.job.id}`,
        "x-idempotent-replay": result.duplicate ? "true" : "false",
      });
    } catch (error) {
      return jobErrorResponse(error, correlationId);
    }
  }

  list(request: Request): Response {
    const correlationId = parseCorrelationId(request.headers.get("x-correlation-id"));
    try {
      const url = new URL(request.url);
      const query = listJobsQuerySchema.parse(Object.fromEntries(url.searchParams.entries()));
      return jobJsonResponse(this.service.list(query), 200, correlationId);
    } catch (error) {
      return jobErrorResponse(toValidationError(error), correlationId);
    }
  }

  get(request: Request, jobId: string): Response {
    const correlationId = parseCorrelationId(request.headers.get("x-correlation-id"));
    try {
      return jobJsonResponse(this.service.get(requireJobId(jobId)), 200, correlationId);
    } catch (error) {
      return jobErrorResponse(error, correlationId);
    }
  }

  async action(request: Request, jobId: string): Promise<Response> {
    const correlationId = parseCorrelationId(request.headers.get("x-correlation-id"));
    try {
      const input = await parseJsonBody(request, jobActionSchema);
      const result = await this.service.act(
        requireJobId(jobId),
        input,
        parseIdempotencyKey(request.headers.get("idempotency-key")),
      );
      return jobJsonResponse(result.job, result.duplicate ? 200 : 202, correlationId, {
        "x-idempotent-replay": result.duplicate ? "true" : "false",
      });
    } catch (error) {
      return jobErrorResponse(error, correlationId);
    }
  }

  async capabilities(request: Request): Promise<Response> {
    const correlationId = parseCorrelationId(request.headers.get("x-correlation-id"));
    try {
      return jobJsonResponse(await this.service.capabilities(), 200, correlationId);
    } catch (error) {
      return jobErrorResponse(error, correlationId);
    }
  }
}

function requireJobId(jobId: string): string {
  if (/^[a-f0-9-]{36}$/u.test(jobId)) return jobId;
  throw new JobError("INVALID_JOB_ID", "업무 ID 형식을 확인해 주세요.", 400, false);
}

function toValidationError(error: unknown): JobError {
  if (error instanceof JobError) return error;
  return new JobError("INVALID_QUERY", "목록 조회 조건을 확인해 주세요.", 400, false);
}
