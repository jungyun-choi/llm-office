export class JobError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "JobError";
  }
}

export function jobNotFound(): JobError {
  return new JobError("JOB_NOT_FOUND", "업무를 찾지 못했습니다.", 404, false);
}

export function staleJobVersion(): JobError {
  return new JobError(
    "STALE_JOB_VERSION",
    "업무 상태가 변경되었습니다. 최신 상태를 확인한 뒤 다시 시도해 주세요.",
    409,
    true,
  );
}
