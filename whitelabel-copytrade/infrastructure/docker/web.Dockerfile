# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# Customer web app (Next.js, apps/web).
#
# Same shape as admin-web.Dockerfile: standalone output so the runtime image
# carries only the server bundle and its traced dependencies. NEXT_PUBLIC_*
# values are baked in at build time, which is why nothing secret may ever
# carry that prefix. Server-only values (API_BASE_URL, SESSION_COOKIE_SECRET)
# are injected at runtime by Compose.
# ---------------------------------------------------------------------------
FROM node:22.23.3-bookworm-slim AS base
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates dumb-init \
    && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
FROM base AS deps

COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/config/package.json packages/config/
COPY packages/validation/package.json packages/validation/
COPY packages/utils/package.json packages/utils/
COPY apps/web/package.json apps/web/

RUN npm ci --workspace @wlct/web --include-workspace-root

# ---------------------------------------------------------------------------
FROM deps AS build
WORKDIR /app

ARG NEXT_PUBLIC_APP_NAME="Copy Trading"
ARG NEXT_PUBLIC_SITE_URL=""
ARG NEXT_PUBLIC_API_VERSION=v1
ARG NEXT_PUBLIC_WS_URL=""
ARG NEXT_PUBLIC_WS_PATH=/socket.io
ARG NEXT_PUBLIC_PLATFORM_DOMAIN=localhost
ARG NEXT_PUBLIC_SUPPORT_EMAIL=support@example.com
ARG NEXT_PUBLIC_SUPPORT_URL=/support
ARG NEXT_PUBLIC_ENVIRONMENT=production
ARG NEXT_PUBLIC_ENABLE_TELEMETRY=false
ENV NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME \
    NEXT_PUBLIC_API_VERSION=$NEXT_PUBLIC_API_VERSION \
    NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL \
    NEXT_PUBLIC_WS_PATH=$NEXT_PUBLIC_WS_PATH \
    NEXT_PUBLIC_PLATFORM_DOMAIN=$NEXT_PUBLIC_PLATFORM_DOMAIN \
    NEXT_PUBLIC_SUPPORT_EMAIL=$NEXT_PUBLIC_SUPPORT_EMAIL \
    NEXT_PUBLIC_SUPPORT_URL=$NEXT_PUBLIC_SUPPORT_URL \
    NEXT_PUBLIC_ENVIRONMENT=$NEXT_PUBLIC_ENVIRONMENT \
    NEXT_PUBLIC_ENABLE_TELEMETRY=$NEXT_PUBLIC_ENABLE_TELEMETRY \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL

COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web

# Server-side variables are only needed so the build can typecheck and
# pre-render; real values are injected at runtime by Compose.
ENV API_BASE_URL=http://api:4000/api \
    SESSION_COOKIE_SECRET=build_time_placeholder_not_used_at_runtime \
    NODE_ENV=production

RUN npm run build --workspace @wlct/web

# ---------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3001 \
    HOSTNAME=0.0.0.0
WORKDIR /app

COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public

USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/login').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/web/server.js"]
