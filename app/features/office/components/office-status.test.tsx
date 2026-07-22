import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import type { OfficeAgent, OfficeCapabilities, OfficeEngineInfo, OfficeJob, OfficeTask } from "../types";
import { pruneOfficeTasks, restoreOfficeTasks } from "../workflow-task-history";
import { AgentDesk, getAgentStateLabel } from "./agent-desk";
import { OfficeHeader } from "./office-header";
import { formatExecutionSummary, ResultEngineCard } from "./result-engine-card";
import { getPocTruthLabel } from "./task-composer";
import { TaskQueueHistory } from "./task-queue-history";
import { WorkflowElapsedStatus } from "./workflow-elapsed-status";
import { ReviewDispatchDesk, canApproveCoding } from "./review-dispatch-desk";
import { getDevelopmentStationState } from "./claude-office";
import { AnalysisOffice, getAnalysisAgentState } from "./analysis-office";
import { getAnalysisPhaseLabel } from "./analysis-stage-progress";
import {
  calculateWorkflowElapsedSeconds,
  formatWorkflowElapsedTime,
} from "../workflow-elapsed-time";

const ZEN_ENGINE: OfficeEngineInfo = {
  label: "OpenCode Zen 합성 POC 런타임",
  dataRoute: "external-opencode-zen",
  dataRouteLabel: "OpenCode Zen · 합성 스냅샷만 전송",
  cliProcesses: 1,
  modelTurns: 1,
  roleOutputCount: 5,
};

const ORCHESTRATOR: OfficeAgent = {
  id: "orchestrator",
  name: "Orbit",
  role: "오케스트레이터",
  deskLabel: "ORBIT",
  specialty: "업무 조율",
  seat: "south",
};

const RESEARCH_AGENT: OfficeAgent = {
  id: "research",
  name: "DLD",
  role: "리서처",
  deskLabel: "DLD",
  specialty: "자료 조사",
  seat: "north-west",
};

test("agent desks expose stable identity and team rank selectors", () => {
  const leadMarkup = renderToStaticMarkup(
    <AgentDesk agent={ORCHESTRATOR} state="idle" activity="대기 중" />,
  );
  const memberMarkup = renderToStaticMarkup(
    <AgentDesk agent={RESEARCH_AGENT} state="idle" activity="대기 중" />,
  );

  assert.match(leadMarkup, /<li[^>]+data-agent-id="orchestrator"[^>]+data-rank="lead"/u);
  assert.match(memberMarkup, /<li[^>]+data-agent-id="research"[^>]+data-rank="member"/u);
});

test("mobile connection copy keeps the single-server state explicit", () => {
  const connected = renderToStaticMarkup(
    <OfficeHeader currentTime="10:42" connectionMode="opencode" onRetryConnection={() => undefined} />,
  );
  const disconnected = renderToStaticMarkup(
    <OfficeHeader currentTime="10:42" connectionMode="disconnected" onRetryConnection={() => undefined} />,
  );

  assert.match(connected, />ZEN 연결</u);
  assert.match(disconnected, />서버 끊김</u);
  assert.match(disconnected, /<button[^>]+data-mode="disconnected"/u);
  assert.match(disconnected, /서버 연결 다시 확인/u);
});

test("Zen POC truth copy identifies the single model call", () => {
  assert.equal(
    getPocTruthLabel("opencode"),
    "현재 POC: Zen 단일 호출 1회 · 역할 흐름은 시각화",
  );
});

test("result engine exposes actual process, turn, and role counts", () => {
  const expected = "1 CLI / 1 model turn / 역할 산출물 5개";

  assert.equal(formatExecutionSummary(ZEN_ENGINE), expected);
  assert.match(renderToStaticMarkup(<ResultEngineCard engine={ZEN_ENGINE} />), new RegExp(expected, "u"));
});

test("Zen wait status shows local elapsed time without implying server progress", () => {
  const markup = renderToStaticMarkup(
    <WorkflowElapsedStatus connectionMode="opencode" elapsedSeconds={23} />,
  );

  assert.match(markup, /Zen 응답 대기/u);
  assert.match(markup, /00:23/u);
  assert.match(markup, /로컬 브라우저 경과 시간 · 서버 진행률 아님/u);
});

test("elapsed time is formatted and reset outside a running workflow", () => {
  assert.equal(formatWorkflowElapsedTime(70), "01:10");
  assert.equal(calculateWorkflowElapsedSeconds("running", 1_000, 71_999), 70);
  assert.equal(calculateWorkflowElapsedSeconds("complete", 1_000, 71_999), 0);
  assert.equal(calculateWorkflowElapsedSeconds("error", 1_000, 71_999), 0);
  assert.equal(calculateWorkflowElapsedSeconds("running", null, 71_999), 0);
});

test("server queue exposes approval work and safe failure details", () => {
  const jobs: readonly OfficeJob[] = [
    {
      ...createJob("job-running", "첫 번째 작업을 분석해줘", "analyzing"),
      analysisStages: [
        { id: "research", status: "completed" },
        { id: "framework", status: "running" },
        { id: "estimate", status: "pending" },
        { id: "test", status: "pending" },
        { id: "git", status: "pending" },
        { id: "orchestrator", status: "pending" },
      ],
    },
    { ...createJob("job-pending", "두 번째 작업을 분석해줘", "queued"), queuePosition: 1 },
    {
      ...createJob("job-failed", "실패한 작업", "failed"),
      error: { code: "MODEL_OUTPUT", message: "모델 응답 형식을 확인하지 못했습니다." },
      actions: { ...EMPTY_ACTIONS, retry: true },
    },
  ];

  const markup = renderToStaticMarkup(
    <TaskQueueHistory
      jobs={jobs}
      busyJobId={null}
      onSelect={() => undefined}
      onAction={() => undefined}
    />,
  );

  assert.match(markup, /1건 대기/u);
  assert.match(markup, /첫 번째 작업을 분석해줘/u);
  assert.match(markup, /1\/6 · 코드-X 작업 중/u);
  assert.match(markup, /모델 응답 형식을 확인하지 못했습니다/u);
  assert.equal(getAgentStateLabel("error"), "문제 발생");
});

test("coding approval is visible only at the explicit human gate", () => {
  const awaiting = {
    ...createJob("job-awaiting", "리드 버퍼를 늘려줘", "awaiting_coding_approval"),
    actions: { ...EMPTY_ACTIONS, approveCoding: true },
  };
  const coding = { ...awaiting, state: "coding" as const };

  assert.equal(canApproveCoding(awaiting), true);
  assert.equal(canApproveCoding(coding), false);
  assert.match(renderReviewDesk(awaiting), /Claude에게 구현 맡기기/u);
  assert.doesNotMatch(renderReviewDesk(coding), /Claude에게 구현 맡기기/u);
});

test("Claude stations map coding, testing, and Git approval states", () => {
  const coding = createJob("job-coding", "코딩 작업", "coding");
  const testing = createJob("job-testing", "테스트 작업", "testing");
  const changesReady = createJob("job-ready", "검토 작업", "changes_ready");

  assert.equal(getDevelopmentStationState("implementation", coding), "working");
  assert.equal(getDevelopmentStationState("implementation", testing), "complete");
  assert.equal(getDevelopmentStationState("verification", testing), "working");
  assert.equal(getDevelopmentStationState("publisher", changesReady), "waiting");
});

test("company analysis progress activates only the current specialist", () => {
  const job: OfficeJob = {
    ...createJob("job-company", "회사 기능을 깊게 분석해줘", "analyzing"),
    analysisStages: [
      { id: "research", status: "completed", summary: "DLD 근거 정리 완료" },
      {
        id: "framework",
        status: "running",
        phase: "calling_model",
        startedAt: "2026-07-22T00:00:01.000Z",
        attempt: 2,
      },
      { id: "estimate", status: "pending" },
      { id: "test", status: "pending" },
      { id: "git", status: "pending" },
      { id: "orchestrator", status: "pending" },
    ],
  };

  assert.equal(getAnalysisAgentState("research", job), "complete");
  assert.equal(getAnalysisAgentState("framework", job), "receiving");
  assert.equal(getAnalysisAgentState("estimate", job), "idle");
  assert.equal(getAnalysisAgentState("orchestrator", job), "idle");
  assert.equal(getAnalysisPhaseLabel("preparing_context"), "컨텍스트 준비");
  assert.equal(getAnalysisPhaseLabel("calling_model"), "사내 LLM 응답 대기");
  assert.equal(getAnalysisPhaseLabel("validating_output"), "결과 검증");

  const markup = renderToStaticMarkup(<AnalysisOffice job={job} runtimeLabel="CodeLLMPro" />);
  assert.match(markup, /1\/6 · 코드-X 진행/u);
  assert.match(markup, /사내 LLM 응답 대기/u);
  assert.match(markup, /경과 계산 중/u);
  assert.match(markup, /2차 시도/u);
});

test("stored running work returns to the FIFO and terminal history is bounded", () => {
  const restored = restoreOfficeTasks(JSON.stringify([
    {
      id: "task-running",
      request: "새로고침 전에 실행 중이던 작업",
      status: "running",
      submittedAt: "2026-07-22T00:00:00.000Z",
    },
    { bad: "record" },
  ]));
  assert.equal(restored.length, 1);
  assert.equal(restored[0]?.status, "pending");

  const terminalTasks: OfficeTask[] = Array.from({ length: 24 }, (_, index) => ({
    id: `done-${index}`,
    request: `완료 ${index}`,
    status: "completed",
    submittedAt: new Date(index).toISOString(),
  }));
  const pendingTask: OfficeTask = {
    id: "still-pending",
    request: "아직 대기 중",
    status: "pending",
    submittedAt: "2026-07-22T00:00:00.000Z",
  };
  const pruned = pruneOfficeTasks([...terminalTasks, pendingTask]);

  assert.equal(pruned.length, 21);
  assert.equal(pruned[0]?.id, "done-4");
  assert.equal(pruned.at(-1)?.id, "still-pending");

  const tooManyPending: OfficeTask[] = Array.from({ length: 12 }, (_, index) => ({
    id: `pending-${index}`,
    request: `대기 ${index}`,
    status: "pending",
    submittedAt: new Date(index).toISOString(),
  }));
  assert.deepEqual(
    pruneOfficeTasks(tooManyPending).map((task) => task.id),
    tooManyPending.slice(0, 10).map((task) => task.id),
  );
});

const EMPTY_ACTIONS: OfficeJob["actions"] = {
  approveCoding: false,
  cancel: false,
  retry: false,
  publishCommit: false,
  publishAndPush: false,
};

const CAPABILITIES: OfficeCapabilities = {
  canCommit: true,
  canPush: false,
};

function createJob(id: string, prompt: string, state: OfficeJob["state"]): OfficeJob {
  return {
    id,
    prompt,
    state,
    createdAt: "2026-07-22T00:00:00.000Z",
    analysisStages: [],
    events: [],
    actions: EMPTY_ACTIONS,
  };
}

function renderReviewDesk(job: OfficeJob): string {
  return renderToStaticMarkup(
    <ReviewDispatchDesk
      job={job}
      capabilities={CAPABILITIES}
      busy={false}
      onAction={() => undefined}
      onAnalysisOpen={() => undefined}
    />,
  );
}
