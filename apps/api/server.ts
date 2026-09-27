import express from "express";
import type { Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { AIGateway } from "./ai/gateway.js";
import { MockProvider } from "./ai/providers/mock.js";
import { OllamaProvider } from "./ai/providers/ollama.js";
import { OpenRouterProvider } from "./ai/providers/openrouter.js";
import { NexumAgent } from "./agent/agent.js";
import { AgentLoop, type AgentEvent } from "./agent/loop.js";
import { ProjectManager, ProjectManagerError } from "./projects/projectManager.js";
import { readFile, stat, readdir } from "node:fs/promises";
import { dirname, resolve, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { GitTool } from "./agent/tools/git.js";
import { RunCommandTool } from "./agent/tools/runCommand.js";
import { assertExistingProjectPath, assertWritableProjectPath, ProjectPathError } from "./agent/tools/path.js";

dotenv.config();

const app = express();
const configuredProvider = process.env.AI_PROVIDER?.toLowerCase();
const defaultProvider = configuredProvider === "ollama" || configuredProvider === "openrouter"
  ? configuredProvider
  : process.env.OPENROUTER_API_KEY?.trim()
    ? "openrouter"
    : "mock";
const aiGateway = new AIGateway(
  [new MockProvider(), new OllamaProvider(), new OpenRouterProvider()],
  defaultProvider,
);
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const projectManager = new ProjectManager(workspaceRoot);

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
) {
  const job = chatJobs.get(jobId);
  if (!job) return;

  job.status = "running";
  job.updatedAt = Date.now();
  job.currentMessage = "Запускаю AI-агента и начинаю выполнение задачи.";

  try {
    const project = await projectManager.getActiveProject(projectId);
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
        job.updatedAt = Date.now();
        if (event.type === "tool-error" || event.type === "failed") {
          job.problems = [
            ...(job.problems ?? []),
            event.tool ? { message: event.message, source: event.tool } : { message: event.message },
          ];
        }
      },
    );
    const result = await agentLoop.run(message, {
      ...(provider === undefined ? {} : { provider }),
      ...(model === undefined ? {} : { model }),
    });

    job.updatedAt = Date.now();
    if (!result.success) {
      job.status = "failed";
      job.error = result.error ?? "AI agent failed";
      job.steps = result.steps;
      return;
    }

    job.status = "completed";
    if (result.finalResponse !== undefined) job.reply = result.finalResponse;
    job.steps = result.steps;
    console.log("[Nexum] chat job completed", jobId);
  } catch (error) {
    job.status = "failed";
    job.updatedAt = Date.now();
    job.error = error instanceof Error ? error.message : "AI provider request failed";
    console.error("[Nexum] chat job failed", jobId, error);
  }
}


await projectManager.initialize();

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "NEXUM.DEV API", aiProvider: defaultProvider, openRouterKeyConfigured: Boolean(process.env.OPENROUTER_API_KEY?.trim()) });
});

app.get("/api/ai/providers", (_req, res) => {
  return res.json({ success: true, providers: aiGateway.getProviders() });
});

app.get("/api/ai/models", async (_req, res) => {
  return res.json({ success: true, models: await aiGateway.getModels() });
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

    res.type(mimeTypes[extname(filePath).toLowerCase()] ?? "application/octet-stream");
    return res.send(await readFile(filePath));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return res.status(404).send("Preview is not available yet. Ask NEXUM to create the app.");
    if (error instanceof ProjectManagerError) return sendProjectError(res, error);
    return res.status(500).send("Preview failed");
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
  const { message, projectId, provider, model } = req.body as {
    message?: unknown;
    projectId?: unknown;
    provider?: unknown;
    model?: unknown;
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
    });

    // Do not await the agent. The HTTP request returns immediately, avoiding
    // platform/proxy 504s while local Ollama or another provider is generating.
    void runChatJob(
      jobId,
      message.trim(),
      projectId,
      provider,
      model,
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
