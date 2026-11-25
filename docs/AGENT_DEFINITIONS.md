# AI Agent Definitions

## Current capability

КВАРД supports account-owned agent configurations. Each definition stores:

- name and description;
- system instruction;
- optional provider and model identifiers (no API credentials);
- allowlisted tool names;
- approval policy metadata;
- active/paused configuration status.

The definitions are separate from reusable prompt profiles. Profiles remain quick-start templates; agent definitions are persistent configuration records.

## API

All endpoints require an authenticated session.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/agents` | List the current account's agents |
| POST | `/api/agents` | Create an agent |
| PATCH | `/api/agents/:id` | Update supplied fields only |
| DELETE | `/api/agents/:id` | Delete an agent |

Every database mutation is scoped by both agent ID and authenticated user ID. Responses omit internal `userId`.

## Configuration

- `approvalPolicy`: `always`, `writes`, or `autonomous`.
- `status`: `active` or `paused`.
- `allowedTools`: up to 32 unique tool identifiers that must already have a registered security policy in `apps/api/agent/toolPolicy.ts`.
- Provider and model values are identifiers only. Credentials remain in the user's provider connection settings and are not copied into agent records.

## Persistence

PostgreSQL uses `agent_definitions`, with a per-account case-insensitive unique name index and an account/update-time index. If `NEXUM_DATABASE_URL` is absent, the API uses an in-memory fallback for local development; those records are lost when the server process restarts.

Apply database migrations with the existing API migration command. Migration `003_agent_definitions.sql` creates the table and indexes.

## Safe manual execution and approval

An active agent can be selected from the Agents workspace and handed off to Studio as part of a user-submitted chat task. The chat request includes the agent definition ID; the API resolves it only within the authenticated account and rejects paused or foreign agents before creating a job.

The runtime applies the saved provider/model, system instruction, allowlist, and approval policy. The system instruction is lower-priority role guidance; it cannot override platform safety, project isolation, or tool permissions. The model-visible tool catalog is filtered to the allowlist, and direct tool invocations outside that list are rejected independently.

### Approval policy semantics

- `always`: pause before every tool invocation, including READ operations.
- `writes`: READ tools run automatically; WRITE, EXECUTE, and DESTRUCTIVE tools require an explicit approval.
- `autonomous`: no prompts; the configuration validator restricts the allowlist to READ-risk tools only.

Approval is evaluated after the existing tool-input and project-path checks and immediately before the tool executes. The pending request is stored with its chat job. It contains the tool name, server-derived risk, a redacted and length-limited argument preview, and a 10-minute expiry; raw tool input is not copied into the approval record.

The authenticated job owner can approve or reject one invocation through `POST /api/chat/jobs/:id/approvals/:approvalId`. Decisions are one-shot: only a matching pending request on a running job can be resolved, and a second or stale decision is rejected. Approving resumes the same job. Rejecting or expiring returns a denial to the agent without executing that tool. The agent may then adapt its plan.

Cancelling a job marks its pending approval cancelled and aborts the waiting AgentLoop. Approval does not bypass allowlists, path validation, sandbox restrictions, or any other tool-security check. Non-configured ordinary chat runs retain their existing behavior.

## Deferred work

Schedules, event triggers, background workers, per-action approvals for write/execute tools, execution history linked to agent definitions, and multi-agent orchestration remain future work.
