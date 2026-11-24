# NEXUM Builder — Daytona Sandbox Runtime

## Status
Approved implementation direction. Feature branch: feat/daytona-sandbox-runtime.

## Goal
Move execution of AI-generated project commands out of the NEXUM API host into isolated, provider-managed sandboxes while preserving the existing agent/tool contracts and project workspace behavior.

## Architecture
- NEXUM remains the control plane: authentication, project ownership, chat jobs, agent loop, policy, history, and user-facing Preview routing.
- SandboxProvider is the provider-neutral boundary. The first implementation is Daytona.
- Each active agent job gets an isolated Daytona sandbox; the project workspace is transferred into it, commands execute there, and changed files are synchronized back before the job advances.
- Provider credentials are read only by the API process from environment configuration. Never expose credentials to the browser or generated project code.
- The existing Docker sandbox remains available as an explicit local-development fallback, not as the production execution dependency.

## Daytona integration
- Use only documented Daytona API/SDK contracts verified against current official docs.
- Provision sandbox resources from server-side limits; use per-job identity labels and a finite TTL.
- Execute commands inside the sandbox. Preserve cancellation and bounded output semantics.
- Transfer project files with explicit exclusions for secrets and generated directories (at minimum .git, node_modules, dist, .env*, and local caches).
- Preview links must be private by default. Any user-facing URL must be time-limited or proxied through an authenticated NEXUM route; never persist provider bearer tokens in client-visible job payloads.
- Always clean up sandboxes in finally; if cleanup fails, log a structured error and rely on provider TTL as a backstop.

## Security and isolation
- Never execute generated commands on the NEXUM API host.
- Do not mount the host Docker socket or expose privileged host resources.
- Apply per-job CPU, memory, disk, wall-clock, output-size, and concurrency limits.
- Treat repository files, package scripts, AI output, and dependencies as untrusted.
- Network access must be an explicit policy decision; dependency installation may require outbound registry access, but arbitrary project runtime traffic must not inherit unrestricted host credentials.
- Do not put provider secrets into sandbox environment variables unless the specific secret is required by the task and approved for that purpose.

## Compatibility
- Keep existing SandboxRequest and SandboxResult semantics stable where possible.
- Preserve command validation at the NEXUM tool boundary, but allow package-manager lifecycle behavior only inside the isolated provider sandbox under policy.
- Keep current local Docker tests meaningful and add provider contract tests using an injected HTTP/SDK client; no live Daytona account is required for unit tests.

## Operational behavior
- Missing Daytona credentials must fail with a clear configuration error and must not silently execute generated code on the API host in production.
- Cancellation must stop remote execution and attempt sandbox cleanup.
- Remote API timeouts and 429/5xx errors must be distinguishable from user command failures.
- Job state remains owned by NEXUM; provider outages must transition jobs to a terminal or retryable state without losing the job identifier.

## Out of scope
- Creating a Daytona account or enabling paid billing.
- Adding or rotating API keys in production.
- Production deployment or switching the live service to Daytona.
- Building a public arbitrary-code execution endpoint.
- Replacing NEXUM project persistence or Preview delivery architecture wholesale.

## Acceptance criteria
1. Provider selection is configuration-driven and defaults to current local behavior in development.
2. Production mode cannot silently fall back to host execution when Daytona is unavailable.
3. A project can be staged, commands executed, and resulting files returned through a provider-neutral interface.
4. Abort signals terminate remote execution and cleanup is attempted.
5. Preview access does not leak Daytona API credentials.
6. Unit/contract tests cover success, command failure, timeout, cancellation, missing credentials, provider outage, file transfer exclusions, and cleanup.
7. API typecheck and complete API test suite pass in CI.