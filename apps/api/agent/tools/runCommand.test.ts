import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunCommandTool } from "./runCommand.js";

test("runCommand rejects shell operators without executing a command", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "nexum-run-command-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await new RunCommandTool(root).execute("node --version && whoami");
  assert.equal(result.success, false);
  assert.match(result.stderr, /Shell operators and redirection are not allowed/i);
  assert.equal(result.exitCode, null);
});

test("runCommand rejects project scripts outside the allowlist before spawning", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "nexum-run-command-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await new RunCommandTool(root).execute("npm run deploy");
  assert.equal(result.success, false);
  assert.match(result.stderr, /allowlisted npm run scripts|Only npm/i);
  assert.equal(result.exitCode, null);
});

test("runCommand rejects git directory overrides", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "nexum-run-command-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await new RunCommandTool(root).execute("git -C /tmp status");
  assert.equal(result.success, false);
  assert.match(result.stderr, /Changing the git working directory or config is not allowed/i);
  assert.equal(result.exitCode, null);
});
