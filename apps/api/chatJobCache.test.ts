import test from "node:test";
import assert from "node:assert/strict";
import { chatJobCache, loadChatJob, syncTerminalChatJobCache } from "./chatJobCache.js";
import type { ChatJob } from "./chatJobStore.js";

function job(status: ChatJob["status"]): ChatJob {
  return {
    id: "job-terminal-cache-regression",
    userId: "user-1",
    status,
    createdAt: 1,
    updatedAt: status === "running" ? 2 : 3,
  };
}

test.afterEach(() => {
  chatJobCache.clear();
});

test("successful terminal persistence result is visible through the production cache read path", async () => {
  const running = job("running");
  chatJobCache.set(running.id, running);

  const persistedCompleted = job("completed");
  const completeChatJob = async (): Promise<ChatJob> => persistedCompleted;
  const completed = await completeChatJob();
  syncTerminalChatJobCache(completed);

  const loaded = await loadChatJob(
    running.id,
    running.userId,
    async () => persistedCompleted,
  );

  assert.equal(loaded?.status, "completed");
  assert.equal(loaded, persistedCompleted);
});

test("failed terminal persistence result is visible through the production cache read path", async () => {
  const running = job("running");
  chatJobCache.set(running.id, running);

  const persistedFailed = job("failed");
  const failChatJob = async (): Promise<ChatJob> => persistedFailed;
  const failed = await failChatJob();
  syncTerminalChatJobCache(failed);

  const loaded = await loadChatJob(
    running.id,
    running.userId,
    async () => persistedFailed,
  );

  assert.equal(loaded?.status, "failed");
  assert.equal(loaded, persistedFailed);
});

test("cancelled terminal persistence result is visible through the production cache read path", async () => {
  const running = job("running");
  chatJobCache.set(running.id, running);

  const persistedCancelled = job("cancelled");
  const cancelChatJob = async (): Promise<ChatJob> => persistedCancelled;
  const cancelled = await cancelChatJob();
  syncTerminalChatJobCache(cancelled);

  const loaded = await loadChatJob(
    running.id,
    running.userId,
    async () => persistedCancelled,
  );

  assert.equal(loaded?.status, "cancelled");
  assert.equal(loaded, persistedCancelled);
});

test("missing terminal persistence result cannot overwrite a running cache entry", async () => {
  const running = job("running");
  chatJobCache.set(running.id, running);

  syncTerminalChatJobCache(null);

  const loaded = await loadChatJob(
    running.id,
    running.userId,
    async () => job("completed"),
  );

  assert.equal(loaded, running);
  assert.equal(loaded?.status, "running");
});
