import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { formatProjectUnderstanding, understandProject } from "../projects/projectUnderstanding.js";
import type { ProjectState } from "../projects/projectState.js";

export interface AgentContextSnapshot {
  task: string;
  knowledge: string;
  contracts: {
    operating: string;
    project: string;
    architecture: string;
    rules: string;
    role: string;
  };
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
  role = "general",
): Promise<AgentContextSnapshot> {
  const [knowledge, operating, project, architecture, rules, roleInstructions, stateRaw, journalRaw] = await Promise.all([
    optionalFile(root, ".nexum/knowledge.md"),
    optionalFile(root, ".nexum/AI.md"),
    optionalFile(root, ".nexum/PROJECT.md"),
    optionalFile(root, ".nexum/ARCHITECTURE.md"),
    optionalFile(root, ".nexum/RULES.md"),
    optionalFile(root, `.nexum/agents/${role}.md`),
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
    contracts: {
      operating: operating.slice(0, 7000),
      project: project.slice(0, 3500),
      architecture: architecture.slice(0, 3500),
      rules: rules.slice(0, 3500),
      role: roleInstructions.slice(0, 2500),
    },
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
    nexumContract: context.contracts.operating || "No NEXUM operating contract found.",
    projectContract: context.contracts.project || "No persistent project identity found.",
    architectureContract: context.contracts.architecture || "No persistent architecture contract found.",
    rulesContract: context.contracts.rules || "No persistent project rules found.",
    roleInstructions: context.contracts.role || "No role-specific instructions found.",
    projectUnderstanding: (() => { try { return JSON.parse(formatProjectUnderstanding(understandProject(state as unknown as ProjectState))); } catch { return { health: "unknown", risks: ["project understanding unavailable"] }; } })(),
    projectState: {
      projectType: state.projectType,
      framework: state.framework,
      entryFiles: Array.isArray(state.entryFiles) ? state.entryFiles.slice(0, 8) : [],
      buildCommand: state.buildCommand,
      previewMode: state.previewMode,
      currentGoal: state.currentGoal,
      intentDomain: state.intentDomain,
      intentProductType: state.intentProductType,
      intentAudience: state.intentAudience,
      intentConfidence: state.intentConfidence,
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
