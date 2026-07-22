import { AlertTriangle, BriefcaseBusiness, RefreshCw } from "lucide-react";

import type {
  OfficeCapabilities,
  OfficeConnectionMode,
  OfficeJob,
  OfficeJobAction,
  OfficeRequestInput,
  OfficeResult,
  OfficeResultPreview,
  PublishMode,
} from "../types";
import { AnalysisOffice } from "./analysis-office";
import { ClaudeOffice } from "./claude-office";
import { ResultVault } from "./result-vault";
import { ReviewDispatchDesk } from "./review-dispatch-desk";
import { TaskComposer } from "./task-composer";
import { TaskQueueHistory } from "./task-queue-history";

interface OfficeFloorProps {
  jobs: readonly OfficeJob[];
  focusJob: OfficeJob | null;
  results: readonly OfficeResultPreview[];
  capabilities: OfficeCapabilities;
  connectionMode: OfficeConnectionMode;
  serverError: string | null;
  actionError: string | null;
  isSubmitting: boolean;
  busyJobId: string | null;
  onRequest: (input: OfficeRequestInput) => Promise<boolean>;
  onAction: (job: OfficeJob, action: OfficeJobAction, mode?: PublishMode, feedback?: string) => Promise<void>;
  onJobSelect: (jobId: string) => void;
  onResultOpen: (result: OfficeResult | OfficeResultPreview) => void;
  onRetryConnection: () => void;
}

export function OfficeFloor(props: OfficeFloorProps) {
  const hasActiveJobs = props.jobs.some((job) => !["completed", "failed", "canceled"].includes(job.state));
  const runtime = props.capabilities;
  return (
    <section className="office-room office-campus" aria-labelledby="office-floor-title" data-workflow-status={props.focusJob?.state ?? "idle"}>
      <div className="office-room__wash" aria-hidden="true" />
      <header className="office-campus__heading">
        <div>
          <span>LIVE AI CAMPUS</span>
          <h1 id="office-floor-title">분석에서 코딩까지, 한 사무실에서</h1>
          <p><BriefcaseBusiness size={15} aria-hidden="true" /><span>선택 업무</span><strong>{props.focusJob?.prompt ?? "새 업무를 기다리고 있어요"}</strong></p>
        </div>
      </header>
      <TaskComposer
        isRunning={hasActiveJobs}
        isSubmitting={props.isSubmitting}
        connectionMode={props.connectionMode}
        queueErrorMessage={props.actionError}
        onRequest={props.onRequest}
      />
      {props.serverError && (
        <div className="office-server-alert" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <div><strong>단일 서버에 연결할 수 없습니다</strong><p>{props.serverError}</p></div>
          <button type="button" onClick={props.onRetryConnection}><RefreshCw size={15} aria-hidden="true" />다시 연결</button>
        </div>
      )}
      <div className="office-campus__grid">
        <AnalysisOffice job={props.focusJob} runtimeLabel={runtime.analysisRuntimeLabel} />
        <ReviewDispatchDesk
          job={props.focusJob}
          capabilities={runtime}
          busy={props.busyJobId === props.focusJob?.id}
          onAction={(job, action, mode, feedback) => void props.onAction(job, action, mode, feedback)}
          onAnalysisOpen={props.onResultOpen}
        />
        <ClaudeOffice job={props.focusJob} runtimeLabel={runtime.codingRuntimeLabel} />
      </div>
      <div className="office-campus__operations">
        <TaskQueueHistory
          jobs={props.jobs}
          selectedJobId={props.focusJob?.id}
          busyJobId={props.busyJobId}
          onSelect={props.onJobSelect}
          onAction={(job, action) => void props.onAction(job, action)}
        />
        <ResultVault results={props.results} isReceiving={false} onOpen={props.onResultOpen} />
      </div>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {getAccessibleJobStatus(props.focusJob)}
      </p>
    </section>
  );
}

function getAccessibleJobStatus(job: OfficeJob | null): string {
  if (!job) return "새 업무를 기다리고 있습니다.";
  if (job.state === "awaiting_coding_approval") return "분석이 끝났습니다. Claude 구현 승인이 필요합니다.";
  if (job.state === "changes_ready") return "코딩과 테스트가 끝났습니다. Git 반영 승인이 필요합니다.";
  if (job.state === "review_pending") return "PR이 준비되었습니다. 최종 코드 검토와 머지 결정이 필요합니다.";
  if (job.state === "merging") return "최종 승인된 PR을 머지하고 있습니다.";
  if (job.state === "failed") return `업무가 멈췄습니다. ${job.error?.message ?? "오류 내용을 확인해 주세요."}`;
  return job.events.at(-1)?.message ?? `${job.prompt}, ${job.state} 상태입니다.`;
}
