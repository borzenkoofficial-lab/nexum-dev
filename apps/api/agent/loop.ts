import type { AIGateway } from "../ai/gateway.js";
import type { GatewayGenerateOptions } from "../ai/gateway.js";
import type {
  AgentModelOptions,
  AgentPlan,
  AgentLoopResult,
  AgentRuntime,
  AgentStep,
  AgentToolResult,
} from "./types.js";

const DEFAULT_MAX_ITERATIONS = 10;
const MAX_RESULT_LENGTH = 8_000;

export interface AgentEvent {
  id: number;
  timestamp: number;
  iteration: number;
  type: "thinking" | "tool-start" | "tool-success" | "tool-error" | "completed" | "failed";
  tool?: string;
  message: string;
}

export class AgentLoop {
  constructor(
    private readonly runtime: AgentRuntime,
    private readonly gateway: AIGateway,
    private readonly maxIterations = DEFAULT_MAX_ITERATIONS,
    private readonly onStep?: (step: AgentStep) => void,
    private readonly onEvent?: (event: AgentEvent) => void,
  ) {}

  async run(task: string, options?: GatewayGenerateOptions): Promise<AgentLoopResult> {
    const steps: AgentStep[] = [];
    const previousResults: AgentToolResult[] = [];
    const seenActions = new Set<string>();
    let eventId = 0;
    const emit = (event: Omit<AgentEvent, "id" | "timestamp">) => {
      this.onEvent?.({ ...event, id: ++eventId, timestamp: Date.now() });
    };
    emit({ iteration: 0, type: "thinking", message: "Принял запрос. Анализирую проект и выбираю следующий шаг." });

    for (let iteration = 1; iteration <= this.maxIterations; iteration += 1) {
      const availableTools = this.runtime.getAvailableTools();
      emit({ iteration, type: "thinking", message: `Шаг ${iteration}: анализирую состояние проекта и результаты предыдущего действия.` });
      let modelPlan: AgentPlan | null = null;
      if (this.runtime.planWithAI) {
        try {
          modelPlan = await this.runtime.planWithAI(task, previousResults, options as AgentModelOptions);
        } catch (error) {
          const message = error instanceof Error ? error.message : "AI planning failed";
          this.log(iteration, "AI planner", "error");
          emit({ iteration, type: "failed", tool: "AI planner", message: `Не удалось получить следующий шаг от модели: ${message}` });
          return { success: false, iterations: iteration - 1, steps, error: message };
        }
      }
      // Prefer the model plan when available; otherwise use the deterministic runtime planner.
      const plan = modelPlan ?? this.runtime.plan(task, previousResults);

      if (!plan) {
        emit({ iteration, type: "completed", message: "Дополнительных действий не требуется. Формирую итог." });
        return {
          success: true,
          iterations: iteration - 1,
          steps,
          finalResponse: await this.finalResponse(task, previousResults, options),
        };
      }

      if (plan.done) {
        const lastFailure = [...previousResults].reverse().find((item) => !item.result.success);
        if (lastFailure) {
          return {
            success: false,
            iterations: iteration - 1,
            steps,
            error: `Tool ${lastFailure.tool} failed: ${lastFailure.result.output}`,
          };
        }

        emit({ iteration, type: "completed", message: "Все запланированные действия выполнены. Формирую итог и обновляю результат." });
        return {
          success: true,
          iterations: iteration - 1,
          steps,
          finalResponse: plan.finalResponse ?? await this.finalResponse(task, previousResults, options),
        };
      }

      if (!availableTools.includes(plan.tool)) {
        const error = `Agent stopped: unavailable tool (${plan.tool})`;
        this.log(iteration, plan.tool, "error");
        emit({ iteration, type: "failed", tool: plan.tool, message: error });
        return { success: false, iterations: iteration - 1, steps, error };
      }

      const actionKey = `${plan.tool}:${plan.input}`;
      if (seenActions.has(actionKey)) {
        const lastFailure = [...previousResults].reverse().find((item) => !item.result.success);
        const error = lastFailure
          ? `Tool ${lastFailure.tool} failed: ${lastFailure.result.output}`
          : `Agent stopped: repeated action detected (${plan.tool})`;
        this.log(iteration, plan.tool, "error");
        emit({ iteration, type: "failed", tool: plan.tool, message: error });
        return { success: false, iterations: iteration - 1, steps, error };
      }
      seenActions.add(actionKey);

      emit({ iteration, type: "tool-start", tool: plan.tool, message: this.describeToolStart(plan.tool, plan.input) });
      const result = await this.runtime.executeTool(plan.tool, plan.input);
      const step: AgentStep = {
        iteration,
        tool: plan.tool,
        input: plan.input,
        success: result.success,
      };
      steps.push(step);
      this.onStep?.(step);
      previousResults.push({ iteration, tool: plan.tool, input: plan.input, result });
      this.log(iteration, plan.tool, result.success ? "success" : "error");
      emit({
        iteration,
        type: result.success ? "tool-success" : "tool-error",
        tool: plan.tool,
        message: result.success ? this.describeToolSuccess(plan.tool, result.output) : this.describeToolError(plan.tool, result.output),
      });

      // A React/Vite scaffold is not usable in Preview until its production
      // bundle exists. Build it automatically instead of leaving that step
      // to the user or the model's next planning iteration.
      if (result.success && plan.tool === "scaffoldProject" && /React\/Vite scaffold created/i.test(result.output)) {
        for (const command of ["npm install", "npm run build"]) {
          if (!availableTools.includes("runCommand")) {
            const error = "React/Vite project was created, but runCommand is unavailable to install dependencies and build it.";
            emit({ iteration, type: "failed", tool: "runCommand", message: error });
            return { success: false, iterations: iteration, steps, error };
          }
          const commandKey = `runCommand:${command}`;
          if (seenActions.has(commandKey)) {
            const error = `Agent stopped: repeated build command detected (${command})`;
            emit({ iteration, type: "failed", tool: "runCommand", message: error });
            return { success: false, iterations: iteration, steps, error };
          }
          seenActions.add(commandKey);
          emit({ iteration, type: "tool-start", tool: "runCommand", message: command === "npm install" ? "Устанавливаю зависимости созданного React-приложения." : "Собираю production-версию для Preview." });
          const buildResult = await this.runtime.executeTool("runCommand", command);
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
            return { success: false, iterations: iteration, steps, error: `React/Vite build pipeline failed at ${command}: ${buildResult.output}` };
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
    this.log(this.maxIterations, "loop", "error");
    emit({ iteration: this.maxIterations, type: "failed", message: error });
    return { success: false, iterations: this.maxIterations, steps, error };
  }

  private async finalResponse(
    task: string,
    results: AgentToolResult[],
    options?: GatewayGenerateOptions,
  ): Promise<string> {
    if (results.length === 0) {
      return this.gateway.generate(task, options);
    }

    const summary = results
      .map((item) => {
        if (item.tool === "readFile") return "readFile: file content inspected successfully";
        return `${item.tool}: ${item.result.output.slice(0, MAX_RESULT_LENGTH)}`;
      })
      .join("\n");
    return this.gateway.generate(`Задача выполнена: ${task}\nРезультаты инструментов:\n${summary}`, options);
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

  private log(iteration: number, tool: string, status: "success" | "error"): void {
    console.log(JSON.stringify({ iteration, tool, status }));
  }
}
