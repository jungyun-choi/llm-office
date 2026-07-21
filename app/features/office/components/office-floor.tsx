import { BriefcaseBusiness } from "lucide-react";

import { OFFICE_COPY } from "../copy";
import { OFFICE_AGENTS } from "../office-data";
import type { AgentFlowState, AgentId, OfficeRequestInput, OfficeResult, WorkflowStage, WorkflowStatus } from "../types";
import { AgentDesk } from "./agent-desk";
import { CollaborationTable } from "./collaboration-table";
import { ResultVault } from "./result-vault";
import { TaskComposer } from "./task-composer";
import { TransferPacket } from "./transfer-packet";

interface OfficeFloorProps {
  status: WorkflowStatus;
  currentStage: WorkflowStage | null;
  currentRequest: string | null;
  results: readonly OfficeResult[];
  onRequest: (input: OfficeRequestInput) => boolean;
  onResultOpen: (result: OfficeResult) => void;
  errorMessage: string | null;
  isResultArriving: boolean;
}

export function OfficeFloor(props: OfficeFloorProps) {
  const liveCaption = getLiveCaption(props.status, props.currentStage, props.errorMessage);

  return (
    <section className="office-room" aria-labelledby="office-floor-title">
      <div className="office-room__wash" aria-hidden="true" />
      <div className="office-room__header">
        <span>{OFFICE_COPY.floor.eyebrow}</span>
        <h1 id="office-floor-title">{OFFICE_COPY.floor.title}</h1>
        <p>
          <BriefcaseBusiness size={14} aria-hidden="true" />
          <span>{OFFICE_COPY.floor.taskLabel}</span>
          <strong>{props.currentRequest ?? OFFICE_COPY.floor.idleTask}</strong>
        </p>
      </div>
      <OfficeDecor />
      <ul className="agent-stations" aria-label={OFFICE_COPY.accessibility.officeAgents}>
        {OFFICE_AGENTS.map((agent) => {
          const state = getAgentFlowState(agent.id, props.status, props.currentStage);
          return (
            <AgentDesk
              key={agent.id}
              agent={agent}
              state={state}
              activity={getAgentActivity(agent.id, agent.specialty, state, props.currentStage)}
            />
          );
        })}
      </ul>
      <CollaborationTable />
      <TransferPacket stage={props.currentStage} status={props.status} />
      <div className="handoff-caption" aria-live="polite" aria-atomic="true">
        <span
          className={props.status === "running" ? "is-active" : props.status === "error" ? "is-error" : ""}
          aria-hidden="true"
        />
        <div>
          {props.currentStage && <strong>{props.currentStage.label}</strong>}
          <p>{liveCaption}</p>
        </div>
      </div>
      <ResultVault
        results={props.results}
        isReceiving={props.isResultArriving}
        onOpen={props.onResultOpen}
      />
      <TaskComposer isRunning={props.status === "running"} onRequest={props.onRequest} />
    </section>
  );
}

function getAgentFlowState(
  agentId: AgentId,
  status: WorkflowStatus,
  stage: WorkflowStage | null,
): AgentFlowState {
  if (status === "complete") return agentId === "orchestrator" ? "complete" : "idle";
  if (status !== "running" || !stage) return "idle";
  if (stage.receiverIds.includes(agentId)) return "receiving";
  if (stage.senderIds.includes(agentId)) return "sending";
  return "idle";
}

function getAgentActivity(
  agentId: AgentId,
  specialty: string,
  state: AgentFlowState,
  stage: WorkflowStage | null,
): string {
  if (state === "complete") return OFFICE_COPY.floor.completeActivity;
  if (state === "idle" || !stage) return specialty;
  return stage.agentActions[agentId] ?? specialty;
}

function getLiveCaption(
  status: WorkflowStatus,
  stage: WorkflowStage | null,
  errorMessage: string | null,
): string {
  if (status === "error") return errorMessage ?? OFFICE_COPY.progress.error;
  if (status === "complete") return OFFICE_COPY.progress.complete;
  if (status === "running" && stage) return stage.description;
  return OFFICE_COPY.progress.idle;
}

function OfficeDecor() {
  return (
    <div className="office-decor" aria-hidden="true">
      <div className="office-window"><span /><span /><span /></div>
      <div className="office-shelf"><span /><span /><span /><span /></div>
      <div className="office-plant"><span /><span /><span /></div>
      <div className="office-rug" />
    </div>
  );
}
