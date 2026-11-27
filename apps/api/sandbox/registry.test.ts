import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { SandboxProvider, SandboxSession } from "./provider.js";
import { MemorySandboxRegistry, ONE_SHOT_ORPHAN_MS, ORPHAN_GRACE_MS, PostgresSandboxRegistry } from "./registry.js";
import { reapOrphanedSandboxes, resetSandboxRunnerForTests, setSandboxProviderForTests, setSandboxRegistryForTests } from "./runner.js";

function fakeRemoteProvider() {
  const remote = new Map<string, "live" | "deleted">();
  const provider: SandboxProvider = {
    id: "fake-remote",
    async create(): Promise<SandboxSession> {
      const remoteId = `sb-${randomUUID()}`;
      remote.set(remoteId, "live");
      return {
        remoteId,
        run: async () => ({ success: true, exitCode: 0, stdout: "ok", stderr: "", output: "ok" } as never),
        getPreviewUrl: async () => "https://preview.invalid",
        dispose: async () => { remote.set(remoteId, "deleted"); },
      };
    },
    async destroyById(remoteId) {
      if (remote.get(remoteId) !== "live") return "missing";
      remote.set(remoteId, "deleted");
      return "deleted";
    },
  };
  return { provider, remote };
}

test("Daytona records a sandbox right after provisioning and releases it on dispose", async () => {
  const { DaytonaSandboxProvider } = await import("./daytonaSandbox.js");
  const { Readable } = await import("node:stream");
  const root = await mkdtemp(join(tmpdir(), "kvard-sb-"));
  const sandbox = {
    id: "sandbox-registry-1",
    process: {
      createSession: async () => undefined,
      executeSessionCommand: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      deleteSession: async () => undefined,
    },
    fs: {
      createFolder: async () => undefined,
      uploadFileStream: async () => undefined,
      listFiles: async () => [],
      downloadFileStream: async () => Readable.from([]),
    },
    getWorkDir: async () => "/home/daytona",
    setTtl: async () => undefined,
    setLabels: async () => ({}),
    getSignedPreviewUrl: async () => ({ url: "https://preview.invalid" }),
    delete: async () => undefined,
    stop: async () => undefined,
  };
  const registry = new MemorySandboxRegistry(() => false);
  const provider = new DaytonaSandboxProvider({ apiKey: "test-key", registry, client: { v0: { create: async () => sandbox as never } } });
  const session = await provider.create({ projectPath: root, taskId: "task-1", projectId: "p1" });
  assert.equal(session.remoteId, "sandbox-registry-1");
  const orphansBefore = await registry.listOrphans(Date.now() + ORPHAN_GRACE_MS);
  assert.deepEqual(orphansBefore.map((item) => [item.remoteId, item.provider, item.taskId, item.projectId]), [["sandbox-registry-1", "daytona", "task-1", "p1"]]);
  await session.dispose();
  assert.equal(registry.releaseReason("sandbox-registry-1"), "disposed");
  assert.equal((await registry.listOrphans(Date.now() + ONE_SHOT_ORPHAN_MS)).length, 0);
});

test("the reaper deletes orphans of finished tasks and never touches active tasks", async () => {
  await resetSandboxRunnerForTests();
  const { provider, remote } = fakeRemoteProvider();
  const active = new Set(["task-active"]);
  const registry = new MemorySandboxRegistry((taskId) => active.has(taskId));
  setSandboxProviderForTests(provider);
  setSandboxRegistryForTests(registry);
  const orphan = await provider.create({ projectPath: "/x" });
  const running = await provider.create({ projectPath: "/x" });
  const vanished = "sb-already-expired";
  await registry.record({ remoteId: orphan.remoteId!, provider: "fake-remote", taskId: "task-dead", projectId: null });
  await registry.record({ remoteId: running.remoteId!, provider: "fake-remote", taskId: "task-active", projectId: null });
  await registry.record({ remoteId: vanished, provider: "fake-remote", taskId: "task-dead-2", projectId: null });
  await registry.record({ remoteId: "sb-other-provider", provider: "daytona", taskId: "task-dead-3", projectId: null });
  // Records are judged only after the grace period.
  const realNow = Date.now;
  Date.now = () => realNow() + ORPHAN_GRACE_MS + 1;
  try {
    const result = await reapOrphanedSandboxes();
    assert.deepEqual(result, { deleted: 1, missing: 1, failed: 0, skipped: 1 });
  } finally {
    Date.now = realNow;
  }
  assert.equal(remote.get(orphan.remoteId!), "deleted");
  assert.equal(remote.get(running.remoteId!), "live", "a sandbox of an active task must survive");
  assert.equal(registry.releaseReason(orphan.remoteId!), "orphan-deleted");
  assert.equal(registry.releaseReason(vanished), "orphan-missing");
  assert.equal(registry.releaseReason("sb-other-provider"), null, "another provider's sandbox is left alone");
  await resetSandboxRunnerForTests();
});

const databaseUrl = process.env.KVARD_BILLING_TEST_DATABASE_URL;
test("PostgreSQL: orphan query respects grace period, release state and one-shot age", { skip: !databaseUrl && "set KVARD_BILLING_TEST_DATABASE_URL to run against PostgreSQL" }, async () => {
  const previous = process.env.NEXUM_DATABASE_URL;
  const previousSsl = process.env.NEXUM_DB_SSL;
  process.env.NEXUM_DATABASE_URL = databaseUrl;
  process.env.NEXUM_DB_SSL = "false";
  const { closeDatabase, query } = await import("../db.js");
  try {
    // agent_chat_jobs is created at runtime by chatJobStore; make sure it exists for the join.
    await import("../chatJobStore.js").then((store) => store.getChatJob(randomUUID(), randomUUID())).catch(() => undefined);
    const registry = new PostgresSandboxRegistry();
    const tag = randomUUID();
    const ids = { fresh: `fresh-${tag}`, dead: `dead-${tag}`, released: `released-${tag}`, oneShotYoung: `oneshot-young-${tag}`, oneShotOld: `oneshot-old-${tag}` };
    await registry.record({ remoteId: ids.fresh, provider: "daytona", taskId: `t-${tag}-1`, projectId: null });
    for (const [id, task, ageMs] of [[ids.dead, `t-${tag}-2`, ORPHAN_GRACE_MS + 60_000], [ids.released, `t-${tag}-3`, ORPHAN_GRACE_MS + 60_000], [ids.oneShotYoung, null, ORPHAN_GRACE_MS + 60_000], [ids.oneShotOld, null, ONE_SHOT_ORPHAN_MS + 60_000]] as const) {
      await registry.record({ remoteId: id, provider: "daytona", taskId: task, projectId: null });
      await query("UPDATE sandbox_sessions SET created_at = NOW() - ($2::bigint * INTERVAL '1 millisecond') WHERE remote_id = $1", [id, ageMs]);
    }
    await registry.release(ids.released, "disposed");
    const orphans = new Set((await registry.listOrphans()).map((item) => item.remoteId).filter((id) => id.endsWith(tag)));
    assert.deepEqual([...orphans].sort(), [ids.dead, ids.oneShotOld].sort());
  } finally {
    await closeDatabase();
    if (previous === undefined) delete process.env.NEXUM_DATABASE_URL; else process.env.NEXUM_DATABASE_URL = previous;
    if (previousSsl === undefined) delete process.env.NEXUM_DB_SSL; else process.env.NEXUM_DB_SSL = previousSsl;
  }
});

test("Daytona destroyById deletes by id, maps 404 to missing and surfaces other errors", async () => {
  const { DaytonaSandboxProvider } = await import("./daytonaSandbox.js");
  const deleted: string[] = [];
  const notFound = Object.assign(new Error("not found"), { name: "DaytonaNotFoundError", statusCode: 404 });
  const client = {
    v0: {
      create: async () => { throw new Error("not used"); },
      get: async (id: string) => {
        if (id === "gone") throw notFound;
        if (id === "boom") throw Object.assign(new Error("server error"), { statusCode: 500 });
        return { id, delete: async () => { deleted.push(id); } } as never;
      },
    },
  };
  const provider = new DaytonaSandboxProvider({ apiKey: "test-key", client });
  assert.equal(provider.id, "daytona");
  assert.equal(await provider.destroyById("sb-1"), "deleted");
  assert.deepEqual(deleted, ["sb-1"]);
  assert.equal(await provider.destroyById("gone"), "missing");
  await assert.rejects(provider.destroyById("boom"), /server error/);
});
