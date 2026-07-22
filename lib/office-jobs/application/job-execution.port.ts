import type { PocRunResult } from "../../poc/domain/poc-types";
import type { AgentRuntimeProgressCallback } from "../../poc/application/ports/agent-runtime";
import type {
  ChangeManifestEntry,
  JobExecutionMode,
  JobRecord,
  PublishMode,
} from "../domain/job-types";

export interface CodingExecutionResult {
  worktreePath: string;
  branchName: string;
  model: string;
  output: string;
  changedFiles: string[];
  diff: string;
  diffTruncated: boolean;
  changesDigest: string;
  changesManifest: ChangeManifestEntry[];
}

export interface TestExecutionResult {
  passed: boolean;
  output: string;
  truncated: boolean;
}

export interface PublishExecutionResult {
  commitSha: string;
  mode: PublishMode;
  pullRequestUrl?: string;
  pullRequestNumber?: number;
  pullRequestError?: string;
}

export interface JobExecutionPort {
  resolveBaseSha(signal?: AbortSignal): Promise<string>;
  runAnalysis(
    prompt: string,
    executionMode: JobExecutionMode,
    idempotencyKey: string,
    signal?: AbortSignal,
    onProgress?: AgentRuntimeProgressCallback,
  ): Promise<PocRunResult>;
  isClaudeAvailable(): Promise<boolean>;
  runCoding(job: JobRecord, signal?: AbortSignal): Promise<CodingExecutionResult>;
  runTests(job: JobRecord, signal?: AbortSignal): Promise<TestExecutionResult>;
  publish(
    job: JobRecord,
    mode: PublishMode,
    signal?: AbortSignal,
  ): Promise<PublishExecutionResult>;
  mergePullRequest(job: JobRecord, signal?: AbortSignal): Promise<void>;
  cleanup(job: JobRecord): Promise<void>;
}
