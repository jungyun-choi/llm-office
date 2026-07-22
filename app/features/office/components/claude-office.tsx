import { Bot } from "lucide-react";

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
          <small>OFFICE B · DEVELOPMENT</small>
          <h2 id="claude-office-title">Claude 개발 사무실</h2>
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
      {job?.coding && hasCodingArtifacts(job) && <CodingResultPanel coding={job.coding} />}
    </section>
  );
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
  if (state === "awaiting_coding_approval" || state === "changes_ready") return "waiting";
  if (state === "coding_queued") return "queued";
  if (["coding", "testing", "publishing"].includes(state)) return "working";
  if (state === "completed") return "complete";
  return "idle";
}

function getImplementationState(state: OfficeJob["state"]): DevelopmentFlowState {
  if (state === "coding_queued") return "queued";
  if (state === "coding") return "working";
  if (["testing", "changes_ready", "publishing", "completed"].includes(state)) return "complete";
  return "idle";
}

function getVerificationState(state: OfficeJob["state"]): DevelopmentFlowState {
  if (state === "testing") return "working";
  if (["changes_ready", "publishing", "completed"].includes(state)) return "complete";
  return "idle";
}

function getPublisherState(state: OfficeJob["state"]): DevelopmentFlowState {
  if (state === "changes_ready") return "waiting";
  if (state === "publishing") return "working";
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
  if (job.state === "completed") return "업무 완료";
  if (job.state === "failed" && job.coding) return "문제 발생";
  return ["coding_queued", "coding", "testing", "publishing"].includes(job.state) ? "작업 중" : "대기";
}

function getClaudeActivity(job: OfficeJob | null): string {
  if (!job) return "검토 데스크의 구현 승인을 기다립니다";
  if (job.state === "awaiting_coding_approval") return "구현 패킷은 도착했지만 아직 코드를 건드리지 않습니다";
  if (job.state === "changes_ready") return "변경과 테스트를 마치고 Git 승인을 기다립니다";
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
