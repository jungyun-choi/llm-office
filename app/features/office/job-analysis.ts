import { mapPocRunResult } from "./api/map-poc-result";
import { pocRunResultSchema } from "./api/poc-contract";
import type { OfficeJob, OfficeResult, OfficeResultPreview } from "./types";

export function getJobAnalysisResult(job: OfficeJob): OfficeResult | null {
  const parsed = pocRunResultSchema.safeParse(job.analysis);
  return parsed.success ? mapPocRunResult(parsed.data, job.prompt) : null;
}

export function getAnalysisResultPreviews(jobs: readonly OfficeJob[]): readonly OfficeResultPreview[] {
  return jobs.flatMap((job) => {
    const result = getJobAnalysisResult(job);
    if (result) {
      return [{
        jobId: job.id,
        runId: result.id,
        title: result.title,
        summary: result.summary,
        createdAt: result.createdAt,
      }];
    }
    return job.analysisPreview ? [{
      jobId: job.analysisPreview.jobId,
      runId: job.analysisPreview.runId,
      title: job.analysisPreview.title,
      summary: job.analysisPreview.objective,
      createdAt: job.analysisPreview.completedAt,
    }] : [];
  });
}
