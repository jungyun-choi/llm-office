import { z } from "zod";
import { createPocRunSchema } from "../../poc/domain/poc-schema";

const idempotencyPattern = /^[a-zA-Z0-9._:-]{8,128}$/u;
const digestPattern = /^[a-f0-9]{64}$/u;
const jobIdPattern = /^[a-f0-9-]{36}$/u;

export const createJobSchema = createPocRunSchema;

const actionBase = z.object({
  expectedVersion: z.number().int().min(1),
});

export const jobActionSchema = z.discriminatedUnion("action", [
  actionBase.extend({
    action: z.literal("approve_coding"),
    artifactDigest: z.string().regex(digestPattern),
  }).strict(),
  actionBase.extend({
    action: z.literal("publish_changes"),
    artifactDigest: z.string().regex(digestPattern),
    mode: z.enum(["commit", "commit_and_push"]),
  }).strict(),
  actionBase.extend({ action: z.literal("cancel") }).strict(),
  actionBase.extend({ action: z.literal("retry") }).strict(),
]);

export const listJobsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
}).strict();

export type CreateJobInput = z.infer<typeof createJobSchema>;
export type JobActionInput = z.infer<typeof jobActionSchema>;

export function parseIdempotencyKey(value: string | null): string {
  return value && idempotencyPattern.test(value) ? value : crypto.randomUUID();
}

export function parseCorrelationId(value: string | null): string {
  return value && idempotencyPattern.test(value) ? value : crypto.randomUUID();
}

export function parseJobId(value: string): string {
  if (!jobIdPattern.test(value)) throw new Error("invalid job id");
  return value;
}
