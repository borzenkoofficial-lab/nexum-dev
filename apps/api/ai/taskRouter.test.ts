import assert from "node:assert/strict";
import { test } from "node:test";
import { executionBudget, routeTask } from "./taskRouter.js";

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

test("routes preview runtime failures to the deep debugger", () => {
  const decision = routeTask("Preview сообщил runtime error: UnhandledRejection в iframe");
  assert.equal(decision.role, "debugger");
  assert.equal(decision.mode, "debug");
  assert.equal(decision.requiresDebugger, true);
  assert.equal(decision.requiresVerification, true);
});

test("routes review requests to reviewer without unnecessary builder work", () => {
  const decision = routeTask("Проведи аудит проекта и найди проблемы");
  assert.equal(decision.role, "reviewer");
  assert.equal(decision.requiresBuilder, false);
});

test("keeps simple tasks on a single cheap execution path", () => {
  const budget = executionBudget(routeTask("Напиши функцию сортировки"));
  assert.equal(budget.maxAiCalls, 1);
});

test("allows a complex build to use a bounded repair cycle", () => {
  const budget = executionBudget(routeTask("С нуля разработай production marketplace с API и базой данных"));
  assert.equal(budget.maxAiCalls, 4);
});
