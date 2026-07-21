import { ArrowRight, GitPullRequestArrow, Workflow } from "lucide-react";

import { UI_COPY } from "../copy";
import { PIPELINE_STAGES } from "../mock-data";
import type { Task, TaskStage } from "../types";

interface PipelineBoardProps {
  tasks: Task[];
  selectedStage: TaskStage | null;
  onStageSelect: (stage: TaskStage | null) => void;
}

export function PipelineBoard({ tasks, selectedStage, onStageSelect }: PipelineBoardProps) {
  return (
    <section className="panel pipeline-panel" id="pipeline" aria-labelledby="pipeline-title">
      <div className="section-heading"><div><span className="section-icon"><Workflow size={16} /></span><div><h2 id="pipeline-title">{UI_COPY.pipelineTitle}</h2><p>{UI_COPY.pipelineDescription}</p></div></div>{selectedStage && <button className="text-button" onClick={() => onStageSelect(null)}>필터 해제</button>}</div>
      <div className="pipeline-flow">{PIPELINE_STAGES.map((stage, index) => <PipelineStageCard key={stage.id} stage={stage} count={tasks.filter((task) => task.stage === stage.id).length} isSelected={selectedStage === stage.id} onSelect={onStageSelect} showArrow={index < PIPELINE_STAGES.length - 1} />)}</div>
      <div className="pipeline-note"><GitPullRequestArrow size={15} /><span>현재 병목</span><strong>승인 대기 3건</strong><p>평균 대기 1시간 15분 · SLA 4시간 이내</p></div>
    </section>
  );
}

function PipelineStageCard({ stage, count, isSelected, onSelect, showArrow }: { stage: (typeof PIPELINE_STAGES)[number]; count: number; isSelected: boolean; onSelect: (stage: TaskStage) => void; showArrow: boolean }) {
  return <div className="pipeline-stage-wrap"><button className={`pipeline-stage ${isSelected ? "is-selected" : ""}`} onClick={() => onSelect(stage.id)} aria-pressed={isSelected}><span>{stage.shortLabel}</span><strong>{count}</strong><small>{stage.description}</small></button>{showArrow && <ArrowRight className="pipeline-arrow" size={14} aria-hidden="true" />}</div>;
}
