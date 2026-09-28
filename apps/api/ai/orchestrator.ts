import type { AIGateway, GatewayGenerateOptions } from "./gateway.js";
import { routesForRole } from "./modelRegistry.js";

export type AIOrchestratorRole =
  | "director"
  | "planner"
  | "coder"
  | "reviewer"
  | "debugger"
  | "tester"
  | "finalizer"
  | "general";

export interface AIOrchestratorRun {
  role: AIOrchestratorRole;
  provider: string;
  model: string;
  response: string;
  fallback: boolean;
}

export class AIOrchestrator {
  constructor(private readonly gateway: AIGateway) {}

  async run(
    role: AIOrchestratorRole,
    prompt: string,
    options?: GatewayGenerateOptions,
  ): Promise<AIOrchestratorRun> {
    const requested = options?.model?.trim();
    const explicitProvider = options?.provider?.trim();
    const availableProviders = new Set(this.gateway.getProviders().map((provider) => provider.id));
    const routes = routesForRole(role, availableProviders);

    const providerDefault = explicitProvider && !requested
      ? this.gateway.getDefaultModel(explicitProvider)
      : undefined;

    const candidates = requested
      ? [{ provider: explicitProvider, model: requested }]
      : explicitProvider && providerDefault
        ? [{ provider: explicitProvider, model: providerDefault }]
        : routes.length
          ? routes.map((route) => ({ provider: route.provider, model: route.model }))
          : [{ provider: this.gateway.getDefaultProviderId(), model: this.gateway.getDefaultModel() }];

    let lastError: unknown;

    for (const candidate of candidates) {
      try {
        const route = routes.find((item) => item.provider === candidate.provider && item.model === candidate.model);
        const generation = await this.gateway.generateWithMetadata(
          this.decoratePrompt(role, prompt),
          {
            ...options,
            ...(candidate.provider ? { provider: candidate.provider } : {}),
            model: candidate.model,
            maxTokens: Math.min(
              options?.maxTokens && options.maxTokens > 0
                ? options.maxTokens
                : route?.maxTokens ?? this.maxTokensFor(role),
              route?.maxTokens ?? this.maxTokensFor(role),
            ),
          },
        );
        return {
          role,
          provider: generation.provider,
          model: generation.model,
          response: generation.response,
          fallback: generation.fallback,
        };
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[agent] ${role} model ${candidate.model} failed: ${message}`);
        if (requested || !this.shouldTryNextModel(message)) break;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`No AI model available for role ${role}`);
  }

  modelFor(role: AIOrchestratorRole): string {
    const providers = new Set(this.gateway.getProviders().map((provider) => provider.id));
    return routesForRole(role, providers)[0]?.model ?? this.gateway.getDefaultModel();
  }

  getRoleModels(): Record<AIOrchestratorRole, string[]> {
    const providers = new Set(this.gateway.getProviders().map((provider) => provider.id));
    const roles: AIOrchestratorRole[] = ["director", "planner", "coder", "reviewer", "debugger", "tester", "finalizer", "general"];
    return Object.fromEntries(
      roles.map((role) => [role, routesForRole(role, providers).map((route) => route.model)]),
    ) as Record<AIOrchestratorRole, string[]>;
  }

  private shouldTryNextModel(message: string): boolean {
    return /(?:429|rate.?limit|too many requests|temporar|timeout|timed out|5\d{2}|network error|fetch failed)/i.test(message);
  }

  private maxTokensFor(role: AIOrchestratorRole): number {
    switch (role) {
      case "director":
      case "planner":
        return 1_800;
      case "reviewer":
      case "tester":
        return 1_600;
      case "debugger":
        return 3_000;
      case "coder":
        return 5_000;
      case "finalizer":
      case "general":
      default:
        return 1_000;
    }
  }

  private decoratePrompt(role: AIOrchestratorRole, prompt: string): string {
    const roleInstruction: Record<AIOrchestratorRole, string> = {
      director: "You are the NEXUM Director. Decompose the task, select the smallest safe execution path, and delegate only when necessary.",
      planner: "You are the planning/orchestration specialist. Choose the safest next tool action and keep the plan minimal.",
      coder: "You are the implementation specialist. Produce precise, production-ready changes and prefer existing project conventions.",
      reviewer: "You are the code reviewer. Find concrete correctness, security, UX, and build issues. Do not invent problems.",
      debugger: "You are the debugging specialist. Trace the reported failure to a concrete cause and propose the smallest correct fix.",
      tester: "You are the verification specialist. Determine what must be checked and interpret test/build output precisely.",
      finalizer: "You are the release/finalization specialist. Summarize verified work and remaining concrete issues without dumping code.",
      general: "You are a general NEXUM.DEV assistant. Be concise and technically precise.",
    };
    return [
      `NEXUM.DEV AI role: ${role}`,
      roleInstruction[role],
      "Do not expose internal chain-of-thought. Return only the requested result.",
      prompt,
    ].join("\n");
  }
}
