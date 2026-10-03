function phaseAfterIteration(current: AgentPhase, hasHistory: boolean): AgentPhase {
  if (!hasHistory) return "analyze";
  return current === "repair" ? "repair" : "plan";
}

import type { AIGateway } from "../ai/gateway.js";
import { diagnoseError } from "./errorRecovery.js";
import { toNexumError } from "../core/errors.js";
import { canFinishBuilder, createAgentTaskState, recordSuccessfulChange, syncVerificationState } from "./taskState.js";
import { recordAction } from "./journal.js";
import type { GatewayGenerateOptions } from "../ai/gateway.js";
import { createAdaptiveTokenBudget, type AdaptiveTokenBudget } from "./tokenBudget.js";
import { createAgentIntent } from "./intent.js";
import { createExecutionPlan, createTelemetry, transitionAgentState, setPlanStep, markPlanStepCompleted, markPlanStepSkipped, canRunPlanStep, createValidation, evaluateCompletionGate, type AgentExecutionSnapshot } from "./executionState.js";
import { agentFailureInjection } from "./failureInjection.js";
import type {
  AgentModelOptions,
  AgentPlan,
  AgentLoopResult,
  ProductPlan,
  AgentRuntime,
  AgentStep,
  AgentToolResult,
  AgentPhase,
  AgentErrorInfo,
  AgentIntent,
  AgentState,
  AgentResultSummary,
} from "./types.js";

const DEFAULT_MAX_ITERATIONS = 12;
const MAX_AI_PLANNER_CALLS = 3;
const MAX_PRODUCT_REVIEW_CALLS = 1;
const MAX_REPAIR_ATTEMPTS = 3;
const MAX_TOOL_CALLS = 40;
const MAX_MODEL_TURNS = 8;
const MAX_DURATION_MS = 15 * 60 * 1000;
// One bounded token budget is shared by every remote AI call in a single task.
// The budget is based on requested max tokens, so a long agent run cannot
// silently accumulate several independent per-call limits.
const DEFAULT_TASK_TOKEN_BUDGET = 18_000;
const MAX_RESULT_LENGTH = 8_000;
const MAX_CONTEXT_RESULTS = 6;
const MAX_ACTION_FINGERPRINT_LENGTH = 1800;
const MAX_COMPACT_HISTORY_CHARS = 5_000;
const MAX_COMPACT_HISTORY_ITEMS = 8;
const MAX_COMPACT_INPUT_CHARS = 320;
const MAX_COMPACT_OUTPUT_CHARS = 520;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Agent task cancelled", "AbortError");
}
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError" || error instanceof Error && error.name === "AbortError";
}

export function compactAgentHistory(results: AgentToolResult[]): AgentToolResult[] {
  if (results.length === 0) return [];

  const normalized = results
    .map((item) => {
      const output = item.result.output.replace(/\s+/g, " ").trim();
      const input = item.input.replace(/\s+/g, " ").trim();
      const compactInput = (() => {
        try {
          const parsed = JSON.parse(item.input) as Record<string, unknown>;
          if (item.tool === "writeFile" && typeof parsed.path === "string") {
            return JSON.stringify({ path: parsed.path, content: `<${typeof parsed.content === "string" ? parsed.content.length : 0} chars>` });
          }
          if (item.tool === "patchFile" && typeof parsed.path === "string") {
            return JSON.stringify({
              path: parsed.path,
              find: typeof parsed.find === "string" ? parsed.find.slice(0, 120) : "",
              replace: `<${typeof parsed.replace === "string" ? parsed.replace.length : 0} chars>`,
            });
          }
          if (item.tool === "runSandbox" && typeof parsed.command === "string") {
            return JSON.stringify({ command: parsed.command });
          }
        } catch {
          // Keep non-JSON tool inputs as text.
        }
        return input.slice(0, MAX_COMPACT_INPUT_CHARS);
      })();

      const outputLimit = item.result.success
        ? (item.tool === "listFiles" || item.tool === "searchFiles" ? 700 : MAX_COMPACT_OUTPUT_CHARS)
        : 700;
      const compactOutput = output.length <= outputLimit
        ? output
        : `${output.slice(0, Math.max(120, outputLimit - 180))} … ${output.slice(-160)}`;
      return {
        ...item,
        input: compactInput,
        result: { ...item.result, output: compactOutput },
      };
    })
    .filter((item, index, all) => !all.slice(0, index).some((candidate) =>
      candidate.tool === item.tool &&
      candidate.input === item.input &&
      candidate.result.success === item.result.success &&
      candidate.result.output === item.result.output,
    ));

  const recent = normalized.slice(-MAX_COMPACT_HISTORY_ITEMS);
  const recentKeys = new Set(recent.map((item) => `${item.tool}|${item.input}|${item.result.success}`));
  const recentFailures = normalized
    .filter((item) => !item.result.success)
    .slice(-3)
    .filter((item) => !recentKeys.has(`${item.tool}|${item.input}|${item.result.success}`));
  const selected = [...recentFailures, ...recent];

  const compacted: AgentToolResult[] = [];
  let usedChars = 0;
  for (const item of selected) {
    const lineSize = item.tool.length + item.input.length + item.result.output.length + 48;
    if (compacted.length > 0 && usedChars + lineSize > MAX_COMPACT_HISTORY_CHARS) break;
    compacted.push(item);
    usedChars += lineSize;
  }
  return compacted;
}

export type AgentEventName = "agent.started"|"agent.intent.created"|"agent.plan.created"|"agent.step.started"|"agent.tool.started"|"agent.tool.completed"|"agent.observation.created"|"agent.validation.started"|"agent.validation.failed"|"agent.repair.started"|"agent.repair.completed"|"agent.verification.started"|"agent.completed"|"agent.failed"|"agent.cancelled";

export interface AgentEvent {
  id: number;
  timestamp: number;
  iteration: number;
  type: "thinking" | "tool-start" | "tool-success" | "tool-error" | "completed" | "failed";
  name?: AgentEventName;
  phase: AgentPhase;
  tool?: string;
  message: string;
  errorCode?: string;
  retryable?: boolean;
  requestId?: string;
  projectId?: string;
  taskId?: string;
  agentJobId?: string;
  planId?: string;
}

export class AgentLoop {
  private lastExecutionSnapshot?: AgentExecutionSnapshot;

  constructor(
    private readonly runtime: AgentRuntime,
    private readonly gateway: AIGateway,
    private readonly maxIterations = DEFAULT_MAX_ITERATIONS,
    private readonly onStep?: (step: AgentStep) => void,
    private readonly onEvent?: (event: AgentEvent) => void,
    private readonly onPlan?: (plan: ProductPlan) => void,
    private readonly journalContext?: { requestId?: string; agentRunId?: string; taskId?: string; projectId?: string; provider?: string; model?: string },
    private readonly onExecutionUpdate?: (snapshot: AgentExecutionSnapshot) => void,
  ) {}

  async run(task: string, options?: GatewayGenerateOptions): Promise<AgentLoopResult> {
    try {
      const result = await this.runInternal(task, options);
      const intent = result.intent ?? createAgentIntent(task, {
        requestId: this.journalContext?.requestId,
        projectId: this.journalContext?.projectId,
        taskId: this.journalContext?.taskId ?? this.journalContext?.agentRunId,
        agentJobId: this.journalContext?.agentRunId,
      });
      const finalState: AgentState = result.finalState ?? (result.success ? "COMPLETED" : "FAILED");
      const executionPlan = result.executionPlan ?? createExecutionPlan(intent);
      return {
        ...result,
        intent,
        executionPlan,
        finalState,
        summary: result.summary ?? {
          status: finalState,
          summary: result.success ? "Agent execution completed." : result.error ?? "Agent execution failed.",
          changedFiles: [],
          completedSteps: executionPlan.steps.filter((step) => step.status === "COMPLETED").map((step) => step.id),
          warnings: [],
          errors: result.success ? [] : [result.error ?? finalState],
        },
      };
    } catch (error) {
      if (isAbortError(error) || options?.signal?.aborted) {
        const snapshot = this.lastExecutionSnapshot;
        const intent = snapshot?.intent ?? createAgentIntent(task, {
          requestId: this.journalContext?.requestId,
          projectId: this.journalContext?.projectId,
          taskId: this.journalContext?.taskId ?? this.journalContext?.agentRunId,
          agentJobId: this.journalContext?.agentRunId,
        });
        const executionPlan = snapshot?.plan ?? createExecutionPlan(intent);
        return {
          success: false,
          iterations: snapshot?.completedStepIds.length ?? 0,
          steps: [],
          phase: "repair",
          intent,
          executionPlan,
          finalState: "CANCELLED",
          validation: {
            passed: false,
            categories: { static: false, runtime: false, functional: false, project: false },
            checks: [{ name: "cancellation", passed: true, evidence: "Agent cancellation was observed before completion." }],
            failedCriteria: ["Cancelled by user"],
          },
          telemetry: snapshot ? createTelemetry(snapshot.startedAt, 0, 0, snapshot.completedStepIds.length, snapshot.repairAttempts) : undefined,
          error: "Agent task cancelled by user.",
          summary: {
            status: "CANCELLED",
            summary: "Agent execution cancelled by user.",
            changedFiles: [],
            completedSteps: snapshot?.completedStepIds ?? [],
            warnings: [],
            errors: ["CANCELLED"],
          },
        };
      }
      throw error;
    }
  }      throw error;
    }
  }

  private async runInternal(task: string, options?: GatewayGenerateOptions): Promise<AgentLoopResult> {
    const steps: AgentStep[] = [];
    const previousResults: AgentToolResult[] = [];
    const seenActions = new Set<string>();
    const actionAttempts = new Map<string, number>();
    const seenPlannerContexts = new Set<string>();
    const actionSequence: string[] = [];
    let eventId = 0;
    let phase: AgentPhase = "analyze";
    const taskState = createAgentTaskState(task);
    const intent = createAgentIntent(task, {
      requestId: this.journalContext?.requestId,
      projectId: this.journalContext?.projectId,
      taskId: this.journalContext?.taskId ?? this.journalContext?.agentRunId,
      agentJobId: this.journalContext?.agentRunId,
    });
    const executionSnapshot: AgentExecutionSnapshot = {
      intent,
      state: "IDLE",
      plan: createExecutionPlan(intent),
      observations: [],
      completedStepIds: [],
      repairAttempts: 0,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };
    const publishExecution = () => {
      executionSnapshot.updatedAt = Date.now();
      this.lastExecutionSnapshot = structuredClone(executionSnapshot);
      this.onExecutionUpdate?.(structuredClone(executionSnapshot));
    };
    const setAgentState = (next: AgentState, name?: AgentEventName, message?: string) => {
      if (executionSnapshot.state === next) return true;
      const changed = transitionAgentState(executionSnapshot, next, (warning, severity = "warn") => {
        this.onEvent?.({ id: ++eventId, timestamp: Date.now(), iteration: 0, type: "failed", phase, name: "agent.failed", message: warning, errorCode: severity === "error" ? "INTERNAL_ERROR" : undefined });
      });
      if (!changed) throw new Error(`Invalid Agent state transition ${executionSnapshot.state} -> ${next}`);
      publishExecution();
      if (name && message) emit({ iteration: 0, type: "thinking", name, message, phase });
      return true;
    };
    let productPlan: ProductPlan | null = null;
    const onAbort = () => {
      if (!["COMPLETED", "FAILED", "CANCELLED"].includes(executionSnapshot.state)) {
        transitionAgentState(executionSnapshot, "CANCELLED", () => undefined);
        executionSnapshot.updatedAt = Date.now();
        this.onEvent?.({ id: ++eventId, timestamp: Date.now(), iteration: executionSnapshot.plan.steps.length, type: "failed", name: "agent.cancelled", phase, message: "Agent execution cancelled." });
        this.onExecutionUpdate?.(structuredClone(executionSnapshot));
      }
    };
    options?.signal?.addEventListener("abort", onAbort, { once: true });
    let productReviewAttempts = 0;
    let forceCompletionNextIteration = false;
    let remotePlannerRateLimited = false;
    let aiPlannerCalls = 0;
    let modelTurns = 0;
    let productPlannerCreated = false;
    const adaptiveBudget: AdaptiveTokenBudget = createAdaptiveTokenBudget(task, { legacyHardCap: DEFAULT_TASK_TOKEN_BUDGET });
    const aiOptionsForTask = (base?: GatewayGenerateOptions, role: "planner" | "coder" | "reviewer" | "debugger" | "tester" | "finalizer" | "general" = "general"): GatewayGenerateOptions | undefined => {
      const maxTokens = adaptiveBudget.reserve(role, typeof base?.maxTokens === "number" && base.maxTokens > 0 ? base.maxTokens : undefined);
      return maxTokens > 0 ? { ...(base ?? {}), maxTokens } : undefined;
    };
    const builderTask = /создай|сделай|разработай|build|create|make|сайт|приложени|лендинг|dashboard|landing|web app|website|marketplace|crm|поменяй|измени|добавь|удали|исправь/i.test(task);
    const requiresProjectUnderstanding = builderTask || /analy[sz]e|audit|review|проверь|проанализ|исправ|debug|debugger|рефактор|refactor|настрой|configure|измен|добав|удал|fix|bug/i.test(task);
    const markStepRunning = (id: string) => {
      if (!canRunPlanStep(executionSnapshot.plan, id)) {
        throw new Error(`Plan step dependency is not satisfied: ${id}`);
      }
      setPlanStep(executionSnapshot.plan, id, "RUNNING");
      publishExecution();
    };
    const markStepCompletedLocal = (id: string, result?: string) => {
      markPlanStepCompleted(executionSnapshot.plan, id, result);
      if (!executionSnapshot.completedStepIds.includes(id)) executionSnapshot.completedStepIds.push(id);
      publishExecution();
    };
    const addObservation = (observation: string) => {
      executionSnapshot.observations.push(observation.slice(0, 1600));
      executionSnapshot.observations = executionSnapshot.observations.slice(-12);
      publishExecution();
      emit({ iteration: 0, type: "thinking", name: "agent.observation.created", message: "Observation: " + observation.slice(0, 420), phase });
    };


    // Build is optional for static projects. Only enforce npm run build when
    // package.json (or a React/Vite scaffold) actually exposes a build script.
    const projectHasBuildScript = (results: AgentToolResult[]): boolean => {
      const packageResult = [...results]
        .reverse()
        .find((item) => item.tool === "readFile" && item.result.success && /"scripts"\s*:/i.test(item.result.output));
      if (packageResult) {
        try {
          const parsed = JSON.parse(packageResult.result.output);
          return typeof parsed?.scripts?.build === "string" && parsed.scripts.build.trim().length > 0;
        } catch {
          return /"build"\s*:/i.test(packageResult.result.output);
        }
      }
      return results.some((item) =>
        item.tool === "scaffoldProject" &&
        item.result.success &&
        /React\/Vite scaffold created/i.test(item.result.output)
      );
    };
    const transition = (next: AgentPhase) => {
      if (phase === next) return;
      const stateByPhase: Record<AgentPhase, AgentState> = { analyze: "UNDERSTANDING", plan: "PLANNING", implement: "EXECUTING", validate: "VALIDATING", repair: "REPAIRING", verify: "VERIFYING", finish: "COMPLETED" };
      const nextState = stateByPhase[next];
      if (executionSnapshot.state !== nextState && !transitionAgentState(executionSnapshot, nextState, (warning) => this.onEvent?.({ id: ++eventId, timestamp: Date.now(), iteration: 0, type: "failed", name: "agent.failed", phase, message: warning }))) {
        return;
      }
      phase = next;
      taskState.phase = next;
      publishExecution();
      emit({ iteration: 0, type: "thinking", phase, message: `Стадия агента: ${phase}.` });
    };
    const emit = (event: Omit<AgentEvent, "id" | "timestamp" | "phase"> & { phase?: AgentPhase }) => {
      this.onEvent?.({
        ...event,
        phase: event.phase ?? phase,
        id: ++eventId,
        timestamp: Date.now(),
        requestId: this.journalContext?.requestId,
        projectId: this.journalContext?.projectId,
        taskId: this.journalContext?.taskId,
        agentJobId: this.journalContext?.agentRunId,
        planId: executionSnapshot.plan.planId,
      });
    };
    setAgentState("UNDERSTANDING", "agent.started", "Agent execution started.");
    emit({ iteration: 0, type: "thinking", name: "agent.intent.created", phase: "analyze", message: "Нормализовал запрос в структурированный Intent и закрепил project/task ownership." });
    publishExecution();
    emit({ iteration: 0, type: "thinking", phase: "analyze", message: "Принял запрос. Анализирую проект и выбираю следующий шаг." });

    for (let iteration = 1; iteration <= this.maxIterations; iteration += 1) {
      throwIfAborted(options?.signal);
      if (agentFailureInjection.isEnabled("TIMEOUT")) {
        setAgentState("FAILED", "agent.failed", "Injected Agent timeout.");
        options?.signal?.removeEventListener("abort", onAbort);
        return { phase, success: false, iterations: iteration - 1, steps, productPlan: productPlan ?? undefined, intent, executionPlan: executionSnapshot.plan, finalState: "FAILED", error: "Injected Agent timeout." };
      }
      if (Date.now() - executionSnapshot.startedAt > MAX_DURATION_MS) {
        setAgentState("FAILED", "agent.failed", "Agent execution duration limit reached.");
        options?.signal?.removeEventListener("abort", onAbort);
        return { phase, success: false, iterations: iteration - 1, steps, productPlan: productPlan ?? undefined, intent, executionPlan: executionSnapshot.plan, finalState: "FAILED", error: "Agent execution duration limit reached." };
      }
      if (steps.length >= MAX_TOOL_CALLS) {
        setAgentState("FAILED", "agent.failed", "Agent tool-call limit reached.");
        options?.signal?.removeEventListener("abort", onAbort);
        return { phase, success: false, iterations: iteration - 1, steps, productPlan: productPlan ?? undefined, intent, executionPlan: executionSnapshot.plan, finalState: "FAILED", error: "Agent tool-call limit reached." };
      }
      const availableTools = this.runtime.getAvailableTools();
      transition(phaseAfterIteration(phase, previousResults.length > 0));

      // Builder sessions always inspect the active project before planning or editing.
      // This prevents the model from inventing a new app or answering with source code.
      if (requiresProjectUnderstanding && previousResults.length === 0 && availableTools.includes("listFiles")) {
        markStepRunning("understand");
        emit({ iteration, type: "tool-start", name: "agent.step.started", tool: "listFiles", message: "Изучаю текущий проект перед планированием." });
        const inspection = await this.runtime.executeTool("listFiles", ".", options?.signal);
        const step: AgentStep = { iteration, tool: "listFiles", input: ".", success: inspection.success };
        steps.push(step);
        this.onStep?.(step);
        previousResults.push({ iteration, tool: "listFiles", input: ".", result: inspection });
        addObservation(inspection.success ? `Project structure acquired: ${inspection.output.slice(0, 900)}` : `Project inspection failed: ${inspection.output.slice(0, 900)}`);
        markStepCompletedLocal("understand", inspection.output);
        seenActions.add(this.actionFingerprint("listFiles", "."));
        actionAttempts.set(this.actionFingerprint("listFiles", "."), 1);
        this.log(iteration, "listFiles", inspection.success ? "success" : "error");
        emit({
          iteration,
          type: inspection.success ? "tool-success" : "tool-error",
          tool: "listFiles",
          message: inspection.success ? "Структура проекта изучена." : `Не удалось изучить проект: ${inspection.output.slice(0, 400)}`,
        });
        continue;
      }

      if (builderTask && !productPlan && !productPlannerCreated && this.runtime.createProductPlan && previousResults.some((item) => item.tool === "listFiles" && item.result.success)) {
        emit({ iteration, type: "thinking", message: "Формирую Product Plan: страницы, компоненты, визуальную систему и критерии готовности." });
        try {
          if (++modelTurns > MAX_MODEL_TURNS) throw new Error("Agent model-turn limit reached");
          productPlannerCreated = true;
          const aiOptions = aiOptionsForTask(options, "planner");
          if (!aiOptions) throw new Error("Task AI token budget exhausted");
          productPlan = await this.runtime.createProductPlan(task, compactAgentHistory(previousResults), aiOptions as AgentModelOptions);
          this.onPlan?.(productPlan);
          executionSnapshot.plan.acceptanceCriteria = [...new Set([...executionSnapshot.plan.acceptanceCriteria, ...productPlan.acceptanceCriteria])];
          markPlanStepCompleted(executionSnapshot.plan, "plan", JSON.stringify({ productType: productPlan.productType, pages: productPlan.pages, components: productPlan.components }));
          if (!executionSnapshot.completedStepIds.includes("plan")) executionSnapshot.completedStepIds.push("plan");
          publishExecution();
          emit({ iteration, type: "thinking", name: "agent.plan.created", message: `План готов: ${productPlan.productType}; ${productPlan.pages.length} экранов; ${productPlan.acceptanceCriteria.length} критериев проверки.` });
        } catch (error) {
        if (isAbortError(error) || options?.signal?.aborted) throw new DOMException("Agent task cancelled", "AbortError");
          const normalizedError = toNexumError(error, "MODEL_ERROR", "Не удалось сформировать план проекта.");
      emit({ iteration, type: "tool-error", tool: "Product Planner", message: normalizedError.userSafeMessage, errorCode: normalizedError.code, retryable: normalizedError.retryable });
        }
      }
      emit({ iteration, type: "thinking", message: `Шаг ${iteration}: анализирую состояние проекта и результаты предыдущего действия.` });
      let modelPlan: AgentPlan | null = null;
      if (forceCompletionNextIteration) {
        forceCompletionNextIteration = false;
        modelPlan = { tool: "", input: "", done: true, finalResponse: "Задача проверена и завершена." };
      }
      const compactHistory = compactAgentHistory(previousResults);
      const plannerContextFingerprint = JSON.stringify({
        task,
        provider: options?.provider ?? null,
        model: options?.model ?? null,
        productPlan: productPlan ?? null,
        history: compactHistory.map((item) => ({
          iteration: item.iteration,
          tool: item.tool,
          input: item.input,
          success: item.result.success,
          output: item.result.output,
        })),
      });
      const plannerContextSeen = seenPlannerContexts.has(plannerContextFingerprint);
      if (!modelPlan && this.runtime.planWithAI && !remotePlannerRateLimited && aiPlannerCalls < MAX_AI_PLANNER_CALLS && !plannerContextSeen) {
        try {
          if (++modelTurns > MAX_MODEL_TURNS) throw new Error("Agent model-turn limit reached");
          seenPlannerContexts.add(plannerContextFingerprint);
          aiPlannerCalls += 1;
          const aiOptions = aiOptionsForTask(options, "finalizer");
          if (!aiOptions) throw new Error("Task AI token budget exhausted");
          modelPlan = await this.runtime.planWithAI(task, compactHistory, aiOptions as AgentModelOptions, productPlan ?? undefined);
        } catch (error) {
        if (isAbortError(error) || options?.signal?.aborted) throw new DOMException("Agent task cancelled", "AbortError");
          const message = error instanceof Error ? error.message : "AI planning failed";
          if (/(?:rate limit|rate-limit|too many requests|429)/i.test(message)) {
            remotePlannerRateLimited = true;
          }
          this.log(iteration, "AI planner", "error");
          emit({
            iteration,
            type: "tool-error",
            tool: "AI planner",
            message: `AI planner недоступен: ${message}. Переключаюсь на встроенный планировщик.`,
          });
          // A missing/unavailable AI provider must not make basic Builder tasks
          // appear to do nothing. The deterministic planner can still scaffold,
          // edit, build and verify supported projects. Once a provider returns
          // 429, keep it disabled for this job instead of hammering the same
          // rate-limited endpoint on every iteration.
          modelPlan = null;
        }
      } else if (this.runtime.planWithAI && plannerContextSeen) {
        emit({
          iteration,
          type: "thinking",
          message: "Контекст задачи не изменился. Повторный AI planner-запрос пропущен.",
        });
      }
      // Prefer the model plan when available. If it repeats an action that
      // already failed, switch to the deterministic planner so recovery can continue.
      let plan = modelPlan ?? this.runtime.plan(task, previousResults);
      if (!plan && !builderTask && previousResults.length > 0 && previousResults[previousResults.length - 1]?.result.success) {
        const followUp = this.runtime.plan(task, previousResults);
        if (!followUp) {
          forceCompletionNextIteration = true;
          plan = { tool: "", input: "", done: true, finalResponse: "Задача проверена и завершена." };
        }
      }
      if (plan && !executionSnapshot.completedStepIds.includes("plan")) {
        markStepCompletedLocal("plan", `Next action: ${plan.done ? "completion candidate" : plan.tool}`);
        emit({ iteration, type: "thinking", name: "agent.plan.created", message: "Выбран следующий bounded action с учётом наблюдений.", phase });
      }
      if (plan && !plan.done) transition(plan.tool === "runCommand" || plan.tool === "runSandbox" ? "validate" : plan.tool === "readFile" || plan.tool === "listFiles" || plan.tool === "searchFiles" ? "analyze" : "implement");
      if (modelPlan) {
        const modelActionKey = this.actionFingerprint(modelPlan.tool, modelPlan.input);
        const repeatedFailure = previousResults.some(
          (item) => item.tool === modelPlan.tool && item.input === modelPlan.input && !item.result.success,
        );
        const attempts = actionAttempts.get(modelActionKey) ?? 0;
        if (repeatedFailure || seenActions.has(modelActionKey) || attempts >= 2) {
          emit({
            iteration,
            type: "thinking",
            message: "Модель повторила неудачное действие. Переключаюсь на детерминированный recovery-план.",
          });
          plan = this.runtime.plan(task, previousResults);
        }
      }

      if (!plan) {
        if (builderTask) {
          const implementationWrites = previousResults.filter(
            (item) => (item.tool === "writeFile" || item.tool === "patchFile") && item.result.success,
          ).length;
          if (implementationWrites < 2) {
            const inspection = [...previousResults]
              .reverse()
              .find((item) => item.tool === "listFiles" && item.result.success)?.result.output ?? "";
            const candidates = [
              "src/App.tsx",
              "src/App.jsx",
              "src/main.tsx",
              "src/main.jsx",
              "index.html",
              "package.json",
              "src/App.css",
              "src/styles.css",
              "style.css",
            ];
            const nextPath = candidates.find((candidate) =>
              inspection.includes(candidate) &&
              !previousResults.some((item) => item.tool === "readFile" && item.input === candidate && item.result.success),
            );
            if (nextPath) {
              plan = { tool: "readFile", input: nextPath };
              emit({
                iteration,
                type: "thinking",
                message: `Планировщик не выбрал действие. Для Builder-задачи принудительно читаю ${nextPath}, чтобы продолжить реализацию.`,
              });
            } else if (availableTools.includes("searchFiles")) {
              plan = { tool: "searchFiles", input: task };
              emit({
                iteration,
                type: "thinking",
                message: "Планировщик не выбрал действие. Ищу связанные файлы перед реализацией.",
              });
            }
          }
        }

        if (!plan) {
          emit({ iteration, type: "failed", message: "Builder не выполнил реализацию: планировщик не предложил ни одного действия." });
          return {
            phase,
            success: false,
            iterations: iteration - 1,
            steps,
            productPlan: productPlan ?? undefined,
            error: "Builder stopped before implementation: no actionable plan.",
          };
        }
      }

      if (!plan) {
        transition("finish");
        emit({ iteration, type: "completed", message: "Детерминированный план завершён." });
        return {
          phase: "finish",
          success: true,
          iterations: iteration,
          steps,
          productPlan: productPlan ?? undefined,
        };
      }

      if (plan.done) {
        transition("validate");
        const buildTask = /создай|сделай|разработай|сайт|приложени|лендинг|dashboard|landing|web app|website|marketplace|crm/i.test(task);
        const scaffoldedProject = previousResults.some((item) => item.tool === "scaffoldProject" && item.result.success);
        const meaningfulImplementationCount = previousResults.filter((item) => (item.tool === "writeFile" || item.tool === "patchFile") && item.result.success).length;
        const meaningfulImplementation = meaningfulImplementationCount >= 2;
        const inspectedProject = previousResults.some((item) => (item.tool === "listFiles" || item.tool === "readFile" || item.tool === "searchFiles") && item.result.success);
        const verifiedBuild = previousResults.some((item) => item.tool === "runCommand" && item.input === "npm run build" && item.result.success);

        if (buildTask && scaffoldedProject && (!inspectedProject || !meaningfulImplementation || !verifiedBuild)) {
          emit({
            iteration,
            type: "thinking",
            message: !inspectedProject
              ? "Каркас создан. Изучаю его файлы перед реализацией."
              : !meaningfulImplementation
                ? "Каркас недостаточен. Реализую интерфейс и логику по исходному запросу."
                : "Реализация есть. Проверяю production-сборку.",
          });

          if (!inspectedProject && availableTools.includes("listFiles")) {
            const input = ".";
            const result = await this.runtime.executeTool("listFiles", input, options?.signal);
            const step: AgentStep = { iteration, tool: "listFiles", input, success: result.success };
            steps.push(step);
            this.onStep?.(step);
            previousResults.push({ iteration, tool: "listFiles", input, result });
            this.log(iteration, "listFiles", result.success ? "success" : "error");
            emit({
              iteration,
              type: result.success ? "tool-success" : "tool-error",
              tool: "listFiles",
              message: result.success ? "Структура проекта изучена." : `Не удалось прочитать структуру: ${result.output.slice(0, 400)}`,
            });
            continue;
          }
          if (!meaningfulImplementation) continue;

          if (!verifiedBuild && projectHasBuildScript(previousResults) && availableTools.includes("runCommand")) {
            const input = "npm run build";
            const result = await this.runtime.executeTool("runCommand", input, options?.signal);
            const step: AgentStep = { iteration, tool: "runCommand", input, success: result.success };
            steps.push(step);
            this.onStep?.(step);
            previousResults.push({ iteration, tool: "runCommand", input, result });
            this.log(iteration, input, result.success ? "success" : "error");
            emit({
              iteration,
              type: result.success ? "tool-success" : "tool-error",
              tool: "runCommand",
              message: result.success ? "Production-сборка подтверждена." : `Сборка не прошла: ${result.output.slice(0, 500)}`,
            });
            if (!result.success) { transition("repair"); continue; }
          }
        }

        const lastResult = previousResults[previousResults.length - 1];
        const lastFailure = [...previousResults].reverse().find((item) => !item.result.success);
        if (lastFailure && lastResult?.result.success === false) {
          emit({ iteration, type: "thinking", message: "Последнее действие завершилось ошибкой. Передаю её модели вместо завершения сессии." });
          continue;
        }

        // Never finish an app-building session with an unverified package project.
        // If the agent wrote project files but did not build, perform the final
        // install/build deterministically and let the model repair any failure.
        const hasSuccessfulStaticValidation = previousResults.some(
          (item) => item.tool === "validateProject" && item.result.success,
        );
        const hasStaticProject = previousResults.some(
          (item) => item.tool === "listFiles" && item.result.success &&
            /(?:^|\\n)index\\.html(?:\\n|$)/.test(item.result.output),
        ) && !projectHasBuildScript(previousResults);
        if (
          builderTask &&
          hasStaticProject &&
          !hasSuccessfulStaticValidation &&
          availableTools.includes("validateProject")
        ) {
          emit({
            iteration,
            type: "tool-start",
            tool: "validateProject",
            message: "Проверяю HTML, CSS, JavaScript и JSON перед Preview.",
          });
          const validation = await this.runtime.executeTool("validateProject", ".", options?.signal);
          const step: AgentStep = { iteration, tool: "validateProject", input: ".", success: validation.success };
          steps.push(step);
          this.onStep?.(step);
          previousResults.push({ iteration, tool: "validateProject", input: ".", result: validation });
          this.log(iteration, "validateProject", validation.success ? "success" : "error");
          emit({
            iteration,
            type: validation.success ? "tool-success" : "tool-error",
            tool: "validateProject",
            message: validation.success
              ? "Статический проект прошёл проверку."
              : `Найдены ошибки: ${validation.output.slice(0, 700)}`,
          });
          if (!validation.success) { transition("repair"); continue; }
        }

        const hasProjectChanges = previousResults.some((item) =>
          item.tool === "scaffoldProject" &&
          /React\/Vite scaffold created/i.test(item.result.output),
        ) || previousResults.some((item) =>
          (item.tool === "writeFile" || item.tool === "patchFile") && item.result.success,
        );
        const lastProjectChangeIndex = previousResults.reduce((lastIndex, item, index) => {
          if (
            item.tool === "scaffoldProject" ||
            item.tool === "writeFile" ||
            item.tool === "patchFile"
          ) return index;
          return lastIndex;
        }, -1);
        const lastSuccessfulBuildIndex = previousResults.reduce((lastIndex, item, index) => {
          if (item.tool === "runCommand" && item.input === "npm run build" && item.result.success) {
            return index;
          }
          return lastIndex;
        }, -1);
        const hasSuccessfulBuild = lastSuccessfulBuildIndex > lastProjectChangeIndex;
        if (hasProjectChanges && projectHasBuildScript(previousResults) && !hasSuccessfulBuild && availableTools.includes("runCommand")) {
          for (const command of ["npm install", "npm run build"]) {
            const alreadySuccessful = previousResults.some(
              (item) => item.tool === "runCommand" && item.input === command && item.result.success,
            );
            if (alreadySuccessful) continue;
            emit({
              iteration,
              type: "tool-start",
              tool: "runCommand",
              message: command === "npm install"
                ? "Финализирую приложение: устанавливаю зависимости."
                : "Финализирую приложение: выполняю production-сборку перед Preview.",
            });
            const result = await this.runtime.executeTool("runCommand", command, options?.signal);
            const step: AgentStep = { iteration, tool: "runCommand", input: command, success: result.success };
            steps.push(step);
            this.onStep?.(step);
            previousResults.push({ iteration, tool: "runCommand", input: command, result });
            this.log(iteration, `runCommand ${command}`, result.success ? "success" : "error");
            emit({
              iteration,
              type: result.success ? "tool-success" : "tool-error",
              tool: "runCommand",
              message: result.success
                ? (command === "npm install" ? "Зависимости установлены." : "Production-сборка завершена. Preview готов.")
                : `Не удалось выполнить «${command}»: ${result.output.slice(0, 500)}`,
            });
            if (!result.success) {
              emit({ iteration, type: "thinking", message: "Финальная проверка не прошла. Возвращаю ошибку модели для автоматического исправления." });
              break;
            }
          }

          const buildSucceeded = previousResults.some(
            (item) => item.tool === "runCommand" && item.input === "npm run build" && item.result.success,
          );
          if (!buildSucceeded) { transition("repair"); continue; }
        }

        const hasSuccessfulProjectTest = previousResults.some(
          (item) => item.tool === "testProject" && item.result.success,
        );
        if (builderTask && !hasSuccessfulProjectTest && availableTools.includes("testProject")) {
          emit({
            iteration,
            type: "tool-start",
            tool: "testProject",
            message: "Запускаю автоматический Tester Agent перед финальным self-review.",
          });
          const testResult = await this.runtime.executeTool("testProject", ".", options?.signal);
          const testStep: AgentStep = { iteration, tool: "testProject", input: ".", success: testResult.success };
          steps.push(testStep);
          this.onStep?.(testStep);
          previousResults.push({ iteration, tool: "testProject", input: ".", result: testResult });
          this.log(iteration, "testProject", testResult.success ? "success" : "error");
          emit({
            iteration,
            type: testResult.success ? "tool-success" : "tool-error",
            tool: "testProject",
            message: testResult.success
              ? "Автоматические проверки проекта пройдены."
              : `Tester Agent нашёл проблему: ${testResult.output.slice(0, 900)}`,
          });
          if (!testResult.success) { transition("repair"); continue; }
        }

        // Hard domain gate: never report success when the generated file content belongs to another industry.
        // This catches a planner that technically wrote files but reused an old template/domain.
        if (builderTask) {
          const latestWritesByPath = new Map<string, string>();
          for (const item of previousResults) {
            if ((item.tool !== "writeFile" && item.tool !== "patchFile") || !item.result.success) continue;
            try {
              const parsed = JSON.parse(item.input) as { path?: unknown; content?: unknown };
              if (typeof parsed.path === "string") {
                latestWritesByPath.set(parsed.path, item.input);
              } else {
                latestWritesByPath.set(`__write_${item.iteration}_${item.tool}`, item.input);
              }
            } catch {
              latestWritesByPath.set(`__write_${item.iteration}_${item.tool}`, item.input);
            }
          }
          const successfulWrites = [...latestWritesByPath.values()].join("\n");
          const taskLower = task.toLowerCase();
          const autoRequested = /авто|автомобил|автосервис|ремонт.*авто|ремонт.*машин|сто|диагностик|шиномонтаж|кузов|двигател|ходов|тормоз|масл|запчаст/.test(taskLower);
          const constructionRequested = /строит|строитель|демонтаж|фасад|подряд|отделк|стяжк|штукатур|монтаж|кровл|бетон/.test(taskLower);
          const contentLower = successfulWrites.toLowerCase();
          const hasAutoSignals = /авто|автомобил|автосервис|диагностик|шиномонтаж|двигател|ходов|тормоз|масл|запчаст|\bсто\b/.test(contentLower);
          const hasConstructionSignals = /строит|строитель|демонтаж|фасад|подряд|отделк|стяжк|штукатур|монтаж|кровл|бетон/.test(contentLower);
          const wrongDomain = (autoRequested && hasConstructionSignals && !hasAutoSignals)
            || (constructionRequested && hasAutoSignals && !hasConstructionSignals);
          if (wrongDomain) {
            const expectedDomain = autoRequested ? "автосервис/ремонт автомобилей" : "строительство/подряд";
            const wrongDomainName = autoRequested ? "строительство" : "автосервис";
            const message = `DOMAIN_MISMATCH: запрос пользователя относится к ${expectedDomain}, но созданный контент относится к ${wrongDomainName}. Нельзя завершать задачу. Перепиши/исправь содержимое файлов так, чтобы весь сайт соответствовал исходному запросу.`;
            previousResults.push({
              iteration,
              tool: "domainValidation",
              input: expectedDomain,
              result: { success: false, output: message },
            });
            emit({ iteration, type: "tool-error", tool: "Domain Validation", message });
            transition("repair");
            continue;
          }
          taskState.verified.domain = true;
          emit({ iteration, type: "tool-success", tool: "Domain Validation", message: "Тематика готового контента соответствует исходному запросу." });
        }

        setAgentState("VALIDATING", "agent.validation.started", "Проверяю результат перед completion gate.");
        markStepRunning("validate");
        if (builderTask && productPlan && this.runtime.reviewProduct && productReviewAttempts < MAX_PRODUCT_REVIEW_CALLS) {
          productReviewAttempts += 1;
          if (++modelTurns > MAX_MODEL_TURNS) throw new Error("Agent model-turn limit reached");
          emit({ iteration, type: "thinking", message: "Запускаю финальный self-review: сверяю реализацию с Product Plan и ищу недостающие функции." });
          const aiOptions = aiOptionsForTask(options, "reviewer");
          if (!aiOptions) throw new Error("Task AI token budget exhausted");
            const review = await this.runtime.reviewProduct(task, compactAgentHistory(previousResults), productPlan, aiOptions as AgentModelOptions);
          if (!review.passed) {
            const feedback = [
              "Final self-review failed.",
              review.missing.length ? `Missing: ${review.missing.join("; ")}` : "",
              review.risks.length ? `Risks: ${review.risks.join("; ")}` : "",
            ].filter(Boolean).join("\n");
            const reviewResult = { success: false, output: feedback };
            previousResults.push({ iteration, tool: "productReview", input: "final", result: reviewResult });
            emit({ iteration, type: "tool-error", name: "agent.validation.failed", tool: "productReview", message: feedback.slice(0, 1200) });
            executionSnapshot.repairAttempts += 1;
            if (executionSnapshot.repairAttempts > MAX_REPAIR_ATTEMPTS) {
              setAgentState("FAILED", "agent.failed", "Bounded repair limit reached after product validation.");
              return { phase, success: false, iterations: iteration, steps, productPlan: productPlan ?? undefined, intent, executionPlan: executionSnapshot.plan, finalState: "FAILED", error: "Bounded repair limit reached after validation.", errorInfo: { code: "VALIDATION_ERROR", message: "Product validation remained unsatisfied within the repair budget.", retryable: false, repairable: false, fatal: false, category: "validation", summary: "REPAIR_LIMIT", recoveryStrategy: "Stop after the bounded repair budget." } };
            }
            markStepRunning("repair");
            transition("repair");
            continue;
          }
          previousResults.push({ iteration, tool: "productReview", input: "final", result: { success: true, output: "Product review passed." } });
          emit({ iteration, type: "tool-success", tool: "productReview", message: "Self-review пройден: реализация соответствует плану." });
        }

        syncVerificationState(taskState, previousResults, productPlan);
        let finishReason: string | undefined;
        let gatePassed = !agentFailureInjection.consumeFailure("VALIDATION_FAILURE");
        if (!gatePassed) finishReason = "Injected validation failure.";
        if (builderTask) {
          const finishCheck = canFinishBuilder(
            taskState,
            previousResults,
            projectHasBuildScript(previousResults),
            hasStaticProject,
            availableTools.includes("testProject"),
          );
          finishReason = finishCheck.reason;
          gatePassed = finishCheck.ok;
          if (!finishCheck.ok) {
            emit({
              iteration,
              type: "thinking",
              message: "Финальный gate не разрешил завершение: " + finishCheck.reason + " Возвращаю задачу в исполнение.",
            });
            transition(/build|сборк/i.test(finishCheck.reason ?? "") ? "validate" : "repair");
            continue;
          }
        }

        let runtimeValidationPassed = true;
        let runtimeValidationEvidence = "Runtime validation not required for this task.";
        if (builderTask && this.runtime.validateRuntime) {
          const runtimeCheck = await this.runtime.validateRuntime(options?.signal);
          runtimeValidationPassed = runtimeCheck.success;
          runtimeValidationEvidence = runtimeCheck.output.slice(0, 1600);
          previousResults.push({ iteration, tool: "runtimeValidation", input: ".", result: runtimeCheck, observedAt: Date.now() });
          addObservation("runtimeValidation: " + runtimeCheck.output);
        }
        const lastObserved = previousResults.filter((item) => item.tool !== "runtimeValidation").slice(-1)[0];
        const hasExecuted = Boolean(lastObserved);
        const lastActionPassed = Boolean(lastObserved?.result.success);
        const reviewPassed = !productPlan || !builderTask || previousResults.some(
          (item) => item.tool === "productReview" && item.result.success,
        );
        const noCriticalErrors = !previousResults.some(
          (item) => !item.result.success && /permission|security|fatal|credential|secret/i.test(item.result.output),
        );
        const completionGate = evaluateCompletionGate({
          hasPlan: executionSnapshot.plan.steps.some((step) => step.status === "COMPLETED" && ["plan", "execute", "observe", "validate", "verify"].includes(step.id)),
          hasExecuted,
          validationPassed: gatePassed && lastActionPassed && runtimeValidationPassed,
          acceptanceCriteriaSatisfied: reviewPassed,
          noCriticalErrors,
          projectStateConsistent: lastActionPassed,
        });
        if (!completionGate.ok) {
          gatePassed = false;
          finishReason = completionGate.reasons.join("; ");
        }
        const validationChecks = [
          { name: "tool execution", passed: hasExecuted, evidence: `toolCalls=${previousResults.length}` },
          { name: "last action", passed: lastActionPassed, evidence: lastObserved ? `${lastObserved.tool}: ${lastObserved.result.success ? "success" : "failure"}` : "no action" },
          { name: "build", passed: !builderTask || !projectHasBuildScript(previousResults) || previousResults.some((item) => item.tool === "runCommand" && item.input === "npm run build" && item.result.success), evidence: "latest build must pass after changes" },
          { name: "runtime", passed: runtimeValidationPassed, evidence: runtimeValidationEvidence },
          { name: "tests", passed: !builderTask || !availableTools.includes("testProject") || previousResults.some((item) => item.tool === "testProject" && item.result.success), evidence: "applicable project smoke checks" },
          { name: "project/domain", passed: !builderTask || taskState.verified.domain, evidence: taskState.verified.domain ? "domain verified" : "domain not verified" },
          { name: "acceptance criteria", passed: reviewPassed, evidence: reviewPassed ? "criteria verified" : "product review evidence missing" },
          { name: "completion gate", passed: gatePassed, evidence: finishReason ?? "gate passed" },
        ];
        const finalValidation = createValidation(validationChecks, gatePassed ? [] : [finishReason ?? "Completion gate failed."]);
        markStepCompletedLocal("validate", JSON.stringify(finalValidation));
        if (!finalValidation.passed || !hasExecuted || !lastActionPassed) {
          emit({ iteration, type: "tool-error", name: "agent.validation.failed", message: "Completion blocked: validation did not pass." });
          executionSnapshot.repairAttempts += 1;
          if (executionSnapshot.repairAttempts > MAX_REPAIR_ATTEMPTS) {
            setAgentState("FAILED", "agent.failed", "Bounded repair limit reached after validation.");
            return { phase, success: false, iterations: iteration, steps, productPlan: productPlan ?? undefined, intent, executionPlan: executionSnapshot.plan, finalState: "FAILED", error: "Bounded repair limit reached after validation.", errorInfo: { code: "VALIDATION_ERROR", message: "Validation did not pass within the repair budget.", retryable: false, repairable: false, fatal: false, category: "validation", summary: "REPAIR_LIMIT", recoveryStrategy: "Stop after the bounded repair budget." } };
          }
          setAgentState("REPAIRING", "agent.repair.started", "Validation failed; bounded repair required.");
          markStepRunning("repair");
          transition("repair");
          continue;
        }
        setAgentState("VERIFYING", "agent.verification.started", "Acceptance criteria and final project state verified.");
        const repairStep = executionSnapshot.plan.steps.find((step) => step.id === "repair");
        if (repairStep?.status === "PENDING") markPlanStepSkipped(executionSnapshot.plan, "repair", "No repair required after validation.");
        if (repairStep?.status === "RUNNING") markStepCompletedLocal("repair", "Repair cycle resolved after revalidation.");
        markStepRunning("verify");
        markStepCompletedLocal("verify", "Verification passed.");
        markStepCompletedLocal("complete", "Completion gate passed.");
        transition("finish");
        markStepCompletedLocal("complete", "Agent completed after validation and verification.");
        emit({ iteration, type: "completed", name: "agent.completed", message: "Финальный completion gate пройден. Проект действительно реализован и проверен." });
        const finalResponse = plan.finalResponse ?? await this.finalResponse(task, previousResults, aiOptionsForTask(options, "finalizer"));
        const completedSteps = executionSnapshot.plan.steps.filter((step) => step.status === "COMPLETED").map((step) => step.id);
        const changedFiles = [...taskState.changedFiles].slice(-20);
        const summary: AgentResultSummary = {
          status: "COMPLETED",
          summary: "Execution completed after validation and verification.",
          changedFiles,
          completedSteps,
          warnings: finalValidation.checks.filter((check) => !check.passed).map((check) => check.name),
          errors: [],
        };
        options?.signal?.removeEventListener("abort", onAbort);
        return {
          success: true,
          iterations: iteration - 1,
          steps,
          productPlan: productPlan ?? undefined,
          phase: "finish",
          intent,
          executionPlan: executionSnapshot.plan,
          validation: finalValidation,
          telemetry: createTelemetry(executionSnapshot.startedAt, modelTurns, steps.length, steps.length, executionSnapshot.repairAttempts, options?.provider, options?.model),
          finalState: "COMPLETED",
          summary,
          finalResponse,
        };

      }

      if (!availableTools.includes((plan as AgentPlan).tool)) {
        const error = `Agent stopped: unavailable tool (${(plan as AgentPlan).tool})`;
        this.log(iteration, (plan as AgentPlan).tool, "error");
        const normalizedError = toNexumError(error, "TOOL_ERROR", "Инструмент агента завершился с ошибкой.");
        emit({ iteration, type: "failed", tool: (plan as AgentPlan).tool, message: normalizedError.userSafeMessage, errorCode: normalizedError.code, retryable: normalizedError.retryable });
        return { phase, success: false, iterations: iteration - 1, steps, productPlan: productPlan ?? undefined, error };
      }

      const actionKey = `${(plan as AgentPlan).tool}:${(plan as AgentPlan).input}`;
      const previousSuccess = previousResults.some(
        (item) => item.tool === (plan as AgentPlan).tool && item.input === (plan as AgentPlan).input && item.result.success,
      );
      if (previousSuccess) {
        const inspectionTool = (plan as AgentPlan).tool === "searchFiles" || (plan as AgentPlan).tool === "listFiles" || (plan as AgentPlan).tool === "readFile";
        if (builderTask && inspectionTool) {
          // Never let a Builder die because the model repeated an inspection call.
          // First exhaust concrete entry files from the latest project listing.
          const latestListing = [...previousResults]
            .reverse()
            .find((item) => item.tool === "listFiles" && item.result.success)?.result.output ?? "";
          const candidates = [
            "src/App.tsx",
            "src/App.jsx",
            "src/main.tsx",
            "src/main.jsx",
            "src/App.css",
            "src/styles.css",
            "style.css",
            "index.html",
            "package.json",
          ];
          const unread = candidates.find((candidate) =>
            latestListing.includes(candidate) &&
            !previousResults.some((item) => item.tool === "readFile" && item.input === candidate && item.result.success),
          );
          if (unread && availableTools.includes("readFile")) {
            const currentTool = plan.tool;
            plan = { tool: "readFile", input: unread };
            emit({
              iteration,
              type: "thinking",
              message: "Повторная инспекция " + currentTool + " обнаружена. Читаю следующий реальный файл: " + unread + ".",
            });
          } else {
            const recoveryPlan = this.runtime.plan(task, previousResults);
            const recoveryKey = recoveryPlan && !recoveryPlan.done
              ? this.actionFingerprint(recoveryPlan.tool, recoveryPlan.input)
              : "";
            const currentKey = this.actionFingerprint(plan.tool, plan.input);
            if (recoveryPlan && !recoveryPlan.done && recoveryKey !== currentKey) {
              const nextTool = recoveryPlan.tool;
              plan = recoveryPlan;
              emit({
                iteration,
                type: "thinking",
                message: "Повторная инспекция обнаружена. Перехожу к следующему действию Builder: " + nextTool + ".",
              });
            } else {
              const error = "Agent stopped: repeated successful action detected (" + plan.tool + ")";
              this.log(iteration, plan.tool, "error");
              const normalizedError = toNexumError(error, "TOOL_ERROR", "Инструмент агента завершился с ошибкой.");
          emit({ iteration, type: "failed", tool: plan.tool, message: normalizedError.userSafeMessage, errorCode: normalizedError.code, retryable: normalizedError.retryable });
              return { phase, success: false, iterations: iteration - 1, steps, productPlan: productPlan ?? undefined, error };
            }
          }
        } else {
          const error = "Agent stopped: repeated successful action detected (" + plan.tool + ")";
          this.log(iteration, plan.tool, "error");
          emit({ iteration, type: "failed", tool: plan.tool, message: error });
          return { phase, success: false, iterations: iteration - 1, steps, productPlan: productPlan ?? undefined, error };
        }
      }
      seenActions.add(actionKey);

      setAgentState("EXECUTING", "agent.tool.started", this.describeToolStart(plan.tool, plan.input));
      markStepRunning("execute");
      emit({ iteration, type: "tool-start", name: "agent.tool.started", tool: plan.tool, message: this.describeToolStart(plan.tool, plan.input) });
      const fingerprint = this.actionFingerprint(plan.tool, plan.input);
      const attemptCount = (actionAttempts.get(fingerprint) ?? 0) + 1;
      actionAttempts.set(fingerprint, attemptCount);
      seenActions.add(fingerprint);
      actionSequence.push(fingerprint);
      if (actionSequence.length > 8) actionSequence.shift();
      const toolStartedAt = Date.now();
      throwIfAborted(options?.signal);
      let result: AgentToolResult["result"];
      try {
        if (agentFailureInjection.consumeFailure("TOOL_FAILURE")) throw new Error("Injected tool failure");
        result = await this.runtime.executeTool(plan.tool, plan.input, options?.signal);
      } catch (error) {
        if (isAbortError(error) || options?.signal?.aborted) throw new DOMException("Agent task cancelled", "AbortError");
        const normalized = toNexumError(error, "TOOL_ERROR", "Инструмент агента завершился с ошибкой.");
        result = { success: false, output: normalized.userSafeMessage };
      }
      if (options?.signal?.aborted) throw new DOMException("Agent task cancelled", "AbortError");
      const toolDurationMs = Date.now() - toolStartedAt;
      const sequenceLength = actionSequence.length;
      const alternatingFailure = sequenceLength >= 4
        && actionSequence[sequenceLength - 1] === actionSequence[sequenceLength - 3]
        && actionSequence[sequenceLength - 2] === actionSequence[sequenceLength - 4]
        && actionSequence[sequenceLength - 1] !== actionSequence[sequenceLength - 2]
        && !result.success;
      const actionPlanStepId = `action-${iteration}-${crypto.randomUUID().slice(0, 8)}`;
      const lastActionStep = [...executionSnapshot.plan.steps].reverse().find((item) => item.id.startsWith("action-") && item.status === "COMPLETED");
      executionSnapshot.plan.steps.push({
        id: actionPlanStepId,
        description: this.describeToolStart(plan.tool, plan.input),
        tool: plan.tool,
        input: plan.input,
        dependencies: lastActionStep ? [lastActionStep.id] : [],
        status: "READY",
        attempts: 0,
      });
      executionSnapshot.plan.currentStepId = actionPlanStepId;
      (plan as AgentPlan).planStepId = actionPlanStepId;
      if (canRunPlanStep(executionSnapshot.plan, actionPlanStepId)) {
        setPlanStep(executionSnapshot.plan, actionPlanStepId, "RUNNING");
      }
      const step: AgentStep = {
        iteration,
        tool: plan.tool,
        input: plan.input,
        success: result.success,
        toolCallId: crypto.randomUUID(),
        durationMs: toolDurationMs,
        planStepId: actionPlanStepId,
      };
      steps.push(step);
      this.onStep?.(step);
      result = {
        ...result,
        toolCallId: step.toolCallId,
        toolName: plan.tool,
        metadata: {
          ...(result.metadata ?? {}),
          projectId: this.journalContext?.projectId,
          taskId: this.journalContext?.taskId,
          agentJobId: this.journalContext?.agentRunId,
          durationMs: toolDurationMs,
          ...(typeof (result as { exitCode?: unknown }).exitCode === "number" ? { exitCode: (result as { exitCode: number }).exitCode } : {}),
        },
      };
      if (!result.success) {
        const diagnosis = diagnoseError(result.output);
        result.error = {
          code: diagnosis.category === "network" ? "NETWORK_ERROR" : diagnosis.category === "permission" ? "PERMISSION_ERROR" : diagnosis.category === "validation" ? "VALIDATION_ERROR" : "TOOL_ERROR",
          message: result.output.slice(0, 2000),
          retryable: diagnosis.priority >= 3,
          repairable: diagnosis.priority <= 2,
          fatal: diagnosis.priority === 1 && diagnosis.category === "permission",
        };
      }
      previousResults.push({ iteration, tool: plan.tool, input: plan.input, result, toolCallId: step.toolCallId, observedAt: Date.now() });
      if (result.success) markPlanStepCompleted(executionSnapshot.plan, actionPlanStepId, result.output);
      else setPlanStep(executionSnapshot.plan, actionPlanStepId, "FAILED", result.output);
      setAgentState("OBSERVING", "agent.observation.created", `Observed ${plan.tool}: ${result.success ? "success" : "failure"}.`);
      if (alternatingFailure) {
        setAgentState("FAILED", "agent.failed", "LOOP_DETECTED: repeating alternating failing actions.");
        emit({ iteration, type: "failed", name: "agent.failed", tool: plan.tool, message: "LOOP_DETECTED: alternating failing tool actions detected." });
        return { phase, success: false, iterations: iteration, steps, productPlan: productPlan ?? undefined, intent, executionPlan: executionSnapshot.plan, finalState: "FAILED", error: "LOOP_DETECTED", errorInfo: { code: "TOOL_ERROR", message: "Alternating failing tool actions detected.", retryable: false, repairable: false, fatal: false, category: "loop", summary: "LOOP_DETECTED", recoveryStrategy: "Stop repeated actions and require a new plan." } };
      }
      markPlanStepCompleted(executionSnapshot.plan, "execute", `${plan.tool}: ${result.success ? "success" : "failure"}`);
      markPlanStepCompleted(executionSnapshot.plan, "observe", result.output);
      if (!executionSnapshot.completedStepIds.includes("execute")) executionSnapshot.completedStepIds.push("execute");
      if (!executionSnapshot.completedStepIds.includes("observe")) executionSnapshot.completedStepIds.push("observe");
      publishExecution();
      addObservation(`${plan.tool}: ${result.output}`);
      const runtimeRoot = this.runtime instanceof Object && "projectRoot" in this.runtime ? (this.runtime as { projectRoot?: string }).projectRoot : undefined;
      if (runtimeRoot) {
        const errorInfo = result.success ? undefined : diagnoseError(result.output);
        void recordAction(runtimeRoot, {
          timestamp: new Date().toISOString(),
          requestId: this.journalContext?.requestId,
          agentRunId: this.journalContext?.agentRunId,
          projectId: this.journalContext?.projectId,
          provider: this.journalContext?.provider,
          model: this.journalContext?.model,
          iteration,
          phase,
          tool: plan.tool,
          input: plan.input,
          success: result.success,
          status: result.success ? "success" : "error",
          durationMs: toolDurationMs,
          errorCode: result.success ? undefined : "TOOL_ERROR",
          retryable: result.success ? undefined : Boolean(errorInfo && errorInfo.priority >= 3),
          output: result.output,
        }).catch(() => undefined);
      }
      if (result.success && (plan.tool === "writeFile" || plan.tool === "patchFile")) recordSuccessfulChange(taskState, plan.input);
      if (result.success && executionSnapshot.plan.steps.find((step) => step.id === "repair")?.status === "RUNNING") {
        markStepCompletedLocal("repair", "Repair action completed; continuing with validation.");
        emit({ iteration, type: "thinking", name: "agent.repair.completed", phase: "repair", message: "Исправление выполнено; возвращаю результат на validation." });
      }
      syncVerificationState(taskState, previousResults, productPlan);

      // Validate the domain immediately after every implementation write so a
      // premature done=true cannot bypass the intent lock.
      if (result.success && builderTask && (plan.tool === "writeFile" || plan.tool === "patchFile")) {
        const taskLower = task.toLowerCase();
        const writeLower = plan.input.toLowerCase();
        const autoRequested = /авто|автомобил|автосервис|ремонт.*авто|ремонт.*машин|диагностик|шиномонтаж|кузов|двигател|ходов|тормоз|масл|запчаст/.test(taskLower);
        const constructionRequested = /строит|строитель|демонтаж|фасад|подряд|отделк|стяжк|штукатур|монтаж|кровл|бетон/.test(taskLower);
        const hasAutoSignals = /авто|автомобил|автосервис|диагностик|шиномонтаж|двигател|ходов|тормоз|масл|запчаст|\bсто\b/.test(writeLower);
        const hasConstructionSignals = /строит|строитель|демонтаж|фасад|подряд|отделк|стяжк|штукатур|монтаж|кровл|бетон/.test(writeLower);
        const wrongDomain = (autoRequested && hasConstructionSignals && !hasAutoSignals)
          || (constructionRequested && hasAutoSignals && !hasConstructionSignals);
        if (wrongDomain) {
          const message = `DOMAIN_MISMATCH: implementation content does not match the requested domain. Expected ${autoRequested ? "auto repair" : "construction"}.`;
          previousResults.push({
            iteration,
            tool: "domainValidation",
            input: autoRequested ? "auto repair" : "construction",
            result: { success: false, output: message },
          });
          emit({ iteration, type: "tool-error", tool: "Domain Validation", message });
          transition("repair");
          continue;
        }
      }

      this.log(iteration, plan.tool, result.success ? "success" : "error");
      emit({
        iteration,
        type: result.success ? "tool-success" : "tool-error",
        name: "agent.tool.completed",
        tool: plan.tool,
        message: result.success ? this.describeToolSuccess(plan.tool, result.output) : this.describeToolError(plan.tool, result.output),
      });
      if (!result.success) {
        executionSnapshot.repairAttempts += 1;
        if (attemptCount >= 3 || executionSnapshot.repairAttempts > MAX_REPAIR_ATTEMPTS) {
          setAgentState("FAILED", "agent.failed", "Bounded repair/loop limit reached.");
          options?.signal?.removeEventListener("abort", onAbort);
          return { phase, success: false, iterations: iteration, steps, productPlan: productPlan ?? undefined, intent, executionPlan: executionSnapshot.plan, finalState: "FAILED", error: "Bounded repair/loop limit reached.", errorInfo: { code: "TOOL_ERROR", message: "Repeated failing tool action detected.", retryable: false, category: "loop", summary: "LOOP_DETECTED", recoveryStrategy: "Choose a new action instead of repeating the same failing tool call." } };
        }
        markStepRunning("repair");
        transition("repair");
        emit({ iteration, type: "thinking", name: "agent.repair.started", phase: "repair", message: "Ошибка исполнения обнаружена; запускаю bounded repair path." });
        const diagnosis = diagnoseError(result.output);
        emit({
          iteration,
          type: "thinking",
          tool: "Error Recovery",
          message: `Ошибка классифицирована как ${diagnosis.category} (приоритет ${diagnosis.priority}/4): ${diagnosis.summary}. ${diagnosis.strategy}`,
        });
      }

      // A scaffold is only the baseline. Once the agent writes the requested
      // implementation, immediately rebuild so Preview always reflects the
      // latest generated files rather than the pre-implementation scaffold.
      if (
        result.success &&
        plan.tool === "writeFile" &&
        previousResults.some((item) => item.tool === "scaffoldProject" && item.result.success) &&
        availableTools.includes("runCommand")
      ) {
        const packageChanged = /"path"\s*:\s*"package\.json"/i.test(plan.input);
        const commands = projectHasBuildScript(previousResults)
          ? (packageChanged ? ["npm install", "npm run build"] : ["npm run build"])
          : (packageChanged ? ["npm install"] : []);
        for (const command of commands) {
          const commandResult = await this.runtime.executeTool("runCommand", command, options?.signal);          const commandStep: AgentStep = { iteration, tool: "runCommand", input: command, success: commandResult.success };
          steps.push(commandStep);
          this.onStep?.(commandStep);
          previousResults.push({ iteration, tool: "runCommand", input: command, result: commandResult });
          this.log(iteration, `runCommand ${command}`, commandResult.success ? "success" : "error");
          emit({
            iteration,
            type: commandResult.success ? "tool-success" : "tool-error",
            tool: "runCommand",
            message: commandResult.success
              ? (command === "npm install" ? "Зависимости обновлены." : "Preview пересобран после изменения файла.")
              : `Не удалось пересобрать Preview: ${commandResult.output.slice(0, 400)}`,
          });
          if (!commandResult.success) break;
        }
      }

      // A React/Vite scaffold is not usable in Preview until its production
      // bundle exists. Build it automatically instead of leaving that step
      // to the user or the model's next planning iteration.
      if (result.success && plan.tool === "scaffoldProject" && /React\/Vite scaffold created/i.test(result.output)) {
        for (const command of ["npm install", "npm run build"]) {
          if (!availableTools.includes("runCommand")) {
            const error = "React/Vite project was created, but runCommand is unavailable to install dependencies and build it.";
            const normalizedError = toNexumError(error, "BUILD_ERROR", "Команда проекта завершилась с ошибкой.");
      emit({ iteration, type: "failed", tool: "runCommand", message: normalizedError.userSafeMessage, errorCode: normalizedError.code, retryable: normalizedError.retryable });
            return { phase, success: false, iterations: iteration, steps, error };
          }
          const commandKey = `runCommand:${command}`;
          const previousCommandSuccess = previousResults.some(
            (item) => item.tool === "runCommand" && item.input === command && item.result.success,
          );
          if (previousCommandSuccess) {
            continue;
          }
          seenActions.add(commandKey);
          emit({ iteration, type: "tool-start", tool: "runCommand", message: command === "npm install" ? "Устанавливаю зависимости созданного React-приложения." : "Собираю production-версию для Preview." });
          const buildResult = await this.runtime.executeTool("runCommand", command, options?.signal);
          const buildStep: AgentStep = { iteration, tool: "runCommand", input: command, success: buildResult.success };
          steps.push(buildStep);
          this.onStep?.(buildStep);
          previousResults.push({ iteration, tool: "runCommand", input: command, result: buildResult });
          this.log(iteration, `runCommand ${command}`, buildResult.success ? "success" : "error");
          emit({
            iteration,
            type: buildResult.success ? "tool-success" : "tool-error",
            tool: "runCommand",
            message: buildResult.success
              ? (command === "npm install" ? "Зависимости установлены." : "Production-сборка завершена. Preview готов к открытию.")
              : `Не удалось выполнить «${command}»: ${buildResult.output.slice(0, 400)}`,
          });
          if (!buildResult.success) {
            emit({
              iteration,
              type: "thinking",
              message: `Сборка не прошла на шаге «${command}». Передаю ошибку планировщику для исправления.`,
            });
            break;
          }
        }
      }

      if (!result.success) {
        // Give the planner a chance to inspect the failure and choose a corrected action.
        // This is important for model-generated paths/commands: one bad tool input must
        // not terminate the entire build session immediately.
        continue;
      }
    }

    const lastFailure = [...previousResults].reverse().find((item) => !item.result.success);
    const error = lastFailure
      ? `Tool ${lastFailure.tool} failed after recovery attempts: ${lastFailure.result.output}`
      : `Agent stopped: maximum iterations reached (${this.maxIterations})`;
    const diagnosis = diagnoseError(lastFailure?.result.output ?? error);
    const code: AgentErrorInfo["code"] =
      diagnosis.category === "typescript" || diagnosis.category === "syntax" || diagnosis.category === "build" ? "BUILD_ERROR" :
      diagnosis.category === "runtime" ? "RUNTIME_ERROR" :
      diagnosis.category === "dependency" ? "CONFIG_ERROR" :
      diagnosis.category === "path" || diagnosis.category === "tool" ? "TOOL_ERROR" :
      "INTERNAL_ERROR";
    const errorInfo: AgentErrorInfo = {
      code,
      message: diagnosis.summary,
      retryable: diagnosis.priority >= 3,
      category: diagnosis.category,
      summary: diagnosis.summary,
      recoveryStrategy: diagnosis.strategy,
    };
    this.log(this.maxIterations, "loop", "error");
    emit({ iteration: this.maxIterations, type: "failed", message: diagnosis.summary });
    return { phase, success: false, iterations: this.maxIterations, steps, productPlan: productPlan ?? undefined, error, errorInfo };
  }

  private async finalResponse(
    task: string,
    results: AgentToolResult[],
    options?: GatewayGenerateOptions,
  ): Promise<string> {
    if (results.length === 0) {
      try {
        if (!options) return "NEXUM завершил выполнение без дополнительного AI-ответа: лимит токенов задачи исчерпан.";
        return await this.gateway.generate(task, options);
      } catch (error) {
        if (isAbortError(error) || options?.signal?.aborted) throw new DOMException("Agent task cancelled", "AbortError");
        const detail = error instanceof Error ? error.message : "AI response generation failed";
        return `NEXUM завершил выполнение, но финальный ответ AI недоступен: ${detail}. Проверьте Preview и AI Activity.`;
      }
    }

    const builderTask = /создай|сделай|разработай|build|create|make|сайт|приложени|лендинг|dashboard|landing|web app|website|marketplace|crm|поменяй|измени|добавь|удали|исправь/i.test(task);
    if (builderTask) {
      const writes = results.filter((item) => (item.tool === "writeFile" || item.tool === "patchFile") && item.result.success).length;
      const builds = results.filter((item) => (item.tool === "runCommand" || item.tool === "runSandbox") && /npm run build/.test(item.input) && item.result.success).length;
      const changedFiles = results
        .filter((item) => (item.tool === "writeFile" || item.tool === "patchFile") && item.result.success)
        .map((item) => {
          try {
            const parsed = JSON.parse(item.input);
            return typeof parsed.path === "string" ? parsed.path : "";
          } catch {
            return "";
          }
        })
        .filter(Boolean)
        .slice(-6);
      return `Готово. Проект реально изменён. Файлов изменено: ${writes}.${changedFiles.length ? ` Изменения: ${changedFiles.join(", ")}.` : ""} Production-сборка: ${builds > 0 ? "проверена" : "не запускалась"}. Откройте Preview и AI Activity.`;
    }

    const summary = compactAgentHistory(results)
      .map((item) => {
        if (item.tool === "readFile") return "readFile: file content inspected successfully";
        return `${item.tool}: ${item.result.output}`;
      })
      .join("\n");
    try {
      if (!options) return "Задача выполнена. Дополнительный финальный AI-ответ отключён: лимит токенов задачи исчерпан.";
      return await this.gateway.generate(`Задача выполнена: ${task}\nРезультаты инструментов:\n${summary}`, options);
    } catch (error) {
        if (isAbortError(error) || options?.signal?.aborted) throw new DOMException("Agent task cancelled", "AbortError");
      const detail = error instanceof Error ? error.message : "AI response generation failed";
      return `Задача выполнена, но финальный ответ AI недоступен: ${detail}. Откройте Preview и вкладку AI Activity для проверки результата.`;
    }
  }

  private describeToolStart(tool: string, input: string): string {
    const labels: Record<string, string> = {
      listFiles: "Смотрю структуру проекта.",
      readFile: "Читаю нужный файл и проверяю текущую реализацию.",
      writeFile: "Изменяю файл по задаче.",
      scaffoldProject: "Создаю базовую структуру приложения.",
      searchFiles: "Ищу связанные файлы и места использования.",
      runCommand: "Запускаю проверочную команду.",
      runSandbox: "Запускаю сборку или тест в изолированной среде.",
      git: "Проверяю состояние Git.",
      github: "Получаю данные из GitHub.",
    };
    const detail = input.length < 120 ? ` (${input})` : "";
    return (labels[tool] ?? `Выполняю действие: ${tool}.`) + detail;
  }

  private describeToolSuccess(tool: string, output: string): string {
    const tail = output.replace(/\s+/g, " ").trim().slice(0, 180);
    const labels: Record<string, string> = {
      listFiles: "Структура проекта получена.",
      readFile: "Файл прочитан.",
      writeFile: "Файл изменён.",
      scaffoldProject: "Структура приложения создана.",
      searchFiles: "Поиск завершён.",
      runCommand: "Команда завершилась успешно.",
      runSandbox: "Проверка завершилась успешно.",
      git: "Состояние Git получено.",
      github: "Данные GitHub получены.",
    };
    return tail ? `${labels[tool] ?? "Действие завершено."} ${tail}` : (labels[tool] ?? "Действие завершено.");
  }

  private describeToolError(tool: string, output: string): string {
    const detail = output.replace(/\s+/g, " ").trim().slice(0, 260);
    return `${tool} завершился с ошибкой. Анализирую проблему и попробую исправить её. ${detail}`.trim();
  }

  private actionFingerprint(tool: string, input: string): string {
    const normalized = input.replace(/\s+/g, " ").replace(/\b\d{10,}\b/g, "<id>").trim().slice(0, MAX_ACTION_FINGERPRINT_LENGTH);
    return `${tool}:${normalized}`;
  }

  private log(iteration: number, tool: string, status: "success" | "error"): void {
    console.log(JSON.stringify({ iteration, tool, status }));
  }
}