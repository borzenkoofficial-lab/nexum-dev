import test from "node:test";
import assert from "node:assert/strict";
import { NexumDirector } from "./director.js";

test("director decomposes a complex app task into specialist roles", () => {
  const director = new NexumDirector();
  const decisions = director.decide("Создай полноценное SaaS-приложение доставки с backend, базой данных и авторизацией");

  assert.ok(decisions.length >= 3);
  assert.equal(decisions[0]?.role, "director");
  assert.ok(decisions.some((item) => item.role === "coder"));
  assert.ok(decisions.some((item) => item.role === "tester"));
});

test("director escalates after repeated failures", () => {
  const director = new NexumDirector();

  assert.equal(director.shouldEscalate(1, true, false), false);
  assert.equal(director.shouldEscalate(2, false, false), true);
  assert.equal(director.shouldEscalate(1, true, true), true);
});

test("director only parallelizes independent work without shared mutable files", () => {
  const director = new NexumDirector();

  assert.equal(director.shouldParallelize(2, false), true);
  assert.equal(director.shouldParallelize(2, true), false);
  assert.equal(director.shouldParallelize(1, false), false);
});
