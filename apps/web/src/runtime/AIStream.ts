export type AIStreamEvent =
  | { type: "message_start"; provider: string; model: string; requestId?: string; usage?: Record<string, number> }
  | { type: "text_delta"; text: string }
  | { type: "tool_call_start"; index: number; id: string; name: string }
  | { type: "tool_call_delta"; index: number; argumentsDelta: string }
  | { type: "usage"; usage: Record<string, number>; source: "provider_reported" | "unavailable" }
  | { type: "message_end"; finishReason?: string; stopSequence?: string }
  | { type: "error"; code: string; message: string };

export class AIStreamProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIStreamProtocolError";
  }
}

const EVENT_TYPES = new Set<AIStreamEvent["type"]>([
  "message_start",
  "text_delta",
  "tool_call_start",
  "tool_call_delta",
  "usage",
  "message_end",
  "error",
]);
const MAX_SSE_FRAME_CHARS = 2 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeEvent(eventName: string, data: string): AIStreamEvent {
  if (!EVENT_TYPES.has(eventName as AIStreamEvent["type"])) {
    throw new AIStreamProtocolError("AI stream contained an unsupported event type.");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    throw new AIStreamProtocolError("AI stream contained invalid JSON.");
  }
  if (!isRecord(payload) || payload.type !== eventName) {
    throw new AIStreamProtocolError("AI stream event name and payload do not match.");
  }

  switch (eventName) {
    case "message_start":
      if (typeof payload.provider !== "string" || typeof payload.model !== "string") break;
      return payload as AIStreamEvent;
    case "text_delta":
      if (typeof payload.text === "string") return payload as AIStreamEvent;
      break;
    case "tool_call_start":
      if (Number.isInteger(payload.index) && typeof payload.id === "string" && typeof payload.name === "string") return payload as AIStreamEvent;
      break;
    case "tool_call_delta":
      if (Number.isInteger(payload.index) && typeof payload.argumentsDelta === "string") return payload as AIStreamEvent;
      break;
    case "usage":
      if (isRecord(payload.usage) && (payload.source === "provider_reported" || payload.source === "unavailable")) return payload as AIStreamEvent;
      break;
    case "message_end":
      return payload as AIStreamEvent;
    case "error":
      if (typeof payload.code === "string" && typeof payload.message === "string") return payload as AIStreamEvent;
      break;
  }
  throw new AIStreamProtocolError("AI stream event payload is malformed.");
}

/**
 * Consume a fetch() response containing named Server-Sent Events.
 * Handles arbitrary byte boundaries, UTF-8 splits, CRLF, comments,
 * multi-line data fields, and a final frame without a trailing blank line.
 */
export async function consumeAIStream(
  response: Response,
  onEvent: (event: AIStreamEvent) => void | Promise<void>,
): Promise<void> {
  if (!response.ok) {
    throw new Error(`AI stream request failed (HTTP ${response.status}).`);
  }
  if (!response.body) {
    throw new AIStreamProtocolError("AI stream response has no readable body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "";
  let dataLines: string[] = [];
  let firstLine = true;

  const dispatch = async () => {
    if (dataLines.length === 0) {
      eventName = "";
      return;
    }
    const event = decodeEvent(eventName, dataLines.join("\n"));
    eventName = "";
    dataLines = [];
    await onEvent(event);
  };

  const processLine = async (rawLine: string) => {
    let line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (firstLine) {
      firstLine = false;
      if (line.charCodeAt(0) === 0xfeff) line = line.slice(1);
    }
    if (line === "") {
      await dispatch();
      return;
    }
    if (line.startsWith(":")) return;

    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") eventName = value;
    else if (field === "data") {
      dataLines.push(value);
      if (dataLines.reduce((total, item) => total + item.length + 1, 0) > MAX_SSE_FRAME_CHARS) {
        throw new AIStreamProtocolError("AI stream event exceeded the maximum frame size.");
      }
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (buffer.length > MAX_SSE_FRAME_CHARS && !buffer.includes("\n")) {
        throw new AIStreamProtocolError("AI stream frame exceeded the maximum size.");
      }
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        await processLine(line);
        newline = buffer.indexOf("\n");
      }
      if (done) {
        if (buffer.length > 0) await processLine(buffer);
        await dispatch();
        break;
      }
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}
