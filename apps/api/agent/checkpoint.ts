import { mkdir, readdir, readFile, rm, stat, writeFile, cp } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

export interface CheckpointFile {
  path: string;
  size: number;
}

export interface ProjectCheckpoint {
  id: string;
  projectId: string;
  createdAt: string;
  label: string;
  files: CheckpointFile[];
}

const EXCLUDED = new Set([".git", "node_modules", "dist", ".nexum"]);
const MAX_FILES = 5000;
const MAX_BYTES = 100 * 1024 * 1024;

async function collectFiles(root: string, current = root, output: CheckpointFile[] = []): Promise<CheckpointFile[]> {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDED.has(entry.name)) continue;
    const absolute = resolve(current, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(root, absolute, output);
    } else if (entry.isFile()) {
      const details = await stat(absolute);
      output.push({ path: relative(root, absolute).split(sep).join("/"), size: details.size });
    }
  }
  return output;
}

function assertSafeRelativePath(path: string): void {
  const normalized = path.replaceAll("\\\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new Error("Invalid checkpoint path");
  }
  if (EXCLUDED.has(normalized.split("/")[0])) {
    throw new Error("Checkpoint cannot access protected project directories");
  }
}

export class CheckpointManager {
  private root(projectPath: string): string {
    return resolve(projectPath, ".nexum", "checkpoints");
  }

  async create(projectId: string, projectPath: string, label = "checkpoint"): Promise<ProjectCheckpoint> {
    const id = Date.now().toString(36) + "-" + randomUUID().slice(0, 8);
    const checkpointRoot = resolve(this.root(projectPath), id);
    await mkdir(checkpointRoot, { recursive: true });

    const files = await collectFiles(projectPath);
    if (files.length > MAX_FILES) throw new Error("Checkpoint exceeds the 5000 file safety limit");
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > MAX_BYTES) throw new Error("Checkpoint exceeds the 100 MB safety limit");
    for (const file of files) {
      assertSafeRelativePath(file.path);
      const source = resolve(projectPath, file.path);
      const target = resolve(checkpointRoot, file.path);
      await mkdir(dirname(target), { recursive: true });
      await cp(source, target, { force: true });
    }

    const checkpoint: ProjectCheckpoint = {
      id,
      projectId,
      createdAt: new Date().toISOString(),
      label: label.trim().slice(0, 120) || "checkpoint",
      files,
    };
    await writeFile(resolve(checkpointRoot, "manifest.json"), JSON.stringify(checkpoint, null, 2), "utf8");
    return checkpoint;
  }

  async list(projectId: string, projectPath: string): Promise<ProjectCheckpoint[]> {
    const root = this.root(projectPath);
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    const checkpoints: ProjectCheckpoint[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const manifest = JSON.parse(await readFile(resolve(root, entry.name, "manifest.json"), "utf8")) as ProjectCheckpoint;
        if (manifest.projectId === projectId) checkpoints.push(manifest);
      } catch {
        // Ignore incomplete checkpoints.
      }
    }
    return checkpoints.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async rollback(projectId: string, projectPath: string, checkpointId: string): Promise<ProjectCheckpoint> {
    if (!/^[a-z0-9-]+$/i.test(checkpointId)) throw new Error("Invalid checkpoint id");
    const checkpointRoot = resolve(this.root(projectPath), checkpointId);
    const manifestPath = resolve(checkpointRoot, "manifest.json");
    const checkpoint = JSON.parse(await readFile(manifestPath, "utf8")) as ProjectCheckpoint;
    if (checkpoint.projectId !== projectId) throw new Error("Checkpoint does not belong to this project");

    const currentFiles = await collectFiles(projectPath);
    const snapshotFiles = new Set(checkpoint.files.map((file) => file.path));

    for (const file of currentFiles) {
      assertSafeRelativePath(file.path);
      if (!snapshotFiles.has(file.path)) {
        await rm(resolve(projectPath, file.path), { force: true });
      }
    }

    for (const file of checkpoint.files) {
      assertSafeRelativePath(file.path);
      const source = resolve(checkpointRoot, file.path);
      const target = resolve(projectPath, file.path);
      await mkdir(dirname(target), { recursive: true });
      await cp(source, target, { force: true });
    }

    return checkpoint;
  }
}
