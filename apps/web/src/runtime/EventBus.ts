import type { RuntimeEvent } from "./types.ts";
type Handler=(event:RuntimeEvent)=>void;
export class RuntimeEventBus {
 private handlers=new Map<string,Set<Handler>>(); private active=true; private emitting=false;
 on(type:string,handler:Handler){if(!this.active)return()=>{};const set=this.handlers.get(type)??new Set<Handler>();set.add(handler);this.handlers.set(type,set);return()=>{set.delete(handler);if(!set.size)this.handlers.delete(type);};}
 once(type:string,handler:Handler){let off=()=>{};off=this.on(type,e=>{off();handler(e)});return off;}
 emit<T>(type:string,payload?:T,context?:RuntimeEvent["context"]){if(!this.active||this.emitting)return;const e:RuntimeEvent<T>={type,timestamp:Date.now(),payload,context};this.emitting=true;try{for(const h of [...(this.handlers.get(type)??[]),...(this.handlers.get("*")??[])]){try{h(e)}catch{}}}finally{this.emitting=false}}
 clear(){this.handlers.clear()}
 close(){this.active=false;this.handlers.clear()}
 open(){this.active=true}
 isActive(){return this.active}
}
