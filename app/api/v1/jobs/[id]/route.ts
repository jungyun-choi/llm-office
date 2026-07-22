import { proxyLocalJobRequest } from "@/lib/office-jobs/http/local-job-proxy";

interface JobRouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: JobRouteContext): Promise<Response> {
  const { id } = await context.params;
  return proxyLocalJobRequest(request, `/api/v1/jobs/${encodeURIComponent(id)}`);
}
