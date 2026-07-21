import type {
  AgentRuntime,
  AgentRuntimeRequest,
  AgentRuntimeResult,
} from "../application/ports/agent-runtime";
import type { PocFallbackReason } from "../domain/poc-types";
import { runDemoPoc } from "./demo-poc-runner";

export class DeterministicRuntime implements AgentRuntime {
  readonly id = "deterministic";
  readonly label = "안전한 데모 엔진";

  constructor(private readonly reason?: PocFallbackReason) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async execute(request: AgentRuntimeRequest): Promise<AgentRuntimeResult> {
    return runDemoPoc(request.featureRequest, this.reason);
  }
}
