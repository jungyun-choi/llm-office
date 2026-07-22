import { z } from "zod";

const probableSecret =
  /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|authorization\s*:\s*bearer\s+\S+|(?:api[_-]?key|password|secret|token)\s*[=:]\s*\S{8,})/iu;

const safeQuestionText = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u.test(value), {
    message: "질문에 제어 문자를 사용할 수 없습니다.",
  });

export const orbitQuestionRequestSchema = z.object({
  request: safeQuestionText.max(2_000).refine((value) => !probableSecret.test(value), {
    message: "요청에 비밀값으로 보이는 내용이 있습니다.",
  }),
}).strict();

export const orbitQuestionSchema = z.object({
  id: z.enum(["behavior", "context", "acceptance", "priority"]),
  prompt: safeQuestionText.max(240),
  hint: safeQuestionText.max(280),
  placeholder: safeQuestionText.max(320),
}).strict();

export const orbitQuestionOutputSchema = z.object({
  questions: z.array(orbitQuestionSchema).min(1).max(3),
}).strict().superRefine((value, context) => {
  const ids = value.questions.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({
      code: "custom",
      message: "질문 범주는 중복될 수 없습니다.",
      path: ["questions"],
    });
  }
});

export type OrbitQuestionOutput = z.infer<typeof orbitQuestionOutputSchema>;

export interface OrbitQuestionResult extends OrbitQuestionOutput {
  source: "company-opencode";
  model: string;
}
