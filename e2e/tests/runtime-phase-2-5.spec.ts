import { test, expect } from "@playwright/test";

type Harness = {
  status: () => Promise<any>;
  enableFailure: (name: string, options?: any) => void;
  disableFailure: (name: string) => void;
  resetFailures: () => void;
  runNetworkTask: (projectId: string) => Promise<any>;
  startNetworkTask: (projectId: string) => string;
  waitTask: (taskId: string) => Promise<any>;
  cancelNetworkTask: (taskId: string) => void;
  cancelProject: (projectId: string) => void;
  runConcurrentTasks: (projectIds: string[], count?: number) => Promise<any>;
  startPreviewHealthCheck: () => Promise<boolean>;
};

async function harness(page: any): Promise<Harness> {
  await page.waitForFunction(() => Boolean((window as any).__NEXUM_E2E__));
  return page.evaluateHandle(() => (window as any).__NEXUM_E2E__).then((handle: any) => handle.jsonValue());
}

async function createStaticProject(page: any, name: string): Promise<string> {
  const response = await page.request.post("/api/projects", {
    data: { name, description: "Runtime Phase 2.5 E2E", type: "static" },
  });
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  const id = data.project.id as string;
  const file = await page.request.put(`/api/projects/${encodeURIComponent(id)}/file`, {
    data: { path: "index.html", content: `<!doctype html><html><body><h1>${name}</h1></body></html>` },
  });
  expect(file.ok()).toBeTruthy();
  return id;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("nexum:onboarding-complete", "1");
    sessionStorage.clear();
  });
});

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const status = await page.evaluate(() => (window as any).__NEXUM_E2E__?.status?.()).catch(() => null);
  await testInfo.attach("runtime-diagnostics.json", {
    body: Buffer.from(JSON.stringify(status, null, 2)),
    contentType: "application/json",
  });
  await testInfo.attach("browser-console.txt", {
    body: Buffer.from("Browser console is captured in the Playwright trace."),
    contentType: "text/plain",
  });
  await testInfo.attach("failure-screenshot.png", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});

test("boot, runtime inspection and browser-visible navigation", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).toContainText("NEXUM", { timeout: 15_000 });
  const status = await page.evaluate(() => (window as any).__NEXUM_E2E__.status());
  expect(["READY", "BUSY", "DEGRADED"]).toContain(status.lifecycle);
  expect(status.activeTasks).toBe(0);
  expect(status.activeResources).toBeGreaterThanOrEqual(0);

  await page.goto("/settings");
  await expect(page.locator("body")).toContainText("Настройки");
  await page.goto("/diagnostics");
  await expect(page.locator("body")).toContainText("Диагностика");
  await page.goto("/");
  await page.reload();
  await page.waitForFunction(() => Boolean((window as any).__NEXUM_E2E__));
  const restored = await page.evaluate(() => (window as any).__NEXUM_E2E__.status());
  expect(["READY", "DEGRADED"]).toContain(restored.lifecycle);

  const apiStatus = await page.request.get("/api/runtime/status");
  expect(apiStatus.ok()).toBeTruthy();
  const api = await apiStatus.json();
  expect(api.success).toBeTruthy();
  expect(["READY", "DEGRADED", "BUSY"]).toContain(api.lifecycle);
});

test("network failure recovers with bounded retries and stable request identity", async ({ page }) => {
  await page.goto("/");
  const h = await harness(page);
  h.enableFailure("FAIL_NETWORK", { projectId: "A" });
  const resultPromise = page.evaluate(async () => {
    const h = (window as any).__NEXUM_E2E__;
    const disable = () => h.disableFailure("FAIL_NETWORK");
    window.setTimeout(disable, 65);
    return h.runNetworkTask("A");
  });
  const result = await resultPromise;
  expect(result.ok).toBeTruthy();

  const status = await page.evaluate(() => (window as any).__NEXUM_E2E__.status());
  expect(status.activeTasks).toBe(0);
  expect(status.network).toEqual([]);
  const attempts = status.diagnostics.filter((d: any) => d.subsystem === "NETWORK" && d.message.includes("Injected network failure"));
  expect(attempts.length).toBeGreaterThanOrEqual(1);
  const requestIds = new Set(attempts.map((d: any) => d.payload?.requestId).filter(Boolean));
  expect(requestIds.size).toBe(1);
});

test("network cancellation race leaves no active request or task", async ({ page }) => {
  await page.goto("/");
  const h = await harness(page);
  h.enableFailure("DELAY_REQUEST", { delayMs: 500, projectId: "race" });
  const taskId = await page.evaluate(() => (window as any).__NEXUM_E2E__.startNetworkTask("race"));
  await page.waitForTimeout(50);
  await page.evaluate((id) => (window as any).__NEXUM_E2E__.cancelNetworkTask(id), taskId);
  await page.evaluate((id) => (window as any).__NEXUM_E2E__.waitTask(id).catch(() => null), taskId);
  await page.evaluate(() => (window as any).__NEXUM_E2E__.disableFailure("DELAY_REQUEST"));
  const status = await page.evaluate(() => (window as any).__NEXUM_E2E__.status());
  const task = status.tasks.find((item: any) => item.id === taskId);
  expect(task.status).toBe("CANCELLED");
  expect(status.network).toEqual([]);
  expect(status.activeTasks).toBe(0);
});

test("preview health failure is bounded and recovers when real preview is available", async ({ page }) => {
  await page.goto("/");
  const projectId = await createStaticProject(page, "runtime-preview-e2e");
  await page.goto(`/projects/${encodeURIComponent(projectId)}`);
  await page.waitForTimeout(500);
  const baseline = await page.request.get(`/api/projects/${encodeURIComponent(projectId)}/preview/status`);
  expect(baseline.ok()).toBeTruthy();
  const baselineData = await baseline.json();
  expect(baselineData.online).toBeTruthy();

  await page.evaluate(() => (window as any).__NEXUM_E2E__.enableFailure("FAIL_PREVIEW", { projectId: "runtime-preview-e2e" }));
  const failed = await page.evaluate(() => (window as any).__NEXUM_E2E__.startPreviewHealthCheck());
  expect(failed).toBeFalsy();
  const degraded = await page.evaluate(() => (window as any).__NEXUM_E2E__.status());
  expect(["UNHEALTHY", "FAILED", "RESTARTING"]).toContain(degraded.preview.state);

  await page.evaluate(() => (window as any).__NEXUM_E2E__.disableFailure("FAIL_PREVIEW"));
  const recovered = await page.evaluate(() => (window as any).__NEXUM_E2E__.startPreviewHealthCheck());
  expect(recovered).toBeTruthy();
  const ready = await page.evaluate(() => (window as any).__NEXUM_E2E__.status());
  expect(ready.preview.state).toBe("READY");
  expect(ready.preview.restartCount).toBeGreaterThanOrEqual(1);
});

test("multi-project concurrency and isolation", async ({ page }) => {
  await page.goto("/");
  const projects = await Promise.all([
    createStaticProject(page, "runtime-A"),
    createStaticProject(page, "runtime-B"),
    createStaticProject(page, "runtime-C"),
  ]);
  await page.evaluate((ids) => { void (window as any).__NEXUM_E2E__.runConcurrentTasks(ids, 15); }, projects);
  await page.waitForTimeout(60);
  const before = await page.evaluate(() => (window as any).__NEXUM_E2E__.status());
  const projectTasks = before.tasks.filter((t: any) => t.status === "COMPLETED");
  expect(projectTasks.length).toBeGreaterThanOrEqual(15);

  await page.evaluate((id) => {
    const h = (window as any).__NEXUM_E2E__;
    h.enableFailure("DELAY_TASK", { delayMs: 250, projectId: id });
    void h.runConcurrentTasks([id], 4);
  }, projects[0]);
  await page.waitForTimeout(40);
  await page.evaluate((id) => (window as any).__NEXUM_E2E__.cancelProject(id), projects[0]);
  const after = await page.evaluate(() => (window as any).__NEXUM_E2E__.status());
  expect(after.tasks.filter((t: any) => t.projectId === projects[0] && ["RUNNING", "QUEUED"].includes(t.status))).toHaveLength(0);
  expect(after.tasks.filter((t: any) => t.projectId === projects[1] && ["RUNNING", "COMPLETED"].includes(t.status)).length).toBeGreaterThan(0);
  expect(after.tasks.filter((t: any) => t.projectId === projects[2] && ["RUNNING", "COMPLETED"].includes(t.status)).length).toBeGreaterThan(0);
});

test("corrupted persisted state safely falls back after hard reload", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("nexum:runtime:snapshot:v1", "{corrupted");
  });
  await page.reload();
  await page.waitForFunction(() => Boolean((window as any).__NEXUM_E2E__));
  const status = await page.evaluate(() => (window as any).__NEXUM_E2E__.status());
  expect(["READY", "DEGRADED"]).toContain(status.lifecycle);
  expect(status.activeTasks).toBe(0);
  expect(status.diagnostics.some((d: any) => d.subsystem === "STATE" && d.message.includes("failed validation"))).toBeTruthy();
});

test("shutdown releases runtime resources and prevents active work", async ({ page }) => {
  await page.goto("/");
  const h = await harness(page);
  h.enableFailure("DELAY_TASK", { delayMs: 300 });
  await page.evaluate(() => (window as any).__NEXUM_E2E__.runConcurrentTasks(["shutdown"], 10));
  await page.evaluate(() => (window as any).__NEXUM_E2E__.shutdown());
  const status = await page.evaluate(() => (window as any).__NEXUM_E2E__.status());
  expect(status.lifecycle).toBe("SHUTTING_DOWN");
  expect(status.activeTasks).toBe(0);
  expect(status.network).toEqual([]);
  expect(status.activeResources).toBe(0);
});
