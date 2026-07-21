"use client";

import { CheckCircle2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { UI_COPY } from "./copy";
import { ACTIVITIES, AGENTS, APPROVALS, INITIAL_TASKS, OUTPUTS } from "./mock-data";
import type { AgentId, NewTaskInput, QueueFilter, TaskStage } from "./types";
import { createTask, filterTasks, getAgent } from "./utils";
import { AgentGrid } from "./components/agent-grid";
import { AppSidebar } from "./components/app-sidebar";
import { DashboardHeader } from "./components/dashboard-header";
import { NewTaskModal } from "./components/new-task-modal";
import { OperationsRail } from "./components/operations-rail";
import { OverviewHero } from "./components/overview-hero";
import { PipelineBoard } from "./components/pipeline-board";
import { QueueSection } from "./components/queue-section";
import { TaskDetailDrawer } from "./components/task-detail-drawer";

export function DashboardClient() {
  const [tasks, setTasks] = useState(INITIAL_TASKS);
  const [search, setSearch] = useState("");
  const [agentId, setAgentId] = useState<AgentId | null>(null);
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("all");
  const [stage, setStage] = useState<TaskStage | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [isNewTaskOpen, setNewTaskOpen] = useState(false);
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [notice, setNotice] = useState(false);
  useSearchShortcut();
  const visibleTasks = useMemo(() => filterTasks(tasks, { search, agentId, queueFilter, stage }), [tasks, search, agentId, queueFilter, stage]);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const selectedAgent = selectedTask ? getAgent(AGENTS, selectedTask.assigneeId) : null;
  const openTask = useCallback((taskId: string) => setSelectedTaskId(taskId), []);
  const handleCreate = (input: NewTaskInput) => { const nextSequence = Math.max(...tasks.map((task) => Number(task.id.replace("SIM-", "")))) + 1; const task = createTask(input, nextSequence); setTasks((current) => [task, ...current]); setNewTaskOpen(false); setNotice(true); setSelectedTaskId(task.id); window.setTimeout(() => setNotice(false), 3000); };
  const focusQueueFilters = () => { document.querySelector<HTMLButtonElement>("#queue .queue-filters button")?.focus(); document.getElementById("queue")?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const openUrgentApproval = () => openTask(APPROVALS[0].taskId);
  return (
    <div className="dashboard-shell"><a className="skip-link" href="#main-content">{UI_COPY.skipToContent}</a><AppSidebar isOpen={isSidebarOpen} onClose={() => setSidebarOpen(false)} /><div className="dashboard-workspace"><DashboardHeader search={search} onSearchChange={setSearch} onMenuOpen={() => setSidebarOpen(true)} onFilterOpen={focusQueueFilters} onNotificationsOpen={openUrgentApproval} onNewTask={() => setNewTaskOpen(true)} /><main id="main-content" className="dashboard-content"><OverviewHero tasks={tasks} /><div className="dashboard-grid"><div className="dashboard-primary"><AgentGrid agents={AGENTS} tasks={tasks} selectedId={agentId} onSelect={(id) => setAgentId((current) => current === id ? null : id)} /><QueueSection agents={AGENTS} tasks={visibleTasks} selectedAgentId={agentId} filter={queueFilter} onFilterChange={setQueueFilter} onTaskOpen={openTask} /><PipelineBoard tasks={tasks} selectedStage={stage} onStageSelect={(value) => setStage((current) => current === value ? null : value)} /></div><OperationsRail agents={AGENTS} approvals={APPROVALS} outputs={OUTPUTS} activities={ACTIVITIES} onTaskOpen={openTask} /></div></main></div><TaskDetailDrawer task={selectedTask} agent={selectedAgent} onClose={() => setSelectedTaskId(null)} /><NewTaskModal agents={AGENTS} isOpen={isNewTaskOpen} onClose={() => setNewTaskOpen(false)} onSubmit={handleCreate} />{notice && <div className="toast" role="status"><CheckCircle2 size={17} />{UI_COPY.createSuccess}</div>}</div>
  );
}

function useSearchShortcut() {
  useEffect(() => { const handleKey = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); document.getElementById("global-work-search")?.focus(); } }; document.addEventListener("keydown", handleKey); return () => document.removeEventListener("keydown", handleKey); }, []);
}
