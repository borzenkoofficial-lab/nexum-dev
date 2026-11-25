# Daytona deployment configuration

## Required production environment

Set these Render environment variables before enabling Builder execution:

- `NEXUM_SANDBOX_PROVIDER=daytona`
- `DAYTONA_API_KEY` — a project-scoped Daytona API key, stored as a secret

The API key must remain server-side. Do not add it to frontend build variables, project files, generated app environment, or logs.

The Render blueprint declares the provider and secret slot, but it does not create a Daytona account, mint a key, or provision paid resources. The production Builder will fail closed if the key is absent; it will not fall back to running generated commands on the API host.

## Current execution profile

The initial provider profile is intentionally bounded:

- 2 vCPU, 4 GiB RAM, 10 GiB disk
- 30-minute sandbox TTL
- Private sandbox
- Outbound network is restricted to `registry.npmjs.org` for the sandbox lifetime; no general internet egress or host credentials are exposed
- Fresh task sandboxes automatically run `npm install --ignore-scripts` before the first build/test command when a root `package.json` exists; explicit later installs are also supported
- `.env*`, `.git`, `node_modules`, local caches and stale build outputs are excluded when staging files into Daytona; fresh `dist/` and `build/` artifacts are synced back for the authenticated NEXUM Preview
- Per-file transfer limit: 20 MiB; total workspace transfer limit: 200 MiB; maximum 1,000 files
- The Daytona adapter can request signed preview URLs (30–600 seconds), but the current NEXUM Builder Preview is served by the authenticated API from the synchronized project workspace; the signed Daytona URL is not yet wired into the user-facing Preview flow.

These are starting limits, not a claim that every project will fit. Larger builds should be handled by an explicit resource-profile change with tests.

## Local development

When `NEXUM_SANDBOX_PROVIDER` is unset and `NODE_ENV` is not `production`, the runner keeps the existing Docker sandbox. To test Daytona locally, set `NEXUM_SANDBOX_PROVIDER=daytona` and `DAYTONA_API_KEY`.

## Activation checklist

1. Create a Daytona project API key in the Daytona dashboard.
2. Add it to Render as `DAYTONA_API_KEY`.
3. Confirm `NEXUM_SANDBOX_PROVIDER=daytona`.
4. Run a controlled smoke test on a non-production project.
5. Verify create → upload → command → sync → delete and inspect network policy.
6. Only then enable Builder execution for production traffic.

Do not merge or deploy this branch before the secret has been provisioned and the smoke test has been approved.
