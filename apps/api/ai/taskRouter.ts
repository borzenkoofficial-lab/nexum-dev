import type { AIOrchestratorRole } from "./orchestrator.js";

export type ExecutionMode = "simple" | "build" | "debug" | "review";

export interface TaskRoutingDecision {
  role: AIOrchestratorRole;
  mode: ExecutionMode;
  requiresBuilder: boolean;
  requiresDebugger: boolean;
  requiresVerification: boolean;
  complexity: "low" | "medium" | "high";
}

const BUILD = /создай|сделай|разработай|построй|build|create|make|сайт|приложени|лендинг|dashboard|landing|web app|website|marketplace|crm|ui|код|code|добавь|измени|поменяй|реализ/i;
const DEBUG = /ошиб|error|debug|не работает|слом|fix|исправ|exception|failed|crash|build failed|compile/i;
const REVIEW = /проверь|провер|ревью|review|audit|аудит|оцени код|найди проблемы/i;
const COMPLEX = /полностью|с нуля|full|production|продакш|автоном|marketplace|crm|backend|база|database|auth|авторизац|интеграц|api|платформ/i;

export function routeTask(task: string): TaskRoutingDecision {
  const text = task.trim();
  const debugging = DEBUG.test(text);
  const building = BUILD.test(text);
  const review = REVIEW.test(text);
  const complex = COMPLEX.test(text);

  if (debugging) return { role: "debugger", mode: "debug", requiresBuilder: true, requiresDebugger: true, requiresVerification: true, complexity: complex ? "high" : "medium" };
  if (review && !building) return { role: "reviewer", mode: "review", requiresBuilder: false, requiresDebugger: false, requiresVerification: true, complexity: complex ? "high" : "low" };
  if (building) return { role: "coder", mode: "build", requiresBuilder: true, requiresDebugger: false, requiresVerification: true, complexity: complex ? "high" : "medium" };
  return { role: "planner", mode: "simple", requiresBuilder: false, requiresDebugger: false, requiresVerification: false, complexity: complex ? "medium" : "low" };
}
