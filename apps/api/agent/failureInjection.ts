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

const enabled = new Map<AgentFailure, { remaining?: number }>(
  initial.map((name) => [name, {}]),
);

const events: Array<{ timestamp: number; name: AgentFailure; enabled: boolean; remaining?: number; phase?: "enabled" | "consumed" | "released" }> = [];
const checkpointWaiters = new Map<AgentFailure, Set<{ resolve: () => void; reject: (error: unknown) => void }>>();

function record(name: AgentFailure, on: boolean, remaining?: number, phase?: "enabled" | "consumed" | "released") {
  events.push({ timestamp: Date.now(), name, enabled: on, ...(remaining === undefined ? {} : { remaining }), ...(phase ? { phase } : {}) });
  if (events.length > 200) events.splice(0, events.length - 200);
}

export const agentFailureInjection = {
  active,
  enableFailure(name: AgentFailure, options: { times?: number } = {}) {
    if (!active || !ALLOWED.has(name)) return;
    const times = Number.isFinite(options.times) && (options.times ?? 0) > 0 ? Math.floor(options.times!) : undefined;
    enabled.set(name, times === undefined ? {} : { remaining: times });
    record(name, true, times, "enabled");
  },
  async waitForCheckpoint(name: AgentFailure, signal?: AbortSignal): Promise<void> {
    const waiters = checkpointWaiters.get(name) ?? new Set();
    checkpointWaiters.set(name, waiters);
    record(name, true, undefined, "consumed");
    await new Promise<void>((resolve, reject) => {
      let wrapped: { resolve: () => void; reject: (error: unknown) => void };
      const abort = () => {
        waiters.delete(wrapped);
        if (waiters.size === 0) checkpointWaiters.delete(name);
        reject(new DOMException("Agent task cancelled", "AbortError"));
      };
      if (signal?.aborted) return abort();
      signal?.addEventListener("abort", abort, { once: true });
      wrapped = {
        resolve: () => {
          signal?.removeEventListener("abort", abort);
          waiters.delete(wrapped);
          if (waiters.size === 0) checkpointWaiters.delete(name);
          resolve();
        },
        reject: (error: unknown) => {
          signal?.removeEventListener("abort", abort);
          waiters.delete(wrapped);
          if (waiters.size === 0) checkpointWaiters.delete(name);
          reject(error);
        },
      };
      waiters.add(wrapped);
    });
  },
  releaseFailure(name: AgentFailure) {
    if (!active) return;
    enabled.delete(name);
    const waiters = checkpointWaiters.get(name);
    if (waiters) for (const waiter of [...waiters]) waiter.resolve();
    checkpointWaiters.delete(name);
    record(name, false, undefined, "released");
  },
  disableFailure(name: AgentFailure) {
    if (!active) return;
    enabled.delete(name);
    record(name, false);
  },
  resetFailures() {
    if (!active) return;
    for (const name of [...enabled.keys()]) {
      const waiters = checkpointWaiters.get(name);
      if (waiters) for (const waiter of [...waiters]) waiter.resolve();
      checkpointWaiters.delete(name);
      record(name, false, undefined, "released");
    }
    enabled.clear();
  },
  isEnabled(name: AgentFailure) {
    return active && enabled.has(name);
  },
  consumeFailure(name: AgentFailure) {
    if (!active) return false;
    const entry = enabled.get(name);
    if (!entry) return false;
    if (entry.remaining === undefined) return true;
    if (entry.remaining <= 0) {
      enabled.delete(name);
      return false;
    }
    entry.remaining -= 1;
    if (entry.remaining === 0) enabled.delete(name);
    record(name, true, entry.remaining, name === "TOOL_CHECKPOINT" ? "consumed" : undefined);
    return true;
  },
  list() {
    return active ? [...enabled.entries()].map(([name, options]) => ({ name, ...options })) : [];
  },
  diagnostics() {
    return [...events];
  },
};
