import express from "express";
import type { Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { AIGateway } from "./ai/gateway.js";
import { MockProvider } from "./ai/providers/mock.js";
import { OllamaProvider } from "./ai/providers/ollama.js";
import { OpenRouterProvider } from "./ai/providers/openrouter.js";
import { NexumAgent } from "./agent/agent.js";
import { AgentLoop } from "./agent/loop.js";
import { ProjectManager, ProjectManagerError } from "./projects/projectManager.js";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

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

await projectManager.initialize();

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "NEXUM.DEV API" });
});

app.get("/api/ai/providers", (_req, res) => {
  return res.json({ success: true, providers: aiGateway.getProviders() });
});

app.get("/api/ai/models", async (_req, res) => {
  return res.json({ success: true, models: await aiGateway.getModels() });
});

app.get("/api/ai/status", async (req, res) => {
  const provider = typeof req.query.provider === "string" ? req.query.provider : undefined;
  try {
    return res.json({ success: true, status: await aiGateway.getStatus(provider) });
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
    const filePath = resolve(project.path, requestedPath);
    const projectRelative = relative(project.path, filePath);

    if (projectRelative.startsWith("..") || projectRelative.includes(".."+"/") || projectRelative.includes(".."+String.fromCharCode(92))) {
      return res.status(403).send("Invalid preview path");
    }

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

app.get("/api/projects/:id/preview/status", async (req, res) => {
  try {
    const project = await projectManager.getProject(req.params.id);
    await stat(resolve(project.path, "index.html"));
    return res.json({ online: true, url: `/api/preview/${project.id}/index.html` });
  } catch {
    return res.json({ online: false, url: null });
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
    const project = await projectManager.getActiveProject(projectId);
    const agent = new NexumAgent(aiGateway, project.path);
    const agentLoop = new AgentLoop(agent, aiGateway);
    const result = await agentLoop.run(message, {
      ...(provider === undefined ? {} : { provider }),
      ...(model === undefined ? {} : { model }),
    });

    return res.json({
      reply: result.success ? result.finalResponse : result.error,
      steps: result.steps,
    });
  } catch (error) {
    return res.status(502).json({
      error: error instanceof Error ? error.message : "AI provider request failed",
    });
  }
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`NEXUM API running on port ${PORT}`);
});
