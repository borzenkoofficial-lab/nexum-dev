import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProjectState } from "./projectState.js";
import { formatProjectUnderstanding, understandProject } from "./projectUnderstanding.js";

const state: ProjectState = {
  version: 2, projectId: "demo", projectType: "react", framework: "Vite",
  entryFiles: ["src/main.tsx", "src/App.tsx"], existingFiles: ["package.json", "src/main.tsx", "src/App.tsx", "src/components/Hero.tsx", "README.md"],
  dependencies: ["react", "vite"], buildCommand: "vite build", previewMode: "built-app",
  currentGoal: "Создай сайт строительной компании", intentDomain: "construction",
  intentProductType: "строительная компания или строительный сервис", intentAudience: "заказчики, подрядчики и представители бизнеса", intentConfidence: .85,
  completedActions: [], failedActions: [], changedFiles: [], knownErrors: [], architecture: ["Главная"], designSystem: ["светлая"],
  routes: ["/"], updatedAt: new Date().toISOString()
};

test("builds a compact understanding from project state", () => {
  const result = understandProject(state);
  assert.equal(result.framework, "Vite");
  assert.deepEqual(result.entryPoints, ["src/main.tsx", "src/App.tsx"]);
  assert.ok(result.relevantFiles.includes("package.json"));
  assert.equal(result.domain.value, "construction");
  assert.equal(result.health, "ready");
});

test("flags incomplete project knowledge", () => {
  const result = understandProject({...state, framework: null, buildCommand: null, previewMode: "unknown"});
  assert.equal(result.health, "unknown");
  assert.ok(result.risks.length >= 3);
});

test("formats understanding without dumping the whole project", () => {
  const text = formatProjectUnderstanding(understandProject(state));
  assert.ok(text.length < 3000);
  assert.match(text, /construction/);
});
