import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { resolveProjectPath } from "./path.js";

test("accepts relative paths inside the active project", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexum-path-"));
  assert.equal(resolveProjectPath(root, "src/app.js"), resolve(root, "src/app.js"));
});

test("accepts an absolute path inside the active project", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexum-path-"));
  assert.equal(resolveProjectPath(root, join(root, "index.html")), resolve(root, "index.html"));
});

test("rejects traversal and unrelated absolute paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexum-path-"));
  await mkdir(join(root, "src"));
  assert.throws(() => resolveProjectPath(root, "../escape.txt"), /project directory/);
  assert.throws(() => resolveProjectPath(root, "/tmp/projects/fake/index.html"), /project directory/);
});
