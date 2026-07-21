import { handleHostedPocRun } from "@/lib/poc/http/hosted-poc-controller";
import { isLocalPocProxyEnabled, proxyLocalPocRun } from "@/lib/poc/http/local-poc-proxy";

export async function POST(request: Request): Promise<Response> {
  if (isLocalPocProxyEnabled()) return proxyLocalPocRun(request);
  return handleHostedPocRun(request);
}
