# NEXUM.DEV — Vercel Services deployment audit

**Status: ROUTING CONFIGURATION UNDER TEST / PRODUCTION DEPLOYMENT BLOCKED**

This audit records a source-level review of the repository before its first Vercel Services deployment. It is not a claim that a Vercel build or runtime test has passed.

## Confirmed deployment topology

The selected topology is:

| Service | Root | Framework | Public path |
|---|---|---|---|
| `web` | `apps/web` | Vite | `/` and all non-API paths |
| `api` | `apps/api` | Express | `/api/*` |
| Root Docker app | `.` | Container | Excluded from Vercel Services |

The root Dockerfile remains in the repository for the existing container deployment path. It is deliberately not registered as a Vercel service.

## Routing and bindings

- `/api/(.*)` is routed to `api`.
- The catch-all `/(.*)` is routed to `web` and is last.
- Vercel rewrites preserve the incoming path. The Express application already declares API routes with the `/api` prefix, so no prefix stripping is required.
- The browser client uses relative `/api/...` requests. Those requests use the public same-origin route and do not need a service binding.
- The reviewed API code does not make HTTP calls to the web service or another internal Vercel service.
- **No service bindings are required or added.**

## Blocking runtime incompatibilities

### 1. Docker Sandbox cannot run inside the Express Function

`apps/api/sandbox/dockerSandbox.ts` launches the Docker CLI with `spawn("docker", ...)`, checks the Docker daemon with `docker version`, and runs isolated containers. A Vercel Express service runs as a Vercel Function; it does not provide a host Docker daemon or a mounted Docker socket. The Builder's command-execution path therefore cannot work in this deployment topology.

### 2. User projects are written to the local workspace filesystem

`apps/api/server.ts` derives `workspaceRoot` from the deployed module location. `ProjectManager` creates and mutates user project directories and metadata under `runtime/users/<userId>`; related agent history/checkpoint code also writes local files. Vercel Functions have a read-only deployment filesystem and only temporary writable `/tmp` storage. `/tmp` is not durable shared storage and cannot safely serve as the canonical project workspace across invocations or instances.

### 3. Agent jobs outlive the request and the function budget

The chat route starts `runChatJob(...)` without awaiting it, then returns HTTP 202. The agent loop has a 15-minute task budget. A Vercel Function has a bounded maximum duration (plan-dependent); a detached in-process promise is not a durable job queue or worker. This needs a durable queue/worker design and explicit completion/recovery semantics before production use.

### 4. Stateful in-memory coordination is instance-local

The API maintains process-local maps/caches for project managers, active controllers, chat-job cache, runtime tasks, and related coordination. Vercel may run multiple independent function instances and recycle them. Production correctness must rely on shared durable storage/coordination, not process-local memory.

### 5. Production provider and secret configuration is required

The API refuses to start when no real AI provider is configured. Production authentication also requires `NEXUM_AUTH_ENABLED=true` and a strong `NEXUM_AUTH_SECRET`. Persistent accounts/jobs require a reachable PostgreSQL database via `NEXUM_DATABASE_URL`. An Ollama URL pointing to `localhost` is not a hosted provider on Vercel.

## Required architecture work before a functional production deployment

1. Move project source trees and generated artifacts to durable object storage or a persistent workspace service.
2. Move command execution to an isolated remote sandbox/worker service that can actually provision containers; do not attempt Docker-in-Docker inside a Vercel Function.
3. Move chat-job execution to a durable queue plus worker/daemon. Persist job state and cancellation/recovery in PostgreSQL or another shared store.
4. Replace process-local correctness-critical coordination with shared durable locks/state.
5. Configure and verify production PostgreSQL, auth secret, and a reachable AI provider in Vercel environment settings.
6. Add an end-to-end Preview test that creates a project, writes files, executes a sandbox command, observes job progress, cancels a job, and reloads state from a separate request/instance.

## Verification performed for this audit

- Read the root Dockerfile, Render manifest, API and web package manifests, Vite config, Express server, DockerSandbox, ProjectManager, database and auth modules, agent loop, CI workflow, README, and project status.
- Confirmed the frontend uses same-origin relative `/api` URLs.
- Confirmed Express routes are already prefixed with `/api`.
- Confirmed no caller-to-callee HTTP service relationship requiring a Vercel binding in the reviewed code.
- Confirmed Docker Sandbox invokes the external `docker` CLI and requires a Docker daemon.
- Confirmed user project data is written under a workspace-root filesystem path.
- Confirmed chat work is launched asynchronously after the HTTP request is prepared to return 202.
- No Vercel deployment, `vercel dev`, local build, Docker runtime test, or current CI run was executed as part of this source-level audit.

## Decision

The two-service Vercel routing configuration is prepared as requested, but it must be treated as a **routing/build experiment only**, not as a production-ready NEXUM deployment. Do not promote it to production until the blocking runtime dependencies above have been addressed and verified.


## Architecture decision update

The user selected full Vercel-native adaptation with remote Sandbox, durable queues/workflows and persistent storage. See [VERCEL_PLATFORM_ARCHITECTURE.md](./VERCEL_PLATFORM_ARCHITECTURE.md) for the implementation contract, migration phases, Hobby constraints and acceptance tests. This decision does not make the existing API compatible by itself.


## Verification update — 2026-11-04

- Added a Vite SPA fallback to the `web` service and a CI contract test for service names, roots, route order, SPA fallback and Docker exclusion.
- Added a Vercel startup guard: if `VERCEL=1` and `NEXUM_DATABASE_URL` is absent, API startup fails instead of silently using process-local job state. Serverless PostgreSQL pool default is 2 connections; local default remains 10 and can be overridden.
- Added tests for the Vercel database guard and connection-pool default.
- GitHub Actions run `41897854607`: build **SUCCESS**, E2E **SUCCESS**. This is repository CI evidence, not Vercel Preview evidence.
- A Vercel project linked to the intended repository and a 1 GiB persistent Drive were provisioned. A cross-session Sandbox/Drive write-read smoke test passed. No Vercel deployment was made; no production secrets, database, queue or workflow have been configured.
- See [VERCEL_PLATFORM_ARCHITECTURE.md](./VERCEL_PLATFORM_ARCHITECTURE.md) for the current infrastructure test record and remaining migration plan.
