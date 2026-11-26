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

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0

COPY --from=build /app/apps/api/package*.json ./apps/api/
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
# TypeScript compilation does not copy SQL migration assets.
COPY --from=build /app/apps/api/db/migrations ./apps/api/dist/db/migrations
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/scripts/start-production.sh ./scripts/start-production.sh

RUN chmod 755 /app/scripts/start-production.sh \
    && mkdir -p /app/runtime \
    && chown node:node /app/runtime

USER node

EXPOSE 3001
CMD ["/app/scripts/start-production.sh"]
