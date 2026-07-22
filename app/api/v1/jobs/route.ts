import { proxyLocalJobRequest } from "@/lib/office-jobs/http/local-job-proxy";

export async function GET(request: Request): Promise<Response> {
  const search = new URL(request.url).search;
  return proxyLocalJobRequest(request, `/api/v1/jobs${search}`);
}

export async function POST(request: Request): Promise<Response> {
  return proxyLocalJobRequest(request, "/api/v1/jobs");
}
