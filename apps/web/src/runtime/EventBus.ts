
import type { RuntimeEvent } from "./types";
type Handler=(event:RuntimeEvent)=>void;
export class RuntimeEventBus {
 private handlers=new Map<string,Set<Handler>>();
 on(type:string,handler:Handler){const set=this.handlers.get(type)??new Set<Handler>();set.add(handler);this.handlers.set(type,set);return()=>{set.delete(handler);if(!set.size)this.handlers.delete(type);};}
 once(type:string,handler:Handler){let off=()=>{};off=this.on(type,e=>{off();handler(e)});return off;}
 emit<T>(type:string,payload?:T,context?:RuntimeEvent["context"]){const e:RuntimeEvent<T>={type,timestamp:Date.now(),payload,context};for(const h of [...(this.handlers.get(type)??[]),...(this.handlers.get("*")??[])]){try{h(e)}catch{}}}
 clear(){this.handlers.clear()}
}
