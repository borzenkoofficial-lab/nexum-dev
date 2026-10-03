import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import type { Tool, ToolResult } from "../types.js";
import { ProjectWorkspace } from "./workspace.js";

export class ValidateProjectTool implements Tool {
  name = "validateProject";
  description = "Performs lightweight static validation of project files before Preview.";
  constructor(private readonly workspace: ProjectWorkspace) {}

  async execute(_input = ".", signal?: AbortSignal): Promise<ToolResult> {
    try {
      const root = await this.workspace.existing(".");
      const files: string[] = [];
      await this.collect(root, files, signal);

      const problems: string[] = [];
      for (const file of files) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const relative = this.workspace.relative(file);
        const extension = extname(file).toLowerCase();
        if (![".html", ".css", ".js", ".mjs", ".cjs", ".json"].includes(extension)) continue;

        const source = await readFile(file, "utf8");

        if (extension === ".json") {
          try {
            JSON.parse(source);
          } catch (error) {
            problems.push(`${relative}: invalid JSON — ${error instanceof Error ? error.message : "parse error"}`);
          }
        }

        if (extension === ".html") {
          if (!/^\s*<!doctype html>/i.test(source)) problems.push(`${relative}: missing HTML5 doctype`);
          if (!/<html[\s>]/i.test(source) || !/<body[\s>]/i.test(source)) problems.push(`${relative}: missing html/body element`);
          if (/content=["']?width=["']/i.test(source) || /initial-scale=["'][^"']*["'][^=]*=/i.test(source)) {
            problems.push(`${relative}: malformed viewport meta tag`);
          }
          if ((source.match(/<script\b/gi) ?? []).length !== (source.match(/<\/script>/gi) ?? []).length) {
            problems.push(`${relative}: unbalanced script tags`);
          }
        }

        if (extension === ".css" && !this.balanced(source, "{", "}")) {
          problems.push(`${relative}: unbalanced CSS braces`);
        }

        if ([".js", ".mjs", ".cjs"].includes(extension) && !this.balanced(source, "{", "}")) {
          problems.push(`${relative}: unbalanced JavaScript braces`);
        }
      }

      if (problems.length) {
        return { success: false, output: JSON.stringify({ problems: problems.slice(0, 30) }) };
      }
      return { success: true, output: `Static validation passed for ${files.length} project files.` };
    } catch (error) {
      return { success: false, output: error instanceof Error ? error.message : "Project validation failed" };
    }
  }

  private balanced(source: string, open: string, close: string): boolean {
    let depth = 0;
    let quote: string | null = null;
    let escaped = false;
    for (const char of source) {
      if (escaped) { escaped = false; continue; }
      if (char === "\\") { escaped = true; continue; }
      if (quote) {
        if (char === quote) quote = null;
        continue;
      }
      if (char === '"' || char === "'" || char === "`") { quote = char; continue; }
      if (char === open) depth += 1;
      if (char === close) depth -= 1;
      if (depth < 0) return false;
    }
    return depth === 0 && quote === null;
  }

  private async collect(dir: string, files: string[], signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if ([".git", "node_modules", "dist", ".nexum"].includes(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await this.collect(path, files, signal);
      else files.push(path);
    }
  }
}
