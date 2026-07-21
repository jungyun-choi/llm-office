import { PocCapacityError, PocError } from "../domain/poc-errors";

const IDEMPOTENCY_TTL_MS = 60_000;
const MAX_COMPLETED_RUNS = 16;

interface CompletedRun<T> {
  fingerprint: string;
  result: T;
  expiresAt: number;
}

class SingleFlightGate {
  private active?: { key: string; fingerprint: string; promise: Promise<unknown> };
  private readonly completed = new Map<string, CompletedRun<unknown>>();

  async run<T>(
    key: string,
    fingerprint: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    this.removeExpired();
    const completed = this.completed.get(key) as CompletedRun<T> | undefined;
    if (completed) return this.reuse(completed.fingerprint, fingerprint, completed.result);
    if (this.active?.key === key) {
      this.assertSameRequest(this.active.fingerprint, fingerprint);
      return this.active.promise as Promise<T>;
    }
    if (this.active) throw new PocCapacityError();

    const promise = operation();
    this.active = { key, fingerprint, promise };
    try {
      const result = await promise;
      this.remember(key, fingerprint, result);
      return result;
    } finally {
      if (this.active?.promise === promise) this.active = undefined;
    }
  }

  private reuse<T>(stored: string, incoming: string, result: T): T {
    this.assertSameRequest(stored, incoming);
    return result;
  }

  private assertSameRequest(stored: string, incoming: string): void {
    if (stored === incoming) return;
    throw new PocError(
      "IDEMPOTENCY_KEY_REUSED",
      "같은 Idempotency-Key를 다른 요청에 사용할 수 없습니다.",
      409,
      false,
    );
  }

  private remember<T>(key: string, fingerprint: string, result: T): void {
    if (this.completed.size >= MAX_COMPLETED_RUNS) {
      const oldestKey = this.completed.keys().next().value as string | undefined;
      if (oldestKey) this.completed.delete(oldestKey);
    }
    this.completed.set(key, {
      fingerprint,
      result,
      expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
    });
  }

  private removeExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.completed) {
      if (entry.expiresAt <= now) this.completed.delete(key);
    }
  }
}

export const pocSingleFlight = new SingleFlightGate();
