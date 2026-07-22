import { ArrowRight, BrainCircuit, Code2, UserRoundCheck } from "lucide-react";

import { OFFICE_AGENTS } from "../office-data";
import type { OfficeJob, OfficeJobState } from "../types";
import { getJobStateLabel } from "./task-queue-history";

type CompanyTeamId = "analysis" | "review" | "development";

interface CompanyOperationsBoardProps {
  jobs: readonly OfficeJob[];
  selectedJobId?: string;
  onSelect: (jobId: string) => void;
}

const TEAM_DEFINITIONS = [
  {
    id: "analysis",
    eyebrow: "TEAM A · OPENCODE",
    title: "분석팀",
    description: "DLD · 코드 · TopView 근거 조사",
    icon: BrainCircuit,
  },
  {
    id: "review",
    eyebrow: "TEAM B · HUMAN",
    title: "사용자 검토팀",
    description: "구현 승인 · Git 승인 · PR 최종 검토",
    icon: UserRoundCheck,
  },
  {
    id: "development",
    eyebrow: "TEAM C · CLAUDE",
    title: "개발팀",
    description: "코드 수정 · 테스트 · Git 게시",
    icon: Code2,
  },
] as const;

const TEAM_STATES: Record<CompanyTeamId, readonly OfficeJobState[]> = {
  analysis: ["queued", "analyzing"],
  review: ["awaiting_coding_approval", "changes_ready", "review_pending", "merging"],
  development: ["coding_queued", "coding", "testing", "publishing"],
};

export function CompanyOperationsBoard(props: CompanyOperationsBoardProps) {
  return (
    <section className="company-operations" aria-labelledby="company-operations-title">
      <header className="company-operations__header">
        <div>
          <span>LIVE COMPANY</span>
          <h2 id="company-operations-title">세 팀이 각자의 업무를 동시에 처리합니다</h2>
        </div>
        <p>업무는 분석팀에서 시작해 사용자 검토를 거쳐 개발팀으로 전달됩니다. 각 팀의 대기열은 독립적으로 움직입니다.</p>
      </header>
      <div className="company-operations__lanes">
        {TEAM_DEFINITIONS.map((team, index) => {
          const jobs = props.jobs.filter((job) => TEAM_STATES[team.id].includes(job.state));
          const Icon = team.icon;
          return (
            <div className="company-operations__lane-wrap" key={team.id}>
              <section className="company-team-lane" data-team={team.id} aria-labelledby={`company-team-${team.id}`}>
                <header>
                  <span className="company-team-lane__icon"><Icon size={18} aria-hidden="true" /></span>
                  <div>
                    <small>{team.eyebrow}</small>
                    <strong id={`company-team-${team.id}`}>{team.title}</strong>
                    <p>{team.description}</p>
                  </div>
                  <em>{jobs.length}건</em>
                </header>
                {jobs.length > 0 ? (
                  <ol>
                    {jobs.slice(0, 3).map((job) => (
                      <li key={job.id} data-state={job.state} data-selected={job.id === props.selectedJobId ? "true" : "false"}>
                        <button type="button" onClick={() => props.onSelect(job.id)}>
                          <span className="company-team-lane__status"><i aria-hidden="true" />{getJobStateLabel(job.state)}</span>
                          <strong>{job.prompt}</strong>
                          <small>{getTeamActivity(job)}</small>
                        </button>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="company-team-lane__empty">현재 업무 없음 · 새 인계를 기다리는 중</p>
                )}
                {jobs.length > 3 && <p className="company-team-lane__more">외 {jobs.length - 3}건이 이 팀 대기열에 있습니다.</p>}
              </section>
              {index < TEAM_DEFINITIONS.length - 1 && (
                <span className="company-operations__handoff" aria-hidden="true"><ArrowRight size={17} /></span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function getCompanyTeam(job: OfficeJob): CompanyTeamId | undefined {
  return TEAM_DEFINITIONS.find((team) => TEAM_STATES[team.id].includes(job.state))?.id;
}

function getTeamActivity(job: OfficeJob): string {
  if (job.state === "queued") return job.queuePosition ? `분석팀 대기열 ${job.queuePosition}번째` : "분석 순서를 기다리는 중";
  if (job.state === "analyzing") {
    const running = job.analysisStages.find((stage) => stage.status === "running");
    const agent = running && OFFICE_AGENTS.find((candidate) => candidate.id === running.id);
    return running?.summary ?? (agent ? `${agent.name}가 근거를 정리하는 중` : "전문 에이전트가 분석하는 중");
  }
  if (job.state === "awaiting_coding_approval") return "분석 패킷 확인과 구현 승인이 필요합니다";
  if (job.state === "changes_ready") return "변경 파일과 테스트 결과의 Git 승인이 필요합니다";
  if (job.state === "review_pending") return "GitHub PR 검토와 최종 결정이 필요합니다";
  if (job.state === "merging") return "승인된 PR의 머지 상태를 확인하는 중";
  if (job.state === "coding_queued") return job.queuePosition ? `개발팀 대기열 ${job.queuePosition}번째` : "Claude 실행 순서를 기다리는 중";
  if (job.state === "coding") return job.events.at(-1)?.message ?? "Claude가 승인된 범위의 코드를 수정하는 중";
  if (job.state === "testing") return "변경 코드의 허용된 테스트를 실행하는 중";
  return "승인된 변경을 Git에 반영하는 중";
}
