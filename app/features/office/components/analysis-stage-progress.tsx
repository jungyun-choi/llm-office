"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import type { AnalysisStagePhase, OfficeAnalysisStage } from "../types";
import { formatWorkflowElapsedTime } from "../workflow-elapsed-time";

interface AnalysisStageProgressProps {
  stage: OfficeAnalysisStage;
}

export function AnalysisStageProgress({ stage }: AnalysisStageProgressProps) {
  const elapsedSeconds = useStageElapsedSeconds(stage.startedAt);
  const phaseLabel = getAnalysisPhaseLabel(stage.phase);
  const elapsedLabel = elapsedSeconds === null
    ? "경과 계산 중"
    : `경과 ${formatWorkflowElapsedTime(elapsedSeconds)}`;

  return (
    <div
      className="agent-stage-progress"
      role="group"
      aria-label={`${phaseLabel}, ${elapsedLabel}${stage.attempt && stage.attempt > 1 ? `, ${stage.attempt}차 시도` : ""}`}
    >
      <span><LoaderCircle className="is-spinning" size={12} aria-hidden="true" />{phaseLabel}</span>
      <time dateTime={stage.startedAt}>{elapsedLabel}</time>
      {stage.attempt && stage.attempt > 1 ? <small>{stage.attempt}차 시도</small> : null}
    </div>
  );
}

export function getAnalysisPhaseLabel(phase?: AnalysisStagePhase): string {
  if (phase === "preparing_context") return "컨텍스트 준비";
  if (phase === "calling_model") return "사내 LLM 응답 대기";
  if (phase === "validating_output") return "결과 검증";
  return "사내 LLM 작업 중";
}

function useStageElapsedSeconds(startedAt?: string): number | null {
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    const startedAtMs = startedAt ? Date.parse(startedAt) : Number.NaN;
    if (!Number.isFinite(startedAtMs)) return;

    const updateNow = () => setNowMs(Date.now());
    const timeoutId = window.setTimeout(updateNow, 0);
    const intervalId = window.setInterval(updateNow, 1_000);
    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
    };
  }, [startedAt]);

  const startedAtMs = startedAt ? Date.parse(startedAt) : Number.NaN;
  if (nowMs === null || !Number.isFinite(startedAtMs)) return null;
  return Math.max(0, Math.floor((nowMs - startedAtMs) / 1_000));
}
