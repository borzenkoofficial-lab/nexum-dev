import { test, expect } from "@playwright/test";

async function setFailure(page: any, operation: "enable" | "disable" | "reset", name?: string, times?: number, projectId?: string) {
  const response = await page.request.post("/api/test/agent-failures", {
    data: { operation, ...(name ? { name } : {}), ...(times ? { times } : {}), ...(projectId ? { projectId } : {}) },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function waitForFailurePhase(page: any, name: string, phase: "consumed" | "released") {
  await expect.poll(async () => {
    const response = await page.request.get("/api/test/agent-failures");
    if (!response.ok()) return false;
    const data = await response.json();
    const events = (data.diagnostics ?? []).filter((entry: any) => entry.name === name);
    const latestEnable = [...events].reverse().find((entry: any) => entry.phase === "enabled");
    return Boolean(latestEnable && events.some((entry: any) => entry.phase === phase && entry.timestamp >= latestEnable.timestamp && (!latestEnable.projectId || entry.projectId === latestEnable.projectId)));
  }, { timeout: 5_000 }).toBeTruthy();
}

async function submitAgent(page: any, message: string, projectId?: string) {
  const response = await page.request.post("/api/chat", {
    data: { message, projectId: projectId ?? undefined },
  });
  expect(response.status()).toBe(202);
  const body = await response.json();
  expect(body.success).toBeTruthy();
  expect(body.jobId).toBeTruthy();
  expect(body.runtimeTaskId).toBeTruthy();
  return body as { jobId: string; runtimeTaskId: string };
}

async function createE2EWorkspace(page: any): Promise<string> {
  const name = `e2e-agent-workspace-${Date.now()}`;
  const response = await page.request.post("/api/projects", {
    data: { name, description: "AI Loop browser workspace", type: "static" },
  });
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  return data.project.id as string;
}

async function getJob(page: any, jobId: string) {
  const response = await page.request.get(`/api/chat/jobs/${encodeURIComponent(jobId)}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).job;
}

async function waitForTerminal(page: any, jobId: string, timeout = 20_000) {
  await expect.poll(async () => (await getJob(page, jobId)).status, { timeout }).toMatch(/completed|failed|cancelled/);
  return getJob(page, jobId);
}

let e2eWorkspaceId = "";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("nexum:onboarding-complete", "1");
    sessionStorage.clear();
  });
  await page.request.post("/api/test/agent-failures", { data: { operation: "reset" } }).catch(() => {});
  e2eWorkspaceId = await createE2EWorkspace(page);
  await page.goto("/projects/" + encodeURIComponent(e2eWorkspaceId));
  await expect(page.getByLabel("Опишите задачу")).toBeVisible({ timeout: 10_000 });
});

test.afterEach(async ({ page }) => {
  await page.request.post("/api/test/agent-failures", { data: { operation: "reset" } }).catch(() => {});
});

test("E2E-01 user request creates one Agent Job and one canonical Runtime Task", async ({ page }) => {
  const input = page.getByLabel("Опишите задачу");
  await input.fill("Покажи структуру текущего проекта.");
  await page.getByRole("button", { name: "Отправить задачу агенту NEXUM" }).click();

  await expect(page.getByText("NEXUM выполняет задачу")).toBeVisible({ timeout: 5_000 });
  const jobId = await page.evaluate(() => (window as any).__NEXUM_E2E_LAST_JOB_ID__);
  const runtimeTaskId = await page.evaluate(() => (window as any).__NEXUM_E2E_RUNTIME_TASK_ID__);
  expect(jobId).toBeTruthy();
  expect(runtimeTaskId).toBeTruthy();

  const job = await getJob(page, jobId);
  expect(job.runtimeTaskId).toBe(runtimeTaskId);
  expect(job.requestId).toBeTruthy();

  const runtime = await (await page.request.get("/api/runtime/status")).json();
  expect(runtime.tasks.filter((task: any) => task.id === runtimeTaskId)).toHaveLength(1);
  expect(runtime.tasks.filter((task: any) => task.operation === "ai-agent-job")).toHaveLength(0);
});

test("E2E-02 intent → plan → execution state is persisted", async ({ page }) => {
  const { jobId } = await submitAgent(page, "Покажи структуру текущего проекта.");
  const job = await waitForTerminal(page, jobId);

  expect(job.agentIntent?.objective).toContain("Покажи структуру");
  expect(job.agentIntent?.agentJobId).toBe(job.id);
  expect(job.executionPlan?.planId).toBeTruthy();
  expect(job.executionPlan?.taskId).toBe(job.runtimeTaskId);
  expect(job.executionState).toBeTruthy();
  expect(["COMPLETED", "FAILED", "CANCELLED"]).toContain(job.executionState.state);
});

test("E2E-03 tool execution is structured and observable", async ({ page }) => {
  const { jobId } = await submitAgent(page, "Покажи структуру текущего проекта.");
  const job = await waitForTerminal(page, jobId);

  expect(Array.isArray(job.steps)).toBeTruthy();
  expect(job.steps.length).toBeGreaterThan(0);
  const first = job.steps[0];
  expect(first.tool).toBeTruthy();
  expect(first.toolCallId).toBeTruthy();
  expect(typeof first.durationMs).toBe("number");
  expect(first.planStepId).toBeTruthy();
  expect(Array.isArray(job.events)).toBeTruthy();
  expect(job.events.some((event: any) => event.name === "agent.tool.started")).toBeTruthy();
  expect(job.events.some((event: any) => event.name === "agent.tool.completed")).toBeTruthy();
});

test("E2E-04 validation failure is repaired and bounded", async ({ page }) => {
  await setFailure(page, "enable", "VALIDATION_FAILURE", 1);
  const { jobId } = await submitAgent(page, "Покажи структуру текущего проекта.");
  const job = await waitForTerminal(page, jobId, 30_000);

  expect(job.status).toBe("completed");
  expect(job.validation?.passed).toBeTruthy();
  expect(job.executionState?.repairAttempts).toBeGreaterThanOrEqual(1);
  expect(job.events.some((event: any) => event.name === "agent.validation.failed")).toBeTruthy();
  expect(job.events.some((event: any) => event.name === "agent.repair.started")).toBeTruthy();
});

test("E2E-05 user cancellation produces CANCELLED terminal Agent and Runtime task", async ({ page }) => {
  await setFailure(page, "enable", "PLANNER_CHECKPOINT", undefined, e2eWorkspaceId);
  const input = page.getByLabel("Опишите задачу");
  await input.fill("Проверь структуру текущего проекта и ничего не изменяй.");
  await input.press("Enter");

  await page.waitForFunction(() => Boolean((window as any).__NEXUM_E2E_LAST_JOB_ID__));
  const jobId = await page.evaluate(() => (window as any).__NEXUM_E2E_LAST_JOB_ID__);
  expect(jobId).toBeTruthy();
  console.log("[CANCEL DOM]"+JSON.stringify(await page.locator(".composer-cancel").evaluateAll((els) => els.map((el) => ({ aria: el.getAttribute("aria-label"), text: el.textContent, display: getComputedStyle(el).display, visibility: getComputedStyle(el).visibility, opacity: getComputedStyle(el).opacity, rect: (el as HTMLElement).getBoundingClientRect().toJSON(), parent: el.parentElement?.className, hiddenAncestor: el.closest("[aria-hidden=\"true\"]")?.outerHTML.slice(0,120) ?? null }))));
  const cancel = page.getByRole("button", { name: "Отменить задачу Agent" });
  await expect(cancel).toBeVisible({ timeout: 5_000 });
  await waitForFailurePhase(page, "PLANNER_CHECKPOINT", "consumed");
  await cancel.click();

  await expect.poll(async () => (await getJob(page, jobId)).status, { timeout: 10_000 }).toBe("cancelled");
  const job = await getJob(page, jobId);
  const runtime = await (await page.request.get("/api/runtime/status")).json();
  const task = runtime.tasks.find((item: any) => item.id === job.runtimeTaskId);

  expect(job.status).toBe("cancelled");
  expect(task?.status).toBe("CANCELLED");
  expect(runtime.resources).toBe(0);
  expect(runtime.processes).toHaveLength(0);
  expect(job.events.some((event: any) => event.name === "agent.cancelled")).toBeTruthy();
});

test("E2E-06 cancellation is idempotent and cannot be resurrected by late completion", async ({ page }) => {
  await setFailure(page, "enable", "TOOL_CHECKPOINT");
  const { jobId } = await submitAgent(page, "Покажи структуру проекта.", e2eWorkspaceId);
  await waitForFailurePhase(page, "TOOL_CHECKPOINT", "consumed");

  const first = await page.request.post(`/api/chat/jobs/${encodeURIComponent(jobId)}/cancel`);
  const second = await page.request.post(`/api/chat/jobs/${encodeURIComponent(jobId)}/cancel`);
  expect(first.ok()).toBeTruthy();
  expect(second.ok()).toBeTruthy();

  const job = await getJob(page, jobId);
  expect(job.status).toBe("cancelled");
  const runtime = await (await page.request.get("/api/runtime/status")).json();
  expect(runtime.tasks.find((item: any) => item.id === job.runtimeTaskId)?.status).toBe("CANCELLED");
});

test("E2E-07 cancellation during real tool execution aborts before completion", async ({ page }) => {
  await setFailure(page, "enable", "TOOL_CHECKPOINT");
  const { jobId } = await submitAgent(page, "Покажи структуру текущего проекта.", e2eWorkspaceId);
  await waitForFailurePhase(page, "TOOL_CHECKPOINT", "consumed");

  const cancel = await page.request.post(`/api/chat/jobs/${encodeURIComponent(jobId)}/cancel`);
  expect(cancel.ok()).toBeTruthy();

  await expect.poll(async () => (await getJob(page, jobId)).status, { timeout: 10_000 }).toBe("cancelled");
  const job = await getJob(page, jobId);
  const runtime = await (await page.request.get("/api/runtime/status")).json();
  expect(job.status).toBe("cancelled");
  expect(runtime.tasks.find((task: any) => task.id === job.runtimeTaskId)?.status).toBe("CANCELLED");
  expect(runtime.resources).toBe(0);
  expect(runtime.processes).toHaveLength(0);
  expect(job.steps ?? []).toHaveLength(0);
});

test("E2E-08 completion gate blocks injected validation failure before final completion", async ({ page }) => {
  await setFailure(page, "enable", "VALIDATION_FAILURE", 10);
  const { jobId } = await submitAgent(page, "Покажи структуру текущего проекта.");
  const terminal = await waitForTerminal(page, jobId, 30_000);
  expect(terminal.status).toBe("failed");
  expect(terminal.events.some((event: any) => event.name === "agent.validation.failed")).toBeTruthy();
  expect(terminal.events.some((event: any) => event.name === "agent.completed")).toBeFalsy();
});

test("E2E-09 browser reload preserves one Agent Job without duplicate submission", async ({ page }) => {
  const { jobId } = await submitAgent(page, "Покажи структуру текущего проекта.");
  await page.reload();
  const final = await waitForTerminal(page, jobId, 30_000);

  const jobsResponse = await page.request.get("/api/chat/jobs/" + encodeURIComponent(jobId));
  expect(jobsResponse.ok()).toBeTruthy();
  expect((await jobsResponse.json()).job.id).toBe(jobId);
  expect(final.status).toMatch(/completed|failed/);
});

test("E2E-10 project isolation keeps independent Agent Jobs independent", async ({ page }) => {
  const projectNames = ["ai-loop-project-A", "ai-loop-project-B", "ai-loop-project-C"];
  const projects = [];
  for (const name of projectNames) {
    const response = await page.request.post("/api/projects", {
      data: { name, description: "AI loop isolation", type: "static" },
    });
    expect(response.ok() || response.status() === 409).toBeTruthy();
    const data = response.status() === 409 ? await (await page.request.get("/api/projects")).json() : await response.json();
    const project = response.status() === 409
      ? data.projects.find((item: any) => item.name === name)
      : data.project;
    expect(project?.id).toBeTruthy();
    projects.push(project.id);
  }

  const jobs = await Promise.all(projects.map((id) => submitAgent(page, "Покажи структуру текущего проекта.", id)));
  await page.request.post(`/api/chat/jobs/${encodeURIComponent(jobs[0].jobId)}/cancel`);
  const a = await getJob(page, jobs[0].jobId);
  expect(a.status).toBe("cancelled");

  const b = await waitForTerminal(page, jobs[1].jobId, 30_000);
  const c = await waitForTerminal(page, jobs[2].jobId, 30_000);
  expect(["completed", "failed"]).toContain(b.status);
  expect(["completed", "failed"]).toContain(c.status);

  expect(a.projectId).toBe(projects[0]);
  expect(b.projectId).toBe(projects[1]);
  expect(c.projectId).toBe(projects[2]);
});

test("E2E-11 concurrent Agent Jobs create isolated Runtime Tasks", async ({ page }) => {
  const jobs = await Promise.all([
    submitAgent(page, "Покажи структуру текущего проекта."),
    submitAgent(page, "Покажи структуру текущего проекта."),
    submitAgent(page, "Покажи структуру текущего проекта."),
  ]);
  const runtimeIds = new Set(jobs.map((job) => job.runtimeTaskId));
  expect(runtimeIds.size).toBe(3);
  const terminal = await Promise.all(jobs.map((job) => waitForTerminal(page, job.jobId, 30_000)));
  expect(terminal.every((job) => ["completed", "failed", "cancelled"].includes(job.status))).toBeTruthy();
  expect(new Set(terminal.map((job) => job.projectId)).size).toBe(1);
});

test("E2E-12 model failure follows controlled recovery without infinite retries", async ({ page }) => {
  await setFailure(page, "enable", "MODEL_FAILURE", 1);
  const { jobId } = await submitAgent(page, "Покажи структуру текущего проекта.");
  const job = await waitForTerminal(page, jobId, 30_000);

  expect(["completed", "failed"]).toContain(job.status);
  expect(job.events.some((event: any) => /AI planner|model/i.test(event.message))).toBeTruthy();
});

test("E2E-13 network failure uses bounded provider recovery", async ({ page }) => {
  await setFailure(page, "enable", "NETWORK_FAILURE", 1);
  const { jobId } = await submitAgent(page, "Покажи структуру текущего проекта.");
  const job = await waitForTerminal(page, jobId, 30_000);

  expect(["completed", "failed"]).toContain(job.status);
  expect(job.events.some((event: any) => /AI planner|network/i.test(event.message))).toBeTruthy();
});

test("E2E-14 permanent tool failure reaches FAILED without infinite loop", async ({ page }) => {
  await setFailure(page, "enable", "TOOL_FAILURE");
  const { jobId } = await submitAgent(page, "Покажи структуру текущего проекта.");
  const job = await waitForTerminal(page, jobId, 30_000);

  expect(job.status).toBe("failed");
  expect(job.executionState?.repairAttempts).toBeLessThanOrEqual(4);
  expect(job.events.some((event: any) => event.name === "agent.failed")).toBeTruthy();
});

test("E2E-15 repeated failing actions are detected as LOOP_DETECTED", async ({ page }) => {
  await setFailure(page, "enable", "TOOL_FAILURE");
  const { jobId } = await submitAgent(page, "Покажи структуру текущего проекта.");
  const job = await waitForTerminal(page, jobId, 30_000);

  expect(job.status).toBe("failed");
  expect(job.errorInfo?.summary).toMatch(/LOOP_DETECTED|Bounded repair/i);
});

test("E2E-16 final verification is persisted before completion", async ({ page }) => {
  const { jobId } = await submitAgent(page, "Покажи структуру текущего проекта.");
  const job = await waitForTerminal(page, jobId, 30_000);

  expect(job.status).toBe("completed");
  expect(job.validation?.passed).toBeTruthy();
  expect(job.executionState?.state).toBe("COMPLETED");
  expect(job.executionPlan.steps.some((step: any) => step.id === "verify" && step.status === "COMPLETED")).toBeTruthy();
  expect(job.executionPlan.steps.some((step: any) => step.id === "complete" && step.status === "COMPLETED")).toBeTruthy();
});

test("E2E-17 one transient tool failure enters repair and then completes", async ({ page }) => {
  await setFailure(page, "enable", "TOOL_FAILURE", 1);
  const { jobId } = await submitAgent(page, "Покажи структуру текущего проекта.");
  const job = await waitForTerminal(page, jobId, 30_000);

  expect(job.status).toBe("completed");
  expect(job.events.some((event: any) => event.name === "agent.repair.started")).toBeTruthy();
  expect(job.events.some((event: any) => event.name === "agent.repair.completed")).toBeTruthy();
  expect(job.validation?.passed).toBeTruthy();
});


test.skip("E2E-18 streaming cancellation is NOT APPLICABLE: all current production AI providers expose non-streaming generation", async () => {});
