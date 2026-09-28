import type { NexumIntent } from "./intentEngine.js";

export type TaskNodeRole = "planner" | "coder" | "debugger" | "reviewer" | "tester";

export interface TaskNode {
  id: string;
  title: string;
  description: string;
  role: TaskNodeRole;
  dependencies: string[];
  affectedAreas: string[];
  verificationRequired: boolean;
  risk: "low" | "medium" | "high";
}

export interface TaskGraph {
  rootTask: string;
  mode: NexumIntent["mode"];
  complexity: "low" | "medium" | "high";
  nodes: TaskNode[];
  executionOrder: string[][];
  parallelizable: boolean;
}

export interface TaskDecompositionContext {
  relevantFiles?: string[];
  routes?: string[];
  architecture?: string[];
  health?: "unknown" | "ready" | "attention";
}

function node(
  id: string,
  title: string,
  description: string,
  role: TaskNodeRole,
  dependencies: string[],
  affectedAreas: string[],
  verificationRequired: boolean,
  risk: TaskNode["risk"],
): TaskNode {
  return { id, title, description, role, dependencies, affectedAreas, verificationRequired, risk };
}

function hasSharedArea(a: TaskNode, b: TaskNode): boolean {
  return a.affectedAreas.some((area) => b.affectedAreas.includes(area));
}

export function buildExecutionOrder(nodes: TaskNode[]): string[][] {
  const completed = new Set<string>();
  const order: string[][] = [];

  while (completed.size < nodes.length) {
    const ready = nodes
      .filter((candidate) => !completed.has(candidate.id))
      .filter((candidate) => candidate.dependencies.every((dependency) => completed.has(dependency)));

    if (!ready.length) {
      throw new Error("Task graph contains a dependency cycle or missing dependency.");
    }

    const batch: TaskNode[] = [];
    for (const candidate of ready) {
      if (batch.every((selected) => !hasSharedArea(selected, candidate))) {
        batch.push(candidate);
      }
    }

    const ids = batch.map((item) => item.id);
    for (const id of ids) completed.add(id);
    order.push(ids);
  }

  return order;
}

export function decomposeTask(
  task: string,
  intent: NexumIntent,
  context: TaskDecompositionContext = {},
): TaskGraph {
  const relevantFiles = context.relevantFiles ?? [];
  const complex = intent.features.length >= 3
    || /с нуля|полностью|production|prod|marketplace|crm|backend|api|database|база|интеграц|автоном/i.test(task);
  const attention = context.health === "attention";

  let nodes: TaskNode[];

  if (intent.mode === "debug") {
    nodes = [
      node("diagnose", "Диагностика", "Проверить текущий проект, воспроизвести/локализовать ошибку и определить минимальный набор файлов.", "debugger", [], relevantFiles, true, "high"),
      node("fix", "Исправление", "Внести минимальное точечное исправление без изменения бизнес-домена.", "debugger", ["diagnose"], relevantFiles, true, "high"),
      node("verify", "Проверка", "Запустить доступные проверки и убедиться, что исходная ошибка устранена.", "tester", ["fix"], ["build", "tests", "preview"], true, "medium"),
    ];
  } else if (intent.mode === "review") {
    nodes = [
      node("inspect", "Инспекция", "Изучить архитектуру, ключевые файлы и текущие ошибки без изменения продукта.", "reviewer", [], relevantFiles, false, "medium"),
      node("findings", "Выводы", "Сформировать конкретные проблемы, риски и порядок исправлений.", "reviewer", ["inspect"], ["architecture", "quality"], true, "medium"),
    ];
  } else if (!complex && intent.mode !== "create") {
    nodes = [
      node("implement", "Изменение", "Выполнить ограниченное изменение в релевантной области проекта.", "coder", [], relevantFiles, true, attention ? "medium" : "low"),
      node("verify", "Проверка", "Проверить изменённую область и сборку, если она доступна.", "tester", ["implement"], ["build", "tests"], true, "low"),
    ];
  } else if (!complex) {
    nodes = [
      node("implement", "Реализация", "Создать или изменить продукт строго в рамках распознанного домена и product type.", "coder", [], relevantFiles, true, "medium"),
      node("verify", "Проверка", "Проверить сборку и ключевые структурные требования.", "tester", ["implement"], ["build", "tests"], true, "low"),
    ];
  } else {
    nodes = [
      node("understand", "Понимание проекта", "Зафиксировать текущую архитектуру, точки входа, домен и ограничения перед изменением.", "planner", [], ["architecture", ...relevantFiles], false, "medium"),
      node("scaffold", "Основа", "Подготовить или скорректировать структуру приложения, сохраняя существующую инфраструктуру.", "coder", ["understand"], ["structure", "routes"], true, "high"),
      node("implement", "Основная реализация", "Реализовать продуктовые сценарии и интерфейс согласно структурированному intent.", "coder", ["scaffold"], ["ui", "product", "routes"], true, "high"),
      node("verify", "Верификация", "Запустить typecheck/test/lint/build и проверить отсутствие регрессий.", "tester", ["implement"], ["build", "tests", "runtime"], true, "high"),
    ];
  }

  const executionOrder = buildExecutionOrder(nodes);
  const parallelizable = executionOrder.some((batch) => batch.length > 1);

  return {
    rootTask: task.trim(),
    mode: intent.mode,
    complexity: complex ? "high" : nodes.length > 1 ? "medium" : "low",
    nodes,
    executionOrder,
    parallelizable,
  };
}

export function formatTaskGraph(graph: TaskGraph): string {
  return JSON.stringify({
    mode: graph.mode,
    complexity: graph.complexity,
    nodes: graph.nodes.map(({ id, role, dependencies, affectedAreas, verificationRequired, risk }) => ({
      id, role, dependencies, affectedAreas, verificationRequired, risk,
    })),
    executionOrder: graph.executionOrder,
  });
}
