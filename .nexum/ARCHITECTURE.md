# NEXUM Project Architecture

This document records stable technical architecture for AI agents.

## Rules
- Inspect the actual repository before relying on this document.
- Treat this file as guidance, not proof that the implementation still matches it.
- Update it after deliberate architectural changes.
- Prefer existing abstractions over parallel implementations.

## Current architecture
- Web client: React/Vite in `apps/web`.
- API/agent runtime: TypeScript/Node in `apps/api`.
- AI Gateway: provider abstraction plus runtime per-user provider keys.
- Model Registry: centralized logical routes for Director, Builder, Debugger, Worker, Tester/Reviewer and fallbacks.
- Intent Engine: deterministic domain/product/mode extraction before execution.
- Task Router 2.0: structured routing using intent, task graph and provider readiness.
- Task Decomposer: bounded execution graph with dependencies and affected-area awareness.
- Context Engine: bounded relevant-file/context selection.
- Project Understanding: current project/framework/build/routes/domain/risks snapshot.
- Agent Loop: inspect → plan → tool execution → verification → bounded recovery → completion gate.
- Autonomous Builder: bounded node attempts and rewind without resetting recovery budgets.
- Error Recovery: classifies real verification/runtime/build failures and supplies evidence to Debugger.
- Verification Engine: project tests plus production build/static validation where applicable.
- Preview runtime recovery: Preview reports runtime errors to the authenticated project endpoint and starts a bounded Debugger job.
- Persistent AI contract: `.nexum/AI.md`, `.nexum/PROJECT.md`, `.nexum/ARCHITECTURE.md`, `.nexum/RULES.md`, and role-specific files under `.nexum/agents/`.

## Execution contract
`User → Intent → Project Understanding → Task Graph → Router → specialist model → tools/files → verification → debugger recovery if needed → Preview → completion gate`.

## Source of truth
The repository is the source of truth for implementation details. This document provides durable architectural intent; Project Understanding provides current observed structure.