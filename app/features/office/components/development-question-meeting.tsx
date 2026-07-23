"use client";

import { Check, MessageCircleQuestion } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import type { DevelopmentRole, OfficeJob } from "../types";
import { MeetingRoom } from "./meeting-room";

interface DevelopmentQuestionMeetingProps {
  job: OfficeJob;
  busy: boolean;
  onAnswer: (feedback: string) => void;
}

const ROLE_NAMES: Record<DevelopmentRole, string> = {
  lead: "아틀라스",
  implementation: "메이슨",
  verification: "베라",
  git: "릴레이",
};

const ROLE_LABELS: Record<DevelopmentRole, string> = {
  lead: "개발팀장",
  implementation: "구현 담당",
  verification: "검증 담당",
  git: "Git 담당",
};

export function DevelopmentQuestionMeeting({ job, busy, onAnswer }: DevelopmentQuestionMeetingProps) {
  const question = job.developmentQuestion;
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState("");

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

  if (!question || question.status !== "open") return null;
  const reporterName = ROLE_NAMES[question.raisedBy];

  if (!open) {
    return (
      <button
        className="review-dispatch__primary development-question-launch"
        type="button"
        disabled={busy}
        onClick={() => setOpen(true)}
      >
        <MessageCircleQuestion size={17} aria-hidden="true" />아틀라스 질문 확인
      </button>
    );
  }

  return createPortal(
    <MeetingRoom
      id={`development-question-${job.id}`}
      className="development-question-meeting"
      theme="development"
      eyebrow="HUMAN GATE · DEVELOPMENT CHECKPOINT"
      title={question.title}
      description="개발팀이 추측으로 진행하지 않고 사람의 판단을 기다리고 있습니다. 답변은 같은 업무 맥락에 합쳐져 개발팀으로 돌아갑니다."
      hostName="아틀라스"
      hostRole="개발팀장"
      hostModel="Claude Opus"
      sourceLabel={`${reporterName} ${ROLE_LABELS[question.raisedBy]} 보고`}
      modal
      onClose={() => setOpen(false)}
    >
      <form className="development-question" onSubmit={(event) => {
        event.preventDefault();
        const feedback = answer.trim();
        if (feedback) onAnswer(feedback);
      }}>
        <div className="development-question__brief">
          <small>{reporterName.toUpperCase()} → ATLAS → YOU</small>
          <strong>{question.question}</strong>
          <p>{question.context}</p>
        </div>
        {(question.evidence.length > 0 || question.attempted.length > 0) && (
          <div className="development-question__evidence">
            {question.evidence.length > 0 && (
              <section>
                <span>확인 근거</span>
                <ul>{question.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
              </section>
            )}
            {question.attempted.length > 0 && (
              <section>
                <span>이미 확인한 내용</span>
                <ul>{question.attempted.map((item) => <li key={item}>{item}</li>)}</ul>
              </section>
            )}
          </div>
        )}
        <label className="development-question__answer" htmlFor={`development-answer-${job.id}`}>
          <span>개발팀에 전달할 판단</span>
          <textarea
            id={`development-answer-${job.id}`}
            autoFocus
            rows={4}
            maxLength={4_000}
            value={answer}
            placeholder="결정할 범위, 허용할 동작, 확인할 스펙을 짧고 명확하게 적어 주세요."
            onChange={(event) => setAnswer(event.target.value)}
          />
        </label>
        <div className="development-question__actions">
          <small>답변 전에는 이 업무만 멈추며 다른 분석·개발 업무는 계속 진행됩니다.</small>
          <button type="submit" disabled={busy || answer.trim().length === 0}>
            <Check size={16} aria-hidden="true" />답변 전달 · 개발 재개
          </button>
        </div>
      </form>
    </MeetingRoom>,
    document.body,
  );
}
