# NEXUM staging on a REG.RU cloud server

## Architecture

GitHub -> REG.RU VPS -> Docker Compose -> Caddy HTTPS -> NEXUM Web/API

The API serves the built Vite application from `apps/web/dist`, so Web and API share one origin.

## Server requirements

- Linux VPS
- Docker Engine + Docker Compose plugin
- ports 80 and 443 available
- at least 2 GB RAM recommended for the staging instance
- Git installed

NEXUM's verification sandbox also uses Docker. The compose file mounts the host Docker socket into the NEXUM container so the existing sandbox can execute isolated build/test containers.

## First deployment

1. Point the REG.RU domain A record to the VPS public IPv4 address.
2. SSH into the server.
3. Install Git and Docker if they are not already installed.
4. Clone this repository.
5. Copy `.env.staging.example` to `.env.staging`.
6. Set `NEXUM_DOMAIN` to the real domain.
7. Add AI/database secrets only to `.env.staging`.
8. Run `bash scripts/deploy-staging.sh`.
9. Caddy obtains and renews the HTTPS certificate automatically once DNS resolves to the server.

## Updating

```bash
git pull --ff-only
bash scripts/deploy-staging.sh
```

## Health

```bash
curl -fsS https://YOUR_DOMAIN/api/health
```

The browser should load NEXUM from the same HTTPS origin. No Vite development server is required in staging.

## Security

- Do not commit `.env.staging`.
- Do not expose port 3001 publicly; Caddy is the public entry point.
- Keep the server firewall limited to SSH, HTTP and HTTPS.
- The Docker socket is required by the current NEXUM verification sandbox; keep the staging server dedicated to NEXUM and restrict SSH access.
