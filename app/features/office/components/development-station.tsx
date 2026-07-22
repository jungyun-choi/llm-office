import { CheckCircle2, Code2, GitCommitHorizontal, Sparkles, type LucideIcon } from "lucide-react";

import type { DevelopmentFlowState, DevelopmentStationId } from "../types";

const ICONS: Record<DevelopmentStationId, LucideIcon> = {
  claude: Sparkles,
  implementation: Code2,
  verification: CheckCircle2,
  publisher: GitCommitHorizontal,
};

interface DevelopmentStationProps {
  id: DevelopmentStationId;
  label: string;
  title: string;
  description: string;
  state: DevelopmentFlowState;
  lead?: boolean;
}

export function DevelopmentStation(props: DevelopmentStationProps) {
  const Icon = ICONS[props.id];
  return (
    <article
      className={`development-station ${props.lead ? "development-station--lead" : ""}`}
      data-station-id={props.id}
      data-state={props.state}
      aria-label={`${props.title}, ${getDevelopmentStateLabel(props.state)}`}
    >
      <div className="development-station__desk" aria-hidden="true">
        <span className="development-station__screen"><Icon size={props.lead ? 24 : 17} /></span>
        <span className="development-station__surface" />
        <span className="development-station__chair" />
      </div>
      <div className="development-station__copy">
        <span>{props.label}</span>
        <strong>{props.title}</strong>
        <small>{getDevelopmentStateLabel(props.state)}</small>
        <p>{props.description}</p>
      </div>
    </article>
  );
}

export function getDevelopmentStateLabel(state: DevelopmentFlowState): string {
  if (state === "queued") return "업무 대기";
  if (state === "working") return "작업 중";
  if (state === "waiting") return "승인 대기";
  if (state === "complete") return "완료";
  if (state === "error") return "문제 발생";
  return "자리에서 대기";
}
