"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import { isPocAbortError, runPocRequest, type PocEndpoint } from "../api/poc-client";
import { mapPocRunResult } from "../api/map-poc-result";
import { OFFICE_COPY } from "../copy";
import { DEMO_WORKFLOW, REDUCED_MOTION_STAGE_DURATION_MS } from "../office-data";
import type { OfficeRequestInput, OfficeResult, WorkflowStage, WorkflowStatus } from "../types";
import { useReducedMotion } from "./use-reduced-motion";

const MAX_RESULTS = 3;
const RESULT_ARRIVAL_DURATION_MS = 1_400;

interface OfficeWorkflowOptions {
  resolveEndpoint: () => Promise<PocEndpoint>;
  markHostedFallback: () => void;
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
  startWorkflow: (input: OfficeRequestInput) => boolean;
  openResult: (result: OfficeResult) => void;
  closeResult: () => void;
}

export function useOfficeWorkflow(options: OfficeWorkflowOptions): OfficeWorkflowState {
  const { markHostedFallback, resolveEndpoint } = options;
  const [status, setStatus] = useState<WorkflowStatus>("idle");
  const [stageIndex, setStageIndex] = useState<number | null>(null);
  const [currentRequest, setCurrentRequest] = useState<string | null>(null);
  const [results, setResults] = useState<readonly OfficeResult[]>([]);
  const [selectedResult, setSelectedResult] = useState<OfficeResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isResultArriving, setIsResultArriving] = useState(false);
  const submissionLockRef = useRef(false);
  const requestControllerRef = useRef<AbortController | null>(null);
  const pendingResultRef = useRef<OfficeResult | null>(null);
  const finalDelayDoneRef = useRef(false);
  const prefersReducedMotion = useReducedMotion();
  const closeResult = useCallback(() => setSelectedResult(null), []);

  const failRequest = useCallback((error: unknown, controller: AbortController) => {
    if (isPocAbortError(error) || requestControllerRef.current !== controller) return;
    requestControllerRef.current = null;
    submissionLockRef.current = false;
    setStageIndex(null);
    setErrorMessage(getErrorMessage(error));
    setStatus("error");
  }, []);

  const completeWorkflow = useCallback((result: OfficeResult) => {
    if (!submissionLockRef.current) return;
    submissionLockRef.current = false;
    requestControllerRef.current = null;
    setResults((current) => [result, ...current].slice(0, MAX_RESULTS));
    setIsResultArriving(true);
    setStatus("complete");
  }, []);

  const executeRequest = useCallback(async (request: string, controller: AbortController) => {
    try {
      const endpoint = await resolveEndpoint();
      if (controller.signal.aborted) return;
      const outcome = await runPocRequest(endpoint, request, controller.signal);
      if (requestControllerRef.current !== controller) return;
      if (outcome.usedHostedFallback) markHostedFallback();
      const result = mapPocRunResult(outcome.result, request);
      pendingResultRef.current = result;
      if (finalDelayDoneRef.current) completeWorkflow(result);
    } catch (error) {
      failRequest(error, controller);
    }
  }, [completeWorkflow, failRequest, markHostedFallback, resolveEndpoint]);

  const startWorkflow = useCallback((input: OfficeRequestInput): boolean => {
    if (submissionLockRef.current) return false;
    const controller = new AbortController();
    submissionLockRef.current = true;
    requestControllerRef.current = controller;
    setCurrentRequest(input.request);
    setSelectedResult(null);
    setIsResultArriving(false);
    pendingResultRef.current = null;
    finalDelayDoneRef.current = false;
    setErrorMessage(null);
    setStageIndex(0);
    setStatus("running");
    void executeRequest(input.request, controller);
    return true;
  }, [executeRequest]);

  const finishFinalDelay = useCallback(() => {
    finalDelayDoneRef.current = true;
    const result = pendingResultRef.current;
    if (result) completeWorkflow(result);
  }, [completeWorkflow]);

  useStageTimer(status, stageIndex, prefersReducedMotion, setStageIndex, finishFinalDelay);

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
    startWorkflow,
    openResult: setSelectedResult,
    closeResult,
  };
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
