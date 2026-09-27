import type { AgentPhase, AgentToolResult, ProductPlan } from "./types.js";

export interface AgentTaskState {
  phase: AgentPhase;
  goal: string;
  startedAt: number;
  changedFiles: Set<string>;
  verified: {
    build: boolean;
    tests: boolean;
    staticValidation: boolean;
    domain: boolean;
    review: boolean;
  };
}

export function createAgentTaskState(goal: string): AgentTaskState {
  return {
    phase: "analyze",
    goal,
    startedAt: Date.now(),
    changedFiles: new Set<string>(),
    verified: {
      build: false,
      tests: false,
      staticValidation: false,
      domain: false,
      review: false,
    },
  };
}

export function recordSuccessfulChange(state: AgentTaskState, input: string): void {
  try {
    const parsed = JSON.parse(input) as { path?: unknown };
    if (typeof parsed.path === "string" && parsed.path.trim()) state.changedFiles.add(parsed.path);
  } catch {
    // Non-JSON tool input cannot identify a changed file.
  }
}

export function syncVerificationState(
  state: AgentTaskState,
  results: AgentToolResult[],
  productPlan?: ProductPlan | null,
): void {
  state.verified.build = results.some(
    (item) =>
      item.result.success &&
      (item.tool === "runCommand" || item.tool === "runSandbox") &&
      /npm run build|build/i.test(item.input),
  );
  state.verified.tests = results.some(
    (item) => item.result.success && item.tool === "testProject",
  );
  state.verified.staticValidation = results.some(
    (item) => item.result.success && item.tool === "validateProject",
  );
  state.verified.review = results.some(
    (item) => item.result.success && item.tool === "productReview",
  );
  // Product-plan existence is deliberately not treated as verification.
  // Domain validation is set only by the loop after checking generated content.
  if (productPlan && productPlan.acceptanceCriteria.length === 0) {
    // Keep the field explicit without inventing acceptance success.
    state.verified.review = state.verified.review;
  }
}

export function canFinishBuilder(
  state: AgentTaskState,
  results: AgentToolResult[],
  hasBuildScript: boolean,
  isStaticProject: boolean,
): { ok: boolean; reason?: string } {
  if (state.changedFiles.size === 0) return { ok: false, reason: "No project files were changed." };
  if (hasBuildScript && !state.verified.build) return { ok: false, reason: "Production build has not been verified after the latest changes." };
  if (isStaticProject && !state.verified.staticValidation) return { ok: false, reason: "Static project validation has not passed." };
  if (!state.verified.tests) return { ok: false, reason: "Project smoke tests have not passed." };
  if (!state.verified.domain) return { ok: false, reason: "Requested product domain has not been verified." };
  if (state.verified.review === false && results.some((item) => item.tool === "productReview")) {
    return { ok: false, reason: "Product review has not passed." };
  }
  return { ok: true };
}
