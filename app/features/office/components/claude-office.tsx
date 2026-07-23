import { ArrowRight, Bot, Check, CircleDot, FileCode2, Gauge, ListChecks, Radio } from "lucide-react";

import type {
  DevelopmentFlowState,
  DevelopmentStationId,
  OfficeDevelopmentPart,
  OfficeJob,
} from "../types";
import { CodingResultPanel } from "./coding-result-panel";
import { DevelopmentStation } from "./development-station";

const CLAUDE_PHASES: readonly {
  id: Exclude<DevelopmentStationId, "claude">;
  label: string;
  title: string;
  model: string;
  description: string;
}[] = [
  {
    id: "implementation",
    label: "BUILDER · 구현 담당",
    title: "메이슨",
    model: "Claude Sonnet",
    description: "아틀라스의 지시에 따라 코드와 테스트를 구현",
  },
  {
    id: "verification",
    label: "VERIFIER · 검증 담당",
    title: "베라",
    model: "Claude Sonnet",
    description: "Diff · 테스트 · 회귀 위험을 독립 검증",
  },
  {
    id: "publisher",
    label: "RELEASE · Git 담당",
    title: "릴레이",
    model: "Claude Haiku",
    description: "승인된 변경의 Commit · Push · PR 처리",
  },
];

const OPENCODE_PHASES: typeof CLAUDE_PHASES = [
  {
    id: "implementation",
    label: "BUILDER · 구현 담당",
    title: "코어",
    model: "OpenCode · Build",
    description: "아르고의 지시에 따라 단순·반복 구현을 빠르게 처리",
  },
  {
    id: "verification",
    label: "VERIFIER · 검증 담당",
    title: "센티널",
    model: "OpenCode · Verify",
    description: "변경 범위와 회귀 테스트 결과를 독립 검증",
  },
  {
    id: "publisher",
    label: "RELEASE · Git 담당",
    title: "브릿지",
    model: "OpenCode · Git",
    description: "승인된 변경의 Commit · Push · PR 처리",
  },
];

const PART_DEFINITIONS = {
  claude: {
    eyebrow: "DEVELOPMENT PART 1 · CLAUDE",
    title: "개발 1파트",
    specialty: "고난도 · 복합 변경",
    leadName: "아틀라스",
    leadModel: "Claude Opus",
    leadLabel: "TEAM LEAD · OPUS",
    phases: CLAUDE_PHASES,
  },
  opencode: {
    eyebrow: "DEVELOPMENT PART 2 · OPENCODE",
    title: "개발 2파트",
    specialty: "저난도 · 정형 구현",
    leadName: "아르고",
    leadModel: "OpenCode · Lead",
    leadLabel: "TEAM LEAD · OPENCODE",
    phases: OPENCODE_PHASES,
  },
} as const;

interface ClaudeOfficeProps {
  job: OfficeJob | null;
  runtimeLabel?: string;
  opencodeRuntimeLabel?: string;
}

export function ClaudeOffice({ job, runtimeLabel, opencodeRuntimeLabel }: ClaudeOfficeProps) {
  const assignedPart = getDevelopmentPart(job);
  const unassignedFailure = job && isPreDevelopmentFailure(job) ? job : null;
  const claudeJob = assignedPart === "claude" ? job : unassignedFailure;
  const opencodeJob = assignedPart === "opencode" ? job : unassignedFailure;
  return (
    <section className="campus-office campus-office--claude campus-office--development" aria-labelledby="development-office-title">
      <header className="campus-office__header">
        <span className="campus-office__icon"><Bot size={18} aria-hidden="true" /></span>
        <div>
          <small>TEAM C · DEVELOPMENT DIVISION</small>
          <h2 id="development-office-title">개발팀</h2>
          <p>업무 난이도에 따라 두 파트가 독립적으로 구현합니다</p>
        </div>
        <span className="campus-office__state">{getClaudeOfficeState(job)}</span>
      </header>
      <DevelopmentRouting job={job} assignedPart={assignedPart} />
      <div className="development-parts" aria-label="개발팀 파트 배치">
        <DevelopmentPart
          part="claude"
          job={claudeJob}
          selectedJob={job}
          assignedPart={assignedPart}
          runtimeLabel={runtimeLabel ?? "Claude Opus · Sonnet · Haiku"}
        />
        <DevelopmentPart
          part="opencode"
          job={opencodeJob}
          selectedJob={job}
          assignedPart={assignedPart}
          runtimeLabel={opencodeRuntimeLabel ?? "사내 OpenCode 런타임"}
        />
      </div>
      {assignedPart && shouldShowImplementationActivity(job) && (
        <ImplementationActivityPanel job={job as OfficeJob} part={assignedPart} />
      )}
      {job?.coding && hasCodingArtifacts(job) && <CodingResultPanel coding={job.coding} />}
    </section>
  );
}

function DevelopmentRouting(props: {
  job: OfficeJob | null;
  assignedPart?: OfficeDevelopmentPart;
}) {
  const difficulty = props.job?.difficultyAssessment;
  const recommendedPart = difficulty?.recommendedPart ?? getRecommendedDevelopmentPart(props.job);
  return (
    <div className="development-routing" data-level={difficulty?.level ?? "pending"}>
      <span className="development-routing__icon"><Gauge size={17} aria-hidden="true" /></span>
      <div>
        <small>WORK ROUTING</small>
        <strong>
          {difficulty
            ? `종합 난이도 · ${getDifficultyLabel(difficulty.level)}${difficulty.score ? ` · ${difficulty.score}/5` : ""}`
            : "종합 난이도 평가 대기"}
        </strong>
        <p>{difficulty?.summary ?? "분석팀의 난이도 평가가 도착하면 검토팀에서 개발 파트를 결정합니다."}</p>
      </div>
      <span className="development-routing__decision">
        {props.assignedPart
          ? `${getDevelopmentPartLabel(props.assignedPart)} 배정`
          : recommendedPart
            ? `${getDevelopmentPartLabel(recommendedPart)} 권장`
            : "파트 배정 대기"}
      </span>
    </div>
  );
}

function DevelopmentPart(props: {
  part: OfficeDevelopmentPart;
  job: OfficeJob | null;
  selectedJob: OfficeJob | null;
  assignedPart?: OfficeDevelopmentPart;
  runtimeLabel: string;
}) {
  const definition = PART_DEFINITIONS[props.part];
  return (
    <section
      className={`development-part development-part--${props.part}`}
      data-active={props.job ? "true" : "false"}
      aria-labelledby={`development-part-${props.part}`}
    >
      <header className="development-part__header">
        <div>
          <small>{definition.eyebrow}</small>
          <h3 id={`development-part-${props.part}`}>{definition.title}</h3>
          <p>{definition.specialty}</p>
        </div>
        <span>{getDevelopmentPartState(props.part, props.selectedJob, props.assignedPart)}</span>
      </header>
      <p className="development-part__runtime" title={props.runtimeLabel}>{props.runtimeLabel}</p>
      <div className="claude-station-grid">
        <DevelopmentStation
          id="claude"
          label={definition.leadLabel}
          title={definition.leadName}
          model={definition.leadModel}
          description={`${definition.title} 팀장 · ${getClaudeActivity(props.job)}`}
          state={getDevelopmentStationState("claude", props.job)}
          team={props.part}
          lead
        />
        <DevelopmentTeamExchange job={props.job} part={props.part} />
        <div className="claude-phase-row" aria-label={`${definition.title} 구현 단계`}>
          {definition.phases.map((phase) => (
            <DevelopmentStation
              key={phase.id}
              {...phase}
              team={props.part}
              state={getDevelopmentStationState(phase.id, props.job)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

const IMPLEMENTATION_PLAN = [
  "아틀라스 · 계획",
  "메이슨 · 구현",
  "아틀라스 · 코드 리뷰",
  "베라 · 검증",
  "아틀라스 · 최종 판단",
  "릴레이 · Git · PR",
] as const;

const OPENCODE_IMPLEMENTATION_PLAN = [
  "아르고 · 계획",
  "코어 · 구현",
  "아르고 · 코드 리뷰",
  "센티널 · 검증",
  "아르고 · 최종 판단",
  "브릿지 · Git · PR",
] as const;

type ImplementationPlanState = "pending" | "active" | "completed" | "failed";

function ImplementationActivityPanel({ job, part }: { job: OfficeJob; part: OfficeDevelopmentPart }) {
  const changedFiles = job.coding?.changedFiles ?? [];
  const plan = part === "claude" ? IMPLEMENTATION_PLAN : OPENCODE_IMPLEMENTATION_PLAN;
  const teamLabel = getDevelopmentPartLabel(part);
  const targetPaths = changedFiles.length > 0
    ? changedFiles.map((file) => file.path)
    : job.codingPlan?.allowedPaths ?? [];
  const recentEvents = job.events.filter((event) => event.message).slice(-2).reverse();
  return (
    <section className="claude-activity" aria-labelledby={`claude-activity-${job.id}`}>
      <header>
        <div>
          <small><Radio size={13} aria-hidden="true" />IMPLEMENTATION LIVE</small>
          <strong id={`claude-activity-${job.id}`}>{teamLabel} 작업 현황</strong>
        </div>
        <span data-state={job.state}>{getClaudeOfficeState(job)}</span>
      </header>
      <div className="claude-activity__grid">
        <article className="claude-activity__current">
          <span><CircleDot size={14} aria-hidden="true" />현재 작업</span>
          <strong>{getClaudeCurrentTask(job)}</strong>
          <p>{job.intakeBrief?.objective ?? job.codingPlan?.objective ?? job.coding?.summary ?? getLatestEvent(job)}</p>
        </article>
        <article className="claude-activity__plan">
          <span><ListChecks size={14} aria-hidden="true" />구현 계획</span>
          <ol>
            {plan.map((label, index) => {
              const state = getImplementationPlanState(job, index);
              return (
                <li key={label} data-status={state}>
                  <i aria-hidden="true">{state === "completed" ? <Check size={11} /> : index + 1}</i>
                  <span>{label}</span>
                </li>
              );
            })}
          </ol>
        </article>
        <article className="claude-activity__files">
          <span><FileCode2 size={14} aria-hidden="true" />{changedFiles.length > 0 ? "확인된 변경 파일" : "허용 작업 경로"}</span>
          {targetPaths.length > 0 ? (
            <ul>
              {targetPaths.slice(0, 4).map((file) => <li key={file}><code>{file}</code></li>)}
            </ul>
          ) : (
            <p>작업 경로를 확인하는 중입니다.</p>
          )}
          {changedFiles.length === 0 && job.state === "coding" && (
            <small>실제 변경 파일은 {part === "claude" ? "Claude" : "OpenCode"} 실행이 끝나는 즉시 표시됩니다.</small>
          )}
        </article>
        <article className="claude-activity__log">
          <span><Radio size={14} aria-hidden="true" />최근 실행 기록</span>
          {recentEvents.length > 0 ? (
            <ul>{recentEvents.map((event, index) => <li key={event.id ?? `${event.createdAt}-${index}`}>{event.message}</li>)}</ul>
          ) : (
            <p>첫 실행 기록을 기다리는 중입니다.</p>
          )}
        </article>
      </div>
    </section>
  );
}

export function shouldShowImplementationActivity(job: OfficeJob | null): boolean {
  return Boolean(
    job &&
    !["queued", "analyzing", "canceled"].includes(job.state) &&
    !isPreDevelopmentFailure(job),
  );
}

function getClaudeCurrentTask(job: OfficeJob): string {
  if (job.state === "awaiting_coding_approval") return "승인된 구현 범위 확인 대기";
  if (job.state === "coding_queued") return "격리 작업 브랜치 준비 대기";
  if (job.state === "coding") return "허용된 경로에서 코드 구현";
  if (job.state === "testing") return "변경 코드 회귀 테스트";
  if (job.state === "awaiting_development_input") return "사람 판단을 기다리며 안전하게 일시 정지";
  if (job.state === "changes_ready") return "변경 파일과 테스트 결과 전달";
  if (job.state === "publishing") return "승인된 변경의 Commit · Push";
  if (job.state === "review_pending") return "GitHub PR 최종 리뷰 대기";
  if (job.state === "merging") return "승인된 PR 머지";
  if (job.state === "completed") return "구현 작업 완료";
  return job.error?.message ?? "개발 단계 문제 확인";
}

function getLatestEvent(job: OfficeJob): string {
  return job.events.at(-1)?.message ?? "승인된 분석 패킷을 기준으로 구현합니다.";
}

function getImplementationPlanState(job: OfficeJob, index: number): ImplementationPlanState {
  const activeIndex = getImplementationPlanIndex(job);
  if (job.state === "completed") return "completed";
  if (index < activeIndex) return "completed";
  if (index > activeIndex) return "pending";
  if (job.state === "failed") return "failed";
  return "active";
}

export function getImplementationPlanIndex(job: OfficeJob): number {
  if (["awaiting_coding_approval", "coding_queued"].includes(job.state)) return 0;
  if (job.state === "coding") return 1;
  if (job.state === "testing") return 3;
  if (job.state === "awaiting_development_input") {
    if (job.developmentQuestion?.resumeStage === "verification") return 3;
    if (job.developmentQuestion?.resumeStage === "git") return 5;
    return 1;
  }
  if (job.state === "changes_ready") return 4;
  if (["publishing", "review_pending", "merging"].includes(job.state)) return 5;
  if (job.state === "failed") {
    if (job.error?.stage === "analysis" || job.error?.stage === "queue") return 0;
    if (job.error?.stage === "coding") return 1;
    if (job.error?.stage === "testing") return 3;
    if (job.error?.stage === "publishing") return 5;
    return job.coding ? 1 : 0;
  }
  return 5;
}

export function getDevelopmentStationState(
  station: DevelopmentStationId,
  job: OfficeJob | null,
): DevelopmentFlowState {
  if (!job || job.state === "queued" || job.state === "analyzing" || job.state === "canceled") return "idle";
  if (job.state === "failed") return getFailedStationState(station, job);
  if (job.state === "awaiting_development_input") return getHumanQuestionStationState(station, job);
  if (station === "claude") return getClaudeLeadState(job.state);
  if (station === "implementation") return getImplementationState(job.state);
  if (station === "verification") return getVerificationState(job.state);
  return getPublisherState(job.state);
}

function getClaudeLeadState(state: OfficeJob["state"]): DevelopmentFlowState {
  if (["awaiting_coding_approval", "changes_ready", "review_pending"].includes(state)) return "waiting";
  if (state === "coding_queued") return "queued";
  if (["coding", "testing", "publishing", "merging"].includes(state)) return "working";
  if (state === "completed") return "complete";
  return "idle";
}

function getImplementationState(state: OfficeJob["state"]): DevelopmentFlowState {
  if (state === "coding_queued") return "queued";
  if (state === "coding") return "working";
  if (["testing", "changes_ready", "publishing", "review_pending", "merging", "completed"].includes(state)) return "complete";
  return "idle";
}

function getVerificationState(state: OfficeJob["state"]): DevelopmentFlowState {
  if (state === "testing") return "working";
  if (["changes_ready", "publishing", "review_pending", "merging", "completed"].includes(state)) return "complete";
  return "idle";
}

function getPublisherState(state: OfficeJob["state"]): DevelopmentFlowState {
  if (state === "changes_ready") return "waiting";
  if (state === "publishing") return "working";
  if (state === "review_pending") return "waiting";
  if (state === "merging") return "working";
  if (state === "completed") return "complete";
  return "idle";
}

function getHumanQuestionStationState(
  station: DevelopmentStationId,
  job: OfficeJob,
): DevelopmentFlowState {
  if (station === "claude") return "waiting";
  const resumeStage = job.developmentQuestion?.resumeStage ?? "implementation";
  if (resumeStage === "implementation") return station === "implementation" ? "waiting" : "idle";
  if (resumeStage === "verification") {
    if (station === "implementation") return "complete";
    return station === "verification" ? "waiting" : "idle";
  }
  return station === "publisher" ? "waiting" : "complete";
}

function getFailedStationState(station: DevelopmentStationId, job: OfficeJob): DevelopmentFlowState {
  if (!job.coding) return "idle";
  if (station === "claude") return "error";
  if (job.error?.stage === "testing") return station === "verification" ? "error" : "complete";
  if (job.error?.stage === "publishing") return station === "publisher" ? "error" : "complete";
  return station === "implementation" ? "error" : "idle";
}

function getClaudeOfficeState(job: OfficeJob | null): string {
  if (!job || ["queued", "analyzing"].includes(job.state)) return "업무 수령 대기";
  if (isPreDevelopmentFailure(job)) return "업무 수령 대기";
  if (job.state === "awaiting_coding_approval") return "사용자 승인 대기";
  if (job.state === "awaiting_development_input") return "사람 판단 대기";
  if (job.state === "changes_ready") return "Git 승인 대기";
  if (job.state === "review_pending") return "PR 최종 검토 대기";
  if (job.state === "merging") return "PR 머지 중";
  if (job.state === "completed") return "업무 완료";
  if (job.state === "failed" && job.coding) return "문제 발생";
  return ["coding_queued", "coding", "testing", "publishing", "merging"].includes(job.state) ? "작업 중" : "대기";
}

function getClaudeActivity(job: OfficeJob | null): string {
  if (!job) return "검토 데스크의 구현 승인을 기다립니다";
  if (isPreDevelopmentFailure(job)) return "분석팀이 문제를 해결한 뒤 구현 패킷을 전달합니다";
  if (job.state === "awaiting_coding_approval") return "구현 패킷은 도착했지만 아직 코드를 건드리지 않습니다";
  if (job.state === "awaiting_development_input") return "팀원의 막힘을 정리해 회의실에서 사람의 판단을 기다립니다";
  if (job.state === "changes_ready") return "변경과 테스트를 마치고 Git 승인을 기다립니다";
  if (job.state === "review_pending") return "PR이 준비되어 사용자의 최종 코드 검토를 기다립니다";
  if (job.state === "merging") return "사용자의 최종 승인에 따라 PR을 머지하고 있습니다";
  if (job.state === "failed") return job.error?.message ?? "개발 단계에서 작업이 멈췄습니다";
  return job.coding?.summary ?? "허용된 작업 공간에서 구현을 진행합니다";
}

function isPreDevelopmentFailure(job: OfficeJob): boolean {
  return job.state === "failed" &&
    (job.error?.stage === "analysis" || job.error?.stage === "queue" || !job.coding);
}

function hasCodingArtifacts(job: OfficeJob): boolean {
  return Boolean(
    job.coding?.diff
      || job.coding?.changedFiles.length
      || job.coding?.commitSha
      || (job.coding?.test && job.coding.test.status !== "not_run"),
  );
}

interface DevelopmentExchange {
  from: string;
  to: string;
  message: string;
  tone: "idle" | "active" | "blocked" | "complete";
}

function DevelopmentTeamExchange({ job, part }: { job: OfficeJob | null; part: OfficeDevelopmentPart }) {
  const exchange = getDevelopmentExchange(job, part);
  return (
    <div className="development-team-exchange" data-tone={exchange.tone} aria-live="polite">
      <span className="development-team-exchange__signal" aria-hidden="true"><Radio size={14} /></span>
      <div>
        <small>TEAM HANDOFF</small>
        <strong>
          <span>{exchange.from}</span>
          <ArrowRight size={14} aria-hidden="true" />
          <span>{exchange.to}</span>
        </strong>
        <p>{exchange.message}</p>
      </div>
      <i aria-hidden="true" />
    </div>
  );
}

export function getDevelopmentExchange(
  job: OfficeJob | null,
  part: OfficeDevelopmentPart = "claude",
): DevelopmentExchange {
  const names = part === "claude"
    ? { lead: "아틀라스", builder: "메이슨", verifier: "베라", publisher: "릴레이", team: "개발 1파트" }
    : { lead: "아르고", builder: "코어", verifier: "센티널", publisher: "브릿지", team: "개발 2파트" };
  if (!job || ["queued", "analyzing", "canceled"].includes(job.state) || isPreDevelopmentFailure(job)) {
    return {
      from: "검토팀",
      to: names.lead,
      message: "승인된 구현 패킷을 기다리고 있습니다.",
      tone: "idle",
    };
  }
  if (job.state === "awaiting_coding_approval") {
    return {
      from: "검토팀",
      to: names.lead,
      message: "분석 패킷을 함께 검토하고 개발 사전 미팅을 준비합니다.",
      tone: "idle",
    };
  }
  if (job.state === "coding_queued") {
    return {
      from: names.lead,
      to: names.builder,
      message: "분석 패킷을 검토하고 구현 순서와 작업 지시를 준비합니다.",
      tone: "active",
    };
  }
  if (job.state === "coding") {
    return {
      from: names.lead,
      to: names.builder,
      message: "구현 지시 전달 · 막히는 내용은 근거와 함께 팀장에게 보고합니다.",
      tone: "active",
    };
  }
  if (job.state === "awaiting_development_input") {
    const reporter = getDevelopmentReporterName(job, part);
    return {
      from: names.lead,
      to: "검토팀",
      message: `${reporter}의 보고를 검토했습니다. 추측으로 진행하지 않고 사람의 판단을 기다립니다.`,
      tone: "blocked",
    };
  }
  if (job.state === "testing") {
    return {
      from: names.builder,
      to: names.verifier,
      message: "변경 파일과 구현 결과를 인계해 독립 검증을 진행합니다.",
      tone: "active",
    };
  }
  if (job.state === "changes_ready") {
    return {
      from: names.verifier,
      to: names.lead,
      message: "검증 결과를 보고하고 사용자의 Git 승인을 기다립니다.",
      tone: "complete",
    };
  }
  if (job.state === "publishing") {
    return {
      from: names.lead,
      to: names.publisher,
      message: "사용자가 승인한 변경의 Commit · Push · PR 작업을 지시합니다.",
      tone: "active",
    };
  }
  if (["review_pending", "merging"].includes(job.state)) {
    return {
      from: names.publisher,
      to: "검토팀",
      message: "PR과 Git 결과를 전달해 사용자의 최종 코드 검토를 기다립니다.",
      tone: "complete",
    };
  }
  if (job.state === "completed") {
    return {
      from: names.team,
      to: "검토팀",
      message: "구현·검증·Git 작업과 사람 검토가 모두 완료됐습니다.",
      tone: "complete",
    };
  }
  if (job.state === "failed") {
    const from = job.error?.stage === "testing"
      ? names.verifier
      : job.error?.stage === "publishing"
      ? names.publisher
      : names.builder;
    return {
      from,
      to: names.lead,
      message: job.error?.message ?? "작업을 계속하기 위한 팀장 지시가 필요합니다.",
      tone: "blocked",
    };
  }
  return {
    from: names.lead,
    to: names.team,
    message: "현재 업무 상태를 확인하고 있습니다.",
    tone: "idle",
  };
}

function getDevelopmentReporterName(job: OfficeJob, part: OfficeDevelopmentPart): string {
  if (part === "opencode") {
    if (job.developmentQuestion?.raisedBy === "implementation") return "코어";
    if (job.developmentQuestion?.raisedBy === "verification") return "센티널";
    if (job.developmentQuestion?.raisedBy === "git") return "브릿지";
    return "아르고";
  }
  if (job.developmentQuestion?.raisedBy === "implementation") return "메이슨";
  if (job.developmentQuestion?.raisedBy === "verification") return "베라";
  if (job.developmentQuestion?.raisedBy === "git") return "릴레이";
  return "아틀라스";
}

export function getDevelopmentPart(job: OfficeJob | null): OfficeDevelopmentPart | undefined {
  if (!job) return undefined;
  if (job.developmentPart) return job.developmentPart;
  const runtime = `${job.coding?.runtimeLabel ?? ""} ${job.coding?.model ?? ""}`.toLowerCase();
  if (runtime.includes("opencode") || runtime.includes("open code")) return "opencode";
  if (runtime.includes("claude")) return "claude";
  if (
    job.coding
    || [
      "coding_queued",
      "coding",
      "testing",
      "awaiting_development_input",
      "changes_ready",
      "publishing",
      "review_pending",
      "merging",
      "completed",
    ].includes(job.state)
  ) return "claude";
  return undefined;
}

export function getRecommendedDevelopmentPart(job: OfficeJob | null): OfficeDevelopmentPart | undefined {
  const difficulty = job?.difficultyAssessment;
  if (!difficulty) return undefined;
  if (difficulty.recommendedPart) return difficulty.recommendedPart;
  return difficulty.level === "hard" || difficulty.level === "critical" ? "claude" : "opencode";
}

function getDevelopmentPartLabel(part: OfficeDevelopmentPart): string {
  return part === "claude" ? "개발 1파트" : "개발 2파트";
}

function getDifficultyLabel(level: NonNullable<OfficeJob["difficultyAssessment"]>["level"]): string {
  if (level === "easy") return "쉬움";
  if (level === "normal") return "보통";
  if (level === "hard") return "어려움";
  return "매우 어려움";
}

function getDevelopmentPartState(
  part: OfficeDevelopmentPart,
  job: OfficeJob | null,
  assignedPart?: OfficeDevelopmentPart,
): string {
  if (assignedPart === part) return getClaudeOfficeState(job);
  if (assignedPart) return "별도 업무 수령 가능";
  if (job?.state === "awaiting_coding_approval") return "파트 배정 대기";
  return "업무 수령 대기";
}
