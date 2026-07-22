import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";

const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
const webArguments = process.argv.slice(2);
const children: ChildProcess[] = [];
const childEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  AI_OFFICE_BRIDGE_TOKEN: randomBytes(32).toString("base64url"),
};
const bridgeScript = process.env.AI_OFFICE_OPENCODE_PROFILE === "company"
  ? "poc:bridge:company"
  : "poc:bridge:office:poc";
let stopping = false;

children.push(start(["run", bridgeScript]));
children.push(start(["run", "dev:poc", "--", ...webArguments]));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => stop(signal));
}

await new Promise<void>((resolve) => {
  let remaining = children.length;
  for (const child of children) {
    child.once("exit", (code, signal) => {
      remaining -= 1;
      if (!stopping) {
        process.exitCode = code ?? (signal ? 1 : 0);
        stop("SIGTERM");
      }
      if (remaining === 0) resolve();
    });
  }
});

function start(args: string[]): ChildProcess {
  return spawn(npmExecutable, args, {
    cwd: process.cwd(),
    env: childEnvironment,
    stdio: "inherit",
    shell: false,
    detached: process.platform !== "win32",
  });
}

function stop(signal: NodeJS.Signals): void {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.killed) continue;
    if (process.platform !== "win32" && child.pid) {
      try {
        process.kill(-child.pid, signal);
        continue;
      } catch {
        // The process group may have already exited.
      }
    }
    child.kill(signal);
  }
}
