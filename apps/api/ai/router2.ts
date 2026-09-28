import type { AIOrchestratorRole } from "./orchestrator.js";
import type { TaskGraph } from "./taskDecomposer.js";
import type { NexumIntent } from "./intentEngine.js";
import { routesForRole, type ModelRoute } from "./modelRegistry.js";

export interface Router2Decision {
  role: AIOrchestratorRole;
  route?: ModelRoute;
  mode: "simple" | "build" | "debug" | "review";
  complexity: "low" | "medium" | "high";
  reason: string;
  maxAiCalls: number;
  maxOutputTokens: number;
  confidence: number;
}

export interface Router2Input {
  task: string;
  intent: NexumIntent;
  graph: TaskGraph;
  availableProviders: Iterable<string>;
  requestedProvider?: string;
  requestedModel?: string;
}

export function routeWithStructuredContext(input: Router2Input): Router2Decision {
  const providers = new Set(input.availableProviders);
  const preferredRole: AIOrchestratorRole = input.graph.nodes.some((node) => node.role === "coder") ? "coder" :
    input.graph.nodes.some((node) => node.role === "debugger") ? "debugger" :
    input.graph.nodes.some((node) => node.role === "reviewer") ? "reviewer" : "tester";

  const role: AIOrchestratorRole = input.intent.mode === "debug" ? "debugger" :
    input.intent.mode === "review" ? "reviewer" :
    input.intent.mode === "explain" ? "general" : preferredRole;

  const candidates = routesForRole(role, providers);
  const requested = input.requestedModel?.trim();
  const route = requested
    ? candidates.find((candidate) => candidate.model === requested || candidate.aliases?.includes(requested))
    : input.requestedProvider
      ? candidates.find((candidate) => candidate.provider === input.requestedProvider)
      : candidates[0];

  const maxAiCalls = input.graph.complexity === "high" ? 4 : input.graph.complexity === "medium" ? 3 : 1;
  const maxOutputTokens = input.graph.complexity === "high" ? 8500 : input.graph.complexity === "medium" ? 6500 : 1800;
  const reason = [
    "intent=" + input.intent.mode,
    "domain=" + input.intent.domain,
    "complexity=" + input.graph.complexity,
    "role=" + role,
    "route=" + (route?.id ?? "unavailable"),
  ].join("; ");

  return {
    role,
    route,
    mode: input.intent.mode === "debug" ? "debug" : input.intent.mode === "review" ? "review" : input.intent.mode === "explain" ? "simple" : "build",
    complexity: input.graph.complexity,
    reason,
    maxAiCalls,
    maxOutputTokens,
    confidence: Math.max(0.5, Math.min(1, input.intent.confidence)),
  };
}