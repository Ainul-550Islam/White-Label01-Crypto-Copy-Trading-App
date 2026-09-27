# Part 13 - The durable execution-engine store

Status: shipped. Every file in this part is reproduced in full in
`docs/PART13_HANDOVER_FULL_SOURCE.md`.

## 1. What this part is

`libs/trading-core` has defined the order-persistence PORT since Part 2 -
`wlct_trading.execution.store.OrderStore` - and its only implementations
were the in-memory reference and nothing else. The execution engine service
therefore recorded orders, fills, events and reconciliation state in
process memory: `storeDurable: false` at readiness, a truthful claim the
whole platform made sure to publish rather than hide (SECURITY has always
said the simulated store is process-local, and the numbers said so too).

Part 13 ships the durable adapter the port's docstring promised:
`services/execution-engine/app/store_sql.py` implements the same ABC over
Postgres, the DDL joins the schema that owns every table (Prisma, with the
generated row-level-security machinery covering the new tables
automatically), and the worker's startup tripwire - "refuse a durable
engine until the ack policy is re-reviewed" - got that re-review and is
documented in Section 6.

What did NOT change, deliberately:

* `EXECUTION_MODE=live` is still refused by code. Durability was ONE of
  live's prerequisites (as written at the time, the credential provider and the
  authenticated order-placement review remained open; Part 16 has since wired
  both - the credential source is configuration with its own boot refusals and
  the review is gate 11 of 11 - and live is still refused, for the four reasons
  listed in docs/PART16_PLACEMENT_REVIEW.md sec. 8); shipping the store did not
  sneak live closer by implication.
* The default backend is `memory`. Deployments opt into durability;
  nothing degrades silently in either direction (Section 5).
* The engine still serves the same four commands and answers 501 to
  everything else; a store backend is not a capability expansion.

## 2. The adapter

`PostgresOrderStore(OrderStore)` - thirteen port methods, one design:

* **Driver-free.** The store talks to a two-method protocol
  (`PgPool.acquire`, `PgPool.close`; `PgConnection.execute/fetch/fetchrow/
  transaction`). `app/pg_store.py` is the one module that imports `asyncpg`
  (the mypy override list says so, and a source-scan test pins that no
  other app module may import the driver). This keeps the semantics suite
  DB-free and the seam for a different driver one file deep.
* **Stateless over the tables.** There is no in-process projection to
  "replay" - every read is a query, so restart recovery is Postgres
  recovery. The reducer-shaped replay worry that motivates event-store
  designs elsewhere does not apply: the tables ARE the projection, written
  by transactional statements.
* **Fidelity first, strictness where SQL must be louder.** Reservation
  answers (win / resume / lost-race-with-holder), `record_fill`'s
  already-recorded `False`, `IN_SYNC`-erases-state, append-only events: all
  mirror the in-memory reference, which the port documents as the contract.
  Two places SQL is STRICTER by design, both documented at the statement
  and tested: `save_order` of an order claiming a client id held by a
  DIFFERENT order raises the unique violation instead of the reference's
  silent keep-the-first-mapping; and the reservation INSERT carries
  `reconciliation_state = UNKNOWN` (the reference store cannot express the
  crash-between-reserve-and-submit question at all - losing the process also
  loses the order - so the durable store states the true answer: unknown).
* **The one refusal.** `list_orders_needing_reconciliation` is the port's
  single cross-tenant method. Tenant-scoped answers to a fleet-wide
  question would be the "no orders need reconciliation" lie, and under this
  store's own GUC law a fleet-wide query is impossible by construction - so
  the durable adapter raises `CrossTenantSweepUnsupported` (an
  `OrderStoreError`, and the service has no route that reaches the
  reference store's sweep either). The platform's reconciliation runs
  per-account through the `reconcile-trading-account` command, which is
  tenant-scoped and fully supported.

## 3. Schema law

Three tables, owned by `apps/api/prisma/schema.prisma` +
`migrations/20260914120000_part13_execution_store/migration.sql`:
`engine_orders` (composite primary key `(tenant_id, order_id)`; unique
`(tenant_id, client_order_id)`), `engine_order_events` and
`engine_order_fills` (children keyed `(tenant, order)` by a composite
foreign key, so a child row cannot pair one tenant with another tenant's
order - cross-tenant children are a constraint violation, not a review
item).

Shape decisions the codebase will be asked to defend, and the answers:

* **DECIMALS AS TEXT.** `quantity`, `price`, fees and derived aggregates
  are `VARCHAR` columns holding the canonical `Decimal.__str__` output.
  Postgres `NUMERIC(p,s)` RESCALES - `average_fill_price` is a division
  with arbitrary residue (`0.100000000000000000000001` in the tests) - and
  a rounded stored aggregate would make the durable record disagree with
  the domain's own derivation. Decimal-as-text is already the wire law of
  this service's response schemas; the tables keep it end to end. The
  codec's round-trip test asserts string-level scale preservation, not
  just numeric equality.
* **MICROSECONDS AS BIGINT.** The platform's int-time law (the same one
  the leases and SLO rows obey); no Timestamptz on the execution plane, so
  no server timezone can ever edit history.
* **ENUM VOCABULARIES ARE VARCHAR, NOT CREATE TYPE.** The status/side/
  type/time-in-force values are owned by `wlct_trading.enums` and move with
  the library; a mirrored Postgres enum type would be a second source of
  truth with a drift bug waiting. The codec CONSTRUCTS the enum on read, so
  a row outside the vocabulary is a hard decode error (fail-closed), and
  tests pin that corrupt rows raise rather than default.
* **`seq BIGSERIAL` on both journals.** The in-memory store returns fills
  and events in insertion order; microsecond timestamps tie routinely
  (three transitions in one tick), so only a monotonic column reproduces
  "append order". It doubles as the row identity.
* **`reconciliation_state NULL` = IN_SYNC.** The reference store DELETES
  its map entry on sync; one fact gets exactly one spelling in the table
  too, and `engine_orders_reconciliation_state_idx` makes the flagged
  subset cheap.
* **Event `event_id` has NO unique constraint.** The port appends
  unconditionally; a constraint stricter than the contract would reject
  rows the reference store accepts. Indexed for correlation, not for
  dedup (Section 2's strictness list is exhaustive on purpose).
* **`ON DELETE RESTRICT` from tenant.** Operational tables elsewhere use
  Cascade or SetNull; execution records are the audit of money movement
  and must not vanish as a side effect of tenant deletion - not even by an
  admin's deliberate hard delete, which fails loudly instead.

`@@map` names are the SQL names (`engine_orders`, ...) so the RLS
generator's schema parse - "models whose non-nullable `tenantId` column is
`@db.Uuid`" - picked all three tables up WITHOUT any generator change:
coverage went 38 -> 41 covered tables on the next deterministic regeneration
(migration, enable.sql, disable.sql, coverage JSON), the coverage spec
re-derived and passed, and the enablement checklist's probes cover the new
tables exactly like the old ones.

## 4. The tenant law: one GUC, one transaction, every statement

Every port method runs `acquire -> transaction -> set_config('app.tenant_
id', $1, true) -> statements` - the character-identical contract of
`PrismaService.withTenantRls` on the Node side (bound parameter, local
scope, first statement in the transaction). Tests pin the law three ways:
every operation's first recorded statement is the GUC with the right
tenant bound; every operation opens and closes exactly one transaction;
and a statement error rolls back and propagates (never swallowed).

Consequences that matter:

* **RLS day one.** When an operator flips the generated policies on
  (Part 11's checklist-gated `enable.sql` step), the engine needs no code
  change - its tables were covered by the policy generation and its
  connections carry the GUC. A store whose queries could not satisfy the
  policies would make the enablement checklist a trap; this one makes
  enabling a no-op for the engine.
* **Malformed tenants fail before the connection.** The tenant column is
  `uuid`, so `PostgresOrderStore` refuses any `tenant_id` that is not the
  canonical 8-4-4-4-12 form, naming the reason, instead of letting the
  driver raise "invalid input syntax" mid-command. The wire header's own
  pattern is looser; the DB type is the stricter contract and the store
  states it.
* **Pool hygiene.** `_TenantTransaction` releases the connection in a
  `finally`, so the error paths cannot leak pool slots (test-pinned
  against the scripted fake).

## 5. Mode and backend: no silent anything

`EXECUTION_STORE_BACKEND=memory|postgres`, default `memory`:

* `postgres` without `EXECUTION_POSTGRES_DSN` (or with a non-`postgresql://`
  one) is a SETTINGS validation failure - the process does not start.
* A DSN set while the backend is `memory` is also a refusal ("a
  half-configured durable store is not a store"): the commonest silent
  failure in this space is someone believing durability was on. An EMPTY
  DSN string counts as unset (compose's `${VAR:-}` defaults must not arm
  the mismatch law).
* `postgres` + pool connect failure or a missing table is a STARTUP
  refusal: `app/pg_store.py` verifies `to_regclass('public.engine_orders')`
  (and the two journals) and names the migration in the error. There is no
  fallback to memory - "configured durable, running memory" is exactly the
  lie the `storeDurable` honesty rule exists to prevent, and the health
  surface would have no way to report it truthfully after boot.
* `build_runtime(settings, store=...)` accepts a store ONLY under the
  postgres backend (and demands one), so the composition function itself
  refuses any wiring where describe() would have to lie.
* Readiness and `/internal/v1/status` now carry `storeBackend` as well as
  `storeDurable`; the DSN never appears in `to_public_dict`, logs, or
  responses (whitelist law; the test asserts the literal credential
  substring is absent from the public view).

## 6. The worker ack-policy re-review (the tripwire's condition)

`docs/PART11_WORKER_SCALING.md` parked a forcing function: the worker's
startup gate REFUSED any engine reporting `storeDurable: true` until the
ack policy had been re-read against durability. That review happened now;
here is its result and the evidence behind it.

The policy under review (unchanged since Part 11): a TRADE_EXECUTION job
acks when the engine answers 2xx REGARDLESS of business outcome (a
receipt of `rejected` is a completed command - the decision is recorded,
not the queue's problem); 5xx/transport failures retry (BullMQ at-least-
once), and a retry may REPLAY a command that already applied. In-memory
that replay was harmless because a lost reply usually meant the process was
gone; durable, replays land next to the originals, so each replayable
command must be idempotent AGAINST THE TABLES:

1. **Credential verification / balance refresh**: read-only from the
   queue's view (the paper account adapter is still process-memory; its
   mirror rows are the API's, written via their own idempotent upserts).
   Replaying these changes nothing per-call. No store reservation.
2. **cancel-order**: transitions the order through the legal-transition
   table via the store; a replay either re-saves the same terminal state
   (upsert: idempotent) or finds the order already terminal and answers a
   `rejected` receipt (a record, not a second action). The store never
   DELETES, so no replay can resurrect history.
3. **reconcile-trading-account**: fills are recorded through
   `ON CONFLICT (tenant_id, fill_id) DO NOTHING` - a replayed execution
   answers "already recorded" and the order's aggregates are untouched
   (the bool `False` is the dedupe signal the engine's caller path uses);
   event appends carry the venue's event ids and the journal is append-only.
4. **The submission reservation** - the mechanism the whole Part 2
   `DuplicateOrderGuard` grew from - is now database-enforced: the unique
   `(tenant_id, client_order_id)` index. A redelivered submit resumes the
   reserved order (the ReservationOutcome contract) instead of creating a
   second position. This is ALSO the answer to the deeper question the
   tripwire was guarding: at-least-once delivery meets at-most-once
   EFFECTS through the reservation, which only BECOMES real on a durable
   store. The store's existence is what makes the retry taxonomy SAFE, not
   risky - the refusal had to be reviewed to notice that.

The gate therefore flips from "refuse durable" to "accept durable,
provided the engine's claim is coherent": `storeDurable: true` requires
`storeBackend: "postgres"` in the same status payload. A durable claim
without a named backend (an engine too old to send the field included -
'unknown' by parse) stays a startup REFUSAL: unproven durability is
unproven, and this worker only forwards under the reviewed contract. The
mode check keeps precedence (a live-mode engine is refused on mode before
anything else). Three new tests in `worker.spec.ts` pin accept-coherent,
refuse-incoherent (undefined/memory/unknown backend spellings), and
non-durable-passes-unchanged.

## 7. Engine restart: what actually survives

With the postgres backend: order rows, the event journal, fill ledger,
reservations (as rows) and reconciliation state all survive; a cancel
after restart finds its order instead of answering a truthful 404 (that
limitation is retired in Section 13's item list below, from Part 11).
Reconciliation state as-of-crash reads `UNKNOWN` for reserved-but-un-
submitted orders - which the engine treats as "query by clientOrderId,
never resubmit", the behavior the state was invented for.

What does NOT survive (and says so): the incident recorder and the account
balances of the paper adapter remain process-memory (they are simulated-
venue state, not the audit record; the API's account mirrors keep their
own durable path). Locks are in-memory per process - the distributed
RedisLockManager exists in the core for deployments that wire it; nothing
in Part 13 claimed otherwise, and `locksDistributed` still reports the
truth.

## 8. Configuration surfaces

* `services/execution-engine/.env.example`: the block (backend + DSN, with
  the "never a fallback" note).
* Root `.env.example`: a short discoverability note beside
  `EXECUTION_ENGINE_URL` (compose reads the root env).
* `docker-compose.yml` execution-engine service: `EXECUTION_STORE_BACKEND:
  ${EXECUTION_STORE_BACKEND:-memory}`, `EXECUTION_POSTGRES_DSN:
  ${EXECUTION_POSTGRES_DSN:-}`. The service's existing `depends_on:
  postgres: service_healthy` already orders the database; migrations are
  the migrate job's (they belong to the API's schema, and nothing else
  owns engine DDL).
* `requirements.txt` pins `asyncpg==0.29.0`, same pin as the trading
  engine (one upgrade sweep rule).

## 9. Test law (and its honest limits)

Three layers, all deterministic in-repo:

1. **`test_part13_postgres_store.py`** - statement-shape golden pins
   (reservation insert targets NO conflict clause; upsert assigns
   everything but the composite key; fill insert rides the unique index;
   the journal is append-only UPDATE/DELETE-free; child JSON is
   COALESCE'd and seq-ordered; the terminal-status array is IMPORTED from
   the shared enum, sorted for parameter determinism, never retyped;
   character-for-character the Node contract; every
   constant parses with sqlglot's postgres dialect) plus the
   reference-semantics mirror against a scripted connection, plus a full
   codec round-trip through an ECHO connection that captures INSERT
   parameters and answers the matching SELECTs from them (so column order,
   null spelling and scale survive the same values twice), plus
   strictness-divergence pins (unique violation propagates; the failed
   transaction rolls back), and the tenant-refusal-before-connection law.
2. **`test_part13_drift_parity.py`** - the cross-artifact trap: store SQL
   literals vs the migration's declared columns (both directions), vs the
   Prisma model's effective column set (exact set equality), the three
   constraints the semantics RIDE (client-id unique, fill-id unique,
   composite FK), and the width laws vs the wire validators.
3. **`test_part13_postgres_store_live.py`** - the real-database suite,
   SKIPPING by name unless `EXECUTION_TEST_POSTGRES_DSN` is provided:
   it applies the actual migration file, round-trips every port method,
   and SIMULATES ENABLEMENT: creates the tenant policies + ENABLE + FORCE
   on the three tables, then asserts the store's queries still return
   their tenant's rows (because of the GUC law), while a raw query on the
   same connection with no GUC sees ZERO rows and tenant A with its GUC
   cannot reach tenant B's row. That is the whole RLS argument, executed.

Limits, stated plainly: the sandbox where this part shipped has no
Postgres server (apt locked, no root), so layer 3 was verified to SKIP
correctly, not run; the SQL was verified with a real parser and exact
echo-round-trip fakes instead. The live file runs on the CI database with
the env var set, and Section 4's claims that depend on real query
behaviour (child JSON ordering, ON CONFLICT outcomes, policy interaction)
have no assertions anywhere else pretending they were executed here.

## 10. Operator runbook (durability on, in four moves)

1. Run the migrate job (applies
   `20260914120000_part13_execution_store` alongside the rest).
2. Set `EXECUTION_STORE_BACKEND=postgres` and `EXECUTION_POSTGRES_DSN` in
   the root env (a role with the same grants the API role has; no GRANT
   statements ship in the migration, matching the platform's existing
   single-role topology - a split-role deployment grants the three
   `engine_*` tables like every other table).
3. Restart the engine; if the tables are missing it REFUSES to start and
   says which ones. Verify `GET /health/ready` reports
   `storeBackend: "postgres", storeDurable: true` - the flag combination
   the worker's gate now accepts (Section 6).
4. Rolling restart with the backend on: commands in flight during the
   restart window are retried by the worker against the durable store -
   Section 6 is the contract that makes this boring.

To go back: unset both variables (memory + no DSN validates; memory +
lingering DSN does not). Old engine rows stay in the tables - nothing in
this part deletes anything, ever.

## 11. Decisions ledger

| Decision | Choice | Why not the alternative |
| --- | --- | --- |
| Where the adapter lives | service, not core | core is a pure library by law; the port's docstring pre-decided this |
| Projection | state tables, read-as-queried | an event-projection would add a fold with no benefit; the tables ARE durable state |
| Decimals | text | NUMERIC rescales; the record must equal the domain's derivation byte-scale |
| Enums | VARCHAR + codec | no mirrored CREATE TYPE to drift |
| Child ordering | `seq` | timestamp ties are the norm mid-tick |
| `save_order` on foreign client id | unique violation | silent keep-first is a foot-gun only memory can afford |
| Reservation recon state | UNKNOWN at reserve | durable stores must answer the crash question honestly |
| Cross-tenant sweep | raise `CrossTenantSweepUnsupported` | empty-list under RLS is a lie; per-account is the supported shape |
| Worker gate | accept coherent durable claims, refuse incoherent ones | the tripwire's condition was the re-review; it passed with the reservation mechanism as the reason |
| Backend default | memory | durability is opt-in; defaults that grab databases are how outages get made |
| `postgres` failure handling | startup refusal only, never fallback | a half-durable engine is the exact "false durability" this platform bans |
| Driver location | `app/pg_store.py` only | testability + one seam for driver changes |
| Tenant uuid check | store-side, pre-connection | self-explaining refusal beats a driver cast error at 3am |

## 12. Cross-references

* Port + reference implementation: `libs/trading-core/wlct_trading/
  execution/store.py` (unchanged in this part - the contract that made
  this addable without touching the engine's core).
* Ack policy + the retired tripwire: `docs/PART11_WORKER_SCALING.md`
  §13 items and the startup-gate paragraph (amended with the RESOLVED
  marker, in the Part 12 convention).
* RLS machinery: `docs/PART11_WORKER_SCALING.md` §16 for the policies, and
  `docs/PART15_RLS_ENABLEMENT.md` for the enablement checklist that now covers the
  engine tables via the 41-cover regeneration. (Both names amended 2026-09-19: the
  Part 11 document that shipped the policies is the worker-scaling one, and the
  checklist moved to Part 15 when enablement became an audited surface, so the single
  reference this bullet carried had been pointing at a file never written.)
* SECURITY: the two amended bullets (engine store no longer "process-local
  by design" in postgres mode; live refusal now names only the missing
  prerequisites).
* ROADMAP: part row 13; open-list entry "durable execution-engine store"
  retired.

## 13. Open items this part closes and leaves

CLOSED: "durable execution-engine store wiring (Part 11 refuses live mode
until it exists)" - the store ships and the worker gate condition is
resolved. PARTIAL against the live-mode prerequisite list: durability yes,
credential provider + authenticated order-placement review still no **as this
document was written**, and live still refuses at startup (Section 1). Part 16
wired that pair - the credential source is configuration with its own boot
refusals and the review is the engine's eleventh safety gate - and the four
prerequisites live mode still lacks are listed in
[`PART16_PLACEMENT_REVIEW.md`](PART16_PLACEMENT_REVIEW.md) sec. 8.

Still open after this part (unchanged provenance): RLS enablement FLIP in
staging per checklist; `--due` scheduler wiring; time-series retention;
the full chaos/failover matrix on real infrastructure; the leader-gated
singleton job (item 2 above - Part 13 added no sweep to gate).

PART 14 AMENDMENT: the unbounded growth of `engine_order_events` that this
part shipped - implicit in section 2's journal design, unnamed in the list
above - is answered by Part 14 (docs/PART14_RETENTION.md): the journal is
the single prunable table, orders/fills/ledger are not, and the ledger
records every run. "Time-series retention" in the list above MEANS the
metrics plane (time-series storage behind the Prometheus exposition,
Part 9's open item) and stays open; engine journal retention and metrics
retention are different tables with different parts, and deployments
should not read either document as answering the other.
