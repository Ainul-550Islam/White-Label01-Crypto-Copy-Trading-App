#!/usr/bin/env bash
# One-time repair for a failed, transaction-rolled-back historical outbox
# migration. Does not edit migration history files or touch an applied outbox.
# Run only during an exclusive migration window, with a database backup.
set -euo pipefail

if [[ "${1:-}" != '--repair-failed-outbox' || $# != 1 ]]; then
  echo 'Usage: apply-batch02-outbox-migration-repair.sh --repair-failed-outbox' >&2
  exit 2
fi
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${DIRECT_DATABASE_URL:?DIRECT_DATABASE_URL is required}"
command -v psql >/dev/null
command -v sha256sum >/dev/null
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
prisma="$root/node_modules/prisma/build/index.js"
schema="$root/apps/api/prisma/schema.prisma"
migration="$root/apps/api/prisma/migrations/20261008120000_outbox_event/migration.sql"
name='20261008120000_outbox_event'
checksum='896bd2f1c99f1a2849a0ce1653fa364502a57f6b80fc31e6ae00bf20c6f673bc'
[[ -f "$prisma" && -f "$schema" && -f "$migration" ]] || { echo 'Prisma or migration files are missing.' >&2; exit 1; }
[[ "$(sha256sum "$migration" | cut -d' ' -f1)" == "$checksum" ]] || { echo 'Historical migration checksum differs; refusing automatic repair.' >&2; exit 1; }

# Avoid placing database credentials in a process argument. Convert the direct
# URI to a private libpq service file; Prisma-only `schema=public` is removed.
service_file="$(mktemp "${TMPDIR:-/tmp}/batch02-pg-service.XXXXXX")"
trap 'rm -f "$service_file"' EXIT
chmod 600 "$service_file"
export BATCH02_PG_SERVICE_FILE="$service_file"
node <<'NODE'
const fs = require('fs');
const u = new URL(process.env.DIRECT_DATABASE_URL);
if (!['postgres:', 'postgresql:'].includes(u.protocol) || !u.hostname || !u.pathname.slice(1)) process.exit(2);
const schema = u.searchParams.get('schema');
if (schema && schema !== 'public') process.exit(2);
const allowed = new Set(['schema', 'sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'connect_timeout', 'application_name', 'target_session_attrs']);
for (const key of u.searchParams.keys()) if (!allowed.has(key)) process.exit(2);
const safe = (value) => { if (/[\r\n]/.test(value)) process.exit(2); return value; };
const entries = [['host', u.hostname.replace(/^\[|\]$/g, '')], ['port', u.port || '5432'],
  ['dbname', decodeURIComponent(u.pathname.slice(1))]];
if (u.username) entries.push(['user', decodeURIComponent(u.username)]);
for (const [key, value] of u.searchParams) if (key !== 'schema') entries.push([key, value]);
fs.writeFileSync(process.env.BATCH02_PG_SERVICE_FILE, '[batch02]\n' + entries.map(([k, v]) => `${k}=${safe(v)}`).join('\n') + '\n', { mode: 0o600 });
NODE
if [[ "$(node -e 'process.stdout.write(new URL(process.env.DIRECT_DATABASE_URL).password ? "yes" : "no")')" == yes ]]; then
  export PGPASSWORD="$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.DIRECT_DATABASE_URL).password))')"
fi
unset PGDATABASE PGHOST PGPORT PGUSER
export PGSERVICEFILE="$service_file" PGSERVICE=batch02
query() { psql -X -qAt -v ON_ERROR_STOP=1 -c "$1"; }
state="$(query "SELECT count(*) FROM public._prisma_migrations WHERE migration_name = '$name' AND checksum = '$checksum' AND finished_at IS NULL AND rolled_back_at IS NULL AND applied_steps_count = 0")"
other="$(query "SELECT count(*) FROM public._prisma_migrations WHERE migration_name = '$name' AND (finished_at IS NOT NULL OR (finished_at IS NULL AND rolled_back_at IS NULL AND checksum <> '$checksum'))")"
objects="$(query "SELECT (to_regclass('public.outbox_events') IS NOT NULL OR to_regtype('public.\"OutboxEventStatus\"') IS NOT NULL OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'source_event_id'))::int")"
[[ "$state" == 1 && "$other" == 0 && "$objects" == 0 ]] || {
  echo 'Expected one failed zero-step outbox migration with no outbox objects; refusing repair.' >&2
  exit 1
}

# PostgreSQL truncates both original index names to the same 63 bytes. Rename
# the second, non-unique lookup index in the SQL stream only; the original
# migration file and its checksum remain byte-for-byte unchanged.
echo 'Marking the failed transaction rolled back, applying corrected SQL, then recording the original migration as applied.'
node "$prisma" migrate resolve --rolled-back "$name" --schema "$schema"
sed 's/"outbox_events_tenant_id_aggregate_type_aggregate_id_aggregate_sequence_idx"/"outbox_events_tenant_aggregate_sequence_lookup_idx"/' "$migration" | psql -X -q -v ON_ERROR_STOP=1
node "$prisma" migrate resolve --applied "$name" --schema "$schema"
node "$prisma" migrate deploy --schema "$schema"
