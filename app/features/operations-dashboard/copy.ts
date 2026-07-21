import type {
  AgentStatus,
  QueueFilter,
  TaskPriority,
  TaskStage,
} from "./types";

export const UI_COPY = {
  productName: "AI OFFICE",
  productDescriptor: "SIMULATION OPERATIONS",
  workspaceName: "SSD / UFS 성능 시뮬레이터",
  workspaceCode: "SIM-OPS / KR-01",
  pageEyebrow: "COMMAND OVERVIEW",
  pageTitle: "시뮬레이션 개발 준비실",
  pageDescription:
    "조사부터 견적, 테스트 설계, Git 이슈화까지 — 코딩 전 의사결정 흐름을 지휘합니다.",
  localTime: "2026.07.21 · 화요일 · KST",
  systemHealthy: "전체 시스템 정상",
  searchPlaceholder: "업무, 태그, 산출물 검색",
  searchShortcut: "⌘ K",
  newTask: "신규 업무",
  agentSectionTitle: "에이전트 스테이션",
  agentSectionDescription: "담당자를 선택하면 아래 업무 큐가 함께 필터링됩니다.",
  allAgents: "전체 에이전트",
  queueTitle: "우선순위 업무 큐",
  queueDescription: "현재 준비 작업의 병목과 다음 행동을 확인하세요.",
  clearAgent: "선택 해제",
  noTasksTitle: "조건에 맞는 업무가 없습니다",
  noTasksDescription: "검색어나 필터를 조정해 다른 업무를 확인해 보세요.",
  pipelineTitle: "준비 파이프라인",
  pipelineDescription: "코딩 착수 전 완료되어야 할 여섯 단계입니다.",
  approvalsTitle: "승인 대기",
  approvalsDescription: "사람의 판단이 필요한 항목",
  outputsTitle: "최근 산출물",
  outputsDescription: "검토 가능한 최신 문서",
  activityTitle: "라이브 로그",
  activityDescription: "에이전트 작업 이벤트",
  viewAll: "전체 보기",
  details: "상세 보기",
  taskDetails: "업무 상세",
  close: "닫기",
  assignedAgent: "담당 에이전트",
  requiredOutput: "요청 산출물",
  acceptanceCriteria: "완료 기준",
  progress: "진행률",
  schedule: "일정",
  blockedReason: "차단 사유",
  createTitle: "새 준비 업무 등록",
  createDescription:
    "목표와 기대 산출물을 명확히 적으면 오케스트레이터가 실행 순서를 조정합니다.",
  taskName: "업무명",
  taskNamePlaceholder: "예: NVMe 랜덤 읽기 벤치마크 조사",
  taskBrief: "요청 배경",
  taskBriefPlaceholder: "의사결정에 필요한 맥락과 범위를 적어 주세요.",
  priority: "우선순위",
  agent: "담당 에이전트",
  output: "기대 산출물",
  outputPlaceholder: "예: 비교표 + 권고안 1페이지",
  cancel: "취소",
  create: "업무 등록",
  createSuccess: "새 업무가 접수 큐에 등록되었습니다.",
  formRequired: "필수 항목입니다.",
  navigationLabel: "주요 메뉴",
  mobileMenuOpen: "메뉴 열기",
  mobileMenuClose: "메뉴 닫기",
  skipToContent: "본문으로 건너뛰기",
  errorTitle: "대시보드를 불러오지 못했습니다",
  errorDescription: "잠시 후 다시 시도하거나 화면을 새로고침해 주세요.",
  retry: "다시 시도",
} as const;

export const NAV_ITEMS = [
  { id: "overview", label: "상황판" },
  { id: "queue", label: "업무 큐" },
  { id: "pipeline", label: "파이프라인" },
  { id: "outputs", label: "산출물" },
] as const;

export const AGENT_STATUS_LABELS: Record<AgentStatus, string> = {
  working: "작업 중",
  review: "검토 중",
  waiting: "대기",
  offline: "오프라인",
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  urgent: "긴급",
  high: "높음",
  normal: "보통",
};

export const STAGE_LABELS: Record<TaskStage, string> = {
  inbox: "접수",
  research: "자료 조사",
  analysis: "견적·분석",
  test: "테스트 설계",
  issue: "Git 이슈화",
  approval: "승인 대기",
};

export const QUEUE_FILTER_LABELS: Record<QueueFilter, string> = {
  all: "전체",
  active: "진행 중",
  approval: "승인 대기",
  blocked: "차단됨",
};
