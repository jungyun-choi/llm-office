export type AgentId =
  | "orbit"
  | "probe"
  | "calc"
  | "verify"
  | "gitmate"
  | "flashx";

export type AgentStatus = "working" | "review" | "waiting" | "offline";
export type TaskPriority = "urgent" | "high" | "normal";
export type TaskStage =
  | "inbox"
  | "research"
  | "analysis"
  | "test"
  | "issue"
  | "approval";
export type QueueFilter = "all" | "active" | "approval" | "blocked";

export interface Agent {
  id: AgentId;
  name: string;
  callSign: string;
  role: string;
  specialty: string;
  status: AgentStatus;
  currentTaskId: string | null;
  queueCount: number;
  load: number;
  lastActivity: string;
}

export interface Task {
  id: string;
  title: string;
  brief: string;
  priority: TaskPriority;
  stage: TaskStage;
  assigneeId: AgentId;
  dueLabel: string;
  updatedLabel: string;
  progress: number;
  tags: string[];
  requiredOutput: string;
  acceptanceCriteria: string[];
  blockedReason?: string;
}

export interface PipelineStage {
  id: TaskStage;
  label: string;
  shortLabel: string;
  description: string;
}

export interface ApprovalItem {
  id: string;
  taskId: string;
  title: string;
  requestedBy: AgentId;
  waitingTime: string;
  decisionKind: string;
  urgency: "urgent" | "normal";
}

export interface OutputItem {
  id: string;
  taskId: string;
  title: string;
  type: string;
  ownerId: AgentId;
  createdAt: string;
  status: "ready" | "draft";
}

export interface ActivityItem {
  id: string;
  actorId: AgentId;
  summary: string;
  time: string;
  tone: "teal" | "blue" | "amber" | "slate";
}

export interface NewTaskInput {
  title: string;
  brief: string;
  priority: TaskPriority;
  assigneeId: AgentId;
  requiredOutput: string;
}
