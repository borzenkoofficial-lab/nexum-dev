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
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const app = express();
const configuredProvider = process.env.AI_PROVIDER?.toLowerCase();
const aiGateway = new AIGateway(
  [new MockProvider(), new OllamaProvider(), new OpenRouterProvider()],
  configuredProvider === "ollama" || configuredProvider === "openrouter" ? configuredProvider : "mock",
);
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const projectManager = new ProjectManager(workspaceRoot);

await projectManager.initialize();

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "NEXUM.DEV API",
  });
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

app.post("/api/chat", async (req, res) => {
  const { message, projectId, provider, model } = req.body as {
    message?: unknown;
    projectId?: unknown;
    provider?: unknown;
    model?: unknown;
  };

  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({
      error: "Message is required",
    });
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
    });
  } catch (error) {
    return res.status(502).json({
      error: error instanceof Error ? error.message : "AI provider request failed",
    });
  }
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