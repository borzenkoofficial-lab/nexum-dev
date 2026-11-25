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

## Safe manual execution

An active agent can be selected from the Agents workspace and handed off to Studio as part of a user-submitted chat task. The chat request includes the agent definition ID; the API resolves it only within the authenticated account and rejects paused or foreign agents before creating a job.

For this milestone, execution is intentionally limited to definitions with approval policy autonomous and a non-empty allowlist containing only READ-risk tools. The runtime filters the model-visible tool catalog and independently rejects direct invocations outside the allowlist. The saved system prompt is included as user-defined role guidance below platform safety and project-isolation instructions. Saved provider/model settings are applied to the run when present.

Definitions using always or writes are saved but cannot yet be run: a per-action approval queue and approval UI are still required. WRITE, EXECUTE and DESTRUCTIVE tools are not permitted in autonomous runs. A user must explicitly submit each task; there are no unattended schedules or triggers.

## Deferred work

Schedules, event triggers, background workers, per-action approvals for write/execute tools, execution history linked to agent definitions, and multi-agent orchestration remain future work.
