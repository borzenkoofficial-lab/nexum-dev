import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Tool, ToolResult } from "../types.js";
import { ProjectWorkspace } from "./workspace.js";
const IGNORED_DIRECTORIES=new Set([".git","node_modules","dist"]);
export class ListFilesTool implements Tool {
 name="listFiles"; description="Lists files inside the active project.";
 constructor(private readonly workspace:ProjectWorkspace){}
 async execute(input=".", signal?:AbortSignal):Promise<ToolResult>{
  try{if(signal?.aborted)throw new DOMException("Aborted","AbortError");const start=await this.workspace.existing(input||".");const files:string[]=[];await this.collect(start,files,signal);return {success:true,output:files.join("\n")||"Project directory is empty"}}
  catch(error){return {success:false,output:error instanceof Error?error.message:"Unable to list project files"}}
 }
 private async collect(dir:string,files:string[],signal?:AbortSignal):Promise<void>{
  if(signal?.aborted)throw new DOMException("Aborted","AbortError");
  for(const entry of await readdir(dir,{withFileTypes:true})){
   if(entry.isDirectory()&&IGNORED_DIRECTORIES.has(entry.name))continue;
   const p=join(dir,entry.name);files.push(entry.isDirectory()?`${this.workspace.relative(p)}/`:this.workspace.relative(p));
   if(entry.isDirectory()&&!entry.isSymbolicLink())await this.collect(p,files,signal);
  }
 }
}
