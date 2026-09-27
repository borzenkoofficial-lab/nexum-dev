import express from "express";
import type { Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { AIGateway, type GatewayFallbackEvent } from "./ai/gateway.js";
import { MockProvider } from "./ai/providers/mock.js";
import { OllamaProvider } from "./ai/providers/ollama.js";
import { OpenRouterProvider } from "./ai/providers/openrouter.js";
import { OpenAIProvider } from "./ai/providers/openai.js";
import { OrcaRouterProvider } from "./ai/providers/orcarouter.js";
import { NexumAgent } from "./agent/agent.js";
import { AgentLoop, type AgentEvent } from "./agent/loop.js";
import type { ProductPlan } from "./agent/types.js";
import { ProjectManager, ProjectManagerError } from "./projects/projectManager.js";
import { mkdir, readFile, stat, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { GitTool } from "./agent/tools/git.js";
import { RunCommandTool } from "./agent/tools/runCommand.js";
import { assertExistingProjectPath, assertWritableProjectPath, ProjectPathError } from "./agent/tools/path.js";
import { AgentHistory } from "./agent/history.js";
import { ProjectStateManager } from "./projects/projectState.js";

dotenv.config();

const app = express();
const configuredProvider = process.env.AI_PROVIDER?.toLowerCase();
const defaultProvider = configuredProvider === "ollama" || configuredProvider === "openrouter" || configuredProvider === "openai" || configuredProvider === "orcarouter"
  ? configuredProvider
  : process.env.ORCAROUTER_API_KEY?.trim()
    ? "orcarouter"
    : process.env.OPENAI_API_KEY?.trim()
      ? "openai"
      : process.env.OPENROUTER_API_KEY?.trim()
        ? "openrouter"
        : "mock";
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const projectManager = new ProjectManager(workspaceRoot);
const agentHistory = new AgentHistory(workspaceRoot);
const projectStates = new Map<string, ProjectStateManager>();
const fallbackProvider = process.env.AI_FALLBACK_PROVIDER?.toLowerCase() ||
  (defaultProvider === "ollama" ? "openrouter" : defaultProvider === "orcarouter" ? "openrouter" : undefined);

const aiGateway = new AIGateway(
  [new MockProvider(), new OllamaProvider(), new OpenRouterProvider(), new OpenAIProvider(), new OrcaRouterProvider()],
  defaultProvider,
  {
    fallbackProviderId: fallbackProvider,
    onFallback: (event: GatewayFallbackEvent) => {
      void agentHistory.record({
        type: "provider-fallback",
        provider: event.fromProvider,
        model: event.fromModel,
        status: "fallback",
        message: `AI fallback: ${event.fromProvider}/${event.fromModel} -> ${event.toProvider}/${event.toModel}`,
        output: event.reason,
      });
      console.warn("[Nexum] AI provider fallback", event);
    },
  },
);

type ChatJobStatus = "queued" | "running" | "completed" | "failed";
interface ChatJob {
  id: string;
  status: ChatJobStatus;
  createdAt: number;
  updatedAt: number;
  reply?: string;
  steps?: unknown[];
  events?: AgentEvent[];
  problems?: Array<{ message: string; source?: string }>;
  currentMessage?: string;
  commandOutput?: { command: string; stdout: string; stderr: string; exitCode: number | null };
  error?: string;
  stage?: "queued" | "analyzing" | "planning" | "reading" | "editing" | "building" | "testing" | "completed" | "error";
  attachments?: string[];
  productPlan?: ProductPlan;
}
const chatJobs = new Map<string, ChatJob>();
const CHAT_JOB_TTL_MS = 30 * 60 * 1000;

function cleanupChatJobs() {
  const cutoff = Date.now() - CHAT_JOB_TTL_MS;
  for (const [id, job] of chatJobs) {
    if (job.updatedAt < cutoff && (job.status === "completed" || job.status === "failed")) {
      chatJobs.delete(id);
    }
  }
}

async function runChatJob(
  jobId: string,
  message: string,
  projectId: string | undefined,
  provider: string | undefined,
  model: string | undefined,
  attachments: Array<{ name: string; type: string; size: number; content?: string; data?: string }>,
  conversation: Array<{ role: "user" | "assistant"; content: string }>,
) {
  const job = chatJobs.get(jobId);
  if (!job) return;

  job.status = "running";
  job.updatedAt = Date.now();
  void agentHistory.record({ type: "job-start", jobId, projectId, provider, model, message });
  job.currentMessage = "Запускаю AI-агента и начинаю выполнение задачи.";
  job.stage = "analyzing";

  try {
    const project = await projectManager.getActiveProject(projectId);
    const stateManager = projectStates.get(project.id) ?? new ProjectStateManager(project.path, project.id);
    projectStates.set(project.id, stateManager);
    await stateManager.refresh(message);
    const attachmentDir = resolve(project.path, ".nexum", "attachments", jobId);
    const attachmentNames: string[] = [];
    const attachmentContext: string[] = [];
    if (attachments.length) {
      await mkdir(attachmentDir, { recursive: true });
      for (const attachment of attachments.slice(0, 5)) {
        const safeName = attachment.name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "attachment";
        const target = resolve(attachmentDir, safeName);
        if (attachment.content !== undefined) {
          await writeFile(target, attachment.content.slice(0, 80_000), "utf8");
          attachmentContext.push(`Attached text file ${safeName}:\\n${attachment.content.slice(0, 80_000)}`);
        } else if (attachment.data) {
          await writeFile(target, Buffer.from(attachment.data, "base64"));
          attachmentContext.push(`Attached binary file ${safeName} is stored at .nexum/attachments/${jobId}/${safeName}.`);
        }
        attachmentNames.push(safeName);
      }
    }
    job.attachments = attachmentNames;
    const compactConversation = conversation
      .slice(-8)
      .map((item) => `${item.role === "user" ? "Пользователь" : "NEXUM"}: ${item.content.slice(0, 900)}`)
      .join("\n");
    const projectContext = [
      "PROJECT CONTEXT LOCK:",
      `Текущий проект: «${project.name}»`,
      `ID проекта: ${project.id}`,
      "Все действия, файлы, команды и ответы относятся ТОЛЬКО к этому проекту.",
      "Не переносить файлы, дизайн, контент или предположения из других проектов.",
      compactConversation ? `Последние сообщения ЭТОГО проекта:\n${compactConversation}` : "Предыдущих сообщений в этом проекте нет.",
    ].join("\n");
    const agentMessage = [
      projectContext,
      message,
      attachmentContext.length ? `ATTACHED FILES:\n${attachmentContext.join("\n\n")}` : "",
    ].filter(Boolean).join("\n\n");
    console.log("[Nexum] chat job started", jobId, project.id, project.path);
    const agent = new NexumAgent(aiGateway, project.path);
    const agentLoop = new AgentLoop(
      agent,
      aiGateway,
      undefined,
      (step) => {
        job.steps = [...(job.steps ?? []), step];
        job.updatedAt = Date.now();
      },
      (event) => {
        job.events = [...(job.events ?? []), event].slice(-100);
        job.currentMessage = event.message;
        if (event.type === "thinking") job.stage = event.iteration === 0 ? "analyzing" : "planning";
        if (event.type === "tool-start") {
          if (event.tool === "listFiles" || event.tool === "readFile" || event.tool === "searchFiles") job.stage = "reading";
          else if (event.tool === "writeFile" || event.tool === "scaffoldProject") job.stage = "editing";
          else if (event.tool === "runSandbox" || event.tool === "runCommand") job.stage = /test/i.test(event.message) ? "testing" : "building";
        }
        if (event.type === "tool-error" || event.type === "failed") job.stage = "error";
        job.updatedAt = Date.now();
        void agentHistory.record({ type: "agent-event", jobId, projectId, provider, model, iteration: event.iteration, tool: event.tool, status: event.type, message: event.message });
        if (event.type === "tool-error" || event.type === "failed") {
          job.problems = [
            ...(job.problems ?? []),
            event.tool ? { message: event.message, source: event.tool } : { message: event.message },
          ];
        }
      },
      (plan) => {
        job.productPlan = plan;
        job.stage = "planning";
        job.currentMessage = "Product Plan сформирован. Перехожу к реализации.";
        job.updatedAt = Date.now();
      },
    );
    const result = await agentLoop.run(agentMessage, {
      ...(provider === undefined ? {} : { provider }),
      ...(model === undefined ? {} : { model }),
    });

    job.updatedAt = Date.now();
    if (!result.success) {
      job.status = "failed";
      job.stage = "error";
      job.error = result.error ?? "AI agent failed";
      void agentHistory.record({ type: "job-failed", jobId, projectId, provider, model, status: "failed", message: job.error });
      job.steps = result.steps;
      return;
    }

    job.status = "completed";
    job.stage = "completed";
    if (result.finalResponse !== undefined) job.reply = result.finalResponse;
    void agentHistory.record({ type: "job-completed", jobId, projectId, provider, model, status: "completed", message: result.finalResponse });
    job.steps = result.steps;
    job.productPlan = result.productPlan;
    const successfulBuild = result.steps.some((step) =>
      step.success &&
      (step.tool === "runCommand" || step.tool === "runSandbox") &&
      /npm run build/.test(step.input),
    );
    if (successfulBuild) {
      await stateManager.markBuildSucceeded();
    }
    await stateManager.refresh(message, result.productPlan, result.steps.filter((step) => step.success && /^(writeFile|patchFile|scaffoldProject)$/.test(step.tool)).map((step) => {
      try {
        const parsed = JSON.parse(step.input);
        return typeof parsed.path === "string" ? parsed.path : "";
      } catch { return ""; }
    }).filter(Boolean), result.steps.filter((step) => !step.success).map((step) => `${step.tool}: ${step.input.slice(0, 300)}`).slice(-20));
    await stateManager.markCompleted(message.slice(0, 240));
    console.log("[Nexum] chat job completed", jobId);
  } catch (error) {
    job.status = "failed";
    job.stage = "error";
    job.updatedAt = Date.now();
    job.error = error instanceof Error ? error.message : "AI provider request failed";
    void agentHistory.record({ type: "job-exception", jobId, projectId, provider, model, status: "failed", message: job.error });
    console.error("[Nexum] chat job failed", jobId, error);
  }
}


await projectManager.initialize();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "NEXUM.DEV API",
    aiProvider: defaultProvider,
    aiFallbackProvider: fallbackProvider ?? null,
    openRouterKeyConfigured: aiGateway.hasOpenRouterKey(),
    openAIKeyConfigured: aiGateway.hasOpenAIKey(),
    orcaRouterKeyConfigured: aiGateway.hasOrcaRouterKey(),
  });
});

app.get("/api/ai/providers", (_req, res) => {
  return res.json({ success: true, providers: aiGateway.getProviders() });
});

app.get("/api/ai/models", async (_req, res) => {
  return res.json({ success: true, models: await aiGateway.getModels() });
});

const localTestMode = process.env.NODE_ENV !== "production" && process.env.NEXUM_LOCAL_TEST_MODE !== "false";

app.get("/api/ai/key-status", (_req, res) => {
  return res.json({ success: true, providers: { openai: aiGateway.hasOpenAIKey(), openrouter: aiGateway.hasOpenRouterKey(), orcarouter: aiGateway.hasOrcaRouterKey() } });
});

app.post("/api/ai/connect-key", async (req, res) => {
  const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
  if (!apiKey) return res.status(400).json({ success: false, error: "API key is required" });

  const requestedProvider = typeof req.body?.provider === "string" ? req.body.provider.toLowerCase() : "";
  const candidates = requestedProvider === "openai" ? ["openai"]
    : requestedProvider === "openrouter" ? ["openrouter"]
    : requestedProvider === "orcarouter" ? ["orcarouter"]
    : /sk-orca-|orcarouter/i.test(apiKey) ? ["orcarouter", "openrouter", "openai"]
    : /or-|openrouter/i.test(apiKey) ? ["openrouter", "orcarouter", "openai"]
    : ["openai", "orcarouter", "openrouter"];

  const errors: string[] = [];
  for (const providerId of candidates) {
    try {
      if (providerId === "openai") {
        const provider = new OpenAIProvider();
        provider.setRuntimeApiKey(apiKey);
        const status = await provider.getStatus();
        if (!status.available) throw new Error(status.error ?? "OpenAI key verification failed");
        aiGateway.setRuntimeOpenAIKey(apiKey);
        return res.json({ success: true, provider: "openai", model: status.model, status });
      }
      if (providerId === "orcarouter") {
        const provider = new OrcaRouterProvider();
        provider.setRuntimeApiKey(apiKey);
        const status = await provider.getStatus();
        if (!status.available) throw new Error(status.error ?? "OrcaRouter key verification failed");
        aiGateway.setRuntimeOrcaRouterKey(apiKey);
        return res.json({ success: true, provider: "orcarouter", model: status.model, status });
      }

      const provider = new OpenRouterProvider();
      provider.setRuntimeApiKey(apiKey);
      const status = await provider.getStatus();
      if (!status.available) throw new Error(status.error ?? "OpenRouter key verification failed");
      aiGateway.setRuntimeOpenRouterKey(apiKey);
      return res.json({ success: true, provider: "openrouter", model: status.model, status });
    } catch (error) {
      errors.push(providerId + ": " + (error instanceof Error ? error.message : "verification failed"));
    }
  }
  return res.status(401).json({ success: false, error: errors.join("; ") || "API key verification failed" });
});

app.get("/api/ai/local-test", (_req, res) => {
  return res.json({ enabled: localTestMode, configured: aiGateway.hasOpenRouterKey() });
});

app.post("/api/ai/local-test", async (req, res) => {
  if (!localTestMode) {
    return res.status(403).json({ success: false, error: "Local AI key setup is disabled in production." });
  }

  const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
  if (!apiKey) {
    return res.status(400).json({ success: false, error: "Enter an OpenRouter API key." });
  }

  try {
    const provider = new OpenRouterProvider();
    provider.setRuntimeApiKey(apiKey);
    const status = await provider.getStatus();
    if (!status.available) {
      return res.status(401).json({ success: false, error: status.error ?? "OpenRouter key could not be verified." });
    }
    aiGateway.setRuntimeOpenRouterKey(apiKey);
    return res.json({ success: true, configured: true, status });
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: error instanceof Error ? error.message : "OpenRouter key verification failed",
    });
  }
});

app.get("/api/ai/status", async (req, res) => {
  const provider = typeof req.query.provider === "string" ? req.query.provider : undefined;
  const model = typeof req.query.model === "string" ? req.query.model : undefined;
  try {
    return res.json({ success: true, status: await aiGateway.getStatus(provider, model) });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "AI provider status failed",
    });
  }
});

app.get("/api/projects", async (_req, res) => {
  try {
    return res.json({ success: true, projects: await projectManager.listProjects() });
  } catch (error) {
    return sendProjectError(res, error);
  }
});

app.post("/api/projects", async (req, res) => {
  const { name } = req.body as { name?: unknown };
  if (typeof name !== "string") {
    return res.status(400).json({ success: false, error: "Project name is required" });
  }

  try {
    const project = await projectManager.createProject(name);
    return res.status(201).json({ success: true, project });
  } catch (error) {
    return sendProjectError(res, error);
  }
});

app.get("/api/projects/:id", async (req, res) => {
  try {
    return res.json({ success: true, project: await projectManager.getProject(req.params.id) });
  } catch (error) {
    return sendProjectError(res, error);
  }
});

app.post("/api/projects/:id/duplicate", async (req, res) => {
  try {
    const project = await projectManager.duplicateProject(req.params.id);
    return res.status(201).json({ success: true, project });
  } catch (error) {
    return sendProjectError(res, error);
  }
});

app.post("/api/projects/:id/select", async (req, res) => {
  try {
    return res.json({ success: true, project: await projectManager.selectProject(req.params.id) });
  } catch (error) {
    return sendProjectError(res, error);
  }
});

app.post("/api/projects/:id/archive", async (req, res) => {
  try {
    return res.json({ success: true, project: await projectManager.archiveProject(req.params.id) });
  } catch (error) {
    return sendProjectError(res, error);
  }
});

app.delete("/api/projects/:id", async (req, res) => {
  try {
    const project = await projectManager.deleteProject(req.params.id);
    return res.json({ success: true, project });
  } catch (error) {
    return sendProjectError(res, error);
  }
});

// Static project preview. The agent writes the project files, and the preview
// renders index.html directly without requiring a separate dev server.
app.use("/api/preview/:id", async (req, res) => {
  try {
    const project = await projectManager.getProject(req.params.id);
    const requestedPath = req.path.replace(/^\/+/, "") || "index.html";
    const distRoot = resolve(project.path, "dist");
    const distCandidate = resolve(distRoot, requestedPath);
    const sourceCandidate = resolve(project.path, requestedPath);
    const distIndex = resolve(distRoot, "index.html");
    const hasBuild = await stat(distIndex).then(() => true).catch(() => false);
    let filePath = hasBuild ? distCandidate : sourceCandidate;
    const requestedExtension = extname(requestedPath);

    // Support client-side routes in single-page apps: /dashboard, /settings, etc.
    // If the requested route is not a real asset, serve the app entry document.
    try {
      const candidateDetails = await stat(filePath);
      if (!candidateDetails.isFile()) return res.status(404).send("Preview file not found");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (requestedExtension) return res.status(404).send("Preview file not found");
      filePath = hasBuild ? distIndex : resolve(project.path, "index.html");
    }

    const projectRelative = relative(project.path, filePath);
    if (projectRelative.startsWith("..") || projectRelative.includes("../") || projectRelative.includes("..\\") || resolve(project.path, projectRelative) !== resolve(filePath)) {
      return res.status(403).send("Invalid preview path");
    }

    await assertExistingProjectPath(project.path, relative(project.path, filePath));
    const details = await stat(filePath);
    if (!details.isFile()) return res.status(404).send("Preview file not found");

    const mimeTypes: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".mjs": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".ico": "image/x-icon",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".ttf": "font/ttf",
      ".txt": "text/plain; charset=utf-8",
    };

    const extension = extname(filePath).toLowerCase();
    res.type(mimeTypes[extension] ?? "application/octet-stream");
    if (extension === ".html") {
      let html = await readFile(filePath, "utf8");

      // Preview is mounted below /api/preview/:id, while Vite production builds
      // usually emit root-relative /assets/... URLs. Rewrite those URLs so the
      // iframe can load JS/CSS/images from the same project preview namespace.
      const previewBase = `/api/preview/${encodeURIComponent(req.params.id)}/`;
      html = html
        .replace(/(src|href|action)=(["'])\/(?!\/)/gi, `$1=$2${previewBase}`)
        .replace(/url\((["']?)\/(?!\/)/gi, `url($1${previewBase}`);

      const headTag = "<base href=\"" + previewBase + "\">";
      if (!/<base\s/i.test(html)) {
        const headIndex = html.toLowerCase().indexOf("<head");
        const headClose = html.toLowerCase().indexOf(">", headIndex);
        html = headClose >= 0 ? html.slice(0, headClose + 1) + headTag + html.slice(headClose + 1) : headTag + html;
      }

      const runtimeBridge = "<script>(() => { const projectId = " + JSON.stringify(req.params.id) + "; const report = (kind, message, stack) => { try { parent.postMessage({ source: \"nexum-preview\", projectId, kind, message: String(message || \"Preview runtime error\").slice(0, 4000), stack: stack ? String(stack).slice(0, 8000) : undefined }, \"*\"); } catch {} }; window.addEventListener(\"error\", (event) => report(\"error\", event.message, event.error && event.error.stack)); window.addEventListener(\"unhandledrejection\", (event) => report(\"unhandledrejection\", event.reason instanceof Error ? event.reason.message : String(event.reason), event.reason instanceof Error ? event.reason.stack : undefined)); })();</script>";
      const bodyIndex = html.toLowerCase().lastIndexOf("</body>");
      return res.send(bodyIndex >= 0 ? html.slice(0, bodyIndex) + runtimeBridge + html.slice(bodyIndex) : html + runtimeBridge);
    }
    return res.send(await readFile(filePath));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return res.status(404).send("Preview is not available yet. Ask NEXUM to create the app.");
    if (error instanceof ProjectManagerError) return sendProjectError(res, error);
    return res.status(500).send("Preview failed");
  }
});

app.post("/api/projects/:id/preview/runtime-error", async (req, res) => {
  try {
    const project = await projectManager.getProject(req.params.id);
    const message = typeof req.body?.message === "string" ? req.body.message.slice(0, 4000) : "Preview runtime error";
    const stack = typeof req.body?.stack === "string" ? req.body.stack.slice(0, 8000) : undefined;
    const kind = typeof req.body?.kind === "string" ? req.body.kind.slice(0, 80) : "error";
    const stateManager = projectStates.get(project.id) ?? new ProjectStateManager(project.path, project.id);
    projectStates.set(project.id, stateManager);
    await stateManager.refresh(undefined, undefined, [], [`preview:${kind}: ${message}`]);
    void agentHistory.record({
      type: "preview-runtime-error",
      projectId: project.id,
      status: "error",
      message,
      output: JSON.stringify({ kind, stack }),
    });
    return res.status(202).json({ success: true });
  } catch (error) {
    return sendProjectError(res, error);
  }
});

app.get("/api/projects/:id/files", async (req, res) => {
  try {
    const project = await projectManager.getProject(req.params.id);
    const root = resolve(project.path);
    const entries = await readdir(root, { withFileTypes: true, recursive: true });
    const files = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.parentPath ? relative(root, resolve(entry.parentPath, entry.name)) : entry.name)
      .filter((file) => !file.startsWith(".git/") && !file.includes("node_modules/"))
      .sort();
    return res.json({ success: true, files });
  } catch (error) {
    const statusCode = error instanceof ProjectManagerError ? error.statusCode : 500;
    return res.status(statusCode).json({ success: false, error: error instanceof Error ? error.message : "Unable to list project files" });
  }
});

app.get("/api/projects/:id/file", async (req, res) => {
  try {
    const project = await projectManager.getProject(req.params.id);
    const requested = typeof req.query.path === "string" ? req.query.path : "";
    if (!requested) return res.status(400).json({ success: false, error: "File path is required" });
    const filePath = resolve(project.path, requested);
    const projectRelative = relative(project.path, filePath);
    if (projectRelative.startsWith("..") || projectRelative.includes("../") || projectRelative.includes("..\\") || projectRelative.startsWith(".git/") || projectRelative.includes("node_modules/")) {
      return res.status(403).json({ success: false, error: "Invalid file path" });
    }
    await assertExistingProjectPath(project.path, requested);
    const details = await stat(filePath);
    if (!details.isFile()) return res.status(404).json({ success: false, error: "File not found" });
    return res.json({ success: true, path: projectRelative, content: await readFile(filePath, "utf8") });
  } catch (error) {
    if (error instanceof ProjectPathError) return res.status(403).json({ success: false, error: error.message });
    return sendProjectError(res, error);
  }
});

app.put("/api/projects/:id/file", async (req, res) => {
  try {
    const project = await projectManager.getProject(req.params.id);
    const { path: requested, content } = req.body as { path?: unknown; content?: unknown };
    if (typeof requested !== "string" || typeof content !== "string") return res.status(400).json({ success: false, error: "path and content are required" });
    const filePath = resolve(project.path, requested);
    const projectRelative = relative(project.path, filePath);
    if (projectRelative.startsWith("..") || projectRelative.includes("../") || projectRelative.includes("..\\") || projectRelative.startsWith(".git/") || projectRelative.includes("node_modules/")) {
      return res.status(403).json({ success: false, error: "Invalid file path" });
    }
    await assertWritableProjectPath(project.path, requested);
    const fs = await import("node:fs/promises");
    await fs.mkdir(dirname(filePath), { recursive: true });
    // Re-check after creating parent directories to reject symlinked paths.
    await assertWritableProjectPath(project.path, requested);
    await fs.writeFile(filePath, content, "utf8");
    return res.json({ success: true, path: projectRelative });
  } catch (error) {
    if (error instanceof ProjectPathError) return res.status(403).json({ success: false, error: error.message });
    return sendProjectError(res, error);
  }
});

app.get("/api/projects/:id/git/:operation", async (req, res) => {
  try {
    const project = await projectManager.getProject(req.params.id);
    const operation = req.params.operation;
    if (!["status", "diff", "diff-stat", "log", "branch"].includes(operation)) {
      return res.status(400).json({ success: false, error: "Unsupported Git operation" });
    }
    const result = await new GitTool(resolve(project.path)).execute(operation);
    return res.status(result.success ? 200 : 422).json({
      success: result.success,
      operation: result.operation,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    });
  } catch (error) {
    return sendProjectError(res, error);
  }
});

app.post("/api/projects/:id/run", async (req, res) => {
  try {
    const project = await projectManager.getProject(req.params.id);
    const command = typeof req.body?.command === "string" ? req.body.command.trim() : "";
    const allowed = new Set(["npm run build", "npm run test", "npm run lint", "npm run typecheck", "git status", "git diff", "git log"]);
    if (!allowed.has(command)) return res.status(400).json({ success: false, error: "Command is not allowed" });
    const result = await new RunCommandTool(resolve(project.path), 120000).execute(command);
    const problems = result.success ? [] : [{
      message: result.stderr || result.stdout || "Command failed",
      source: command,
    }];
    return res.status(result.success ? 200 : 422).json({
      success: result.success,
      command,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      problems,
    });
  } catch (error) {
    return sendProjectError(res, error);
  }
});

app.get("/api/projects/:id/state", async (req, res) => {
  try {
    const project = await projectManager.getProject(req.params.id);
    const stateManager = projectStates.get(project.id) ?? new ProjectStateManager(project.path, project.id);
    projectStates.set(project.id, stateManager);
    const state = await stateManager.refresh();
    return res.json({ success: true, state });
  } catch (error) {
    if (error instanceof ProjectManagerError) return sendProjectError(res, error);
    return res.status(500).json({ success: false, error: "Unable to read project state" });
  }
});

app.get("/api/projects/:id/preview/status", async (req, res) => {
  try {
    const project = await projectManager.getProject(req.params.id);
    const packagePath = resolve(project.path, "package.json");
    const distIndexPath = resolve(project.path, "dist", "index.html");
    const sourceIndexPath = resolve(project.path, "index.html");
    const hasPackage = await stat(packagePath).then((details) => details.isFile()).catch(() => false);
    const hasDist = await stat(distIndexPath).then((details) => details.isFile()).catch(() => false);
    const hasSource = await stat(sourceIndexPath).then((details) => details.isFile()).catch(() => false);

    // React/Vite apps must have a production bundle. Static HTML projects can
    // be previewed directly from their source index.html.
    const online = hasPackage ? hasDist : hasSource;
    return res.json({
      online,
      url: online ? `/api/preview/${project.id}/index.html` : null,
      mode: hasPackage ? "built-app" : "static",
      reason: online ? null : hasPackage ? "Production build is missing" : "index.html is missing",
    });
  } catch (error) {
    if (error instanceof ProjectManagerError) return sendProjectError(res, error);
    return res.status(500).json({ online: false, url: null, error: "Unable to determine preview status" });
  }
});

app.post("/api/chat", async (req, res) => {
  const { message, projectId, provider, model, attachments, conversation } = req.body as {
    message?: unknown;
    projectId?: unknown;
    provider?: unknown;
    model?: unknown;
    attachments?: unknown;
    conversation?: unknown;
  };

  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Message is required" });
  }
  if (projectId !== undefined && typeof projectId !== "string") {
    return res.status(400).json({ error: "projectId must be a string" });
  }
  if (provider !== undefined && typeof provider !== "string") {
    return res.status(400).json({ error: "provider must be a string" });
  }
  if (model !== undefined && typeof model !== "string") {
    return res.status(400).json({ error: "model must be a string" });
  }
  if (attachments !== undefined && (!Array.isArray(attachments) || attachments.length > 5)) {
    return res.status(400).json({ error: "attachments must be an array of up to 5 files" });
  }
  const normalizedAttachments = Array.isArray(attachments)
    ? attachments.map((item) => item as { name?: unknown; type?: unknown; size?: unknown; content?: unknown; data?: unknown }).filter((item) =>
        typeof item.name === "string" && typeof item.size === "number" &&
        (typeof item.content === "string" || typeof item.data === "string"),
      ).map((item) => ({
        name: String(item.name).slice(0, 160),
        type: typeof item.type === "string" ? item.type.slice(0, 120) : "application/octet-stream",
        size: Math.max(0, Math.min(Number(item.size), 2_000_000)),
        ...(typeof item.content === "string" ? { content: item.content.slice(0, 80_000) } : {}),
        ...(typeof item.data === "string" ? { data: item.data.slice(0, 3_000_000) } : {}),
      }))
    : [];
  const normalizedConversation = Array.isArray(conversation)
    ? conversation
      .map((item) => item as { role?: unknown; content?: unknown })
      .filter((item) => (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
      .slice(-8)
      .map((item) => ({ role: item.role as "user" | "assistant", content: String(item.content).slice(0, 900) }))
    : [];

  try {
    // Validate the project before creating the background job so bad project IDs
    // still fail immediately instead of creating a job that can never run.
    await projectManager.getActiveProject(projectId);

    cleanupChatJobs();
    const jobId = randomUUID();
    const now = Date.now();
    chatJobs.set(jobId, {
      id: jobId,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      stage: "queued",
      attachments: normalizedAttachments.map((item) => item.name),
      productPlan: undefined,
    });

    // Do not await the agent. The HTTP request returns immediately, avoiding
    // platform/proxy 504s while local Ollama or another provider is generating.
    void runChatJob(
      jobId,
      message.trim(),
      projectId,
      provider,
      model,
      normalizedAttachments,
      normalizedConversation,
    );

    return res.status(202).json({
      success: true,
      jobId,
      status: "queued",
    });
  } catch (error) {
    return res.status(502).json({
      error: error instanceof Error ? error.message : "Chat job creation failed",
    });
  }
});

app.get("/api/agent/history", async (req, res) => {
  const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 200;
  return res.json({ success: true, entries: await agentHistory.recent(Number.isFinite(limit) ? limit : 200) });
});

app.post("/api/agent/client-error", async (req, res) => {
  const { message, stack, source, url } = req.body as {
    message?: unknown;
    stack?: unknown;
    source?: unknown;
    url?: unknown;
  };
  const errorMessage = typeof message === "string" ? message.slice(0, 4000) : "Unknown client error";
  void agentHistory.record({
    type: "client-error",
    status: "error",
    message: errorMessage,
    output: JSON.stringify({
      stack: typeof stack === "string" ? stack.slice(0, 8000) : undefined,
      source: typeof source === "string" ? source.slice(0, 500) : undefined,
      url: typeof url === "string" ? url.slice(0, 1000) : undefined,
    }),
  });
  return res.status(202).json({ success: true });
});

app.get("/api/agent/diagnostics", async (req, res) => {
  const rawLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : 100;
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 100;
  const entries = await agentHistory.recent(limit);
  const failures = entries.filter((entry) =>
    (entry.type === "agent-event" && (entry.status === "tool-error" || entry.status === "failed")) ||
    entry.type === "job-failed" ||
    entry.type === "job-exception" ||
    entry.type === "provider-fallback"
  );
  return res.json({
    success: true,
    generatedAt: new Date().toISOString(),
    service: "NEXUM.DEV API",
    aiProvider: defaultProvider,
    failureCount: failures.length,
    failures,
    jobs: [...chatJobs.values()].slice(-20).map((job) => ({
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      error: job.error,
      problems: job.problems,
    })),
    recent: entries,
  });
});

app.get("/api/chat/jobs/:id", (req, res) => {
  cleanupChatJobs();
  const job = chatJobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({
      success: false,
      error: "Chat job not found or expired",
    });
  }

  return res.json({
    success: true,
    job: {
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      reply: job.reply ?? null,
      steps: job.steps ?? [],
      events: job.events ?? [],
      currentMessage: job.currentMessage ?? null,
      problems: job.problems ?? [],
      commandOutput: job.commandOutput ?? null,
      error: job.error ?? null,
      stage: job.stage ?? null,
      attachments: job.attachments ?? [],
      productPlan: job.productPlan ?? null,
    },
  });
});

const webDist = resolve(workspaceRoot, "apps/web/dist");

app.use(express.static(webDist));

app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) return next();

  const indexPath = resolve(webDist, "index.html");
  return res.sendFile(indexPath, (error) => {
    if (!error) return;

    // In local development the API and Vite dev server run separately.
    // Do not let a missing production build turn into an uncaught ENOENT.
    if (!res.headersSent) {
      return res.status(404).send(
        "NEXUM web build is not available here. Open the Vite app on port 5173."
      );
    }
  });
});

function sendProjectError(res: Response, error: unknown) {
  if (error instanceof ProjectManagerError) {
    return res.status(error.statusCode).json({ success: false, error: error.message });
  }
  return res.status(500).json({ success: false, error: "Project manager request failed" });
}

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || "0.0.0.0";
app.listen(PORT, HOST, () => {
  console.log(`NEXUM API running on http://${HOST}:${PORT}`);
});
