import assert from "node:assert/strict";
import test from "node:test";

import type { OfficeJob, OfficeJobState } from "../types";
import {
  getJobPollingDelay,
  mergeJobDetail,
  reconcilePolledJobs,
  startJobPolling,
} from "./use-office-workflow";

test("poll reconciliation preserves unchanged arrays and job references", () => {
  const first = createJob("first", "queued", 3, 1);
  const second = createJob("second", "analyzing", 7);
  const current = [first, second];

  const unchanged = reconcilePolledJobs(current, [
    { ...first, events: [...first.events] },
    { ...second, analysisStages: [...second.analysisStages] },
  ]);

  assert.equal(unchanged, current);
  assert.equal(unchanged[0], first);
  assert.equal(unchanged[1], second);

  const moved = { ...first, queuePosition: 2 };
  const queueChanged = reconcilePolledJobs(current, [moved, { ...second }]);
  assert.notEqual(queueChanged, current);
  assert.equal(queueChanged[0], moved);
  assert.equal(queueChanged[1], second);

  const advanced = { ...second, version: 8 };
  const versionChanged = reconcilePolledJobs(current, [{ ...first }, advanced]);
  assert.equal(versionChanged[0], first);
  assert.equal(versionChanged[1], advanced);
});

test("poll reconciliation treats missing versions as changed", () => {
  const current = [createJob("legacy", "queued", undefined, 1)];
  const incoming = [{ ...current[0] }];

  const reconciled = reconcilePolledJobs(current, incoming);

  assert.notEqual(reconciled, current);
  assert.equal(reconciled[0], incoming[0]);
});

test("compact polling preserves current full detail until the version changes", () => {
  const full = {
    ...createJob("detail", "changes_ready", 7),
    detailLevel: "full" as const,
    analysis: { result: "loaded" },
  };
  const sameVersionSummary = {
    ...createJob("detail", "changes_ready", 7),
    detailLevel: "summary" as const,
  };
  const preserved = reconcilePolledJobs([full], [sameVersionSummary]);
  assert.equal(preserved[0], full);

  const newerSummary = { ...sameVersionSummary, version: 8 };
  const advanced = reconcilePolledJobs([full], [newerSummary]);
  assert.equal(advanced[0], newerSummary);

  const freshDetail = { ...full, version: 8 };
  assert.equal(mergeJobDetail(advanced, freshDetail)[0], freshDetail);
  assert.equal(mergeJobDetail([freshDetail], full)[0], freshDetail);
});

test("failure delay backs off exponentially and caps at fifteen seconds", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6].map((failures) => getJobPollingDelay(true, failures)),
    [1_000, 1_000, 2_000, 4_000, 8_000, 15_000, 15_000],
  );
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((failures) => getJobPollingDelay(false, failures)),
    [5_000, 5_000, 10_000, 15_000, 15_000],
  );
});

test("polling pauses without a hidden timer and refreshes immediately when visible", async () => {
  const runtime = new FakePollingRuntime();
  let refreshCount = 0;
  const stop = startJobPolling(true, async () => {
    refreshCount += 1;
    return true;
  }, runtime);

  await settle();
  assert.equal(refreshCount, 1);
  assert.equal(runtime.nextDelay(), 1_000);

  runtime.setVisible(false);
  assert.equal(runtime.timerCount(), 0);

  runtime.setVisible(true);
  await settle();
  assert.equal(refreshCount, 2);
  assert.equal(runtime.nextDelay(), 1_000);

  stop();
  assert.equal(runtime.timerCount(), 0);
  assert.equal(runtime.listenerCount(), 0);
});

test("polling applies failure backoff and restores the success cadence", async () => {
  const runtime = new FakePollingRuntime();
  const outcomes = [false, false, false, false, false, true];
  const stop = startJobPolling(true, async () => outcomes.shift() ?? true, runtime);
  const expectedDelays = [1_000, 2_000, 4_000, 8_000, 15_000, 1_000];

  for (const [index, expectedDelay] of expectedDelays.entries()) {
    await settle();
    assert.equal(runtime.nextDelay(), expectedDelay);
    if (index < expectedDelays.length - 1) runtime.fireNext();
  }

  stop();
});

function createJob(
  id: string,
  state: OfficeJobState,
  version?: number,
  queuePosition?: number,
): OfficeJob {
  return {
    id,
    prompt: `${id} 작업`,
    state,
    createdAt: "2026-07-22T00:00:00.000Z",
    queuePosition,
    analysisStages: [],
    events: [],
    actions: {
      approveCoding: false,
      cancel: true,
      retry: false,
      publishCommit: false,
      publishAndPush: false,
      requestChanges: false,
      mergePr: false,
    },
    version,
  };
}

class FakePollingRuntime {
  private visible = true;
  private nextTimerId = 1;
  private readonly timers = new Map<number, { callback: () => void; delayMs: number }>();
  private readonly listeners = new Set<() => void>();

  isVisible(): boolean {
    return this.visible;
  }

  setTimer(callback: () => void, delayMs: number): number {
    const timerId = this.nextTimerId;
    this.nextTimerId += 1;
    this.timers.set(timerId, { callback, delayMs });
    return timerId;
  }

  clearTimer(timerId: number): void {
    this.timers.delete(timerId);
  }

  subscribeVisibility(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    for (const listener of this.listeners) listener();
  }

  fireNext(): void {
    const next = this.timers.entries().next().value as
      | [number, { callback: () => void; delayMs: number }]
      | undefined;
    assert.ok(next, "expected a scheduled poll");
    this.timers.delete(next[0]);
    next[1].callback();
  }

  nextDelay(): number | undefined {
    return this.timers.values().next().value?.delayMs;
  }

  timerCount(): number {
    return this.timers.size;
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
