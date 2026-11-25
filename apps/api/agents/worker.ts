import "dotenv/config";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { AIGateway } from "../ai/gateway.js";
import { OllamaProvider } from "../ai/providers/ollama.js";
import { OpenRouterProvider } from "../ai/providers/openrouter.js";
import { AnyModelProvider } from "../ai/providers/anymodel.js";
import { OpenAIProvider } from "../ai/providers/openai.js";
import { AnthropicProvider } from "../ai/providers/anthropic.js";
import { OrcaRouterProvider } from "../ai/providers/orcarouter.js";
import {
  claimNextAgentRun, getAgentVersionForRun, renewAgentRunLease, releaseAgentRunLease, updateRun, addRunEvent,
} from "./agentRepository.js";
import { AgentRuntime } from "./agentRuntime.js";
import { recordAgentRunUsage } from "../billing/quotaService.js";
import { closeDatabase } from "../db.js";

const leaseMs = Math.max(30_000, Math.min(300_000, Number(process.env.NEXUM_AGENT_RUN_LEASE_MS || 60_000)));
const pollMs = Math.max(250, Math.min(10_000, Number(process.env.NEXUM_AGENT_RUN_POLL_MS || 1_000)));
const workerId = process.env.NEXUM_WORKER_ID?.trim() || randomUUID();
const configuredProvider = process.env.AI_PROVIDER?.toLowerCase();
const providerId = configuredProvider === "ollama" || configuredProvider === "openrouter" ||
  configuredProvider === "openai" || configuredProvider === "anthropic" ||
  configuredProvider === "orcarouter" || configuredProvider === "anymodel"
  ? configuredProvider
  : process.env.ORCAROUTER_API_KEY?.trim() ? "orcarouter"
  : process.env.ANYMODEL_API_KEY?.trim() ? "anymodel"
  : process.env.OPENAI_API_KEY?.trim() ? "openai"
  : process.env.ANTHROPIC_API_KEY?.trim() ? "anthropic"
  : process.env.OPENROUTER_API_KEY?.trim() ? "openrouter"
  : process.env.OLLAMA_BASE_URL?.trim() ? "ollama" : undefined;

if (!process.env.NEXUM_DATABASE_URL?.trim()) {
  throw new Error("NEXUM_DATABASE_URL is required for the durable Agent worker.");
}
if (!providerId) {
  throw new Error("Configure AI_PROVIDER or a supported provider API key for the Agent worker.");
}

const gateway = new AIGateway([
  new OllamaProvider(), new OpenRouterProvider(), new AnyModelProvider(),
  new OpenAIProvider(), new AnthropicProvider(), new OrcaRouterProvider(),
], providerId);
const runtime = new AgentRuntime(gateway);
let stopping = false;

async function processOne(): Promise<boolean> {
  const claimed = await claimNextAgentRun(workerId, leaseMs);
  if (!claimed) return false;

  const controller = new AbortController();
  let heartbeatBusy = false;
  const heartbeat = setInterval(() => {
    if (heartbeatBusy || controller.signal.aborted) return;
    heartbeatBusy = true;
    void renewAgentRunLease(claimed.id, workerId, leaseMs)
      .then((renewed) => {
        if (!renewed) controller.abort(new DOMException("Agent run lease was lost", "AbortError"));
      })
      .catch((error) => {
        console.error("[NEXUM worker] lease renewal failed", { runId: claimed.id, error });
        controller.abort(new DOMException("Agent run lease renewal failed", "AbortError"));
      })
      .finally(() => { heartbeatBusy = false; });
  }, Math.max(5_000, Math.floor(leaseMs / 3)));

  try {
    const owned = await renewAgentRunLease(claimed.id, workerId, leaseMs);
    if (!owned) return true;
    const agent = await getAgentVersionForRun(claimed.organization_id, claimed.agent_id, claimed.agent_version_id);
    if (!agent) throw new Error("The immutable agent version for this queued run no longer exists.");
    await runtime.execute(
      agent as never, claimed.id, claimed.created_by, claimed.input, controller.signal, workerId,
    );
    await recordAgentRunUsage(claimed.id).catch((error) => {
      console.error("[NEXUM worker] usage recording failed", { runId: claimed.id, error });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected worker execution failure";
    await updateRun(claimed.id, "failed", { error: { code: "WORKER_EXECUTION_ERROR", message } }, workerId).catch(() => undefined);
    await addRunEvent(claimed.id, "run.worker_failed", { attempt: claimed.attempts, message }, workerId).catch(() => undefined);
    console.error("[NEXUM worker] run execution failed", { runId: claimed.id, attempt: claimed.attempts, error });
    // Deterministic runtime failures are terminal; never blindly replay tool side effects.
  } finally {
    clearInterval(heartbeat);
    await releaseAgentRunLease(claimed.id, workerId).catch((error) => {
      console.error("[NEXUM worker] lease release failed", { runId: claimed.id, error });
    });
  }
  return true;
}

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`[NEXUM worker] ${signal} received; no new runs will be claimed after the current run.`);
}

process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
process.once("SIGINT", () => { void shutdown("SIGINT"); });

console.log(`[NEXUM worker] started id=${workerId} poll=${pollMs}ms lease=${leaseMs}ms`);
try {
  while (!stopping) {
    try {
      const processed = await processOne();
      if (!processed) await delay(pollMs);
    } catch (error) {
      console.error("[NEXUM worker] queue poll failed", error);
      await delay(Math.min(10_000, pollMs * 5));
    }
  }
} finally {
  await closeDatabase();
  console.log("[NEXUM worker] stopped");
}
