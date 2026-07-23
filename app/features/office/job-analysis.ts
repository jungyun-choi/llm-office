import { mapPocRunResult } from "./api/map-poc-result";
import { pocRunResultSchema } from "./api/poc-contract";
import type { OfficeJob, OfficeResult, OfficeResultPreview } from "./types";

export function getJobAnalysisResult(job: OfficeJob, runId?: string): OfficeResult | null {
  const current = pocRunResultSchema.safeParse(job.analysis);
  if (current.success && (!runId || current.data.runId === runId)) {
    return {
      ...mapPocRunResult(current.data, job.prompt),
      sourceJobId: job.id,
      isCurrentRevision: true,
    };
  }
  if (!runId) return null;
  for (const revision of job.analysisHistory ?? []) {
    const parsed = pocRunResultSchema.safeParse(revision.result);
    if (parsed.success && (!runId || parsed.data.runId === runId)) {
      return {
        ...mapPocRunResult(parsed.data, job.prompt),
        sourceJobId: job.id,
        isCurrentRevision: false,
        reviewFeedback: revision.feedback,
      };
    }
  }
  return null;
}

export function getAnalysisResultPreviews(jobs: readonly OfficeJob[]): readonly OfficeResultPreview[] {
  return jobs.flatMap((job) => {
    const result = getJobAnalysisResult(job);
    const history = job.detailLevel === "full"
      ? [...(job.analysisHistory ?? [])].reverse().flatMap((revision) => {
        const runId = readRevisionRunId(revision.result);
        if (!runId) return [];
        const mapped = getJobAnalysisResult(job, runId);
        return mapped ? [toPreview(job.id, mapped, false, revision.feedback)] : [];
      })
      : [...(job.analysisHistoryPreviews ?? [])].reverse().map((preview) => ({
        jobId: preview.jobId,
        runId: preview.runId,
        title: preview.title,
        summary: preview.objective,
        createdAt: preview.completedAt,
        isCurrentRevision: false,
        reviewFeedback: preview.feedback,
      }));
    if (result) {
      return [toPreview(job.id, result, true), ...history];
    }
    return job.analysisPreview ? [{
      jobId: job.analysisPreview.jobId,
      runId: job.analysisPreview.runId,
      title: job.analysisPreview.title,
      summary: job.analysisPreview.objective,
      createdAt: job.analysisPreview.completedAt,
      isCurrentRevision: true,
    }, ...history] : history;
  });
}

function toPreview(
  jobId: string,
  result: OfficeResult,
  isCurrentRevision: boolean,
  reviewFeedback?: string,
): OfficeResultPreview {
  return {
    jobId,
    runId: result.id,
    title: result.title,
    summary: result.summary,
    createdAt: result.createdAt,
    isCurrentRevision,
    reviewFeedback,
  };
}

function readRevisionRunId(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const runId = Reflect.get(value, "runId");
  return typeof runId === "string" ? runId : undefined;
}
