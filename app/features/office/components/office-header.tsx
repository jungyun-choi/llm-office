import { Clock3, LoaderCircle, RefreshCw, ShieldCheck, Wifi, WifiOff } from "lucide-react";

import type { PocConnectionMode } from "../api/poc-client";
import { OFFICE_COPY } from "../copy";
import type { OfficeConnectionMode } from "../types";

type HeaderConnectionMode = OfficeConnectionMode | PocConnectionMode;

interface OfficeHeaderProps {
  currentTime: string;
  connectionMode: HeaderConnectionMode;
  onRetryConnection: () => void;
}

export function OfficeHeader({ currentTime, connectionMode, onRetryConnection }: OfficeHeaderProps) {
  const connectionLabel = OFFICE_COPY.header.connections[connectionMode];
  const connectionShortLabel = OFFICE_COPY.header.connectionShort[connectionMode];
  const connectionContent = (
    <>
      <ConnectionIcon mode={connectionMode} />
      <span className="connection-status__dot" aria-hidden="true" />
      <span className="connection-status__label connection-status__label--desktop">{connectionLabel}</span>
      <span className="connection-status__label connection-status__label--mobile">{connectionShortLabel}</span>
      {connectionMode === "disconnected" && <RefreshCw className="connection-status__retry-icon" size={13} aria-hidden="true" />}
    </>
  );
  return (
    <header className="office-header">
      <div className="office-brand" aria-label={OFFICE_COPY.header.brand}>
        <span className="office-brand__mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span>
          <strong>{OFFICE_COPY.header.brand}</strong>
          <small>{OFFICE_COPY.header.brandDescription}</small>
        </span>
      </div>
      <div className="office-header__signals">
        <span className="connection-status-announcer" aria-live="polite">
          {connectionMode === "disconnected" ? (
            <button
              className="connection-status"
              data-mode={connectionMode}
              type="button"
              onClick={onRetryConnection}
              aria-label={`${connectionLabel}. ${OFFICE_COPY.header.retryConnection}`}
              title={OFFICE_COPY.header.retryConnection}
            >
              {connectionContent}
            </button>
          ) : (
            <span className="connection-status" data-mode={connectionMode} aria-label={connectionLabel}>
              {connectionContent}
            </span>
          )}
        </span>
        <time className="office-clock" aria-label={OFFICE_COPY.header.clockAria}>
          <Clock3 size={14} aria-hidden="true" />
          {currentTime}
        </time>
      </div>
    </header>
  );
}

function ConnectionIcon({ mode }: { mode: HeaderConnectionMode }) {
  if (mode === "checking") {
    return <LoaderCircle className="is-spinning" size={14} aria-hidden="true" />;
  }
  if (mode === "disconnected") return <WifiOff size={14} aria-hidden="true" />;
  if (mode === "demo") return <ShieldCheck size={14} aria-hidden="true" />;
  return <Wifi size={14} aria-hidden="true" />;
}
