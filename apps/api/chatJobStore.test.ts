import test from "node:test";
import assert from "node:assert/strict";
import {
  acquireProjectLock,
  heartbeatProjectLock,
  releaseProjectLock,
  cancelChatJob,
  createChatJob,
  getChatJob,
  requestChatJobApproval,
  resolveChatJobApproval,
  type ChatJob,
  type ChatJobApproval,
} from "./chatJobStore.js";

const previousDatabaseUrl = process.env.NEXUM_DATABASE_URL;
delete process.env.NEXUM_DATABASE_URL;

function makeJob(id: string, userId: string): ChatJob {
  const now = Date.now();
  return { id, userId, status: "running", stage: "editing", createdAt: now, updatedAt: now };
}

function makeApproval(id: string): ChatJobApproval {
  const now = Date.now();
  return {
    id,
    toolName: "writeFile",
    risk: "WRITE",
    inputPreview: "{\"path\":\"src/app.ts\",\"content\":\"safe\"}",
    status: "pending",
    createdAt: now,
    expiresAt: now + 600_000,
    resumeStage: "editing",
  };
}

test("approval decision is owner-scoped and can be resolved only once", async () => {
  const jobId = "approval-store-owner-scope";
  const approvalId = "approval-owner-scope";
  await createChatJob(makeJob(jobId, "owner-a"));
  const pending = await requestChatJobApproval(jobId, "owner-a", makeApproval(approvalId));
  assert.equal(pending?.pendingApproval?.status, "pending");

  const foreign = await resolveChatJobApproval(jobId, "owner-b", approvalId, "approved", "owner-b");
  assert.equal(foreign, null);

  const approved = await resolveChatJobApproval(jobId, "owner-a", approvalId, "approved", "owner-a");
  assert.equal(approved?.pendingApproval?.status, "approved");
  assert.equal(approved?.pendingApproval?.resolvedBy, "owner-a");

  const duplicate = await resolveChatJobApproval(jobId, "owner-a", approvalId, "rejected", "owner-a");
  assert.equal(duplicate, null);
  assert.equal((await getChatJob(jobId, "owner-a"))?.pendingApproval?.status, "approved");
});

test("cancelling a job cancels its pending approval", async () => {
  const jobId = "approval-store-cancel";
  await createChatJob(makeJob(jobId, "owner-c"));
  await requestChatJobApproval(jobId, "owner-c", makeApproval("approval-cancel"));
  const cancelled = await cancelChatJob(jobId, "owner-c");
  assert.equal(cancelled?.status, "cancelled");
  assert.equal(cancelled?.pendingApproval?.status, "cancelled");
  assert.ok(cancelled?.pendingApproval?.resolvedAt);
  assert.ok(cancelled?.events?.some((event) => event && typeof event === "object" && (event as { name?: unknown }).name === "agent.approval.cancelled"));
});

test.after(() => {
  if (previousDatabaseUrl === undefined) delete process.env.NEXUM_DATABASE_URL;
  else process.env.NEXUM_DATABASE_URL = previousDatabaseUrl;
});


test("cancelling after approval preserves the recorded approval decision", async () => {
  const jobId = "approval-store-approved-then-cancelled";
  await createChatJob(makeJob(jobId, "owner-d"));
  await requestChatJobApproval(jobId, "owner-d", makeApproval("approval-approved-before-cancel"));
  const approved = await resolveChatJobApproval(jobId, "owner-d", "approval-approved-before-cancel", "approved", "owner-d");
  assert.equal(approved?.pendingApproval?.status, "approved");

  const cancelled = await cancelChatJob(jobId, "owner-d");
  assert.equal(cancelled?.status, "cancelled");
  assert.equal(cancelled?.pendingApproval?.status, "approved");
  assert.equal(cancelled?.events?.some((event) => event && typeof event === "object" && (event as { name?: unknown }).name === "agent.approval.cancelled"), false);
});


test("concurrent memory-store approval requests create only one pending request", async () => {
  const jobId = "approval-store-concurrent-request";
  await createChatJob(makeJob(jobId, "owner-e"));
  const [first, second] = await Promise.all([
    requestChatJobApproval(jobId, "owner-e", makeApproval("approval-concurrent-a")),
    requestChatJobApproval(jobId, "owner-e", makeApproval("approval-concurrent-b")),
  ]);
  assert.equal([first, second].filter(Boolean).length, 1);
  assert.equal((await getChatJob(jobId, "owner-e"))?.pendingApproval?.status, "pending");
});

test("concurrent memory-store decisions resolve a pending request only once", async () => {
  const jobId = "approval-store-concurrent-decision";
  await createChatJob(makeJob(jobId, "owner-f"));
  await requestChatJobApproval(jobId, "owner-f", makeApproval("approval-concurrent-decision"));
  const [approved, rejected] = await Promise.all([
    resolveChatJobApproval(jobId, "owner-f", "approval-concurrent-decision", "approved", "owner-f"),
    resolveChatJobApproval(jobId, "owner-f", "approval-concurrent-decision", "rejected", "owner-f"),
  ]);
  assert.equal([approved, rejected].filter(Boolean).length, 1);
  const final = await getChatJob(jobId, "owner-f");
  assert.ok(final?.pendingApproval?.status === "approved" || final?.pendingApproval?.status === "rejected");
});


test("project lock admits one concurrent Agent Run and enforces owner-only heartbeat and release", async () => {
  const projectId = "project-lock-concurrency-test";
  const contenders = await Promise.all([
    acquireProjectLock(projectId, "owner-lock-a", "job-lock-a"),
    acquireProjectLock(projectId, "owner-lock-b", "job-lock-b"),
  ]);
  assert.equal(contenders.filter(Boolean).length, 1);
  const ownerJobId = contenders[0] ? "job-lock-a" : "job-lock-b";
  const otherJobId = ownerJobId === "job-lock-a" ? "job-lock-b" : "job-lock-a";
  assert.equal(await heartbeatProjectLock(projectId, ownerJobId), true);
  assert.equal(await heartbeatProjectLock(projectId, otherJobId), false);

  await releaseProjectLock(projectId, otherJobId);
  assert.equal(await acquireProjectLock(projectId, "owner-lock-c", "job-lock-c"), false);

  await releaseProjectLock(projectId, ownerJobId);
  assert.equal(await acquireProjectLock(projectId, "owner-lock-c", "job-lock-c"), true);
  await releaseProjectLock(projectId, "job-lock-c");
});
