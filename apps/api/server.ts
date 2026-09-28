import express from "express";
import type { Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { AIGateway, type GatewayFallbackEvent } from "./ai/gateway.js";
import { MockProvider } from "./ai/providers/mock.js";
import { OllamaProvider } from "./ai/providers/ollama.js";
import { OpenRouterProvider } from "./ai/providers/openrouter.js";
import { OpenAIProvider } from "./ai/providers/openai.js";
import { AnthropicProvider } from "./ai/providers/anthropic.js";
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
import { CheckpointManager } from "./agent/checkpoint.js";
import { ProjectStateManager } from "./projects/projectState.js";
import { authMiddleware, authenticateUser, clearSessionCookie, createUser, getAuthUser, issueSession } from "./auth.js";
import { pingDatabase } from "./db.js";
import { clearRuntimeMemory, loadRuntimeKeys, saveRuntimeKey } from "./ai/runtimeKeys.js";
import { readDesignSpec, writeDesignSpec, deriveDesignSpec } from "./design/designSpec.js";
import { interactionScript } from "./design/interactionContract.js";
import { verifyDesign } from "./design/visualVerification.js";
import { prepareAutonomousDesignPipeline, finalizeAutonomousDesignPipeline, getPipelineSnapshot, evaluatePipelineGates } from "./design/autonomousPipeline.js";
import { createPipelineController, decidePipelineRecovery, recoveryPromptFor } from "./design/pipelineController.js";
import { componentContracts } from "./design/componentIntelligence.js";
import { allowedInteraction, createInteractionRecord, resolveInteraction } from "./design/interactionEngine.js";
import { inspectLiveUpdate } from "./design/liveUpdate.js";
import { readStateSpec, writeStateSpec } from "./design/stateEngine.js";
import { extractIntent } from "./ai/intentEngine.js";

dotenv.config();

const app = express();
const configuredProvider = process.env.AI_PROVIDER?.toLowerCase();
const defaultProvider = configuredProvider === "ollama" || configuredProvider === "openrouter" || configuredProvider === "openai" || configuredProvider === "anthropic" || configuredProvider === "orcarouter"
  ? configuredProvider
  : process.env.ORCAROUTER_API_KEY?.trim()
    ? "orcarouter"
    : process.env.OPENAI_API_KEY?.trim()
      ? "openai"
      : process.env.ANTHROPIC_API_KEY?.trim()
        ? "anthropic"
      : process.env.OPENROUTER_API_KEY?.trim()
        ? "openrouter"
        : "mock";
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const projectManagers = new Map<string, ProjectManager>();

type RuntimeAIKeys = Partial<Record<"openai" | "openrouter" | "orcarouter", string>>;
const runtimeAIKeysByUser = new Map<string, RuntimeAIKeys>();

async function getUserAIGateway(userId: string): Promise<AIGateway> {
  const persisted = await loadRuntimeKeys(userId);
  const keys = { ...persisted, ...(runtimeAIKeysByUser.get(userId) ?? {}) };
  runtimeAIKeysByUser.set(userId, keys);
  const gateway = new AIGateway(
    [new MockProvider(), new OllamaProvider(), new OpenRouterProvider(), new OpenAIProvider(), new AnthropicProvider(), new OrcaRouterProvider()],
    defaultProvider,
    { fallbackProviderId: fallbackProvider },
  );
  for (const providerId of ["openai", "openrouter", "orcarouter"] as const) {
    const key = keys[providerId];
    if (key) gateway.setRuntimeProviderKey(providerId, key);
  }
  return gateway;
}

function getProjectManager(userId: string): ProjectManager {
  let manager = projectManagers.get(userId);
  if (!manager) {
    manager = new ProjectManager(resolve(workspaceRoot, "runtime", "users", userId));
    projectManagers.set(userId, manager);
  }
  return manager;
}
const agentHistory = new AgentHistory(workspaceRoot);
const checkpointManager = new CheckpointManager();
const projectStates = new Map<string, ProjectStateManager>();
const fallbackProvider = process.env.AI_FALLBACK_PROVIDER?.toLowerCase() ||
  (defaultProvider === "ollama" ? "openrouter" : defaultProvider === "orcarouter" ? "openrouter" : undefined);

const aiGateway = new AIGateway(
  [new MockProvider(), new OllamaProvider(), new OpenRouterProvider(), new OpenAIProvider(), new AnthropicProvider(), new OrcaRouterProvider()],
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
  checkpointId?: string;
  userId?: string;
}
const chatJobs = new Map<string, ChatJob>();
const CHAT_JOB_TTL_MS = 30 * 60 * 1000;
const runtimeRecoveryInFlight = new Set<string>();
const projectJobsInFlight = new Set<string>();
const runtimeRecoveryLastStartedAt = new Map<string, number>();
const RUNTIME_RECOVERY_COOLDOWN_MS = 60_000;

type PreviewSubscriber = { userId: string; projectId: string; response: Response };
const previewSubscribers = new Map<string, Set<PreviewSubscriber>>();

function previewSubscriberKey(userId: string, projectId: string): string {
  return userId + ":" + projectId;
}

function closePreviewSubscriber(subscriber: PreviewSubscriber): void {
  const key = previewSubscriberKey(subscriber.userId, subscriber.projectId);
  const subscribers = previewSubscribers.get(key);
  if (!subscribers) return;
  subscribers.delete(subscriber);
  if (subscribers.size === 0) previewSubscribers.delete(key);
}

async function broadcastPreviewRevision(userId: string, projectId: string, projectPath: string): Promise<void> {
  const key = previewSubscriberKey(userId, projectId);
  const subscribers = previewSubscribers.get(key);
  if (!subscribers?.size) return;
  const live = await inspectLiveUpdate(projectPath, projectId);
  const payload = JSON.stringify(live);
  for (const subscriber of [...subscribers]) {
    try {
      subscriber.response.write(`event: preview-update\\ndata: ${payload}\\n\\n`);
    } catch {
      closePreviewSubscriber(subscriber);
    }
  }
}

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
  userId: string,
  provider: string | undefined,
  model: string | undefined,
  attachments: Array<{ name: string; type: string; size: number; content?: string; data?: string }>,
  conversation: Array<{ role: "user" | "assistant"; content: string }>,
) {
  const job = chatJobs.get(jobId);
  if (!job) return;
  let projectLockKey: string | undefined;

  job.status = "running";
  job.updatedAt = Date.now();
  void agentHistory.record({ type: "job-start", jobId, projectId, userId, provider, model, message });
  job.currentMessage = "Запускаю AI-агента и начинаю выполнение задачи.";
  job.stage = "analyzing";

  try {
    const project = await getProjectManager(userId).getActiveProject(projectId);
    projectLockKey = userId + ":" + project.id;
    const stateManager = projectStates.get(project.path) ?? new ProjectStateManager(project.path, project.id);
    projectStates.set(project.path, stateManager);
    const checkpoint = await checkpointManager.create(project.id, project.path, `before agent job ${jobId}`);
    job.checkpointId = checkpoint.id;
    await stateManager.refresh(message);
    void agentHistory.record({
      type: "checkpoint-created",
      jobId,
      projectId: project.id,
      userId,
      status: "success",
      message: "Automatic pre-task checkpoint created",
      output: JSON.stringify({ checkpointId: checkpoint.id, files: checkpoint.files.length }),
    });
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
          attachmentContext.push(`Attached text file ${safeName}:\
${attachment.content.slice(0, 80_000)}`);
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
    const userGateway = await getUserAIGateway(userId);
    const agent = new NexumAgent(userGateway, project.path);
    const agentLoop = new AgentLoop(
      agent,
      userGateway,
      undefined,
      (step) => {
        job.steps = [...(job.steps ?? []), step];
        job.updatedAt = Date.now();
      },
      (event) => {
        job.events = [...(job.events ?? []), event].slice(-100);
        job.currentMessage = event.message;
        if (event.type === "thinking") {
          job.stage =
            event.phase === "analyze" ? "analyzing" :
            event.phase === "plan" ? "planning" :
            event.phase === "implement" ? "editing" :
            event.phase === "validate" ? "building" :
            event.phase === "repair" ? "error" :
            event.phase === "verify" ? "testing" :
            event.phase === "finish" ? "completed" :
            event.iteration === 0 ? "analyzing" : "planning";
        }
        if (event.type === "tool-start") {
          if (event.tool === "listFiles" || event.tool === "readFile" || event.tool === "searchFiles") job.stage = "reading";
          else if (event.tool === "writeFile" || event.tool === "scaffoldProject") job.stage = "editing";
          else if (event.tool === "runSandbox" || event.tool === "runCommand") job.stage = /test/i.test(event.message) ? "testing" : "building";
        }
        if (event.type === "tool-error" || event.type === "failed") job.stage = "error";
        job.updatedAt = Date.now();
        void agentHistory.record({ type: "agent-event", jobId, projectId, userId, provider, model, iteration: event.iteration, tool: event.tool, status: event.type, message: event.message });
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
    // Establish the executable DesignSpec before the first AI implementation pass.
    // This makes design a build-time contract, not a post-build decoration.
    await prepareAutonomousDesignPipeline(project.path, extractIntent(message));

    let result = await agentLoop.run(agentMessage, {
      ...(provider === undefined ? {} : { provider }),
      ...(model === undefined ? {} : { model }),
    });

    job.updatedAt = Date.now();
    if (!result.success) {
      job.status = "failed";
      job.stage = "error";
      job.error = result.error ?? "AI agent failed";
      void agentHistory.record({ type: "job-failed", jobId, projectId, userId, provider, model, status: "failed", message: job.error });
      job.steps = result.steps;
      projectJobsInFlight.delete(projectLockKey);
      return;
    }

    // A successful agent loop is necessary but not sufficient: the product must
    // also pass the design/component/interaction/verification/build/live gates.
    job.steps = result.steps;
    job.productPlan = result.productPlan;
    if (result.finalResponse !== undefined) job.reply = result.finalResponse;
    let successfulBuild = result.steps.some((step) =>
      step.success &&
      (step.tool === "runCommand" || step.tool === "runSandbox") &&
      /(?:npm run build|pnpm (?:run )?build|yarn build|bun run build)/i.test(step.input),
    );
    let finalizedPipeline = await finalizeAutonomousDesignPipeline(project.path, project.id, successfulBuild);
    const pipelineController = createPipelineController(3);

    while (!finalizedPipeline.completed) {
      const gates = evaluatePipelineGates(finalizedPipeline);
      const decision = decidePipelineRecovery(finalizedPipeline, gates, pipelineController);
      if (decision.exhausted) break;

      const recoveryMessage = [
        agentMessage,
        "",
        recoveryPromptFor(decision),
        "",
        `Current pipeline stage: ${finalizedPipeline.stage}`,
        `Gate detail: ${decision.gate?.detail ?? "unknown"}`,
      ].join("\n");
      const recoveryResult = await agentLoop.run(recoveryMessage, {
        ...(provider === undefined ? {} : { provider }),
        ...(model === undefined ? {} : { model }),
      });
      result = recoveryResult;
      job.steps = recoveryResult.steps;
      job.productPlan = recoveryResult.productPlan ?? job.productPlan;
      if (recoveryResult.finalResponse !== undefined) job.reply = recoveryResult.finalResponse;
      if (!recoveryResult.success) break;
      successfulBuild = successfulBuild || recoveryResult.steps.some((step) =>
        step.success &&
        (step.tool === "runCommand" || step.tool === "runSandbox") &&
        /(?:npm run build|pnpm (?:run )?build|yarn build|bun run build)/i.test(step.input),
      );
      finalizedPipeline = await finalizeAutonomousDesignPipeline(project.path, project.id, successfulBuild);
    }

    if (successfulBuild) {
      await stateManager.markBuildSucceeded();
      await broadcastPreviewRevision(userId, project.id, project.path);
    }
    if (!finalizedPipeline.completed) {
      job.problems = [
        ...(job.problems ?? []),
        {
          message: finalizedPipeline.readyForLive
            ? "Autonomous pipeline is live-ready but build verification evidence is incomplete."
            : `Autonomous pipeline stopped at stage: ${finalizedPipeline.stage}.`,
          source: "autonomous-pipeline",
        },
      ];
    }

    // The externally visible job status follows the final acceptance gates.
    // This prevents the UI/API from reporting "completed" while verification
    // still has a failed gate.
    job.status = finalizedPipeline.completed ? "completed" : "failed";
    job.stage = finalizedPipeline.completed ? "completed" : "error";
    job.currentMessage = finalizedPipeline.completed
      ? "Autonomous pipeline completed: build, design verification and live preview are ready."
      : `Autonomous pipeline failed acceptance gates at stage: ${finalizedPipeline.stage}.`;
    void agentHistory.record({
      type: finalizedPipeline.completed ? "job-completed" : "job-failed",
      jobId,
      projectId,
      userId,
      provider,
      model,
      status: finalizedPipeline.completed ? "completed" : "failed",
      message: job.currentMessage,
    });
    void agentHistory.record({
      type: "autonomous-pipeline",
      jobId,
      projectId: project.id,
      userId,
      status: finalizedPipeline.completed ? "completed" : "error",
      message: job.currentMessage,
      output: JSON.stringify({
        preparedStage: finalizedPipeline.stage,
        finalStage: finalizedPipeline.stage,
        buildVerified: finalizedPipeline.buildVerified,
        readyForLive: finalizedPipeline.readyForLive,
        verificationScore: finalizedPipeline.verification?.score ?? 0,
      }),
    });
    await stateManager.refresh(message, result.productPlan, result.steps.filter((step) => step.success && /^(writeFile|patchFile|scaffoldProject)$/.test(step.tool)).map((step) => {
      try {
        const parsed = JSON.parse(step.input);
        return typeof parsed.path === "string" ? parsed.path : "";
      } catch { return ""; }
    }).filter(Boolean), result.steps.filter((step) => !step.success).map((step) => `${step.tool}: ${step.input.slice(0, 300)}`).slice(-20));
    if (finalizedPipeline.completed) {
      await stateManager.markCompleted(message.slice(0, 240));
    } else {
      await stateManager.refresh(
        message,
        result.productPlan,
        [],
        (job.problems ?? []).map((problem) => problem.message).slice(-20),
      );
    }
    projectJobsInFlight.delete(projectLockKey);
    console.log("[Nexum] chat job finished", jobId, job.status);
  } catch (error) {
    job.status = "failed";
    job.stage = "error";
    job.updatedAt = Date.now();
    job.error = error instanceof Error ? error.message : "AI provider request failed";
    void agentHistory.record({ type: "job-exception", jobId, projectId, userId, provider, model, status: "failed", message: job.error });
    if (projectLockKey) projectJobsInFlight.delete(projectLockKey);
    console.error("[Nexum] chat job failed", jobId, error);
  }
}


// Project managers are initialized lazily per authenticated user.

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/api/health", async (_req, res) => {
  const database = await pingDatabase();
  res.json({
    status: database.ok ? "ok" : "degraded",
    database,
    service: "NEXUM.DEV API",
    aiProvider: defaultProvider,
    aiFallbackProvider: fallbackProvider ?? null,
    openRouterKeyConfigured: aiGateway.hasOpenRouterKey(),
    openAIKeyConfigured: aiGateway.hasOpenAIKey(),
    orcaRouterKeyConfigured: aiGateway.hasOrcaRouterKey(),
  });
});


app.post("/api/auth/register", async (req, res) => {
  try {
    const email = typeof req.body?.email === "string" ? req.body.email : "";
    const name = typeof req.body?.name === "string" ? req.body.name : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const user = await createUser(email, name, password);
    issueSession(res, user);
    return res.status(201).json({ success: true, user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Registration failed";
    return res.status(message.includes("already exists") ? 409 : 400).json({ success: false, error: message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = typeof req.body?.email === "string" ? req.body.email : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const user = await authenticateUser(email, password);
    if (!user) return res.status(401).json({ success: false, error: "Invalid email or password" });
    issueSession(res, user);
    return res.json({ success: true, user });
  } catch (error) {
    return res.status(503).json({ success: false, error: error instanceof Error ? error.message : "Authentication service unavailable" });
  }
});

app.get("/api/auth/me", authMiddleware, (req, res) => {
  return res.json({ success: true, user: getAuthUser(req) });
});

app.post("/api/auth/logout", authMiddleware, (req, res) => {
  runtimeAIKeysByUser.delete(getAuthUser(req).id);
  clearRuntimeMemory(getAuthUser(req).id);
  clearSessionCookie(res);
  return res.json({ success: true });
});

app.use("/api/projects", authMiddleware);
app.use("/api/chat", authMiddleware);
app.use("/api/agent/history", authMiddleware);
app.use("/api/ai", authMiddleware);
app.use("/api/agent/diagnostics", authMiddleware);

app.get("/api/ai/providers", (_req, res) => {
  return res.json({ success: true, providers: aiGateway.getProviders() });
});

app.get("/api/ai/models", async (_req, res) => {
  return res.json({ success: true, models: await aiGateway.getModels() });
});

const localTestMode = process.env.NODE_ENV !== "production" && process.env.NEXUM_LOCAL_TEST_MODE !== "false";

app.get("/api/ai/key-status", async (req, res) => {
  const userGateway = await getUserAIGateway(getAuthUser(req).id);
  return res.json({ success: true, providers: { openai: userGateway.hasOpenAIKey(), openrouter: userGateway.hasOpenRouterKey(), orcarouter: userGateway.hasOrcaRouterKey() } });
});

app.post("/api/ai/connect-key", async (req, res) => {
  const userId = getAuthUser(req).id;
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
        const keys = runtimeAIKeysByUser.get(userId) ?? {};
        runtimeAIKeysByUser.set(userId, { ...keys, openai: apiKey });
        await saveRuntimeKey(userId, "openai", apiKey);
        return res.json({ success: true, provider: "openai", model: status.model, status });
      }
      if (providerId === "orcarouter") {
        const provider = new OrcaRouterProvider();
        provider.setRuntimeApiKey(apiKey);
        const status = await provider.getStatus();
        if (!status.available) throw new Error(status.error ?? "OrcaRouter key verification failed");
        const keys = runtimeAIKeysByUser.get(userId) ?? {};
        runtimeAIKeysByUser.set(userId, { ...keys, orcarouter: apiKey });
        await saveRuntimeKey(userId, "orcarouter", apiKey);
        return res.json({ success: true, provider: "orcarouter", model: status.model, status });
      }

      const provider = new OpenRouterProvider();
      provider.setRuntimeApiKey(apiKey);
      const status = await provider.getStatus();
      if (!status.available) throw new Error(status.error ?? "OpenRouter key verification failed");
      const keys = runtimeAIKeysByUser.get(userId) ?? {};
      runtimeAIKeysByUser.set(userId, { ...keys, openrouter: apiKey });
      await saveRuntimeKey(userId, "openrouter", apiKey);
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
  const userId = getAuthUser(req).id;
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
    const keys = runtimeAIKeysByUser.get(userId) ?? {};
    runtimeAIKeysByUser.set(userId, { ...keys, openrouter: apiKey });
    await saveRuntimeKey(userId, "openrouter", apiKey);
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
    return res.json({ success: true, status: await (await getUserAIGateway(getAuthUser(req).id)).getStatus(provider, model) });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "AI provider status failed",
    });
  }
});

app.get("/api/projects", async (req, res) => {
  try {
    return res.json({ success: true, projects: await getProjectManager(getAuthUser(req).id).listProjects() });
  } catch (error) {
    return sendProjectError(res, error);
  }
});

app.post("/api/projects", async (req, res) => {
  const { name, description, type } = req.body as { name?: unknown; description?: unknown; type?: unknown };
  if (typeof name !== "string") {
    return res.status(400).json({ success: false, error: "Project name is required" });
  }

  try {
    const project = await getProjectManager(getAuthUser(req).id).createProject(name, typeof description === "string" ? description : "", typeof type === "string" ? type : "Веб-приложение");
    return res.status(201).json({ success: true, project });
  } catch (error) {
    return sendProjectError(res, error);
  }
});

app.get("/api/projects/:id", async (req, res) => {
  try {
    return res.json({ success: true, project: await getProjectManager(getAuthUser(req).id).getProject(String(req.params.id)) });
  } catch (error) {
    return sendProjectError(res, error);
  }
});

app.post("/api/projects/:id/duplicate", async (req, res) => {
  try {
    const project = await getProjectManager(getAuthUser(req).id).duplicateProject(String(req.params.id));
    return res.status(201).json({ success: true, project });
  } catch (error) {
    return sendProjectError(res, error);
  }
});

app.post("/api/projects/:id/select", async (req, res) => {
  try {
    return res.json({ success: true, project: await getProjectManager(getAuthUser(req).id).selectProject(req.params.id) });
  } catch (error) {
    return sendProjectError(res, error);
  }
});

app.post("/api/projects/:id/archive", async (req, res) => {
  try {
    return res.json({ success: true, project: await getProjectManager(getAuthUser(req).id).archiveProject(req.params.id) });
  } catch (error) {
    return sendProjectError(res, error);
  }
});

app.delete("/api/projects/:id", async (req, res) => {
  try {
    const project = await getProjectManager(getAuthUser(req).id).deleteProject(req.params.id);
    return res.json({ success: true, project });
  } catch (error) {
    return sendProjectError(res, error);
  }
});

// Static project preview. The agent writes the project files, and the preview
// renders index.html directly without requiring a separate dev server.
app.use("/api/preview/:id", authMiddleware, async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    const project = await getProjectManager(getAuthUser(req).id).getProject(String(req.params.id));
    const requestedPath = req.path.replace(/^\/+/, "") || "index.html";
    const distRoot = resolve(project.path, "dist");
    const distCandidate = resolve(distRoot, requestedPath);
    const sourceCandidate = resolve(project.path, requestedPath);
    const distIndex = resolve(distRoot, "index.html");
    const hasBuild = await stat(distIndex).then(() => true).catch(() => false);
    let filePath = hasBuild ? distCandidate : sourceCandidate;
    const requestedExtension = extname(requestedPath);
    const previewAllowed = new Set([".html", ".css", ".js", ".mjs", ".json", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".ico", ".woff", ".woff2", ".ttf"]);
    const basename = requestedPath.split("/").pop() ?? "";
    if (basename.startsWith(".") || basename === "package-lock.json" || basename === "pnpm-lock.yaml" || basename === "yarn.lock" || (requestedExtension && !previewAllowed.has(requestedExtension.toLowerCase()))) {
      return res.status(403).send("Preview file is not allowed");
    }

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
      const previewBase = `/api/preview/${encodeURIComponent(String(req.params.id))}/`;
      html = html
        .replace(/(src|href|action)=(["'])\/(?!\/)/gi, `$1=$2${previewBase}`)
        .replace(/url\((["']?)\/(?!\/)/gi, `url($1${previewBase}`);

      const headTag = "<base href=\"" + previewBase + "\">";
      if (!/<base\s/i.test(html)) {
        const headIndex = html.toLowerCase().indexOf("<head");
        const headClose = html.toLowerCase().indexOf(">", headIndex);
        html = headClose >= 0 ? html.slice(0, headClose + 1) + headTag + html.slice(headClose + 1) : headTag + html;
      }

      const runtimeBridge = `<script>(()=>{const projectId=${JSON.stringify(String(req.params.id))};let liveRevision="";let cssRevision="";let appRevision="";const send=(payload)=>{try{parent.postMessage({source:"nexum-preview",projectId,...payload},"*")}catch{}};const report=(kind,message,stack)=>send({kind,message:String(message||"Preview runtime error").slice(0,4000),stack:stack?String(stack).slice(0,8000):undefined});const describe=(el)=>el&&el.getAttribute?el.getAttribute("data-nexum-id")||el.id||el.getAttribute("name")||el.getAttribute("aria-label")||el.textContent?.trim().slice(0,80)||el.tagName?.toLowerCase()||"unknown":"unknown";const hotSwapCss=async(nextRevision)=>{if(!cssRevision||nextRevision===cssRevision)return true;const links=[...document.querySelectorAll('link[rel="stylesheet"][href]')];if(!links.length)return false;await Promise.all(links.map(link=>new Promise((resolve)=>{const next=link.cloneNode(true);const href=next.getAttribute("href");if(!href){resolve(false);return;}const separator=href.includes("?")?"&":"?";next.setAttribute("href",href+separator+"nexum="+encodeURIComponent(nextRevision));next.addEventListener("load",()=>{link.replaceWith(next);resolve(true)},{once:true});next.addEventListener("error",()=>resolve(false),{once:true});link.after(next)})));cssRevision=nextRevision;return true};const syncLive=async()=>{try{const response=await fetch("/api/projects/"+encodeURIComponent(projectId)+"/preview/live?ts="+Date.now(),{cache:"no-store"});if(response.ok){const live=await response.json();liveRevision=live?.live?.revision||"";cssRevision=live?.live?.cssRevision||"";appRevision=live?.live?.appRevision||""}}catch{}};window.addEventListener("error",e=>report("error",e.message,e.error&&e.error.stack));window.addEventListener("unhandledrejection",e=>report("unhandledrejection",e.reason instanceof Error?e.reason.message:String(e.reason),e.reason instanceof Error?e.reason.stack:undefined));document.addEventListener("click",e=>{const el=e.target?.closest?.("[data-nexum-action],button,a,[role=button]");if(el)send({kind:"interaction",eventType:"click",target:describe(el),action:el.getAttribute("data-nexum-action")||undefined})},true);document.addEventListener("submit",e=>{const el=e.target;send({kind:"interaction",eventType:"submit",target:describe(el),action:el?.getAttribute?.("data-nexum-action")||undefined})},true);document.addEventListener("change",e=>{const el=e.target;if(el instanceof Element)send({kind:"interaction",eventType:"change",target:describe(el)})},true);window.addEventListener("popstate",()=>send({kind:"interaction",eventType:"navigate",target:location.pathname}));window.addEventListener("hashchange",()=>send({kind:"interaction",eventType:"navigate",target:location.hash}));syncLive().finally(()=>send({kind:"preview-ready",eventType:"ready",target:location.pathname,revision:liveRevision}));window.addEventListener("message",async(e)=>{if(e.data?.source!=="nexum-host"||e.data.projectId!==projectId)return;if(e.data.type==="refresh"){location.reload();return}if(e.data.type==="update"){const nextRevision=typeof e.data.revision==="string"?e.data.revision:"";if(!nextRevision||nextRevision===liveRevision)return;const nextCss=typeof e.data.cssRevision==="string"?e.data.cssRevision:"";const nextApp=typeof e.data.appRevision==="string"?e.data.appRevision:"";if(nextApp===appRevision&&nextCss&&await hotSwapCss(nextCss)){liveRevision=nextRevision;send({kind:"preview-updated",revision:nextRevision,mode:"css-hot-update"});return}location.reload()}if(e.data.type==="navigate"&&typeof e.data.url==="string"){location.href=e.data.url}})})()</script>`;
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

app.get("/api/projects/:id/pipeline", async (req,res)=>{
  try {
    const project=await getProjectManager(getAuthUser(req).id).getProject(String(req.params.id));
    return res.json({success:true,pipeline:await getPipelineSnapshot(project.path)});
  } catch(error){ return sendProjectError(res,error); }
});
app.post("/api/projects/:id/pipeline/prepare", async (req,res)=>{
  try {
    const project=await getProjectManager(getAuthUser(req).id).getProject(String(req.params.id));
    const intent=extractIntent(typeof req.body?.task==="string"?req.body.task:"");
    return res.json({success:true,pipeline:await prepareAutonomousDesignPipeline(project.path,intent)});
  } catch(error){ return sendProjectError(res,error); }
});
app.get("/api/projects/:id/components", async (req,res)=>{
  try {
    const project=await getProjectManager(getAuthUser(req).id).getProject(String(req.params.id));
    const design=await readDesignSpec(project.path);
    return res.json({success:true,components:componentContracts(design)});
  } catch(error){ return sendProjectError(res,error); }
});
app.get("/api/projects/:id/state", async (req,res)=>{
  try {
    const project=await getProjectManager(getAuthUser(req).id).getProject(String(req.params.id));
    return res.json({success:true,state:await readStateSpec(project.path)});
  } catch(error){ return sendProjectError(res,error); }
});
app.put("/api/projects/:id/state", async (req,res)=>{
  try {
    const project=await getProjectManager(getAuthUser(req).id).getProject(String(req.params.id));
    return res.json({success:true,state:await writeStateSpec(project.path,req.body&&typeof req.body==="object"?req.body:{})});
  } catch(error){ return sendProjectError(res,error); }
});
app.get("/api/projects/:id/preview/live", async (req,res)=>{
  try {
    const project=await getProjectManager(getAuthUser(req).id).getProject(String(req.params.id));
    return res.json({success:true,live:await inspectLiveUpdate(project.path,String(project.id))});
  } catch(error){ return sendProjectError(res,error); }
});
app.get("/api/projects/:id/preview/live/events", async (req,res)=>{
  const userId=getAuthUser(req).id;
  try {
    const project=await getProjectManager(userId).getProject(String(req.params.id));
    const projectId=String(project.id);
    const subscriber: PreviewSubscriber={userId,projectId,response:res};
    const key=previewSubscriberKey(userId,projectId);
    const subscribers=previewSubscribers.get(key) ?? new Set<PreviewSubscriber>();
    subscribers.add(subscriber);
    previewSubscribers.set(key,subscribers);
    res.status(200);
    res.setHeader("Content-Type","text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control","no-cache, no-transform");
    res.setHeader("Connection","keep-alive");
    res.setHeader("X-Accel-Buffering","no");
    res.flushHeaders();
    const live=await inspectLiveUpdate(project.path,projectId);
    res.write(`event: preview-ready\\ndata: ${JSON.stringify(live)}\\n\\n`);
    const heartbeat=setInterval(()=>{ try { res.write(": ping\\n\\n"); } catch { clearInterval(heartbeat); closePreviewSubscriber(subscriber); } },15000);
    req.on("close",()=>{ clearInterval(heartbeat); closePreviewSubscriber(subscriber); });
  } catch(error){ if(!res.headersSent) return sendProjectError(res,error); res.end(); }
});

app.get("/api/projects/:id/design", async (req, res) => {
  try { const project=await getProjectManager(getAuthUser(req).id).getProject(String(req.params.id)); return res.json({success:true,design:await readDesignSpec(project.path)}); }
  catch(error){ return sendProjectError(res,error); }
});
app.put("/api/projects/:id/design", async (req, res) => {
  try { const project=await getProjectManager(getAuthUser(req).id).getProject(String(req.params.id)); return res.json({success:true,design:await writeDesignSpec(project.path,req.body&&typeof req.body==="object"?req.body:{})}); }
  catch(error){ return sendProjectError(res,error); }
});
app.post("/api/projects/:id/design/derive", async (req, res) => {
  try {
    const project=await getProjectManager(getAuthUser(req).id).getProject(String(req.params.id));
    const design=await writeDesignSpec(project.path,deriveDesignSpec({
      domain:typeof req.body?.domain==="string"?req.body.domain:undefined,
      productType:typeof req.body?.productType==="string"?req.body.productType:undefined,
      visualDirection:typeof req.body?.visualDirection==="string"?req.body.visualDirection:undefined,
      audience:typeof req.body?.audience==="string"?req.body.audience:undefined,
      features:Array.isArray(req.body?.features)?req.body.features.filter((x:unknown):x is string=>typeof x==="string"):[],
    }));
    return res.json({success:true,design});
  } catch(error){ return sendProjectError(res,error); }
});
app.get("/api/projects/:id/design/verify", async (req,res)=>{
  try { const project=await getProjectManager(getAuthUser(req).id).getProject(String(req.params.id)); return res.json({success:true,verification:await verifyDesign(project.path)}); }
  catch(error){ return sendProjectError(res,error); }
});
app.post("/api/projects/:id/preview/interaction", async (req,res)=>{
  try {
    const userId=getAuthUser(req).id; const project=await getProjectManager(userId).getProject(String(req.params.id));
    const projectId=typeof req.body?.projectId==="string"?req.body.projectId:"";
    if(projectId && projectId!==String(project.id)) return res.status(400).json({success:false,error:"Preview project mismatch"});
    const type=typeof req.body?.eventType==="string"?req.body.eventType.slice(0,40):"unknown";
    const target=typeof req.body?.target==="string"?req.body.target.slice(0,200):"unknown";
    const design=await readDesignSpec(project.path);
    const event={projectId:String(project.id),type: type as "click"|"submit"|"change"|"navigate",target,action:typeof req.body?.action==="string"?req.body.action.slice(0,200):undefined,value:typeof req.body?.value==="string"?req.body.value.slice(0,1000):undefined,timestamp:Date.now()};
    const accepted=allowedInteraction(design,event);
    const record=createInteractionRecord(event,event.action);
    const resolved=resolveInteraction(record,accepted);
    void agentHistory.record({type:"preview-interaction",projectId:project.id,userId,status:accepted?"success":"error",message:`${type}: ${target}`,output:JSON.stringify({accepted,record:resolved})});
    return res.json({success:true,accepted,record:resolved});
  } catch(error){ return sendProjectError(res,error); }
});
app.get("/api/projects/:id/preview/bridge", async (req,res)=>{
  try { const project=await getProjectManager(getAuthUser(req).id).getProject(String(req.params.id)); res.type("text/javascript; charset=utf-8"); return res.send(interactionScript(String(project.id))); }
  catch(error){ return sendProjectError(res,error); }
});

app.post("/api/projects/:id/preview/runtime-error", async (req, res) => {
  try {
    const userId = getAuthUser(req).id;
    const project = await getProjectManager(userId).getProject(req.params.id);
    const message = typeof req.body?.message === "string" ? req.body.message.slice(0, 4000) : "Preview runtime error";
    const stack = typeof req.body?.stack === "string" ? req.body.stack.slice(0, 8000) : undefined;
    const kind = typeof req.body?.kind === "string" ? req.body.kind.slice(0, 80) : "error";
    const originProjectId = typeof req.body?.projectId === "string" ? req.body.projectId : "";
    // projectId is supplied by the injected Preview bridge and must match the route project.
    if (originProjectId && originProjectId !== String(project.id)) return res.status(400).json({ success: false, error: "Preview project mismatch" });
    const stateManager = projectStates.get(project.path) ?? new ProjectStateManager(project.path, project.id);
    projectStates.set(project.path, stateManager);
    const evidence = `preview runtime error [${kind}]: ${message}${stack ? `
${stack}` : ""}`;
    await stateManager.refresh(undefined, undefined, [], [evidence]);
    void agentHistory.record({
      type: "preview-runtime-error",
      projectId: project.id,
      status: "error",
      message,
      output: JSON.stringify({ kind, stack }),
    });

    // A browser runtime failure is a real debugger signal, not just telemetry.
    // Start one bounded recovery job per project so repeated iframe events do
    // not create an uncontrolled AI loop. The recovery job uses the same
    // authenticated project workspace and normal Debugger -> verification flow.
    const recoveryKey = `${userId}:${project.id}`;
    const lastStartedAt = runtimeRecoveryLastStartedAt.get(recoveryKey) ?? 0;
    const cooldownActive = Date.now() - lastStartedAt < RUNTIME_RECOVERY_COOLDOWN_MS;
    if (!runtimeRecoveryInFlight.has(recoveryKey) && !cooldownActive && !projectJobsInFlight.has(recoveryKey)) {
      runtimeRecoveryLastStartedAt.set(recoveryKey, Date.now());
      projectJobsInFlight.add(recoveryKey);
      runtimeRecoveryInFlight.add(recoveryKey);
      cleanupChatJobs();
      const jobId = randomUUID();
      const now = Date.now();
      chatJobs.set(jobId, {
        id: jobId,
        status: "queued",
        createdAt: now,
        updatedAt: now,
        stage: "queued",
        userId,
        problems: [{ message: `Preview runtime error: ${message}`, source: "Preview" }],
      });
      const recoveryMessage = [
        "АВТОМАТИЧЕСКОЕ ВОССТАНОВЛЕНИЕ NEXUM.",
        "Preview проекта сообщил реальную runtime-ошибку. Не создавай новый проект и не меняй домен продукта.",
        "Сначала изучи текущий проект и стек ошибки, затем найди минимальную причину и исправь её.",
        "После исправления обязательно выполни доступную проверку/сборку. Заверши только после успешной проверки.",
        `Проект: ${project.name} (${project.id})`,
        `Ошибка: ${message}`,
        stack ? `Stack:\n${stack}` : "",
      ].filter(Boolean).join("\n\n");
      void runChatJob(jobId, recoveryMessage, project.id, userId, undefined, undefined, [], [])
        .catch((error) => {
          console.error("[Nexum] preview recovery failed", jobId, error);
        })
        .finally(() => {
          runtimeRecoveryInFlight.delete(recoveryKey);
        });
      return res.status(202).json({ success: true, recovery: { started: true, jobId } });
    }

    return res.status(202).json({ success: true, recovery: { started: false, reason: cooldownActive ? "cooldown" : (projectJobsInFlight.has(recoveryKey) ? "project-busy" : "already-running") } });
  } catch (error) {
    return sendProjectError(res, error);
  }
});

app.get("/api/projects/:id/files", async (req, res) => {
  try {
    const project = await getProjectManager(getAuthUser(req).id).getProject(String(req.params.id));
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
    const project = await getProjectManager(getAuthUser(req).id).getProject(String(req.params.id));
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
    const project = await getProjectManager(getAuthUser(req).id).getProject(String(req.params.id));
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
    await broadcastPreviewRevision(getAuthUser(req).id, project.id, project.path);
    return res.json({ success: true, path: projectRelative });
  } catch (error) {
    if (error instanceof ProjectPathError) return res.status(403).json({ success: false, error: error.message });
    return sendProjectError(res, error);
  }
});

app.get("/api/projects/:id/git/:operation", async (req, res) => {
  try {
    const project = await getProjectManager(getAuthUser(req).id).getProject(String(req.params.id));
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
    const project = await getProjectManager(getAuthUser(req).id).getProject(String(req.params.id));
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

app.get("/api/projects/:id/checkpoints", async (req, res) => {
  try {
    const project = await getProjectManager(getAuthUser(req).id).getProject(String(req.params.id));
    const checkpoints = await checkpointManager.list(project.id, project.path);
    return res.json({ success: true, checkpoints });
  } catch (error) {
    return sendProjectError(res, error);
  }
});

app.post("/api/projects/:id/checkpoints", async (req, res) => {
  try {
    const project = await getProjectManager(getAuthUser(req).id).getProject(String(req.params.id));
    const label = typeof req.body?.label === "string" ? req.body.label : "before agent changes";
    const checkpoint = await checkpointManager.create(project.id, project.path, label);
    void agentHistory.record({
      type: "checkpoint-created",
      projectId: project.id,
      status: "success",
      message: `Checkpoint ${checkpoint.id} created`,
      output: JSON.stringify({ label: checkpoint.label, files: checkpoint.files.length }),
    });
    return res.status(201).json({ success: true, checkpoint });
  } catch (error) {
    return sendProjectError(res, error);
  }
});

app.post("/api/projects/:id/checkpoints/:checkpointId/rollback", async (req, res) => {
  try {
    const project = await getProjectManager(getAuthUser(req).id).getProject(String(req.params.id));
    const checkpoint = await checkpointManager.rollback(project.id, project.path, req.params.checkpointId);
    const stateManager = projectStates.get(project.path) ?? new ProjectStateManager(project.path, project.id);
    projectStates.set(project.path, stateManager);
    await stateManager.refresh(undefined, undefined, [], [`rollback:${checkpoint.id}`]);
    void agentHistory.record({
      type: "checkpoint-rollback",
      projectId: project.id,
      status: "success",
      message: `Rolled back to checkpoint ${checkpoint.id}`,
      output: JSON.stringify({ label: checkpoint.label, files: checkpoint.files.length }),
    });
    return res.json({ success: true, checkpoint });
  } catch (error) {
    return sendProjectError(res, error);
  }
});

app.get("/api/projects/:id/state", async (req, res) => {
  try {
    const project = await getProjectManager(getAuthUser(req).id).getProject(String(req.params.id));
    const stateManager = projectStates.get(project.path) ?? new ProjectStateManager(project.path, project.id);
    projectStates.set(project.path, stateManager);
    const state = await stateManager.refresh();
    return res.json({ success: true, state });
  } catch (error) {
    if (error instanceof ProjectManagerError) return sendProjectError(res, error);
    return res.status(500).json({ success: false, error: "Unable to read project state" });
  }
});

app.get("/api/projects/:id/preview/status", async (req, res) => {
  try {
    const project = await getProjectManager(getAuthUser(req).id).getProject(String(req.params.id));
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
    const userId = getAuthUser(req).id;
    const activeProject = await getProjectManager(userId).getActiveProject(projectId);
    const projectLockKey = userId + ":" + activeProject.id;
    if (projectJobsInFlight.has(projectLockKey)) {
      return res.status(409).json({ success: false, error: "Another AI job is already running for this project." });
    }
    projectJobsInFlight.add(projectLockKey);

    cleanupChatJobs();
    const jobId = randomUUID();
    const now = Date.now();
    chatJobs.set(jobId, {
      id: jobId,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      stage: "queued",
      userId,
      attachments: normalizedAttachments.map((item) => item.name),
      productPlan: undefined,
    });

    // Do not await the agent. The HTTP request returns immediately, avoiding
    // platform/proxy 504s while local Ollama or another provider is generating.
    void runChatJob(
      jobId,
      message.trim(),
      projectId,
      userId,
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
  const userId = getAuthUser(req).id;
  const userProjects = await getProjectManager(userId).listProjects();
  const projectIds = new Set(userProjects.map((project) => project.id));
  const entries = (await agentHistory.recent(Number.isFinite(limit) ? limit : 200))
    .filter((entry) => entry.userId === userId)
    .filter((entry) => !entry.projectId || projectIds.has(entry.projectId));
  return res.json({ success: true, entries });
});

app.post("/api/agent/client-error", authMiddleware, async (req, res) => {
  const { message, stack, source, url, projectId: rawProjectId } = req.body as {
    message?: unknown;
    stack?: unknown;
    source?: unknown;
    url?: unknown;
    projectId?: unknown;
  };
  const userId = getAuthUser(req).id;
  const projectId = typeof rawProjectId === "string" ? rawProjectId.slice(0, 160) : "";
  const errorMessage = typeof message === "string" ? message.slice(0, 4000) : "Unknown client error";
  if (!projectId) return res.status(400).json({ success: false, error: "projectId is required" });

  // Resolve through the authenticated user's project manager; never trust a
  // client-supplied filesystem path or project owned by another account.
  let project;
  try {
    project = await getProjectManager(userId).getActiveProject(projectId);
  } catch {
    return res.status(404).json({ success: false, error: "Project not found" });
  }
  const projectLockKey = userId + ":" + project.id;
  const now = Date.now();
  const previousStart = runtimeRecoveryLastStartedAt.get(projectLockKey) ?? 0;
  const duplicateRecovery = runtimeRecoveryInFlight.has(projectLockKey) ||
    projectJobsInFlight.has(projectLockKey) ||
    now - previousStart < RUNTIME_RECOVERY_COOLDOWN_MS;

  await agentHistory.record({
    type: "client-error",
    projectId: project.id,
    userId,
    status: "error",
    message: errorMessage,
    output: JSON.stringify({
      stack: typeof stack === "string" ? stack.slice(0, 8000) : undefined,
      source: typeof source === "string" ? source.slice(0, 500) : undefined,
      url: typeof url === "string" ? url.slice(0, 1000) : undefined,
      recovery: duplicateRecovery ? "suppressed" : "queued",
    }),
  });

  if (!duplicateRecovery) {
    runtimeRecoveryInFlight.add(projectLockKey);
    runtimeRecoveryLastStartedAt.set(projectLockKey, now);
    const jobId = randomUUID();
    const recoveryMessage = [
      "AUTOMATIC PREVIEW RUNTIME RECOVERY",
      "The user's existing project has a runtime error in its live preview. Do not scaffold a new app or change its product domain.",
      "Inspect the current source and fix only the demonstrated runtime failure. Preserve existing design, routes, data, and working interactions.",
      "Rebuild or run the relevant checks after the patch. If the issue cannot be reproduced or safely fixed, report the evidence instead of making speculative changes.",
      "Runtime error: " + errorMessage,
      typeof stack === "string" ? "Stack: " + stack.slice(0, 3500) : "",
      typeof source === "string" ? "Source: " + source.slice(0, 300) : "",
    ].filter(Boolean).join("\n");
    const job: ChatJob = {
      id: jobId, status: "queued", createdAt: now, updatedAt: now,
      currentMessage: "Получена ошибка предпросмотра. Запускаю ограниченное автоматическое исправление.",
      stage: "queued", userId,
    };
    chatJobs.set(jobId, job);
    void runChatJob(jobId, recoveryMessage, project.id, userId, undefined, undefined, [], [])
      .finally(() => runtimeRecoveryInFlight.delete(projectLockKey));
  }
  return res.status(202).json({ success: true, recoveryQueued: !duplicateRecovery });
});

app.get("/api/agent/diagnostics", async (req, res) => {
  const rawLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : 100;
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 100;
  const userId = getAuthUser(req).id;
  const userProjects = await getProjectManager(userId).listProjects();
  const projectIds = new Set(userProjects.map((project) => project.id));
  const entries = (await agentHistory.recent(limit))
    .filter((entry) => entry.userId === userId)
    .filter((entry) => !entry.projectId || projectIds.has(entry.projectId));
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
    jobs: [...chatJobs.values()]
      .filter((job) => job.userId === userId)
      .slice(-20)
      .map((job) => ({
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
  const userId = getAuthUser(req).id;
  cleanupChatJobs();
  const job = chatJobs.get(req.params.id);
  if (!job || job.userId !== userId) {
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
      checkpointId: job.checkpointId ?? null,
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
