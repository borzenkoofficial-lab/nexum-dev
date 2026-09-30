import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

export interface ActionJournalEntry {
  timestamp: string;
  requestId?: string;
  agentRunId?: string;
  iteration: number;
  phase?: string;
  tool: string;
  input: string;
  success: boolean;
  durationMs?: number;
  errorCode?: string;
  retryable?: boolean;
  output: string;
}

export async function recordAction(root: string, entry: ActionJournalEntry): Promise<void> {
  const dir = resolve(root, ".nexum");
  await mkdir(dir, { recursive: true });
  const path = resolve(dir, "action-journal.jsonl");
  let existing = "";
  try { existing = await readFile(path, "utf8"); } catch {}
  const line = JSON.stringify({
    ...entry,
    input: entry.input.slice(0, 2000),
    output: entry.output.slice(0, 4000),
  });
  const lines = existing.split(/\r?\n/).filter(Boolean).slice(-499);
  lines.push(line);
  await writeFile(path, lines.join("\n") + "\n", "utf8");
}
