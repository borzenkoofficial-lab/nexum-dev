
import { RuntimeDiagnostics } from "./Diagnostics"; import type { RuntimeContext } from "./types";
export interface NetworkOptions extends RequestInit,RuntimeContext { timeoutMs?:number;retries?:number;dedupe?:boolean;retryBaseMs?:number; }
export class NetworkManager {
 private inflight=new Map<string,Promise<Response>>();
 private online=typeof navigator==="undefined"?true:navigator.onLine;
 private onOnline=()=>this.online=true;private onOffline=()=>this.online=false;
 private diagnostics:RuntimeDiagnostics; constructor(diagnostics:RuntimeDiagnostics){this.diagnostics=diagnostics;if(typeof window!=="undefined"){window.addEventListener("online",this.onOnline);window.addEventListener("offline",this.onOffline)}}
 async fetch(input:RequestInfo|URL,options:NetworkOptions={}):Promise<Response>{const {timeoutMs=30000,retries=2,dedupe=true,retryBaseMs=250,projectId,taskId,operation,...init}=options;const url=typeof input==="string"?input:input instanceof URL?input.toString():input.url;const key=dedupe&&(init.method??"GET").toUpperCase()==="GET"?url:"";if(key&&this.inflight.has(key))return this.inflight.get(key)!.then(r=>r.clone());if(!this.online&&/^https?:/i.test(url))throw new Error("Network offline");const p=this.execute(input,init,timeoutMs,retries,retryBaseMs,{projectId,taskId,operation});if(key)this.inflight.set(key,p);try{return await p}finally{if(key)this.inflight.delete(key)}}
 private async execute(input:RequestInfo|URL,init:RequestInit,timeout:number,retries:number,base:number,context:RuntimeContext){let last:unknown;for(let attempt=0;attempt<=retries;attempt++){const c=new AbortController();const timer=window.setTimeout(()=>c.abort(),timeout);try{const r=await window.fetch(input,{...init,signal:c.signal});if(r.ok||(![408,425,429].includes(r.status)&&r.status<500)||attempt===retries)return r;last=new Error("HTTP "+r.status)}catch(e){last=e;if(attempt===retries)throw e}finally{window.clearTimeout(timer)}await new Promise(r=>window.setTimeout(r,base*Math.pow(2,attempt)))}this.diagnostics.error("NETWORK","Request exhausted retries",last,context);throw last instanceof Error?last:new Error(String(last))}
 destroy(){if(typeof window!=="undefined"){window.removeEventListener("online",this.onOnline);window.removeEventListener("offline",this.onOffline)}}
}
