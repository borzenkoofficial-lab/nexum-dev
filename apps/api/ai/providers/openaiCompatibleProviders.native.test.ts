import assert from "node:assert/strict";
import { test } from "node:test";
import type { AIRequest } from "../types.js";
import { AnyModelProvider } from "./anymodel.js";
import { OrcaRouterProvider } from "./orcarouter.js";

const key = "compatible-provider-test-key-1234567890";
const response = (payload: unknown) => new Response(JSON.stringify(payload), {
  status: 200,
  headers: { "content-type": "application/json" },
});

function metadata(id: string) {
  return {
    id,
    architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
    supported_parameters: ["temperature", "tools", "tool_choice", "response_format"],
    context_length: 128000,
  };
}

for (const [name, create] of [
  ["OrcaRouter", (fetchImpl: typeof fetch) => new OrcaRouterProvider("https://orca.test/v1", "model-a", 1000, fetchImpl)],
  ["AnyModel", (fetchImpl: typeof fetch) => new AnyModelProvider("https://anymodel.test/v1", "model-a", 1000, fetchImpl)],
] as const) {
  test(`${name} native adapter maps canonical requests and reports provider metadata`, async () => {
    const urls: string[] = [];
    let requestBody: Record<string, any> | undefined;
    const provider = create(async (input, init) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith("/models")) return response({ data: [metadata("model-a")] });
      requestBody = JSON.parse(String(init?.body));
      return response({
        id: "compatible-chat-1",
        model: "model-a-revision",
        choices: [{
          finish_reason: "stop",
          message: { content: "Ответ" },
        }],
        usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 },
      });
    });
    provider.setRuntimeApiKey(key);
    const models = await provider.listModels();
    assert.deepEqual(models, ["model-a"]);
    const capabilities = provider.getCapabilities("model-a");
    assert.equal(capabilities.text, true);
    assert.equal(capabilities.code, true);
    assert.equal(capabilities.vision, true);
    assert.equal(capabilities.toolCalling, true);
    assert.equal(capabilities.structuredOutput, true);
    assert.equal(capabilities.contextWindow, 128000);
    assert.equal(provider.getCapabilities("not-listed").text, "unknown");

    const request: AIRequest = {
      version: 1,
      model: "model-a",
      messages: [{ role: "user", content: "Проверь совместимость" }],
      maxTokens: 200,
    };
    const result = await provider.generateRequest(request);
    assert.equal(result.content, "Ответ");
    assert.equal(result.provider, provider.id);
    assert.equal(result.model, "model-a-revision");
    assert.equal(result.usageSource, "provider_reported");
    assert.equal(result.usage?.totalTokens, 50);
    assert.equal(requestBody?.model, "model-a");
    assert.equal(requestBody?.max_tokens, 200);
    assert.equal(urls[0].endsWith("/models"), true);
    assert.equal(urls[1].endsWith("/chat/completions"), true);
    assert.equal((await provider.getStatus("model-a")).available, true);
    assert.equal((await provider.getStatus("missing-model")).available, false);
  });
}
