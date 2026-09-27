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

export class AgentLoop {
  constructor(
    private readonly runtime: AgentRuntime,
    private readonly gateway: AIGateway,
    private readonly maxIterations = DEFAULT_MAX_ITERATIONS,
  ) {}

  async run(task: string, options?: GatewayGenerateOptions): Promise<AgentLoopResult> {
    const steps: AgentStep[] = [];
    const previousResults: AgentToolResult[] = [];
    const seenActions = new Set<string>();

    for (let iteration = 1; iteration <= this.maxIterations; iteration += 1) {
      const availableTools = this.runtime.getAvailableTools();
      let modelPlan: AgentPlan | null = null;
      if (this.runtime.planWithAI) {
        try {
          modelPlan = await this.runtime.planWithAI(task, previousResults, options as AgentModelOptions);
        } catch (error) {
          const message = error instanceof Error ? error.message : "AI planning failed";
          this.log(iteration, "AI planner", "error");
          return { success: false, iterations: iteration - 1, steps, error: message };
        }
      }
      const plan = modelPlan ?? this.runtime.plan(task, previousResults);

      if (!plan) {
        return {
          success: true,
          iterations: iteration - 1,
          steps,
          finalResponse: await this.finalResponse(task, previousResults, options),
        };
      }

      if (plan.done) {
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
        return { success: false, iterations: iteration - 1, steps, error };
      }

      const actionKey = `${plan.tool}:${plan.input}`;
      if (seenActions.has(actionKey)) {
        const lastFailure = [...previousResults].reverse().find((item) => !item.result.success);
        const error = lastFailure
          ? `Tool ${lastFailure.tool} failed: ${lastFailure.result.output}`
          : `Agent stopped: repeated action detected (${plan.tool})`;
        this.log(iteration, plan.tool, "error");
        return { success: false, iterations: iteration - 1, steps, error };
      }
      seenActions.add(actionKey);

      const result = await this.runtime.executeTool(plan.tool, plan.input);
      const step: AgentStep = {
        iteration,
        tool: plan.tool,
        input: plan.input,
        success: result.success,
      };
      steps.push(step);
      previousResults.push({ iteration, tool: plan.tool, input: plan.input, result });
      this.log(iteration, plan.tool, result.success ? "success" : "error");

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

  private log(iteration: number, tool: string, status: "success" | "error"): void {
    console.log(JSON.stringify({ iteration, tool, status }));
  }
}
