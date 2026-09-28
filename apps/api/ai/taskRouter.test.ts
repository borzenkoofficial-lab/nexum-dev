import assert from "node:assert/strict";
import { test } from "node:test";
import { routeTask } from "./taskRouter.js";

test("routes product creation to the coding specialist", () => {
  const decision = routeTask("Создай сайт строительной компании");
  assert.equal(decision.role, "coder");
  assert.equal(decision.mode, "build");
  assert.equal(decision.requiresVerification, true);
});

test("routes failures to the deep debugger", () => {
  const decision = routeTask("Исправь ошибку сборки npm run build");
  assert.equal(decision.role, "debugger");
  assert.equal(decision.mode, "debug");
  assert.equal(decision.requiresDebugger, true);
});

test("routes review requests to reviewer without unnecessary builder work", () => {
  const decision = routeTask("Проведи аудит проекта и найди проблемы");
  assert.equal(decision.role, "reviewer");
  assert.equal(decision.requiresBuilder, false);
});
