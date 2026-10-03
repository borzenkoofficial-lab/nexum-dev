import test from "node:test";
import assert from "node:assert/strict";
import { chatJobCache, syncTerminalChatJobCache } from "./chatJobCache.js";
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

test("terminal completion replaces stale running cache entry", () => {
  chatJobCache.set("job-terminal-cache-regression", job("running"));

  const completed = job("completed");
  syncTerminalChatJobCache(completed);

  assert.equal(chatJobCache.get(completed.id)?.status, "completed");
  assert.equal(chatJobCache.get(completed.id), completed);
});

test("terminal failure replaces stale running cache entry", () => {
  chatJobCache.set("job-terminal-cache-regression", job("running"));

  const failed = job("failed");
  syncTerminalChatJobCache(failed);

  assert.equal(chatJobCache.get(failed.id)?.status, "failed");
  assert.equal(chatJobCache.get(failed.id), failed);
});

test("terminal cancellation replaces stale running cache entry", () => {
  chatJobCache.set("job-terminal-cache-regression", job("running"));

  const cancelled = job("cancelled");
  syncTerminalChatJobCache(cancelled);

  assert.equal(chatJobCache.get(cancelled.id)?.status, "cancelled");
  assert.equal(chatJobCache.get(cancelled.id), cancelled);
});

test("missing terminal persistence result cannot overwrite a running cache entry", () => {
  const running = job("running");
  chatJobCache.set(running.id, running);

  syncTerminalChatJobCache(null);

  assert.equal(chatJobCache.get(running.id), running);
  assert.equal(chatJobCache.get(running.id)?.status, "running");
});
