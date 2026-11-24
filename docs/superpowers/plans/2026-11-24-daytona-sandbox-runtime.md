# Daytona Sandbox Runtime Implementation Plan

> **For agentic workers:** Execute task-by-task with test-driven development. Each task must begin with a failing test and verify it fails for the expected reason.

**Goal:** Add an isolated Daytona execution backend for NEXUM Builder without coupling agent tools to a specific sandbox vendor.

**Architecture:** Add a provider-neutral sandbox contract and a Daytona implementation behind configuration. Stage a filtered project snapshot into a per-job sandbox, run commands there, and synchronize changed files back. Keep the current Docker backend for local development only; production must fail closed if the configured remote provider is unavailable.

**Tech Stack:** Existing Node.js 22 + TypeScript API, Node built-in fetch/filesystem APIs unless the official Daytona SDK is added with a reproducible lockfile update, existing node:test suite.

**Spec:** docs/architecture/daytona-sandbox-runtime.md

## Global Constraints
- Never execute generated project code on the NEXUM API host in production.
- Never expose DAYTONA_API_KEY to browser code or generated code.
- Keep remote sandboxes private by default and assign finite TTLs.
- Preserve cancellation, bounded logs, job ownership, and current tool result shapes.
- No production credential, paid account, billing, deployment, or main-branch changes.

## Review Focus
- Missing/invalid credentials: return actionable configuration failure; no host fallback in production.
- Malicious filenames/symlinks: stage only files contained in the project root and apply explicit exclusions.
- Provider timeouts/429/5xx: classify as infrastructure failures, not command exit failures.
- Cancellation during upload/command: stop work and attempt cleanup without masking the original cancellation.
- Preview URLs: no provider API token or unbounded signed URL may be persisted in client-visible state.

---

### Task 1: Provider contract and factory
**Files:** create apps/api/sandbox/provider.ts and provider.test.ts; modify apps/api/sandbox/types.ts.
**Interfaces:** SandboxProvider.create(request): Promise<SandboxSession>; SandboxSession.run(request, signal?): Promise<SandboxResult>; SandboxSession.getPreviewUrl(port, expiresInSeconds): Promise<string>; SandboxSession.dispose(): Promise<void>. Factory selects docker or daytona from NEXUM_SANDBOX_PROVIDER.
- [ ] Write tests for provider selection, missing provider configuration, and stable session contract.
- [ ] Run focused tests and verify expected RED.
- [ ] Implement minimal interfaces and factory.
- [ ] Run focused tests and API typecheck.
- [ ] Commit.

### Task 2: Daytona API client and sandbox lifecycle
**Files:** create apps/api/sandbox/daytonaClient.ts, daytonaClient.test.ts, and daytonaSandbox.ts.
**Interfaces:** Inject fetch, base URL, API key, and request timeout for deterministic tests. Create sandbox with server-defined resource limits, labels, privacy settings, and TTL. Retrieve toolbox proxy URL and use documented toolbox endpoints. Delete sandbox idempotently.
- [ ] Test auth headers, URL construction, response parsing, HTTP error classification, and delete behavior with a local fake HTTP server.
- [ ] Verify RED.
- [ ] Implement only documented Daytona API calls.
- [ ] Verify GREEN and typecheck.
- [ ] Commit.

### Task 3: Safe workspace staging and synchronization
**Files:** create apps/api/sandbox/workspaceTransfer.ts and workspaceTransfer.test.ts.
**Interfaces:** collectWorkspaceFiles(root): Promise<WorkspaceFile[]>; stageWorkspace(session, root, signal?): Promise<void>; syncWorkspace(session, root, signal?): Promise<void>.
- [ ] Test exclusions, traversal/symlink rejection, binary files, empty directories, and file size limits.
- [ ] Verify RED.
- [ ] Implement bounded file transfer and a manifest-based change set.
- [ ] Verify GREEN.
- [ ] Commit.

### Task 4: Connect agent tools to provider sessions
**Files:** modify apps/api/agent/tools/runCommand.ts, apps/api/agent/tools/testProject.ts, apps/api/agent/loop.ts; add tests beside affected tools.
- [ ] Add tests proving all agent build/test commands use the selected provider session and preserve result shape.
- [ ] Verify RED.
- [ ] Implement session reuse for one job and sync changes before returning.
- [ ] Verify focused tests, API typecheck, and full API suite.
- [ ] Commit.

### Task 5: Production configuration and operations
**Files:** modify render.yaml; modify apps/api/server.ts only if lifecycle wiring requires it; update sandbox tests; create docs/deployment/daytona.md.
- [ ] Test that production with Daytona selected and no key fails closed; local development retains Docker behavior.
- [ ] Verify RED.
- [ ] Add documented environment variables, resource limits, TTL, and health diagnostics.
- [ ] Verify GREEN and full CI.
- [ ] Commit.

## Completion gate
- Full API test suite and typecheck pass in CI.
- Draft PR opened against main; do not merge or deploy.
- Live Daytona smoke test remains blocked until the owner supplies a project-scoped API key and explicitly approves any paid usage.