import { z } from "zod";
import { createPocRunSchema } from "../../poc/domain/poc-schema";

const idempotencyPattern = /^[a-zA-Z0-9._:-]{8,128}$/u;
const digestPattern = /^[a-f0-9]{64}$/u;
const jobIdPattern = /^[a-f0-9-]{36}$/u;
const probableSecret =
  /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|authorization\s*:\s*bearer\s+\S+|(?:api[_-]?key|password|secret|token)\s*[=:]\s*\S{8,})/iu;

const conciseBriefText = z
  .string()
  .trim()
  .min(1)
  .max(700)
  .refine((value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u.test(value), {
    message: "브리프에 제어 문자를 사용할 수 없습니다.",
  })
  .refine((value) => !probableSecret.test(value), {
    message: "브리프에 비밀값으로 보이는 내용이 있습니다.",
  });

export const orbitIntakeBriefSchema = z.object({
  version: z.literal("1"),
  objective: conciseBriefText.max(500),
  currentAndExpectedBehavior: conciseBriefText.optional(),
  repositoryContext: conciseBriefText.optional(),
  acceptanceAndTests: conciseBriefText.optional(),
  assumptions: z.array(conciseBriefText.max(240)).max(4),
}).strict();

export const createJobSchema = createPocRunSchema.extend({
  intakeBrief: orbitIntakeBriefSchema.optional(),
}).strict();

const actionBase = z.object({
  expectedVersion: z.number().int().min(1),
});

const humanDecisionText = z
  .string()
  .trim()
  .min(1)
  .max(4_000)
  .refine((value) => !probableSecret.test(value), {
    message: "답변에 비밀값으로 보이는 내용이 있습니다.",
  });

export const jobActionSchema = z.discriminatedUnion("action", [
  actionBase.extend({
    action: z.literal("approve_coding"),
    artifactDigest: z.string().regex(digestPattern),
    feedback: z.string().trim().min(1).max(4_000).optional(),
  }).strict(),
  actionBase.extend({
    action: z.literal("publish_changes"),
    artifactDigest: z.string().regex(digestPattern),
    mode: z.enum(["commit", "commit_and_push"]),
  }).strict(),
  actionBase.extend({
    action: z.literal("request_changes"),
    feedback: humanDecisionText,
  }).strict(),
  actionBase.extend({
    action: z.literal("request_reanalysis"),
    analysisRunId: z.string().trim().min(1).max(160),
    feedback: humanDecisionText,
  }).strict(),
  actionBase.extend({
    action: z.literal("answer_development_question"),
    questionId: z.string().uuid(),
    feedback: humanDecisionText,
  }).strict(),
  actionBase.extend({
    action: z.literal("merge_pr"),
    artifactDigest: z.string().regex(digestPattern),
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
