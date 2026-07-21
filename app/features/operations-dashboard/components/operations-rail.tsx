import { ArrowUpRight, Check, Clock3, FileCheck2, RadioTower } from "lucide-react";

import { UI_COPY } from "../copy";
import type { ActivityItem, Agent, ApprovalItem, OutputItem } from "../types";
import { getAgent } from "../utils";

interface OperationsRailProps {
  agents: Agent[];
  approvals: ApprovalItem[];
  outputs: OutputItem[];
  activities: ActivityItem[];
  onTaskOpen: (taskId: string) => void;
}

export function OperationsRail(props: OperationsRailProps) {
  return <aside className="operations-rail"><ApprovalsPanel {...props} /><OutputsPanel {...props} /><ActivityPanel agents={props.agents} activities={props.activities} /></aside>;
}

function ApprovalsPanel({ agents, approvals, onTaskOpen }: OperationsRailProps) {
  return (
    <section className="panel rail-panel" aria-labelledby="approval-title"><RailHeading icon={Clock3} title={UI_COPY.approvalsTitle} description={UI_COPY.approvalsDescription} count={approvals.length} /><div className="approval-list">{approvals.map((item) => { const agent = getAgent(agents, item.requestedBy); return <button key={item.id} className="approval-item" onClick={() => onTaskOpen(item.taskId)}><span className={`approval-indicator approval-indicator--${item.urgency}`} /><div><span>{item.decisionKind} · {item.id}</span><strong>{item.title}</strong><small>{agent.name} 요청 · {item.waitingTime} 대기</small></div><ArrowUpRight size={15} /></button>; })}</div></section>
  );
}

function OutputsPanel({ agents, outputs, onTaskOpen }: OperationsRailProps) {
  return (
    <section className="panel rail-panel" id="outputs" aria-labelledby="output-title"><RailHeading icon={FileCheck2} title={UI_COPY.outputsTitle} description={UI_COPY.outputsDescription} /><div className="output-list">{outputs.map((item) => { const agent = getAgent(agents, item.ownerId); return <button key={item.id} className="output-item" onClick={() => onTaskOpen(item.taskId)}><span className="output-icon"><FileCheck2 size={15} /></span><div><span>{item.type} · {item.id}</span><strong>{item.title}</strong><small>{agent.name} · {item.createdAt}</small></div><span className={`output-state output-state--${item.status}`}>{item.status === "ready" ? <><Check size={11} />검토 가능</> : "초안"}</span></button>; })}</div></section>
  );
}

function ActivityPanel({ agents, activities }: Pick<OperationsRailProps, "agents" | "activities">) {
  return (
    <section className="panel rail-panel activity-panel" aria-labelledby="activity-title"><RailHeading icon={RadioTower} title={UI_COPY.activityTitle} description={UI_COPY.activityDescription} /><div className="activity-list">{activities.map((item) => { const agent = getAgent(agents, item.actorId); return <div className="activity-item" key={item.id}><span className={`activity-dot activity-dot--${item.tone}`} /><div><strong>{agent.name}</strong><p>{item.summary}</p><small>{item.time}</small></div></div>; })}</div></section>
  );
}

function RailHeading({ icon: Icon, title, description, count }: { icon: typeof Clock3; title: string; description: string; count?: number }) {
  return <div className="rail-heading"><span className="section-icon"><Icon size={15} /></span><div><h2 id={title === UI_COPY.approvalsTitle ? "approval-title" : title === UI_COPY.outputsTitle ? "output-title" : "activity-title"}>{title}</h2><p>{description}</p></div>{typeof count === "number" && <b>{count}</b>}</div>;
}
