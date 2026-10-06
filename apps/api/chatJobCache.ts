import type { ChatJob } from "./chatJobStore.js";

const MAX_CACHE_ENTRIES = 200;
const CACHE_TTL_MS = 35 * 60 * 1000;

export const chatJobCache = new Map<string, ChatJob>();

function evictStaleJobs(): void {
  const now = Date.now();
  for (const [id, job] of chatJobCache) {
    if (now - job.updatedAt > CACHE_TTL_MS) chatJobCache.delete(id);
  }
  while (chatJobCache.size > MAX_CACHE_ENTRIES) {
    const oldest = chatJobCache.keys().next().value as string | undefined;
    if (!oldest) break;
    chatJobCache.delete(oldest);
  }
}

export function syncTerminalChatJobCache(job: ChatJob | null): void {
  if (!job) return;
  evictStaleJobs();
  if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
    chatJobCache.set(job.id, job);
    evictStaleJobs();
  }
}

export async function loadChatJob(
  id: string,
  userId: string,
  loadPersisted: (id: string, userId: string) => Promise<ChatJob | null>,
): Promise<ChatJob | null> {
  evictStaleJobs();
  const cached = chatJobCache.get(id);
  if (cached && cached.userId === userId) return cached;
  const persisted = await loadPersisted(id, userId);
  if (persisted) {
    chatJobCache.set(id, persisted);
    evictStaleJobs();
  }
  return persisted;
}
