# Plan: durable project storage foundation

## Scope

This PR introduces only the additive PostgreSQL schema and architecture contract for durable workspaces. It does not switch the running Builder to object storage and must not be described as completing persistence.

## Steps

- [x] Inspect current ProjectManager, DB access, migrations, Builder filesystem assumptions, and Docker runtime.
- [x] Define PostgreSQL metadata and immutable manifest schema.
- [x] Document S3-compatible object storage, materialization, atomic commits, security policy, rollout, and rollback.
- [ ] Add object-storage adapter and contract tests in a follow-up implementation PR.
- [ ] Integrate per-job materialization/commit with Builder and every mutating project route.
- [ ] Add importer, multi-instance integration tests, and isolated S3 live test.
- [ ] Enable production only after secrets, bucket policy, backup/restore, and migration are explicitly configured.

## Verification

This change is schema/documentation only. CI will validate the migration files as part of the existing repository workflow; database integration tests and runtime persistence are not claimed by this PR.
