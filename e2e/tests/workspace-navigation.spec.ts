import { test, expect } from "@playwright/test";

test("workspace navigation remains available across every main section", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("nexum:onboarding-complete", "1");
    sessionStorage.clear();
  });

  await page.goto("/");
  const navigation = page.getByRole("navigation", { name: "Основная навигация" });
  await expect(navigation).toBeVisible({ timeout: 15_000 });

  const sections = [
    { label: "Обзор", path: /\/projects\/?$/ },
    { label: "AI-агенты", path: /\/agents\/?$/ },
    { label: "Бизнес-агенты", path: /\/business-agents\/?$/ },
    { label: "Интеграции", path: /\/connectors\/?$/ },
    { label: "Диагностика", path: /\/diagnostics\/?$/ },
    { label: "Журнал", path: /\/news\/?$/ },
    { label: "Настройки", path: /\/settings\/?$/ },
  ];

  for (const section of sections) {
    await navigation.getByRole("button", { name: section.label, exact: true }).click();
    await expect(page).toHaveURL(section.path);
    await expect(navigation).toBeVisible();
  }
});
