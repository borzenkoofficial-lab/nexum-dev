import type { AIStreamEvent } from "./types.js";

/**
 * Encode one canonical provider event as a Server-Sent Event frame.
 * JSON payload encoding keeps provider-controlled text from injecting SSE fields.
 */
export function encodeAIStreamEvent(event: AIStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
