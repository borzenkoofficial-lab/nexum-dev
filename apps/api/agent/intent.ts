import type { AgentIntent, AgentIntentType, ProductPlan } from "./types.js";

function inferType(task: string): AgentIntentType {
  const text = task.toLowerCase();
  if (/создай|создание|сделай|разработай|build|create|make/.test(text)) return "create";
  if (/исправ|debug|ошиб|bug|fix|не работает/.test(text)) return "debug";
  if (/рефактор|refactor|перестрой/.test(text)) return "refactor";
  if (/настрой|configure|config|подключ/.test(text)) return "configure";
  if (/анализ|проверь|исслед|analyz|review/.test(text)) return "analyze";
  if (/измени|добавь|удали|modify|change|update/.test(text)) return "modify";
  return "unknown";
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 30);
}

export function createAgentIntent(
  task: string,
  context: { requestId?: string; projectId?: string; taskId?: string; agentJobId?: string },
  productPlan?: ProductPlan | null,
): AgentIntent {
  const objective = task.trim().slice(0, 3000);
  const type = inferType(objective);
  const requirements = unique([
    objective,
    ...(productPlan?.components ?? []).slice(0, 8),
    ...(productPlan?.interactions ?? []).slice(0, 8),
  ]);
  const constraints = unique([
    ...(productPlan?.visualSystem ?? []).slice(0, 6),
    ...(productPlan?.filesToChange ?? []).slice(0, 8).map((file) => "Relevant file: " + file),
  ]);
  const acceptanceCriteria = unique(productPlan?.acceptanceCriteria ?? []);
  const explicitFiles = unique(productPlan?.filesToInspect ?? []).slice(0, 12);
  const unknowns = unique([
    ...(productPlan ? [] : ["Product plan is not available yet"]),
  ]);
  const confidence = productPlan
    ? Math.min(0.98, 0.65 + acceptanceCriteria.length * 0.03)
    : 0.55;

  return {
    requestId: context.requestId ?? "unknown-request",
    projectId: context.projectId ?? "unknown-project",
    taskId: context.taskId ?? "unknown-task",
    agentJobId: context.agentJobId ?? context.taskId ?? "unknown-agent-job",
    type,
    objective,
    requirements,
    constraints,
    acceptanceCriteria,
    ...(explicitFiles.length ? { explicitFiles } : {}),
    unknowns,
    confidence,
    createdAt: Date.now(),
  };
}
