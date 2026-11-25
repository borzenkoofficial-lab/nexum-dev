import assert from "node:assert/strict";
import { test } from "node:test";
import type { AIRequest } from "../types.js";
import { OpenRouterProvider } from "./openrouter.js";

const key = "openrouter-test-key-that-is-long-enough-123456";
const response = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { "content-type": "application/json" },
});

function createProvider(fetchImpl: typeof fetch) {
  const provider = new OpenRouterProvider("https://openrouter.test/api/v1", "openai/gpt-6.2-sol", 1000, fetchImpl);
  provider.setRuntimeApiKey(key);
  return provider;
}

test("native OpenRouter adapter maps canonical requests and normalizes usage", async () => {
  let url = "";
  let init: RequestInit | undefined;
  const provider = createProvider(async (input, requestInit) => {
    url = String(input);
    init = requestInit;
    return response({
      id: "or_chat_1",
      model: "openai/gpt-6.2-sol",
      choices: [{
        finish_reason: "stop",
        message: { content: "Ответ OpenRouter" },
      }],
      usage: { prompt_tokens: 80, completion_tokens: 20, total_tokens: 100 },
    });
  });
  const request: AIRequest = {
    version: 1,
    model: "openai/gpt-6.2-sol",
    messages: [
      { role: "system", content: "Системные правила" },
      { role: "user", content: "Проверь интеграцию" },
    ],
    maxTokens: 256,
    temperature: 0.3,
  };
  const result = await provider.generateRequest(request);
  const body = JSON.parse(String(init?.body));
  const headers = init?.headers as Record<string, string>;
  assert.equal(url, "https://openrouter.test/api/v1/chat/completions");
  assert.equal(headers.Authorization, `Bearer ${key}`);
  assert.equal(headers["HTTP-Referer"], "https://nexum.dev");
  assert.equal(headers["X-Title"], "КВАРД");
  assert.deepEqual(body.messages, [
    { role: "system", content: "Системные правила" },
    { role: "user", content: "Проверь интеграцию" },
  ]);
  assert.equal(body.max_tokens, 256);
  assert.equal(body.temperature, 0.3);
  assert.equal(result.content, "Ответ OpenRouter");
  assert.equal(result.provider, "openrouter");
  assert.equal(result.model, "openai/gpt-6.2-sol");
  assert.equal(result.requestId, "or_chat_1");
  assert.equal(result.usageSource, "provider_reported");
  assert.equal(result.usage?.totalTokens, 100);
});

test("OpenRouter model discovery uses provider metadata for capabilities and does not add static defaults", async () => {
  const provider = createProvider(async (input) => {
    assert.match(String(input), /\/models\?output_modalities=text/);
    return response({
      data: [
        {
          id: "openai/gpt-6.2-sol",
          architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
          supported_parameters: ["temperature", "tools", "tool_choice", "response_format", "reasoning_effort"],
          context_length: 256000,
          pricing: { prompt: "0.000001", completion: "0.000005" },
        },
        {
          id: "openai/text-embedding-3-small",
          architecture: { input_modalities: ["text"], output_modalities: ["embeddings"] },
          supported_parameters: [],
          context_length: 8192,
        },
      ],
    });
  });
  assert.deepEqual(await provider.listModels(), ["openai/gpt-6.2-sol", "openai/text-embedding-3-small"]);
  const capabilities = provider.getCapabilities("openai/gpt-6.2-sol");
  assert.equal(capabilities.text, true);
  assert.equal(capabilities.code, true);
  assert.equal(capabilities.vision, true);
  assert.equal(capabilities.toolCalling, true);
  assert.equal(capabilities.structuredOutput, true);
  assert.equal(capabilities.reasoning, true);
  assert.equal(capabilities.contextWindow, 256000);
  assert.equal(provider.getCapabilities("openai/text-embedding-3-small").text, false);
  assert.deepEqual(await provider.listModels(), ["openai/gpt-6.2-sol", "openai/text-embedding-3-small"]);
});

test("OpenRouter verifies selected models and treats dynamic free routing as a separate alias", async () => {
  const provider = createProvider(async () => response({
    data: [{
      id: "openai/gpt-6.2-sol",
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      supported_parameters: ["temperature"],
      context_length: 128000,
    }],
  }));
  assert.equal((await provider.getStatus("openai/gpt-6.2-sol")).available, true);
  assert.equal((await provider.getStatus("openai/unknown")).available, false);
  assert.equal((await provider.getStatus("openrouter/free")).available, true);
  assert.equal(provider.getCapabilities("openrouter/free").text, true);
});

test("OpenRouter has no plausible model list without an authenticated provider response", async () => {
  const provider = new OpenRouterProvider(
    "https://openrouter.test/api/v1",
    "openrouter/free",
    1000,
    async () => { throw new Error("network must not be called"); },
  );
  await assert.rejects(() => provider.listModels(), /API_KEY|configured/i);
  assert.equal(provider.hasApiKey(), false);
});

test("OpenRouter native adapter rejects streaming before a provider request", async () => {
  let calls = 0;
  const provider = createProvider(async () => {
    calls += 1;
    return response({});
  });
  await assert.rejects(() => provider.generateRequest({
    version: 1,
    model: "openai/gpt-6.2-sol",
    messages: [{ role: "user", content: "test" }],
    stream: true,
  }), /does not support streaming/i);
  assert.equal(calls, 0);
});
