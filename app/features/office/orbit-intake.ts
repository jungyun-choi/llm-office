import type { OrbitIntakeBrief } from "./types";
import { z } from "zod";

export type OrbitQuestionId = "behavior" | "context" | "acceptance" | "priority";

export interface OrbitQuestion {
  id: OrbitQuestionId;
  prompt: string;
  hint: string;
  placeholder: string;
}

export type OrbitAnswers = Partial<Record<OrbitQuestionId, string>>;

export interface OrbitQuestionSet {
  source: "company-opencode";
  model: string;
  questions: readonly OrbitQuestion[];
}

const orbitQuestionSetSchema = z.object({
  source: z.literal("company-opencode"),
  model: z.string().trim().min(1).max(160),
  questions: z.array(z.object({
    id: z.enum(["behavior", "context", "acceptance", "priority"]),
    prompt: z.string().trim().min(1).max(240),
    hint: z.string().trim().min(1).max(280),
    placeholder: z.string().trim().min(1).max(320),
  }).strict()).min(1).max(3),
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

export function parseOrbitQuestionSet(payload: unknown): OrbitQuestionSet {
  return orbitQuestionSetSchema.parse(payload);
}

const QUESTIONS: Record<OrbitQuestionId, OrbitQuestion> = {
  behavior: {
    id: "behavior",
    prompt: "지금 동작과 바꾸고 싶은 동작은 각각 무엇인가요?",
    hint: "차이를 한두 문장으로 알려주면 분석 범위가 훨씬 정확해집니다.",
    placeholder: "예: 현재 1MB에서 요청이 막히고, 2MB까지 정상 처리되길 원해요.",
  },
  context: {
    id: "context",
    prompt: "관련 레이어·경로·문서 중 알고 있는 게 있나요?",
    hint: "Common/HIL/FTL/FIL, .LLM DLD, TopView처럼 단서만 적어도 됩니다.",
    placeholder: "예: FTL/read_buffer, .LLM DLD와 TopView의 read 시나리오 참고",
  },
  acceptance: {
    id: "acceptance",
    prompt: "완료 기준이나 꼭 확인할 테스트는 무엇인가요?",
    hint: "모르면 비워 두세요. 테스트 전문가가 기준을 제안합니다.",
    placeholder: "예: 기존 1MB 회귀 없이 2MB 경계값과 overflow 테스트 통과",
  },
  priority: {
    id: "priority",
    prompt: "이번 업무에서 가장 중요한 한 가지는 무엇인가요?",
    hint: "이미 요청이 구체적이라 우선순위만 확인할게요.",
    placeholder: "예: 성능보다 기존 모델과의 동작 호환성이 우선이에요.",
  },
};

export function createOrbitQuestions(request: string): OrbitQuestion[] {
  const normalized = request.toLowerCase();
  const questions: OrbitQuestion[] = [];
  if (!/(현재|기존|문제|오류|동작|원하|바꾸|추가|증가|감소|지원|크게|작게|늘리|줄이|확장|축소|도입|expected|current|from|to)/u.test(normalized)) {
    questions.push(QUESTIONS.behavior);
  }
  if (!/(common|hil|ftl|fil|\.llm|dld|topview|top view|경로|디렉토리|파일|레이어|모듈|문서)/iu.test(normalized)) {
    questions.push(QUESTIONS.context);
  }
  if (!/(테스트|검증|완료|기준|성공|회귀|accept|pass|실패|경계|성능)/iu.test(normalized)) {
    questions.push(QUESTIONS.acceptance);
  }
  return questions.length > 0 ? questions.slice(0, 3) : [QUESTIONS.priority];
}

export function buildOrbitIntakeBrief(
  request: string,
  answers: OrbitAnswers = {},
): OrbitIntakeBrief {
  const objective = compact(request, 500);
  const assumptions = [
    !answers.behavior && !hasBehaviorContext(request)
      ? "현재·기대 동작의 세부 차이는 분석 중 확인"
      : undefined,
    !answers.context && !hasRepositoryContext(request)
      ? "대상 경로와 DLD·TopView 근거는 분석팀이 레포에서 확인"
      : undefined,
    !answers.acceptance && !hasAcceptanceContext(request)
      ? "회귀 방지 기준과 테스트 범위는 테스트 전문가가 제안"
      : undefined,
  ].filter((item): item is string => Boolean(item));

  return {
    version: "1",
    objective,
    currentAndExpectedBehavior: optionalCompact(answers.behavior, 700),
    repositoryContext: optionalCompact(answers.context, 700),
    acceptanceAndTests: optionalCompact(answers.acceptance, 700),
    assumptions: answers.priority
      ? [...assumptions, `최우선 조건: ${compact(answers.priority, 210)}`].slice(0, 4)
      : assumptions,
  };
}

function hasBehaviorContext(request: string): boolean {
  return /(현재|기존|문제|오류|동작|원하|바꾸|추가|증가|감소|지원|크게|작게|늘리|줄이|확장|축소|도입|expected|current|from|to)/iu.test(request);
}

function hasRepositoryContext(request: string): boolean {
  return /(common|hil|ftl|fil|\.llm|dld|topview|top view|경로|디렉토리|파일|레이어|모듈|문서)/iu.test(request);
}

function hasAcceptanceContext(request: string): boolean {
  return /(테스트|검증|완료|기준|성공|회귀|accept|pass|실패|경계|성능)/iu.test(request);
}

function optionalCompact(value: string | undefined, maxLength: number): string | undefined {
  const normalized = value ? compact(value, maxLength) : "";
  return normalized || undefined;
}

function compact(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
