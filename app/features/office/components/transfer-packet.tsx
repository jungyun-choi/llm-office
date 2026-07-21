import { FileText } from "lucide-react";

import type { WorkflowStage, WorkflowStatus } from "../types";

interface TransferPacketProps {
  stage: WorkflowStage | null;
  status: WorkflowStatus;
}

export function TransferPacket({ stage, status }: TransferPacketProps) {
  if (!stage || status !== "running") return null;

  return (
    <div className={`handoff-route route--${stage.transfer.route}`} aria-hidden="true">
      <span className="handoff-route__line" />
      <span className="handoff-packet">
        <FileText size={12} strokeWidth={2.2} />
      </span>
    </div>
  );
}
