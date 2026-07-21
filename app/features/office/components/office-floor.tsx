import { BriefcaseBusiness, FileText } from "lucide-react";

import type { PocConnectionMode } from "../api/poc-client";
import { OFFICE_COPY } from "../copy";
import { DEMO_WORKFLOW, OFFICE_AGENTS } from "../office-data";
import type { AgentFlowState, AgentId, OfficeAgent, OfficeRequestInput, OfficeResult, OfficeTask, WorkflowStage, WorkflowStatus } from "../types";
import { AgentDesk } from "./agent-desk";
import { CollaborationTable } from "./collaboration-table";
import { ResultVault } from "./result-vault";
import { TaskComposer } from "./task-composer";
import { TaskQueueHistory } from "./task-queue-history";
import { TransferPacket } from "./transfer-packet";
import { WorkflowElapsedStatus } from "./workflow-elapsed-status";

interface OfficeFloorProps {
  status: WorkflowStatus;
  currentStage: WorkflowStage | null;
  currentRequest: string | null;
  results: readonly OfficeResult[];
  onRequest: (input: OfficeRequestInput) => boolean;
  onResultOpen: (result: OfficeResult) => void;
  errorMessage: string | null;
  isResultArriving: boolean;
  connectionMode: PocConnectionMode;
  elapsedSeconds: number;
  tasks: readonly OfficeTask[];
  errorAgentIds: readonly AgentId[];
  queueErrorMessage: string | null;
  onTaskCancel: (taskId: string) => void;
  onTaskHistoryClear: () => void;
}

export function OfficeFloor(props: OfficeFloorProps) {
  const liveCaption = getLiveCaption(props.status, props.currentStage, props.errorMessage);
  const stageNumber = getStageNumber(props.currentStage);
  const activeWorkers = getActiveWorkers(props.currentStage);
  const handoff = getHandoff(props.currentStage);
  const accessibleProgress = getAccessibleProgressSummary(
    props.status,
    props.currentStage,
    props.errorMessage,
    stageNumber,
    activeWorkers,
    handoff,
  );
  const progressHeading = getProgressHeading(props.status, props.currentStage);
  const latestResult = props.results[0];

  return (
    <section
      className="office-room"
      aria-labelledby="office-floor-title"
      data-workflow-status={props.status}
    >
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
          const state = getAgentFlowState(agent.id, props.status, props.currentStage, props.errorAgentIds);
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
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {accessibleProgress}
      </p>
      <div className="handoff-caption">
        <span
          className={props.status === "running" ? "is-active" : props.status === "error" ? "is-error" : ""}
          aria-hidden="true"
        />
        <div>
          <div className="handoff-caption__heading">
            {props.status === "running" && stageNumber !== null && (
              <span className="handoff-caption__step">
                {stageNumber} / {DEMO_WORKFLOW.length}
              </span>
            )}
            {progressHeading && <strong>{progressHeading}</strong>}
          </div>
          <p>{liveCaption}</p>
          {props.status === "running" && (
            <WorkflowElapsedStatus
              connectionMode={props.connectionMode}
              elapsedSeconds={props.elapsedSeconds}
            />
          )}
          {props.status === "complete" && latestResult && (
            <button
              className="handoff-caption__result-button"
              type="button"
              onClick={() => props.onResultOpen(latestResult)}
            >
              <FileText size={15} aria-hidden="true" />
              {OFFICE_COPY.progress.openResult}
            </button>
          )}
          {props.status === "running" && props.currentStage && (
            <div className="handoff-caption__mobile-details">
              <span className="handoff-caption__eyebrow">{OFFICE_COPY.floor.liveWorkLabel}</span>
              <ul aria-label={OFFICE_COPY.floor.activeAgentsLabel}>
                {activeWorkers.map((worker) => (
                  <li key={worker.id}>
                    <span className="handoff-caption__worker-dot" aria-hidden="true" />
                    <div>
                      <span>
                        <strong>{worker.name}</strong>
                        <small>{worker.role}</small>
                      </span>
                      <p>{worker.action}</p>
                    </div>
                  </li>
                ))}
              </ul>
              {handoff && (
                <div
                  className="handoff-caption__transfer"
                  aria-hidden="true"
                >
                  <span>{handoff.from}</span>
                  <span className="handoff-caption__track">
                    <i />
                    <FileText size={13} strokeWidth={2.2} />
                  </span>
                  <span>{handoff.to}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <TaskQueueHistory
        tasks={props.tasks}
        onResultOpen={props.onResultOpen}
        onTaskCancel={props.onTaskCancel}
        onHistoryClear={props.onTaskHistoryClear}
      />
      <ResultVault
        results={props.results}
        isReceiving={props.isResultArriving}
        onOpen={props.onResultOpen}
      />
      <TaskComposer
        isRunning={props.status === "running"}
        connectionMode={props.connectionMode}
        queueErrorMessage={props.queueErrorMessage}
        onRequest={props.onRequest}
      />
    </section>
  );
}

interface ActiveWorker {
  id: AgentId;
  name: string;
  role: string;
  action: string;
}

interface HandoffLabel {
  from: string;
  to: string;
}

const AGENTS_BY_ID = new Map<AgentId, OfficeAgent>(
  OFFICE_AGENTS.map((agent) => [agent.id, agent] as const),
);

function getStageNumber(stage: WorkflowStage | null): number | null {
  if (!stage) return null;
  const index = DEMO_WORKFLOW.findIndex((candidate) => candidate.id === stage.id);
  return index < 0 ? null : index + 1;
}

function getActiveWorkers(stage: WorkflowStage | null): readonly ActiveWorker[] {
  if (!stage) return [];
  return stage.receiverIds.flatMap((id) => {
    const agent = AGENTS_BY_ID.get(id);
    if (!agent) return [];
    return [{
      id,
      name: agent.name,
      role: agent.role,
      action: stage.agentActions[id] ?? agent.specialty,
    }];
  });
}

function getHandoff(stage: WorkflowStage | null): HandoffLabel | null {
  if (!stage) return null;
  const from = stage.senderIds.length === 0
    ? OFFICE_COPY.floor.requestInbox
    : getAgentNames(stage.senderIds);
  const to = getAgentNames(stage.receiverIds);
  return to ? { from, to } : null;
}

function getAgentNames(ids: readonly AgentId[]): string {
  return ids.flatMap((id) => {
    const agent = AGENTS_BY_ID.get(id);
    return agent ? [agent.name] : [];
  }).join(" · ");
}

function getAgentFlowState(
  agentId: AgentId,
  status: WorkflowStatus,
  stage: WorkflowStage | null,
  errorAgentIds: readonly AgentId[],
): AgentFlowState {
  if (status === "error" && errorAgentIds.includes(agentId)) return "error";
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
  if (state === "error") return OFFICE_COPY.floor.errorActivity;
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

function getProgressHeading(status: WorkflowStatus, stage: WorkflowStage | null): string | null {
  if (status === "complete") return OFFICE_COPY.progress.completeTitle;
  if (status === "error") return OFFICE_COPY.progress.errorTitle;
  return stage?.label ?? null;
}

function getAccessibleProgressSummary(
  status: WorkflowStatus,
  stage: WorkflowStage | null,
  errorMessage: string | null,
  stageNumber: number | null,
  activeWorkers: readonly ActiveWorker[],
  handoff: HandoffLabel | null,
): string {
  if (status === "error") return errorMessage ?? OFFICE_COPY.progress.error;
  if (status === "complete") return OFFICE_COPY.progress.complete;
  if (status !== "running" || !stage || stageNumber === null) return OFFICE_COPY.progress.idle;

  const workers = activeWorkers.map((worker) => worker.name).join(" · ");
  const transfer = handoff
    ? `${handoff.from}에서 ${handoff.to}로 업무 전달. `
    : "";
  const workerStatus = workers ? `${workers} 작업 중.` : "담당 에이전트 배정 중.";

  return `${stageNumber}/${DEMO_WORKFLOW.length} 단계, ${stage.label}. ${transfer}${workerStatus}`;
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
