
import {RuntimeEventBus} from "./EventBus";import {RuntimeDiagnostics}from"./Diagnostics";import type{RuntimeHealth}from"./types";
export class VisualRuntime{
 private loops=new Map<string,number>();private health:RuntimeHealth="NORMAL";private reduced=false;
 constructor(private bus:RuntimeEventBus,private diagnostics:RuntimeDiagnostics){this.bus.on("performance:health",e=>{const p=e.payload as {health?:RuntimeHealth}|undefined;if(p?.health)this.setHealth(p.health)})}
 registerAnimation(id:string,frame:(time:number)=>void){this.stopAnimation(id);let raf=0;const tick=(time:number)=>{if(this.reduced)return;frame(time);raf=requestAnimationFrame(tick)};raf=requestAnimationFrame(tick);this.loops.set(id,raf);return()=>this.stopAnimation(id)}
 stopAnimation(id:string){const raf=this.loops.get(id);if(raf)cancelAnimationFrame(raf);this.loops.delete(id)}
 setHealth(health:RuntimeHealth){this.health=health;this.reduced=health==="DEGRADED"||health==="CRITICAL";this.bus.emit("visual:degradation",{health,reduced:this.reduced});if(this.reduced)this.diagnostics.warn("VISUAL","Controlled visual degradation enabled",undefined,{health})}
 releaseAll(){for(const id of [...this.loops.keys()])this.stopAnimation(id)}
 getState(){return{health:this.health,reduced:this.reduced,activeAnimations:this.loops.size}}
}
