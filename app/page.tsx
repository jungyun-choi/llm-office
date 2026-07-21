import { OfficeClient } from "./features/office/office-client";
import { OfficeErrorBoundary } from "./features/office/office-error-boundary";

export default function Home() {
  return (
    <OfficeErrorBoundary>
      <OfficeClient />
    </OfficeErrorBoundary>
  );
}
