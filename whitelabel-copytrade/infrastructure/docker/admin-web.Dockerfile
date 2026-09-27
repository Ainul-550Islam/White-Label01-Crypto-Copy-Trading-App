# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# Admin console (Next.js).
#
# Built in standalone mode so the runtime image contains only the server bundle
# and its traced dependencies. NEXT_PUBLIC_* values are baked in at build time,
# which is why nothing secret may ever carry that prefix.
# ---------------------------------------------------------------------------
FROM node:20.11.0-bookworm-slim AS base
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
COPY apps/admin-web/package.json apps/admin-web/

RUN npm ci --workspace @wlct/admin-web --include-workspace-root

# ---------------------------------------------------------------------------
FROM deps AS build
WORKDIR /app

ARG NEXT_PUBLIC_APP_NAME="CopyTrade Admin"
ARG NEXT_PUBLIC_API_VERSION=v1
ARG NEXT_PUBLIC_WS_URL=""
ARG NEXT_PUBLIC_WS_PATH=/socket.io
ENV NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME \
    NEXT_PUBLIC_API_VERSION=$NEXT_PUBLIC_API_VERSION \
    NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL \
    NEXT_PUBLIC_WS_PATH=$NEXT_PUBLIC_WS_PATH

COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/admin-web ./apps/admin-web

# Server-side variables are only needed so the build can typecheck and
# pre-render; real values are injected at runtime by Compose.
ENV API_BASE_URL=http://api:4000/api \
    ADMIN_TENANT_SLUG=platform \
    SESSION_COOKIE_SECRET=build_time_placeholder_not_used_at_runtime \
    NODE_ENV=production

RUN npm run build --workspace @wlct/admin-web

# ---------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app

COPY --from=build --chown=node:node /app/apps/admin-web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/admin-web/.next/static ./apps/admin-web/.next/static
COPY --from=build --chown=node:node /app/apps/admin-web/public ./apps/admin-web/public

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/admin-web/server.js"]
