import assert from "node:assert/strict";
import { test } from "node:test";
import { AIGateway } from "./gateway.js";
import type { AIProvider, AIRequest, AIResponse } from "./types.js";

interface FixtureOptions {
  response?: AIResponse;
  error?: Error;
  capabilities?: AIProvider["capabilities"];
}

class CanonicalContractFixture implements AIProvider {
  id = "contract-fixture";
  name = "Canonical Contract Fixture";
  model = "fixture-v1";
  capabilities = {
    text: true,
    code: false,
    vision: false,
    toolCalling: false,
    streaming: false,
    structuredOutput: false,
    reasoning: false,
    contextWindow: 16_000,
  };
  calls: AIRequest[] = [];

  constructor(private readonly options: FixtureOptions = {}) {
    if (options.capabilities) this.capabilities = options.capabilities;
  }

  async generate(): Promise<string> {
    throw new Error("Canonical fixture must not use legacy generate()");
  }

  async generateRequest(request: AIRequest): Promise<AIResponse> {
    this.calls.push(request);
    if (this.options.error) throw this.options.error;
    return this.options.response ?? {
      content: "fixture response",
      provider: "untrusted",
      model: "fixture-resolved-v1",
    };
  }
}

function request(overrides: Partial<AIRequest> = {}): AIRequest {
  return {
    version: 1,
    model: "fixture-requested-v1",
    messages: [{ role: "user", content: "Run the contract check" }],
    ...overrides,
  };
}

function registerCanonicalProviderConformanceSuite(
  name: string,
  createProvider: () => CanonicalContractFixture,
): void {
  test(`${name}: maps content and provider/model identity`, async () => {
    const provider = createProvider();
    const response = await new AIGateway([provider], provider.id).generateRequest(request());
    assert.equal(response.content, "fixture response");
    assert.equal(response.provider, provider.id);
    assert.equal(response.model, "fixture-resolved-v1");
    assert.equal(provider.calls.length, 1);
  });

  test(`${name}: preserves provider-reported partial usage without inventing token counts`, async () => {
    const provider = createProviderWithResponse({
      content: "partial usage",
      provider: "fixture",
      model: "fixture-v1",
      usage: { inputTokens: 7 },
    });
    const response = await new AIGateway([provider], provider.id).generateRequest(request());
    assert.deepEqual(response.usage, { inputTokens: 7 });
    assert.equal(response.usageSource, "provider_reported");
    assert.equal(response.usage?.outputTokens, undefined);
  });

  test(`${name}: marks missing usage as unavailable`, async () => {
    const provider = createProvider();
    const response = await new AIGateway([provider], provider.id).generateRequest(request());
    assert.equal(response.usage, undefined);
    assert.equal(response.usageSource, "unavailable");
  });

  test(`${name}: rejects unsupported capabilities before invoking the adapter`, async () => {
    const provider = createProvider();
    const gateway = new AIGateway([provider], provider.id);
    await assert.rejects(
      () => gateway.generateRequest(request({
        messages: [{ role: "user", content: [{ type: "image", source: { type: "url", url: "https://example.com/image.png" } }] }],
      })),
      (error: any) => error?.code === "MODEL_ERROR" && error?.status === 400,
    );
    assert.equal(provider.calls.length, 0);
  });

  test(`${name}: redacts bearer credentials from provider errors`, async () => {
    const secret = "sk-live-provider-secret-1234567890";
    const provider = createProviderWithError(new Error(`401 Unauthorized Bearer ${secret}`));
    await assert.rejects(
      () => new AIGateway([provider], provider.id).generateRequest(request()),
      (error: any) => {
        assert.equal(error?.code, "AUTH_ERROR");
        assert.equal(String(error?.technicalDetails).includes(secret), false);
        assert.match(String(error?.technicalDetails), /REDACTED/);
        return true;
      },
    );
  });

  test(`${name}: does not invoke the adapter for an already-aborted request`, async () => {
    const provider = createProvider();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(() => new AIGateway([provider], provider.id).generateRequest(request({ signal: controller.signal })));
    assert.equal(provider.calls.length, 0);
  });
}

function createProviderWithResponse(response: AIResponse): CanonicalContractFixture {
  return new CanonicalContractFixture({ response });
}

function createProviderWithError(error: Error): CanonicalContractFixture {
  return new CanonicalContractFixture({ error });
}

registerCanonicalProviderConformanceSuite("canonical provider adapter", () => new CanonicalContractFixture());
