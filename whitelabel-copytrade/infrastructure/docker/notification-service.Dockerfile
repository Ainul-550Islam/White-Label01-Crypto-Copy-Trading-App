# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# Notification worker (Node + BullMQ).
#
# Consumes the email queue. It holds no database connection: everything it
# needs travels on the job payload, so a compromised worker cannot read tenant
# data.
# ---------------------------------------------------------------------------
FROM node:20.11.0-bookworm-slim AS base
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates dumb-init \
    && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
FROM base AS deps
ENV NODE_ENV=development

COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/config/package.json packages/config/
COPY packages/validation/package.json packages/validation/
COPY packages/utils/package.json packages/utils/
COPY services/notification-service/package.json services/notification-service/

RUN npm ci --workspace @wlct/notification-service --include-workspace-root

# ---------------------------------------------------------------------------
FROM deps AS build
ENV NODE_ENV=development
WORKDIR /app

COPY tsconfig.base.json ./
COPY packages ./packages
COPY services/notification-service ./services/notification-service

RUN npm run build --workspace @wlct/shared-types \
    && npm run build --workspace @wlct/config \
    && npm run build --workspace @wlct/utils \
    && npm run build --workspace @wlct/notification-service \
    && npm prune --omit=dev --workspace @wlct/notification-service --include-workspace-root

# ---------------------------------------------------------------------------
FROM base AS runtime
WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/services/notification-service/dist ./services/notification-service/dist
COPY --from=build --chown=node:node /app/services/notification-service/package.json ./services/notification-service/package.json

USER node
EXPOSE 8003

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.NOTIFICATION_SERVICE_PORT||8003)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "services/notification-service/dist/main.js"]
