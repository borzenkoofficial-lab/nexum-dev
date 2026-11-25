import { test, expect } from "@playwright/test";

test("every main section has a clear page heading and fits desktop/mobile viewports", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("nexum:onboarding-complete", "1");
    sessionStorage.clear();
  });

  const sections = [
    { id: "agents", path: "/agents" },
    { id: "business-agents", path: "/business-agents" },
    { id: "integrations", path: "/connectors" },
    { id: "diagnostics", path: "/diagnostics" },
    { id: "journal", path: "/news" },
    { id: "settings", path: "/settings" },
  ];

  for (const section of sections) {
    for (const viewport of [{ width: 1440, height: 1000, name: "desktop" }, { width: 390, height: 844, name: "mobile" }]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(section.path);
      await expect(page.getByRole("navigation", { name: "Основная навигация" })).toBeVisible({ timeout: 15_000 });
      await expect(page.locator("h1").first()).toBeVisible({ timeout: 15_000 });

      const layout = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        rootWidth: document.getElementById("root")?.scrollWidth ?? 0,
      }));
      expect(layout.documentWidth, `${section.id} document overflow at ${viewport.width}px: ${JSON.stringify(layout)}`).toBeLessThanOrEqual(viewport.width);
      expect(layout.bodyWidth, `${section.id} body overflow at ${viewport.width}px`).toBeLessThanOrEqual(viewport.width);
      expect(layout.rootWidth, `${section.id} root overflow at ${viewport.width}px`).toBeLessThanOrEqual(viewport.width);

      await testInfo.attach(`${section.id}-${viewport.name}.png`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    }
  }
});
