import express from "express";
import type { NextFunction, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { AIGateway, type GatewayFallbackEvent } from "./ai/gateway.js";
import { OllamaProvider } from "./ai/providers/ollama.js";
import { OpenRouterProvider } from "./ai/providers/openrouter.js";
import { OpenAIProvider } from "./ai/providers/openai.js";
import { AnthropicProvider } from "./ai/providers/anthropic.js";
import { OrcaRouterProvider } from "./ai/providers/orcarouter.js";
import { MockProvider } from "./ai/providers/mock.js";
import { NexumAgent } from "./agent/agent.js";
import { AgentLoop, type AgentEvent } from "./agent/loop.js";
import type { ProductPlan } from "./agent/types.js";
import { ProjectManager, ProjectManagerError } from "./projects/projectManager.js";
import { mkdir, readFile, stat, readdir, writeFile, rm } from "node:fs/promises";
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
import { closeDatabase, pingDatabase } from "./db.js";
import { createDiagnosticsSession, getDiagnosticsSession, getLatestDiagnostics, recordDiagnosticsEvent } from "./diagnostics.js";
import { acquireProjectLock, cancelChatJob, claimChatJob, completeChatJob, failChatJob, cleanupChatJobs, createChatJob, getChatJob, heartbeatProjectLock, listChatJobs, recoverStaleChatJobs, releaseProjectLock, updateChatJob, type ChatJob } from "./chatJobStore.js";
import { chatJobCache, loadChatJob, syncTerminalChatJobCache } from "./chatJobCache.js";
import { NexumError, classifyAIError } from "./core/errors.js";
import { serverRuntime } from "./runtime/runtime.js";
import { agentFailureInjection, type AgentFailure } from "./agent/failureInjection.js";
import { enqueueChatJobPersistence, waitForChatJobPersistence } from "./chatJobPersistence.js";
import { checkRateLimit, getRateLimitKey } from "./rateLimit.js";

dotenv.config();

const requestIds = new WeakMap<object, string>();

function getRequestId(req: express.Request): string {
  const existing = requestIds.get(req);
  if (existing) return existing;
  const id = req.header("x-request-id")?.trim() || randomUUID();
  requestIds.set(req, id);
  return id;
}

function createRateLimitMiddleware(prefix: string, limit: number, windowMs: number) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const identity = req.user?.id ?? req.ip ?? "unknown";
    try {
      const result = await checkRateLimit(getRateLimitKey(prefix, identity), limit, windowMs);
      res.setHeader("X-RateLimit-Limit", String(limit));
      res.setHeader("X-RateLimit-Remaining", String(result.remaining));
      if (!result.allowed) {
        if (result.retryAfterSeconds) res.setHeader("Retry-After", String(result.retryAfterSeconds));
        res.status(429).json({ success: false, error: "Too many requests. Please try again later." });
        return;
      }
      next();
    } catch (error) {
      console.error("[Nexum] rate-limit check failed", { prefix, error });
      res.status(503).json({ success: false, error: "Rate-limit service unavailable" });
    }
  };
}

const isProduction = process.env.NODE_ENV === "production";
const authRegisterLimiter = createRateLimitMiddleware("auth:register", isProduction ? 10 : 100, 60_000);
const authLoginLimiter = createRateLimitMiddleware("auth:login", isProduction ? 20 : 200, 60_000);
const projectLimiter = createRateLimitMiddleware("projects", isProduction ? 120 : 1000, 60_000);
const chatLimiter = createRateLimitMiddleware("chat", isProduction ? 30 : 300, 60_000);
const aiWriteLimiter = createRateLimitMiddleware("ai-write", isProduction ? 20 : 200, 60_000);

function sendSafeError(res: Response, error: unknown, requestId: string, fallback = "Внутренняя ошибка NEXUM.") {
  const normalized = error instanceof NexumError
    ? error
    : classifyAIError(error);
  if (normalized.status === undefined || normalized.status >= 500) {
    console.error("[Nexum] request failed", { requestId, code: normalized.code, error: normalized.technicalDetails });
  }
  return res.status(normalized.status ?? 500).json({
    success: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      retryable: normalized.retryable,
      requestId,
    },
  });
}

const app = express();
void recoverStaleChatJobs(0).catch((error) => console.error("[Nexum] stale Agent recovery failed", error));
serverRuntime.start();
app.use((req, _res, next) => {
  const requestId = getRequestId(req);
  const started = Date.now();
  _res.on("finish", () => {
    const operation = req.method + " " + req.originalUrl;
    serverRuntime.record(
      "NETWORK",
      _res.statusCode >= 500 ? "error" : "info",
      "HTTP request completed",
      { operation },
      _res.statusCode >= 500 ? new Error("HTTP " + _res.statusCode) : undefined,
    );
    if (req.path === "/index.html" || req.originalUrl.includes("/index.html")) {
      void stat(webIndex)
        .then((details) => console.error("[Nexum] index request diagnostic", {
          requestId, operation, status: _res.statusCode,
          cwd: process.cwd(), nodeEnv: process.env.NODE_ENV ?? "undefined",
          workspaceRoot, webDist, webIndex, indexExists: details.isFile(),
          indexSize: details.size, durationMs: Date.now() - started,
        }))
        .catch((error) => console.error("[Nexum] index request diagnostic", {
          requestId, operation, status: _res.statusCode,
          cwd: process.cwd(), nodeEnv: process.env.NODE_ENV ?? "undefined",
          workspaceRoot, webDist, webIndex, indexExists: false,
          durationMs: Date.now() - started,
          statError: error instanceof Error ? error.message : String(error),
        }));
    }
  });
  next();
});
const configuredProvider = process.env.AI_PROVIDER?.toLowerCase();
const e2eMockAI = process.env.NEXUM_E2E_MOCK_AI === "true" && process.env.NODE_ENV === "test";
const defaultProvider = e2eMockAI && configuredProvider === "mock"
  ? "mock"
  : configuredProvider === "ollama" || configuredProvider === "openrouter" || configuredProvider === "openai" || configuredProvider === "anthropic" || configuredProvider === "orcarouter"
    ? configuredProvider
  : process.env.ORCAROUTER_API_KEY?.trim()
    ? "orcarouter"
    : process.env.OPENAI_API_KEY?.trim()
      ? "openai"
      : process.env.ANTHROPIC_API_KEY?.trim()
        ? "anthropic"
        : process.env.OPENROUTER_API_KEY?.trim()
          ? "openrouter"
          : process.env.OLLAMA_BASE_URL?.trim()
            ? "ollama"
            : undefined;

if (!defaultProvider) {
  throw new Error("NEXUM AI is not configured. Set AI_PROVIDER to a real provider or configure a real provider API key. Mock AI is disabled.");
}
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const webDist = resolve(workspaceRoot, "apps/web/dist");
const webIndex = resolve(webDist, "index.html");
const projectManagers = new Map<string, ProjectManager>();

function getProjectManager(userId: string): ProjectManager {
  let manager = projectManagers.get(userId);
  if (!manager) {
    manager = new ProjectManager(resolve(workspaceRoot, "runtime", "users", userId));
    projectManagers.set(userId, manager);
  }
  return manager;
}
async function getLatestProjectSourceMtime(projectRoot: string): Promise<number> {
  let latest = 0;
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if ([".git", "node_modules", "dist", ".nexum"].includes(entry.name)) continue;
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const details = await stat(full);
        latest = Math.max(latest, details.mtimeMs);
      }
    }
  };
  await walk(projectRoot);
  return latest;
}

const agentHistory = new AgentHistory(workspaceRoot);
const checkpointManager = new CheckpointManager();
const projectStates = new Map<string, ProjectStateManager>();
const fallbackProvider = process.env.AI_FALLBACK_PROVIDER?.toLowerCase() ||
  (defaultProvider === "ollama" ? "openrouter" : defaultProvider === "orcarouter" ? "openrouter" : undefined);

const aiGateway = new AIGateway(
  [new OllamaProvider(), new OpenRouterProvider(), new OpenAIProvider(), new AnthropicProvider(), new OrcaRouterProvider(), ...(e2eMockAI ? [new MockProvider()] : [])],
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

const userAIGateways = new Map<string, AIGateway>();

function createProviderGateway(runtimeProvider?: string, runtimeCredential?: string): AIGateway {
  const providers = [new OllamaProvider(), new OpenRouterProvider(), new OpenAIProvider(), new AnthropicProvider(), new OrcaRouterProvider(), ...(e2eMockAI ? [new MockProvider()] : [])];
  if (runtimeProvider && runtimeCredential) {
    const target = providers.find((provider) => provider.id === runtimeProvider);
    const setter = target && (target as unknown as { setRuntimeApiKey?: (value: string) => void }).setRuntimeApiKey;
    if (!setter) throw new Error(`Provider ${runtimeProvider} does not support runtime credentials`);
    setter.call(target, runtimeCredential);
  }
  return new AIGateway(providers, runtimeProvider ?? defaultProvider, {
    fallbackProviderId: runtimeProvider ? undefined : fallbackProvider,
    onFallback: (event: GatewayFallbackEvent) => {
      void agentHistory.record({
        type: "provider-fallback",
        provider: event.fromProvider,
        model: event.fromModel,
        status: "fallback",
        message: `AI fallback: ${event.fromProvider}/${event.fromModel} -> ${event.toProvider}/${event.toModel}`,
        output: event.reason,
      });
    },
  });
}

function getAIGatewayForUser(userId: string): AIGateway {
  return userAIGateways.get(userId) ?? aiGateway;
}

const chatJobControllers = new Map<string, AbortController>();
const CHAT_JOB_TTL_MS = 30 * 60 * 1000;

async function persistChatJob(job: ChatJob): Promise<void> {
  await enqueueChatJobPersistence(job.id, async () => {
    const persisted = await updateChatJob(job.id, job.userId, job);
    if (persisted) chatJobCache.set(job.id, persisted);
  });
}

function throwIfAgentAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Agent task cancelled by user.", "AbortError");
}

function createAgentCancellationBridge(jobId: string, userId: string, parentSignal?: AbortSignal): { signal: AbortSignal; stop: () => void } {
  const controller = new AbortController();
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort(new DOMException("Agent task cancelled", "AbortError"));
    }
  };

  const poll = async () => {
    if (controller.signal.aborted) return;
    try {
      const persisted = await getChatJob(jobId, userId);
      if (persisted?.status === "cancelled") abort();
    } catch (error) {
      // A transient database read failure must not cancel a healthy Agent run.
      console.error("[Nexum] cancellation bridge poll failed", { jobId, error });
    }
  };

  if (parentSignal) {
    if (parentSignal.aborted) abort();
    else parentSignal.addEventListener("abort", abort, { once: true });
  }
  pollTimer = setInterval(() => { void poll(); }, 750);

  return {
    signal: controller.signal,
    stop: () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = undefined;
      parentSignal?.removeEventListener("abort", abort);
    },
  };
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
  requestId?: string,
  parentSignal?: AbortSignal,
  runtimeTaskId?: string,
) {
  const runtimeTask = runtimeTaskId ? serverRuntime.tasks.get(runtimeTaskId) : undefined;
  if (!runtimeTask) throw new Error("Canonical Runtime Task is unavailable for Agent Job");
  const cancellationBridge = createAgentCancellationBridge(jobId, userId, parentSignal);
  const signal = cancellationBridge.signal;
  throwIfAgentAborted(signal);
  const existingJob = await getChatJob(jobId, userId);
  if (!existingJob) { cancellationBridge.stop(); serverRuntime.updateTask(runtimeTask.id, "FAILED", { error: "Chat job not found" }); return; }
  const job = existingJob.status === "queued" ? await claimChatJob(jobId, userId) : existingJob;
  if (!job || job.status !== "running") {
    if (job?.status === "cancelled") serverRuntime.cancelTask(runtimeTask.id);
    else serverRuntime.updateTask(runtimeTask.id, "FAILED", { error: "Agent Job could not be claimed" });
    chatJobControllers.delete(jobId);
    cancellationBridge.stop();
    return;
  }
  chatJobCache.set(jobId, job);
  serverRuntime.updateTask(runtimeTask.id, "RUNNING");
  throwIfAgentAborted(signal);
  let lockedProjectId: string | undefined;
  let attachmentDir: string | undefined;
  let lockHeartbeat: ReturnType<typeof setInterval> | undefined;
  let lockHeartbeatResourceId: string | undefined;

  job.status = "running";
  job.updatedAt = Date.now();
  await persistChatJob(job);
  void agentHistory.record({ type: "job-start", jobId, projectId, provider, model, message, output: `user:${userId}` });
  job.currentMessage = "Запускаю AI-агента и начинаю выполнение задачи.";
  job.stage = "analyzing";

  try {
    throwIfAgentAborted(signal);
    const project = await getProjectManager(userId).getActiveProject(projectId);
    throwIfAgentAborted(signal);
    const lockAcquired = await acquireProjectLock(project.id, userId, jobId);
    throwIfAgentAborted(signal);
    if (!lockAcquired) {
      job.status = "failed";
      job.stage = "error";
      job.error = "Project is already being modified by another Agent Run.";
      await waitForChatJobPersistence(jobId);
      const failed = await failChatJob(jobId, userId, { error: job.error, stage: job.stage });
      syncTerminalChatJobCache(failed);
      serverRuntime.updateTask(runtimeTask.id, "FAILED", { error: job.error });
      void agentHistory.record({ type: "job-rejected-lock", jobId, projectId: project.id, status: "failed", message: job.error });
      return;
    }
    lockHeartbeat = setInterval(() => {
      void heartbeatProjectLock(project.id, jobId).catch((error) => console.error("[Nexum] project lock heartbeat failed", error));
    }, 60_000);
    lockHeartbeatResourceId = serverRuntime.registerResource("timer", () => { if (lockHeartbeat) clearInterval(lockHeartbeat); lockHeartbeat = undefined; }, { projectId: project.id, taskId: runtimeTask.id, operation: "project-lock-heartbeat" });
    lockedProjectId = project.id;
    const stateManager = projectStates.get(project.path) ?? new ProjectStateManager(project.path, project.id);
    projectStates.set(project.path, stateManager);
    throwIfAgentAborted(signal);
    const checkpoint = await checkpointManager.create(project.id, project.path, `before agent job ${jobId}`);
    throwIfAgentAborted(signal);
    job.checkpointId = checkpoint.id;
    serverRuntime.updateTask(runtimeTask.id, "WAITING", { checkpointId: checkpoint.id, progress: 0.1 });
    serverRuntime.updateTask(runtimeTask.id, "RUNNING", { progress: 0.2 });
    await stateManager.refresh(message);
    void agentHistory.record({
      type: "checkpoint-created",
      jobId,
      projectId: project.id,
      status: "success",
      message: "Automatic pre-task checkpoint created",
      output: JSON.stringify({ checkpointId: checkpoint.id, files: checkpoint.files.length }),
    });
    attachmentDir = resolve(project.path, ".nexum", "attachments", jobId);
    const attachmentNames: string[] = [];
    const attachmentContext: string[] = [];
    if (attachments.length) {
      throwIfAgentAborted(signal);
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
    throwIfAgentAborted(signal);
    console.log("[Nexum] chat job started", jobId, project.id, project.path);
    const userGateway = getAIGatewayForUser(userId);
    const agent = new NexumAgent(userGateway, project.path, serverRuntime, { projectId: project.id, taskId: runtimeTask.id });
    const agentLoop = new AgentLoop(
      agent,
      userGateway,
      undefined,
      (step) => {
        job.steps = [...(job.steps ?? []), step];
        job.updatedAt = Date.now();
        void persistChatJob(job).catch((error) => console.error("[Nexum] job persistence failed", error));
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
            event.phase === "finish" ? "testing" :
            event.iteration === 0 ? "analyzing" : "planning";
        }
        if (event.type === "tool-start") {
          if (event.tool === "listFiles" || event.tool === "readFile" || event.tool === "searchFiles") job.stage = "reading";
          else if (event.tool === "writeFile" || event.tool === "scaffoldProject") job.stage = "editing";
          else if (event.tool === "runSandbox" || event.tool === "runCommand") job.stage = /test/i.test(event.message) ? "testing" : "building";
        }
        if (event.type === "tool-error" || event.type === "failed") job.stage = "error";
        job.updatedAt = Date.now();
        if (event.type === "tool-error" || event.type === "failed") {
          job.problems = [
            ...(job.problems ?? []),
            event.tool ? { message: event.message, source: event.tool } : { message: event.message },
          ];
        }
        void persistChatJob(job).catch((error) => console.error("[Nexum] job event persistence failed", error));
        void agentHistory.record({ type: "agent-event", jobId, projectId, provider, model, requestId: event.requestId ?? requestId, taskId: event.taskId ?? runtimeTask.id, planId: event.planId, iteration: event.iteration, tool: event.tool, status: event.name ?? event.type, message: event.message });
      },
      (plan) => {
        job.productPlan = plan;
        job.stage = "planning";
        job.currentMessage = "Product Plan сформирован. Перехожу к реализации.";
        job.updatedAt = Date.now();
      },
      {
        requestId,
        agentRunId: jobId,
        taskId: runtimeTask.id,
        projectId: project.id,
        provider,
        model,
      },
      (snapshot) => {
        job.agentIntent = snapshot.intent;
        job.executionPlan = snapshot.plan;
        job.executionState = snapshot;
        job.updatedAt = Date.now();
        const runtimeStatus = snapshot.state === "VALIDATING"
          ? "VALIDATING"
          : snapshot.state === "REPAIRING"
            ? "RECOVERING"
            : snapshot.state === "COMPLETED"
              ? "VALIDATING"
              : snapshot.state === "FAILED"
                ? "FAILED"
                : snapshot.state === "CANCELLED"
                  ? "CANCELLED"
                  : "RUNNING";
        if (runtimeStatus === "CANCELLED") serverRuntime.cancelTask(runtimeTask.id);
        else serverRuntime.updateTask(runtimeTask.id, runtimeStatus, {
          progress: Math.min(0.95, snapshot.completedStepIds.length / Math.max(1, snapshot.plan.steps.length)),
          planId: snapshot.plan.planId,
          ...(job.checkpointId ? { checkpointId: job.checkpointId } : {}),
        });
        void persistChatJob(job).catch((error) => console.error("[Nexum] execution state persistence failed", error));
        if (job.checkpointId) {
          void checkpointManager.writeExecutionState(project.id, project.path, job.checkpointId, snapshot)
            .catch((error: unknown) => console.error("[Nexum] execution checkpoint persistence failed", error));
        }
      },
    );
    if (process.env.NODE_ENV !== "production" && Number(process.env.NEXUM_E2E_AGENT_DELAY_MS || 0) > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, Number(process.env.NEXUM_E2E_AGENT_DELAY_MS));
        signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Agent task cancelled", "AbortError")); }, { once: true });
      });
    }
    throwIfAgentAborted(signal);
    const result = await agentLoop.run(agentMessage, {
      ...(signal ? { signal } : {}),
      ...(provider === undefined ? {} : { provider }),
      ...(model === undefined ? {} : { model }),
    });

    if (signal?.aborted) throw new DOMException("Agent task cancelled", "AbortError");
    const persistedAfterRun = await getChatJob(jobId, userId);
    if (persistedAfterRun?.status === "cancelled") throw new DOMException("Agent task cancelled", "AbortError");
    job.updatedAt = Date.now();
    if (result.finalState === "CANCELLED") {
      job.status = "cancelled";
      job.stage = "cancelled";
      job.error = result.error ?? "Agent task cancelled by user.";
      job.validation = result.validation;
      job.telemetry = result.telemetry;
      await waitForChatJobPersistence(jobId);
      const cancelled = await cancelChatJob(jobId, userId, job.error);
      syncTerminalChatJobCache(cancelled);
      serverRuntime.cancelTask(runtimeTask.id);
      void agentHistory.record({ type: "job-cancelled", jobId, projectId, provider, model, status: "cancelled", message: job.error });
      return;
    }
    if (!result.success) {
      job.status = "failed";
      job.stage = "error";
      job.error = result.error ?? result.errorInfo?.message ?? "AI agent failed";
      job.errorCode = result.errorInfo?.code;
      job.errorInfo = result.errorInfo;
      void agentHistory.record({ type: "job-failed", jobId, projectId, provider, model, status: "failed", message: job.error });
      job.steps = result.steps;
      await waitForChatJobPersistence(jobId);
      const failed = await failChatJob(jobId, userId, { error: job.error, errorCode: job.errorCode, errorInfo: job.errorInfo, steps: job.steps, productPlan: job.productPlan, stage: job.stage, agentIntent: job.agentIntent, executionPlan: job.executionPlan, executionState: job.executionState, validation: job.validation, telemetry: job.telemetry });
      syncTerminalChatJobCache(failed);
      return;
    }

    if (signal?.aborted || (await getChatJob(jobId, userId))?.status === "cancelled") throw new DOMException("Agent task cancelled", "AbortError");
    job.steps = result.steps;
    job.productPlan = result.productPlan;
    job.agentIntent = result.intent;
    job.executionPlan = result.executionPlan;
    job.validation = result.validation;
    job.telemetry = result.telemetry;
    if (result.finalResponse !== undefined) job.reply = result.finalResponse;

    const successfulBuild = result.steps.some((step) =>
      step.success &&
      (step.tool === "runCommand" || step.tool === "runSandbox") &&
      /npm run build/.test(step.input),
    );
    if (signal?.aborted || (await getChatJob(jobId, userId))?.status === "cancelled") throw new DOMException("Agent task cancelled", "AbortError");
    await waitForChatJobPersistence(jobId);
    if (successfulBuild) await stateManager.markBuildSucceeded();
    await stateManager.refresh(message, result.productPlan, result.steps.filter((step) => step.success && /^(writeFile|patchFile|scaffoldProject)$/.test(step.tool)).map((step) => {
      try {
        const parsed = JSON.parse(step.input);
        return typeof parsed.path === "string" ? parsed.path : "";
      } catch { return ""; }
    }).filter(Boolean), result.steps.filter((step) => !step.success).map((step) => `${step.tool}: ${step.input.slice(0, 300)}`).slice(-20));
    await stateManager.markCompleted(message.slice(0, 240));
    if (signal?.aborted || (await getChatJob(jobId, userId))?.status === "cancelled") {
      throw new DOMException("Agent task cancelled", "AbortError");
    }
    const completed = await completeChatJob(jobId, userId, {
      reply: job.reply,
      steps: job.steps,
      productPlan: job.productPlan,
      agentIntent: job.agentIntent,
      executionPlan: job.executionPlan,
      executionState: job.executionState,
      validation: job.validation,
      telemetry: job.telemetry,
      stage: "completed",
    });
    if (!completed || completed.status !== "completed") throw new DOMException("Agent completion lost a race with cancellation", "AbortError");
    syncTerminalChatJobCache(completed);
    job.status = "completed";
    job.stage = "completed";
    void agentHistory.record({ type: "job-completed", jobId, projectId, provider, model, status: "completed", message: result.finalResponse });
    serverRuntime.updateTask(runtimeTask.id, "COMPLETED", { progress: 1 });

  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      job.status = "cancelled";
      job.stage = "cancelled";
      job.error = "Agent task cancelled by user.";
      job.updatedAt = Date.now();
      await persistChatJob(job).catch(() => {});
      void agentHistory.record({ type: "job-cancelled", jobId, projectId, provider, model, status: "cancelled", message: job.error });
      serverRuntime.updateTask(runtimeTask.id, "CANCELLED", { error: job.error });
      return;
    }
    job.status = "failed";
    job.stage = "error";
    job.updatedAt = Date.now();
    const normalizedError = error instanceof NexumError ? error : new NexumError("INTERNAL_ERROR", "AI agent execution failed.", { technicalDetails: error instanceof Error ? error.message : String(error) });
    job.error = normalizedError.userSafeMessage;
    job.errorCode = normalizedError.code;
    job.errorInfo = { code: normalizedError.code, message: normalizedError.userSafeMessage, retryable: normalizedError.retryable };
    await waitForChatJobPersistence(jobId);
    const failed = await failChatJob(jobId, userId, { stage: "error", error: job.error, errorCode: job.errorCode, errorInfo: job.errorInfo, agentIntent: job.agentIntent, executionPlan: job.executionPlan, executionState: job.executionState, validation: job.validation, telemetry: job.telemetry }).catch((persistenceError) => {
      console.error("[Nexum] failed to persist job exception", persistenceError);
      return null;
    });
    syncTerminalChatJobCache(failed);
    void agentHistory.record({ type: "job-exception", jobId, projectId, provider, model, status: "failed", message: job.error });
    serverRuntime.updateTask(runtimeTask.id, "FAILED", { error: normalizedError.userSafeMessage });
    console.error("[Nexum] chat job failed", jobId, error);
  } finally {
    chatJobControllers.delete(jobId);
    try {
      if (lockHeartbeatResourceId) serverRuntime.releaseResource(lockHeartbeatResourceId);
      if (lockHeartbeat) clearInterval(lockHeartbeat);
      if (lockedProjectId) await releaseProjectLock(lockedProjectId, jobId);
    } catch (lockError) {
      console.error("[Nexum] project lock release failed", jobId, lockError);
    }
    cancellationBridge.stop();
    if (attachmentDir) {
      await rm(attachmentDir, { recursive: true, force: true }).catch((error) => {
        console.error("[Nexum] attachment cleanup failed", { jobId, error });
      });
    }
  }
}


// Project managers are initialized lazily per authenticated user.

let httpServer: ReturnType<typeof app.listen> | undefined;
let shutdownPromise: Promise<void> | undefined;

async function shutdownServer(signal: "SIGTERM" | "SIGINT"): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    console.log(`[Nexum] ${signal} received; shutting down HTTP server and runtime.`);
    // Abort background Agent jobs first so no model/tool work can keep the
    // process alive while Playwright or a production supervisor waits for exit.
    for (const controller of chatJobControllers.values()) controller.abort();
    chatJobControllers.clear();
    serverRuntime.shutdown();

    await new Promise<void>((resolve) => {
      if (!httpServer || !httpServer.listening) {
        resolve();
        return;
      }
      httpServer.close(() => resolve());
    });

    await closeDatabase().catch((error) => {
      console.error("[Nexum] database shutdown failed", error);
    });
  })();
  return shutdownPromise;
}

process.once("SIGTERM", () => { void shutdownServer("SIGTERM"); });
process.once("SIGINT", () => { void shutdownServer("SIGINT"); });

const configuredCorsOrigins = (process.env.NEXUM_CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin: process.env.NODE_ENV === "production"
    ? (origin, callback) => {
        if (!origin || configuredCorsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error("CORS origin is not allowed"));
      }
    : true,
  credentials: true,
}));

app.use(express.json({ limit: "10mb" }));

app.post("/api/diagnostics/events", authMiddleware, (req, res) => {
  const body = req.body ?? {};
  const sessionId = typeof body.sessionId === "string" && body.sessionId.length < 120 ? body.sessionId : createDiagnosticsSession();
  const event = recordDiagnosticsEvent({
    sessionId,
    userId: getAuthUser(req).id,
    type: typeof body.type === "string" ? body.type.slice(0, 120) : "unknown",
    level: body.level === "error" || body.level === "warn" ? body.level : "info",
    message: typeof body.message === "string" ? body.message.slice(0, 4000) : "Unknown diagnostics event",
    route: typeof body.route === "string" ? body.route.slice(0, 500) : undefined,
    projectId: typeof body.projectId === "string" ? body.projectId.slice(0, 200) : undefined,
    jobId: typeof body.jobId === "string" ? body.jobId.slice(0, 200) : undefined,
    metadata: body.metadata && typeof body.metadata === "object" ? body.metadata as Record<string, unknown> : undefined,
  });
  return res.status(202).json({ success: true, sessionId: event.sessionId, eventId: event.id });
});

app.get("/api/diagnostics/session/:sessionId", authMiddleware, (req, res) => {
  const sessionId = typeof req.params.sessionId === "string" ? req.params.sessionId : "";
  return res.json({ success: true, ...getDiagnosticsSession(sessionId, getAuthUser(req).id) });
});

app.get("/api/diagnostics/latest", authMiddleware, (req, res) => {
  const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 100;
  return res.json({ success: true, generatedAt: new Date().toISOString(), events: getLatestDiagnostics(Number.isFinite(limit) ? limit : 100, getAuthUser(req).id) });
});

app.get("/api/runtime/status", authMiddleware, async (req, res) => {
  const ownedProjectIds = new Set((await getProjectManager(getAuthUser(req).id).listProjects()).map((project) => project.id));
  const tasks = [...serverRuntime.tasks.values()].filter((task) => typeof task.projectId === "string" && ownedProjectIds.has(task.projectId));
  const processes = [...serverRuntime.processes.values()]
    .filter((process) => typeof process.projectId === "string" && ownedProjectIds.has(process.projectId))
    .map((process) => ({ id: process.id, name: process.name, state: process.state, projectId: process.projectId }));
  return res.json({
    success: true,
    lifecycle: serverRuntime.lifecycle,
    tasks,
    resources: tasks.length,
    processes,
    diagnostics: serverRuntime.diagnostics.filter((event) => !event.projectId || ownedProjectIds.has(event.projectId)).slice(-100),
  });
});

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


app.post("/api/auth/register", authRegisterLimiter, async (req, res) => {
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

app.post("/api/auth/login", authLoginLimiter, async (req, res) => {
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

app.post("/api/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  return res.json({ success: true });
});

app.use("/api/projects", authMiddleware, projectLimiter);
app.use("/api/chat", authMiddleware, chatLimiter);
app.use("/api/agent/history", authMiddleware);
app.use("/api/agent/diagnostics", authMiddleware);

app.get("/api/ai/providers", authMiddleware, (req, res) => {
  return res.json({ success: true, providers: getAIGatewayForUser(getAuthUser(req).id).getProviders() });
});

app.get("/api/ai/models", authMiddleware, async (req, res) => {
  return res.json({ success: true, models: await getAIGatewayForUser(getAuthUser(req).id).getModels() });
});

const agentFailureControlEnabled = process.env.NODE_ENV !== "production" && agentFailureInjection.active;
if (agentFailureControlEnabled) {
  app.post("/api/test/agent-failures", (req, res) => {
    const operation = typeof req.body?.operation === "string" ? req.body.operation : "";
    const name = typeof req.body?.name === "string" ? req.body.name as AgentFailure : undefined;
    if (operation === "reset") agentFailureInjection.resetFailures();
    else if (operation === "enable" && name) agentFailureInjection.enableFailure(name, { times: Number(req.body?.times) || undefined, projectId: typeof req.body?.projectId === "string" ? req.body.projectId : undefined });
    else if (operation === "disable" && name) agentFailureInjection.disableFailure(name);
    else if (operation === "release" && name) agentFailureInjection.releaseFailure(name);
    else return res.status(400).json({ success: false, error: "Invalid failure injection operation" });
    return res.json({ success: true, active: agentFailureInjection.list(), diagnostics: agentFailureInjection.diagnostics().slice(-50) });
  });
  app.get("/api/test/agent-failures", (_req, res) => res.json({ success: true, active: agentFailureInjection.list(), diagnostics: agentFailureInjection.diagnostics().slice(-50) }));
}

const localTestMode = process.env.NODE_ENV !== "production" && process.env.NEXUM_LOCAL_TEST_MODE !== "false";

app.get("/api/ai/key-status", authMiddleware, (req, res) => {
  const gateway = getAIGatewayForUser(getAuthUser(req).id);
  return res.json({ success: true, providers: { openai: gateway.hasOpenAIKey(), openrouter: gateway.hasOpenRouterKey(), orcarouter: gateway.hasOrcaRouterKey() } });
});

app.post("/api/ai/connect-key", authMiddleware, aiWriteLimiter, async (req, res) => {
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
        userAIGateways.set(userId, createProviderGateway("openai", apiKey));
        return res.json({ success: true, provider: "openai", model: status.model, status });
      }
      if (providerId === "orcarouter") {
        const provider = new OrcaRouterProvider();
        provider.setRuntimeApiKey(apiKey);
        const status = await provider.getStatus();
        if (!status.available) throw new Error(status.error ?? "OrcaRouter key verification failed");
        userAIGateways.set(userId, createProviderGateway("orcarouter", apiKey));
        return res.json({ success: true, provider: "orcarouter", model: status.model, status });
      }

      const provider = new OpenRouterProvider();
      provider.setRuntimeApiKey(apiKey);
      const status = await provider.getStatus();
      if (!status.available) throw new Error(status.error ?? "OpenRouter key verification failed");
      userAIGateways.set(userId, createProviderGateway("openrouter", apiKey));
      return res.json({ success: true, provider: "openrouter", model: status.model, status });
    } catch (error) {
      errors.push(providerId + ": " + (error instanceof Error ? error.message : "verification failed"));
    }
  }
  return res.status(401).json({ success: false, error: errors.join("; ") || "API key verification failed" });
});

app.get("/api/ai/local-test", authMiddleware, (_req, res) => {
  return res.json({ enabled: localTestMode, configured: aiGateway.hasOpenRouterKey() });
});

app.post("/api/ai/local-test", authMiddleware, async (req, res) => {
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
    userAIGateways.set(getAuthUser(req).id, createProviderGateway("openrouter", apiKey));
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
    return res.json({ success: true, status: await getAIGatewayForUser(getAuthUser(req).id).getStatus(provider, model) });
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
    return sendProjectError(res, error, req);
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
    return res.json({ success: true, project: await getProjectManager(getAuthUser(req).id).getProject(req.params.id) });
  } catch (error) {
    return sendProjectError(res, error);
  }
});

app.post("/api/projects/:id/duplicate", async (req, res) => {
  try {
    const project = await getProjectManager(getAuthUser(req).id).duplicateProject(req.params.id);
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

app.use("/api/preview", authMiddleware);

// Static project preview. The agent writes the project files, and the preview
// renders index.html directly without requiring a separate dev server.
app.use("/api/preview/:id", async (req, res) => {
  try {
    const project = await getProjectManager(getAuthUser(req).id).getProject(req.params.id);
    const requestedPath = req.path.replace(/^\/+/, "") || "index.html";
    const distRoot = resolve(project.path, "dist");
    const distCandidate = resolve(distRoot, requestedPath);
    const sourceCandidate = resolve(project.path, requestedPath);
    const distIndex = resolve(distRoot, "index.html");
    const sourceMtime = await getLatestProjectSourceMtime(project.path);
    const distMtime = await stat(distIndex).then((details) => details.mtimeMs).catch(() => 0);
    const previewStateManager = projectStates.get(project.path) ?? new ProjectStateManager(project.path, project.id);
    projectStates.set(project.path, previewStateManager);
    const previewState = await previewStateManager.refresh();
    const hasBuild = distMtime > 0 && distMtime >= sourceMtime && previewState.previewRevision === previewState.sourceRevision;
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
    const project = await getProjectManager(getAuthUser(req).id).getProject(req.params.id);
    const message = typeof req.body?.message === "string" ? req.body.message.slice(0, 4000) : "Preview runtime error";
    const stack = typeof req.body?.stack === "string" ? req.body.stack.slice(0, 8000) : undefined;
    const kind = typeof req.body?.kind === "string" ? req.body.kind.slice(0, 80) : "error";
    const stateManager = projectStates.get(project.path) ?? new ProjectStateManager(project.path, project.id);
    projectStates.set(project.path, stateManager);
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
    const project = await getProjectManager(getAuthUser(req).id).getProject(req.params.id);
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
    const project = await getProjectManager(getAuthUser(req).id).getProject(req.params.id);
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
    const project = await getProjectManager(getAuthUser(req).id).getProject(req.params.id);
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
    const project = await getProjectManager(getAuthUser(req).id).getProject(req.params.id);
    const operation = req.params.operation;
    if (!["status", "diff", "diff-stat", "log", "branch"].includes(operation)) {
      return res.status(400).json({ success: false, error: "Unsupported Git operation" });
    }
    const result = await new GitTool(resolve(project.path), 30_000, serverRuntime, { projectId: project.id }).execute(operation);
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
    const project = await getProjectManager(getAuthUser(req).id).getProject(req.params.id);
    const command = typeof req.body?.command === "string" ? req.body.command.trim() : "";
    const allowed = new Set(["npm run build", "npm run test", "npm run lint", "npm run typecheck", "git status", "git diff", "git log"]);
    if (!allowed.has(command)) return res.status(400).json({ success: false, error: "Command is not allowed" });
    const result = await new RunCommandTool(resolve(project.path), 120000, serverRuntime, { projectId: project.id }).execute(command);
    const stateManager = projectStates.get(project.path) ?? new ProjectStateManager(project.path, project.id);
    projectStates.set(project.path, stateManager);
    if (command === "npm run build") {
      if (result.success) await stateManager.markBuildSucceeded();
      else await stateManager.refresh(undefined, undefined, [], [`build: ${result.stderr || result.stdout || "Command failed"}`]);
    }
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
    const project = await getProjectManager(getAuthUser(req).id).getProject(req.params.id);
    const checkpoints = await checkpointManager.list(project.id, project.path);
    return res.json({ success: true, checkpoints });
  } catch (error) {
    return sendProjectError(res, error);
  }
});

app.post("/api/projects/:id/checkpoints", async (req, res) => {
  try {
    const project = await getProjectManager(getAuthUser(req).id).getProject(req.params.id);
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
    const project = await getProjectManager(getAuthUser(req).id).getProject(req.params.id);
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
    const project = await getProjectManager(getAuthUser(req).id).getProject(req.params.id);
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
    const project = await getProjectManager(getAuthUser(req).id).getProject(req.params.id);
    const packagePath = resolve(project.path, "package.json");
    const distIndexPath = resolve(project.path, "dist", "index.html");
    const sourceIndexPath = resolve(project.path, "index.html");
    const hasPackage = await stat(packagePath).then((details) => details.isFile()).catch(() => false);
    const sourceMtime = await getLatestProjectSourceMtime(project.path);
    const distMtime = await stat(distIndexPath).then((details) => details.mtimeMs).catch(() => 0);
    const stateManager = projectStates.get(project.path) ?? new ProjectStateManager(project.path, project.id);
    projectStates.set(project.path, stateManager);
    const state = await stateManager.refresh();
    const hasDist = distMtime > 0 && distMtime >= sourceMtime && state.previewRevision === state.sourceRevision;
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
    await getProjectManager(getAuthUser(req).id).getActiveProject(projectId);

    await cleanupChatJobs();
    const jobId = randomUUID();
    const runtimeTask = serverRuntime.createTask({
      projectId: typeof projectId === "string" ? projectId : undefined,
      requestId: getRequestId(req),
      agentJobId: jobId,
      operation: "chat-job",
      priority: 10,
      maxRetries: 1,
    });
    const now = Date.now();
    const newJob: ChatJob = {
      id: jobId,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      stage: "queued",
      attachments: normalizedAttachments.map((item) => item.name),
      productPlan: undefined,
      userId: getAuthUser(req).id,
      projectId: typeof projectId === "string" ? projectId : undefined,
      runtimeTaskId: runtimeTask.id,
      requestId: getRequestId(req),
    };
    try {
      await createChatJob(newJob);
      chatJobCache.set(jobId, newJob);
    } catch (error) {
      serverRuntime.updateTask(runtimeTask.id, "FAILED", { error: error instanceof Error ? error.message : "Chat Job persistence failed" });
      throw error;
    }

    // Do not await the agent. The HTTP request returns immediately, avoiding
    // platform/proxy 504s while local Ollama or another provider is generating.
    const controller = new AbortController();
    chatJobControllers.set(jobId, controller);
    void runChatJob(
      jobId,
      message.trim(),
      projectId,
      getAuthUser(req).id,
      provider,
      model,
      normalizedAttachments,
      normalizedConversation,
      getRequestId(req),
      controller.signal,
      runtimeTask.id,
    );

    return res.status(202).json({
      success: true,
      jobId,
      runtimeTaskId: runtimeTask.id,
      status: "queued",
    });
  } catch (error) {
    return res.status(502).json({
      error: error instanceof Error ? error.message : "Chat job creation failed",
    });
  }
});

app.post("/api/chat/jobs/:id/cancel", async (req, res) => {
  const userId = getAuthUser(req).id;
  await cleanupChatJobs();
  const job = await loadChatJob(req.params.id, userId, getChatJob);
  if (!job) return res.status(404).json({ success: false, error: "Chat job not found or expired" });
  if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
    return res.json({ success: true, cancelled: job.status === "cancelled", job });
  }
  await waitForChatJobPersistence(job.id);
  const cancelled = await cancelChatJob(job.id, userId);
  if (!cancelled) {
    const current = await loadChatJob(job.id, userId, getChatJob);
    return res.json({ success: true, cancelled: current?.status === "cancelled", job: current });
  }
  syncTerminalChatJobCache(cancelled);
  chatJobControllers.get(job.id)?.abort();
  const runtimeTaskId = job.runtimeTaskId;
  if (runtimeTaskId) serverRuntime.cancelTask(runtimeTaskId);
  return res.json({ success: true, cancelled: true, job: cancelled });
});

app.get("/api/agent/history", async (req, res) => {
  const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 200;
  const userId = getAuthUser(req).id;
  const ownedProjectIds = new Set((await getProjectManager(userId).listProjects()).map((project) => project.id));
  const entries = (await agentHistory.recent(Number.isFinite(limit) ? limit : 200))
    .filter((entry) => typeof entry.projectId === "string" && ownedProjectIds.has(entry.projectId));
  return res.json({ success: true, entries });
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
  const userId = getAuthUser(req).id;
  const ownedProjectIds = new Set((await getProjectManager(userId).listProjects()).map((project) => project.id));
  const entries = (await agentHistory.recent(limit))
    .filter((entry) => typeof entry.projectId === "string" && ownedProjectIds.has(entry.projectId));
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
    jobs: (await listChatJobs(getAuthUser(req).id, 20)).map((job) => ({
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

app.get("/api/chat/jobs", async (req, res) => {
  await cleanupChatJobs();
  const userId = getAuthUser(req).id;
  const jobs = await listChatJobs(userId, 50);
  const active = jobs.filter((job) => job.status === "queued" || job.status === "running");
  return res.json({ success: true, jobs: active });
});

app.get("/api/chat/jobs/:id", async (req, res) => {
  await cleanupChatJobs();
  const userId = getAuthUser(req).id;
  const job = await loadChatJob(req.params.id, userId, getChatJob);
  if (!job) return res.status(404).json({ success: false, error: "Chat job not found or expired" });
  return res.json({ success: true, job });
});

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

function sendProjectError(res: Response, error: unknown, req?: express.Request) {
  const requestId = req ? getRequestId(req) : randomUUID();
  if (error instanceof ProjectManagerError) {
    const code = error.statusCode === 404 ? "USER_ERROR" : error.statusCode === 409 ? "USER_ERROR" : "INTERNAL_ERROR";
    return sendSafeError(res, new NexumError(code, error.message, { status: error.statusCode, retryable: error.statusCode >= 500, technicalDetails: error.message }), requestId);
  }
  return sendSafeError(res, error, requestId, "Project manager request failed");
}

app.use((error: unknown, req: express.Request, res: Response, next: express.NextFunction) => {
  if (res.headersSent) return next(error);
  const requestId = getRequestId(req);
  return sendSafeError(res, error, requestId);
});

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || "0.0.0.0";
httpServer = app.listen(PORT, HOST, () => {
  console.log(`NEXUM API running on http://${HOST}:${PORT}`);
});
