import { ChevronDown, FileSearch } from "lucide-react";

import { OFFICE_COPY } from "../copy";
import type { OfficeRoleResult } from "../types";

interface RoleOutputListProps {
  outputs: readonly OfficeRoleResult[];
}

export function RoleOutputList({ outputs }: RoleOutputListProps) {
  return (
    <section className="role-output-section" aria-labelledby="role-output-title">
      <h3 id="role-output-title">{OFFICE_COPY.drawer.roleOutputsLabel}</h3>
      <div className="role-output-list">
        {outputs.map((output) => <RoleOutput key={output.role} output={output} />)}
      </div>
    </section>
  );
}

function RoleOutput({ output }: { output: OfficeRoleResult }) {
  return (
    <details className="role-output">
      <summary>
        <span><strong>{output.agentName}</strong><small>{output.roleLabel}</small></span>
        <p>{output.summary}</p>
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <div>
        <ul>{output.findings.map((finding) => <li key={finding}>{finding}</li>)}</ul>
        <section>
          <span><FileSearch size={13} />{OFFICE_COPY.drawer.evidenceLabel}</span>
          {output.evidence.map((evidence) => <code key={evidence}>{evidence}</code>)}
        </section>
      </div>
    </details>
  );
}
