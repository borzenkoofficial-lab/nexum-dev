import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Tool, ToolResult } from "../types.js";
import { assertExistingProjectPath } from "./path.js";

const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist"]);

export class ListFilesTool implements Tool {
  name = "listFiles";
  description = "Lists project files and directories";

  constructor(private readonly projectRoot: string) {}

  async execute(input = "."): Promise<ToolResult> {
    try {
      const startPath = await assertExistingProjectPath(this.projectRoot, input || ".");
      const files: string[] = [];
      await this.collect(startPath, files);

      return { success: true, output: files.join("\n") || "Project directory is empty" };
    } catch (error) {
      return { success: false, output: this.errorMessage(error) };
    }
  }

  private async collect(directory: string, files: string[]): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;

      const entryPath = join(directory, entry.name);
      const relativePath = relative(this.projectRoot, entryPath);
      files.push(entry.isDirectory() ? `${relativePath}/` : relativePath);

      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await this.collect(entryPath, files);
      }
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Unable to list project files";
  }
}
