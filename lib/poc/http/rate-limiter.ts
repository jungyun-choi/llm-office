import { PocError } from "../domain/poc-errors";

const WINDOW_MS = 60 * 60 * 1_000;
const MAX_REQUESTS = 100;
const MAX_CLIENTS = 1_000;
const clients = new Map<string, { count: number; resetAt: number }>();

export function enforcePocRateLimit(request: Request): void {
  const client = request.headers.get("cf-connecting-ip") ?? "local-bridge";
  const now = Date.now();
  const existing = clients.get(client);
  if (!existing || existing.resetAt <= now) {
    if (clients.size >= MAX_CLIENTS) clients.delete(clients.keys().next().value as string);
    clients.set(client, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  existing.count += 1;
  if (existing.count > MAX_REQUESTS) {
    throw new PocError("RATE_LIMITED", "요청 한도를 초과했습니다.", 429, true);
  }
}
