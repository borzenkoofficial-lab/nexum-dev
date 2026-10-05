import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProjectWorkspace } from "./workspace.js";
import { ScaffoldProjectTool } from "./scaffoldProject.js";

test("scaffoldProject ignores NEXUM checkpoint metadata in an otherwise fresh project", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexum-scaffold-"));
  try {
    await mkdir(join(root, ".nexum"), { recursive: true });
    await writeFile(join(root, ".nexum", "checkpoint.json"), "{}\n", "utf8");

    const result = await new ScaffoldProjectTool(new ProjectWorkspace(root)).execute(
      "Сделай сайт автосервиса с диагностикой и ремонтом автомобилей",
    );

    assert.equal(result.success, true);
    assert.match(result.output, /Website scaffold created/i);
    assert.match(await readFile(join(root, "index.html"), "utf8"), /автосервис/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
