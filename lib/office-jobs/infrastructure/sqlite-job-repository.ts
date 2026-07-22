import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementResultingChanges } from "node:sqlite";
import { JobError } from "../domain/job-errors";
import type {
  JobActionRecord,
  JobEvent,
  JobListQuery,
  JobListRecord,
  JobListResult,
  JobQueueStats,
  JobRecord,
  JobRepository,
  JobState,
} from "../domain/job-types";

const ACTIVE_STATES = [
  "queued",
  "analyzing",
  "awaiting_coding_approval",
  "coding_queued",
  "coding",
  "testing",
  "changes_ready",
  "publishing",
  "review_pending",
  "merging",
] as const;

type SqlValue = string | number | bigint | null;
type DatabaseRow = Record<string, SqlValue>;

export class SqliteJobRepository implements JobRepository {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") {
      mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
      chmodSync(path.dirname(databasePath), 0o700);
    }
    this.database = new DatabaseSync(databasePath);
    if (databasePath !== ":memory:") chmodSync(databasePath, 0o600);
    this.database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.migrate();
  }

  close(): void {
    this.database.close();
  }

  recoverInterruptedJobs(now: string): void {
    const interrupted = this.database.prepare(
      `SELECT * FROM office_jobs
       WHERE state IN ('analyzing','coding','testing')
          OR (state = 'publishing' AND queue_order IS NULL)
          OR state = 'merging'
          OR cancel_requested = 1`,
    ).all() as DatabaseRow[];
    for (const row of interrupted) {
      const job = rowToJob(row);
      if (job.cancelRequested) {
        const recovered = this.update(job.id, job.version, {
          state: "canceled",
          cancelRequested: false,
          queueOrder: undefined,
          updatedAt: now,
        });
        this.appendEvent(job.id, recoveryEvent(recovered, "서버 재시작 후 취소를 완료했습니다.", now));
        continue;
      }
      if (job.state === "analyzing") {
        const recovered = this.update(job.id, job.version, {
          state: "queued",
          queueOrder: this.nextQueueOrder(),
          updatedAt: now,
        });
        this.appendEvent(job.id, recoveryEvent(recovered, "분석 업무를 대기열로 복구했습니다.", now));
        continue;
      }
      if (job.state === "merging") {
        const recovered = this.update(job.id, job.version, {
          state: "review_pending",
          queueOrder: undefined,
          updatedAt: now,
          error: {
            code: "MERGE_STATUS_UNKNOWN",
            message: "서버 재시작으로 PR 머지 결과를 확정하지 못했습니다. GitHub에서 상태를 확인해 주세요.",
            retryable: true,
            stage: "publishing",
          },
        });
        this.appendEvent(job.id, recoveryEvent(recovered, "PR 머지 상태를 사람 검토 단계로 복구했습니다.", now));
        continue;
      }
      const recovered = this.update(job.id, job.version, {
        state: "failed",
        queueOrder: undefined,
        updatedAt: now,
        error: {
          code: "WORKER_RESTARTED",
          message: "작업 도중 서버가 재시작되었습니다. 안전하게 다시 시도해 주세요.",
          retryable: true,
          stage: job.state === "publishing" ? "publishing" : "coding",
        },
      });
      this.appendEvent(job.id, recoveryEvent(recovered, "중단된 실행을 안전한 실패 상태로 복구했습니다.", now));
    }
  }

  create(record: JobRecord): JobRecord {
    this.database.prepare(`
      INSERT INTO office_jobs (
        id, idempotency_key, request_fingerprint, prompt, intake_brief_json, execution_mode, state,
        version, queue_order, created_at, updated_at, analysis_json,
        analysis_stages_json, coding_packet_json, base_sha, worktree_path, branch_name, claude_model,
        claude_output, changed_files_json, diff_text, diff_truncated,
        changes_digest, changes_manifest_json, test_status, test_output, test_output_truncated,
        requested_publish_mode, commit_sha, pull_request_url, pull_request_number,
        pull_request_error, review_feedback, review_round, issue_url, issue_error,
        error_json, cancel_requested, attempts
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `).run(...jobValues(record));
    return record;
  }

  get(id: string): JobRecord | undefined {
    const row = this.database.prepare("SELECT * FROM office_jobs WHERE id = ?").get(id) as DatabaseRow | undefined;
    return row ? rowToJob(row) : undefined;
  }

  findByIdempotencyKey(key: string): JobRecord | undefined {
    const row = this.database.prepare(
      "SELECT * FROM office_jobs WHERE idempotency_key = ?",
    ).get(key) as DatabaseRow | undefined;
    return row ? rowToJob(row) : undefined;
  }

  list(query: JobListQuery): JobListResult {
    const rows = this.database.prepare(`
      WITH ranked_queue AS (
        SELECT
          id,
          ROW_NUMBER() OVER (ORDER BY queue_order ASC, created_at ASC, id ASC) AS queue_position
        FROM office_jobs
        WHERE state IN ('queued','coding_queued','publishing') AND queue_order IS NOT NULL
      ),
      paged_jobs AS (
        SELECT
          id,
          substr(prompt, 1, 2000) AS prompt,
          execution_mode,
          state,
          version,
          created_at,
          updated_at,
          analysis_stages_json,
          substr(json_extract(analysis_json, '$.runId'), 1, 160) AS analysis_run_id,
          substr(json_extract(analysis_json, '$.brief.title'), 1, 160) AS analysis_title,
          substr(json_extract(analysis_json, '$.brief.objective'), 1, 1000) AS analysis_objective,
          substr(json_extract(analysis_json, '$.completedAt'), 1, 80) AS analysis_completed_at,
          substr(json_extract(coding_packet_json, '$.digest'), 1, 64) AS coding_packet_digest,
          branch_name,
          claude_model,
          COALESCE(json_array_length(changed_files_json), 0) AS changed_file_count,
          diff_truncated,
          changes_digest,
          test_status,
          test_output_truncated,
          requested_publish_mode,
          commit_sha,
          pull_request_url,
          pull_request_number,
          pull_request_error,
          review_round,
          issue_url,
          issue_error,
          error_json
        FROM office_jobs
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?
      )
      SELECT paged_jobs.*, ranked_queue.queue_position
      FROM paged_jobs
      LEFT JOIN ranked_queue ON ranked_queue.id = paged_jobs.id
      ORDER BY paged_jobs.created_at DESC, paged_jobs.id DESC
    `).all(query.limit, query.offset) as DatabaseRow[];
    const count = this.database.prepare("SELECT COUNT(*) AS total FROM office_jobs").get() as DatabaseRow;
    return { jobs: rows.map(rowToListJob), total: numberValue(count.total) };
  }

  stats(): JobQueueStats {
    const placeholders = ACTIVE_STATES.map(() => "?").join(",");
    const active = this.database.prepare(
      `SELECT COUNT(*) AS total FROM office_jobs WHERE state IN (${placeholders})`,
    ).get(...ACTIVE_STATES) as DatabaseRow;
    const queued = this.database.prepare(
      "SELECT COUNT(*) AS total FROM office_jobs WHERE state IN ('queued','coding_queued','publishing')",
    ).get() as DatabaseRow;
    return { active: numberValue(active.total), queued: numberValue(queued.total) };
  }

  nextRunnable(states: readonly JobState[] = ["queued", "coding_queued", "publishing"]): JobRecord | undefined {
    if (states.length === 0) return undefined;
    const placeholders = states.map(() => "?").join(",");
    const row = this.database.prepare(`
      SELECT * FROM office_jobs
      WHERE state IN (${placeholders}) AND cancel_requested = 0
      ORDER BY queue_order ASC, created_at ASC
      LIMIT 1
    `).get(...states) as DatabaseRow | undefined;
    return row ? rowToJob(row) : undefined;
  }

  queuePosition(id: string): number | undefined {
    const job = this.get(id);
    if (!job?.queueOrder) return undefined;
    const row = this.database.prepare(`
      SELECT COUNT(*) AS total FROM office_jobs
      WHERE state IN ('queued','coding_queued','publishing') AND queue_order <= ?
    `).get(job.queueOrder) as DatabaseRow;
    return numberValue(row.total);
  }

  nextQueueOrder(): number {
    return this.inTransaction(() => {
      const row = this.database.prepare(
        "SELECT value FROM office_job_meta WHERE key = 'queue_sequence'",
      ).get() as DatabaseRow;
      const next = numberValue(row.value) + 1;
      this.database.prepare(
        "UPDATE office_job_meta SET value = ? WHERE key = 'queue_sequence'",
      ).run(next);
      return next;
    });
  }

  update(id: string, expectedVersion: number, patch: Partial<JobRecord>): JobRecord {
    return this.inTransaction(() => this.updateRow(id, expectedVersion, patch));
  }

  updateWithAction(
    id: string,
    expectedVersion: number,
    patch: Partial<JobRecord>,
    action: JobActionRecord,
  ): JobRecord {
    return this.inTransaction(() => {
      const next = this.updateRow(id, expectedVersion, patch);
      this.insertAction(action);
      return next;
    });
  }

  private updateRow(
    id: string,
    expectedVersion: number,
    patch: Partial<JobRecord>,
  ): JobRecord {
    const current = this.get(id);
    if (!current) throw new JobError("JOB_NOT_FOUND", "업무를 찾지 못했습니다.", 404, false);
    if (current.version !== expectedVersion) {
      throw new JobError("STALE_JOB_VERSION", "업무 상태가 이미 변경되었습니다.", 409, true);
    }
    const next: JobRecord = { ...current, ...patch, id, version: current.version + 1 };
    const result = this.database.prepare(`
        UPDATE office_jobs SET
          idempotency_key = ?, request_fingerprint = ?, prompt = ?, intake_brief_json = ?, execution_mode = ?, state = ?,
          version = ?, queue_order = ?, created_at = ?, updated_at = ?, analysis_json = ?,
          analysis_stages_json = ?, coding_packet_json = ?, base_sha = ?, worktree_path = ?, branch_name = ?, claude_model = ?,
          claude_output = ?, changed_files_json = ?, diff_text = ?, diff_truncated = ?,
          changes_digest = ?, changes_manifest_json = ?, test_status = ?, test_output = ?, test_output_truncated = ?,
          requested_publish_mode = ?, commit_sha = ?, pull_request_url = ?, pull_request_number = ?,
          pull_request_error = ?, review_feedback = ?, review_round = ?, issue_url = ?, issue_error = ?,
          error_json = ?, cancel_requested = ?, attempts = ?
        WHERE id = ? AND version = ?
    `).run(...jobValues(next).slice(1), id, expectedVersion);
    assertOneChange(result);
    return next;
  }

  appendEvent(jobId: string, event: Omit<JobEvent, "id">): JobEvent {
    const result = this.database.prepare(`
      INSERT INTO office_job_events (job_id, kind, state, message, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(jobId, event.kind, event.state, event.message, event.createdAt);
    return { ...event, id: Number(result.lastInsertRowid) };
  }

  listEvents(jobId: string, limit: number): JobEvent[] {
    const rows = this.database.prepare(`
      SELECT id, kind, state, message, created_at
      FROM office_job_events WHERE job_id = ? ORDER BY id DESC LIMIT ?
    `).all(jobId, limit) as DatabaseRow[];
    return rows.reverse().map((row) => ({
      id: numberValue(row.id),
      kind: stringValue(row.kind) as JobEvent["kind"],
      state: stringValue(row.state) as JobState,
      message: stringValue(row.message),
      createdAt: stringValue(row.created_at),
    }));
  }

  findAction(jobId: string, idempotencyKey: string): JobActionRecord | undefined {
    const row = this.database.prepare(`
      SELECT job_id, idempotency_key, fingerprint FROM office_job_actions
      WHERE job_id = ? AND idempotency_key = ?
    `).get(jobId, idempotencyKey) as DatabaseRow | undefined;
    return row ? {
      jobId: stringValue(row.job_id),
      idempotencyKey: stringValue(row.idempotency_key),
      fingerprint: stringValue(row.fingerprint),
    } : undefined;
  }

  recordAction(action: JobActionRecord): void {
    this.insertAction(action);
  }

  private insertAction(action: JobActionRecord): void {
    this.database.prepare(`
      INSERT INTO office_job_actions (job_id, idempotency_key, fingerprint, created_at)
      VALUES (?, ?, ?, ?)
    `).run(action.jobId, action.idempotencyKey, action.fingerprint, new Date().toISOString());
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS office_jobs (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        request_fingerprint TEXT NOT NULL,
        prompt TEXT NOT NULL,
        intake_brief_json TEXT,
        execution_mode TEXT NOT NULL,
        state TEXT NOT NULL,
        version INTEGER NOT NULL,
        queue_order INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        analysis_json TEXT,
        analysis_stages_json TEXT NOT NULL DEFAULT '[]',
        coding_packet_json TEXT,
        base_sha TEXT,
        worktree_path TEXT,
        branch_name TEXT,
        claude_model TEXT,
        claude_output TEXT,
        changed_files_json TEXT NOT NULL DEFAULT '[]',
        diff_text TEXT,
        diff_truncated INTEGER NOT NULL DEFAULT 0,
        changes_digest TEXT,
        changes_manifest_json TEXT,
        test_status TEXT NOT NULL DEFAULT 'not_run',
        test_output TEXT,
        test_output_truncated INTEGER NOT NULL DEFAULT 0,
        requested_publish_mode TEXT,
        commit_sha TEXT,
        pull_request_url TEXT,
        pull_request_number INTEGER,
        pull_request_error TEXT,
        review_feedback TEXT,
        review_round INTEGER NOT NULL DEFAULT 0,
        issue_url TEXT,
        issue_error TEXT,
        error_json TEXT,
        cancel_requested INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS office_jobs_queue_idx ON office_jobs(state, queue_order);
      CREATE INDEX IF NOT EXISTS office_jobs_created_idx ON office_jobs(created_at DESC);
      CREATE TABLE IF NOT EXISTS office_job_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL REFERENCES office_jobs(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        state TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS office_job_events_job_idx ON office_job_events(job_id, id DESC);
      CREATE TABLE IF NOT EXISTS office_job_actions (
        job_id TEXT NOT NULL REFERENCES office_jobs(id) ON DELETE CASCADE,
        idempotency_key TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (job_id, idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS office_job_meta (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO office_job_meta (key, value) VALUES ('queue_sequence', 0);
    `);
    this.ensureColumn(
      "analysis_stages_json",
      "ALTER TABLE office_jobs ADD COLUMN analysis_stages_json TEXT NOT NULL DEFAULT '[]'",
    );
    this.ensureColumn("intake_brief_json", "ALTER TABLE office_jobs ADD COLUMN intake_brief_json TEXT");
    this.ensureColumn(
      "changes_manifest_json",
      "ALTER TABLE office_jobs ADD COLUMN changes_manifest_json TEXT",
    );
    this.ensureColumn("pull_request_url", "ALTER TABLE office_jobs ADD COLUMN pull_request_url TEXT");
    this.ensureColumn("pull_request_number", "ALTER TABLE office_jobs ADD COLUMN pull_request_number INTEGER");
    this.ensureColumn("pull_request_error", "ALTER TABLE office_jobs ADD COLUMN pull_request_error TEXT");
    this.ensureColumn("review_feedback", "ALTER TABLE office_jobs ADD COLUMN review_feedback TEXT");
    this.ensureColumn("review_round", "ALTER TABLE office_jobs ADD COLUMN review_round INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("issue_url", "ALTER TABLE office_jobs ADD COLUMN issue_url TEXT");
    this.ensureColumn("issue_error", "ALTER TABLE office_jobs ADD COLUMN issue_error TEXT");
  }

  private ensureColumn(name: string, statement: string): void {
    const columns = this.database.prepare("PRAGMA table_info(office_jobs)").all() as DatabaseRow[];
    if (!columns.some((column) => column.name === name)) this.database.exec(statement);
  }

  private inTransaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function jobValues(record: JobRecord): SqlValue[] {
  return [
    record.id,
    record.idempotencyKey,
    record.requestFingerprint,
    record.prompt,
    jsonValue(record.intakeBrief),
    record.executionMode,
    record.state,
    record.version,
    record.queueOrder ?? null,
    record.createdAt,
    record.updatedAt,
    jsonValue(record.analysis),
    JSON.stringify(record.analysisStages),
    jsonValue(record.codingPacket),
    record.baseSha ?? null,
    record.worktreePath ?? null,
    record.branchName ?? null,
    record.claudeModel ?? null,
    record.claudeOutput ?? null,
    JSON.stringify(record.changedFiles),
    record.diff ?? null,
    record.diffTruncated ? 1 : 0,
    record.changesDigest ?? null,
    jsonValue(record.changesManifest),
    record.testStatus,
    record.testOutput ?? null,
    record.testOutputTruncated ? 1 : 0,
    record.requestedPublishMode ?? null,
    record.commitSha ?? null,
    record.pullRequestUrl ?? null,
    record.pullRequestNumber ?? null,
    record.pullRequestError ?? null,
    record.reviewFeedback ?? null,
    record.reviewRound,
    record.issueUrl ?? null,
    record.issueError ?? null,
    jsonValue(record.error),
    record.cancelRequested ? 1 : 0,
    record.attempts,
  ];
}

function rowToJob(row: DatabaseRow): JobRecord {
  return {
    id: stringValue(row.id),
    idempotencyKey: stringValue(row.idempotency_key),
    requestFingerprint: stringValue(row.request_fingerprint),
    prompt: stringValue(row.prompt),
    intakeBrief: parseJson(row.intake_brief_json),
    executionMode: stringValue(row.execution_mode) as JobRecord["executionMode"],
    state: stringValue(row.state) as JobState,
    version: numberValue(row.version),
    queueOrder: optionalNumber(row.queue_order),
    createdAt: stringValue(row.created_at),
    updatedAt: stringValue(row.updated_at),
    analysis: parseJson(row.analysis_json),
    analysisStages: parseJson(row.analysis_stages_json) ?? [],
    codingPacket: parseJson(row.coding_packet_json),
    baseSha: optionalString(row.base_sha),
    worktreePath: optionalString(row.worktree_path),
    branchName: optionalString(row.branch_name),
    claudeModel: optionalString(row.claude_model),
    claudeOutput: optionalString(row.claude_output),
    changedFiles: parseJson<string[]>(row.changed_files_json) ?? [],
    diff: optionalString(row.diff_text),
    diffTruncated: numberValue(row.diff_truncated) === 1,
    changesDigest: optionalString(row.changes_digest),
    changesManifest: parseJson(row.changes_manifest_json),
    testStatus: stringValue(row.test_status) as JobRecord["testStatus"],
    testOutput: optionalString(row.test_output),
    testOutputTruncated: numberValue(row.test_output_truncated) === 1,
    requestedPublishMode: optionalString(row.requested_publish_mode) as JobRecord["requestedPublishMode"],
    commitSha: optionalString(row.commit_sha),
    pullRequestUrl: optionalString(row.pull_request_url),
    pullRequestNumber: optionalNumber(row.pull_request_number),
    pullRequestError: optionalString(row.pull_request_error),
    reviewFeedback: optionalString(row.review_feedback),
    reviewRound: numberValue(row.review_round),
    issueUrl: optionalString(row.issue_url),
    issueError: optionalString(row.issue_error),
    error: parseJson(row.error_json),
    cancelRequested: numberValue(row.cancel_requested) === 1,
    attempts: numberValue(row.attempts),
  };
}

function rowToListJob(row: DatabaseRow): JobListRecord {
  const id = stringValue(row.id);
  const analysisRunId = optionalString(row.analysis_run_id);
  const analysisTitle = optionalString(row.analysis_title);
  const analysisObjective = optionalString(row.analysis_objective);
  const analysisCompletedAt = optionalString(row.analysis_completed_at);
  const analysisPreview = analysisRunId && analysisTitle && analysisObjective && analysisCompletedAt
    ? {
      jobId: id,
      runId: analysisRunId,
      title: analysisTitle,
      objective: analysisObjective,
      completedAt: analysisCompletedAt,
    }
    : undefined;
  return {
    id,
    prompt: stringValue(row.prompt),
    executionMode: stringValue(row.execution_mode) as JobRecord["executionMode"],
    state: stringValue(row.state) as JobState,
    version: numberValue(row.version),
    createdAt: stringValue(row.created_at),
    updatedAt: stringValue(row.updated_at),
    queuePosition: optionalNumber(row.queue_position),
    analysisPreview,
    analysisStages: parseJson(row.analysis_stages_json) ?? [],
    codingPacketDigest: optionalString(row.coding_packet_digest),
    branchName: optionalString(row.branch_name),
    claudeModel: optionalString(row.claude_model),
    changedFileCount: numberValue(row.changed_file_count),
    diffTruncated: numberValue(row.diff_truncated) === 1,
    changesDigest: optionalString(row.changes_digest),
    testStatus: stringValue(row.test_status) as JobRecord["testStatus"],
    testOutputTruncated: numberValue(row.test_output_truncated) === 1,
    requestedPublishMode: optionalString(row.requested_publish_mode) as JobRecord["requestedPublishMode"],
    commitSha: optionalString(row.commit_sha),
    pullRequestUrl: optionalString(row.pull_request_url),
    pullRequestNumber: optionalNumber(row.pull_request_number),
    pullRequestError: optionalString(row.pull_request_error),
    reviewRound: numberValue(row.review_round),
    issueUrl: optionalString(row.issue_url),
    issueError: optionalString(row.issue_error),
    error: parseJson(row.error_json),
  };
}

function recoveryEvent(
  job: JobRecord,
  message: string,
  createdAt: string,
): Omit<JobEvent, "id"> {
  return { kind: "recovery", state: job.state, message, createdAt };
}

function assertOneChange(result: StatementResultingChanges): void {
  if (Number(result.changes) !== 1) {
    throw new JobError("STALE_JOB_VERSION", "업무 상태가 이미 변경되었습니다.", 409, true);
  }
}

function jsonValue(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function parseJson<T>(value: SqlValue | undefined): T | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new JobError(
      "JOB_STORAGE_CORRUPT",
      "저장된 업무 데이터를 읽지 못했습니다.",
      500,
      false,
    );
  }
}

function stringValue(value: SqlValue | undefined): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function optionalString(value: SqlValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: SqlValue | undefined): number {
  return typeof value === "bigint" ? Number(value) : Number(value ?? 0);
}

function optionalNumber(value: SqlValue | undefined): number | undefined {
  return value === null || value === undefined ? undefined : numberValue(value);
}
