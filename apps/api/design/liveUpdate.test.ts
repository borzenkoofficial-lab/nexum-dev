import { mkdir, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectLiveUpdate } from "./liveUpdate.js";

test("live update manifest exposes granular css and app revisions", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "nexum-live-"));
  try {
    await mkdir(resolve(root, "dist", "assets"), { recursive: true });
    await writeFile(resolve(root, "dist", "index.html"), "<!doctype html><html><body><div id=\"app\"></div></body></html>");
    await writeFile(resolve(root, "dist", "assets", "app.js"), "console.log('a')");
    await writeFile(resolve(root, "dist", "assets", "style.css"), "body{margin:0}");
    const first = await inspectLiveUpdate(root, "p1");
    assert.equal(first.mode, "built-app");
    assert.equal(first.buildReady, true);
    assert.ok(first.revision);
    assert.ok(first.cssRevision);
    assert.ok(first.appRevision);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await writeFile(resolve(root, "dist", "assets", "style.css"), "body{margin:8px}");
    const second = await inspectLiveUpdate(root, "p1");
    assert.notEqual(second.revision, first.revision);
    assert.notEqual(second.cssRevision, first.cssRevision);
    assert.equal(second.appRevision, first.appRevision);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
