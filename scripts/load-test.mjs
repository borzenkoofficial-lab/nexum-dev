#!/usr/bin/env node
// Lightweight load test for a KVARD API (no dependencies; Node 22 fetch).
//
//   node scripts/load-test.mjs --url http://127.0.0.1:3001 --users 20 --duration 20 [--sse 100]
//
// Creates --users test accounts, then for --duration seconds each user loops:
// login, GET /api/projects, GET /api/health. Optionally holds --sse concurrent
// ChatJob event streams on one job. Reports throughput, error rate and latency
// percentiles per endpoint, plus event-loop responsiveness (health latency).
// NEVER point it at production without the owner's approval: it creates users.
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
  if (value.startsWith("--")) pairs.push([value.slice(2), all[index + 1]]);
  return pairs;
}, []));
const base = (args.url ?? "http://127.0.0.1:3001").replace(/\/$/, "");
const users = Number(args.users ?? 10);
const durationMs = Number(args.duration ?? 15) * 1000;
const sseStreams = Number(args.sse ?? 0);

const stats = new Map();
function record(name, ms, ok) {
  const entry = stats.get(name) ?? { latencies: [], errors: 0 };
  entry.latencies.push(ms);
  if (!ok) entry.errors += 1;
  stats.set(name, entry);
}
async function timed(name, fn) {
  const started = performance.now();
  try {
    const response = await fn();
    record(name, performance.now() - started, response.ok);
    return response;
  } catch {
    record(name, performance.now() - started, false);
    return null;
  }
}
const percentile = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;

function cookieFrom(response) {
  return response?.headers.get("set-cookie")?.split(";")[0] ?? "";
}

async function register(index) {
  const email = `load-${index}-${randomUUID()}@example.com`;
  const password = `load-${randomUUID()}`;
  const response = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": `10.10.${index >> 8}.${index & 255}` },
    body: JSON.stringify({ email, name: `Load ${index}`, password }),
  });
  if (response.status !== 201) throw new Error(`register failed: ${response.status} ${await response.text()}`);
  return { email, password, ip: `10.20.${index >> 8}.${index & 255}`, cookie: cookieFrom(response) };
}

// Stay under the per-account login budget (10 / 15 min) so the run measures
// throughput, not the brute-force limiter.
const MAX_LOGINS_PER_USER = 8;

async function userLoop(user, deadline) {
  let logins = 0;
  while (performance.now() < deadline) {
    if (logins >= MAX_LOGINS_PER_USER) {
      const projects = await timed("GET /api/projects", () => fetch(`${base}/api/projects`, { headers: { Cookie: user.cookie } }));
      await projects?.arrayBuffer().catch(() => undefined);
      continue;
    }
    logins += 1;
    const login = await timed("POST /api/auth/login", () => fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": user.ip },
      body: JSON.stringify({ email: user.email, password: user.password }),
    }));
    if (login?.ok) user.cookie = cookieFrom(login) || user.cookie;
    await login?.arrayBuffer().catch(() => undefined);
    for (let i = 0; i < 5 && performance.now() < deadline; i += 1) {
      const projects = await timed("GET /api/projects", () => fetch(`${base}/api/projects`, { headers: { Cookie: user.cookie } }));
      await projects?.arrayBuffer().catch(() => undefined);
    }
  }
}

async function healthProbe(deadline) {
  // Health is cheap: its latency under load shows event-loop / DB-pool pressure.
  while (performance.now() < deadline) {
    const response = await timed("GET /api/health (probe)", () => fetch(`${base}/api/health`));
    await response?.arrayBuffer().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function openStreams(owner, count, deadline) {
  const project = `load-sse-${Date.now()}`;
  await fetch(`${base}/api/projects`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: owner.cookie }, body: JSON.stringify({ name: project, type: "static" }) });
  const job = await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: owner.cookie, "Idempotency-Key": `load-${randomUUID()}` }, body: JSON.stringify({ message: "Проверь структуру проекта", projectId: project }) });
  const jobId = (await job.json()).jobId;
  if (!jobId) { console.error("could not start a job for SSE streams"); return; }
  const controllers = [];
  let opened = 0;
  let firstEvents = 0;
  await Promise.all(Array.from({ length: count }, async () => {
    const controller = new AbortController();
    controllers.push(controller);
    const started = performance.now();
    try {
      const response = await fetch(`${base}/api/chat/jobs/${jobId}/events`, { headers: { Cookie: owner.cookie, Accept: "text/event-stream" }, signal: controller.signal });
      if (!response.ok || !response.body) { record("SSE first event", performance.now() - started, false); return; }
      opened += 1;
      const reader = response.body.getReader();
      const { value } = await reader.read();
      if (value) { firstEvents += 1; record("SSE first event", performance.now() - started, true); }
      while (performance.now() < deadline) {
        const next = await reader.read();
        if (next.done) break;
      }
    } catch {
      /* aborted at the end of the run */
    }
  }).concat([new Promise((resolve) => setTimeout(resolve, Math.max(0, deadline - performance.now()))).then(() => controllers.forEach((c) => c.abort()))]));
  console.log(`SSE: ${opened}/${count} streams opened, ${firstEvents} delivered a first event`);
}

console.log(`Target ${base}: ${users} users, ${durationMs / 1000}s${sseStreams ? `, ${sseStreams} SSE streams` : ""}`);
const accounts = [];
for (let index = 0; index < users; index += 1) accounts.push(await register(index));
const started = performance.now();
const deadline = started + durationMs;
await Promise.all([
  ...accounts.map((user) => userLoop(user, deadline)),
  healthProbe(deadline),
  ...(sseStreams > 0 ? [openStreams(accounts[0], sseStreams, deadline)] : []),
]);
const elapsed = (performance.now() - started) / 1000;

console.log("\nendpoint                          reqs   rps     err%   p50ms   p95ms   p99ms   max");
for (const [name, entry] of stats) {
  const sorted = [...entry.latencies].sort((a, b) => a - b);
  const row = [
    name.padEnd(32),
    String(sorted.length).padStart(6),
    (sorted.length / elapsed).toFixed(1).padStart(7),
    ((entry.errors / Math.max(1, sorted.length)) * 100).toFixed(1).padStart(7),
    percentile(sorted, 0.5).toFixed(0).padStart(7),
    percentile(sorted, 0.95).toFixed(0).padStart(7),
    percentile(sorted, 0.99).toFixed(0).padStart(7),
    (sorted.at(-1) ?? 0).toFixed(0).padStart(7),
  ];
  console.log(row.join(" "));
}
