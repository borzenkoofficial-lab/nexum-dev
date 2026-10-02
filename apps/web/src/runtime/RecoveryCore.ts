
import { RuntimeDiagnostics } from "./Diagnostics";
export type RecoveryClass="TRANSIENT"|"RECOVERABLE"|"RESOURCE"|"NETWORK"|"PROCESS"|"STATE"|"CODE"|"USER"|"FATAL";
export class RecoveryCore{
 private diagnostics:RuntimeDiagnostics; constructor(diagnostics:RuntimeDiagnostics){this.diagnostics=diagnostics}
 classify(error:unknown):RecoveryClass{const m=error instanceof Error?error.message:String(error);if(/abort|cancel/i.test(m))return"USER";if(/network|fetch|offline|timeout|429|5\\d\\d/i.test(m))return"NETWORK";if(/worker|process|preview/i.test(m))return"PROCESS";if(/state|snapshot/i.test(m))return"STATE";if(/memory|resource|quota/i.test(m))return"RESOURCE";if(/syntax|type|compile|build/i.test(m))return"CODE";return"RECOVERABLE"}
 async execute<T>(operation:()=>Promise<T>,maxRetries=2,context?:{projectId?:string;taskId?:string}):Promise<T>{let last:unknown;for(let i=0;i<=maxRetries;i++){try{return await operation()}catch(e){last=e;if(i===maxRetries)break;const kind=this.classify(e);if(kind==="USER"||kind==="FATAL"||kind==="CODE")break;this.diagnostics.warn("RECOVERY","Bounded recovery attempt "+(i+1)+"/"+maxRetries,context,{kind});await new Promise(r=>setTimeout(r,250*Math.pow(2,i)))}}throw last instanceof Error?last:new Error(String(last))}
}
