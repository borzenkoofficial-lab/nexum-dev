# NEXUM.DEV — Vercel-native platform architecture

**Decision:** full Vercel adaptation. This document is the implementation contract for the migration. It does not claim that the migration is complete.

## 1. Target topology

| Layer | Vercel component | Responsibility |
|---|---|---|
| Web | Services: `web` / Vite | SPA, editor, project UI |
| API | Services: `api` / Express Functions | Authentication, project API, AI orchestration, job status |
| Job intake | Vercel Queues | Durable enqueue, redelivery, backpressure |
| Job orchestration | Vercel Workflow | Durable phases/steps, retries, cancellation and resume |
| Code execution | Vercel Sandbox | Isolated Firecracker microVM; executes user/generated project commands |
| Metadata and coordination | PostgreSQL | Users, projects, jobs, events, workflow IDs, leases/locks |
| Project filesystem | Vercel Drive where enabled; otherwise private Vercel Blob archive + Sandbox workspace | Durable source tree and generated artifacts |

Public routes remain `/` → `web` and `/api/*` → `api`. The Vite service must internally rewrite deep links to `/index.html`. The root Docker application remains excluded from Vercel Services and is retained for local/legacy deployment only.

No Vercel service binding is needed for browser-to-API traffic: the browser uses same-origin relative `/api/*` URLs. Add a binding only if a future server-side service-to-service call is introduced.

## 2. Agent job lifecycle

1. API authenticates and authorizes the request, validates the active project, and inserts a durable `queued` job row.
2. API publishes a small message containing identifiers only (job ID, user ID, project ID, schema version) to a Vercel Queue. The job row remains the source of truth.
3. Queue delivery is at-least-once. The consumer must atomically claim the job in PostgreSQL; duplicate deliveries must not start duplicate work.
4. The consumer starts a durable Workflow and persists its workflow run ID before acknowledging the queue message.
5. Workflow executes explicit bounded steps: load/lock workspace, create checkpoint, run one bounded agent phase/iteration, persist progress and outputs, validate, finalize. Long-running work must not be hidden in one detached Promise or one oversized Function invocation.
6. Cancellation is a durable DB state/event observed between steps and by active Sandbox commands. Lease heartbeats are DB-backed, not process-local timers as the sole source of truth.
7. Terminal job state and event history are written to PostgreSQL. The API reads them from PostgreSQL on every request; in-memory caches are optional accelerators only.

Queue messages are delivery triggers, not the canonical job record. Use the job UUID as an idempotency key and make every consumer/step safe to replay.

## 3. Sandbox and workspace model

- Replace the production Docker CLI dependency with a provider interface; keep Docker as the local-development provider.
- The Vercel provider creates/reopens a named Sandbox for a project workspace and uses SDK file APIs/commands. The API process never assumes that its own local filesystem is the project filesystem.
- Execute user/generated code only in the isolated Sandbox. Keep model-provider credentials and database credentials in the API/Workflow control plane; do not inject them into the untrusted project runtime.
- Use argument-array command execution, a strict executable/argument allowlist, bounded output, timeouts, cancellation, and a restrictive network policy. Do not pass untrusted strings through a shell.
- A single project write lease prevents two Sandbox sessions from mutating the same workspace concurrently.
- Prefer a Vercel Drive mounted read-write into the project's Sandbox for durable workspace files. Drives are beta and the Vercel tool catalog currently describes Drive access as private-beta gated. Hobby Drive capacity is documented as 1 GiB by default, with one read-write mount at a time. Verify entitlement, region and quota before relying on it.
- If Drive is unavailable, use a private Blob archive as the durable source of truth and hydrate a Sandbox workspace from it. Snapshot retention alone is not the only copy of user data.
- PostgreSQL stores workspace metadata, versions, object keys, checksums and job ownership. File contents do not belong in process-local maps or deployment filesystems.

## 4. Hobby-plan constraints to design against

- Vercel Sandbox sessions are limited to 45 minutes on Hobby; longer sessions require an eligible paid plan. Current agent task limits must remain within this envelope or be split into resumable steps.
- Sandbox persistence snapshots filesystem state, not running processes. Resume must restart required processes and revalidate workspace state.
- Drive is beta/private-beta gated; do not assume it is enabled until the actual NEXUM Vercel project can list or create a Drive.
- Vercel Queues uses at-least-once delivery and has bounded message retention. The DB job record and Workflow run, not the queue message, must preserve long-lived job state.

## 5. Migration sequence

### Phase A — Vercel ingress contract
- Add and test the two-service config, public route order and Vite SPA fallback.
- Keep root Docker out of the Services list.
- Validate with `vercel dev` and a Preview deployment after a real Vercel project is linked.

### Phase B — Durable job control plane
- Add DB-backed queue/job state, idempotent claims, lease renewal, cancellation and event persistence.
- Add Queue publisher/consumer and Workflow starter.
- Remove fire-and-forget `runChatJob` as the production entrypoint.
- Split AgentLoop into replay-safe bounded phases/iterations and persist its execution snapshot.

### Phase C — Remote workspace and sandbox
- Define a workspace filesystem contract used by ProjectManager and every Agent file tool.
- Implement Vercel Sandbox provider and local Docker provider behind the same contract.
- Add Drive persistence when entitlement is confirmed; add Blob archive/restore fallback.
- Migrate checkpoints, history, project duplication/deletion, git operations and previews to the workspace contract.

### Phase D — production hardening
- Enforce production fail-closed configuration: PostgreSQL, auth secret, queue, workflow, sandbox provider and durable workspace storage are mandatory.
- Add observability for job ID, workflow run ID, sandbox ID/session ID, project ID, delivery count and phase timings. Never log secrets or user file contents.
- Add recovery sweeps for queued/running jobs, expired locks, interrupted workflow runs and orphaned sandboxes.
- Run end-to-end tests through the public Vercel URL, including two independent API invocations to prove cross-instance persistence.

## 6. Required acceptance tests

- Duplicate queue delivery starts exactly one job.
- A failed consumer is redelivered without losing the canonical job record.
- Workflow resumes after a failed/restarted step without repeating committed side effects.
- Cancellation stops an active command and releases the DB lease.
- Two jobs cannot concurrently write one project workspace.
- Workspace files survive Sandbox stop/resume and a separate API invocation.
- Project A cannot read, list, modify or execute files from Project B.
- Path traversal, symlinks, shell operators, blocked executables and oversized output are rejected.
- API cold starts and separate instances return the same project/job state from PostgreSQL.
- A production Preview flow can create a project, write/read files, run a build/test command in Sandbox, observe progress, cancel a job and reload the result.

## 7. Current prerequisites / blockers

- The Vercel team context currently shows Hobby plan. The only linked project returned is `nexum-cloud`, linked to the SKOL repository; no Vercel project linked to `borzenkoofficial-lab/nexum-dev` was returned. Do not attach NEXUM resources to the SKOL project.
- Drive entitlement cannot be verified until the NEXUM Vercel project exists.
- No Vercel database, Blob store, Queue topic, Workflow or Sandbox has been provisioned for NEXUM by this change.
- Existing Yandex PostgreSQL support is present in the codebase; its production connectivity and cross-region latency must be verified before choosing whether to retain it or provision a Vercel Marketplace Postgres integration.

## 8. Release gate

This architecture is not production-ready until all Phases A–D and the acceptance tests are complete, a Vercel Preview deployment is reachable, and the full end-to-end flow passes. Source-level review, GitHub CI, and a successful static build do not substitute for that evidence.
