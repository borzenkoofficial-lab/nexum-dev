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
  const projectRoot = join(root, "projects", "nexum");
  assert.equal(
    resolveProjectPath(projectRoot, "/workspaces/nexum-dev/projects/nexum/index.html"),
    resolve(projectRoot, "index.html"),
  );
});


test("normalizes workspace-relative project paths emitted by the model", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexum-path-"));
  const projectName = root.split("/").pop() ?? "nexum";
  const projectRoot = join(root, "projects", projectName);
  await mkdir(projectRoot, { recursive: true });
  assert.equal(
    resolveProjectPath(projectRoot, "projects/" + projectName + "/index.html"),
    resolve(projectRoot, "index.html"),
  );
  assert.equal(
    resolveProjectPath(projectRoot, "./projects/" + projectName + "/index.html"),
    resolve(projectRoot, "index.html"),
  );
});
