
import type { ResourceKind,ResourceRecord,RuntimeContext } from "./types.ts";
import { RuntimeEventBus } from "./EventBus.ts"; import { RuntimeDiagnostics } from "./Diagnostics.ts";
export class ResourceManager {
 private resources=new Map<string,ResourceRecord>();
 private bus:RuntimeEventBus; private diagnostics:RuntimeDiagnostics; constructor(bus:RuntimeEventBus,diagnostics:RuntimeDiagnostics){this.bus=bus;this.diagnostics=diagnostics}
 register(kind:ResourceKind,release:()=>void,context:RuntimeContext={}){const id=crypto.randomUUID();const r:ResourceRecord={id,kind,status:"CREATE",createdAt:Date.now(),release,...context};this.resources.set(id,r);r.status="ACTIVE";this.bus.emit("resource:created",r,context);return id}
 pause(id:string){const r=this.resources.get(id);if(r&&r.status==="ACTIVE")r.status="PAUSED"}
 activate(id:string){const r=this.resources.get(id);if(r&&r.status==="PAUSED")r.status="ACTIVE"}
 release(id:string){const r=this.resources.get(id);if(!r||r.status==="RELEASED")return;try{r.release()}catch(e){this.diagnostics.error("RESOURCE","Resource cleanup failed",e,r)}r.status="RELEASED";this.bus.emit("resource:released",r,r)}
 releaseByContext(projectId?:string,taskId?:string){for(const r of this.resources.values())if((!projectId||r.projectId===projectId)&&(!taskId||r.taskId===taskId))this.release(r.id)}
 snapshot(){return [...this.resources.values()].map(({release,...r})=>r)}
 releaseAll(){for(const id of [...this.resources.keys()])this.release(id)}
}
