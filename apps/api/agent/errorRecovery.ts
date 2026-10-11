export type ErrorCategory =
  | "typescript"
  | "syntax"
  | "dependency"
  | "build"
  | "runtime"
  | "path"
  | "tool"
  | "network"
  | "permission"
  | "validation"
  | "cancellation"
  | "timeout"
  | "unknown";

export type RecoveryAction =
  | "stop"
  | "request_authorization"
  | "inspect_cleanup"
  | "bounded_retry_if_transient"
  | "bounded_retry_or_provider_fallback"
  | "inspect_provider_status"
  | "inspect_evidence"
  | "targeted_repair"
  | "rerun_relevant_validation"
  | "inspect_manifest_lockfile"
  | "minimal_dependency_repair"
  | "rerun_install_or_build"
  | "inspect_project_tree"
  | "correct_relative_path"
  | "validate_tool_input"
  | "choose_allowed_alternative"
  | "inspect_failed_criteria"
  | "rerun_validation"
  | "gather_relevant_context"
  | "choose_low_risk_action";

const RECOVERY_ACTIONS_BY_CATEGORY: Record<ErrorCategory, RecoveryAction[]> = {
  cancellation: ["stop"],
  permission: ["stop", "request_authorization"],
  timeout: ["inspect_cleanup", "bounded_retry_if_transient"],
  network: ["bounded_retry_or_provider_fallback", "inspect_provider_status"],
  typescript: ["inspect_evidence", "targeted_repair", "rerun_relevant_validation"],
  syntax: ["inspect_evidence", "targeted_repair", "rerun_relevant_validation"],
  runtime: ["inspect_evidence", "targeted_repair", "rerun_relevant_validation"],
  build: ["inspect_evidence", "targeted_repair", "rerun_relevant_validation"],
  dependency: ["inspect_manifest_lockfile", "minimal_dependency_repair", "rerun_install_or_build"],
  path: ["inspect_project_tree", "correct_relative_path"],
  tool: ["validate_tool_input", "choose_allowed_alternative"],
  validation: ["inspect_failed_criteria", "targeted_repair", "rerun_validation"],
  unknown: ["inspect_evidence", "gather_relevant_context", "choose_low_risk_action"],
};

/** Returns a deterministic, ordered recovery plan; earlier actions have higher priority. */
export function getPrioritizedRecoveryActions(category: ErrorCategory): RecoveryAction[] {
  return [...RECOVERY_ACTIONS_BY_CATEGORY[category]];
}

export interface ErrorDiagnosis {
  category: ErrorCategory;
  /** Priority 1 is highest urgency; 4 is lowest. */
  priority: number;
  summary: string;
  evidence: string;
  likelyFiles: string[];
  strategy: string;
  recoveryActions: RecoveryAction[];
}

function createDiagnosis(
  category: ErrorCategory,
  priority: number,
  summary: string,
  evidence: string,
  likelyFiles: string[],
  strategy: string,
): ErrorDiagnosis {
  const recoveryActions = getPrioritizedRecoveryActions(category);
  const orderedActions = recoveryActions.join(" → ");
  return {
    category,
    priority,
    summary,
    evidence,
    likelyFiles,
    recoveryActions,
    strategy: `${strategy} Prioritized recovery actions (in order): ${orderedActions}.`,
  };
}

export function diagnoseError(output: string): ErrorDiagnosis {
  const text = output.slice(-12000);
  const fileMatches = [...text.matchAll(/(?:^|\\s)([A-Za-z0-9_.-]+\\/(?:[A-Za-z0-9_./-]+)|(?:src|app|pages)\\/[A-Za-z0-9_./-]+):\\d+(?::\\d+)?/g)]
    .map((match) => match[1])
    .filter(Boolean);
  const likelyFiles = [...new Set(fileMatches.filter((file): file is string => Boolean(file)))].slice(0, 8);
  const evidence = text.slice(-1600);

  if (/(?:aborterror|cancelled|canceled|cancel)/i.test(text)) {
    return createDiagnosis("cancellation", 1, "Agent execution cancelled", evidence, likelyFiles, "Do not retry or repair a cancelled operation; stop execution and release owned resources.");
  }
  if (/(?:timed out|timeout|ETIMEDOUT)/i.test(text)) {
    return createDiagnosis("timeout", 2, "Operation timed out", evidence, likelyFiles, "Stop the timed-out operation, verify cleanup, then retry only when the operation is transient and bounded.");
  }
  if (/(?:401|403|permission denied|forbidden|not permitted|EACCES)/i.test(text)) {
    return createDiagnosis("permission", 1, "Permission error", evidence, likelyFiles, "Do not retry automatically. Report the permission boundary or require explicit user configuration.");
  }
  if (/(?:network error|fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|429|rate limit|too many requests)/i.test(text)) {
    return createDiagnosis("network", 3, "Transient network/provider error", evidence, likelyFiles, "Use the bounded Runtime network retry policy; never create an independent unbounded retry loop.");
  }
  if (/(?:validation failed|completion gate|acceptance criteria|DOMAIN_MISMATCH)/i.test(text)) {
    return createDiagnosis("validation", 2, "Validation did not pass", evidence, likelyFiles, "Treat the evidence as the current project state; repair only the failed criteria, then rerun validation.");
  }
  if (/(?:TS\\d+|TypeScript|tsc)/i.test(text)) {
    return createDiagnosis("typescript", 1, "TypeScript error", evidence, likelyFiles, "Inspect the reported file and type error, apply the smallest targeted fix, then rerun typecheck/build.");
  }
  if (/(?:parse error|syntaxerror|unexpected token|invalid unicode escape|unterminated)/i.test(text)) {
    return createDiagnosis("syntax", 1, "Syntax or parser error", evidence, likelyFiles, "Read the failing file around the reported location, correct syntax/escaping, then rerun the same check.");
  }
  if (/(?:module not found|cannot find module|missing script|npm ERR|ERESOLVE|peer dep)/i.test(text)) {
    return createDiagnosis("dependency", 2, "Dependency or npm configuration error", evidence, likelyFiles, "Inspect package.json and the exact missing dependency/script before changing dependencies; install only what the project requires.");
  }
  if (/(?:ENOENT|no such file|file not found|invalid path|path is not allowed)/i.test(text)) {
    return createDiagnosis("path", 2, "Project path or missing-file error", evidence, likelyFiles, "Inspect the project tree and use an exact existing relative path; never invent a filesystem path.");
  }
  if (/(?:runtime|referenceerror|typeerror|uncaught|unhandledrejection)/i.test(text)) {
    return createDiagnosis("runtime", 1, "Runtime error", evidence, likelyFiles, "Locate the runtime stack frame, inspect the responsible component/module, patch the smallest cause, then rerun the relevant check.");
  }
  if (/(?:build failed|failed to build|vite|webpack|rollup)/i.test(text)) {
    return createDiagnosis("build", 2, "Build error", evidence, likelyFiles, "Inspect the exact build output and responsible file, make a targeted fix, then rerun the build.");
  }
  if (/(?:tool|command is not allowed|tool failed)/i.test(text)) {
    return createDiagnosis("tool", 3, "Tool execution error", evidence, likelyFiles, "Validate the tool input against the active project scope and choose an allowed alternative action.");
  }
  return createDiagnosis("unknown", 4, "Unclassified project error", evidence, likelyFiles, "Inspect the latest failed action and relevant files before attempting another change.");
}
