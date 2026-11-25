import type { Request, RequestHandler, Response } from "express";
import { randomUUID } from "node:crypto";
import type { AuthUser } from "../auth.js";
import { classifyAIError, NexumError } from "../core/errors.js";
import { validateCanonicalRequest } from "./canonical.js";
import { encodeAIStreamEvent } from "./sse.js";
import type { AIGateway } from "./gateway.js";
import type { AIRequest, AIStreamEvent } from "./types.js";

type AuthenticatedRequest = Request & { user?: AuthUser };

function safeRequestId(req: Request): string {
  const candidate = req.header("x-request-id")?.trim();
  return candidate && candidate.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(candidate)
    ? candidate
    : randomUUID();
}

function sendValidationError(res: Response, error: unknown, requestId: string): void {
  const normalized = error instanceof NexumError ? error : classifyAIError(error);
  res.status(normalized.status ?? 400).json({
    success: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      retryable: normalized.retryable,
      requestId,
    },
  });
}

export function createAIStreamHandler(
  getGatewayForUser: (userId: string) => AIGateway,
): RequestHandler {
  return async (request, res) => {
    const req = request as AuthenticatedRequest;
    const requestId = safeRequestId(req);
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: "Authentication required." });
      return;
    }

    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      res.status(400).json({ success: false, error: "Request body must be an object." });
      return;
    }
    if (body.provider !== undefined && (
      typeof body.provider !== "string" || !body.provider.trim() || body.provider.length > 80
    )) {
      res.status(400).json({ success: false, error: "provider must be a non-empty provider ID." });
      return;
    }

    const controller = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.once("close", onClose);

    const aiRequest: AIRequest = {
      version: 1,
      messages: body.messages as AIRequest["messages"],
      model: body.model as string,
      stream: true,
      ...(body.maxTokens !== undefined ? { maxTokens: body.maxTokens as number } : {}),
      ...(body.temperature !== undefined ? { temperature: body.temperature as number } : {}),
      ...(body.topP !== undefined ? { topP: body.topP as number } : {}),
      ...(body.stopSequences !== undefined ? { stopSequences: body.stopSequences as string[] } : {}),
      ...(body.tools !== undefined ? { tools: body.tools as AIRequest["tools"] } : {}),
      ...(body.toolChoice !== undefined ? { toolChoice: body.toolChoice as AIRequest["toolChoice"] } : {}),
      ...(body.responseFormat !== undefined ? { responseFormat: body.responseFormat as AIRequest["responseFormat"] } : {}),
      ...(body.timeoutMs !== undefined ? { timeoutMs: body.timeoutMs as number } : {}),
      metadata: { requestId, userId },
      signal: controller.signal,
    };

    try {
      validateCanonicalRequest(aiRequest);
    } catch (error) {
      res.removeListener("close", onClose);
      sendValidationError(res, error, requestId);
      return;
    }

    const writeEvent = async (event: AIStreamEvent): Promise<boolean> => {
      if (controller.signal.aborted || res.destroyed) return false;
      if (res.write(encodeAIStreamEvent(event))) return true;
      await new Promise<void>((resolve) => {
        const finish = () => {
          res.removeListener("drain", finish);
          res.removeListener("close", finish);
          controller.signal.removeEventListener("abort", finish);
          resolve();
        };
        res.once("drain", finish);
        res.once("close", finish);
        controller.signal.addEventListener("abort", finish, { once: true });
      });
      return !controller.signal.aborted && !res.destroyed;
    };

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("X-Request-Id", requestId);
    res.flushHeaders();

    try {
      const gateway = getGatewayForUser(userId);
      const provider = typeof body.provider === "string" ? body.provider.trim() : undefined;
      for await (const event of gateway.streamRequest(aiRequest, provider ? { provider } : {})) {
        if (!await writeEvent(event)) break;
        if (event.type === "error" || event.type === "message_end") break;
      }
    } catch (error) {
      if (!controller.signal.aborted && !res.destroyed) {
        const normalized = error instanceof NexumError ? error : classifyAIError(error);
        await writeEvent({
          type: "error",
          code: normalized.code,
          message: normalized.message,
        });
      }
    } finally {
      res.removeListener("close", onClose);
      if (!res.destroyed && !res.writableEnded) res.end();
    }
  };
}
