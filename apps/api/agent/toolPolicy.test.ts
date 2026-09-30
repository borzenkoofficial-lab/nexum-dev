import assert from "node:assert/strict";
import { test } from "node:test";
import { getToolSecurityPolicy, validateToolInvocation } from "./toolPolicy.js";

test("every registered agent tool has an explicit security policy", () => {
  const names = ["listFiles","readFile","writeFile","scaffoldProject","validateProject","patchFile","testProject","searchFiles","runCommand","runSandbox","git","github"];
  assert.equal(names.filter((name) => {
    try { getToolSecurityPolicy(name); return false; } catch { return true; }
  }).length, 0);
});

test("tool input is bounded by its security policy", () => {
  const tool = { name: "readFile", description: "read", execute: async () => ({ success: true, output: "" }) };
  assert.throws(() => validateToolInvocation(tool, "x".repeat(4_001)));
});
