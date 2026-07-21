import { AGENT_STATUS_LABELS, PRIORITY_LABELS, STAGE_LABELS } from "../copy";
import type { AgentStatus, TaskPriority, TaskStage } from "../types";

interface AgentStatusBadgeProps {
  status: AgentStatus;
}

interface TaskBadgeProps {
  priority?: TaskPriority;
  stage?: TaskStage;
}

export function AgentStatusBadge({ status }: AgentStatusBadgeProps) {
  return (
    <span className={`status-badge status-badge--${status}`}>
      <span className="status-badge__dot" aria-hidden="true" />
      {AGENT_STATUS_LABELS[status]}
    </span>
  );
}

export function TaskBadge({ priority, stage }: TaskBadgeProps) {
  if (priority) {
    return <span className={`task-badge task-badge--${priority}`}>{PRIORITY_LABELS[priority]}</span>;
  }
  if (stage) {
    return <span className="task-badge task-badge--stage">{STAGE_LABELS[stage]}</span>;
  }
  return null;
}
