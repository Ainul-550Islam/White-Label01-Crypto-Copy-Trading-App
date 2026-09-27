# Part 9 - Observability & Operations

> **The sentence this part is contractually required to keep saying, and that
> the UI, the l10n catalog and the config summary all also say:**
> **Risk controls reduce operational risk but cannot guarantee against all
> losses.**

Companion to Parts 1-8. Full source of every new and modified file:
`docs/PART9_HANDOVER_FULL_SOURCE.md` (generated; same "complete content, no
placeholders" standard as every previous part).

---

## 1. What existed before Part 9 (and what Part 9 therefore must NOT redo)

The platform already had, and Part 9 extends rather than competes with:

| Concern | Pre-existing owner | Part 9 relationship |
| --- | --- | --- |
| Latency/counter measurement | `wlct_trading/metrics.py` (Parts 2-8: `LatencyHistogram`, `ConnectivityMetrics`, `ExecutionMetrics`, `StrategyMetrics`, `DatasetMetrics`, `RiskMetrics`) - explicitly designed as "an in-process registry a collector scrapes on its own schedule" | The collector now exists: `wlct_trading.observability.metrics` renders those registries (via a new read-only `LatencyHistogram.snapshot_buckets()`) into Prometheus exposition; no measurement moved, none was cloned |
| Monotonic timing discipline | `wlct_trading/clock.py` (`monotonic_nanos`, `LatencySpan`, `StageTimer`) - "latency is always measured with the monotonic clock" | Pipeline stage timing (`PipelineSpan`) is built on the same primitives; a boundary test forbids any duration arithmetic from wall clocks in the new package |
| Health probes | NestJS terminus module (`/health`, `/health/ready`, `/health/deep`, `/health/startup`) with prisma/redis/queue/service indicators; FastAPI `/health` + `/health/ready` in both Python services | `/health` stays liveness (never touches a dependency), `/health/ready` stays control-plane readiness, `/health/trading` is NEW: the trading-readiness verdict, a distinct question with a distinct answer |
| Correlation | `RequestContextMiddleware` minting/validating `x-request-id` (UUID-or-mint); Python services echoing it; audit rows carrying `requestId` | Extended, not replaced: `x-correlation-id` added alongside (UUID-or-mint, same discipline); `correlationId`/`operationId` added as nullable audit columns; contextvars propagate across asyncio tasks and queue payloads |
| Secret redaction | `@wlct/utils` recursive `redact()` + `PINO_REDACT_PATHS` (Node); per-service `RedactionFilter` regex filters (Python) | The Python side now delegates to ONE redactor (`observability/redaction.py`) shared by services, metrics and incident payloads; the TS side gained the value patterns the fixture pins (DSNs, bearer tokens, signed queries, AWS keys) and the key substrings the Python predicate had |
| Queues + workers | BullMQ (Bull module, `QueueService.getDepths`, maintenance queue + repeatable scheduler + processor) | Two new repeatables on the SAME maintenance queue (`sync-operational-alerts` every minute, `prune-operational-history` nightly); `QueueDepth` gained `oldestWaitingAgeMs` |
| Audit | `AuditService.record/recordImmediate`, `@Audited` interceptor, retention pruning | Three new actions (`OPS_ALERT_ACKNOWLEDGED`, `OPS_ALERT_FORCE_RESOLVED`, `OPS_INCIDENT_STATUS_CHANGED`); correlation columns; nothing about the existing schema's meaning changed |
| Metrics exposition | main.ts already EXCLUDED `/metrics` from the global prefix and the pino autoLogging ignore list already silences it - the path was reserved by Parts 1-5 convention with nothing behind it | The reservation is now honoured: a real, policy-guarded, optionally-token-gated exposition endpoint |
| RBAC | `Permission.PLATFORM_READ_METRICS` existed with zero consumers | Left untouched (it means tenant-platform billing metrics reads in the original scope; operations reads got their own, clearer pair: `operations:read`, `operations:alerts_update`) |
| Mobile | Part 8 read-only risk viewer | Intentionally NOTHING. The spec forbids operational dashboards on mobile and the platform needs no account-level observability beyond Part 8's screen. Zero Dart files changed; the Part 8 Flutter verification status stands unchanged |

## 2. What Part 9 adds

A unified flow - application event → structured log (correlated, redacted) →
metrics (cardinality-guarded) → health state → alert rule → incident/audit
correlation - realized as:

* **Python**: one new package, `wlct_trading/observability/` (labels, metrics,
  health, readiness, correlation, alerts, incidents, redaction, dashboard);
  additive `snapshot_buckets()` on the existing histogram; additive ops keys
  in `redis_keys.py`.
* **Services**: `app/observability.py` hubs in both FastAPI services
  (registry + health + alerts + mirror loop), `/metrics` +
  `/health/components` on both, `/health/trading` on the engine, shared
  redaction + correlation log filter, poller observer hook, Dockerfiles now
  install the (zero-dependency) core library into the image.
* **API**: `infrastructure/metrics/metrics.registry.ts` (TS twin of the
  registry), a full `modules/observability/` (13 files) exposing
  `/v1/observability/*` + `/v1/observability/alerts*` + incidents, the
  `/metrics` endpoint behind `x-metrics-token`, `/health/trading` on the
  health controller, the HTTP metrics interceptor, the durable alert fold
  and its queue jobs.
* **Persistence (additive)**: `ops_alerts`, `ops_incidents`,
  `ops_incident_links` + four enums; two nullable correlation columns on
  `audit_logs`. **No metric samples are ever stored in PostgreSQL** - time
  series live in the exposition; Postgres stores operational *state*.
* **Admin**: one page (`/observability`) with gate table, service mirrors,
  alerts (the only two controls: acknowledge / typed force-resolve), queues,
  incidents.
* **Config**: 13 new validated environment keys with production enforcement;
  service-side settings; compose passes the mirror cadence through.

## 3. Metrics architecture

One registry per process, three standard types, Prometheus semantics and text
format (0.0.4) rendered deterministically (families sorted, series sorted by
canonical label text, cumulative `le` buckets + `+Inf` + `_sum`/`_count`).

* Python services register families at startup; `sample_process()` refreshes
  the five conservative process gauges (uptime, peak RSS, CPU seconds, open
  fds - `-1` where unobservable, fd limit); `render_health_metrics()`
  projects health snapshots into `wlct_component_health` /
  `..._age_seconds` gauges; `observe_latency_histogram()` folds the existing
  registries' histograms into exposition at scrape time; `PipelineSpan`
  stamps the eleven mandated observation points and records the declared
  monotonic-clock transitions into `wlct_pipeline_transition_micros{stage,
  simulation, exchange}`.
* The API's TS twin registry renders byte-identical text for byte-identical
  inputs (fixture-pinned: `docs/fixtures/observability_fixtures.json`,
  generated by `libs/trading-core/scripts/gen_observability_fixtures.py`,
  consumed by both test suites). HTTP metrics ride the route TEMPLATE
  (`route="v1/observability/alerts/:id"`) - never a URL with an id in it;
  unmatched requests collapse to one `unmatched` value.
* The full core-metric checklist (application / market data / strategies /
  risk / execution / orders / positions / datasets / queues / infrastructure)
  maps onto the tables in §12 below, with each figure's source named.

## 4. Cardinality policy (explicit, enforced, tested)

`observability/labels.py` is law in both languages (parity-tested against
each other AND against the fixture):

* label NAMES: allow-listed (`service`, `component`, `exchange`,
  `market_type`, `event_kind`, `strategy_id`, `result`, `risk_code`,
  `rule_id`, `scope`, `stage`, `queue`, `channel`, `symbol`, `dataset_kind`,
  `trigger_type`, `alert_type`, `alert_state`, `severity`, `job_name`,
  `method`, `route`, `status_class`, `simulation`, `feed_state`,
  `pool_state`). A label name not in the list is a registration error.
* label NAMES that are identifiers or secrets (`order_id`,
  `client_order_id`, `request_id`, `correlation_id`, `tenant_id`,
  `user_id`, `account_id`, `api_key`, `token`, `password`, `url`, `query`,
  `message`, ...) are **forbidden before the allow-list is even consulted**;
  a name on both lists is a construction error, and the two lists are
  asserted disjoint by test.
* label VALUES must be bounded wire tokens (`^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,63}$`):
  sentences, whitespace, quoting games and unbounded identifiers are refused.
* symbols are permitted ONLY with a declared enumerated domain (the
  market-data gauge bounds them to `MARKET_DATA_SYMBOLS`); "bounded" is a
  code-level claim, not a comment. `strategy_id` is allow-listed because the
  strategy registry is operator-bounded - stated, so narrowing it later is
  a deliberate act.
* per-family series cap (4,096 default): past the cap, NEW label sets are
  refused and counted (`wlct_registry_series_overflow_total`), existing
  series keep recording. Refusal at the edge is the fail-closed choice: an
  unbounded scrape takes monitoring down WITH the thing it monitors.
* record-path errors NEVER throw (a metric cannot 500 a live request);
  registration-path errors always throw (a broken family map must not boot).
* metric names are never built from symbols, configs, users, tenants or
  order ids - there is no API to build a name from anything: registration is
  a literal, and the boundary test greps for name-composition patterns.

No latency or throughput figure published anywhere is a guarantee; the module
docstrings say "observations of this process", and this document says it too.

## 5. Health architecture

`observability/health.py`: five statuses (`HEALTHY DEGRADED UNHEALTHY
STOPPED UNKNOWN`) with an explicit severity ranking for aggregation
(`HEALTHY < DEGRADED < UNHEALTHY < UNKNOWN < STOPPED`: `UNKNOWN` outranks
`UNHEALTHY` because "nobody can say" is the state you investigate; `STOPPED`
outranks it because a deliberately-off component is an expectation to
verify). Each result carries reason, latency (monotonic-measured by the
registry wrapper), last-success, captured-at and redacted details.

Provider errors are isolated: a raising probe yields `UNKNOWN` naming only
the exception TYPE (messages can embed DSNs); a component that was HEALTHY
and whose provider goes unable-to-say degrades to `DEGRADED` carrying its
last-known state - demoted, never erased. Freshness budgets are per-component;
a HEALTHY result older than its budget aggregates to DEGRADED, never to
HEALTHY, and a missing captured-instant is stale by definition.

Liveness ≠ readiness by construction: the registry separates
`readiness=True` components (the process-role gates: API → pg+redis;
market-data → redis) from the operator view and from the critical trading
set; `/health` touches nothing, `/health/ready` checks only role gates,
`/health/deep` adds queues + downstreams (unchanged from Part 1),
`/health/components` on the services exposes the full snapshot + alerts +
dashboard projection.

## 6. Trading-readiness architecture

`observability/readiness.py` + `apps/api/.../readiness-eval.ts` - twin
evaluations of one declared table (`TRADING_GATES`: `market_data`,
`risk_engine`, `risk_state_fresh`, `exchange_connectivity`,
`execution_adapter`, `reconciliation`, `queues`, `kill_switches`,
`configuration`), fail-closed three ways: missing evidence ⇒ not satisfied;
`None` evidence ⇒ not satisfied; stale evidence ⇒ not satisfied by age
arithmetic. Adding a gate means editing `TRADING_GATES` - the evaluator
iterates the declared list, so "forgot to check the new thing" is
structurally impossible, and evidence for an UNdeclared gate raises.

Evidence is produced where it exists. The trading engine reports the
trading-plane gates from its own probes (market-data health mirror; its
loaded pre-trade engine; risk-snapshot staleness computed from durable
`risk_snapshot_metadata` with the honest zero-rows answer "state worker not
wired - not fresh"; connectivity "configured, not connected" until an
execution worker publishes evidence; reconciliation from durable tables;
kill-switch/protection counts from `kill_switches` + `risk_protection_actions`).
The API supplies `queues` (BullMQ counts + oldest-waiting age; execution
queue at HALF the age) and `configuration` (boot proves it), and RECOMPUTES
`kill_switches` from the durable table so a mirror written a second before a
switch engagement cannot show stale green; if Postgres is unreachable it
falls back to the engine's view and SAYS so in the reason. The merge yields
`tradingReady`, the blocking-gate list, per-gate reason + source.

What it is not, in writing at every surface: **a report, not an
authorisation.** The risk gate (Part 8) decides orders; nothing in the
trading path imports the readiness module (boundary-tested); "DEGRADED"
means exactly the spec's example states - control plane serving, trading
plane blocked - and the process is never killed for it.

## 7. Alert lifecycle

`observability/alerts.py` (engine-side truth) + `alerts.service.ts`
(durable fold). Catalog: 19 declared rules (`MARKET_DATA_STALE`,
`ORDERBOOK_RESYNC_STORM`, `RISK_SNAPSHOT_STALE`, `RISK_ENGINE_UNAVAILABLE`,
`EXECUTION_UNAVAILABLE`, `EXCHANGE_DISCONNECTED`,
`RECONCILIATION_DISCREPANCY`, `REPEATED_ORDER_REJECTION`,
`AMBIGUOUS_EXECUTION`, `RATE_LIMIT_EXHAUSTION`, `QUEUE_BACKLOG`,
`EXECUTION_QUEUE_BACKLOG`, `WORKER_FAILURE`, `POSTGRES_UNAVAILABLE`,
`REDIS_UNAVAILABLE`, `DATASET_VALIDATION_FAILURES`, `STRATEGY_ERROR_SPIKE`,
`KILL_SWITCH_ENGAGED`, `PROTECTION_TRIGGERED`) with severity, condition text
and `blocks_trading`/`requires_recovery` flags; mirrored in the TS
`ALERT_RULE_CATALOG` and parity-tested rule-by-rule against the Python
source (ids, severities, flags) - the same lockstep discipline Part 8 used
for switch transitions.

States: `OPEN → ACKNOWLEDGED → RESOLVED`, with the two resolve doors:
**observed recovery** (the publisher's next mirror omits the record - and
ONLY a present mirror may imply that; silence never resolves anything) or an
operator force-resolve quoting `FORCE RESOLVE ALERT` with a ≥20-char reason,
audited immediately. Acknowledge is legal only from OPEN and resolves
nothing - "acknowledgement is not resolution" is an exception message and a
test. Dedupe by `rule|component|scope`: the engine folds occurrences live
(10,000 ticks ⇒ one record with `occurrences: 10_000`), the durable fold
mirrors the cumulative count with a max-guard so a publisher restart cannot
erase history, and re-fire after resolution RE-ARMS the same row rather
than inserting a twin (unique-key fold). Occurrences, first_seen, last_seen
and duration stay observable on the row - nothing about the storm is hidden,
which is the other half of the anti-storm requirement.

Queue policy is separate and stricter where it must be: `trade-execution`
alerts CRITICAL at half `QUEUE_ALERT_AGE_MS`; control queues WARNING at full
age. The API is its own publisher there, so an absent condition on the next
sample IS the observed recovery.

Retention: `ALERT_RETENTION_DAYS` (floor 7) applies only to RESOLVED rows;
`INCIDENT_RETENTION_DAYS` (floor 30) only to CLOSED incidents; unresolved
history is not a deletion candidate at any age, and the guard is in the
`where` clause, not a comment. Audit/security evidence retention was not
touched - the audit pruner still enforces its own statutory floor.

## 8. Incident correlation

`observability/incidents.py` + `incidents.service.ts` +
`ops_incidents`/`ops_incident_links`. An incident is a grouping over
references: `(kind, targetId)` links of kinds `ALERT`, `RISK_EVENT`,
`AUDIT`, `ORDER`, `EXECUTION_INCIDENT`, `STRATEGY_EVENT`,
`MARKET_DATA_FAULT`, `QUEUE_JOB` (identical enum both languages, parity
tested). Grouping key is `correlation:<id>` when the evidence carries one,
else a content digest of the sorted link set - same evidence, same incident,
deterministically, which is what the scenario test pins. Incidents own no
payload copies (links point, they never embed); target ids are
identifier-validated, the API sanitises the one free-text field (title)
through the platform redactor, and the whole incident document is asserted
payload-free by test. Creation happens ONLY through the alert fold (an
incident nobody observed is a rumour; the platform prefers its rumours to
be alerts first); operators move status (`OPEN → REVIEWING → CLOSED`) and
closing requires a note; the audit trail records every transition with the
caller's correlation metadata.

The mandated chain - stale market data → risk rejection → execution blocked →
alert → ack → recovery → resolution - is proven end-to-end in
`test_observability_scenario.py` on the REAL Part 8 `RiskGate` (stale quote
⇒ `STALE_MARKET_DATA`; alert folds three attempts into one record ×3; ack
does not unlock; recovery flips readiness and resolves; the incident links
the deduped risk event ids + the alert by correlation id) - and the
persistence half is pinned by the API's `alerts.service.spec.ts`.

## 9. Correlation model

HTTP (`x-correlation-id`, UUID-or-mint, echoed on the response) → every log
line (pino `customProps` carry tenant/user/session already; Python
services got a `LoggingCorrelationFilter` over the same contextvars) →
queue payloads (camelCase `correlationId`/`operationId` envelope, extracted
defensively field-by-field so one poisoned value cannot blind the other
seven) → engine decisions (the risk decision already keys `request_id`; the
observation points carry the ambient ids) → audit rows (`correlationId`,
`operationId` columns).

`CorrelationContext` is an allow-listed, frozen, contextvar-scoped record -
`with bind(...)` layers ids, exit restores them, tasks never bleed (tested
with real asyncio interleaving), arbitrary attachments are refused by
construction (`KeyError` on unknown fields, `ValueError` on non-wire-token
values). No secrets, ever: the field set is closed and the values are ids.
This is deliberately *not* distributed tracing; it is the minimum the
OpenTelemetry context will carry when someone adds a tracer, and the
`to_queue_payload` seam is where the W3C traceparent would ride alongside.

## 10. Logging & redaction architecture

One policy, per language, shared by everything: Node keeps
`@wlct/utils.redact` + pino path redaction (now extended with the DSN,
bearer, AWS-key and signed-query value patterns the Python side had);
Python gained `observability/redaction.py`, which the two service
`logging_config.py` files now delegate to - replacing two per-service
key-only filters with recursive key AND value scrubbing, bytes/unknown
object handling, bounded depth, and exception-message redaction (the old
filters never looked at exception text; the new ones replace
`exc_text` with a `{type, redacted message}` summary).

The fixture (`redaction.cases`) is the cross-language oracle: generated by
Python, asserted by BOTH test suites against identical inputs - where the
Python side has a hand-written `declared` expectation it is kept in the
fixture so a reference-implementation regression shows up as a diff, not a
silently recomputed constant.

Structured log fields for the new plane: `service`, `component`, `event`,
`correlation_id`, `operation_id`, `tenant_id`/`account_id`/`strategy_id`/
`order_id` where bound, `symbol`/`exchange` where bound, `result`.
Never logged: API keys/secrets, JWTs, refresh tokens, passwords, private
keys, signed query strings, credentials, raw `Authorization` headers - by
the redaction filters, the pino path list, the metric label ban, the
correlation field ban, and incident/alert detail redaction, each tested.

## 11. Prometheus endpoint & protection

`GET /metrics` (versionless, like health; excluded from the global prefix
in `main.ts`; autoLogging-silenced in pino). Content-type
`text/plain; version=0.0.4; charset=utf-8` from a shared constant.

Auth model per the spec's two branches, both implemented honestly:
deployments that isolate (compose publishes NO metrics port - the API port
maps 4000 for /api+health; Python services stay on the internal network)
may scrape unauthenticated; where the listener is shared, `METRICS_TOKEN`
is required **in production** (env validation) and the header
`x-metrics-token` is compared in constant time. Outside production an open
`/metrics` is allowed by default and is exactly what the endpoint refuses
when misconfigured in production (defence in depth: the controller re-checks
even if a config were assembled outside bootstrap). Nothing else gates it:
no tenant data, no credential material, no financial detail beyond
aggregate operational state (counts, ages, latencies as observations) -
which the render itself is tested to contain nothing else of.

## 12. Core-metric checklist (where each mandated figure lives)

| Mandate | Source |
| --- | --- |
| uptime | `wlct_process_uptime_seconds` (both languages; restart = the fall-over, documented as such) |
| unhandled exceptions | service exception handlers already log `request.unhandled_error`; metrics: counters live in existing layers - not re-invented (see honesty note §14) |
| market messages/parse/sequence/reconnects/staleness/resyncs | `wlct_market_*` families + existing `CounterSet`/`TransportCounters` via the fold adapter |
| ticker/trade/book latencies | existing feed-lag/processing/end-to-end histograms (exposed via `observe_latency_histogram`) |
| strategy events/errors/latency/state age | `StrategyMetrics` (Part 6) + `wlct_strategy_*` panel rows; profitability explicitly NOT a health metric |
| risk evaluations/approvals/rejections/rule codes/staleness/latency | `RiskMetrics` (Part 8) + `wlct_risk_*`; per-rule detail stays in risk events, verdict classes in labels |
| kill-switch/protections | `wlct_kill_switch_global_engaged`, `wlct_risk_active_protections` gauges (engine hub, durable source) |
| reservations/rate | `RiskCounters` (lost/reservations) + rate-window counters, Part 8 |
| orders/fills/acks/ambiguous/reconciliation | `ExecutionMetrics` (Part 5) + orders groupBy panel rows |
| positions/exposure/PnL | panel sections (durable queries) - metrics carry only bounded aggregates |
| datasets/backtest | `DatasetMetrics` + runs-status panel |
| queues | `wlct_queue_waiting_jobs`, `wlct_queue_oldest_waiting_age_ms`, BullMQ counters; depth+active+failed+delayed on panels; completed/failed trend left to the (future) time-series store, as promised: no metric samples in PG |
| Redis/PG/HTTP latency | redis `healthCheck` latency (existing), prisma indicator (existing), `wlct_http_request_duration_seconds` + counts (new) |
| websocket state | existing realtime gateway stats surface untouched by Part 9; no new WS metrics invented that would duplicate it |
| simulated vs live | `simulation` label on pipeline families (bounded to `simulated`/`live`) and `isSimulated` on every durable row (Part 5-8 discipline); no metric mixes the two |

## 13. Degraded & fail-closed behaviour (the interesting states)

* Redis down: market-data poller survives (cached quotes age), probes flip
  `UNKNOWN`/`UNHEALTHY`, mirrors stop publishing, engine gates go unknown ⇒
  trading not ready; alerts `REDIS_UNAVAILABLE` EMERGENCY with blocks-trading
  semantics; orders fail closed inside the Part 8 gate (unchanged - this
  part adds visibility, not a new judgement).
* Postgres down: readiness recomputation degrades to the engine mirror
  (labelled), fold retries next minute, unresolved rows untouched, panels
  show gaps as gaps.
* Publisher process dies: its mirror TTLs out; absence ⇒ silence-flagged,
  never recovery; its engine gates ⇒ unknown ⇒ not ready; the panel shows
  `STALE`/`UNKNOWN`, the alerts it held stay open.
* Queue backend unreadable: `queues` gate unknown (blocks), samples
  empty (no false all-clears - tested).
* Strategy exception storm / repeated rejections: alert rules exist;
  quarantine/halt machinery is Part 6/8's, untouched by observability.

## 14. Honesty list (what this part deliberately does NOT claim)

1. No latency guarantee, no uptime guarantee, anywhere - every figure is an
   observation of a process about itself, phrased that way in the module
   docstrings, panel notes and the note fields of the API views.
2. No "process restarts" counter. A restart resets everything the process
   could count; the truthful signal is uptime falling over in the scrape
   history. Inventing an in-process restart count is fiction in an
   operations panel, and fiction there is worse than a gap.
3. No alert auto-clear on publisher absence. Absence is silence; silence is
   flagged, never fatalistically resolved.
4. No sub-millisecond promises; the histogram edges start at 100µs because
   that is where honest local measurement begins, not because anything is
   guaranteed there.
5. Metric samples are not financial records; panels are derived; nothing in
   the trading path reads any of it. If this whole layer were deleted,
   trading behaviour would be bit-identical - only the lights would go out.
6. The services' mypy/ruff configurations predate Part 9 and their app
   trees still carry pre-existing findings (interface-binding lints,
   quoted annotations, etc.) in files Part 9 only appended to; every file
   Part 9 authored passes both linters cleanly. Service mypy strict is
   additionally limited in this environment by stub-less third-party bases
   (`pythonjsonlogger`) - an environment fact, disclosed not hidden.

## 15. Directory / file map

New:

```
libs/trading-core/wlct_trading/observability/
  __init__.py  labels.py  metrics.py  health.py  readiness.py
  correlation.py  alerts.py  incidents.py  redaction.py  dashboard.py
libs/trading-core/scripts/gen_observability_fixtures.py
libs/trading-core/tests/test_observability_{labels,metrics,health,readiness,
  alerts,correlation_incidents,redaction,boundaries,scenario}.py
services/market-data/app/observability.py
services/market-data/app/routers/observability.py
services/market-data/tests/test_observability.py
services/trading-engine/app/observability.py
services/trading-engine/app/routers/observability.py
services/trading-engine/tests/test_observability_readiness.py
apps/api/src/infrastructure/metrics/metrics.registry.ts
apps/api/src/modules/observability/
  alert.constants.ts  readiness-eval.ts  observability.types.ts
  observability.mapper.ts  observability.service.ts  alerts.service.ts
  incidents.service.ts  metrics.registry.provider.ts
  metrics.controller.ts  observability.controller.ts
  http-metrics.interceptor.ts  observability.module.ts
  dto/observability.dto.ts
  observability-safety.spec.ts  alerts.service.spec.ts
apps/api/src/modules/health/trading-readiness.service.ts
apps/api/src/modules/health/trading-readiness.spec.ts
apps/admin-web/src/app/(console)/observability/page.tsx
apps/admin-web/src/app/(console)/observability/alert-controls.tsx
apps/api/prisma/migrations/20260912120000_part9_observability_operations/migration.sql
docs/fixtures/observability_fixtures.json   (generated oracle)
```

Modified (complete final contents in the handover doc): the histogram
snapshot method + redis-key additions + `py.typed`/packaging in trading
core; `packages/config` constants + env schema; `packages/utils` redactor;
shared-types rbac + audit; API app-config, request context (decorator,
types, middleware), audit types/service, audit interceptor, health module +
controller, queue service/module/scheduler/processor, `main.ts`,
`app.module.ts`, `prisma/schema.prisma`; both services' `main.py`,
`config.py`, `logging_config.py`, `schemas.py` (market-data), `poller.py`
(hook), `engine.py` (observe hook), `requirements-dev.txt`, `pyproject.toml`
(mypy overrides); both service Dockerfiles; `docker-compose.yml`;
`.env.example`.

## 16. Test plan (what proves what)

* Python unit: labels (allow/forbid/bounds/exactness), registry (type
  semantics, negative observations, cap + overflow metric, rendering vectors,
  escaping, determinism, adapter edge cases, process sampling), pipeline
  span (monotonic-only, None for missing, first-mark-wins), health
  (ordering, provider isolation incl. message-scrubbing, demote-not-erase,
  staleness, readiness subsets), readiness (fail-closed truth table incl.
  all-critical declaration), alerts (storm fold, scope separation, ack
  legality, recovery-only resolution, re-fire fresh record, payload
  roundtrip, ordering contract, link accumulation), correlation (binding,
  nesting, injection refusal, queue roundtrip, field-drop resilience, task
  isolation, filter precedence), incidents (deterministic grouping,
  immutability, bounds, no-payload guarantee), redaction (recursion, value
  patterns, exceptions, depth, fixture parity incl. render vectors),
  boundaries (no I/O, no trading-path imports, no suppressions, wall-clock
  duration ban, purity of state machines), scenario (the §8 chain on the
  real gate).
* API jest: fixture parity (render bytes, redaction, 512+18-row readiness
  replay, catalogs parsed from live Python source), cardinality enforcement
  (allow-list, refusals-counted, bounded domains, series cap, provider
  source scan), source guarantees (no suppressions, no trading-path imports,
  ops tables only, permission structure, no PUT/PATCH/DELETE, non-wildcard
  update permission, role grants), DTO discipline, env validation (mandatory
  flags, token requirement, retention floors), alert-fold service semantics
  (creation/fold/storm 10k→1/max-guard/silence-vs-recovery/unparseable),
  mutation lifecycle (transitions, platform/tenant split, cross-tenant
  NotFound, phrase discipline, audit correlation fields), readiness merge
  (mirror-absent blocks, single-gate blocks, durable override, fallback
  labelling, queue half-age policy, unknown-backend blocks, no-authorisation
  note), queue samples fidelity.
* Services: hub state machines + route contracts on fake Redis; the full
  existing suites still pass (6→13 market-data, 9→15 trading-engine).
* Gates kept green: pytest 1140, ruff, mypy strict (131 files), jest 160,
  API + admin tsc/eslint clean, build:packages, prisma validate + additive
  migration grep (zero destructive statements), fixture determinism.

## 17. Quality-gate commands

```
# Prisma (schema changed: additive only)
cd apps/api && npx dotenv -e ../../.env -- prisma validate
cd apps/api && npx dotenv -e ../../.env -- prisma generate
cd apps/api && npx dotenv -e ../../.env -- prisma migrate deploy   # applies 20260912120000_part9_observability_operations

# Python - core library
cd libs/trading-core && python3 -m pytest tests -q          # 1140 passed
cd libs/trading-core && python3 -m ruff check wlct_trading tests
cd libs/trading-core && python3 -m mypy wlct_trading        # strict, 131 files
cd libs/trading-core && python3 scripts/gen_observability_fixtures.py   # fixture oracle

# Python - services (dev venv with each service's requirements-dev.txt;
# trading-core installed editable or on PYTHONPATH)
cd services/market-data && python3 -m pytest tests -q       # 13 passed
cd services/market-data && python3 -m ruff check app tests  # Part 9 files clean (pre-existing findings documented in §14.6)
cd services/trading-engine && python3 -m pytest tests -q    # 15 passed
cd services/trading-engine && python3 -m ruff check app tests

# Node
npm run build:packages
cd apps/api && npx tsc -p tsconfig.json --noEmit
cd apps/api && npx eslint "src/**/*.ts" --max-warnings=0
cd apps/api && npx jest                                      # 7 suites, 160 passed
cd apps/admin-web && npx tsc -p tsconfig.json --noEmit
cd apps/admin-web && npx eslint "src/**/*.{ts,tsx}" --max-warnings=0

# Flutter - intentionally untouched by Part 9 (no operational surface on
# mobile, per spec). Part 8's status stands: analyze/test not executable in
# the build sandbox (no Dart SDK); static verification documented in
# docs/PART8_RISK.md §12. Re-run before shipping mobile changes:
cd apps/mobile && flutter analyze
cd apps/mobile && flutter test
```

Verification map: metrics exposition determinism -
`test_observability_metrics.py` + jest fixture replay; cardinality -
`test_observability_labels.py` + jest cardinality block; health fail-closed -
`test_observability_health.py`; trading readiness (both languages) -
`test_observability_readiness.py` + `trading-readiness.spec.ts` + the
fixture truth table; alert lifecycle/dedupe/storm -
`test_observability_alerts.py` + `alerts.service.spec.ts`; incident chain -
`test_observability_scenario.py`; redaction - `test_observability_redaction.py`
+ jest redaction cases; boundaries/authorisation-free-ness -
`test_observability_boundaries.py` + jest source-guarantee block;
configuration enforcement - jest env-validation block.
