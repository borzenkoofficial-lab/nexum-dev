import type { AgentPhase, AgentToolResult, ProductPlan } from "./types.js";

export interface AgentTaskState {
  phase: AgentPhase;
  goal: string;
  startedAt: number;
  changeVersion: number;
  changedFiles: Set<string>;
  verified: {
    build: boolean;
    tests: boolean;
    staticValidation: boolean;
    domain: boolean;
    review: boolean;
  };
  verifiedAtChangeVersion: {
    build: number;
    tests: number;
    staticValidation: number;
    domain: number;
    review: number;
    reviewAttempted: number;
  };
}

export function createAgentTaskState(goal: string): AgentTaskState {
  return {
    phase: "analyze",
    goal,
    startedAt: Date.now(),
    changeVersion: 0,
    changedFiles: new Set<string>(),
    verified: {
      build: false,
      tests: false,
      staticValidation: false,
      domain: false,
      review: false,
    },
    verifiedAtChangeVersion: {
      build: -1,
      tests: -1,
      staticValidation: -1,
      domain: -1,
      review: -1,
    },
  };
}

export function recordSuccessfulChange(state: AgentTaskState, input: string): void {
  state.changeVersion += 1;
  state.verified.build = false;
  state.verified.tests = false;
  state.verified.staticValidation = false;
  state.verified.domain = false;
  state.verified.review = false;

  try {
    const parsed = JSON.parse(input) as { path?: unknown };
    if (typeof parsed.path === "string" && parsed.path.trim()) {
      state.changedFiles.add(parsed.path);
    }
  } catch {
    // Non-JSON tool input cannot identify a changed file.
  }
}

function isVerificationResult(item: AgentToolResult, tool: string): boolean {
  return item.result.success && item.tool === tool;
}

export function syncVerificationState(
  state: AgentTaskState,
  results: AgentToolResult[],
  productPlan?: ProductPlan | null,
): void {
  // Reconstruct the version attached to each historical result. A verification
  // only remains valid until the next successful write/patch.
  let version = 0;
  let buildVersion = -1;
  let testsVersion = -1;
  let staticValidationVersion = -1;
  let reviewVersion = -1;
  let reviewAttemptedVersion = -1;

  for (const item of results) {
    if (item.result.success && (item.tool === "writeFile" || item.tool === "patchFile")) {
      version += 1;
      continue;
    }

    if (isVerificationResult(item, "runCommand") || isVerificationResult(item, "runSandbox")) {
      if (/npm run build|build/i.test(item.input)) buildVersion = version;
    }
    if (isVerificationResult(item, "testProject")) testsVersion = version;
    if (isVerificationResult(item, "validateProject")) staticValidationVersion = version;
    if (item.tool === "productReview") {
      reviewAttemptedVersion = version;
      if (item.result.success && /product review passed|"passed"\s*[:=]\s*true|passed\s*[:=]\s*true/i.test(item.result.output)) {
        reviewVersion = version;
      }
    }
  }

  // The live task state's version is authoritative. Historical results may
  // contain writes performed outside this state helper, so never let the
  // reconstructed version move it backwards.
  state.changeVersion = Math.max(state.changeVersion, version);
  state.verifiedAtChangeVersion.build = buildVersion;
  state.verifiedAtChangeVersion.tests = testsVersion;
  state.verifiedAtChangeVersion.staticValidation = staticValidationVersion;
  state.verifiedAtChangeVersion.review = reviewVersion;
  state.verifiedAtChangeVersion.reviewAttempted = reviewAttemptedVersion;

  state.verified.build = buildVersion === state.changeVersion;
  state.verified.tests = testsVersion === state.changeVersion;
  state.verified.staticValidation = staticValidationVersion === state.changeVersion;
  state.verified.review = reviewVersion === state.changeVersion;

  // Domain verification is controlled by the loop because it depends on the
  // generated content and the original request, not merely a tool result.
  if (productPlan && productPlan.acceptanceCriteria.length === 0) {
    // Product-plan existence is deliberately not treated as verification.
  }
}

export function canFinishBuilder(
  state: AgentTaskState,
  _results: AgentToolResult[],
  hasBuildScript: boolean,
  isStaticProject: boolean,
): { ok: boolean; reason?: string } {
  if (state.changedFiles.size === 0) return { ok: false, reason: "No project files were changed." };
  if (hasBuildScript && state.verifiedAtChangeVersion.build !== state.changeVersion) {
    return { ok: false, reason: "Production build has not been verified after the latest changes." };
  }
  if (isStaticProject && state.verifiedAtChangeVersion.staticValidation !== state.changeVersion) {
    return { ok: false, reason: "Static project validation has not passed after the latest changes." };
  }
  if (state.verifiedAtChangeVersion.tests !== state.changeVersion) {
    return { ok: false, reason: "Project smoke tests have not passed after the latest changes." };
  }
  if (!state.verified.domain) {
    return { ok: false, reason: "Requested product domain has not been verified." };
  }
  if (state.verifiedAtChangeVersion.reviewAttempted === state.changeVersion &&
      state.verifiedAtChangeVersion.review !== state.changeVersion) {
    return { ok: false, reason: "Product review has not passed." };
  }
  return { ok: true };
}
