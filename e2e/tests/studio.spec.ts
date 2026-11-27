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
