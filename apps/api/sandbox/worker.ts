import { createServer } from "node:http";
import { DockerSandbox } from "./dockerSandbox.js";
import { verifySandboxWorkerRequest } from "./workerAuth.js";

const HOST = process.env.NEXUM_SANDBOX_WORKER_HOST ?? "0.0.0.0";
const PORT = Number(process.env.NEXUM_SANDBOX_WORKER_PORT ?? 3020);
const WORKSPACE_ROOT = process.env.NEXUM_SANDBOX_VOLUME_ROOT ?? "/app/runtime";
const SECRET = process.env.NEXUM_SANDBOX_WORKER_SECRET ?? "";
const MAX_BODY_BYTES = 16 * 1024;

if (SECRET.length < 32) {
  throw new Error("NEXUM_SANDBOX_WORKER_SECRET must contain at least 32 characters");
}
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("NEXUM_SANDBOX_WORKER_PORT must be a valid TCP port");
}

const sandbox = new DockerSandbox(WORKSPACE_ROOT);
const seenNonces = new Map<string, number>();

const server = createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok", service: "nexum-sandbox-worker" }));
    return;
  }

  if (request.method !== "POST" || request.url !== "/run") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ success: false, error: "Not found" }));
    return;
  }

  const timestamp = request.headers["x-nexum-timestamp"];
  const nonce = request.headers["x-nexum-nonce"];
  const signature = request.headers["x-nexum-signature"];
  if (typeof timestamp !== "string" || typeof nonce !== "string" || typeof signature !== "string") {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ success: false, error: "Worker authentication required" }));
    return;
  }

  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BODY_BYTES) {
      response.writeHead(413, { "content-type": "application/json" });
      response.end(JSON.stringify({ success: false, error: "Request body too large" }));
      return;
    }
    chunks.push(buffer);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  const now = Date.now();
  for (const [knownNonce, expiresAt] of seenNonces) if (expiresAt <= now) seenNonces.delete(knownNonce);
  if (seenNonces.has(nonce) || !verifySandboxWorkerRequest(SECRET, timestamp, rawBody, signature, now, nonce)) {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ success: false, error: "Invalid or expired worker signature" }));
    return;
  }

  seenNonces.set(nonce, now + 60_000);

  let payload: { projectPath?: unknown; command?: unknown; timeoutMs?: unknown };
  try {
    payload = JSON.parse(rawBody) as typeof payload;
  } catch {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ success: false, error: "Invalid JSON body" }));
    return;
  }

  if (
    typeof payload.projectPath !== "string" ||
    payload.projectPath.length > 1000 ||
    payload.projectPath.startsWith("/") ||
    payload.projectPath.split(/[\\/]/).some((part) => part === "..") ||
    typeof payload.command !== "string" ||
    payload.command.length > 2000 ||
    (payload.timeoutMs !== undefined && (typeof payload.timeoutMs !== "number" || !Number.isInteger(payload.timeoutMs)))
  ) {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ success: false, error: "Invalid sandbox request" }));
    return;
  }

  try {
    const result = await sandbox.run({
      projectPath: payload.projectPath || ".",
      command: payload.command,
      ...(payload.timeoutMs === undefined ? {} : { timeoutMs: payload.timeoutMs as number }),
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(result));
  } catch (error) {
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Sandbox worker failed" }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({ service: "nexum-sandbox-worker", host: HOST, port: PORT, workspaceRoot: WORKSPACE_ROOT }));
});
