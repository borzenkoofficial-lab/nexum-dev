import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface AgentContextSnapshot {
  task: string;
  knowledge: string;
  state: Record<string, unknown>;
  recentErrors: string[];
  recentActions: Array<{
    iteration: number;
    tool: string;
    success: boolean;
    summary: string;
  }>;
}

async function optionalFile(root: string, path: string): Promise<string> {
  try {
    return await readFile(resolve(root, path), "utf8");
  } catch {
    return "";
  }
}

function parseState(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseJournal(raw: string): AgentContextSnapshot["recentActions"] {
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-12)
    .map((line) => {
      try {
        const item = JSON.parse(line) as Record<string, unknown>;
        return {
          iteration: typeof item.iteration === "number" ? item.iteration : 0,
          tool: typeof item.tool === "string" ? item.tool : "unknown",
          success: item.success === true,
          summary: String(item.output ?? "").replace(/\s+/g, " ").slice(0, 420),
        };
      } catch {
        return null;
      }
    })
    .filter((item): item is AgentContextSnapshot["recentActions"][number] => item !== null);
}

export async function buildAgentContext(
  root: string,
  history: Array<{ tool: string; success: boolean; output: string }>,
  task = "",
): Promise<AgentContextSnapshot> {
  const [knowledge, stateRaw, journalRaw] = await Promise.all([
    optionalFile(root, ".nexum/knowledge.md"),
    optionalFile(root, ".nexum/state.json"),
    optionalFile(root, ".nexum/action-journal.jsonl"),
  ]);

  const state = parseState(stateRaw);
  const recentActions = parseJournal(journalRaw);
  const recentErrors = [
    ...history.filter((item) => !item.success).map((item) => item.tool + ": " + item.output.slice(0, 700)),
    ...recentActions
      .filter((item) => !item.success)
      .map((item) => item.tool + ": " + item.summary),
  ].slice(-6);

  return {
    task: task.slice(0, 3000),
    knowledge: knowledge.slice(0, 6000),
    state,
    recentErrors,
    recentActions,
  };
}

export function formatAgentContext(context: AgentContextSnapshot): string {
  const state = context.state;
  return JSON.stringify({
    task: context.task || "Current task unavailable.",
    projectKnowledge: context.knowledge || "No persistent project knowledge.",
    projectState: {
      projectType: state.projectType,
      framework: state.framework,
      entryFiles: Array.isArray(state.entryFiles) ? state.entryFiles.slice(0, 8) : [],
      buildCommand: state.buildCommand,
      previewMode: state.previewMode,
      currentGoal: state.currentGoal,
      changedFiles: Array.isArray(state.changedFiles) ? state.changedFiles.slice(-12) : [],
      knownErrors: Array.isArray(state.knownErrors) ? state.knownErrors.slice(-6) : [],
      lastSuccessfulBuildAt: state.lastSuccessfulBuildAt,
      lastFailedTool: state.lastFailedTool,
      routes: Array.isArray(state.routes) ? state.routes.slice(0, 12) : [],
      designSystem: Array.isArray(state.designSystem) ? state.designSystem.slice(0, 8) : [],
    },
    recentErrors: context.recentErrors,
    recentActions: context.recentActions,
  });
}
