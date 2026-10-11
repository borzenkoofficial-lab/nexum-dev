import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { RunCommandTool } from "./runCommand.js";

test("rejects shell operators before executing a command", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexum-run-command-"));
  try {
    const result = await new RunCommandTool(root).execute("git status && echo bypass");
    assert.equal(result.success, false);
    assert.match(result.stderr, /shell operators/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bounds git output and reports output-limit failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexum-run-command-"));
  try {
    execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
    await writeFile(join(root, "large.txt"), "a".repeat(80_000), "utf8");
    execFileSync("git", ["add", "large.txt"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["-c", "user.name=NEXUM Test", "-c", "user.email=test@nexum.invalid", "commit", "-m", "initial"], { cwd: root, stdio: "ignore" });
    await writeFile(join(root, "large.txt"), "b".repeat(80_000), "utf8");

    const result = await new RunCommandTool(root, 10_000).execute("git diff");
    assert.equal(result.success, false);
    assert.match(result.stderr, /output limit exceeded/i);
    assert.ok(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) < 33_000);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
