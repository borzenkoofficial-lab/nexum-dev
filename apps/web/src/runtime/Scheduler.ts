
import { TaskManager,type TaskOptions } from "./TaskManager";
export class RuntimeScheduler {
 private active=0;private queue:Array<{priority:number;run:()=>void}>=[];
 private tasks:TaskManager; private concurrency:number; constructor(tasks:TaskManager,concurrency=4){this.tasks=tasks;this.concurrency=concurrency}
 schedule<T>(fn:(signal:AbortSignal,task:any)=>Promise<T>,options:TaskOptions={}):Promise<T>{return new Promise((resolve,reject)=>{this.queue.push({priority:options.priority??0,run:()=>{void this.tasks.run(fn,options).then(resolve,reject).finally(()=>{this.active--;this.drain()})}});this.queue.sort((a,b)=>b.priority-a.priority);this.drain()})}
 private drain(){while(this.active<this.concurrency&&this.queue.length){const j=this.queue.shift()!;this.active++;j.run()}}
 getActiveCount(){return this.active} getQueuedCount(){return this.queue.length}
}
