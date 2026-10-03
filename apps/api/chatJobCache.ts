import type { ChatJob } from "./chatJobStore.js";

export const chatJobCache = new Map<string, ChatJob>();

export function syncTerminalChatJobCache(job: ChatJob | null): void {
  if (!job) return;
  if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
    chatJobCache.set(job.id, job);
  }
}

export async function loadChatJob(
  id: string,
  userId: string,
  loadPersisted: (id: string, userId: string) => Promise<ChatJob | null>,
): Promise<ChatJob | null> {
  const cached = chatJobCache.get(id);
  if (cached && cached.userId === userId) return cached;
  const persisted = await loadPersisted(id, userId);
  if (persisted) chatJobCache.set(id, persisted);
  return persisted;
}
