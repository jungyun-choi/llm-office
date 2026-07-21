import {
  Blocks,
  Calculator,
  CheckCircle2,
  GitBranch,
  Search,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import { OFFICE_COPY } from "../copy";
import type { AgentFlowState, AgentId, OfficeAgent } from "../types";

const AGENT_ICONS: Record<AgentId, LucideIcon> = {
  orchestrator: Sparkles,
  research: Search,
  framework: Blocks,
  estimate: Calculator,
  test: CheckCircle2,
  git: GitBranch,
};

interface AgentDeskProps {
  agent: OfficeAgent;
  state: AgentFlowState;
  activity: string;
}

export function AgentDesk({ agent, state, activity }: AgentDeskProps) {
  const AgentIcon = AGENT_ICONS[agent.id];

  return (
    <li className={`agent-station agent-station--${agent.seat}`} data-state={state}>
      <article className="agent-station__content" aria-label={`${agent.name}, ${agent.role}`}>
        <div className="agent-desk-graphic" aria-hidden="true">
          <div className="desk-screen">
            <AgentIcon size={14} strokeWidth={2.2} />
            <span />
          </div>
          <div className="desk-surface"><span /></div>
          <div className="agent-person">
            <span className="agent-person__head" />
            <span className="agent-person__body" />
          </div>
        </div>
        <div className="agent-station__label">
          <div>
            <span>{agent.deskLabel}</span>
            <strong>{agent.name}</strong>
            <small>{agent.role} · {getAgentStateLabel(state)}</small>
          </div>
          <span className="agent-state-dot" aria-hidden="true" />
        </div>
        <p>{activity}</p>
      </article>
    </li>
  );
}

export function getAgentStateLabel(state: AgentFlowState): string {
  if (state === "error") return OFFICE_COPY.floor.error;
  if (state === "sending") return OFFICE_COPY.floor.activeSender;
  if (state === "receiving") return OFFICE_COPY.floor.activeReceiver;
  if (state === "complete") return OFFICE_COPY.floor.complete;
  return OFFICE_COPY.floor.idle;
}
