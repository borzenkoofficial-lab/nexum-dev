import { randomUUID } from "node:crypto";

export type DiagnosticsEvent = {
  id: string; sessionId: string; userId: string; timestamp: string; type: string;
  level: "info" | "warn" | "error"; message: string; route?: string;
  projectId?: string; jobId?: string; metadata?: Record<string, unknown>;
};
const sessions = new Map<string, DiagnosticsEvent[]>();
const MAX_EVENTS = 500, MAX_SESSIONS = 50;
function sanitize(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]").replace(/(sk-[A-Za-z0-9_-]{8,})/g, "[REDACTED_KEY]").replace(/(sk-or-[A-Za-z0-9_-]{8,})/g, "[REDACTED_KEY]").slice(0, 8000);
  if (Array.isArray(value)) return value.slice(0, 20).map(sanitize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = /authorization|api[-_]?key|token|password|secret|cookie/i.test(key) ? "[REDACTED]" : sanitize(item);
    return out;
  }
  return value;
}
export function createDiagnosticsSession(): string {
  const sessionId = randomUUID(); sessions.set(sessionId, []);
  while (sessions.size > MAX_SESSIONS) { const first = sessions.keys().next().value; if (first) sessions.delete(first); else break; }
  return sessionId;
}
export function recordDiagnosticsEvent(input: Omit<DiagnosticsEvent, "id" | "timestamp">): DiagnosticsEvent {
  const event: DiagnosticsEvent = { ...input, id: randomUUID(), timestamp: new Date().toISOString(), message: sanitize(input.message) as string, metadata: sanitize(input.metadata) as Record<string, unknown> | undefined };
  const list = sessions.get(event.sessionId) ?? []; list.push(event); sessions.set(event.sessionId, list.slice(-MAX_EVENTS)); return event;
}
export function getDiagnosticsSession(sessionId: string, userId: string) {
  return { sessionId, events: (sessions.get(sessionId) ?? []).filter((event) => event.userId === userId) };
}
export function getLatestDiagnostics(limit = 200, userId?: string) {
  return [...sessions.values()]
    .flat()
    .filter((event) => userId === undefined || event.userId === userId)
    .sort((a,b)=>b.timestamp.localeCompare(a.timestamp))
    .slice(0, Math.min(Math.max(limit,1),500));
}
