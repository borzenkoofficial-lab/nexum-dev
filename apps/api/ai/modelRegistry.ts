import type { AIOrchestratorRole } from "./orchestrator.js";

export type ModelCapability =
  | "reasoning"
  | "coding"
  | "debugging"
  | "testing"
  | "vision"
  | "fast"
  | "cheap"
  | "general";

export interface ModelRoute {
  id: string;
  label: string;
  provider: string;
  model: string;
  aliases?: string[];
  roles: AIOrchestratorRole[];
  capabilities: ModelCapability[];
  priority: number;
  maxTokens: number;
  minTokens?: number;
  enabled: boolean;
  fallbackIds?: string[];
}

/**
 * Central model registry.
 *
 * Model IDs are configuration, not architecture. Providers can expose different
 * IDs through environment variables or the Settings layer without changing the
 * agent/orchestrator code.
 */
export function getModelRegistry(): ModelRoute[] {
  return [
    {
      id: "director",
      label: "NEXUM Director",
      provider: process.env.NEXUM_DIRECTOR_PROVIDER || "openai",
      model: process.env.NEXUM_DIRECTOR_MODEL || process.env.OPENAI_MODEL || "gpt-5",
      roles: ["director", "planner"],
      capabilities: ["reasoning", "general"],
      priority: 100,
      maxTokens: 1800,
      enabled: process.env.NEXUM_DIRECTOR_ENABLED !== "false",
      fallbackIds: ["worker", "cheap-worker"],
    },
    {
      id: "builder",
      label: "Builder",
      provider: process.env.NEXUM_BUILDER_PROVIDER || "anthropic",
      model: process.env.NEXUM_BUILDER_MODEL || process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
      roles: ["coder", "general"],
      capabilities: ["coding", "reasoning"],
      priority: 100,
      maxTokens: 5000,
      enabled: process.env.NEXUM_BUILDER_ENABLED !== "false",
      fallbackIds: ["coding-worker", "cheap-worker"],
    },
    {
      id: "debugger",
      label: "Deep Debugger",
      provider: process.env.NEXUM_DEBUGGER_PROVIDER || "anthropic",
      model: process.env.NEXUM_DEBUGGER_MODEL || process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
      roles: ["debugger"],
      capabilities: ["debugging", "coding", "reasoning"],
      priority: 100,
      maxTokens: 3000,
      enabled: process.env.NEXUM_DEBUGGER_ENABLED !== "false",
      fallbackIds: ["coding-worker", "worker"],
    },
    {
      id: "worker",
      label: "Worker",
      provider: process.env.NEXUM_WORKER_PROVIDER || "openai",
      model: process.env.NEXUM_WORKER_MODEL || process.env.OPENAI_MODEL || "gpt-5-mini",
      roles: ["tester", "reviewer", "general"],
      capabilities: ["general", "testing", "fast"],
      priority: 80,
      maxTokens: 1600,
      enabled: process.env.NEXUM_WORKER_ENABLED !== "false",
      fallbackIds: ["cheap-worker"],
    },
    {
      id: "cheap-worker",
      label: "Cheap Worker",
      provider: process.env.NEXUM_CHEAP_WORKER_PROVIDER || "orcarouter",
      model: process.env.NEXUM_CHEAP_WORKER_MODEL || process.env.ORCAROUTER_MODEL || "deepseek/deepseek-v4-flash-free",
      roles: ["tester", "reviewer", "finalizer", "general"],
      capabilities: ["cheap", "fast", "general"],
      priority: 60,
      maxTokens: 1200,
      enabled: process.env.NEXUM_CHEAP_WORKER_ENABLED !== "false",
      fallbackIds: ["coding-worker"],
    },
    {
      id: "coding-worker",
      label: "Coding Worker",
      provider: process.env.NEXUM_CODING_WORKER_PROVIDER || "openrouter",
      model: process.env.NEXUM_CODING_WORKER_MODEL || process.env.OPENROUTER_MODEL || "openrouter/free",
      roles: ["coder", "debugger", "tester"],
      capabilities: ["coding", "debugging", "cheap"],
      priority: 70,
      maxTokens: 4000,
      enabled: process.env.NEXUM_CODING_WORKER_ENABLED !== "false",
      fallbackIds: ["cheap-worker"],
    },
    {
      id: "vision-ui",
      label: "Vision / UI",
      provider: process.env.NEXUM_VISION_PROVIDER || "gemini",
      model: process.env.NEXUM_VISION_MODEL || "gemini-3.1-pro",
      roles: ["reviewer", "general"],
      capabilities: ["vision", "reasoning"],
      priority: 90,
      maxTokens: 1800,
      enabled: process.env.NEXUM_VISION_ENABLED !== "false",
    },
    {
      id: "fallback",
      label: "DeepSeek Fallback",
      provider: process.env.NEXUM_FALLBACK_PROVIDER || "orcarouter",
      model: process.env.NEXUM_FALLBACK_MODEL || process.env.ORCAROUTER_MODEL || "deepseek/deepseek-v4-flash-free",
      roles: ["planner", "coder", "debugger", "tester", "general"],
      capabilities: ["general", "cheap", "fast"],
      priority: 30,
      maxTokens: 1800,
      enabled: process.env.NEXUM_FALLBACK_ENABLED !== "false",
    },
  ];
}

export function routesForRole(role: AIOrchestratorRole, availableProviders: Set<string>): ModelRoute[] {
  return getModelRegistry()
    .filter((route) => route.enabled && route.roles.includes(role) && availableProviders.has(route.provider))
    .sort((a, b) => b.priority - a.priority);
}

export function resolveRouteModel(model: string | undefined, availableProviders: Set<string>): ModelRoute | undefined {
  if (!model) return undefined;
  return getModelRegistry().find((route) =>
    route.enabled &&
    availableProviders.has(route.provider) &&
    (route.model === model || route.aliases?.includes(model)),
  );
}

export function routeById(id: string, availableProviders: Set<string>): ModelRoute | undefined {
  return getModelRegistry().find((route) =>
    route.enabled && route.id === id && availableProviders.has(route.provider),
  );
}
