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
  model: string;
  response: string;
}

const ROLE_MODELS: Record<AIOrchestratorRole, string[]> = {
  planner: [
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "nvidia/nemotron-3.5-lightning:free",
    "qwen/qwen3.8-27b:free",
  ],
  coder: [
    "cohere/north-mini-code:free",
    "poolside/laguna-s-2.1:free",
    "poolside/laguna-xs-2.1:free",
    "dots-studio/dots3-note-preview:free",
  ],
  reviewer: [
    "qwen/qwen3.8-27b:free",
    "dots-studio/dots3-note-preview:free",
    "nvidia/nemotron-3.5-lightning:free",
  ],
  debugger: [
    "cohere/north-mini-code:free",
    "poolside/laguna-s-2.1:free",
    "poolside/laguna-xs-2.1:free",
  ],
  tester: [
    "cohere/north-mini-code:free",
    "nvidia/nemotron-3.5-lightning:free",
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
    const candidates = ROLE_MODELS[role];
    const requested = options?.model?.trim();
    // If the user explicitly selected OpenRouter's free router, preserve it.
    // The provider is responsible for routing that request to an available free model.
    // Previously NEXUM replaced openrouter/free with a hard-coded role model, which
    // made the "free router" setting misleading and could select unavailable models.
    const model = requested
      ? requested
      : (candidates.at(0) ?? "openrouter/free");

    const response = await this.gateway.generate(
      this.decoratePrompt(role, prompt),
      { ...options, model },
    );

    return { role, model, response };
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
