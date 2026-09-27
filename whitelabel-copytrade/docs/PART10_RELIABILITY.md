# Part 10 — Reliability: tracing, error budgets, fault injection

> **Standing disclaimer, inherited and repeated because this part touches
> operator psychology directly: observability makes the platform easier to
> operate; it does not - and must not - make the trading path less safe. No
> number in this part authorises an order. Latency histograms are bucket
> approximations and are labelled as such where they can flatter compliance;
> none of this is a performance guarantee, and the platform has never claimed
> one (no sub-millisecond language anywhere, including here).**

Complete file contents for every file this part created or modified are in
`docs/PART10_HANDOVER_FULL_SOURCE.md`. API surface: `docs/API.md` §"Service
objectives, tracing, fault posture (Part 10)". Threat rules:
`docs/SECURITY.md` §"Trace-side rules (Part 10)". Plane layout:
`docs/ARCHITECTURE.md` §"The reliability plane (Part 10)".

---

## 10.1 The one law, and how it is enforced structurally

**Observe, never authorise.** Everything else in Part 10 is engineering
around making that sentence survive contact with future edits:

* The risk gate (Part 8) is unchanged and cannot read any Part 10 signal.
  Enforcement is not a policy memo - `consumeFault()` textually appears in
  exactly two production files (the tracing service, the scrape endpoint),
  `apps/api/src/modules/{execution,risk,strategy,signals,tenants,auth,realtime}`
  contain zero imports from `infrastructure/tracing`, and the engine's
  evaluate router must not contain the tokens `injector`, `tracer.`,
  `should_sample`, `sampler` at all. All four claims are tests
  (`part10-safety.spec.ts`, `tests/test_part10_safety.py`), so the law rots
  loudly if anyone violates it.
* Sampling changes what is RECORDED, never what is ANSWERED. An unsampled
  request still gets `x-trace-id`, still gets its metrics, still gets its
  decision. A sampled request additionally leaves a span.
* Fault injection is a configuration posture, not a runtime lever: armed
  only via env, refused at boot in production by BOTH validators (zod
  superRefine on the API side, pydantic validator on the engine), and the
  only runtime operation anywhere is `consume` at instrumented points. There
  is no arm route, no resolve route, no delete route - the fault POST does
  not exist, anywhere, on any plane.

## 10.2 W3C trace context

`traceparent`/`tracestate` are parsed to the W3C grammar and nothing more:
version field, 32-hex nonzero trace-id, 16-hex nonzero span-id, flags byte.
Malformed → the header is ignored and a fresh root begins; a future version
with `00-` prefix is accepted only in the exact 3-field tail form (the spec's
own forward-compatibility rule). `tracestate` members are kept newest-first,
deduplicated by vendor key, capped at 32 members and 512 chars per member -
then re-canonicalised before export. Raw inbound bytes never reach an
exporter.

Propagation surfaces (API): `TraceMiddleware` is FIRST in `configure()`
before request-context and tenant middleware, so even a 401 from a guard is
inside a span with a status; the response carries `x-trace-id`; the span's
`http.*` attributes come from a closed list. Queue hops (both services) do
NOT put context into job payloads: a successful `add()` is followed by a
best-effort write of `formatTraceparent(active)` into
`wlct:tracing:ctx:queue:<queue>:<jobId>` with a TTL, and the consumer reads
that key back. The payload schema stays what Parts 2-9 defined; telemetry
travels beside it, never inside it. A missing sidecar starts no continuation
- a worker with no parent does not invent one.

The engine mirrors the same surface via `app/tracing.py` (tracer build,
request-span helper, flush helper) used from `app/main.py`'s middleware.

## 10.3 Sampling: deterministic, pure, fixture-pinned

`SamplingPolicy.should_sample` is a pure function of (mode, ratio-ppm,
trace-id, parent flag, operation) in both languages:

| Mode | Semantics |
| --- | --- |
| `disabled` | no tracer object is even constructed - zero-cost passthrough |
| `off` | tracer exists, samples nothing (posture switch for load tests) |
| `all` | every trace |
| `ratio` | `int(trace_id[:16], 16) < ratio_ppm * 2^64 / 10^6` - integer-only, stable per trace, boundary is threshold-1 (pinned by fixtures at both edges) |
| `parent_based` | parent decision honoured when present, else the ratio rule |

Priority operations (config `OTEL_PRIORITY_OPERATIONS`, default
`execution.transmit`) always sample when the policy is not disabled - one
span per order attempt is affordable and enormously useful during an
incident, and "critical operational traces remain inspectable" is a spec
line, not a vibe. Ratio floats exist only at the construction edge; the
comparison is BigInt/integer forever after. The 96-row parity suite replays
the Python policy's decisions through the TypeScript class and vice versa.

## 10.4 Export: OTLP/JSON, one attempt, counted

Batches of ≤512 spans from an 8192-span ring are POSTed as `resourceSpans`
encoded by the encoder both languages share by fixture: canonical key order,
sorted attributes, int64-as-string (BigInt on the TS side - the fixture's
`int64Edge` vector carries 2^53+1 precisely because a JS `number` would
lie), status codes 1/2/3, `flags` from the sampled bit. A full ring at
ingest-time drops the oldest with `wlct_tracing_spans_total{result="dropped"}`
counted per reason.

**Single-attempt contract.** One `fetch` per batch per tick. Failure → spans
gone, counted `{result="export_failed"}`, consecutive-failure gauge up; at
three consecutive failures the sink opens `TELEMETRY_EXPORT_FAILING`
("platform running darker than configured"); recovery closes it with
observed-recovery semantics. NO retry queue: an unbounded buffer behind a
dead collector converts an observability outage into a memory outage in the
process that keeps orders alive. A deliberately unconfigured endpoint is
`skipped`, resets the streak, and does not alert - a posture, not an
outage. The manual `POST /tracing/flush` runs the same tick once.

The engine hub keeps the same law with the same counters, and the same
alert ids, in its own mirror loop.

## 10.5 Fault injection: config-armed, closed-set, consume-only

Ten fault points live in one shared catalog (fixture enums ↔ TS enum
↔ Python enum, three-way pinned). The API process physically wires two of
them: `trace_export_unavailable` (export tick short-circuits to counted
skips) and `metrics_export_unavailable` (the scrape answers 503
`METRICS_EXPORT_UNAVAILABLE` AFTER token auth - so an unauthenticated prober
cannot learn whether injection is armed - while the registry keeps counting
behind the closed door). `consumeFault(point)` returns true only while
armed AND the point is in this process's closed set; "times = -1" semantics:
armed means armed-until-restart, because the environment is the plan. The
other eight points belong to the planes that own those signals (engine
health/probe simulators); a `GET /v1/operational/faults` view reports
`{enabled, production, activePoints}` so a panel can tell "no faults armed"
from "fault injection does not exist here" - two different sentences that
an absence would otherwise conflate.

## 10.6 Error budgets: the model, stated completely

Definitions (9-objective default catalog; `api.availability`,
`api.request_success`, `api.latency`, `queue.processing_success`,
`queue.freshness`, `market.data_freshness`, `risk.state_freshness`,
`reconciliation.freshness`, `engine.pretrade_error`): canonical JSON of the
lowercased field set, SHA-256, `objective` as decimal string ≤4 fraction
digits in (0,100) exclusive → `objectivePpm`; `allowedPpm = 10^6 -
objectivePpm`. Budget math is event-count integer math only
(`budget_total = floor(total * allowed/10^6)`); ratio ppm saturate at 10^6;
burn multipliers default 1.0×/2.0× in ppm.

Windows are 10-minute Redis bucket hashes
(`wlct:trading:ops:slo:<source>:<floor(ms/600000)>`, fields `good`, `bad`,
`ticks`, latency extras `total`/`le<N>ms`; HINCRBY deltas + PEXPIRE 14d =
2× retention). The bucket containing "now" is EXCLUDED from every read -
half-written buckets cannot enter an evidence row. Completeness law:
tick-driven sources certify when `ticks ≥ 0.95 × expected` (1 tick/5min per
collector); event-shaped sources (`engineerr`, `apireq`, `apilat`,
`queueproc`) are complete by existence and the evaluator renders "no events
recorded in window" honestly. A window that reads fewer buckets than it
needs says `window read X/Y buckets (pre-deployment or pruned by retention)`
in the note and the state becomes UNKNOWN via the thin-collector rule -
never a percentage computed from evidence that is not there. Latency
compliance at a threshold between grid boundaries reads at the largest
boundary ≤ threshold with an explicit "(floor)" note: the overstatement is
disclosed in the row, not hidden in the query.

Paging state machine per evaluation:

```
EXHAUSTED  if budget_total > 0 AND remaining == 0            (pages alone)
CRITICAL   if short_burn ≥ fast AND long_burn ≥ slow          (pages)
WARNING    if short_burn ≥ fast OR  long_burn ≥ slow          (does not page)
HEALTHY    otherwise
UNKNOWN    thin collector OR zero samples                      (gap alert, not paging)
```

Burn alerts fold into the Part 9 alert table under `component='slo'` with
dedupe key `SLO_BURN_FAST|slo:<id>` etc.; they auto-resolve when a later
evaluation covering the same scope stops paging - the covered-scope guard
means an evaluation that skipped an SLO cannot "recover" its alert.
`SLO_TELEMETRY_GAP` (WARNING) fires when a window is uncertifiable:
"we stopped seeing it" is its own row, so it can never masquerade as either
"it stopped happening" or "it broke".

Rows land in `slo_evaluations` (durable, append-only) and gauges
(`wlct_slo_state`, `wlct_slo_error_budget_remaining_ppm`,
`wlct_slo_burn_rate_ppm{window_kind}`) update per evaluation; the readiness
rollup (`GET /slos/readiness`) is the same rows summed - worst remaining
budget is a MINIMUM, never an average, because one exhausted objective is
the headline.

## 10.7 Collection points, and why each is where it is

| Source | Written by | Cadence/shape | Notes |
| --- | --- | --- | --- |
| `apiavail` | API evaluator tick | 1/5-min ticks from raw `SELECT 1` + redis PING ≤2s | the probe measures what availability means here |
| `apireq`/`apilat` | `TracingService.noteHttpRequest` via the interceptor + loop flush of DELTAS | per request; latency into grid | flushed deltas survive a failed loop (retry = exactly-once via high-water marks) |
| `mdfresh` | mirror tick | HEALTHY mirror → good tick; absent → no tick | reads the Part 9 mirror, not a new protocol |
| `riskfresh` | tick | published>0 AND stale==0 at 2× gate budget, DISTINCT ON LIMIT 1000 | query error → NO tick (absence cannot certify compliance either) |
| `queuefresh` | tick | bad iff zero samples or any null/>240s job age | the queue itself is the sample |
| `reconfresh` | tick | any of last 20 COMPLETED runs ≤900s ago AND repaired≥found | "clean within budget" is derived in TS because Prisma cannot express the OR-of-counts |
| `queueproc` | the maintenance worker's own `completed`/`failed` listeners | per job | attached BEFORE the inline-close decision, so whichever process consumes the job counts it; replicas sum through Redis |
| `engineerr` | engine hub mirror loop | per-decision in-memory good/bad counters, delta-flushed | approved AND refused are both good samples - an SLO that punished the gate for refusing would be an instruction to loosen the gate; internal errors (the router except-path) are the only bads; no `ticks` field by design (event-shaped), no baseline key |

The scheduler registers `*/N * * * *` EVALUATE_OPERATIONAL_SLOS (N =
`sloEvaluationIntervalMinutes` clamped 1..59) and `50 3 * * *`
`PRUNE_SLO_EVALUATIONS` carrying `retentionDays` - the service re-clamps to
≥7 days regardless of what a caller asks (the floor is code, not config).
Both cron families reuse the existing idempotent `schedule()` (jobId
`repeat:<name>`).

## 10.8 Durability and tenancy

Two additive tables (migration `20260912180000_part10_reliability_slo`:
1 CREATE TYPE, 2 CREATE TABLE, indexes, 2 unique constraints; verified
zero destructive statements): `slo_configuration_versions`
(`(tenantId, sloId, version)` unique; payload Json + checksum; enablement
outside the checksummed identity so toggling measurement does not rewrite
the promise) and `slo_evaluations` (every ppm integer as BigInt - the
platform's 64-bit rule; `(tenantId, sloId, createdAt)` indexed). Tenant
scoping is everywhere the Prisma client touches; the bucket keys are
platform-global telemetry (counts, no tenant rows) exactly like
`/metrics`. No client-supplied tenant id is believed anywhere in this part.

## 10.9 Cross-language parity regime

`docs/fixtures/reliability_fixtures.json` (1551 lines, generated by
`gen_part10_fixtures.py` executing the REAL Python modules - enums,
traceparent/tracestate vectors, sampling decision table, attribute-hygiene
table, four byte-exact OTLP/JSON payload vectors, budget/burn tables,
catalog checksum vectors, five whole-scenario evaluation rows) is replayed
by `slo-parity.spec.ts`. One fabricated sampling row (mode `"constant"`,
all-zero trace id, a ratio/ratioPpm pair no constructor can produce) is
asserted as the pure-arithmetic claim it documents rather than routed
through either constructor - and the spec says so in a comment, because a
fixture you do not understand is a fixture you will "fix" wrongly.
The TS catalog's TEXT (descriptions, good/bad-event sentences) is pinned
through the checksums rather than string comparison: a reworded TS
description changes the digest and fails.

## 10.10 Admin surface (`apps/admin-web` → Service objectives)

One server-rendered page (`/slo`, `operations:read`-gated via the existing
console session path - the browser holds no token) with three client islands
(total: page.tsx + slo-controls.tsx + one sidebar entry): evaluate-all,
per-row evaluate, export tick, and the publish-version form. The form's
fields mirror the DTO one-for-one (objective as text, windows, burn ppms,
owner/description/events, freshness/latency conditional fields, enablement);
its copy tells the truth about what publishing does (appends a version,
cannot rewrite history, identical publish = no-op); there is no optimistic
UI anywhere; the fault card reads the same read-only posture the API
returns. No control on the page can arm a fault, edit a stored version,
delete evidence or resolve an alert.

## 10.11 Deliberate limits, stated plainly

* Head sampling loses spans of unsampled traces - full stop, by design;
  priority operations are the mitigation, not a fix.
* OTLP/JSON only; no gRPC, no protobuf. Collector-side transformation is the
  deployment's choice.
* Span link semantics are parent-only; no `links[]` array.
* Bucket histograms are grid approximations; the le-grid note is the
  disclosure. p95/p99 are not computed and not claimed.
* `engineerr` measures the HTTP evaluate path; an engine that dies without
  writing buckets leaves that source silent (event-shaped completeness
  cannot distinguish "dead" from "nothing to see") - the counter cross-check
  (`wlct_risk_decisions_total` in the engine's registry) exists for the
  skeptical operator, and this paragraph exists so nobody pretends the
  limitation is not real.
* Trace retention is the collector's business; `traces/current` answers
  only "this request", and no route searches history.
* The scrape-fault 503 does not pause counting; expect gaps in
  Prometheus, not corrections.

## 10.12 Quality gates (as run for this part)

* `libs/trading-core`: `pytest tests -q` → **1256 passed**;
  `ruff check wlct_trading tests` → green; `mypy wlct_trading` → **no
  issues, 139 files** (strict, zero suppressions; the no-suppression guard
  itself passes over the new modules).
* `services/trading-engine`: `pytest tests -q` → **43 passed**;
  ruff clean on every Part-10-touched file (`app/tracing.py`,
  `app/observability.py`, `app/config.py`, `app/main.py`,
  `app/routers/engine.py`, both part-10 tests); the one remaining engine
  finding (`S104` on `TRADING_ENGINE_HOST = "0.0.0.0"`) is a pre-Part-10
  default-bind line in config.py, untouched here, documented as before.
* `services/market-data`: **19 passed**, unchanged (Part 10 touches nothing
  in this service - its hub was already the mirror contract of Part 9).
* `apps/api`: `tsc --noEmit -p tsconfig.json` → **0 errors**;
  `jest` → **285 passed / 10 suites** (baseline 160 + 125 Part-10: 96
  parity + 9 samples + 20 safety across the three new specs); `eslint
  --max-warnings=0` over `src/infrastructure/tracing`,
  `src/modules/observability`, `src/modules/queue` → clean (the parity
  spec is fixture-typed with interfaces, not `any`).
* `apps/admin-web`: `tsc --noEmit` → clean; eslint on the two new files and
  the sidebar → clean.
* `prisma validate` → valid; `prisma generate` → clean; migration
  destructive-statement grep (DROP/TRUNCATE/DELETE FROM/RENAME/ALTER) →
  **zero** (one comment mentions renames to say there are none).
* Banned-placeholder token sweep across all 31 new/modified TS files and
  the Python set → zero hits (the engine's pre-existing "placeholder
  token" REJECTION list is guard data, not a placeholder, as in Part 9's
  sweep-exemption note).
* Flutter: **not re-run** - Part 10 adds zero Dart files (deliberate:
  the operator console is the surface for this plane; phones read
  decisions, not dashboards), the Part 8 status stands.
