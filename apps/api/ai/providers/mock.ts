import type { AIProvider, AIProviderStatus } from "../types.js";

type BuilderStage = "read" | "scaffold" | "app" | "style" | "test" | "done";

const builderStages = new Map<string, BuilderStage>();

export class MockProvider implements AIProvider {
  id = "mock";
  name = "NEXUM E2E Mock";
  model = "e2e-v1";
  capabilities = {
    text: true,
    code: true,
    vision: false,
    toolCalling: false,
    streaming: false,
    structuredOutput: true,
    reasoning: false,
    contextWindow: 32_000,
  } as const;

  async generate(message: string): Promise<string> {
    // Preserve the lightweight mock semantics used by unit tests. The richer
    // deterministic planner is enabled only by the E2E-only environment flag.
    if (process.env.NEXUM_E2E_MOCK_AI !== "true") return `NEXUM Demo: ${message}`;

    if (/Turn the user's request into a concrete implementation plan for a coding agent/i.test(message)) {
      const userRequest = message.match(/User request:\s*([^\n]*)/i)?.[1]?.trim() ?? "";
      const requestLower = userRequest.toLowerCase();
      const autoRequested = /авто|автомобил|автосервис|диагностик|ремонт.*машин|ремонт.*авто|сто/.test(requestLower);
      const constructionRequested = /строит|демонтаж|отделк|стяжк|подряд|монтаж|бетон/.test(requestLower);
      const productType = autoRequested
        ? "Сайт автосервиса"
        : constructionRequested
          ? "Сайт строительной компании"
          : userRequest
            ? `Продукт по запросу: ${userRequest.slice(0, 100)}`
            : "E2E validation task";
      const goal = autoRequested
        ? "Сайт автосервиса для диагностики и ремонта автомобилей с услугами, преимуществами и записью."
        : constructionRequested
          ? "Сайт строительной компании с услугами, примерами работ и формой заявки."
          : userRequest
            ? `Реализовать запрошенный продукт: ${userRequest.slice(0, 180)}`
            : "Проверить и выполнить запрос пользователя в тестовом окружении NEXUM.";
      return JSON.stringify({
        goal,
        productType,
        targetUser: autoRequested ? "Владельцы автомобилей" : constructionRequested ? "Заказчики строительных работ" : "Пользователи продукта",
        pages: autoRequested ? ["Главная", "Услуги", "Контакты"] : constructionRequested ? ["Главная", "Услуги", "Объекты", "Контакты"] : ["Главная", "Основной раздел", "Контакты"],
        components: autoRequested ? ["Каталог услуг автосервиса", "Карточки диагностики и ремонта", "Форма записи"] : constructionRequested ? ["Каталог услуг", "Карточки объектов", "Форма заявки"] : ["Навигация", "Основной контент", "Форма обратной связи"],
        visualSystem: ["Адаптивная сетка", "Контрастная типографика", "Согласованная цветовая система"],
        interactions: autoRequested ? ["Запись на диагностику", "Переход к услугам"] : ["Навигация", "Отправка формы"],
        dataModel: autoRequested ? ["Услуга автосервиса", "Заявка на запись"] : constructionRequested ? ["Строительная услуга", "Заявка клиента"] : ["Основная сущность", "Заявка пользователя"],
        filesToInspect: [],
        filesToChange: [],
        acceptanceCriteria: autoRequested ? ["Контент явно описывает диагностику и ремонт автомобилей", "Есть услуги автосервиса и способ записи"] : constructionRequested ? ["Контент соответствует строительной тематике", "Есть услуги и форма заявки"] : ["Реализован предмет исходного запроса", "Приложение проходит проверку"],
      });
    }

    if (/You are the NEXUM final implementation reviewer/i.test(message)) {
      return JSON.stringify({ passed: true, missing: [], risks: [] });
    }

    // Builder E2E state is tracked per active project instead of being inferred from
    // compacted tool history. The latter is intentionally lossy and must never be the
    // source of truth for an acceptance workflow.
    const userTask = message.match(/User (?:task|request):\s*([^\n]*)/i)?.[1]?.trim() ?? "";
    const isBuilderTask = /создай|сделай|разработай|build|create|make|сайт|приложени|лендинг|dashboard|landing|web app|website|marketplace|crm/i.test(userTask) || /автосервис|автомобил|диагностик.*авто|ремонт.*авто/i.test(message);

    if (/You are the NEXUM\.DEV autonomous project builder|previous response was not valid nexum tool-plan json/i.test(message)) {
      if (isBuilderTask) {
        const projectKey = message.match(/(?:ID проекта|projectId)\s*[:=]\s*([A-Za-z0-9_-]+)/i)?.[1] ?? userTask;
        let current = builderStages.get(projectKey) ?? "read";
        // Empty projects are scaffolded by AgentLoop before the first Builder model turn.
        // Skip the legacy read/scaffold stages when history already confirms the scaffold.
        const scaffoldAlreadyCreated = /scaffoldProject:[^\n]*(?:scaffold created|created for test)/i.test(message);
        if (scaffoldAlreadyCreated && (current === "read" || current === "scaffold")) {
          current = "app";
          builderStages.set(projectKey, current);
        }

        switch (current) {
          case "read":
            builderStages.set(projectKey, "scaffold");
            return JSON.stringify({ tool: "readFile", input: "index.html" });
          case "scaffold":
            builderStages.set(projectKey, "app");
            return JSON.stringify({ tool: "scaffoldProject", input: "Сделай React/Vite сайт автосервиса с диагностикой и ремонтом автомобилей" });
          case "app":
            builderStages.set(projectKey, "style");
            return JSON.stringify({
              tool: "writeFile",
              input: {
                path: "src/App.jsx",
                content: "export default function App(){return <main><h1>Диагностика и ремонт автомобилей</h1><p>Автосервис полного цикла.</p><button>Записаться на диагностику</button></main>}",
              },
            });
          case "style":
            builderStages.set(projectKey, "test");
            return JSON.stringify({
              tool: "writeFile",
              input: {
                path: "src/styles.css",
                content: "html,body,#root{min-height:100%;margin:0}body{font-family:system-ui,sans-serif;background:#101010;color:#fff}main{min-height:100vh;padding:48px;box-sizing:border-box}h1{font-size:64px}",
              },
            });
          case "test":
            builderStages.set(projectKey, "done");
            return JSON.stringify({ tool: "testProject", input: "." });
          case "done":
            return JSON.stringify({ done: true, finalResponse: "Сайт автосервиса создан, собран и проверен в Preview." });
        }
      }

      // Non-builder tasks continue into the shared tool-history handler below.
    }

    // Non-builder E2E tasks must execute at least one real tool action before
    // proposing completion. This keeps the mock aligned with the Completion Gate
    // and lets failure-injection tests exercise retries and cancellation.
    const history = message.split(/Previous tool results:\s*/i)[1] ?? "";
    if (/No tools have run yet\./i.test(history)) {
      return JSON.stringify({ tool: "listFiles", input: "." });
    }

    const lastHistoryLine = history.trim().split("\n").at(-1) ?? "";
    if (/^listFiles:/i.test(lastHistoryLine) && /injected|failure|error|ошиб/i.test(lastHistoryLine)) {
      return JSON.stringify({ tool: "readFile", input: "index.html" });
    }

    return JSON.stringify({ done: true, finalResponse: "Проверка завершена." });
  }

  async listModels(): Promise<string[]> {
    return [this.model];
  }

  async getStatus(model = this.model): Promise<AIProviderStatus> {
    return {
      available: process.env.NEXUM_E2E_MOCK_AI === "true",
      model,
      latencyMs: process.env.NEXUM_E2E_MOCK_AI === "true" ? 0 : null,
      ...(process.env.NEXUM_E2E_MOCK_AI === "true" ? {} : { error: "Demo provider is not a real AI model" }),
    };
  }
}
