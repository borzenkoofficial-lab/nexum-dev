import assert from "node:assert/strict";
import { test } from "node:test";
import { AIGateway } from "./gateway.js";
import type { AIModelCapabilities, AIProvider, AIRequest, AIResponse } from "./types.js";

class LegacyFixture implements AIProvider {
  id = "legacy";
  name = "Legacy";
  model = "legacy-default";
  protocol = "custom" as const;
  adapterVersion = "1.0.0";
  capabilities = { text: true, code: true, vision: false, toolCalling: false, streaming: false, structuredOutput: false, reasoning: false, contextWindow: 8192 };
  calls = 0;
  async generate(message: string): Promise<string> {
    this.calls += 1;
    return `legacy:${message}`;
  }
}

class NativeFixture extends LegacyFixture {
  id = "native";
  name = "Native";
  model = "native-default";
  protocol = "test-canonical";
  adapterVersion = "1.0.0";
  received: AIRequest[] = [];
  response: AIResponse = { content: "native answer", provider: "untrusted-provider", model: "provider-resolved-model" };
  override async generateRequest(request: AIRequest): Promise<AIResponse> {
    this.received.push(request);
    return this.response;
  }
}

const request = (overrides: Partial<AIRequest> = {}): AIRequest => ({
  version: 1,
  model: "requested-model",
  messages: [{ role: "user", content: "Hello" }],
  ...overrides,
});

test("gateway routes canonical requests to a native provider adapter", async () => {
  const provider = new NativeFixture();
  const gateway = new AIGateway([provider], "native");
  const response = await gateway.generateRequest(request());
  assert.equal(provider.received.length, 1);
  assert.equal(response.content, "native answer");
  assert.equal(response.provider, "native");
  assert.equal(response.model, "provider-resolved-model");
});

test("gateway routes text-only canonical requests through the legacy bridge", async () => {
  const provider = new LegacyFixture();
  const gateway = new AIGateway([provider], "legacy");
  const response = await gateway.generateRequest(request());
  assert.equal(provider.calls, 1);
  assert.match(response.content, /\[USER\]\nHello/);
  assert.equal(response.usageSource, "unavailable");
});

test("model-level capabilities override provider-level capabilities", async () => {
  class RestrictedModel extends NativeFixture {
    capabilities = { ...super.capabilities, vision: true };
    override getCapabilities() {
      return { ...this.capabilities, vision: false };
    }
  }
  const provider = new RestrictedModel();
  const gateway = new AIGateway([provider], "native");
  await assert.rejects(
    () => gateway.generateRequest(request({
      messages: [{ role: "user", content: [{ type: "image", source: { type: "url", url: "https://example.com/image.png" } }] }],
    })),
    (error: any) => error?.code === "MODEL_ERROR" && error?.status === 400,
  );
  assert.equal(provider.received.length, 0);
});

test("gateway rejects unknown provider identifiers", async () => {
  const gateway = new AIGateway([new NativeFixture()], "native");
  await assert.rejects(() => gateway.generateRequest(request(), { provider: "missing" }), (error: any) => error?.code === "CONFIG_ERROR");
});

test("gateway forwards AbortSignal unchanged to native adapters", async () => {
  const provider = new NativeFixture();
  const gateway = new AIGateway([provider], "native");
  const controller = new AbortController();
  await gateway.generateRequest(request({ signal: controller.signal }));
  assert.equal(provider.received[0].signal, controller.signal);
});

test("gateway rejects unsupported capabilities before making a provider call", async () => {
  const provider = new NativeFixture();
  const gateway = new AIGateway([provider], provider.id);
  await assert.rejects(
    () => gateway.generateRequest(request({ stream: true })),
    (error: any) => error?.code === "MODEL_ERROR",
  );
  assert.equal(provider.received.length, 0);
});


test("treats unknown model capabilities as unsupported rather than assuming support", async () => {
  const unknownCapabilities: AIModelCapabilities = {
    text: true,
    code: false,
    vision: "unknown",
    toolCalling: false,
    streaming: false,
    structuredOutput: false,
    reasoning: false,
    contextWindow: 16_000,
  };
  class UnknownVisionProvider extends NativeFixture {
    getCapabilities() {
      return unknownCapabilities;
    }
  }
  const provider = new UnknownVisionProvider();
  const gateway = new AIGateway([provider], "native");
  await assert.rejects(
    () => gateway.generateRequest(request({
      messages: [{ role: "user", content: [{ type: "image", source: { type: "url", url: "https://example.com/image.png" } }] }],
    })),
    (error: any) => error?.code === "MODEL_ERROR",
  );
  assert.equal(provider.received.length, 0);
});


test("legacy string facade supports providers that implement only the canonical API", async () => {
  const received: AIRequest[] = [];
  const provider = {
    id: "native-only",
    name: "Native-only provider",
    model: "native-model",
    protocol: "custom" as const,
    adapterVersion: "1.0.0",
    protocol: "test-canonical",
    adapterVersion: "1.0.0",
    capabilities: {
      text: true,
      code: false,
      vision: false,
      toolCalling: false,
      streaming: false,
      structuredOutput: false,
      reasoning: false,
      contextWindow: 16_000,
    },
    async generateRequest(input: AIRequest): Promise<AIResponse> {
      received.push(input);
      return { content: "native-only answer", provider: "native-only", model: "native-model-v2" };
    },
  } as unknown as AIProvider;

  const gateway = new AIGateway([provider], provider.id);
  const result = await gateway.generateWithMetadata("Explain the project", {
    maxTokens: 321,
    temperature: 0.3,
  });
  assert.equal(result.response, "native-only answer");
  assert.equal(result.provider, "native-only");
  assert.equal(result.model, "native-model-v2");
  assert.equal(received[0].maxTokens, 321);
  assert.equal(received[0].temperature, 0.3);
  assert.match(String(received[0].messages[0].content), /LANGUAGE PROTOCOL/);
});

test("gateway rejects provider entries with neither native nor legacy generation", () => {
  const invalidProvider = {
    id: "invalid",
    name: "Invalid",
    model: "none",
    capabilities: {
      text: true, code: false, vision: false, toolCalling: false,
      streaming: false, structuredOutput: false, reasoning: false, contextWindow: null,
    },
  } as unknown as AIProvider;
  assert.throws(() => new AIGateway([invalidProvider], "invalid"), /generation method/i);
});


test("prefers native canonical generation when a provider exposes both interfaces", async () => {
  const provider = new NativeFixture();
  const gateway = new AIGateway([provider], "native");
  const result = await gateway.generateWithMetadata("Use the native path");
  assert.equal(result.response, "native answer");
  assert.equal(provider.received.length, 1);
  assert.equal(provider.calls, 0);
});

test("supports a native-only provider as an automatic transient fallback", async () => {
  class RateLimitedLegacy extends LegacyFixture {
    override async generate(): Promise<string> {
      this.calls += 1;
      throw new Error("429 rate limit");
    }
  }
  const primary = new RateLimitedLegacy();
  const received: AIRequest[] = [];
  const fallback = {
    id: "native-fallback",
    name: "Native fallback",
    model: "fallback-model",
    protocol: "custom" as const,
    adapterVersion: "1.0.0",
    protocol: "test-canonical",
    adapterVersion: "1.0.0",
    capabilities: {
      text: true, code: false, vision: false, toolCalling: false,
      streaming: false, structuredOutput: false, reasoning: false, contextWindow: 16_000,
    },
    async generateRequest(input: AIRequest): Promise<AIResponse> {
      received.push(input);
      return { content: "fallback answer", provider: "native-fallback", model: "fallback-resolved-model" };
    },
  } as unknown as AIProvider;
  const gateway = new AIGateway([primary, fallback], "legacy", { fallbackProviderId: fallback.id });
  const result = await gateway.generateWithMetadata("Fallback safely");
  assert.equal(result.response, "fallback answer");
  assert.equal(result.provider, "native-fallback");
  assert.equal(result.model, "fallback-resolved-model");
  assert.equal(result.fallback, true);
  assert.equal(received.length, 1);
});


test("rejects streaming on the complete-response API even if a provider advertises streaming", async () => {
  const provider = {
    id: "streaming-advertised",
    name: "Streaming advertised",
    model: "streaming-model",
    protocol: "custom" as const,
    adapterVersion: "1.0.0",
    protocol: "test-canonical",
    adapterVersion: "1.0.0",
    capabilities: {
      text: true, code: false, vision: false, toolCalling: false,
      streaming: true, structuredOutput: false, reasoning: false, contextWindow: 16_000,
    },
    received: [] as AIRequest[],
    async generateRequest(input: AIRequest): Promise<AIResponse> {
      this.received.push(input);
      return { content: "complete response", provider: "streaming-advertised", model: "streaming-model" };
    },
  } as unknown as AIProvider;
  const gateway = new AIGateway([provider], "streaming-advertised");
  await assert.rejects(
    () => gateway.generateRequest(request({ stream: true })),
    (error: any) => error?.code === "MODEL_ERROR" && /stream/i.test(String(error?.technicalDetails)),
  );
  assert.equal(provider.received.length, 0);
});


test("requires native adapters to declare their wire protocol and adapter version", () => {
  const provider = {
    id: "missing-protocol",
    name: "Missing protocol",
    model: "model",
    capabilities: {
      text: true, code: false, vision: false, toolCalling: false,
      streaming: false, structuredOutput: false, reasoning: false, contextWindow: 8192,
    },
    async generateRequest(): Promise<AIResponse> {
      return { content: "answer", provider: "missing-protocol", model: "model" };
    },
  } as unknown as AIProvider;
  assert.throws(() => new AIGateway([provider], provider.id), /protocol and adapter version/i);
});


test("model catalog distinguishes verified provider models from configured fallback", async () => {
  const available: AIProvider = {
    id: "catalog-live",
    name: "Catalog live",
    model: "configured-model",
    capabilities: {
      text: true, code: false, vision: false, toolCalling: false,
      streaming: false, structuredOutput: false, reasoning: false, contextWindow: 16_000,
    },
    async generate() { return "ok"; },
    async listModels() { return ["model-a", "model-a", "", "model-b"]; },
  };
  const unavailable: AIProvider = {
    id: "catalog-down",
    name: "Catalog down",
    model: "fallback-model",
    capabilities: available.capabilities,
    async generate() { return "ok"; },
    async listModels() { throw new Error("provider secret must not escape"); },
  };
  const gateway = new AIGateway([available, unavailable], available.id);
  const catalog = await gateway.getModelCatalog();

  assert.deepEqual(catalog.providers[0], {
    provider: "catalog-live",
    configuredModel: "configured-model",
    models: ["model-a", "model-b"],
    source: "provider_api",
    verified: true,
    status: "available",
  });
  assert.deepEqual(catalog.providers[1], {
    provider: "catalog-down",
    configuredModel: "fallback-model",
    models: ["fallback-model"],
    source: "configured_fallback",
    verified: false,
    status: "unavailable",
    errorCode: "catalog_request_failed",
  });
  assert.doesNotMatch(JSON.stringify(catalog), /secret/);
});

test("model catalog marks an empty provider response unverified", async () => {
  const provider: AIProvider = {
    id: "catalog-empty",
    name: "Catalog empty",
    model: "configured-model",
    capabilities: {
      text: true, code: false, vision: false, toolCalling: false,
      streaming: false, structuredOutput: false, reasoning: false, contextWindow: 16_000,
    },
    async generate() { return "ok"; },
    async listModels() { return []; },
  };
  const catalog = await new AIGateway([provider], provider.id).getModelCatalog();
  assert.equal(catalog.providers[0].verified, false);
  assert.equal(catalog.providers[0].status, "empty");
  assert.deepEqual(catalog.providers[0].models, ["configured-model"]);
});


test("gateway rejects native adapters without an explicit protocol and semantic version", () => {
  const provider = {
    id: "unversioned-native",
    name: "Unversioned native",
    model: "model",
    capabilities: {
      text: true, code: false, vision: false, toolCalling: false,
      streaming: false, structuredOutput: false, reasoning: false, contextWindow: 16_000,
    },
    async generateRequest(): Promise<AIResponse> {
      return { content: "ok", provider: "unversioned-native", model: "model" };
    },
  } as unknown as AIProvider;
  assert.throws(
    () => new AIGateway([provider], provider.id),
    /protocol and adapter version/i,
  );
});
