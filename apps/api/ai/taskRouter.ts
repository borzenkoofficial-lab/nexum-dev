import type { AIOrchestratorRole } from "./orchestrator.js";
import { extractIntent } from "./intentEngine.js";

export type ExecutionMode = "simple" | "build" | "debug" | "review";

export interface TaskRoutingDecision {
  role: AIOrchestratorRole;
  mode: ExecutionMode;
  requiresBuilder: boolean;
  requiresDebugger: boolean;
  requiresVerification: boolean;
  complexity: "low" | "medium" | "high";
  domain: ReturnType<typeof extractIntent>["domain"];
  productType: string;
}

const BUILD = /создай|сделай|разработай|построй|build|create|make|сайт|приложени|лендинг|dashboard|landing|web app|website|marketplace|crm|ui|код|code|добавь|измени|поменяй|реализ/i;
const DEBUG = /ошиб|error|debug|не работает|слом|fix\s+(?:ошиб|баг|код|проблем)|исправь\s+(?:ошиб|баг|код|проблем)|exception|failed|crash|build failed|compile (?:error|failed)/i;
const RUNTIME = /runtime|preview|предпросмотр|iframe|unhandledrejection|uncaught|stack trace|white screen|белый экран/i;
const REVIEW = /проверь|провер|ревью|review|audit|аудит|оцени код|найди проблемы/i;
const COMPLEX = /полностью|с нуля|full|production|продакш|автоном|marketplace|crm|backend|база|database|auth|авторизац|интеграц|api|платформ/i;

export function routeTask(task: string): TaskRoutingDecision {
  const text = task.trim();
  const intent = extractIntent(text);
  const debugging = intent.mode === "debug" || DEBUG.test(text) || RUNTIME.test(text);
  const building = BUILD.test(text) || intent.mode === "create" || intent.mode === "modify";
  const review = intent.mode === "review" || REVIEW.test(text);
  const complex = COMPLEX.test(text) || intent.features.length >= 3;

  if (debugging) return {
    role: "debugger",
    mode: "debug",
    requiresBuilder: true,
    requiresDebugger: true,
    requiresVerification: true,
    complexity: complex ? "high" : "medium",
    domain: intent.domain,
    productType: intent.productType,
  };
  if (review && !building) return {
    role: "reviewer",
    mode: "review",
    requiresBuilder: false,
    requiresDebugger: false,
    requiresVerification: true,
    complexity: complex ? "high" : "low",
    domain: intent.domain,
    productType: intent.productType,
  };
  if (building) return {
    role: "coder",
    mode: "build",
    requiresBuilder: true,
    requiresDebugger: false,
    requiresVerification: true,
    complexity: complex ? "high" : "medium",
    domain: intent.domain,
    productType: intent.productType,
  };
  return {
    role: "planner",
    mode: "simple",
    requiresBuilder: false,
    requiresDebugger: false,
    requiresVerification: false,
    complexity: complex ? "medium" : "low",
    domain: intent.domain,
    productType: intent.productType,
  };
}

export function executionBudget(decision: TaskRoutingDecision): {
  maxAiCalls: number;
  maxOutputTokens: number;
} {
  if (decision.mode === "simple") return { maxAiCalls: 1, maxOutputTokens: 1200 };
  if (decision.mode === "review") return { maxAiCalls: 1, maxOutputTokens: 1800 };
  if (decision.mode === "debug") return { maxAiCalls: 3, maxOutputTokens: 6500 };
  if (decision.complexity === "high") return { maxAiCalls: 4, maxOutputTokens: 8500 };
  return { maxAiCalls: 3, maxOutputTokens: 6500 };
}
