# Part 14 - journal retention: pruning the one table that may be pruned

> **Risk note, deliberately unsoftened:** this part puts a DELETE statement
> on the money-adjacent plane, and everything about it is shaped by that.
> One table is deletable (the event journal), by two independent guards;
> the capability is dark by default at BOTH ends (engine config refuses
> apply, script refuses to ask for it); and every run - including the ones
> that delete nothing, and the rehearsals - leaves a row in a ledger that
> nothing prunes. Live venue transmission is unaffected by this document:
> it remains refused at engine startup (Part 13 §1; the credential provider
> and placement review were the two items still open when this was written, and
> Part 16 has since wired both - live still refuses, for the four reasons in
> [`PART16_PLACEMENT_REVIEW.md`](PART16_PLACEMENT_REVIEW.md) sec. 8).

## 1. What Part 13 left standing, and why it bends

The durable store ships three tables. Two of them are correct to keep
forever: `engine_orders` is one modest row per order (the record every
later command looks up), and `engine_order_fills` is the money ledger -
fees and aggregates reconcile against it, and Part 13 deliberately made
its child FK `ON DELETE RESTRICT` so that deleting an order with fills is
not a retention setting, it is a schema change. The third -
`engine_order_events` - grows without law: every transition appends,
payload included,
and a churning resting order can write a dozen rows a minute for hours.
Unbounded growth next to money is how operations get "we must vacuum the
audit table" conversations, and the wrong resolution (prune by age alone)
is how the story behind a disputed fill quietly disappears.

So the scope of this part, exactly: **the journal is prunable, everything
else is not, and both halves are enforced rather than promised.**

## 2. The law (core), before any SQL existed

`libs/trading-core/wlct_trading/retention.py` is pure and knows no
database. Four laws, each with a reason:

1. **Terminality is `terminal_at`, never a status re-derivation.** The
   core's transition table stamps `terminal_at` when an order reaches a
   terminal status (orders.py), and the store persists the stamp
   (Part 13). Retention asks the stamp, not the status list - a second
   definition of "done" would be a second thing to drift. A row whose
   stamp is NULL is UNPROVEN-settled and kept, whatever an operator
   believes its status means.
2. **An order keeps its whole story or none of it.** An event is prunable
   only when BOTH the event and its order's `terminal_at` are older than
   the cutoff. Without the second comparison, "90-day retention" would
   erase the history of an order that settled yesterday while the order
   row itself remains - the exact window an investigation is open in.
3. **Nonsense cannot exist.** `RetentionPolicy` refuses at construction:
   days outside 1..36,500 (zero is a loaded gun; a century is a lie about
   intent), batch rows outside 1..10,000, batches outside 1..1,000, and
   booleans (Python's `True` IS `1` day - a joke with database
   consequences). The engine's config validator constructs the policy at
   BOOT, so a typo names its env var in a startup failure instead of
   naming it in an incident.
4. **Timestamps arrive as arguments.** `now_us` is a parameter on every
   law-bearing function; the module imports no clock (a purity test walks
   the syntax tree and refuses imports of `time`/`datetime` and any
   `now()`-shaped call). A deletion path that cannot be given a fake clock
   is a deletion path that cannot be tested at the boundary.

`PRUNABLE_JOURNAL` and `IMMUTABLE_RECORD_TABLES` are named constants
because "obviously only the journal" survives one confident refactor only
as an identifier something can test against.

## 3. The executor: small, literal, and boring on purpose

`services/execution-engine/app/retention.py` holds five SQL constants
(hand-assembled adjacent literals - Part 13's law continues to bind) and
two coroutines:

- `run_event_retention(pool, tenant_id, policy, dry_run, instance_id)` -
  dry runs execute ONE count statement; applies loop over
  batch-select → delete-by-explicit-seq-list until the journal is
  considered, the work ends mid-batch, or the ceiling stops the run
  (`exhausted: true`, "schedule again" - a maintenance job yields to the
  command path, it does not drain a shard in one statement);
- `inspect_event_store(...)` - count + last five ledger rows, in ONE
  transaction, because two queries at different times are two answers.

The invariants the tests pin character-for-character:

- every statement carries `tenant_id = $n` in its WHERE (the belt) and
  runs inside the store's OWN `_TenantTransaction` - the GUC first
  statement, the canonical-UUID guard before the pool is borrowed, the
  per-transaction rhythm. Retention got zero new connection handling
  because every law Part 13's tests pin for writes extends to deletes for
  free;
- the count and the batch-select embed the SAME predicate text (a test
  pins that the shared WHERE constant is present in both), so a rehearsal
  cannot mean something different than the execution;
- deletes name explicit `seq = ANY($2::bigint[])` lists - never a
  predicate the database re-evaluates at delete time, never a USING-join
  shortcut - and `RETURNING 1` makes the reported count the rows ACTUALLY
  removed, so losing a race to a concurrent delete shrinks the number and
  nothing else;
- each batch is its own committed transaction (locks held per batch, a
  crash mid-run loses only the un-ledgered remainder, and the predicate
  makes the next run resume by construction - already-deleted rows simply
  stop matching);
- no retries anywhere in the loop. A store error propagates; the scheduler
  will try again, against idempotent statements. That is the same
  at-least-once contract the worker's command path earned in Part 11.

## 4. The ledger: `engine_retention_runs`

One row per COMPLETED run, written after the deletes, in its own
transaction: tenant, started/finished (micros), the applied cutoff,
`rows_deleted` (for dry rows: the prunable count - the column's name is
read as "reported", `dry_run` makes which one it is unambiguous),
`batches`, `exhausted`, and the `instance_id` that performed it. The
table lives by the same ownership law as the store's three: Prisma model
+ migration DDL in `apps/api/prisma`, RLS coverage via the generator
(42 covered tables then, 43 since Part 17's incident table), composite tenant FK with `Restrict` - the
deletion record survives arguments about the tenant.

Two honest edges, stated:

- **Refusals do not reach the ledger.** They happen at the router, in
  front of any store handle, and they return their code over HTTP - an
  operator wanting "who tried to prune against a dry-run-only deployment"
  gets it from the engine's log lines, not from a table that only the
  durable path could write. A "refused" row that requires the store would
  not exist precisely when memory mode refuses for want of a store.
- **The ledger insert is the one write that can fail after the deletes.**
  The design chose that ordering on purpose (recording first would
  over-record deletions that then failed to happen) and made the
  consequence survivable: a ledger failure surfaces as
  `RetentionLedgerLost` carrying the FULL counts, logged at ERROR
  (`retention.ledger_write_failed`) and echoed in the 500 body - the
  operator reading the response, or the script's stdout, holds exactly
  what the missing row would have. Between an under-record and an
  over-record, the platform under-records LOUDLY.

## 5. Configuration: dark at both ends

| Variable | Default | Law |
| --- | --- | --- |
| `EXECUTION_RETENTION_ENABLED` | `false` | Gates APPLY only. Inspect/dry-run need nothing. |
| `EXECUTION_RETENTION_EVENT_DAYS` | `90` | Constructed into the core policy at boot; out-of-bounds refuses startup. |
| `EXECUTION_RETENTION_BATCH_ROWS` | `2000` | ditto |
| `EXECUTION_RETENTION_MAX_BATCHES` | `50` | ditto |

Compose passes all four with `${VAR:-default}` (the `:-` form means an
EMPTY override resolves to the default - the Part 13 empty-DSN trap cannot
recur). The public config view exposes all four (non-secret by
construction); `/health/ready` and `/internal/v1/status` carry
`retentionEnabled`/`retentionEventDays` so the posture is readable, and
`describe()`'s new fields travel to the worker's status assertion without
joining its compatibility law (the worker does not gate on retention -
its commands do not touch the journal).

## 6. The wire surface: two POSTs, five answers

Both routes live on the internal prefix, behind the same token auth and
the same body-vs-header tenant match as the command routes. The error
envelope is the engine's existing flat `{code, message}`:

- `409 RETENTION_NO_DURABLE_STORE` - memory mode, both routes. The message
  says WHY it is not an empty success: memory journals are bounded by
  restart; pretending to prune them would be answering a maintenance
  command with a fiction.
- `409 RETENTION_APPLY_DISABLED` - apply attempted while ENABLED=false,
  and (pinned) not ONE statement reached the pool.
- `409` from the store's own UUID guard path is not applicable (the
  executor borrows the store's guard, refusing before touching the pool -
  `pool.acquires == 0` is asserted).
- `500 RETENTION_LEDGER_LOST` - section 4's loud under-record, counts in
  the body.
- `200` otherwise: `{"dryRun","cutoffUs","rowsReported","batchesRun","exhausted","ledgerWritten"}`
  for run; config view + `prunableNow` + recent `runs[]` for inspect.

The routes are reachable ONLY with the internal token, compose keeps the
engine on the internal network, and nothing on the public API proxies
here. A tenant cannot prune itself out of its audit trail; an operator
with the token and a scheduler can prune a tenant that asked them to -
which is the standing trust model of every engine command, restated
because the verb here is DELETE.

## 7. The CLI, and what scheduling means here

`node scripts/retention-run.mjs --tenant <uuid> [--inspect|--apply]` is
the only way this part intends deletion to happen unprompted:

- exit 0 completed / 1 engine refused or failed (code+message echoed,
  counts included for ledger-lost) / 2 misuse or unreachable engine - the
  exit-code contract a cron or systemd timer alerts on, matching
  `dr-manifest.mjs --due`'s precedent;
- one tenant per invocation, ALWAYS - a `--all-tenants` flag would be the
  cross-tenant sweep the store exists to refuse, wearing a CLI;
- the token is env-only and scrubbed from every line printed, including
  echoed error bodies (a test makes the fake engine reflect the token
  inside a 500 message and asserts it never reaches stdout);
- `--inspect` and dry-run are the defaults' friends: with no mode flag the
  call is a rehearsal, and the rehearsal is what the cron entry SHOULD be.

Deployment owns the cadence (a timer per tenant, or a loop calling the
script); the platform owns refusing to invent one. Compose ships no cron
sidecar: a schedule that exists is a promise about evidence and freshness
the deployment - and only the deployment - can keep, same reasoning as the
DR ledger staying unwired.

## 8. RLS and the cross-tenant proof

The ledger table was picked up by the Part 11 generator with no generator
change (coverage 41 → 42, and 43 after Part 17), so the enablement checklist remains one
document for every tenant table. The live suite (gated, honest, same
pattern as Part 13's) executes the whole argument on a real database: an
apply prunes tenant A's rows and touches NOTHING belonging to B - same
shapes, same cutoffs, same tables; and with policies ENABLE/FORCED on the
ledger, the executor's own transaction sees its new row while a bare
session sees zero rows, because the GUC is transaction-local and the law
of Part 13 §3 binds deletes as tightly as it binds writes.

## 9. Test law, with its limits in the same font

- `libs/trading-core/tests/test_part14_retention.py` - 35 tests: the
  construction law matrix, cutoff arithmetic recomputed through a second
  unit path, the prunable-predicate boundary rows (both strict-`<` edges
  included), the table-naming laws, and the AST-level purity scan (no
  clock, no driver, no status vocabulary - prose mentions are legal,
  imports are not).
- `services/execution-engine/tests/test_part14_retention.py` - 33 tests:
  five statement-literal pins (shared predicate, single delete target
  scanned off the module's own strings, sqlglot parse, ledger columns in
  migration order), the scripted conversations (dry/apply/ceiling/empty/
  race/ledger-failure/pool-error, transaction boundaries counted, GUC
  before every statement, zero pool acquires when the guard fires), and
  the HTTP matrix over a patched-pool booted app (including
  `statements == []` on the refused apply).
- `services/execution-engine/tests/test_part14_drift_parity.py` - 11
  tests: migration ⇄ Prisma model ⇄ executor INSERT re-derived to agree
  (minus the identity column, deliberately), the index name in both
  artifacts, the predicate columns existing in Part 13's DDL, the
  whole-app scan that finds exactly one `DELETE FROM` target, and RLS
  coverage/enable/disable symmetry for the new table.
- `services/execution-engine/tests/test_part14_retention_live.py` - 5
  tests against a REAL Postgres when `EXECUTION_TEST_POSTGRES_DSN` is
  set (skipped-by-name otherwise, exactly as disclosed for Part 13): the
  predicate matching the prose row-for-row, dry-run recording without
  touching a row, ceiling-stop-then-resume with the remainder intact
  across two runs, tenant isolation under identical shapes, and the
  live RLS probe on the ledger.
- `scripts/retention-run.test.mjs` - 11 node tests: arg law (dry default,
  exclusive modes, canonical-uuid refusal, no-token refusal), request
  shape, the scrub function, and full-process CLI runs against a real
  local fake engine asserting exit codes, header/body pairs, and the
  token never surfacing even when the server echoes it back.

The limits, plainly: the sandbox has no Postgres server, so the live
layer was verified to SKIP (12 skips across both live files, by name, in
the final ledger); its claims about the database are the CI database's to
confirm, same stance as Part 13 §9. The scripted fakes pin the SHAPE of
every statement and conversation; the live file is what pins their SUB-
STANCE. Both halves of that sentence are load-bearing.

## 10. The runbook (four moves, in order, with the reason each exists)

1. **Back up first, provably.** `node scripts/dr-manifest.mjs --due`
   green for the `postgres` component before any apply - a prune followed
   by a failed restore is indistinguishable from a data-losing outage.
   (The check exists since Part 12; this part makes its first real
   consequence one a deletion could worsen.) Since Part 15 the same move
   carries a second gate: `node scripts/rls-enablement.mjs check` (i.e.
   `dr-manifest.mjs --check-rls`) green too, because a DELETE whose
   blast radius depends on row-level security should not run against a
   partitioning that is believed rather than audited
   (docs/PART15_RLS_ENABLEMENT.md sec. 8).
2. **Inspect on the staging tenant set.** `--inspect` answers "what WOULD
   go, and when did we last run" in one transaction; read the cutoff it
   prints and make sure it is the cutoff you meant.
3. **Schedule the rehearsal.** A cron line running the default (dry) mode
   per tenant writes ledger rows that become the numbers you judge the
   first apply against. "Prune nothing for a week, watch the count" is a
   real safety feature with a 0-cost rollout.
4. **Enable, apply, verify.** Set `EXECUTION_RETENTION_ENABLED=true`
   (restart - the flip is deliberately not hot), run one `--apply` per
   tenant, read the ledger row back via `--inspect`
   (`rowsDeleted`/`exhausted`), and let the scheduler take it from there.
   A `dryRun=false, rows_deleted=0` row at steady state is a healthy run.

Rollback of a mistake is out of scope by the same law as the deletion:
Postgres point-in-time recovery from a verified backup - the DR runbook
(docs/DR.md), not a feature flag. That is why move 1 is the first move.

## 11. Decisions, each with its rejected alternative nearby

| Decision | Rejected alternative | Why |
| --- | --- | --- |
| Prune events only; orders and fills are permanent | Age-pruning orders too (with CASCADE-deleting fills, or re-RESTRICTing to Cascade) | The order row is the audit spine commands look up; fills are money. Growth was only ever in the journal; deleting what does not grow buys risk for nothing |
| `terminal_at` stamp as the settledness law | Re-deriving from `TERMINAL_ORDER_STATUSES` at prune time | Two definitions of "done" drift; the writer already decided, per row |
| Cutoff compares event AND order settlement | Pruning any event by its own age | Law 2: the recent history of a just-closed order is the active case |
| Explicit seq lists for DELETE | `DELETE ... USING` with the predicate re-evaluated | The rehearsal's rows are exactly the deleted rows; concurrent activity can only shrink the count, never retarget the delete |
| Ledger written after the deletes | Write-ahead "started" row + update (or refusals recorded too) | An update path that can half-write is worse; refusals lack the very handle a ledger row needs; the loud 500 carries the record forward instead |
| Dry runs recorded | Rehearsals being ephemeral | The scheduled rehearsal's ledger row IS the evidence the first apply is judged on |
| Engine endpoint + thin CLI, no scheduler in compose | Engine-side cron loop (self-firing deletes) | A process that deletes on its own schedule cannot be paused by pausing the schedule; deployment-owned cadence can |
| Bounded batches + `exhausted` resume | Unbounded "clean everything" | Retention competes with the money path for locks; losing that race must be structurally impossible |
| Refusal at router before any store touch | Executor-internal guards | One code path where "0 statements" is testable; the module stays about SQL, not config archaeology |

## 12. Cross-references

- Part 13: `docs/PART13_DURABLE_STORE.md` - the store whose transaction
  helper this part reuses verbatim, and whose §13 open-items list this part
  amends (journal retention closed; metrics time-series retention stays
  open - different table, different part, never conflate them).
- Part 11: `docs/PART11_WORKER_SCALING.md` §13 - the "no database" law
  this part extends without contradicting (the default still reports
  `storeDurable: false`; retention simply cannot be pointed at it).
- `docs/DR.md` - backup freshness is now load-bearing for deletion safety,
  not only for disaster size; and `docs/SECURITY.md` / `docs/ARCHITECTURE.md` carry the updated bullets.
- `docs/ROADMAP.md` - delivery-log row 14; the journal-retention entry is
  struck from the open list.

## 13. What this part does NOT do

It does not delete anything by itself, ever (no schedule ships, no
self-firing job); does not prune orders, fills, reconciliation state, or
its own ledger (structurally - one DELETE target, scanned app-wide by
test); does not grow the worker or the public API (no proxy, no queue
command, and the worker's gate remains what Part 13 made it); does not
touch live mode (startup still refuses it for the missing provider and
review, and a prune run against a live engine would still just be a
prune); does not pretend memory mode has a growth problem (it says so,
in the 409's own words); and does not add a fleet-wide sweep - `--tenant`
is required, the store's tenant law with a CLI bolted on, which is the
only kind of retention call this platform will make.
