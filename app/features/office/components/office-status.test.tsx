import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import type { OfficeEngineInfo } from "../types";
import { OfficeHeader } from "./office-header";
import { formatExecutionSummary, ResultEngineCard } from "./result-engine-card";
import { getPocTruthLabel } from "./task-composer";
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
