import type { AIGateway, GatewayGenerateOptions } from "./gateway.js";
import { AIModelRegistry, type AIModelRequirement } from "./modelRegistry.js";

export type AIOrchestratorRole =
  | "planner" | "coder" | "reviewer" | "debugger" | "tester" | "finalizer" | "general" | "director";

export interface AIOrchestratorRun {
  role: AIOrchestratorRole;
  provider: string;
  model: string;
  response: string;
  fallback: boolean;
}

const ROLE_REQUIREMENTS: Record<AIOrchestratorRole, AIModelRequirement> = {
  director: { text: true },
  planner: { text: true },
  coder: { text: true, code: true },
  reviewer: { text: true, code: true },
  debugger: { text: true, code: true },
  tester: { text: true, code: true },
  finalizer: { text: true },
  general: { text: true },
};

export class AIOrchestrator {
  private readonly registry: AIModelRegistry;

  constructor(private readonly gateway: AIGateway) {
    this.registry = new AIModelRegistry(gateway);
  }

  async run(role: AIOrchestratorRole, prompt: string, options?: GatewayGenerateOptions): Promise<AIOrchestratorRun> {
    const requested = options?.model?.trim();
    const explicitProvider = options?.provider?.trim();
    const selected = await this.registry.select(ROLE_REQUIREMENTS[role], {
      ...(explicitProvider ? { provider: explicitProvider } : {}),
      ...(requested ? { model: requested } : {}),
    });

    if (requested && !selected) {
      throw new Error(`Selected model does not satisfy the ${role} capability contract: ${requested}`);
    }
    if (!selected) {
      throw new Error(`No configured AI model satisfies the ${role} capability contract`);
    }

    const maxTokens = Math.min(
      options?.maxTokens && options.maxTokens > 0 ? options.maxTokens : this.maxTokensFor(role),
      this.maxTokensFor(role),
    );

    const generation = await this.gateway.generateWithMetadata(this.decoratePrompt(role, prompt), {
      ...options,
      provider: selected.provider,
      model: selected.model,
      maxTokens,
    });

    return {
      role,
      provider: generation.provider,
      model: generation.model,
      response: generation.response,
      fallback: generation.fallback,
    };
  }

  modelFor(_role: AIOrchestratorRole): string {
    return this.gateway.getDefaultModel();
  }

  async getRoleModel(role: AIOrchestratorRole, provider?: string): Promise<string | null> {
    const selected = await this.registry.select(ROLE_REQUIREMENTS[role], provider ? { provider } : {});
    return selected?.model ?? null;
  }

  getRoleRequirements(): Record<AIOrchestratorRole, AIModelRequirement> {
    return Object.fromEntries(Object.entries(ROLE_REQUIREMENTS).map(([role, requirement]) => [role, { ...requirement }])) as Record<AIOrchestratorRole, AIModelRequirement>;
  }

  private maxTokensFor(role: AIOrchestratorRole): number {
    switch (role) {
      case "director":
      case "planner":
      case "reviewer":
      case "tester":
        return 1_200;
      case "debugger":
        return 3_000;
      case "coder":
        return 5_000;
      default:
        return 900;
    }
  }

  private decoratePrompt(role: AIOrchestratorRole, prompt: string): string {
    const roleInstruction: Record<AIOrchestratorRole, string> = {
      planner: "You are the planning/orchestration specialist. Choose the safest next tool action and keep the plan minimal.",
      coder: "You are the implementation specialist. Produce precise, production-ready changes and prefer existing project conventions.",
      reviewer: "You are the code reviewer. Find concrete correctness, security, UX, and build issues. Do not invent problems.",
      debugger: "You are the debugging specialist. Trace the reported failure to a concrete cause and propose the smallest correct fix.",
      tester: "You are the verification specialist. Determine what must be checked and interpret test/build output precisely.",
      finalizer: "You are the release/finalization specialist. Summarize verified work and remaining concrete issues without dumping code.",
      director: "You are the NEXUM director. Decompose the task, assign roles, control budget and escalation, and do not write project code.",
      general: "You are a general NEXUM.DEV assistant. Be concise and technically precise.",
    };
    return [`NEXUM.DEV AI role: ${role}`, roleInstruction[role], "Do not expose internal chain-of-thought. Return only the requested result.", prompt].join("\n");
  }
}
