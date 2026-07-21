import { handleHostedPocRun } from "@/lib/poc/http/hosted-poc-controller";

export async function POST(request: Request): Promise<Response> {
  return handleHostedPocRun(request);
}
