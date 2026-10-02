
import { RuntimeEventBus } from "./EventBus.ts"; import { RuntimeDiagnostics } from "./Diagnostics.ts";
type State="START"|"HEALTHY"|"UNHEALTHY"|"RESTARTING"|"STOPPED"|"FAILED";
interface Process{ id:string;name:string;state:State;projectId?:string;stop:()=>void;restart?:()=>Promise<void>;health?:()=>Promise<boolean> }
export class ProcessSupervisor{
 private processes=new Map<string,Process>();private timers=new Map<string,number>();
 private bus:RuntimeEventBus; private diagnostics:RuntimeDiagnostics; constructor(bus:RuntimeEventBus,diagnostics:RuntimeDiagnostics){this.bus=bus;this.diagnostics=diagnostics}
 register(input:Omit<Process,"state">){const p={...input,state:"START" as State};this.processes.set(p.id,p);this.bus.emit("process:started",p,p);return()=>this.stop(p.id)}
 async check(id:string){const p=this.processes.get(id);if(!p?.health)return true;try{const ok=await p.health();p.state=ok?"HEALTHY":"UNHEALTHY";if(!ok)await this.recover(p);return ok}catch(e){p.state="UNHEALTHY";this.diagnostics.error("PROCESS","Health check failed: "+p.name,e,p);await this.recover(p);return false}}
 private async recover(p:Process){if(!p.restart){p.state="FAILED";return}p.state="RESTARTING";this.bus.emit("process:crashed",p,p);try{await p.restart();p.state="HEALTHY";this.bus.emit("process:restarted",p,p)}catch(e){p.state="FAILED";this.diagnostics.error("PROCESS","Restart failed: "+p.name,e,p)}}
 monitor(id:string,ms=10000){this.stopMonitoring(id);const t=window.setInterval(()=>void this.check(id),ms);this.timers.set(id,t);return()=>this.stopMonitoring(id)}
 stopMonitoring(id:string){const t=this.timers.get(id);if(t)window.clearInterval(t);this.timers.delete(id)}
 stop(id:string){const p=this.processes.get(id);if(!p)return;try{p.stop()}catch{}this.stopMonitoring(id);p.state="STOPPED";this.processes.delete(id)}
 getActiveCount(){return this.processes.size}
 get(id:string){return this.processes.get(id)}
 list(){return [...this.processes.values()].map(({stop,restart,health,...p})=>p)}
 stopAll(){for(const id of [...this.processes.keys()])this.stop(id)}
}
