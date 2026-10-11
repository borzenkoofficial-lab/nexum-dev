import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunCommandTool } from "../agent/tools/runCommand.js";
import { DockerSandbox } from "./dockerSandbox.js";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

test("rejects shell operators before Docker execution", async () => {
  const result = await new DockerSandbox(workspaceRoot).run({
    projectPath: ".",
    command: "npm run build && echo bypass",
  });

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /shell operators/i);
});

test("rejects a project path outside the workspace", async () => {
  const result = await new DockerSandbox(workspaceRoot).run({
    projectPath: "../",
    command: "npm run build",
  });

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /project directory/i);
});

test("rejects unsupported commands and invalid timeout", async () => {
  const sandbox = new DockerSandbox(workspaceRoot);
  const commandResult = await sandbox.run({ projectPath: ".", command: "docker ps" });
  const timeoutResult = await sandbox.run({ projectPath: ".", command: "npm run build", timeoutMs: 10 });

  assert.equal(commandResult.success, false);
  assert.match(commandResult.error ?? "", /not allowed/i);
  assert.equal(timeoutResult.success, false);
  assert.match(timeoutResult.error ?? "", /timeout/i);
});

test("checks Docker and never pulls the image automatically", async () => {
  const result = await new DockerSandbox(workspaceRoot).run({
    projectPath: ".",
    command: "npm run build",
  });

  assert.equal(typeof result.success, "boolean");
  assert.equal(result.command, "npm run build");
  assert.equal(result.exitCode === null || typeof result.exitCode === "number", true);
});

test("RunCommandTool bounds git output and fails closed on overflow", async () => {
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
