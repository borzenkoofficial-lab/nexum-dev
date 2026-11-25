# Daytona runtime integration plan

## Goal
Port the existing Daytona sandbox implementation onto the current `main` without reverting or weakening the current agent loop, approval policies, job persistence, cancellation bridge, or project isolation.

## Scope
- Add a provider-neutral sandbox contract and task-scoped session runner.
- Port the Daytona SDK adapter with bounded workspace transfer, secret/path exclusions, resource limits, npm-registry-only egress, abort handling, and idempotent disposal.
- Keep Docker as the development provider; production must fail closed unless Daytona is explicitly configured.
- Route runCommand, runSandbox, and testProject through the shared runner.
- Release task sessions from the current job-finally path and during API shutdown.
- Add unit/contract tests and deployment configuration/documentation.

## Non-goals
- Do not merge or rewrite the stale PR #57.
- Do not change the current AgentLoop, tool approval policy, ChatJob persistence model, or frontend Preview flow beyond what is required for sandbox routing.
- Do not configure production secrets, switch production traffic, or deploy.

## Architecture decisions
- The existing API remains the control plane; Daytona is an execution provider only.
- One remote sandbox session is keyed by the existing ChatJob task ID, reused for commands within that job, and disposed in the job's existing finally block.
- One-shot validation calls without a task ID create and dispose their own session.
- Production selection is explicit and fail-closed; local development retains Docker when no provider is configured.
- Remote workspace staging excludes secrets, VCS metadata, dependencies, caches, symlinks, and stale build output. Only fresh build artifacts are synchronized back.
- Daytona API credentials remain server-side. Sandbox egress is restricted to the npm registry.

## Tasks
1. Add provider contract and runner lifecycle tests; ensure task sessions are reused and released once, and shutdown waits for in-flight creation.
2. Port the Daytona SDK provider and its contract tests; enforce transfer/resource/network limits and safe cleanup.
3. Integrate the runner into current command/build/test tools without replacing current agent orchestration.
4. Wire job-finally and server shutdown cleanup; preserve cancellation and approval behavior.
5. Add package dependency, environment/deployment documentation, then run API tests, typecheck, build, and CI.
6. Review the final diff and open a draft PR; do not merge or deploy.

## Verification
- Provider selection tests cover development Docker default, explicit Daytona, missing production provider, and no production fallback.
- Daytona tests cover staging exclusions, limits, command validation, failed commands, abort, cleanup, and preview URL validation.
- Runner tests cover session reuse, one-shot cleanup, task release, and shutdown races.
- Run `npm --prefix apps/api test`, `npm --prefix apps/api run typecheck`, and `npm --prefix apps/api run build` in CI.
- Live Daytona smoke testing remains a separate activation gate requiring a real `DAYTONA_API_KEY`.
