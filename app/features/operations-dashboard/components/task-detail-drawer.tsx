"use client";

import { CalendarClock, CheckCircle2, CircleSlash2, FileOutput, UserRound, X } from "lucide-react";
import { useEffect } from "react";

import { UI_COPY } from "../copy";
import type { Agent, Task } from "../types";
import { AgentStatusBadge, TaskBadge } from "./status-badge";

interface TaskDetailDrawerProps {
  task: Task | null;
  agent: Agent | null;
  onClose: () => void;
}

export function TaskDetailDrawer({ task, agent, onClose }: TaskDetailDrawerProps) {
  useEscapeClose(Boolean(task), onClose);
  if (!task || !agent) return null;
  return (
    <div className="drawer-layer"><button className="drawer-scrim" onClick={onClose} aria-label={UI_COPY.close} /><section className="task-drawer" role="dialog" aria-modal="true" aria-labelledby="task-detail-title"><header><div><span>{UI_COPY.taskDetails} · {task.id}</span><h2 id="task-detail-title">{task.title}</h2></div><button className="icon-button" onClick={onClose} aria-label={UI_COPY.close} autoFocus><X size={19} /></button></header><div className="drawer-content"><div className="drawer-badges"><TaskBadge priority={task.priority} /><TaskBadge stage={task.stage} /></div><p className="drawer-brief">{task.brief}</p><DrawerProgress task={task} /><DrawerAgent agent={agent} /><DrawerDetail icon={FileOutput} label={UI_COPY.requiredOutput}><p>{task.requiredOutput}</p></DrawerDetail><DrawerDetail icon={CheckCircle2} label={UI_COPY.acceptanceCriteria}><ul>{task.acceptanceCriteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ul></DrawerDetail>{task.blockedReason && <DrawerDetail icon={CircleSlash2} label={UI_COPY.blockedReason} tone="danger"><p>{task.blockedReason}</p></DrawerDetail>}<DrawerDetail icon={CalendarClock} label={UI_COPY.schedule}><p>{task.dueLabel} · {task.updatedLabel}</p></DrawerDetail></div></section></div>
  );
}

function DrawerProgress({ task }: { task: Task }) {
  return <div className="drawer-progress"><span>{UI_COPY.progress}<strong>{task.progress}%</strong></span><i><em style={{ width: `${task.progress}%` }} /></i></div>;
}

function DrawerAgent({ agent }: { agent: Agent }) {
  return <DrawerDetail icon={UserRound} label={UI_COPY.assignedAgent}><div className="drawer-agent"><span className={`agent-avatar agent-avatar--${agent.id}`}>{agent.name.slice(0, 1)}</span><div><strong>{agent.name}</strong><span>{agent.role} · {agent.callSign}</span></div><AgentStatusBadge status={agent.status} /></div></DrawerDetail>;
}

function DrawerDetail({ icon: Icon, label, children, tone }: { icon: typeof UserRound; label: string; children: React.ReactNode; tone?: "danger" }) {
  return <section className={`drawer-detail ${tone ? `drawer-detail--${tone}` : ""}`}><h3><Icon size={15} />{label}</h3>{children}</section>;
}

function useEscapeClose(isOpen: boolean, onClose: () => void) {
  useEffect(() => { if (!isOpen) return; const handleKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; document.addEventListener("keydown", handleKey); return () => document.removeEventListener("keydown", handleKey); }, [isOpen, onClose]);
}
