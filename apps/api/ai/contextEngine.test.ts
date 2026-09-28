import assert from "node:assert/strict";
import { test } from "node:test";
import { extractIntent } from "./intentEngine.js";
import { selectContext } from "./contextEngine.js";
import type { ProjectUnderstanding } from "../projects/projectUnderstanding.js";

const understanding: ProjectUnderstanding = {
  projectId: "p1",
  projectType: "web",
  framework: "react-vite",
  health: "ready",
  entryPoints: ["src/main.tsx", "src/App.tsx"],
  relevantFiles: [
    "src/App.tsx",
    "src/main.tsx",
    "src/pages/Home.tsx",
    "src/pages/Construction.tsx",
    "src/components/Portfolio.tsx",
    "src/components/Checkout.tsx",
    "package.json",
    "vite.config.ts",
  ],
  scripts: ["build"],
  dependencies: ["react", "react-router-dom"],
  routes: ["/", "/portfolio", "/contacts"],
  architecture: ["React SPA", "route-based pages", "shared UI components"],
  designSystem: ["light", "graphite", "yellow accent"],
  domain: {
    value: "construction",
    productType: "construction company website",
    audience: "construction clients",
    confidence: 0.94,
  },
  risks: [],
};

test("prioritizes entry points and task-relevant construction files", () => {
  const task = "Создай страницу строительной компании с портфолио";
  const selected = selectContext(task, extractIntent(task), understanding);

  assert.equal(selected.files[0].path, "src/App.tsx");
  assert.ok(selected.files.some((file) => file.path === "src/pages/Construction.tsx"));
  assert.ok(selected.compactSummary.includes("construction"));
});

test("keeps context bounded", () => {
  const selected = selectContext("Создай сайт", extractIntent("Создай сайт"), understanding, {
    maxFiles: 4,
    maxChars: 1000,
  });

  assert.ok(selected.files.length <= 4);
  assert.ok(selected.charCount <= 1000);
});

test("preserves routes and architecture without dumping full project state", () => {
  const selected = selectContext("Проверь проект", extractIntent("Проверь проект"), understanding);

  assert.deepEqual(selected.routes, understanding.routes);
  assert.deepEqual(selected.architecture, understanding.architecture);
  assert.equal(selected.compactSummary.includes("dependencies"), false);
});
