"use client";

import { OFFICE_COPY } from "./copy";
import { OfficeFloor } from "./components/office-floor";
import { OfficeHeader } from "./components/office-header";
import { ResultDrawer } from "./components/result-drawer";
import { useCurrentTime } from "./hooks/use-current-time";
import { useOfficeWorkflow } from "./hooks/use-office-workflow";

export function OfficeClient() {
  const currentTime = useCurrentTime();
  const workflow = useOfficeWorkflow();

  return (
    <div className="office-app">
      <a className="skip-link" href="#main-content">{OFFICE_COPY.accessibility.skipToMain}</a>
      <OfficeHeader
        currentTime={currentTime}
        connectionMode={workflow.connectionMode}
        onRetryConnection={workflow.retryConnection}
      />
      <main className="office-main" id="main-content">
        <OfficeFloor
          jobs={workflow.jobs}
          focusJob={workflow.focusJob}
          results={workflow.results}
          capabilities={workflow.capabilities}
          connectionMode={workflow.connectionMode}
          serverError={workflow.serverError}
          actionError={workflow.actionError}
          isSubmitting={workflow.isSubmitting}
          busyJobId={workflow.busyJobId}
          onRequest={workflow.startWorkflow}
          onAction={workflow.runAction}
          onJobSelect={workflow.selectJob}
          onResultOpen={workflow.openResult}
          onRetryConnection={workflow.retryConnection}
        />
      </main>
      <ResultDrawer
        result={workflow.selectedResult}
        job={workflow.selectedResultJob}
        busy={workflow.busyJobId === workflow.selectedResultJob?.id}
        onClose={workflow.closeResult}
        onRequestReanalysis={(job, feedback) => {
          workflow.closeResult();
          void workflow.runAction(job, "request_reanalysis", undefined, feedback);
        }}
      />
    </div>
  );
}
