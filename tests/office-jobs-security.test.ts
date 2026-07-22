import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { runHostedPoc } from "../lib/poc/application/hosted-poc-run.service";
import { executeSecureCli } from "../lib/poc/infrastructure/secure-cli-process";
import { JobService } from "../lib/office-jobs/application/job-service";
import type { JobExecutionPort } from "../lib/office-jobs/application/job-execution.port";
import type { JobRecord } from "../lib/office-jobs/domain/job-types";
import { LocalJobController } from "../lib/office-jobs/http/local-job-controller";
import { getJobRuntimeConfig, type JobRuntimeConfig } from "../lib/office-jobs/infrastructure/job-config";
import { GitHubPullRequestClient } from "../lib/office-jobs/infrastructure/github-pull-request-client";
import {
  buildChangeManifest,
  buildClaudePrompt,
  manifestDigest,
  testSandboxProfile,
} from "../lib/office-jobs/infrastructure/local-job-executor";
import { SqliteJobRepository } from "../lib/office-jobs/infrastructure/sqlite-job-repository";

test("bundled executor disables internal coding even with on-prem acknowledgement", () => {
  const prior = captureEnvironment([
    "AI_OFFICE_CODING_ENABLED",
    "AI_OFFICE_CLAUDE_PROFILE",
    "AI_OFFICE_INTERNAL_EXECUTION_ACK",
    "NODE_ENV",
  ]);
  try {
    process.env.AI_OFFICE_CODING_ENABLED = "1";
    process.env.AI_OFFICE_CLAUDE_PROFILE = "internal";
    process.env.AI_OFFICE_INTERNAL_EXECUTION_ACK = "on-prem-only";
    Reflect.set(process.env, "NODE_ENV", "development");
    const config = getJobRuntimeConfig();
    assert.equal(config.profile, "internal");
    assert.equal(config.codingEnabled, false);
    assert.match(config.configurationError ?? "", /synthetic-only/u);
  } finally {
    restoreEnvironment(prior);
  }
});

test("synthetic Claude prompt excludes raw request and free-form analysis", async () => {
  const rawMarker = "RAW_COMPANY_REQUEST_MARKER";
  const analysisMarker = "FREE_FORM_ANALYSIS_MARKER";
  const analysis = await runHostedPoc({
    prompt: `${rawMarker} 합성 버퍼 기능을 추가해 주세요`,
    executionMode: "demo",
  });
  analysis.brief.objective = analysisMarker;
  analysis.roleOutputs[0].summary = analysisMarker;
  const repository = new SqliteJobRepository(":memory:");
  const config = syntheticConfig();
  const service = new JobService(repository, inertExecutor(), config);
  const job = baseJob(`${rawMarker} 합성 버퍼 기능을 추가해 주세요`);
  job.intakeBrief = {
    version: "1",
    objective: `${rawMarker} 사용자가 확정한 목표`,
    repositoryContext: `${rawMarker} 내부 DLD와 TopView`,
    assumptions: [],
  };
  const packet = await service.buildCodingPacket(job, analysis);
  assert.match(packet.executionPolicy.repositoryFingerprint, /^[a-f0-9]{64}$/u);
  assert.equal(packet.executionPolicy.profile, "synthetic");
  assert.equal(packet.executionPolicy.executorVersion, "bundled-synthetic-v2");
  assert.equal(packet.executionPolicy.testCommandId, "python-unittest-isolated-v1");
  assert.deepEqual(packet.executionPolicy.allowedPaths, config.allowedPaths);
  const prompt = buildClaudePrompt({ ...job, codingPacket: packet }, config);
  assert.doesNotMatch(prompt, new RegExp(rawMarker, "u"));
  assert.doesNotMatch(prompt, new RegExp(analysisMarker, "u"));
  assert.doesNotMatch(prompt, new RegExp(rawMarker, "u"));
  assert.match(prompt, /confirmedTaskBrief/u);
  assert.match(prompt, /deterministicFeatureSpec/u);
  assert.match(prompt, /sourceCommit/u);
  repository.close();
});

test("internal coding packet gives Claude the same confirmed Orbit brief", async () => {
  const repository = new SqliteJobRepository(":memory:");
  const config: JobRuntimeConfig = {
    ...syntheticConfig(),
    profile: "internal",
    internalExecutionAcknowledged: true,
  };
  const service = new JobService(repository, inertExecutor(), config);
  const analysis = await runHostedPoc({
    prompt: "합성 버퍼 기능을 검증해 주세요",
    executionMode: "demo",
  });
  const job = baseJob("Read buffer를 2MB로 확장해 주세요");
  job.intakeBrief = {
    version: "1",
    objective: "Read buffer를 2MB로 확장",
    repositoryContext: "FTL/read_buffer, .LLM DLD, TopView read scenario",
    acceptanceAndTests: "기존 1MB 회귀와 2MB 경계 테스트 통과",
    assumptions: [],
  };

  const packet = await service.buildCodingPacket(job, analysis);
  const prompt = buildClaudePrompt({ ...job, codingPacket: packet }, config);

  assert.deepEqual(packet.intakeBrief, job.intakeBrief);
  assert.match(prompt, /Read buffer를 2MB로 확장/u);
  assert.match(prompt, /TopView read scenario/u);
  repository.close();
});

test("change digest uses full sorted content manifest and deletion markers", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "office-manifest-"));
  try {
    await mkdir(path.join(root, "poc", "simulator", "src"), { recursive: true });
    const relative = "poc/simulator/src/simulator.py";
    const content = "print('full-content')\n";
    await writeFile(path.join(root, relative), content, "utf8");
    const manifest = await buildChangeManifest(root, [
      "poc/simulator/src/deleted.py",
      relative,
    ]);
    assert.deepEqual(manifest.map(({ path: value }) => value), [
      "poc/simulator/src/deleted.py",
      relative,
    ]);
    assert.equal(manifest[0].type, "deletion");
    assert.equal(
      manifest[1].sha256,
      createHash("sha256").update(content).digest("hex"),
    );
    const first = await manifestDigest("a".repeat(40), manifest);
    await writeFile(path.join(root, relative), "print('changed')\n", "utf8");
    const changed = await buildChangeManifest(root, [relative]);
    const second = await manifestDigest("a".repeat(40), changed);
    assert.notEqual(first, second);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("action state and idempotency record commit atomically", () => {
  const repository = new SqliteJobRepository(":memory:");
  const job = baseJob("합성 버퍼 기능을 추가해 주세요");
  job.intakeBrief = {
    version: "1",
    objective: "합성 버퍼 기능 추가",
    repositoryContext: "FTL과 TopView 확인",
    assumptions: [],
  };
  repository.create(job);
  assert.deepEqual(repository.get(job.id)?.intakeBrief, job.intakeBrief);
  const first = repository.updateWithAction(
    job.id,
    job.version,
    { state: "coding_queued", updatedAt: new Date().toISOString() },
    { jobId: job.id, idempotencyKey: "atomic-action-key", fingerprint: "one" },
  );
  assert.equal(first.version, 2);
  assert.throws(() => repository.updateWithAction(
    job.id,
    first.version,
    { state: "coding", updatedAt: new Date().toISOString() },
    { jobId: job.id, idempotencyKey: "atomic-action-key", fingerprint: "two" },
  ));
  const unchanged = repository.get(job.id);
  assert.equal(unchanged?.version, 2);
  assert.equal(unchanged?.state, "coding_queued");
  repository.close();
});

test("final review can send feedback back to Claude on the same PR branch", async () => {
  const repository = new SqliteJobRepository(":memory:");
  const config = syntheticConfig();
  const service = new JobService(repository, inertExecutor(), config);
  const analysis = await runHostedPoc({
    prompt: "합성 PR 재검토 루프를 검증해 주세요",
    executionMode: "demo",
  });
  const job = baseJob("합성 PR 재검토 루프를 검증해 주세요");
  job.analysis = analysis;
  job.codingPacket = await service.buildCodingPacket(job, analysis);
  job.state = "review_pending";
  job.commitSha = "b".repeat(40);
  job.branchName = `ai-office/${job.id}`;
  job.pullRequestUrl = "https://github.example.test/test/simulator/pull/7";
  job.pullRequestNumber = 7;
  job.changesDigest = "d".repeat(64);
  job.testStatus = "passed";
  repository.create(job);

  const result = await service.act(job.id, {
    action: "request_changes",
    expectedVersion: job.version,
    feedback: "경계값 테스트를 추가하고 리뷰 코멘트를 반영해 주세요.",
  }, "review-feedback-action");

  assert.equal(result.job.state, "coding_queued");
  const stored = repository.get(job.id);
  assert.equal(stored?.baseSha, "b".repeat(40));
  assert.equal(stored?.codingPacket?.sourceCommit, "b".repeat(40));
  assert.equal(stored?.reviewRound, 1);
  assert.match(stored?.reviewFeedback ?? "", /경계값 테스트/u);
  assert.equal(stored?.pullRequestNumber, 7);
  assert.equal(stored?.commitSha, undefined);
  repository.close();
});

test("final merge approval completes only after the pull request gateway succeeds", async () => {
  const repository = new SqliteJobRepository(":memory:");
  const executor = inertExecutor();
  let merged = 0;
  executor.mergePullRequest = async (job) => {
    assert.equal(job.pullRequestNumber, 11);
    merged += 1;
  };
  const service = new JobService(repository, executor, syntheticConfig());
  const job = baseJob("최종 PR 머지를 검증해 주세요");
  job.state = "review_pending";
  job.pullRequestUrl = "https://github.example.test/test/simulator/pull/11";
  job.pullRequestNumber = 11;
  job.changesDigest = "e".repeat(64);
  repository.create(job);

  const result = await service.act(job.id, {
    action: "merge_pr",
    expectedVersion: job.version,
    artifactDigest: "e".repeat(64),
  }, "final-merge-action");

  assert.equal(merged, 1);
  assert.equal(result.job.state, "completed");
  assert.equal(result.job.actions.mergePr, false);
  repository.close();
});

test("GitHub PR gateway creates and merges only the configured repository PR", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method?: string; body?: string }> = [];
  const config = {
    ...syntheticConfig(),
    githubToken: "test-token",
    githubApiBase: "https://github.example.test/api/v3/repos/test/simulator",
    githubBaseBranch: "develop",
  };
  const job = baseJob("PR API 요청을 검증해 주세요");
  job.branchName = `ai-office/${job.id}`;
  job.pullRequestUrl = undefined;
  job.pullRequestNumber = undefined;
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), method: init?.method, body: String(init?.body ?? "") });
    if (String(input).endsWith("/pulls")) {
      return Response.json({
        html_url: "https://github.example.test/test/simulator/pull/21",
        number: 21,
      }, { status: 201 });
    }
    return Response.json({ merged: true }, { status: 200 });
  };
  try {
    const client = new GitHubPullRequestClient(config);
    const created = await client.create(job);
    assert.equal(created.pullRequestNumber, 21);
    assert.equal(requests[0]?.url, `${config.githubApiBase}/pulls`);
    assert.match(requests[0]?.body ?? "", /"base":"develop"/u);
    await client.merge({ ...job, ...created });
    assert.equal(requests[1]?.url, `${config.githubApiBase}/pulls/21/merge`);
    assert.equal(requests[1]?.method, "PUT");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("compact job list omits heavy artifacts and batches FIFO positions", async () => {
  const artifactMarker = "SENTINEL_ARTIFACT_MUST_STAY_IN_DETAIL";
  const heavyArtifact = artifactMarker.repeat(20_000);
  const repository = new CountingRepository();
  const config = syntheticConfig();
  const service = new JobService(repository, inertExecutor(), config);
  const controller = new LocalJobController(service);
  const analysis = await runHostedPoc({
    prompt: "합성 버퍼 목록 API 경량화를 검증해 주세요",
    executionMode: "demo",
  });
  const artifactJob = baseJob("합성 버퍼 목록 API 경량화를 검증해 주세요");
  artifactJob.state = "coding_queued";
  artifactJob.queueOrder = 20;
  artifactJob.analysis = analysis;
  artifactJob.codingPacket = await service.buildCodingPacket(artifactJob, analysis);
  artifactJob.codingPacket.brief.issueDraft.body = heavyArtifact;
  artifactJob.claudeModel = "test-model";
  artifactJob.claudeOutput = heavyArtifact;
  artifactJob.branchName = `ai-office/${artifactJob.id}`;
  artifactJob.changedFiles = Array.from(
    { length: 512 },
    (_, index) => `poc/simulator/src/generated-${index}.py`,
  );
  artifactJob.diff = heavyArtifact;
  artifactJob.diffTruncated = true;
  artifactJob.changesDigest = "d".repeat(64);
  artifactJob.testStatus = "passed";
  artifactJob.testOutput = heavyArtifact;
  artifactJob.testOutputTruncated = true;
  repository.create(artifactJob);
  repository.appendEvent(artifactJob.id, {
    kind: "state",
    state: artifactJob.state,
    message: heavyArtifact,
    createdAt: artifactJob.createdAt,
  });

  const firstQueued = queueJob(10, "2026-07-22T00:00:01.000Z");
  const thirdQueued = queueJob(30, "2026-07-22T00:00:03.000Z");
  thirdQueued.state = "publishing";
  const failed = queueJob(undefined, "2026-07-22T00:00:04.000Z");
  failed.state = "failed";
  failed.error = {
    code: "SAFE_FAILURE",
    message: "안전한 오류 요약",
    retryable: true,
    stage: "analysis",
  };
  for (const job of [firstQueued, thirdQueued, failed]) repository.create(job);

  const listResponse = controller.list(new Request("http://localhost/api/v1/jobs?limit=100"));
  const listPayload = await listResponse.json() as {
    items: Array<Record<string, unknown>>;
    total: number;
  };
  const serializedList = JSON.stringify(listPayload);
  assert.equal(listResponse.status, 200);
  assert.equal(listPayload.total, 4);
  assert.doesNotMatch(serializedList, new RegExp(artifactMarker, "u"));
  assert.ok(serializedList.length < 30_000, `compact list was ${serializedList.length} bytes`);
  assert.equal(repository.queuePositionReads, 0);
  assert.equal(repository.eventReads, 0);

  const byId = new Map(listPayload.items.map((item) => [item.id, item]));
  assert.equal(byId.get(firstQueued.id)?.queuePosition, 1);
  assert.equal(byId.get(artifactJob.id)?.queuePosition, 2);
  assert.equal(byId.get(thirdQueued.id)?.queuePosition, 3);
  assert.equal(byId.get(failed.id)?.queuePosition, undefined);
  assert.equal((byId.get(failed.id)?.error as { code?: string } | undefined)?.code, "SAFE_FAILURE");
  assert.equal((byId.get(failed.id)?.actions as { retry?: boolean } | undefined)?.retry, true);

  const compact = byId.get(artifactJob.id) as Record<string, unknown>;
  const preview = compact.analysisPreview as Record<string, unknown>;
  const coding = compact.coding as Record<string, unknown>;
  const codingTest = coding.test as Record<string, unknown>;
  assert.equal(preview.jobId, artifactJob.id);
  assert.equal(preview.runId, analysis.runId);
  assert.equal(preview.title, analysis.brief.title);
  assert.equal(preview.objective, analysis.brief.objective);
  assert.equal(preview.completedAt, analysis.completedAt);
  assert.equal(compact.codingPacketDigest, artifactJob.codingPacket.digest);
  assert.equal(coding.changedFileCount, 512);
  assert.equal(codingTest.status, "passed");
  for (const omitted of ["analysis", "codingPacket", "events"]) {
    assert.equal(Object.hasOwn(compact, omitted), false);
  }
  for (const omitted of ["output", "diff", "changedFiles"]) {
    assert.equal(Object.hasOwn(coding, omitted), false);
  }
  assert.equal(Object.hasOwn(codingTest, "output"), false);

  const detailResponse = controller.get(
    new Request(`http://localhost/api/v1/jobs/${artifactJob.id}`),
    artifactJob.id,
  );
  const serializedDetail = JSON.stringify(await detailResponse.json());
  assert.equal(detailResponse.status, 200);
  assert.match(serializedDetail, new RegExp(artifactMarker, "u"));
  assert.equal(repository.queuePositionReads, 1);
  assert.equal(repository.eventReads, 1);

  const createdResponse = await controller.create(new Request("http://localhost/api/v1/jobs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "create-full-contract",
    },
    body: JSON.stringify({
      prompt: "합성 생성 응답의 전체 계약을 확인해 주세요",
      executionMode: "demo",
    }),
  }));
  const createdPayload = await createdResponse.json() as Record<string, unknown>;
  const createdCoding = createdPayload.coding as Record<string, unknown>;
  assert.equal(createdResponse.status, 202);
  assert.ok(Array.isArray(createdPayload.events));
  assert.ok(Array.isArray(createdCoding.changedFiles));

  const current = repository.get(artifactJob.id);
  assert.ok(current);
  const approvalReady = repository.update(artifactJob.id, current.version, {
    state: "awaiting_coding_approval",
    queueOrder: undefined,
    updatedAt: new Date().toISOString(),
  });
  const actionResponse = await controller.action(
    new Request(`http://localhost/api/v1/jobs/${artifactJob.id}/actions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "approve-full-contract",
      },
      body: JSON.stringify({
        action: "approve_coding",
        expectedVersion: approvalReady.version,
        artifactDigest: artifactJob.codingPacket.digest,
      }),
    }),
    artifactJob.id,
  );
  const actionPayload = await actionResponse.json() as Record<string, unknown>;
  assert.equal(actionResponse.status, 202);
  assert.ok(actionPayload.codingPacket);
  assert.ok(Array.isArray(actionPayload.events));
  assert.match(JSON.stringify(actionPayload), new RegExp(artifactMarker, "u"));
  repository.close();
});

test("test sandbox denies worktree writes, network, and non-Python exec", {
  skip: process.platform !== "darwin" ? "sandbox-exec is Darwin-only" : false,
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "office-sandbox-"));
  try {
    const worktree = path.join(root, "worktree");
    const home = path.join(root, "home");
    const tmp = path.join(root, "tmp");
    await Promise.all([mkdir(worktree), mkdir(home), mkdir(tmp)]);
    const python = await testPythonExecutable();
    const runtime = { root, home, tmp };
    const profilePath = path.join(root, "test.sb");
    await writeFile(profilePath, testSandboxProfile(worktree, runtime, python), "utf8");
    const environment = testEnvironment(python, home, tmp);
    const attempts = [
      `open(${JSON.stringify(path.join(worktree, "blocked"))},'w').write('x')`,
      "import subprocess; subprocess.run(['/bin/sh','-c','true'],check=True)",
      "import socket; socket.create_connection(('127.0.0.1',9),timeout=0.1)",
    ];
    for (const script of attempts) {
      const result = await executeSecureCli({
        executable: "/usr/bin/sandbox-exec",
        args: ["-f", profilePath, python, "-I", "-B", "-c", script],
        cwd: worktree,
        env: environment,
        timeoutMs: 5_000,
        stdoutLimitBytes: 8_192,
        stderrLimitBytes: 8_192,
      });
      assert.notEqual(result.exitCode, 0);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function syntheticConfig(): JobRuntimeConfig {
  return {
    dataDirectory: path.join(os.tmpdir(), "ai-office-test-data"),
    databasePath: ":memory:",
    worktreeDirectory: path.join(os.tmpdir(), "ai-office-test-worktrees"),
    repositoryRoot: process.cwd(),
    allowedPaths: [
      "poc/simulator/src",
      "poc/simulator/tests",
      "poc/simulator/config",
    ],
    profile: "synthetic",
    codingRequested: true,
    codingEnabled: true,
    claudeModel: "test-model",
    claudeTimeoutMs: 30_000,
    claudeStdoutLimitBytes: 8_192,
    claudeStderrLimitBytes: 8_192,
    diffLimitBytes: 8_192,
    testOutputLimitBytes: 8_192,
    maxActiveJobs: 10,
    pushEnabled: false,
    githubApiBase: "https://github.example.test/api/v3/repos/test/simulator",
    githubBaseBranch: "develop",
    internalExecutionAcknowledged: false,
  };
}

function baseJob(prompt: string): JobRecord {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    requestFingerprint: "fingerprint",
    prompt,
    executionMode: "demo",
    state: "awaiting_coding_approval",
    version: 1,
    createdAt: now,
    updatedAt: now,
    analysisStages: [
      { id: "research", status: "completed", startedAt: now, updatedAt: now, completedAt: now },
    ],
    baseSha: "a".repeat(40),
    changedFiles: [],
    diffTruncated: false,
    testStatus: "not_run",
    testOutputTruncated: false,
    reviewRound: 0,
    cancelRequested: false,
    attempts: 0,
  };
}

function queueJob(queueOrder: number | undefined, createdAt: string): JobRecord {
  return {
    ...baseJob("합성 큐 순서를 확인해 주세요"),
    id: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    state: "queued",
    queueOrder,
    createdAt,
    updatedAt: createdAt,
  };
}

class CountingRepository extends SqliteJobRepository {
  queuePositionReads = 0;
  eventReads = 0;

  constructor() {
    super(":memory:");
  }

  override queuePosition(id: string): number | undefined {
    this.queuePositionReads += 1;
    return super.queuePosition(id);
  }

  override listEvents(jobId: string, limit: number) {
    this.eventReads += 1;
    return super.listEvents(jobId, limit);
  }
}

function inertExecutor(): JobExecutionPort {
  const unavailable = async (): Promise<never> => {
    throw new Error("not used");
  };
  return {
    resolveBaseSha: unavailable,
    runAnalysis: unavailable,
    isClaudeAvailable: async () => false,
    runCoding: unavailable,
    runTests: unavailable,
    publish: unavailable,
    mergePullRequest: unavailable,
    cleanup: async () => undefined,
  };
}

function testEnvironment(python: string, home: string, tmp: string): NodeJS.ProcessEnv {
  return {
    PATH: path.dirname(python),
    HOME: home,
    TMPDIR: tmp,
    LANG: "C.UTF-8",
    NO_COLOR: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONNOUSERSITE: "1",
    NODE_ENV: "production",
  };
}

async function testPythonExecutable(): Promise<string> {
  for (const candidate of ["/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3"]) {
    try {
      return await realpath(candidate);
    } catch {
      // Try the next fixed candidate.
    }
  }
  throw new Error("Python 3 is unavailable");
}

function captureEnvironment(names: string[]): Record<string, string | undefined> {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreEnvironment(values: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
