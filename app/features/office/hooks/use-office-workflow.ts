"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import {
  createRequestId,
  isPocAbortError,
  runPocRequest,
  type PocEndpoint,
} from "../api/poc-client";
import { mapPocRunResult } from "../api/map-poc-result";
import { OFFICE_COPY } from "../copy";
import { DEMO_WORKFLOW, REDUCED_MOTION_STAGE_DURATION_MS } from "../office-data";
import type {
  AgentId,
  OfficeRequestInput,
  OfficeResult,
  OfficeTask,
  WorkflowStage,
  WorkflowStatus,
} from "../types";
import { pruneOfficeTasks, restoreOfficeTasks, serializeOfficeTasks } from "../workflow-task-history";
import { calculateWorkflowElapsedSeconds } from "../workflow-elapsed-time";
import { useReducedMotion } from "./use-reduced-motion";

const MAX_RESULTS = 3;
const MAX_ACTIVE_TASKS = 10;
const RESULT_ARRIVAL_DURATION_MS = 1_400;
const ERROR_VISIBILITY_DURATION_MS = 1_500;
const TASK_HISTORY_STORAGE_KEY = "ai-office:poc-task-history:v1";

interface OfficeWorkflowOptions {
  resolveEndpoint: () => Promise<PocEndpoint>;
}

interface OfficeWorkflowState {
  status: WorkflowStatus;
  stageIndex: number | null;
  currentStage: WorkflowStage | null;
  currentRequest: string | null;
  results: readonly OfficeResult[];
  selectedResult: OfficeResult | null;
  errorMessage: string | null;
  isResultArriving: boolean;
  elapsedSeconds: number;
  tasks: readonly OfficeTask[];
  errorAgentIds: readonly AgentId[];
  queueErrorMessage: string | null;
  startWorkflow: (input: OfficeRequestInput) => boolean;
  cancelTask: (taskId: string) => void;
  clearTaskHistory: () => void;
  openResult: (result: OfficeResult) => void;
  closeResult: () => void;
}

export function useOfficeWorkflow(options: OfficeWorkflowOptions): OfficeWorkflowState {
  const { resolveEndpoint } = options;
  const [status, setStatus] = useState<WorkflowStatus>("idle");
  const [stageIndex, setStageIndex] = useState<number | null>(null);
  const [currentRequest, setCurrentRequest] = useState<string | null>(null);
  const [results, setResults] = useState<readonly OfficeResult[]>([]);
  const [selectedResult, setSelectedResult] = useState<OfficeResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isResultArriving, setIsResultArriving] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [tasks, setTasks] = useState<readonly OfficeTask[]>([]);
  const [isTaskHistoryReady, setIsTaskHistoryReady] = useState(false);
  const [errorAgentIds, setErrorAgentIds] = useState<readonly AgentId[]>([]);
  const [queueErrorMessage, setQueueErrorMessage] = useState<string | null>(null);
  const [isErrorPauseActive, setIsErrorPauseActive] = useState(false);
  const submissionLockRef = useRef(false);
  const requestControllerRef = useRef<AbortController | null>(null);
  const currentTaskIdRef = useRef<string | null>(null);
  const stageIndexRef = useRef<number | null>(null);
  const pendingResultRef = useRef<OfficeResult | null>(null);
  const finalDelayDoneRef = useRef(false);
  const elapsedStartedAtRef = useRef<number | null>(null);
  const prefersReducedMotion = useReducedMotion();
  const closeResult = useCallback(() => setSelectedResult(null), []);

  const failRequest = useCallback((error: unknown, controller: AbortController) => {
    if (isPocAbortError(error) || requestControllerRef.current !== controller) return;
    const message = getErrorMessage(error);
    const failedAgentIds = getStageAgentIds(stageIndexRef.current);
    const taskId = currentTaskIdRef.current;
    requestControllerRef.current = null;
    currentTaskIdRef.current = null;
    submissionLockRef.current = false;
    elapsedStartedAtRef.current = null;
    setElapsedSeconds(0);
    setStageIndex(null);
    setErrorMessage(message);
    setErrorAgentIds(failedAgentIds);
    setIsErrorPauseActive(true);
    if (taskId) {
      setTasks((current) => pruneOfficeTasks(current.map((task) => task.id === taskId
        ? { ...task, status: "failed", errorMessage: message, errorAgentIds: failedAgentIds }
        : task)));
    }
    setStatus("error");
  }, []);

  const completeWorkflow = useCallback((result: OfficeResult) => {
    if (!submissionLockRef.current) return;
    const taskId = currentTaskIdRef.current;
    submissionLockRef.current = false;
    requestControllerRef.current = null;
    currentTaskIdRef.current = null;
    elapsedStartedAtRef.current = null;
    setElapsedSeconds(0);
    setResults((current) => [result, ...current].slice(0, MAX_RESULTS));
    if (taskId) {
      setTasks((current) => pruneOfficeTasks(current.map((task) => task.id === taskId
        ? { ...task, status: "completed", result }
        : task)));
    }
    setIsResultArriving(true);
    setStatus("complete");
  }, []);

  const executeRequest = useCallback(async (request: string, controller: AbortController) => {
    try {
      const endpoint = await resolveEndpoint();
      if (controller.signal.aborted) return;
      const response = await runPocRequest(endpoint, request, controller.signal);
      if (requestControllerRef.current !== controller) return;
      const result = mapPocRunResult(response, request);
      pendingResultRef.current = result;
      if (finalDelayDoneRef.current) completeWorkflow(result);
    } catch (error) {
      failRequest(error, controller);
    }
  }, [completeWorkflow, failRequest, resolveEndpoint]);

  const beginWorkflow = useCallback((task: OfficeTask): void => {
    if (submissionLockRef.current) return;
    const controller = new AbortController();
    submissionLockRef.current = true;
    requestControllerRef.current = controller;
    currentTaskIdRef.current = task.id;
    setTasks((current) => current.map((candidate) => candidate.id === task.id
      ? { ...candidate, status: "running", errorMessage: undefined, errorAgentIds: undefined }
      : candidate));
    setCurrentRequest(task.request);
    setSelectedResult(null);
    setIsResultArriving(false);
    pendingResultRef.current = null;
    finalDelayDoneRef.current = false;
    elapsedStartedAtRef.current = Date.now();
    setElapsedSeconds(0);
    setErrorMessage(null);
    setErrorAgentIds([]);
    setQueueErrorMessage(null);
    setStageIndex(0);
    setStatus("running");
    void executeRequest(task.request, controller);
  }, [executeRequest]);

  const startWorkflow = useCallback((input: OfficeRequestInput): boolean => {
    const activeTaskCount = tasks.filter((task) => task.status === "pending" || task.status === "running").length;
    if (activeTaskCount >= MAX_ACTIVE_TASKS) {
      setQueueErrorMessage(OFFICE_COPY.queue.full);
      return false;
    }
    const task: OfficeTask = {
      id: `task-${createRequestId()}`,
      request: input.request,
      status: "pending",
      submittedAt: new Date().toISOString(),
    };
    setTasks((current) => pruneOfficeTasks([...current, task]));
    setQueueErrorMessage(null);
    return true;
  }, [tasks]);

  const cancelTask = useCallback((taskId: string) => {
    setTasks((current) => current.filter((task) => task.id !== taskId || task.status !== "pending"));
    setQueueErrorMessage(null);
  }, []);

  const clearTaskHistory = useCallback(() => {
    setTasks((current) => current.filter((task) => task.status === "pending" || task.status === "running"));
    setResults([]);
  }, []);

  const finishFinalDelay = useCallback(() => {
    finalDelayDoneRef.current = true;
    const result = pendingResultRef.current;
    if (result) completeWorkflow(result);
  }, [completeWorkflow]);

  useStageTimer(status, stageIndex, prefersReducedMotion, setStageIndex, finishFinalDelay);

  useEffect(() => {
    stageIndexRef.current = stageIndex;
  }, [stageIndex]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      let restored: readonly OfficeTask[] = [];
      try {
        restored = restoreOfficeTasks(window.localStorage.getItem(TASK_HISTORY_STORAGE_KEY));
      } catch {
        // Some private browsing modes disable localStorage entirely.
      }
      setTasks((current) => pruneOfficeTasks([...restored, ...current]));
      setResults(restored.flatMap((task) => task.result ? [task.result] : []).slice(-MAX_RESULTS).reverse());
      setIsTaskHistoryReady(true);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (!isTaskHistoryReady) return;
    try {
      window.localStorage.setItem(TASK_HISTORY_STORAGE_KEY, serializeOfficeTasks(tasks));
    } catch {
      // The synthetic POC keeps working even when browser storage is unavailable or full.
    }
  }, [isTaskHistoryReady, tasks]);

  useEffect(() => {
    if (!isTaskHistoryReady || submissionLockRef.current || isErrorPauseActive) return;
    const nextTask = tasks.find((task) => task.status === "pending");
    if (nextTask) beginWorkflow(nextTask);
  }, [beginWorkflow, isErrorPauseActive, isTaskHistoryReady, tasks]);

  useEffect(() => {
    if (!isErrorPauseActive) return;
    const timeoutId = window.setTimeout(() => setIsErrorPauseActive(false), ERROR_VISIBILITY_DURATION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [isErrorPauseActive]);

  useEffect(() => {
    if (status !== "running") return;
    const intervalId = window.setInterval(() => {
      setElapsedSeconds(calculateWorkflowElapsedSeconds(
        status,
        elapsedStartedAtRef.current,
        Date.now(),
      ));
    }, 1_000);
    return () => window.clearInterval(intervalId);
  }, [status]);

  useEffect(() => {
    if (!isResultArriving) return;
    const timeoutId = window.setTimeout(
      () => setIsResultArriving(false),
      prefersReducedMotion ? REDUCED_MOTION_STAGE_DURATION_MS : RESULT_ARRIVAL_DURATION_MS,
    );
    return () => window.clearTimeout(timeoutId);
  }, [isResultArriving, prefersReducedMotion]);

  useEffect(() => () => requestControllerRef.current?.abort(), []);

  return {
    status,
    stageIndex,
    currentStage: stageIndex === null ? null : DEMO_WORKFLOW[stageIndex],
    currentRequest,
    results,
    selectedResult,
    errorMessage,
    isResultArriving,
    elapsedSeconds,
    tasks,
    errorAgentIds,
    queueErrorMessage,
    startWorkflow,
    cancelTask,
    clearTaskHistory,
    openResult: setSelectedResult,
    closeResult,
  };
}

function getStageAgentIds(stageIndex: number | null): readonly AgentId[] {
  if (stageIndex === null) return ["orchestrator"];
  const stage = DEMO_WORKFLOW[stageIndex];
  return stage?.receiverIds.length ? stage.receiverIds : ["orchestrator"];
}

function useStageTimer(
  status: WorkflowStatus,
  stageIndex: number | null,
  reducedMotion: boolean,
  setStageIndex: Dispatch<SetStateAction<number | null>>,
  finishFinalDelay: () => void,
): void {
  useEffect(() => {
    if (status !== "running" || stageIndex === null) return;
    const stage = DEMO_WORKFLOW[stageIndex];
    const delay = reducedMotion ? REDUCED_MOTION_STAGE_DURATION_MS : stage.durationMs;
    const timeoutId = window.setTimeout(() => {
      if (stageIndex < DEMO_WORKFLOW.length - 1) {
        setStageIndex(stageIndex + 1);
      } else {
        finishFinalDelay();
      }
    }, delay);
    return () => window.clearTimeout(timeoutId);
  }, [finishFinalDelay, reducedMotion, setStageIndex, stageIndex, status]);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.name === "PocClientError" && error.message
    ? error.message
    : OFFICE_COPY.progress.error;
}
