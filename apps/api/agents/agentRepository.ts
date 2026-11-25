import {randomUUID} from "node:crypto";
import {query,withDatabaseTransaction} from "../db.js";
import type {AgentConfig,AgentRunStatus} from "./types.js";
export async function listAgents(org:string){const r=await query("SELECT a.*,v.version_number,v.instructions,v.provider,v.model,v.temperature,v.config FROM agents a LEFT JOIN agent_versions v ON v.id=a.current_version_id WHERE a.organization_id=$1 AND a.status<>'archived' ORDER BY a.updated_at DESC",[org]);return r.rows;}
export async function getAgent(org:string,id:string){const r=await query("SELECT a.*,v.version_number,v.instructions,v.provider,v.model,v.temperature,v.config FROM agents a LEFT JOIN agent_versions v ON v.id=a.current_version_id WHERE a.organization_id=$1 AND a.id=$2 LIMIT 1",[org,id]);return r.rows[0]??null;}
export async function createAgent(org:string,user:string,c:AgentConfig){const id=randomUUID(),versionId=randomUUID();return withDatabaseTransaction(async client=>{await client.query("INSERT INTO agents(id,organization_id,created_by,name,description,status) VALUES($1,$2,$3,$4,$5,'draft')",[id,org,user,c.name,c.description]);await client.query("INSERT INTO agent_versions(id,agent_id,version_number,instructions,provider,model,temperature,config,created_by) VALUES($1,$2,1,$3,$4,$5,$6,$7::jsonb,$8)",[versionId,id,c.instructions,c.provider,c.model,c.temperature,JSON.stringify(c),user]);for(const tool of c.tools)await client.query("INSERT INTO agent_tool_bindings(agent_version_id,tool_id,enabled) VALUES($1,$2,true)",[versionId,tool]);await client.query("UPDATE agents SET current_version_id=$1 WHERE id=$2",[versionId,id]);const r=await client.query("SELECT * FROM agents WHERE id=$1",[id]);return r.rows[0];});}
export async function updateAgent(org:string,user:string,id:string,c:AgentConfig){return withDatabaseTransaction(async client=>{const found=await client.query("SELECT id,status FROM agents WHERE id=$1 AND organization_id=$2 FOR UPDATE",[id,org]);if(!found.rows[0]||found.rows[0].status==="archived")return null;const n=await client.query("SELECT COALESCE(MAX(version_number),0)+1 AS version_number FROM agent_versions WHERE agent_id=$1",[id]);const versionId=randomUUID(),version=Number(n.rows[0].version_number);await client.query("INSERT INTO agent_versions(id,agent_id,version_number,instructions,provider,model,temperature,config,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)",[versionId,id,version,c.instructions,c.provider,c.model,c.temperature,JSON.stringify(c),user]);for(const tool of c.tools)await client.query("INSERT INTO agent_tool_bindings(agent_version_id,tool_id,enabled) VALUES($1,$2,true)",[versionId,tool]);await client.query("UPDATE agents SET name=$1,description=$2,current_version_id=$3,updated_at=NOW() WHERE id=$4 AND organization_id=$5",[c.name,c.description,versionId,id,org]);const r=await client.query("SELECT * FROM agents WHERE id=$1 AND organization_id=$2",[id,org]);return r.rows[0]??null;});}
export async function setAgentStatus(org:string,id:string,status:"published"|"paused"|"archived"){const r=await query("UPDATE agents SET status=$1,updated_at=NOW() WHERE id=$2 AND organization_id=$3 AND status<>'archived' RETURNING id",[status,id,org]);return r.rows.length>0;}
export async function getAgentVersion(org:string,id:string){const r=await query("SELECT a.id,a.name,a.description,a.status,a.organization_id,v.id AS version_id,v.version_number,v.instructions,v.provider,v.model,v.temperature,v.config,COALESCE(jsonb_agg(b.tool_id) FILTER(WHERE b.enabled),'[]'::jsonb) AS tools FROM agents a JOIN agent_versions v ON v.id=a.current_version_id LEFT JOIN agent_tool_bindings b ON b.agent_version_id=v.id WHERE a.organization_id=$1 AND a.id=$2 GROUP BY a.id,v.id",[org,id]);return r.rows[0]??null;}
export async function createAgentRun(org:string,user:string,agent:string,version:string,input:unknown,idempotencyKey?:string){const id=randomUUID();if(idempotencyKey){const inserted=await query<{id:string}>("INSERT INTO agent_runs(id,organization_id,agent_id,agent_version_id,created_by,status,input,idempotency_key) VALUES($1,$2,$3,$4,$5,'queued',$6::jsonb,$7) ON CONFLICT (organization_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING id",[id,org,agent,version,user,JSON.stringify(input??{}),idempotencyKey]);if(inserted.rows[0])return inserted.rows[0].id;const existing=await query<{id:string}>("SELECT id FROM agent_runs WHERE organization_id=$1 AND idempotency_key=$2 LIMIT 1",[org,idempotencyKey]);if(!existing.rows[0])throw new Error("Idempotent run insert conflicted but existing run could not be loaded.");return existing.rows[0].id;}await query("INSERT INTO agent_runs(id,organization_id,agent_id,agent_version_id,created_by,status,input) VALUES($1,$2,$3,$4,$5,'queued',$6::jsonb)",[id,org,agent,version,user,JSON.stringify(input??{})]);return id;}
export async function updateRun(id:string,status:AgentRunStatus,fields:{output?:unknown;error?:unknown}={},leaseOwner?:string){
  await query("UPDATE agent_runs SET status=$2,output=COALESCE($3::jsonb,output),error=COALESCE($4::jsonb,error),started_at=CASE WHEN $2 IN('initializing','planning','running') AND started_at IS NULL THEN NOW() ELSE started_at END,finished_at=CASE WHEN $2 IN('completed','failed','cancelled','timed_out','limit_reached') THEN NOW() ELSE finished_at END WHERE id=$1 AND ($5::text IS NULL OR lease_owner=$5)",[id,status,fields.output===undefined?null:JSON.stringify(fields.output),fields.error===undefined?null:JSON.stringify(fields.error),leaseOwner??null]);
}
export async function addRunEvent(id:string,type:string,payload:Record<string,unknown>={},leaseOwner?:string){
  if(leaseOwner){await query("INSERT INTO agent_run_events(run_id,event_type,payload) SELECT $1,$2,$3::jsonb WHERE EXISTS(SELECT 1 FROM agent_runs WHERE id=$1 AND lease_owner=$4)",[id,type,JSON.stringify(payload),leaseOwner]);return;}
  await query("INSERT INTO agent_run_events(run_id,event_type,payload) VALUES($1,$2,$3::jsonb)",[id,type,JSON.stringify(payload)]);
}
export async function getRun(org:string,id:string){const r=await query("SELECT * FROM agent_runs WHERE id=$1 AND organization_id=$2 LIMIT 1",[id,org]);return r.rows[0]??null;}
export async function getRunEvents(org:string,id:string,after=0){const r=await query("SELECT e.id,e.event_type,e.payload,e.created_at FROM agent_run_events e JOIN agent_runs r ON r.id=e.run_id WHERE r.organization_id=$1 AND r.id=$2 AND e.id>$3 ORDER BY e.id ASC LIMIT 500",[org,id,after]);return r.rows;}

export interface ClaimedAgentRun {
  id:string; organization_id:string; agent_id:string; agent_version_id:string;
  created_by:string; input:unknown; attempts:number; max_attempts:number;
}

export async function claimNextAgentRun(workerId:string,leaseMs=60000):Promise<ClaimedAgentRun|null>{
  const result=await query<ClaimedAgentRun>(`
    WITH exhausted AS (
      UPDATE agent_runs SET status='failed',finished_at=NOW(),lease_owner=NULL,lease_expires_at=NULL,
        error=jsonb_build_object('code','WORKER_LEASE_EXHAUSTED','message','Worker lease expired and the maximum delivery attempts were reached.')
      WHERE status IN ('initializing','planning','running','waiting_approval') AND lease_expires_at<=NOW() AND attempts>=max_attempts RETURNING id
    ), candidate AS (
      SELECT id FROM agent_runs WHERE attempts<max_attempts AND (
        (status='queued' AND available_at<=NOW()) OR
        (status IN ('initializing','planning','running','waiting_approval') AND lease_expires_at<=NOW())
      ) ORDER BY available_at ASC,created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE agent_runs AS run SET status='initializing',attempts=run.attempts+1,
      lease_owner=$1,lease_expires_at=NOW()+($2::int*INTERVAL '1 millisecond'),
      started_at=COALESCE(run.started_at,NOW()),finished_at=NULL
    FROM candidate WHERE run.id=candidate.id
    RETURNING run.id,run.organization_id,run.agent_id,run.agent_version_id,run.created_by,run.input,run.attempts,run.max_attempts
  `,[workerId,Math.max(10000,Math.min(300000,leaseMs))]);
  return result.rows[0]??null;
}

export async function renewAgentRunLease(runId:string,workerId:string,leaseMs=60000):Promise<boolean>{
  const result=await query("UPDATE agent_runs SET lease_expires_at=NOW()+($3::int*INTERVAL '1 millisecond') WHERE id=$1 AND lease_owner=$2 AND lease_expires_at>NOW() AND status IN ('initializing','planning','running','waiting_approval') RETURNING id",[runId,workerId,Math.max(10000,Math.min(300000,leaseMs))]);
  return result.rows.length>0;
}

export async function releaseAgentRunLease(runId:string,workerId:string):Promise<void>{
  await query("UPDATE agent_runs SET lease_owner=NULL,lease_expires_at=NULL WHERE id=$1 AND lease_owner=$2",[runId,workerId]);
}

export async function cancelAgentRun(org:string,runId:string):Promise<boolean>{
  const result=await query("UPDATE agent_runs SET status='cancelled',finished_at=NOW(),lease_owner=NULL,lease_expires_at=NULL,error=jsonb_build_object('code','CANCELLED','message','Cancelled by user.') WHERE id=$1 AND organization_id=$2 AND status IN ('queued','initializing','planning','running','waiting_approval') RETURNING id",[runId,org]);
  if(result.rows.length)await addRunEvent(runId,"run.cancelled",{source:"user"});
  return result.rows.length>0;
}

export async function getAgentVersionForRun(org:string,agentId:string,versionId:string){
  const r=await query("SELECT a.id,a.name,a.description,a.status,a.organization_id,v.id AS version_id,v.version_number,v.instructions,v.provider,v.model,v.temperature,v.config,COALESCE(jsonb_agg(b.tool_id) FILTER(WHERE b.enabled),'[]'::jsonb) AS tools FROM agents a JOIN agent_versions v ON v.agent_id=a.id LEFT JOIN agent_tool_bindings b ON b.agent_version_id=v.id WHERE a.organization_id=$1 AND a.id=$2 AND v.id=$3 GROUP BY a.id,v.id",[org,agentId,versionId]);
  return r.rows[0]??null;
}