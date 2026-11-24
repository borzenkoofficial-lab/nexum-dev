import type { AIGateway } from "../ai/gateway.js";
export type AgentStatus = "draft" | "published" | "paused" | "archived";
export type AgentRunStatus = "queued" | "initializing" | "planning" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled" | "timed_out" | "limit_reached";
export interface AgentConfig { name:string; description:string; instructions:string; provider:string; model:string; temperature:number; tools:string[]; limits:{maxIterations:number;maxToolCalls:number;maxDurationSeconds:number}; approvalPolicy:Record<string,"required"|"not_required">; }
export interface AgentExecutionContext { organizationId:string; userId:string; runId:string; signal:AbortSignal; requestApproval?:(request:{actionSummary:string;actionPayload?:unknown})=>Promise<{approvalId:string;status:string;reason?:string}>; }
export interface AgentToolDefinition { id:string; name:string; description:string; inputSchema:Record<string,unknown>; outputSchema:Record<string,unknown>; requiredScopes:string[]; riskLevel:"low"|"medium"|"high"; execute(input:unknown,context:AgentExecutionContext):Promise<unknown>; }
export interface RuntimeAgent { id:string; organization_id:string; name:string; description:string; instructions:string; provider:string; model:string; temperature:number; version_id:string; tools:string[]; config:{limits?:{maxIterations?:number;maxToolCalls?:number;maxDurationSeconds?:number}}; }
export type AgentGateway = AIGateway;
