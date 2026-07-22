import { Bot, Check, CircleDot, FileCode2, ListChecks, Radio } from "lucide-react";

import type { DevelopmentFlowState, DevelopmentStationId, OfficeJob } from "../types";
import { CodingResultPanel } from "./coding-result-panel";
import { DevelopmentStation } from "./development-station";

const PHASES: readonly {
  id: Exclude<DevelopmentStationId, "claude">;
  label: string;
  title: string;
  description: string;
}[] = [
  { id: "implementation", label: "01 · BUILD", title: "구현", description: "격리 브랜치에서 코드 수정" },
  { id: "verification", label: "02 · TEST", title: "검증", description: "허용된 테스트 명령 실행" },
  { id: "publisher", label: "03 · GIT", title: "Git", description: "승인 후 commit · push" },
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
          <h2 id="claude-office-title">Claude 개발실</h2>
          <p>{job?.coding?.model ?? runtimeLabel ?? "승인된 사내 Claude 실행기"}</p>
        </div>
        <span className="campus-office__state">{getClaudeOfficeState(job)}</span>
      </header>
      <div className="claude-station-grid">
        <DevelopmentStation
          id="claude"
          label="CLAUDE LEAD"
          title="클로드"
          description={getClaudeActivity(job)}
          state={leadState}
          lead
        />
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

const IMPLEMENTATION_PLAN = ["구현 범위 확인", "코드 수정", "테스트", "Git · PR"] as const;

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
          <strong id={`claude-activity-${job.id}`}>Claude 작업 현황</strong>
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

function shouldShowImplementationActivity(job: OfficeJob | null): boolean {
  return Boolean(job && !["queued", "analyzing", "canceled"].includes(job.state));
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

function getImplementationPlanIndex(job: OfficeJob): number {
  if (["awaiting_coding_approval", "coding_queued"].includes(job.state)) return 0;
  if (job.state === "coding") return 1;
  if (job.state === "testing") return 2;
  if (["changes_ready", "publishing", "review_pending", "merging"].includes(job.state)) return 3;
  if (job.state === "failed") {
    if (job.error?.stage === "testing") return 2;
    if (job.error?.stage === "publishing") return 3;
    return 1;
  }
  return 3;
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
  if (job.state === "awaiting_coding_approval") return "구현 패킷은 도착했지만 아직 코드를 건드리지 않습니다";
  if (job.state === "changes_ready") return "변경과 테스트를 마치고 Git 승인을 기다립니다";
  if (job.state === "review_pending") return "PR이 준비되어 사용자의 최종 코드 검토를 기다립니다";
  if (job.state === "merging") return "사용자의 최종 승인에 따라 PR을 머지하고 있습니다";
  if (job.state === "failed") return job.error?.message ?? "개발 단계에서 작업이 멈췄습니다";
  return job.coding?.summary ?? "허용된 작업 공간에서 구현을 진행합니다";
}

function hasCodingArtifacts(job: OfficeJob): boolean {
  return Boolean(
    job.coding?.diff
      || job.coding?.changedFiles.length
      || job.coding?.commitSha
      || (job.coding?.test && job.coding.test.status !== "not_run"),
  );
}
