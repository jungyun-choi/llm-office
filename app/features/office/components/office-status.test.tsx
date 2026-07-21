import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import type { OfficeEngineInfo, OfficeTask } from "../types";
import { pruneOfficeTasks, restoreOfficeTasks } from "../workflow-task-history";
import { getAgentStateLabel } from "./agent-desk";
import { OfficeHeader } from "./office-header";
import { formatExecutionSummary, ResultEngineCard } from "./result-engine-card";
import { getPocTruthLabel } from "./task-composer";
import { TaskQueueHistory } from "./task-queue-history";
import { WorkflowElapsedStatus } from "./workflow-elapsed-status";
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

test("mobile connection copy keeps the Zen state explicit", () => {
  const connected = renderToStaticMarkup(
    <OfficeHeader currentTime="10:42" connectionMode="opencode" onRetryConnection={() => undefined} />,
  );
  const disconnected = renderToStaticMarkup(
    <OfficeHeader currentTime="10:42" connectionMode="disconnected" onRetryConnection={() => undefined} />,
  );

  assert.match(connected, />ZEN 연결</u);
  assert.match(disconnected, />ZEN 끊김</u);
  assert.match(disconnected, /<button[^>]+data-mode="disconnected"/u);
  assert.match(disconnected, /Zen 연결 다시 확인/u);
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

test("queue history exposes queued work and safe failure details", () => {
  const tasks: readonly OfficeTask[] = [
    {
      id: "task-running",
      request: "첫 번째 작업을 분석해줘",
      status: "running",
      submittedAt: "2026-07-22T00:00:00.000Z",
    },
    {
      id: "task-pending",
      request: "두 번째 작업을 분석해줘",
      status: "pending",
      submittedAt: "2026-07-22T00:01:00.000Z",
    },
    {
      id: "task-failed",
      request: "실패한 작업",
      status: "failed",
      submittedAt: "2026-07-22T00:02:00.000Z",
      errorMessage: "모델 응답 형식을 확인하지 못했습니다.",
    },
  ];

  const markup = renderToStaticMarkup(
    <TaskQueueHistory
      tasks={tasks}
      onResultOpen={() => undefined}
      onTaskCancel={() => undefined}
      onHistoryClear={() => undefined}
    />,
  );

  assert.match(markup, /1건 대기/u);
  assert.match(markup, /첫 번째 작업을 분석해줘/u);
  assert.match(markup, /모델 응답 형식을 확인하지 못했습니다/u);
  assert.equal(getAgentStateLabel("error"), "문제 발생");
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
