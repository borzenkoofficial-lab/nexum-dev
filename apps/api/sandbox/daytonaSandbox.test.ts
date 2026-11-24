import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { test } from "node:test";
import { DaytonaSandboxProvider, collectWorkspaceFiles, type DaytonaClientLike } from "./daytonaSandbox.js";

test("workspace staging excludes secrets, dependencies, build output and symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexum-daytona-stage-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await mkdir(join(root, ".git"), { recursive: true });
    await writeFile(join(root, "src", "main.ts"), "export {};");
    await writeFile(join(root, ".env"), "SECRET=do-not-copy");
    await writeFile(join(root, "node_modules", "pkg", "index.js"), "ignored");
    await writeFile(join(root, ".git", "config"), "ignored");
    await symlink(join(root, "src", "main.ts"), join(root, "linked.ts"));
    const files = await collectWorkspaceFiles(root);
    assert.deepEqual(files.map((file) => file.relativePath), ["src/main.ts"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Daytona provider provisions private network-isolated sandbox, executes and disposes", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexum-daytona-run-"));
  const calls: string[] = [];
  let uploaded: Array<{ source: string; destination: string }> = [];
  const sandbox = {
    id: "sandbox-123",
    process: {
      executeCommand: async (command: string) => {
        calls.push("execute:" + command);
        return { exitCode: 0, result: "build ok", artifacts: { stdout: "build ok", stderr: "" } };
      },
    },
    fs: {
      createFolder: async (path: string) => { calls.push("mkdir:" + path); },
      uploadFiles: async (files: Array<{ source: string; destination: string }>) => { uploaded = files; calls.push("upload"); },
      listFiles: async () => [],
      downloadFile: async () => undefined,
    },
    getWorkDir: async () => "/home/daytona",
    updateNetworkSettings: async (settings: { networkBlockAll?: boolean; domainAllowList?: string }) => {
      calls.push("network:" + (settings.networkBlockAll ? "blocked" : settings.domainAllowList ?? "open"));
    },
    getSignedPreviewUrl: async () => ({ url: "https://preview.example.test/signed" }),
    delete: async () => { calls.push("delete"); },
    stop: async () => { calls.push("stop"); },
  };
  const client: DaytonaClientLike = {
    v0: {
      create: async (options) => {
        assert.equal(options.public, false);
        assert.equal(options.networkBlockAll, true);
        calls.push("create");
        return sandbox;
      },
    },
  };
  try {
    await writeFile(join(root, "index.html"), "<h1>ok</h1>");
    const provider = new DaytonaSandboxProvider({ apiKey: "test-key", client });
    const session = await provider.create({ projectPath: root, projectId: "p1", taskId: "t1" });
    assert.equal(uploaded.length, 1);
    assert.equal(uploaded[0].destination, posix.join("/home/daytona", "nexum-project", "index.html"));
    const result = await session.run({ projectPath: ".", command: "npm run build", timeoutMs: 10_000 });
    assert.equal(result.success, true);
    assert.equal(result.stdout, "build ok");
    assert.equal(await session.getPreviewUrl(4173, 120), "https://preview.example.test/signed");
    await session.dispose();
    assert.ok(calls.includes("delete"));
    assert.ok(calls.includes("network:blocked"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Daytona provider rejects missing credentials before creating a sandbox", async () => {
  let created = false;
  const client: DaytonaClientLike = { v0: { create: async () => { created = true; throw new Error("unexpected"); } } };
  const provider = new DaytonaSandboxProvider({ apiKey: "", client });
  await assert.rejects(provider.create({ projectPath: "." }), /DAYTONA_API_KEY/);
  assert.equal(created, false);
});

test("Daytona provider only opens npm registry egress for dependency installation", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexum-daytona-network-"));
  const calls: string[] = [];
  const sandbox = {
    id: "sandbox-123",
    process: { executeCommand: async () => ({ exitCode: 0, result: "", artifacts: { stdout: "", stderr: "" } }) },
    fs: { createFolder: async () => undefined, uploadFiles: async () => undefined, listFiles: async () => [], downloadFile: async () => undefined },
    getWorkDir: async () => "/home/daytona",
    updateNetworkSettings: async (settings: { networkBlockAll?: boolean; domainAllowList?: string }) => {
      calls.push(settings.networkBlockAll ? "blocked" : settings.domainAllowList ?? "open");
    },
    getSignedPreviewUrl: async () => ({ url: "https://preview.example.test" }),
    delete: async () => undefined,
    stop: async () => undefined,
  };
  const client: DaytonaClientLike = { v0: { create: async () => sandbox } };
  try {
    await writeFile(join(root, "package.json"), "{}");
    const session = await new DaytonaSandboxProvider({ apiKey: "test-key", client }).create({ projectPath: root });
    await session.run({ projectPath: ".", command: "npm install --ignore-scripts" });
    assert.deepEqual(calls, ["registry.npmjs.org", "blocked"]);
    await session.dispose();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
