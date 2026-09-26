import { readFile } from "node:fs/promises";
import type { Tool, ToolResult } from "../types.js";
import { assertExistingProjectPath } from "./path.js";

export class ReadFileTool implements Tool {
  name = "readFile";
  description = "Reads a text file from the project";

  constructor(private readonly projectRoot: string) {}

  async execute(input: string): Promise<ToolResult> {
    try {
      const filePath = await assertExistingProjectPath(this.projectRoot, input);
      const content = await readFile(filePath, "utf8");
      return { success: true, output: content };
    } catch (error) {
      return {
        success: false,
        output: error instanceof Error ? error.message : "Unable to read file",
      };
    }
  }
}
