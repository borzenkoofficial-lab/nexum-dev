import type { Request, Response } from "express";
import type { ChatJob } from "./chatJobStore.js";

type ChatJobEventHandlerDependencies = {
  getUserId: (request: Request) => string;
  getJob: (jobId: string, userId: string) => Promise<ChatJob | null>;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
};

const terminalStatuses = new Set(["completed", "failed", "cancelled"]);

function writeChunk(response: Response, chunk: string, signal: AbortSignal): Promise<void> {
  if (response.write(chunk)) return Promise.resolve();
  return new Promise((resolve) => {
    const cleanup = () => {
      response.removeListener("drain", onDrain);
      signal.removeEventListener("abort", onAbort);
    };
    const onDrain = () => { cleanup(); resolve(); };
    const onAbort = () => { cleanup(); resolve(); };
    response.on("drain", onDrain);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function createChatJobEventsHandler({
  getUserId,
  getJob,
  pollIntervalMs = 500,
  heartbeatIntervalMs = 15_000,
}: ChatJobEventHandlerDependencies) {
  return async (request: Request, response: Response): Promise<void> => {
    const jobId = request.params.id;
    const userId = getUserId(request);
    let job: ChatJob | null;
    try {
      job = await getJob(jobId, userId);
    } catch (error) {
      console.error("[Nexum] ChatJob SSE initial lookup failed", { jobId, error });
      response.status(503).json({ success: false, error: "Chat job status unavailable" });
      return;
    }
    if (!job) {
      response.status(404).json({ success: false, error: "Chat job not found or expired" });
      return;
    }

    response.status(200);
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-store, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders?.();

    const controller = new AbortController();
    const onClose = () => controller.abort();
    response.on("close", onClose);
    let lastSnapshot = "";
    let lastHeartbeat = Date.now();

    const emitJob = async (snapshot: ChatJob) => {
      const serialized = JSON.stringify(snapshot);
      await writeChunk(response, `id: ${snapshot.updatedAt}\nevent: job\ndata: ${serialized}\n\n`, controller.signal);
      lastSnapshot = serialized;
      lastHeartbeat = Date.now();
    };

    try {
      await writeChunk(response, "retry: 1500\n\n", controller.signal);
      await emitJob(job);
      if (terminalStatuses.has(job.status)) {
        response.end();
        return;
      }

      while (!controller.signal.aborted) {
        await wait(pollIntervalMs, controller.signal);
        if (controller.signal.aborted) break;
        try {
          const latest = await getJob(jobId, userId);
          if (controller.signal.aborted) break;
          if (!latest) {
            await writeChunk(response, `event: unavailable\ndata: ${JSON.stringify({ error: "Chat job expired or unavailable" })}\n\n`, controller.signal);
            response.end();
            break;
          }
          if (JSON.stringify(latest) !== lastSnapshot) await emitJob(latest);
          if (terminalStatuses.has(latest.status)) {
            response.end();
            break;
          }
          if (Date.now() - lastHeartbeat >= heartbeatIntervalMs) {
            await writeChunk(response, ": heartbeat\n\n", controller.signal);
            lastHeartbeat = Date.now();
          }
        } catch (error) {
          console.error("[Nexum] ChatJob SSE poll failed", { jobId, error });
          await writeChunk(response, `event: unavailable\ndata: ${JSON.stringify({ error: "Chat job status unavailable" })}\n\n`, controller.signal);
          response.end();
          break;
        }
      }
    } finally {
      response.removeListener("close", onClose);
      if (!response.writableEnded) response.end();
    }
  };
}
