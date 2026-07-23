import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import type { OfficeAgent, OfficeCapabilities, OfficeEngineInfo, OfficeJob, OfficeResultPreview, OfficeTask } from "../types";
import { pruneOfficeTasks, restoreOfficeTasks } from "../workflow-task-history";
import { AgentDesk, getAgentStateLabel } from "./agent-desk";
import { OfficeHeader } from "./office-header";
import { formatExecutionSummary, ResultEngineCard } from "./result-engine-card";
import { getPocTruthLabel } from "./task-composer";
import { MeetingRoom } from "./meeting-room";
import { TaskQueueHistory } from "./task-queue-history";
import { ResultVault } from "./result-vault";
import { WorkflowElapsedStatus } from "./workflow-elapsed-status";
import { ReviewDispatchDesk, canApproveCoding } from "./review-dispatch-desk";
import {
  ClaudeOffice,
  getDevelopmentExchange,
  getDevelopmentStationState,
  getImplementationPlanIndex,
  shouldShowImplementationActivity,
} from "./claude-office";
import { AnalysisOffice, getAnalysisAgentDetail, getAnalysisAgentState } from "./analysis-office";
import {
  CompanyOperationsBoard,
  getCompanyTeam,
  getHumanBottleneckSnapshot,
} from "./company-operations-board";
import { getAnalysisPhaseLabel } from "./analysis-stage-progress";
import {
  calculateWorkflowElapsedSeconds,
  formatWorkflowElapsedTime,
} from "../workflow-elapsed-time";
import { buildPocRunResult } from "../../../../lib/poc/application/poc-result-builder";
import { runDemoPoc } from "../../../../lib/poc/infrastructure/demo-poc-runner";
import {
  buildDevelopmentMeetingBrief,
  createDevelopmentMeetingQuestions,
} from "../development-meeting";

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
  assert.match(markup, /task-queue-history__scroll/u);
  assert.equal(getAgentStateLabel("error"), "문제 발생");
});

test("result archive renders every result as a separate selectable row", () => {
  const results: OfficeResultPreview[] = Array.from({ length: 6 }, (_, index) => ({
    jobId: `job-${index}`,
    runId: `run-${index}`,
    title: `보관 결과 ${index + 1}`,
    summary: `요약 ${index + 1}`,
    createdAt: `2026-07-2${index + 1}T00:00:00.000Z`,
  }));
  const markup = renderToStaticMarkup(
    <ResultVault results={results} isReceiving={false} onOpen={() => undefined} />,
  );

  assert.match(markup, /aria-label="보관된 분석 결과"/u);
  assert.match(markup, /보관 결과 1/u);
  assert.match(markup, /보관 결과 6/u);
  assert.equal((markup.match(/<li>/gu) ?? []).length, 6);
  assert.doesNotMatch(markup, /--stack-index/u);
});

test("coding approval is visible only at the explicit human gate", () => {
  const awaiting = {
    ...createJob("job-awaiting", "리드 버퍼를 늘려줘", "awaiting_coding_approval"),
    actions: { ...EMPTY_ACTIONS, approveCoding: true },
  };
  const coding = { ...awaiting, state: "coding" as const };

  assert.equal(canApproveCoding(awaiting), true);
  assert.equal(canApproveCoding(coding), false);
  assert.match(renderReviewDesk(awaiting), /아틀라스 팀장과 개발 미팅/u);
  assert.doesNotMatch(renderReviewDesk(coding), /아틀라스 팀장과 개발 미팅/u);
});

test("Orbit and Atlas meetings share a visible conference room", () => {
  const markup = renderToStaticMarkup(
    <MeetingRoom
      id="meeting-test"
      theme="development"
      eyebrow="HUMAN GATE"
      title="개발 미팅"
      description="분석 패킷을 함께 확인합니다."
      hostName="아틀라스"
      hostRole="개발팀장"
      hostModel="Claude Opus"
      onClose={() => undefined}
    >
      <p>회의 내용</p>
    </MeetingRoom>,
  );

  assert.match(markup, /meeting-room__scene/u);
  assert.match(markup, /SHARED BRIEF/u);
  assert.match(markup, /아틀라스/u);
  assert.match(markup, /YOU/u);
});

test("development meeting compacts only confirmed human context for Claude", () => {
  const job: OfficeJob = {
    ...createJob("job-development-meeting", "Read buffer를 늘려줘", "awaiting_coding_approval"),
    intakeBrief: {
      version: "1",
      objective: "Read buffer 상한 확장",
      assumptions: ["기존 인터페이스는 유지한다"],
    },
    codingPlan: {
      objective: "Read buffer 상한 확장",
      scope: ["FTL 버퍼 설정과 경계 검증 변경"],
      allowedPaths: ["common", "FTL"],
    },
  };
  const questions = createDevelopmentMeetingQuestions(job);
  const brief = buildDevelopmentMeetingBrief(job, questions, {
    boundaries: "common 인터페이스는 바꾸지 말아 주세요.",
    acceptance: "경계값 회귀 테스트를 통과해야 합니다.",
  });

  assert.equal(questions.length, 3);
  assert.match(questions[0]?.prompt ?? "", /기존 인터페이스/u);
  assert.match(brief.packetSummary, /FTL 버퍼/u);
  assert.match(brief.feedback, /아틀라스 개발 사전 미팅/u);
  assert.match(brief.feedback, /common 인터페이스/u);
  assert.match(brief.feedback, /경계값 회귀 테스트/u);
  assert.ok(brief.feedback.length <= 4_000);
});

test("final PR review is rendered as a second human gate", () => {
  const reviewJob: OfficeJob = {
    ...createJob("job-pr-review", "PR 최종 검토", "review_pending"),
    coding: {
      changedFiles: [],
      diffTruncated: false,
      reviewRound: 1,
      changesDigest: "d".repeat(64),
      pullRequestUrl: "https://github.example.test/test/simulator/pull/12",
      pullRequestNumber: 12,
    },
    actions: {
      ...EMPTY_ACTIONS,
      requestChanges: true,
      mergePr: true,
    },
  };

  const markup = renderReviewDesk(reviewJob);
  assert.match(markup, /HUMAN GATE 2 · FINAL CODE REVIEW/u);
  assert.match(markup, /PR #12 GitHub에서 보기/u);
  assert.match(markup, /개발팀에 재의뢰/u);
  assert.match(markup, /최종 머지 승인/u);
});

test("Claude stations map coding, testing, and Git approval states", () => {
  const coding = createJob("job-coding", "코딩 작업", "coding");
  const testing = createJob("job-testing", "테스트 작업", "testing");
  const changesReady = createJob("job-ready", "검토 작업", "changes_ready");
  const publishing = createJob("job-publishing", "Git 작업", "publishing");

  assert.equal(getDevelopmentStationState("implementation", coding), "working");
  assert.equal(getDevelopmentStationState("implementation", testing), "complete");
  assert.equal(getDevelopmentStationState("verification", testing), "working");
  assert.equal(getDevelopmentStationState("publisher", changesReady), "waiting");
  assert.equal(getImplementationPlanIndex(testing), 3);
  assert.equal(getImplementationPlanIndex(publishing), 5);
  assert.deepEqual(getDevelopmentExchange(coding), {
    from: "아틀라스",
    to: "메이슨",
    message: "구현 지시 전달 · 막히는 내용은 근거와 함께 팀장에게 보고합니다.",
    tone: "active",
  });
  assert.equal(getDevelopmentExchange(testing).to, "베라");
  assert.equal(getDevelopmentExchange(publishing).to, "릴레이");
});

test("development blockers move through the Atlas human meeting gate", () => {
  const job: OfficeJob = {
    ...createJob("job-human-question", "버퍼 호환성 확인", "awaiting_development_input"),
    developmentQuestion: {
      id: "11111111-1111-4111-8111-111111111111",
      raisedBy: "implementation",
      title: "호환성 범위 확인",
      question: "기존 공개 인터페이스를 유지해야 하나요?",
      context: "DLD와 현재 코드의 기본값이 다릅니다.",
      evidence: ["DLD 기본값 1MB"],
      attempted: ["TopView 확인"],
      resumeStage: "implementation",
      status: "open",
      createdAt: "2026-07-23T01:00:00.000Z",
    },
    actions: { ...EMPTY_ACTIONS, answerDevelopmentQuestion: true },
  };

  const desk = renderReviewDesk(job);
  const office = renderToStaticMarkup(<ClaudeOffice job={job} runtimeLabel="company" />);
  assert.match(desk, /아틀라스 질문 확인/u);
  assert.match(desk, /개발팀이 판단을 기다리고 있습니다/u);
  assert.match(office, /사람 판단 대기/u);
  assert.equal(getDevelopmentStationState("claude", job), "waiting");
  assert.equal(getDevelopmentStationState("implementation", job), "waiting");
  assert.equal(getDevelopmentStationState("verification", job), "idle");
  assert.deepEqual(getDevelopmentExchange(job), {
    from: "아틀라스",
    to: "검토팀",
    message: "메이슨의 보고를 검토했습니다. 추측으로 진행하지 않고 사람의 판단을 기다립니다.",
    tone: "blocked",
  });
});

test("analysis failures never look like Claude code failures", () => {
  const failed: OfficeJob = {
    ...createJob("job-analysis-failed", "TopView 분석", "failed"),
    error: { stage: "analysis", message: "탑뷰 결과 형식을 확인하지 못했습니다." },
  };

  assert.equal(shouldShowImplementationActivity(failed), false);
  assert.equal(getImplementationPlanIndex(failed), 0);
  const markup = renderToStaticMarkup(<ClaudeOffice job={failed} runtimeLabel="CodeLLMPro" />);
  assert.match(markup, /업무 수령 대기/u);
  assert.match(markup, /분석팀이 문제를 해결한 뒤/u);
  assert.doesNotMatch(markup, /개발팀 작업 현황/u);
  assert.doesNotMatch(markup, /코드 수정 실패/u);
});

test("company board assigns simultaneous work to independent teams", () => {
  const analysis = createJob("job-analysis", "DLD와 TopView를 분석해줘", "analyzing");
  const review = createJob("job-review", "구현 패킷을 검토해줘", "awaiting_coding_approval");
  const coding = createJob("job-coding", "Read buffer 코드를 수정해줘", "coding");
  const markup = renderToStaticMarkup(
    <CompanyOperationsBoard
      jobs={[analysis, review, coding]}
      selectedJobId={review.id}
      onSelect={() => undefined}
    />,
  );

  assert.equal(getCompanyTeam(analysis), "analysis");
  assert.equal(getCompanyTeam(review), "review");
  assert.equal(getCompanyTeam(coding), "development");
  assert.match(markup, /실시간 오피스/u);
  assert.match(markup, /DLD와 TopView를 분석해줘/u);
  assert.match(markup, /구현 패킷을 검토해줘/u);
  assert.match(markup, /REVIEW QUEUE/u);
  assert.match(markup, /사람 검토 대기 업무/u);
  assert.match(markup, /aria-pressed="true"/u);
  assert.doesNotMatch(markup, /human-file-preview/u);
  assert.match(markup, /Read buffer 코드를 수정해줘/u);
  assert.match(markup, /data-selected="true"/u);
});

test("human review pressure uses real queue depth and wait age without an explicit warning", () => {
  const now = Date.parse("2026-07-22T02:00:00.000Z");
  const freshHuman = [
    { ...createJob("review-1", "구현 승인 1", "awaiting_coding_approval"), updatedAt: "2026-07-22T01:55:00.000Z" },
    { ...createJob("review-2", "Git 승인 2", "changes_ready"), updatedAt: "2026-07-22T01:54:00.000Z" },
  ];
  const machineQueue = [
    createJob("analysis-1", "분석 1", "queued"),
    createJob("analysis-2", "분석 2", "queued"),
    createJob("analysis-3", "분석 3", "queued"),
  ];
  const watched = getHumanBottleneckSnapshot([...freshHuman, ...machineQueue], now);
  const aged = getHumanBottleneckSnapshot([
    { ...freshHuman[0], updatedAt: "2026-07-22T01:20:00.000Z" },
  ], now);
  const clear = getHumanBottleneckSnapshot([], now);

  assert.equal(watched.level, "watch");
  assert.equal(watched.label, "검토 대기 업무");
  assert.equal(aged.level, "bottleneck");
  assert.equal(aged.label, "검토 대기 업무");
  assert.equal(aged.oldestWaitMinutes, 40);
  assert.match(aged.detail, /최장 40분/u);
  assert.equal(clear.level, "clear");
  assert.equal(clear.label, "검토 대기 없음");
});

test("Claude team shows a safe implementation plan and verified file targets", () => {
  const job: OfficeJob = {
    ...createJob("job-live-coding", "Read buffer를 확장해줘", "coding"),
    codingPlan: {
      objective: "읽기 버퍼 상한과 경계 검증을 함께 확장",
      scope: ["버퍼 설정 변경", "회귀 테스트 추가"],
      allowedPaths: ["poc/simulator/src", "poc/simulator/tests"],
    },
    events: [{ id: "event-1", message: "Claude 개발팀이 코딩을 시작했습니다." }],
  };
  const markup = renderToStaticMarkup(<ClaudeOffice job={job} runtimeLabel="CodeLLMPro" />);

  assert.match(markup, /개발팀 작업 현황/u);
  assert.match(markup, /Opus · Sonnet · Haiku 협업 런타임/u);
  assert.match(markup, /아틀라스/u);
  assert.match(markup, /메이슨/u);
  assert.match(markup, /베라/u);
  assert.match(markup, /릴레이/u);
  assert.match(markup, /Claude Opus/u);
  assert.equal((markup.match(/Claude Sonnet/gu) ?? []).length, 4);
  assert.match(markup, /Claude Haiku/u);
  assert.match(markup, /TEAM HANDOFF/u);
  assert.match(markup, /허용된 경로에서 코드 구현/u);
  assert.match(markup, /읽기 버퍼 상한과 경계 검증을 함께 확장/u);
  assert.match(markup, /poc\/simulator\/src/u);
  assert.match(markup, /실제 변경 파일은 Claude 실행이 끝나는 즉시 표시됩니다/u);
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

test("agent detail exposes the completed model artifact", () => {
  const timestamp = "2026-07-22T00:00:00.000Z";
  const job: OfficeJob = {
    ...createJob("job-agent-output", "DLD 근거를 정리해줘", "awaiting_coding_approval"),
    analysis: buildPocRunResult(runDemoPoc("버퍼 근거 조사"), timestamp, timestamp),
    analysisStages: [{ id: "research", status: "completed", summary: "DLD 단계 완료" }],
  };

  const detail = getAnalysisAgentDetail("research", job);
  assert.ok(detail);
  assert.match(detail.summary ?? "", /합성 Wiki/u);
  assert.ok(detail.findings.length > 0);
  assert.ok(detail.evidence.some((item) => item.includes("wiki/")));
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
  requestChanges: false,
  mergePr: false,
  answerDevelopmentQuestion: false,
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
