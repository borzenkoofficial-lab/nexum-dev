import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScaffoldProjectTool } from "./scaffoldProject.js";
import { ProjectWorkspace } from "./workspace.js";

async function createWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "nexum-scaffold-test-"));
}

test("scaffoldProject creates a runnable starter in an empty workspace", async (t) => {
  const root = await createWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await new ScaffoldProjectTool(new ProjectWorkspace(root)).execute("Create a simple landing page");
  assert.equal(result.success, true, result.output);
  const files = await readdir(root);
  assert.ok(files.includes("index.html"));
  assert.ok(files.includes("style.css"));
  assert.ok(files.includes("app.js"));
  assert.match(await readFile(join(root, "index.html"), "utf8"), /<title>/i);
});

test("scaffoldProject refuses to overwrite an existing project", async (t) => {
  const root = await createWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "keep.txt"), "user data", "utf8");

  const result = await new ScaffoldProjectTool(new ProjectWorkspace(root)).execute("Create a landing page");
  assert.equal(result.success, false);
  assert.match(result.output, /Refused to scaffold a non-empty project/i);
  assert.equal(await readFile(join(root, "keep.txt"), "utf8"), "user data");
  assert.deepEqual(await readdir(root), ["keep.txt"]);
});

test("scaffoldProject stops when the task is already cancelled", async (t) => {
  const root = await createWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  const controller = new AbortController();
  controller.abort();

  const result = await new ScaffoldProjectTool(new ProjectWorkspace(root)).execute("Create a landing page", controller.signal);
  assert.equal(result.success, false);
  assert.match(result.output, /Aborted/i);
  assert.deepEqual(await readdir(root), []);
});
