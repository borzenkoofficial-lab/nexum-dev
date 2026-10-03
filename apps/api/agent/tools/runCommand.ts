import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import type { Tool } from "../types.js";
import type { ToolResult } from "../types.js";
import { resolveProjectPath } from "./path.js";
import type { ServerRuntime } from "../../runtime/runtime.js";

export interface RunCommandResult extends ToolResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  command: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 32 * 1024;
const SHELL_SYNTAX = /[;&|`$()<>\n\r\\]/;
const BLOCKED_ARGUMENTS = new Set([
  "-c",
  "--config",
  "--exec-path",
  "--git-dir",
  "--output",
  "--receive-pack",
  "--upload-pack",
  "--work-tree",
]);

export class RunCommandTool implements Tool {
  name = "runCommand";
  description = "Runs an allowlisted project command without a shell";

  constructor(
    private readonly projectRoot: string,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
    private readonly runtime?: ServerRuntime,
    private readonly context: { projectId?: string; taskId?: string } = {},
  ) {}

  async execute(input: string, signal?: AbortSignal): Promise<RunCommandResult> {
    const command = input.trim();

    try {
      const { executable, args } = this.validateCommand(command);
      const result = await this.run(executable, args, command, signal);
      console.log(
        `[agent] command: ${command}; cwd: ${this.projectRoot}; result: ${result.success ? "success" : "failed"}; exitCode: ${result.exitCode}`,
      );
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Command is not allowed";
      const result: RunCommandResult = {
        success: false,
        exitCode: null,
        stdout: "",
        stderr: message,
        command,
        output: message,
      };
      console.log(
        `[agent] command: ${command}; cwd: ${this.projectRoot}; result: blocked; exitCode: null`,
      );
      return result;
    }
  }

  private validateCommand(command: string): { executable: string; args: string[] } {
    if (!command) throw new Error("Command is required");
    if (SHELL_SYNTAX.test(command)) {
      throw new Error("Shell operators and redirection are not allowed");
    }

    const tokens = command.split(/\s+/);
    const [executable, ...args] = tokens;
    if (!executable || executable.includes("/")) {
      throw new Error("Only allowlisted commands are permitted");
    }

    for (const argument of args) {
      if (BLOCKED_ARGUMENTS.has(argument) || argument.includes("..") || isAbsolute(argument)) {
        throw new Error("Command argument is not allowed");
      }
    }

    if (executable === "git") return this.validateGit(args);
    if (executable === "npm") return this.validateNpm(args);
    if (executable === "npx") return this.validateNpx(args);
    if (executable === "node") return this.validateNode(args);

    throw new Error(`Command is not allowed: ${executable}`);
  }

  private validateGit(args: string[]): { executable: string; args: string[] } {
    const commandIndex = args[0] === "--no-pager" ? 1 : 0;
    const gitCommand = args[commandIndex];
    if (!gitCommand || !["status", "diff", "log"].includes(gitCommand)) {
      throw new Error("Only git status, git diff and git log are allowed");
    }

    if (args.some((argument) => argument === "-C" || argument === "-c")) {
      throw new Error("Changing the git working directory or config is not allowed");
    }

    return { executable: "git", args };
  }

  private validateNpm(args: string[]): { executable: string; args: string[] } {
    const normalizedArgs = args;
    const prefixIndex = normalizedArgs.indexOf("--prefix");

    if (prefixIndex !== -1) {
      const prefix = normalizedArgs[prefixIndex + 1];
      if (!prefix) throw new Error("npm --prefix requires a project path");
      resolveProjectPath(this.projectRoot, prefix);
      normalizedArgs.splice(prefixIndex, 2);
    }

    if (normalizedArgs[0] === "install") {
      if (normalizedArgs.slice(1).some((argument) => argument.startsWith("-"))) {
        throw new Error("npm install flags are not allowed");
      }
      return { executable: "npm", args: normalizedArgs };
    }

    if (normalizedArgs[0] === "--version" || normalizedArgs[0] === "-v") {
      return { executable: "npm", args: normalizedArgs };
    }

    if (normalizedArgs[0] !== "run") {
      throw new Error("Only npm install, npm --version and npm run <script> are allowed");
    }

    // "npm run" without a script only prints package scripts; it does not
    // execute project code. The builder uses it to discover whether a build
    // command actually exists before forcing a production build.
    if (!normalizedArgs[1]) {
      return { executable: "npm", args: normalizedArgs };
    }

    const allowedScripts = new Set(["build", "test", "lint", "typecheck", "dev", "start", "preview"]);
    if (!allowedScripts.has(normalizedArgs[1])) {
      throw new Error("npm script is not allowed");
    }

    return { executable: "npm", args: normalizedArgs };
  }

  private validateNpx(args: string[]): { executable: string; args: string[] } {
    const packageName = args.find((argument) => !argument.startsWith("-"));
    if (!packageName || !["tsc", "vite", "oxlint"].includes(packageName)) {
      throw new Error("Only npx tsc, npx vite and npx oxlint are allowed");
    }

    if (args.some((argument) => ["--yes", "--package", "--shell"].includes(argument))) {
      throw new Error("npx package installation and shell options are not allowed");
    }

    return { executable: "npx", args };
  }

  private validateNode(args: string[]): { executable: string; args: string[] } {
    if (args[0] === "--version" || args[0] === "-v") {
      return { executable: "node", args };
    }

    if (!args[0] || args[0].startsWith("-") || args.some((argument) => ["-e", "--eval", "-p", "--print"].includes(argument))) {
      throw new Error("node evaluation flags are not allowed; use a project script path");
    }

    resolveProjectPath(this.projectRoot, args[0]);
    return { executable: "node", args };
  }

  private run(executable: string, args: string[], command: string, signal?: AbortSignal): Promise<RunCommandResult> {
    return new Promise((resolveResult) => {
      const child = spawn(executable, args, {
        cwd: this.projectRoot,
        shell: false,
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      let outputBytes = 0;
      let timedOut = false;
      let outputLimitReached = false;
      const processId = this.runtime?.registerProcess(`runCommand:${command.slice(0, 120)}`, child, { ...this.context, operation: command });
      const abort = () => { if (processId) this.runtime?.stopProcess(processId); else if (child.exitCode === null) child.kill("SIGTERM"); };
      if (signal) { if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true }); }

      const append = (target: "stdout" | "stderr", chunk: Buffer): void => {
        if (outputLimitReached) return;

        const remaining = MAX_OUTPUT_BYTES - outputBytes;
        const text = chunk.subarray(0, Math.max(remaining, 0)).toString("utf8");
        if (target === "stdout") stdout += text;
        else stderr += text;
        outputBytes += Buffer.byteLength(text);

        if (chunk.byteLength > remaining) {
          outputLimitReached = true;
          stderr += "\nOutput limit exceeded";
          child.kill("SIGTERM");
        }
      };

      child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
      child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));

      const timer = setTimeout(() => {
        timedOut = true;
        stderr += "\nCommand timed out";
        child.kill("SIGTERM");
      }, this.timeoutMs);

      child.on("error", (error) => {
        clearTimeout(timer);
        if (processId) this.runtime?.completeProcess(processId);
        signal?.removeEventListener("abort", abort);
        resolveResult({
          success: false,
          exitCode: null,
          stdout,
          stderr: `${stderr}${error.message}`,
          command,
          output: this.formatOutput(stdout, stderr, null),
        });
      });

      child.on("close", (exitCode) => {
        clearTimeout(timer);
        if (processId) this.runtime?.completeProcess(processId);
        signal?.removeEventListener("abort", abort);
        const success = exitCode === 0 && !timedOut && !outputLimitReached;
        resolveResult({
          success,
          exitCode,
          stdout,
          stderr,
          command,
          output: this.formatOutput(stdout, stderr, exitCode),
        });
      });
    });
  }

  private formatOutput(stdout: string, stderr: string, exitCode: number | null): string {
    return JSON.stringify({ exitCode, stdout, stderr });
  }
}
