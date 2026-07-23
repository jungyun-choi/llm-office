"use client";

import { ArrowLeft, ArrowUp, Check, MessageCircleQuestion, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import {
  buildDevelopmentMeetingBrief,
  createDevelopmentMeetingQuestions,
  type DevelopmentMeetingAnswers,
} from "../development-meeting";
import type { OfficeJob } from "../types";
import { MeetingRoom } from "./meeting-room";

interface DevelopmentLeadMeetingProps {
  job: OfficeJob;
  busy: boolean;
  onApprove: (feedback: string) => void;
}

export function DevelopmentLeadMeeting({ job, busy, onApprove }: DevelopmentLeadMeetingProps) {
  const questions = useMemo(() => createDevelopmentMeetingQuestions(job), [job]);
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState<DevelopmentMeetingAnswers>({});
  const [questionIndex, setQuestionIndex] = useState(0);
  const [phase, setPhase] = useState<"questions" | "review">("questions");
  const [answer, setAnswer] = useState("");
  const brief = useMemo(
    () => buildDevelopmentMeetingBrief(job, questions, answers),
    [answers, job, questions],
  );

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
      <button className="review-dispatch__primary development-meeting-launch" type="button" disabled={busy} onClick={() => setOpen(true)}>
        <MessageCircleQuestion size={17} aria-hidden="true" />아틀라스 팀장과 개발 미팅
      </button>
    );
  }

  const question = questions[questionIndex];
  return createPortal(
    <MeetingRoom
      id={`development-meeting-${job.id}`}
      className="development-lead-meeting"
      theme="development"
      eyebrow="HUMAN GATE 1 · DEVELOPMENT PREFLIGHT"
      title={phase === "review" ? "개발 브리프를 함께 확인합니다" : "아틀라스 팀장과 구현을 점검합니다"}
      description={phase === "review"
        ? "확정된 보완 내용만 개발팀 전체에 전달해 불필요한 모델 턴을 줄입니다."
        : "분석 패킷을 함께 보고 이해가 부족한 부분, 범위와 완료 조건을 구현 전에 맞춥니다."}
      hostName="아틀라스"
      hostRole="개발팀장"
      hostModel="Claude Opus"
      sourceLabel="분석 패킷 기반 개발 미팅"
      modal
      onClose={() => setOpen(false)}
    >
      {phase === "questions" && question ? (
        <form className="orbit-question development-meeting-question" onSubmit={(event) => {
          event.preventDefault();
          answerQuestion(answer);
        }}>
          <div className="orbit-question__progress" aria-label={`질문 ${questionIndex + 1}/${questions.length}`}>
            {questions.map((item, index) => <span key={item.id} className={index <= questionIndex ? "is-active" : ""} />)}
          </div>
          <p className="orbit-question__request"><span>ANALYSIS PACKET</span>{brief.packetSummary}</p>
          <label htmlFor={`development-meeting-answer-${job.id}`}>{question.prompt}</label>
          <small>{question.hint}</small>
          <textarea
            id={`development-meeting-answer-${job.id}`}
            autoFocus
            maxLength={900}
            rows={3}
            value={answer}
            placeholder={question.placeholder}
            onChange={(event) => setAnswer(event.target.value)}
          />
          <div className="orbit-question__actions">
            {questionIndex > 0 && (
              <button type="button" onClick={goPrevious}><ArrowLeft size={15} />이전</button>
            )}
            <button type="button" onClick={() => answerQuestion("")}>패킷대로 진행</button>
            <button className="is-primary" type="submit">
              {questionIndex + 1 === questions.length ? <Check size={16} /> : <ArrowUp size={16} />}
              {questionIndex + 1 === questions.length ? "브리프 확인" : "다음 질문"}
            </button>
          </div>
        </form>
      ) : (
        <div className="orbit-brief development-meeting-brief">
          <p className="orbit-brief__request"><span>DEVELOPMENT OBJECTIVE</span>{brief.objective}</p>
          <dl>
            <div><dt>분석 범위</dt><dd>{brief.packetSummary}</dd></div>
            <div>
              <dt>미팅 보완</dt>
              <dd>{brief.clarifications.length > 0 ? brief.clarifications.join(" · ") : "추가 보완 없음 · 분석 패킷 기준"}</dd>
            </div>
            <div><dt>전달 대상</dt><dd>아틀라스 계획 → 메이슨 구현 → 베라 검증 → 릴레이 Git</dd></div>
          </dl>
          <div className="orbit-brief__actions">
            <button type="button" onClick={revise}><RotateCcw size={15} />답변 다시 보기</button>
            <button className="is-primary" type="button" disabled={busy} onClick={() => onApprove(brief.feedback)}>
              <Check size={16} />브리프 확정 · 구현 승인
            </button>
          </div>
        </div>
      )}
    </MeetingRoom>,
    document.body,
  );

  function answerQuestion(value: string) {
    if (!question) return;
    const nextAnswers = { ...answers, [question.id]: value.trim() };
    const nextIndex = questionIndex + 1;
    setAnswers(nextAnswers);
    setQuestionIndex(Math.min(nextIndex, questions.length - 1));
    setPhase(nextIndex >= questions.length ? "review" : "questions");
    const nextQuestion = questions[nextIndex];
    setAnswer(nextQuestion ? nextAnswers[nextQuestion.id] ?? "" : "");
  }

  function goPrevious() {
    const previousIndex = Math.max(0, questionIndex - 1);
    const previous = questions[previousIndex];
    setQuestionIndex(previousIndex);
    setAnswer(previous ? answers[previous.id] ?? "" : "");
  }

  function revise() {
    const first = questions[0];
    setQuestionIndex(0);
    setPhase("questions");
    setAnswer(first ? answers[first.id] ?? "" : "");
  }
}
