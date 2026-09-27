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
import { PatchFileTool } from "./tools/patchFile.js";
import { TestProjectTool } from "./tools/testProject.js";
import { buildAgentContext, formatAgentContext } from "./context.js";

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
      new PatchFileTool(workspace),
      new TestProjectTool(workspace),
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
    const lowerTask = task.toLowerCase();
    const isConstructionTask = /строит|строитель|демонтаж|фасад|монтаж|подряд|объект|отделк|бетон|кровл|инженерн/.test(lowerTask);
    const isAutoRepairTask = /авто|автомобил|машин|сто|автосервис|ремонт.*машин|ремонт.*авто|диагностик|шиномонтаж|кузов|двигател|ходов|тормоз|масл|запчаст/.test(lowerTask);
    if (isConstructionTask || isAutoRepairTask) {
      return this.fallbackProductPlan(task, previousResults);
    }

    const inspection = previousResults
      .filter((item) => item.result.success)
      .slice(-4)
      .map((item) => `${item.tool}: ${item.result.output.slice(0, 700)}`)
      .join("\n");
    const prompt = [
      "LANGUAGE PROTOCOL: Understand Russian natively. The user communicates in Russian. Interpret Russian requests, terminology, slang, spelling variations and mixed Russian/English technical terms correctly. All human-readable text you generate (site copy, UI text, plans, summaries, errors and final responses) must be in Russian unless the user explicitly requests another language. Keep required JSON property names, tool names, file paths, code, commands and API identifiers exactly as specified.",
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
      .slice(-8)
      .map((item) => `${item.tool}: ${item.result.output.slice(0, 700)}`)
      .join("\n");
    const prompt = [
      "LANGUAGE PROTOCOL: Understand Russian natively. Review Russian-language user requests and Russian UI/content. All human-readable review output must be in Russian; keep JSON keys in the required English schema.",
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
    // Construction requests still go through the AI implementation planner.
    // The deterministic fallback remains only as recovery. Otherwise every
    // construction request would reuse the same hard-coded template and merely
    // replace its text, which defeats the purpose of a generative builder.
    const toolCatalog = [
      "listFiles: input is a relative directory path string, usually .",
      "readFile: input is a relative file path string",
      'writeFile: input is JSON object {"path":"relative/path","content":"file contents"}',
      "searchFiles: input is the text to search for",
      "scaffoldProject: input is the app brief; creates the project starter files only in an empty project",
      "validateProject: input is ., performs static validation of HTML/CSS/JS/JSON before Preview",
      'patchFile: input is JSON object {"path":"existing/file","find":"exact old text","replace":"new text","expectedMatches":1}; use for targeted edits and never for broad rewrites',
      "runCommand: input is one allowlisted command for the active project, such as npm install, npm run build or npm run test",
      'runSandbox: input is JSON object {"projectPath":".","command":"npm run build"}; projectPath is always forced to the active project',
      "git: input is one of status, diff, diff-stat, log, branch",
      "github: input is a read-only operation string",
    ].join("\n");

    const history = previousResults.length === 0
      ? "No tools have run yet."
      : previousResults
          .slice(-6)
          .map((item) => `${item.tool}: ${item.result.output.slice(0, 500)}`)
          .join("\n");
    const projectStateContext = "Project state is included in persistent context.";

    const prompt = [
      "LANGUAGE PROTOCOL: Russian is the primary language of NEXUM. Understand Russian instructions natively, including colloquial wording and construction/business terminology. Unless the user explicitly asks for another language, every user-facing word in generated websites/apps must be Russian: navigation, buttons, headings, forms, placeholders, errors, empty states, metadata and marketing copy. Do not translate code identifiers, package names, tool names, API fields, file paths or commands. Do not answer a Russian request in English.",
      "You are the NEXUM.DEV autonomous project builder.",
      "Your job is to modify the user's project, not merely explain code.",      "Choose exactly one available tool for the next action, or finish the task. Keep the JSON response as short as possible.",
      "For app-building tasks, NEVER jump straight to scaffoldProject. First inspect the current project with listFiles, then read the relevant entry files. If the project already contains an app, modify that app instead of replacing it. Only scaffold an actually empty/new project.",
      "After listFiles, use the exact filenames returned by the inspection. Do not invent paths unless the file already exists or you have just created it.",
      "For a change request on an existing app, first read the smallest set of relevant existing files, then make targeted edits. Prefer patchFile for local changes; use writeFile for genuinely new or substantially rewritten files. Do not regenerate the whole application for a local change.",
      "For visual changes, inspect the existing stylesheet/component before editing. Preserve unrelated layout, content, and behavior.",
      "After writeFile, verify the changed file when the next decision depends on its exact contents.",
      "Never answer with a full code listing when a file should be changed: use writeFile.",
      "The filesystem tools are already scoped to the active project. Never reference or reveal the physical filesystem path.",
      "All filesystem tools are already scoped to this active project root.",
      "NEVER prefix paths with projects/, the repository name, apps/, or the workspace root.",
      "Use only paths relative to the active project, such as index.html, src/app.js, style.css.",
      "Do not modify another project or the NEXUM repository root.",
      "Before implementation, extract a concrete product brief from the user request: page type, target user, information architecture, visual direction, sections, interactions, responsive behavior, and key content. Use that brief to drive the files you write. Do not use generic NEXUM copy, demo metrics, placeholder cards, or a reusable starter layout unless the user explicitly asks for them.",
      "INTENT LOCK: The user's nouns, industry, audience, product/service and requested outcome are hard requirements. Extract the dominant business/domain from the current user request before choosing content. Never substitute a generic digital-product/SaaS/AI-studio concept. If the request is about auto repair, cars, an auto service station or vehicle maintenance, the generated site must visibly be an auto-repair business: repair services, diagnostics, service categories, advantages/trust, reviews and appointment/contact CTA. If it is about construction/building/renovation/demolition/contracting, use construction services, projects/objects, work process, trust/experience, geography and estimate/contact CTA. Apply the same rule to every other industry: preserve the exact requested domain instead of reusing the previous project's domain. Never use NEXUM.DEV, Digital products, SaaS, AI studio, software products, or tech-stack marketing copy as the site's primary subject unless the user explicitly asks for that.",
      "CREATE MODE: When the user says create/make/develop a new site, treat the request as a fresh design brief even if the active project already contains a previous generated site. Preserve the runnable project infrastructure/package configuration, but replace the previous application's visual composition and business content. Do not merely rename headings, swap sentences, or keep the same hero/cards/navigation structure.",
      "DESIGN NOVELTY LOCK: For a new site, inspect the current UI only to avoid copying it. Then deliberately choose a contrasting information architecture and visual composition: change at least 3 of hero layout, navigation pattern, section ordering, card geometry, typography scale, spacing rhythm, imagery treatment, and CTA placement. The result must be recognizably a new design, not a recolored version.",
      "For construction requests, never reuse the hard-coded emergency construction template as the normal implementation path. If AI planning is unavailable, prefer continuing inspection/recovery over writing that fixed template. The fixed fallback is emergency-only and must not silently replace a valid generated design.",
      "If the requested industry differs from the current starter, change the actual page copy, headings, sections, navigation, cards, and CTA to that industry. A changed sentence or title alone is not sufficient.",
      "Before returning a writeFile action, mentally check: does the file content clearly describe the exact user's requested business? If not, do not write it; generate a corrected file instead.",
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
      `PERSISTENT PROJECT CONTEXT (advisory, current project only): ${persistentContext}`,\n      `PROJECT STATE MEMORY (advisory, current project only): ${projectStateContext}`,
      `User task: ${task}`,
      `Previous tool results:\n${history}`,
    ].join("\n");

    const role = /ошибк|error|debug|сборк|build|compile|fix|исправ/i.test(task)
      ? "debugger"
      : /создай|разработай|сайт|приложени|dashboard|landing|react|ui|код|code/i.test(task)
        ? "coder"
        : "planner";
    const run = await this.orchestrator.run(role, prompt, options);
    console.log(JSON.stringify({ type: "ai-role", role: run.role, provider: run.provider, model: run.model, fallback: run.fallback }));
    const parsed = this.parseAIPlan(run.response);
    if (parsed && this.isPlanAlignedWithTask(task, parsed)) return parsed;
    if (parsed) {
      console.warn("[agent] rejected AI plan because it does not match the user's requested domain; using deterministic recovery");
    }

    // Do not spend a second provider request repairing a known 429 response.
    // The deterministic planner is deliberately kept usable without a remote
    // model so a temporary OpenRouter limit cannot corrupt the build flow.
    if (this.isRateLimitError(run.response)) {
      console.warn("[agent] AI planner returned a rate-limit response; using deterministic planner");
      // Surface the rate limit to AgentLoop so it disables remote planner calls
      // for the remainder of this task. Returning null here was ambiguous:
      // AgentLoop could not distinguish "rate limited" from "no plan" and could
      // call OrcaRouter again on the next iteration.
      throw new Error("OrcaRouter rate limit exceeded (429)");
    }

    const repairPrompt = [
      "LANGUAGE PROTOCOL: The user language is Russian. Understand the Russian task and keep all human-readable response text in Russian. Preserve English JSON keys, tool names, code, paths and commands.",
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
      console.log(JSON.stringify({ type: "ai-role-repair", role: repairedRun.role, provider: repairedRun.provider, model: repairedRun.model, fallback: repairedRun.fallback }));
      const repairedPlan = this.parseAIPlan(repairedRun.response);
      // A repair response that only says "done" cannot erase the deterministic
      // fallback when no tool has executed yet. Prefer the concrete local plan.
      if (repairedPlan?.done && previousResults.length === 0) return null;
      return repairedPlan;
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

    // IMPORTANT: normal Builder execution must never silently fall back to a
    // hard-coded website template. That made every construction request look
    // identical and only changed the text. If the AI planner cannot produce an
    // implementation action, stop/replan instead of overwriting the project with
    // fallbackApp/fallbackStyles/fallbackStatic*.
    //
    // The fallback generators remain available for emergency/internal recovery,
    // but they are intentionally not selected by the normal Builder route.
    if (scaffolded && !previousResults.some((item) =>
      (item.tool === "writeFile" || item.tool === "patchFile") && item.result.success
    )) {
      const existingPath = this.existingPathsFromResults(previousResults).find(
        (candidate) => !previousResults.some(
          (item) => item.tool === "readFile" && item.input === candidate && item.result.success,
        ),
      );
      if (existingPath) return { tool: "readFile", input: existingPath };
    }

    // Provider-independent Builder recovery: after inspection, read the real
    // entry files before falling back to search. This prevents the offline/rate-limit
    // path from looping forever on searchFiles and gives the local planner source
    // material to implement against.
    const entryCandidates = [
      "src/App.tsx",
      "src/App.jsx",
      "src/main.tsx",
      "src/main.jsx",
      "src/App.css",
      "src/styles.css",
      "style.css",
      "index.html",
    ];
    const inspectedListing = previousResults
      .filter((item) => item.tool === "listFiles" && item.result.success)
      .map((item) => item.result.output)
      .join("\n");
    if (/создай|сделай|разработай|build|create|make|сайт|приложени|лендинг|website|landing|web app|страниц/i.test(task) && inspectedListing) {
      const unreadEntry = entryCandidates.find((candidate) =>
        inspectedListing.includes(candidate) &&
        !previousResults.some((item) => item.tool === "readFile" && item.input === candidate && item.result.success),
      );
      if (unreadEntry) return { tool: "readFile", input: unreadEntry };
    }

    // Provider-independent Builder fallback: if the remote planner is unavailable,
    // keep implementing the requested site instead of returning a false completion.
    const deterministicWrite = this.deterministicBuilderWrite(task, previousResults);
    if (deterministicWrite) return deterministicWrite;

    const selection = this.selectTool(task, previousResults);
    if (!selection) return null;

    const alreadyCompleted = previousResults.some(
      (item) => item.tool === selection.name && item.input === selection.input && item.result.success,
    );
    return alreadyCompleted ? null : { tool: selection.name, input: selection.input };
  }

  private deterministicBuilderWrite(task: string, previousResults: AgentToolResult[]): AgentPlan | null {
    const lower = task.toLowerCase();
    const isAuto = /авто|автомобил|машин|сто|автосервис|ремонт.*авто|ремонт.*машин|диагностик|шиномонтаж|кузов|двигател|тормоз|масл|запчаст/.test(lower);
    const isConstruction = /строит|строитель|демонтаж|фасад|монтаж|подряд|объект|отделк|бетон|кровл|инженерн/.test(lower);
    const isBuilder = /создай|сделай|разработай|build|create|make|сайт|приложени|лендинг|website|landing|web app|страниц/.test(lower);
    if (!isBuilder) return null;

    const writes = previousResults.filter(
      (item) => (item.tool === "writeFile" || item.tool === "patchFile") && item.result.success,
    ).length;
    if (writes >= 2) return null;

    const inspection = previousResults
      .filter((item) => item.tool === "listFiles" && item.result.success)
      .map((item) => item.result.output)
      .join("\n");

    const hasReactApp = /(?:^|[\\/])src[\\/]App\\.(?:tsx|jsx)\\b/.test(inspection);
    const appPath = /(?:^|[\\/])src[\\/]App\\.jsx\\b/.test(inspection) ? "src/App.jsx" : "src/App.tsx";
    const hasCss = /(?:^|[\\/])src[\\/](?:App|styles)\\.css\\b|(?:^|[\\/])style\\.css\\b/.test(inspection);
    const cssPath = /(?:^|[\\/])src[\\/]App\\.css\\b/.test(inspection)
      ? "src/App.css"
      : /(?:^|[\\/])src[\\/]styles\\.css\\b/.test(inspection)
        ? "src/styles.css"
        : "style.css";
    const hasStatic = /(?:^|[\\/])index\\.html\\b/.test(inspection) && /(?:^|[\\/])style\\.css\\b/.test(inspection);

    if (hasReactApp && hasCss) {
      const appWritten = previousResults.some(
        (item) => item.tool === "writeFile" && item.result.success && item.input.includes(appPath),
      );
      if (!appWritten) {
        let content = this.fallbackApp(task);
        if (cssPath.startsWith("src/")) {
          content = content.replace(
            'import { useState } from "react";',
            'import { useState } from "react";\nimport "./' + cssPath.slice(4) + '";',
          );
        }
        return {
          tool: "writeFile",
          input: JSON.stringify({ path: appPath, content }),
        };
      }

      const cssWritten = previousResults.some(
        (item) => item.tool === "writeFile" && item.result.success && item.input.includes(cssPath),
      );
      if (!cssWritten) {
        return {
          tool: "writeFile",
          input: JSON.stringify({ path: cssPath, content: this.fallbackStyles() }),
        };
      }
    }

    if (hasStatic) {
      const indexWritten = previousResults.some(
        (item) => item.tool === "writeFile" && item.result.success && item.input.includes("index.html"),
      );
      if (!indexWritten) {
        return {
          tool: "writeFile",
          input: JSON.stringify({ path: "index.html", content: this.fallbackStaticIndex(task) }),
        };
      }

      const cssWritten = previousResults.some(
        (item) => item.tool === "writeFile" && item.result.success && item.input.includes("style.css"),
      );
      if (!cssWritten) {
        return {
          tool: "writeFile",
          input: JSON.stringify({ path: "style.css", content: this.fallbackStaticStyles() }),
        };
      }
    }

    // If the project is not one of the recognized layouts, let the normal
    // deterministic planner inspect it rather than overwriting unknown files.
    return null;
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
    const construction = /строит|строитель|демонтаж|фасад|монтаж|подряд|объект|отделк|бетон|кровл|инженерн/.test(lower);
    const autoRepair = /авто|автомобил|машин|сто|автосервис|ремонт.*машин|ремонт.*авто|диагностик|шиномонтаж|кузов|двигател|ходов|тормоз|масл|запчаст/.test(lower);
    if (construction) {
      return {
        goal: task.trim(),
        productType: "Construction company website",
        targetUser: "Клиенты и заказчики строительных услуг",
        pages: ["Главная", "Услуги", "Объекты", "Процесс", "О компании", "Контакты"],
        components: ["Construction header", "Hero with estimate CTA", "Services grid", "Project cases", "Work process", "Trust block", "Contact form"],
        visualSystem: ["Distinct construction visual direction", "Architecture/industrial imagery", "Strong typography hierarchy", "Responsive mobile layout"],
        interactions: ["Service navigation", "Estimate CTA", "Project browsing", "Lead form", "Mobile navigation"],
        dataModel: ["services", "projects", "leads", "contacts"],
        filesToInspect: ["."],
        filesToChange: ["Application entry", "Styles", "Interaction files"],
        acceptanceCriteria: [
          "The site is unmistakably about the requested construction business",
          "Services, projects, process, trust and contacts are visible",
          "No NEXUM, SaaS, AI studio or digital-product copy remains in the site",
          "Primary CTA requests an estimate/contact",
          "Responsive layout works on mobile",
          "Production build succeeds"
        ],
      };
    }
    if (autoRepair) {
      return {
        goal: task.trim(),
        productType: "Auto repair service website",
        targetUser: "Property owners, general contractors and commercial customers",
        pages: ["Главная", "Услуги", "Диагностика", "Цены", "Отзывы", "Контакты"],
        components: ["Автосервис header", "Hero with booking CTA", "Services grid", "Repair categories", "Advantages/trust block", "Reviews", "Booking form"],
        visualSystem: [
          "Choose a visual direction appropriate to an automotive service business and materially different from the current project's existing design",
          "Possible directions: premium dark garage, clean technical service, bold motorsport-inspired, editorial automotive, or bright modern workshop",
          "Use automotive repair, diagnostics, trust and booking as the content source",
          "Do not reuse the current project's hero composition, card geometry, navigation pattern, typography scale, or spacing system",
          "Responsive mobile layout",
        ],
        interactions: ["Service navigation", "Book service CTA", "Repair category browsing", "Booking/contact form", "Mobile navigation"],
        dataModel: ["services", "repairCategories", "reviews", "appointments", "contacts"],
        filesToInspect: ["."],
        filesToChange: ["Application entry", "Styles", "Interaction files"],
        acceptanceCriteria: [
          "The site is unmistakably about the requested auto repair business",
          "Services, diagnostics, repair categories, trust and contacts are visible",
          "No NEXUM, SaaS, AI studio or digital-product copy remains in the site",
          "Primary CTA books a repair/diagnostics appointment",
          "Responsive layout works on mobile",
          "Production build succeeds"
        ],
      };
    }

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

  private isPlanAlignedWithTask(task: string, plan: AgentPlan): boolean {
    const lower = task.toLowerCase();
    const construction = /строит|строитель|демонтаж|фасад|монтаж|подряд|объект|отделк|бетон|кровл|инженерн/.test(lower);
    const autoRepair = /авто|автомобил|машин|сто|автосервис|ремонт.*машин|ремонт.*авто|диагностик|шиномонтаж|кузов|двигател|ходов|тормоз|масл|запчаст/.test(lower);
    if (!construction && !autoRepair) return true;
    const input = String(plan.input ?? "").toLowerCase();
    if (plan.done) return false;
    if (plan.tool !== "writeFile" && plan.tool !== "patchFile") return true;
    const content = input;
    const genericDigital = /nexum\.dev|digital products|ai studio|saas|software products|web products|digital systems/.test(content);
    const domainSignal = construction
      ? /строит|подряд|демонтаж|фасад|объект|бригада|ремонт|стяжк|штукатур|монтаж|кровл/.test(content)
      : /авто|автомобил|машин|автосервис|диагностик|шиномонтаж|кузов|двигател|ходов|тормоз|масл|запчаст|сто/.test(content);
    return !genericDigital || domainSignal;
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
    const brief = task.replace(/\\s+/g, " ").trim().slice(0, 320);
    const lower = task.toLowerCase();
    const autoRepair = /авто|автомобил|машин|сто|автосервис|ремонт.*машин|ремонт.*авто|диагностик|шиномонтаж|кузов|двигател|ходов|тормоз|масл|запчаст/.test(lower);
    const construction = /строит|строитель|ремонт|демонтаж|фасад|монтаж|подряд|объект|бригада|грузчик|отделк|бетон|кровл|инженерн/.test(lower);

    if (autoRepair) {
      return `import { useState } from "react";

const brief = ${JSON.stringify(brief)};
const services = ["Диагностика автомобиля", "Ремонт двигателя", "Ремонт ходовой", "Тормозная система", "Замена масла и расходников", "Электрика и компьютерная диагностика"];

export default function App() {
  const [active, setActive] = useState("Услуги");
  const sections = ["Услуги", "Диагностика", "Цены", "Отзывы", "Контакты"];

  return (
    <main className="auto-service-site">
      <header className="topbar">
        <div className="brand">AUTO<span>SERVICE</span></div>
        <nav aria-label="Основная навигация">{sections.map((item) => <button key={item} className={active === item ? "tab active" : "tab"} onClick={() => setActive(item)}>{item}</button>)}</nav>
        <button className="primary" onClick={() => setActive("Контакты")}>Записаться в сервис</button>
      </header>
      <section className="auto-hero">
        <div>
          <span className="kicker">АВТОСЕРВИС / ДИАГНОСТИКА / РЕМОНТ</span>
          <h1>Ремонт автомобиля<br /><em>без лишних обещаний.</em></h1>
          <p>{brief}</p>
          <div className="hero-actions">
            <button className="primary" onClick={() => setActive("Контакты")}>Записаться на диагностику</button>
            <button className="secondary" onClick={() => setActive("Услуги")}>Услуги сервиса</button>
          </div>
        </div>
        <div className="hero-facts"><div><strong>10+</strong><span>лет опыта</span></div><div><strong>01</strong><span>диагностика перед ремонтом</span></div><div><strong>100%</strong><span>согласование работ</span></div></div>
      </section>
      <section className="content-section"><span className="kicker">01 / УСЛУГИ</span><h2>Работы для автомобиля в одном сервисе.</h2><div className="cards">{services.map((item, index) => <article key={item}><b>0{index + 1}</b><h3>{item}</h3><p>Осмотр, диагностика, согласование работ и обслуживание автомобиля.</p></article>)}</div></section>
      <section className="content-section"><span className="kicker">02 / ЗАПИСЬ</span><div className="contact-panel"><div><h2>Нужна диагностика или ремонт?</h2><p>Оставьте заявку — согласуем время визита и перечень работ.</p></div><button className="primary" onClick={() => setActive("Контакты")}>Оставить заявку</button></div></section>
      <footer>Автосервис <span>Диагностика · Ремонт · Обслуживание</span></footer>
    </main>
  );
}
`;
    }

    if (construction) {
      return `import { useState } from "react";

const brief = ${JSON.stringify(brief)};
const services = ["Демонтаж и подготовка", "Фасадные работы", "Внутренние работы", "Полы и стяжка"];
const projects = ["Коммерческие объекты", "Жилые объекты", "Реконструкция и ремонт"];

export default function App() {
  const [active, setActive] = useState("Услуги");
  const sections = ["Услуги", "Объекты", "О компании", "Контакты"];

  return (
    <main className="construction-site">
      <header className="topbar">
        <div className="brand">СТРОЙ<span>ПРОФИ</span></div>
        <nav aria-label="Основная навигация">
          {sections.map((item) => (
            <button key={item} className={active === item ? "tab active" : "tab"} onClick={() => setActive(item)}>{item}</button>
          ))}
        </nav>
        <button className="primary" onClick={() => setActive("Контакты")}>Рассчитать работу</button>
      </header>

      <section className="construction-hero">
        <div>
          <span className="kicker">СТРОИТЕЛЬНО-ПОДРЯДНАЯ КОМПАНИЯ</span>
          <h1>Строительные работы<br /><em>под задачу объекта.</em></h1>
          <p>{brief}</p>
          <div className="hero-actions">
            <button className="primary" onClick={() => setActive("Контакты")}>Получить расчёт</button>
            <button className="secondary" onClick={() => setActive("Объекты")}>Посмотреть объекты</button>
          </div>
        </div>
        <div className="hero-facts">
          <div><strong>10+</strong><span>лет опыта</span></div>
          <div><strong>Москва</strong><span>и область</span></div>
          <div><strong>01</strong><span>ответственный подрядчик</span></div>
        </div>
      </section>

      <section className="content-section">
        <span className="kicker">01 / УСЛУГИ</span>
        <h2>Работы, которые закрывают задачи объекта.</h2>
        <div className="cards">{services.map((item, index) => <article key={item}><b>0{index + 1}</b><h3>{item}</h3><p>Организация работ, подготовка основания, контроль качества и сдача результата.</p></article>)}</div>
      </section>

      <section className="content-section">
        <span className="kicker">02 / ОБЪЕКТЫ</span>
        <h2>Опыт на разных типах объектов.</h2>
        <div className="cards">{projects.map((item, index) => <article key={item}><b>0{index + 1}</b><h3>{item}</h3><p>Состав работ и технология подбираются после осмотра и технического задания.</p></article>)}</div>
      </section>

      <section className="content-section">
        <span className="kicker">03 / КОНТАКТЫ</span>
        <div className="contact-panel">
          <div><h2>Нужен подрядчик?</h2><p>Оставьте задачу по объекту. Обсудим объём, сроки, состав работ и подготовим расчёт.</p></div>
          <button className="primary" onClick={() => setActive("Контакты")}>Оставить заявку</button>
        </div>
      </section>

      <footer>Строительная компания <span>Москва · Московская область</span></footer>
    </main>
  );
}
`;
    }

    const mode = /дашборд|dashboard|crm/.test(lower)
      ? "workspace"
      : /магазин|shop|store|marketplace|маркетплейс/.test(lower)
        ? "catalog"
        : /лендинг|landing|сайт|website/.test(lower)
          ? "landing"
          : "product";

    const title = mode === "workspace" ? "Рабочее пространство" : mode === "catalog" ? "Каталог продукта" : mode === "landing" ? "Цифровой продукт" : "Новый продукт";
    const sections = mode === "workspace" ? ["Обзор", "Рабочие данные", "Настройки"] : mode === "catalog" ? ["Каталог", "Описание", "Действие"] : ["Главный экран", "Возможности", "Следующий шаг"];

    return `import { useState } from "react";

const brief = ${JSON.stringify(brief)};
const sections = ${JSON.stringify(sections)};

export default function App() {
  const [active, setActive] = useState(sections[0]);
  return (
    <main className="nexum-shell">
      <header className="topbar"><div className="brand">NEXUM.DEV</div><div className="status">Preview</div></header>
      <section className="hero-card"><span className="kicker">GENERATED FROM REQUEST</span><h1>{${JSON.stringify(title)}}</h1><p>{brief}</p><button className="primary" onClick={() => setActive(sections[1] ?? sections[0])}>Продолжить</button></section>
      <nav className="tabs" aria-label="Разделы">{sections.map((item) => <button key={item} className={active === item ? "tab active" : "tab"} onClick={() => setActive(item)}>{item}</button>)}</nav>
      <section className="panel"><span className="kicker">CURRENT SECTION</span><h2>{active}</h2><p>Секция создана как безопасная основа для дальнейшей реализации исходного запроса.</p></section>
    </main>
  );
}
`;
  }

  private fallbackStaticIndex(task: string): string {
    const brief = this.escapeHtml(task.replace(/\\s+/g, " ").trim().slice(0, 260));
    const lowerTask = task.toLowerCase();
    const autoRepair = /авто|автомобил|машин|сто|автосервис|ремонт.*машин|ремонт.*авто|диагностик|шиномонтаж|кузов|двигател|ходов|тормоз|масл|запчаст/.test(lowerTask);
    const construction = /строит|строитель|ремонт|демонтаж|фасад|монтаж|подряд|объект|отделк|бетон|кровл|инженерн/.test(lowerTask);

    if (autoRepair) {
      return `<!doctype html>
<html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${brief}"><title>Автосервис — диагностика и ремонт</title><link rel="stylesheet" href="style.css"></head>
<body>
<header class="site-header"><a class="logo" href="#top">AUTO<span>SERVICE</span></a><nav><a href="#services">Услуги</a><a href="#diagnostics">Диагностика</a><a href="#prices">Цены</a><a href="#reviews">Отзывы</a><a href="#contact">Контакт</a></nav><a class="header-cta" href="#contact">Записаться</a></header>
<main id="top"><section class="hero"><div class="eyebrow">АВТОСЕРВИС / ДИАГНОСТИКА / РЕМОНТ</div><h1>Ремонт автомобиля<br><em>без лишних обещаний.</em></h1><p>${brief}</p><div class="hero-actions"><a class="btn primary" href="#contact">Записаться на диагностику</a><a class="btn ghost" href="#services">Услуги сервиса</a></div></section>
<section id="services" class="section"><div class="section-head"><span>01 / УСЛУГИ</span><h2>Основные направления ремонта.</h2></div><div class="cards"><article><b>01</b><h3>Диагностика</h3><p>Компьютерная и техническая диагностика перед ремонтом.</p></article><article><b>02</b><h3>Двигатель и ходовая</h3><p>Поиск неисправностей и ремонт основных узлов автомобиля.</p></article><article><b>03</b><h3>Тормоза и обслуживание</h3><p>Тормозная система, масла, расходники и плановое ТО.</p></article></div></section>
<section id="diagnostics" class="section"><div class="section-head"><span>02 / ДИАГНОСТИКА</span><h2>Сначала определяем причину, затем согласовываем работы.</h2></div></section>
<section id="prices" class="section"><div class="section-head"><span>03 / ЦЕНЫ</span><h2>Стоимость согласовывается до начала ремонта.</h2></div></section>
<section id="reviews" class="section"><div class="section-head"><span>04 / ОТЗЫВЫ</span><h2>Отзывы клиентов и история обслуживания.</h2></div></section>
<section id="contact" class="section"><div class="contact-panel"><div><h2>Записаться в автосервис</h2><p>Оставьте контакт и опишите проблему автомобиля.</p></div><a class="btn primary" href="tel:+70000000000">Связаться с сервисом</a></div></section></main>
<footer>Автосервис · Диагностика · Ремонт · Обслуживание</footer></body></html>`;
    }

    if (construction) {
      return `<!doctype html>
<html lang="ru">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${brief}"><title>Строительная компания — подрядные работы</title><link rel="stylesheet" href="style.css"></head>
<body>
<header class="site-header"><a class="logo" href="#top">СТРОЙ<span>ПРОФИ</span></a><nav><a href="#services">Услуги</a><a href="#projects">Объекты</a><a href="#process">Процесс</a><a href="#contact">Контакт</a></nav><a class="header-cta" href="#contact">Получить расчёт</a></header>
<main id="top">
<section class="hero"><div class="eyebrow">СТРОИТЕЛЬНО-ПОДРЯДНАЯ КОМПАНИЯ / 2026</div><h1>Строительные работы<br><em>под задачу объекта.</em></h1><p>${brief}</p><div class="hero-actions"><a class="btn primary" href="#contact">Получить расчёт</a><a class="btn ghost" href="#projects">Посмотреть объекты</a></div><div class="hero-grid"><div><strong>10+</strong><span>лет опыта</span></div><div><strong>Москва</strong><span>и область</span></div><div><strong>01</strong><span>ответственный подрядчик</span></div></div></section>
<section id="services" class="section"><div class="section-head"><span>01 / УСЛУГИ</span><h2>Основные виды строительных работ.</h2></div><div class="cards"><article><b>01</b><h3>Демонтаж</h3><p>Демонтаж конструкций, перегородок, полов и подготовка помещений к следующему этапу.</p></article><article><b>02</b><h3>Фасадные работы</h3><p>Фасадные работы и подготовка поверхностей с организацией работ на объекте.</p></article><article><b>03</b><h3>Внутренние работы</h3><p>Полы, стяжка, штукатурка, потолки, перегородки и другие работы по заданию.</p></article></div></section>
<section id="projects" class="section"><div class="section-head"><span>02 / ОБЪЕКТЫ</span><h2>Работаем с коммерческими и жилыми объектами.</h2></div><div class="cases"><article><div class="case-no">01</div><h3>Коммерческие объекты</h3><p>Работы по подготовке, реконструкции и ремонту помещений.</p></article><article><div class="case-no">02</div><h3>Жилые объекты</h3><p>Демонтаж, подготовка и отделочные работы.</p></article><article><div class="case-no">03</div><h3>Реконструкция</h3><p>Комплекс работ под техническое задание и график объекта.</p></article></div></section>
<section id="process" class="section"><div class="section-head"><span>03 / ПРОЦЕСС</span><h2>От задачи до сдачи работ.</h2></div><div class="process"><div><b>01</b><h3>Заявка</h3><p>Получаем задачу, площадь и адрес объекта.</p></div><div><b>02</b><h3>Расчёт</h3><p>Определяем объём работ, сроки и состав бригады.</p></div><div><b>03</b><h3>Работы</h3><p>Организуем производство и контроль на объекте.</p></div><div><b>04</b><h3>Сдача</h3><p>Закрываем этап и передаём результат заказчику.</p></div></div></section>
<section id="contact" class="section contact"><div><span>04 / КОНТАКТ</span><h2>Нужен подрядчик на объект?</h2><p>Опишите объект и необходимый объём работ — подготовим следующий шаг по заявке.</p></div><form id="lead-form"><input name="name" required placeholder="Имя / компания"><input name="contact" required placeholder="Телефон / Telegram / email"><textarea name="task" required placeholder="Объект, площадь и требуемые работы"></textarea><button class="btn primary" type="submit">Получить расчёт</button><p id="form-state" role="status"></p></form></section>
</main><footer>Строительная компания <span>Москва · Московская область</span></footer><script src="app.js"></script>
</body></html>`;
    }

    return `<!doctype html>
<html lang="ru">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${brief}"><title>NEXUM.DEV — Digital studio</title><link rel="stylesheet" href="style.css"></head>
<body>
<header class="site-header"><a class="logo" href="#top">NEXUM<span>.DEV</span></a><nav><a href="#services">Услуги</a><a href="#cases">Кейсы</a><a href="#process">Процесс</a><a href="#contact">Контакт</a></nav><a class="header-cta" href="#contact">Обсудить проект</a></header>
<main id="top"><section class="hero"><div class="eyebrow">DIGITAL STUDIO / 2026</div><h1>Цифровые продукты,<br><em>которые работают.</em></h1><p>${brief}</p><div class="hero-actions"><a class="btn primary" href="#cases">Смотреть кейсы</a><a class="btn ghost" href="#contact">Обсудить проект</a></div><div class="hero-grid"><div><strong>01</strong><span>Web products</span></div><div><strong>02</strong><span>AI automation</span></div><div><strong>03</strong><span>Digital systems</span></div></div></section>
<section id="services" class="section"><div class="section-head"><span>01 / SERVICES</span><h2>От идеи до рабочего продукта.</h2></div><div class="cards"><article><b>01</b><h3>Сайты</h3><p>Лендинги и корпоративные сайты.</p></article><article><b>02</b><h3>Веб-приложения</h3><p>Кабинеты, CRM и внутренние сервисы.</p></article><article><b>03</b><h3>AI-автоматизация</h3><p>AI-агенты и автоматизация процессов.</p></article></div></section>
<section id="cases" class="section"><div class="section-head"><span>02 / CASES</span><h2>Продукты и интерфейсы.</h2></div><div class="cases"><article><div class="case-no">01</div><h3>NEXUM.DEV</h3><p>AI-платформа для цифровых продуктов.</p></article><article><div class="case-no">02</div><h3>GRUZLI</h3><p>Marketplace для диспетчеров, грузчиков и заказчиков.</p></article><article><div class="case-no">03</div><h3>AI SYSTEMS</h3><p>Автоматизация бизнес-процессов.</p></article></div></section>
<section id="process" class="section"><div class="section-head"><span>03 / PROCESS</span><h2>Четыре шага до запуска.</h2></div><div class="process"><div><b>01</b><h3>Бриф</h3><p>Фиксируем задачу.</p></div><div><b>02</b><h3>Архитектура</h3><p>Проектируем структуру.</p></div><div><b>03</b><h3>Разработка</h3><p>Собираем продукт.</p></div><div><b>04</b><h3>Запуск</h3><p>Проверяем и передаём.</p></div></div></section>
<section id="contact" class="section contact"><div><span>04 / CONTACT</span><h2>Расскажите, что нужно построить.</h2></div><form id="lead-form"><input name="name" required placeholder="Имя"><input name="contact" required placeholder="Telegram / телефон / email"><textarea name="task" required placeholder="Коротко опишите задачу"></textarea><button class="btn primary" type="submit">Отправить заявку</button><p id="form-state" role="status"></p></form></section>
</main><footer>NEXUM.DEV <span>Digital products & AI</span></footer><script src="app.js"></script></body></html>`;
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
    return `.construction-site{min-height:100vh;background:#f3f3f0;color:#111}.construction-site .topbar{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:18px 5vw;border-bottom:1px solid #ddd;background:rgba(255,255,255,.86);position:sticky;top:0;z-index:20}.construction-site .topbar nav{display:flex;gap:6px}.construction-site .brand{font-weight:900;letter-spacing:-.04em}.construction-site .brand span{color:#999}.construction-site .construction-hero,.construction-site .content-section{width:min(1180px,90vw);margin:auto}.construction-site .construction-hero{min-height:78vh;padding:10vh 0 8vh;display:flex;flex-direction:column;justify-content:space-between}.construction-site .construction-hero h1{font-size:clamp(48px,8vw,110px);line-height:.9;letter-spacing:-.07em;margin:20px 0}.construction-site .construction-hero h1 em{font-style:normal;color:#777}.construction-site .construction-hero p{max-width:720px;font-size:19px;line-height:1.55;color:#555}.construction-site .kicker{font-size:11px;font-weight:900;letter-spacing:.15em;color:#777}.construction-site .hero-actions{display:flex;gap:10px;margin-top:28px}.construction-site .hero-facts{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid #ccc;margin-top:70px}.construction-site .hero-facts div{padding:20px 0;border-right:1px solid #ccc}.construction-site .hero-facts strong,.construction-site .hero-facts span{display:block}.construction-site .hero-facts strong{font-size:30px}.construction-site .hero-facts span{color:#777;font-size:13px;margin-top:6px}.construction-site .content-section{padding:90px 0;border-top:1px solid #ddd}.construction-site .content-section h2{font-size:clamp(36px,5vw,68px);line-height:.95;letter-spacing:-.06em;max-width:800px}.construction-site .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.construction-site .cards article{background:#fff;border:1px solid #ddd;border-radius:24px;padding:26px;min-height:190px}.construction-site .cards b{color:#999}.construction-site .cards h3{font-size:25px;margin-top:55px}.construction-site .cards p{color:#666;line-height:1.5}.construction-site .contact-panel{display:flex;justify-content:space-between;align-items:center;gap:30px;background:#fff;border:1px solid #ddd;border-radius:24px;padding:32px}.construction-site .primary,.construction-site .secondary,.construction-site .tab{border:0;border-radius:999px;cursor:pointer;padding:11px 16px}.construction-site .primary{background:#111;color:#fff}.construction-site .secondary{background:#e9e9e5;color:#111}.construction-site .tab{background:transparent;color:#666}.construction-site .tab.active{background:#111;color:#fff}.construction-site footer{display:flex;justify-content:space-between;padding:30px 5vw;border-top:1px solid #ddd;color:#777;font-size:12px}
@media(max-width:760px){.construction-site .topbar nav{display:none}.construction-site .construction-hero,.construction-site .content-section{width:min(100% - 28px,1180px)}.construction-site .construction-hero{padding-top:8vh}.construction-site .hero-facts,.construction-site .cards{grid-template-columns:1fr}.construction-site .hero-facts div{border-right:0;border-bottom:1px solid #ccc}.construction-site .contact-panel{display:block}.construction-site .contact-panel .primary{margin-top:20px}}

:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111;background:#f3f3f0;font-synthesis:none}
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

  private selectDeterministicImplementation(task: string, previousResults: AgentToolResult[]): { name: string; input: string } | null {
    const normalized = task.toLowerCase();
    const builder = /создай|сделай|разработай|build|create|make|сайт|приложени|лендинг|website|landing|web app|страниц/.test(normalized);
    if (!builder) return null;

    const inspection = previousResults
      .filter((item) => item.tool === "listFiles" && item.result.success)
      .map((item) => item.result.output)
      .join("\n");
    if (!inspection) return null;

    const reactApp = inspection.includes("src/App.tsx") || inspection.includes("src/App.jsx");
    const appPath = inspection.includes("src/App.tsx") ? "src/App.tsx" : "src/App.jsx";
    const cssPath = inspection.includes("src/App.css")
      ? "src/App.css"
      : inspection.includes("src/styles.css")
        ? "src/styles.css"
        : inspection.includes("style.css")
          ? "style.css"
          : reactApp ? "src/App.css" : null;

    if (reactApp && cssPath) {
      const appWritten = previousResults.some(
        (item) => item.tool === "writeFile" && item.result.success && item.input.includes(appPath),
      );
      if (!appWritten) {
        const cssImport = cssPath.startsWith("src/") ? cssPath.slice(4) : cssPath;
        const app = this.fallbackApp(task).replace(
          /import \{ useState \} from "react";/,
          'import { useState } from "react";\nimport "./' + cssImport + '";',
        );
        return { name: "writeFile", input: JSON.stringify({ path: appPath, content: app }) };
      }

      const cssWritten = previousResults.some(
        (item) => item.tool === "writeFile" && item.result.success && item.input.includes(cssPath),
      );
      if (!cssWritten) {
        return { name: "writeFile", input: JSON.stringify({ path: cssPath, content: this.fallbackStyles() }) };
      }
    }

    if (inspection.includes("index.html") && inspection.includes("style.css")) {
      const indexWritten = previousResults.some(
        (item) => item.tool === "writeFile" && item.result.success && item.input.includes("index.html"),
      );
      if (!indexWritten) {
        return { name: "writeFile", input: JSON.stringify({ path: "index.html", content: this.fallbackStaticIndex(task) }) };
      }
      const cssWritten = previousResults.some(
        (item) => item.tool === "writeFile" && item.result.success && item.input.includes("style.css"),
      );
      if (!cssWritten) {
        return { name: "writeFile", input: JSON.stringify({ path: "style.css", content: this.fallbackStaticStyles() }) };
      }
    }

    return null;
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

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
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