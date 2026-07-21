import { DashboardClient } from "./features/operations-dashboard/dashboard-client";
import { DashboardErrorBoundary } from "./features/operations-dashboard/dashboard-error-boundary";

export default function Home() {
  return (
    <DashboardErrorBoundary>
      <DashboardClient />
    </DashboardErrorBoundary>
  );
}
