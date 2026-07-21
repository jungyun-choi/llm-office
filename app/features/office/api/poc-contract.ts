import { z } from "zod";

const agentRoleSchema = z.enum(["research", "framework", "estimate", "test", "git"]);
const fallbackReasonSchema = z.enum([
  "disabled",
  "unavailable",
  "timeout",
  "model_error",
  "invalid_output",
  "capacity",
]);

export const pocCapabilitiesSchema = z.object({
  apiVersion: z.literal("v1"),
  environment: z.enum(["local", "hosted"]),
  bridgeToken: z.string().min(8).max(256).optional(),
  agentRuntime: z.object({
    enabled: z.boolean(),
    available: z.boolean(),
    label: z.string().min(1).max(160),
    singleFlight: z.literal(true),
    timeoutMs: z.number().int().positive(),
    progressMode: z.literal("indeterminate-then-stages"),
  }),
  fallback: z.object({ available: z.literal(true), deterministic: z.literal(true) }),
  dataPolicy: z.object({
    syntheticRepositoryOnly: z.literal(true),
    acceptsCompanyData: z.literal(false),
    externalModelReceivesSyntheticSnapshot: z.boolean(),
  }),
});

const roleOutputSchema = z.object({
  role: agentRoleSchema,
  summary: z.string(),
  findings: z.array(z.string()),
  evidence: z.array(z.string()),
});

const workItemSchema = z.object({
  title: z.string(),
  owner: agentRoleSchema,
  effort: z.enum(["XS", "S", "M", "L"]),
  dependencies: z.array(z.string()),
});

export const pocRunResultSchema = z.object({
  runId: z.string().min(1),
  status: z.literal("completed"),
  requestedAt: z.string(),
  completedAt: z.string(),
  execution: z.object({
    kind: z.enum(["agent", "deterministic"]),
    dataRoute: z.enum(["external-openai", "internal-opencode", "deterministic"]),
    label: z.string(),
    model: z.string().optional(),
    localOnly: z.boolean(),
    fallbackReason: fallbackReasonSchema.optional(),
    cliProcesses: z.number(),
    modelTurns: z.number(),
    durationMs: z.number(),
  }),
  roleOutputs: z.array(roleOutputSchema).length(5),
  brief: z.object({
    title: z.string(),
    objective: z.string(),
    scope: z.array(z.string()),
    outOfScope: z.array(z.string()),
    assumptions: z.array(z.string()),
    workBreakdown: z.array(workItemSchema),
    acceptanceCriteria: z.array(z.string()),
    testStrategy: z.array(z.string()),
    risks: z.array(z.string()),
    issueDraft: z.object({
      title: z.string(),
      body: z.string(),
      labels: z.array(z.string()),
    }),
  }),
  stages: z.array(z.object({
    sequence: z.number(),
    id: z.string(),
    role: z.union([z.literal("orchestrator"), agentRoleSchema]),
    agentName: z.string(),
    status: z.literal("completed"),
    summary: z.string(),
    handoffTo: z.array(z.union([z.literal("orchestrator"), agentRoleSchema])),
  })),
  notices: z.array(z.string()),
});

export const pocErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean().optional(),
    correlationId: z.string().optional(),
  }),
});

export type PocAgentRoleDto = z.infer<typeof agentRoleSchema>;
export type PocCapabilitiesDto = z.infer<typeof pocCapabilitiesSchema>;
export type PocRunResultDto = z.infer<typeof pocRunResultSchema>;
