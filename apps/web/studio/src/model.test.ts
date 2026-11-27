import assert from "node:assert/strict";
import { test } from "node:test";
import { ancestorDirs, apiUrl, buildFileTree, clampPane, isTerminal, parseJobSnapshot } from "./model.ts";

test("file tree: directories first, sorted, nested", () => {
  const tree = buildFileTree(["src/main.jsx", "index.html", "src/App.jsx", "src/styles/app.css", "package.json"]);
  assert.deepEqual(tree.map((node) => `${node.kind}:${node.name}`), ["dir:src", "file:index.html", "file:package.json"]);
  const src = tree[0]!;
  assert.deepEqual(src.children.map((node) => `${node.kind}:${node.path}`), ["dir:src/styles", "file:src/App.jsx", "file:src/main.jsx"]);
  assert.equal(src.children[0]!.children[0]!.path, "src/styles/app.css");
});

test("ancestor directories of a file", () => {
  assert.deepEqual(ancestorDirs("src/styles/app.css"), ["src", "src/styles"]);
  assert.deepEqual(ancestorDirs("index.html"), []);
});

test("job snapshots are validated and normalised", () => {
  assert.equal(parseJobSnapshot(null), null);
  assert.equal(parseJobSnapshot({ id: "x", status: "weird" }), null);
  const job = parseJobSnapshot({ id: "j1", status: "running", stage: "editing", events: [{ id: 1, timestamp: 1, type: "thinking", message: "ok" }, null, { bad: true }], steps: [{ tool: "writeFile", success: true }, 3], updatedAt: 5 });
  assert.equal(job?.events.length, 1);
  assert.equal(job?.steps.length, 1);
  assert.equal(job?.stage, "editing");
  assert.equal(isTerminal(job?.status), false);
  assert.equal(isTerminal("cancelled"), true);
});

test("pane widths are clamped to sane bounds", () => {
  assert.equal(clampPane("files", 10), 180);
  assert.equal(clampPane("agent", 5000), 640);
  assert.equal(clampPane("files", Number.NaN), 248);
});

test("API URLs stay same-origin unless a base is configured", () => {
  assert.equal(apiUrl("/api/projects"), "/api/projects");
  assert.equal(apiUrl("/api/projects", "https://api.example.com/"), "https://api.example.com/api/projects");
  assert.throws(() => apiUrl("projects"), /must start with \/api\//);
});
