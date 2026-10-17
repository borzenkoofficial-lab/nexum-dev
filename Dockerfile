FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY apps/api/package*.json ./apps/api/
COPY apps/web/package*.json ./apps/web/

RUN npm ci --prefix apps/api
RUN npm ci --prefix apps/web

COPY . .

RUN npm --prefix apps/api run build
RUN npm --prefix apps/web run build
RUN npm prune --prefix apps/api --omit=dev

# Dedicated sandbox worker. Only this service receives the Docker socket;
# the public API container does not have host Docker access.
FROM node:22-bookworm-slim AS sandbox-worker
RUN apt-get update \
  && apt-get install -y --no-install-recommends docker.io ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
ENV NEXUM_SANDBOX_WORKER_HOST=0.0.0.0
ENV NEXUM_SANDBOX_WORKER_PORT=3020
ENV NEXUM_SANDBOX_VOLUME_ROOT=/app/runtime
COPY --from=build /app/apps/api/package*.json ./apps/api/
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
RUN mkdir -p /app/runtime
EXPOSE 3020
CMD ["node", "apps/api/dist/sandbox/worker.js"]

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0

COPY --from=build /app/apps/api/package*.json ./apps/api/
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/package.json ./package.json

EXPOSE 3001

CMD ["node", "apps/api/dist/server.js"]


