import type { OfficeJob } from "./types";

export type DevelopmentMeetingQuestionId = "packet_gap" | "boundaries" | "acceptance";

export interface DevelopmentMeetingQuestion {
  id: DevelopmentMeetingQuestionId;
  prompt: string;
  hint: string;
  placeholder: string;
}

export type DevelopmentMeetingAnswers = Partial<Record<DevelopmentMeetingQuestionId, string>>;

export interface DevelopmentMeetingBrief {
  objective: string;
  packetSummary: string;
  clarifications: readonly string[];
  feedback: string;
}

export function createDevelopmentMeetingQuestions(job: OfficeJob): readonly DevelopmentMeetingQuestion[] {
  const assumptions = job.intakeBrief?.assumptions.filter(Boolean) ?? [];
  const scope = job.codingPlan?.scope.filter(Boolean) ?? [];
  const allowedPaths = job.codingPlan?.allowedPaths.filter(Boolean) ?? [];
  return [
    {
      id: "packet_gap",
      prompt: assumptions.length > 0
        ? `분석팀이 “${truncate(assumptions[0] ?? "확인할 가정", 72)}”라고 가정했습니다. 바로잡거나 보충할 내용이 있나요?`
        : "분석 패킷을 읽어 보니 이해되지 않거나 빠졌다고 느껴지는 내용이 있나요?",
      hint: "없다면 비워 두세요. 아틀라스가 현재 패킷을 기준으로 계획합니다.",
      placeholder: "예: 기존 동작과 호환되어야 하며, 해당 예외는 범위에서 제외해 주세요.",
    },
    {
      id: "boundaries",
      prompt: scope.length > 0
        ? `현재 구현 범위는 “${truncate(scope[0] ?? "분석된 범위", 76)}”입니다. 반드시 포함하거나 제외할 경계가 있나요?`
        : "개발팀이 반드시 지켜야 할 구현 범위나 건드리면 안 되는 영역이 있나요?",
      hint: allowedPaths.length > 0
        ? `현재 패킷 경로: ${allowedPaths.slice(0, 3).join(" · ")}`
        : "경로, 레이어, 호환성 또는 성능 제약을 짧게 남겨 주세요.",
      placeholder: "예: common 인터페이스는 유지하고 FTL 내부 구현만 변경해 주세요.",
    },
    {
      id: "acceptance",
      prompt: "아틀라스가 최종 구현을 판단할 때 가장 중요하게 볼 완료 조건은 무엇인가요?",
      hint: job.intakeBrief?.acceptanceAndTests
        ? `기존 완료 조건: ${truncate(job.intakeBrief.acceptanceAndTests, 120)}`
        : "테스트, 성능 수치, 로그 또는 시나리오 기준을 적어 주세요.",
      placeholder: "예: 기존 회귀 테스트 통과와 경계값 시나리오 결과를 함께 확인해 주세요.",
    },
  ];
}

export function buildDevelopmentMeetingBrief(
  job: OfficeJob,
  questions: readonly DevelopmentMeetingQuestion[],
  answers: DevelopmentMeetingAnswers,
): DevelopmentMeetingBrief {
  const objective = job.intakeBrief?.objective ?? job.codingPlan?.objective ?? job.prompt;
  const scope = job.codingPlan?.scope.filter(Boolean) ?? [];
  const packetSummary = scope.length > 0 ? scope.slice(0, 3).join(" · ") : "분석팀 패킷과 허용 경로 기준";
  const clarifications = questions.flatMap((question) => {
    const answer = answers[question.id]?.trim();
    return answer ? [`${questionLabel(question.id)}: ${answer}`] : [];
  });
  const feedback = [
    "[아틀라스 개발 사전 미팅]",
    `목표: ${objective}`,
    `패킷 범위: ${packetSummary}`,
    ...(clarifications.length > 0 ? clarifications : ["추가 보완: 없음 · 분석 패킷 기준으로 진행"]),
  ].join("\n").slice(0, 4_000);
  return { objective, packetSummary, clarifications, feedback };
}

function questionLabel(id: DevelopmentMeetingQuestionId): string {
  if (id === "packet_gap") return "이해·누락 보완";
  if (id === "boundaries") return "구현 경계";
  return "완료 조건";
}

function truncate(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/gu, " ").trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1)}…`;
}
