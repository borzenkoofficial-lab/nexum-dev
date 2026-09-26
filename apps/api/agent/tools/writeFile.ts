import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";
import type { Tool, ToolResult } from "../types.js";
import { assertWritableProjectPath } from "./path.js";

export interface WriteFileRequest {
  path: string;
  content: string;
}

export class WriteFileTool implements Tool {
  name = "writeFile";
  description = "Creates or updates a text file inside the project";

  constructor(private readonly projectRoot: string) {}

  async execute(input: string): Promise<ToolResult> {
    try {
      const request = JSON.parse(input) as Partial<WriteFileRequest>;

      if (typeof request.path !== "string" || typeof request.content !== "string") {
        return { success: false, output: "writeFile expects JSON: { path, content }" };
      }

      const filePath = await assertWritableProjectPath(this.projectRoot, request.path);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, request.content, "utf8");

      return { success: true, output: `File written: ${relative(this.projectRoot, filePath)}` };
    } catch (error) {
      return {
        success: false,
        output: error instanceof Error ? error.message : "Unable to write file",
      };
    }
  }
}
