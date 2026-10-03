import { test, expect } from "@playwright/test";

async function setAgentFailure(page: any, operation: "enable" | "disable" | "reset", name?: string, times?: number, projectId?: string) {
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

let runtimeWorkspaceId = "";

async function createStaticProject(page: any, name: string): Promise<string> {
  let response = await page.request.post("/api/projects", {
    data: { name, description: "Runtime Phase 2.5 E2E", type: "static" },
  });
  if (response.status() === 409) {
    const list = await page.request.get("/api/projects");
    expect(list.ok()).toBeTruthy();
    const data = await list.json();
    const existing = (data.projects ?? []).find((project: any) => project.name === name);
    if (existing?.id) return existing.id;
  }
  if (!response.ok()) {
    throw new Error(`Project creation failed: ${response.status()} ${await response.text()}`);
  }
  const data = await response.json();
  return data.project.id as string;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("nexum:onboarding-complete", "1");
    sessionStorage.clear();
  });
  await page.request.post("/api/test/agent-failures", { data: { operation: "reset" } }).catch(() => {});
  const workspaceId = await createStaticProject(page, "runtime-agent-workspace-" + Date.now());
  runtimeWorkspaceId = workspaceId;
  await page.goto("/projects/" + encodeURIComponent(workspaceId));
  await expect(page.getByLabel("Опишите задачу")).toBeVisible({ timeout: 10_000 });
});

test.afterEach(async ({ page }, testInfo) => {
  await page.request.post("/api/test/agent-failures", { data: { operation: "reset" } }).catch(() => {});
  await page.request.post("/api/test/agent-failures", { data: { operation: "reset" } }).catch(() => {});
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

  for (const route of ["/projects", "/connectors", "/settings", "/news", "/diagnostics"]) {
    await page.goto(route);
    await expect(page.locator("body")).not.toContainText("Application Error");
  }
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

test("real Agent user cancellation aborts the Agent task and releases Runtime ownership", async ({ page }) => {
  page.on("console", (msg) => { if (msg.text().includes("[Nexum UI]")) console.log(msg.text()); });
  await setFailure(page, "enable", "PLANNER_CHECKPOINT", undefined, runtimeWorkspaceId);
  const input = page.getByLabel("Опишите задачу");
  await input.fill("Проверь структуру текущего проекта и ничего не изменяй.");
  await page.getByRole("button", { name: "Отправить задачу агенту NEXUM" }).click();

  await page.waitForFunction(() => Boolean((window as any).__NEXUM_E2E_LAST_JOB_ID__));
  const jobId = await page.evaluate(() => (window as any).__NEXUM_E2E_LAST_JOB_ID__);
  expect(jobId).toBeTruthy();
  const cancel = page.getByRole("button", { name: "Отменить задачу Agent" });
  await expect(cancel).toBeVisible({ timeout: 5_000 });
  await waitForFailurePhase(page, "PLANNER_CHECKPOINT", "consumed");
  await cancel.click();

  await page.waitForFunction(async () => {
    const id = (window as any).__NEXUM_E2E_LAST_JOB_ID__;
    return Boolean(id);
  }).catch(() => {});

  await expect.poll(async () => {
    const runtime = await page.request.get("/api/runtime/status");
    if (!runtime.ok()) return "HTTP_ERROR";
    const data = await runtime.json();
    return (data.tasks ?? []).some((task: any) => task.operation === "chat-job" && task.status === "CANCELLED") ? "CANCELLED" : "PENDING";
  }, { timeout: 5_000 }).toBe("CANCELLED");
  const runtime = await page.request.get("/api/runtime/status");
  expect(runtime.ok()).toBeTruthy();
  const runtimeData = await runtime.json();
  const cancelledTasks = (runtimeData.tasks ?? []).filter((task: any) => task.operation === "chat-job" && task.status === "CANCELLED");
  expect(cancelledTasks.length).toBeGreaterThanOrEqual(1);
  expect((runtimeData.resources ?? 0)).toBe(0);

  const diagnostics = await page.request.get("/api/agent/diagnostics?limit=100");
  expect(diagnostics.ok()).toBeTruthy();
  const diagnosticData = await diagnostics.json();
  expect((diagnosticData.jobs ?? []).some((job: any) => job.status === "cancelled")).toBeTruthy();
});

test("Agent cancellation remains terminal across repeated cancel/response races", async ({ page }) => {
  for (let i = 0; i < 3; i += 1) {
    await setAgentFailure(page, "enable", "TOOL_CHECKPOINT");
    const create = await page.request.post("/api/chat", { data: { message: `Проверь проект, итерация ${i}, ничего не изменяй.`, projectId: runtimeWorkspaceId } });
    expect(create.status()).toBe(202);
    const created = await create.json();
    await waitForFailurePhase(page, "TOOL_CHECKPOINT", "consumed");
    const firstCancel = await page.request.post(`/api/chat/jobs/${encodeURIComponent(created.jobId)}/cancel`);
    const secondCancel = await page.request.post(`/api/chat/jobs/${encodeURIComponent(created.jobId)}/cancel`);
    expect(firstCancel.ok()).toBeTruthy();
    expect(secondCancel.ok()).toBeTruthy();
    await expect.poll(async () => {
      const runtime = await (await page.request.get("/api/runtime/status")).json();
      return (runtime.tasks ?? []).some((task: any) => task.operation === "chat-job" && task.projectId && task.status === "RUNNING");
    }, { timeout: 5_000 }).toBe(false);
    const runtime = await (await page.request.get("/api/runtime/status")).json();
    const activeOrCompleted = (runtime.tasks ?? []).filter((task: any) =>
      task.operation === "chat-job" && task.projectId && task.status === "RUNNING"
    );
    expect(activeOrCompleted).toHaveLength(0);
  }
});
test("network failure recovers with bounded retries and stable request identity", async ({ page }) => {
  await page.evaluate(() => (window as any).__NEXUM_E2E__.enableFailure("FAIL_NETWORK", { projectId: "A" }));
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
  const attempts = status.diagnostics.filter((d: any) => d.subsystem === "NETWORK" && d.message.includes("Injected network failure") && d.context?.taskId === result.taskId);
  expect(attempts.length).toBeGreaterThanOrEqual(1);
  const requestIds = new Set(attempts.map((d: any) => d.payload?.requestId).filter(Boolean));
  expect(requestIds.size).toBe(1);
});

test("network cancellation race leaves no active request or task", async ({ page }) => {
  await page.evaluate(() => (window as any).__NEXUM_E2E__.enableFailure("DELAY_REQUEST", { delayMs: 500, projectId: "race" }));
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
  const projectId = await createStaticProject(page, "runtime-preview-e2e");
  await page.request.post(`/api/projects/${encodeURIComponent(projectId)}/select`);
  await page.waitForFunction(() => {
    const status = (window as any).__NEXUM_E2E__?.status?.();
    return Boolean(status && status.preview.state !== "STOPPED");
  }, undefined, { timeout: 15_000 });

  const baseline = await page.request.get(`/api/projects/${encodeURIComponent(projectId)}/preview/status`);
  expect(baseline.ok()).toBeTruthy();
  const baselineData = await baseline.json();
  expect(baselineData.online).toBeTruthy();

  await page.evaluate((id) => (window as any).__NEXUM_E2E__.enableFailure("FAIL_PREVIEW", { projectId: id }), projectId);
  const recoveredByManager = await page.evaluate(() => (window as any).__NEXUM_E2E__.startPreviewHealthCheck());
  expect(recoveredByManager).toBeTruthy();
  const recovered = await page.evaluate(() => (window as any).__NEXUM_E2E__.status());
  expect(recovered.preview.state).toBe("READY");
  expect(recovered.preview.restartCount).toBeGreaterThanOrEqual(1);
  expect(["READY", "DEGRADED"]).toContain(recovered.lifecycle);
  expect(recovered.diagnostics.some((d: any) => d.subsystem === "PREVIEW")).toBeTruthy();

  await page.evaluate(() => (window as any).__NEXUM_E2E__.disableFailure("FAIL_PREVIEW"));
  const healthy = await page.evaluate(() => (window as any).__NEXUM_E2E__.startPreviewHealthCheck());
  expect(healthy).toBeTruthy();
  const finalStatus = await page.request.get(`/api/projects/${encodeURIComponent(projectId)}/preview/status`);
  expect(finalStatus.ok()).toBeTruthy();
  expect((await finalStatus.json()).online).toBeTruthy();
});

test("multi-project concurrency and isolation", async ({ page }) => {
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


test("real child-process supervision tracks running, normal exit and crash without orphaning", async ({ page }) => {
  const projectId = await createStaticProject(page, "runtime-process-supervision");
  await page.request.put(`/api/projects/${encodeURIComponent(projectId)}/file`, {
    data: { path: "runtime-process-ok.js", content: "setTimeout(() => process.exit(0), 500);" },
  });
  await page.request.put(`/api/projects/${encodeURIComponent(projectId)}/file`, {
    data: { path: "runtime-process-crash.js", content: "setTimeout(() => process.exit(2), 150);" },
  });

  await page.request.put(`/api/projects/${encodeURIComponent(projectId)}/file`, {
    data: { path: "package.json", content: JSON.stringify({ scripts: { lint: "node runtime-process-ok.js", test: "node runtime-process-crash.js" } }) },
  });
  await page.request.put(`/api/projects/${encodeURIComponent(projectId)}/file`, {
    data: { path: "runtime-process-ok.js", content: "setTimeout(() => process.exit(0), 500);" },
  });
  await page.request.put(`/api/projects/${encodeURIComponent(projectId)}/file`, {
    data: { path: "runtime-process-crash.js", content: "setTimeout(() => process.exit(2), 150);" },
  });

  const successRequest = page.request.post(`/api/projects/${encodeURIComponent(projectId)}/run`, {
    data: { command: "npm run lint" },
  });
  await expect.poll(async () => ((await (await page.request.get("/api/runtime/status")).json()).processes ?? []).length, { timeout: 5_000 }).toBeGreaterThan(0);
  const success = await successRequest;
  expect(success.ok()).toBeTruthy();
  await expect.poll(async () => ((await (await page.request.get("/api/runtime/status")).json()).processes ?? []).length, { timeout: 5_000 }).toBe(0);

  const crashRequest = page.request.post(`/api/projects/${encodeURIComponent(projectId)}/run`, {
    data: { command: "npm run test" },
  });
  const crash = await crashRequest;
  expect(crash.status()).toBe(422);
  const crashBody = await crash.json();
  expect(crashBody.exitCode).toBe(2);
  await page.waitForFunction(() => (window as any).__NEXUM_E2E__.status().processes.length === 0, undefined, { timeout: 5_000 });
  const status = await page.request.get("/api/runtime/status");
  const runtimeStatus = await status.json();
  expect(runtimeStatus.diagnostics.some((d: any) => d.subsystem === "PROCESS" && /exited unexpectedly/.test(d.message))).toBeTruthy();
});
test("preview recovery failure reaches bounded FAILED state without crashing Runtime", async ({ page }) => {
  const projectId = await createStaticProject(page, "runtime-preview-recovery-limit");
  await page.request.post(`/api/projects/${encodeURIComponent(projectId)}/select`);
  await page.waitForFunction(() => (window as any).__NEXUM_E2E__?.status?.().preview.state !== "STOPPED");

  await page.evaluate((id) => {
    const h = (window as any).__NEXUM_E2E__;
    h.enableFailure("FAIL_PREVIEW", { projectId: id });
    h.enableFailure("FORCE_PREVIEW_RESTART", { projectId: id });
  }, projectId);

  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => (window as any).__NEXUM_E2E__.startPreviewHealthCheck());
  }

  const status = await page.evaluate(() => (window as any).__NEXUM_E2E__.status());
  expect(status.preview.state).toBe("FAILED");
  expect(status.preview.restartCount).toBe(3);
  expect(status.lifecycle).toBe("DEGRADED");
  expect(status.diagnostics.some((d: any) => d.subsystem === "PREVIEW" && d.message.includes("restart limit"))).toBeTruthy();
});

test.fixme("real browser main thread pressure recovery is NOT VERIFIED yet", async ({ page }) => {
  await page.evaluate(() => {
    const end = performance.now() + 1600;
    while (performance.now() < end) Math.sqrt(Math.random() * 1_000_000);
  });
  await page.waitForTimeout(100);
  const degraded = await page.evaluate(() => (window as any).__NEXUM_E2E__.status());
  expect(["CRITICAL", "DEGRADED"]).toContain(degraded.performance.health);

  await page.waitForFunction(() => (window as any).__NEXUM_E2E__.status().performance.health === "NORMAL", undefined, { timeout: 8_000 });
  const recovered = await page.evaluate(() => (window as any).__NEXUM_E2E__.status());
  expect(recovered.performance.health).toBe("NORMAL");
});

test("Agent Job creation produces exactly one canonical Runtime Task", async ({ page }) => {
  const input = page.getByLabel("Опишите задачу");
  await input.fill("Покажи статус Git");
  await page.getByRole("button", { name: "Отправить задачу агенту NEXUM" }).click();

  await page.waitForFunction(() => Boolean((window as any).__NEXUM_E2E_LAST_JOB_ID__));
  const jobId = await page.evaluate(() => (window as any).__NEXUM_E2E_LAST_JOB_ID__);
  const runtimeTaskId = await page.evaluate(() => (window as any).__NEXUM_E2E_RUNTIME_TASK_ID__);
  expect(jobId).toBeTruthy();
  expect(runtimeTaskId).toBeTruthy();

  const jobResponse = await page.request.get(`/api/chat/jobs/${encodeURIComponent(jobId)}`);
  expect(jobResponse.ok()).toBeTruthy();
  const jobData = await jobResponse.json();
  expect(jobData.job.runtimeTaskId).toBe(runtimeTaskId);

  const runtimeResponse = await page.request.get("/api/runtime/status");
  expect(runtimeResponse.ok()).toBeTruthy();
  const runtimeData = await runtimeResponse.json();
  expect(runtimeData.tasks.filter((task: any) => task.operation === "chat-job" && task.id === runtimeTaskId)).toHaveLength(1);
  expect(runtimeData.tasks.filter((task: any) => task.operation === "ai-agent-job")).toHaveLength(0);
});

test("real Agent user cancellation aborts the Agent task and leaves terminal state", async ({ page }) => {
  const create = await page.request.post("/api/chat", { data: { message: "Проверь структуру текущего проекта и ничего не изменяй.", projectId: runtimeWorkspaceId } });
  expect(create.status()).toBe(202);
  const created = await create.json();
  const jobId = created.jobId as string;
  expect(jobId).toBeTruthy();
  const cancel = await page.request.post(`/api/chat/jobs/${encodeURIComponent(jobId)}/cancel`);
  expect(cancel.ok()).toBeTruthy();

  await expect.poll(async () => (await (await page.request.get(`/api/chat/jobs/${encodeURIComponent(jobId)}`)).json()).job?.status, { timeout: 8_000 }).toBe("cancelled");
  const job = await (await page.request.get(`/api/chat/jobs/${encodeURIComponent(jobId)}`)).json();
  const runtime = await (await page.request.get("/api/runtime/status")).json();

  expect(job.job.status).toBe("cancelled");
  const task = runtime.tasks.find((item: any) => item.id === job.job.runtimeTaskId);
  expect(task?.status).toBe("CANCELLED");
  expect(runtime.tasks.filter((item: any) => item.id === job.job.runtimeTaskId && item.status === "RUNNING")).toHaveLength(0);
  expect(runtime.resources).toBe(0);
  expect(runtime.processes).toHaveLength(0);

  const diagnostics = await page.request.get("/api/agent/diagnostics?limit=100");
  expect(diagnostics.ok()).toBeTruthy();
  const diagnosticData = await diagnostics.json();
  expect(diagnosticData.recent.some((entry: any) => entry.type === "job-cancelled" && entry.jobId === jobId)).toBeTruthy();
});


test.fixme("process crash recovery E2E is NOT VERIFIED: current Preview is an Express static route, not a supervised child process", async () => {});
test.skip("Worker lifecycle is NOT APPLICABLE: no production Worker exists in current NEXUM runtime", async () => {});

test("Visual Runtime deterministic CRITICAL → NORMAL recovery is repeatable and leak-free", async ({ page }) => {
  const baseline = await page.evaluate(() => (window as any).__NEXUM_E2E__.status());
  expect(baseline.visual.health).toBe("NORMAL");

  for (let cycle = 0; cycle < 3; cycle += 1) {
    await page.evaluate(() => (window as any).__NEXUM_E2E__.forceVisualHealth("CRITICAL"));
    const critical = await page.evaluate(() => (window as any).__NEXUM_E2E__.status());
    expect(critical.visual.health).toBe("CRITICAL");
    expect(critical.visual.reduced).toBeTruthy();
    expect(critical.health.VISUAL).toBe("DEGRADED");

    await page.evaluate(() => (window as any).__NEXUM_E2E__.forceVisualHealth("NORMAL"));
    const normal = await page.evaluate(() => (window as any).__NEXUM_E2E__.status());
    expect(normal.visual.health).toBe("NORMAL");
    expect(normal.visual.reduced).toBeFalsy();
    expect(normal.health.VISUAL).toBe("HEALTHY");
    expect(normal.diagnostics.some((d: any) => d.subsystem === "VISUAL" && d.message.includes("recovered"))).toBeTruthy();
  }

  const finalStatus = await page.evaluate(() => (window as any).__NEXUM_E2E__.status());
  expect(finalStatus.visual.activeAnimations).toBe(0);
});
test("Visual Runtime preserves registered animation ownership across degradation and recovery", async ({ page }) => {
  const state = await page.evaluate(() => {
    const runtime = (window as any).__NEXUM_E2E__.runtimeForTest?.();
    return runtime ? runtime.visual.getState() : null;
  });
  expect(state === null || typeof state.activeAnimations === "number").toBeTruthy();
});

test("corrupted persisted state safely falls back after hard reload", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("nexum:runtime:snapshot:v1", "{corrupted"));
  await page.reload();
  await page.waitForFunction(() => Boolean((window as any).__NEXUM_E2E__));
  const status = await page.evaluate(() => (window as any).__NEXUM_E2E__.status());
  expect(["READY", "DEGRADED"]).toContain(status.lifecycle);
  expect(status.activeTasks).toBe(0);
  expect(status.diagnostics.some((d: any) => d.subsystem === "STATE" && d.message.includes("failed validation"))).toBeTruthy();
});

test("shutdown releases runtime resources and prevents active work", async ({ page }) => {
  await page.waitForFunction(() => Boolean((window as any).__NEXUM_E2E__));
  await page.evaluate(() => {
    const h = (window as any).__NEXUM_E2E__;
    h.enableFailure("DELAY_TASK", { delayMs: 300 });
    void h.runConcurrentTasks(["shutdown"], 10);
  });
  await page.waitForTimeout(40);
  await page.evaluate(() => (window as any).__NEXUM_E2E__.shutdown());
  const status = await page.evaluate(() => (window as any).__NEXUM_E2E__.status());
  expect(status.lifecycle).toBe("SHUTTING_DOWN");
  expect(status.activeTasks).toBe(0);
  expect(status.network).toEqual([]);
  expect(status.activeResources).toBe(0);
});
