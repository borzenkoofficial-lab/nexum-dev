import type { AIGateway, GatewayGenerateOptions } from "./gateway.js";

export type AIOrchestratorRole =
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

const ROLE_MODELS: Record<AIOrchestratorRole, string[]> = {
  planner: [
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "nvidia/nemotron-3.5-lightning:free",
    "qwen/qwen3.8-27b:free",
    "dots-studio/dots3-note-preview:free",
  ],
  coder: [
    "cohere/north-mini-code:free",
    "poolside/laguna-s-2.1:free",
    "poolside/laguna-xs-2.1:free",
    "qwen/qwen3.8-27b:free",
  ],
  reviewer: [
    "qwen/qwen3.8-27b:free",
    "dots-studio/dots3-note-preview:free",
    "nvidia/nemotron-3.5-lightning:free",
  ],
  debugger: [
    "cohere/north-mini-code:free",
    "poolside/laguna-s-2.1:free",
    "qwen/qwen3.8-27b:free",
  ],
  tester: [
    "cohere/north-mini-code:free",
    "qwen/qwen3.8-27b:free",
  ],
  finalizer: [
    "qwen/qwen3.8-27b:free",
    "nvidia/nemotron-3.5-lightning:free",
  ],
  general: [
    "qwen/qwen3.8-27b:free",
    "nvidia/nemotron-3.5-lightning:free",
  ],
};

export class AIOrchestrator {
  constructor(private readonly gateway: AIGateway) {}

  async run(
    role: AIOrchestratorRole,
    prompt: string,
    options?: GatewayGenerateOptions,
  ): Promise<AIOrchestratorRun> {
    const requested = options?.model?.trim();
    const explicitProvider = options?.provider?.trim();
    const activeProvider = explicitProvider || this.gateway.getDefaultProviderId();
    // For concrete providers, the configured provider model is authoritative
    // unless the user explicitly selected another model. Role-specific model
    // catalogs are only used by OpenRouter, whose purpose here is model routing.
    const providerDefault = activeProvider !== "openrouter" && activeProvider !== "mock"
      ? this.gateway.getDefaultModel(activeProvider)
      : undefined;
    const candidates = ROLE_MODELS[role];
    const models = requested
      ? [requested]
      : providerDefault
        ? [providerDefault]
        : candidates.length
          ? candidates
          : ["openrouter/free"];
    let lastError: unknown;

    // If the caller selected a concrete model, make exactly one request. For the
    // automatic router, fail over across the role's compatible models instead of
    // repeatedly asking one rate-limited endpoint. A 429 from one model therefore
    // does not immediately collapse the whole Builder session.
    for (const model of models) {
      try {
        const generation = await this.gateway.generateWithMetadata(
          this.decoratePrompt(role, prompt),
          {
            ...options,
            model,
            maxTokens: Math.min(
              options?.maxTokens && options.maxTokens > 0 ? options.maxTokens : this.maxTokensFor(role),
              this.maxTokensFor(role),
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
        console.warn(`[agent] ${role} model ${model} failed: ${message}`);
        if (requested || !this.shouldTryNextModel(message)) break;
      }
    }

    throw lastError instanceof Error ? lastError : new Error(`No AI model available for role ${role}`);
  }

  private shouldTryNextModel(message: string): boolean {
    return /(?:429|rate.?limit|too many requests|temporar|timeout|timed out|5\d{2})/i.test(message);
  }

  private maxTokensFor(role: AIOrchestratorRole): number {
    switch (role) {
      case "planner":
        return 1_200;
      case "reviewer":
      case "tester":
        return 1_200;
      case "debugger":
        return 3_000;
      case "coder":
        return 5_000;
      case "finalizer":
      case "general":
      default:
        return 900;
    }
  }

  modelFor(role: AIOrchestratorRole): string {
    return ROLE_MODELS[role].at(0) ?? "openrouter/free";
  }

  getRoleModels(): Record<AIOrchestratorRole, string[]> {
    return Object.fromEntries(
      Object.entries(ROLE_MODELS).map(([role, models]) => [role, [...models]]),
    ) as Record<AIOrchestratorRole, string[]>;
  }

  private decoratePrompt(role: AIOrchestratorRole, prompt: string): string {
    const roleInstruction: Record<AIOrchestratorRole, string> = {
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
