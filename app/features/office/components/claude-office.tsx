import { ArrowRight, Bot, Check, CircleDot, FileCode2, ListChecks, Radio } from "lucide-react";

import type { DevelopmentFlowState, DevelopmentStationId, OfficeJob } from "../types";
import { CodingResultPanel } from "./coding-result-panel";
import { DevelopmentStation } from "./development-station";

const PHASES: readonly {
  id: Exclude<DevelopmentStationId, "claude">;
  label: string;
  title: string;
  model: string;
  description: string;
}[] = [
  {
    id: "implementation",
    label: "BUILDER",
    title: "구현 담당",
    model: "Claude Sonnet",
    description: "팀장 지시에 따라 코드와 테스트를 구현",
  },
  {
    id: "verification",
    label: "VERIFIER",
    title: "검증 담당",
    model: "Claude Sonnet",
    description: "Diff · 테스트 · 회귀 위험을 독립 검증",
  },
  {
    id: "publisher",
    label: "RELEASE",
    title: "Git 담당",
    model: "Claude Haiku",
    description: "승인된 변경의 Commit · Push · PR 처리",
  },
];

interface ClaudeOfficeProps {
  job: OfficeJob | null;
  runtimeLabel?: string;
}

export function ClaudeOffice({ job, runtimeLabel }: ClaudeOfficeProps) {
  const leadState = getDevelopmentStationState("claude", job);
  return (
    <section className="campus-office campus-office--claude" aria-labelledby="claude-office-title">
      <header className="campus-office__header">
        <span className="campus-office__icon"><Bot size={18} aria-hidden="true" /></span>
        <div>
          <small>TEAM C · DEVELOPMENT</small>
          <h2 id="claude-office-title">개발팀</h2>
          <p title={runtimeLabel}>Opus · Sonnet · Haiku 협업 런타임</p>
        </div>
        <span className="campus-office__state">{getClaudeOfficeState(job)}</span>
      </header>
      <div className="claude-station-grid">
        <DevelopmentStation
          id="claude"
          label="TEAM LEAD · OPUS"
          title="클로드 팀장"
          model="Claude Opus"
          description={getClaudeActivity(job)}
          state={leadState}
          lead
        />
        <DevelopmentTeamExchange job={job} />
        <div className="claude-phase-row" aria-label="Claude 구현 단계">
          {PHASES.map((phase) => (
            <DevelopmentStation
              key={phase.id}
              {...phase}
              state={getDevelopmentStationState(phase.id, job)}
            />
          ))}
        </div>
      </div>
      {shouldShowImplementationActivity(job) && <ImplementationActivityPanel job={job as OfficeJob} />}
      {job?.coding && hasCodingArtifacts(job) && <CodingResultPanel coding={job.coding} />}
    </section>
  );
}

const IMPLEMENTATION_PLAN = [
  "Opus 계획",
  "Sonnet 구현",
  "Opus 코드 리뷰",
  "Sonnet 검증",
  "Opus 최종 판단",
  "Haiku Git · PR",
] as const;

type ImplementationPlanState = "pending" | "active" | "completed" | "failed";

function ImplementationActivityPanel({ job }: { job: OfficeJob }) {
  const changedFiles = job.coding?.changedFiles ?? [];
  const targetPaths = changedFiles.length > 0
    ? changedFiles.map((file) => file.path)
    : job.codingPlan?.allowedPaths ?? [];
  const recentEvents = job.events.filter((event) => event.message).slice(-2).reverse();
  return (
    <section className="claude-activity" aria-labelledby={`claude-activity-${job.id}`}>
      <header>
        <div>
          <small><Radio size={13} aria-hidden="true" />IMPLEMENTATION LIVE</small>
          <strong id={`claude-activity-${job.id}`}>개발팀 작업 현황</strong>
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
            {IMPLEMENTATION_PLAN.map((label, index) => {
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
            <small>실제 변경 파일은 Claude 실행이 끝나는 즉시 표시됩니다.</small>
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

function DevelopmentTeamExchange({ job }: { job: OfficeJob | null }) {
  const exchange = getDevelopmentExchange(job);
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

export function getDevelopmentExchange(job: OfficeJob | null): DevelopmentExchange {
  if (!job || ["queued", "analyzing", "canceled"].includes(job.state) || isPreDevelopmentFailure(job)) {
    return {
      from: "검토팀",
      to: "Opus 팀장",
      message: "승인된 구현 패킷을 기다리고 있습니다.",
      tone: "idle",
    };
  }
  if (job.state === "awaiting_coding_approval") {
    return {
      from: "검토팀",
      to: "Opus 팀장",
      message: "구현 승인 전에는 개발팀이 코드를 수정하지 않습니다.",
      tone: "idle",
    };
  }
  if (job.state === "coding_queued") {
    return {
      from: "Opus 팀장",
      to: "Sonnet 구현",
      message: "분석 패킷을 검토하고 구현 순서와 작업 지시를 준비합니다.",
      tone: "active",
    };
  }
  if (job.state === "coding") {
    return {
      from: "Opus 팀장",
      to: "Sonnet 구현",
      message: "구현 지시 전달 · 막히는 내용은 근거와 함께 팀장에게 보고합니다.",
      tone: "active",
    };
  }
  if (job.state === "testing") {
    return {
      from: "Sonnet 구현",
      to: "Sonnet 검증",
      message: "변경 파일과 구현 결과를 인계해 독립 검증을 진행합니다.",
      tone: "active",
    };
  }
  if (job.state === "changes_ready") {
    return {
      from: "Sonnet 검증",
      to: "Opus 팀장",
      message: "검증 결과를 보고하고 사용자의 Git 승인을 기다립니다.",
      tone: "complete",
    };
  }
  if (job.state === "publishing") {
    return {
      from: "Opus 팀장",
      to: "Haiku Git",
      message: "사용자가 승인한 변경의 Commit · Push · PR 작업을 지시합니다.",
      tone: "active",
    };
  }
  if (["review_pending", "merging"].includes(job.state)) {
    return {
      from: "Haiku Git",
      to: "검토팀",
      message: "PR과 Git 결과를 전달해 사용자의 최종 코드 검토를 기다립니다.",
      tone: "complete",
    };
  }
  if (job.state === "completed") {
    return {
      from: "개발팀",
      to: "검토팀",
      message: "구현·검증·Git 작업과 사람 검토가 모두 완료됐습니다.",
      tone: "complete",
    };
  }
  if (job.state === "failed") {
    const from = job.error?.stage === "testing"
      ? "Sonnet 검증"
      : job.error?.stage === "publishing"
      ? "Haiku Git"
      : "Sonnet 구현";
    return {
      from,
      to: "Opus 팀장",
      message: job.error?.message ?? "작업을 계속하기 위한 팀장 지시가 필요합니다.",
      tone: "blocked",
    };
  }
  return {
    from: "Opus 팀장",
    to: "개발팀",
    message: "현재 업무 상태를 확인하고 있습니다.",
    tone: "idle",
  };
}
