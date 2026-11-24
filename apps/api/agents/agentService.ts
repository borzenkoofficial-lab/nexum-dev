import type { AIGateway } from "../ai/gateway.js";
import { createAgent, updateAgent } from "./agentRepository.js";
import type { AgentChannel, AgentConfig, AgentExecutionMode, AgentPermissionConfig, AgentTrigger } from "./types.js";
import { agentToolRegistry } from "./tools/toolRegistry.js";

const defaults = { maxIterations: 12, maxToolCalls: 20, maxDurationSeconds: 300, maxTokensPerRun: 12000 };
const modes = new Set<AgentExecutionMode>(["conversational", "autonomous", "event", "workforce"]);
const channelTypes = new Set(["webchat", "telegram", "email", "api", "crm", "custom"]);
const triggerTypes = new Set(["manual", "schedule", "event"]);
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function stringList(value: unknown, field: string, maxItems = 50): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems || value.some(x => typeof x !== "string" || !x.trim() || x.length > 160)) throw new Error(field + " must be an array of up to " + maxItems + " non-empty strings.");
  return [...new Set(value.map(x => String(x).trim()))];
}
function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  return Number.isInteger(value) ? Math.min(max, Math.max(min, Number(value))) : fallback;
}
function normalizeBindings<T extends { id: string; type: string; enabled: boolean; config: Record<string, unknown> }>(value: unknown, field: string, allowed: Set<string>): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 30) throw new Error(field + " must contain at most 30 entries.");
  return value.map((entry, index) => {
    const item = record(entry);
    const id = typeof item.id === "string" && item.id.trim() ? item.id.trim().slice(0, 80) : field + "-" + (index + 1);
    const type = typeof item.type === "string" ? item.type : "";
    if (!allowed.has(type)) throw new Error("Unsupported " + field + " type: " + type);
    return { id, type, enabled: item.enabled !== false, config: record(item.config) } as T;
  });
}
export function validateAgentConfig(value: unknown, allowedProviders?: string[]): AgentConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Agent configuration must be an object.");
  const v = value as Record<string, unknown>;
  const read = (key: string, max: number, required = true) => {
    const s = typeof v[key] === "string" ? String(v[key]).trim() : "";
    if (required && !s) throw new Error(key + " is required.");
    if (s.length > max) throw new Error(key + " exceeds " + max + " characters.");
    return s;
  };
  const tools = stringList(v.tools, "tools");
  const available = new Set(agentToolRegistry.list().map(t => t.id));
  for (const id of tools) if (!available.has(id)) throw new Error("Unknown tool: " + id);
  const temperature = typeof v.temperature === "number" ? v.temperature : 0.3;
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) throw new Error("temperature must be between 0 and 2.");
  const rawLimits = record(v.limits);
  const limits = {
    maxIterations: boundedInteger(rawLimits.maxIterations, defaults.maxIterations, 1, 30),
    maxToolCalls: boundedInteger(rawLimits.maxToolCalls, defaults.maxToolCalls, 0, 50),
    maxDurationSeconds: boundedInteger(rawLimits.maxDurationSeconds, defaults.maxDurationSeconds, 5, 900),
    maxTokensPerRun: boundedInteger(rawLimits.maxTokensPerRun, defaults.maxTokensPerRun, 1000, 100000)
  };
  const rawModes = v.modes === undefined ? ["conversational", "autonomous"] : v.modes;
  if (!Array.isArray(rawModes) || rawModes.length === 0 || rawModes.some(x => typeof x !== "string" || !modes.has(x as AgentExecutionMode))) throw new Error("modes must contain supported execution modes.");
  const rawMemory = record(v.memory);
  const strategy = rawMemory.strategy === "long_term" || rawMemory.strategy === "hybrid" ? rawMemory.strategy : "session";
  const memory = {
    enabled: rawMemory.enabled === true,
    strategy,
    retentionDays: boundedInteger(rawMemory.retentionDays, 30, 1, 3650)
  } as AgentConfig["memory"];
  const rawPermissions = record(v.permissions);
  const permissions: AgentPermissionConfig = {
    scopes: stringList(rawPermissions.scopes, "permissions.scopes"),
    requireApprovalFor: stringList(rawPermissions.requireApprovalFor, "permissions.requireApprovalFor"),
    allowExternalSideEffects: rawPermissions.allowExternalSideEffects === true
  };
  const approvalPolicy = record(v.approvalPolicy);
  for (const [key, policy] of Object.entries(approvalPolicy)) {
    if (!key || key.length > 120 || (policy !== "required" && policy !== "not_required")) throw new Error("approvalPolicy contains an invalid rule.");
  }
  const config: AgentConfig = {
    name: read("name", 120),
    description: read("description", 2000, false),
    specialization: read("specialization", 160, false),
    instructions: read("instructions", 20000),
    provider: read("provider", 80),
    model: read("model", 200),
    temperature,
    tools,
    capabilities: stringList(v.capabilities, "capabilities"),
    modes: [...new Set(rawModes as AgentExecutionMode[])],
    channels: normalizeBindings<AgentChannel>(v.channels, "channels", channelTypes),
    triggers: normalizeBindings<AgentTrigger>(v.triggers, "triggers", triggerTypes),
    knowledgeSourceIds: stringList(v.knowledgeSourceIds, "knowledgeSourceIds"),
    memory,
    permissions,
    limits,
    approvalPolicy: approvalPolicy as AgentConfig["approvalPolicy"]
  };
  if (allowedProviders && !allowedProviders.includes(config.provider)) throw new Error("Selected AI provider is unavailable.");
  return config;
}
export async function createAgentForOrganization(org: string, user: string, value: unknown, providers: string[]) {
  return createAgent(org, user, validateAgentConfig(value, providers));
}
export async function updateAgentForOrganization(org: string, user: string, id: string, value: unknown, providers: string[]) {
  return updateAgent(org, user, id, validateAgentConfig(value, providers));
}
export async function generateInventDraft(gateway: AIGateway, prompt: string) {
  if (!prompt.trim() || prompt.length > 10000) throw new Error("Describe the agent in 1-10000 characters.");
  const availableTools = agentToolRegistry.list().map(({ id, name, description, inputSchema, riskLevel }) => ({ id, name, description, inputSchema, riskLevel }));
  const providers = gateway.getProviders();
  const response = await gateway.generate(
    "Create a draft NEXUM agent definition. Return JSON only with keys name,description,specialization,instructions,provider,model,temperature,tools,capabilities,modes,channels,triggers,knowledgeSourceIds,memory,permissions,limits,approvalPolicy. The role and specialization must be inferred from the user's request and must not be restricted to a fixed profession catalog. Select tools only from this exact catalog; never invent integrations or capabilities. Use only supplied providers. Default permissions must deny external side effects and require approval for consequential actions. Triggers and channels are configuration only unless a corresponding integration is explicitly present.\nProviders: " + JSON.stringify(providers) + "\nTools: " + JSON.stringify(availableTools) + "\nUser request: " + prompt,
    { maxTokens: 3500, temperature: 0.2 }
  );
  const match = response.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Invent could not produce a JSON configuration.");
  let parsed: unknown;
  try { parsed = JSON.parse(match[0]); } catch { throw new Error("Invent returned invalid JSON."); }
  const config = validateAgentConfig(parsed, providers.map(p => p.id));
  const warnings = [
    ...(!config.tools.length ? ["No tools selected; this agent can only reason over task text."] : []),
    ...(config.channels.length ? ["Channel bindings are saved as configuration; only connected channel integrations can receive messages."] : []),
    ...(config.triggers.some(t => t.type !== "manual") ? ["Non-manual triggers are configuration only until the scheduler/event adapter is connected."] : []),
    ...(!config.permissions.allowExternalSideEffects ? ["External side effects are disabled by default."] : [])
  ];
  return { config, availableTools, warnings };
}
