import { Clock3, LoaderCircle, ShieldCheck, Wifi } from "lucide-react";

import type { PocConnectionMode } from "../api/poc-client";
import { OFFICE_COPY } from "../copy";

interface OfficeHeaderProps {
  currentTime: string;
  connectionMode: PocConnectionMode;
}

export function OfficeHeader({ currentTime, connectionMode }: OfficeHeaderProps) {
  const connectionLabel = OFFICE_COPY.header.connections[connectionMode];
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
        <span className="connection-status" data-mode={connectionMode} aria-label={connectionLabel}>
          <ConnectionIcon mode={connectionMode} />
          <span className="connection-status__dot" aria-hidden="true" />
          {connectionLabel}
        </span>
        <time className="office-clock" aria-label={OFFICE_COPY.header.clockAria}>
          <Clock3 size={14} aria-hidden="true" />
          {currentTime}
        </time>
      </div>
    </header>
  );
}

function ConnectionIcon({ mode }: { mode: PocConnectionMode }) {
  if (mode === "checking") {
    return <LoaderCircle className="is-spinning" size={14} aria-hidden="true" />;
  }
  if (mode === "demo") return <ShieldCheck size={14} aria-hidden="true" />;
  return <Wifi size={14} aria-hidden="true" />;
}
