import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentTaskState, isBuildValidationCommand, syncVerificationState } from "./taskState.js";
import type { AgentToolResult } from "./types.js";

function result(tool: string, input: string, success = true): AgentToolResult {
  return { iteration: 1, tool, input, result: { success, output: success ? "ok" : "failed" } };
}

test("build evidence requires an explicit package build-script command", () => {
  assert.equal(isBuildValidationCommand("runCommand", "npm run build"), true);
  assert.equal(isBuildValidationCommand("runSandbox", JSON.stringify({ command: "npm run build" })), true);
  assert.equal(isBuildValidationCommand("runCommand", "pnpm run build"), true);
  assert.equal(isBuildValidationCommand("runCommand", "yarn build"), true);
  assert.equal(isBuildValidationCommand("runCommand", "bun run build"), true);

  assert.equal(isBuildValidationCommand("runCommand", "echo build"), false);
  assert.equal(isBuildValidationCommand("runCommand", "node -e \"console.log('build')\""), false);
  assert.equal(isBuildValidationCommand("runCommand", "npm install --ignore-scripts"), false);
  assert.equal(isBuildValidationCommand("runCommand", "npm run test"), false);
  assert.equal(isBuildValidationCommand("git", "git status --short"), false);
});

test("verification sync does not treat incidental build text as build evidence", () => {
  const state = createAgentTaskState("Проверить сборку");
  const history = [
    result("writeFile", JSON.stringify({ path: "src/App.tsx", content: "app" })),
    result("writeFile", JSON.stringify({ path: "src/App.css", content: "style" })),
    result("runCommand", "node -e \"console.log('build passed')\""),
  ];

  syncVerificationState(state, history);
  assert.equal(state.verifiedAtChangeVersion.build, -1);
  assert.equal(state.verified.build, false);
});

test("verification sync accepts a successful explicit build after the latest write", () => {
  const state = createAgentTaskState("Проверить сборку");
  const history = [
    result("writeFile", JSON.stringify({ path: "src/App.tsx", content: "app" })),
    result("writeFile", JSON.stringify({ path: "src/App.css", content: "style" })),
    result("runSandbox", JSON.stringify({ command: "npm run build" })),
  ];

  syncVerificationState(state, history);
  assert.equal(state.changeVersion, 2);
  assert.equal(state.verifiedAtChangeVersion.build, 2);
  assert.equal(state.verified.build, true);
});

test("a later write invalidates earlier build evidence", () => {
  const state = createAgentTaskState("Проверить сборку");
  const history = [
    result("writeFile", JSON.stringify({ path: "src/App.tsx", content: "app" })),
    result("runCommand", "npm run build"),
    result("patchFile", JSON.stringify({ path: "src/App.tsx", find: "a", replace: "b" })),
  ];

  syncVerificationState(state, history);
  assert.equal(state.changeVersion, 2);
  assert.equal(state.verifiedAtChangeVersion.build, 1);
  assert.equal(state.verified.build, false);
});
