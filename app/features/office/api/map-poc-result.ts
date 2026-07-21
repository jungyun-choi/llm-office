import type { PocAgentRoleDto, PocRunResultDto } from "./poc-contract";
import type {
  OfficeResult,
  OfficeRoleResult,
  OfficeWorkItem,
  ResultSection,
} from "../types";

const RESULT_TIME_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Seoul",
});

const ROLE_META: Record<PocAgentRoleDto, { agentName: string; roleLabel: string }> = {
  research: { agentName: "프로브", roleLabel: "자료조사" },
  framework: { agentName: "플래시-X", roleLabel: "프레임워크" },
  estimate: { agentName: "칼크", roleLabel: "견적분석" },
  test: { agentName: "베리파이", roleLabel: "테스트" },
  git: { agentName: "깃메이트", roleLabel: "Git" },
};

const DATA_ROUTE_LABELS: Record<PocRunResultDto["execution"]["dataRoute"], string> = {
  "external-openai": "외부 OpenAI · 합성 스냅샷만 전송",
  "external-opencode-zen": "OpenCode Zen · 합성 스냅샷만 전송",
  "internal-opencode": "로컬 OpenCode · 기기 내부 처리",
  deterministic: "호스팅된 결정론적 시연",
};

export function mapPocRunResult(result: PocRunResultDto, request: string): OfficeResult {
  return {
    id: result.runId,
    request,
    title: result.brief.title,
    summary: result.brief.objective,
    gitIssueTitle: result.brief.issueDraft.title,
    issueDraft: result.brief.issueDraft,
    createdAt: formatCompletedAt(result.completedAt),
    sections: createBriefSections(result),
    roleOutputs: result.roleOutputs.map(mapRoleOutput),
    workItems: result.brief.workBreakdown.map(mapWorkItem),
    engine: mapExecutionInfo(result.execution, result.roleOutputs.length),
    notices: result.notices,
  };
}

export function mapExecutionInfo(
  execution: PocRunResultDto["execution"],
  roleOutputCount: number,
): OfficeResult["engine"] {
  return {
    label: execution.label,
    dataRoute: execution.dataRoute,
    dataRouteLabel: DATA_ROUTE_LABELS[execution.dataRoute],
    cliProcesses: execution.cliProcesses,
    modelTurns: execution.modelTurns,
    roleOutputCount,
    fallbackReason: execution.fallbackReason,
  };
}

function createBriefSections(result: PocRunResultDto): readonly ResultSection[] {
  return [
    { label: "포함 범위", items: result.brief.scope },
    { label: "제외 범위", items: result.brief.outOfScope },
    { label: "전제", items: result.brief.assumptions },
    { label: "완료 조건", items: result.brief.acceptanceCriteria },
    { label: "테스트 전략", items: result.brief.testStrategy },
    { label: "위험과 대응", items: result.brief.risks },
  ];
}

function mapRoleOutput(output: PocRunResultDto["roleOutputs"][number]): OfficeRoleResult {
  const meta = ROLE_META[output.role];
  return { ...output, ...meta };
}

function mapWorkItem(item: PocRunResultDto["brief"]["workBreakdown"][number]): OfficeWorkItem {
  return { ...item, owner: ROLE_META[item.owner].agentName };
}

function formatCompletedAt(value: string): string {
  const completedAt = new Date(value);
  return Number.isNaN(completedAt.getTime())
    ? RESULT_TIME_FORMATTER.format(new Date())
    : RESULT_TIME_FORMATTER.format(completedAt);
}
