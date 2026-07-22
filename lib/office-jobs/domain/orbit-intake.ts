import type { OrbitIntakeBrief } from "./job-types";

export function buildAnalysisRequest(
  originalRequest: string,
  brief: OrbitIntakeBrief | undefined,
): string {
  if (!brief) return originalRequest;
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
