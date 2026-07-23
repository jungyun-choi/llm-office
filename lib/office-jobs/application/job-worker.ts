import type { JobExecutionPort } from "./job-execution.port";
import type { JobRecord, JobRepository, JobState } from "../domain/job-types";
import { JobService, toErrorSnapshot } from "./job-service";
import { JobError } from "../domain/job-errors";
import type { AgentRuntimeProgress } from "../../poc/application/ports/agent-runtime";
import { isSafeCompanyOutputText } from "../../poc/infrastructure/company-output-boundary";
import { buildAnalysisRequest } from "../domain/orbit-intake";

const WORKER_LANES = ["analysis", "development"] as const;
type WorkerLane = (typeof WORKER_LANES)[number];

const LANE_STATES: Record<WorkerLane, readonly JobState[]> = {
  analysis: ["queued"],
  development: ["coding_queued", "publishing"],
};

export class JobWorker {
  private stopped = false;
  private readonly runningLanes = new Set<WorkerLane>();
  private readonly scheduledLanes = new Set<WorkerLane>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly idleWaiters: Array<() => void> = [];

  constructor(
    private readonly repository: JobRepository,
    private readonly executor: JobExecutionPort,
    private readonly service: JobService,
  ) {
    this.service.setQueueHandlers(
      () => this.wake(),
      (jobId) => this.controllers.get(jobId)?.abort(),
    );
  }

  start(): void {
    this.repository.recoverInterruptedJobs(new Date().toISOString());
    this.wake();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const controller of this.controllers.values()) controller.abort();
    if (this.runningLanes.size === 0) return;
    await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  wake(): void {
    for (const lane of WORKER_LANES) this.wakeLane(lane);
  }

  private wakeLane(lane: WorkerLane): void {
    if (this.stopped || this.scheduledLanes.has(lane) || this.runningLanes.has(lane)) return;
    this.scheduledLanes.add(lane);
    setImmediate(() => {
      this.scheduledLanes.delete(lane);
      void this.drain(lane);
    });
  }

  private async drain(lane: WorkerLane): Promise<void> {
    if (this.runningLanes.has(lane) || this.stopped) return;
    this.runningLanes.add(lane);
    try {
      while (!this.stopped) {
        const next = this.repository.nextRunnable(LANE_STATES[lane]);
        if (!next) break;
        await this.run(next);
      }
    } finally {
      this.runningLanes.delete(lane);
      if (this.runningLanes.size === 0) {
        for (const resolve of this.idleWaiters.splice(0)) resolve();
      }
      if (!this.stopped && this.repository.nextRunnable(LANE_STATES[lane])) this.wakeLane(lane);
    }
  }

  private async run(job: JobRecord): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    try {
      if (job.state === "queued") await this.analyze(job, controller.signal);
      else if (job.state === "coding_queued") await this.codeAndTest(job, controller.signal);
      else if (job.state === "publishing") await this.publish(job, controller.signal);
    } finally {
      this.controllers.delete(job.id);
    }
  }

  private async analyze(job: JobRecord, signal: AbortSignal): Promise<void> {
    let current = this.transition(job, "analyzing", "OpenCode 분석팀이 업무를 시작했습니다.", {
      queueOrder: undefined,
      attempts: job.attempts + 1,
      analysisStages: job.analysisStages.map((stage) => stage.id === "research" ? {
        ...stage,
        status: "running",
        phase: "preparing_context",
        attempt: job.attempts + 1,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } : stage),
    });
    try {
      const baseSha = await this.executor.resolveBaseSha(signal);
      current = this.repository.update(current.id, current.version, {
        baseSha,
        updatedAt: new Date().toISOString(),
      });
      const analysis = await this.executor.runAnalysis(
        buildAnalysisRequest(
          current.prompt,
          current.intakeBrief,
          current.analysisFeedback,
          current.analysisHistory?.at(-1)?.result,
        ),
        current.executionMode,
        `analysis:${current.id}:${current.attempts}`,
        signal,
        (progress) => this.updateAnalysisProgress(current.id, progress),
      );
      current = this.repository.get(current.id) ?? current;
      if (current.cancelRequested) {
        this.finishCanceled(current);
        return;
      }
      if (signal.aborted) throw new Error("worker stopped");
      current = this.repository.update(current.id, current.version, { analysis });
      const codingPacket = await this.service.buildCodingPacket(current, analysis);
      current = this.repository.update(current.id, current.version, {
        state: "awaiting_coding_approval",
        codingPacket,
        analysisStages: completedAnalysisStages(current, analysis),
        updatedAt: new Date().toISOString(),
        queueOrder: undefined,
      });
      this.event(current, "state", "분석 결과가 준비되었습니다. Claude 코딩 승인을 기다립니다.");
    } catch (error) {
      this.failLatest(job.id, "analysis", error);
    }
  }

  private async codeAndTest(job: JobRecord, signal: AbortSignal): Promise<void> {
    let current = this.transition(job, "coding", "Claude 개발팀이 코딩을 시작했습니다.", {
      queueOrder: undefined,
      attempts: job.attempts + 1,
    });
    try {
      const coding = await this.executor.runCoding(current, signal);
      current = this.repository.get(current.id) ?? current;
      if (current.cancelRequested) {
        this.finishCanceled(current);
        return;
      }
      if (signal.aborted) throw new Error("worker stopped");
      if (coding.kind === "awaiting_human_input") {
        const createdAt = new Date().toISOString();
        current = this.repository.update(current.id, current.version, {
          state: "awaiting_development_input",
          queueOrder: undefined,
          updatedAt: createdAt,
          worktreePath: coding.worktreePath ?? current.worktreePath,
          branchName: coding.branchName ?? current.branchName,
          claudeModel: coding.model ?? current.claudeModel,
          claudeOutput: coding.output ?? current.claudeOutput,
          developmentQuestion: {
            ...coding.question,
            id: crypto.randomUUID(),
            status: "open",
            createdAt,
          },
        });
        this.event(current, "state", "아틀라스가 개발 중 사람의 판단이 필요한 질문을 보냈습니다.");
        return;
      }
      current = this.repository.update(current.id, current.version, {
        state: "testing",
        updatedAt: new Date().toISOString(),
        worktreePath: coding.worktreePath,
        branchName: coding.branchName,
        claudeModel: coding.model,
        claudeOutput: coding.output,
        changedFiles: coding.changedFiles,
        diff: coding.diff,
        diffTruncated: coding.diffTruncated,
        changesDigest: coding.changesDigest,
        changesManifest: coding.changesManifest,
      });
      this.event(current, "state", "코딩이 끝나 서버가 허용된 테스트를 실행합니다.");
      const test = await this.executor.runTests(current, signal);
      current = this.repository.get(current.id) ?? current;
      if (current.cancelRequested) {
        this.finishCanceled(current);
        return;
      }
      if (signal.aborted) throw new Error("worker stopped");
      current = this.repository.update(current.id, current.version, {
        state: "changes_ready",
        updatedAt: new Date().toISOString(),
        testStatus: test.passed ? "passed" : "failed",
        testOutput: test.output,
        testOutputTruncated: test.truncated,
      });
      this.event(
        current,
        test.passed ? "state" : "error",
        test.passed
          ? "변경과 테스트 결과가 준비되었습니다. 게시 승인을 기다립니다."
          : "변경은 준비되었지만 테스트가 실패했습니다. 결과를 확인해 주세요.",
      );
    } catch (error) {
      this.failLatest(job.id, current.state === "testing" ? "testing" : "coding", error);
    }
  }

  private async publish(job: JobRecord, signal: AbortSignal): Promise<void> {
    let current = this.repository.update(job.id, job.version, {
      queueOrder: undefined,
      updatedAt: new Date().toISOString(),
    });
    this.event(current, "state", "승인된 Git 게시 작업을 시작했습니다.");
    try {
      if (!current.requestedPublishMode) throw new Error("publish mode missing");
      const published = await this.executor.publish(current, current.requestedPublishMode, signal);
      current = this.repository.get(current.id) ?? current;
      if (current.cancelRequested) {
        this.finishCanceled(current);
        return;
      }
      if (signal.aborted) throw new Error("worker stopped");
      const awaitingReview = published.mode === "commit_and_push";
      current = this.repository.update(current.id, current.version, {
        state: awaitingReview ? "review_pending" : "completed",
        updatedAt: new Date().toISOString(),
        commitSha: published.commitSha,
        pullRequestUrl: published.pullRequestUrl ?? current.pullRequestUrl,
        pullRequestNumber: published.pullRequestNumber ?? current.pullRequestNumber,
        pullRequestError: published.pullRequestError,
      });
      this.event(
        current,
        "state",
        awaitingReview
          ? published.pullRequestUrl
            ? "원격 브랜치와 PR이 준비되었습니다. 최종 코드 검토를 기다립니다."
            : "원격 브랜치는 게시됐지만 PR 자동 생성에 실패했습니다. 설정을 확인해 주세요."
          : "검토된 변경을 작업 브랜치에 커밋했습니다.",
      );
      if (!awaitingReview) current = await this.service.publishCompletedIssue(current);
    } catch (error) {
      const commitSha = commitShaFromError(error);
      const latest = this.repository.get(job.id);
      if (commitSha && latest) {
        this.repository.update(job.id, latest.version, {
          commitSha,
          updatedAt: new Date().toISOString(),
        });
      }
      this.failLatest(job.id, "publishing", error);
    }
  }

  private transition(
    current: JobRecord,
    state: JobState,
    message: string,
    patch: Partial<JobRecord>,
  ): JobRecord {
    const next = this.repository.update(current.id, current.version, {
      ...patch,
      state,
      updatedAt: new Date().toISOString(),
      error: undefined,
    });
    this.event(next, "state", message);
    return next;
  }

  private finishCanceled(current: JobRecord): void {
    const latest = this.repository.get(current.id) ?? current;
    if (latest.state === "canceled") return;
    const canceled = this.repository.update(latest.id, latest.version, {
      state: "canceled",
      queueOrder: undefined,
      cancelRequested: false,
      updatedAt: new Date().toISOString(),
    });
    this.event(canceled, "state", "업무를 취소했습니다.");
  }

  private failLatest(
    jobId: string,
    stage: "analysis" | "coding" | "testing" | "publishing",
    error: unknown,
  ): void {
    const latest = this.repository.get(jobId);
    if (!latest) return;
    if (latest.cancelRequested) {
      this.finishCanceled(latest);
      return;
    }
    const snapshot = toErrorSnapshot(error, stage);
    const failed = this.repository.update(jobId, latest.version, {
      state: "failed",
      queueOrder: undefined,
      updatedAt: new Date().toISOString(),
      error: snapshot,
      analysisStages: stage === "analysis"
        ? latest.analysisStages.map((item) => item.status === "running" ? {
          ...item,
          status: "failed",
          phase: undefined,
          updatedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          summary: undefined,
        } : item)
        : latest.analysisStages,
      cancelRequested: false,
    });
    this.event(failed, "error", snapshot.message);
  }

  private updateAnalysisProgress(jobId: string, progress: AgentRuntimeProgress): void {
    const latest = this.repository.get(jobId);
    if (!latest || latest.state !== "analyzing" || latest.cancelRequested) return;
    const now = new Date().toISOString();
    const analysisStages = latest.analysisStages.map((stage) => {
      if (stage.id !== progress.role) {
        if (progress.status === "running" && stage.status === "running") {
          return {
            ...stage,
            status: "completed" as const,
            phase: undefined,
            updatedAt: now,
            completedAt: now,
            summary: undefined,
          };
        }
        return stage;
      }
      const completed = progress.status === "completed";
      const terminal = completed || progress.status === "failed";
      return {
        ...stage,
        status: progress.status,
        phase: terminal ? undefined : progress.phase,
        attempt: validAttempt(progress.attempt) ?? stage.attempt,
        startedAt: stage.startedAt ?? (progress.status === "pending" ? undefined : now),
        updatedAt: now,
        completedAt: terminal ? now : undefined,
        summary: completed ? safeSummary(progress.summary) : undefined,
      };
    });
    const updated = this.repository.update(jobId, latest.version, {
      analysisStages,
      updatedAt: now,
    });
    this.event(updated, progress.status === "failed" ? "error" : "state", analysisProgressMessage(progress));
  }

  private event(
    job: JobRecord,
    kind: "state" | "error",
    message: string,
  ): void {
    this.repository.appendEvent(job.id, {
      kind,
      state: job.state,
      message,
      createdAt: job.updatedAt,
    });
  }
}

function commitShaFromError(error: unknown): string | undefined {
  if (!(error instanceof JobError) || !isRecord(error.details)) return undefined;
  const commitSha = error.details.commitSha;
  return typeof commitSha === "string" && /^[a-f0-9]{40,64}$/u.test(commitSha)
    ? commitSha
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function completedAnalysisStages(
  job: JobRecord,
  analysis: NonNullable<JobRecord["analysis"]>,
): JobRecord["analysisStages"] {
  const now = new Date().toISOString();
  const summaries = new Map(analysis.stages.map((stage) => [stage.role, stage.summary]));
  return job.analysisStages.map((stage) => ({
    ...stage,
    status: "completed",
    phase: undefined,
    startedAt: stage.startedAt ?? now,
    updatedAt: now,
    completedAt: now,
    summary: safeSummary(summaries.get(stage.id)),
  }));
}

function validAttempt(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isInteger(value) || value < 1 || value > 100) {
    return undefined;
  }
  return value;
}

function safeSummary(value: string | undefined): string | undefined {
  if (!value || !isSafeCompanyOutputText(value)) return undefined;
  return value.replace(/[\u0000-\u001F\u007F]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 500) || undefined;
}

function analysisProgressMessage(progress: AgentRuntimeProgress): string {
  const label = progress.role === "orchestrator" ? "오케스트레이터" : progress.role;
  if (progress.status === "completed") return `${label} 분석 단계가 완료되었습니다.`;
  if (progress.status === "failed") return `${label} 분석 단계에서 문제가 발생했습니다.`;
  if (progress.status === "running") return `${label} 분석 단계가 진행 중입니다.`;
  return `${label} 분석 단계가 대기 중입니다.`;
}
