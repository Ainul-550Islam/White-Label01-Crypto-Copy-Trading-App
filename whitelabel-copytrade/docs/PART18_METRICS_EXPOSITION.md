# Part 18 — metrics exposition: the scrape that was never plugged in

Part 9 built a socket. This part plugs something into it, and in doing so finds
out that the thing on the other end of the cable had never been switched on.

Everything below was measured against the tree in this build, not against the
documents that describe it — which matters here more than in most parts, because
two sentences this part wrote about itself were already wrong when they were
written, and both are recorded as wrong below (§5, §6).

## 1. The gap, with the evidence

Three facts, each checkable in the file named:

* `wlct_trading/observability/metrics.py` has exported
  `observe_latency_histogram(...)` since Part 9 with a docstring saying "the
  service's scrape handler calls this per scrape". For eighteen parts, the
  execution engine had no scrape handler. `grep -rn observe_latency_histogram
  services/execution-engine/app` returned nothing before this part; the
  `services/trading-engine` and `services/market-data` hubs are the only two
  callers in the repository.
* Both sibling services carry `OBSERVABILITY_ENABLED: bool = True` in their
  config and refuse it as `false` under `NODE_ENV=production`
  (`services/trading-engine/app/config.py:91` and `:139`). This service had
  neither — although `docker-compose.yml` has been passing
  `OBSERVABILITY_ENABLED: ${OBSERVABILITY_ENABLED:-true}` to it all along
  (trading-engine:215, execution-engine:303, market-data:382). The platform
  always intended the knob; one of the three services never read it.
* The deeper one, found while wiring this part and only fixable here:
  `build_runtime` never passed `metrics=` to `ExecutionEngine`. The port has
  been optional since Part 5, so nothing failed; the engine's `_metrics` was
  `None`, every counter update was a guarded no-op, and every histogram that
  Part 16 documents as evidence of a review was being accumulated by nothing.
  `grep -c metrics app/composition.py` returned 0.

So the honest description of the pre-Part-18 state is not "metrics existed and
nobody scraped them". It is: this service could not measure its own order path,
and the machinery that would have measured it sat unused in the library beside
an adapter nobody called.

## 2. What shipped

New files, by line count as measured in this build:

| File | Lines | What it is |
| --- | --- | --- |
| `services/execution-engine/app/observability.py` | 296 | the hub: families, the per-scrape mirror, the reset accounting |
| `services/execution-engine/app/routers/observability.py` | 46 | `GET /metrics`, `include_in_schema=False` |
| `services/execution-engine/tests/test_part18_observability.py` | 545 | 33 tests, 6 of them against a booted app |
| `services/execution-engine/tests/test_part18_asgi_target.py` | 339 | 14 tests: every Python service's image command line, resolved through uvicorn's own loader (§6.1) |
| `services/{execution-engine,trading-engine,market-data}/log-config.json` | 4 each | the two no-op keys, and the reason a file is needed at all (§6.1) |

Edited files, described rather than counted - a repository with no git in it
cannot report a diff honestly, and a line count invented here would be the kind
of prose number this project has repeatedly had to retract:

* `app/config.py` — `OBSERVABILITY_ENABLED`, the `NODE_ENV=production` refusal,
  and `to_public_dict["observabilityEnabled"]`.
* `app/composition.py` — the instrument the engine never had (§6), and
  `describe()["metricsConfigured"]`.
* `app/schemas.py` + `app/routers/internal.py` — `metricsConfigured` on
  `/internal/v1/status`, through the typed model rather than as a passthrough key.
* `wlct_trading/execution/engine.py` — the public `metrics` property,
  `_observe_stage`, and the four timed spans.
* `wlct_trading/observability/metrics.py` — the cumulative double-accumulation
  fix in the shared adapter (§5), plus Part 9's test corrected and extended to
  pin rendered text.
* `libs/trading-core/tests/test_observability_metrics.py` — the drift pin moved
  from 12 unrecorded stages to 8, naming the five recorded ones individually.
* `infrastructure/docker/{execution-engine,trading-engine,market-data}.Dockerfile`
  — `COPY` of the log config, `--log-config ./log-config.json`, and for
  execution-engine the `--factory` target (§6.1). Three images gained a line;
  one gained a startable command.
* `docs/GETTING_STARTED.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`,
  `docs/ROADMAP.md`, `services/execution-engine/.env.example`, root
  `.env.example` — the surfaces, the knob, the label law, and the operator's
  version of §6.1.

A scrape of an idle process registers 44 families and renders 7 of them
(29 lines). Both halves of that sentence are the design: the
registry knows about everything the instrument can hold
(36 `wlct_execution_<field>_total` counters derived from
`dataclasses.fields(ExecutionCounters)`, one
`wlct_execution_metrics_resets_total`, the wiring gauge, the one stage
histogram, and five process families from `ensure_process_families`), while the
text only carries what has actually been written — see §3.

Two figures in that paragraph are not the ones this part shipped, and saying so is
cheaper than letting a reader find it: Part 19 added seven review-area counters (29 →
36, docs/PART19_LIVE_ENABLEMENT.md §2) and two wiring components (7 → 9 series), which is
why the idle render grew by two lines. The counter families are still not listed by hand
anywhere, which is the only reason those two parts could touch the same instrument without
editing this file's machinery at all. The byte count this paragraph used to quote is gone
deliberately: `wlct_process_uptime_seconds` prints with a variable number of digits, so a
byte figure is a property of the run and not of the design, and the honest replacement for a
measurement that will not repeat is the one that does.

## 3. The four laws this exposition keeps

1. **Every series carries `service="execution-engine"`.** Not `job`, not `instance`:
   the platform's own label law (`observability/labels.py`,
   `ALLOWED_LABEL_NAMES`) and the reason a scrape from three Python services can
   be merged into one Prometheus without the numbers lying to each other.
2. **A family with no series is absent, not zero.** `render_prometheus` omits
   it, and the test in §4 asserts that an untouched counter family is *missing*
   from the text rather than present as `0`. This is the law that makes "zero
   placement reviews" readable: an unmeasured stage and a stage that measured
   instantaneous work are two different statements, and only one of them can be
   fabricated. A dashboard that wanted zeros must generate them itself (`or
   vector(0)`), and the choice is then visibly the dashboard's.
3. **A decrease in the source is an event, not a negative rate.** `inc()`
   refuses a negative amount by platform law, so the hub mirrors a delta; when
   the source goes backwards (`ExecutionMetrics.reset()`, or a fresh process
   whose counters start at zero while the scrape target's do not) the hub
   re-baselines the mirrored total and increments
   `wlct_execution_metrics_resets_total`. Tested by driving the counters up to
   20, resetting, and asserting the exposition says `11` with `resets 1` and
   then `14` — i.e. the mirrored series survives a reset without pretending it
   is continuous.
4. **Nothing identifying is in the text.** The core refuses `tenant`,
   `account`, `order`, `client_order_id` and friends at registration
   (`CardinalityError`), and this module does not route around the refusal with
   a rename. The test registers one and asserts the refusal. Per-tenant numbers
   belong in the row-level-security-scoped tables (`docs/PART17_DURABLE_INCIDENTS.md`,
   `docs/PART13_DURABLE_STORE.md`), which is where the API queries them.

Reading is also write-free: a scrape never calls `reset()` and never mutates a
histogram, so an operator looking at a number cannot change it. That is why the
hub copies each histogram whole through the adapter instead of re-observing
samples, and why the engine's `metrics` property is read-only with no setter.

## 4. The stages: 13 declared, 5 recorded, 8 not

`EXECUTION_STAGES` is the vocabulary: `validation`, `risk`, `safety_gates`,
`lock_acquire`, `signing`, `placement_review`, `network`, `exchange_ack`,
`persistence`, `total_submit`, `first_fill`, `private_stream_delivery`,
`reconciliation_pass`.

Part 18 times the four spans that exist **inside** the engine's own
`submit()` — `validation`, `safety_gates`, `risk`, and `total_submit`, the last
recorded inside `finish()` so it covers the whole call including the parts that
refuse. `placement_review` was already timed by Part 16. Five of thirteen.

The other eight are not recorded, and the reason is a rule rather than an
omission: **a stage that crosses a process or transport boundary is not this
engine's number to report.** Measuring `signing` here would measure
`SecretProvider.resolve()`; `network` and `exchange_ack` would measure an
adapter this service does not construct in paper mode; `first_fill` and
`private_stream_delivery` belong to the process that owns the venue stream;
`reconciliation_pass` to whoever runs reconciliation; `persistence` to the
store's own pool. The core's histogram docstring says "observations of this
process and its network path, never a latency guarantee", and the way to honour
that sentence is to refuse the spans that would have to be invented. The
histogram family is additionally bounded at registration to
`frozenset(EXECUTION_STAGES)`, so a typo cannot create a fourteenth stage, and
the drift pin in `libs/trading-core/tests/test_observability_metrics.py` names
the five recorded ones individually — `len(unrecorded) == 8` with the message
explaining what a number below 8 (a call site added without updating §6) and a
number above 8 (a call site deleted) each mean.

## 5. What wiring the adapter found: a nine-part bug

`observe_latency_histogram` had been copying `LatencyHistogram.snapshot_buckets()`
— a cumulative array, `le` semantics — into the registry's bucket store, and
`render_prometheus` runs the cumulative sum on its way out. Summing an already
cumulative array once per bucket is correct only for the first bucket. With one
observation in each of two buckets, the exposition said `1` and then `3`: every
`le` line above the first reported observations that never happened, and
`+Inf`/`count` disagreed with the bucket lines.

It survived nine parts because the only test of the adapter read the *series
state* and never the rendered text, and no process in this repository rendered
an adapter-filled histogram until this part existed. The fix is on the adapter's
side (copy per-bucket counts; the renderer owns the cumulative sum), Part 9's
test was corrected — it had been pinning the wrong contract, and its expectation
went from `{"100": 1, "1000": 2}` to `{"100": 1, "1000": 1}` — and both sides
now assert on rendered text (1 / 2 / 3).

Two things worth stating plainly, because they are the reusable part:

* This part did not set out to find a bug; it set out to call a function. An
  adapter with no caller is unverified code no matter how well it is tested.
* A test that asserts internal state where a contract is defined by output is
  how a wrong contract gets nine parts of institutional memory. `docs/` also
  gained a correction of mine at Part 16 §6 in the same style: the claim that the
  counters were "scraped by trading-engine's observability module" was false —
  different process, nothing was scraping — and it is retracted there.

## 6. The instrument the service never had

`build_runtime` now constructs `ExecutionMetrics(exchange=trading.exchange.value)`
and passes it to the engine. The label is the adapter's own exchange id rather
than the venue it simulates: in paper mode the id is `paper`, and a histogram of
simulator round-trips tagged `binance` would make every dashboard that reads it
lie. The venue a deployment points at is already on `/status`.

Three consequences, each pinned:

* `test_the_service_hands_its_engine_an_instrument` — a booted runtime's engine
  carries an `ExecutionMetrics`, and its stage set is empty until work happens.
  This is the whole §1 bullet three expressed as an assertion.
* `describe()` gains `metricsConfigured` and `/internal/v1/status` renders it
  (typed field, default `False`, which is what a pre-Part-18 engine actually was:
  nothing wired — so an old response cannot be misread as "instrumented but
  idle"). The TS worker hand-picks the fields it validates from that document, so
  the new one is additive and ignored by it; it is for operators, not for gates.
* The gauge `wlct_execution_wiring{component="engine_instrumented"}` is sourced
  from `describe()` like the other six components (`durable_store`,
  `durable_incidents`, `placement_review`, `venue_attestation`,
  `distributed_locks`, `journal_retention`), never from settings — a second
  opinion about the wiring is what made the four earlier gauges wrong-looking in
  the first place. A renamed or missing `describe()` key publishes `0` rather
  than a guess, which is what thirteen parts of this service would have said,
  correctly.

### 6.1 The image could not boot, and the flag in it could not either

The §9 recipe is not decoration - it is how this part found a defect with nothing
to do with metrics. Running the documented command resolved `app.main:app`, the name
`infrastructure/docker/execution-engine.Dockerfile` has carried since it was
written, and the app has never defined it: `create_app` is the only factory
`app.main` exposes. Every container built from that image died before importing the
service, and the only thing in this repository that could notice - the image's own
`HEALTHCHECK` - is read by a runtime nobody runs here.

The fix is `--factory app.main:create_app`, in the image command and in
`python -m app.main`, rather than a module-level `app = create_app()` (which is what
the two siblings do): settings are parsed inside `create_app`, so binding the app at
import time converts a start-up refusal into an import-time one. That would break
this suite's own collection - `tests/conftest.py` supplies the environment in an
autouse fixture, after imports - and it would mean a linter or a docs build has to
configure a trading service to read a constant from it. A test pins the absence
(`test_no_module_level_app_so_the_import_stays_free`).

While proving the corrected command, two more things in the same command line
turned out not to work, in all three Python images rather than one:

* `--log-config /dev/null` was a way of saying "install nothing", and it never was
  one. uvicorn routes a path with no `.json`/`.yaml` suffix to
  `logging.config.fileConfig`, and `fileConfig` refuses a zero-length file
  (`RuntimeError: /dev/null is an empty file`) - checked against CPython's own
  sources at v3.11.9, v3.12.7, v3.13.1 and v3.13.3, which all carry the guard. So
  even with a resolvable app name, `trading-engine` and `market-data` would have
  died at the same line their sibling died at.
* Each service now ships `log-config.json`, exactly
  `{"version": 1, "disable_existing_loggers": false}`, COPY'd next to
  `pyproject.toml` and named as `--log-config ./log-config.json`. The `.json`
  suffix is what routes uvicorn to `dictConfig` instead of `fileConfig`; the two
  keys mean "load nothing, change nothing", which is what the old flag was trying to
  say. It is asserted as behaviour, not as intent: a handler installed on the root
  logger before `dictConfig` is still there after
  (`test_the_log_config_changes_nothing_about_the_loggers_it_meets`), because the
  whole value of the file is that uvicorn must not reconfigure the app's JSON
  pipeline out from under it. And the mechanism is pinned too, so a revert cannot
  be argued with "it used to work"
  (`test_the_zero_length_stand_in_that_used_to_be_the_flag_is_rejected`).

What the corrected command produces, run for real against this tree:

```text
$ curl -s localhost:8093/health
{"status":"ok","service":"execution-engine","version":"1.0.0","instanceId":"exec-1"}
$ curl -s localhost:8093/metrics | grep -c '^wlct_'
13
$ curl -s localhost:8093/metrics | grep '^wlct_execution_wiring'
wlct_execution_wiring{component="distributed_locks",service="execution-engine"} 0
wlct_execution_wiring{component="durable_incidents",service="execution-engine"} 0
wlct_execution_wiring{component="durable_store",service="execution-engine"} 0
wlct_execution_wiring{component="engine_instrumented",service="execution-engine"} 1
wlct_execution_wiring{component="journal_retention",service="execution-engine"} 0
wlct_execution_wiring{component="placement_review",service="execution-engine"} 1
wlct_execution_wiring{component="venue_attestation",service="execution-engine"} 0
```

`engine_instrumented 1` is §6's fix, visible in a process rather than in a test.
`durable_store 0` and `durable_incidents 0` are the same truth on a memory backend:
nothing durable is wired, and the panel should say so rather than let a zero mean
whatever the reader needs it to. `docs/GETTING_STARTED.md` carries the operator's
version of this subsection beside the `docker compose up` instructions.

## 7. Configuration, and what refuses

* `OBSERVABILITY_ENABLED=true` by default, the same name as both siblings and
  as `apps/api` (`apps/api/src/config/app-config.service.ts:1045`, whose
  `observabilityEnabled` and `metricsEnabled` knobs predate this part), so one
  platform setting means one thing in four processes.
* `NODE_ENV=production` with it `false` is a **start-up refusal**, in the
  service's own words: a process that can hold a venue key has to be able to
  show what it measured. Fail-closed config is standing law here, and the
  refusal is a parse error rather than a warning log.
* Development may turn it off: the router is then not mounted at all, so
  `GET /metrics` answers 404, and no test asserts an apology body.
* `to_public_dict` carries `observabilityEnabled` so the console can tell the
  deployment's intent from the endpoint's presence.
* `/metrics` is unauthenticated — like `/health` and `/health/ready` beside it,
  and unlike `apps/api`, which gates its exposition behind `x-metrics-token`
  (docs/PART9_OBSERVABILITY.md). The difference is the payload: the API's
  exposition can carry trading-shaped labels, this one cannot (§3 law 4), it is
  reachable only on the `wlct-internal` network, and it is
  `include_in_schema=False` so the path never appears in the OpenAPI document.
  The worker's forwarding list is built from `/internal/v1/*` paths
  (`apps/api/src/modules/worker/engine-internal.client.ts`) and does not include
  it, which a test in this part asserts.

## 8. Deliberately not done

* **No Redis mirror.** Both siblings publish an evidence mirror for the API to
  persist. This service's evidence is its durable store, its incident table
  (Part 17) and its status document; a third copy of the same facts in Redis
  would be a third thing to keep in step. It is also why this service has no
  `REDIS_URL` in `docker-compose.yml` and none in `.env.example`: not an
  oversight, the absence is the decision.
* **No alert engine and no background loop.** Paging belongs to the layers that
  already own `AlertEngine`. Everything here is read at scrape time from state
  the process already holds — no loop to stall, no interval to tune, no
  staleness that is not the engine's own.
* **No metric for a stage across a boundary** (§4), no histogram family per
  stage (one family, bounded `stage` label — thirteen families would be a
  cardinality choice disguised as a convenience), no retention or downsampling
  (Prometheus' problem, and the exposition carries no history of its own), and
  no new table: this part changes no schema, so `rls_coverage.json` stays at 43
  covered tables and `PROBE_TABLES` at 5.
* **No `/metrics` on the API's token gate.** If this service ever gains a label
  that could identify a tenant, the answer is §3's refusal plus an
  `x-metrics-token`, not a filter at render time.

## 9. Verification

```bash
# service: 306 passed, 12 skipped (the 12 need a live Postgres)
cd services/execution-engine
PYTHONPATH=../../libs/trading-core python3 -m pytest -q
PYTHONPATH=../../libs/trading-core python3 -m pytest -q tests/test_part18_observability.py   # 33
python3 -m ruff check app tests                    # All checks passed
PYTHONPATH=../../libs/trading-core python3 -m mypy app   # 23 source files, clean

# core: 1,568 passed; ruff clean; mypy clean over 148 files
cd libs/trading-core
PYTHONPATH=src python3 -m pytest -q
python3 -m ruff check wlct_trading tests
python3 -m mypy wlct_trading

# an idle scrape, by hand, exactly as the image starts the process (sec. 6.1)
cd services/execution-engine
EXECUTION_INTERNAL_TOKEN=$(python3 -c 'print("x"*40)') \
PYTHONPATH=../../libs/trading-core:. uvicorn --factory app.main:create_app \
  --port 8093 --log-config ./log-config.json
curl -s localhost:8093/metrics | grep -c '^wlct_'      # 13 on an idle process
```

These counts were true of this build at the time of writing (Part 17's
convention: counts are historical records, not targets to chase). The service's
suite was 273 before Part 18 and is 320 after, the arithmetic being 273 plus the
47 new tests (33 for the exposition, 14 for the boot target of §6.1); 27 of the
exposition tests drive a hub directly (so the laws can be tested without a request)
and 6 go through a booted app (so the route, the plane and the composition are
tested too). The core's 1,568 and the siblings' 43 and 19 are
reproduced by the handover generator rather than restated here from memory:
`python3 scripts/gen_part18_handover.py --check` runs every gate and compares the
document byte for byte, and that is also where the three image commands are
resolved.

One measured consequence of running that generator three times in a row, stated
because it is the abstract coupling of Part 17's sec. 10 made concrete: Part 17's
ledger delta read **+244** when Part 17's document was regenerated before Part
16's, and **+163** after - not because a line of Part 17's code changed in
between, but because regenerating the ancestor moved the copies it embeds of the
ten files the two parts share forward to post-Part-18 content, and a delta is
measured against exactly that. Part 18's own delta, +324 then +78, moved for the
same reason. No figure here was picked from the flattering round.

## 9.5 The regeneration order, measured

`docs/PART17_DURABLE_INCIDENTS.md` closes with the sentence that the checks stay green
if an ancestor is regenerated last - "Part 17 first, then Part 16". Part 18 ran that
order across three documents (17, 16, then 18) and Part 17's `--check` came back not
byte-identical: its `+163`/`+164` delta flicker is read out of Part 16's embedded
copies, so writing Part 16 last invalidated the document written before it. Regenerating
ancestor-first - 16, then 17, then 18 - produced **13,221 lines / 32 files** for this
part's ledger and three consecutive `OK: ... byte-identical to a fresh generation`
lines on the same build. The rule that actually holds, and the one Part 17's correction
now states: *generate from the oldest document to the newest, then check in the same
order*, because a document's delta depends on copies its ancestors hold, while its tree
counts depend only on files that already exist. With two documents either order
converges once the pair has been swept; that is where the old sentence came from, and
it is why the sentence was kept rather than deleted.

## 10. Known limits, stated where they can be found

* A counter is process-lifetime cumulative. A restart resets it and the scrape
  target's own counters keep rising; the hub's mirrored total re-baselines and
  `wlct_execution_metrics_resets_total` rises (§3). `rate()` on these series is
  meaningful; `increase()` across an unrecorded restart is a guess the platform
  makes visible rather than hides.
* Stage timings are microseconds, bounded to the core's 16 edges from 100µs to
  10s, and describe this process and its network path — the help text carries
  that caveat from the core rather than restating it as a guarantee.
* `total_submit` includes the paths that refuse, so it is not a latency SLO for
  accepted orders; the ratio to `placement_review` and `safety_gates` is where
  the refusal cost becomes visible.
* The wiring gauges are sampled per scrape from `describe()`, so they can change
  mid-process only if the runtime is rebuilt — which nothing in this service
  does; they are cheap and deliberately not cached.
* Nothing here is durable. Metrics are the observable layer; the records that
  must survive are the store (Part 13), the journal retention (Part 14) and the
  incidents (Part 17).
