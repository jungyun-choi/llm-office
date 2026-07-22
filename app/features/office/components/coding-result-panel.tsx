import { CheckCircle2, FileCode2, GitCommitHorizontal, TestTube2, XCircle } from "lucide-react";

import type { OfficeCodingResult } from "../types";

interface CodingResultPanelProps {
  coding: OfficeCodingResult;
}

export function CodingResultPanel({ coding }: CodingResultPanelProps) {
  return (
    <section className="coding-result" aria-labelledby="coding-result-title">
      <header>
        <div>
          <small>CLAUDE OUTPUT</small>
          <strong id="coding-result-title">변경 검토</strong>
        </div>
        {coding.branchName && <code>{coding.branchName}</code>}
      </header>
      {coding.summary && <p className="coding-result__summary">{coding.summary}</p>}
      <ChangedFileList files={coding.changedFiles} />
      {coding.test && <TestResult test={coding.test} />}
      {coding.diff && (
        <details className="coding-result__diff">
          <summary><FileCode2 size={14} aria-hidden="true" />Diff 보기</summary>
          <pre>{coding.diff}</pre>
          {coding.diffTruncated && <p>안전한 표시 길이에 맞춰 일부만 보여줍니다.</p>}
        </details>
      )}
      {coding.commitSha && (
        <p className="coding-result__commit">
          <GitCommitHorizontal size={14} aria-hidden="true" />
          <span>Commit <code>{coding.commitSha.slice(0, 12)}</code>{coding.pushed ? " · Push 완료" : ""}</span>
        </p>
      )}
    </section>
  );
}

function ChangedFileList({ files }: { files: OfficeCodingResult["changedFiles"] }) {
  if (files.length === 0) return <p className="coding-result__empty">아직 변경 파일이 없습니다.</p>;
  const visibleFiles = files.slice(0, 50);
  return (
    <div className="coding-result__files">
      <span>변경 파일 {files.length}</span>
      <ul>
        {visibleFiles.map((file) => (
          <li key={`${file.status ?? "changed"}-${file.path}`}>
            <code>{file.path}</code>{file.status && <small>{file.status}</small>}
          </li>
        ))}
      </ul>
      {files.length > visibleFiles.length && <small>외 {files.length - visibleFiles.length}개</small>}
    </div>
  );
}

function TestResult({ test }: { test: NonNullable<OfficeCodingResult["test"]> }) {
  const passed = test.status === "passed";
  const failed = test.status === "failed";
  const Icon = passed ? CheckCircle2 : failed ? XCircle : TestTube2;
  return (
    <details className="coding-result__test" data-status={test.status}>
      <summary>
        <Icon size={14} aria-hidden="true" />
        테스트 {getTestStatusLabel(test.status)}
      </summary>
      {test.command && <code>{test.command}</code>}
      {test.output && <pre>{test.output}</pre>}
    </details>
  );
}

export function getTestStatusLabel(status: NonNullable<OfficeCodingResult["test"]>["status"]): string {
  if (status === "passed") return "통과";
  if (status === "failed") return "실패";
  if (status === "running") return "실행 중";
  if (status === "skipped") return "건너뜀";
  if (status === "not_run") return "미실행";
  return "대기";
}
