"use client";

import { ArrowRight, BrainCircuit, Code2, Files, UserRoundCheck } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";

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

const HUMAN_WAITING_STATES = ["awaiting_coding_approval", "changes_ready", "review_pending"] as const;
const BOTTLENECK_WAIT_MINUTES = 30;

export interface HumanBottleneckSnapshot {
  level: "clear" | "watch" | "bottleneck";
  waitingCount: number;
  oldestWaitMinutes?: number;
  label: string;
  detail: string;
}

export function CompanyOperationsBoard(props: CompanyOperationsBoardProps) {
  const now = useBoardClock();
  const humanBottleneck = getHumanBottleneckSnapshot(props.jobs, now);
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
                  <em>{team.id === "review" ? `${humanBottleneck.waitingCount}건 대기` : `${jobs.length}건`}</em>
                </header>
                {team.id === "review" ? (
                  <HumanReviewFileStack
                    jobs={jobs.filter((job) => HUMAN_WAITING_STATES.includes(job.state as (typeof HUMAN_WAITING_STATES)[number]))}
                    snapshot={humanBottleneck}
                    selectedJobId={props.selectedJobId}
                    onSelect={props.onSelect}
                    now={now}
                  />
                ) : jobs.length > 0 ? (
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
                {team.id !== "review" && jobs.length > 3 && <p className="company-team-lane__more">외 {jobs.length - 3}건이 이 팀 대기열에 있습니다.</p>}
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

function HumanReviewFileStack(props: {
  jobs: readonly OfficeJob[];
  snapshot: HumanBottleneckSnapshot;
  selectedJobId?: string;
  onSelect: (jobId: string) => void;
  now?: number;
}) {
  const visibleJobs = props.jobs.slice(0, 4);
  return (
    <div className="human-bottleneck" data-level={props.snapshot.level}>
      <div className="human-bottleneck__summary">
        <span className="human-bottleneck__symbol"><Files size={17} aria-hidden="true" /></span>
        <div>
          <small>REVIEW FILES</small>
          <strong>{props.snapshot.label}</strong>
          <p>{props.snapshot.detail}</p>
        </div>
      </div>
      {visibleJobs.length > 0 ? (
        <ol className="human-file-stack" aria-label="사람 검토 대기 파일철">
          {visibleJobs.map((job, index) => (
            <li
              key={job.id}
              data-selected={job.id === props.selectedJobId ? "true" : "false"}
              style={{ "--file-index": index } as CSSProperties}
            >
              <button type="button" onClick={() => props.onSelect(job.id)}>
                <span className="human-file-stack__tab">{getHumanGateLabel(job.state)}</span>
                <strong>{job.prompt}</strong>
                <small>{formatHumanWait(job, props.now)} · {getTeamActivity(job)}</small>
              </button>
            </li>
          ))}
          {props.jobs.length > visibleJobs.length && (
            <li className="human-file-stack__overflow">+{props.jobs.length - visibleJobs.length}개 파일철</li>
          )}
        </ol>
      ) : (
        <p className="company-team-lane__empty">검토 파일철 없음 · 새 검토를 기다리는 중</p>
      )}
    </div>
  );
}

export function getCompanyTeam(job: OfficeJob): CompanyTeamId | undefined {
  return TEAM_DEFINITIONS.find((team) => TEAM_STATES[team.id].includes(job.state))?.id;
}

export function getHumanBottleneckSnapshot(
  jobs: readonly OfficeJob[],
  now?: number,
): HumanBottleneckSnapshot {
  const waiting = jobs.filter((job) => HUMAN_WAITING_STATES.includes(job.state as (typeof HUMAN_WAITING_STATES)[number]));
  const oldestWaitMinutes = waiting.length > 0 && now !== undefined
    ? Math.max(...waiting.map((job) => getWaitMinutes(job, now)))
    : undefined;
  const machineQueueLength = Math.max(
    jobs.filter((job) => job.state === "queued").length,
    jobs.filter((job) => job.state === "coding_queued").length,
  );
  const isBottleneck = waiting.length >= 3 ||
    (oldestWaitMinutes !== undefined && oldestWaitMinutes >= BOTTLENECK_WAIT_MINUTES) ||
    (waiting.length >= 2 && waiting.length > machineQueueLength);
  if (waiting.length === 0) {
    return {
      level: "clear",
      waitingCount: 0,
      label: "검토 대기 없음",
      detail: "새 검토 파일을 기다리는 중",
    };
  }
  const waitLabel = oldestWaitMinutes === undefined ? "대기 시간 계산 중" : `최장 ${formatWaitMinutes(oldestWaitMinutes)}`;
  return isBottleneck
    ? {
      level: "bottleneck",
      waitingCount: waiting.length,
      oldestWaitMinutes,
      label: "검토 대기 파일철",
      detail: `${waiting.length}건 · ${waitLabel}`,
    }
    : {
      level: "watch",
      waitingCount: waiting.length,
      oldestWaitMinutes,
      label: "검토 대기 파일철",
      detail: `${waiting.length}건 · ${waitLabel}`,
    };
}

function useBoardClock(): number | undefined {
  const [now, setNow] = useState<number>();
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const intervalId = window.setInterval(update, 30_000);
    return () => window.clearInterval(intervalId);
  }, []);
  return now;
}

function getHumanGateLabel(state: OfficeJobState): string {
  if (state === "awaiting_coding_approval") return "구현 승인";
  if (state === "changes_ready") return "Git 승인";
  return "PR 최종 검토";
}

function formatHumanWait(job: OfficeJob, now: number | undefined): string {
  return now === undefined ? "대기 시간 계산 중" : `${formatWaitMinutes(getWaitMinutes(job, now))} 대기`;
}

function getWaitMinutes(job: OfficeJob, now: number): number {
  const startedAt = Date.parse(job.updatedAt ?? job.createdAt);
  if (!Number.isFinite(startedAt)) return 0;
  return Math.max(0, Math.floor((now - startedAt) / 60_000));
}

function formatWaitMinutes(minutes: number): string {
  if (minutes < 1) return "1분 미만";
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder > 0 ? `${hours}시간 ${remainder}분` : `${hours}시간`;
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
