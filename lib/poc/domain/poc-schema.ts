import { z } from "zod";

export const POC_AGENT_ROLES = [
  "research",
  "framework",
  "estimate",
  "test",
  "git",
] as const;

export const POC_EXECUTION_MODES = ["auto", "demo"] as const;

const prohibitedControlCharacters =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u;
const probableSecret =
  /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|authorization\s*:\s*bearer\s+\S+|(?:api[_-]?key|password|secret|token)\s*[=:]\s*\S{8,})/iu;
const parentPathSegment = /(?:^|[^.])\.\.(?=[/\\]|$)/u;
const absoluteEvidencePath = /^(?:\/|[A-Za-z]:[\\/]|\\\\|file:\/\/)/iu;

export const createPocRunSchema = z
  .object({
    prompt: z
      .string()
      .trim()
      .min(8, "요청을 8자 이상 입력해 주세요.")
      .max(2_000, "POC 요청은 2,000자 이하여야 합니다.")
      .refine((value) => !prohibitedControlCharacters.test(value), {
        message: "제어 문자 또는 숨은 방향 제어 문자는 사용할 수 없습니다.",
      })
      .refine((value) => !probableSecret.test(value), {
        message: "비밀값으로 보이는 내용이 있습니다. 제거한 뒤 다시 시도해 주세요.",
      }),
    executionMode: z.enum(POC_EXECUTION_MODES).default("auto"),
  })
  .strict();

const evidenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .refine(
    (value) => !parentPathSegment.test(value),
    "Evidence path cannot traverse directories",
  )
  .refine(
    (value) => !absoluteEvidencePath.test(value),
    "Evidence path must be repository-relative",
  );

export const roleOutputSchema = z
  .object({
    role: z.enum(POC_AGENT_ROLES),
    summary: z.string().trim().min(1).max(1_000),
    findings: z.array(z.string().trim().min(1).max(600)).min(1).max(8),
    evidence: z.array(evidenceSchema).min(1).max(8),
  })
  .strict();

const workItemSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    owner: z.enum(POC_AGENT_ROLES),
    effort: z.enum(["XS", "S", "M", "L"]),
    dependencies: z.array(z.string().trim().min(1).max(160)).max(8),
  })
  .strict();

const issueDraftSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    body: z.string().trim().min(1).max(8_000),
    labels: z.array(z.string().trim().min(1).max(40)).min(1).max(8),
  })
  .strict();

export const pocBriefSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    objective: z.string().trim().min(1).max(1_000),
    scope: z.array(z.string().trim().min(1).max(600)).min(1).max(16),
    outOfScope: z.array(z.string().trim().min(1).max(600)).min(1).max(16),
    assumptions: z.array(z.string().trim().min(1).max(600)).min(1).max(16),
    workBreakdown: z.array(workItemSchema).min(1).max(16),
    acceptanceCriteria: z.array(z.string().trim().min(1).max(600)).min(1).max(16),
    testStrategy: z.array(z.string().trim().min(1).max(600)).min(1).max(16),
    risks: z.array(z.string().trim().min(1).max(600)).min(1).max(16),
    issueDraft: issueDraftSchema,
  })
  .strict();

export const pocModelOutputSchema = z
  .object({
    roleOutputs: z.array(roleOutputSchema).length(POC_AGENT_ROLES.length),
    brief: pocBriefSchema,
  })
  .strict()
  .superRefine((output, context) => {
    const roles = new Set(output.roleOutputs.map(({ role }) => role));
    for (const role of POC_AGENT_ROLES) {
      if (!roles.has(role)) {
        context.addIssue({
          code: "custom",
          message: `Missing role output: ${role}`,
          path: ["roleOutputs"],
        });
      }
    }
  });

export type CreatePocRunInput = z.infer<typeof createPocRunSchema>;
export type PocAgentRole = (typeof POC_AGENT_ROLES)[number];
export type PocModelOutput = z.infer<typeof pocModelOutputSchema>;
export type PocRoleOutput = z.infer<typeof roleOutputSchema>;
