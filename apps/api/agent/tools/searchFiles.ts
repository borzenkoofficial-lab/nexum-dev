import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Tool, ToolResult } from "../types.js";
import { resolveProjectPath } from "./path.js";

const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist"]);

export class SearchFilesTool implements Tool {
  name = "searchFiles";
  description = "Searches text inside project files";

  constructor(private readonly projectRoot: string) {}

  async execute(input: string): Promise<ToolResult> {
    try {
      const query = input.trim();
      if (!query) return { success: false, output: "Search query is required" };

      const matches: string[] = [];
      await this.searchDirectory(this.projectRoot, query, matches);
      return {
        success: true,
        output: matches.join("\n") || `No matches found for: ${query}`,
      };
    } catch (error) {
      return {
        success: false,
        output: error instanceof Error ? error.message : "Unable to search files",
      };
    }
  }

  private async searchDirectory(directory: string, query: string, matches: string[]): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;

      const entryPath = join(directory, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await this.searchDirectory(entryPath, query, matches);
        continue;
      }

      if (!entry.isFile()) continue;

      const content = await readFile(entryPath, "utf8").catch(() => null);
      if (content === null || !content.includes(query)) continue;

      const line = content.split(/\r?\n/).findIndex((value) => value.includes(query)) + 1;
      matches.push(`${relative(this.projectRoot, entryPath)}:${line}`);
    }
  }
}
