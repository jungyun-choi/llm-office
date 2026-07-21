import { ChevronRight, RotateCw, UsersRound } from "lucide-react";

import { UI_COPY } from "../copy";
import type { Agent, AgentId, Task } from "../types";
import { AgentStatusBadge } from "./status-badge";

interface AgentGridProps {
  agents: Agent[];
  tasks: Task[];
  selectedId: AgentId | null;
  onSelect: (agentId: AgentId | null) => void;
}

export function AgentGrid({ agents, tasks, selectedId, onSelect }: AgentGridProps) {
  return (
    <section className="panel agent-panel" aria-labelledby="agent-title">
      <div className="section-heading"><div><span className="section-icon"><UsersRound size={16} /></span><div><h2 id="agent-title">{UI_COPY.agentSectionTitle}</h2><p>{UI_COPY.agentSectionDescription}</p></div></div>{selectedId && <button className="text-button" onClick={() => onSelect(null)}><RotateCw size={13} />{UI_COPY.clearAgent}</button>}</div>
      <div className="agent-grid">{agents.map((agent) => <AgentCard key={agent.id} agent={agent} task={tasks.find((task) => task.id === agent.currentTaskId)} isSelected={agent.id === selectedId} onSelect={onSelect} />)}</div>
    </section>
  );
}

function AgentCard({ agent, task, isSelected, onSelect }: { agent: Agent; task?: Task; isSelected: boolean; onSelect: (id: AgentId) => void }) {
  return (
    <button className={`agent-card ${isSelected ? "is-selected" : ""}`} onClick={() => onSelect(agent.id)} aria-pressed={isSelected}>
      <div className="agent-card__top"><span className={`agent-avatar agent-avatar--${agent.id}`}>{agent.name.slice(0, 1)}</span><div><strong>{agent.name}</strong><span>{agent.callSign}</span></div><AgentStatusBadge status={agent.status} /></div>
      <p className="agent-card__role">{agent.role}</p><p className="agent-card__task">{task?.title ?? "할당된 업무 없음"}</p>
      <div className="agent-card__meta"><span>큐 <b>{agent.queueCount}</b></span><span>부하 <b>{agent.load}%</b></span><span>{agent.lastActivity}</span><ChevronRight size={15} /></div>
    </button>
  );
}
