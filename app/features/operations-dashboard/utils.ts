import type {
  Agent,
  AgentId,
  NewTaskInput,
  QueueFilter,
  Task,
  TaskStage,
} from "./types";

interface TaskFilterOptions {
  search: string;
  agentId: AgentId | null;
  queueFilter: QueueFilter;
  stage: TaskStage | null;
}

export function getAgent(agents: Agent[], agentId: AgentId): Agent {
  const agent = agents.find((candidate) => candidate.id === agentId);
  if (!agent) throw new Error(`Unknown agent: ${agentId}`);
  return agent;
}

export function filterTasks(tasks: Task[], options: TaskFilterOptions): Task[] {
  const query = options.search.trim().toLocaleLowerCase("ko-KR");
  return tasks.filter((task) => {
    const searchable = [
      task.id,
      task.title,
      task.brief,
      task.requiredOutput,
      ...task.acceptanceCriteria,
      ...task.tags,
    ]
      .join(" ")
      .toLocaleLowerCase("ko-KR");
    const matchesQuery = query.length === 0 || searchable.includes(query);
    const matchesAgent = !options.agentId || task.assigneeId === options.agentId;
    const matchesStage = !options.stage || task.stage === options.stage;
    return matchesQuery && matchesAgent && matchesStage && matchesQueue(task, options.queueFilter);
  });
}

function matchesQueue(task: Task, filter: QueueFilter): boolean {
  if (filter === "all") return true;
  if (filter === "active") return task.stage !== "approval" && !task.blockedReason;
  if (filter === "approval") return task.stage === "approval";
  return Boolean(task.blockedReason);
}

export function createTask(input: NewTaskInput, sequence: number): Task {
  return {
    id: `SIM-${sequence}`,
    title: input.title,
    brief: input.brief,
    priority: input.priority,
    stage: "inbox",
    assigneeId: input.assigneeId,
    dueLabel: "일정 미정",
    updatedLabel: "방금 전 접수",
    progress: 4,
    tags: ["New Request", "Triage"],
    requiredOutput: input.requiredOutput,
    acceptanceCriteria: ["요청 범위와 제외 범위가 합의되어 있다", "다음 담당 단계가 지정되어 있다"],
  };
}
