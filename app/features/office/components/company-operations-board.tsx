"use client";

import { ArrowRight, BrainCircuit, ClipboardList, Code2, UserRoundCheck } from "lucide-react";
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
    title: "검토팀",
    description: "구현 승인 · Git 승인 · PR 최종 검토",
    icon: UserRoundCheck,
  },
  {
    id: "development",
    eyebrow: "TEAM C · DUAL RUNTIME",
    title: "개발팀",
    description: "개발 1파트 Claude · 개발 2파트 OpenCode",
    icon: Code2,
  },
] as const;

const TEAM_STATES: Record<CompanyTeamId, readonly OfficeJobState[]> = {
  analysis: ["queued", "analyzing"],
  review: ["awaiting_coding_approval", "awaiting_development_input", "changes_ready", "review_pending", "merging"],
  development: ["coding_queued", "coding", "testing", "awaiting_development_input", "publishing"],
};

const HUMAN_WAITING_STATES = ["awaiting_coding_approval", "awaiting_development_input", "changes_ready", "review_pending"] as const;
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
          <span>LOUVRE AI OFFICE · LIVE TEAMS</span>
          <h2 id="company-operations-title">실시간 오피스</h2>
        </div>
        <p>분석 · 검토 · 개발</p>
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
                  <HumanReviewQueue
                    jobs={jobs.filter((job) => HUMAN_WAITING_STATES.includes(job.state as (typeof HUMAN_WAITING_STATES)[number]))}
                    snapshot={humanBottleneck}
                    selectedJobId={props.selectedJobId}
                    onSelect={props.onSelect}
                    now={now}
                  />
                ) : (
                  <>
                    <TeamRoomScene teamId={team.id} hasWork={jobs.length > 0} />
                    {jobs.length > 0 ? (
                      <ol className="company-team-lane__inbox">
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
                      <p className="company-team-lane__empty">새 업무를 기다리는 중</p>
                    )}
                  </>
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

function HumanReviewQueue(props: {
  jobs: readonly OfficeJob[];
  snapshot: HumanBottleneckSnapshot;
  selectedJobId?: string;
  onSelect: (jobId: string) => void;
  now?: number;
}) {
  return (
    <div className="human-review-queue" data-level={props.snapshot.level}>
      <div className="human-review-queue__summary">
        <span><ClipboardList size={16} aria-hidden="true" /></span>
        <div>
          <small>REVIEW QUEUE</small>
          <strong>{props.snapshot.label}</strong>
          <p>{props.snapshot.detail}</p>
        </div>
      </div>
      {props.jobs.length > 0 ? (
        <ol className="human-review-queue__list" aria-label="사람 검토 대기 업무">
          {props.jobs.map((job) => (
            <li key={job.id} data-selected={job.id === props.selectedJobId ? "true" : "false"}>
              <button
                type="button"
                aria-pressed={job.id === props.selectedJobId}
                onClick={() => props.onSelect(job.id)}
              >
                <span>{getHumanGateLabel(job.state)}</span>
                <strong>{job.prompt}</strong>
                <small>{formatHumanWait(job, props.now)} · {getTeamActivity(job)}</small>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="human-review-queue__empty">검토를 기다리는 업무가 없습니다.</p>
      )}
    </div>
  );
}

function TeamRoomScene(props: { teamId: "analysis" | "development"; hasWork: boolean }) {
  const Icon = props.teamId === "analysis" ? BrainCircuit : Code2;
  return (
    <div className="team-room-scene" data-team={props.teamId} data-active={props.hasWork ? "true" : "false"} aria-hidden="true">
      <div className="team-room-scene__window"><span /><span /></div>
      <div className="team-room-scene__plant"><span /><i /></div>
      <div className="team-room-scene__desk">
        <span className="team-room-scene__monitor"><Icon size={22} /><i /></span>
        <span className="team-room-scene__keyboard" />
        <span className="team-room-scene__mug" />
        <span className="team-room-scene__person"><i /><b /></span>
      </div>
      <span className="team-room-scene__caption">{props.hasWork ? "업무 처리 중" : "다음 업무 대기"}</span>
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
      label: "검토 대기 업무",
      detail: `${waiting.length}건 · ${waitLabel}`,
    }
    : {
      level: "watch",
      waitingCount: waiting.length,
      oldestWaitMinutes,
      label: "검토 대기 업무",
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
  if (state === "awaiting_development_input") return "개발팀 질문";
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
  if (job.state === "awaiting_development_input") return `${job.developmentPart === "opencode" ? "아르고" : "아틀라스"}가 개발 중 판단을 요청했습니다`;
  if (job.state === "changes_ready") return "변경 파일과 테스트 결과의 Git 승인이 필요합니다";
  if (job.state === "review_pending") return "GitHub PR 검토와 최종 결정이 필요합니다";
  if (job.state === "merging") return "승인된 PR의 머지 상태를 확인하는 중";
  if (job.state === "coding_queued") return job.queuePosition ? `개발팀 대기열 ${job.queuePosition}번째` : "배정된 개발 파트의 실행 순서를 기다리는 중";
  if (job.state === "coding") return job.events.at(-1)?.message ?? "배정된 개발 파트가 승인 범위의 코드를 수정하는 중";
  if (job.state === "testing") return "변경 코드의 허용된 테스트를 실행하는 중";
  return "승인된 변경을 Git에 반영하는 중";
}
