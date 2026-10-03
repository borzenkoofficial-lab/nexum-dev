# NEXUM.DEV AI Loop — Canonical Architecture

## Canonical ownership

The production web builder uses one canonical server-side AgentLoop in apps/api/agent/loop.ts. It receives the normalized request through the chat job path and executes against the active project via NexumAgent.

Runtime execution infrastructure is owned by apps/api/runtime/runtime.ts (ServerRuntime). Persistent Agent job state is owned by apps/api/chatJobStore.ts. The existing client runtime under apps/web/src/runtime is a client-side runtime adapter, not the server Agent execution authority. The VS Code extension repair loop is a separate local extension workflow and is not part of the web builder lifecycle.

## Request-to-completion flow

POST /api/chat
→ ChatJob
→ ServerRuntime Task
→ project lock + checkpoint
→ NexumAgent / AgentLoop
→ AgentIntent
→ bounded project context
→ Product/AI plan
→ one tool action
→ ToolResult
→ Observation
→ Validation
→ bounded Repair
→ Verification
→ Completion Gate
→ atomic ChatJob completion

A model response claiming done is never the completion authority.

## Agent state machine

IDLE → UNDERSTANDING → PLANNING → EXECUTING → OBSERVING → VALIDATING
                                                ↘ REPAIRING → EXECUTING
VALIDATING → VERIFYING → COMPLETED
VERIFYING → REPAIRING

FAILED and CANCELLED are terminal. COMPLETED, FAILED and CANCELLED cannot be resurrected. The authoritative transition table is in apps/api/agent/executionState.ts.

## Plan semantics

The execution plan has bounded lifecycle stages and dynamic action steps. Every concrete tool action is attached to an action step with dependencies, attempts and timing. Actual tool results are recorded before the loop can claim observation or validation.

## Tool ownership

| Tool group | Owner | Scope |
|---|---|---|
| listFiles/readFile/searchFiles | NexumAgent | active project |
| writeFile/patchFile/scaffoldProject | NexumAgent | active project |
| runCommand/runSandbox/testProject | NexumAgent + ServerRuntime process registry | active project |
| git/github | NexumAgent | read-only repository/GitHub access |
| diagnostics/history/journal | Runtime + Agent job persistence | task/project |
| model calls | AIOrchestrator → AIGateway → provider | request/task |

## Cancellation

UI cancel → persisted ChatJob cancellation → AbortController → AgentLoop → provider/model request or tool/process → ServerRuntime task cancellation → resource/process cleanup → CANCELLED.

Cancellation is intended to be idempotent. The persisted job transition is atomic, and terminal Agent/Runtime states reject resurrection.

## Recovery

Stale running ChatJobs are converted to controlled failure on API restart and their project locks are released. Agent checkpoints persist intent, plan, current step, observations and repair state.

This branch implements controlled crash recovery, not automatic resume-from-checkpoint. Full resume requires a separate end-to-end capability and must not be marked PASS before evidence exists.

## Security boundary

Repository files, repository comments, documentation and tool output are untrusted project data. They cannot override system policy or user intent.

Secret-bearing .env files, credential/secret files and common private-key files are denied to Agent read/search tools. File writes remain project-sandboxed. Terminal execution uses the existing command allowlists and sandbox.

## Evidence policy

PASS requires real runtime, tool, CI or browser evidence. Missing infrastructure is NOT VERIFIED, never a synthetic PASS.
