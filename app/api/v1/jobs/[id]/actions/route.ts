import { proxyLocalJobRequest } from "@/lib/office-jobs/http/local-job-proxy";

interface JobActionRouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: JobActionRouteContext): Promise<Response> {
  const { id } = await context.params;
  return proxyLocalJobRequest(request, `/api/v1/jobs/${encodeURIComponent(id)}/actions`);
}
