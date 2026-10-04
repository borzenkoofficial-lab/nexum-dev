import { mkdtemp, readFile, mkdir, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { CheckpointManager } from "./checkpoint.js";
import { ProjectStateManager } from "../projects/projectState.js";

test("CheckpointManager restores modified, added, and deleted files", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexum-checkpoint-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.ts"), "original", "utf8");
  const manager = new CheckpointManager();

  const checkpoint = await manager.create("p1", root, "before agent");
  await writeFile(join(root, "src", "app.ts"), "changed", "utf8");
  await writeFile(join(root, "src", "new.ts"), "new", "utf8");

  await manager.rollback("p1", root, checkpoint.id);

  assert.equal(await readFile(join(root, "src", "app.ts"), "utf8"), "original");
  await assert.rejects(readFile(join(root, "src", "new.ts"), "utf8"));
});

test("CheckpointManager excludes protected runtime dependencies", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexum-checkpoint-"));
  await mkdir(join(root, "node_modules"), { recursive: true });
  await writeFile(join(root, "node_modules", "ignored.txt"), "ignored", "utf8");
  const manager = new CheckpointManager();
  const checkpoint = await manager.create("p2", root);
  assert.equal(checkpoint.files.some((file) => file.path.startsWith("node_modules/")), false);
});

test("Checkpoint persistence survives repeated concurrent writes and ignores transient temp files", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexum-checkpoint-concurrency-"));
  await writeFile(join(root, "app.txt"), "stable", "utf8");
  const manager = new CheckpointManager();
  const projectState = new ProjectStateManager(root, "concurrent");
  const checkpoint = await manager.create("concurrent", root, "concurrency");

  for (let batch = 0; batch < 6; batch += 1) {
    const states = Array.from({ length: 32 }, (_, index) => ({
      writer: batch * 32 + index,
      state: "VALIDATING",
      timestamp: Date.now() + batch * 32 + index,
    }));

    await Promise.all([
      ...states.map((state) => manager.writeExecutionState("concurrent", root, checkpoint.id, state)),
      ...Array.from({ length: 8 }, () => projectState.refresh()),
    ]);

    const persisted = await manager.readExecutionState("concurrent", root, checkpoint.id) as { writer?: number; state?: string };
    assert.ok(persisted);
    assert.equal(persisted.state, "VALIDATING");
    const writer = persisted.writer;
    if (typeof writer !== "number") {
      assert.fail("checkpoint state must persist a numeric writer");
    }
    assert.ok(writer >= batch * 32 && writer < (batch + 1) * 32);

    const files = await readdir(join(root, ".nexum", "checkpoints", checkpoint.id));
    assert.equal(files.some((file) => file.startsWith("agent-state.tmp-")), false);
  }
});

test("Checkpoint persistence isolates concurrent checkpoint identities", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexum-checkpoint-isolation-"));
  await writeFile(join(root, "app.txt"), "stable", "utf8");
  const manager = new CheckpointManager();
  const checkpoints = await Promise.all([
    manager.create("job-a", root, "job-a"),
    manager.create("job-b", root, "job-b"),
    manager.create("job-c", root, "job-c"),
  ]);

  await Promise.all(checkpoints.flatMap((checkpoint, checkpointIndex) =>
    Array.from({ length: 24 }, (_, index) =>
      manager.writeExecutionState(
        checkpoint.projectId,
        root,
        checkpoint.id,
        { job: checkpointIndex, writer: index, state: "EXECUTING" },
      ),
    ),
  ));

  for (const [index, checkpoint] of checkpoints.entries()) {
    const persisted = await manager.readExecutionState(checkpoint.projectId, root, checkpoint.id) as {
      job?: number;
      writer?: number;
      state?: string;
    };
    assert.deepEqual(persisted?.job, index);
    assert.equal(persisted?.state, "EXECUTING");
    const writer = persisted?.writer;
    if (typeof writer !== "number") {
      assert.fail("checkpoint state must persist a numeric writer");
    }
    assert.ok(writer >= 0 && writer < 24);
  }
});
