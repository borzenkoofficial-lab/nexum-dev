import { randomUUID } from "node:crypto";
import { query } from "../db.js";
import { getToolSecurityPolicy } from "./toolPolicy.js";

export type AgentApprovalPolicy = "always" | "writes" | "autonomous";
export type AgentDefinitionStatus = "active" | "paused";

export interface AgentDefinition {
  id: string;
  userId: string;
  name: string;
  description: string;
  systemPrompt: string;
  provider: string | null;
  model: string | null;
  allowedTools: string[];
  approvalPolicy: AgentApprovalPolicy;
  status: AgentDefinitionStatus;
  createdAt: number;
  updatedAt: number;
}

export type AgentDefinitionInput = Pick<AgentDefinition,
  "name" | "description" | "systemPrompt" | "allowedTools" | "approvalPolicy" | "status"
> & Partial<Pick<AgentDefinition, "provider" | "model">>;

export type AgentDefinitionPatch = Partial<AgentDefinitionInput>;

type AgentDefinitionRow = {
  id: string;
  user_id: string;
  name: string;
  description: string;
  system_prompt: string;
  provider: string | null;
  model: string | null;
  allowed_tools: string[];
  approval_policy: AgentApprovalPolicy;
  status: AgentDefinitionStatus;
  created_at: string | number;
  updated_at: string | number;
};

const SUPPORTED_AGENT_PROVIDERS = new Set(["ollama", "openrouter", "anymodel", "openai", "anthropic", "orcarouter"]);
const memoryDefinitions = new Map<string, AgentDefinition[]>();
let initialized: Promise<void> | null = null;

export function agentDefinitionsUseDatabase(): boolean {
  return Boolean(process.env.NEXUM_DATABASE_URL?.trim());
}

function validateAllowedTools(toolNames: string[]): void {
  if (!Array.isArray(toolNames)) throw new Error("Список инструментов должен быть массивом.");
  if (toolNames.length > 32) throw new Error("Агент может использовать не более 32 инструментов.");
  if (new Set(toolNames).size !== toolNames.length) throw new Error("Список инструментов содержит повторы.");
  for (const name of toolNames) getToolSecurityPolicy(name);
}

function validateExecutionPolicy(approvalPolicy: AgentApprovalPolicy, allowedTools: string[]): void {
  if (approvalPolicy === "autonomous") {
    if (allowedTools.length === 0) throw new Error("Для автономного режима выберите хотя бы один инструмент чтения.");
    const unsafeTool = allowedTools.find((name) => getToolSecurityPolicy(name).risk !== "READ");
    if (unsafeTool) throw new Error("В автономном режиме разрешены только инструменты чтения.");
  }
}

function validateInput(input: AgentDefinitionInput | AgentDefinitionPatch): void {
  if (input.name !== undefined && (!input.name.trim() || input.name.length > 48)) throw new Error("Название агента обязательно и должно содержать не более 48 символов.");
  if (input.description !== undefined && input.description.length > 160) throw new Error("Описание агента должно содержать не более 160 символов.");
  if (input.systemPrompt !== undefined && (!input.systemPrompt.trim() || input.systemPrompt.length > 5000)) throw new Error("Системная инструкция обязательна и должна содержать не более 5 000 символов.");
  if (input.provider !== undefined && input.provider !== null && !SUPPORTED_AGENT_PROVIDERS.has(input.provider)) {
    throw new Error("Неподдерживаемый провайдер AI.");
  }
  if (input.allowedTools !== undefined) validateAllowedTools(input.allowedTools);
  if (input.approvalPolicy !== undefined && !["always", "writes", "autonomous"].includes(input.approvalPolicy)) {
    throw new Error("Недопустимая политика подтверждения действий.");
  }
  if (input.status !== undefined && !["active", "paused"].includes(input.status)) {
    throw new Error("Недопустимый статус агента.");
  }
}

async function ensureTable(): Promise<void> {
  if (!initialized) {
    initialized = query(`
      CREATE TABLE IF NOT EXISTS agent_definitions (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        system_prompt TEXT NOT NULL,
        provider TEXT,
        model TEXT,
        allowed_tools TEXT[] NOT NULL DEFAULT '{}',
        approval_policy TEXT NOT NULL DEFAULT 'always' CHECK (approval_policy IN ('always', 'writes', 'autonomous')),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS agent_definitions_user_name_idx
        ON agent_definitions (user_id, lower(name));
      CREATE INDEX IF NOT EXISTS agent_definitions_user_updated_idx
        ON agent_definitions (user_id, updated_at DESC);
    `).then(() => undefined).catch((error) => {
      initialized = null;
      throw error;
    });
  }
  await initialized;
}

function fromRow(row: AgentDefinitionRow): AgentDefinition {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    systemPrompt: row.system_prompt,
    provider: row.provider,
    model: row.model,
    allowedTools: row.allowed_tools ?? [],
    approvalPolicy: row.approval_policy,
    status: row.status,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export async function listAgentDefinitions(userId: string): Promise<AgentDefinition[]> {
  if (!agentDefinitionsUseDatabase()) {
    return (memoryDefinitions.get(userId) ?? []).map((agent) => ({ ...agent, allowedTools: [...agent.allowedTools] }));
  }
  await ensureTable();
  const result = await query<AgentDefinitionRow>(
    "SELECT id,user_id,name,description,system_prompt,provider,model,allowed_tools,approval_policy,status,created_at,updated_at FROM agent_definitions WHERE user_id=$1 ORDER BY updated_at DESC",
    [userId],
  );
  return result.rows.map(fromRow);
}

export async function createAgentDefinition(userId: string, input: AgentDefinitionInput): Promise<AgentDefinition> {
  validateInput(input);
  const now = Date.now();
  const agent: AgentDefinition = {
    id: randomUUID(),
    userId,
    name: input.name,
    description: input.description,
    systemPrompt: input.systemPrompt,
    provider: input.provider ?? null,
    model: input.model ?? null,
    allowedTools: [...input.allowedTools],
    approvalPolicy: input.approvalPolicy,
    status: input.status,
    createdAt: now,
    updatedAt: now,
  };
  if (!agent.name.trim()) throw new Error("Название агента обязательно.");
  if (!agent.systemPrompt.trim()) throw new Error("Системная инструкция обязательна.");
  validateExecutionPolicy(agent.approvalPolicy, agent.allowedTools);
  if (!agentDefinitionsUseDatabase()) {
    const existing = memoryDefinitions.get(userId) ?? [];
    if (existing.some((item) => item.name.toLowerCase() === agent.name.toLowerCase())) {
      throw new Error("Агент с таким названием уже существует.");
    }
    memoryDefinitions.set(userId, [...existing, agent]);
    return { ...agent, allowedTools: [...agent.allowedTools] };
  }
  await ensureTable();
  const result = await query<AgentDefinitionRow>(
    "INSERT INTO agent_definitions (id,user_id,name,description,system_prompt,provider,model,allowed_tools,approval_policy,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING id,user_id,name,description,system_prompt,provider,model,allowed_tools,approval_policy,status,created_at,updated_at",
    [agent.id, userId, agent.name, agent.description, agent.systemPrompt, agent.provider, agent.model, agent.allowedTools, agent.approvalPolicy, agent.status, now],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Не удалось сохранить агента.");
  return fromRow(row);
}

export async function updateAgentDefinition(userId: string, agentId: string, patch: AgentDefinitionPatch): Promise<AgentDefinition | null> {
  validateInput(patch);
  if (!Object.keys(patch).length) return null;
  if (!agentDefinitionsUseDatabase()) {
    const existing = memoryDefinitions.get(userId) ?? [];
    const index = existing.findIndex((agent) => agent.id === agentId);
    if (index < 0) return null;
    const current = existing[index];
    if (!current) return null;
    const next: AgentDefinition = { ...current, ...patch, allowedTools: patch.allowedTools ? [...patch.allowedTools] : [...current.allowedTools], updatedAt: Date.now() };
    validateExecutionPolicy(next.approvalPolicy, next.allowedTools);
    if (existing.some((agent, itemIndex) => itemIndex !== index && agent.name.toLowerCase() === next.name.toLowerCase())) {
      throw new Error("Агент с таким названием уже существует.");
    }
    existing[index] = next;
    memoryDefinitions.set(userId, existing);
    return { ...next, allowedTools: [...next.allowedTools] };
  }
  await ensureTable();
  const currentResult = await query<AgentDefinitionRow>(
    "SELECT id,user_id,name,description,system_prompt,provider,model,allowed_tools,approval_policy,status,created_at,updated_at FROM agent_definitions WHERE id=$1 AND user_id=$2",
    [agentId, userId],
  );
  const current = currentResult.rows[0];
  if (!current) return null;
  const merged = { ...fromRow(current), ...patch, allowedTools: patch.allowedTools ?? current.allowed_tools, updatedAt: Date.now() };
  validateExecutionPolicy(merged.approvalPolicy, merged.allowedTools);
  const result = await query<AgentDefinitionRow>(
    "UPDATE agent_definitions SET name=$3,description=$4,system_prompt=$5,provider=$6,model=$7,allowed_tools=$8,approval_policy=$9,status=$10,updated_at=$11 WHERE id=$1 AND user_id=$2 RETURNING id,user_id,name,description,system_prompt,provider,model,allowed_tools,approval_policy,status,created_at,updated_at",
    [agentId, userId, merged.name, merged.description, merged.systemPrompt, merged.provider, merged.model, merged.allowedTools, merged.approvalPolicy, merged.status, merged.updatedAt],
  );
  return result.rows[0] ? fromRow(result.rows[0]) : null;
}

export async function deleteAgentDefinition(userId: string, agentId: string): Promise<boolean> {
  if (!agentDefinitionsUseDatabase()) {
    const existing = memoryDefinitions.get(userId) ?? [];
    const next = existing.filter((agent) => agent.id !== agentId);
    if (next.length === existing.length) return false;
    memoryDefinitions.set(userId, next);
    return true;
  }
  await ensureTable();
  const result = await query<{ id: string }>("DELETE FROM agent_definitions WHERE id=$1 AND user_id=$2 RETURNING id", [agentId, userId]);
  return result.rows.length > 0;
}
