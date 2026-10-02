
import type { TaskRecord,TaskStatus,RuntimeContext } from "./types.ts"; import { RuntimeEventBus } from "./EventBus.ts"; import { RuntimeDiagnostics } from "./Diagnostics.ts";
import { failureInjection } from "./FailureInjection.ts";
export interface TaskOptions extends RuntimeContext { parentTaskId?:string;priority?:number;timeoutMs?:number;maxRetries?:number;dependencies?:string[]; }
type InternalTask=TaskRecord;
export class TaskManager {
 private tasks=new Map<string,InternalTask>();
 private bus:RuntimeEventBus; private diagnostics:RuntimeDiagnostics; private controllers=new Map<string,AbortController>(); private cleanupHooks=new Map<string,Array<()=>void>>(); constructor(bus:RuntimeEventBus,diagnostics:RuntimeDiagnostics){this.bus=bus;this.diagnostics=diagnostics}
 create(options:TaskOptions={}):TaskRecord{const c=new AbortController();const id=crypto.randomUUID();const t:InternalTask={id,status:"QUEUED",childTaskIds:[],priority:options.priority??0,progress:0,createdAt:Date.now(),retryCount:0,maxRetries:options.maxRetries??2,dependencies:options.dependencies??[],cancel:()=>c.abort(),...options};this.controllers.set(id,c);this.tasks.set(id,t);this.bus.emit("task:created",t,t);return t}
 controller(id:string){return this.controllers.get(id)?.signal}
 onCancel(id:string,cleanup:()=>void){const list=this.cleanupHooks.get(id)??[];list.push(cleanup);this.cleanupHooks.set(id,list);return()=>{const current=this.cleanupHooks.get(id)??[];this.cleanupHooks.set(id,current.filter(fn=>fn!==cleanup))}}
 private runCleanup(id:string){for(const fn of this.cleanupHooks.get(id)??[]){try{fn()}catch(e){this.diagnostics.error("TASK","Cancellation cleanup failed",e,{taskId:id})}}this.cleanupHooks.delete(id)}
 update(id:string,status:TaskStatus,patch:Partial<TaskRecord>={}){const t=this.tasks.get(id);if(!t)return;Object.assign(t,patch,{status});if(status==="RUNNING"&&!t.startedAt)t.startedAt=Date.now();if(status==="COMPLETED"||status==="FAILED"||status==="CANCELLED")t.completedAt=Date.now();this.bus.emit("task:"+status.toLowerCase(),t,t);return t}
 get(id:string){return this.tasks.get(id)}
 list(){return [...this.tasks.values()]}
 async run<T>(fn:(signal:AbortSignal,task:TaskRecord)=>Promise<T>,options:TaskOptions={}):Promise<T>{const t=this.create(options);this.update(t.id,"PLANNING");try{if(t.dependencies.some(id=>this.tasks.get(id)?.status!=="COMPLETED"))throw new Error("Task dependency is not completed");this.update(t.id,"RUNNING");const injectedDelay=failureInjection.getDelay("DELAY_TASK");if(injectedDelay>0)await new Promise(resolve=>window.setTimeout(resolve,injectedDelay));if(this.controllers.get(t.id)?.signal.aborted)throw new DOMException("Task cancelled","AbortError");const timer=t.timeoutMs?window.setTimeout(()=>t.cancel(),t.timeoutMs):undefined;try{const result=await fn(this.controllers.get(t.id)!.signal,t);this.update(t.id,"VALIDATING",{progress:1});this.update(t.id,"COMPLETED",{progress:1});return result}finally{if(timer)window.clearTimeout(timer);this.runCleanup(t.id)}}catch(e){if(this.controllers.get(t.id)?.signal.aborted){this.update(t.id,"CANCELLED",{error:"Cancelled"});this.diagnostics.warn("TASK","Task cancelled",t)}else{this.update(t.id,"FAILED",{error:e instanceof Error?e.message:String(e)});this.diagnostics.error("TASK","Task failed",e,t,"bounded recovery")}throw e}}
 cancel(id:string){const t=this.tasks.get(id);if(!t)return;t.cancel();this.runCleanup(id);this.update(id,"CANCELLED",{error:"Cancelled by user"})}
 cancelByProject(projectId:string){for(const t of this.tasks.values())if(t.projectId===projectId&&!["COMPLETED","FAILED","CANCELLED"].includes(t.status))this.cancel(t.id)}
}
