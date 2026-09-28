import { mkdtemp, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { CheckpointManager } from "./checkpoint.js";

test("creates a snapshot and restores modified, added, and deleted files", async () => {
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

test("does not snapshot protected runtime dependencies", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexum-checkpoint-"));
  await mkdir(join(root, "node_modules"), { recursive: true });
  await writeFile(join(root, "node_modules", "ignored.txt"), "ignored", "utf8");
  const manager = new CheckpointManager(root);
  const checkpoint = await manager.create("p2", root);
  assert.equal(checkpoint.files.some((file) => file.path.startsWith("node_modules/")), false);
});
