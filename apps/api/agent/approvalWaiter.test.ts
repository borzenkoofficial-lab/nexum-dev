import test from "node:test";
import assert from "node:assert/strict";
import { waitForChatJobApproval } from "./approvalWaiter.js";
import type { ChatJob } from "../chatJobStore.js";

function jobWithApproval(status: "pending" | "approved" | "rejected" | "expired" | "cancelled", expiresAt = Date.now() + 60_000): ChatJob {
  const now = Date.now();
  return {
    id: "approval-wait-job",
    userId: "approval-wait-owner",
    status: "running",
    stage: "awaiting_approval",
    createdAt: now,
    updatedAt: now,
    pendingApproval: {
      id: "approval-wait-id",
      toolName: "writeFile",
      risk: "WRITE",
      inputPreview: "{\"path\":\"src/app.ts\"}",
      status,
      createdAt: now,
      expiresAt,
      resumeStage: "editing",
    },
  };
}

test("approval waiter returns approved after the persisted decision changes", async () => {
  let reads = 0;
  const decision = await waitForChatJobApproval({
    jobId: "approval-wait-job",
    userId: "approval-wait-owner",
    approvalId: "approval-wait-id",
    pollIntervalMs: 1,
    readJob: async () => jobWithApproval(++reads < 2 ? "pending" : "approved"),
    resolveExpired: async () => null,
  });
  assert.equal(decision, "approved");
  assert.ok(reads >= 2);
});

test("approval waiter returns rejected for a persisted rejection", async () => {
  const decision = await waitForChatJobApproval({
    jobId: "approval-wait-job",
    userId: "approval-wait-owner",
    approvalId: "approval-wait-id",
    readJob: async () => jobWithApproval("rejected"),
    resolveExpired: async () => null,
  });
  assert.equal(decision, "rejected");
});

test("approval waiter expires a request and returns an expired decision", async () => {
  let now = 10_000;
  const decision = await waitForChatJobApproval({
    jobId: "approval-wait-job",
    userId: "approval-wait-owner",
    approvalId: "approval-wait-id",
    now: () => now,
    readJob: async () => jobWithApproval("pending", 9_999),
    resolveExpired: async () => jobWithApproval("expired", 9_999),
  });
  assert.equal(decision, "expired");
});

test("approval waiter fails closed when the request is missing or replaced", async () => {
  await assert.rejects(() => waitForChatJobApproval({
    jobId: "approval-wait-job",
    userId: "approval-wait-owner",
    approvalId: "expected-approval",
    readJob: async () => jobWithApproval("pending"),
    resolveExpired: async () => null,
  }), /approval request changed|not found/i);
});

test("approval waiter aborts promptly when the chat job is cancelled", async () => {
  const controller = new AbortController();
  const waiting = waitForChatJobApproval({
    jobId: "approval-wait-job",
    userId: "approval-wait-owner",
    approvalId: "approval-wait-id",
    signal: controller.signal,
    pollIntervalMs: 5_000,
    readJob: async () => jobWithApproval("pending"),
    resolveExpired: async () => null,
  });
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(waiting, (error: unknown) => error instanceof Error && error.name === "AbortError");
});
