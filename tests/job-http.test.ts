import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { JobService } from "../lib/office-jobs/application/job-service";
import { JobWorker } from "../lib/office-jobs/application/job-worker";
import type { JobExecutionPort } from "../lib/office-jobs/application/job-execution.port";
import type { JobRecord, JobState } from "../lib/office-jobs/domain/job-types";
import { JobError, jobNotFound, staleJobVersion } from "../lib/office-jobs/domain/job-errors";
import { LocalJobController } from "../lib/office-jobs/http/local-job-controller";
import {
  isProductionExecutionAcknowledged,
  proxyLocalJobCapabilities,
  proxyLocalJobRequest,
} from "../lib/office-jobs/http/local-job-proxy";
import { getJobRuntimeConfig } from "../lib/office-jobs/infrastructure/job-config";
import { SqliteJobRepository } from "../lib/office-jobs/infrastructure/sqlite-job-repository";
import { runHostedPoc } from "../lib/poc/application/hosted-poc-run.service";

const originalFetch = globalThis.fetch;
const originalEnvironment = { ...process.env };
const bridgeToken = "a".repeat(43);

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnvironment };
});

describe("single-server job proxy", () => {
  test("production requires both internal deployment acknowledgements", () => {
    assert.equal(isProductionExecutionAcknowledged({ NODE_ENV: "development" }), true);
    assert.equal(isProductionExecutionAcknowledged({ NODE_ENV: "production" }), false);
    assert.equal(isProductionExecutionAcknowledged({
      NODE_ENV: "production",
      AI_OFFICE_DEPLOYMENT_MODE: "internal",
      AI_OFFICE_INTERNAL_EXECUTION_ACK: "on-prem-only",
    }), true);
  });

  test("capabilities strips the loopback bridge token", async () => {
    enableProxy();
    globalThis.fetch = async (_input, init) => {
      assert.equal(new Headers(init?.headers).get("x-ai-office-bridge-token"), bridgeToken);
      return Response.json({
        apiVersion: "v1",
        environment: "local",
        bridgeToken: "must-not-reach-browser",
        queue: { persistent: true },
      });
    };

    const response = await proxyLocalJobCapabilities(new Request("http://office.local/api/v1/jobs/capabilities"));
    const payload = await response.json() as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.equal(payload.bridgeToken, undefined);
    assert.deepEqual(payload.queue, { persistent: true });
  });

  test("mutation forwards only server-owned bridge token and preserves conflict", async () => {
    enableProxy();
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), "http://127.0.0.1:4317/api/v1/jobs/00000000-0000-0000-0000-000000000000/actions");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-ai-office-bridge-token"), bridgeToken);
      assert.equal(headers.get("idempotency-key"), "request-12345678");
      assert.equal(headers.get("origin"), null);
      assert.equal(
        new TextDecoder().decode(init?.body as ArrayBuffer),
        JSON.stringify({ action: "cancel", expectedVersion: 2 }),
      );
      return Response.json(
        { error: { code: "STALE_JOB_VERSION", message: "refresh", retryable: true } },
        { status: 409, headers: { "x-idempotent-replay": "false" } },
      );
    };
    const request = new Request("http://office.local/api/v1/jobs/id/actions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "request-12345678",
        origin: "http://office.local",
        "x-ai-office-bridge-token": "browser-must-not-control-this",
      },
      body: JSON.stringify({ action: "cancel", expectedVersion: 2 }),
    });

    const response = await proxyLocalJobRequest(
      request,
      "/api/v1/jobs/00000000-0000-0000-0000-000000000000/actions",
    );
    const payload = await response.json() as { error: { code: string } };

    assert.equal(response.status, 409);
    assert.equal(payload.error.code, "STALE_JOB_VERSION");
    assert.equal(response.headers.get("x-idempotent-replay"), "false");
  });

  test("missing bridge secret fails closed without a loopback request", async () => {
    enableProxy();
    delete process.env.AI_OFFICE_BRIDGE_TOKEN;
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return Response.json({});
    };

    const response = await proxyLocalJobCapabilities(
      new Request("http://office.local/api/v1/jobs/capabilities"),
    );
    const payload = await response.json() as { error: { code: string } };

    assert.equal(response.status, 503);
    assert.equal(payload.error.code, "BRIDGE_TOKEN_MISSING");
    assert.equal(called, false);
  });

  test("disabled proxy and cross-origin mutations fail before forwarding", async () => {
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return Response.json({});
    };
    delete process.env.AI_OFFICE_LOCAL_PROXY_ENABLED;
    let response = await proxyLocalJobRequest(
      new Request("http://office.local/api/v1/jobs"),
      "/api/v1/jobs",
    );
    assert.equal(response.status, 503);
    assert.equal(called, false);

    enableProxy();
    response = await proxyLocalJobRequest(
      new Request("http://office.local/api/v1/jobs", {
        method: "POST",
        headers: { origin: "https://attacker.example", "content-type": "application/json" },
        body: "{}",
      }),
      "/api/v1/jobs",
    );
    assert.equal(response.status, 403);
    assert.equal(called, false);
  });

  test("company jobs require the trusted proxy secret and one allowlisted user", async () => {
    enableProxy();
    process.env.AI_OFFICE_OPENCODE_PROFILE = "company";
    process.env.AI_OFFICE_TRUSTED_PROXY_SECRET = "p".repeat(43);
    process.env.AI_OFFICE_COMPANY_ALLOWED_USER = "jungyun.choi";
    let called = 0;
    globalThis.fetch = async (_input, init) => {
      called += 1;
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-ai-office-trusted-proxy"), null);
      assert.equal(headers.get("x-ai-office-user"), null);
      return Response.json({ items: [] });
    };

    const missing = await proxyLocalJobRequest(
      new Request("http://office.local/api/v1/jobs"),
      "/api/v1/jobs",
    );
    assert.equal(missing.status, 401);
    assert.equal(called, 0);

    const wrongUser = await proxyLocalJobRequest(
      new Request("http://office.local/api/v1/jobs", {
        headers: {
          "x-ai-office-trusted-proxy": "p".repeat(43),
          "x-ai-office-user": "someone-else",
        },
      }),
      "/api/v1/jobs",
    );
    assert.equal(wrongUser.status, 401);
    assert.equal(called, 0);

    const authorized = await proxyLocalJobRequest(
      new Request("http://office.local/api/v1/jobs", {
        headers: {
          "x-ai-office-trusted-proxy": "p".repeat(43),
          "x-ai-office-user": "jungyun.choi",
        },
      }),
      "/api/v1/jobs",
    );
    assert.equal(authorized.status, 200);
    assert.equal(called, 1);
  });
});

describe("local job controller HTTP mapping", () => {
  test("maps missing jobs and stale approvals without leaking internals", async () => {
    const missingController = controllerWith({
      get: () => {
        throw jobNotFound();
      },
    });
    const missing = missingController.get(
      new Request("http://127.0.0.1:4317/api/v1/jobs/00000000-0000-0000-0000-000000000000"),
      "00000000-0000-0000-0000-000000000000",
    );
    assert.equal(missing.status, 404);
    assert.equal((await missing.json() as { error: { code: string } }).error.code, "JOB_NOT_FOUND");

    const staleController = controllerWith({
      act: async () => {
        throw staleJobVersion();
      },
    });
    const stale = await staleController.action(
      new Request("http://127.0.0.1:4317/api/v1/jobs/00000000-0000-0000-0000-000000000000/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "approve_coding",
          expectedVersion: 1,
          artifactDigest: "a".repeat(64),
        }),
      }),
      "00000000-0000-0000-0000-000000000000",
    );
    assert.equal(stale.status, 409);
    assert.equal((await stale.json() as { error: { code: string } }).error.code, "STALE_JOB_VERSION");
  });

  test("rejects malformed IDs and unsupported JSON media types", async () => {
    const controller = controllerWith({
      get: () => {
        throw new JobError("SHOULD_NOT_RUN", "should not run", 500, false);
      },
      create: async () => {
        throw new JobError("SHOULD_NOT_RUN", "should not run", 500, false);
      },
    });
    const invalidId = controller.get(new Request("http://localhost/jobs/nope"), "nope");
    assert.equal(invalidId.status, 400);

    const invalidMedia = await controller.create(new Request("http://localhost/jobs", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    }));
    assert.equal(invalidMedia.status, 415);
  });
});

describe("job analysis progress persistence", () => {
  test("stores sequential agent progress in SQLite and exposes it through the compact list", async () => {
    const repository = new SqliteJobRepository(":memory:");
    const frameworkRunning = deferred<void>();
    const releaseAnalysis = deferred<void>();
    const analysis = await runHostedPoc({
      prompt: "합성 버퍼 진행 상태를 검증해 주세요",
      executionMode: "demo",
    });
    const executor: JobExecutionPort = {
      resolveBaseSha: async () => "a".repeat(40),
      runAnalysis: async (_prompt, _mode, _key, _signal, onProgress) => {
        await onProgress?.({
          role: "research",
          status: "running",
          phase: "calling_model",
          attempt: 1,
        });
        await onProgress?.({
          role: "research",
          status: "completed",
          attempt: 1,
          summary: "DLD 근거 정리 완료",
        });
        await onProgress?.({
          role: "framework",
          status: "running",
          phase: "validating_output",
          attempt: 2,
        });
        frameworkRunning.resolve();
        await releaseAnalysis.promise;
        await onProgress?.({
          role: "framework",
          status: "completed",
          attempt: 2,
          summary: "SystemC 영향 분석 완료",
        });
        return analysis;
      },
      isClaudeAvailable: async () => false,
      runCoding: async () => {
        throw new Error("coding must not run in this test");
      },
      runTests: async () => {
        throw new Error("tests must not run in this test");
      },
      publish: async () => {
        throw new Error("publish must not run in this test");
      },
      mergePullRequest: async () => {
        throw new Error("merge must not run in this test");
      },
      cleanup: async () => undefined,
    };
    const service = new JobService(repository, executor, getJobRuntimeConfig());
    const worker = new JobWorker(repository, executor, service);
    const controller = new LocalJobController(service);
    worker.start();

    try {
      const createdResponse = await controller.create(new Request("http://localhost/api/v1/jobs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "progress-persistence-test",
        },
        body: JSON.stringify({
          prompt: "회사 버퍼 분석 진행 상태를 확인해 주세요",
          executionMode: "demo",
        }),
      }));
      const created = await createdResponse.json() as { id: string };
      assert.equal(createdResponse.status, 202);
      await withTimeout(frameworkRunning.promise, "framework progress was not persisted");

      const stored = repository.get(created.id);
      assert.ok(stored);
      assert.equal(stored.state, "analyzing");
      assert.deepEqual(
        stored.analysisStages.slice(0, 3).map((stage) => ({
          id: stage.id,
          status: stage.status,
          phase: stage.phase,
          attempt: stage.attempt,
        })),
        [
          { id: "research", status: "completed", phase: undefined, attempt: 1 },
          { id: "framework", status: "running", phase: "validating_output", attempt: 2 },
          { id: "estimate", status: "pending", phase: undefined, attempt: undefined },
        ],
      );
      assert.ok(stored.analysisStages[0]?.completedAt);
      assert.equal(stored.analysisStages[0]?.summary, "DLD 근거 정리 완료");
      assert.ok(stored.analysisStages[1]?.startedAt);

      const listResponse = controller.list(new Request("http://localhost/api/v1/jobs?limit=100&offset=0"));
      const listPayload = await listResponse.json() as {
        items: Array<Record<string, unknown>>;
      };
      const compact = listPayload.items.find((item) => item.id === created.id);
      assert.ok(compact);
      assert.equal(Object.hasOwn(compact, "analysis"), false);
      assert.equal(Object.hasOwn(compact, "codingPacket"), false);
      assert.equal(Object.hasOwn(compact, "events"), false);
      assert.deepEqual(compact.analysisStages, stored.analysisStages);

      releaseAnalysis.resolve();
      await waitFor(() => repository.get(created.id)?.state === "awaiting_coding_approval");
    } finally {
      releaseAnalysis.resolve();
      await worker.stop();
      repository.close();
    }
  });
});

describe("parallel office worker lanes", () => {
  test("analysis and development process different jobs concurrently", async () => {
    const repository = new SqliteJobRepository(":memory:");
    const analysisStarted = deferred<void>();
    const codingStarted = deferred<void>();
    const executor: JobExecutionPort = {
      resolveBaseSha: async () => "a".repeat(40),
      runAnalysis: async (_prompt, _mode, _key, signal) => {
        analysisStarted.resolve();
        return waitForAbort(signal);
      },
      isClaudeAvailable: async () => true,
      runCoding: async (_job, signal) => {
        codingStarted.resolve();
        return waitForAbort(signal);
      },
      runTests: async () => {
        throw new Error("tests must not run before coding completes");
      },
      publish: async () => {
        throw new Error("publish must not run in this test");
      },
      mergePullRequest: async () => {
        throw new Error("merge must not run in this test");
      },
      cleanup: async () => undefined,
    };
    const service = new JobService(repository, executor, getJobRuntimeConfig());
    const worker = new JobWorker(repository, executor, service);
    const analysisJob = runnableJob("analysis-lane-job", "queued", 1);
    const codingJob = runnableJob("development-lane-job", "coding_queued", 2);
    repository.create(analysisJob);
    repository.create(codingJob);
    worker.start();

    try {
      await withTimeout(
        Promise.all([analysisStarted.promise, codingStarted.promise]),
        "both worker lanes did not start",
      );
      assert.equal(repository.get(analysisJob.id)?.state, "analyzing");
      assert.equal(repository.get(codingJob.id)?.state, "coding");
    } finally {
      await worker.stop();
      repository.close();
    }
  });
});

function enableProxy(): void {
  process.env.AI_OFFICE_LOCAL_PROXY_ENABLED = "1";
  process.env.AI_OFFICE_BRIDGE_TOKEN = bridgeToken;
  Object.assign(process.env, { NODE_ENV: "test" });
  delete process.env.AI_OFFICE_BRIDGE_PORT;
}

function controllerWith(overrides: Record<string, unknown>): LocalJobController {
  const service = {
    create: async () => {
      throw new Error("not implemented");
    },
    list: () => {
      throw new Error("not implemented");
    },
    get: () => {
      throw new Error("not implemented");
    },
    act: async () => {
      throw new Error("not implemented");
    },
    capabilities: async () => {
      throw new Error("not implemented");
    },
    ...overrides,
  } as unknown as JobService;
  return new LocalJobController(service);
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), 2_000);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("job did not reach the expected state");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function waitForAbort(signal?: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const abort = () => reject(new Error("worker stopped"));
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

function runnableJob(id: string, state: JobState, queueOrder: number): JobRecord {
  const now = "2026-07-22T00:00:00.000Z";
  return {
    id,
    idempotencyKey: `${id}-idempotency`,
    requestFingerprint: `${id}-fingerprint`,
    prompt: `${id} request`,
    executionMode: "demo",
    state,
    version: 0,
    queueOrder,
    createdAt: now,
    updatedAt: now,
    analysisStages: [],
    changedFiles: [],
    diffTruncated: false,
    testStatus: "not_run",
    testOutputTruncated: false,
    reviewRound: 0,
    cancelRequested: false,
    attempts: 0,
  };
}
