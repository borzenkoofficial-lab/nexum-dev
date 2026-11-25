import test from "node:test";
import assert from "node:assert/strict";
import {
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
