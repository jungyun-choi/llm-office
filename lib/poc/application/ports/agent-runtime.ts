import type { PocFallbackReason } from "../../domain/poc-types";
import type { PocModelOutput } from "../../domain/poc-schema";
import type { SimulatorSourceContext } from "./simulator-source";

export interface AgentRuntimeProgress {
  role: "orchestrator" | "research" | "framework" | "estimate" | "test" | "git";
  status: "pending" | "running" | "completed" | "failed";
  phase?: "preparing_context" | "calling_model" | "validating_output";
  attempt?: number;
  summary?: string;
}

export type AgentRuntimeProgressCallback = (
  progress: AgentRuntimeProgress,
) => unknown | Promise<unknown>;

export interface AgentRuntimeRequest {
  featureRequest: string;
  source: SimulatorSourceContext;
  signal?: AbortSignal;
  onProgress?: AgentRuntimeProgressCallback;
}

export interface AgentRuntimeResult {
  runtimeId: string;
  runtimeLabel: string;
  kind: "agent" | "deterministic";
  dataRoute:
    | "external-openai"
    | "external-opencode-zen"
    | "internal-opencode"
    | "deterministic";
  model?: string;
  output: PocModelOutput;
  fallbackReason?: PocFallbackReason;
  metrics: {
    cliProcesses: number;
    modelTurns: number;
    durationMs: number;
  };
}

export interface AgentRuntime {
  readonly id: string;
  readonly label: string;
  isAvailable(): Promise<boolean>;
  execute(request: AgentRuntimeRequest): Promise<AgentRuntimeResult>;
}
