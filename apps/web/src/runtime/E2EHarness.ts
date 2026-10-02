import { failureInjection, type FailureName } from "./FailureInjection.ts";
import { nexumRuntime } from "./Runtime.ts";

export interface NexumE2EHarness {
  status: () => ReturnType<typeof nexumRuntime.getInspection>;
  enableFailure: (scenario: FailureName, options?: { delayMs?: number; projectId?: string; taskId?: string }) => void;
  disableFailure: (scenario: FailureName) => void;
  resetFailures: () => void;
  runNetworkTask: (projectId: string) => Promise<unknown>;
  startNetworkTask: (projectId: string) => string;
  waitTask: (taskId: string) => Promise<unknown>;
  cancelNetworkTask: (taskId: string) => void;
  cancelProject: (projectId: string) => void;
  runConcurrentTasks: (projectIds: string[], count?: number) => Promise<unknown>;
  startPreviewHealthCheck: () => Promise<boolean>;
  shutdown: () => Promise<void>;
  restart: () => Promise<void>;
  forceVisualHealth: (health: "NORMAL" | "CRITICAL") => void;
  resetVisualHealth: () => void;
  startVisualLoop: (id: string) => void;
  stopVisualLoop: (id: string) => void;
}

const pendingTasks = new Map<string, Promise<unknown>>();

export function installE2EHarness() {
  if (!(import.meta.env.DEV || import.meta.env.VITE_E2E === "true")) return;

  const harness: NexumE2EHarness = {
    status: () => nexumRuntime.getInspection(),
    enableFailure: (scenario, options) => failureInjection.enableFailure(scenario, { delayMs: options?.delayMs, context: { projectId: options?.projectId, taskId: options?.taskId } }),
    disableFailure: (scenario) => failureInjection.disableFailure(scenario),
    resetFailures: () => failureInjection.resetFailures(),

    async runNetworkTask(projectId) {
      const taskId = harness.startNetworkTask(projectId);
      return harness.waitTask(taskId);
    },

    startNetworkTask(projectId) {
      const task = nexumRuntime.tasks.create({ projectId, operation: "e2e-network", maxRetries: 2 });
      nexumRuntime.tasks.update(task.id, "RUNNING");
      nexumRuntime.tasks.onCancel(task.id, () => nexumRuntime.network.cancelTask(task.id));
      const pending = nexumRuntime.network.fetch("/api/health?runtime-e2e=1", {
        projectId,
        taskId: task.id,
        operation: "e2e-network",
        retries: 2,
        retryBaseMs: 25,
      }).then(response => {
        nexumRuntime.tasks.update(task.id, response.ok ? "COMPLETED" : "FAILED", { progress: 1 });
        return { taskId: task.id, ok: response.ok, status: response.status };
      }).catch(error => {
        if (nexumRuntime.tasks.get(task.id)?.status !== "CANCELLED") {
          nexumRuntime.tasks.update(task.id, "FAILED", { error: error instanceof Error ? error.message : String(error) });
        }
        throw error;
      });
      pendingTasks.set(task.id, pending);
      void pending.finally(() => pendingTasks.delete(task.id));
      return task.id;
    },

    waitTask(taskId) {
      const pending = pendingTasks.get(taskId);
      return pending ?? Promise.resolve(nexumRuntime.tasks.get(taskId));
    },

    cancelNetworkTask(taskId) {
      nexumRuntime.network.cancelTask(taskId);
      nexumRuntime.tasks.cancel(taskId);
    },

    cancelProject(projectId) {
      nexumRuntime.network.cancelProject(projectId);
      nexumRuntime.tasks.cancelByProject(projectId);
      nexumRuntime.resources.releaseByContext(projectId);
    },

    forceVisualHealth(health) { failureInjection.disableFailure(health === "CRITICAL" ? "FORCE_VISUAL_NORMAL" : "FORCE_VISUAL_CRITICAL"); failureInjection.enableFailure(health === "CRITICAL" ? "FORCE_VISUAL_CRITICAL" : "FORCE_VISUAL_NORMAL"); nexumRuntime.performance.setHealthForTest(health); },
    resetVisualHealth() { failureInjection.disableFailure("FORCE_VISUAL_CRITICAL"); failureInjection.disableFailure("FORCE_VISUAL_NORMAL"); nexumRuntime.performance.setHealthForTest("NORMAL"); },
    startVisualLoop(id) { nexumRuntime.visual.registerAnimation(id, () => {}); },
    stopVisualLoop(id) { nexumRuntime.visual.stopAnimation(id); },

    async runConcurrentTasks(projectIds, count = 12) {
      const jobs = Array.from({ length: count }, (_, index) => {
        const projectId = projectIds[index % projectIds.length] ?? projectIds[0] ?? "e2e";
        return nexumRuntime.tasks.run(async (signal, task) => {
          const resourceId = nexumRuntime.resources.register("subscription", () => {}, { projectId, taskId: task.id, operation: "e2e-concurrency" });
          nexumRuntime.tasks.onCancel(task.id, () => nexumRuntime.resources.release(resourceId));
          await new Promise<void>((resolve, reject) => {
            const timer = window.setTimeout(resolve, failureInjection.getDelay("DELAY_TASK", 10));
            const abort = () => { window.clearTimeout(timer); reject(new DOMException("Task cancelled", "AbortError")); };
            if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
          });
          nexumRuntime.resources.release(resourceId);
          return index;
        }, { projectId, operation: "e2e-concurrent" });
      });
      return Promise.allSettled(jobs);
    },

    async startPreviewHealthCheck() {
      return nexumRuntime.preview.healthCheck();
    },

    async shutdown() {
      await nexumRuntime.shutdown();
    },

    async restart() {
      await nexumRuntime.start();
    },
  };

  (window as unknown as { __NEXUM_E2E__?: NexumE2EHarness }).__NEXUM_E2E__ = harness;
}
