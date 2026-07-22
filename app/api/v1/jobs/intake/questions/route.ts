import { proxyLocalJobRequest } from "@/lib/office-jobs/http/local-job-proxy";

const ORBIT_REQUEST_TIMEOUT_MS = 105_000;

export async function POST(request: Request): Promise<Response> {
  return proxyLocalJobRequest(
    request,
    "/api/v1/jobs/intake/questions",
    ORBIT_REQUEST_TIMEOUT_MS,
  );
}
