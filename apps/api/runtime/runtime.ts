
import { randomUUID } from "node:crypto";
import type { ChildProcess } from "node:child_process";

export type RuntimeLifecycle="BOOTING"|"READY"|"BUSY"|"DEGRADED"|"RECOVERING"|"SHUTTING_DOWN";
export type TaskStatus="QUEUED"|"PLANNING"|"RUNNING"|"WAITING"|"VALIDATING"|"RECOVERING"|"COMPLETED"|"FAILED"|"CANCELLED";
export type ResourceKind="timer"|"process"|"worker"|"stream"|"request"|"subscription";
export interface RuntimeContext{projectId?:string;taskId?:string;agentJobId?:string;requestId?:string;planId?:string;operation?:string}
export interface RuntimeTask extends RuntimeContext{id:string;status:TaskStatus;parentTaskId?:string;children:string[];priority:number;progress:number;createdAt:number;startedAt?:number;completedAt?:number;timeoutMs?:number;retryCount:number;maxRetries:number;error?:string;checkpointId?:string}
export interface RuntimeDiagnostic extends RuntimeContext{timestamp:number;subsystem:string;severity:"info"|"warn"|"error"|"fatal";operation?:string;message:string;error?:string;recoveryAction?:string}
interface Resource extends RuntimeContext{id:string;kind:ResourceKind;release:()=>void;createdAt:number}
interface ProcessRecord extends RuntimeContext{id:string;name:string;child:ChildProcess;restart?:()=>Promise<ChildProcess>;state:"STARTING"|"HEALTHY"|"UNHEALTHY"|"RESTARTING"|"STOPPED"|"FAILED"}

const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
 QUEUED:["PLANNING","RUNNING","CANCELLED","FAILED"],PLANNING:["RUNNING","WAITING","CANCELLED","FAILED"],RUNNING:["WAITING","VALIDATING","RECOVERING","COMPLETED","FAILED","CANCELLED"],WAITING:["RUNNING","VALIDATING","RECOVERING","FAILED","CANCELLED"],VALIDATING:["COMPLETED","RECOVERING","FAILED","CANCELLED"],RECOVERING:["RUNNING","VALIDATING","FAILED","CANCELLED"],COMPLETED:[],FAILED:[],CANCELLED:[]
};
export class ServerRuntime{
 lifecycle:RuntimeLifecycle="BOOTING";
 readonly tasks=new Map<string,RuntimeTask>();
 readonly resources=new Map<string,Resource>();
 readonly processes=new Map<string,ProcessRecord>();
 readonly diagnostics:RuntimeDiagnostic[]=[];
 start(){this.lifecycle="READY";this.record("RUNTIME","info","Runtime ready");}
 setBusy(value=true){this.lifecycle=value?"BUSY":"READY"}
 createTask(context:RuntimeContext&{priority?:number;maxRetries?:number;timeoutMs?:number}={}):RuntimeTask{const t:RuntimeTask={id:randomUUID(),status:"QUEUED",children:[],priority:context.priority??0,progress:0,createdAt:Date.now(),retryCount:0,maxRetries:context.maxRetries??2,timeoutMs:context.timeoutMs,...context};this.tasks.set(t.id,t);this.record("TASK","info","Task created",context);return t}
 updateTask(id:string,status:TaskStatus,patch:Partial<RuntimeTask>={}){const t=this.tasks.get(id);if(!t)return;if(status!==t.status&&!TASK_TRANSITIONS[t.status].includes(status)){this.record("TASK","warn",`Invalid task transition ${t.status} -> ${status}`,t);return t;}Object.assign(t,patch,{status});if(status==="RUNNING"&&!t.startedAt)t.startedAt=Date.now();if(["COMPLETED","FAILED","CANCELLED"].includes(status))t.completedAt=Date.now();return t}
 registerResource(kind:ResourceKind,release:()=>void,context:RuntimeContext={}):string{const id=randomUUID();this.resources.set(id,{id,kind,release,createdAt:Date.now(),...context});return id}
 releaseResource(id:string){const r=this.resources.get(id);if(!r)return;try{r.release()}catch(e){this.record("RESOURCE","error","Resource release failed",r,e)}this.resources.delete(id)}
 registerProcess(name:string,child:ChildProcess,context:RuntimeContext={},restart?:()=>Promise<ChildProcess>){const id=randomUUID();const p:ProcessRecord={id,name,child,state:"STARTING",restart,...context};this.processes.set(id,p);this.record("PROCESS","info","Process registered",{...context,operation:name});child.once("spawn",()=>{p.state="HEALTHY";this.record("PROCESS","info","Process healthy",{...context,operation:name});});child.once("exit",(code,signal)=>{if(p.state==="STOPPED")return;if(code===0){p.state="STOPPED";this.record("PROCESS","info","Process exited normally",{...context,operation:name});}else{p.state="FAILED";this.record("PROCESS","error","Process exited unexpectedly",{...context,operation:name},new Error(`exit=${code ?? "null"} signal=${signal ?? "none"}`),"no automatic restart for side-effectful command");}this.processes.delete(id)});return id}
 completeProcess(id:string){const p=this.processes.get(id);if(!p)return false;p.state="STOPPED";this.processes.delete(id);return true}
 failProcess(id:string,error:unknown){const p=this.processes.get(id);if(!p)return false;p.state="FAILED";this.record("PROCESS","error","Process failed",{...p,operation:p.name},error);this.processes.delete(id);return true}
 async restartProcess(id:string){const p=this.processes.get(id);if(!p?.restart)return false;p.state="RESTARTING";try{p.child.kill("SIGTERM")}catch{};p.child=await p.restart();p.state="HEALTHY";return true}
 stopProcess(id:string){const p=this.processes.get(id);if(!p)return; p.state="STOPPED"; this.processes.delete(id); try{p.child.kill("SIGTERM")}catch{} }
 cancelTask(id:string){const t=this.tasks.get(id);if(!t||["COMPLETED","FAILED","CANCELLED"].includes(t.status))return false;this.updateTask(id,"CANCELLED",{error:"Cancelled"});for(const [resourceId,r] of this.resources)if(r.taskId===id)this.releaseResource(resourceId);for(const [processId,p] of this.processes)if(p.taskId===id)this.stopProcess(processId);return true}
 listTasks(){return [...this.tasks.values()]}
 listResources(){return [...this.resources.values()].map(({release,...r})=>r)}
 cancelProject(projectId:string){for(const t of this.tasks.values())if(t.projectId===projectId&&!["COMPLETED","FAILED","CANCELLED"].includes(t.status))this.cancelTask(t.id);for(const [id,r] of this.resources)if(r.projectId===projectId)this.releaseResource(id)}
 record(subsystem:string,severity:RuntimeDiagnostic["severity"],message:string,context:RuntimeContext={},error?:unknown,recoveryAction?:string){const e:RuntimeDiagnostic={timestamp:Date.now(),subsystem,severity,message,...context,...(error?{error:error instanceof Error?error.message:String(error)}:{}),...(recoveryAction?{recoveryAction}: {})};this.diagnostics.push(e);if(this.diagnostics.length>2000)this.diagnostics.splice(0,this.diagnostics.length-2000);if(severity==="error"||severity==="fatal")console.error("[NEXUM Runtime]",e);return e}
 shutdown(){this.lifecycle="SHUTTING_DOWN";for(const id of [...this.resources.keys()])this.releaseResource(id);for(const id of [...this.processes.keys()])this.stopProcess(id);for(const t of this.tasks.values())if(!["COMPLETED","FAILED","CANCELLED"].includes(t.status))this.updateTask(t.id,"CANCELLED",{error:"Runtime shutdown"});this.lifecycle="SHUTTING_DOWN"}
}
export const serverRuntime=new ServerRuntime();
