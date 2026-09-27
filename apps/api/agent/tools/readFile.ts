import { readFile } from "node:fs/promises";
import type { Tool, ToolResult } from "../types.js";
import { ProjectWorkspace } from "./workspace.js";
export class ReadFileTool implements Tool {
  name="readFile"; description="Reads a text file from the active project. Path must be relative.";
  constructor(private readonly workspace: ProjectWorkspace) {}
  async execute(input:string):Promise<ToolResult>{
    try { const p=await this.workspace.existing(input); return {success:true,output:await readFile(p,"utf8")}; }
    catch(error){ return {success:false,output:error instanceof Error?error.message:"Unable to read file"}; }
  }
}
