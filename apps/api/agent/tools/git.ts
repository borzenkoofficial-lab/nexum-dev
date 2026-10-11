import { spawn } from "node:child_process";
import { dirname } from "node:path";
import type { Tool, ToolResult } from "../types.js";
import type { ServerRuntime } from "../../runtime/runtime.js";

export type GitOperation = "status" | "diff" | "diff-stat" | "log" | "branch";

export interface GitToolResult extends ToolResult {
  success: boolean;
  operation: GitOperation | string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 32 * 1024;
const OPERATIONS: Record<GitOperation, string[]> = {
  status: ["status", "--short", "--untracked-files=no"],
  diff: ["diff"],
  "diff-stat": ["diff", "--stat"],
  log: ["log"],
  branch: ["branch", "--show-current"],
};

export class GitTool implements Tool {
  name = "git";
  description = "Runs a fixed allowlist of read-only Git operations";

  constructor(
    private readonly projectRoot: string,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
    private readonly runtime?: ServerRuntime,
    private readonly context: { projectId?: string; taskId?: string } = {},
  ) {}

  async execute(input: string, signal?: AbortSignal): Promise<GitToolResult> {
    const operation = input.trim();
    const args = OPERATIONS[operation as GitOperation];

    if (!args) {
      return this.blocked(operation, "Git operation is not allowed");
    }

    return this.run(operation, args, signal);
  }

  private run(operation: string, args: string[], signal?: AbortSignal): Promise<GitToolResult> {
    return new Promise((resolveResult) => {
      const child = spawn("git", args, {
        cwd: this.projectRoot,
        env: {
          PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
          HOME: "/tmp",
          GIT_CEILING_DIRECTORIES: dirname(this.projectRoot),
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_TERMINAL_PROMPT: "0",
        },
        shell: false,
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      let outputBytes = 0;
      let timedOut = false;
      let outputLimitReached = false;
      const processId = this.runtime?.registerProcess(`git:${operation}`, child, { ...this.context, operation });
      const abort = () => { if (child.exitCode === null) child.kill("SIGTERM"); };
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
        stderr += "\nGit operation timed out";
        child.kill("SIGTERM");
      }, this.timeoutMs);

      child.on("error", (error) => {
        clearTimeout(timer);
        if (processId) this.runtime?.completeProcess(processId);
        signal?.removeEventListener("abort", abort);
        this.log(operation, null, false);
        resolveResult({
          success: false,
          operation,
          exitCode: null,
          stdout,
          stderr: `${stderr}${error.message}`,
          output: JSON.stringify({ operation, exitCode: null, stdout, stderr }),
        });
      });

      child.on("close", (exitCode) => {
        clearTimeout(timer);
        if (processId) this.runtime?.completeProcess(processId);
        signal?.removeEventListener("abort", abort);
        const success = exitCode === 0 && !timedOut;
        this.log(operation, exitCode, success);
        resolveResult({
          success,
          operation,
          exitCode,
          stdout,
          stderr,
          output: JSON.stringify({ operation, exitCode, stdout, stderr }),
        });
      });
    });
  }

  private blocked(operation: string, message: string): GitToolResult {
    this.log(operation, null, false);
    return {
      success: false,
      operation,
      exitCode: null,
      stdout: "",
      stderr: message,
      output: JSON.stringify({ operation, exitCode: null, stdout: "", stderr: message }),
    };
  }

  private log(operation: string, exitCode: number | null, success: boolean): void {
    console.log(
      `[agent] git operation: ${operation}; cwd: ${this.projectRoot}; result: ${success ? "success" : "failed"}; exitCode: ${exitCode}`,
    );
  }
}
