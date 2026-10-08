import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Tool, ToolResult } from "../types.js";
import type { ServerRuntime } from "../../runtime/runtime.js";
import { ProjectWorkspace } from "./workspace.js";
import { DockerSandbox } from "../../sandbox/dockerSandbox.js";

export class TestProjectTool implements Tool {
  name = "testProject";
  description = "Runs the project's safest available automated checks and reports structured failures before Preview.";
  constructor(private readonly workspace: ProjectWorkspace, private readonly runtime?: ServerRuntime, private readonly context: { projectId?: string; taskId?: string } = {}) {}

  async execute(_input = ".", signal?: AbortSignal): Promise<ToolResult> {
    try {
      const root = await this.workspace.existing(".");
      const packagePath = resolve(root, "package.json");
      let pkg: { scripts?: Record<string, string> } = {};
      try {
        pkg = JSON.parse(await readFile(packagePath, "utf8"));
      } catch {
        return this.validateStatic(root);
      }

      const scripts = pkg.scripts ?? {};
      const commands = ["test", "typecheck", "lint"].filter((name) => typeof scripts[name] === "string");
      if (!commands.length) {
        if (typeof scripts.build === "string") return this.run(root, "npm", ["run", "build"], "build");
        return { success: true, output: "No automated test/typecheck/lint/build script is defined; project structure is valid for Preview." };
      }

      const results: string[] = [];
      for (const name of commands) {
        const result = await this.run(root, "npm", ["run", name], name, signal);
        results.push(result.output);
        if (!result.success) {
          return {
            success: false,
            output: JSON.stringify({
              stage: name,
              failure: result.output.slice(-12000),
              passed: results.slice(0, -1),
            }),
          };
        }
      }
      return { success: true, output: JSON.stringify({ passed: commands, results: results.map((item) => item.slice(-1800)) }) };
    } catch (error) {
      return { success: false, output: error instanceof Error ? error.message : "Project test runner failed" };
    }
  }

  private async validateStatic(root: string): Promise<ToolResult> {
    try {
      await access(resolve(root, "index.html"));
      const html = await readFile(resolve(root, "index.html"), "utf8");
      const problems: string[] = [];
      if (!/^\s*<!doctype html>/i.test(html)) problems.push("index.html: missing HTML5 doctype");
      if (!/<html[\s>]/i.test(html) || !/<body[\s>]/i.test(html)) problems.push("index.html: missing html/body");
      if ((html.match(/<script\b/gi) ?? []).length !== (html.match(/<\/script>/gi) ?? []).length) problems.push("index.html: unbalanced script tags");
      if (problems.length) return { success: false, output: JSON.stringify({ stage: "static", failure: problems }) };
      return { success: true, output: "Static project smoke test passed: index.html is present and structurally valid." };
    } catch {
      return { success: false, output: "No package.json or index.html entry point was found for automated testing." };
    }
  }

  private async run(cwd: string, command: string, args: string[], stage: string, signal?: AbortSignal): Promise<ToolResult> {
    const requested = [command, ...args].join(" ");
    const sandbox = new DockerSandbox(cwd, undefined, this.runtime, this.context);
    const result = await sandbox.run({
      projectPath: ".",
      command: requested,
      timeoutMs: 120_000,
    }, signal);
    return {
      success: result.success,
      output: JSON.stringify({
        stage,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        ...(result.error ? { error: result.error } : {}),
      }).slice(-16000),
    };
  }}
