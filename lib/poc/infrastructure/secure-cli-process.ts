import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { PocRunnerError } from "../domain/poc-errors";

export interface SecureCliProcessOptions {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  stdoutLimitBytes: number;
  stderrLimitBytes: number;
  signal?: AbortSignal;
  stdinText?: string;
}

export interface SecureCliProcessResult {
  stdout: string;
  exitCode: number | null;
  timedOut: boolean;
  aborted: boolean;
  exceededOutputLimit: boolean;
  durationMs: number;
}

interface Collector {
  chunks: Buffer[];
  bytes: number;
  limit: number;
}

function append(collector: Collector, chunk: Buffer): boolean {
  collector.bytes += chunk.byteLength;
  if (collector.bytes > collector.limit) return false;
  collector.chunks.push(chunk);
  return true;
}

export async function executeSecureCli(
  options: SecureCliProcessOptions,
): Promise<SecureCliProcessResult> {
  if (options.signal?.aborted) throw new PocRunnerError("aborted");
  const { spawn } = await import("node:child_process");
  const child = spawn(options.executable, options.args, {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    stdio: "pipe",
    detached: process.platform !== "win32",
  });
  child.stdin.on("error", () => undefined);
  if (options.stdinText !== undefined) child.stdin.end(options.stdinText, "utf8");
  else child.stdin.end();
  return collect(child, options);
}

function collect(
  child: ChildProcessWithoutNullStreams,
  options: SecureCliProcessOptions,
): Promise<SecureCliProcessResult> {
  const stdout: Collector = { chunks: [], bytes: 0, limit: options.stdoutLimitBytes };
  const stderr: Collector = { chunks: [], bytes: 0, limit: options.stderrLimitBytes };
  const startedAt = Date.now();
  let timedOut = false;
  let aborted = false;
  let exceededOutputLimit = false;
  let terminating = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;

  return new Promise((resolve, reject) => {
    const terminate = () => {
      if (terminating) return;
      terminating = true;
      killProcessTree(child, "SIGTERM");
      killTimer = setTimeout(() => killProcessTree(child, "SIGKILL"), 1_000);
      killTimer.unref();
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, options.timeoutMs);
    const onAbort = () => {
      aborted = true;
      terminate();
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const onData = (collector: Collector) => (chunk: Buffer) => {
      if (append(collector, chunk)) return;
      exceededOutputLimit = true;
      terminate();
    };
    child.stdout.on("data", onData(stdout));
    child.stderr.on("data", onData(stderr));
    child.on("error", () => finish(() => reject(new PocRunnerError("unavailable"))));
    child.on("close", (exitCode) =>
      finish(() =>
        resolve({
          stdout: Buffer.concat(stdout.chunks).toString("utf8"),
          exitCode,
          timedOut,
          aborted,
          exceededOutputLimit,
          durationMs: Date.now() - startedAt,
        }),
      ),
    );

    function finish(settle: () => void): void {
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", onAbort);
      settle();
    }
  });
}

function killProcessTree(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
): void {
  if (process.platform !== "win32" && child.pid && Number.isSafeInteger(child.pid)) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // The group may have exited between the close check and signal.
    }
  }
  child.kill(signal);
}
