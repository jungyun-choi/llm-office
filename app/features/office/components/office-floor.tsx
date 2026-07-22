import { Activity, AlertTriangle, BriefcaseBusiness, Check, RefreshCw } from "lucide-react";
import type { CSSProperties } from "react";

import { OFFICE_COPY } from "../copy";
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
          <span>{OFFICE_COPY.floor.eyebrow}</span>
          <h1 id="office-floor-title">{OFFICE_COPY.floor.title}</h1>
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
      <WorkflowJourney job={props.focusJob} />
      <div className="office-section-heading">
        <span>LIVE TEAM FLOOR</span>
        <strong>두 팀의 현재 작업</strong>
        <p>분석 패킷이 검토 게이트를 거쳐 개발 사무실로 이동합니다.</p>
      </div>
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
      <div className="office-section-heading office-section-heading--records">
        <span>WORK LOG</span>
        <strong>대기 업무와 완료 기록</strong>
        <p>업무가 늘어나면 이 아래로 자연스럽게 쌓입니다.</p>
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

const WORKFLOW_STEPS = [
  { id: "intake", label: "업무 접수", description: "요청과 대기열" },
  { id: "analysis", label: "심층 분석", description: "DLD · 코드 · TopView" },
  { id: "approval", label: "구현 승인", description: "Human Gate 1" },
  { id: "development", label: "개발 · 검증", description: "Claude · 테스트 · Git" },
  { id: "review", label: "PR 검토", description: "Human Gate 2" },
  { id: "complete", label: "업무 완료", description: "머지 · 결과 보관" },
] as const;

type JourneyStepStatus = "pending" | "active" | "completed" | "failed";

function WorkflowJourney({ job }: { job: OfficeJob | null }) {
  const currentIndex = getJourneyStepIndex(job);
  const progress = currentIndex < 0 ? 0 : currentIndex / (WORKFLOW_STEPS.length - 1);
  const style = { "--workflow-progress": progress } as CSSProperties;
  return (
    <section
      className="workflow-journey"
      aria-labelledby="workflow-journey-title"
      data-state={job?.state ?? "idle"}
      style={style}
    >
      <header className="workflow-journey__header">
        <div>
          <span>LIVE WORKFLOW</span>
          <h2 id="workflow-journey-title">업무 흐름</h2>
        </div>
        <p><Activity size={16} aria-hidden="true" /><strong>{getJourneyHeadline(job)}</strong><span>{getJourneyNote(job)}</span></p>
      </header>
      <div className="workflow-journey__rail" aria-hidden="true"><span /></div>
      <ol>
        {WORKFLOW_STEPS.map((step, index) => {
          const status = getJourneyStepStatus(job, index, currentIndex);
          return (
            <li key={step.id} data-status={status} aria-current={status === "active" ? "step" : undefined}>
              <span className="workflow-journey__node" aria-hidden="true">
                {status === "completed" ? <Check size={15} /> : index + 1}
              </span>
              <span className="workflow-journey__copy">
                <strong>{step.label}</strong>
                <small>{step.description}</small>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function getJourneyStepIndex(job: OfficeJob | null): number {
  if (!job) return -1;
  if (job.state === "queued" || job.state === "canceled") return 0;
  if (job.state === "analyzing") return 1;
  if (job.state === "awaiting_coding_approval") return 2;
  if (["coding_queued", "coding", "testing"].includes(job.state)) return 3;
  if (["changes_ready", "publishing", "review_pending", "merging"].includes(job.state)) return 4;
  if (job.state === "completed") return 5;
  if (job.error?.stage === "analysis" || job.error?.stage === "queue") return 1;
  if (job.error?.stage === "publishing") return 4;
  return 3;
}

function getJourneyStepStatus(
  job: OfficeJob | null,
  index: number,
  currentIndex: number,
): JourneyStepStatus {
  if (!job || currentIndex < 0) return "pending";
  if (job.state === "completed") return "completed";
  if (index < currentIndex) return "completed";
  if (index > currentIndex) return "pending";
  if (job.state === "failed" || job.state === "canceled") return "failed";
  return "active";
}

function getJourneyHeadline(job: OfficeJob | null): string {
  if (!job) return "새 업무 대기";
  if (job.state === "failed") return "확인이 필요합니다";
  if (job.state === "canceled") return "업무가 취소됐습니다";
  return WORKFLOW_STEPS[getJourneyStepIndex(job)]?.label ?? "업무 진행 중";
}

function getJourneyNote(job: OfficeJob | null): string {
  if (!job) return "업무를 맡기면 단계별 이동이 여기에 표시됩니다.";
  if (job.state === "analyzing") {
    const running = job.analysisStages.find((stage) => stage.status === "running");
    return running?.summary ?? "전문 에이전트가 근거를 순서대로 정리하고 있습니다.";
  }
  if (job.state === "review_pending") return "GitHub PR을 확인한 뒤 수정 요청 또는 머지를 결정하세요.";
  if (job.state === "awaiting_coding_approval") return "분석 패킷을 확인하고 Claude 구현을 승인하세요.";
  if (job.state === "completed") return "코드와 결과가 보관함에 정리됐습니다.";
  return job.error?.message ?? job.events.at(-1)?.message ?? "현재 단계의 작업을 처리하고 있습니다.";
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
