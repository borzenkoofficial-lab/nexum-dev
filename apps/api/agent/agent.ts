import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { AIGateway, GatewayGenerateOptions } from "../ai/gateway.js";
import { AIOrchestrator } from "../ai/orchestrator.js";
import type {
  AgentModelOptions,
  AgentRuntime,
  AgentToolResult,
  AgentPlan,
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

  async planWithAI(
    task: string,
    previousResults: AgentToolResult[],
    options?: AgentModelOptions,
  ): Promise<AgentPlan | null> {
    const toolCatalog = [
      "listFiles: input is a relative directory path string, usually .",
      "readFile: input is a relative file path string",
      'writeFile: input is JSON object {"path":"relative/path","content":"file contents"}',
      "searchFiles: input is the text to search for",
      "scaffoldProject: input is the app brief; creates the project starter files",
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
      "For app-building tasks, inspect the existing project first, then create/update the required files, then run a build/check before finishing. Do not repeat successful actions.",
      "Never answer with a full code listing when a file should be changed: use writeFile.",
      "The filesystem tools are already scoped to the active project. Never reference or reveal the physical filesystem path.",
      "All filesystem tools are already scoped to this active project root.",
      "NEVER prefix paths with projects/, the repository name, apps/, or the workspace root.",
      "Use only paths relative to the active project, such as index.html, src/app.js, style.css.",
      "Do not modify another project or the NEXUM repository root.",
      "For a new web app, ensure the required entry files exist and are connected.",
      "Keep existing working code unless the user's task requires replacing it.",
      "When a build/check fails, inspect the error and fix the relevant file instead of stopping immediately.",
      "Return JSON only, with no markdown and no explanation.",
      "For a new application, do not stop at scaffoldProject: after the scaffold exists, inspect its files and use writeFile to implement the user's requested UI, behavior, copy, and styling.",
      "Use scaffoldProject only to establish a valid runnable baseline. The user's requested product must be represented in the actual project files before you finish.",
      "When the user asks for a landing page, dashboard, marketplace, SaaS, mobile-style UI, or other specific product, create the actual screen rather than returning a generic starter.",
      'Tool call format: {"tool":"writeFile","input":{"path":"index.html","content":"..."}}.',
      'For string inputs use {"tool":"readFile","input":"path"}.',
      'To finish use {"done":true,"finalResponse":"short summary of files and checks; never include full file contents"}.',
      "Never use npm --prefix apps/web, apps/api, projects/, or the repository root for a user project. The current working directory is already the active user project.",
      "Build/test commands must run from the active project root: use npm install, npm run build, npm run test, npm run lint, or npm run typecheck only when that script exists.",
      "If package.json does not exist yet, create it as part of the user project before attempting npm commands.",
      "Do not narrate your reasoning. Do not output markdown. Do not include explanations outside the required JSON object.",
      "Preferred workflow for a new web app:",
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
    return this.parseAIPlan(run.response);
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
        const selection = this.selectTool(task);
        return selection ? { tool: selection.name, input: selection.input } : null;
      }

      if (!this.hasSuccessfulResult(previousResults, "readFile")) {
        return { tool: "readFile", input: this.extractPath(task) };
      }

      return null;
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

    const selection = this.selectTool(task);
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
    const brief = task.replace(/\s+/g, " ").trim().slice(0, 180);
    const lower = task.toLowerCase();
    const mode = /дашборд|dashboard|crm/.test(lower)
      ? "dashboard"
      : /магазин|shop|store|marketplace|маркетплейс/.test(lower)
        ? "market"
        : /лендинг|landing|сайт|website/.test(lower)
          ? "landing"
          : "product";
    const title = mode === "dashboard"
      ? "Workspace"
      : mode === "market"
        ? "Marketplace"
        : mode === "landing"
          ? "A sharper digital product"
          : "Your product, built in NEXUM";
    return `import { useState } from "react";

const brief = ${JSON.stringify(brief)};

export default function App() {
  const [active, setActive] = useState("Overview");
  const nav = ["Overview", "Projects", "Activity", "Settings"];
  const cards = [
    { label: "Projects", value: "12", meta: "+3 this week" },
    { label: "Active users", value: "2,480", meta: "+18.4%" },
    { label: "Conversion", value: "8.7%", meta: "+1.2%" },
  ];

  return (
    <div className="nexum-shell">
      <header className="topbar">
        <div className="brand">NEXUM<span>·</span>DEV</div>
        <div className="status">● Live preview</div>
      </header>
      <main className="content">
        <section className="hero-card">
          <div>
            <span className="kicker">GENERATED PRODUCT</span>
            <h1>${title}</h1>
            <p>{brief}</p>
          </div>
          <button className="primary" onClick={() => setActive("Projects")}>Open workspace</button>
        </section>
        <nav className="tabs" aria-label="Sections">
          {nav.map((item) => (
            <button key={item} className={active === item ? "tab active" : "tab"} onClick={() => setActive(item)}>
              {item}
            </button>
          ))}
        </nav>
        <section className="grid">
          {cards.map((card) => (
            <article className="metric" key={card.label}>
              <span>{card.label}</span>
              <strong>{card.value}</strong>
              <small>{card.meta}</small>
            </article>
          ))}
        </section>
        <section className="panel">
          <div className="panel-head"><div><span className="kicker">CURRENT VIEW</span><h2>{active}</h2></div><button className="secondary" onClick={() => setActive("Overview")}>Reset</button></div>
          <div className="rows">
            {["Design system", "Application shell", "Preview build"].map((item, index) => (
              <div className="row" key={item}><span>{item}</span><span className="pill">{index === 2 ? "Ready" : "Built"}</span></div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
`;
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

  private selectTool(task: string): { name: string; input: string } | null {
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
      return { name: "scaffoldProject", input: task.trim() };
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
