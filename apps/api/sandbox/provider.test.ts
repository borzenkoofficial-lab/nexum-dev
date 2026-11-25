import assert from "node:assert/strict";
import { test } from "node:test";
import { createSandboxProvider, type SandboxProvider, type SandboxSession } from "./provider.js";

const session: SandboxSession = {
  run: async (request) => ({
    success: true, exitCode: 0, stdout: request.command, stderr: "", durationMs: 1, command: request.command,
  }),
  getPreviewUrl: async () => { throw new Error("Preview is not configured"); },
  dispose: async () => undefined,
};

test("provider factory selects the configured provider", () => {
  const docker: SandboxProvider = { create: async () => session };
  const daytona: SandboxProvider = { create: async () => session };
  assert.equal(createSandboxProvider({ provider: "docker", docker, daytona }), docker);
  assert.equal(createSandboxProvider({ provider: "daytona", docker, daytona }), daytona);
});

test("provider factory defaults to Docker only outside production", () => {
  const docker: SandboxProvider = { create: async () => session };
  assert.equal(createSandboxProvider({ nodeEnv: "development", docker }), docker);
  assert.throws(
    () => createSandboxProvider({ nodeEnv: "production", docker }),
    /NEXUM_SANDBOX_PROVIDER=daytona/,
  );
});

test("provider factory fails closed for unknown providers and missing Daytona", () => {
  const docker: SandboxProvider = { create: async () => session };
  assert.throws(() => createSandboxProvider({ provider: "unknown", docker }), /Unsupported sandbox provider/);
  assert.throws(() => createSandboxProvider({ provider: "daytona", docker }), /Daytona sandbox provider is not configured/);
});
