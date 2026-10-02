import { RuntimeDiagnostics } from "./Diagnostics.ts";
import type { RuntimeContext } from "./types.ts";

export interface NetworkOptions extends RequestInit, RuntimeContext {
  timeoutMs?: number; retries?: number; dedupe?: boolean; retryBaseMs?: number;
}
interface ActiveRequest { controller: AbortController; projectId?: string; taskId?: string; startedAt:number; }

export class NetworkManager {
  private inflight = new Map<string, Promise<Response>>();
  private active = new Map<string, ActiveRequest>();
  private online = typeof navigator === "undefined" ? true : navigator.onLine;
  private onOnline = () => { this.online = true; this.diagnostics.info("NETWORK","Network online"); };
  private onOffline = () => { this.online = false; this.diagnostics.warn("NETWORK","Network offline"); };
  private diagnostics: RuntimeDiagnostics;
  constructor(diagnostics: RuntimeDiagnostics) {
    this.diagnostics = diagnostics;
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onOnline);
      window.addEventListener("offline", this.onOffline);
    }
  }

  async fetch(input: RequestInfo | URL, options: NetworkOptions = {}): Promise<Response> {
    const { timeoutMs=30000, retries=2, dedupe=true, retryBaseMs=250, projectId, taskId, operation, signal: callerSignal, ...init } = options;
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init.method ?? "GET").toUpperCase();
    const key = dedupe && method === "GET" ? `${projectId ?? "global"}:${url}` : "";
    if (callerSignal?.aborted) throw new DOMException("Request cancelled","AbortError");
    if (key && this.inflight.has(key)) return this.inflight.get(key)!.then(r => r.clone());
    if (!this.online && /^https?:/i.test(url)) throw new Error("Network offline");

    const p = this.execute(input, init, timeoutMs, retries, retryBaseMs, {projectId,taskId,operation}, callerSignal ?? undefined);
    if (key) this.inflight.set(key, p);
    try { return await p; }
    finally { if (key) this.inflight.delete(key); }
  }

  private async execute(input: RequestInfo | URL, init: RequestInit, timeout:number, retries:number, base:number, context:RuntimeContext, callerSignal?:AbortSignal) {
    let last: unknown;
    for (let attempt=0; attempt<=retries; attempt++) {
      if (callerSignal?.aborted) throw new DOMException("Request cancelled","AbortError");
      const controller = new AbortController();
      const requestId = crypto.randomUUID();
      const startedAt = Date.now();
      this.active.set(requestId,{controller,...context,startedAt});
      const abortFromCaller = () => controller.abort();
      callerSignal?.addEventListener("abort", abortFromCaller, {once:true});
      const timer = window.setTimeout(() => controller.abort(), timeout);
      try {
        this.diagnostics.info("NETWORK","Request started",{...context}, {requestId,attempt});
        const response = await window.fetch(input,{...init,signal:controller.signal});
        if (response.ok || (![408,425,429].includes(response.status) && response.status < 500) || attempt === retries) {
          return response;
        }
        last = new Error("HTTP "+response.status);
      } catch (e) {
        last = e;
        if (controller.signal.aborted && callerSignal?.aborted) throw e;
        if (attempt === retries) throw e;
      } finally {
        window.clearTimeout(timer);
        callerSignal?.removeEventListener("abort", abortFromCaller);
        this.active.delete(requestId);
      }
      await new Promise<void>((resolve,reject) => {
        const t = window.setTimeout(resolve,base*Math.pow(2,attempt));
        if (callerSignal) callerSignal.addEventListener("abort",()=>{window.clearTimeout(t);reject(new DOMException("Request cancelled","AbortError"))},{once:true});
      });
    }
    this.diagnostics.error("NETWORK","Request exhausted retries",last,context);
    throw last instanceof Error ? last : new Error(String(last));
  }

  cancelTask(taskId:string) {
    for (const [id,r] of this.active) if (r.taskId===taskId) {
      r.controller.abort(); this.active.delete(id);
      this.diagnostics.info("NETWORK","Task requests cancelled",{taskId});
    }
  }
  cancelProject(projectId:string) {
    for (const [id,r] of this.active) if (r.projectId===projectId) { r.controller.abort(); this.active.delete(id); }
  }
  getActive(){ return [...this.active.entries()].map(([id,r])=>({id,projectId:r.projectId,taskId:r.taskId,startedAt:r.startedAt})); }
  isOnline(){return this.online;}
  destroy(){
    for (const r of this.active.values()) r.controller.abort();
    this.active.clear();
    if(typeof window!=="undefined"){window.removeEventListener("online",this.onOnline);window.removeEventListener("offline",this.onOffline)}
  }
}
