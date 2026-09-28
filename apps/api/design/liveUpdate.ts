import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

export interface LiveUpdateManifest {
  projectId: string;
  generatedAt: string;
  entry: string;
  buildReady: boolean;
  revision?: string;
}

export async function inspectLiveUpdate(projectRoot:string, projectId:string):Promise<LiveUpdateManifest> {
  const entry = resolve(projectRoot,"dist","index.html");
  let buildReady=false;
  try { await stat(entry); buildReady=true; } catch {}
  return {projectId,generatedAt:new Date().toISOString(),entry,buildReady};
}

export async function readLiveEntry(projectRoot:string):Promise<string|null> {
  try { return await readFile(resolve(projectRoot,"dist","index.html"),"utf8"); } catch { return null; }
}
