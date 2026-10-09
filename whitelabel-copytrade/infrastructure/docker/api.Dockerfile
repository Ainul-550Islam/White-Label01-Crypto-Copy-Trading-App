# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# NestJS API.
#
# Multi-stage: the build stage carries the full toolchain and dev dependencies,
# the runtime stage carries only production dependencies and compiled output.
# The container runs as a non-root user and ships no source, no .env and no
# build cache.
# ---------------------------------------------------------------------------
FROM node:22.23.3-bookworm-slim AS base
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false
WORKDIR /app

# openssl is required by Prisma's query engine.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates dumb-init \
    && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
FROM base AS deps
ENV NODE_ENV=development

# Only manifests are copied first so the dependency layer is cached until a
# package.json actually changes.
COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/config/package.json packages/config/
COPY packages/validation/package.json packages/validation/
COPY packages/utils/package.json packages/utils/
COPY apps/api/package.json apps/api/

RUN npm ci --workspace @wlct/api --include-workspace-root

# ---------------------------------------------------------------------------
FROM deps AS build
ENV NODE_ENV=development
WORKDIR /app

# The API compile (`nest build`: about 880 files, the swagger plugin and a
# generated Prisma client of roughly 30 MB) needs more heap than Node's default
# on most hosts and aborts with "JavaScript heap out of memory" without it. CI
# type-checks the same code with the same ceiling (.github/workflows/ci.yml).
# It is a ceiling, not a reservation; override it with
# `--build-arg NODE_BUILD_HEAP_MB=<MiB>`. Only this stage (and the one-shot
# migrate job that runs it) sees it: the runtime stage starts from `base`.
ARG NODE_BUILD_HEAP_MB=6144
ENV NODE_OPTIONS=--max-old-space-size=${NODE_BUILD_HEAP_MB}

COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api

RUN npm run build --workspace @wlct/shared-types \
    && npm run build --workspace @wlct/config \
    && npm run build --workspace @wlct/validation \
    && npm run build --workspace @wlct/utils \
    && npx prisma generate --schema apps/api/prisma/schema.prisma \
    && npm run build --workspace @wlct/api

# Strip development dependencies from the tree that will be copied forward.
# npm workspaces hoist every package to /app/node_modules and create
# apps/api/node_modules only when a version conflict forces a nested copy, so
# the directory is made to exist: the runtime COPY below then carries any
# nested packages and is never a "not found" build failure without them.
RUN npm prune --omit=dev --workspace @wlct/api --include-workspace-root \
    && mkdir -p apps/api/node_modules

# ---------------------------------------------------------------------------
FROM base AS runtime
WORKDIR /app

# node:22 already provides an unprivileged `node` user (uid 1000).
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/prisma ./apps/api/prisma
COPY --from=build --chown=node:node /app/apps/api/node_modules ./apps/api/node_modules

# Dataset store and its staging area. Production requires both as absolute
# paths on the same filesystem (finalisation is a rename) and disjoint from
# each other; /app itself is root-owned, so create them for the runtime user.
RUN mkdir -p /app/data/datasets /app/data/staging && chown -R node:node /app/data

USER node
EXPOSE 4000

# The health endpoint is unauthenticated and touches no dependency, which is
# exactly what a liveness probe needs.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/api/dist/main.js"]
