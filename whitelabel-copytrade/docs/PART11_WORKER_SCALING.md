# Part 11 - Scale & coordination: worker plane, partitioning, read replicas

> **Honesty header.** Nothing in this part makes the platform "horizontally
> scalable" in the marketing sense; it makes the WORKER PLANE coordinated, the
> execution boundary enforced, and the read policy fail-closed. Live venue
> transmission remains refused by code (Section 9), durable engine storage
> remains Part 12 (it ultimately SHIPPED IN PART 13 -
> docs/PART13_DURABLE_STORE.md; the §13 item below carries the resolution),
> and every deferral is listed in Section 13 rather than hidden. Gates in
> Section 14 are exactly what was run, including what was not run and why.

## 1. What this part is

Part 11 delivers the coordination foundation and the first real consumer of
it: a trading-worker plane split into three roles that were previously only
described in documentation.

```
NestJS API                    Node worker process              Python execution engine
apps/api (HTTP)      ──►      apps/api dist/worker.js   ──►   services/execution-engine
enqueues TRADE_EXECUTION      validates, admits by claim,     executes against the
jobs (unchanged producers)    forwards, ack-policing          REAL core: wlct_trading
                                                              .execution.ExecutionEngine,
                                                              adapters, locks, store,
                                                              incidents, reconciliation
```

The API gained nothing and changed nothing in its producers (Section 6);
the worker holds no venue authority; the engine holds no queue and serves no
browser. This is the Part 5 boundary ("the API has no signing code and no
credential provider - those live in the trading worker") finally populated:
the worker exists, and the credentials-domain it was promised lives in ONE
process with an internal-token gate around it.

Three deliverable layers:

1. **Coordination primitives** (both languages, fixture-pinned): rendezvous
   partitioning, lease renewal law, `LeaderElector`, `PartitionClaims` with
   the compare-and-extend/renew/release Lua scripts, key builders, verbatim
   cross-language error messages, CRC32 vector table. Foundation first,
   runtime second - every runtime behaviour below rides on that shared,
   tested law rather than inventing its own.
2. **The worker runtime**: partition-gated `TRADE_EXECUTION` consumer with
   deferral accounting, engine forwarding with a strict failure taxonomy,
   graceful shutdown, deterministic-identity claims, read-only ops surface.
3. **The execution engine service**: `services/execution-engine`, a FastAPI
   process composing the CORE `ExecutionEngine` with paper adapters,
   serving the four commands the queue actually carries, refusing the fifth
   honestly, and refusing `live` at startup by code.

Plus: the read-replica policy layer (pure, table-tested, fail-closed),
observe-only chaos invariants on the money path, the config/env surface, and
compose services for `worker` and `execution-engine`.

## 2. The queue-consumer inventory (step 15)

Produced/consumed status as actually found in the repository - this table is
the scoping evidence for "consumers only where contracts exist":

| Queue | Producers (found) | Consumers before | Status after Part 11 |
|---|---|---|---|
| `audit` | audit service (fire-and-forget `enqueue`) | none in-repo (Prisma direct path is authoritative; queue is the relay) | unchanged - out of Part 11 scope |
| `email`, `notification` | notifications module | `NotificationProcessor` (`@Processor`, concurrency 10) | unchanged |
| `security`, `billing` | registered; producers land with their parts | none | unchanged (no producer = no contract to consume) |
| `maintenance` | `MaintenanceScheduler` repeatables | `MaintenanceProcessor` (inline-gated) | unchanged |
| `trade-signal` | **none in Node** (comment: "consumed by the trading engine from Part 3" - the engine's signal pipeline is Redis-stream based, `wlct:trading:events`, NOT BullMQ) | none | **deliberately still none** - implementing a BullMQ consumer for it would invent semantics for an empty queue (step 15 forbids exactly that) |
| `trade-execution` | `ExecutionCommandsService` (4 account commands, `jobId = command:accountId`, attempts 3), `ExecutionOrdersService` (`cancel-order`, `jobId = cancel-order:orderId`) | **none - the worker did not exist** | **implemented here**: `TradeExecutionProcessor` (Section 5) |
| `market-snapshot` | none in Node | none | unchanged - same reasoning as `trade-signal` |
| `strategy-control` | backtest/paper/instances services | none in-repo (executed via the engine's HTTP backtest surface + inline paths) | unchanged - its consumer is the strategy pipeline, not this part's admission law; documented as a known open plane in Section 13 |
| `dataset-control` | ingestion/lifecycle services | none in-repo (same pattern) | unchanged, same reasoning |
| `risk-control` | policy/protection services (publish-after-commit with compensation) | none in Node - the Python engine consumes published policy digests through its own loader | unchanged - the enqueue-with-compensation contract already guarantees its semantics |

The inventory rule applied throughout: **a consumer is implemented only
where the queue has a producer, a payload contract, and an execution core
that can honor it.** `TRADE_EXECUTION` is the only queue satisfying all
three; it is also the only one whose absence of a consumer was a named
liability in the delivery docs ("the only process that holds venue
credentials" - a process that did not exist).

## 3. Ownership: what claims decide, what config suggests

The law, stated once (worker-coordination.service.ts header carries the same
text):

* `WORKER_MEMBERSHIP` (config) computes **who wants** what: the rendezvous
  assignment `partitionOwner(members, p)` is deterministic, order-insensitive
  and fixture-pinned in both languages.
* Redis **claims** decide **who has**: a worker may act on partition `p`
  only while its own claim on `wlct:trading:lock:partition:<group>:<p>`
  exists and is held by it. Claims make a stale/mistaken membership list
  harmless: the wrong holder fails to claim and defers; it never executes.
* Routing key per job: `partitionFor("<tenantId>:<accountId>", WORKER_PARTITION_COUNT)`
  - the exact composition the Python side hashes (fixture vectors pin both
  languages against the same rows). One account always maps to one partition,
  which is what makes CROSS-PROCESS account serialization structural rather
  than lock-dependent.

The lease-honesty paragraph (foundation, canonical answer, repeated here
because it governs the runtime): **exactly-once PROCESSING is not claimed.
A lease guarantees at-most-one-holder between renewal clocks; duplicates
become harmless through idempotency at the effect layer** - BullMQ
deterministic `jobId` dedupe at admission, compare-and-set state machines at
the engine (a second `cancel` of a cancelled order is refused by
`ILLEGAL_STATE_TRANSITION`, not executed twice), and tenant-scoped keys
everywhere. That stack, not the lock, is what makes duplicate-safe
processing true.

## 4. The renewal law (both languages, fixture-pinned)

`renew_due_micros` / `renewDueMicros`:

| Arm | Rule |
|---|---|
| boundary | due when `elapsed_micros >= renew_millis * 1000` (exactly one interval of inactivity IS due) |
| zero/negative/non-integer interval | construction error: "renew intervals must be plain integer milliseconds >= 1" (never-stop configs die at boot) |
| non-integer micros input | error (Python: "…plain integer of microseconds"; TS: TypeError - message text not cross-pinned for the bigint-coercion row, documented in the spec) |
| backward clock step | **due, not an error** - an NTP correction must never lull a holder into skipping a renewal; timing hiccups must not become coordination outages |
| huge elapsed | due (no wraparound: bigint micros both sides) |

`LeaderElector` half-TTL rule (`ttl >= 1000`, `renew >= 250`, refusal when
`renew * 2 >= ttl`, defaults 30000 / ttl//3 / max(250, ttl//8)),
`renew_if_due` between batches, and the demotions metric law
(forced step-downs only - a voluntary `resign()` is a transition, not a
demotion) all ship tested; the elector is wired into the foundation and
exercised by both suites. **No singleton background job claimed a leader in
this part** - Section 13 lists why inventing one would violate the part's
own rule against fake functionality.

## 5. The TRADE_EXECUTION consumer (step 17)

Pipeline per job, in strict order (trade-execution.processor.ts):

1. **Validate** against the mirrored producer contract (worker.types.ts).
   Unknown job names and malformed payloads are `UnrecoverableError`:
   retrying a shape that can never succeed wastes the attempt budget and
   hides the real failure.
2. **Partition**: `partitionFor(tenant:account)` - pure, synchronous.
3. **Admit**: `coordination.holds(partition)` - synchronous verdict from the
   last reconcile tick; staleness (older than 2x the tick cadence, or no
   tick ever completed) answers `false`. The job path NEVER awaits Redis.
   Not admitted -> defer (below). Coordination failure therefore slows and
   visibly defers the pipeline; it cannot accelerate it.
4. **Serialize per account within the process** (in-flight set; a second
   job for the same account defers rather than interleaving). Cross-process
   contention is structurally partition-owned; inside the engine, the core's
   per-order locks run underneath. A fourth lock layer here would guard
   nothing and cost a Redis RTT per job.
5. **Forward** via `EngineInternalClient`: token + tenant + correlation
   headers; 30s hop timeout; no second retry loop (BullMQ owns retries -
   stacking them multiplies load into a degraded venue).
6. **Ack policy** - the boundary where "success" is earned:

| Engine answer | Classification | Job outcome |
|---|---|---|
| 200 (any business verdict in body: ACCEPTED, REJECTED_LOCALLY, DRY_RUN, DUPLICATE...) | durably answered | **completed** - a confident answer about a job is what completion means |
| 401/403 (wiring/config), 404 (no such record), 409 (identity mismatch), 422 (contract violation), 501 (unwired command) | terminal | **failed visibly** with the engine's code+reason (truncated to 256 chars) |
| 5xx, timeout, transport | retryable | **throws** - BullMQ re-delivers within the producer's attempts (3) |
| not the partition owner | routing fact | **deferred**: `moveToDelayed(WORKER_DEFER_DELAY_MS)` - not completed, not failed, no attempt consumed |

7. **Defer accounting**: each deferral increments `job.updateProgress({defers})`
   and the bounded `wlct_worker_deferred_jobs_total{queue="trade-execution"}`
   counter. At `WORKER_MAX_DEFERS` consecutive deferrals the job fails
   with "partition not claimable after N deferrals" - a permanently homeless
   job must page somebody, not orbit forever. (Deferrals cannot use the
   attempt budget: churning ownership is not worker error, and mixing the
   two makes a rebalance look like a crash loop.)
8. **SLO reuse**: `completed`/`failed` fold into the SAME `queueproc`
   counters the maintenance worker feeds (one law, all queues, zero new
   plumbing), and every job runs inside the Part 10 `'queue.process'`
   traced context with the publisher's correlation restored from the
   sidecar.

## 6. Producer contract (unchanged by this part - recorded for the reader)

`ExecutionCommandsService` (all four): `{tenantId, accountId,
requestedByUserId, requestedAt}`, `jobId = "<command>:<accountId>"`,
`attempts: 3`, `enqueueOrThrow` (a 202 that never had a job behind it is a
lie; a 503 is the truth). `ExecutionOrdersService.requestCancel`: adds
`{orderId, clientOrderId, symbol}`, `jobId = "cancel-order:<orderId>"`,
same attempts. Deterministic jobIds ARE the admission-side idempotency:
two operators clicking the same button produce one job; the consumer's
validation is the mirror of exactly these shapes, no wider.

## 7. The execution engine service (steps 17.4-17.10, honestly scoped)

`services/execution-engine` (FastAPI, internal-only, token + tenant header
on every command route):

* `POST /internal/v1/accounts/verify-credentials` -> the core
  `PaperAccountAdapter.verify_credentials` truth (always labelled
  simulated - the ONLY correct answer a simulated venue may give).
* `POST /internal/v1/accounts/refresh-balances` -> configured simulated
  balances, decimal-as-string, labelled simulated.
* `POST /internal/v1/accounts/reconcile` -> the core `ReconciliationService`
  report (orders checked, discrepancies with repaired flags, bounded views).
* `POST /internal/v1/orders/cancel` -> the core `ExecutionEngine.cancel`:
  the REAL engine with its reconciliation-state gate (UNKNOWN order state
  refuses cancellation with `RECONCILIATION_REQUIRED`), its terminal-status
  refusal, its result-unknown incident path, its per-order lock. Not found
  in this runtime's store -> 404 `ORDER_NOT_FOUND` (refusing to fabricate a
  verdict about an order it cannot see). Identity mismatch -> 409.
* `POST /internal/v1/accounts/resync-private-stream` -> **501 NOT_SUPPORTED**.
  A private-stream resync is a live-venue interaction; pretending to accept
  it in a simulated build would convert the API's honest 202 into a lie
  three hops later. The failure is visible, dated, and self-explaining.
* `GET /internal/v1/status` -> the wiring document (mode, adapter, store,
  `storeDurable: false`, `locksDistributed: false`, supported commands). The
  worker asserts this at startup and REFUSES to run against a mode it was not
  built to serve - including refusing to run against a DURABLE engine store
  until this file's ack policy is re-reviewed (the tripwire is live, not
  rhetorical). RESOLVED IN PART 13: the re-review happened, the gate now
  ACCEPTS a durable engine whose claim is coherent (`storeDurable: true`
  requires `storeBackend: "postgres"`; an incoherent claim still refuses) -
  see docs/PART13_DURABLE_STORE.md §6 for the policy text and why
  at-least-once retries are safe against the reservation + fill-dedupe
  constraints. PART 20 MEASURES THE PARAGRAPH ABOVE AND ADDS ONE LAW: this is
  the only internal route read under a token-only scope
  (`require_internal_auth_readonly`), because a process-level read has no tenant to
  name - `src/worker.ts:69` sends token + correlation and nothing else. Until then the
  read demanded a tenant header its single caller could not send, the 400 was classed
  retryable, and the reference worker logged "execution engine gate failed" and exited
  1. The command routes above keep token + tenant, refusal text unchanged to the byte.

What the engine does NOT do: no order-submission route (no producer sends
one; consumers must not grow capabilities their inputs never carry), no
database (the in-memory stores are simulated-mode-appropriate by the core's
own wiring law, and /health/ready says `storeDurable: false` instead of
hiding it; PART 13 SUPERSEDES THE CAPABILITY, NOT THE LAW - a postgres
backend exists and is opt-in, the memory default still reports
`storeDurable: false` exactly as written here, and no mode ever reported
durability it did not have), no public exposure (bound per-deployment,
compose keeps it on the internal network; tokens constant-time compared;
422 bodies name fields,
never values; `EXECUTION_MODE=live` raises at startup - code, not default).

## 8. Read-replica policy (steps 22-23)

`infrastructure/database/read-policy.ts` - one pure function, every arm
table-tested, and the composition helper in PrismaService
(`routeRead({readClass, onPrimary, onReplica, onDecision?})`):

* A read may use the replica only when ALL of: policy enabled, client
  configured, probe healthy, lag known and fresh (10s trust window -
  a stale probe sample is `null` lag, not a small one), `lag <= maxLagMs`,
  and the read classified `operational`/`analytical`. Anything else:
  primary.
* **Unclassified = execution-critical = primary.** Forgetting to classify
  routes safe by default, which is the correct outcome of forgetting.
* `DATABASE_READ_MAX_LAG_MS=0` means "have a replica, refuse to read it at
  any lag", not "any lag is fine".
* Replica-path failures are NOT retried on the primary: a read erroring on
  a dying replica is information; silently re-firing converts one sick
  replica into two overloaded databases during the incident that justified
  the policy.
* Prisma was NOT blanket-rewired - this is the policy layer the roadmap
  asked for; each repository read is an explicit, classified opt-in decided
  by its owner, and the counter (`wlct_read_routing_decisions_total`,
  bounded `result` labels: primary | replica | stale_fallback) makes
  silent-staleness-pinning visible instead of folklore.

## 9. Live money boundary

The platform-wide rule, unweakened here: live execution requires explicit
config + safety controls, and this part SHIPS LESS than that. The engine
refuses `EXECUTION_MODE=live` at startup with a message that enumerates
prerequisites. As this part shipped, that list was "credential provider, durable
store, distributed locks"; Parts 13 and 16 closed the last two and made the first
configuration rather than absence, so the sentence now names what genuinely
remains - no venue trading adapter is constructed by this service, no signed
transport is wired here, and no runbook exists for the enablement evidence a live
account must present ([`PART16_PLACEMENT_REVIEW.md`](PART16_PLACEMENT_REVIEW.md)
sec. 8). The refusal itself is unchanged and is asserted by name, not by
substring. The worker
refuses to boot against any engine not reporting `simulated`. No route,
env value, or queue payload can bypass either refusal; the specs assert the
refusals themselves.

## 10. Worker lifecycle (step 16)

`src/worker.ts` -> `NestFactory.createApplicationContext(WorkerModule)`:
no HTTP server exists to disable because none is created ("no public admin
or order-approval routes" satisfied structurally, not by flag).

Boot order: config validated (the shared schema refuses nonsense) ->
`WORKER_ENABLED=false` EXITS 1 with a reason (a silently-idle worker is an
outage with extra steps) -> engine-compatibility gate (Part 20: the status document is
parsed against a mirrored contract, so an engine answering with something that is not the
contract fails this step terminally, naming the key, instead of the gate judging defaults
the reader invented; the same parsed object is what the ops panel renders) -> module init starts
the claim tick (first tick immediate: waiting one full interval while jobs
arrive is choosing the defer path) -> consume.

Shutdown (SIGTERM/SIGINT): BullMQ workers close (no new jobs; in-flight
finish), held claims release (next owner does not wait a TTL), connections
close - bounded by `WORKER_SHUTDOWN_TIMEOUT_MS`, past which process exit
stands on the lease TTL: unacked jobs redeliver (at-least-once), claims
expire. The degraded path is exactly the crash path, which is why the
forced exit is a WARN, not a panic. `tick()` joins an in-flight reconcile
rather than returning a verdict that has not been written yet (this one was
found by the specs; the semantics fix is in the service).

## 11. Configuration surface (step 27)

| Var | Default | Read by | Notes |
|---|---|---|---|
| `WORKER_ENABLED` | true | worker | false = exit-with-reason, never idle |
| `WORKER_ID` | `host:pid:rand` | worker | must match the member grammar (1..128, `[A-Za-z0-9._:-]`) - PartitionClaims refuses at construction otherwise |
| `WORKER_MEMBERSHIP` | empty (=self) | worker (+API ops view) | THE coordinated list; identical on all replicas |
| `WORKER_PARTITION_COUNT` | 8 | worker (+API ops view) | 1..4096 (fixture ceiling); changing it rescales everyone at once |
| `WORKER_PARTITION_LEASE_TTL_MS` | 15000 | worker, ops view | >= 1000 (jitter law) |
| `WORKER_PARTITION_RETRY_MS` | 2500 | worker | >= 250 (busy-loop law) |
| `WORKER_DEFER_DELAY_MS` | 3000 | worker | >= 250 and >= retry cadence (schema cross-law - the defaults were caught violating it by the safety specs and fixed) |
| `WORKER_MAX_DEFERS` | 30 | worker | the homeless-job ceiling |
| `WORKER_SHUTDOWN_TIMEOUT_MS` | 10000 | worker | drain budget |
| `EXECUTION_ENGINE_URL` | `http://127.0.0.1:8093` | worker | http(s) enforced at client construction |
| `EXECUTION_ENGINE_TOKEN` | (none) | worker | >= 32; REQUIRED for the worker (boot refusal), never read by the API |
| `DATABASE_READ_ENABLED` | false | PrismaService | half-config (URL w/o flag or vice versa) is a BOOT ERROR |
| `DATABASE_READ_URL` | (none) | PrismaService | replica connection; never logged |
| `DATABASE_READ_MAX_LAG_MS` | 1500 | policy | 0 = primary-only while configured |
| Engine side (`EXECUTION_*`) | see service .env.example | execution-engine | `EXECUTION_INTERNAL_TOKEN` REQUIRED, placeholder-prefixed values refused |

No secrets in code anywhere in the part; the compose maps ONE
`EXECUTION_INTERNAL_TOKEN` from `.env` onto both sides (engine validates it,
worker presents it under the name `EXECUTION_ENGINE_TOKEN`).

## 12. Observability & chaos invariants (steps 23-25)

Three bounded metric families added (labels ride the CLOSED Part 9 universe -
`result`, bounded at registration; the ops source-scan law in
`observability-safety.spec.ts` was honored, not worked around):
`wlct_worker_deferred_jobs_total{queue}`,
`wlct_worker_coordination_events_total{result}` (claim_gained | claim_lost |
reconcile_failed | released), `wlct_read_routing_decisions_total{result}`.
Queue completion/failure law reuses `queueproc` unchanged.

Chaos-invariant evidence (each names the arm it pins):
* transport down mid-claim -> claims become misses -> every job defers, no
  evictions, no double-holders (worker.spec)
* reconcile input explodes -> last verdict kept until it AGES past trust,
  then fail-closed `false` (worker.spec)
* engine 503 vs 401 vs 422 vs 501 -> retry vs terminal taxonomy (worker.spec)
* deferral ceiling -> visible failure, no orbit (worker.spec)
* duplicate-ack impossibility -> `moveToDelayed` result is `{deferred:true}`,
  never a trading-meaning completion (worker.spec + processor contract)
* publisher/tracer wired, absent, or FULLY EXPLODING -> cancel verdict,
  store state, event list, and incident count identical (core:
  test_part11_observe_only.py, on the REAL composed engine + paper adapter;
  the exploding-tracer case doubles as the tripwire against anyone moving a
  raw tracer call onto a money-path branch)
* fault injection (Part 10) unchanged and still production-refused; the
  worker process never registers the injection surface at all.

## 13. Known limits and deferrals (the honest list)

1. ~~**Membership is config, not self-registering.**~~ **RESOLVED IN
   PART 12** (docs/PART12_WORKER_MEMBERSHIP.md): the heartbeat-zset registry
   is now the default-on-compose source of membership, the config list
   demoted to its documented fallback, and the law this section was written
   to protect is untouched - membership says who WANTS, claims decide who
   HAS. The deferral had one good reason: a key format must not ship before
   something needs it; Part 12 is that something, and `RedisKeys` grew
   exactly one builder (`membership_registry`).
2. **No leader-gated singleton in the worker.** The elector and its renewal
   law ship complete and tested, but the repo has no reconciliation-sweep or
   similar leader job to gate yet; inventing one to demo the feature is
   exactly the fake functionality this platform prohibits. `resync-private-stream`
   likewise stays 501 until a live adapter exists.
3. ~~**The engine's in-memory store means cancel outcomes are
   per-process.**~~ **RESOLVED IN PART 13** (docs/PART13_DURABLE_STORE.md):
   `PostgresOrderStore` ships behind `EXECUTION_STORE_BACKEND=postgres`
   (memory remains the default, and the in-memory mode's truthful
   `ORDER_NOT_FOUND`-after-restart behaviour documented here is exactly
   what that default still does), the schema joined Prisma with RLS
   coverage auto-extended to the three new tables, and the worker's
   compatibility gate was re-reviewed against the ack policy - Section 6
   of the Part 13 doc records the reasoning (reservation idempotency and
   fill dedupe make the at-least-once retries safe BECAUSE of the durable
   store, which is the condition the tripwire existed to have noticed).
4. **Time-series retention** (the market-data storage backlog item)
   remains open - Part 12 took the two coordination/DR items below and no
   more. Row-level security and the DR/backup manifest DID ship here
   (Sections 16 and 17); the RLS enablement FLIP stays checklist-gated
   deployment work, and backup-cadence AUTOMATION got its MECHANISM in
   Part 12 (`--due` grading with an alertable exit code, the
   backup-ledger.jsonl evidence trail - docs/PART12_WORKER_MEMBERSHIP.md
   sec. 8) while the scheduler WIRING stays deployment-side, listed in the
   ROADMAP open items rather than half-implemented to claim it.
5. **Repository read rewiring** (Section 8): deliberately not blanket.
6. **No `trade-signal`/`market-snapshot` consumers**: producer-less queues;
   the engine plane consumes their streams, not BullMQ jobs.

## 14. Gate ledger (generated 2026-09-13)

* `cd libs/trading-core && python3 -m pytest tests -q` -> **1324 passed**
  (1320 foundation + the 4 observe-only invariants); `ruff check wlct_trading
  tests` -> clean; `mypy wlct_trading` -> **clean, 142 files**.
* `cd apps/api && npx jest --silent` -> **354 passed / 15 suites**
  (309 pre-runtime + 21 worker + 11 read-policy + 5 ops-view + 8
  RLS-coverage); `npx tsc --noEmit` -> **0 errors**;
  `npx eslint src --max-warnings=0` -> clean; `npx prisma validate` ->
  valid; `npm run build` -> emits `dist/worker.js` (compose command target).
* `cd services/execution-engine` -> `pytest tests -q` **20 passed**;
  `ruff check app tests` -> **clean**; `mypy app` -> **clean, 10 files**
  (one documented pyproject-level per-file relaxation: the stub-less
  pythonjsonlogger base class - every other strict rule applies to that
  file and all others unchanged; no inline suppressions anywhere).
* RLS artefacts: `python3 scripts/gen_part11_rls.py` rerun over the shipped
  files -> all four **byte-identical** (generation determinism is a
  property, not an assumption); `rls-coverage.spec.ts` (8 tests) re-derives
  the tenant-table set from `schema.prisma` itself and pins the covered/
  excluded split, the GUC-name cross-reference and the no-destructive-
  statements rule.
* DR tooling: `node --test scripts/` -> **15 passed / 0 failed**; `node
  scripts/dr-manifest.mjs --check` -> valid (5 components, RPO 60m / RTO
  4h, 90-day timed drill); `--plan` byte-deterministic across runs and
  credential-free by scan.
* Root `.env.example` parses through `validateEnv` with every Part-11
  default resolved (`WORKER_*` sane, replica pair off); the schema
  cross-laws refuse the known-bad shapes.
* `docker-compose.yml` parses; `worker` and `execution-engine` expose no
  ports; YAML anchors/health dependencies validated by the compose loader.
* NOT run here, stated plainly: the compose stack itself (no Docker in this
  sandbox), real Redis/Postgres integration (coordination runs against the
  faithful claim-server fake; PrismaService replica paths against
  configured stubs; the RLS POLICY behaviour against live Postgres is the
  enablement-checklist probes in `docs/DR.md` - no PostgreSQL is installable
  in this sandbox, and the generated SQL + spec pins are what ships in
  exchange), and the engine against a live venue (no live wiring exists). The Part 10 requirement "run the complete chaos/failover matrix"
  is satisfied at the level the sandbox allows (fault-mode matrices in-unit);
  a staging run remains a deployment step, listed in the runbook below.

## 16. Row-level security (the defence layer under the defence layer)

The application already refuses cross-tenant queries two ways (explicit
`tenantId` predicates in services; the `$extends` factory that injects them
again). Both are application code, and application code is what this layer
guards against: a new path that never went through either. The database
itself now refuses the row (`docs/MULTI_TENANCY.md` carries the full design;
the summary lives here because it is part of this delivery):

* **Generated coverage:** `scripts/gen_part11_rls.py` reads the schema and
  emits one `tenant_isolation` policy for every non-null-`tenantId` table
  (38 today), the GUC-reading `wlct_current_tenant_id()` function, an
  enablement script pairing every `ENABLE` with `FORCE` (the app role owns
  the tables in this deployment - without FORCE the policies decorate
  nothing), the exact-inverse disable script, and the coverage JSON.
* **Drift is a test failure, not a wiki reminder:** `rls-coverage.spec.ts`
  re-derives the same sets from `schema.prisma` at test time; a tenant model
  added without rerunning the generator turns the suite red with the table
  named. The nullable-`tenantId` exclusions (7 tables) are equally pinned -
  a decision with a rationale, never an omission.
* **The app-side seam:** `PrismaService.withTenantRls(tenantId, work)` -
  UUID-validated, bind-parametered, `SET LOCAL`-scoped, transaction-first.
  Safe to adopt path-by-path precisely because the policies stay dormant
  until the DBA flip; adoption and enablement are decoupled on purpose, and
  the schema cross-law (defer >= renewal cadence) is the same discipline in
  a different coat: the validator catches the pair-mistake, not the outage.
* **Fail-closed at every arm:** no GUC, `NULL`; `tenant_id = NULL` is never
  true; an unscoped read sees zero rows, an unscoped write is refused. The
  generator REFUSES to emit when the covered-table parse yields an
  implausibly small set, and refuses non-uuid tenant columns outright rather
  than guessing a cast.

## 17. DR/backup manifest tooling (the contract before the automation)

`docs/dr/manifest.json` is the platform's disaster-recovery plan as data:
five components - `encryption-keys` restoring before `postgres` (the
validator REFUSES the inversion: ciphertext without keys is not a degraded
system, it is a deleted one) - each with backup method, verification string,
env-KEY references and repository paths; plus the ordered restore
procedure, the timed-drill success criteria, and three rules the file
reasons from (keys before data; Redis rebuilt, not restored; timed or it
didn't happen).

`scripts/dr-manifest.mjs` keeps it honest, mechanically:

* `--check` (CI-grade): every referenced path must EXIST in the repository,
  every env ref must appear in one of the five `.env.example` templates,
  restore orders must form contiguous 1..n, required components must be
  present, cadence fields must be coherent, and a secret-shaped scan refuses
  PEM material, `user:pass@host` URLs or literal `KEY=secret` values - a
  backup plan in git that contains a real credential is the worst possible
  outcome of diligent documentation.
* `--plan` renders the operator runbook as a dry run: deterministic (no
  clock), `$ENV` references never resolved here, commands to be executed by
  a human who has the manifest's invariants on screen.
* `docs/DR.md` is the human half: post-restore probe SQL (the RLS probes
  double as the enablement verification) and the drill-record template a
  rehearsal must fill in to count as one.

Deliberately absent: a backup scheduler. Automating against an unvalidated
plan is how platforms confidently preserve the wrong bytes; the manifest is
the contract the scheduler will be written against, and its absence from
today's runtime is stated in SECURITY.md's gaps rather than glossed.

## 18. Runbook

Bring up the plane (post-Part-11 dev):

```bash
# 1. engine
cd services/execution-engine
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
EXECUTION_INSTANCE_ID=exec-local EXECUTION_INTERNAL_TOKEN=$(openssl rand -hex 32) \
  # `--factory` because app.main exposes create_app and deliberately no module-level
  # app - the target this line used to name (app.main:app) resolves to nothing, which
  # Part 18 found and fixed in the images; docs/PART18_METRICS_EXPOSITION.md sec. 6.1.
  .venv/bin/uvicorn --factory app.main:create_app --port 8093
# 2. worker (repo root, packages built)
cd apps/api && npm run build && npm run worker
#    (or: npm run worker:dev)
# 3. API consumes/verifies as before; ops view:
#    GET /v1/observability/worker-coordination   (OPERATIONS_READ)
```

Scaling events:

* **Add a worker**: choose its `WORKER_ID`; set `WORKER_MEMBERSHIP` to the
  full new list on EVERY worker (and the API, for the ops view); restart the
  fleet. During rolling restart, non-owners defer and owners keep processing;
  no job is lost (deferrals are delays, not failures), in-flight work drains
  per the Section 10 sequence.
* **Kill a worker mid-batch**: claims expire within the lease TTL; the
  partitions move to the remaining members (rendezvous moves ONLY the dead
  member's partitions); unacked jobs redeliver by at-least-once.
* **Redis blip**: held sets age; verdicts fail closed to "not mine" ->
  deferral; claims that survive re-assert without eviction. Nothing needs an
  operator during the blip except the alert the deferral counter exists to
  raise.
* **Staging chaos run** (the not-runnable-here half): arm
  `FAILURE_INJECTION_ENABLED` (non-production only), kill -9 workers under
  load, promote/demote the replica, and assert the Section 12 invariants on
  real infrastructure before believing any of this in production. Part 21 put
  that sentence into machine-readable form:
  `python3 -m wlct_trading.observability.chaos --list` enumerates the ten
  scenarios (this section's four are among them) with their fault points,
  required infrastructure, expected invariant, observation, recovery, cleanup
  and timeout budget, and a run anywhere without the processes grades every one
  `UNVERIFIED` and exits 2 - it cannot award a pass it did not observe, which is
  the property that makes a staging `PASS` worth reading. See
  docs/PART21_DR_OPERATIONS.md sec. 5.
