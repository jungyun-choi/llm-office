import type { PocAgentRole, PocModelOutput } from "./poc-schema";

export type PocFallbackReason =
  | "disabled"
  | "unavailable"
  | "timeout"
  | "model_error"
  | "invalid_output"
  | "capacity";

export interface PocWorkflowStage {
  sequence: number;
  id: string;
  role: "orchestrator" | PocAgentRole;
  agentName: string;
  status: "completed";
  summary: string;
  handoffTo: Array<"orchestrator" | PocAgentRole>;
}

export interface PocRunResult extends PocModelOutput {
  runId: string;
  status: "completed";
  requestedAt: string;
  completedAt: string;
  execution: {
    kind: "agent" | "deterministic";
    dataRoute:
      | "external-openai"
      | "external-opencode-zen"
      | "internal-opencode"
      | "deterministic";
    label: string;
    model?: string;
    localOnly: boolean;
    fallbackReason?: PocFallbackReason;
    cliProcesses: number;
    modelTurns: number;
    durationMs: number;
  };
  stages: PocWorkflowStage[];
  notices: string[];
}

export interface PocCapabilities {
  apiVersion: "v1";
  environment: "local" | "hosted";
  agentRuntime: {
    enabled: boolean;
    available: boolean;
    label: string;
    singleFlight: true;
    timeoutMs: number;
    progressMode: "indeterminate-then-stages";
  };
  fallback: {
    available: true;
    deterministic: true;
  };
  dataPolicy: {
    syntheticRepositoryOnly: boolean;
    acceptsCompanyData: boolean;
    externalModelReceivesSyntheticSnapshot: boolean;
  };
  bridgeToken?: string;
}
