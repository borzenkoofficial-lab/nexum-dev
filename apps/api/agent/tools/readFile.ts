import { readFile } from "node:fs/promises";
import type { Tool, ToolResult } from "../types.js";
import { ProjectWorkspace } from "./workspace.js";
export class ReadFileTool implements Tool {
  name="readFile"; description="Reads a text file from the active project. Path must be relative.";
  constructor(private readonly workspace: ProjectWorkspace) {}
  async execute(input:string):Promise<ToolResult>{
    try {
      let requestedPath = input.trim();
      // The planner contract documents a string input, but models sometimes
      // serialize the same request as {"path":"index.html"}. Accept both forms
      // so a harmless formatting difference cannot turn into an ENOENT.
      if (requestedPath.startsWith("{")) {
        const parsed = JSON.parse(requestedPath) as { path?: unknown };
        if (typeof parsed.path !== "string" || !parsed.path.trim()) {
          return { success:false, output:"readFile expects a relative path string or JSON: { path }" };
        }
        requestedPath = parsed.path;
      }
      const p=await this.workspace.existing(requestedPath);
      return {success:true,output:await readFile(p,"utf8")};
    } catch(error){
      return {success:false,output:error instanceof Error?error.message:"Unable to read file"};
    }
  }
}
