import test from "node:test";
import assert from "node:assert/strict";
import { extractIntent } from "./intentEngine.js";
import {
  builderExecutionPrompt,
  MAX_NODE_ATTEMPTS,
  createBuilderExecutionState,
  nextBuilderStep,
  recordBuilderNodeResult,
  rewindBuilderTo,
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

test("builder node becomes exhausted after bounded failed attempts", () => {
  const task = "Создай production сайт строительной компании с CRM, API и авторизацией";
  const state = createBuilderExecutionState(task, extractIntent(task));
  const nodeId = nextBuilderStep(state)!.node.id;

  for (let i = 0; i < MAX_NODE_ATTEMPTS; i += 1) {
    recordBuilderNodeResult(state, nodeId, false);
  }

  const step = nextBuilderStep(state);
  assert.ok(step);
  assert.equal(step?.node.id, nodeId);
  assert.equal(step?.blocked, true);
  assert.equal(step?.exhausted, true);
  assert.match(builderExecutionPrompt(state, task), /maxAttempts=/);
});

test("builder can rewind verification failure without resetting recovery budget", () => {
  const task = "Исправь ошибку сборки существующего приложения";
  const state = createBuilderExecutionState(task, extractIntent(task));
  const diagnose = nextBuilderStep(state);
  assert.equal(diagnose?.node.id, "diagnose");

  recordBuilderNodeResult(state, "diagnose", true);
  recordBuilderNodeResult(state, "fix", true);
  recordBuilderNodeResult(state, "verify", false);

  rewindBuilderTo(state, "diagnose");

  assert.equal(nextBuilderStep(state)?.node.id, "diagnose");
  assert.equal(state.attempts.get("verify"), 1);
});
