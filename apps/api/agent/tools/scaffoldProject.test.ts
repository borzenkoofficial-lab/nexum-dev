import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProjectWorkspace } from "./workspace.js";
import { ScaffoldProjectTool } from "./scaffoldProject.js";

test("scaffoldProject recognizes the canonical NEXUM starter when app.js is absent", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexum-scaffold-missing-app-"));
  try {
    await mkdir(join(root, ".nexum"), { recursive: true });
    await writeFile(join(root, ".nexum", "checkpoint.json"), "{}\n", "utf8");
    await writeFile(join(root, "index.html"), "<!doctype html><p>Your project is ready. Ask the Agent to design and build it.</p>", "utf8");
    await writeFile(join(root, "style.css"), "body{margin:0}", "utf8");

    const result = await new ScaffoldProjectTool(new ProjectWorkspace(root)).execute(
      "Создай React/Vite сайт автосервиса с диагностикой и ремонтом автомобилей",
    );

    assert.equal(result.success, true, result.output);
    assert.match(await readFile(join(root, "package.json"), "utf8"), /"vite"/);
    assert.match(await readFile(join(root, "src", "App.jsx"), "utf8"), /Loading product/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("scaffoldProject still refuses to overwrite user-authored project files", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexum-scaffold-user-files-"));
  try {
    await writeFile(join(root, "index.html"), "<!doctype html><h1>My site</h1>", "utf8");
    await writeFile(join(root, "style.css"), "body{color:red}", "utf8");
    await writeFile(join(root, "app.js"), "console.log('user code')", "utf8");

    const result = await new ScaffoldProjectTool(new ProjectWorkspace(root)).execute("Создай сайт автосервиса");
    assert.equal(result.success, false);
    assert.match(result.output, /Refused to scaffold/);
    assert.equal(await readFile(join(root, "index.html"), "utf8"), "<!doctype html><h1>My site</h1>");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
