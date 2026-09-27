import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { AIGateway, GatewayGenerateOptions } from "../ai/gateway.js";
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
import { WriteFileTool } from "./tools/writeFile.js";

const defaultProjectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export class NexumAgent implements AgentRuntime {
  private readonly tools: Map<string, Tool>;

  constructor(
    private readonly gateway: AIGateway,
    public readonly projectRoot = defaultProjectRoot,
  ) {
    const tools = [
      new ListFilesTool(projectRoot),
      new ReadFileTool(projectRoot),
      new WriteFileTool(projectRoot),
      new SearchFilesTool(projectRoot),
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
        ? `Инструмент ${selection.tool} выполнен. Результат:\n${result.output}`
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
      "runCommand: input is one allowlisted command for the active project, such as npm run build or npm run test",
      'runSandbox: input is JSON object {"projectPath":".","command":"npm run build"}; projectPath is always forced to the active project',
      "git: input is one of status, diff, diff-stat, log, branch",
      "github: input is a read-only operation string",
    ].join("\n");
    const history = previousResults.length === 0
      ? "No tools have run yet."
      : previousResults.map((item) => `${item.tool}: ${item.result.output.slice(0, 4_000)}`).join("\n");
    const prompt = [
      "You are the NEXUM.DEV autonomous project builder.",
      "Your job is to modify the user's project, not merely explain code.",
      "Choose exactly one available tool for the next action, or finish the task.",
      "For app-building tasks, inspect the existing project first, then create/update the required files, then run a build/check before finishing.",
      "Never answer with a full code listing when a file should be changed: use writeFile.",
      `The active project root is: ${this.projectRoot}`,
      "All filesystem tools are already scoped to this active project root.",
      "NEVER prefix paths with projects/, the repository name, apps/, or the workspace root.",
      "Use only paths relative to the active project, such as index.html, src/app.js, style.css.",
      "Do not modify another project or the NEXUM repository root.",
      "For a new web app, ensure index.html, style.css, and app.js exist and are connected.",
      "Keep existing working code unless the user's task requires replacing it.",
      "When a build/check fails, inspect the error and fix the relevant file instead of stopping immediately.",
      "Return JSON only, with no markdown and no explanation.",
      'Tool call format: {"tool":"writeFile","input":{"path":"index.html","content":"..."}}.',
      'For string inputs use {"tool":"readFile","input":"path"}.',
      'To finish use {"done":true,"finalResponse":"short summary of files and checks; never include full file contents"}.',
      "Never use npm --prefix apps/web, apps/api, projects/, or the repository root for a user project. The current working directory is already the active user project.",
      "Build/test commands must run from the active project root: use npm run build, npm run test, npm run lint, or npm run typecheck only when that script exists.",
      "If package.json does not exist yet, create it as part of the user project before attempting npm commands.",
      "Preferred workflow for a new web app:",
      "1) listFiles .",
      "2) read relevant existing files if they exist.",
      "3) writeFile each required file with complete valid contents.",
      "4) runSandbox with an available build/check command when applicable.",
      "5) if the check fails, fix the file and run the check again.",
      "6) finish with done=true and a short summary.",
      "Available tools and input formats:",
      toolCatalog,
      `User task: ${task}`,
      `Previous tool results:\n${history}`,
    ].join("\n\n");
    const response = await this.gateway.generate(prompt, options);
    return this.parseAIPlan(response);
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
    const jsonCandidate = response.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonCandidate) return null;

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
        return null;
      }

      return {
        tool: parsed.tool,
        input: typeof parsed.input === "string" ? parsed.input : JSON.stringify(parsed.input),
      };
    } catch {
      return null;
    }
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
        input: JSON.stringify({ projectPath: ".", command: "npm --prefix apps/web run build" }),
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
