import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { assertExistingProjectPath, resolveProjectPath } from "../agent/tools/path.js";
import type { SandboxRequest, SandboxResult } from "./types.js";

export const SANDBOX_IMAGE = "node:22-bookworm-slim";
const DEFAULT_TIMEOUT_MS = 30_000;
const DOCKER_CHECK_TIMEOUT_MS = 3_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const SHELL_SYNTAX = /[;&|`$()<>\n\r\\]/;

const ALLOWED_NPM_SCRIPTS = new Set(["build", "test", "lint", "typecheck"]);
const ALLOWED_NPX_COMMANDS = new Set(["tsc", "vite", "oxlint"]);

export class DockerSandbox {
  constructor(
    private readonly workspaceRoot: string,
    private readonly image = SANDBOX_IMAGE,
  ) {}

  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  async run(request: SandboxRequest): Promise<SandboxResult> {
    const startedAt = Date.now();
    const baseResult = {
      command: request.command,
      stdout: "",
      stderr: "",
      exitCode: null,
      durationMs: 0,
    };

    try {
      const timeoutMs = this.validateTimeout(request.timeoutMs);
      const projectPath = await this.resolveProjectPath(request.projectPath);
      const command = this.validateCommand(request.command, projectPath);
      const dockerStatus = await this.checkDocker(timeoutMs);

      if (!dockerStatus.available) {
        return this.finish({ ...baseResult, error: "Docker is not available" }, startedAt, false);
      }

      if (!dockerStatus.imageAvailable) {
        return this.finish(
          { ...baseResult, error: `Docker image is not available: ${this.image}` },
          startedAt,
          false,
        );
      }

      const containerName = `nexum-sandbox-${randomUUID()}`;
      const result = await this.executeContainer(
        projectPath,
        command,
        request.command,
        timeoutMs,
        containerName,
      );
      return this.finish(result, startedAt, result.success);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sandbox request failed";
      return this.finish({ ...baseResult, error: message }, startedAt, false);
    }
  }

  private async resolveProjectPath(requestedPath: string): Promise<string> {
    const resolvedPath = await assertExistingProjectPath(this.workspaceRoot, requestedPath);
    const details = await stat(resolvedPath);
    if (!details.isDirectory()) throw new Error("Sandbox projectPath must be a directory");
    return resolvedPath;
  }

  private validateTimeout(timeoutMs: number | undefined): number {
    if (timeoutMs === undefined) return DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
      throw new Error("Sandbox timeout must be between 100 and 120000 milliseconds");
    }
    return timeoutMs;
  }

  private validateCommand(command: string, projectPath: string): { executable: string; args: string[] } {
    const input = command.trim();
    if (!input) throw new Error("Sandbox command is required");
    if (SHELL_SYNTAX.test(input)) throw new Error("Shell operators and redirection are not allowed");

    const [executable, ...args] = input.split(/\s+/);
    if (!executable || !["npm", "npx", "node"].includes(executable)) {
      throw new Error("Sandbox command is not allowed");
    }

    if (executable === "npm") return this.validateNpm(args, projectPath);
    if (executable === "npx") return this.validateNpx(args);
    return this.validateNode(args, projectPath);
  }

  private validateNpm(args: string[], projectPath: string): { executable: string; args: string[] } {
    const normalizedArgs = [...args];
    const prefixIndex = normalizedArgs.indexOf("--prefix");

    if (prefixIndex !== -1) {
      const prefix = normalizedArgs[prefixIndex + 1];
      if (!prefix) throw new Error("npm --prefix requires a project path");
      resolveProjectPath(projectPath, prefix);
      normalizedArgs.splice(prefixIndex, 2);
    }

    if (normalizedArgs[0] !== "run" || !ALLOWED_NPM_SCRIPTS.has(normalizedArgs[1] ?? "")) {
      throw new Error("Only npm run build/test/lint/typecheck are allowed in Sandbox");
    }
    return { executable: "npm", args };
  }

  private validateNpx(args: string[]): { executable: string; args: string[] } {
    const packageName = args.find((argument) => !argument.startsWith("-"));
    if (!packageName || !ALLOWED_NPX_COMMANDS.has(packageName)) {
      throw new Error("Only npx tsc, npx vite and npx oxlint are allowed in Sandbox");
    }
    if (args.some((argument) => ["--yes", "--package", "--shell"].includes(argument))) {
      throw new Error("npx package installation and shell options are not allowed");
    }
    return { executable: "npx", args };
  }

  private validateNode(args: string[], projectPath: string): { executable: string; args: string[] } {
    if (!args[0] || args[0].startsWith("-") || args.some((argument) => ["-e", "--eval", "-p", "--print"].includes(argument))) {
      throw new Error("node evaluation flags are not allowed in Sandbox");
    }
    resolveProjectPath(projectPath, args[0]);
    return { executable: "node", args };
  }

  private async checkDocker(timeoutMs: number): Promise<{ available: boolean; imageAvailable: boolean }> {
    const version = await this.runProcess(
      ["version", "--format", "{{.Server.Version}}"],
      DOCKER_CHECK_TIMEOUT_MS,
    );
    if (version.spawnError || version.exitCode !== 0) return { available: false, imageAvailable: false };

    const image = await this.runProcess(["image", "inspect", this.image], timeoutMs);
    return { available: true, imageAvailable: !image.spawnError && image.exitCode === 0 };
  }

  private executeContainer(
    projectPath: string,
    command: { executable: string; args: string[] },
    requestedCommand: string,
    timeoutMs: number,
    containerName: string,
  ): Promise<SandboxResult> {
    const dockerArgs = [
      "run",
      "--rm",
      "--init",
      "--name",
      containerName,
      "--user",
      "1000:1000",
      "--network",
      "none",
      "--memory",
      "512m",
      "--cpus",
      "1",
      "--pids-limit",
      "128",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt",
      "no-new-privileges:true",
      "--mount",
      `type=bind,src=${projectPath},dst=/workspace`,
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,size=64m",
      "--workdir",
      "/workspace",
      this.image,
      command.executable,
      ...command.args,
    ];

    return new Promise((resolveResult) => {
      const child = spawn("docker", dockerArgs, { shell: false, windowsHide: true });
      let stdout = "";
      let stderr = "";
      let outputBytes = 0;
      let timedOut = false;
      let outputLimitReached = false;

      const append = (target: "stdout" | "stderr", chunk: Buffer): void => {
        if (outputLimitReached) return;
        const remaining = MAX_OUTPUT_BYTES - outputBytes;
        const text = chunk.subarray(0, Math.max(remaining, 0)).toString("utf8");
        if (target === "stdout") stdout += text;
        else stderr += text;
        outputBytes += Buffer.byteLength(text);
        if (chunk.byteLength > remaining) {
          outputLimitReached = true;
          stderr += "\nSandbox output limit exceeded";
          child.kill("SIGTERM");
        }
      };

      child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
      child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));

      const timer = setTimeout(() => {
        timedOut = true;
        stderr += "\nSandbox timed out";
        child.kill("SIGTERM");
        void this.removeContainer(containerName);
      }, timeoutMs);

      child.on("error", (error) => {
        clearTimeout(timer);
        this.log(requestedCommand, null, Date.now(), false);
        resolveResult({ success: false, exitCode: null, stdout, stderr: `${stderr}${error.message}`, durationMs: 0, command: requestedCommand, error: "Docker is not available" });
      });

      child.on("close", (exitCode) => {
        clearTimeout(timer);
        const success = exitCode === 0 && !timedOut && !outputLimitReached;
        const error = timedOut
          ? "Sandbox timeout"
          : outputLimitReached
            ? "Sandbox output limit exceeded"
            : undefined;
        resolveResult({
          success,
          exitCode,
          stdout,
          stderr,
          durationMs: 0,
          command: requestedCommand,
          ...(error ? { error } : {}),
        });
      });
    });
  }

  private async removeContainer(containerName: string): Promise<void> {
    await this.runProcess(["rm", "-f", containerName], 5_000);
  }

  private runProcess(args: string[], timeoutMs: number): Promise<{ exitCode: number | null; spawnError: boolean }> {
    return new Promise((resolveResult) => {
      const child = spawn("docker", args, { shell: false, windowsHide: true, stdio: "ignore" });
      const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
      child.on("error", () => {
        clearTimeout(timer);
        resolveResult({ exitCode: null, spawnError: true });
      });
      child.on("close", (exitCode) => {
        clearTimeout(timer);
        resolveResult({ exitCode, spawnError: false });
      });
    });
  }

  private finish(
    result: Omit<SandboxResult, "success" | "durationMs"> & { durationMs?: number },
    startedAt: number,
    success: boolean,
  ): SandboxResult {
    const durationMs = Date.now() - startedAt;
    const finalResult = { ...result, success, durationMs };
    this.log(result.command, result.exitCode, startedAt, success, durationMs);
    return finalResult;
  }

  private log(command: string, exitCode: number | null, startedAt: number, success: boolean, durationMs = Date.now() - startedAt): void {
    console.log(JSON.stringify({ tool: "runSandbox", command, exitCode, durationMs, status: success ? "success" : "error" }));
  }
}
