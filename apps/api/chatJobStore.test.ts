import test from "node:test";
import assert from "node:assert/strict";
import {
  acquireProjectLock,
  heartbeatProjectLock,
  releaseProjectLock,
  recoverStaleChatJobs,
  cancelChatJob,
  createChatJob,
  getChatJob,
  requestChatJobApproval,
  resolveChatJobApproval,
  startChatJobToolAction,
  finishChatJobToolAction,
  listChatJobToolActions,
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


test("API restart recovery fails orphaned queued and running jobs and releases their locks", async () => {
  const staleAt = Date.now() - 60_000;
  const runningId = "chat-job-restart-running";
  const queuedId = "chat-job-restart-queued";
  await createChatJob({ ...makeJob(runningId, "restart-owner"), updatedAt: staleAt, projectId: "restart-project-running" });
  await createChatJob({
    ...makeJob(queuedId, "restart-owner"),
    status: "queued",
    stage: "queued",
    updatedAt: staleAt,
    projectId: "restart-project-queued",
  });
  await acquireProjectLock("restart-project-running", "restart-owner", runningId);
  await acquireProjectLock("restart-project-queued", "restart-owner", queuedId);

  const recovered = await recoverStaleChatJobs(5_000);
  assert.ok(recovered >= 2);
  const recoveredRunning = await getChatJob(runningId, "restart-owner");
  assert.equal(recoveredRunning?.status, "failed");
  assert.match(recoveredRunning?.error ?? "", /API process restarted/);
  assert.equal(recoveredRunning?.recoveryAssessment?.disposition, "inspect_before_retry");
  assert.equal(recoveredRunning?.recoveryAssessment?.reason, "execution_evidence_missing");
  assert.equal(recoveredRunning?.recoveryAssessment?.automaticResumeAllowed, false);

  const recoveredQueued = await getChatJob(queuedId, "restart-owner");
  assert.equal(recoveredQueued?.status, "failed");
  assert.match(recoveredQueued?.error ?? "", /API process restarted/);
  assert.equal(recoveredQueued?.recoveryAssessment?.disposition, "safe_to_restart");
  assert.equal(recoveredQueued?.recoveryAssessment?.automaticResumeAllowed, false);
  assert.equal(await acquireProjectLock("restart-project-running", "restart-owner", "restart-next-running"), true);
  assert.equal(await acquireProjectLock("restart-project-queued", "restart-owner", "restart-next-queued"), true);
  await releaseProjectLock("restart-project-running", "restart-next-running");
  await releaseProjectLock("restart-project-queued", "restart-next-queued");
});

test("tool action journal commits intent before execution and finalizes exactly once", async () => {
  const jobId = "tool-action-journal-job";
  await createChatJob(makeJob(jobId, "journal-owner"));
  const actionId = await startChatJobToolAction(jobId, "journal-owner", "writeFile", JSON.stringify({ path: "src/app.ts", content: "x" }));
  const started = await listChatJobToolActions(jobId, "journal-owner");
  assert.equal(started.length, 1);
  assert.equal(started[0].actionId, actionId);
  assert.equal(started[0].status, "started");
  assert.equal(started[0].risk, "WRITE");
  assert.match(started[0].inputSha256, /^[a-f0-9]{64}$/);

  await finishChatJobToolAction(jobId, "journal-owner", actionId, { success: true, output: "written" });
  const completed = await listChatJobToolActions(jobId, "journal-owner");
  assert.equal(completed[0].status, "succeeded");
  assert.equal(completed[0].resultSuccess, true);
  assert.match(completed[0].resultSha256 ?? "", /^[a-f0-9]{64}$/);
  await assert.rejects(
    finishChatJobToolAction(jobId, "journal-owner", actionId, { success: true, output: "duplicate" }),
    /missing, foreign, or already finalized/,
  );
  assert.equal((await listChatJobToolActions(jobId, "foreign-owner")).length, 0);
});

test("tool action journal fails closed for a job that is not running", async () => {
  const jobId = "tool-action-journal-queued";
  await createChatJob({ ...makeJob(jobId, "journal-owner"), status: "queued" });
  await assert.rejects(
    startChatJobToolAction(jobId, "journal-owner", "listFiles", "."),
    /non-running or inaccessible/,
  );
});

test("restart recovery consults durable action journal before marking an Agent Run failed", async () => {
  const jobId = "tool-action-journal-restart";
  const staleAt = Date.now() - 60_000;
  await createChatJob({ ...makeJob(jobId, "journal-restart-owner"), updatedAt: staleAt });
  const actionId = await startChatJobToolAction(jobId, "journal-restart-owner", "writeFile", "{\"path\":\"src/App.tsx\"}");
  const recovered = await recoverStaleChatJobs(5_000);
  assert.ok(recovered >= 1);
  const job = await getChatJob(jobId, "journal-restart-owner");
  assert.equal(job?.status, "failed");
  assert.equal(job?.recoveryAssessment?.disposition, "inspect_before_retry");
  assert.equal(job?.recoveryAssessment?.reason, "tool_outcome_unknown");
  assert.deepEqual(job?.recoveryAssessment?.startedActionIds, [actionId]);
});
