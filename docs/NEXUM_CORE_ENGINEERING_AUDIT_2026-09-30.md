# NEXUM CORE ENGINEERING AUDIT
Date: 2026-09-30
Repository: borzenkoofficial-lab/nexum-dev
Branch: main
Audited baseline: 92a69826d875efb166fcf60545422962c200157a

## Scope
Technical audit only. No UI redesign work is included.

## Current architecture observed
- Web: React 19 + Vite 8 + TypeScript.
- API: Express 5 + PostgreSQL adapter + filesystem-backed per-user projects.
- AI layer: gateway, orchestrator, director, OpenAI, Anthropic, OpenRouter, OrcaRouter, Ollama, MockProvider.
- Agent: AgentLoop + NexumAgent + filesystem/Git/GitHub/build/sandbox tools.
- Persistence: PostgreSQL for auth; filesystem JSON for project metadata/state; in-memory chat jobs/checkpoints/project state.
- Preview/build infrastructure exists, but build/preview state is not yet a durable source of truth.

## Critical findings

### C1 — Fake AI provider remains in runtime selection
MockProvider returns deterministic text while reporting unavailable. server.ts selects mock when no real provider key is configured. This violates the no-fake-AI requirement.
Severity: CRITICAL.
Action: remove MockProvider from production runtime selection; fail explicitly when no real provider is configured.

### C2 — AI provider contract is too weak for a real Agent
AIProvider exposes only generate(message, model, options) -> string.
Missing first-class capabilities, structured output, tool calls, streaming, usage, normalized errors, request IDs and multimodal input.
Severity: CRITICAL.

### C3 — Routing is role-based, not capability-based
AIOrchestrator and NexumDirector contain hard-coded provider/model choices. There is no capability registry proving whether a selected model supports tools, vision, structured output, streaming or context limits.
Severity: CRITICAL.

### C4 — Explicit OpenRouter model selection can silently switch models
OpenRouter can append its model catalog after a selected model. An explicit model therefore is not guaranteed to remain the actual model used.
Severity: HIGH.

### C5 — Deterministic product-plan/builder fallbacks can simulate AI work
NexumAgent and AgentLoop contain deterministic domain-specific planning/template recovery. This conflicts with the requirement that AI functionality must be real and must not fake successful generation.
Severity: CRITICAL.

### C6 — Agent implementation is concentrated in very large files
agent.ts is about 78 KB and loop.ts about 50 KB. Planning, context, fallback, execution and verification are highly coupled.
Severity: HIGH.

### C7 — Tool abstraction lacks a first-class safety contract
Tool has name, description and execute(input), but risk level, schema validation, authorization/project scope and normalized errors are not first-class.
Severity: HIGH.

### C8 — Shell execution is allowlisted but not centrally classified
runCommand has useful allowlisting and path validation, but READ/WRITE/EXECUTE/DESTRUCTIVE policy is not centralized.
Severity: HIGH.

### C9 — Preview is not a durable verified artifact
ProjectState tracks previewMode, but build/preview lifecycle is not a single revision-bound source of truth. There is no durable preview artifact/version contract.
Severity: HIGH.

### C10 — Chat jobs are process-local
chatJobs is an in-memory Map with TTL cleanup. API restart loses active job state and progress.
Severity: HIGH.

### C11 — Project metadata uses filesystem JSON
Project metadata is stored in .nexum-projects.json. This is weak for concurrent writes and multi-instance deployment.
Severity: MEDIUM/HIGH.

### C12 — Authentication has a dev bypass
When NEXUM_AUTH_ENABLED is not true, every request receives a fixed DEV_USER.
Severity: HIGH for production safety.

### C13 — CORS is unrestricted
app.use(cors()) is broad by default.
Severity: HIGH.

### C14 — Runtime API keys are global process state
The connect-key route mutates singleton provider instances. A user-supplied key can therefore affect the whole API process.
Severity: CRITICAL.

### C15 — Provider errors are collapsed too aggressively
Several providers convert unknown failures to generic network errors, losing diagnostics required for recovery and observability.
Severity: MEDIUM/HIGH.

### C16 — No central error taxonomy
Provider, tool, build, runtime and API errors do not share one canonical error contract.
Severity: HIGH.

### C17 — Tests do not yet prove the complete acceptance lifecycle
Existing tests cover many units, but the full CREATE -> GENERATE -> FILES -> BUILD -> PREVIEW -> MODIFY -> REBUILD -> UPDATED PREVIEW lifecycle is not established as an E2E contract.
Severity: HIGH.

## Existing foundations worth preserving
- Project path validation and tests.
- Build/test tools.
- Agent iteration/token/action guards.
- Checkpoints.
- Project state.
- Provider separation.
- PostgreSQL adapter and authentication.
- Diagnostics and Agent history.

## Required execution order
1. Remove fake runtime AI and global runtime-key state.
2. Strengthen AI provider/model contracts and capability registry.
3. Normalize errors and provider transport behavior.
4. Refactor Agent/Tool contracts around real execution and verification.
5. Make project generation/build/preview factual and revision-bound.
6. Persist AgentRun/job state.
7. Harden auth, CORS and project isolation.
8. Add integration/E2E acceptance tests.
9. Run final regression and document remaining limitations.

## Acceptance rule
No feature is successful unless its underlying operation has a verified success state. UI state must derive from backend/project/build/preview truth rather than optimistic assumptions.
