import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { handleLocalPocRun, localCapabilities } from "../lib/poc/http/local-poc-controller";
import { jsonResponse } from "../lib/poc/http/poc-http";
import { isProductionExecutionAcknowledged } from "../lib/office-jobs/http/local-job-proxy";
import {
  createLocalJobSystem,
  type LocalJobSystem,
} from "../lib/office-jobs/infrastructure/local-job-system";

const HOST = "127.0.0.1";
const PORT = parsePort(process.env.AI_OFFICE_BRIDGE_PORT);
const MAX_BODY_BYTES = 8 * 1_024;
const BRIDGE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/u;
const BRIDGE_TOKEN = requireConfiguredBridgeToken();
let jobSystem: LocalJobSystem | undefined;

const server = createServer(async (request, response) => {
  try {
    const origin = request.headers.origin;
    if (!isLoopbackRequest(request) || !isAllowedHost(request.headers.host)) {
      await sendJson(response, bridgeError("LOOPBACK_ONLY", 403));
      return;
    }
    if (origin) {
      await sendJson(response, bridgeError("ORIGIN_DENIED", 403));
      return;
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    if (!hasValidBridgeToken(request)) {
      await sendJson(response, bridgeError("BRIDGE_TOKEN_REQUIRED", 401));
      return;
    }

    const requestUrl = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);
    const pathname = requestUrl.pathname;
    if (request.method === "GET" && pathname === "/api/v1/poc/capabilities") {
      await sendJson(response, jsonResponse(await localCapabilities(), 200, crypto.randomUUID()));
      return;
    }
    if (request.method === "POST" && pathname === "/api/v1/poc/runs") {
      await handleControllerRequest(request, response, (webRequest) => handleLocalPocRun(webRequest));
      return;
    }
    if (pathname.startsWith("/api/v1/jobs")) {
      await handleJobRoute(request, response, requestUrl);
      return;
    }
    await sendJson(response, bridgeError("NOT_FOUND", 404));
  } catch {
    await sendJson(response, bridgeError("INTERNAL_ERROR", 500));
  }
});

server.requestTimeout = 190_000;
server.headersTimeout = 10_000;
server.listen(PORT, HOST, () => {
  process.stdout.write(`AI Office local bridge: http://${HOST}:${PORT}\n`);
});

async function handleJobRoute(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  requestUrl: URL,
): Promise<void> {
  if (!isProductionExecutionAcknowledged()) {
    await sendJson(
      outgoing,
      bridgeError(
        "PRODUCTION_EXECUTION_DENIED",
        503,
        "운영 환경에서는 internal 배포와 on-prem 실행 확인이 모두 필요합니다.",
      ),
    );
    return;
  }

  const controller = getJobSystem().controller;
  if (incoming.method === "GET" && requestUrl.pathname === "/api/v1/jobs/capabilities") {
    await handleControllerRequest(incoming, outgoing, (request) => controller.capabilities(request));
    return;
  }

  if (incoming.method === "GET" && requestUrl.pathname === "/api/v1/jobs") {
    await handleControllerRequest(incoming, outgoing, (request) => controller.list(request));
    return;
  }
  if (incoming.method === "POST" && requestUrl.pathname === "/api/v1/jobs") {
    await handleControllerRequest(incoming, outgoing, (request) => controller.create(request));
    return;
  }
  const actionMatch = requestUrl.pathname.match(/^\/api\/v1\/jobs\/([^/]+)\/actions$/u);
  if (incoming.method === "POST" && actionMatch) {
    await handleControllerRequest(
      incoming,
      outgoing,
      (request) => controller.action(request, actionMatch[1]),
    );
    return;
  }
  const jobMatch = requestUrl.pathname.match(/^\/api\/v1\/jobs\/([^/]+)$/u);
  if (incoming.method === "GET" && jobMatch) {
    await handleControllerRequest(
      incoming,
      outgoing,
      (request) => controller.get(request, jobMatch[1]),
    );
    return;
  }
  await sendJson(outgoing, bridgeError("NOT_FOUND", 404));
}

async function handleControllerRequest(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  handler: (request: Request) => Response | Promise<Response>,
): Promise<void> {
  try {
    const bodyBuffer = incoming.method === "GET" || incoming.method === "HEAD"
      ? undefined
      : await readBody(incoming);
    const controller = new AbortController();
    const abortIfOpen = () => {
      if (!outgoing.writableEnded) controller.abort();
    };
    incoming.once("aborted", abortIfOpen);
    outgoing.once("close", abortIfOpen);
    const request = new Request(`http://${HOST}:${PORT}${incoming.url ?? "/"}`, {
      method: incoming.method,
      headers: bridgeHeaders(incoming),
      body: bodyBuffer ? Uint8Array.from(bodyBuffer).buffer : undefined,
      signal: controller.signal,
    });
    await sendJson(outgoing, await handler(request));
  } catch (error) {
    const oversized = error instanceof PayloadTooLargeError;
    if (oversized) outgoing.once("finish", () => incoming.destroy());
    await sendJson(
      outgoing,
      Response.json(
        {
          error: {
            code: oversized ? "PAYLOAD_TOO_LARGE" : "INVALID_REQUEST",
            message: oversized
              ? "요청 본문은 8 KiB 이하여야 합니다."
              : "요청 본문을 확인해 주세요.",
          },
        },
        { status: oversized ? 413 : 400 },
      ),
    );
  }
}

function getJobSystem(): LocalJobSystem {
  jobSystem ??= createLocalJobSystem();
  return jobSystem;
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let rejected = false;
    request.on("data", (chunk: Buffer) => {
      if (rejected) return;
      bytes += chunk.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        rejected = true;
        request.pause();
        reject(new PayloadTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!rejected) resolve(Buffer.concat(chunks));
    });
    request.on("error", reject);
  });
}

class PayloadTooLargeError extends Error {}

function bridgeHeaders(request: IncomingMessage): Headers {
  const headers = new Headers({
    "content-type": request.headers["content-type"] ?? "",
    "cf-connecting-ip": "local-bridge",
  });
  for (const name of ["idempotency-key", "x-correlation-id"] as const) {
    const value = request.headers[name];
    if (typeof value === "string") headers.set(name, value);
  }
  const bridgeToken = request.headers["x-ai-office-bridge-token"];
  if (typeof bridgeToken === "string") headers.set("x-ai-office-bridge-token", bridgeToken);
  return headers;
}

async function sendJson(response: ServerResponse, webResponse: Response): Promise<void> {
  if (response.writableEnded) return;
  const headers = Object.fromEntries(webResponse.headers.entries());
  response.writeHead(webResponse.status, headers);
  response.end(Buffer.from(await webResponse.arrayBuffer()));
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? 4317);
  return Number.isInteger(port) && port >= 1_024 && port <= 65_535 ? port : 4317;
}

function requireConfiguredBridgeToken(): string {
  const token = process.env.AI_OFFICE_BRIDGE_TOKEN;
  if (token && BRIDGE_TOKEN_PATTERN.test(token)) return token;
  process.stderr.write("AI Office bridge configuration error: bridge token is missing or invalid.\n");
  process.exit(1);
}

function hasValidBridgeToken(request: IncomingMessage): boolean {
  const candidate = request.headers["x-ai-office-bridge-token"];
  if (typeof candidate !== "string") return false;
  const expectedBytes = Buffer.from(BRIDGE_TOKEN);
  const candidateBytes = Buffer.from(candidate);
  return (
    expectedBytes.byteLength === candidateBytes.byteLength &&
    timingSafeEqual(expectedBytes, candidateBytes)
  );
}

function isLoopbackRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress;
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function isAllowedHost(host: string | undefined): boolean {
  return host === `${HOST}:${PORT}` || host === `localhost:${PORT}`;
}

function bridgeError(
  code: string,
  status: number,
  message = "Local AI Office bridge rejected the request.",
): Response {
  return jsonResponse(
    { error: { code, message, retryable: status >= 500 } },
    status,
    crypto.randomUUID(),
  );
}

let shutdownPromise: Promise<void> | undefined;
function shutdown(): Promise<void> {
  shutdownPromise ??= shutdownOnce();
  return shutdownPromise;
}

async function shutdownOnce(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  await jobSystem?.close();
  process.exitCode = 0;
}

function handleShutdownSignal(): void {
  void shutdown().catch(() => {
    process.exitCode = 1;
  });
}

process.once("SIGINT", handleShutdownSignal);
process.once("SIGTERM", handleShutdownSignal);
