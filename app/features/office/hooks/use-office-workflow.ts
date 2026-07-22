"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createOfficeJob,
  getOfficeJob,
  getOfficeJobCapabilities,
  listOfficeJobs,
  runOfficeJobAction,
} from "../api/job-client";
import { getAnalysisResultPreviews, getJobAnalysisResult } from "../job-analysis";
import type {
  OfficeCapabilities,
  OfficeConnectionMode,
  OfficeJob,
  OfficeJobAction,
  OfficeRequestInput,
  OfficeResult,
  OfficeResultPreview,
  PublishMode,
} from "../types";

const DEFAULT_CAPABILITIES: OfficeCapabilities = { canCommit: false, canPush: false };
const ACTIVE_POLL_MS = 1_000;
const IDLE_POLL_MS = 5_000;
const MAX_FAILURE_POLL_MS = 15_000;

export interface OfficeWorkflowState {
  jobs: readonly OfficeJob[];
  focusJob: OfficeJob | null;
  results: readonly OfficeResultPreview[];
  selectedResult: OfficeResult | null;
  capabilities: OfficeCapabilities;
  connectionMode: OfficeConnectionMode;
  serverError: string | null;
  actionError: string | null;
  isSubmitting: boolean;
  busyJobId: string | null;
  startWorkflow: (input: OfficeRequestInput) => Promise<boolean>;
  runAction: (job: OfficeJob, action: OfficeJobAction, mode?: PublishMode) => Promise<void>;
  selectJob: (jobId: string) => void;
  openResult: (result: OfficeResult | OfficeResultPreview) => void;
  closeResult: () => void;
  retryConnection: () => void;
}

export function useOfficeWorkflow(): OfficeWorkflowState {
  const [jobs, setJobs] = useState<readonly OfficeJob[]>([]);
  const [capabilities, setCapabilities] = useState(DEFAULT_CAPABILITIES);
  const [connectionMode, setConnectionMode] = useState<OfficeConnectionMode>("checking");
  const [serverError, setServerError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedResult, setSelectedResult] = useState<OfficeResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const listInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const jobsRef = useRef<readonly OfficeJob[]>([]);
  const detailRequestsRef = useRef(new Map<string, Promise<OfficeJob>>());

  const refreshJobs = useCallback(async (): Promise<boolean> => {
    if (listInFlightRef.current) return true;
    listInFlightRef.current = true;
    const controller = new AbortController();
    try {
      const payload = await listOfficeJobs(controller.signal);
      if (!mountedRef.current) return false;
      setJobs((current) => reconcilePolledJobs(current, payload.jobs));
      if (payload.capabilities) setCapabilities(payload.capabilities);
      setConnectionMode("server");
      setServerError(null);
      return true;
    } catch (error) {
      if (!mountedRef.current) return false;
      setConnectionMode("disconnected");
      setServerError(getErrorMessage(error));
      return false;
    } finally {
      listInFlightRef.current = false;
    }
  }, []);

  const refreshCapabilities = useCallback(async () => {
    const controller = new AbortController();
    try {
      const next = await getOfficeJobCapabilities(controller.signal);
      if (mountedRef.current) setCapabilities(next);
    } catch {
      // Job-specific action flags remain the safe source of truth.
    }
  }, []);

  const loadJobDetail = useCallback((jobId: string): Promise<OfficeJob> => {
    const existing = detailRequestsRef.current.get(jobId);
    if (existing) return existing;
    const controller = new AbortController();
    const request = getOfficeJob(jobId, controller.signal)
      .then((detail) => {
        if (mountedRef.current) setJobs((current) => mergeJobDetail(current, detail));
        return detail;
      })
      .finally(() => {
        if (detailRequestsRef.current.get(jobId) === request) {
          detailRequestsRef.current.delete(jobId);
        }
      });
    detailRequestsRef.current.set(jobId, request);
    return request;
  }, []);

  const hasActiveJobs = jobs.some((job) => isPollingState(job.state));
  useJobPolling(hasActiveJobs, refreshJobs);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void refreshCapabilities(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [refreshCapabilities]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  const startWorkflow = useCallback(async (input: OfficeRequestInput): Promise<boolean> => {
    if (isSubmitting) return false;
    setIsSubmitting(true);
    setActionError(null);
    const controller = new AbortController();
    try {
      const job = await createOfficeJob(input.request, controller.signal);
      setJobs((current) => upsertJob(current, job));
      setSelectedJobId(job.id);
      setConnectionMode("server");
      return true;
    } catch (error) {
      setActionError(getErrorMessage(error));
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting]);

  const runAction = useCallback(async (
    job: OfficeJob,
    action: OfficeJobAction,
    mode?: PublishMode,
  ): Promise<void> => {
    if (busyJobId) return;
    setBusyJobId(job.id);
    setActionError(null);
    const controller = new AbortController();
    try {
      const updated = await runOfficeJobAction(job, action, mode, controller.signal);
      setJobs((current) => upsertJob(current, updated));
      setSelectedJobId(updated.id);
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setBusyJobId(null);
    }
  }, [busyJobId]);

  const focusJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) ?? chooseFocusJob(jobs),
    [jobs, selectedJobId],
  );
  const focusJobId = focusJob?.id;
  const focusJobVersion = focusJob?.version;
  const focusJobDetailLevel = focusJob?.detailLevel;
  useEffect(() => {
    if (!focusJobId || focusJobDetailLevel === "full") return;
    void loadJobDetail(focusJobId).catch((error) => {
      if (mountedRef.current) setActionError(getErrorMessage(error));
    });
  }, [focusJobDetailLevel, focusJobId, focusJobVersion, loadJobDetail]);

  const results = useMemo(() => getAnalysisResultPreviews(jobs), [jobs]);
  const openResult = useCallback((candidate: OfficeResult | OfficeResultPreview) => {
    if (!("jobId" in candidate)) {
      setSelectedResult(candidate);
      return;
    }
    setSelectedJobId(candidate.jobId);
    setActionError(null);
    const known = jobsRef.current.find((job) => job.id === candidate.jobId);
    const detail = known?.detailLevel === "full"
      ? Promise.resolve(known)
      : loadJobDetail(candidate.jobId);
    void detail.then((job) => {
      const result = getJobAnalysisResult(job);
      if (!result) throw new Error("완료된 분석 결과를 불러오지 못했습니다.");
      if (mountedRef.current) setSelectedResult(result);
    }).catch((error) => {
      if (mountedRef.current) setActionError(getErrorMessage(error));
    });
  }, [loadJobDetail]);
  const closeResult = useCallback(() => setSelectedResult(null), []);
  const retryConnection = useCallback(() => {
    setConnectionMode("checking");
    void refreshJobs();
    void refreshCapabilities();
  }, [refreshCapabilities, refreshJobs]);

  return {
    jobs,
    focusJob,
    results,
    selectedResult,
    capabilities,
    connectionMode,
    serverError,
    actionError,
    isSubmitting,
    busyJobId,
    startWorkflow,
    runAction,
    selectJob: setSelectedJobId,
    openResult,
    closeResult,
    retryConnection,
  };
}

function useJobPolling(hasActiveJobs: boolean, refreshJobs: () => Promise<boolean>): void {
  useEffect(
    () => startJobPolling(hasActiveJobs, refreshJobs, browserPollingRuntime),
    [hasActiveJobs, refreshJobs],
  );
}

/** @internal Exported for deterministic polling tests. */
export interface JobPollingRuntime {
  isVisible(): boolean;
  setTimer(callback: () => void, delayMs: number): number;
  clearTimer(timerId: number): void;
  subscribeVisibility(callback: () => void): () => void;
}

const browserPollingRuntime: JobPollingRuntime = {
  isVisible: () => document.visibilityState === "visible",
  setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimer: (timerId) => window.clearTimeout(timerId),
  subscribeVisibility: (callback) => {
    document.addEventListener("visibilitychange", callback);
    return () => document.removeEventListener("visibilitychange", callback);
  },
};

/** @internal Exported for deterministic polling tests. */
export function startJobPolling(
  hasActiveJobs: boolean,
  refreshJobs: () => Promise<boolean>,
  runtime: JobPollingRuntime,
): () => void {
  let timeoutId: number | undefined;
  let disposed = false;
  let running = false;
  let consecutiveFailures = 0;

  const clearScheduled = () => {
    if (timeoutId === undefined) return;
    runtime.clearTimer(timeoutId);
    timeoutId = undefined;
  };
  const schedule = (delayMs: number) => {
    clearScheduled();
    if (!disposed && runtime.isVisible()) {
      timeoutId = runtime.setTimer(() => void tick(), delayMs);
    }
  };
  const tick = async () => {
    clearScheduled();
    if (disposed || running || !runtime.isVisible()) return;
    running = true;
    let succeeded = false;
    try {
      succeeded = await refreshJobs();
    } catch {
      succeeded = false;
    } finally {
      running = false;
    }
    if (disposed || !runtime.isVisible()) return;
    consecutiveFailures = succeeded ? 0 : consecutiveFailures + 1;
    schedule(getJobPollingDelay(hasActiveJobs, consecutiveFailures));
  };
  const handleVisibility = () => {
    clearScheduled();
    if (!disposed && runtime.isVisible() && !running) void tick();
  };

  const unsubscribeVisibility = runtime.subscribeVisibility(handleVisibility);
  if (runtime.isVisible()) void tick();

  return () => {
    disposed = true;
    clearScheduled();
    unsubscribeVisibility();
  };
}

/** @internal Exported for deterministic polling tests. */
export function getJobPollingDelay(hasActiveJobs: boolean, consecutiveFailures: number): number {
  const successDelay = hasActiveJobs ? ACTIVE_POLL_MS : IDLE_POLL_MS;
  if (consecutiveFailures <= 0) return successDelay;
  return Math.min(
    MAX_FAILURE_POLL_MS,
    successDelay * (2 ** Math.min(consecutiveFailures - 1, 8)),
  );
}

function isPollingState(state: OfficeJob["state"]): boolean {
  return !["completed", "failed", "canceled", "awaiting_coding_approval", "changes_ready"].includes(state);
}

function chooseFocusJob(jobs: readonly OfficeJob[]): OfficeJob | null {
  const priorities: readonly OfficeJob["state"][] = [
    "awaiting_coding_approval", "changes_ready", "failed", "coding", "testing",
    "publishing", "analyzing", "coding_queued", "queued", "completed", "canceled",
  ];
  for (const state of priorities) {
    const job = jobs.find((candidate) => candidate.state === state);
    if (job) return job;
  }
  return null;
}

function upsertJob(jobs: readonly OfficeJob[], next: OfficeJob): readonly OfficeJob[] {
  const index = jobs.findIndex((job) => job.id === next.id);
  if (index < 0) return [next, ...jobs];
  return jobs.map((job) => job.id === next.id ? next : job);
}

/** @internal Exported for deterministic detail-loading tests. */
export function mergeJobDetail(
  current: readonly OfficeJob[],
  detail: OfficeJob,
): readonly OfficeJob[] {
  const index = current.findIndex((job) => job.id === detail.id);
  if (index < 0) return [detail, ...current];
  const existing = current[index];
  if (
    existing.version !== undefined &&
    detail.version !== undefined &&
    existing.version > detail.version
  ) return current;
  if (existing === detail) return current;
  return current.map((job, candidateIndex) => candidateIndex === index ? detail : job);
}

/** @internal Exported for deterministic polling tests. */
export function reconcilePolledJobs(
  current: readonly OfficeJob[],
  incoming: readonly OfficeJob[],
): readonly OfficeJob[] {
  const currentById = new Map(current.map((job) => [job.id, job]));
  let changed = current.length !== incoming.length;
  const reconciled = incoming.map((next, index) => {
    const previous = currentById.get(next.id);
    const reusable = previous !== undefined &&
      next.version !== undefined &&
      previous.version === next.version &&
      previous.queuePosition === next.queuePosition;
    const job = reusable ? previous : next;
    if (job !== current[index]) changed = true;
    return job;
  });
  return changed ? reconciled : current;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "단일 서버 요청을 처리하지 못했습니다.";
}
