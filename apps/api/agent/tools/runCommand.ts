import { isAbsolute } from "node:path";
import { resolveProjectPath } from "./path.js";
import type { Tool } from "../types.js";
import type { ToolResult } from "../types.js";
import type { ServerRuntime } from "../../runtime/runtime.js";
import { DockerSandbox } from "../../sandbox/dockerSandbox.js";
import { spawn } from "node:child_process";

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
      if ((executable === "node" || executable === "npm") && (args[0] === "--version" || args[0] === "-v")) {
        const result: RunCommandResult = {
          success: true,
          exitCode: 0,
          stdout: executable === "node" ? process.version + "\n" : "",
          stderr: "",
          command,
          output: JSON.stringify({ exitCode: 0, stdout: executable === "node" ? process.version + "\n" : "", stderr: "" }),
        };
        return result;
      }
      if (executable === "git") {
        const result = await this.runGit(args, command, signal);
        console.log(
          `[agent] command: ${command}; cwd: ${this.projectRoot}; result: ${result.success ? "success" : "failed"}; exitCode: ${result.exitCode}`,
        );
        return result;
      }

      const sandbox = new DockerSandbox(this.projectRoot, undefined, this.runtime, this.context);
      const sandboxResult = await sandbox.run({
        projectPath: ".",
        command,
        timeoutMs: this.timeoutMs,
      }, signal);
      const result: RunCommandResult = {
        success: sandboxResult.success,
        exitCode: sandboxResult.exitCode,
        stdout: sandboxResult.stdout,
        stderr: sandboxResult.stderr,
        command,
        output: JSON.stringify({
          exitCode: sandboxResult.exitCode,
          stdout: sandboxResult.stdout,
          stderr: sandboxResult.stderr,
          ...(sandboxResult.error ? { error: sandboxResult.error } : {}),
        }),
      };
      console.log(
        `[agent] sandbox command: ${command}; cwd: ${this.projectRoot}; result: ${result.success ? "success" : "failed"}; exitCode: ${result.exitCode}`,
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
      if (normalizedArgs.length !== 2 || normalizedArgs[1] !== "--ignore-scripts") {
        throw new Error("Only npm install --ignore-scripts is allowed for Agent dependency bootstrap.");
      }
      return { executable: "npm", args: normalizedArgs };
    }

    if (normalizedArgs[0] === "--version" || normalizedArgs[0] === "-v") {
      return { executable: "npm", args: normalizedArgs };
    }

    if (normalizedArgs[0] !== "run") {
      throw new Error("Only npm --version and allowlisted npm run scripts are permitted");
    }

    // "npm run" without a script only prints package scripts; it does not
    // execute project code. The builder uses it to discover whether a build
    // command actually exists before forcing a production build.
    if (!normalizedArgs[1]) {
      return { executable: "npm", args: normalizedArgs };
    }

    const allowedScripts = new Set(["build", "test", "lint", "typecheck"]);
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

  private runGit(args: string[], command: string, signal?: AbortSignal): Promise<RunCommandResult> {
    return new Promise((resolveResult) => {
      const child = spawn("git", args, { cwd: this.projectRoot, shell: false, windowsHide: true, env: { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", HOME: process.env.HOME ?? "/tmp", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" } });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const processId = this.runtime?.registerProcess(`runCommand:${command.slice(0, 120)}`, child, { ...this.context, operation: command });
      const abort = () => {
        if (child.exitCode === null) child.kill("SIGTERM");
      };
      if (signal) {
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      }
      const timer = setTimeout(() => {
        timedOut = true;
        stderr += "\nCommand timed out";
        child.kill("SIGTERM");
      }, this.timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on("error", (error) => {
        clearTimeout(timer);
        if (processId) this.runtime?.completeProcess(processId);
        signal?.removeEventListener("abort", abort);
        resolveResult({ success: false, exitCode: null, stdout, stderr: error.message, command, output: this.formatOutput(stdout, error.message, null) });
      });
      child.on("close", (exitCode) => {
        clearTimeout(timer);
        if (processId) this.runtime?.completeProcess(processId);
        signal?.removeEventListener("abort", abort);
        const success = exitCode === 0 && !timedOut;
        resolveResult({ success, exitCode, stdout, stderr, command, output: this.formatOutput(stdout, stderr, exitCode) });
      });
    });
  }

  private formatOutput(stdout: string, stderr: string, exitCode: number | null): string {
    return JSON.stringify({ exitCode, stdout, stderr });
  }
}
