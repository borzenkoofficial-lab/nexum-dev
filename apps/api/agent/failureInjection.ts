export type AgentFailure =
  | "MODEL_FAILURE"
  | "NETWORK_FAILURE"
  | "TOOL_FAILURE"
  | "TOOL_DELAY"
  | "TOOL_CHECKPOINT"
  | "VALIDATION_FAILURE"
  | "TIMEOUT"
  | "CANCELLATION"
  | "CORRUPTED_CHECKPOINT";

const ALLOWED = new Set<AgentFailure>([
  "MODEL_FAILURE","NETWORK_FAILURE","TOOL_FAILURE","TOOL_DELAY","TOOL_CHECKPOINT","VALIDATION_FAILURE",
  "TIMEOUT","CANCELLATION","CORRUPTED_CHECKPOINT",
]);

const active = process.env.NODE_ENV !== "production" && process.env.NEXUM_E2E_FAILURE_INJECTION === "true";
const initial = (process.env.NEXUM_AGENT_FAILURES ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter((value): value is AgentFailure => ALLOWED.has(value as AgentFailure));

const enabled = new Map<AgentFailure, { remaining?: number; projectId?: string }>(
  initial.map((name) => [name, {}]),
);

const events: Array<{ timestamp: number; name: AgentFailure; enabled: boolean; remaining?: number; projectId?: string; phase?: "enabled" | "consumed" | "released" }> = [];
const checkpointWaiters = new Map<string, Set<{ resolve: () => void; reject: (error: unknown) => void }>>();

function record(name: AgentFailure, on: boolean, remaining?: number, projectId?: string, phase?: "enabled" | "consumed" | "released") {
  events.push({ timestamp: Date.now(), name, enabled: on, ...(remaining === undefined ? {} : { remaining }), ...(projectId ? { projectId } : {}), ...(phase ? { phase } : {}) });
  if (events.length > 200) events.splice(0, events.length - 200);
}

export const agentFailureInjection = {
  active,
  enableFailure(name: AgentFailure, options: { times?: number; projectId?: string } = {}) {
    if (!active || !ALLOWED.has(name)) return;
    const times = Number.isFinite(options.times) && (options.times ?? 0) > 0 ? Math.floor(options.times!) : undefined;
    enabled.set(name, { ...(times === undefined ? {} : { remaining: times }), ...(options.projectId ? { projectId: options.projectId } : {}) });
    record(name, true, times, options.projectId, "enabled");
  },
  async waitForCheckpoint(name: AgentFailure, projectId?: string, signal?: AbortSignal): Promise<void> {
    const key = `${name}:${projectId ?? ""}`;
    const waiters = checkpointWaiters.get(key) ?? new Set();
    checkpointWaiters.set(key, waiters);
    record(name, true, undefined, projectId, "consumed");
    await new Promise<void>((resolve, reject) => {
      let wrapped: { resolve: () => void; reject: (error: unknown) => void };
      const abort = () => {
        waiters.delete(wrapped);
        if (waiters.size === 0) checkpointWaiters.delete(key);
        reject(new DOMException("Agent task cancelled", "AbortError"));
      };
      if (signal?.aborted) return abort();
      signal?.addEventListener("abort", abort, { once: true });
      wrapped = {
        resolve: () => {
          signal?.removeEventListener("abort", abort);
          waiters.delete(wrapped);
          if (waiters.size === 0) checkpointWaiters.delete(key);
          resolve();
        },
        reject: (error: unknown) => {
          signal?.removeEventListener("abort", abort);
          waiters.delete(wrapped);
          if (waiters.size === 0) checkpointWaiters.delete(key);
          reject(error);
        },
      };
      waiters.add(wrapped);
    });
  },
  releaseFailure(name: AgentFailure, projectId?: string) {
    if (!active) return;
    const entry = enabled.get(name);
    if (projectId && entry?.projectId && entry.projectId !== projectId) return;
    enabled.delete(name);
    for (const [key, waiters] of checkpointWaiters) {
      if (key === `${name}:${projectId ?? entry?.projectId ?? ""}`) {
        for (const waiter of [...waiters]) waiter.resolve();
        checkpointWaiters.delete(key);
      }
    }
    record(name, false, undefined, projectId ?? entry?.projectId, "released");
  },
  disableFailure(name: AgentFailure) {
    if (!active) return;
    const entry = enabled.get(name);
    enabled.delete(name);
    for (const [key, waiters] of checkpointWaiters) {
      if (key.startsWith(name + ":")) {
        for (const waiter of [...waiters]) waiter.resolve();
        checkpointWaiters.delete(key);
      }
    }
    record(name, false, undefined, entry?.projectId);
  },
  resetFailures() {
    if (!active) return;
    for (const name of [...enabled.keys()]) {
      for (const [key, waiters] of checkpointWaiters) {
        if (key.startsWith(`${name}:`)) {
          for (const waiter of [...waiters]) waiter.resolve();
          checkpointWaiters.delete(key);
        }
      }
      const entry = enabled.get(name);
      record(name, false, undefined, entry?.projectId, "released");
    }
    enabled.clear();
  },
  isEnabled(name: AgentFailure) {
    return active && enabled.has(name);
  },
  consumeFailure(name: AgentFailure, projectId?: string) {
    if (!active) return false;
    const entry = enabled.get(name);
    if (!entry) return false;
    if (entry.projectId && entry.projectId !== projectId) return false;
    if (entry.remaining === undefined) return true;
    if (entry.remaining <= 0) {
      enabled.delete(name);
      return false;
    }
    entry.remaining -= 1;
    if (entry.remaining === 0) enabled.delete(name);
    record(name, true, entry.remaining, entry.projectId, name === "TOOL_CHECKPOINT" ? "consumed" : undefined);
    return true;
  },
  list() {
    return active ? [...enabled.entries()].map(([name, options]) => ({ name, ...options })) : [];
  },
  diagnostics() {
    return [...events];
  },
};
