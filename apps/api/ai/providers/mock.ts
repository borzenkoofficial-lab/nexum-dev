import type { AIProvider, AIProviderStatus } from "../types.js";

export class MockProvider implements AIProvider {
  id = "mock";
  name = "NEXUM E2E Mock";
  model = "e2e-v1";
  capabilities = {
    text: true,
    code: false,
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

    if (/You are the NEXUM\\.DEV autonomous project builder/i.test(message)) {
      if (/строительной компании/.test(message)) {
        const history = message.match(/Previous tool results:\\n([\\s\\S]*?)(?:\\n\\n|$)/i)?.[1] ?? "";
        const writes = (history.match(/writeFile:/g) ?? []).length;
        if (writes === 0) return JSON.stringify({ tool: "writeFile", input: { path: "index.html", content: "<!doctype html><html lang=\"ru\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Строительная компания</title><link rel=\"stylesheet\" href=\"/style.css\"></head><body><main><header><strong>СТРОЙКА</strong><a href=\"#contact\">Оставить заявку</a></header><section><p>Демонтаж и строительные работы</p><h1>Надёжно выполняем сложные объекты</h1><p>Демонтаж, подготовка и строительные работы для коммерческих и частных объектов.</p><a id=\"contact\" href=\"#form\">Получить расчёт</a></section><section><h2>Наши услуги</h2><div><article>Демонтаж</article><article>Подготовка объекта</article><article>Строительные работы</article></div></section><section><h2>Объекты</h2><p>Коммерческие помещения, производственные площадки и частные объекты.</p></section><section><h2>Почему нам доверяют</h2><p>Опыт, соблюдение сроков и прозрачная смета.</p></section><section id=\"form\"><h2>Заявка</h2><form><input placeholder=\"Имя\"><input placeholder=\"Телефон\"><button>Получить расчёт</button></form></section></main></body></html>" }});
        if (writes === 1) return JSON.stringify({ tool: "writeFile", input: { path: "style.css", content: "body{margin:0;font-family:Arial,sans-serif;background:#f4f4f2;color:#171717}main{max-width:1180px;margin:auto;padding:32px}header{display:flex;justify-content:space-between}section{padding:72px 0}h1{font-size:64px;max-width:800px}section div{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}article{padding:28px;background:#fff;border:1px solid #ddd}form{display:grid;gap:12px;max-width:420px}input,button{padding:14px;font:inherit}" }});
        if (!/runCommand:\\s*npm run build/i.test(history)) return JSON.stringify({ tool: "runCommand", input: "npm run build" });
        if (!/validateProject:/i.test(history)) return JSON.stringify({ tool: "validateProject", input: "." });
        if (!/testProject:/i.test(history)) return JSON.stringify({ tool: "testProject", input: "." });
        return JSON.stringify({ done: true, finalResponse: "Сайт строительной компании создан, собран и проверен." });
      }
      if (/Previous tool results:[\\s\\S]*searchFiles:/i.test(message)) return JSON.stringify({ done: true, finalResponse: "Проверка завершена." });
      return /listFiles:\\s*\\./i.test(message) ? JSON.stringify({ tool: "searchFiles", input: "export" }) : JSON.stringify({ tool: "listFiles", input: "." });
    }

    if (/previous response was not valid nexum tool-plan json/i.test(message)) {
      return JSON.stringify({ tool: "listFiles", input: "." });
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
