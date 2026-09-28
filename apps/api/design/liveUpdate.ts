import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

export interface LiveUpdateManifest {
  projectId: string;
  generatedAt: string;
  entry: string;
  buildReady: boolean;
  mode: "built-app" | "static" | "missing";
  revision?: string;
}

async function fileRevision(path: string): Promise<string | undefined> {
  try {
    const details = await stat(path);
    return `${Math.round(details.mtimeMs)}:${details.size}`;
  } catch {
    return undefined;
  }
}

export async function inspectLiveUpdate(projectRoot: string, projectId: string): Promise<LiveUpdateManifest> {
  const distEntry = resolve(projectRoot, "dist", "index.html");
  const sourceEntry = resolve(projectRoot, "index.html");
  const distRevision = await fileRevision(distEntry);

  if (distRevision) {
    return {
      projectId,
      generatedAt: new Date().toISOString(),
      entry: distEntry,
      buildReady: true,
      mode: "built-app",
      revision: distRevision,
    };
  }

  const sourceRevision = await fileRevision(sourceEntry);
  if (sourceRevision) {
    return {
      projectId,
      generatedAt: new Date().toISOString(),
      entry: sourceEntry,
      buildReady: true,
      mode: "static",
      revision: sourceRevision,
    };
  }

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    entry: distEntry,
    buildReady: false,
    mode: "missing",
  };
}

export async function readLiveEntry(projectRoot: string): Promise<string | null> {
  for (const candidate of [
    resolve(projectRoot, "dist", "index.html"),
    resolve(projectRoot, "index.html"),
  ]) {
    try {
      return await readFile(candidate, "utf8");
    } catch {
      // Try the next supported preview entry.
    }
  }
  return null;
}
