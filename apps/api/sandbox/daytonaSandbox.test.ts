import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { test } from "node:test";
import { Readable } from "node:stream";
import { DaytonaSandboxProvider, collectWorkspaceFiles, type DaytonaClientLike } from "./daytonaSandbox.js";
import { disposeAllSandboxSessions, releaseSandboxSession, resetSandboxRunnerForTests, runInConfiguredSandbox, setSandboxProviderForTests } from "./runner.js";
import type { SandboxProvider, SandboxSession } from "./provider.js";
import { TestProjectTool } from "../agent/tools/testProject.js";
import { ProjectWorkspace } from "../agent/tools/workspace.js";

test("workspace staging excludes secrets, dependencies, build output and symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexum-daytona-stage-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await mkdir(join(root, ".git"), { recursive: true });
    await mkdir(join(root, ".docker"), { recursive: true });
    await writeFile(join(root, "src", "main.ts"), "export {};");
    await writeFile(join(root, ".env"), "SECRET=do-not-copy");
    await writeFile(join(root, "private.pem"), "PRIVATE KEY");
    await writeFile(join(root, "credentials.json"), "{}");
    await writeFile(join(root, ".docker", "config.json"), "{}");
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
  let deleteCalls = 0;
  let finishDelete: (() => void) | undefined;
  let markDeleteStarted: (() => void) | undefined;
  const deleteStarted = new Promise<void>((resolveDelete) => { markDeleteStarted = resolveDelete; });
  const sandbox = {
    id: "sandbox-123",
    process: {
      createSession: async (sessionId: string) => { calls.push("session:" + sessionId); },
      executeSessionCommand: async (_sessionId: string, request: { command: string }) => {
        calls.push("execute:" + request.command);
        return { exitCode: 0, stdout: request.command === "npm install --ignore-scripts" ? "installed" : request.command === "npm run build" ? "build ok" : "", stderr: "" };
      },
      deleteSession: async () => { calls.push("delete-session"); },
    },
    fs: {
      createFolder: async (path: string) => { calls.push("mkdir:" + path); },
      uploadFileStream: async (source: string, destination: string) => { uploaded.push({ source, destination }); calls.push("upload"); },
      listFiles: async () => [{ path: "/home/daytona/nexum-project/dist/index.html", size: 14 }],
      downloadFileStream: async () => Readable.from([Buffer.from("<h1>built</h1>")]),
    },
    getWorkDir: async () => "/home/daytona",
    setTtl: async () => undefined,
    setLabels: async () => ({}),
    updateNetworkSettings: async (settings: { networkBlockAll?: boolean; domainAllowList?: string }) => {
      calls.push("network:" + (settings.networkBlockAll ? "blocked" : settings.domainAllowList ?? "open"));
    },
    getSignedPreviewUrl: async () => ({ url: "https://preview.example.test/signed" }),
    delete: async () => {
      deleteCalls += 1;
      markDeleteStarted?.();
      await new Promise<void>((resolveDelete) => { finishDelete = resolveDelete; });
      calls.push("delete");
    },
    stop: async () => { calls.push("stop"); },
  };
  const client: DaytonaClientLike = {
    v0: {
      create: async (options) => {
        assert.equal(options.public, false);
        assert.equal(options.domainAllowList, "registry.npmjs.org");
        assert.equal(options.ttlMinutes, 30);
        calls.push("create");
        return sandbox;
      },
    },
  };
  try {
    await writeFile(join(root, "index.html"), "<h1>ok</h1>");
    await writeFile(join(root, "package.json"), "{}");
    const provider = new DaytonaSandboxProvider({ apiKey: "test-key", client });
    const session = await provider.create({ projectPath: root, projectId: "p1", taskId: "t1" });
    assert.equal(uploaded.length, 2);
    assert.equal(uploaded[0].destination, posix.join("/home/daytona", "nexum-project", "index.html"));
    const result = await session.run({ projectPath: ".", command: "npm run build", timeoutMs: 10_000 });
    assert.equal(result.success, true);
    assert.ok(calls.includes("execute:npm install --ignore-scripts"));
    assert.ok(calls.includes("execute:npm run build"));
    assert.match(result.stdout, /build ok/);
    assert.equal(await readFile(join(root, "dist", "index.html"), "utf8"), "<h1>built</h1>");
    assert.equal(await session.getPreviewUrl(4173, 120), "https://preview.example.test/signed");
    const firstDispose = session.dispose();
    const secondDispose = session.dispose();
    await deleteStarted;
    let secondDisposeFinished = false;
    void secondDispose.then(() => { secondDisposeFinished = true; });
    await Promise.resolve();
    assert.equal(secondDisposeFinished, false, "every dispose caller must await the same remote deletion");
    assert.equal(deleteCalls, 1, "concurrent disposal must delete the remote sandbox only once");
    finishDelete?.();
    await Promise.all([firstDispose, secondDispose]);
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
    fs: { createFolder: async () => undefined, uploadFileStream: async () => undefined, listFiles: async () => [], downloadFileStream: async () => Readable.from([]) },
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
      downloadFileStream: async () => Readable.from([]),
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
  let markStarted: (() => void) | undefined;
  const startedPromise = new Promise<void>((resolveStarted) => { markStarted = resolveStarted; });
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
        markStarted?.();
        return new Promise<never>(() => undefined);
      },
      deleteSession: async () => undefined,
    },
    fs: {
      createFolder: async () => undefined,
      uploadFileStream: async () => undefined,
      listFiles: async () => [],
      downloadFileStream: async () => Readable.from([]),
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
    await startedPromise;
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


function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function fakeSession(onDispose: () => Promise<void> | void = () => undefined): SandboxSession {
  return {
    run: async (request) => ({ success: true, exitCode: 0, stdout: request.command, stderr: "", durationMs: 1, command: request.command }),
    getPreviewUrl: async () => "https://preview.example.test",
    dispose: async () => { await onDispose(); },
  };
}

test("shutdown waits for an in-flight one-shot sandbox create and its cleanup", async () => {
  await resetSandboxRunnerForTests();
  const createGate = deferred<SandboxSession>();
  const disposeGate = deferred<void>();
  let disposeCalls = 0;
  const provider: SandboxProvider = { create: async () => createGate.promise };
  setSandboxProviderForTests(provider);
  const root = process.cwd();
  const operation = runInConfiguredSandbox(root, { projectPath: root, command: "npm run build" });
  let operationSettled = false;
  void operation.then(() => { operationSettled = true; }, () => { operationSettled = true; });
  const shutdown = disposeAllSandboxSessions();
  let shutdownSettled = false;
  void shutdown.then(() => { shutdownSettled = true; });
  await Promise.resolve();
  assert.equal(shutdownSettled, false, "shutdown must wait for sandbox creation already in progress");
  createGate.resolve(fakeSession(async () => { disposeCalls += 1; await disposeGate.promise; }));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(disposeCalls, 1);
  assert.equal(operationSettled, false, "the one-shot caller must await cleanup");
  assert.equal(shutdownSettled, false, "shutdown must await one-shot cleanup");
  disposeGate.resolve();
  await assert.rejects(operation, /shutting down/i);
  await shutdown;
  assert.equal(disposeCalls, 1);
  await resetSandboxRunnerForTests();
});

test("shutdown waits for a task-session release already in progress", async () => {
  await resetSandboxRunnerForTests();
  const createGate = deferred<SandboxSession>();
  let disposeCalls = 0;
  const provider: SandboxProvider = { create: async () => createGate.promise };
  setSandboxProviderForTests(provider);
  const root = process.cwd();
  const operation = runInConfiguredSandbox(root, { projectPath: root, command: "npm run build" }, undefined, { taskId: "shutdown-race-task" });
  const release = releaseSandboxSession("shutdown-race-task");
  let releaseSettled = false;
  void release.then(() => { releaseSettled = true; });
  const shutdown = disposeAllSandboxSessions();
  let shutdownSettled = false;
  void shutdown.then(() => { shutdownSettled = true; });
  createGate.resolve(fakeSession(() => { disposeCalls += 1; }));
  await assert.rejects(operation, /shutting down/i);
  await Promise.all([release, shutdown]);
  assert.equal(releaseSettled, true);
  assert.equal(shutdownSettled, true);
  assert.equal(disposeCalls, 1);
  await resetSandboxRunnerForTests();
});

test("sandbox runner rejects new work after shutdown begins", async () => {
  await resetSandboxRunnerForTests();
  await disposeAllSandboxSessions();
  let createCalls = 0;
  setSandboxProviderForTests({ create: async () => { createCalls += 1; return fakeSession(); } });
  assert.throws(
    () => runInConfiguredSandbox(process.cwd(), { projectPath: process.cwd(), command: "npm run build" }),
    /shutting down/i,
  );
  assert.equal(createCalls, 0);
  await resetSandboxRunnerForTests();
});


test("TestProject build-only fallback forwards the cancellation signal", async () => {
  await resetSandboxRunnerForTests();
  const root = await mkdtemp(join(tmpdir(), "nexum-test-project-cancel-"));
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  let disposeCalls = 0;
  setSandboxProviderForTests({
    create: async (_request, signal) => {
      receivedSignal = signal;
      return fakeSession(() => { disposeCalls += 1; });
    },
  });
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { build: "vite build" } }));
    const tool = new TestProjectTool(new ProjectWorkspace(root));
    const result = await tool.execute(".", controller.signal);
    assert.equal(result.success, true);
    assert.equal(receivedSignal, controller.signal);
    assert.equal(disposeCalls, 1);
  } finally {
    await resetSandboxRunnerForTests();
    await rm(root, { recursive: true, force: true });
  }
});
