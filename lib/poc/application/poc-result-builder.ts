import type { AgentRuntimeResult } from "./ports/agent-runtime";
import type { PocAgentRole } from "../domain/poc-schema";
import type { PocRunResult, PocWorkflowStage } from "../domain/poc-types";

const AGENT_NAMES: Record<"orchestrator" | PocAgentRole, string> = {
  orchestrator: "Orbit",
  research: "Probe",
  framework: "Flash-X",
  estimate: "Calc",
  test: "Verify",
  git: "Gitmate",
};

export function buildPocRunResult(
  runner: AgentRuntimeResult,
  requestedAt: string,
  completedAt: string,
): PocRunResult {
  return {
    runId: crypto.randomUUID(),
    status: "completed",
    requestedAt,
    completedAt,
    execution: {
      kind: runner.kind,
      dataRoute: runner.dataRoute,
      label: runner.runtimeLabel,
      model: runner.model,
      localOnly: runner.dataRoute !== "external-openai",
      fallbackReason: runner.fallbackReason,
      ...runner.metrics,
    },
    stages: createStages(runner),
    ...runner.output,
    notices: [
      "이 결과는 합성 저장소만 사용한 POC입니다.",
      "코드는 수정되지 않았고 Git 이슈도 실제로 등록되지 않았습니다.",
      ...(runner.dataRoute === "external-openai"
        ? ["합성 데이터가 외부 OpenAI 모델로 전송됩니다. 회사 데이터는 절대 입력하지 마세요."]
        : []),
    ],
  };
}

function createStages(runner: AgentRuntimeResult): PocWorkflowStage[] {
  const outputs = new Map(runner.output.roleOutputs.map((output) => [output.role, output]));
  const roles: PocAgentRole[] = ["research", "framework", "estimate", "test", "git"];
  const specialistStages = roles.map((role, index) => ({
    sequence: index + 2,
    id: `stage-${role}`,
    role,
    agentName: AGENT_NAMES[role],
    status: "completed" as const,
    summary: outputs.get(role)?.summary ?? "역할별 산출물을 준비했습니다.",
    handoffTo: handoffTargets(role),
  }));
  return [
    {
      sequence: 1,
      id: "stage-orchestrator",
      role: "orchestrator",
      agentName: AGENT_NAMES.orchestrator,
      status: "completed",
      summary: "요청을 다섯 전문 역할로 분해하고 최종 브리프로 통합했습니다.",
      handoffTo: ["research", "framework"],
    },
    ...specialistStages,
  ];
}

function handoffTargets(role: PocAgentRole): Array<"orchestrator" | PocAgentRole> {
  if (role === "research" || role === "framework") return ["estimate", "test"];
  if (role === "estimate" || role === "test") return ["git"];
  return ["orchestrator"];
}
