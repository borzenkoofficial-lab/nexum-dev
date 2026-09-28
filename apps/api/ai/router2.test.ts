import assert from "node:assert/strict";
import { test } from "node:test";
import { extractIntent } from "./intentEngine.js";
import { decomposeTask } from "./taskDecomposer.js";
import { routeWithStructuredContext } from "./router2.js";

test("routes construction build through structured intent and task graph", () => {
  const task = "С нуля создай сайт строительной компании с портфолио и формой заявки";
  const intent = extractIntent(task);
  const graph = decomposeTask(task, intent, { relevantFiles: ["src/App.tsx"] });
  const decision = routeWithStructuredContext({ task, intent, graph, availableProviders: ["openai", "anthropic", "orcarouter"] });
  assert.equal(decision.role, "coder");
  assert.equal(decision.complexity, "high");
  assert.ok(decision.route);
});

test("routes runtime errors to debugger", () => {
  const task = "Исправь runtime error в Preview";
  const intent = extractIntent(task);
  const graph = decomposeTask(task, intent, { relevantFiles: ["src/App.tsx"], health: "attention" });
  const decision = routeWithStructuredContext({ task, intent, graph, availableProviders: ["anthropic", "openai"] });
  assert.equal(decision.role, "debugger");
  assert.equal(decision.mode, "debug");
});

test("respects requested provider when available for the selected role", () => {
  const task = "Проведи аудит проекта";
  const intent = extractIntent(task);
  const graph = decomposeTask(task, intent, { relevantFiles: ["src/App.tsx"] });
  const decision = routeWithStructuredContext({ task, intent, graph, availableProviders: ["openai", "orcarouter"], requestedProvider: "orcarouter" });
  assert.equal(decision.role, "reviewer");
  assert.equal(decision.route?.provider, "orcarouter");
});