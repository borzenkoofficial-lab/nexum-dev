import { expect, test } from "@playwright/test";

const STUDIO = "http://127.0.0.1:5174/studio/";

test("KVARD Studio: agent task from Studio updates files, changes and editor", async ({ page }) => {
  test.setTimeout(150_000);
  const created = await page.request.post("http://127.0.0.1:5173/api/projects", {
    data: { name: `e2e-agent-workspace-studio-${Date.now()}`, description: "AI Loop browser workspace", type: "static" },
  });
  expect(created.ok()).toBeTruthy();
  const projectId = (await created.json()).project.id as string;
  await page.addInitScript((id) => { localStorage.setItem("kvard:studio:project", id); }, projectId);

  await page.goto(STUDIO);
  const tree = page.getByRole("tree", { name: "Файлы проекта" });
  await expect(tree).toBeVisible({ timeout: 20_000 });
  const filesBefore = await page.locator(".st-tree-item").count();

  await page.getByLabel("Задача для AI-агента").fill("Создай сайт автосервиса с диагностикой и ремонтом автомобилей");
  await page.getByRole("button", { name: "Отправить" }).click();
  // Status comes from the backend ChatJob stream, not from a timer.
  const badge = page.locator(".st-agent .kv-status-badge");
  await expect(badge).toHaveText(/^(Готово|Ошибка|Отменено)$/, { timeout: 120_000 });
  await expect(badge).toHaveText("Готово");

  await expect.poll(async () => page.locator(".st-tree-item").count(), { timeout: 10_000 }).toBeGreaterThan(filesBefore);
  await page.getByRole("tab", { name: "Изменения" }).click();
  await expect(page.locator(".kv-changes-file").first()).toBeVisible({ timeout: 15_000 });

  await page.locator(".st-tree-item", { hasText: "package.json" }).first().click();
  await expect(page.getByRole("tab", { name: "Редактор" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".st-editor textarea")).toHaveValue(/"scripts"/);

  const separator = page.getByRole("separator", { name: "Ширина панели файлов" });
  const before = Number(await separator.getAttribute("aria-valuenow"));
  await separator.focus();
  await page.keyboard.press("ArrowRight");
  await expect(separator).toHaveAttribute("aria-valuenow", String(before + 16));
});

test("KVARD Studio fits a phone screen without horizontal scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(STUDIO);
  await expect(page.locator(".st-topbar")).toBeVisible({ timeout: 20_000 });
  for (const pane of ["Файлы", "Работа", "Агент"]) {
    await page.getByRole("button", { name: pane, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

async function studioWithApprovalAgent(page: import("@playwright/test").Page) {
  const created = await page.request.post("http://127.0.0.1:5173/api/projects", { data: { name: `studio-approval-${Date.now()}`, type: "static" } });
  const projectId = (await created.json()).project.id as string;
  const agentResponse = await page.request.post("http://127.0.0.1:5173/api/agents", {
    data: {
      name: `Studio approval agent ${Date.now()}`,
      description: "E2E agent used to verify approvals in Studio",
      systemPrompt: "Inspect the current project. Use only the allowed tools and report what you find.",
      provider: null, model: null, allowedTools: ["listFiles"], approvalPolicy: "always", status: "active",
    },
  });
  expect(agentResponse.ok()).toBeTruthy();
  const agent = (await agentResponse.json()).agent as { id: string; name: string };
  await page.addInitScript((id) => { localStorage.setItem("kvard:studio:project", id); }, projectId);
  await page.goto(STUDIO);
  await page.getByLabel("Агент для задачи").selectOption(agent.id);
  // Same task as the Platform approval E2E: the mock planner answers it with a single listFiles.
  await page.getByLabel("Задача для AI-агента").fill("Покажи структуру текущего проекта.");
  await page.getByRole("button", { name: "Отправить" }).click();
  const panel = page.getByRole("region", { name: "Агент ожидает подтверждения" });
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(panel).toContainText("listFiles");
  return panel;
}

test("KVARD Studio: a configured agent waits for approval and continues after it", async ({ page }) => {
  test.setTimeout(90_000);
  const panel = await studioWithApprovalAgent(page);
  await page.getByRole("button", { name: "Разрешить действие" }).click();
  await expect(panel).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator(".st-agent .kv-status-badge")).toHaveText("Готово", { timeout: 60_000 });
});

test("KVARD Studio: rejecting an approval stops the action", async ({ page }) => {
  test.setTimeout(90_000);
  await studioWithApprovalAgent(page);
  await page.getByRole("button", { name: "Отклонить" }).click();
  await expect(page.locator(".st-agent .kv-status-badge")).toHaveText(/^(Ошибка|Готово|Отменено)$/, { timeout: 60_000 });
  await expect(page.getByRole("region", { name: "Агент ожидает подтверждения" })).toHaveCount(0);
  await expect(page.locator(".st-events")).not.toContainText("listFiles: completed");
});
