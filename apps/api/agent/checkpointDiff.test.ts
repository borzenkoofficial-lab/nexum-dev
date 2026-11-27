import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CheckpointManager } from "./checkpoint.js";

test("checkpoint diff reports added, modified and deleted files with hunks", async () => {
  const root = await mkdtemp(join(tmpdir(), "kvard-diff-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "App.tsx"), "export function App() {\n  return <h1>Old</h1>;\n}\n");
    await writeFile(join(root, "README.md"), "# Project\n");
    await writeFile(join(root, "logo.bin"), Buffer.from([0, 1, 2, 3]));
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(root, "node_modules", "pkg", "index.js"), "ignored");
    const manager = new CheckpointManager();
    const checkpoint = await manager.create("p1", root, "before agent job test");

    await writeFile(join(root, "src", "App.tsx"), "export function App() {\n  return <h1>New</h1>;\n}\n");
    await unlink(join(root, "README.md"));
    await writeFile(join(root, "src", "styles.css"), "h1 { color: red; }\n");
    await writeFile(join(root, "logo.bin"), Buffer.from([0, 9, 9, 9]));
    await writeFile(join(root, "node_modules", "pkg", "index.js"), "changed but excluded");

    const diff = await manager.diff("p1", root, checkpoint.id);
    assert.deepEqual(diff.files.map((file) => [file.path, file.status]), [["README.md", "deleted"], ["logo.bin", "modified"], ["src/App.tsx", "modified"], ["src/styles.css", "added"]]);
    const app = diff.files.find((file) => file.path === "src/App.tsx")!;
    assert.equal(app.additions, 1);
    assert.equal(app.deletions, 1);
    assert.deepEqual(app.hunks[0]!.lines.filter((line) => line.type !== "context").map((line) => line.text), ["  return <h1>Old</h1>;", "  return <h1>New</h1>;"]);
    const binary = diff.files.find((file) => file.path === "logo.bin")!;
    assert.equal(binary.binary, true);
    assert.equal(binary.omitted, true);
    assert.deepEqual(diff.totals, { files: 4, additions: 2, deletions: 2 });
    assert.equal(diff.truncated, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an unchanged project has an empty diff; bad checkpoint ids are rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "kvard-diff-"));
  try {
    await writeFile(join(root, "index.html"), "<h1>x</h1>\n");
    const manager = new CheckpointManager();
    const checkpoint = await manager.create("p1", root);
    assert.deepEqual((await manager.diff("p1", root, checkpoint.id)).files, []);
    await assert.rejects(manager.diff("p1", root, "../../etc"), /Invalid checkpoint id/);
    await assert.rejects(manager.diff("other-project", root, checkpoint.id), /Invalid checkpoint manifest/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
