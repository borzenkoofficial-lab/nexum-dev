import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { ProjectWorkspace } from "./workspace.js";
import { PatchFileTool } from "./patchFile.js";

test("patchFile applies one exact targeted replacement", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "nexum-patch-"));
  await writeFile(resolve(root, "app.js"), "const title = \"Old\";\nconst count = 1;\n", "utf8");
  const result = await new PatchFileTool(new ProjectWorkspace(root)).execute(JSON.stringify({
    path: "app.js",
    find: 'const title = "Old";',
    replace: 'const title = "New";',
  }));
  expect(result.success).toBe(true);
  expect(await readFile(resolve(root, "app.js"), "utf8")).toContain('const title = "New";');
});

test("patchFile refuses ambiguous replacements", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "nexum-patch-"));
  await writeFile(resolve(root, "app.js"), "const title = \"Old\";\nconst title2 = \"Old\";\n", "utf8");
  const result = await new PatchFileTool(new ProjectWorkspace(root)).execute(JSON.stringify({
    path: "app.js",
    find: 'const title = "Old";',
    replace: 'const title = "New";',
    expectedMatches: 2,
  }));
  expect(result.success).toBe(false);
});
