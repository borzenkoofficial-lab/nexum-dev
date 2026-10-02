
import type { RuntimeDiagnostic } from "./types.ts";
export class RuntimeDiagnostics {
 private events:RuntimeDiagnostic[]=[];
 record(input:Omit<RuntimeDiagnostic,"timestamp">){const e={...input,timestamp:Date.now()};this.events.push(e);if(this.events.length>1000)this.events.splice(0,this.events.length-1000);if(e.severity==="error"||e.severity==="fatal")console.error("[NEXUM Runtime]",e);return e}
 info(subsystem:string,message:string,context?:RuntimeDiagnostic["context"],payload?:unknown){return this.record({subsystem,message,severity:"info",type:"runtime",context,payload})}
 warn(subsystem:string,message:string,context?:RuntimeDiagnostic["context"],payload?:unknown){return this.record({subsystem,message,severity:"warn",type:"runtime",context,payload})}
 error(subsystem:string,message:string,error?:unknown,context?:RuntimeDiagnostic["context"],recoveryAction?:string){return this.record({subsystem,message,severity:"error",type:"runtime",context,error:error instanceof Error?error.message:String(error),recoveryAction})}
 list(){return [...this.events]}
 clear(){this.events=[]}
}
