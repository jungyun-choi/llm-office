import { Cpu, Route } from "lucide-react";

import { OFFICE_COPY } from "../copy";
import type { OfficeEngineInfo } from "../types";

interface ResultEngineCardProps {
  engine: OfficeEngineInfo;
}

export function ResultEngineCard({ engine }: ResultEngineCardProps) {
  const executionSummary = formatExecutionSummary(engine);
  return (
    <section className="result-engine-card" aria-label={OFFICE_COPY.drawer.engineLabel}>
      <Cpu size={17} aria-hidden="true" />
      <div>
        <span>{OFFICE_COPY.drawer.engineLabel}</span>
        <strong>{engine.label}</strong>
        <p className="result-engine-card__route"><Route size={13} aria-hidden="true" />{engine.dataRouteLabel}</p>
        <p className="result-engine-card__metrics">{executionSummary}</p>
      </div>
      <code>{engine.dataRoute}</code>
    </section>
  );
}

export function formatExecutionSummary(engine: OfficeEngineInfo): string {
  return `${engine.cliProcesses} CLI / ${engine.modelTurns} model turn / 역할 산출물 ${engine.roleOutputCount}개`;
}
