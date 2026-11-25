# Persistent AI Agent Definitions — Design

## Intent
Move КВАРД beyond reusable prompt profiles toward account-owned AI agent definitions that can later be scheduled and executed by the Agent Runtime. This first vertical slice establishes durable, editable configuration and a security boundary; it does not claim that scheduling or autonomous execution already exists.

## Goals
- Persist agent definitions per authenticated account in PostgreSQL, with an explicit in-memory development fallback.
- Support create, list, update, pause/activate, and delete.
- Store a system prompt, optional provider/model selection, a declared tool allowlist, and an execution approval policy.
- Validate tool names against the existing runtime security policy before saving.
- Enforce account isolation in every read and mutation.

## Non-goals
- No schedules, event triggers, background worker, multi-agent teams, external integrations, or autonomous execution in this slice.
- No API credentials stored in agent definitions.
- No bypass of the existing tool security policy. A saved allowlist is configuration, not proof that the runtime has enforced it.

## Constraints
- Preserve the existing Express, TypeScript, PostgreSQL and auth patterns.
- Keep existing /api/agent/profiles endpoints and behavior compatible.
- Never expose userId in API responses.
- Supported approval policies are `always`, `writes`, and `autonomous`; this field is metadata only until a later runtime-enforcement milestone. UI/API must clearly communicate that execution policy is not yet active.
- Tool allowlists may contain only tools with registered policies in apps/api/agent/toolPolicy.ts.
- The default tool list is empty and the default approval policy is `always`.

## Approaches
1. Extend prompt profiles in place — least code, but conflates reusable templates with persistent agent identities and makes future runtime migration harder.
2. Add a separate account-scoped agent definition model — modest extra schema/API work, cleanly separates templates from configured agents. **Selected** because it gives the runtime a stable entity to attach jobs, schedules and audit events to.
3. Build the full scheduler/runtime now — premature: there is no agent lifecycle model or enforcement boundary to build on yet, and it would increase operational risk.

## Proposed data contract
An agent definition has: id, userId, name, description, systemPrompt, provider, model, allowedTools, approvalPolicy, status, createdAt, updatedAt. Status is `active` or `paused`. Provider/model are optional and are not credentials.

## Security and behavior
- All routes require authentication and are user-scoped.
- Validate lengths, enum values, UUID IDs, and registered tool names at the API boundary.
- Duplicate names are rejected case-insensitively per account.
- Update and delete must be constrained by both agent ID and user ID.
- Pause is a configuration state only; it does not cancel already-running jobs.
- The interface must label schedules and true autonomous execution as not yet available.

## Acceptance criteria
- CRUD operations persist in PostgreSQL and isolate accounts.
- In-memory fallback supports the same behavior for development/tests.
- Invalid tool names, unsupported provider/model types, invalid status/policy and duplicate names are rejected.
- Existing profile endpoints remain unchanged.
- Tests cover account isolation, duplicate names, validation, update ownership and delete ownership.
