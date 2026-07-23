import { FileArchive, FileText, Inbox } from "lucide-react";

import { OFFICE_COPY } from "../copy";
import type { OfficeResultPreview } from "../types";

interface ResultVaultProps {
  results: readonly OfficeResultPreview[];
  isReceiving: boolean;
  onOpen: (result: OfficeResultPreview) => void;
}

export function ResultVault({ results, isReceiving, onOpen }: ResultVaultProps) {
  return (
    <aside className={`result-vault ${isReceiving ? "is-receiving" : ""}`} aria-labelledby="result-vault-title">
      <header>
        <span className="result-vault__icon" aria-hidden="true"><FileArchive size={16} /></span>
        <span>
          <small>{OFFICE_COPY.vault.eyebrow}</small>
          <strong id="result-vault-title">{OFFICE_COPY.vault.title}</strong>
        </span>
      </header>
      {isReceiving && <p className="result-vault__incoming">{OFFICE_COPY.vault.incoming}</p>}
      {results.length === 0 ? (
        <div className="result-vault__empty">
          <Inbox size={21} aria-hidden="true" />
          <strong>{OFFICE_COPY.vault.emptyTitle}</strong>
          <p>{OFFICE_COPY.vault.emptyDescription}</p>
        </div>
      ) : (
        <ul className="result-stack" aria-label="보관된 분석 결과">
          {results.map((result, index) => (
            <li key={`${result.jobId}:${result.runId}`}>
              <button type="button" onClick={() => onOpen(result)}>
                <span className="result-stack__file" aria-hidden="true"><FileText size={15} /></span>
                <span>
                  {index === 0 && <small>{OFFICE_COPY.vault.newResult}</small>}
                  <strong>{result.title}</strong>
                  <span>{result.createdAt}</span>
                </span>
                <span className="sr-only">{OFFICE_COPY.vault.openResult}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
