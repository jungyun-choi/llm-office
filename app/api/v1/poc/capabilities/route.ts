import { hostedCapabilities } from "@/lib/poc/http/hosted-poc-controller";
import { jsonResponse } from "@/lib/poc/http/poc-http";

export async function GET(): Promise<Response> {
  return jsonResponse(hostedCapabilities(), 200, crypto.randomUUID());
}
