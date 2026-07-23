"use client";

import { Check, MessageCircleQuestion, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import type { OfficeResult } from "../types";
import { MeetingRoom } from "./meeting-room";

interface AnalysisReviewMeetingProps {
  result: OfficeResult;
  busy: boolean;
  onSubmit: (feedback: string) => void;
}

export function AnalysisReviewMeeting({ result, busy, onSubmit }: AnalysisReviewMeetingProps) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [evidence, setEvidence] = useState("");
  const [expected, setExpected] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (!open) {
    return (
      <button className="analysis-review-launch" type="button" disabled={busy} onClick={() => setOpen(true)}>
        <MessageCircleQuestion size={18} aria-hidden="true" />오비트와 추가 분석 회의
      </button>
    );
  }

  return createPortal(
    <MeetingRoom
      id={`analysis-review-${result.id}`}
      className="analysis-review-meeting"
      theme="orbit"
      eyebrow="HUMAN GATE · ANALYSIS REVIEW"
      title="오비트와 분석 결과를 다시 점검합니다"
      description="이상한 점과 추가로 확인할 근거를 정리하면 현재 결과는 보관하고 같은 Job을 분석팀에 다시 보냅니다."
      hostName="오비트"
      hostRole="분석팀 오케스트레이터"
      sourceLabel={`분석 결과 · ${result.title}`}
      modal
      onClose={() => setOpen(false)}
    >
      <form className="analysis-review-form" onSubmit={(event) => {
        event.preventDefault();
        const compact = buildReviewFeedback(feedback, evidence, expected);
        if (compact) onSubmit(compact);
      }}>
        <div className="analysis-review-form__context">
          <small>CURRENT ANALYSIS</small>
          <strong>{result.title}</strong>
          <p>{result.summary}</p>
        </div>
        <label>
          <span>어떤 점이 이상하거나 부족한가요?</span>
          <textarea
            autoFocus
            required
            rows={4}
            maxLength={1_800}
            value={feedback}
            placeholder="예: DLD의 queue depth 조건과 결론이 맞지 않습니다. 해당 조건을 다시 확인해 주세요."
            onChange={(event) => setFeedback(event.target.value)}
          />
        </label>
        <div className="analysis-review-form__optional">
          <label>
            <span>추가로 확인할 자료·경로</span>
            <textarea
              rows={3}
              maxLength={900}
              value={evidence}
              placeholder="예: .LLM/DLD, common/buffer, TopView 시나리오 12"
              onChange={(event) => setEvidence(event.target.value)}
            />
          </label>
          <label>
            <span>기대하는 결과·판정 기준</span>
            <textarea
              rows={3}
              maxLength={900}
              value={expected}
              placeholder="예: 기존 결론의 유지·수정 여부를 코드 근거와 함께 명확히 정리"
              onChange={(event) => setExpected(event.target.value)}
            />
          </label>
        </div>
        <div className="analysis-review-form__actions">
          <button type="button" onClick={() => {
            setFeedback("");
            setEvidence("");
            setExpected("");
          }}>
            <RotateCcw size={15} aria-hidden="true" />다시 작성
          </button>
          <button className="is-primary" type="submit" disabled={busy || feedback.trim().length === 0}>
            <Check size={16} aria-hidden="true" />회의 확정 · 추가 분석 요청
          </button>
        </div>
      </form>
    </MeetingRoom>,
    document.body,
  );
}

export function buildReviewFeedback(feedback: string, evidence: string, expected: string): string {
  const lines = [
    "[오비트 후속 분석 회의]",
    `검토 의견: ${feedback.trim()}`,
    evidence.trim() ? `추가 확인 자료: ${evidence.trim()}` : undefined,
    expected.trim() ? `기대 결과: ${expected.trim()}` : undefined,
  ].filter(Boolean);
  return feedback.trim() ? lines.join("\n").slice(0, 4_000) : "";
}
