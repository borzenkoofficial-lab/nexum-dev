import assert from "node:assert/strict";
import { test } from "node:test";
import { AIGateway } from "./gateway.js";
import type { AIProvider, AIRequest, AIResponse } from "./types.js";

class LegacyFixture implements AIProvider {
  id = "legacy";
  name = "Legacy";
  model = "legacy-default";
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
  const gateway = new AIGateway([provider], "native");
  await assert.rejects(
    () => gateway.generateRequest(request({ stream: true })),
    (error: any) => error?.code === "MODEL_ERROR",
  );
  assert.equal(provider.received.length, 0);
});


test("treats unknown model capabilities as unsupported rather than assuming support", async () => {
  class UnknownVisionProvider extends NativeFixture {
    capabilities = { ...super.capabilities, vision: "unknown" as const };
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
