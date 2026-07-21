import type { PocFallbackReason } from "../../domain/poc-types";
import type { PocModelOutput } from "../../domain/poc-schema";
import type { SimulatorSourceContext } from "./simulator-source";

export interface AgentRuntimeRequest {
  featureRequest: string;
  source: SimulatorSourceContext;
  signal?: AbortSignal;
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
