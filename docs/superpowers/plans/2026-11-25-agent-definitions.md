# Persistent AI Agent Definitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add account-scoped, persistent agent definitions with editable configuration and explicit tool/approval metadata.

**Architecture:** Keep reusable prompt profiles intact and add a separate agent-definition store and API. Validate configured tools against the existing tool security policy; do not connect definitions to autonomous execution until runtime enforcement exists.

**Tech Stack:** TypeScript, Express 5, PostgreSQL, node:test, existing React AgentsPage.

**Spec:** docs/superpowers/specs/2026-11-25-agent-definitions-design.md

## Global Constraints
- All agent definitions are scoped to the authenticated user.
- Existing profile API behavior is preserved.
- No credentials are stored in definitions.
- Approval policy and allowed tools are configuration metadata only in this milestone; no autonomous execution claim.
- No new runtime dependencies.

## Review Focus
- Cross-account access by guessing another agent UUID.
- Concurrent duplicate-name creation.
- Empty/unknown tool names and invalid enum values.
- Partial updates accidentally erasing existing fields.
- PostgreSQL unique-index conflicts and in-memory behavior parity.

---

### Task 1: Agent definition store and migration

**Files:**
- Create: `apps/api/agent/agentDefinitionStore.ts`
- Create: `apps/api/agent/agentDefinitionStore.test.ts`
- Create: `apps/api/db/migrations/003_agent_definitions.sql`
- Modify: `apps/api/db/migrate.ts`
- Modify: `apps/api/package.json`

**Interfaces:**
- `AgentDefinition`: id, userId, name, description, systemPrompt, provider, model, allowedTools, approvalPolicy, status, createdAt, updatedAt.
- Store functions: `listAgentDefinitions(userId)`, `createAgentDefinition(userId,input)`, `updateAgentDefinition(userId,id,patch)`, `deleteAgentDefinition(userId,id)`.
- `approvalPolicy`: `always | writes | autonomous`; `status`: `active | paused`.

- [x] Write tests first for create/list, account isolation, case-insensitive duplicate names, update only by owner, partial patch semantics, delete only by owner, unknown tool rejection, unsupported provider and empty fields.
- [ ] Run `npm --prefix apps/api test -- agent/agentDefinitionStore.test.ts` and confirm expected failures. Not yet run: no repository execution environment is connected.
- [x] Implement in-memory and PostgreSQL stores; use a text[] field for allowedTools, unique per-user lower(name) index, and owner-scoped UPDATE/DELETE.
- [x] Add migration 003 to the migration runner and register the test in the API test script.
- [ ] Run focused test and full API test suite.

### Task 2: Authenticated API

**Files:**
- Modify: `apps/api/server.ts`
- Create: `apps/api/agent/agentDefinitionApi.test.ts` only if existing server test harness can exercise routes without exporting production-only internals.

**Interfaces:**
- `GET /api/agents` → { success, storage, agents }
- `POST /api/agents` → 201 { success, storage, agent }
- `PATCH /api/agents/:id` → { success, agent }; 404 for absent/non-owned ID.
- `DELETE /api/agents/:id` → { success }; 404 for absent/non-owned ID.
- Validate name ≤ 48, description ≤ 160, systemPrompt ≤ 5000, provider ≤ 40, model ≤ 120, max 32 allowed tools.

- [x] Add auth middleware and CRUD routes using authenticated user ID.
- [x] Validate all inputs and tool names against `getToolSecurityPolicy`.
- [x] Return safe DTOs without userId.
- [x] Preserve profile routes and existing rate-limit behavior.
- [ ] Run API typecheck and full API tests.

### Task 3: Agents workspace configuration UI

**Files:**
- Modify: `apps/web/src/components/AgentsPage.tsx`
- Modify: `apps/web/src/kvard-design-system.css`

- [x] Add list/create/edit/pause/activate/delete flows for agent definitions.
- [x] Expose system prompt, optional provider/model, allowed tools and approval policy.
- [x] Show a clear notice that schedules and policy enforcement are not yet active.
- [x] Keep existing reusable prompt profiles and task history available.
- [ ] Run web typecheck, runtime tests and production build.

### Task 4: Documentation and verification

**Files:**
- Modify: `docs/KVARD_DESIGN_SYSTEM.md`
- Create: `docs/AGENT_DEFINITIONS.md`

- [x] Document API, data model, security limits and deferred runtime work.
- [ ] Run the full CI-equivalent API/Web checks and E2E workflow.
- [x] Perform a static self-review of account isolation, secret handling and autonomy claims; independent review and executable verification remain pending.
