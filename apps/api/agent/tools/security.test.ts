import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ProjectWorkspace } from "./workspace.js";
import { ReadFileTool } from "./readFile.js";
import { SearchFilesTool } from "./searchFiles.js";

test("Agent cannot read secret-bearing files", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexum-security-"));
  await writeFile(join(root, ".env"), "OPENAI_API_KEY=secret-value\n", "utf8");
  const result = await new ReadFileTool(new ProjectWorkspace(root)).execute(".env");
  assert.equal(result.success, false);
  assert.equal(result.error?.fatal, true);
});

test("Agent search excludes secret-bearing files", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexum-security-"));
  await writeFile(join(root, ".env"), "DO_NOT_EXPOSE_THIS=secret-value\n", "utf8");
  await writeFile(join(root, "README.md"), "DO_NOT_EXPOSE_THIS is documentation placeholder", "utf8");
  const result = await new SearchFilesTool(new ProjectWorkspace(root)).execute("DO_NOT_EXPOSE_THIS");
  assert.equal(result.success, true);
  assert.match(result.output, /README\.md/);
  assert.doesNotMatch(result.output, /\.env/);
});
