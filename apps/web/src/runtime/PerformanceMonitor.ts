
import type { RuntimeHealth } from "./types"; import { failureInjection } from "./FailureInjection.ts"; import { RuntimeEventBus } from "./EventBus"; import { RuntimeDiagnostics } from "./Diagnostics";
export class PerformanceMonitor{
 private health:RuntimeHealth="NORMAL";private fps=60;private raf=0;private last=performance.now();private frames=0;
 private bus:RuntimeEventBus; private diagnostics:RuntimeDiagnostics; constructor(bus:RuntimeEventBus,diagnostics:RuntimeDiagnostics){this.bus=bus;this.diagnostics=diagnostics}
 start(){if(typeof window==="undefined"||typeof requestAnimationFrame!=="function")return;if(this.raf)return;const tick=(now:number)=>{this.frames++;if(now-this.last>=1000){this.fps=this.frames*1000/(now-this.last);this.frames=0;this.last=now;this.evaluate()}this.raf=requestAnimationFrame(tick)};this.raf=requestAnimationFrame(tick)}
 private evaluate(){const next:RuntimeHealth=failureInjection.isEnabled("FORCE_VISUAL_CRITICAL")?"CRITICAL":failureInjection.isEnabled("FORCE_VISUAL_NORMAL")?"NORMAL":this.fps<20?"CRITICAL":this.fps<40?"DEGRADED":this.fps<50?"WARNING":"NORMAL";if(next!==this.health){this.health=next;this.bus.emit("performance:health",{health:next,fps:Math.round(this.fps)});if(next!=="NORMAL")this.diagnostics.warn("VISUAL","Performance state "+next,undefined,{fps:this.fps})}}
 setHealthForTest(health:RuntimeHealth){if(health!==this.health){this.health=health;this.bus.emit("performance:health",{health,fps:Math.round(this.fps)});this.diagnostics.info("VISUAL","Injected performance state "+health,undefined,{fps:this.fps})}}
 stop(){if(this.raf&&typeof cancelAnimationFrame==="function")cancelAnimationFrame(this.raf);this.raf=0}getHealth(){return this.health}getFps(){return this.fps}
}
