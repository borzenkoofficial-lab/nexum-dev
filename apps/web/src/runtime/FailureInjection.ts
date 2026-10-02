import type { RuntimeContext } from "./types.ts";

export type FailureName =
  | "FAIL_NETWORK"
  | "FAIL_PREVIEW"
  | "FAIL_AGENT"
  | "FAIL_PROCESS"
  | "FAIL_STATE_RESTORE"
  | "DELAY_REQUEST"
  | "DELAY_TASK"
  | "FORCE_PREVIEW_RESTART"
  | "FORCE_PROCESS_UNHEALTHY"
  | "FORCE_VISUAL_CRITICAL"
  | "FORCE_VISUAL_NORMAL";

export interface FailureRecord extends RuntimeContext {
  scenario: FailureName;
  enabled: boolean;
  timestamp: number;
  details?: string;
}

const ALLOWED = new Set<FailureName>([
  "FAIL_NETWORK","FAIL_PREVIEW","FAIL_AGENT","FAIL_PROCESS",
  "FAIL_STATE_RESTORE","DELAY_REQUEST","DELAY_TASK",
  "FORCE_PREVIEW_RESTART","FORCE_PROCESS_UNHEALTHY","FORCE_VISUAL_CRITICAL","FORCE_VISUAL_NORMAL",
]);

class FailureInjection {
  private enabled = new Map<FailureName, { delayMs?: number }>();
  private records: FailureRecord[] = [];

  readonly active = import.meta.env.DEV || import.meta.env.VITE_E2E === "true";

  enableFailure(scenario: FailureName, options: { delayMs?: number; context?: RuntimeContext } = {}) {
    if (!this.active) throw new Error("Failure injection is disabled outside development/E2E.");
    if (!ALLOWED.has(scenario)) throw new Error("Unknown failure scenario: " + scenario);
    this.enabled.set(scenario, { delayMs: options.delayMs });
    this.record(scenario, true, options.context, options.delayMs ? "delay=" + options.delayMs : undefined);
  }

  disableFailure(scenario: FailureName, context?: RuntimeContext) {
    if (!this.active) return;
    this.enabled.delete(scenario);
    this.record(scenario, false, context);
  }

  resetFailures(context?: RuntimeContext) {
    if (!this.active) return;
    for (const scenario of [...this.enabled.keys()]) this.record(scenario, false, context);
    this.enabled.clear();
  }

  isEnabled(scenario: FailureName) { return this.active && this.enabled.has(scenario); }
  getDelay(scenario: FailureName, fallback = 0) { return this.enabled.get(scenario)?.delayMs ?? fallback; }
  list() { return [...this.enabled.entries()].map(([scenario, options]) => ({ scenario, ...options })); }
  diagnostics() { return this.records.slice(-200); }

  private record(scenario: FailureName, enabled: boolean, context?: RuntimeContext, details?: string) {
    this.records.push({ scenario, enabled, timestamp: Date.now(), ...context, ...(details ? { details } : {}) });
    if (this.records.length > 200) this.records.splice(0, this.records.length - 200);
  }
}

export const failureInjection = new FailureInjection();
