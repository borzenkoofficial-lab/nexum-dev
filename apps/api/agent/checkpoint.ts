import { mkdir, readdir, readFile, rm, stat, writeFile, cp, rename } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { diffText, type DiffHunk } from "./textDiff.js";

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
  if (typeof path !== "string" || !path || path.includes("\0")) {
    throw new Error("Invalid checkpoint path");
  }
  const normalized = path.replaceAll("\\", "/");
  if (
    normalized !== path ||
    normalized.startsWith("/") ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Invalid checkpoint path");
  }
  const firstSegment = normalized.split("/")[0];
  if (firstSegment && EXCLUDED.has(firstSegment)) {
    throw new Error("Checkpoint cannot access protected project directories");
  }
}

function validateCheckpointManifest(value: unknown, projectId: string, checkpointId: string): ProjectCheckpoint {
  if (!value || typeof value !== "object") throw new Error("Invalid checkpoint manifest");
  const manifest = value as Partial<ProjectCheckpoint>;
  if (
    manifest.id !== checkpointId ||
    manifest.projectId !== projectId ||
    typeof manifest.createdAt !== "string" ||
    typeof manifest.label !== "string" ||
    !Array.isArray(manifest.files) ||
    manifest.files.length > MAX_FILES
  ) {
    throw new Error("Invalid checkpoint manifest");
  }

  const seen = new Set<string>();
  let totalBytes = 0;
  for (const file of manifest.files) {
    if (!file || typeof file.path !== "string" || !Number.isSafeInteger(file.size) || file.size < 0) {
      throw new Error("Invalid checkpoint manifest file entry");
    }
    assertSafeRelativePath(file.path);
    if (seen.has(file.path)) throw new Error("Checkpoint manifest contains duplicate paths");
    seen.add(file.path);
    totalBytes += file.size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_BYTES) {
      throw new Error("Checkpoint exceeds the 100 MB safety limit");
    }
  }
  return manifest as ProjectCheckpoint;
}

export type FileChangeStatus = "added" | "modified" | "deleted";

export interface FileChange {
  path: string;
  status: FileChangeStatus;
  binary: boolean;
  /** Too big or too different to render line by line; counts may be unknown. */
  omitted: boolean;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface CheckpointDiff {
  checkpointId: string;
  createdAt: string;
  files: FileChange[];
  totals: { files: number; additions: number; deletions: number };
  /** More changed files than MAX_DIFF_FILES; only the first ones are listed. */
  truncated: boolean;
}

export const MAX_DIFF_FILES = 200;
const MAX_DIFF_FILE_BYTES = 256 * 1024;

function looksBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 8192).includes(0);
}

function describeChange(path: string, status: FileChangeStatus, before: Buffer | null, after: Buffer | null): FileChange {
  const binary = Boolean((before && looksBinary(before)) || (after && looksBinary(after)));
  const tooBig = (before?.length ?? 0) > MAX_DIFF_FILE_BYTES || (after?.length ?? 0) > MAX_DIFF_FILE_BYTES;
  if (binary || tooBig) return { path, status, binary, omitted: true, additions: 0, deletions: 0, hunks: [] };
  const diff = diffText(before?.toString("utf8") ?? "", after?.toString("utf8") ?? "");
  return { path, status, binary: false, omitted: diff.tooComplex, additions: diff.additions, deletions: diff.deletions, hunks: diff.hunks };
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

  async writeExecutionState(projectId: string, projectPath: string, checkpointId: string, state: unknown): Promise<void> {
    if (!/^[a-z0-9-]+$/i.test(checkpointId)) throw new Error("Invalid checkpoint id");
    const checkpointRoot = resolve(this.root(projectPath), checkpointId);
    const rawManifest: unknown = JSON.parse(await readFile(resolve(checkpointRoot, "manifest.json"), "utf8"));
    validateCheckpointManifest(rawManifest, projectId, checkpointId);
    const temp = resolve(checkpointRoot, `agent-state.tmp-${process.pid}-${randomUUID()}`);
    const target = resolve(checkpointRoot, "agent-state.json");
    await writeFile(temp, JSON.stringify(state, null, 2), "utf8");
    await rename(temp, target);
  }

  async readExecutionState(projectId: string, projectPath: string, checkpointId: string): Promise<unknown | null> {
    if (!/^[a-z0-9-]+$/i.test(checkpointId)) throw new Error("Invalid checkpoint id");
    const checkpointRoot = resolve(this.root(projectPath), checkpointId);
    try {
      const rawManifest: unknown = JSON.parse(await readFile(resolve(checkpointRoot, "manifest.json"), "utf8"));
      validateCheckpointManifest(rawManifest, projectId, checkpointId);
      const rawState = await readFile(resolve(checkpointRoot, "agent-state.json"), "utf8");
      const parsed: unknown = JSON.parse(rawState);
      if (!parsed || typeof parsed !== "object") throw new Error("Invalid persisted Agent execution state");
      return parsed;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      throw error;
    }
  }
  /** What changed in the project since the checkpoint (snapshot vs current files). Read-only. */
  async diff(projectId: string, projectPath: string, checkpointId: string): Promise<CheckpointDiff> {
    if (!/^[a-z0-9-]+$/i.test(checkpointId)) throw new Error("Invalid checkpoint id");
    const checkpointRoot = resolve(this.root(projectPath), checkpointId);
    const rawManifest: unknown = JSON.parse(await readFile(resolve(checkpointRoot, "manifest.json"), "utf8"));
    const checkpoint = validateCheckpointManifest(rawManifest, projectId, checkpointId);
    const current = await collectFiles(projectPath);
    const before = new Map(checkpoint.files.map((file) => [file.path, file]));
    const after = new Map(current.map((file) => [file.path, file]));
    const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
    const changes: FileChange[] = [];
    let truncated = false;
    for (const path of paths) {
      assertSafeRelativePath(path);
      const inBefore = before.has(path);
      const inAfter = after.has(path);
      const beforeBytes = inBefore ? await readFile(resolve(checkpointRoot, path)) : null;
      const afterBytes = inAfter ? await readFile(resolve(projectPath, path)) : null;
      if (beforeBytes && afterBytes && beforeBytes.equals(afterBytes)) continue;
      if (changes.length >= MAX_DIFF_FILES) { truncated = true; break; }
      changes.push(describeChange(path, !inBefore ? "added" : !inAfter ? "deleted" : "modified", beforeBytes, afterBytes));
    }
    return {
      checkpointId,
      createdAt: checkpoint.createdAt,
      files: changes,
      totals: {
        files: changes.length,
        additions: changes.reduce((sum, item) => sum + item.additions, 0),
        deletions: changes.reduce((sum, item) => sum + item.deletions, 0),
      },
      truncated,
    };
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
    const rawManifest: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
    const checkpoint = validateCheckpointManifest(rawManifest, projectId, checkpointId);

    // Validate every snapshot source before changing the live project. A damaged
    // manifest must never cause a partial destructive rollback.
    for (const file of checkpoint.files) {
      const source = resolve(checkpointRoot, file.path);
      const relativeSource = relative(checkpointRoot, source);
      if (relativeSource.startsWith("..") || relativeSource === "" || relativeSource.startsWith(sep)) {
        throw new Error("Checkpoint file escapes its snapshot directory");
      }
      const details = await stat(source);
      if (!details.isFile() || details.size !== file.size) {
        throw new Error(`Checkpoint file is missing or has changed: ${file.path}`);
      }
    }

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
