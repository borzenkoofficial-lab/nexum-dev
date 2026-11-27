/**
 * Critical user paths against a real API process with authentication ENABLED
 * and PostgreSQL (the Playwright E2E suite runs with auth disabled):
 * registration, login/logout and session revocation, project ownership
 * isolation between two users, Builder quota enforcement per user.
 *
 * Runs only with KVARD_TEST_DATABASE_URL (CI e2e job, `npm run test:postgres`).
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const databaseUrl = process.env.KVARD_TEST_DATABASE_URL;
const skip = !databaseUrl && "set KVARD_TEST_DATABASE_URL to run against PostgreSQL";
const apiDirectory = fileURLToPath(new URL(".", import.meta.url));

let server: ChildProcess | undefined;
let baseUrl = "";
let serverLog = "";
const createdUserIds: string[] = [];

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => (typeof address === "object" && address ? resolvePort(address.port) : reject(new Error("no port"))));
    });
  });
}

class Client {
  cookie = "";
  constructor(readonly ip: string) {}
  async request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(baseUrl + path, {
      method,
      redirect: "manual",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        // Distinct client IPs so the per-IP auth limiter reflects separate users.
        "X-Forwarded-For": this.ip,
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      const pair = setCookie.split(";")[0]!;
      this.cookie = pair.endsWith("=") ? "" : pair;
    }
    const text = await response.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { status: response.status, json, setCookie, headers: response.headers };
  }
}

async function register(client: Client, label: string) {
  const email = `${label}-${randomUUID()}@example.com`;
  const password = `pw-${randomUUID()}`;
  const response = await client.request("POST", "/api/auth/register", { email, name: label, password });
  assert.equal(response.status, 201, JSON.stringify(response.json));
  createdUserIds.push(response.json.user.id);
  return { email, password, id: response.json.user.id as string, setCookie: response.setCookie ?? "" };
}

before(async () => {
  if (skip) return;
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
    cwd: apiDirectory,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      HOST: "127.0.0.1",
      NEXUM_DATABASE_URL: databaseUrl,
      NEXUM_DB_SSL: "false",
      NEXUM_AUTH_ENABLED: "true",
      NEXUM_AUTH_SECRET: `critical-paths-${randomUUID()}-secret`,
      AI_PROVIDER: "mock",
      NEXUM_E2E_MOCK_AI: "true",
      NEXUM_E2E_AGENT_DELAY_MS: "1500",
      KVARD_BUILDER_DEFAULT_PLAN: "free",
      NEXUM_TRUST_PROXY: "loopback",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (chunk) => { serverLog += chunk; });
  server.stderr?.on("data", (chunk) => { serverLog += chunk; });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error("API exited during startup:\n" + serverLog.slice(-4000));
    try {
      const health = await fetch(baseUrl + "/api/health");
      if (health.ok) return;
    } catch { /* not listening yet */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error("API did not become healthy:\n" + serverLog.slice(-4000));
});

after(async () => {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolveExit) => { server!.once("exit", resolveExit); setTimeout(resolveExit, 10_000); });
  }
  const workspaceRoot = resolve(apiDirectory, "..", "..");
  await Promise.all(createdUserIds.map((id) => rm(resolve(workspaceRoot, "runtime", "users", id), { recursive: true, force: true })));
});

test("1-2. registration issues a secure session; logout revokes it server-side; login works again", { skip }, async () => {
  const client = new Client("198.51.100.10");
  const anonymous = await new Client("198.51.100.11").request("GET", "/api/projects");
  assert.equal(anonymous.status, 401, "protected API must require a session");

  const account = await register(client, "paths-a");
  assert.match(account.setCookie, /HttpOnly/i);
  assert.match(account.setCookie, /SameSite=Lax/i);
  assert.equal((await client.request("GET", "/api/projects")).status, 200);

  const stolenCookie = client.cookie;
  assert.equal((await client.request("POST", "/api/auth/logout")).status, 200);
  const replay = new Client("198.51.100.10");
  replay.cookie = stolenCookie;
  assert.equal((await replay.request("GET", "/api/projects")).status, 401, "a logged-out session token must be rejected even if replayed");

  assert.equal((await client.request("POST", "/api/auth/login", { email: account.email, password: "wrong-password" })).status, 401);
  const login = await client.request("POST", "/api/auth/login", { email: account.email.toUpperCase(), password: account.password });
  assert.equal(login.status, 200, JSON.stringify(login.json));
  assert.equal((await client.request("GET", "/api/projects")).status, 200);
  assert.equal((await new Client("198.51.100.12").request("POST", "/api/auth/register", { email: account.email, name: "dup", password: "another-password" })).status, 409);
});

test("3, 15. a user's project, files, git, preview and jobs are invisible to another user", { skip }, async () => {
  const owner = new Client("198.51.100.20");
  const intruder = new Client("198.51.100.21");
  await register(owner, "owner");
  await register(intruder, "intruder");

  const created = await owner.request("POST", "/api/projects", { name: "private-project", type: "static" });
  assert.ok(created.status === 200 || created.status === 201, JSON.stringify(created.json));
  const projectId = created.json.project.id as string;
  assert.equal((await owner.request("PUT", `/api/projects/${projectId}/file`, { path: "secret.txt", content: "owner-only" })).status, 200);
  assert.equal((await owner.request("GET", `/api/projects/${projectId}/file?path=secret.txt`)).json.content, "owner-only");

  for (const [method, path, body] of [
    ["GET", `/api/projects/${projectId}`],
    ["GET", `/api/projects/${projectId}/files`],
    ["GET", `/api/projects/${projectId}/file?path=secret.txt`],
    ["PUT", `/api/projects/${projectId}/file`, { path: "secret.txt", content: "overwritten" }],
    ["GET", `/api/projects/${projectId}/git/status`],
    ["DELETE", `/api/projects/${projectId}`],
    ["GET", `/api/preview/${projectId}/index.html`],
  ] as const) {
    const response = await intruder.request(method, path, body);
    assert.ok([403, 404].includes(response.status), `${method} ${path} must be denied to another user, got ${response.status}`);
  }
  assert.equal((await owner.request("GET", `/api/projects/${projectId}/file?path=secret.txt`)).json.content, "owner-only", "the intruder must not have changed the file");
  const intruderProjects = await intruder.request("GET", "/api/projects");
  assert.equal(JSON.stringify(intruderProjects.json).includes(projectId), false, "the owner's project must not be listed for another user");

  const job = await owner.request("POST", "/api/chat", { message: "Проверь структуру проекта", projectId }, { "Idempotency-Key": `paths-${randomUUID()}` });
  assert.equal(job.status, 202, JSON.stringify(job.json));
  const jobId = job.json.jobId as string;
  assert.equal((await intruder.request("POST", "/api/chat", { message: "x", projectId })).status >= 400, true, "another user cannot start a job in the owner's project");
  for (const [method, path] of [
    ["GET", `/api/chat/jobs/${jobId}`],
    ["GET", `/api/chat/jobs/${jobId}/events`],
    ["POST", `/api/chat/jobs/${jobId}/cancel`],
  ] as const) {
    const response = await intruder.request(method, path);
    assert.equal(response.status, 404, `${method} ${path} must not reveal another user's job`);
  }
  assert.equal((await owner.request("GET", `/api/chat/jobs/${jobId}`)).status, 200);
});

test("16. Builder quotas are enforced per user and reported through the billing API", { skip }, async () => {
  const user = new Client("198.51.100.30");
  const other = new Client("198.51.100.31");
  await register(user, "quota");
  await register(other, "quota-other");
  const project = (await user.request("POST", "/api/projects", { name: "quota-project", type: "static" })).json.project.id as string;

  const first = await user.request("POST", "/api/chat", { message: "Проверь структуру", projectId: project }, { "Idempotency-Key": `quota-${randomUUID()}` });
  assert.equal(first.status, 202, JSON.stringify(first.json));
  const second = await user.request("POST", "/api/chat", { message: "Проверь структуру", projectId: project }, { "Idempotency-Key": `quota-${randomUUID()}` });
  assert.equal(second.status, 402, "the Free plan allows one running task");
  assert.equal(second.json.code, "PARALLEL_LIMIT");

  const usage = (await user.request("GET", "/api/billing/builder")).json.usage;
  assert.equal(usage.plan.id, "free");
  assert.equal(usage.tasksUsed, 1);
  const otherUsage = (await other.request("GET", "/api/billing/builder")).json.usage;
  assert.equal(otherUsage.tasksUsed, 0, "usage is per user");
  assert.equal((await new Client("198.51.100.32").request("GET", "/api/billing/builder")).status, 401);
});
