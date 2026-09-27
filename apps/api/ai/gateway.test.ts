import assert from "node:assert/strict";
import { test } from "node:test";
import { AIGateway } from "./gateway.js";
import type { AIProvider } from "./types.js";

class StubProvider implements AIProvider {
  constructor(
    public readonly id: string,
    public readonly model: string,
    private readonly error?: string,
  ) {}
  name = this.id;
  calls = 0;
  async generate(): Promise<string> {
    this.calls += 1;
    if (this.error) throw new Error(this.error);
    return `ok:${this.id}`;
  }
}

test("falls back on transient failures when provider is automatic", async () => {
  const primary = new StubProvider("primary", "primary-model", "503 service unavailable");
  const fallback = new StubProvider("fallback", "fallback-model");
  const events: string[] = [];
  const gateway = new AIGateway([primary, fallback], "primary", {
    fallbackProviderId: "fallback",
    onFallback: (event) => events.push(`${event.fromProvider}->${event.toProvider}`),
  });

  const result = await gateway.generate("test");
  assert.equal(result, "ok:fallback");
  assert.equal(primary.calls, 1);
  assert.equal(fallback.calls, 1);
  assert.deepEqual(events, ["primary->fallback"]);
});

test("does not silently fall back from an explicitly selected string provider", async () => {
  const primary = new StubProvider("primary", "primary-model", "429 rate limit");
  const fallback = new StubProvider("fallback", "fallback-model");
  const gateway = new AIGateway([primary, fallback], "primary", { fallbackProviderId: "fallback" });

  await assert.rejects(() => gateway.generate("test", "primary"), /429 rate limit/);
  assert.equal(primary.calls, 1);
  assert.equal(fallback.calls, 0);
});

test("explicit provider can opt into transient fallback", async () => {
  const primary = new StubProvider("primary", "primary-model", "timeout");
  const fallback = new StubProvider("fallback", "fallback-model");
  const gateway = new AIGateway([primary, fallback], "primary", { fallbackProviderId: "fallback" });

  const result = await gateway.generate("test", { provider: "primary", fallback: true });
  assert.equal(result, "ok:fallback");
  assert.equal(fallback.calls, 1);
});

test("never falls back for authentication failures", async () => {
  const primary = new StubProvider("primary", "primary-model", "401 unauthorized");
  const fallback = new StubProvider("fallback", "fallback-model");
  const gateway = new AIGateway([primary, fallback], "primary", { fallbackProviderId: "fallback" });

  await assert.rejects(() => gateway.generate("test"), /401 unauthorized/);
  assert.equal(fallback.calls, 0);
});
