import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveKeyVerificationProvider } from "./keyProviderResolution.js";

test("an explicitly selected supported provider is the only verification target", () => {
  assert.equal(resolveKeyVerificationProvider("OpenRouter", "sk-proj-aaaaaaaaaaaaaaaaaaaaaaaa"), "openrouter");
  assert.equal(resolveKeyVerificationProvider("anymodel", "anything"), "anymodel");
});

test("an unambiguous key prefix selects exactly one provider", () => {
  assert.equal(resolveKeyVerificationProvider(undefined, "sk-orca-0123456789"), "orcarouter");
  assert.equal(resolveKeyVerificationProvider("", "sk-or-v1-0123456789"), "openrouter");
  assert.equal(resolveKeyVerificationProvider("mock", "sk-proj-abcdefghijklmnopqrstuvwxyz"), "openai");
});

test("an unidentifiable key is never sprayed across providers", () => {
  assert.equal(resolveKeyVerificationProvider(undefined, "my-random-token"), null);
  assert.equal(resolveKeyVerificationProvider("ollama", "anymodel-like-but-unknown"), null);
  assert.equal(resolveKeyVerificationProvider("unknown", "sk-short"), null);
});
