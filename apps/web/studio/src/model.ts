/** Pure Studio logic (no React, no DOM) so it can be unit-tested with node --test. */

export interface FileNode {
  name: string;
  path: string;
  kind: "dir" | "file";
  children: FileNode[];
}

/** Builds a sorted tree (directories first) from flat project-relative paths. */
export function buildFileTree(paths: string[]): FileNode[] {
  const root: FileNode = { name: "", path: "", kind: "dir", children: [] };
  for (const raw of paths) {
    const parts = raw.replace(/\\/g, "/").split("/").filter(Boolean);
    let node = root;
    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;
      const path = parts.slice(0, index + 1).join("/");
      let child = node.children.find((item) => item.name === part && item.kind === (isFile ? "file" : "dir"));
      if (!child) {
        child = { name: part, path, kind: isFile ? "file" : "dir", children: [] };
        node.children.push(child);
      }
      node = child;
    });
  }
  const sort = (nodes: FileNode[]): FileNode[] => nodes
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1))
    .map((node) => ({ ...node, children: sort(node.children) }));
  return sort(root.children);
}

/** Directories that contain `path` (to auto-expand the tree to a selected file). */
export function ancestorDirs(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
}

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface JobEvent { id: number; timestamp: number; type: string; tool?: string; message: string }

export interface PendingApproval {
  id: string;
  toolName: string;
  risk: "READ" | "WRITE" | "EXECUTE" | "DESTRUCTIVE";
  inputPreview: string;
  status: "pending" | "approved" | "rejected" | "expired" | "cancelled";
  createdAt: number;
  expiresAt: number;
}

function parseApproval(value: unknown): PendingApproval | undefined {
  const item = value as Partial<PendingApproval> | null;
  if (!item || typeof item.id !== "string" || typeof item.toolName !== "string") return undefined;
  if (!["READ", "WRITE", "EXECUTE", "DESTRUCTIVE"].includes(String(item.risk))) return undefined;
  if (!["pending", "approved", "rejected", "expired", "cancelled"].includes(String(item.status))) return undefined;
  return {
    id: item.id,
    toolName: item.toolName,
    risk: item.risk as PendingApproval["risk"],
    inputPreview: typeof item.inputPreview === "string" ? item.inputPreview : "",
    status: item.status as PendingApproval["status"],
    createdAt: typeof item.createdAt === "number" ? item.createdAt : 0,
    expiresAt: typeof item.expiresAt === "number" ? item.expiresAt : 0,
  };
}

/** The approval the user must decide now, if any. */
export function activeApproval(job: JobSnapshot | null): PendingApproval | null {
  return job && job.status === "running" && job.pendingApproval?.status === "pending" ? job.pendingApproval : null;
}

export interface JobSnapshot {
  pendingApproval?: PendingApproval;
  id: string;
  status: JobStatus;
  stage?: string;
  currentMessage?: string;
  reply?: string;
  error?: string;
  errorInfo?: { message?: string; recoveryStrategy?: string };
  events: JobEvent[];
  steps: Array<{ tool: string; success: boolean }>;
  updatedAt: number;
}

export function isTerminal(status: JobStatus | undefined): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

/** Validates an SSE/REST job payload from the API; returns null for anything malformed. */
export function parseJobSnapshot(value: unknown): JobSnapshot | null {
  const job = value as Partial<JobSnapshot> | null;
  if (!job || typeof job.id !== "string" || !["queued", "running", "completed", "failed", "cancelled"].includes(String(job.status))) return null;
  const events = Array.isArray(job.events) ? job.events.filter((event): event is JobEvent => Boolean(event) && typeof (event as JobEvent).message === "string") : [];
  const steps = Array.isArray(job.steps) ? job.steps.filter((step): step is { tool: string; success: boolean } => Boolean(step) && typeof (step as { tool?: unknown }).tool === "string") : [];
  return {
    id: job.id,
    status: job.status as JobStatus,
    ...(typeof job.stage === "string" ? { stage: job.stage } : {}),
    ...(typeof job.currentMessage === "string" ? { currentMessage: job.currentMessage } : {}),
    ...(typeof job.reply === "string" ? { reply: job.reply } : {}),
    ...(typeof job.error === "string" ? { error: job.error } : {}),
    ...(job.errorInfo && typeof job.errorInfo === "object" ? { errorInfo: job.errorInfo } : {}),
    ...(parseApproval((job as { pendingApproval?: unknown }).pendingApproval) ? { pendingApproval: parseApproval((job as { pendingApproval?: unknown }).pendingApproval)! } : {}),
    events,
    steps,
    updatedAt: typeof job.updatedAt === "number" ? job.updatedAt : 0,
  };
}

export const PANE_LIMITS = { files: { min: 180, max: 480, initial: 248 }, agent: { min: 300, max: 640, initial: 380 } } as const;

export function clampPane(kind: keyof typeof PANE_LIMITS, width: number): number {
  const limits = PANE_LIMITS[kind];
  if (!Number.isFinite(width)) return limits.initial;
  return Math.round(Math.min(limits.max, Math.max(limits.min, width)));
}

/** API base: same origin by default; VITE_API_BASE_URL only for a separate Studio origin (not enabled yet). */
export function apiUrl(path: string, base = ""): string {
  if (!path.startsWith("/api/")) throw new Error(`Studio API paths must start with /api/: ${path}`);
  return base.replace(/\/$/, "") + path;
}
