import { proxyLocalJobCapabilities } from "@/lib/office-jobs/http/local-job-proxy";

export async function GET(request: Request): Promise<Response> {
  return proxyLocalJobCapabilities(request);
}
