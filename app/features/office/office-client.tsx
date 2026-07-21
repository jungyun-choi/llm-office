"use client";

import { OFFICE_COPY } from "./copy";
import { OfficeFloor } from "./components/office-floor";
import { OfficeHeader } from "./components/office-header";
import { ResultDrawer } from "./components/result-drawer";
import { useCurrentTime } from "./hooks/use-current-time";
import { useOfficeWorkflow } from "./hooks/use-office-workflow";
import { usePocTransport } from "./hooks/use-poc-transport";

export function OfficeClient() {
  const currentTime = useCurrentTime();
  const transport = usePocTransport();
  const workflow = useOfficeWorkflow({
    resolveEndpoint: transport.resolveEndpoint,
  });

  return (
    <div className="office-app">
      <a className="skip-link" href="#main-content">{OFFICE_COPY.accessibility.skipToMain}</a>
      <OfficeHeader
        currentTime={currentTime}
        connectionMode={transport.connectionMode}
        onRetryConnection={transport.retryConnection}
      />
      <main className="office-main" id="main-content">
        <OfficeFloor
          status={workflow.status}
          currentStage={workflow.currentStage}
          currentRequest={workflow.currentRequest}
          results={workflow.results}
          onRequest={workflow.startWorkflow}
          onResultOpen={workflow.openResult}
          errorMessage={workflow.errorMessage}
          isResultArriving={workflow.isResultArriving}
          connectionMode={transport.connectionMode}
          elapsedSeconds={workflow.elapsedSeconds}
        />
      </main>
      <ResultDrawer result={workflow.selectedResult} onClose={workflow.closeResult} />
    </div>
  );
}
