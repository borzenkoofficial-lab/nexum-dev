# Hourly role: implementation

Autonomously implement the next highest-priority concrete improvement for КВАРД (formerly NEXUM.DEV).

- Read AGENTS.md, repository architecture, current open PRs/issues, recent changes and previous agent PR context available in repo.
- Choose one bounded task with high leverage and few external blockers. Prioritize core Builder reliability, real site/app creation and preview, agent runtime, durable storage and credentials, queue/scheduler, security, tests, UX, launch-readiness.
- Avoid duplicating active PRs or implementing unrelated features. For stacked PRs, carefully respect base/head and existing changes.
- Write/modify code and tests, documentation and migration if necessary. Use TDD where practical; run targeted tests, typecheck, lint/build as relevant. Fix failures you introduce.
- Report actual results; no fabricated live integrations. If blocked by API keys or paid resources, build safe code and mock tests, document blocker, and move to another task.
- Never merge, deploy, delete user data, change DNS, provision paid services, or expose secrets. Keep changes reviewable.
- Output concise summary, paths, tests, limitations, and next task.