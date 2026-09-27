import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { AIGateway, GatewayGenerateOptions } from "../ai/gateway.js";
import { AIOrchestrator } from "../ai/orchestrator.js";
import type {
  AgentModelOptions,
  AgentRuntime,
  AgentToolResult,
  AgentPlan,
  ProductPlan,
  ProductReview,
  Tool,
  ToolResult,
} from "./types.js";
import { ListFilesTool } from "./tools/listFiles.js";
import { ReadFileTool } from "./tools/readFile.js";
import { SearchFilesTool } from "./tools/searchFiles.js";
import { RunCommandTool } from "./tools/runCommand.js";
import { RunSandboxTool } from "./tools/runSandbox.js";
import { GitTool } from "./tools/git.js";
import { GitHubTool } from "./tools/github.js";
import { ProjectWorkspace } from "./tools/workspace.js";
import { WriteFileTool } from "./tools/writeFile.js";
import { ScaffoldProjectTool } from "./tools/scaffoldProject.js";
import { ValidateProjectTool } from "./tools/validateProject.js";

const defaultProjectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export class NexumAgent implements AgentRuntime {
  private readonly tools: Map<string, Tool>;
  private readonly orchestrator: AIOrchestrator;

  constructor(
    private readonly gateway: AIGateway,
    public readonly projectRoot = defaultProjectRoot,
  ) {
    this.orchestrator = new AIOrchestrator(gateway);
    const workspace = new ProjectWorkspace(projectRoot);
    const tools = [
      new ListFilesTool(workspace),
      new ReadFileTool(workspace),
      new WriteFileTool(workspace),
      new ScaffoldProjectTool(workspace),
      new ValidateProjectTool(workspace),
      new SearchFilesTool(workspace),
      new RunCommandTool(projectRoot),
      new RunSandboxTool(projectRoot),
      new GitTool(projectRoot),
      new GitHubTool(projectRoot),
    ];
    this.tools = new Map(tools.map((tool) => [tool.name, tool]));
  }

  async handle(task: string, options?: GatewayGenerateOptions): Promise<string> {
    console.log(`[agent] projectRoot: ${this.projectRoot}`);
    console.log(`[agent] task: ${task}`);
    const selection = this.plan(task, []);

    if (!selection) {
      return this.gateway.generate(task, options);
    }

    const result = await this.executeTool(selection.tool, selection.input);

    return this.gateway.generate(
      result.success
        ? `Инструмент ${selection.tool} выполнен. Результат:
${result.output}`
        : `Инструмент ${selection.tool} не выполнен: ${result.output}`,
      options,
    );
  }

  getAvailableTools(): string[] {
    return [...this.tools.keys()];
  }

  async createProductPlan(
    task: string,
    previousResults: AgentToolResult[],
    options?: AgentModelOptions,
  ): Promise<ProductPlan> {
    const inspection = previousResults
      .filter((item) => item.result.success)
      .map((item) => `${item.tool}: ${item.result.output.slice(0, 1200)}`)
      .join("\n");
    const prompt = [
      "You are the NEXUM product planner.",
      "Turn the user's request into a concrete implementation plan for a coding agent.",
      "Do not write source code. Do not discuss policy. Return JSON only.",
      "The plan must be specific enough that a different request produces a materially different application.",
      "Include concrete pages, components, visual system, interactions, data concepts, files to inspect/change, and acceptance criteria.",
      'JSON shape: {"goal":"...","productType":"...","targetUser":"...","pages":["..."],"components":["..."],"visualSystem":["..."],"interactions":["..."],"dataModel":["..."],"filesToInspect":["..."],"filesToChange":["..."],"acceptanceCriteria":["..."]}',
      `User request: ${task}`,
      `Current project inspection:\n${inspection || "No inspection result yet."}`,
    ].join("\n");
    try {
      const run = await this.orchestrator.run("planner", prompt, options);
      const parsed = this.parseProductPlan(run.response);
      if (parsed) return parsed;

      // A malformed response is worth one repair pass, but a provider rate-limit
      // is not: retrying immediately only burns another request and delays the
      // deterministic fallback. The caller will continue with a local plan.
      if (this.isRateLimitError(run.response)) {
        console.warn("[agent] product planner returned a rate-limit response; using deterministic plan");
        return this.fallbackProductPlan(task, previousResults);
      }

      const repair = await this.orchestrator.run("planner", [
        "Repair the previous planner output.",
        "Return ONLY one valid JSON object matching the exact Product Plan schema.",
        "No markdown, no code fences, no commentary.",
        "Preserve the user intent and make pages, components, interactions and acceptance criteria concrete.",
        `User request: ${task}`,
        `Previous planner output: ${run.response.slice(0, 6000)}`,
      ].join("\n"), options);
      const repaired = this.parseProductPlan(repair.response);
      if (repaired) return repaired;
    } catch (error) {
      console.warn("[agent] product planner failed, using deterministic plan", error);
    }
    return this.fallbackProductPlan(task, previousResults);
  }

  async reviewProduct(
    task: string,
    previousResults: AgentToolResult[],
    productPlan: ProductPlan,
    options?: AgentModelOptions,
  ): Promise<ProductReview> {
    const evidence = previousResults
      .filter((item) => item.result.success)
      .map((item) => `${item.tool}: ${item.result.output.slice(0, 1800)}`)
      .join("\n");
    const prompt = [
      "You are the NEXUM final implementation reviewer.",
      "Review whether the coding agent actually implemented the requested product, not merely a scaffold.",
      'Return JSON only: {"passed":true|false,"missing":["..."],"risks":["..."]}.',
      "Do not require backend functionality unless the user requested it.",
      "Treat placeholder/demo copy, generic starter UI, or an unverified build as a failure.",
      `User request: ${task}`,
      `Product plan: ${JSON.stringify(productPlan)}`,
      `Execution evidence:\n${evidence}`,
    ].join("\n");
    try {
      const run = await this.orchestrator.run("debugger", prompt, options);
      const parsed = this.parseProductReview(run.response);
      if (parsed) return parsed;
    } catch (error) {
      console.warn("[agent] product review failed", error);
    }
    const writes = previousResults.filter((item) => item.tool === "writeFile" && item.result.success).length;
    const built = previousResults.some((item) =>
      (item.tool === "runCommand" || item.tool === "runSandbox") &&
      /npm run build/.test(item.input) &&
      item.result.success,
    );
    const inspectedFiles = previousResults
      .filter((item) => item.result.success)
      .map((item) => item.result.output)
      .join("\n");
    const hasStaticEntry = /(?:^|\n)index\.html(?:\n|$)/.test(inspectedFiles);
    const hasPackage = /(?:^|\n)package\.json(?:\n|$)/.test(inspectedFiles);
    const previewReady = built || (hasStaticEntry && !hasPackage);
    return {
      passed: writes >= 2 && previewReady,
      missing: writes < 2
        ? ["Substantive implementation changes are missing."]
        : previewReady
          ? []
          : ["Production build or static preview readiness was not verified."],
      risks: [],
    };
  }

  async planWithAI(
    task: string,
    previousResults: AgentToolResult[],
    options?: AgentModelOptions,
    productPlan?: ProductPlan,
  ): Promise<AgentPlan | null> {
    const toolCatalog = [
      "listFiles: input is a relative directory path string, usually .",
      "readFile: input is a relative file path string",
      'writeFile: input is JSON object {"path":"relative/path","content":"file contents"}',
      "searchFiles: input is the text to search for",
      "scaffoldProject: input is the app brief; creates the project starter files only in an empty project",
      "validateProject: input is ., performs static validation of HTML/CSS/JS/JSON before Preview",
      "runCommand: input is one allowlisted command for the active project, such as npm install, npm run build or npm run test",
      'runSandbox: input is JSON object {"projectPath":".","command":"npm run build"}; projectPath is always forced to the active project',
      "git: input is one of status, diff, diff-stat, log, branch",
      "github: input is a read-only operation string",
    ].join("\n");

    const history = previousResults.length === 0
      ? "No tools have run yet."
      : previousResults
          .map((item) => `${item.tool}: ${item.result.output.slice(0, 1_800)}`)
          .join("\n");

    const prompt = [
      "You are the NEXUM.DEV autonomous project builder.",
      "Your job is to modify the user's project, not merely explain code.",
      "Choose exactly one available tool for the next action, or finish the task. Keep the JSON response as short as possible.",
      "For app-building tasks, NEVER jump straight to scaffoldProject. First inspect the current project with listFiles, then read the relevant entry files. If the project already contains an app, modify that app instead of replacing it. Only scaffold an actually empty/new project.",
      "After listFiles, use the exact filenames returned by the inspection. Do not invent paths unless the file already exists or you have just created it.",
      "For a change request on an existing app, first read the smallest set of relevant existing files, then make targeted edits. Do not regenerate the whole application for a local change.",
      "For visual changes, inspect the existing stylesheet/component before editing. Preserve unrelated layout, content, and behavior.",
      "After writeFile, verify the changed file when the next decision depends on its exact contents.",
      "Never answer with a full code listing when a file should be changed: use writeFile.",
      "The filesystem tools are already scoped to the active project. Never reference or reveal the physical filesystem path.",
      "All filesystem tools are already scoped to this active project root.",
      "NEVER prefix paths with projects/, the repository name, apps/, or the workspace root.",
      "Use only paths relative to the active project, such as index.html, src/app.js, style.css.",
      "Do not modify another project or the NEXUM repository root.",
      "Before implementation, extract a concrete product brief from the user request: page type, target user, information architecture, visual direction, sections, interactions, responsive behavior, and key content. Use that brief to drive the files you write. Do not use generic NEXUM copy, demo metrics, placeholder cards, or a reusable starter layout unless the user explicitly asks for them.",
      "A Product Plan is authoritative implementation context. Do not ignore it, invent a different product, or collapse it into a generic landing page.",
      productPlan ? `PRODUCT PLAN: ${JSON.stringify(productPlan)}` : "PRODUCT PLAN: unavailable; infer a concrete plan before acting.",
      "Keep existing working code unless the user's task requires replacing it.",
      "When a build/check fails, inspect the exact error, locate the responsible file/line, fix it, and rerun the same check. Never report success when the last build is failing.",
      "Return JSON only, with no markdown and no explanation.",
      "For a new application, do not stop at scaffoldProject: after the scaffold exists, inspect its files and use writeFile to implement the user's requested UI, behavior, copy, and styling.",
      "Use scaffoldProject only to establish a valid runnable baseline. The user's requested product must be represented in the actual project files before you finish.",
      "When the user asks for a landing page, dashboard, marketplace, SaaS, mobile-style UI, or other specific product, create the actual screen rather than returning a generic starter. Each new request must produce materially different information architecture, layout, components, copy, and interactions when the brief differs.",
      'Tool call format: {"tool":"writeFile","input":{"path":"index.html","content":"..."}}.',
      'For string inputs use {"tool":"readFile","input":"path"}.',
      'To finish use {"done":true,"finalResponse":"short summary of files and checks; never include full file contents"}.',
      "Never use npm --prefix apps/web, apps/api, projects/, or the repository root for a user project. The current working directory is already the active user project.",
      "Build/test commands must run from the active project root: use npm install, npm run build, npm run test, npm run lint, or npm run typecheck only when that script exists.",
      "If package.json does not exist yet, create it as part of the user project before attempting npm commands.",
      "Do not narrate your reasoning. Do not output markdown. Do not include explanations outside the required JSON object.",
      "Quality gate: do not finish after scaffoldProject. For a real build request, inspect first, then make at least two substantive writeFile changes to implement the requested product, then build and repair any errors before done=true. A scaffold-only result is never acceptable.",
      "1) listFiles .",
      "2) read relevant existing files if they exist.",
      "3) writeFile each required file with complete valid contents.",
      "4) for a package-based app, run npm install first, then runSandbox with the build/check command when applicable.",
      "5) if the check fails, fix the file and run the check again.",
      "6) finish with done=true and a short summary.",
      "Available tools and input formats:",
      toolCatalog,
      `User task: ${task}`,
      `Previous tool results:\n${history}`,
    ].join("\n");

    const role = /ошибк|error|debug|сборк|build|compile|fix|исправ/i.test(task)
      ? "debugger"
      : /создай|разработай|сайт|приложени|dashboard|landing|react|ui|код|code/i.test(task)
        ? "coder"
        : "planner";
    const run = await this.orchestrator.run(role, prompt, options);
    console.log(JSON.stringify({ type: "ai-role", role: run.role, model: run.model }));
    const parsed = this.parseAIPlan(run.response);
    if (parsed) return parsed;

    // Do not spend a second provider request repairing a known 429 response.
    // The deterministic planner is deliberately kept usable without a remote
    // model so a temporary OpenRouter limit cannot corrupt the build flow.
    if (this.isRateLimitError(run.response)) {
      console.warn("[agent] AI planner returned a rate-limit response; using deterministic planner");
      return null;
    }

    const repairPrompt = [
      "The previous response was not valid NEXUM tool-plan JSON.",
      "Return exactly one JSON object and nothing else.",
      '{"tool":"...","input":"..."} or {"done":true,"finalResponse":"..."}',
      "Use only the available tools listed below.",
      "Never invent paths: choose paths from project inspection already provided.",
      "If implementation is incomplete, choose the next concrete tool action instead of done=true.",
      `User task: ${task}`,
      `Previous results:\n${history}`,
      `Previous invalid response:\n${run.response.slice(0, 5000)}`,
      `Available tools:\n${toolCatalog}`,
    ].join("\n");
    try {
      const repairedRun = await this.orchestrator.run(role, repairPrompt, options);
      console.log(JSON.stringify({ type: "ai-role-repair", role: repairedRun.role, model: repairedRun.model }));
      return this.parseAIPlan(repairedRun.response);
    } catch (error) {
      console.warn("[agent] AI plan repair failed", error);
      return null;
    }
  }

  plan(task: string, previousResults: AgentToolResult[]): AgentPlan | null {
    const normalizedTask = task.toLowerCase();

    if (/покажи структуру.*проверь сборк|проверь проект.*сборк|проверь проект и/.test(normalizedTask)) {
      if (!this.hasSuccessfulResult(previousResults, "listFiles")) {
        return { tool: "listFiles", input: "." };
      }

      if (!this.hasSuccessfulResult(previousResults, "runSandbox")) {
        return {
          tool: "runSandbox",
          input: JSON.stringify({ projectPath: ".", command: "npm run build" }),
        };
      }

      return null;
    }

    if (/создай файл|запиши файл|write file|create file/.test(normalizedTask) && /проверь|проверь результат|verify/.test(normalizedTask)) {
      if (!this.hasSuccessfulResult(previousResults, "writeFile")) {
        const selection = this.selectTool(task, previousResults);
        return selection ? { tool: selection.name, input: selection.input } : null;
      }

      if (!this.hasSuccessfulResult(previousResults, "readFile")) {
        return { tool: "readFile", input: this.extractPath(task) };
      }

      return null;
    }

    if (/создай|сделай|разработай|build|create|make/.test(normalizedTask) && /приложени|сайт|лендинг|web app|website|landing|страниц|dashboard|marketplace|crm/.test(normalizedTask)) {
      if (!this.hasSuccessfulResult(previousResults, "listFiles")) {
        return { tool: "listFiles", input: "." };
      }
    }

    const scaffolded = previousResults.some(
      (item) => item.tool === "scaffoldProject" && item.result.success,
    );
    if (scaffolded) {
      const implementationWrites = previousResults.filter(
        (item) => item.tool === "writeFile" && item.result.success,
      );
      if (implementationWrites.length === 0 && this.getAvailableTools().includes("writeFile")) {
        return {
          tool: "writeFile",
          input: JSON.stringify({
            path: "src/App.jsx",
            content: this.fallbackApp(task),
          }),
        };
      }
      if (
        implementationWrites.length === 1 &&
        !implementationWrites.some((item) => item.input.includes('"path":"src/styles.css"')) &&
        this.getAvailableTools().includes("writeFile")
      ) {
        return {
          tool: "writeFile",
          input: JSON.stringify({
            path: "src/styles.css",
            content: this.fallbackStyles(),
          }),
        };
      }
    }

    // Deterministic recovery for existing projects. If the remote model is
    // unavailable, we still make substantive changes without ever scaffolding over
    // a non-empty project.
    const existingProject = this.projectHasExistingFilesFromResults(previousResults);
    const implementationWrites = previousResults.filter(
      (item) => item.tool === "writeFile" && item.result.success,
    );
    if (existingProject && !scaffolded && /создай|сделай|разработай|сайт|лендинг|landing|website|приложени|app|dashboard|crm/i.test(normalizedTask)) {
      const hasPackage = this.existingPathsFromResults(previousResults).includes("package.json");
      if (hasPackage) {
        if (implementationWrites.length === 0) {
          return {
            tool: "writeFile",
            input: JSON.stringify({ path: "src/App.jsx", content: this.fallbackApp(task) }),
          };
        }
        if (implementationWrites.length === 1) {
          return {
            tool: "writeFile",
            input: JSON.stringify({ path: "src/styles.css", content: this.fallbackStyles() }),
          };
        }
      } else {
        if (implementationWrites.length === 0) {
          return {
            tool: "writeFile",
            input: JSON.stringify({ path: "index.html", content: this.fallbackStaticIndex(task) }),
          };
        }
        if (implementationWrites.length === 1) {
          return {
            tool: "writeFile",
            input: JSON.stringify({ path: "style.css", content: this.fallbackStaticStyles() }),
          };
        }
        if (implementationWrites.length === 2) {
          return {
            tool: "writeFile",
            input: JSON.stringify({ path: "app.js", content: this.fallbackStaticJs() }),
          };
        }
      }
    }

    const selection = this.selectTool(task, previousResults);
    if (!selection) return null;

    const alreadyCompleted = previousResults.some(
      (item) => item.tool === selection.name && item.input === selection.input && item.result.success,
    );
    return alreadyCompleted ? null : { tool: selection.name, input: selection.input };
  }

  async executeTool(toolName: string, input: string): Promise<ToolResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return { success: false, output: `Unknown tool: ${toolName}` };
    }

    console.log(`[agent] tool: ${tool.name}`);
    const result = await tool.execute(input);
    console.log(`[agent] ${tool.name}: ${result.success ? "success" : "failed"}`);
    return result;
  }

  private isRateLimitError(response: string): boolean {
    return /(?:rate limit|rate-limit|too many requests|429)/i.test(response);
  }

  private parseProductPlan(response: string): ProductPlan | null {
    const candidates = [
      response.trim(),
      response.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]?.trim() ?? "",
      response.match(/\{[\s\S]*\}/)?.[0] ?? "",
    ].filter(Boolean);
    for (const candidate of candidates) {
      try {
        const value = JSON.parse(candidate) as Record<string, unknown>;
        const strings = (key: string) => Array.isArray(value[key]) ? value[key].filter((item): item is string => typeof item === "string") : [];
        if (typeof value.goal === "string" && typeof value.productType === "string") {
          return {
            goal: value.goal,
            productType: value.productType,
            targetUser: typeof value.targetUser === "string" ? value.targetUser : "End users",
            pages: strings("pages"),
            components: strings("components"),
            visualSystem: strings("visualSystem"),
            interactions: strings("interactions"),
            dataModel: strings("dataModel"),
            filesToInspect: strings("filesToInspect"),
            filesToChange: strings("filesToChange"),
            acceptanceCriteria: strings("acceptanceCriteria"),
          };
        }
      } catch {}
    }
    return null;
  }

  private parseProductReview(response: string): ProductReview | null {
    const candidates = [
      response.trim(),
      response.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]?.trim() ?? "",
      response.match(/\{[\s\S]*\}/)?.[0] ?? "",
    ].filter(Boolean);
    for (const candidate of candidates) {
      try {
        const value = JSON.parse(candidate) as Record<string, unknown>;
        if (typeof value.passed === "boolean") {
          return {
            passed: value.passed,
            missing: Array.isArray(value.missing) ? value.missing.filter((item): item is string => typeof item === "string") : [],
            risks: Array.isArray(value.risks) ? value.risks.filter((item): item is string => typeof item === "string") : [],
          };
        }
      } catch {}
    }
    return null;
  }

  private fallbackProductPlan(task: string, previousResults: AgentToolResult[]): ProductPlan {
    const lower = task.toLowerCase();
    const type = /marketplace|маркетплейс|авито|перепродаж/.test(lower)
      ? "Marketplace"
      : /dashboard|crm|панел/.test(lower)
        ? "Dashboard"
        : /магазин|shop|store|ecommerce|каталог/.test(lower)
          ? "Commerce"
          : /приложени|app|spa/.test(lower)
            ? "Web application"
            : "Website";
    const pages = type === "Marketplace"
      ? ["Home", "Search/results", "Listing detail", "Create listing", "Profile", "Messages"]
      : type === "Dashboard"
        ? ["Overview", "Records", "Details", "Settings"]
        : ["Home", "About/Benefits", "Services or content", "Contact/CTA"];
    const components = [
      "Responsive header",
      "Primary navigation",
      "Task-specific content blocks",
      "Interactive controls",
      "Responsive mobile layout",
      "Accessible focus and hover states",
    ];
    return {
      goal: task.trim(),
      productType: type,
      targetUser: "The audience implied by the request",
      pages,
      components,
      visualSystem: ["Distinct visual direction derived from the request", "Consistent typography", "Responsive spacing and hierarchy", "High-contrast interactive states"],
      interactions: ["Primary CTA", "Navigation", "Task-specific controls", "Mobile interaction states"],
      dataModel: type === "Marketplace" ? ["users", "listings", "categories", "messages", "favorites"] : ["content", "actions"],
      filesToInspect: previousResults.some((item) => item.tool === "listFiles") ? ["."] : ["."],
      filesToChange: ["The actual application entry file", "The actual stylesheet", "Supporting interaction/data files as required"],
      acceptanceCriteria: [
        "The requested product is visibly implemented, not a generic starter",
        "The main user flow described by the request is interactive",
        "The layout is responsive",
        "The project builds successfully",
        "No placeholder/demo NEXUM starter content remains",
      ],
    };
  }

  private parseAIPlan(response: string): AgentPlan | null {
    const candidates = [
      response.trim(),
      response.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]?.trim() ?? "",
      response.match(/\{[\s\S]*\}/)?.[0] ?? "",
    ].filter(Boolean);

    for (const jsonCandidate of candidates) {
      try {
        const parsed = JSON.parse(jsonCandidate) as {
          tool?: unknown;
          input?: unknown;
          done?: unknown;
          finalResponse?: unknown;
        };

        if (parsed.done === true) {
          return {
            tool: "",
            input: "",
            done: true,
            ...(typeof parsed.finalResponse === "string" ? { finalResponse: parsed.finalResponse } : {}),
          };
        }

        if (typeof parsed.tool !== "string" || !this.tools.has(parsed.tool) || parsed.input === undefined) {
          continue;
        }

        return {
          tool: parsed.tool,
          input: typeof parsed.input === "string" ? parsed.input : JSON.stringify(parsed.input),
        };
      } catch {
        continue;
      }
    }

    return null;
  }

  private fallbackApp(task: string): string {
    const brief = task.replace(/\\s+/g, " ").trim().slice(0, 260);
    const lower = task.toLowerCase();
    const mode = /дашборд|dashboard|crm/.test(lower)
      ? "workspace"
      : /магазин|shop|store|marketplace|маркетплейс/.test(lower)
        ? "catalog"
        : /лендинг|landing|сайт|website/.test(lower)
          ? "landing"
          : "product";

    const title = mode === "workspace"
      ? "Рабочее пространство"
      : mode === "catalog"
        ? "Каталог продукта"
        : mode === "landing"
          ? "Цифровой продукт"
          : "Новый продукт";

    const sections = mode === "workspace"
      ? ["Обзор", "Рабочие данные", "Настройки"]
      : mode === "catalog"
        ? ["Каталог", "Описание", "Действие"]
        : ["Главный экран", "Возможности", "Следующий шаг"];

    return `import { useState } from "react";

const brief = ${JSON.stringify(brief)};
const sections = ${JSON.stringify(sections)};

export default function App() {
  const [active, setActive] = useState(sections[0]);

  return (
    <main className="nexum-shell">
      <header className="topbar">
        <div className="brand">NEXUM.DEV</div>
        <div className="status">Preview</div>
      </header>
      <section className="hero-card">
        <span className="kicker">GENERATED FROM REQUEST</span>
        <h1>${title}</h1>
        <p>{brief}</p>
        <button className="primary" onClick={() => setActive(sections[1] ?? sections[0])}>
          Продолжить
        </button>
      </section>
      <nav className="tabs" aria-label="Разделы">
        {sections.map((item) => (
          <button key={item} className={active === item ? "tab active" : "tab"} onClick={() => setActive(item)}>
            {item}
          </button>
        ))}
      </nav>
      <section className="panel">
        <span className="kicker">CURRENT SECTION</span>
        <h2>{active}</h2>
        <p>Секция создана как безопасная основа для дальнейшей реализации исходного запроса.</p>
      </section>
    </main>
  );
}
`;
  }

  private fallbackStaticIndex(task: string): string {
    const brief = this.escapeHtml(task.replace(/\s+/g, " ").trim().slice(0, 220));
    return `<!doctype html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="${brief}">
<title>NEXUM.DEV — Digital studio</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<header class="site-header"><a class="logo" href="#top">NEXUM<span>.DEV</span></a><nav><a href="#services">Услуги</a><a href="#cases">Кейсы</a><a href="#process">Процесс</a><a href="#contact">Контакт</a></nav><a class="header-cta" href="#contact">Обсудить проект</a></header>
<main id="top">
<section class="hero"><div class="eyebrow">DIGITAL STUDIO / 2026</div><h1>Цифровые продукты,<br><em>которые работают.</em></h1><p>Разработка сайтов, веб-приложений и AI-автоматизации под конкретную задачу бизнеса.</p><div class="hero-actions"><a class="btn primary" href="#cases">Смотреть кейсы</a><a class="btn ghost" href="#contact">Обсудить проект</a></div><div class="hero-grid"><div><strong>01</strong><span>Web products</span></div><div><strong>02</strong><span>AI automation</span></div><div><strong>03</strong><span>Digital systems</span></div></div></section>
<section id="services" class="section"><div class="section-head"><span>01 / SERVICES</span><h2>От идеи до рабочего продукта.</h2></div><div class="cards"><article><b>01</b><h3>Сайты</h3><p>Лендинги и корпоративные сайты с сильной структурой, адаптивностью и понятной конверсией.</p></article><article><b>02</b><h3>Веб-приложения</h3><p>Кабинеты, CRM, маркетплейсы и внутренние сервисы с реальной логикой продукта.</p></article><article><b>03</b><h3>AI-автоматизация</h3><p>AI-агенты, обработка данных и автоматизация повторяющихся бизнес-процессов.</p></article></div></section>
<section id="cases" class="section"><div class="section-head"><span>02 / CASES</span><h2>Продукты и интерфейсы.</h2></div><div class="cases"><article><div class="case-no">01</div><h3>NEXUM.DEV</h3><p>AI-платформа для создания и развития цифровых продуктов.</p><a href="#contact">Смотреть кейс →</a></article><article><div class="case-no">02</div><h3>GRUZLI</h3><p>Marketplace для диспетчеров, грузчиков и заказчиков.</p><a href="#contact">Смотреть кейс →</a></article><article><div class="case-no">03</div><h3>AI SYSTEMS</h3><p>Автоматизация сбора, анализа и маршрутизации бизнес-запросов.</p><a href="#contact">Смотреть кейс →</a></article></div></section>
<section id="process" class="section"><div class="section-head"><span>03 / PROCESS</span><h2>Четыре шага до запуска.</h2></div><div class="process"><div><b>01</b><h3>Бриф</h3><p>Фиксируем задачу и результат.</p></div><div><b>02</b><h3>Архитектура</h3><p>Проектируем структуру и сценарии.</p></div><div><b>03</b><h3>Разработка</h3><p>Собираем интерфейс и бизнес-логику.</p></div><div><b>04</b><h3>Запуск</h3><p>Проверяем, исправляем и передаём продукт.</p></div></div></section>
<section class="section tech"><div class="section-head"><span>04 / STACK</span><h2>Технологии под задачу.</h2></div><div class="tech-list"><span>React</span><span>TypeScript</span><span>Node.js</span><span>Python</span><span>AI</span></div></section>
<section id="contact" class="section contact"><div><span>05 / CONTACT</span><h2>Расскажите, что нужно построить.</h2></div><form id="lead-form"><input name="name" required placeholder="Имя"><input name="contact" required placeholder="Telegram / телефон / email"><textarea name="task" required placeholder="Коротко опишите задачу"></textarea><button class="btn primary" type="submit">Отправить заявку</button><p id="form-state" role="status"></p></form></section>
</main>
<footer>NEXUM.DEV <span>Digital products & AI</span></footer>
<script src="app.js"></script>
</body></html>`;
  }

  private fallbackStaticStyles(): string {
    return `:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111;background:#f6f6f3;font-synthesis:none;scroll-behavior:smooth}
*{box-sizing:border-box}body{margin:0;min-width:320px;background:#f6f6f3}a{color:inherit;text-decoration:none}button,input,textarea{font:inherit}.site-header{position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;gap:20px;padding:18px 5vw;border-bottom:1px solid #ddd;background:rgba(246,246,243,.84);backdrop-filter:blur(18px)}.logo{font-weight:900;letter-spacing:-.04em}.logo span{color:#888}.site-header nav{display:flex;gap:24px;font-size:13px;color:#555}.header-cta,.btn{border-radius:999px;padding:12px 18px;border:1px solid #111}.header-cta{font-size:13px;background:#111;color:#fff}.hero,.section{width:min(1180px,90vw);margin:auto}.hero{padding:12vh 0 9vh;min-height:82vh}.eyebrow,.section-head>span{font-size:11px;font-weight:800;letter-spacing:.16em;color:#777}.hero h1{font-size:clamp(52px,9vw,122px);line-height:.9;letter-spacing:-.07em;max-width:1050px;margin:22px 0}.hero h1 em{font-style:normal;color:#777}.hero p{max-width:650px;font-size:20px;line-height:1.5;color:#555}.hero-actions{display:flex;gap:10px;margin-top:30px}.btn{display:inline-block;cursor:pointer}.primary{background:#111;color:#fff}.ghost{background:transparent}.hero-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#ddd;margin-top:80px}.hero-grid div{padding:22px;background:#f6f6f3;display:flex;justify-content:space-between}.hero-grid span{color:#777}.section{padding:100px 0;border-top:1px solid #ddd}.section-head{display:flex;justify-content:space-between;gap:30px;margin-bottom:42px}.section h2{font-size:clamp(36px,5vw,70px);line-height:.95;letter-spacing:-.06em;margin:0;max-width:760px}.cards,.cases,.process{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.cards article,.cases article,.process div{border:1px solid #ddd;background:#fff;border-radius:24px;padding:28px;min-height:220px}.cards b,.process b{color:#999}.cards h3,.cases h3,.process h3{font-size:28px;margin:60px 0 10px}.cards p,.cases p,.process p{color:#666;line-height:1.5}.cases article a{font-size:13px;font-weight:800}.process{grid-template-columns:repeat(4,1fr)}.process h3{margin-top:50px;font-size:24px}.tech-list{display:flex;flex-wrap:wrap;gap:10px}.tech-list span{padding:14px 18px;border:1px solid #ccc;border-radius:999px;background:#fff}.contact{display:grid;grid-template-columns:1fr 1fr;gap:60px}.contact form{display:grid;gap:10px}.contact input,.contact textarea{width:100%;padding:15px 16px;border:1px solid #ccc;border-radius:14px;background:#fff;outline:none}.contact textarea{min-height:150px;resize:vertical}.contact button{border:0}.contact #form-state{min-height:24px;color:#555;font-size:13px}footer{display:flex;justify-content:space-between;padding:30px 5vw;border-top:1px solid #ddd;color:#777;font-size:12px}@media(max-width:760px){.site-header nav{display:none}.header-cta{padding:10px 13px}.hero{padding-top:8vh}.hero-grid,.cards,.cases,.process,.contact{grid-template-columns:1fr}.section-head{display:block}.section-head>span{display:block;margin-bottom:18px}.hero h1{font-size:clamp(48px,15vw,80px)}.hero-actions{flex-wrap:wrap}}`;
  }

  private fallbackStaticJs(): string {
    return `const form=document.querySelector("#lead-form");const state=document.querySelector("#form-state");
form?.addEventListener("submit",(event)=>{event.preventDefault();const data=Object.fromEntries(new FormData(form).entries());localStorage.setItem("nexum:lead",JSON.stringify({...data,savedAt:new Date().toISOString()}));form.reset();if(state)state.textContent="Заявка сохранена. Мы свяжемся с вами.";});
document.querySelectorAll('a[href^="#"]').forEach((link)=>link.addEventListener("click",(event)=>{const id=link.getAttribute("href");if(!id||id==="#")return;const target=document.querySelector(id);if(target){event.preventDefault();target.scrollIntoView({behavior:"smooth",block:"start"});}}));`;
  }

  private fallbackStyles(): string {
    return `:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111;background:#f3f3f0;font-synthesis:none}
*{box-sizing:border-box}
body{margin:0;min-width:320px;background:linear-gradient(180deg,#fafaf8 0%,#eeeeea 100%)}
button{font:inherit}
.nexum-shell{min-height:100vh}
.topbar{height:72px;display:flex;align-items:center;justify-content:space-between;padding:0 32px;border-bottom:1px solid #deded8;background:rgba(255,255,255,.72);backdrop-filter:blur(18px);position:sticky;top:0;z-index:10}
.brand{font-size:13px;font-weight:900;letter-spacing:.14em}.brand span{margin:0 5px;color:#999}.status{font-size:12px;color:#5d5d59}
.content{width:min(1180px,calc(100% - 36px));margin:auto;padding:36px 0 80px}
.hero-card{display:flex;align-items:flex-end;justify-content:space-between;gap:28px;padding:42px;border:1px solid #dddcd5;border-radius:28px;background:#fff;box-shadow:0 18px 60px rgba(0,0,0,.06)}
.kicker{font-size:11px;font-weight:900;letter-spacing:.15em;color:#888}
h1{max-width:760px;margin:12px 0 10px;font-size:clamp(44px,7vw,82px);line-height:.92;letter-spacing:-.06em}
.hero-card p{max-width:680px;margin:0;color:#666;font-size:18px;line-height:1.55}
.primary,.secondary,.tab{border:0;cursor:pointer;border-radius:14px}.primary{padding:13px 18px;background:#111;color:#fff;font-weight:800;white-space:nowrap}.secondary{padding:10px 14px;background:#f1f1ed;color:#111}
.tabs{display:flex;gap:8px;margin:18px 0}.tab{padding:10px 14px;background:transparent;color:#777}.tab.active{background:#111;color:#fff}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.metric{padding:24px;border:1px solid #deded8;border-radius:20px;background:rgba(255,255,255,.8)}.metric span,.metric small{display:block;color:#777}.metric strong{display:block;margin:18px 0 5px;font-size:34px;letter-spacing:-.04em}
.panel{margin-top:12px;padding:26px;border:1px solid #deded8;border-radius:24px;background:#fff}.panel-head{display:flex;align-items:center;justify-content:space-between}.panel h2{margin:7px 0 0;font-size:28px;letter-spacing:-.04em}.rows{margin-top:22px}.row{display:flex;justify-content:space-between;padding:17px 0;border-top:1px solid #ecece7}.pill{padding:5px 9px;border-radius:999px;background:#eee;color:#555;font-size:11px;font-weight:800}
@media(max-width:720px){.topbar{padding:0 18px}.content{width:min(100% - 24px,1180px);padding-top:18px}.hero-card{padding:26px;display:block}.primary{margin-top:22px}.grid{grid-template-columns:1fr}.tabs{overflow:auto}}
`;
  }

  private selectTool(task: string, previousResults: AgentToolResult[] = []): { name: string; input: string } | null {
    const normalizedTask = task.toLowerCase();

    if (/запусти тесты.*(?:sandbox|изолирован)|тесты в изолирован/.test(normalizedTask)) {
      return {
        name: "runSandbox",
        input: JSON.stringify({ projectPath: ".", command: "npm run test" }),
      };
    }

    if (/sandbox|изолирован|docker|проверь сборк|запусти сборк|проверь npm build|проверь.*собирается/.test(normalizedTask)) {
      return {
        name: "runSandbox",
        input: JSON.stringify({ projectPath: ".", command: "npm run build" }),
      };
    }

    if (this.isGitHubTask(normalizedTask)) {
      return { name: "github", input: this.extractGitHubOperation(task) };
    }

    if (/\bgit\b|что изменилось|последн.*коммит|какая сейчас ветка|текущ.*ветка|статус git|статистик.*изменени/.test(normalizedTask)) {
      return { name: "git", input: this.extractGitOperation(task) };
    }

    if (/запусти команду|выполни команду|run command/.test(normalizedTask)) {
      return { name: "runCommand", input: this.extractCommand(task) };
    }

    if (/git\s+status|статус git/.test(normalizedTask)) {
      return { name: "runCommand", input: "git status" };
    }

    if (/git\s+diff/.test(normalizedTask)) {
      return { name: "runCommand", input: "git diff" };
    }

    if (/git\s+log/.test(normalizedTask)) {
      return { name: "runCommand", input: "git log" };
    }

    if (/создай|сделай|разработай|build|create|make/.test(normalizedTask) && /приложени|сайт|лендинг|web app|website|landing|страниц/.test(normalizedTask)) {
      // Critical safety rule: scaffoldProject is only valid for a genuinely
      // empty/new project. If the current project already contains files, never
      // use the user's "create/rebuild" wording as permission to wipe/replace it.
      // The loop will have inspected the project first; deterministic recovery
      // must preserve that decision as well.
      const hasExistingProject = this.projectHasExistingFilesFromResults(previousResults);
      if (!hasExistingProject) {
        return { name: "scaffoldProject", input: task.trim() };
      }
      const existingPath = this.firstRelevantExistingPath(previousResults);
      if (existingPath) {
        return { name: "readFile", input: existingPath };
      }
      return { name: "listFiles", input: "." };
    }

    if (/структур|список файлов|покажи файлы|list files|project files/.test(normalizedTask)) {
      return { name: "listFiles", input: "." };
    }

    if (/создай файл|запиши файл|write file|create file/.test(normalizedTask)) {
      const path = this.extractPath(task);
      const content = this.extractContent(task);
      return {
        name: "writeFile",
        input: JSON.stringify({ path, content }),
      };
    }

    if (/прочитай|содержимое файла|read file|show file/.test(normalizedTask)) {
      return { name: "readFile", input: this.extractPath(task) };
    }

    if (/найди|поиск|ищи|search|find/.test(normalizedTask)) {
      return { name: "searchFiles", input: this.extractSearchQuery(task) };
    }

    return null;
  }

  private projectHasExistingFilesFromResults(results: AgentToolResult[]): boolean {
    const inspection = results
      .filter((item) => item.tool === "listFiles" && item.result.success)
      .map((item) => item.result.output)
      .join("\n");
    if (inspection.trim()) {
      const normalized = inspection.toLowerCase();
      if (/(?:^|[\n, ])(?:empty|no files|directory is empty|пуст)/.test(normalized)) return false;
      return /(?:index\.html|package\.json|src[\\/]\w+|style\.css|app\.js|vite\.config|main\.(?:js|jsx|ts|tsx))/.test(inspection);
    }
    return results.some((item) => item.result.success && (
      item.tool === "readFile" ||
      item.tool === "writeFile" ||
      item.tool === "scaffoldProject"
    ));
  }

  private firstRelevantExistingPath(results: AgentToolResult[]): string | null {
    const inspection = results
      .filter((item) => item.tool === "listFiles" && item.result.success)
      .map((item) => item.result.output)
      .join("\n");
    const candidates = ["index.html", "package.json", "src/App.jsx", "src/App.tsx", "src/main.jsx", "src/main.tsx", "style.css", "src/styles.css", "app.js"];
    for (const candidate of candidates) {
      if (inspection.includes(candidate)) return candidate;
    }
    return null;
  }

  private existingPathsFromResults(results: AgentToolResult[]): string[] {
    const inspection = results
      .filter((item) => item.tool === "listFiles" && item.result.success)
      .map((item) => item.result.output)
      .join("\n");
    return ["index.html", "package.json", "src/App.jsx", "src/App.tsx", "src/main.jsx", "src/main.tsx", "style.css", "src/styles.css", "app.js", "vite.config.js"]
      .filter((path) => inspection.includes(path));
  }

  private extractPath(task: string): string {
    const match = task.match(
      /(?:прочитай|read|show)\s+(?:файл|file)\s+[`"']?([^\s`"']+)|(?:файл|file)\s+[`"']?([^\s`"']+)/i,
    );
    return match?.[1] ?? match?.[2] ?? ".";
  }

  private extractContent(task: string): string {
    const match = task.match(/(?:содержимым|содержимое|content)\s*:\s*([\s\S]+)$/i);
    return match?.[1]?.trim() ?? "";
  }

  private extractSearchQuery(task: string): string {
    const match = task.match(/(?:найди|поиск|ищи|search|find)\s+["`']?([\s\S]+?)["`']?$/i);
    return match?.[1]?.trim() ?? task;
  }

  private extractCommand(task: string): string {
    const match = task.match(/(?:запусти команду|выполни команду|run command)\s+([\s\S]+)$/i);
    return match?.[1]?.trim() ?? "";
  }

  private hasSuccessfulResult(results: AgentToolResult[], toolName: string): boolean {
    return results.some((item) => item.tool === toolName && item.result.success);
  }

  private extractGitOperation(task: string): string {
    const explicitCommand = this.extractCommand(task);
    const candidate = explicitCommand || task.trim();
    const normalizedCandidate = candidate.toLowerCase();

    if (!/[;&|`$()<>\n\r\\]/.test(candidate)) {
      if (/git\s+diff\s+--stat/.test(normalizedCandidate) || /статистик.*изменени/.test(normalizedCandidate)) {
        return "diff-stat";
      }
      if (/git\s+diff/.test(normalizedCandidate) || /что изменилось/.test(normalizedCandidate)) return "diff";
      if (/git\s+log/.test(normalizedCandidate) || /последн.*коммит/.test(normalizedCandidate)) return "log";
      if (/git\s+branch\s+--show-current/.test(normalizedCandidate) || /ветк/.test(normalizedCandidate)) return "branch";
      if (/git\s+status/.test(normalizedCandidate) || /статус git/.test(normalizedCandidate)) return "status";
    }

    return candidate;
  }

  private isGitHubTask(task: string): boolean {
    return (
      /github|pull requests?|pull request|\bpr\s*#?\d+|issues?|issue\s*#?\d+/.test(task) ||
      /информац.*репозитор|информац.*коммит|конкрет.*commit|какие есть ветки|покажи последние коммиты|последн.*коммит/.test(task)
    );
  }

  private extractGitHubOperation(task: string): string {
    const normalizedTask = task.toLowerCase();
    const pullRequestNumber = normalizedTask.match(/(?:pull request|pull|pr)\s*#?\s*(\d+)/i)?.[1];
    const issueNumber = normalizedTask.match(/(?:issue|issues|проблем|задач)\s*#?\s*(\d+)/i)?.[1];
    const commitIdentifier = normalizedTask.match(/(?:commit|коммит(?:е|а|ом)?)\s+([a-f0-9]{7,40})\b/i)?.[1];

    if (pullRequestNumber) return `pullRequest:${pullRequestNumber}`;
    if (issueNumber) return `issue:${issueNumber}`;
    if (commitIdentifier) return `commit:${commitIdentifier}`;
    if (/pull requests?|pull request|\bpr\b/.test(normalizedTask)) return "pullRequests";
    if (/issues?|проблем|задач/.test(normalizedTask)) return "issues";
    if (/ветк|branches?/.test(normalizedTask)) return "branches";
    if (/коммит|commit/.test(normalizedTask)) return "commits";
    return "repository";
  }
}
