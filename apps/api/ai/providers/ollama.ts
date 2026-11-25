import type { AIProvider, AIProviderStatus, AIGenerateOptions, AIRequest, AIStreamEvent, AIModelCapabilities } from "../types.js";
import { validateCanonicalRequest } from "../canonical.js";

const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_MODEL = "qwen3:4b";
const DEFAULT_TIMEOUT_MS = 75_000;
const DEFAULT_CONTEXT = 4096;

interface OllamaChatResponse {
  message?: { content?: string };
}

interface OllamaTagsResponse {
  models?: Array<{ name?: string }>;
}

export class OllamaProvider implements AIProvider {
  id = "ollama";
  name = "Ollama";
  protocol = "ollama-chat" as const;
  adapterVersion = "1.0.0";
  model: string;
  capabilities = { text: true, code: true, vision: false, toolCalling: false, streaming: false, structuredOutput: false, reasoning: false, contextWindow: null } as const;
  private readonly installedModels = new Set<string>();

  getCapabilities(model = this.model): AIModelCapabilities {
    const installed = this.installedModels.has(model) || [...this.installedModels].some((item) => item.startsWith(model + ":"));
    return { ...this.capabilities, streaming: installed };
  }
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(
    baseUrl = process.env.OLLAMA_BASE_URL || DEFAULT_BASE_URL,
    model = process.env.OLLAMA_MODEL || DEFAULT_MODEL,
    timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.model = this.validateModel(model);
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async generate(message: string, model = this.model, options: AIGenerateOptions = {}): Promise<string> {
    const selectedModel = this.validateModel(model);
    const data = await this.request<OllamaChatResponse>("/api/chat", {
      method: "POST",
      signal: options.signal,
      body: JSON.stringify({
        model: selectedModel,
        messages: [{ role: "user", content: message }],
        stream: false,
        keep_alive: "10m",
        think: false,
        options: {
          num_ctx: Number(process.env.OLLAMA_NUM_CTX || DEFAULT_CONTEXT),
          ...(process.env.OLLAMA_NUM_THREAD?.trim() ? { num_thread: Number(process.env.OLLAMA_NUM_THREAD) } : {}),
          num_predict: options.maxTokens ?? Number(process.env.OLLAMA_NUM_PREDICT || 1400),
        },
      }),
    });

    const content = data.message?.content;
    if (typeof content !== "string") {
      throw new Error("Ollama returned an invalid response");
    }
    return content;
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const data = await this.request<OllamaTagsResponse>("/api/tags", { method: "GET", ...(signal ? { signal } : {}) });
    const models = (data.models ?? [])
      .map((model) => model.name)
      .filter((model): model is string => typeof model === "string" && model.length > 0);
    this.installedModels.clear();
    for (const model of models) this.installedModels.add(model);
    return models;
  }

  async *streamRequest(request: AIRequest): AsyncGenerator<AIStreamEvent> {
    validateCanonicalRequest(request);
    if (!this.getCapabilities(request.model).streaming) {
      throw new Error("Ollama streaming requires the selected model to be present in the local model catalog");
    }
    if (request.tools?.length || request.messages.some((message) => message.role === "tool" || Boolean(message.toolCalls?.length))) {
      throw new Error("Ollama streaming adapter currently supports text-only conversations without tool calls");
    }
    if (request.responseFormat && request.responseFormat !== "text") {
      throw new Error("Ollama streaming adapter does not support structured output yet");
    }
    const messages = request.messages.map((message) => {
      if (message.role === "tool") throw new Error("Ollama streaming does not accept tool messages");
      const content = typeof message.content === "string" ? message.content : message.content.map((part) => {
        if (part.type !== "text") throw new Error("Ollama streaming adapter does not support image input");
        return part.text;
      }).join("\n");
      return { role: message.role === "developer" ? "system" : message.role, content };
    });
    const body: Record<string, unknown> = {
      model: this.validateModel(request.model),
      messages,
      stream: true,
      keep_alive: "10m",
      think: false,
      options: {
        num_ctx: Number(process.env.OLLAMA_NUM_CTX || DEFAULT_CONTEXT),
        num_predict: request.maxTokens ?? Number(process.env.OLLAMA_NUM_PREDICT || 1400),
        ...(process.env.OLLAMA_NUM_THREAD?.trim() ? { num_thread: Number(process.env.OLLAMA_NUM_THREAD) } : {}),
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.topP === undefined ? {} : { top_p: request.topP }),
        ...(request.stopSequences?.length ? { stop: request.stopSequences } : {}),
      },
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? this.timeoutMs);
    const callerSignal = request.signal;
    const abortFromCaller = () => controller.abort(callerSignal?.reason);
    if (callerSignal) {
      if (callerSignal.aborted) abortFromCaller();
      else callerSignal.addEventListener("abort", abortFromCaller, { once: true });
    }
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let terminal = false;
    try {
      const response = await this.fetchImpl(this.baseUrl + "/api/chat", {
        method: "POST",
        headers: { Accept: "application/x-ndjson", "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Ollama request failed (" + response.status + ")");
      if (!response.body) throw new Error("Ollama stream has no response body");
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let started = false;
      let resolvedModel = request.model;
      let usageEvent: AIStreamEvent = { type: "usage", usage: {}, source: "unavailable" };
      let finishReason: string | undefined;
      const processLine = (line: string): AIStreamEvent[] => {
        const value = line.trim();
        if (!value) return [];
        if (terminal) throw new Error("Ollama returned data after its terminal done frame");
        let payload: Record<string, any>;
        try { payload = JSON.parse(value) as Record<string, any>; }
        catch { throw new Error("Ollama returned an invalid NDJSON stream frame"); }
        if (typeof payload.error === "string" && payload.error) throw new Error("Ollama stream failed during generation");
        const events: AIStreamEvent[] = [];
        if (!started) {
          started = true;
          if (typeof payload.model === "string") resolvedModel = payload.model;
          events.push({ type: "message_start", provider: this.id, model: resolvedModel });
        }
        if (typeof payload.message?.content === "string" && payload.message.content) {
          events.push({ type: "text_delta", text: payload.message.content });
        }
        if (payload.done === true) {
          const valid = (count: unknown): count is number =>
            typeof count === "number" && Number.isSafeInteger(count) && count >= 0;
          if (valid(payload.prompt_eval_count) && valid(payload.eval_count)) {
            usageEvent = {
              type: "usage",
              usage: {
                inputTokens: payload.prompt_eval_count,
                outputTokens: payload.eval_count,
                totalTokens: payload.prompt_eval_count + payload.eval_count,
                ...(valid(payload.prompt_eval_cached_count) ? { cachedInputTokens: payload.prompt_eval_cached_count } : {}),
              },
              source: "provider_reported",
            };
          }
          if (typeof payload.done_reason === "string") finishReason = payload.done_reason;
          terminal = true;
          events.push(usageEvent, { type: "message_end", ...(finishReason ? { finishReason } : {}) });
        }
        return events;
      };
      while (true) {
        const part = await reader.read();
        buffer += decoder.decode(part.value, { stream: !part.done });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) for (const event of processLine(line)) yield event;
        if (part.done) break;
      }
      if (buffer.trim()) for (const event of processLine(buffer)) yield event;
      if (!terminal) throw new Error("Ollama stream ended before its final done frame");
    } catch (error) {
      if (callerSignal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (controller.signal.aborted) throw new Error("Ollama request timed out");
      if (error instanceof Error && error.message.startsWith("Ollama")) throw error;
      throw new Error("Ollama streaming request failed");
    } finally {
      if (reader) {
        try { await reader.cancel(); } catch { /* stream may already be closed */ }
        reader.releaseLock();
      }
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    }
  }

  async getStatus(model = this.model, signal?: AbortSignal): Promise<AIProviderStatus> {
    const startedAt = Date.now();

    try {
      const selectedModel = this.validateModel(model);
      const models = await this.listModels(signal);
      const modelAvailable = models.some(
        (installedModel) =>
          installedModel === selectedModel ||
          installedModel.startsWith(selectedModel + ":"),
      );

      if (!modelAvailable) {
        return {
          available: false,
          model: selectedModel,
          latencyMs: Date.now() - startedAt,
          error: `Ollama is running, but model ${selectedModel} is not installed`,
        };
      }

      return {
        available: true,
        model: selectedModel,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        available: false,
        model: this.validateModel(model),
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : "Ollama is unavailable",
      };
    }
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const callerSignal = (init as RequestInit).signal;
    const abortFromCaller = () => controller.abort(callerSignal?.reason);
    if (callerSignal) { if (callerSignal.aborted) abortFromCaller(); else callerSignal.addEventListener("abort", abortFromCaller, { once: true }); }

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        let detail = "";
        if (body) {
          try {
            const parsed = JSON.parse(body) as { error?: unknown };
            if (typeof parsed.error === "string" && parsed.error.trim()) detail = `: ${parsed.error.trim()}`;
          } catch {
            // Keep the transport error generic if Ollama returned non-JSON content.
          }
        }
        throw new Error(`Ollama request failed (${response.status})${detail}`);
      }
      return (await response.json()) as T;
    } catch (error) {
      if (callerSignal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (controller.signal.aborted) throw new Error("Ollama request timed out");
      if (error instanceof Error && error.message.startsWith("Ollama ")) throw error;
      throw new Error("Ollama is unavailable");
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    }
  }

  private validateModel(model: string): string {
    const value = model.trim();
    if (!value || value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)) {
      throw new Error("Ollama model name is invalid");
    }
    return value;
  }
}
