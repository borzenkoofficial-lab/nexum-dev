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

## Important limitation

This milestone stores and manages agent configuration; it does not yet execute agents independently. The approval policy and tool allowlist are not yet enforced by the execution runtime. Schedules, event triggers, background workers, tool-permission enforcement at invocation time, execution history per agent, and multi-agent orchestration remain future work. The UI must not imply otherwise.
