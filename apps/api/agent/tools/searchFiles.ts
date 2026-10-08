import { readFile,readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Tool,ToolResult } from "../types.js";
import { ProjectWorkspace } from "./workspace.js";
const IGNORED_DIRECTORIES=new Set([".git","node_modules","dist"]);
const SENSITIVE_FILE=/(^|\/)(?:\.env(?:\..*)?|.*(?:secret|credential|private[-_]?key|id_rsa).*)(?:$)/i;
export class SearchFilesTool implements Tool {
 name="searchFiles"; description="Searches text inside the active project.";
 constructor(private readonly workspace:ProjectWorkspace){}
 async execute(input:string, signal?:AbortSignal):Promise<ToolResult>{
  try{const q=input.trim();if(!q)return {success:false,output:"Search query is required"};if(q.length>500)return {success:false,output:"Search query is too long. Provide a short project-specific phrase (max 500 characters), not the full agent prompt."};if(/PROJECT CONTEXT LOCK:|LANGUAGE PROTOCOL:|You are the NEXUM/i.test(q))return {success:false,output:"Invalid search query. Provide only a concrete filename, UI term, business/domain phrase, or code symbol to search for."};const m:string[]=[];await this.search(this.workspace.root,q,m,signal);return {success:true,output:m.join("\n")||`No matches found for: ${q}`}}
  catch(error){return {success:false,output:error instanceof Error?error.message:"Unable to search files"}}
 }
 private async search(dir:string,q:string,m:string[],signal?:AbortSignal):Promise<void>{
  if(signal?.aborted)throw new DOMException("Aborted","AbortError");
  for(const e of await readdir(dir,{withFileTypes:true})){if(e.isDirectory()&&IGNORED_DIRECTORIES.has(e.name))continue;const p=join(dir,e.name);if(e.isDirectory()&&!e.isSymbolicLink()){await this.search(p,q,m,signal);continue}if(!e.isFile()||SENSITIVE_FILE.test(p))continue;const c=await readFile(p,"utf8").catch(()=>null);if(c===null||!c.includes(q))continue;const line=c.split(/\r?\n/).findIndex(v=>v.includes(q))+1;m.push(`${this.workspace.relative(p)}:${line}`)}
 }
}
