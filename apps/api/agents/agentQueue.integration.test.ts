import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { closeDatabase, query } from "../db.js";
import {
  cancelAgentRun, claimNextAgentRun, createAgentRun, getRun, renewAgentRunLease, updateRun,
} from "./agentRepository.js";

test("durable Agent queue enforces exclusive leases, recovery, idempotency and cancellation fencing", async () => {
  assert.ok(process.env.NEXUM_DATABASE_URL, "NEXUM_DATABASE_URL is required for queue integration tests");
  const userId = "00000000-0000-4000-8000-000000000001";
  const organizationId = randomUUID();
  const agentId = randomUUID();
  const versionId = randomUUID();
  const slug = "queue-test-" + randomUUID().replaceAll("-", "");
  try {
    await query("INSERT INTO organizations(id,name,slug) VALUES($1,'Queue integration test',$2)", [organizationId, slug]);
    await query("INSERT INTO organization_members(organization_id,user_id,role) VALUES($1,$2,'owner')", [organizationId, userId]);
    await query("INSERT INTO agents(id,organization_id,created_by,name,status) VALUES($1,$2,$3,'Queue test agent','published')", [agentId, organizationId, userId]);
    await query("INSERT INTO agent_versions(id,agent_id,version_number,instructions,provider,model,temperature,config,created_by) VALUES($1,$2,1,'test','openrouter','test-model',0.2,'{}'::jsonb,$3)", [versionId, agentId, userId]);
    await query("UPDATE agents SET current_version_id=$1 WHERE id=$2", [versionId, agentId]);

    const runId = await createAgentRun(organizationId, userId, agentId, versionId, { task: "lease-test" });
    assert.equal(await getRun(randomUUID(), runId), null, "runs must be scoped to their organization");

    const claimed = await claimNextAgentRun("worker-a", 30_000);
    assert.equal(claimed?.id, runId);
    assert.equal(Number(claimed?.attempts), 1);
    assert.equal(await claimNextAgentRun("worker-b", 30_000), null, "a live lease must exclude another worker");
    assert.equal(await renewAgentRunLease(runId, "worker-a", 30_000), true);

    await query("UPDATE agent_runs SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [runId]);
    const recovered = await claimNextAgentRun("worker-b", 30_000);
    assert.equal(recovered?.id, runId);
    assert.equal(Number(recovered?.attempts), 2);
    assert.equal(await renewAgentRunLease(runId, "worker-a", 30_000), false, "the previous owner must be fenced out");

    assert.equal(await cancelAgentRun(organizationId, runId), true);
    await updateRun(runId, "completed", { output: { shouldNotPersist: true } }, "worker-b");
    const cancelled = await getRun(organizationId, runId);
    assert.equal(cancelled?.status, "cancelled", "a stale worker must not overwrite cancellation");

    const idempotentA = await createAgentRun(organizationId, userId, agentId, versionId, { task: "dedupe" }, "same-request");
    const idempotentB = await createAgentRun(organizationId, userId, agentId, versionId, { task: "dedupe" }, "same-request");
    assert.equal(idempotentA, idempotentB, "same tenant idempotency key must return the original run");
    assert.equal(await cancelAgentRun(organizationId, idempotentA), true);

    const exhaustedId = await createAgentRun(organizationId, userId, agentId, versionId, { task: "exhaustion" });
    await query("UPDATE agent_runs SET max_attempts=1 WHERE id=$1", [exhaustedId]);
    const lastAttempt = await claimNextAgentRun("worker-c", 30_000);
    assert.equal(lastAttempt?.id, exhaustedId);
    await query("UPDATE agent_runs SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [exhaustedId]);
    assert.equal(await claimNextAgentRun("worker-d", 30_000), null);
    const exhausted = await getRun(organizationId, exhaustedId);
    assert.equal(exhausted?.status, "failed");
    assert.equal((exhausted?.error as { code?: string })?.code, "WORKER_LEASE_EXHAUSTED");
  } finally {
    await query("DELETE FROM organizations WHERE id=$1", [organizationId]).catch(() => undefined);
    await closeDatabase();
  }
});
