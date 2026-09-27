import type { AIGateway } from "../ai/gateway.js";
import type { GatewayGenerateOptions } from "../ai/gateway.js";
import type {
  AgentModelOptions,
  AgentPlan,
  AgentLoopResult,
  ProductPlan,
  AgentRuntime,
  AgentStep,
  AgentToolResult,
} from "./types.js";

const DEFAULT_MAX_ITERATIONS = 20;
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
    private readonly onPlan?: (plan: ProductPlan) => void,
  ) {}

  async run(task: string, options?: GatewayGenerateOptions): Promise<AgentLoopResult> {
    const steps: AgentStep[] = [];
    const previousResults: AgentToolResult[] = [];
    const seenActions = new Set<string>();
    let eventId = 0;
    let productPlan: ProductPlan | null = null;
    let productReviewAttempts = 0;
    const builderTask = /создай|сделай|разработай|build|create|make|сайт|приложени|лендинг|dashboard|landing|web app|website|marketplace|crm|поменяй|измени|добавь|удали|исправь/i.test(task);
    const emit = (event: Omit<AgentEvent, "id" | "timestamp">) => {
      this.onEvent?.({ ...event, id: ++eventId, timestamp: Date.now() });
    };
    emit({ iteration: 0, type: "thinking", message: "Принял запрос. Анализирую проект и выбираю следующий шаг." });

    for (let iteration = 1; iteration <= this.maxIterations; iteration += 1) {
      const availableTools = this.runtime.getAvailableTools();

      // Builder sessions always inspect the active project before planning or editing.
      // This prevents the model from inventing a new app or answering with source code.
      if (builderTask && previousResults.length === 0 && availableTools.includes("listFiles")) {
        emit({ iteration, type: "tool-start", tool: "listFiles", message: "Изучаю текущий проект перед планированием." });
        const inspection = await this.runtime.executeTool("listFiles", ".");
        const step: AgentStep = { iteration, tool: "listFiles", input: ".", success: inspection.success };
        steps.push(step);
        this.onStep?.(step);
        previousResults.push({ iteration, tool: "listFiles", input: ".", result: inspection });
        this.log(iteration, "listFiles", inspection.success ? "success" : "error");
        emit({
          iteration,
          type: inspection.success ? "tool-success" : "tool-error",
          tool: "listFiles",
          message: inspection.success ? "Структура проекта изучена." : `Не удалось изучить проект: ${inspection.output.slice(0, 400)}`,
        });
        continue;
      }

      if (builderTask && !productPlan && this.runtime.createProductPlan && previousResults.some((item) => item.tool === "listFiles" && item.result.success)) {
        emit({ iteration, type: "thinking", message: "Формирую Product Plan: страницы, компоненты, визуальную систему и критерии готовности." });
        try {
          productPlan = await this.runtime.createProductPlan(task, previousResults, options as AgentModelOptions);
          this.onPlan?.(productPlan);
          emit({ iteration, type: "thinking", message: `План готов: ${productPlan.productType}; ${productPlan.pages.length} экранов; ${productPlan.acceptanceCriteria.length} критериев проверки.` });
        } catch (error) {
          emit({ iteration, type: "tool-error", tool: "Product Planner", message: error instanceof Error ? error.message : "Product planning failed" });
        }
      }
      emit({ iteration, type: "thinking", message: `Шаг ${iteration}: анализирую состояние проекта и результаты предыдущего действия.` });
      let modelPlan: AgentPlan | null = null;
      if (this.runtime.planWithAI) {
        try {
          modelPlan = await this.runtime.planWithAI(task, previousResults, options as AgentModelOptions, productPlan ?? undefined);
        } catch (error) {
          const message = error instanceof Error ? error.message : "AI planning failed";
          this.log(iteration, "AI planner", "error");
          emit({
            iteration,
            type: "tool-error",
            tool: "AI planner",
            message: `AI planner недоступен: ${message}. Переключаюсь на встроенный планировщик.`,
          });
          // A missing/unavailable AI provider must not make basic Builder tasks
          // appear to do nothing. The deterministic planner can still scaffold,
          // edit, build and verify supported projects.
          modelPlan = null;
        }
      }
      // Prefer the model plan when available. If it repeats an action that
      // already failed, switch to the deterministic planner so recovery can continue.
      let plan = modelPlan ?? this.runtime.plan(task, previousResults);
      if (modelPlan) {
        const modelActionKey = `${modelPlan.tool}:${modelPlan.input}`;
        const repeatedFailure = previousResults.some(
          (item) => item.tool === modelPlan.tool && item.input === modelPlan.input && !item.result.success,
        );
        if (repeatedFailure || seenActions.has(modelActionKey)) {
          emit({
            iteration,
            type: "thinking",
            message: "Модель повторила неудачное действие. Переключаюсь на детерминированный recovery-план.",
          });
          plan = this.runtime.plan(task, previousResults);
        }
      }

      // A model is not allowed to declare completion while the deterministic
      // builder still has required implementation work. This is the hard guard
      // against "done" responses that only rename the starter template.
      if (plan?.done && builderTask) {
        const deterministicContinuation = this.runtime.plan(task, previousResults);
        if (deterministicContinuation && !deterministicContinuation.done) {
          plan = deterministicContinuation;
          emit({ iteration, type: "thinking", message: "Модель предложила завершить слишком рано. Продолжаю по Builder quality gate." });
        }
      }

      if (!plan) {
        emit({ iteration, type: "completed", message: "Дополнительных действий не требуется. Формирую итог." });
        return {
          success: true,
          iterations: iteration - 1,
          steps,
          productPlan: productPlan ?? undefined,
          finalResponse: await this.finalResponse(task, previousResults, options),
        };
      }

      if (plan.done) {
        const buildTask = /создай|сделай|разработай|сайт|приложени|лендинг|dashboard|landing|web app|website|marketplace|crm/i.test(task);
        const scaffoldedProject = previousResults.some((item) => item.tool === "scaffoldProject" && item.result.success);
        const meaningfulImplementationCount = previousResults.filter((item) => item.tool === "writeFile" && item.result.success).length;
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
            const result = await this.runtime.executeTool("listFiles", input);
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

          if (!verifiedBuild && availableTools.includes("runCommand")) {
            const input = "npm run build";
            const result = await this.runtime.executeTool("runCommand", input);
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
            if (!result.success) continue;
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
        const hasProjectChanges = previousResults.some((item) =>
          item.tool === "scaffoldProject" &&
          /React\/Vite scaffold created/i.test(item.result.output),
        ) || previousResults.some((item) =>
          item.tool === "writeFile" &&
          /"path"\s*:\s*"(?:(?:src\/)|(?:package\.json$)|(?:vite\.config\.)|(?:index\.html$))/i.test(item.input),
        );
        const lastProjectChangeIndex = previousResults.reduce((lastIndex, item, index) => {
          if (
            item.tool === "scaffoldProject" ||
            item.tool === "writeFile"
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
        if (hasProjectChanges && !hasSuccessfulBuild && availableTools.includes("runCommand")) {
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
            const result = await this.runtime.executeTool("runCommand", command);
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
          if (!buildSucceeded) continue;
        }

        if (builderTask && productPlan && this.runtime.reviewProduct && productReviewAttempts < 2) {
          productReviewAttempts += 1;
          emit({ iteration, type: "thinking", message: "Запускаю финальный self-review: сверяю реализацию с Product Plan и ищу недостающие функции." });
          const review = await this.runtime.reviewProduct(task, previousResults, productPlan, options as AgentModelOptions);
          if (!review.passed) {
            const feedback = [
              "Final self-review failed.",
              review.missing.length ? `Missing: ${review.missing.join("; ")}` : "",
              review.risks.length ? `Risks: ${review.risks.join("; ")}` : "",
            ].filter(Boolean).join("\n");
            const reviewResult = { success: false, output: feedback };
            previousResults.push({ iteration, tool: "productReview", input: "final", result: reviewResult });
            emit({ iteration, type: "tool-error", tool: "productReview", message: feedback.slice(0, 1200) });
            continue;
          }
          previousResults.push({ iteration, tool: "productReview", input: "final", result: { success: true, output: "Product review passed." } });
          emit({ iteration, type: "tool-success", tool: "productReview", message: "Self-review пройден: реализация соответствует плану." });
        }

        emit({ iteration, type: "completed", message: "Все запланированные действия выполнены. Self-review и проверки пройдены." });
        return {
          success: true,
          iterations: iteration - 1,
          steps,
          productPlan: productPlan ?? undefined,
          finalResponse: plan.finalResponse ?? await this.finalResponse(task, previousResults, options),
        };
      }

      if (!availableTools.includes(plan.tool)) {
        const error = `Agent stopped: unavailable tool (${plan.tool})`;
        this.log(iteration, plan.tool, "error");
        emit({ iteration, type: "failed", tool: plan.tool, message: error });
        return { success: false, iterations: iteration - 1, steps, productPlan: productPlan ?? undefined, error };
      }

      const actionKey = `${plan.tool}:${plan.input}`;
      const previousSuccess = previousResults.some(
        (item) => item.tool === plan.tool && item.input === plan.input && item.result.success,
      );
      if (previousSuccess) {
        const error = `Agent stopped: repeated successful action detected (${plan.tool})`;
        this.log(iteration, plan.tool, "error");
        emit({ iteration, type: "failed", tool: plan.tool, message: error });
        return { success: false, iterations: iteration - 1, steps, productPlan: productPlan ?? undefined, error };
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
        const commands = packageChanged ? ["npm install", "npm run build"] : ["npm run build"];
        for (const command of commands) {
          const commandResult = await this.runtime.executeTool("runCommand", command);
          const commandStep: AgentStep = { iteration, tool: "runCommand", input: command, success: commandResult.success };
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
            emit({ iteration, type: "failed", tool: "runCommand", message: error });
            return { success: false, iterations: iteration, steps, error };
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
    this.log(this.maxIterations, "loop", "error");
    emit({ iteration: this.maxIterations, type: "failed", message: error });
    return { success: false, iterations: this.maxIterations, steps, productPlan: productPlan ?? undefined, error };
  }

  private async finalResponse(
    task: string,
    results: AgentToolResult[],
    options?: GatewayGenerateOptions,
  ): Promise<string> {
    if (results.length === 0) {
      try {
        return await this.gateway.generate(task, options);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "AI response generation failed";
        return `NEXUM завершил выполнение, но финальный ответ AI недоступен: ${detail}. Проверьте Preview и AI Activity.`;
      }
    }

    const builderTask = /создай|сделай|разработай|build|create|make|сайт|приложени|лендинг|dashboard|landing|web app|website|marketplace|crm|поменяй|измени|добавь|удали|исправь/i.test(task);
    if (builderTask) {
      const writes = results.filter((item) => item.tool === "writeFile" && item.result.success).length;
      const builds = results.filter((item) => (item.tool === "runCommand" || item.tool === "runSandbox") && /npm run build/.test(item.input) && item.result.success).length;
      return `Готово. NEXUM изменил проект по запросу: ${task.trim().slice(0, 160)}. Выполнено изменений: ${writes}. Production-сборка: ${builds > 0 ? "проверена" : "не запускалась"}. Откройте Preview для результата и AI Activity для деталей.`;
    }

    const summary = results
      .map((item) => {
        if (item.tool === "readFile") return "readFile: file content inspected successfully";
        return `${item.tool}: ${item.result.output.slice(0, MAX_RESULT_LENGTH)}`;
      })
      .join("\n");
    try {
      return await this.gateway.generate(`Задача выполнена: ${task}\nРезультаты инструментов:\n${summary}`, options);
    } catch (error) {
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

  private log(iteration: number, tool: string, status: "success" | "error"): void {
    console.log(JSON.stringify({ iteration, tool, status }));
  }
}
