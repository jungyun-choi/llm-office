import { AlertCircle, CheckCircle2, Clock3, LoaderCircle } from "lucide-react";

import { OFFICE_COPY } from "../copy";
import { OFFICE_AGENTS } from "../office-data";
import type { OfficeResult, OfficeTask, OfficeTaskStatus } from "../types";

interface TaskQueueHistoryProps {
  tasks: readonly OfficeTask[];
  onResultOpen: (result: OfficeResult) => void;
  onTaskCancel: (taskId: string) => void;
  onHistoryClear: () => void;
}

const STATUS_ICONS = {
  pending: Clock3,
  running: LoaderCircle,
  completed: CheckCircle2,
  failed: AlertCircle,
} as const;

export function TaskQueueHistory({ tasks, onResultOpen, onTaskCancel, onHistoryClear }: TaskQueueHistoryProps) {
  const queuedTasks = tasks.filter((task) => task.status === "running" || task.status === "pending");
  const pendingCount = queuedTasks.filter((task) => task.status === "pending").length;
  const historyTasks = tasks
    .filter((task) => task.status === "completed" || task.status === "failed")
    .slice(-20)
    .reverse();

  return (
    <section className="task-queue-history" aria-labelledby="task-queue-title">
      <header>
        <div>
          <span>{OFFICE_COPY.queue.eyebrow}</span>
          <strong id="task-queue-title">{OFFICE_COPY.queue.title}</strong>
        </div>
        <small>{pendingCount}{OFFICE_COPY.queue.waitingCount}</small>
      </header>
      {tasks.length === 0 && <p className="task-queue-history__empty">{OFFICE_COPY.queue.empty}</p>}
      {queuedTasks.length > 0 && (
        <ol aria-label={OFFICE_COPY.queue.queueLabel}>
          {queuedTasks.map((task, index) => (
            <TaskQueueItem
              key={task.id}
              task={task}
              queuePosition={task.status === "pending"
                ? queuedTasks.slice(0, index + 1).filter((candidate) => candidate.status === "pending").length
                : undefined}
              onResultOpen={onResultOpen}
              onTaskCancel={onTaskCancel}
            />
          ))}
        </ol>
      )}
      {historyTasks.length > 0 && (
        <>
          <div className="task-queue-history__section-heading">
            <span className="task-queue-history__section-label">{OFFICE_COPY.queue.historyLabel}</span>
            <button type="button" onClick={onHistoryClear}>{OFFICE_COPY.queue.clearHistory}</button>
          </div>
          <ol aria-label={OFFICE_COPY.queue.historyLabel}>
            {historyTasks.map((task) => (
              <TaskQueueItem
                key={task.id}
                task={task}
                onResultOpen={onResultOpen}
                onTaskCancel={onTaskCancel}
              />
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

interface TaskQueueItemProps {
  task: OfficeTask;
  queuePosition?: number;
  onResultOpen: (result: OfficeResult) => void;
  onTaskCancel: (taskId: string) => void;
}

function TaskQueueItem({ task, queuePosition, onResultOpen, onTaskCancel }: TaskQueueItemProps) {
  const Icon = STATUS_ICONS[task.status];
  const result = task.result;
  const failedAgentNames = task.errorAgentIds?.flatMap((agentId) => {
    const agent = OFFICE_AGENTS.find((candidate) => candidate.id === agentId);
    return agent ? [agent.name] : [];
  });
  const content = (
    <>
      <Icon className={task.status === "running" ? "is-spinning" : ""} size={13} aria-hidden="true" />
      <span>
        <small>
          {getStatusLabel(task.status)}
          {queuePosition ? ` ${queuePosition}` : ""}
        </small>
        <strong>{task.request}</strong>
      </span>
      {failedAgentNames && failedAgentNames.length > 0 && (
        <em>{OFFICE_COPY.queue.failedAgents}: {failedAgentNames.join(" · ")}</em>
      )}
      {task.errorMessage && <p role="alert">{task.errorMessage}</p>}
    </>
  );

  return (
    <li data-status={task.status}>
      {result ? (
        <button className="task-queue-history__item-body" type="button" onClick={() => onResultOpen(result)} aria-label={`${OFFICE_COPY.queue.openResult}: ${task.request}`}>{content}</button>
      ) : <div className="task-queue-history__item-body">{content}</div>}
      {task.status === "pending" && (
        <button
          className="task-queue-history__cancel"
          type="button"
          onClick={() => onTaskCancel(task.id)}
        >
          {OFFICE_COPY.queue.cancel}
        </button>
      )}
    </li>
  );
}

function getStatusLabel(status: OfficeTaskStatus): string {
  return OFFICE_COPY.queue[status];
}
