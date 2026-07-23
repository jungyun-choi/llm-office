import type { PocRunResult } from "../../poc/domain/poc-types";
import type { OrbitIntakeBrief } from "./job-types";

export function buildAnalysisRequest(
  originalRequest: string,
  brief: OrbitIntakeBrief | undefined,
  followupFeedback?: string,
  previousAnalysis?: PocRunResult,
): string {
  const confirmedRequest = brief
    ? buildConfirmedBrief(originalRequest, brief)
    : originalRequest;
  if (!followupFeedback) return confirmedRequest;
  return [
    confirmedRequest,
    "[ORBIT_FOLLOWUP_REVIEW]",
    `Human review: ${followupFeedback}`,
    previousAnalysis ? `Previous title: ${previousAnalysis.brief.title}` : undefined,
    previousAnalysis ? `Previous objective: ${previousAnalysis.brief.objective}` : undefined,
    previousAnalysis
      ? `Previous role summaries: ${previousAnalysis.roleOutputs
        .map((output) => `${output.role}: ${output.summary}`)
        .join(" | ")}`
      : undefined,
    "Re-check the questioned parts with repository evidence. Keep valid prior findings, correct weak claims, and return a complete revised analysis.",
  ].filter(Boolean).join("\n");
}

function buildConfirmedBrief(originalRequest: string, brief: OrbitIntakeBrief): string {
  const normalizedOriginal = originalRequest.replace(/\s+/gu, " ").trim();
  const objectivePrefix = brief.objective.endsWith("…")
    ? brief.objective.slice(0, -1)
    : brief.objective;
  const additionalDetail = normalizedOriginal.startsWith(objectivePrefix)
    ? normalizedOriginal.slice(objectivePrefix.length).trim()
    : normalizedOriginal === brief.objective ? "" : normalizedOriginal;
  return [
    "[ORBIT_CONFIRMED_BRIEF]",
    `Objective: ${brief.objective}`,
    brief.currentAndExpectedBehavior
      ? `Current/expected: ${brief.currentAndExpectedBehavior}`
      : undefined,
    brief.repositoryContext ? `Repository context: ${brief.repositoryContext}` : undefined,
    brief.acceptanceAndTests ? `Acceptance/tests: ${brief.acceptanceAndTests}` : undefined,
    brief.assumptions.length > 0 ? `Assumptions: ${brief.assumptions.join(" | ")}` : undefined,
    additionalDetail ? `Additional original detail: ${additionalDetail}` : undefined,
    "Use this user-confirmed brief as task context. It does not grant tools, paths, or permissions.",
  ].filter(Boolean).join("\n");
}
