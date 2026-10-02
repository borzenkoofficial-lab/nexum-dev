
import type { RuntimeHealth } from "./types"; import { RuntimeEventBus } from "./EventBus"; import { RuntimeDiagnostics } from "./Diagnostics";
export class PerformanceMonitor{
 private health:RuntimeHealth="NORMAL";private fps=60;private raf=0;private last=performance.now();private frames=0;
 constructor(private bus:RuntimeEventBus,private diagnostics:RuntimeDiagnostics){}
 start(){if(this.raf)return;const tick=(now:number)=>{this.frames++;if(now-this.last>=1000){this.fps=this.frames*1000/(now-this.last);this.frames=0;this.last=now;this.evaluate()}this.raf=requestAnimationFrame(tick)};this.raf=requestAnimationFrame(tick)}
 private evaluate(){const next:RuntimeHealth=this.fps<20?"CRITICAL":this.fps<40?"DEGRADED":this.fps<50?"WARNING":"NORMAL";if(next!==this.health){this.health=next;this.bus.emit("performance:health",{health:next,fps:Math.round(this.fps)});if(next!=="NORMAL")this.diagnostics.warn("VISUAL","Performance state "+next,undefined,{fps:this.fps})}}
 stop(){if(this.raf)cancelAnimationFrame(this.raf);this.raf=0}getHealth(){return this.health}getFps(){return this.fps}
}
