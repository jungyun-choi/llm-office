import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { handleLocalPocRun, localCapabilities } from "../lib/poc/http/local-poc-controller";
import { jsonResponse } from "../lib/poc/http/poc-http";

const HOST = "127.0.0.1";
const PORT = parsePort(process.env.AI_OFFICE_BRIDGE_PORT);
const MAX_BODY_BYTES = 8 * 1_024;
const BRIDGE_TOKEN = randomBytes(32).toString("base64url");

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (!isLoopbackRequest(request) || !isAllowedHost(request.headers.host)) {
    sendJson(response, bridgeError("LOOPBACK_ONLY", 403));
    return;
  }
  if (origin) {
    sendJson(response, bridgeError("ORIGIN_DENIED", 403));
    return;
  }
  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }

  const pathname = new URL(request.url ?? "/", `http://${HOST}:${PORT}`).pathname;
  if (request.method === "GET" && pathname === "/api/v1/poc/capabilities") {
    sendJson(response, jsonResponse(await localCapabilities(BRIDGE_TOKEN), 200, crypto.randomUUID()));
    return;
  }
  if (request.method === "POST" && pathname === "/api/v1/poc/runs") {
    if (!hasValidBridgeToken(request)) {
      sendJson(response, bridgeError("BRIDGE_TOKEN_REQUIRED", 401));
      return;
    }
    await handleRun(request, response);
    return;
  }
  sendJson(response, bridgeError("NOT_FOUND", 404));
});

server.requestTimeout = 190_000;
server.headersTimeout = 10_000;
server.listen(PORT, HOST, () => {
  process.stdout.write(`AI Office synthetic POC bridge: http://${HOST}:${PORT}\n`);
});

async function handleRun(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
): Promise<void> {
  try {
    const body = await readBody(incoming);
    const controller = new AbortController();
    const abortIfOpen = () => {
      if (!outgoing.writableEnded) controller.abort();
    };
    incoming.once("aborted", abortIfOpen);
    outgoing.once("close", abortIfOpen);
    const request = new Request(`http://${HOST}:${PORT}/api/v1/poc/runs`, {
      method: "POST",
      headers: bridgeHeaders(incoming),
      body: body.toString("utf8"),
      signal: controller.signal,
    });
    await sendJson(outgoing, await handleLocalPocRun(request));
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

function bridgeError(code: string, status: number): Response {
  return jsonResponse(
    { error: { code, message: "Local synthetic POC bridge rejected the request." } },
    status,
    crypto.randomUUID(),
  );
}
