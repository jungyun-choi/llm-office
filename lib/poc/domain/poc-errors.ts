export class PocError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "PocError";
  }
}

export class PocCapacityError extends PocError {
  constructor() {
    super(
      "POC_RUN_IN_PROGRESS",
      "다른 POC 실행이 진행 중입니다. 잠시 후 다시 시도해 주세요.",
      429,
      true,
    );
  }
}

export class PocRunnerError extends Error {
  constructor(
    readonly reason:
      | "unavailable"
      | "timeout"
      | "aborted"
      | "model_error"
      | "invalid_output",
  ) {
    super(reason);
    this.name = "PocRunnerError";
  }
}
