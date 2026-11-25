import { test, expect } from "@playwright/test";

async function createWorkspace(page: any): Promise<string> {
  const response = await page.request.post("/api/projects", {
    data: { name: `agent-approval-${Date.now()}`, description: "Agent approval E2E", type: "static" },
  });
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  return data.project.id as string;
}

async function createAgent(page: any, policy: "always" | "writes" = "always") {
  const name = `Approval agent ${Date.now()}`;
  const response = await page.request.post("/api/agents", {
    data: {
      name,
      description: "E2E agent used to verify per-tool approvals",
      systemPrompt: "Inspect the current project. Use only the allowed tools and report what you find.",
      provider: null,
      model: null,
      allowedTools: ["listFiles"],
      approvalPolicy: policy,
      status: "active",
    },
  });
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  expect(data.agent?.id).toBeTruthy();
  return { id: data.agent.id as string, name };
}

async function launchConfiguredAgent(page: any, projectId: string, agent: { id: string; name: string }) {
  await page.goto("/agents");
  await expect(page.getByRole("heading", { name: "Агенты и профили запуска" })).toBeVisible();
  await page.getByLabel("Проект для запуска").selectOption(projectId);
  const task = "Покажи структуру текущего проекта. Ничего не изменяй.";
  await page.getByLabel("Задача для выбранного агента").fill(task);
  const card = page.locator(".kv-agents-profile").filter({ hasText: agent.name });
  await card.getByRole("button", { name: "Открыть в Studio" }).click();
  const composer = page.getByLabel("Опишите задачу");
  await expect(composer).toHaveValue(task);
  await page.getByRole("button", { name: "Отправить задачу AI-агенту КВАРД" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__NEXUM_E2E_LAST_JOB_ID__ ?? null), { timeout: 5_000 }).toBeTruthy();
  return page.evaluate(() => (window as any).__NEXUM_E2E_LAST_JOB_ID__ as string);
}

async function getJob(page: any, jobId: string) {
  const response = await page.request.get(`/api/chat/jobs/${encodeURIComponent(jobId)}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).job;
}

async function waitForPendingApproval(page: any, jobId: string) {
  await expect.poll(async () => (await getJob(page, jobId)).pendingApproval?.status, { timeout: 15_000 }).toBe("pending");
  await expect(page.getByRole("region", { name: "Агент ожидает подтверждения" })).toBeVisible();
}

async function waitForTerminal(page: any, jobId: string) {
  await expect.poll(async () => (await getJob(page, jobId)).status, { timeout: 20_000 }).toMatch(/completed|failed|cancelled/);
  return getJob(page, jobId);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("nexum:onboarding-complete", "1");
    sessionStorage.clear();
  });
  await page.request.post("/api/test/agent-failures", { data: { operation: "reset" } }).catch(() => {});
});

test.afterEach(async ({ page }) => {
  await page.request.post("/api/test/agent-failures", { data: { operation: "reset" } }).catch(() => {});
});

test("Studio pauses a configured agent before a READ tool and resumes after approval", async ({ page }) => {
  const projectId = await createWorkspace(page);
  const agent = await createAgent(page, "always");
  const jobId = await launchConfiguredAgent(page, projectId, agent);
  await waitForPendingApproval(page, jobId);

  const pending = (await getJob(page, jobId)).pendingApproval;
  expect(pending.toolName).toBe("listFiles");
  expect(pending.risk).toBe("READ");
  expect(pending.inputPreview).toContain(".");
  expect((await getJob(page, jobId)).steps ?? []).toHaveLength(0);

  await page.getByRole("button", { name: "Разрешить действие" }).click();
  const completed = await waitForTerminal(page, jobId);
  expect(completed.status).toBe("completed");
  expect(completed.pendingApproval.status).toBe("approved");
  expect(completed.steps.some((step: any) => step.tool === "listFiles" && step.success)).toBeTruthy();
  expect(completed.events.some((event: any) => event.name === "agent.approval.approved")).toBeTruthy();
  await expect(page.getByRole("region", { name: "Агент ожидает подтверждения" })).toHaveCount(0);
});

test("rejecting an action prevents the tool from running", async ({ page }) => {
  const projectId = await createWorkspace(page);
  const agent = await createAgent(page, "always");
  const jobId = await launchConfiguredAgent(page, projectId, agent);
  await waitForPendingApproval(page, jobId);

  await page.getByRole("button", { name: "Отклонить" }).click();
  const completed = await waitForTerminal(page, jobId);
  expect(completed.pendingApproval.status).toBe("rejected");
  expect(completed.steps.some((step: any) => step.tool === "listFiles" && step.success)).toBe(false);
  expect(completed.events.some((event: any) => event.name === "agent.approval.rejected")).toBeTruthy();
});

test("cancelling a job while approval is pending cancels the approval", async ({ page }) => {
  const projectId = await createWorkspace(page);
  const agent = await createAgent(page, "always");
  const jobId = await launchConfiguredAgent(page, projectId, agent);
  await waitForPendingApproval(page, jobId);

  await page.getByRole("button", { name: "Отменить выполнение задачи" }).click();
  const cancelled = await waitForTerminal(page, jobId);
  expect(cancelled.status).toBe("cancelled");
  expect(cancelled.pendingApproval.status).toBe("cancelled");
  await expect(page.getByRole("region", { name: "Агент ожидает подтверждения" })).toHaveCount(0);
});
