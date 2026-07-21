import { ArrowRight, CircleSlash2, ListFilter, Timer } from "lucide-react";

import { QUEUE_FILTER_LABELS, UI_COPY } from "../copy";
import type { Agent, AgentId, QueueFilter, Task } from "../types";
import { getAgent } from "../utils";
import { TaskBadge } from "./status-badge";

interface QueueSectionProps {
  agents: Agent[];
  tasks: Task[];
  selectedAgentId: AgentId | null;
  filter: QueueFilter;
  onFilterChange: (filter: QueueFilter) => void;
  onTaskOpen: (taskId: string) => void;
}

const FILTERS: QueueFilter[] = ["all", "active", "approval", "blocked"];

export function QueueSection(props: QueueSectionProps) {
  const selectedAgent = props.agents.find((agent) => agent.id === props.selectedAgentId);
  return (
    <section className="panel queue-panel" id="queue" aria-labelledby="queue-title">
      <div className="section-heading queue-heading"><div><span className="section-icon"><ListFilter size={16} /></span><div><h2 id="queue-title">{UI_COPY.queueTitle}</h2><p>{selectedAgent ? `${selectedAgent.name}에게 할당된 준비 업무` : UI_COPY.queueDescription}</p></div></div><div className="queue-count"><strong>{props.tasks.length}</strong><span>ITEMS</span></div></div>
      <div className="queue-filters" role="group" aria-label="업무 상태 필터">{FILTERS.map((filter) => <button key={filter} className={props.filter === filter ? "is-active" : ""} onClick={() => props.onFilterChange(filter)} aria-pressed={props.filter === filter}>{QUEUE_FILTER_LABELS[filter]}</button>)}</div>
      {props.tasks.length > 0 ? <div className="task-list">{props.tasks.map((task) => <TaskCard key={task.id} task={task} agent={getAgent(props.agents, task.assigneeId)} onOpen={props.onTaskOpen} />)}</div> : <EmptyQueue />}
    </section>
  );
}

function TaskCard({ task, agent, onOpen }: { task: Task; agent: Agent; onOpen: (taskId: string) => void }) {
  return (
    <button className={`task-card ${task.blockedReason ? "is-blocked" : ""}`} onClick={() => onOpen(task.id)}>
      <div className="task-card__main"><div className="task-card__badges"><TaskBadge priority={task.priority} /><TaskBadge stage={task.stage} />{task.blockedReason && <span className="blocked-chip"><CircleSlash2 size={12} />차단</span>}</div><span className="task-card__id">{task.id}</span><h3>{task.title}</h3><p>{task.brief}</p><div className="tag-list">{task.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></div>
      <div className="task-card__side"><span className={`mini-avatar agent-avatar--${agent.id}`}>{agent.name.slice(0, 1)}</span><div><span>{agent.name}</span><small>{agent.role}</small></div><span className="task-due"><Timer size={13} />{task.dueLabel}</span><div className="task-progress"><span><b>{task.progress}%</b> 완료</span><i><em style={{ width: `${task.progress}%` }} /></i></div><ArrowRight className="task-arrow" size={17} /></div>
    </button>
  );
}

function EmptyQueue() {
  return <div className="empty-state"><CircleSlash2 size={24} /><strong>{UI_COPY.noTasksTitle}</strong><p>{UI_COPY.noTasksDescription}</p></div>;
}
