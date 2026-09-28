import assert from "node:assert/strict";
import { test } from "node:test";
import { extractIntent } from "./intentEngine.js";
import { buildExecutionOrder, decomposeTask } from "./taskDecomposer.js";

test("decomposes a construction site build into bounded dependent stages", () => {
  const task = "С нуля создай production сайт строительной компании по демонтажу фасадов с портфолио и формой заявки";
  const intent = extractIntent(task);
  const graph = decomposeTask(task, intent, {
    relevantFiles: ["src/App.tsx", "src/main.tsx", "package.json"],
    health: "ready",
  });

  assert.equal(graph.mode, "create");
  assert.equal(graph.complexity, "high");
  assert.deepEqual(graph.executionOrder, [
    ["understand"],
    ["scaffold"],
    ["implement"],
    ["verify"],
  ]);
  assert.equal(graph.nodes.find((item) => item.id === "implement")?.role, "coder");
});

test("decomposes debugging into diagnose, fix and verify", () => {
  const task = "Исправь runtime error в Preview";
  const graph = decomposeTask(task, extractIntent(task), {
    relevantFiles: ["src/App.tsx"],
    health: "attention",
  });

  assert.deepEqual(graph.executionOrder, [
    ["diagnose"],
    ["fix"],
    ["verify"],
  ]);
  assert.equal(graph.nodes[1].dependencies[0], "diagnose");
});

test("keeps a small modification bounded to implementation and verification", () => {
  const task = "Измени текст кнопки на странице";
  const graph = decomposeTask(task, extractIntent(task), {
    relevantFiles: ["src/App.tsx"],
  });

  assert.equal(graph.complexity, "medium");
  assert.equal(graph.nodes.length, 2);
  assert.deepEqual(graph.executionOrder, [["implement"], ["verify"]]);
});

test("does not parallelize tasks with overlapping mutable areas", () => {
  const task = "Проверь проект";
  const graph = decomposeTask(task, extractIntent(task), {
    relevantFiles: ["src/App.tsx"],
  });

  assert.equal(graph.parallelizable, false);
});

test("rejects dependency cycles", () => {
  assert.throws(
    () => buildExecutionOrder([
      {
        id: "a",
        title: "A",
        description: "",
        role: "coder",
        dependencies: ["b"],
        affectedAreas: ["same"],
        verificationRequired: false,
        risk: "low",
      },
      {
        id: "b",
        title: "B",
        description: "",
        role: "coder",
        dependencies: ["a"],
        affectedAreas: ["same"],
        verificationRequired: false,
        risk: "low",
      },
    ]),
    /dependency cycle/,
  );
});
