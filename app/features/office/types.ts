export type AgentId =
  | "orchestrator"
  | "research"
  | "framework"
  | "estimate"
  | "test"
  | "git";

export type AgentSeat =
  | "north"
  | "north-west"
  | "north-east"
  | "south-west"
  | "south-east"
  | "south";

export type AgentFlowState = "idle" | "sending" | "receiving" | "complete";
export type WorkflowStatus = "idle" | "running" | "complete" | "error";

export interface OfficeAgent {
  id: AgentId;
  name: string;
  role: string;
  deskLabel: string;
  specialty: string;
  seat: AgentSeat;
}

export interface WorkflowTransfer {
  id: string;
  from: AgentId | "inbox";
  to: AgentId;
  route: string;
}

export interface WorkflowStage {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  durationMs: number;
  senderIds: readonly AgentId[];
  receiverIds: readonly AgentId[];
  transfer: WorkflowTransfer;
  agentActions: Partial<Record<AgentId, string>>;
}

export interface ResultSection {
  label: string;
  items: readonly string[];
}

export interface OfficeRoleResult {
  role: Exclude<AgentId, "orchestrator">;
  agentName: string;
  roleLabel: string;
  summary: string;
  findings: readonly string[];
  evidence: readonly string[];
}

export interface OfficeWorkItem {
  title: string;
  owner: string;
  effort: "XS" | "S" | "M" | "L";
  dependencies: readonly string[];
}

export interface OfficeEngineInfo {
  label: string;
  dataRoute: "external-openai" | "internal-opencode" | "deterministic";
  dataRouteLabel: string;
  fallbackReason?: string;
}

export interface OfficeIssueDraft {
  title: string;
  body: string;
  labels: readonly string[];
}

export interface OfficeResult {
  id: string;
  request: string;
  title: string;
  summary: string;
  gitIssueTitle: string;
  issueDraft: OfficeIssueDraft;
  createdAt: string;
  sections: readonly ResultSection[];
  roleOutputs: readonly OfficeRoleResult[];
  workItems: readonly OfficeWorkItem[];
  engine: OfficeEngineInfo;
  notices: readonly string[];
}

export interface OfficeRequestInput {
  request: string;
}
