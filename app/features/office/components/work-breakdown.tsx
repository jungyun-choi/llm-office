import { ArrowRight } from "lucide-react";

import { OFFICE_COPY } from "../copy";
import type { OfficeWorkItem } from "../types";

interface WorkBreakdownProps {
  items: readonly OfficeWorkItem[];
}

export function WorkBreakdown({ items }: WorkBreakdownProps) {
  return (
    <section className="work-breakdown" aria-labelledby="work-breakdown-title">
      <h3 id="work-breakdown-title">{OFFICE_COPY.drawer.workBreakdownLabel}</h3>
      <ol>
        {items.map((item) => (
          <li key={`${item.owner}-${item.title}`}>
            <span className="work-breakdown__effort">{item.effort}</span>
            <div>
              <strong>{item.title}</strong>
              <small>{item.owner}</small>
              <p>
                <ArrowRight size={12} aria-hidden="true" />
                <span>{OFFICE_COPY.drawer.dependenciesLabel}</span>
                {item.dependencies.length > 0
                  ? item.dependencies.join(" · ")
                  : OFFICE_COPY.drawer.noDependencies}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
