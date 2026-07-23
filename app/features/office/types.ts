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

export type AgentFlowState = "idle" | "sending" | "receiving" | "complete" | "error";
export type AnalysisStageStatus = "pending" | "running" | "completed" | "failed";
export type AnalysisStagePhase = "preparing_context" | "calling_model" | "validating_output";
export type WorkflowStatus = "idle" | "running" | "complete" | "error";
export type OfficeTaskStatus = "pending" | "running" | "completed" | "failed";

export type OfficeJobState =
  | "queued"
  | "analyzing"
  | "awaiting_coding_approval"
  | "coding_queued"
  | "coding"
  | "testing"
  | "awaiting_development_input"
  | "changes_ready"
  | "publishing"
  | "review_pending"
  | "merging"
  | "completed"
  | "failed"
  | "canceled";

export type OfficeJobAction =
  | "approve_coding"
  | "publish_changes"
  | "request_changes"
  | "answer_development_question"
  | "merge_pr"
  | "cancel"
  | "retry";
export type PublishMode = "commit" | "commit_and_push";
export type OfficeConnectionMode = "checking" | "server" | "disconnected";
export type DevelopmentStationId = "claude" | "implementation" | "verification" | "publisher";
export type DevelopmentFlowState = "idle" | "queued" | "working" | "waiting" | "complete" | "error";
export type DevelopmentRole = "lead" | "implementation" | "verification" | "git";
export type DevelopmentResumeStage = "implementation" | "verification" | "git";

export interface OfficeDevelopmentQuestion {
  id: string;
  raisedBy: DevelopmentRole;
  title: string;
  question: string;
  context: string;
  evidence: readonly string[];
  attempted: readonly string[];
  resumeStage: DevelopmentResumeStage;
  status: "open" | "answered";
  createdAt: string;
  answer?: string;
  answeredAt?: string;
}

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
  dataRoute: "external-openai" | "external-opencode-zen" | "internal-opencode" | "deterministic";
  dataRouteLabel: string;
  cliProcesses: number;
  modelTurns: number;
  roleOutputCount: number;
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

export interface OrbitIntakeBrief {
  version: "1";
  objective: string;
  currentAndExpectedBehavior?: string;
  repositoryContext?: string;
  acceptanceAndTests?: string;
  assumptions: readonly string[];
}

export interface OfficeRequestInput {
  request: string;
  intakeBrief?: OrbitIntakeBrief;
}

export interface OfficeTask {
  id: string;
  request: string;
  status: OfficeTaskStatus;
  submittedAt: string;
  result?: OfficeResult;
  errorMessage?: string;
  errorAgentIds?: readonly AgentId[];
}

export interface OfficeCapabilities {
  canCommit: boolean;
  canPush: boolean;
  analysisRuntimeLabel?: string;
  codingRuntimeLabel?: string;
}

export interface OfficeChangedFile {
  path: string;
  status?: string;
}

export interface OfficeCodingTest {
  status: "not_run" | "pending" | "running" | "passed" | "failed" | "skipped" | "unknown";
  command?: string;
  output?: string;
}

export interface OfficeCodingResult {
  runtimeLabel?: string;
  model?: string;
  branchName?: string;
  baseSha?: string;
  changedFiles: readonly OfficeChangedFile[];
  changedFileCount?: number;
  diff?: string;
  diffTruncated: boolean;
  summary?: string;
  test?: OfficeCodingTest;
  commitSha?: string;
  pushed?: boolean;
  changesDigest?: string;
  pullRequestUrl?: string;
  pullRequestNumber?: number;
  pullRequestError?: string;
  reviewFeedback?: string;
  reviewRound: number;
  issueUrl?: string;
  issueError?: string;
}

export interface OfficeCodingPlan {
  objective?: string;
  scope: readonly string[];
  allowedPaths: readonly string[];
}

export interface OfficeJobActions {
  approveCoding: boolean;
  cancel: boolean;
  retry: boolean;
  publishCommit: boolean;
  publishAndPush: boolean;
  requestChanges: boolean;
  mergePr: boolean;
  answerDevelopmentQuestion: boolean;
}

export interface OfficeJobError {
  code?: string;
  message: string;
  retryable?: boolean;
  stage?: "analysis" | "coding" | "testing" | "publishing" | "queue";
}

export interface OfficeJobEvent {
  id?: string;
  type?: string;
  message?: string;
  createdAt?: string;
  agentId?: string;
}

export interface OfficeAnalysisStage {
  id: AgentId;
  status: AnalysisStageStatus;
  phase?: AnalysisStagePhase;
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
  attempt?: number;
  summary?: string;
}

export interface OfficeAnalysisPreview {
  jobId: string;
  runId: string;
  title: string;
  objective: string;
  completedAt: string;
}

export interface OfficeResultPreview {
  jobId: string;
  runId: string;
  title: string;
  summary: string;
  createdAt: string;
}

export interface OfficeJob {
  id: string;
  prompt: string;
  intakeBrief?: OrbitIntakeBrief;
  state: OfficeJobState;
  createdAt: string;
  updatedAt?: string;
  queuePosition?: number;
  detailLevel?: "summary" | "full";
  analysis?: unknown;
  analysisPreview?: OfficeAnalysisPreview;
  analysisStages: readonly OfficeAnalysisStage[];
  coding?: OfficeCodingResult;
  codingPlan?: OfficeCodingPlan;
  error?: OfficeJobError;
  developmentQuestion?: OfficeDevelopmentQuestion;
  events: readonly OfficeJobEvent[];
  actions: OfficeJobActions;
  version?: number;
  codingPacketDigest?: string;
}
