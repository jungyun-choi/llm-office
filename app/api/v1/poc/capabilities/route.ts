import { hostedCapabilities } from "@/lib/poc/http/hosted-poc-controller";
import {
  isLocalPocProxyEnabled,
  proxyLocalPocCapabilities,
} from "@/lib/poc/http/local-poc-proxy";
import { jsonResponse } from "@/lib/poc/http/poc-http";

export async function GET(): Promise<Response> {
  if (isLocalPocProxyEnabled()) return proxyLocalPocCapabilities();
  return jsonResponse(hostedCapabilities(), 200, crypto.randomUUID());
}
