import type { NexumIntent } from "./intentEngine.js";
import type { ProjectUnderstanding } from "../projects/projectUnderstanding.js";

export interface ContextCandidate {
  path: string;
  score: number;
  reason: string;
}

export interface SelectedContext {
  task: string;
  files: ContextCandidate[];
  routes: string[];
  architecture: string[];
  errors: string[];
  compactSummary: string;
  charCount: number;
}

export interface ContextSelectionOptions {
  maxFiles?: number;
  maxRoutes?: number;
  maxArchitecture?: number;
  maxErrors?: number;
  maxChars?: number;
}

const DEFAULTS: Required<ContextSelectionOptions> = {
  maxFiles: 12,
  maxRoutes: 12,
  maxArchitecture: 10,
  maxErrors: 8,
  maxChars: 8_000,
};

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-zа-яё0-9/._-]+/gi, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function scoreFile(path: string, taskTokens: Set<string>, intent: NexumIntent): ContextCandidate {
  const normalized = path.toLowerCase();
  const fileTokens = tokens(normalized);
  let score = 0;
  const reasons: string[] = [];

  if (/(^|\/)app\./i.test(path)) {
    score += 30;
    reasons.push("entry");
  }
  if (/(^|\/)(main|index)\./i.test(path)) {
    score += 20;
    reasons.push("bootstrap");
  }
  if (/package\.json|vite\.config|next\.config/i.test(path)) {
    score += 18;
    reasons.push("project-config");
  }
  if (/(route|page|layout|api|server|schema|model)/i.test(normalized)) {
    score += 12;
    reasons.push("architecture");
  }
  if (intent.domain !== "generic" && normalized.includes(intent.domain)) {
    score += 15;
    reasons.push("domain");
  }

  const overlap = fileTokens.filter((token) => taskTokens.has(token)).length;
  if (overlap) {
    score += Math.min(25, overlap * 5);
    reasons.push("task-match");
  }

  return { path, score, reason: reasons.join(",") || "project-file" };
}

export function selectContext(
  task: string,
  intent: NexumIntent,
  understanding: ProjectUnderstanding,
  options: ContextSelectionOptions = {},
): SelectedContext {
  const config = { ...DEFAULTS, ...options };
  const taskTokens = new Set(tokens(task));
  const candidates = understanding.relevantFiles
    .map((path) => scoreFile(path, taskTokens, intent))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, config.maxFiles);

  const routes = understanding.routes.slice(0, config.maxRoutes);
  const architecture = understanding.architecture.slice(0, config.maxArchitecture);
  const errors = understanding.risks
    .filter((risk) => /error|fail|risk|unknown|not identified|not defined/i.test(risk))
    .slice(0, config.maxErrors);

  const compact = {
    task: task.slice(0, 700),
    intent: {
      mode: intent.mode,
      domain: intent.domain,
      productType: intent.productType,
      audience: intent.audience,
      features: intent.features.slice(0, 8),
      constraints: intent.constraints.slice(0, 8),
    },
    project: {
      framework: understanding.framework,
      health: understanding.health,
      entryPoints: understanding.entryPoints.slice(0, 8),
      files: candidates,
      routes,
      architecture,
      risks: errors,
    },
  };

  let compactSummary = JSON.stringify(compact);
  if (compactSummary.length > config.maxChars) {
    const reduced = {
      ...compact,
      project: {
        ...compact.project,
        files: candidates.slice(0, Math.max(3, Math.floor(config.maxFiles / 2))),
        routes: routes.slice(0, Math.max(3, Math.floor(config.maxRoutes / 2))),
        architecture: architecture.slice(0, Math.max(3, Math.floor(config.maxArchitecture / 2))),
        risks: errors.slice(0, Math.max(2, Math.floor(config.maxErrors / 2))),
      },
    };
    compactSummary = JSON.stringify(reduced);
  }
  if (compactSummary.length > config.maxChars) {
    const minimal = {
      task: task.slice(0, 500),
      intent: {
        mode: intent.mode,
        domain: intent.domain,
        productType: intent.productType,
      },
      project: {
        framework: understanding.framework,
        health: understanding.health,
        entryPoints: understanding.entryPoints.slice(0, 4),
        files: candidates.slice(0, 4),
        routes: routes.slice(0, 4),
        architecture: architecture.slice(0, 4),
        risks: errors.slice(0, 2),
      },
    };
    compactSummary = JSON.stringify(minimal);
    if (compactSummary.length > config.maxChars) {
      compactSummary = JSON.stringify({
        intent: { mode: intent.mode, domain: intent.domain },
        project: { framework: understanding.framework, health: understanding.health },
      });
    }
    if (compactSummary.length > config.maxChars) {
      compactSummary = JSON.stringify({ intent: { domain: intent.domain } });
    }
  }
  // Keep the context structurally valid JSON even when a caller requests an
  // unusually small character budget. Never slice serialized JSON mid-token.

  return {
    task,
    files: candidates,
    routes,
    architecture,
    errors,
    compactSummary,
    charCount: compactSummary.length,
  };
}

export function contextForAgent(selected: SelectedContext): string {
  return [
    "COMPACT PROJECT CONTEXT:",
    selected.compactSummary,
    "Use only the listed project facts as context. Inspect files before editing if content is missing.",
  ].join("\n");
}
