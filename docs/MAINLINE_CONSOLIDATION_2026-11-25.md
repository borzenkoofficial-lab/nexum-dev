# Mainline Consolidation — 2026-11-25

## Canonical source of truth

- The only active development branch is `main`.
- New feature/fix/design branches and routine pull requests are not part of the development workflow.
- New work is committed directly to `main` in small, reviewable commits.
- Existing branches are historical inputs only. They are not independent product sources of truth.
- Do not delete historical branches until their unique work has been reviewed and either integrated, explicitly rejected, or archived in this document.

## Consolidation policy

A branch is not merged merely because it exists or has commits ahead of `main`. Every candidate is evaluated for:
1. Unique functionality not already present in `main`.
2. Compatibility with current APIs, data models, authentication, and runtime.
3. Security and tenant-isolation implications.
4. Dependency and deployment impact.
5. Tests and reproducible verification.

Branches with no commits ahead of `main` are already represented by the mainline history and do not need another merge. Diverged branches must be cherry-picked or ported selectively; bulk merging stale branches is prohibited.

## Mainline capabilities already present

- React/Vite web application and TypeScript/Node API.
- Existing coding Builder/Agent loop, model gateway and registry, project workspace, sandbox tooling, diagnostics, and CI.
- KVARD design-system stylesheet and current application shell.
- Organization and membership foundation for multi-tenant business agents.
- Business-agent API namespace at `/api/business-agents` (kept separate from the legacy coding-agent `/api/agents` namespace).
- Business-agent persistence/runtime, tool registry and scope enforcement, knowledge sources, approval workflow, workforce graph/runtime, usage quotas, durable run queue and worker entrypoint.
- PostgreSQL migration runner with migration checksums and advisory locking; migrations 005–011 are present in source but are not automatically applied to production by this document.
- Object-storage port and local adapter.
- Hourly autonomous development workflow currently emits a reviewable artifact; it does not create branches, PRs, or push to production.

## Completed consolidation actions

- PR #65 — durable project storage foundation: merged.
- PR #66 — object-storage port and local adapter: merged.
- PR #67 — hourly autonomous development workflow: merged; publish-to-branch job subsequently removed to preserve the main-only and no-silent-production-push policy.
- PR #50 — bounded replanning when the AI selects an unavailable tool: merged directly to `main` on 2026-11-25 (merge commit `6a358e8c3396b1cb913b6b929f5d3d445edf7817`).
- Business-agent backend foundations from the agents/runtime work were ported into `main`; the original branches and PRs are not authoritative.

## Branch comparison findings

The repository branch inventory returned 60 non-main branches at the time of this review. A comparison was performed against `main` for the named groups below. This is a snapshot; rerun comparisons before any destructive cleanup.

### No unique commits ahead of main (already represented in mainline)

- `design/clean-foundation`
- `design/kvard-premium-system`
- `design/professional-workspace`
- `ui/full-rebuild`
- `ui/full-ui-reset`
- `ui/rebuild-builder-workspace`
- `feat/nexum-runtime`
- `fix/api-dependency-bootstrap-2026-09-28`
- `integration/nexum-final-2026-09-28`
- `phase/1-foundation`

### Unique work remains to be reviewed and selectively ported

- `ui/global-product-redesign` — six UI files; large stylesheet and builder-shell changes. Do not bulk-merge: it conflicts with the current KVARD design-system direction and needs component-level review.
- `feat/admin-control-center` — admin RBAC/API/UI foundation. Review role resolution, auth-disabled behavior, schema compatibility and audit logging before porting.
- `feat/agents-durable-runtime-queue` / `feat/nexum-agents-review` / `feat/nexum-agents-foundation` — overlapping business-agent backend and UI. Backend foundations have already been ported; compare remaining UI files and API paths before adoption.
- `feat/daytona-runtime-main-integration` / `feat/daytona-sandbox-runtime` — optional Daytona sandbox provider, runner, tests and deployment configuration. Needs dependency, credential, isolation and cost review before activation.
- `fix/builder-scaffold-first` — Builder bootstrap/recovery behavior and tests; port only after checking current agent-loop behavior.
- `feat/agent-state-aware-tool-selection` — bounded unavailable-tool replanning; integrated through PR #50.
- `feat/durable-project-storage` — storage migration/docs; compare against merged PR #65 and the current migration sequence.
- `fix/deep-audit-2026-10-17` and `fix/p0-production-hardening` — broad historical runtime/security/deployment work. These include stale or generated content (including a historical node_modules tree in the latter); never merge wholesale.
- `feat/model-registry-routing` — large historical AI-loop/model-routing snapshot. Current model registry and agent loop already exist in main; only demonstrably missing improvements should be ported.
- Remaining small fix/test branches — inspect their exact file-level delta against current main before deciding whether already superseded.

## Open pull requests

Open PRs are not a second development workflow. They are historical review containers. Before closing or merging any PR, compare its unique changes with the current mainline and current CI. In particular:
- PR #68 overlaps the business-agent queue foundation already ported; do not merge wholesale.
- PR #61 and #57 contain overlapping Daytona work; consolidate into one reviewed implementation if retained.
- PR #56 overlaps the business-agent backend foundation; review its remaining UI separately.
- PR #25 is a large UI/CSS redesign and is not safe to merge as-is.
- PR #12 admin foundation requires a security review before adoption.
- PR #50 has been merged.

## Production activation gates

The following are source-code foundations, not proof of live production activation:
- PostgreSQL migrations 005–011 have not been confirmed applied to production.
- The separate durable queue worker has not been confirmed deployed/running.
- Business-agent UI is not yet fully connected to the business-agent API.
- External integrations and real-world side effects are not activated.
- Billing quota logic exists, but payment-provider checkout/subscriptions are not integrated.
- Daytona is not enabled; Docker remains the configured/default sandbox until a reviewed provider switch and credentials are explicitly configured.
- No production deployment or paid infrastructure service is authorized by this consolidation record.

## Required closeout before deleting historical branches

1. Re-run the branch inventory and compare every remaining branch against current `main`.
2. Review all open PR diffs and identify unique commits/files.
3. Port accepted changes directly to `main`; run targeted tests and the full CI suite.
4. Record rejected, superseded, or deferred work here with a reason.
5. Only then delete merged/superseded branches. Preserve backup branches until the final mainline is verified.

Last reviewed: 2026-11-25. This document must be updated after each consolidation batch.
