import {
  ArrowRight,
  FileCheck2,
  FileText,
  GitCommitHorizontal,
  RotateCcw,
  Send,
  X,
} from "lucide-react";

import { getJobAnalysisResult } from "../job-analysis";
import type { OfficeCapabilities, OfficeJob, OfficeJobAction, OfficeResult, PublishMode } from "../types";

interface ReviewDispatchDeskProps {
  job: OfficeJob | null;
  capabilities: OfficeCapabilities;
  busy: boolean;
  onAction: (job: OfficeJob, action: OfficeJobAction, mode?: PublishMode) => void;
  onAnalysisOpen: (result: OfficeResult) => void;
}

export function ReviewDispatchDesk(props: ReviewDispatchDeskProps) {
  const analysisResult = props.job ? getJobAnalysisResult(props.job) : null;
  return (
    <section className="review-dispatch" aria-labelledby="review-dispatch-title" data-state={props.job?.state ?? "empty"}>
      <header>
        <small>HUMAN GATE</small>
        <h2 id="review-dispatch-title">검토 · 전달 데스크</h2>
        <p>코드 수정과 Git 반영은 당신이 승인해야 시작됩니다.</p>
      </header>
      <div className="review-packet" aria-hidden="true">
        <span className="review-packet__source">OpenCode</span>
        <span className="review-packet__paper"><FileText size={22} /></span>
        <ArrowRight size={18} />
        <span className="review-packet__destination">Claude</span>
      </div>
      <div className="review-dispatch__status" role="status">
        <span>{getReviewEyebrow(props.job)}</span>
        <strong>{getReviewTitle(props.job)}</strong>
        <p>{getReviewDescription(props.job)}</p>
      </div>
      {analysisResult && (
        <button className="review-dispatch__secondary" type="button" onClick={() => props.onAnalysisOpen(analysisResult)}>
          <FileCheck2 size={16} aria-hidden="true" />분석 패킷 확인
        </button>
      )}
      {canApproveCoding(props.job) && (
        <button
          className="review-dispatch__primary"
          type="button"
          disabled={props.busy}
          onClick={() => props.onAction(props.job as OfficeJob, "approve_coding")}
        >
          <Send size={17} aria-hidden="true" />Claude에게 구현 맡기기
        </button>
      )}
      {canPublishCommit(props.job, props.capabilities) && (
        <div className="review-dispatch__publish">
          <button
            className="review-dispatch__primary"
            type="button"
            disabled={props.busy}
            onClick={() => props.onAction(props.job as OfficeJob, "publish_changes", "commit")}
          >
            <GitCommitHorizontal size={17} aria-hidden="true" />Commit 승인
          </button>
          {canPublishAndPush(props.job, props.capabilities) && (
            <button
              className="review-dispatch__secondary"
              type="button"
              disabled={props.busy}
              onClick={() => props.onAction(props.job as OfficeJob, "publish_changes", "commit_and_push")}
            >
              Commit + Push 승인
            </button>
          )}
        </div>
      )}
      <RecoveryActions {...props} />
    </section>
  );
}

function RecoveryActions(props: ReviewDispatchDeskProps) {
  if (!props.job) return null;
  return (
    <div className="review-dispatch__recovery">
      {props.job.actions.retry && (
        <button type="button" disabled={props.busy} onClick={() => props.onAction(props.job as OfficeJob, "retry")}>
          <RotateCcw size={14} aria-hidden="true" />다시 시도
        </button>
      )}
      {props.job.actions.cancel && (
        <button type="button" disabled={props.busy} onClick={() => props.onAction(props.job as OfficeJob, "cancel")}>
          <X size={14} aria-hidden="true" />업무 취소
        </button>
      )}
    </div>
  );
}

export function canApproveCoding(job: OfficeJob | null): boolean {
  return job?.detailLevel !== "summary" &&
    job?.state === "awaiting_coding_approval" && job.actions.approveCoding;
}

function canPublishCommit(job: OfficeJob | null, capabilities: OfficeCapabilities): boolean {
  return job?.detailLevel !== "summary" &&
    job?.state === "changes_ready" && job.actions.publishCommit && capabilities.canCommit;
}

function canPublishAndPush(job: OfficeJob | null, capabilities: OfficeCapabilities): boolean {
  return Boolean(job?.actions.publishAndPush && capabilities.canPush);
}

function getReviewEyebrow(job: OfficeJob | null): string {
  if (!job) return "EMPTY DESK";
  if (job.state === "awaiting_coding_approval") return "PACKET READY";
  if (job.state === "changes_ready") return "CHANGES READY";
  if (job.state === "failed") return "ACTION NEEDED";
  return "LIVE HANDOFF";
}

function getReviewTitle(job: OfficeJob | null): string {
  if (!job) return "검토할 업무가 없습니다";
  if (job.state === "awaiting_coding_approval") return "구현 패킷이 도착했습니다";
  if (job.state === "changes_ready") return "코드와 테스트 결과가 도착했습니다";
  if (job.state === "completed") return "Git 반영이 끝났습니다";
  if (job.state === "failed") return "업무가 멈췄습니다";
  if (job.state === "canceled") return "취소된 업무입니다";
  return "팀이 업무를 처리하고 있습니다";
}

function getReviewDescription(job: OfficeJob | null): string {
  if (!job) return "오비트에게 업무를 맡기면 분석 패킷이 이곳에 도착합니다.";
  if (job.error) return job.error.message;
  if (job.state === "awaiting_coding_approval") return "내용을 확인한 뒤 승인하세요. 승인 전에는 Claude가 코드를 수정하지 않습니다.";
  if (job.state === "changes_ready") return "변경 파일, Diff, 테스트 결과를 확인한 뒤 Git 반영 범위를 선택하세요.";
  if (job.state === "completed") return job.coding?.pushed ? "Commit과 Push까지 승인대로 완료했습니다." : "Commit까지 승인대로 완료했습니다.";
  return job.events.at(-1)?.message ?? "현재 단계가 끝나면 이 데스크에서 다음 행동을 선택할 수 있습니다.";
}
