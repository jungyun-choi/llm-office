import { GitBranch } from "lucide-react";

import { OFFICE_COPY } from "../copy";
import type { OfficeIssueDraft } from "../types";

interface IssueDraftCardProps {
  issue: OfficeIssueDraft;
}

export function IssueDraftCard({ issue }: IssueDraftCardProps) {
  return (
    <section className="git-draft-card">
      <GitBranch size={17} aria-hidden="true" />
      <div>
        <span>{OFFICE_COPY.drawer.gitLabel}</span>
        <strong>{issue.title}</strong>
        <div className="git-draft-card__labels">
          {issue.labels.map((label) => <code key={label}>{label}</code>)}
        </div>
        <pre>{issue.body}</pre>
      </div>
    </section>
  );
}
