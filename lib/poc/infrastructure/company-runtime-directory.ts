import os from "node:os";
import path from "node:path";
import { PocRunnerError } from "../domain/poc-errors";

const COMPANY_RUNTIME_PREFIX = "ai-office-company-turn-";

export interface CompanyRuntimeDirectory {
  root: string;
  home: string;
  config: string;
  data: string;
  cache: string;
  state: string;
  tmp: string;
  workspace: string;
}

export async function createCompanyRuntimeDirectory(): Promise<CompanyRuntimeDirectory> {
  const { chmod, mkdir, mkdtemp, realpath, rm } = await import("node:fs/promises");
  const runtimeRoot = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(runtimeRoot, COMPANY_RUNTIME_PREFIX));
  try {
    if (path.dirname(root) !== runtimeRoot || !path.basename(root).startsWith(COMPANY_RUNTIME_PREFIX)) {
      throw new PocRunnerError("unavailable");
    }
    await chmod(root, 0o700);
    const directory: CompanyRuntimeDirectory = {
      root,
      home: path.join(root, "home"),
      config: path.join(root, "config"),
      data: path.join(root, "data"),
      cache: path.join(root, "cache"),
      state: path.join(root, "state"),
      tmp: path.join(root, "tmp"),
      workspace: path.join(root, "workspace"),
    };
    await Promise.all(
      Object.values(directory)
        .filter((candidate) => candidate !== root)
        .map((candidate) => mkdir(candidate, { mode: 0o700 })),
    );
    return directory;
  } catch {
    await rm(root, { recursive: true, force: true });
    throw new PocRunnerError("unavailable");
  }
}

export async function removeCompanyRuntimeDirectory(runtimeDirectory: string): Promise<void> {
  const { realpath, rm } = await import("node:fs/promises");
  const runtimeRoot = await realpath(os.tmpdir());
  if (
    path.dirname(runtimeDirectory) !== runtimeRoot ||
    !path.basename(runtimeDirectory).startsWith(COMPANY_RUNTIME_PREFIX)
  ) {
    return;
  }
  await rm(runtimeDirectory, { recursive: true, force: true });
}
