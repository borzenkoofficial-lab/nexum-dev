import type { ChatJob } from "../chatJobStore.js";

export interface WaitForChatJobApprovalOptions {
  jobId: string;
  userId: string;
  approvalId: string;
  signal?: AbortSignal;
  pollIntervalMs?: number;
  now?: () => number;
  readJob: (jobId: string, userId: string) => Promise<ChatJob | null>;
  resolveExpired: (jobId: string, userId: string, approvalId: string) => Promise<ChatJob | null>;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Agent task cancelled while waiting for approval.", "AbortError");
}

function waitForNextPoll(delayMs: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new DOMException("Agent task cancelled while waiting for approval.", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export async function waitForChatJobApproval(options: WaitForChatJobApprovalOptions): Promise<"approved" | "rejected" | "expired"> {
  const pollIntervalMs = Math.max(1, options.pollIntervalMs ?? 500);
  const now = options.now ?? Date.now;

  while (true) {
    throwIfAborted(options.signal);
    const job = await options.readJob(options.jobId, options.userId);
    throwIfAborted(options.signal);
    if (!job) throw new Error("Chat job not found while waiting for approval.");
    if (job.status === "cancelled") throw new DOMException("Agent task cancelled while waiting for approval.", "AbortError");
    if (job.status !== "running") throw new Error("Chat job is no longer running; pending approval cannot continue.");

    const approval = job.pendingApproval;
    if (!approval || approval.id !== options.approvalId) {
      throw new Error("The approval request changed or was not found.");
    }
    if (approval.status === "approved") return "approved";
    if (approval.status === "rejected") return "rejected";
    if (approval.status === "expired") return "expired";
    if (approval.status === "cancelled") throw new DOMException("Agent task cancelled while waiting for approval.", "AbortError");

    const remainingMs = approval.expiresAt - now();
    if (remainingMs <= 0) {
      const expired = await options.resolveExpired(options.jobId, options.userId, options.approvalId);
      if (expired?.pendingApproval?.id === options.approvalId && expired.pendingApproval.status === "expired") return "expired";
      continue;
    }
    await waitForNextPoll(Math.min(pollIntervalMs, remainingMs), options.signal);
  }
}
