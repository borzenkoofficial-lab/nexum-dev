import type { AIOrchestratorRole } from "./orchestrator.js";
import { getModelRegistry, routesForRole } from "./modelRegistry.js";

export type DirectorMode = "auto" | "economy" | "quality" | "speed";

export interface DirectorDecision {
  role: AIOrchestratorRole;
  provider?: string;
  model?: string;
  reason: string;
  priority: "low" | "normal" | "high" | "critical";
  maxTokens?: number;
}

export interface DirectorBudget {
  tier: "micro" | "small" | "medium" | "large";
  maxTokens: number;
  remainingTokens: number;
}

export class NexumDirector {
  decide(task: string, mode: DirectorMode = "auto", budget?: DirectorBudget): DirectorDecision[] {
    const text = task.toLowerCase();
    const complex = /с нуля|полноцен|saas|crm|marketplace|backend|api|база данных|database|auth|авторизац|интеграц|connector|mcp|многостранич|from scratch/.test(text);
    const debugging = /ошиб|bug|debug|не работает|сломал|fix|исправь|тест|build|ci|compile|typecheck/.test(text);
    const visual = /дизайн|ui|ux|страниц|лендинг|сайт|dashboard|интерфейс/.test(text);
    const availableProviders = new Set(
      getModelRegistry().filter((route) => route.enabled).map((route) => route.provider),
    );

    const pick = (role: AIOrchestratorRole, reason: string, priority: DirectorDecision["priority"]): DirectorDecision => {
      const route = routesForRole(role, availableProviders)[0];
      return {
        role,
        provider: route?.provider,
        model: route?.model,
        maxTokens: route?.maxTokens,
        reason,
        priority,
      };
    };

    const limit = budget?.remainingTokens ?? budget?.maxTokens ?? Number.POSITIVE_INFINITY;
    const allow = (decisions: DirectorDecision[]): DirectorDecision[] => {
      let remaining = limit;
      const selected: DirectorDecision[] = [];
      for (const decision of decisions) {
        const cost = decision.maxTokens ?? 0;
        if (selected.length > 0 && remaining < cost) break;
        selected.push(decision);
        remaining -= cost;
      }
      return selected.length ? selected : [pick("general", "Бюджет ограничен: выполняю минимальный безопасный маршрут.", "normal")];
    };

    if (mode === "speed") {
      return allow([pick(debugging ? "debugger" : visual ? "coder" : "general", "Режим Speed: использую один специализированный проход.", "normal")]);
    }

    if (mode === "economy" || (!complex && !debugging && !visual)) {
      return allow([pick(debugging ? "debugger" : "coder", "Экономичный маршрут: один специализированный исполнитель без лишней декомпозиции.", debugging ? "high" : "normal")]);
    }

    if (complex) {
      return allow([
        pick("director", "Сначала декомпозирую сложную задачу.", "high"),
        pick("coder", "Затем выполняю основную реализацию.", "high"),
        pick("tester", "После изменения выполняю независимую дешёвую проверку.", "normal"),
      ]);
    }

    if (debugging) {
      return allow([
        pick("director", "Определяю причину и минимальный порядок восстановления.", "high"),
        pick("debugger", "Выполняю глубокую диагностику и точечное исправление.", "high"),
        pick("tester", "Проверяю исправление отдельным проходом.", "normal"),
      ]);
    }

    return allow([
      pick("director", "Планирую задачу перед изменением проекта.", "normal"),
      pick("coder", "Выполняю основную разработку.", "normal"),
    ]);
  }

  shouldEscalate(failureCount: number, buildFailed: boolean, runtimeFailed: boolean): boolean {
    return failureCount >= 2 || (buildFailed && runtimeFailed);
  }

  shouldParallelize(independentTasks: number, sharedMutableFiles: boolean): boolean {
    return independentTasks >= 2 && !sharedMutableFiles;
  }
}
