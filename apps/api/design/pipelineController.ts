import type { PipelineGate, PipelineSnapshot } from "./autonomousPipeline.js";

export type PipelineRecoveryAction =
  | "plan-design"
  | "implement-components"
  | "implement-interactions"
  | "rebuild"
  | "diagnose"
  | "refresh-live"
  | "finish";

export interface PipelineControllerState {
  attempts: number;
  maxAttempts: number;
  lastGate?: string;
  lastAction?: PipelineRecoveryAction;
}

export interface PipelineControllerDecision {
  passed: boolean;
  action: PipelineRecoveryAction;
  gate?: PipelineGate;
  attempts: number;
  exhausted: boolean;
  reason: string;
}

const ACTIONS: Record<string, PipelineRecoveryAction> = {
  design: "plan-design",
  components: "implement-components",
  interactions: "implement-interactions",
  verification: "diagnose",
  build: "rebuild",
  live: "refresh-live",
};

export function createPipelineController(maxAttempts = 3): PipelineControllerState {
  return { attempts: 0, maxAttempts: Math.max(1, maxAttempts) };
}

export function decidePipelineRecovery(
  snapshot: Pick<PipelineSnapshot, "design" | "componentCount" | "interactionCount" | "verification" | "live" | "buildVerified">,
  gates: PipelineGate[],
  state: PipelineControllerState,
): PipelineControllerDecision {
  const failed = gates.find((gate) => !gate.passed);
  if (!failed) {
    return {
      passed: true,
      action: "finish",
      attempts: state.attempts,
      exhausted: false,
      reason: "All autonomous pipeline gates passed.",
    };
  }

  const nextAttempts = state.attempts + 1;
  const action = ACTIONS[failed.name] ?? "diagnose";
  state.attempts = nextAttempts;
  state.lastGate = failed.name;
  state.lastAction = action;

  return {
    passed: false,
    action,
    gate: failed,
    attempts: nextAttempts,
    exhausted: nextAttempts > state.maxAttempts,
    reason: failed.detail,
  };
}

export function recoveryPromptFor(decision: PipelineControllerDecision): string {
  if (decision.passed) return "Все контрольные ворота NEXUM пройдены. Заверши задачу.";
  const gate = decision.gate?.name ?? "unknown";
  const instructions: Record<PipelineRecoveryAction, string> = {
    "plan-design": "Проверь Intent и DesignSpec. Исправь дизайн-контракт под точный домен пользователя.",
    "implement-components": "Проверь обязательные компоненты DesignSpec и реализуй отсутствующие компоненты.",
    "implement-interactions": "Проверь Interaction Contract и реализуй отсутствующие интерактивные сценарии.",
    rebuild: "Найди причину провала production build, исправь её и повторно выполни npm run build.",
    diagnose: "Проанализируй конкретный провал визуальной/domain/runtime проверки, внеси минимальный исправляющий патч и повтори проверку.",
    "refresh-live": "Проверь production preview и пересобери приложение, если live entry отсутствует или устарел.",
    finish: "Проверь все контрольные ворота и заверши только при полном успехе.",
  };
  return [
    "NEXUM AUTONOMOUS PIPELINE RECOVERY.",
    `Failed gate: ${gate}.`,
    `Recovery attempt: ${decision.attempts}/${decision.gate ? "bounded" : "bounded"}.`,
    instructions[decision.action],
    "Не меняй домен продукта. Не создавай новый проект. Используй существующий код и минимальный корректный патч.",
    "После исправления обязательно повтори соответствующую проверку.",
  ].join("\n");
}
