import { DockerSandbox } from "./dockerSandbox.js";
import { DaytonaSandboxProvider } from "./daytonaSandbox.js";
import { createSandboxProvider, type SandboxCreateRequest, type SandboxProvider, type SandboxSession } from "./provider.js";
import type { SandboxRequest, SandboxResult } from "./types.js";
import type { ServerRuntime } from "../runtime/runtime.js";

interface RuntimeContext {
  projectId?: string;
  taskId?: string;
}

class DockerSandboxProvider implements SandboxProvider {
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

function getProvider(runtime?: ServerRuntime, context: RuntimeContext = {}): SandboxProvider {
  if (configuredProvider) return configuredProvider;
  const docker = new DockerSandboxProvider(runtime);
  const apiKey = process.env.DAYTONA_API_KEY?.trim();
  const daytona = apiKey ? new DaytonaSandboxProvider({ apiKey }) : undefined;
  configuredProvider = createSandboxProvider({
    provider: process.env.NEXUM_SANDBOX_PROVIDER,
    nodeEnv: process.env.NODE_ENV,
    docker,
    daytona,
  });
  return configuredProvider;
}

function getSessionKey(context: RuntimeContext): string | undefined {
  return context.taskId ? `task:${context.taskId}` : undefined;
}

export async function runInConfiguredSandbox(
  projectRoot: string,
  request: SandboxRequest,
  runtime?: ServerRuntime,
  context: RuntimeContext = {},
  signal?: AbortSignal,
): Promise<SandboxResult> {
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
  } else {
    session = await provider.create({ projectPath: projectRoot, ...context }, signal);
    disposeAfter = true;
  }

  try {
    return await session.run(request, signal);
  } finally {
    if (disposeAfter) await session.dispose().catch((error) => {
      console.error("[Nexum] Failed to dispose one-shot sandbox", error);
    });
  }
}

export async function releaseSandboxSession(taskId?: string): Promise<void> {
  if (!taskId) return;
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

/** Test-only reset hook; not exposed through an HTTP route. */
export async function resetSandboxRunnerForTests(): Promise<void> {
  const pending = [...sessions.values()];
  sessions.clear();
  configuredProvider = undefined;
  await Promise.all(pending.map(async (sessionPromise) => {
    try { await (await sessionPromise).dispose(); } catch { /* best-effort test cleanup */ }
  }));
}
