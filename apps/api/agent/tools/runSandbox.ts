import type { Tool, ToolResult } from "../types.js";
import { DockerSandbox } from "../../sandbox/dockerSandbox.js";
import type { SandboxRequest, SandboxResult } from "../../sandbox/types.js";

export interface RunSandboxResult extends SandboxResult, ToolResult {}

export class RunSandboxTool implements Tool {
  name = "runSandbox";
  description = "Runs an allowlisted build or test command in an isolated Docker container";

  private readonly sandbox: DockerSandbox;

  constructor(projectRoot: string) {
    this.sandbox = new DockerSandbox(projectRoot);
  }

  async execute(input: string): Promise<RunSandboxResult> {
    try {
      const request = this.parseRequest(input);
      const result = await this.sandbox.run(request);
      return { ...result, output: JSON.stringify(result) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sandbox request is invalid";
      const result: RunSandboxResult = {
        success: false,
        exitCode: null,
        stdout: "",
        stderr: "",
        durationMs: 0,
        command: input,
        error: message,
        output: JSON.stringify({ success: false, error: message }),
      };
      return result;
    }
  }

  private parseRequest(input: string): SandboxRequest {
    if (!input.trim().startsWith("{")) {
      return { projectPath: ".", command: input };
    }

    const request = JSON.parse(input) as Partial<SandboxRequest>;
    if (typeof request.command !== "string") {
      throw new Error("runSandbox expects JSON with a command");
    }

    return {
      projectPath: typeof request.projectPath === "string" ? request.projectPath : ".",
      command: request.command,
      ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
    };
  }
}
