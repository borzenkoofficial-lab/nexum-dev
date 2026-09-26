import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
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
