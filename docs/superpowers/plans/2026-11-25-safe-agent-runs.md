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

- [ ] Verify tests fail before implementation.
- [ ] Add optional runtime configuration with systemPrompt and allowedTools.
- [ ] Filter getAvailableTools() and reject non-allowlisted executeTool() calls.
- [ ] Add the user-defined instruction block to planner/reviewer prompts with an explicit lower-priority trust boundary.
- [ ] Run focused tests and API typecheck.

### Task 2: Enforce safe autonomous configuration

**Files:**
- Modify: apps/api/agent/agentDefinitionStore.ts
- Modify: apps/api/agent/agentDefinitionStore.test.ts

- [ ] Verify the new validation test fails.
- [ ] Permit autonomous only when every configured tool has risk READ.
- [ ] Preserve always and writes as saved but non-runnable policies until an approval queue exists.
- [ ] Run the focused store tests.

### Task 3: Bind owned definitions to chat jobs

**Files:**
- Modify: apps/api/server.ts
- Modify: apps/api/agent/agentDefinitionStore.ts only if a narrowly scoped getter is required.
- Modify: apps/api/agent/agentDefinitionStore.test.ts if a getter is added.

- [ ] Accept optional agentDefinitionId on POST /api/chat.
- [ ] Load by authenticated owner, reject paused agents, reject non-autonomous approval policies, and reject any non-READ tool.
- [ ] Pass the resolved definition into runChatJob and the NexumAgent runtime.
- [ ] Use the saved provider/model when configured; do not accept client overrides for a configured agent.
- [ ] Keep the existing no-agent chat path unchanged.
- [ ] Verify invalid/paused/policy-incompatible agent requests fail before job creation.

### Task 4: Add an explicit run handoff in the UI

**Files:**
- Modify: apps/web/src/components/AgentsPage.tsx
- Modify: apps/web/src/App.tsx

- [ ] Add a task field and a button to open the selected saved agent in Studio.
- [ ] Carry the agent ID with the next submitted chat task; clear it after the request is accepted.
- [ ] Keep normal profiles separate from persistent agent definitions.
- [ ] Explain that this milestone supports user-submitted read-only runs only.

### Task 5: Verification and documentation

**Files:**
- Modify: docs/AGENT_DEFINITIONS.md
- Modify: docs/superpowers/plans/2026-11-25-agent-definitions.md

- [ ] Run full API tests, API typecheck, web typecheck, web tests, builds and E2E.
- [ ] Review account isolation, tool enforcement, prompt trust boundary and ordinary chat regression.
- [ ] Record exactly which checks passed and any unavailable verification.
