import {RuntimeEventBus}from "./EventBus.ts";import {RuntimeDiagnostics}from "./Diagnostics.ts";import type{RuntimeHealth}from "./types.ts";
interface VisualLoop{raf:number;frame:(time:number)=>void}
export class VisualRuntime{
 private loops=new Map<string,VisualLoop>();private health:RuntimeHealth="NORMAL";private reduced=false;
 private bus:RuntimeEventBus;private diagnostics:RuntimeDiagnostics;
 constructor(bus:RuntimeEventBus,diagnostics:RuntimeDiagnostics){this.bus=bus;this.diagnostics=diagnostics;this.bus.on("performance:health",e=>{const p=e.payload as {health?:RuntimeHealth}|undefined;if(p?.health)this.setHealth(p.health)})}
 registerAnimation(id:string,frame:(time:number)=>void){this.stopAnimation(id);const loop:VisualLoop={raf:0,frame};this.loops.set(id,loop);if(!this.reduced)this.schedule(id,loop);return()=>this.stopAnimation(id)}
 private schedule(id:string,loop:VisualLoop){if(this.reduced)return;loop.raf=requestAnimationFrame(time=>{if(!this.loops.has(id))return;if(this.reduced){loop.raf=0;return}loop.frame(time);this.schedule(id,loop)})}
 stopAnimation(id:string){const loop=this.loops.get(id);if(!loop)return;if(loop.raf)cancelAnimationFrame(loop.raf);this.loops.delete(id)}
 setHealth(health:RuntimeHealth){const previous=this.health;this.health=health;this.reduced=health==="DEGRADED"||health==="CRITICAL";if(this.reduced){for(const loop of this.loops.values()){if(loop.raf)cancelAnimationFrame(loop.raf);loop.raf=0}}else if(previous!=="NORMAL"){for(const [id,loop] of this.loops)this.schedule(id,loop)}this.bus.emit("visual:degradation",{health,reduced:this.reduced});if(health!=="NORMAL"&&health!==previous)this.diagnostics.warn("VISUAL","Controlled visual degradation enabled",undefined,{health});if(health==="NORMAL"&&previous!=="NORMAL")this.diagnostics.info("VISUAL","Visual runtime recovered",undefined,{health})}
 releaseAll(){for(const id of [...this.loops.keys()])this.stopAnimation(id)}
 getState(){return{health:this.health,reduced:this.reduced,activeAnimations:this.loops.size}}
}
