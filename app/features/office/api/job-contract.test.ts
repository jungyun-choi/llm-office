import assert from "node:assert/strict";
import test from "node:test";

import { parseCapabilities, parseJobPayload, parseJobsPayload } from "./job-contract";

const BASE_JOB = {
  id: "job-1",
  state: "changes_ready",
  version: 7,
  prompt: "read buffer를 늘려줘",
  executionMode: "auto",
  createdAt: "2026-07-22T00:00:00.000Z",
  updatedAt: "2026-07-22T00:01:00.000Z",
  analysisStages: [
    { id: "research", status: "completed", summary: "DLD 조사 완료" },
    {
      id: "framework",
      status: "running",
      phase: "calling_model",
      startedAt: "2026-07-22T00:00:30.000Z",
      updatedAt: "2026-07-22T00:01:00.000Z",
      attempt: 1,
    },
  ],
  codingPacket: {
    digest: "packet-digest",
    allowedPaths: ["poc/simulator/src", "/Users/person/work/private"],
    brief: {
      objective: "Read buffer 경계를 안전하게 확장",
      scope: ["buffer manager 수정", "/Users/person/work 내부 경로 제거"],
    },
  },
  coding: {
    profile: "synthetic",
    enabled: true,
    model: "claude-test",
    branch: "ai-office/job-1",
    changedFiles: ["src/read-buffer.cc", "/Users/person/work/simulator/tests/read-buffer.test.cc"],
    diff: "--- /Users/person/work/simulator/src/read-buffer.cc\n+++ b/src/read-buffer.cc",
    diffTruncated: false,
    changesDigest: "changes-digest",
    reviewRound: 2,
    pullRequestUrl: "https://github.example.test/test/simulator/pull/4",
    pullRequestNumber: 4,
    test: { status: "passed", output: "ok", truncated: false },
  },
  actions: {
    approveCoding: false,
    cancel: false,
    retry: false,
    publishCommit: true,
    publishAndPush: false,
    requestChanges: false,
    mergePr: false,
  },
  events: [{ id: 1, kind: "state", state: "changes_ready", message: "검토 준비", createdAt: "2026-07-22T00:01:00.000Z" }],
};

test("bare and wrapped JobDTO responses are normalized", () => {
  const bare = parseJobPayload(BASE_JOB);
  const wrapped = parseJobPayload({ job: BASE_JOB });

  assert.equal(bare.id, "job-1");
  assert.equal(bare.detailLevel, "full");
  assert.equal(wrapped.state, "changes_ready");
  assert.equal(bare.codingPacketDigest, "packet-digest");
  assert.equal(bare.coding?.changesDigest, "changes-digest");
  assert.equal(bare.coding?.test?.status, "passed");
  assert.equal(bare.coding?.pullRequestNumber, 4);
  assert.equal(bare.coding?.reviewRound, 2);
  assert.equal(bare.codingPlan?.objective, "Read buffer 경계를 안전하게 확장");
  assert.deepEqual(bare.codingPlan?.allowedPaths, ["poc/simulator/src", "[workspace-path]"]);
  assert.match(bare.codingPlan?.scope[1] ?? "", /\[workspace-path\]/u);
  assert.deepEqual(bare.analysisStages.map(({ id, status }) => ({ id, status })), [
    { id: "research", status: "completed" },
    { id: "framework", status: "running" },
  ]);
  assert.equal(bare.analysisStages[1]?.phase, "calling_model");
  assert.equal(bare.analysisStages[1]?.attempt, 1);
});

test("job display data redacts absolute worktree paths", () => {
  const job = parseJobPayload(BASE_JOB);

  assert.equal(job.coding?.changedFiles[1]?.path, "…/simulator/tests/read-buffer.test.cc");
  assert.doesNotMatch(job.coding?.diff ?? "", /\/Users\/person/u);
  assert.match(job.coding?.diff ?? "", /\[workspace-path\]/u);
});

test("list and capabilities accept the single-server response shape", () => {
  const compactJob = {
    id: BASE_JOB.id,
    state: BASE_JOB.state,
    version: BASE_JOB.version,
    prompt: BASE_JOB.prompt,
    executionMode: BASE_JOB.executionMode,
    createdAt: BASE_JOB.createdAt,
    updatedAt: BASE_JOB.updatedAt,
    analysisPreview: {
      jobId: BASE_JOB.id,
      runId: "run-1",
      title: "리드 버퍼 확장",
      objective: "버퍼 한도를 안전하게 확장",
      completedAt: BASE_JOB.updatedAt,
    },
    analysisStages: BASE_JOB.analysisStages,
    codingPacketDigest: "packet-digest",
    coding: {
      profile: "synthetic",
      enabled: true,
      model: "claude-test",
      branch: "ai-office/job-1",
      changedFileCount: 2,
      diffTruncated: false,
      changesDigest: "changes-digest",
      test: { status: "passed", truncated: false },
    },
    actions: BASE_JOB.actions,
  };
  const list = parseJobsPayload({ jobs: [compactJob], total: 1 });
  const capabilities = parseCapabilities({
    apiVersion: "v1",
    analysis: { enabled: true, available: true, label: "OpenCode Internal" },
    coding: { enabled: true, available: true, model: "CodeLLMPro" },
    publishing: { commitAvailable: true, pushEnabled: false },
  });

  assert.equal(list.jobs.length, 1);
  assert.equal(list.jobs[0]?.detailLevel, "summary");
  assert.equal(list.jobs[0]?.analysisPreview?.runId, "run-1");
  assert.equal(list.jobs[0]?.codingPacketDigest, "packet-digest");
  assert.equal(list.jobs[0]?.coding?.changedFileCount, 2);
  assert.equal(list.jobs[0]?.coding?.diff, undefined);
  assert.equal(capabilities.analysisRuntimeLabel, "OpenCode Internal");
  assert.equal(capabilities.codingRuntimeLabel, "CodeLLMPro");
  assert.equal(capabilities.canCommit, true);
  assert.equal(capabilities.canPush, false);
});
