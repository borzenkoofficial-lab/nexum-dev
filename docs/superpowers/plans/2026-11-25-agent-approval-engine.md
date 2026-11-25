# Agent Approval Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent, owner-scoped, per-tool approval gate for configured КВАРД agents, with approve/reject controls in Studio.

**Architecture:** The Agent runtime asks for approval after validation and before tool execution. The API persists one pending approval in the existing chat-job JSONB payload, exposes conditional owner-scoped decision endpoints, and lets the running AgentLoop poll the shared store. Studio renders the pending request and submits a one-shot decision.

**Tech Stack:** TypeScript, Node.js test runner, Express 5, PostgreSQL JSONB, React, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-25-agent-approval-engine-design.md`

## Global Constraints

- `always` gates every tool invocation.
- `writes` gates WRITE, EXECUTE, and DESTRUCTIVE tools; READ remains automatic.
- `autonomous` remains READ-only and does not prompt.
- Approval is checked after existing allowlist and tool-input validation and before tool execution.
- Only configured agent definitions receive the approval callback; ordinary chat behavior is unchanged.
- Approval decisions are owner-scoped, one-shot, and conditional on the job still running.
- Approval expires after 10 minutes; cancellation marks it cancelled and aborts the waiter.
- Input previews redact common secrets and are capped; raw tool input is never persisted in the approval record.
- No new runtime dependency; PR #59 remains draft, unmerged, and undeployed.

## Review Focus

- Concurrent approve/reject requests for the same approval — only the first decision may win.
- Cancellation racing with approval — a cancelled job must never execute the pending tool.
- Stale or foreign job/approval IDs — no cross-account disclosure or mutation.
- Expired approval — the tool must remain unexecuted and the agent must receive a denial.
- Sensitive tool arguments — previews must redact credentials and never expose raw secret values.

---

### Task 1: Approval domain and chat-job persistence

**Files:**
- Create: `apps/api/agent/approval.ts`
- Create: `apps/api/agent/approval.test.ts`
- Modify: `apps/api/chatJobStore.ts`
- Create: `apps/api/chatJobStore.test.ts`
- Modify: `apps/api/package.json`

**Interfaces:**
- `shouldRequireToolApproval(policy, risk): boolean`
- `createApprovalPreview(input): string`
- `ChatJob.pendingApproval?: ChatJobApproval`
- `requestChatJobApproval(id, userId, approval): Promise<ChatJob | null>`
- `resolveChatJobApproval(id, userId, approvalId, decision, resolvedBy): Promise<ChatJob | null>`

- [ ] Write tests for policy routing: always gates READ; writes gates WRITE and EXECUTE but not READ; autonomous never gates.
- [ ] Write tests proving previews redact bearer tokens and secret/password/api-key fields and enforce a bounded length.
- [ ] Write store tests proving only the owning user can resolve an approval, only a pending matching approval resolves once, and cancellation marks it cancelled.
- [ ] Run the focused tests and verify the expected failures.
- [ ] Implement the approval domain and store transitions for memory and PostgreSQL modes. Use conditional SQL updates for decision resolution.
- [ ] Run focused tests, then the full API test suite.

### Task 2: Runtime enforcement before tool execution

**Files:**
- Modify: `apps/api/agent/agent.ts`
- Modify: `apps/api/agent/agent-config.test.ts`

**Interfaces:**
- Extend `NexumAgentConfiguration` with `approvalPolicy` and an async `requestApproval` callback.
- A denied or expired approval returns a non-fatal tool error and must not call `tool.execute`.

- [ ] Add a failing test proving a writes-policy agent does not create a file until the approval callback returns approved.
- [ ] Add tests proving rejection blocks the write, READ is not gated under writes, and always gates READ.
- [ ] Run the focused tests and verify they fail because the runtime has no approval gate.
- [ ] Implement approval evaluation after `validateToolInvocation` and before the tool's `execute`.
- [ ] Run focused tests and the full API test suite.

### Task 3: Authenticated approval API and wait lifecycle

**Files:**
- Modify: `apps/api/server.ts`
- Modify: `apps/api/chatJobStore.ts`
- Create: `apps/api/agent/approvalWaiter.ts`
- Create: `apps/api/agent/approvalWaiter.test.ts`

**Interfaces:**
- `POST /api/chat/jobs/:id/approvals/:approvalId` with JSON body `{ decision: "approve" | "reject" }`.
- `waitForChatJobApproval({ jobId, userId, approvalId, signal, readJob, resolveExpired }): Promise<"approved" | "rejected">`.

- [ ] Add waiter tests for approved, rejected, expired, missing/replaced request, and AbortSignal cancellation.
- [ ] Run the focused tests and verify they fail because the waiter does not exist.
- [ ] Implement a 500 ms cancellable polling waiter with a 10-minute expiry.
- [ ] Persist request creation through the per-job persistence queue; update the job cache after request and decision.
- [ ] Allow saved definitions with always/writes policies; retain autonomous READ-only validation.
- [ ] Supply the policy and server-owned approval callback to NexumAgent.
- [ ] Add the authenticated, owner-scoped, one-shot decision endpoint with 400/404/409 responses for malformed, foreign/missing, and stale/already-resolved decisions.
- [ ] Ensure cancellation marks pending approval cancelled and aborts the waiter.
- [ ] Run focused tests and the full API test suite.

### Task 4: Studio approval panel and E2E coverage

**Files:**
- Create: `apps/web/src/components/AgentApprovalPanel.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/kvard-design-system.css`
- Create or modify: `e2e/tests/agent-approval.spec.ts`
- Modify: `apps/web/src/components/AgentsPage.tsx` (policy descriptions)

**Interfaces:**
- App polling state exposes a typed pending approval from the active chat job.
- Approval panel callbacks submit approve/reject decisions for the active job.
- The panel is visible in Studio only while an approval is pending.

- [ ] Add E2E coverage for the writes policy: task pauses before write, user approves, same job resumes and file change completes.
- [ ] Add E2E coverage for rejection: tool is not executed and the job continues or completes with the denial recorded.
- [ ] Add E2E coverage for cancellation while approval is pending.
- [ ] Run the new E2E tests and verify they fail because the approval panel is not implemented.
- [ ] Implement the panel with tool/risk labels, redacted preview, expiry, accessible buttons, and pending/decision feedback.
- [ ] Wire App polling and authenticated decision calls; preserve the existing Cancel control.
- [ ] Update agent policy descriptions and the safety notice to match enforced behavior.
- [ ] Run Web typecheck, Web build, lint, API tests, full E2E and production Docker smoke test.

### Task 5: Review and document the finished gate

**Files:**
- Modify: `docs/AGENT_DEFINITIONS.md`
- Modify: `docs/superpowers/plans/2026-11-25-agent-approval-engine.md`

- [ ] Document the exact policy semantics, one-shot decisions, redaction, expiry, and cancellation behavior.
- [ ] Review the full diff for auth isolation, race conditions, unsafe fallthrough, and ordinary chat regressions.
- [ ] Record any deferred minor findings; fix all critical/important findings with RED→GREEN tests.
- [ ] Verify the final PR head and CI run. Keep PR #59 draft, unmerged, and undeployed.
