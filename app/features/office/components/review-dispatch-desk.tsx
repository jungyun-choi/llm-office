"use client";

import { useState } from "react";
import {
  ArrowRight,
  ExternalLink,
  FileCheck2,
  FileText,
  GitCommitHorizontal,
  GitMerge,
  MessageSquareText,
  RotateCcw,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";

import { getJobAnalysisResult } from "../job-analysis";
import type { OfficeCapabilities, OfficeJob, OfficeJobAction, OfficeResult, PublishMode } from "../types";

interface ReviewDispatchDeskProps {
  job: OfficeJob | null;
  capabilities: OfficeCapabilities;
  busy: boolean;
  onAction: (job: OfficeJob, action: OfficeJobAction, mode?: PublishMode, feedback?: string) => void;
  onAnalysisOpen: (result: OfficeResult) => void;
}

export function ReviewDispatchDesk(props: ReviewDispatchDeskProps) {
  const analysisResult = props.job ? getJobAnalysisResult(props.job) : null;
  return (
    <section className="review-dispatch" aria-labelledby="review-dispatch-title" data-state={props.job?.state ?? "empty"}>
      <header>
        <small>TEAM B · HUMAN REVIEW</small>
        <h2 id="review-dispatch-title">사용자 검토팀</h2>
        <p>구현 승인부터 Git 반영, PR 최종 결정까지 당신이 담당합니다.</p>
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
      {props.job?.state === "review_pending" && (
        <FinalReviewGate
          key={`${props.job.id}:${props.job.coding?.reviewRound ?? 0}`}
          {...props}
          job={props.job}
        />
      )}
      {props.job?.state === "completed" && (props.job.coding?.issueUrl ?? props.job.coding?.issueError) && (
        <p className="review-dispatch__issue">
          {props.job.coding?.issueUrl ? (
            <a href={props.job.coding.issueUrl} target="_blank" rel="noreferrer">
              <FileCheck2 size={14} aria-hidden="true" />Git 이슈 보기
            </a>
          ) : props.job.coding?.issueError}
        </p>
      )}
      <RecoveryActions {...props} />
    </section>
  );
}

function FinalReviewGate(props: ReviewDispatchDeskProps & { job: OfficeJob }) {
  const [feedback, setFeedback] = useState("");
  const [mergeConfirmationOpen, setMergeConfirmationOpen] = useState(false);
  const canRequestChanges = props.job.actions.requestChanges && feedback.trim().length > 0;
  const reviewRound = props.job.coding?.reviewRound ?? 0;
  return (
    <div className="final-review-gate" aria-labelledby="final-review-gate-title">
      <div className="final-review-gate__heading">
        <span>HUMAN GATE 2 · FINAL CODE REVIEW</span>
        <strong id="final-review-gate-title">PR 최종 코드 검토</strong>
        <p>GitHub에서 구현과 리뷰 코멘트를 확인한 뒤 수정 요청 또는 머지를 결정하세요.</p>
      </div>
      {props.job.coding?.pullRequestUrl ? (
        <a
          className="final-review-gate__pr-link"
          href={props.job.coding.pullRequestUrl}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={16} aria-hidden="true" />
          PR #{props.job.coding.pullRequestNumber ?? ""} GitHub에서 보기
        </a>
      ) : (
        <p className="final-review-gate__error" role="alert">
          {props.job.coding?.pullRequestError ?? "PR 링크가 아직 준비되지 않았습니다."}
        </p>
      )}
      <label className="final-review-gate__feedback">
        <span><MessageSquareText size={15} aria-hidden="true" />Claude 재개발 요청</span>
        <textarea
          value={feedback}
          maxLength={4_000}
          placeholder="GitHub 리뷰 내용을 요약하거나 수정 방향을 적어 주세요."
          onChange={(event) => setFeedback(event.target.value)}
        />
      </label>
      {mergeConfirmationOpen && (
        <p className="final-review-gate__confirmation" role="status">
          이 승인은 PR을 바로 머지합니다. GitHub 검토를 마쳤다면 한 번 더 확정하세요.
        </p>
      )}
      <div className="final-review-gate__actions">
        {mergeConfirmationOpen ? (
          <>
            <button
              className="review-dispatch__secondary"
              type="button"
              disabled={props.busy}
              onClick={() => setMergeConfirmationOpen(false)}
            >
              <RotateCcw size={15} aria-hidden="true" />검토로 돌아가기
            </button>
            <button
              className="review-dispatch__primary final-review-gate__merge-confirm"
              type="button"
              disabled={props.busy || !props.job.actions.mergePr}
              onClick={() => props.onAction(props.job, "merge_pr")}
            >
              <ShieldCheck size={16} aria-hidden="true" />PR 머지 확정
            </button>
          </>
        ) : (
          <>
            <button
              className="review-dispatch__secondary"
              type="button"
              disabled={props.busy || !canRequestChanges}
              onClick={() => props.onAction(props.job, "request_changes", undefined, feedback.trim())}
            >
              <RotateCcw size={15} aria-hidden="true" />개발팀에 재의뢰
            </button>
            <button
              className="review-dispatch__primary"
              type="button"
              disabled={props.busy || !props.job.actions.mergePr}
              onClick={() => setMergeConfirmationOpen(true)}
            >
              <GitMerge size={16} aria-hidden="true" />최종 머지 승인
            </button>
          </>
        )}
      </div>
      {reviewRound > 0 && (
        <small className="final-review-gate__round">재검토 {reviewRound}회차</small>
      )}
    </div>
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
  if (job.state === "review_pending") return "FINAL REVIEW";
  if (job.state === "merging") return "MERGING PR";
  if (job.state === "failed") return "ACTION NEEDED";
  return "LIVE HANDOFF";
}

function getReviewTitle(job: OfficeJob | null): string {
  if (!job) return "검토할 업무가 없습니다";
  if (job.state === "awaiting_coding_approval") return "구현 패킷이 도착했습니다";
  if (job.state === "changes_ready") return "코드와 테스트 결과가 도착했습니다";
  if (job.state === "review_pending") return "PR 최종 검토가 필요합니다";
  if (job.state === "merging") return "승인된 PR을 머지하고 있습니다";
  if (job.state === "completed") return job.coding?.pullRequestUrl ? "PR 머지가 완료됐습니다" : "Git 반영이 끝났습니다";
  if (job.state === "failed") return "업무가 멈췄습니다";
  if (job.state === "canceled") return "취소된 업무입니다";
  return "팀이 업무를 처리하고 있습니다";
}

function getReviewDescription(job: OfficeJob | null): string {
  if (!job) return "오비트에게 업무를 맡기면 분석 패킷이 이곳에 도착합니다.";
  if (job.error) return job.error.message;
  if (job.state === "awaiting_coding_approval") return "내용을 확인한 뒤 승인하세요. 승인 전에는 Claude가 코드를 수정하지 않습니다.";
  if (job.state === "changes_ready") return "변경 파일, Diff, 테스트 결과를 확인한 뒤 Git 반영 범위를 선택하세요.";
  if (job.state === "review_pending") return "PR 링크에서 구현과 리뷰 코멘트를 확인한 뒤 수정 요청 또는 최종 머지를 선택하세요.";
  if (job.state === "completed") return job.coding?.pullRequestUrl
    ? "최종 검토와 PR 머지까지 완료했습니다."
    : job.coding?.pushed
      ? "Commit과 Push까지 승인대로 완료했습니다."
      : "Commit까지 승인대로 완료했습니다.";
  return job.events.at(-1)?.message ?? "현재 단계가 끝나면 이 데스크에서 다음 행동을 선택할 수 있습니다.";
}
