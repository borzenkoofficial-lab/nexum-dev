# КВАРД Agent Approval Engine — Design

## Intent

Give account-owned AI-agent definitions an enforceable, per-tool approval gate. A configured agent must stop before a protected action, show the exact proposed action to its owner, and continue only after an explicit decision. This closes the gap between the existing saved approval-policy setting and actual Runtime enforcement.

## Goals

- `always`: require a fresh approval before every tool invocation.
- `writes`: allow READ tools automatically; require approval before WRITE, EXECUTE, or DESTRUCTIVE tools. Command execution is therefore gated as well as file changes.
- `autonomous`: retain the existing read-only restriction and do not prompt.
- Persist one pending approval with its chat job so polling, cancellation, and resolution use the same authenticated job record.
- Expose owner-scoped approve/reject endpoints. A decision is one-shot; a second or stale decision is rejected.
- Show the tool, risk class, sanitized input preview, and Approve/Reject actions in Studio.
- Rejection returns a denial result to the model; it does not execute the tool and the agent may adapt.
- Pending requests expire after 10 minutes and are treated as rejected.
- Cancelling a job cancels its pending approval and aborts the waiter.
- Keep existing non-configured chat-agent behavior unchanged.

## Non-goals

- No blanket or permanent grants; every approval applies to one invocation only.
- No unattended schedules, event triggers, background agents, or multi-agent orchestration.
- No approval of tools outside the configured allowlist.
- No removal of existing path, sandbox, tool-risk, or project-isolation checks.
- No server-restart resume of an in-flight AgentLoop; stale-job recovery remains responsible for interrupted runs.

## Approaches

1. **Persist the approval in the existing chat-job JSON payload (selected).** Add a typed pending approval to the current job record, use conditional database updates for one-shot decisions, and have the active AgentLoop poll the shared job store while waiting. This reuses the established job lifecycle, authentication, cancellation and polling, and works across API instances sharing PostgreSQL. The in-memory store remains supported for local development.
2. **Create a separate approvals table and worker queue.** This is a better foundation for high-volume audit queries and distributed workers, but adds a second lifecycle and coordination layer before the product has background workers.
3. **Keep approval state only in process memory.** This is smaller but loses decisions on process restarts and cannot safely resolve from another API instance; rejected.

## Selected behavior and security boundaries

- Approval is evaluated inside `NexumAgent.executeTool`, after allowlist and tool-input/path validation, but before `tool.execute`.
- The server supplies the approval callback only for a saved agent definition. Ordinary chat remains unchanged.
- The server resolves the definition from the authenticated user's account; the client cannot supply a policy or risk classification.
- Risk comes from the server-side `toolPolicy` registry, never from model output.
- The preview redacts common secret-bearing fields and bearer credentials, is length-capped, and is not used as the actual tool input.
- The original input stays in the running process only; it is not added to the approval record.
- Only the owner of the chat job may approve or reject. Decision writes are conditional on job status = running, matching approval ID, and pending status.
- A job can have only one pending approval at a time.
- Cancellation wins over later approval decisions; expired, rejected, cancelled, and already-resolved approvals cannot execute.
- Existing tool invocation validation remains mandatory even after approval.

## User experience

Studio shows a blocking approval panel while the job remains running. It includes the proposed tool, its risk, a sanitized argument preview, and the 10-minute expiry. Approve resumes the same job; Reject denies that one tool call and returns control to the agent. The existing Cancel action remains available and cancels the pending approval.

## Constraints

- Reuse the existing Express API, PostgreSQL JSONB chat-job persistence, React/TypeScript client, and KVARD semantic design tokens.
- Do not add runtime dependencies.
- Keep PR #59 draft, unmerged and undeployed.
- Preserve account isolation and the existing Agent Runtime contracts.
- Add tests for policy routing, approval persistence, one-shot resolution, owner isolation, denial-before-execution, cancellation and expiry.
