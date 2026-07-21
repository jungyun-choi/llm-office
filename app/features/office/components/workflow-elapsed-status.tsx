import { Clock3 } from "lucide-react";

import type { PocConnectionMode } from "../api/poc-client";
import { OFFICE_COPY } from "../copy";
import { formatWorkflowElapsedTime } from "../workflow-elapsed-time";

interface WorkflowElapsedStatusProps {
  connectionMode: PocConnectionMode;
  elapsedSeconds: number;
}

export function WorkflowElapsedStatus({
  connectionMode,
  elapsedSeconds,
}: WorkflowElapsedStatusProps) {
  const waitLabel = OFFICE_COPY.progress.waiting[connectionMode];
  const safeElapsedSeconds = Number.isFinite(elapsedSeconds)
    ? Math.max(0, Math.floor(elapsedSeconds))
    : 0;
  const formattedTime = formatWorkflowElapsedTime(safeElapsedSeconds);

  return (
    <div
      className="workflow-elapsed-status"
      aria-label={`${waitLabel} ${formattedTime}. ${OFFICE_COPY.progress.elapsedClarification}`}
    >
      <Clock3 size={14} aria-hidden="true" />
      <span>{waitLabel}</span>
      <time dateTime={`PT${safeElapsedSeconds}S`}>{formattedTime}</time>
      <small>{OFFICE_COPY.progress.elapsedClarification}</small>
    </div>
  );
}
