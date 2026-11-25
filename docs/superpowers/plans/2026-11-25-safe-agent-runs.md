# Safe Configured Agent Runs Implementation Plan

> **For agentic workers:** Use this plan task-by-task. Keep the change limited to authenticated, owner-scoped, read-only configured-agent execution.

**Goal:** Allow an active saved agent to run a user-submitted task in an owned project while enforcing its saved prompt, provider/model selection, and read-only tool allowlist.

**Architecture:** Extend the existing /api/chat job pipeline with an optional owned agent definition. Pass an immutable execution policy into NexumAgent; filter discoverable tools and enforce the allowlist again at invocation time. Until an approval queue exists, only the autonomous policy with READ-only tools may run; always and writes configurations remain non-runnable. The user still explicitly submits each task.

**Tech Stack:** TypeScript, Express 5, existing AgentLoop/NexumAgent, PostgreSQL-backed agent definitions, React.

**Spec:** docs/AGENT_DEFINITIONS.md

## Global Constraints

- Never run a paused or foreign-account agent.
- Never allow an autonomous definition to include WRITE, EXECUTE, or DESTRUCTIVE tools.
- Enforce allowlists in executeTool, not only in model-visible tool lists.
- Preserve existing ordinary /api/chat behavior when no agent ID is supplied.
- User-defined system prompts cannot override platform safety, project scoping, or tool policies.
- Do not implement schedules or unattended triggers in this milestone.
- Do not imply that write approvals are supported.

## Review Focus

- Foreign or malformed agent IDs must not start jobs.
- Paused agents must not start jobs.
- READ-only mode must reject direct invocation of a write/execute tool.
- Empty allowlists must not silently become unrestricted access.
- Existing chat jobs without an agent ID must retain current behavior.

---

### Task 1: Enforce runtime allowlists

**Files:**
- Modify: apps/api/agent/agent.ts
- Create: apps/api/agent/agent-config.test.ts
- Modify: apps/api/package.json

- [x] Added runtime allowlist and trust-boundary tests before implementation. A local RED run is unavailable in this GitHub-only editing session; CI will provide executable verification.
- [x] Add optional runtime configuration with systemPrompt and allowedTools.
- [x] Filter getAvailableTools() and reject non-allowlisted executeTool() calls.
- [x] Add the user-defined instruction block to planner/reviewer prompts with an explicit lower-priority trust boundary.
- [x] Configured-agent runtime tests and API typecheck passed in CI run #2607.

### Task 2: Enforce safe autonomous configuration

**Files:**
- Modify: apps/api/agent/agentDefinitionStore.ts
- Modify: apps/api/agent/agentDefinitionStore.test.ts

- [x] Added autonomous policy validation tests before implementation. Local RED run unavailable; CI will verify.
- [x] Permit autonomous only when every configured tool has risk READ.
- [ ] Preserve always and writes as saved but non-runnable policies until an approval queue exists.
- [x] Agent-definition store tests passed in CI run #2607.

### Task 3: Bind owned definitions to chat jobs

**Files:**
- Modify: apps/api/server.ts
- Modify: apps/api/agent/agentDefinitionStore.ts only if a narrowly scoped getter is required.
- Modify: apps/api/agent/agentDefinitionStore.test.ts if a getter is added.

- [x] Accept optional agentDefinitionId on POST /api/chat.
- [x] Load by authenticated owner, reject paused agents, reject non-autonomous approval policies, and reject any non-READ tool.
- [x] Pass the resolved definition into runChatJob and the NexumAgent runtime.
- [x] Use the saved provider/model when configured; saved values override client selections.
- [ ] Keep the existing no-agent chat path unchanged.
- [x] Server validates ownership, UUID, active status, autonomous policy and READ-only tools before creating the chat job; route-level negative integration tests remain a follow-up.

### Task 4: Add an explicit run handoff in the UI

**Files:**
- Modify: apps/web/src/components/AgentsPage.tsx
- Modify: apps/web/src/App.tsx

- [x] Add a task field and a button to open the selected saved agent in Studio.
- [x] Carry the agent ID with the next submitted chat task; clear it after the request is accepted.
- [x] Keep normal profiles separate from persistent agent definitions.
- [x] Explain that this milestone supports user-submitted read-only runs only.

### Task 5: Verification and documentation

**Files:**
- Modify: docs/AGENT_DEFINITIONS.md
- Modify: docs/superpowers/plans/2026-11-25-agent-definitions.md

- [x] API tests, API typecheck, web runtime tests, web typecheck, API/Web builds, lint, Docker build and production-container smoke test passed in CI run #2607. E2E remains in progress.
- [x] Static review confirms owner-scoped lookup, tool allowlist enforcement at invocation, lower-priority custom instruction boundary and unchanged no-agent request path. E2E verification is pending.
- [ ] Record exactly which checks passed and any unavailable verification.
