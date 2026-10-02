
export type RuntimeLifecycle = "BOOTING" | "READY" | "BUSY" | "DEGRADED" | "RECOVERING" | "SHUTTING_DOWN";
export type RuntimeSeverity = "debug" | "info" | "warn" | "error" | "fatal";
export type RuntimeHealth = "NORMAL" | "WARNING" | "DEGRADED" | "CRITICAL";
export type TaskStatus = "QUEUED" | "PLANNING" | "RUNNING" | "WAITING" | "VALIDATING" | "RECOVERING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type ResourceKind = "timer" | "listener" | "request" | "worker" | "stream" | "object-url" | "animation" | "subscription" | "process" | "asset";
export interface RuntimeContext { projectId?: string; taskId?: string; operation?: string; }
export interface RuntimeEvent<T=unknown> { type:string; timestamp:number; context?:RuntimeContext; severity?:RuntimeSeverity; payload?:T; }
export interface RuntimeDiagnostic extends RuntimeEvent { subsystem:string; message:string; error?:string; recoveryAction?:string; }
export interface TaskRecord extends RuntimeContext { id:string; status:TaskStatus; parentTaskId?:string; childTaskIds:string[]; priority:number; progress:number; createdAt:number; startedAt?:number; completedAt?:number; timeoutMs?:number; retryCount:number; maxRetries:number; dependencies:string[]; error?:string; recoveryState?:string; checkpointId?:string; cancel:()=>void; }
export interface ResourceRecord extends RuntimeContext { id:string; kind:ResourceKind; status:"CREATE"|"ACTIVE"|"PAUSED"|"RELEASED"; createdAt:number; release:()=>void; }
export interface RuntimeSnapshot { version:1; savedAt:number; lifecycle:RuntimeLifecycle; activeProjectId?:string; activeTaskIds:string[]; metadata:Record<string,unknown>; }
