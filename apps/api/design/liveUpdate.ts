import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, relative } from "node:path";

export interface LiveUpdateManifest {
  projectId: string;
  generatedAt: string;
  entry: string;
  buildReady: boolean;
  mode: "built-app" | "static" | "missing";
  revision?: string;
  cssRevision?: string;
  appRevision?: string;
}

async function fileRevision(path: string): Promise<string | undefined> {
  try {
    const details = await stat(path);
    return `${Math.round(details.mtimeMs)}:${details.size}`;
  } catch {
    return undefined;
  }
}

async function directoryRevision(root: string): Promise<{ revision: string; cssRevision: string; appRevision: string }> {
  const rows: string[] = [];
  const css: string[] = [];
  const app: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === ".nexum" || entry.name === "node_modules" || entry.name === ".git") continue;
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      if (!/\.(css|js|mjs|html|json)$/i.test(entry.name)) continue;
      const revision = await fileRevision(path);
      if (!revision) continue;
      const key = relative(root, path).replaceAll("\\", "/");
      rows.push(`${key}=${revision}`);
      if (/\.css$/i.test(entry.name)) css.push(`${key}=${revision}`);
      else app.push(`${key}=${revision}`);
    }
  }

  await walk(root);
  rows.sort(); css.sort(); app.sort();
  return {
    revision: rows.join("|"),
    cssRevision: css.join("|"),
    appRevision: app.join("|"),
  };
}

export async function inspectLiveUpdate(projectRoot: string, projectId: string): Promise<LiveUpdateManifest> {
  const distRoot = resolve(projectRoot, "dist");
  const distEntry = resolve(distRoot, "index.html");
  const sourceEntry = resolve(projectRoot, "index.html");
  const distRevision = await fileRevision(distEntry);

  if (distRevision) {
    const revisions = await directoryRevision(distRoot);
    return {
      projectId,
      generatedAt: new Date().toISOString(),
      entry: distEntry,
      buildReady: true,
      mode: "built-app",
      revision: revisions.revision || distRevision,
      cssRevision: revisions.cssRevision,
      appRevision: revisions.appRevision,
    };
  }

  const sourceRevision = await fileRevision(sourceEntry);
  if (sourceRevision) {
    const revisions = await directoryRevision(projectRoot);
    return {
      projectId,
      generatedAt: new Date().toISOString(),
      entry: sourceEntry,
      buildReady: true,
      mode: "static",
      revision: revisions.revision || sourceRevision,
      cssRevision: revisions.cssRevision,
      appRevision: revisions.appRevision,
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
