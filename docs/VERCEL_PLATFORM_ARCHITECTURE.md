# NEXUM.DEV — Vercel-native platform architecture

**Decision:** full Vercel adaptation. This document is the implementation contract for the migration. It does not claim that the migration is complete.

## 1. Target topology

| Layer | Vercel component | Responsibility |
|---|---|---|
| Web | Services: `web` / Vite | SPA, editor, project UI |
| API | Services: `api` / Express Functions | Authentication, project API, AI orchestration, job status |
| Job intake | Vercel Queues | Durable enqueue, redelivery, backpressure |
| Job orchestration | Vercel Queues + Sandbox worker | Durable delivery, detached execution, retries/recovery and cancellation |
| Code execution | Vercel Sandbox | Isolated Firecracker microVM; executes user/generated project commands |
| Metadata and coordination | PostgreSQL | Users, projects, jobs, events, Sandbox session IDs, leases/locks |
| Project filesystem | Vercel Drive where enabled; otherwise private Vercel Blob archive + Sandbox workspace | Durable source tree and generated artifacts |

Public routes remain `/` → `web` and `/api/*` → `api`. The Vite service must internally rewrite deep links to `/index.html`. The root Docker application remains excluded from Vercel Services and is retained for local/legacy deployment only.

No Vercel service binding is needed for browser-to-API traffic: the browser uses same-origin relative `/api/*` URLs. Add a binding only if a future server-side service-to-service call is introduced.

## 2. Agent job lifecycle

1. API authenticates and authorizes the request, validates the active project, and inserts a durable `queued` job row.
2. API publishes a small message containing identifiers only (job ID, user ID, project ID, schema version) to a Vercel Queue. The job row remains the source of truth.
3. Queue delivery is at-least-once. The consumer must atomically claim the job in PostgreSQL; duplicate deliveries must not start duplicate work.
4. The consumer atomically claims the job, obtains the per-user Drive lease, creates/resumes the named Sandbox, and starts the trusted NEXUM worker as a detached process. It persists the Sandbox name/session ID in PostgreSQL before acknowledging the queue message.
5. The worker runs the Agent Loop inside the Sandbox, where the mounted Drive is the project workspace. The API control plane remains responsible for authentication, model-provider credentials and canonical job state. The worker reports progress/results through narrowly scoped internal API endpoints; no PostgreSQL or provider secrets are injected into the project runtime.
6. The worker checks durable cancellation state between Agent iterations and before/after commands. Lease heartbeats are DB-backed, not process-local timers as the sole source of truth. Sandbox timeout/exit is detected by recovery sweeps; interrupted jobs are resumed or marked failed deterministically.
7. Terminal job state and event history are written to PostgreSQL. The API reads them from PostgreSQL on every request; in-memory caches are optional accelerators only.

Queue messages are delivery triggers, not the canonical job record. Use the job UUID as an idempotency key and make every consumer and worker operation safe to replay.

## 3. Sandbox and workspace model

- Replace the production Docker CLI dependency with a provider interface; keep Docker as the local-development provider.
- The Vercel provider creates/reopens a named Sandbox for a user's workspace and uses SDK file APIs/commands. The API process never assumes that its own local filesystem is the project filesystem.
- Execute user/generated code only in the isolated Sandbox. Keep model-provider credentials and database credentials in the API control plane; do not inject them into the untrusted project runtime.
- Use argument-array command execution, a strict executable/argument allowlist, bounded output, timeouts, cancellation, and a restrictive network policy. Do not pass untrusted strings through a shell.
- A Drive-level writer lease (database row keyed by Drive ID) prevents multiple Sandbox sessions from mounting the same Drive read-write. Keep the existing project-level lease as a second guard against conflicting Agent jobs. For multi-user operation, provision one Drive per user (stable opaque/hash-derived name) so one user's projects serialize on that user's Drive without blocking other users. The initial `nexum-workspaces` Drive is the first workspace volume for this deployment, not a shared multi-tenant volume.
- Prefer a Vercel Drive mounted read-write into the project's Sandbox for durable workspace files. Vercel Drives reached general availability for Sandbox on all plans in October 2026. Hobby drives are limited to 1 GiB each by default; Hobby includes 15 GB of lifetime Drive storage and 30 GB/month of reads and writes. A Drive is region-bound and permits one read-write mount at a time; use snapshots for parallel read-only sessions. The NEXUM project now has a 1 GiB Drive named `nexum-workspaces` in `iad1`. A write → stop session → mount read-only snapshot in a new session → read test passed.
- If Drive is unavailable, use a private Blob archive as the durable source of truth and hydrate a Sandbox workspace from it. Snapshot retention alone is not the only copy of user data.
- PostgreSQL stores workspace metadata, versions, object keys, checksums and job ownership. File contents do not belong in process-local maps or deployment filesystems.

## 4. Hobby-plan constraints to design against

- Vercel Sandbox sessions are limited to 45 minutes on Hobby; longer sessions require an eligible paid plan. Hobby currently includes 5 active CPU-hours/month, 420 GiB-hours of provisioned memory, and 5,000 Sandbox creations. Current agent task limits must remain within the 45-minute session envelope or be split into resumable steps.
- Sandbox persistence snapshots filesystem state, not running processes. Resume must restart required processes and revalidate workspace state.
- Hobby Drive limits: 1 GiB per Drive by default, 15 GB lifetime Drive storage included, and 30 GB/month each for reads and writes. Drives are GA for Sandbox on all plans. NEXUM's `nexum-workspaces` Drive is provisioned at 1 GiB in `iad1`; cross-session persistence smoke test passed.
- A Drive permits one read-write mount at a time; read-only snapshots can be mounted concurrently. Enforce the writer lease at Drive scope, not only project scope.
- Vercel Queues uses at-least-once delivery and has bounded message retention. Hobby currently includes 1M Queue API operations/month. The PostgreSQL job record and Sandbox worker state, not the queue message, must preserve long-lived job state.

## 5. Migration sequence

### Phase A — Vercel ingress contract
- Add and test the two-service config, public route order and Vite SPA fallback.
- Keep root Docker out of the Services list.
- Validate with `vercel dev` and a Preview deployment after a real Vercel project is linked.

### Phase B — Durable job control plane
- Add DB-backed queue/job state, idempotent claims, lease renewal, cancellation and event persistence.
- Add Queue publisher/consumer and detached Sandbox worker launcher.
- Remove fire-and-forget `runChatJob` as the production entrypoint.
- Split AgentLoop into replay-safe bounded phases/iterations and persist its execution snapshot.

### Phase C — Remote workspace and sandbox
- Define a workspace filesystem contract used by ProjectManager and every Agent file tool.
- Implement Vercel Sandbox provider and local Docker provider behind the same contract.
- Provision one Drive per user and enforce a Drive-level writer lease; add Blob archive/restore only if Drive quota or region constraints require it.
- Migrate checkpoints, history, project duplication/deletion, git operations and previews to the workspace contract.

### Phase D — production hardening
- Enforce production fail-closed configuration: PostgreSQL, auth secret, queue, sandbox provider and durable workspace storage are mandatory.
- Add observability for job ID, sandbox name/session ID, project ID, delivery count and phase timings. Never log secrets or user file contents.
- Add recovery sweeps for queued/running jobs, expired locks, interrupted worker sessions and orphaned sandboxes.
- Run end-to-end tests through the public Vercel URL, including two independent API invocations to prove cross-instance persistence.

## 6. Required acceptance tests

- Duplicate queue delivery starts exactly one job.
- A failed consumer is redelivered without losing the canonical job record.
- A worker resumes or deterministically fails after a Sandbox interruption without repeating committed side effects.
- Cancellation stops an active command and releases the DB lease.
- Two jobs cannot concurrently write one project workspace.
- Workspace files survive Sandbox stop/resume and a separate API invocation.
- Project A cannot read, list, modify or execute files from Project B.
- Path traversal, symlinks, shell operators, blocked executables and oversized output are rejected.
- API cold starts and separate instances return the same project/job state from PostgreSQL.
- A production Preview flow can create a project, write/read files, run a build/test command in Sandbox, observe progress, cancel a job and reload the result.

## 7. Current prerequisites / blockers

- The Vercel team is on Hobby. A separate `nexum-dev` project is now linked to `borzenkoofficial-lab/nexum-dev`; it is configured with the Services framework and Node.js 22.x. The existing `nexum-cloud` project remains linked to SKOL and was not modified.
- The `nexum-dev` project has a **READY Preview deployment** for commit `0e3fab3` on `deploy/vercel-services`; there is no Production deployment (`live: false`). Deployment Protection SSO remains enabled. The project environment variable list is empty, so the API is intentionally not runtime-ready and will fail closed until PostgreSQL/auth/provider variables are configured.
- The 1 GiB `nexum-workspaces` Drive is provisioned and tested. Temporary Sandbox smoke-test resources were stopped and deleted; no Sandbox is left running.
- No PostgreSQL integration, Blob store or Queue topic has been provisioned for NEXUM. The Queue/Sandbox SDKs are present in the API package, but the producer/consumer and worker entrypoint are not wired yet. Existing Yandex PostgreSQL support remains in the codebase; production connectivity and serverless connection limits must be verified.
- 
## 8. Release gate

This architecture is not production-ready until all Phases A–D and the acceptance tests are complete, a Vercel Preview deployment is reachable, and the full end-to-end flow passes. Source-level review, GitHub CI, and a successful static build do not substitute for that evidence.


## 9. Infrastructure smoke test evidence (2026-11-04)

- Vercel project `nexum-dev` is linked to the intended GitHub repository, framework is `services`, Node.js version is `22.x`, and its branch Preview deployment reached `READY` after the TypeScript compatibility fix. No Production deployment exists.
- Created `nexum-workspaces` with a 1 GiB maximum in `iad1`.
- Created a temporary 1-vCPU / 2-GiB Sandbox with `networkPolicy: deny-all`, mounted the Drive read-write, wrote and read a marker file, then stopped the session.
- Created a separate Sandbox, mounted a read-only Drive snapshot, and successfully read the same marker (`exitCode: 0`) after the original writer session had stopped.
- Removed the marker file and deleted all temporary named Sandboxes. Final Vercel inventory: one Drive, zero named Sandboxes.
- This validates the Vercel Sandbox + Drive primitive only. It does not validate NEXUM's API integration, queue delivery, workflow recovery, or production deployment.
- GitHub Actions run `41897854607` completed with **SUCCESS** for both build and E2E jobs. The build job includes the new Vercel routing and PostgreSQL fail-closed tests; the E2E job includes the existing Runtime Phase 2.5 suite.


## 10. SDK dependency and security decision (2026-11-04)

- Added exact production dependencies: `@vercel/sandbox@3.6.1` and `@vercel/queue@0.1.1`. These releases expose the required Sandbox/Drive and QueueClient/Express callback APIs.
- Added npm overrides `@vercel/oidc@3.5.0` and `zod@4.6.7` to pin patched dependency versions.
- Initial trial of the latest SDK combination (`@vercel/sandbox@3.9.1`, `@vercel/queue@0.11.0`, `workflow@5.3.0`) produced 30 npm audit findings, including 24 high severity. Those versions and the Workflow SDK were not committed.
- With the pinned Sandbox/Queue releases and overrides: `npm ci` succeeded, `npm audit` reported **0 vulnerabilities**, API typecheck passed, all **127 API tests passed**, and API build passed in the Vercel implementation workbench.
- The initial architecture therefore uses Queue + detached Sandbox worker + PostgreSQL rather than the Workflow SDK. Reconsider Workflow only after a clean dependency audit and a concrete need.
- These SDK dependencies are installed in the repository, but the API has not yet been switched to use them.


## 11. Vercel builder compatibility fix

- The first Preview build failed inside Vercel's Express backend typecheck with `TypeError: Cannot read properties of undefined (reading 'readFile')` while loading local TypeScript `7.0.2`.
- Pinned `typescript@5.9.3` and `@types/node@22.20.5`, matching the Node 22 runtime and the supported Vercel builder API.
- Re-ran `npm ci`, `npm audit` (0 findings), API typecheck, all 127 API tests and API build in the Vercel workbench; all passed.
- A new Vercel Preview build for commit `0e3fab3` then completed both service builds: Express API typecheck and Vite Web build. Deployment status is `READY`.
- The Preview is SSO-protected and the project has no environment variables. No authenticated HTTP/runtime test was performed; API runtime is expected to fail closed until its required environment is configured.
