"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowUp, Check, Info, ListPlus, LoaderCircle, MessageCircleQuestion, RotateCcw, Zap } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";

import type { PocConnectionMode } from "../api/poc-client";
import { requestOrbitQuestions } from "../api/job-client";
import { OFFICE_COPY } from "../copy";
import { officeRequestSchema } from "../office-request-schema";
import {
  buildOrbitIntakeBrief,
  createOrbitQuestions,
  type OrbitAnswers,
  type OrbitQuestion,
} from "../orbit-intake";
import type { OfficeConnectionMode, OfficeRequestInput } from "../types";
import { MeetingRoom } from "./meeting-room";

type ComposerConnectionMode = OfficeConnectionMode | PocConnectionMode;

interface TaskComposerProps {
  isRunning: boolean;
  isSubmitting: boolean;
  connectionMode: ComposerConnectionMode;
  queueErrorMessage: string | null;
  onRequest: (input: OfficeRequestInput) => Promise<boolean>;
}

export function TaskComposer({ isRunning, isSubmitting, connectionMode, queueErrorMessage, onRequest }: TaskComposerProps) {
  const [meeting, setMeeting] = useState<{
    request: string;
    questions: readonly OrbitQuestion[];
    answers: OrbitAnswers;
    questionIndex: number;
    phase: "questions" | "review";
    source: "company-opencode" | "fallback";
    model?: string;
    notice?: string;
  } | null>(null);
  const [answer, setAnswer] = useState("");
  const [isPreparingMeeting, setIsPreparingMeeting] = useState(false);
  const form = useForm<OfficeRequestInput>({
    resolver: zodResolver(officeRequestSchema),
    defaultValues: { request: "" },
  });

  const startMeeting = form.handleSubmit(async (input) => {
    if (isPreparingMeeting) return;
    setIsPreparingMeeting(true);
    const controller = new AbortController();
    try {
      const generated = await requestOrbitQuestions(input.request, controller.signal);
      setMeeting({
        request: input.request,
        questions: generated.questions,
        answers: {},
        questionIndex: 0,
        phase: "questions",
        source: generated.source,
        model: generated.model,
      });
    } catch {
      setMeeting({
        request: input.request,
        questions: createOrbitQuestions(input.request),
        answers: {},
        questionIndex: 0,
        phase: "questions",
        source: "fallback",
        notice: OFFICE_COPY.composer.meetingFallbackNotice,
      });
    } finally {
      setAnswer("");
      setIsPreparingMeeting(false);
    }
  });

  const quickSubmit = form.handleSubmit(async (input) => {
    const intakeBrief = buildOrbitIntakeBrief(input.request);
    if (await onRequest({ ...input, intakeBrief })) form.reset();
  });

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter") return;
    event.preventDefault();
    void startMeeting();
  }

  const brief = useMemo(
    () => meeting ? buildOrbitIntakeBrief(meeting.request, meeting.answers) : null,
    [meeting],
  );

  async function confirmBrief() {
    if (!meeting || !brief) return;
    if (await onRequest({ request: meeting.request, intakeBrief: brief })) {
      form.reset();
      setMeeting(null);
      setAnswer("");
    }
  }

  function answerQuestion(value: string) {
    if (!meeting) return;
    const question = meeting.questions[meeting.questionIndex];
    if (!question) return;
    const answers = { ...meeting.answers, [question.id]: value.trim() };
    const nextIndex = meeting.questionIndex + 1;
    setMeeting({
      ...meeting,
      answers,
      questionIndex: Math.min(nextIndex, meeting.questions.length - 1),
      phase: nextIndex >= meeting.questions.length ? "review" : "questions",
    });
    setAnswer(nextIndex >= meeting.questions.length
      ? ""
      : answers[meeting.questions[nextIndex]?.id ?? "behavior"] ?? "");
  }

  function reviseAnswers() {
    if (!meeting) return;
    const first = meeting.questions[0];
    setMeeting({ ...meeting, phase: "questions", questionIndex: 0 });
    setAnswer(first ? meeting.answers[first.id] ?? "" : "");
  }

  const error = form.formState.errors.request;
  const errorMessage = error?.message ?? queueErrorMessage;

  if (meeting) {
    const question = meeting.questions[meeting.questionIndex];
    return (
      <MeetingRoom
        id="orbit-meeting-title"
        className="task-composer task-composer--meeting"
        theme="orbit"
        eyebrow={OFFICE_COPY.composer.meetingEyebrow}
        title={meeting.phase === "review" ? OFFICE_COPY.composer.reviewTitle : OFFICE_COPY.composer.meetingTitle}
        description={meeting.phase === "review" ? OFFICE_COPY.composer.reviewDescription : OFFICE_COPY.composer.meetingDescription}
        hostName="오비트"
        hostRole="분석팀장"
        hostModel={meeting.model}
        sourceLabel={meeting.source === "company-opencode"
          ? OFFICE_COPY.composer.meetingModelSource
          : OFFICE_COPY.composer.meetingFallbackSource}
        onClose={() => setMeeting(null)}
      >
        {meeting.notice && <p className="orbit-meeting__notice" role="status">{meeting.notice}</p>}
        {meeting.phase === "questions" && question ? (
          <form className="orbit-question" onSubmit={(event) => { event.preventDefault(); answerQuestion(answer); }}>
            <div className="orbit-question__progress" aria-label={`질문 ${meeting.questionIndex + 1}/${meeting.questions.length}`}>
              {meeting.questions.map((item, index) => (
                <span key={item.id} className={index <= meeting.questionIndex ? "is-active" : ""} />
              ))}
            </div>
            <p className="orbit-question__request"><span>의뢰</span>{meeting.request}</p>
            <label htmlFor="orbit-answer">{question.prompt}</label>
            <small>{question.hint}</small>
            <textarea
              id="orbit-answer"
              autoFocus
              maxLength={700}
              rows={2}
              value={answer}
              placeholder={question.placeholder}
              onChange={(event) => setAnswer(event.target.value)}
            />
            <div className="orbit-question__actions">
              {meeting.questionIndex > 0 && (
                <button type="button" onClick={() => {
                  const previousIndex = meeting.questionIndex - 1;
                  const previous = meeting.questions[previousIndex];
                  setMeeting({ ...meeting, questionIndex: previousIndex });
                  setAnswer(previous ? meeting.answers[previous.id] ?? "" : "");
                }}><ArrowLeft size={15} />이전</button>
              )}
              <button type="button" onClick={() => answerQuestion("")}>모름 · 팀이 확인</button>
              <button className="is-primary" type="submit">
                {meeting.questionIndex + 1 === meeting.questions.length ? <Check size={16} /> : <ArrowUp size={16} />}
                {meeting.questionIndex + 1 === meeting.questions.length ? "브리프 확인" : "다음 질문"}
              </button>
            </div>
          </form>
        ) : brief ? (
          <div className="orbit-brief">
            <p className="orbit-brief__request"><span>ORIGINAL REQUEST</span>{meeting.request}</p>
            <dl>
              <BriefRow label="목표" value={brief.objective} />
              <BriefRow label="동작 변화" value={brief.currentAndExpectedBehavior} />
              <BriefRow label="레포·문서" value={brief.repositoryContext} />
              <BriefRow label="완료·테스트" value={brief.acceptanceAndTests} />
              {brief.assumptions.length > 0 && <BriefRow label="분석팀 확인" value={brief.assumptions.join(" · ")} />}
            </dl>
            <div className="orbit-brief__actions">
              <button type="button" onClick={reviseAnswers}><RotateCcw size={15} />{OFFICE_COPY.composer.reviseBrief}</button>
              <button className="is-primary" type="button" disabled={isSubmitting} onClick={() => void confirmBrief()}>
                {isRunning ? <ListPlus size={16} /> : <Check size={16} />}{OFFICE_COPY.composer.confirmBrief}
              </button>
            </div>
          </div>
        ) : null}
        {queueErrorMessage && <p className="task-composer__error" role="alert">{queueErrorMessage}</p>}
      </MeetingRoom>
    );
  }

  return (
    <form className="task-composer" onSubmit={startMeeting} noValidate>
      <div className="task-composer__heading">
        <div>
          <span>{OFFICE_COPY.hero.eyebrow}</span>
          <label htmlFor="office-request">{OFFICE_COPY.composer.label}</label>
        </div>
        <small>{OFFICE_COPY.composer.shortcut}</small>
      </div>
      <p className="poc-truth-note">
        <Info size={14} aria-hidden="true" />
        <span>{getPocTruthLabel(connectionMode)}</span>
      </p>
      <div className={`task-composer__field ${errorMessage ? "has-error" : ""}`}>
        <textarea
          id="office-request"
          maxLength={2_000}
          rows={2}
          placeholder={OFFICE_COPY.composer.placeholder}
          aria-invalid={Boolean(errorMessage)}
          aria-describedby={errorMessage ? "office-request-error" : undefined}
          onKeyDown={handleComposerKeyDown}
          {...form.register("request")}
        />
        <button type="submit" disabled={isSubmitting || isPreparingMeeting}>
          {isPreparingMeeting
            ? <LoaderCircle className="is-spinning" size={19} strokeWidth={2.2} aria-hidden="true" />
            : <MessageCircleQuestion size={19} strokeWidth={2.2} aria-hidden="true" />}
          <span>{isPreparingMeeting ? "질문 준비 중" : OFFICE_COPY.composer.submit}</span>
        </button>
      </div>
      {isPreparingMeeting && <p className="orbit-preflight-status" role="status">{OFFICE_COPY.composer.meetingPreparing}</p>}
      <button className="task-composer__quick" type="button" disabled={isSubmitting} onClick={() => void quickSubmit()}>
        <Zap size={14} aria-hidden="true" />{OFFICE_COPY.composer.quickSubmit}
        <small>질문 없이 기본 가정으로 대기열 등록</small>
      </button>
      {errorMessage ? (
        <p className="task-composer__error" id="office-request-error" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </form>
  );
}

function BriefRow({ label, value }: { label: string; value: string | undefined }) {
  if (!value) return null;
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

export function getPocTruthLabel(connectionMode: ComposerConnectionMode): string {
  return OFFICE_COPY.composer.pocTruth[connectionMode];
}
