import type { AIOrchestratorRole } from "./orchestrator.js";

export type DirectorMode = "auto" | "economy" | "quality" | "speed";

export interface DirectorDecision {
  role: AIOrchestratorRole;
  provider?: "openai" | "anthropic" | "openrouter" | "orcarouter" | "ollama";
  model?: string;
  reason: string;
  priority: "low" | "normal" | "high" | "critical";
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

    if (mode === "speed") {
      return [{ role: debugging ? "debugger" : visual ? "coder" : "general", provider: "openai", model: "gpt-5.4-mini", reason: "Режим Speed: минимизирую задержку.", priority: "normal" }];
    }

    if (mode === "economy" || (!complex && !debugging && !visual)) {
      return [{ role: debugging ? "debugger" : "coder", provider: "openai", model: "gpt-5.4-mini", reason: "Экономичный маршрут для задачи без признаков сложной архитектуры.", priority: debugging ? "high" : "normal" }];
    }

    if (complex) {
      return [
        { role: "director", provider: "openai", model: "gpt-5.4", reason: "Декомпозирую сложную многошаговую задачу и распределяю работу.", priority: "high" },
        { role: "coder", provider: "anthropic", model: "claude-sonnet-5", reason: "Основная реализация и изменение нескольких файлов.", priority: "high" },
        { role: "tester", provider: "openai", model: "gpt-5.4-mini", reason: "Дешёвая независимая проверка после реализации.", priority: "normal" },
      ];
    }

    if (debugging) {
      return [
        { role: "director", provider: "openai", model: "gpt-5.4", reason: "Определяю причину и порядок восстановления.", priority: "high" },
        { role: "debugger", provider: "anthropic", model: "claude-sonnet-5", reason: "Глубокая диагностика и точечное исправление.", priority: "high" },
        { role: "tester", provider: "openai", model: "gpt-5.4-mini", reason: "Проверяю исправление отдельным дешёвым проходом.", priority: "normal" },
      ];
    }

    return [
      { role: "director", provider: "openai", model: "gpt-5.4", reason: "Планирую задачу перед изменением проекта.", priority: "normal" },
      { role: "coder", provider: "anthropic", model: "claude-sonnet-5", reason: "Выполняю основную разработку.", priority: "normal" },
    ];
  }

  shouldEscalate(failureCount: number, buildFailed: boolean, runtimeFailed: boolean): boolean {
    return failureCount >= 2 || (buildFailed && runtimeFailed);
  }

  shouldParallelize(independentTasks: number, sharedMutableFiles: boolean): boolean {
    return independentTasks >= 2 && !sharedMutableFiles;
  }
}
