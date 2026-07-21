import { Layers3 } from "lucide-react";

import { OFFICE_COPY } from "../copy";

export function CollaborationTable() {
  return (
    <div className="collaboration-table" aria-label={OFFICE_COPY.floor.collaborationTable}>
      <div className="collaboration-table__top" aria-hidden="true">
        <span />
        <span />
        <Layers3 size={17} />
      </div>
      <strong>{OFFICE_COPY.floor.collaborationTable}</strong>
      <small>{OFFICE_COPY.floor.collaborationNote}</small>
    </div>
  );
}
