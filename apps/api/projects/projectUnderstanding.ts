import type { ProjectState } from "./projectState.js";

export type ProjectHealth = "unknown" | "ready" | "attention";

export interface ProjectUnderstanding {
  projectId: string;
  projectType: ProjectState["projectType"];
  framework: string | null;
  health: ProjectHealth;
  entryPoints: string[];
  relevantFiles: string[];
  scripts: string[];
  dependencies: string[];
  routes: string[];
  architecture: string[];
  designSystem: string[];
  domain: {
    value: string;
    productType: string;
    audience: string;
    confidence: number;
  };
  risks: string[];
}

const PRIORITY_FILE = /^(src\/(App|main|index)\.(tsx?|jsx?|css)|app\/.*\.(tsx?|jsx?)|pages\/.*\.(tsx?|jsx?)|index\.html|package\.json|vite\.config\.[cm]?[jt]s|next\.config\.[cm]?[jt]s)$/i;

export function understandProject(state: ProjectState): ProjectUnderstanding {
  const existing = state.existingFiles ?? [];
  const entryPoints = state.entryFiles?.length
    ? state.entryFiles
    : existing.filter((file) => /(^|\/)(index|main|App)\.(tsx?|jsx?|html)$/i.test(file)).slice(0, 12);

  const relevantFiles = existing
    .filter((file) => PRIORITY_FILE.test(file))
    .slice(0, 80);

  const risks: string[] = [];
  if (!state.framework) risks.push("framework not identified");
  if (!state.buildCommand) risks.push("build script is not defined");
  if (state.knownErrors?.length) risks.push(`${state.knownErrors.length} known error(s)`);
  if (state.previewMode === "unknown") risks.push("preview mode is not established");
  if (state.intentConfidence < 0.55 && state.currentGoal) risks.push("product intent has low confidence");

  const health: ProjectHealth = risks.length === 0 ? "ready" : state.knownErrors?.length ? "attention" : "unknown";

  return {
    projectId: state.projectId,
    projectType: state.projectType,
    framework: state.framework,
    health,
    entryPoints,
    relevantFiles,
    scripts: state.buildCommand ? ["build"] : [],
    dependencies: (state.dependencies ?? []).slice(0, 80),
    routes: (state.routes ?? []).slice(0, 40),
    architecture: (state.architecture ?? []).slice(0, 40),
    designSystem: (state.designSystem ?? []).slice(0, 20),
    domain: {
      value: state.intentDomain ?? "generic",
      productType: state.intentProductType ?? "digital product",
      audience: state.intentAudience ?? "product users",
      confidence: state.intentConfidence ?? 0,
    },
    risks,
  };
}

export function formatProjectUnderstanding(understanding: ProjectUnderstanding): string {
  return JSON.stringify({
    projectId: understanding.projectId,
    projectType: understanding.projectType,
    framework: understanding.framework,
    health: understanding.health,
    entryPoints: understanding.entryPoints,
    relevantFiles: understanding.relevantFiles,
    dependencies: understanding.dependencies,
    routes: understanding.routes,
    domain: understanding.domain,
    risks: understanding.risks,
  });
}
