import type { Tool, ToolResult } from "../types.js";
import { relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { signSandboxWorkerRequest } from "../../sandbox/workerAuth.js";
import { DockerSandbox } from "../../sandbox/dockerSandbox.js";
import type { SandboxRequest, SandboxResult } from "../../sandbox/types.js";
import type { ServerRuntime } from "../../runtime/runtime.js";

export interface RunSandboxResult extends ToolResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  command: string;
}

export class RunSandboxTool implements Tool {
  name = "runSandbox";
  description = "Runs an allowlisted build or test command in an isolated Docker container";

  private readonly sandbox: DockerSandbox;
  private readonly projectRoot: string;

  constructor(projectRoot: string, runtime?: ServerRuntime, context: { projectId?: string; taskId?: string } = {}) {
    this.projectRoot = resolve(projectRoot);
    this.sandbox = new DockerSandbox(projectRoot, undefined, runtime, context);
  }

  async execute(input: string, signal?: AbortSignal): Promise<RunSandboxResult> {
    try {
      const request = this.parseRequest(input);
      const result = process.env.NEXUM_SANDBOX_WORKER_URL?.trim()
        ? await this.runRemote(request, signal)
        : await this.sandbox.run(request, signal);
      return {
        success: result.success,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
        command: result.command,
        output: JSON.stringify(result),
        ...(result.error ? { error: { code: "TOOL_ERROR", message: result.error, retryable: /timeout|temporar|network|busy/i.test(result.error) } } : {}),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sandbox request is invalid";
      const result: RunSandboxResult = {
        success: false,
        exitCode: null,
        stdout: "",
        stderr: "",
        durationMs: 0,
        command: input,
        output: JSON.stringify({ success: false, error: message }),
        error: { code: "TOOL_ERROR", message, retryable: /timeout|temporar|network|busy/i.test(message), repairable: true, fatal: false },
      };
      return result;
    }
  }

  private async runRemote(request: SandboxRequest, signal?: AbortSignal): Promise<SandboxResult> {
    const baseUrl = process.env.NEXUM_SANDBOX_WORKER_URL?.trim().replace(/\/+$/, "");
    const secret = process.env.NEXUM_SANDBOX_WORKER_SECRET ?? "";
    if (!baseUrl) throw new Error("NEXUM_SANDBOX_WORKER_URL is not configured");
    if (secret.length < 32) throw new Error("NEXUM_SANDBOX_WORKER_SECRET must contain at least 32 characters");

    const volumeRoot = resolve(process.env.NEXUM_SANDBOX_VOLUME_ROOT ?? "/app/runtime");
    const projectPath = relative(volumeRoot, this.projectRoot);
    if (!projectPath || projectPath === "." || projectPath === ".." || projectPath.startsWith(".." + sep) || resolve(volumeRoot, projectPath) !== this.projectRoot) {
      throw new Error("Project directory is outside the configured shared sandbox volume");
    }

    const body = JSON.stringify({
      projectPath: projectPath.split(sep).join("/"),
      command: request.command,
      ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
    });
    const timestamp = String(Date.now());
    const nonce = randomUUID();
    const signature = signSandboxWorkerRequest(secret, timestamp, nonce, body);
    const timeoutMs = request.timeoutMs ?? 30_000;
    const timeoutSignal = AbortSignal.timeout(timeoutMs + 15_000);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    let response: Response;
    try {
      response = await fetch(baseUrl + "/run", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-nexum-timestamp": timestamp,
          "x-nexum-nonce": nonce,
          "x-nexum-signature": signature,
        },
        body,
        signal: requestSignal,
      });
    } catch (error) {
      if (signal?.aborted) throw new Error("Sandbox worker request was cancelled");
      throw new Error(error instanceof Error ? `Sandbox worker unavailable: ${error.message}` : "Sandbox worker unavailable");
    }

    const payload = await response.json().catch(() => null) as SandboxResult | { error?: string } | null;
    if (!response.ok) {
      const message = payload && typeof payload.error === "string" ? payload.error : `Sandbox worker returned HTTP ${response.status}`;
      throw new Error(message);
    }
    if (!payload || typeof payload !== "object" || !("success" in payload) || !("command" in payload) || typeof payload.success !== "boolean" || typeof payload.command !== "string") {
      throw new Error("Sandbox worker returned an invalid response");
    }
    return payload as SandboxResult;
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
      projectPath: ".",
      command: request.command,
      ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
    };
  }
}
