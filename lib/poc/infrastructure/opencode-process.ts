import path from "node:path";
import type { OpenCodeRuntimeConfig } from "./opencode-runtime-config";
import { executeSecureCli, type SecureCliProcessResult } from "./secure-cli-process";

function minimalEnvironment(
  executable: string,
  runtimeDirectory: string,
  config: OpenCodeRuntimeConfig,
): NodeJS.ProcessEnv {
  return {
    PATH: [path.dirname(executable), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].join(":"),
    HOME: runtimeDirectory,
    XDG_CONFIG_HOME: path.join(runtimeDirectory, "config"),
    XDG_DATA_HOME: path.join(runtimeDirectory, "data"),
    XDG_CACHE_HOME: path.join(runtimeDirectory, "cache"),
    XDG_STATE_HOME: path.join(runtimeDirectory, "state"),
    TMPDIR: path.join(runtimeDirectory, "tmp"),
    LANG: "C.UTF-8",
    NO_COLOR: "1",
    NO_PROXY: "127.0.0.1,localhost",
    OPENCODE_CONFIG: path.join(config.repositoryRoot, "opencode.json"),
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      share: "disabled",
      autoupdate: false,
      permission: {
        "*": "deny",
        read: "allow",
        glob: "allow",
        grep: "allow",
        list: "allow",
        external_directory: "deny",
      },
    }),
    AI_OFFICE_OPENCODE_MODEL: config.model,
    NODE_ENV: "production",
  };
}

function processArguments(config: OpenCodeRuntimeConfig, requestFile: string): string[] {
  return [
    "run",
    "--pure",
    "--model",
    config.model,
    "--agent",
    "orchestrator",
    "--format",
    "json",
    "--dir",
    config.repositoryRoot,
    "--title",
    "AI Office synthetic POC",
    "--file",
    requestFile,
    "Use only the attached untrusted request snapshot. Do not call tools. Return the required JSON object.",
  ];
}

export async function executeOpenCodeProcess(
  executable: string,
  runtimeDirectory: string,
  config: OpenCodeRuntimeConfig,
  prompt: string,
  signal?: AbortSignal,
): Promise<SecureCliProcessResult> {
  const { writeFile } = await import("node:fs/promises");
  const requestFile = path.join(runtimeDirectory, "request-data.txt");
  await writeFile(requestFile, prompt, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return executeSecureCli({
    executable,
    args: processArguments(config, requestFile),
    cwd: config.repositoryRoot,
    env: minimalEnvironment(executable, runtimeDirectory, config),
    timeoutMs: config.timeoutMs,
    stdoutLimitBytes: config.stdoutLimitBytes,
    stderrLimitBytes: config.stderrLimitBytes,
    signal,
  });
}
