import { BrainCircuit } from "lucide-react";

import { OFFICE_AGENTS } from "../office-data";
import type { AgentFlowState, AgentId, OfficeAnalysisStage, OfficeJob } from "../types";
import { AgentDesk } from "./agent-desk";

const ANALYSIS_STAGE_TOTAL = 6;

interface AnalysisOfficeProps {
  job: OfficeJob | null;
  runtimeLabel?: string;
}

export function AnalysisOffice({ job, runtimeLabel }: AnalysisOfficeProps) {
  return (
    <section className="campus-office campus-office--analysis" aria-labelledby="analysis-office-title">
      <header className="campus-office__header">
        <span className="campus-office__icon"><BrainCircuit size={18} aria-hidden="true" /></span>
        <div>
          <small>OFFICE A · ANALYSIS</small>
          <h2 id="analysis-office-title">OpenCode 분석 사무실</h2>
          <p>{runtimeLabel ?? "사내 OpenCode 분석 팀"}</p>
        </div>
        <OfficeStateBadge state={getAnalysisOfficeState(job)} />
      </header>
      <ul className="analysis-agent-grid" aria-label="OpenCode 분석 에이전트 좌석">
        {OFFICE_AGENTS.map((agent) => {
          const state = getAnalysisAgentState(agent.id, job);
          const stage = job ? getStage(agent.id, job) : undefined;
          return (
            <AgentDesk
              key={agent.id}
              agent={agent}
              state={state}
              stage={stage}
              activity={getAnalysisActivity(agent.id, agent.specialty, job, state)}
            />
          );
        })}
      </ul>
    </section>
  );
}

function OfficeStateBadge({ state }: { state: string }) {
  return <span className="campus-office__state">{state}</span>;
}

export function getAnalysisAgentState(agentId: AgentId, job: OfficeJob | null): AgentFlowState {
  if (!job || job.state === "canceled") return "idle";
  if (job.state === "queued") return agentId === "orchestrator" ? "receiving" : "idle";
  const stage = getStage(agentId, job);
  if (stage) {
    if (stage.status === "failed") return "error";
    if (stage.status === "completed") return "complete";
    if (stage.status === "running") return "receiving";
    return "idle";
  }
  if (job.state === "analyzing") return agentId === "orchestrator" ? "sending" : "receiving";
  if (job.state === "failed" && isAnalysisFailure(job)) {
    return agentId === "orchestrator" ? "error" : "idle";
  }
  return hasAnalysisFinished(job) ? "complete" : "idle";
}

function getAnalysisActivity(
  agentId: AgentId,
  specialty: string,
  job: OfficeJob | null,
  state: AgentFlowState,
): string {
  const stage = job ? getStage(agentId, job) : undefined;
  if (state === "error") return job?.error?.message ?? "분석 단계에서 작업이 멈췄어요";
  if (state === "complete") {
    return stage?.summary ?? (agentId === "orchestrator"
      ? "구현 패킷을 검토 데스크로 전달했어요"
      : "분석 근거 전달 완료");
  }
  if (state === "sending") return "요청을 전문 에이전트에게 분배하는 중";
  if (state === "receiving") {
    if (job?.state === "queued") return "분석 순서를 기다리는 중";
    return getRunningActivity(agentId);
  }
  if (stage?.status === "pending" && job?.state === "analyzing") return "선행 분석 결과를 기다리는 중";
  return specialty;
}

function getAnalysisOfficeState(job: OfficeJob | null): string {
  if (!job) return "대기";
  if (job.state === "queued") return `대기 ${job.queuePosition ?? ""}`.trim();
  if (job.state === "analyzing" && job.analysisStages.length > 0) {
    const completed = job.analysisStages.filter((stage) => stage.status === "completed").length;
    const running = job.analysisStages.find((stage) => stage.status === "running");
    const agent = running && OFFICE_AGENTS.find((candidate) => candidate.id === running.id);
    return `${completed}/${ANALYSIS_STAGE_TOTAL}${agent ? ` · ${agent.name} 진행` : " · 준비 중"}`;
  }
  if (job.state === "analyzing") return "분석 중";
  if (job.state === "failed" && isAnalysisFailure(job)) return "문제 발생";
  if (hasAnalysisFinished(job)) return "패킷 전달 완료";
  return "대기";
}

function getStage(agentId: AgentId, job: OfficeJob): OfficeAnalysisStage | undefined {
  return job.analysisStages.find((stage) => stage.id === agentId);
}

function getRunningActivity(agentId: AgentId): string {
  if (agentId === "research") return ".LLM·DLD·설계 근거를 깊게 조사하는 중";
  if (agentId === "framework") return "코드 구조와 SystemC 모델 영향을 분석하는 중";
  if (agentId === "estimate") return "TopView 패킷 흐름과 구현 범위를 산정하는 중";
  if (agentId === "test") return "회귀·경계·성능 검증 항목을 설계하는 중";
  if (agentId === "git") return "Claude 인계팩과 Git 초안을 구성하는 중";
  return "다섯 역할 결과를 최종 구현 패킷으로 조립하는 중";
}

function hasAnalysisFinished(job: OfficeJob): boolean {
  return Boolean(job.analysis) || [
    "awaiting_coding_approval", "coding_queued", "coding", "testing",
    "changes_ready", "publishing", "completed",
  ].includes(job.state);
}

function isAnalysisFailure(job: OfficeJob): boolean {
  return !job.coding || job.error?.stage === "analysis" || job.error?.stage === "queue";
}
