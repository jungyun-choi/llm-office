import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Code2,
  FileCheck2,
  GitCommitHorizontal,
  GitPullRequest,
  LoaderCircle,
  MessageSquareText,
  TestTube2,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { OFFICE_AGENTS } from "../office-data";
import type { OfficeJob, OfficeJobAction, OfficeJobState } from "../types";

interface TaskQueueHistoryProps {
  jobs: readonly OfficeJob[];
  selectedJobId?: string;
  busyJobId: string | null;
  onSelect: (jobId: string) => void;
  onAction: (job: OfficeJob, action: OfficeJobAction) => void;
}

const TERMINAL_STATES: readonly OfficeJobState[] = ["completed", "failed", "canceled"];
const STATUS_ICONS: Record<OfficeJobState, LucideIcon> = {
  queued: Clock3,
  analyzing: LoaderCircle,
  awaiting_coding_approval: FileCheck2,
  coding_queued: Clock3,
  coding: Code2,
  testing: TestTube2,
  awaiting_development_input: MessageSquareText,
  changes_ready: FileCheck2,
  publishing: GitCommitHorizontal,
  review_pending: GitPullRequest,
  merging: GitCommitHorizontal,
  completed: CheckCircle2,
  failed: AlertCircle,
  canceled: XCircle,
};

export function TaskQueueHistory(props: TaskQueueHistoryProps) {
  const activeJobs = props.jobs.filter((job) => !TERMINAL_STATES.includes(job.state));
  const historyJobs = props.jobs.filter((job) => TERMINAL_STATES.includes(job.state)).slice(0, 20);
  const queuedCount = props.jobs.filter((job) => job.state === "queued").length;
  return (
    <section className="task-queue-history" aria-labelledby="task-queue-title">
      <header>
        <div><span>SERVER WORK QUEUE</span><strong id="task-queue-title">업무 대기열 · 히스토리</strong></div>
        <small>{queuedCount}건 대기</small>
      </header>
      <div className="task-queue-history__scroll" tabIndex={0} aria-label="업무 대기열과 최근 히스토리">
        {props.jobs.length === 0 && <p className="task-queue-history__empty">맡긴 업무가 서버 대기열에 순서대로 쌓입니다.</p>}
        <JobList {...props} label="진행 중인 업무" jobs={activeJobs} />
        {historyJobs.length > 0 && (
          <>
            <div className="task-queue-history__section-heading">
              <span className="task-queue-history__section-label">최근 히스토리</span>
            </div>
            <JobList {...props} label="최근 히스토리" jobs={historyJobs} />
          </>
        )}
      </div>
    </section>
  );
}

interface JobListProps extends TaskQueueHistoryProps {
  label: string;
  jobs: readonly OfficeJob[];
}

function JobList(props: JobListProps) {
  if (props.jobs.length === 0) return null;
  return (
    <ol aria-label={props.label}>
      {props.jobs.map((job) => (
        <JobItem key={job.id} job={job} {...props} />
      ))}
    </ol>
  );
}

interface JobItemProps extends TaskQueueHistoryProps {
  job: OfficeJob;
}

function JobItem({ job, selectedJobId, busyJobId, onSelect, onAction }: JobItemProps) {
  const Icon = STATUS_ICONS[job.state];
  const analysisProgress = getAnalysisProgress(job);
  return (
    <li data-status={job.state} data-selected={job.id === selectedJobId ? "true" : "false"}>
      <button className="task-queue-history__item-body" type="button" onClick={() => onSelect(job.id)}>
        <Icon className={isWorkingState(job.state) ? "is-spinning" : ""} size={14} aria-hidden="true" />
        <span>
          <small>{getJobStateLabel(job.state)}{job.queuePosition ? ` · ${job.queuePosition}번째` : ""}</small>
          <strong>{job.prompt}</strong>
        </span>
        {analysisProgress && <em>{analysisProgress}</em>}
        {job.error && <p role="alert">{job.error.code ? `${job.error.code} · ` : ""}{job.error.message}</p>}
      </button>
      <InlineAction job={job} busy={busyJobId === job.id} onAction={onAction} />
    </li>
  );
}

function getAnalysisProgress(job: OfficeJob): string | undefined {
  if (job.state !== "analyzing" || job.analysisStages.length === 0) return undefined;
  const running = job.analysisStages.find((stage) => stage.status === "running");
  if (!running) return "순차 분석 준비 중";
  const name = OFFICE_AGENTS.find((agent) => agent.id === running.id)?.name ?? running.id;
  const completed = job.analysisStages.filter((stage) => stage.status === "completed").length;
  return `${completed}/${job.analysisStages.length} · ${name} 작업 중`;
}

function InlineAction(props: { job: OfficeJob; busy: boolean; onAction: JobItemProps["onAction"] }) {
  if (props.job.actions.retry) {
    return <button className="task-queue-history__cancel" type="button" disabled={props.busy} onClick={() => props.onAction(props.job, "retry")}>다시 시도</button>;
  }
  if (props.job.actions.cancel) {
    return <button className="task-queue-history__cancel" type="button" disabled={props.busy} onClick={() => props.onAction(props.job, "cancel")}>업무 취소</button>;
  }
  return null;
}

export function getJobStateLabel(state: OfficeJobState): string {
  const labels: Record<OfficeJobState, string> = {
    queued: "분석 대기", analyzing: "OpenCode 분석 중", awaiting_coding_approval: "구현 승인 대기",
    coding_queued: "개발 대기", coding: "구현 중", testing: "테스트 중",
    awaiting_development_input: "개발팀 질문 대기",
    changes_ready: "Git 승인 대기", publishing: "Git 반영 중", review_pending: "PR 최종 검토", merging: "PR 머지 중", completed: "완료",
    failed: "문제 발생", canceled: "취소",
  };
  return labels[state];
}

function isWorkingState(state: OfficeJobState): boolean {
  return ["analyzing", "coding", "testing", "publishing", "merging"].includes(state);
}
