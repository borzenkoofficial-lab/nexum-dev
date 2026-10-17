# Self-hosted NEXUM staging

This deployment uses Docker Compose on a Linux host. It is intended for a REG.RU VPS or another host where you control Docker Engine. It is **not** the same deployment mode as Render: the sandbox worker requires access to the host Docker daemon and a shared named volume with the API.

## Prerequisites

- A Linux VPS with Docker Engine and the Docker Compose plugin.
- A DNS A record for the chosen staging domain pointing to the VPS.
- TCP ports 80 and 443 open for Caddy/HTTPS.
- A PostgreSQL database reachable **from the containers**. Do not use `127.0.0.1` in the database URL unless PostgreSQL is in the same container (it should not be).
- A valid AnyModel API key.

## Configure secrets

From the repository root on the VPS:

```bash
cp .env.staging.example .env.staging
openssl rand -hex 32
openssl rand -hex 32
```

Put the first generated value in `NEXUM_AUTH_SECRET` and the second, different value in `NEXUM_SANDBOX_WORKER_SECRET`. Then edit `.env.staging` and replace every placeholder:

- `NEXUM_DOMAIN`: the real DNS name.
- `NEXUM_DATABASE_URL`: PostgreSQL URL reachable from the Docker network.
- `ANYMODEL_API_KEY`: the actual key.
- Both secrets: independent random values, at least 32 characters.

Do not commit or upload `.env.staging`. It is ignored by Git.

## Deploy and verify

```bash
bash scripts/deploy-staging.sh
```

The script validates the Compose file, builds the API and sandbox-worker images, pulls the sandbox runtime image, runs database migrations, starts the services, and fails if the HTTPS health endpoint does not return successfully.

Useful diagnostics:

```bash
docker compose --env-file .env.staging -f docker-compose.staging.yml ps
docker compose --env-file .env.staging -f docker-compose.staging.yml logs --tail=200 api
docker compose --env-file .env.staging -f docker-compose.staging.yml logs --tail=200 sandbox-worker
```

## Security boundary

- The public API container does **not** receive `/var/run/docker.sock`.
- Only the private `sandbox-worker` service receives the Docker socket. That still gives the worker host-level Docker control, so treat it as a privileged trusted service: keep its port unexposed, use a strong independent secret, restrict host access, and do not run unrelated workloads on the same VPS.
- Project files are shared through the explicit `nexum-runtime` Docker volume. The worker rejects unsigned, expired, and replayed requests and executes commands through the existing restricted Docker sandbox.
- Do not add `ports:` for the worker or expose port 3020 publicly.
- The preview iframe keeps `sandbox="allow-scripts"`. Preview assets use short-lived, project-scoped bearer URLs so opaque iframe origins can load ES modules without enabling `allow-same-origin`; these links expire after 10 minutes.

## What this does not prove

The repository's CI can test image builds and an isolated worker command, but it cannot prove your VPS DNS, firewall, PostgreSQL reachability, real AnyModel credentials, or TLS issuance. Verify those on the actual host. No production deployment is performed by the CI workflow.
