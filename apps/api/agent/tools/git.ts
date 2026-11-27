import { spawn } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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
  diff: ["diff", "--no-ext-diff", "--no-textconv"],
  "diff-stat": ["diff", "--stat", "--no-ext-diff", "--no-textconv"],
  log: ["log", "--no-ext-diff", "--no-textconv"],
  branch: ["branch", "--show-current"],
};

/**
 * Git runs on the API host, not in the sandbox, and a repository's own config can
 * make even read-only commands execute programs (core.fsmonitor, filters,
 * textconv, hooks, includes, ...). Project files are user- and agent-controlled,
 * so the repository config is checked against a strict allowlist and anything
 * else is refused before git starts. Command-line overrides below add a second
 * layer for the most common execution hooks.
 */
const SAFE_GIT_OVERRIDES = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "core.pager=cat", "--no-pager"];

const ALLOWED_CONFIG_KEYS: Record<string, ReadonlySet<string>> = {
  core: new Set(["repositoryformatversion", "filemode", "bare", "logallrefupdates", "ignorecase", "precomposeunicode", "symlinks", "autocrlf", "safecrlf", "eol"]),
  extensions: new Set(["objectformat", "refstorage"]),
  init: new Set(["defaultbranch"]),
  user: new Set(["name", "email"]),
  branch: new Set(["remote", "merge", "rebase"]),
  remote: new Set(["url", "fetch", "pushurl"]),
};

export class UnsafeGitRepositoryError extends Error {}

export function assertSafeGitConfig(config: string): void {
  let section: string | null = null;
  for (const rawLine of config.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    if (line.endsWith("\\")) throw new UnsafeGitRepositoryError("Git config line continuations are not allowed");
    const header = /^\[\s*([A-Za-z0-9-]+)(?:[.\s][^\]]*)?\]\s*(?:[#;].*)?$/.exec(line);
    if (header) {
      section = header[1]!.toLowerCase();
      if (!ALLOWED_CONFIG_KEYS[section]) throw new UnsafeGitRepositoryError(`Git config section [${section}] is not allowed`);
      continue;
    }
    if (line.startsWith("[")) throw new UnsafeGitRepositoryError("Malformed git config section is not allowed");
    const key = /^([A-Za-z][A-Za-z0-9-]*)\s*(?:=|$)/.exec(line)?.[1]?.toLowerCase();
    if (!section || !key || !ALLOWED_CONFIG_KEYS[section]!.has(key)) {
      throw new UnsafeGitRepositoryError(`Git config key ${section ?? "?"}.${key ?? "?"} is not allowed`);
    }
  }
}

/**
 * Everything needed to run git on the API host against a project safely:
 * the validated repository, command-line overrides placed before the
 * subcommand, and a minimal pinned environment. Throws UnsafeGitRepositoryError.
 */
export async function prepareSafeGitInvocation(projectRoot: string): Promise<{ overrides: string[]; env: NodeJS.ProcessEnv }> {
  const gitDir = await assertSafeRepository(projectRoot);
  return {
    overrides: [...SAFE_GIT_OVERRIDES],
    env: {
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      HOME: "/tmp",
      // Pin the repository: no discovery, no gitfile redirection.
      GIT_DIR: gitDir,
      GIT_WORK_TREE: projectRoot,
      GIT_CEILING_DIRECTORIES: dirname(projectRoot),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
    },
  };
}

/** Requires a real .git directory with an allowlisted config; returns the git dir. */
async function assertSafeRepository(projectRoot: string): Promise<string> {
  const gitDir = join(projectRoot, ".git");
  const entry = await lstat(gitDir).catch(() => null);
  if (!entry) throw new UnsafeGitRepositoryError("Project is not a Git repository");
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new UnsafeGitRepositoryError("A .git file or symlink is not allowed (refused)");
  for (const redirect of ["commondir", "config.worktree"]) {
    if (await lstat(join(gitDir, redirect)).then(() => true, () => false)) {
      throw new UnsafeGitRepositoryError(`.git/${redirect} is not allowed (refused)`);
    }
  }
  const configEntry = await lstat(join(gitDir, "config")).catch(() => null);
  if (configEntry) {
    if (!configEntry.isFile()) throw new UnsafeGitRepositoryError(".git/config must be a regular file (refused)");
    assertSafeGitConfig(await readFile(join(gitDir, "config"), "utf8"));
  }
  return gitDir;
}

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

    let invocation: Awaited<ReturnType<typeof prepareSafeGitInvocation>>;
    try {
      invocation = await prepareSafeGitInvocation(this.projectRoot);
    } catch (error) {
      if (error instanceof UnsafeGitRepositoryError) return this.blocked(operation, `Git operation refused: ${error.message}`);
      throw error;
    }
    return this.run(operation, [...invocation.overrides, ...args], invocation.env, signal);
  }

  private run(operation: string, args: string[], env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<GitToolResult> {
    return new Promise((resolveResult) => {
      const child = spawn("git", args, {
        cwd: this.projectRoot,
        env,
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
