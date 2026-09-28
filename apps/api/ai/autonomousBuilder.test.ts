import test from "node:test";
import assert from "node:assert/strict";
import { extractIntent } from "./intentEngine.js";
import {
  builderExecutionPrompt,
  createBuilderExecutionState,
  nextBuilderStep,
  recordBuilderNodeResult,
} from "./autonomousBuilder.js";

test("builder state starts with the first graph node", () => {
  const task = "Создай production сайт строительной компании с CRM, API и авторизацией";
  const state = createBuilderExecutionState(task, extractIntent(task));
  const step = nextBuilderStep(state);

  assert.ok(step);
  assert.equal(step?.node.id, "understand");
  assert.equal(step?.node.role, "planner");
});

test("builder state advances only after successful node completion", () => {
  const task = "Создай production сайт строительной компании с CRM, API и авторизацией";
  const state = createBuilderExecutionState(task, extractIntent(task));
  const first = nextBuilderStep(state);
  assert.ok(first);

  recordBuilderNodeResult(state, first!.node.id, false);
  assert.equal(nextBuilderStep(state)?.node.id, "understand");

  recordBuilderNodeResult(state, first!.node.id, true);
  assert.equal(nextBuilderStep(state)?.node.id, "scaffold");
});

test("builder prompt is bounded and names the active node", () => {
  const task = "Создай сайт строительной компании по демонтажу фасадов";
  const state = createBuilderExecutionState(task, extractIntent(task));
  const prompt = builderExecutionPrompt(state, task);

  assert.match(prompt, /currentNode=/);
  assert.match(prompt, /Execute only this node/);
  assert.ok(prompt.length < 2_500);
});
