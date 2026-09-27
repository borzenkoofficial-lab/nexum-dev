import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Tool, ToolResult } from "../types.js";
import { ProjectWorkspace } from "./workspace.js";

export interface WriteFileRequest { path: string; content: string; }

export class WriteFileTool implements Tool {
  name = "writeFile";
  description = "Creates or updates a text file inside the active project. Path must be relative.";
  constructor(private readonly workspace: ProjectWorkspace) {}
  async execute(input: string): Promise<ToolResult> {
    try {
      const request = JSON.parse(input) as Partial<WriteFileRequest>;
      if (typeof request.path !== "string" || typeof request.content !== "string") return { success:false, output:"writeFile expects JSON: { path, content }" };
      const filePath = await this.workspace.writable(request.path);
      await mkdir(dirname(filePath), { recursive:true });
      await writeFile(filePath, request.content, "utf8");
      return { success:true, output:`File written: ${this.workspace.relative(filePath)}` };
    } catch (error) { return { success:false, output:error instanceof Error ? error.message : "Unable to write file" }; }
  }
}
