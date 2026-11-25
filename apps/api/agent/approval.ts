import type { AgentApprovalPolicy } from "./agentDefinitionStore.js";
import type { ToolRisk } from "./toolPolicy.js";

const MAX_APPROVAL_PREVIEW_LENGTH = 8_000;
const SECRET_FIELD = /(?:secret|token|password|api[_-]?key|authorization|cookie|credential|private[_-]?key)/i;

export function shouldRequireToolApproval(policy: AgentApprovalPolicy, risk: ToolRisk): boolean {
  if (policy === "always") return true;
  if (policy === "writes") return risk !== "READ";
  return false;
}

function redactText(value: string): string {
  return value
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, "$1[REDACTED]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/g, "[REDACTED]")
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|authorization|cookie)\s*[:=]\s*)(["']?)[^\s,"'}]+/gi, "$1$2[REDACTED]");
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (typeof value === "string") return redactText(value);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    SECRET_FIELD.test(key) ? "[REDACTED]" : redactValue(item),
  ]));
}

export function createApprovalPreview(input: string): string {
  let preview: string;
  try {
    preview = JSON.stringify(redactValue(JSON.parse(input)), null, 2);
  } catch {
    preview = redactText(input);
  }
  if (preview.length <= MAX_APPROVAL_PREVIEW_LENGTH) return preview;
  return preview.slice(0, MAX_APPROVAL_PREVIEW_LENGTH - 24) + "\n...[truncated]";
}
