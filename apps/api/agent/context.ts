import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface AgentContextSnapshot {
  knowledge: string;
  state: Record<string, unknown>;
  recentErrors: string[];
}

async function optionalFile(root: string, path: string): Promise<string> {
  try { return await readFile(resolve(root, path), "utf8"); } catch { return ""; }
}

export async function buildAgentContext(
  root: string,
  history: Array<{ tool: string; success: boolean; output: string }>,
): Promise<AgentContextSnapshot> {
  const [knowledge, stateRaw] = await Promise.all([
    optionalFile(root, ".nexum/knowledge.md"),
    optionalFile(root, ".nexum/state.json"),
  ]);
  let state: Record<string, unknown> = {};
  try { state = stateRaw ? JSON.parse(stateRaw) : {}; } catch {}
  return {
    knowledge: knowledge.slice(0, 6000),
    state,
    recentErrors: history.filter((item) => !item.success).slice(-4).map((item) => item.tool + ": " + item.output.slice(0, 700)),
  };
}

export function formatAgentContext(context: AgentContextSnapshot): string {
  return JSON.stringify({
    projectKnowledge: context.knowledge || "No persistent project knowledge.",
    projectState: {
      projectType: context.state.projectType,
      framework: context.state.framework,
      entryFiles: context.state.entryFiles,
      buildCommand: context.state.buildCommand,
      previewMode: context.state.previewMode,
      currentGoal: context.state.currentGoal,
      changedFiles: context.state.changedFiles,
      routes: context.state.routes,
      designSystem: context.state.designSystem,
    },
    recentErrors: context.recentErrors,
  });
}
