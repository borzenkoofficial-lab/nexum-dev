import assert from "node:assert/strict";
import { test } from "node:test";
import { getModelRegistry, routesForRole } from "./modelRegistry.js";

test("model registry contains the selected architecture roles", () => {
  const ids = new Set(getModelRegistry().map((route) => route.id));
  for (const id of ["director", "builder", "debugger", "worker", "cheap-worker", "coding-worker", "vision-ui", "fallback"]) {
    assert.ok(ids.has(id), id);
  }
});

test("registry routes only through providers that are actually available", () => {
  const routes = routesForRole("coder", new Set(["openrouter"]));
  assert.ok(routes.length > 0);
  assert.ok(routes.every((route) => route.provider === "openrouter"));
});

test("model IDs are configuration points rather than hard-coded provider coupling", () => {
  const registry = getModelRegistry();
  const coding = registry.find((route) => route.id === "coding-worker");
  assert.ok(coding);
  assert.equal(coding?.provider, process.env.NEXUM_CODING_WORKER_PROVIDER || "openrouter");
});
