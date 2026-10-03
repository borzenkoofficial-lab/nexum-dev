import type { AgentIntentType } from "./types.js";

export interface AgentIntent {
  requestId: string;
  projectId: string;
  taskId: string;
  type: AgentIntentType;
  objective: string;
  requirements: string[];
  constraints: string[];
  acceptanceCriteria: string[];
  explicitFiles: string[];
  unknowns: string[];
  confidence?: number;
}

export function inferIntentType(request: string): AgentIntentType {
  const value = request.toLowerCase();
  if (/debug|fix|ошиб|почин|не работает|broken/.test(value)) return "debug";
  if (/refactor|рефактор|перепиш/.test(value)) return "refactor";
  if (/analy[sz]|анализ|проверь|audit|аудит/.test(value)) return "analyze";
  if (/config|настрой|configure|подключ/.test(value)) return "configure";
  if (/modify|change|update|измени|добавь|удали|передел/.test(value)) return "modify";
  if (/create|build|make|создай|сделай|разработай/.test(value)) return "create";
  return "unknown";
}

export function createAgentIntent(request: string, context: Partial<AgentIntent> = {}): AgentIntent {
  const objective = request.trim();
  return {
    requestId: context.requestId ?? "unknown-request",
    projectId: context.projectId ?? "unknown-project",
    taskId: context.taskId ?? "unknown-task",
    type: context.type ?? inferIntentType(objective),
    objective,
    requirements: context.requirements ?? [],
    constraints: context.constraints ?? [],
    acceptanceCriteria: context.acceptanceCriteria ?? [],
    explicitFiles: context.explicitFiles ?? [],
    unknowns: context.unknowns ?? [],
    confidence: context.confidence,
  };
}
