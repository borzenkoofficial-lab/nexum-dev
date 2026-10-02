
import {RuntimeEventBus} from "./EventBus";import {RuntimeDiagnostics} from "./Diagnostics";import type{RuntimeContext}from"./types";
export type PreviewState="STOPPED"|"STARTING"|"READY"|"UNHEALTHY"|"RESTARTING"|"FAILED";
export interface PreviewAdapter{start:(context:RuntimeContext)=>Promise<void>;stop:()=>Promise<void>;health:()=>Promise<boolean>;restart?:()=>Promise<void>}
export class PreviewManager{
 state:PreviewState="STOPPED";private context:RuntimeContext={};private adapter?:PreviewAdapter;private timer=0;
 constructor(private bus:RuntimeEventBus,private diagnostics:RuntimeDiagnostics){}
 attach(adapter:PreviewAdapter){this.adapter=adapter}
 async start(context:RuntimeContext={}){if(!this.adapter)return;this.context=context;this.state="STARTING";this.bus.emit("preview:started",context,context);try{await this.adapter.start(context);this.state="READY";this.bus.emit("preview:ready",undefined,context);this.monitor()}catch(e){this.state="FAILED";this.diagnostics.error("PREVIEW","Preview start failed",e,context,"restart")}}
 private monitor(){if(this.timer)clearInterval(this.timer);this.timer=window.setInterval(()=>void this.healthCheck(),10000)}
 async healthCheck(){if(!this.adapter||this.state==="STOPPED")return true;try{const ok=await this.adapter.health();if(ok){this.state="READY";return true}this.state="UNHEALTHY";this.bus.emit("preview:error",{state:this.state},this.context);return this.recover()}catch(e){this.state="UNHEALTHY";this.diagnostics.error("PREVIEW","Preview health check failed",e,this.context,"restart");return this.recover()}}
 async recover(){if(!this.adapter)return false;this.state="RESTARTING";this.bus.emit("preview:restarting",undefined,this.context);try{if(this.adapter.restart)await this.adapter.restart();else{await this.adapter.stop();await this.adapter.start(this.context)}this.state="READY";this.bus.emit("preview:ready",undefined,this.context);return true}catch(e){this.state="FAILED";this.diagnostics.error("PREVIEW","Preview recovery failed",e,this.context);return false}}
 async stop(){if(this.timer)clearInterval(this.timer);this.timer=0;if(this.adapter){try{await this.adapter.stop()}catch(e){this.diagnostics.error("PREVIEW","Preview stop failed",e,this.context)}}this.state="STOPPED";this.bus.emit("preview:stopped",undefined,this.context)}
}
