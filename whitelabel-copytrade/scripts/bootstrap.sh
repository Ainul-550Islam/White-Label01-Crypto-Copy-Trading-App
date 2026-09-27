#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# One-command local setup.
#
# Idempotent: safe to re-run. It never overwrites an existing .env value that
# looks configured, and it stops at the first failure rather than leaving a
# half-initialised environment behind.
# -----------------------------------------------------------------------------
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

log()  { printf '\033[0;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[0;33m warn\033[0m %s\n' "$*"; }
die()  { printf '\033[0;31merror\033[0m %s\n' "$*" >&2; exit 1; }

require() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required but was not found on PATH."
}

log 'Checking prerequisites'
require node
require npm

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  die "Node 20 or newer is required (found $(node -v)). See .nvmrc."
fi

if [[ ! -f .env ]]; then
  log 'Creating .env from .env.example'
  cp .env.example .env
  chmod 600 .env
else
  log '.env already exists; leaving it untouched'
fi

log 'Generating any missing secrets'
node scripts/generate-keys.mjs --write .env

log 'Installing workspace dependencies'
npm install

log 'Generating the Prisma client'
npx prisma generate --schema apps/api/prisma/schema.prisma

if command -v docker >/dev/null 2>&1; then
  log 'Starting Postgres and Redis'
  docker compose up -d postgres redis

  log 'Waiting for Postgres to accept connections'
  for _ in $(seq 1 30); do
    if docker compose exec -T postgres pg_isready -q; then
      break
    fi
    sleep 2
  done

  log 'Applying database migrations'
  npm run prisma:deploy

  log 'Seeding baseline data'
  npm run db:seed
else
  warn 'docker was not found. Start Postgres and Redis yourself, then run:'
  warn '  npm run prisma:deploy && npm run db:seed'
fi

cat <<'DONE'

Setup complete.

Next steps:
  npm run dev:api            API on http://localhost:4000  (docs at /docs)
  npm run dev:admin          Admin console on http://localhost:3000

Review .env before doing anything beyond local development. Every value that
still reads "change_me" must be replaced.
DONE
