import { DockerSandbox } from "./dockerSandbox.js";
import { DaytonaSandboxProvider } from "./daytonaSandbox.js";
import { createSandboxProvider, type SandboxCreateRequest, type SandboxProvider, type SandboxSession } from "./provider.js";
import type { SandboxRequest, SandboxResult } from "./types.js";
import type { ServerRuntime } from "../runtime/runtime.js";
import { MemorySandboxRegistry, PostgresSandboxRegistry, type SandboxRegistry } from "./registry.js";

interface RuntimeContext {
  projectId?: string;
  taskId?: string;
}

class DockerSandboxProvider implements SandboxProvider {
  readonly id = "docker";
  constructor(private readonly runtime?: ServerRuntime) {}

  async create(request: SandboxCreateRequest): Promise<SandboxSession> {
    const sandbox = new DockerSandbox(request.projectPath, undefined, this.runtime, { projectId: request.projectId, taskId: request.taskId });
    return {
      run: (command: SandboxRequest, signal?: AbortSignal) => sandbox.run(command, signal),
      getPreviewUrl: async () => { throw new Error("Docker sandbox does not provide hosted Preview URLs"); },
      dispose: async () => undefined,
    };
  }
}

let configuredProvider: SandboxProvider | undefined;
const sessions = new Map<string, Promise<SandboxSession>>();
const activeOperations = new Set<Promise<unknown>>();
let shuttingDown = false;
let shutdownPromise: Promise<void> | undefined;

function assertRunnerAvailable(): void {
  if (shuttingDown) throw new Error("Sandbox runner is shutting down");
}

function trackOperation<T>(operation: Promise<T>): Promise<T> {
  activeOperations.add(operation);
  void operation.then(
    () => activeOperations.delete(operation),
    () => activeOperations.delete(operation),
  );
  return operation;
}

/** Test-only provider injection; no HTTP route exposes this hook. */
export function setSandboxProviderForTests(provider: SandboxProvider): void {
  configuredProvider = provider;
}

let configuredRegistry: SandboxRegistry | undefined;

function getRegistry(): SandboxRegistry {
  if (!configuredRegistry) {
    configuredRegistry = process.env.NEXUM_DATABASE_URL?.trim()
      ? new PostgresSandboxRegistry()
      : new MemorySandboxRegistry((taskId) => sessions.has(`task:${taskId}`));
  }
  return configuredRegistry;
}

/** Test-only registry injection; no HTTP route exposes this hook. */
export function setSandboxRegistryForTests(registry: SandboxRegistry | undefined): void {
  configuredRegistry = registry;
}

function getProvider(runtime?: ServerRuntime, context: RuntimeContext = {}): SandboxProvider {
  if (configuredProvider) return configuredProvider;
  const docker = new DockerSandboxProvider(runtime);
  const apiKey = process.env.DAYTONA_API_KEY?.trim();
  // Daytona records each remote sandbox so a later process can delete orphans.
  const daytona = apiKey ? new DaytonaSandboxProvider({ apiKey, registry: getRegistry() }) : undefined;
  configuredProvider = createSandboxProvider({
    provider: process.env.NEXUM_SANDBOX_PROVIDER,
    nodeEnv: process.env.NODE_ENV,
    docker,
    daytona,
  });
  return configuredProvider;
}

/**
 * Whether the configured provider installs dependencies by itself before the
 * first command (Daytona does; the local Docker provider does not).
 */
export function sandboxInstallsDependencies(runtime?: ServerRuntime): boolean {
  try {
    return getProvider(runtime).id !== "docker";
  } catch {
    return true; // No provider configured: commands will fail anyway; do not add an install step.
  }
}

export interface OrphanReapResult { deleted: number; missing: number; failed: number; skipped: number }

/**
 * Deletes remote sandboxes left behind by API processes that died before
 * releasing them. Only sandboxes of the configured provider whose task has no
 * queued/running job are touched (see SandboxRegistry).
 */
export async function reapOrphanedSandboxes(runtime?: ServerRuntime): Promise<OrphanReapResult> {
  const result: OrphanReapResult = { deleted: 0, missing: 0, failed: 0, skipped: 0 };
  let provider: SandboxProvider;
  try {
    provider = getProvider(runtime);
  } catch {
    return result; // No sandbox provider configured: nothing can be cleaned up here.
  }
  const registry = getRegistry();
  for (const orphan of await registry.listOrphans()) {
    if (!provider.destroyById || orphan.provider !== provider.id) {
      result.skipped += 1;
      continue;
    }
    try {
      const outcome = await provider.destroyById(orphan.remoteId);
      await registry.release(orphan.remoteId, outcome === "deleted" ? "orphan-deleted" : "orphan-missing");
      result[outcome] += 1;
    } catch (error) {
      result.failed += 1;
      console.error("[Nexum] Failed to delete orphaned sandbox", { remoteId: orphan.remoteId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (result.deleted || result.missing || result.failed) console.info("[Nexum] Orphaned sandbox cleanup", result);
  return result;
}

function getSessionKey(context: RuntimeContext): string | undefined {
  return context.taskId ? `task:${context.taskId}` : undefined;
}

export function runInConfiguredSandbox(
  projectRoot: string,
  request: SandboxRequest,
  runtime?: ServerRuntime,
  context: RuntimeContext = {},
  signal?: AbortSignal,
): Promise<SandboxResult> {
  assertRunnerAvailable();
  return trackOperation(runInConfiguredSandboxInternal(projectRoot, request, runtime, context, signal));
}

async function runInConfiguredSandboxInternal(
  projectRoot: string,
  request: SandboxRequest,
  runtime?: ServerRuntime,
  context: RuntimeContext = {},
  signal?: AbortSignal,
): Promise<SandboxResult> {
  assertRunnerAvailable();
  const provider = getProvider(runtime, context);
  const key = getSessionKey(context);
  let session: SandboxSession;
  let disposeAfter = false;

  if (key) {
    let pending = sessions.get(key);
    if (!pending) {
      pending = provider.create({ projectPath: projectRoot, ...context }, signal);
      sessions.set(key, pending);
      void pending.catch(() => {
        if (sessions.get(key) === pending) sessions.delete(key);
      });
    }
    session = await pending;
    if (shuttingDown) {
      // disposeAllSandboxSessions owns the session after taking its snapshot.
      throw new Error("Sandbox runner is shutting down");
    }
  } else {
    session = await provider.create({ projectPath: projectRoot, ...context }, signal);
    disposeAfter = true;
    if (shuttingDown) {
      await session.dispose().catch((error) => {
        console.error("[Nexum] Failed to dispose sandbox created during shutdown", error);
      });
      throw new Error("Sandbox runner is shutting down");
    }
  }

  try {
    return await session.run(request, signal);
  } finally {
    if (disposeAfter) await session.dispose().catch((error) => {
      console.error("[Nexum] Failed to dispose one-shot sandbox", error);
    });
  }
}

export function releaseSandboxSession(taskId?: string): Promise<void> {
  if (!taskId) return Promise.resolve();
  return trackOperation(releaseSandboxSessionInternal(taskId));
}

async function releaseSandboxSessionInternal(taskId: string): Promise<void> {
  const key = `task:${taskId}`;
  const pending = sessions.get(key);
  if (!pending) return;
  sessions.delete(key);
  try {
    const session = await pending;
    await session.dispose();
  } catch (error) {
    console.error("[Nexum] Failed to release task sandbox", {
      taskId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function disposeAllSandboxSessions(): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  shutdownPromise = (async () => {
    const pending = [...sessions.entries()];
    sessions.clear();
    const sessionDisposals = pending.map(async ([key, sessionPromise]) => {
      try {
        await (await sessionPromise).dispose();
      } catch (error) {
        console.error("[Nexum] Failed to dispose sandbox during shutdown", {
          sessionKey: key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    // Includes one-shot creates/runs and task releases that may already have
    // removed their sessions from the map before shutdown took its snapshot.
    const operations = [...activeOperations];
    await Promise.allSettled([...sessionDisposals, ...operations]);
  })();
  return shutdownPromise;
}

/** Test-only reset hook; not exposed through an HTTP route. */
export async function resetSandboxRunnerForTests(): Promise<void> {
  const pending = [...sessions.values()];
  sessions.clear();
  await Promise.allSettled([
    ...pending.map(async (sessionPromise) => {
      try { await (await sessionPromise).dispose(); } catch { /* best-effort test cleanup */ }
    }),
    ...activeOperations,
  ]);
  configuredProvider = undefined;
  configuredRegistry = undefined;
  shuttingDown = false;
  shutdownPromise = undefined;
}
