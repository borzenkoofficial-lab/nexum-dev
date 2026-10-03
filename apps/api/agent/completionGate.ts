export interface CompletionEvidence {
  hasIntent: boolean;
  hasPlan: boolean;
  hasExecuted: boolean;
  validationPassed: boolean;
  acceptanceCriteriaSatisfied: boolean;
  noCriticalErrors: boolean;
  projectStateConsistent: boolean;
}

export interface CompletionDecision {
  completed: boolean;
  missing: string[];
}

export function evaluateCompletionGate(evidence: CompletionEvidence): CompletionDecision {
  const missing: string[] = [];
  if (!evidence.hasIntent) missing.push("intent");
  if (!evidence.hasPlan) missing.push("plan");
  if (!evidence.hasExecuted) missing.push("execution");
  if (!evidence.validationPassed) missing.push("validation");
  if (!evidence.acceptanceCriteriaSatisfied) missing.push("acceptanceCriteria");
  if (!evidence.noCriticalErrors) missing.push("criticalErrors");
  if (!evidence.projectStateConsistent) missing.push("projectState");
  return { completed: missing.length === 0, missing };
}
