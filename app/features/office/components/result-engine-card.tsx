import { Cpu, Route } from "lucide-react";

import { OFFICE_COPY } from "../copy";
import type { OfficeEngineInfo } from "../types";

interface ResultEngineCardProps {
  engine: OfficeEngineInfo;
}

export function ResultEngineCard({ engine }: ResultEngineCardProps) {
  return (
    <section className="result-engine-card" aria-label={OFFICE_COPY.drawer.engineLabel}>
      <Cpu size={17} aria-hidden="true" />
      <div>
        <span>{OFFICE_COPY.drawer.engineLabel}</span>
        <strong>{engine.label}</strong>
        <p><Route size={13} aria-hidden="true" />{engine.dataRouteLabel}</p>
      </div>
      <code>{engine.dataRoute}</code>
    </section>
  );
}
