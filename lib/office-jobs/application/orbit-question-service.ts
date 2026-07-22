import { JobError } from "../domain/job-errors";
import type { OrbitQuestionResult } from "../domain/orbit-question-schema";
import { PocRunnerError } from "../../poc/domain/poc-errors";

export interface OrbitQuestionGenerator {
  generate(request: string, signal?: AbortSignal): Promise<OrbitQuestionResult>;
}

export class OrbitQuestionService {
  constructor(private readonly generator: OrbitQuestionGenerator) {}

  async generate(request: string, signal?: AbortSignal): Promise<OrbitQuestionResult> {
    try {
      return await this.generator.generate(request, signal);
    } catch (error) {
      throw toOrbitQuestionError(error);
    }
  }
}

function toOrbitQuestionError(error: unknown): JobError {
  if (error instanceof JobError) return error;
  if (!(error instanceof PocRunnerError)) {
    return new JobError(
      "ORBIT_MODEL_ERROR",
      "오비트가 맞춤 질문을 준비하지 못했습니다.",
      502,
      true,
    );
  }
  if (error.reason === "unavailable") {
    return new JobError(
      "ORBIT_MODEL_UNAVAILABLE",
      "사내 OpenCode 오비트를 사용할 수 없습니다.",
      503,
      true,
    );
  }
  if (error.reason === "timeout") {
    return new JobError(
      "ORBIT_MODEL_TIMEOUT",
      "오비트의 질문 준비 시간이 초과되었습니다.",
      504,
      true,
    );
  }
  if (error.reason === "aborted") {
    return new JobError("ORBIT_REQUEST_ABORTED", "오비트 미팅 요청이 취소되었습니다.", 408, true);
  }
  return new JobError(
    error.reason === "invalid_output" ? "ORBIT_INVALID_OUTPUT" : "ORBIT_MODEL_ERROR",
    "오비트가 맞춤 질문을 준비하지 못했습니다.",
    502,
    true,
  );
}
