import { RuntimeDiagnostics } from "./Diagnostics.ts";
import type { RuntimeContext } from "./types.ts";
import { failureInjection } from "./FailureInjection.ts";

export interface NetworkOptions extends RequestInit, RuntimeContext {
  timeoutMs?: number;
  retries?: number;
  dedupe?: boolean;
  retryBaseMs?: number;
}

interface ActiveRequest {
  controller: AbortController;
  projectId?: string;
  taskId?: string;
  startedAt: number;
  requestId: string;
  attempt: number;
}

export class NetworkManager {
  private inflight = new Map<string, Promise<Response>>();
  private active = new Map<string, ActiveRequest>();
  private online = typeof navigator === "undefined" ? true : navigator.onLine;
  private onOnline = () => { this.online = true; this.diagnostics.info("NETWORK", "Network online"); };
  private onOffline = () => { this.online = false; this.diagnostics.warn("NETWORK", "Network offline"); };
  private diagnostics: RuntimeDiagnostics;

  constructor(diagnostics: RuntimeDiagnostics) {
    this.diagnostics = diagnostics;
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onOnline);
      window.addEventListener("offline", this.onOffline);
    }
  }

  async fetch(input: RequestInfo | URL, options: NetworkOptions = {}): Promise<Response> {
    const {
      timeoutMs = 30000,
      retries = 2,
      dedupe = true,
      retryBaseMs = 250,
      projectId,
      taskId,
      operation,
      signal: callerSignal,
      ...init
    } = options;
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init.method ?? "GET").toUpperCase();
    const key = dedupe && method === "GET" ? `${projectId ?? "global"}:${url}` : "";

    if (callerSignal?.aborted) throw new DOMException("Request cancelled", "AbortError");
    if (key && this.inflight.has(key)) return this.inflight.get(key)!.then(r => r.clone());
    if (!this.online && /^https?:/i.test(url)) throw new Error("Network offline");

    const p = this.execute(input, init, timeoutMs, retries, retryBaseMs, { projectId, taskId, operation }, callerSignal ?? undefined);
    if (key) this.inflight.set(key, p);
    try {
      return await p;
    } finally {
      if (key) this.inflight.delete(key);
    }
  }

  private async execute(
    input: RequestInfo | URL,
    init: RequestInit,
    timeout: number,
    retries: number,
    base: number,
    context: RuntimeContext,
    callerSignal?: AbortSignal,
  ) {
    let last: unknown;
    const requestId = crypto.randomUUID();

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (callerSignal?.aborted) throw new DOMException("Request cancelled", "AbortError");

      const controller = new AbortController();
      const startedAt = Date.now();
      this.active.set(requestId, { controller, requestId, attempt, ...context, startedAt });

      const abortFromCaller = () => controller.abort();
      callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
      const timer = window.setTimeout(() => controller.abort(), timeout);

      try {
        this.diagnostics.info("NETWORK", "Request started", context, { requestId, attempt });

        const injectedDelay = failureInjection.getDelay("DELAY_REQUEST");
        if (injectedDelay > 0) {
          await this.delay(injectedDelay, controller.signal);
        }

        if (failureInjection.isEnabled("FAIL_NETWORK")) {
          last = new Error("Injected network failure");
          this.diagnostics.warn("NETWORK", "Injected network failure", context, { requestId, attempt });
          if (attempt === retries) throw last;
        } else {
          const injectedDelay = failureInjection.getDelay("DELAY_REQUEST");
          if (injectedDelay > 0) {
            await this.delay(injectedDelay, controller.signal);
          }
          const response = await window.fetch(input, { ...init, signal: controller.signal });
          if (response.ok || (![408, 425, 429].includes(response.status) && response.status < 500) || attempt === retries) {
            return response;
          }
          last = new Error("HTTP " + response.status);
        }
      } catch (e) {
        last = e;
        if (controller.signal.aborted && callerSignal?.aborted) throw e;
        if (attempt === retries) throw e;
      } finally {
        window.clearTimeout(timer);
        callerSignal?.removeEventListener("abort", abortFromCaller);
        this.active.delete(requestId);
      }

      await this.delay(base * Math.pow(2, attempt), callerSignal);
    }

    this.diagnostics.error("NETWORK", "Request exhausted retries", last, context, "bounded retry");
    throw last instanceof Error ? last : new Error(String(last));
  }

  private delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(resolve, ms);
      if (!signal) return;
      const abort = () => {
        window.clearTimeout(timer);
        reject(new DOMException("Request cancelled", "AbortError"));
      };
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    });
  }

  cancelTask(taskId: string) {
    for (const [id, request] of this.active) {
      if (request.taskId !== taskId) continue;
      request.controller.abort();
      this.active.delete(id);
      this.diagnostics.info("NETWORK", "Task requests cancelled", { taskId }, { requestId: request.requestId, attempt: request.attempt });
    }
  }

  cancelProject(projectId: string) {
    for (const [id, request] of this.active) {
      if (request.projectId !== projectId) continue;
      request.controller.abort();
      this.active.delete(id);
      this.diagnostics.info("NETWORK", "Project requests cancelled", { projectId }, { requestId: request.requestId, attempt: request.attempt });
    }
  }

  getActive() {
    return [...this.active.entries()].map(([id, request]) => ({
      id,
      requestId: request.requestId,
      attempt: request.attempt,
      projectId: request.projectId,
      taskId: request.taskId,
      startedAt: request.startedAt,
    }));
  }

  isOnline() { return this.online; }

  destroy() {
    for (const request of this.active.values()) request.controller.abort();
    this.active.clear();
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.onOnline);
      window.removeEventListener("offline", this.onOffline);
    }
  }
}
