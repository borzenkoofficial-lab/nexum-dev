import test from "node:test";
import assert from "node:assert/strict";
import { enqueueChatJobPersistence, waitForChatJobPersistence } from "./chatJobPersistence.js";

test("terminal transition waits for an in-flight event persistence operation", async () => {
  const jobId = "job-persistence-ordering";
  let releasePersistence!: () => void;
  const persistenceReleased = new Promise<void>((resolve) => { releasePersistence = resolve; });
  let eventPersisted = false;
  let terminalVisible = false;

  const eventPersistence = enqueueChatJobPersistence(jobId, async () => {
    await persistenceReleased;
    eventPersisted = true;
  });

  const terminalTransition = (async () => {
    await waitForChatJobPersistence(jobId);
    terminalVisible = true;
  })();

  await Promise.resolve();
  assert.equal(eventPersisted, false);
  assert.equal(terminalVisible, false);

  releasePersistence();
  await Promise.all([eventPersistence, terminalTransition]);

  assert.equal(eventPersisted, true);
  assert.equal(terminalVisible, true);
});

test("multiple event persistence operations are settled before terminal transition", async () => {
  const jobId = "job-persistence-ordering-multiple";
  const order: string[] = [];
  let releaseFirst!: () => void;
  const firstReleased = new Promise<void>((resolve) => { releaseFirst = resolve; });

  const first = enqueueChatJobPersistence(jobId, async () => {
    await firstReleased;
    order.push("validation.failed");
  });
  const second = enqueueChatJobPersistence(jobId, async () => {
    order.push("repair.started");
  });

  const terminal = (async () => {
    await waitForChatJobPersistence(jobId);
    order.push("terminal");
  })();

  await Promise.resolve();
  assert.deepEqual(order, []);

  releaseFirst();
  await Promise.all([first, second, terminal]);

  assert.deepEqual(order, ["validation.failed", "repair.started", "terminal"]);
});

test("failure terminal transition waits for the emitted failure event", async () => {
  const jobId = "job-persistence-ordering-failed";
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const persisted: string[] = [];

  const event = enqueueChatJobPersistence(jobId, async () => {
    await held;
    persisted.push("agent.validation.failed");
  });
  const terminal = (async () => {
    await waitForChatJobPersistence(jobId);
    persisted.push("FAILED");
  })();

  await Promise.resolve();
  assert.deepEqual(persisted, []);
  release();
  await Promise.all([event, terminal]);

  assert.deepEqual(persisted, ["agent.validation.failed", "FAILED"]);
});

test("cancellation terminal transition waits for the emitted event", async () => {
  const jobId = "job-persistence-ordering-cancelled";
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const persisted: string[] = [];

  const event = enqueueChatJobPersistence(jobId, async () => {
    await held;
    persisted.push("agent.repair.started");
  });
  const terminal = (async () => {
    await waitForChatJobPersistence(jobId);
    persisted.push("CANCELLED");
  })();

  await Promise.resolve();
  assert.deepEqual(persisted, []);
  release();
  await Promise.all([event, terminal]);

  assert.deepEqual(persisted, ["agent.repair.started", "CANCELLED"]);
});
