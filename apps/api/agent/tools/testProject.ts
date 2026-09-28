import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { RunCommandTool } from "./runCommand.js";
import type { Tool, ToolResult } from "../types.js";
import { ProjectWorkspace } from "./workspace.js";

export class TestProjectTool implements Tool {
  name = "testProject";
  description = "Runs the project's safest available automated checks and reports structured failures before Preview.";
  constructor(private readonly workspace: ProjectWorkspace) {}

  async execute(_input = "."): Promise<ToolResult> {
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
      const commands = ["test", "typecheck", "lint", "build"].filter((name) => typeof scripts[name] === "string");
      if (!commands.length) {

        return { success: true, output: "No automated test/typecheck/lint/build script is defined; project structure is valid for Preview." };
      }

      const results: string[] = [];
      for (const name of commands) {
        const result = await this.run(root, "npm", ["run", name], name);
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
      return { success: true, output: JSON.stringify({ status: "passed", stages: commands, results: results.map((item) => item.slice(-1800)) }) };
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

  private async run(cwd: string, command: string, args: string[], stage: string): Promise<ToolResult> {
    const runner = new RunCommandTool(cwd);
    const result = await runner.execute([command, ...args].join(" "));
    return {
      success: result.success,
      output: (stage + " exit=" + (result.exitCode ?? "unknown") + "\n" + result.stdout + "\n" + result.stderr).slice(-16000),
    };
  }
}
