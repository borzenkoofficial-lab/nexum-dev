import type { ChatJob } from "./chatJobStore.js";

export const chatJobCache = new Map<string, ChatJob>();

export function syncTerminalChatJobCache(job: ChatJob | null): void {
  if (!job) return;
  if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
    chatJobCache.set(job.id, job);
  }
}
