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

test("Daytona provider provisions private registry-restricted sandbox, executes and disposes", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexum-daytona-run-"));
  const calls: string[] = [];
  let uploaded: Array<{ source: string; destination: string }> = [];
  const sandbox = {
    id: "sandbox-123",
    process: {
      createSession: async (sessionId: string) => { calls.push("session:" + sessionId); },
      executeSessionCommand: async (_sessionId: string, request: { command: string }) => {
        calls.push("execute:" + request.command);
        return { exitCode: 0, stdout: request.command.startsWith("npm") ? "build ok" : "", stderr: "" };
      },
      deleteSession: async () => { calls.push("delete-session"); },
    },
    fs: {
      createFolder: async (path: string) => { calls.push("mkdir:" + path); },
      uploadFileStream: async (source: string, destination: string) => { uploaded.push({ source, destination }); calls.push("upload"); },
      listFiles: async () => [{ path: "/home/daytona/nexum-project/dist/index.html", size: 14 }],
      downloadFile: async (_remotePath: string, localPath: string) => { await writeFile(localPath, "<h1>built</h1>"); },
    },
    getWorkDir: async () => "/home/daytona",
    setTtl: async () => undefined,
    setLabels: async () => ({}),
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
        assert.equal(options.domainAllowList, "registry.npmjs.org");
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
    assert.ok(calls.includes("execute:npm install --ignore-scripts"));
    assert.ok(calls.includes("execute:npm run build"));
    assert.equal(result.stdout, "build ok");
    assert.equal(await readFile(join(root, "dist", "index.html"), "utf8"), "<h1>built</h1>");
    assert.equal(await session.getPreviewUrl(4173, 120), "https://preview.example.test/signed");
    await session.dispose();
    assert.ok(calls.includes("delete"));
    assert.ok(calls.includes("delete-session"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Daytona provider rejects missing credentials before creating a sandbox", async () => {
  let created = false;
  const client: DaytonaClientLike = { v0: { create: async () => { created = true; throw new Error("unexpected"); } } };
  assert.throws(() => new DaytonaSandboxProvider({ apiKey: "", client }), /DAYTONA_API_KEY/);
  assert.equal(created, false);
});

test("Daytona sandbox outbound network is restricted to the npm registry", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexum-daytona-network-"));
  let domainAllowList: string | undefined;
  const sandbox = {
    id: "sandbox-123",
    process: {
      createSession: async () => undefined,
      executeSessionCommand: async (_sessionId: string, request: { command: string }) => ({
        exitCode: 0, stdout: request.command.startsWith("npm") ? "installed" : "", stderr: "",
      }),
      deleteSession: async () => undefined,
    },
    fs: { createFolder: async () => undefined, uploadFileStream: async () => undefined, listFiles: async () => [], downloadFile: async () => undefined },
    getWorkDir: async () => "/home/daytona",
    setTtl: async () => undefined,
    setLabels: async () => ({}),
    getSignedPreviewUrl: async () => ({ url: "https://preview.example.test" }),
    delete: async () => undefined,
    stop: async () => undefined,
  };
  const client: DaytonaClientLike = { v0: { create: async (options) => { domainAllowList = String(options.domainAllowList ?? ""); return sandbox; } } };
  try {
    await writeFile(join(root, "package.json"), "{}");
    const session = await new DaytonaSandboxProvider({ apiKey: "test-key", client }).create({ projectPath: root });
    await session.run({ projectPath: ".", command: "npm install --ignore-scripts" });
    assert.equal(domainAllowList, "registry.npmjs.org");
    await session.dispose();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("command failures retain stdout/stderr and return a failed sandbox result", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexum-daytona-failure-"));
  const sandbox = {
    id: "sandbox-failure",
    process: {
      createSession: async () => undefined,
      executeSessionCommand: async (_sessionId: string, request: { command: string }) => {
        if (request.command.startsWith("cd ") || request.command === "npm install --ignore-scripts") {
          return { exitCode: 0, stdout: "installed", stderr: "" };
        }
        return { exitCode: 2, stdout: "partial output", stderr: "build failed" };
      },
      deleteSession: async () => undefined,
    },
    fs: {
      createFolder: async () => undefined,
      uploadFileStream: async () => undefined,
      listFiles: async () => [],
      downloadFile: async () => undefined,
    },
    getWorkDir: async () => "/home/daytona",
    setTtl: async () => undefined,
    setLabels: async () => ({}),
    updateNetworkSettings: async () => undefined,
    getSignedPreviewUrl: async () => ({ url: "https://preview.example.test" }),
    delete: async () => undefined,
    stop: async () => undefined,
  };
  const client: DaytonaClientLike = { v0: { create: async () => sandbox } };
  try {
    await writeFile(join(root, "package.json"), "{}");
    const session = await new DaytonaSandboxProvider({ apiKey: "test-key", client }).create({ projectPath: root });
    const result = await session.run({ projectPath: ".", command: "npm run build" });
    assert.equal(result.success, false);
    assert.equal(result.exitCode, 2);
    assert.match(result.stdout, /partial output/);
    assert.match(result.stderr, /build failed/);
    await session.dispose();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("abort signal stops the remote sandbox command", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexum-daytona-abort-"));
  let started = false;
  let stopped = false;
  let deleted = false;
  const sandbox = {
    id: "sandbox-abort",
    process: {
      createSession: async () => undefined,
      executeSessionCommand: async (_sessionId: string, request: { command: string }) => {
        if (request.command.startsWith("cd ") || request.command === "npm install --ignore-scripts") {
          return { exitCode: 0, stdout: "", stderr: "" };
        }
        started = true;
        return new Promise<never>(() => undefined);
      },
      deleteSession: async () => undefined,
    },
    fs: {
      createFolder: async () => undefined,
      uploadFileStream: async () => undefined,
      listFiles: async () => [],
      downloadFile: async () => undefined,
    },
    getWorkDir: async () => "/home/daytona",
    setTtl: async () => undefined,
    setLabels: async () => ({}),
    updateNetworkSettings: async () => undefined,
    getSignedPreviewUrl: async () => ({ url: "https://preview.example.test" }),
    delete: async () => { deleted = true; },
    stop: async () => { stopped = true; },
  };
  const client: DaytonaClientLike = { v0: { create: async () => sandbox } };
  try {
    await writeFile(join(root, "package.json"), "{}");
    const session = await new DaytonaSandboxProvider({ apiKey: "test-key", client }).create({ projectPath: root });
    const controller = new AbortController();
    const pending = session.run({ projectPath: ".", command: "npm run build" }, controller.signal);
    await Promise.resolve();
    assert.equal(started, true);
    controller.abort();
    const result = await pending;
    assert.equal(result.success, false);
    assert.match(result.error ?? "", /cancelled/i);
    assert.equal(stopped, true);
    await session.dispose();
    assert.equal(deleted, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
