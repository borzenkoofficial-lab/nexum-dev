import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentIntent, inferIntentType } from "./intent.js";

test("infers intent categories from explicit user language", () => {
  assert.equal(inferIntentType("Создай новый сайт"), "create");
  assert.equal(inferIntentType("Исправь ошибку сборки"), "debug");
  assert.equal(inferIntentType("Проведи рефакторинг Agent Loop"), "refactor");
  assert.equal(inferIntentType("Проанализируй runtime"), "analyze");
  assert.equal(inferIntentType("Измени страницу проекта"), "modify");
});

test("intent keeps correlation and explicit acceptance data", () => {
  const intent = createAgentIntent("Добавь страницу настроек", {
    requestId: "req-1",
    projectId: "project-1",
    taskId: "task-1",
    acceptanceCriteria: ["Settings route exists"],
    explicitFiles: ["src/App.tsx"],
  });
  assert.equal(intent.type, "modify");
  assert.equal(intent.requestId, "req-1");
  assert.equal(intent.projectId, "project-1");
  assert.equal(intent.taskId, "task-1");
  assert.deepEqual(intent.acceptanceCriteria, ["Settings route exists"]);
  assert.deepEqual(intent.explicitFiles, ["src/App.tsx"]);
});
