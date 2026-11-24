# Universal Agent Definition

NEXUM AGENTS is a general-purpose business-agent platform. Agent roles are user-defined; the product must not constrain creation to a predefined list of professions. Templates are optional starting points, never a capability boundary.

## Definition contract (v1)

Every saved agent version contains one validated definition:

- **Identity:** name, description and free-form specialization.
- **Instructions:** system-level task guidance authored for the agent.
- **Model:** provider, model and bounded generation temperature.
- **Capabilities and tools:** descriptive capabilities plus tool IDs that exist in the server-side Tool Registry. A capability label does not grant execution rights.
- **Execution modes:** conversational, autonomous, event-driven and workforce participant.
- **Channels:** typed configuration for webchat, Telegram, email, API, CRM or custom adapters. Saving a channel binding does not imply that an adapter is installed or active.
- **Triggers:** manual, schedule or event definitions. Schedule/event definitions remain inert until their scheduler/event adapter is connected.
- **Knowledge and memory:** organization-scoped knowledge source IDs and explicit memory policy.
- **Permissions:** explicit scopes, actions requiring approval, and an opt-in flag for external side effects. External side effects are denied by default.
- **Limits:** bounded iterations, tool calls, duration and token budget.
- **Approval policy:** action-level approval rules.

## Runtime boundaries

1. The Coding Agent and business Agent Runtime remain separate systems.
2. Only server-registered tools can execute. Invent must never fabricate tool IDs or claim an integration exists when it is absent.
3. Tool execution is allowlisted and risk-checked by the server. The expanded scopes/permission policy is currently stored as configuration; scope-by-scope enforcement must be completed before enabling external side-effect tools.
4. External content is untrusted input. It cannot override system policy or grant permissions.
5. Email drafting is not email sending. Human approval records a decision; it does not itself execute the approved action.
6. Credentials and connector tokens must be stored outside Agent Definition, encrypted at rest, scoped to an organization and excluded from prompts/logs.
7. Channels and triggers are declarative until a real adapter/worker is implemented and operationally verified.
8. Each edit creates an immutable version. Runs must execute against a specific version and retain an auditable event history.

## Extension rules

- Add new professions by configuration/templates, not by adding role-specific runtime branches.
- Add integrations by implementing a typed Tool/Channel/Trigger adapter and registering its supported schemas, scopes, risk level and execution handler.
- Keep organization tenancy in every repository query and enforce access server-side.
- Require explicit approval for high-impact external operations (sending messages, financial actions, contracts, destructive changes).
- Add contract tests for every new adapter and tenant-isolation tests for every new data path.

## Current implementation status

The current branch has universal definition fields and validation, free-form specialization and mode selection in the initial workspace, plus an Invent prompt constrained to registered tools/providers. The existing runtime currently executes registered tools in its current in-process loop. Execution modes, channel/trigger bindings, knowledge IDs, memory settings and expanded permission metadata are currently persisted configuration; mode-specific dispatch, corresponding adapters, scope-level enforcement, and aggregate maxTokensPerRun accounting are not yet active. Durable queues, scheduler/event adapters, external channels, scope-level authorization and long-term memory execution remain separate implementation work.
