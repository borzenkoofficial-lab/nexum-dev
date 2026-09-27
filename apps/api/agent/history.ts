import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface AgentHistoryEntry {
  timestamp: string;
  type: string;
  jobId?: string;
  projectId?: string;
  provider?: string;
  model?: string;
  iteration?: number;
  tool?: string;
  status?: string;
  message?: string;
  output?: string;
}

const MAX_FIELD = 4000;
function compact(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return String(value).replace(/\s+/g, " ").trim().slice(0, MAX_FIELD);
}

export class AgentHistory {
  private readonly filePath: string;
  constructor(workspaceRoot: string) {
    this.filePath = resolve(workspaceRoot, "runtime", "agent-history.jsonl");
  }
  async record(entry: Omit<AgentHistoryEntry, "timestamp">): Promise<void> {
    const safe: AgentHistoryEntry = { timestamp: new Date().toISOString(), ...entry, message: compact(entry.message), output: compact(entry.output) };
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, JSON.stringify(safe) + "\n", "utf8");
  }
  async recent(limit = 200): Promise<AgentHistoryEntry[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return raw.split("\n").filter(Boolean).slice(-Math.max(1, Math.min(limit, 1000))).map((line) => JSON.parse(line) as AgentHistoryEntry);
    } catch { return []; }
  }
  getPath(): string { return this.filePath; }
}