# Part 22 - the scrape side: one reader, one bundle, nothing invented

ROADMAP's Part 18 boundary said the exposition ships and "the alert rules, the dashboards and the
scrape targets stay in the deployment" (`docs/PART18_METRICS_EXPOSITION.md`, `docs/ROADMAP.md`).
Part 22 takes that half-back: the deployment side now exists **as files in this repository**, because
a config that lives only on a host cannot be reviewed, cannot be diffed, and cannot be checked against
the code it describes. Everything here is generated from the code it describes, and the generator
refuses rather than fills a gap.

Six new files and four amended ones:

| file | lines | what it is |
| --- | --- | --- |
| `libs/trading-core/scripts/gen_observability_bundle.py` | 1,945 | generator, verifier, catalog and the `--dashboard` reader |
| `libs/trading-core/tests/test_part22_scrape_bundle.py` | 838 | 41 tests, most of them testing refusals |
| `infrastructure/observability/prometheus/prometheus.yml` | 57 | four scrape jobs, no cadence, no relabeling |
| `infrastructure/observability/prometheus/rules/wlct.rules.yml` | 124 | 4 alerts + the availability rule + 20 named refusals |
| `infrastructure/observability/metrics-catalog.json` | 425 | the same facts as data, with evidence per field |
| `infrastructure/observability/README.md` | 114 | how to regenerate, deploy, and what is deliberately absent |
| `docker-compose.observability.yml` | 107 | one service: `prom/prometheus:v3.5.0`, hand-written, law-checked |
| `docs/PART22_SCRAPE_SIDE.md` | this file | the reasoning, so the diff has an argument attached |

Amended: `docs/ROADMAP.md` (the Part 21 paragraph's "no Grafana/Prometheus file in this tree" clause,
now false), `docs/PART21_DR_OPERATIONS.md` sec. 8 (same sentence), `docs/PART20_ENGINE_STATUS_EDGE.md`
sec. 9 (its "there is also no `infrastructure/observability/` to write it into" note), `.env.example`
(`PROMETHEUS_PORT`, the one name this part introduces).

---

## 1. The law this part is built on

A deployment file is where an invented number goes to look official. So the rule for every artifact is
the same, and it is enforced rather than described:

> **Nothing is written here that is not already true elsewhere in the tree, and everything that was
> considered and left out is named in the file that omits it.**

Concretely, `compose_bundle()` runs six audits before it will return an artifact set, and a violation
is a `BundleError` (exit 2 for a missing input, 1 for drift, 3 for a refusal - the same ladder the
other generators use):

* `assert_no_invented_numbers` - every numeric literal in `expr:` lines must be in a rule's
  **declared** `allowed_numbers`. The allowed set is never read back out of the expression the renderer
  just produced, so a rule cannot widen its own allowance; `test_invented_numbers_are_refused_even_inside_an_expression`
  proves it by re-rendering one rule with `allowed_numbers=()` and a threshold one unit higher.
* `assert_no_invented_cadence` - no `scrape_interval`, `evaluation_interval`, `scrape_timeout`,
  `honor_labels`, and no `for:` / `interval:` / `keep_firing_for:` in the rules. This repository
  declares no scrape cadence and no dwell policy, so the pinned image's defaults stand and the file
  says so. `ALERT_DEDUP_WINDOW_MS` already owns dwell, on the application side, where the alert record
  lives.
* `assert_no_secret_shapes` - a secret-shaped literal is a refusal. `METRICS_TOKEN` appears exactly
  once per job, as `${METRICS_TOKEN}`, and the value never exists in this tree.
* `assert_labels_are_not_invented` - no `relabel_configs`, `metric_relabel_configs`, `external_labels`
  or `labelmap` in the *effective* config. Comments are skipped, because the generated header names
  those keys to explain their absence, and a checker that greps prose reports its own documentation as
  a violation. Cardinality is decided by `wlct_trading/observability/labels.py`, at registration; the
  monitoring side does not get a route around what the code cannot break.
* `assert_job_regex_matches_every_target` - the availability alert's `job=~"wlct-(api|...)"` is
  evaluated against every job name in the config, the way Prometheus anchors it. This caught a real
  defect during authoring: `wlct-api|trading-engine|...` (no parens) matches only the first job, so
  three targets could never be reported down while the file looked complete.
* `assert_only_catalog_labels` - walks the `labels:` blocks at rule depth and accepts only `severity`,
  `rule_id`, `source`. `annotations:` keys are prose and are not mistaken for labels.

## 2. What is scraped, and how it was decided

Four jobs, from `docker-compose.yml` plus each service's own router - never from a list typed into a
generator:

| service | target | path | auth |
| --- | --- | --- | --- |
| `api` | `api:4000` | `${PROMETHEUS_PATH}` | `x-metrics-token: ${METRICS_TOKEN}` |
| `trading-engine` | `trading-engine:8001` | `/metrics` | none |
| `execution-engine` | `execution-engine:8093` | `/metrics` | none |
| `market-data` | `market-data:8002` | `/metrics` | none |

Ports come from the service's own `expose:`/`ports:` entry (`portEvidence` in the catalog records
which line), and the path from the route declaration: `_route_evidence` matches
`@router.get("/metrics"` - a docstring that merely mentions the path is not evidence, and three of the
four routers do mention it in prose several lines early. The API's path is different from the other
three because `apps/api/src/config/app-config.service.ts` reads `PROMETHEUS_PATH`, so the generated
config carries the expansion rather than a literal; a deployment that sets `PROMETHEUS_PATH` to
anything other than `/metrics` is a refusal, not a rewrite, and the same is true of a Python service
that moves its route.

Three candidates are named and refused in every artifact, each with an evidence path that exists:

* `notification-service` and `admin-web` - their source contains no `GET /metrics` route, so there is
  nothing to scrape.
* `worker` - `docker-compose.yml` gives it neither `expose:` nor `ports:`; there is no target.

`absent is absent`, applied to the deployment side: a service without a route does not get a job, a
rule without a threshold does not get an expression, and a family without a series is reported as
absent rather than as zero.

## 3. Four alerts, twenty refusals

`--rules` prints the census, and the rules file repeats it as comments so a reader of either cannot
miss it:

```
rendered SLO_BUDGET_EXHAUSTED      wlct_slo_error_budget_remaining_ppm <= 0
rendered SLO_BURN_FAST             wlct_slo_burn_rate_ppm{window_kind="short"} > 14400000 and ...
rendered SLO_BURN_SLOW             wlct_slo_burn_rate_ppm{window_kind="short"} > 6000000 and ...
rendered TELEMETRY_EXPORT_FAILING  wlct_tracing_export_consecutive_failures > 3
refused  ORDERBOOK_RESYNC_STORM    no registered family in this tree exposes the unit the rule names
refused  ...                        (20 lines, each naming what was missing)
```

4 of 24 - `ALERT_RULES` has 24 entries, and the census is asserted to sum to that, so a rule cannot
be dropped silently. 17 rules carry `threshold: None` and no numeric value exists for a generator to
scale, and 3 name a unit no registered family in this tree exposes. Each refusal names which of the
two it is, because "we alert on nothing else" must never quietly read as "nothing else was worth
alerting on".

Three decisions inside those four expressions are worth their own paragraph each:

* **`ppm` scaling.** The SLO families' registered help says the values are parts per million, and the
  catalog's thresholds are ratios. So `0.0144` becomes `14400000` - one multiplication by a unit, the
  only arithmetic the generator performs, and the conversion is recorded in the rule's evidence.
* **The inverted comparison.** `SLO_BUDGET_EXHAUSTED`'s condition says the remaining budget **is zero**,
  so the expression is `<= 0`. `AlertRule`'s docstring speaks of thresholds being *exceeded*, and
  following that single word would have shipped a rule that pages on every healthy second of the
  platform's life, because a remaining-budget gauge counts downward.
* **The one number that is not the catalog's.** `WLCTScrapeTargetDown` (`up{job=~...} == 0`) is not in
  `ALERT_RULES`. It exists because every catalog rule is silent while its own target is unreachable,
  and silence indistinguishable from health is the failure mode four earlier documents name. Its only
  literal is `0`, which is the definition of a failed scrape rather than a threshold anybody set, and
  the job list inside it is generated from the same evidence that produced the jobs.

## 4. The overlay, and the eight laws that read it back

`docker-compose.observability.yml` is the only hand-written file in the set, because it is deployment
configuration rather than a rendering of source: one service, `prom/prometheus:v3.5.0` pinned (the
config uses `http_headers`, which needs >= 2.53, and `latest` is a tag that can change the format
underneath a committed file). It mounts `infrastructure/observability/prometheus` at `/etc/prometheus`
**read-only**, keeps the TSDB on a named volume, publishes `127.0.0.1:${PROMETHEUS_PORT:-9090}:9090`,
joins `wlct-internal`, and sets no `--web.enable-lifecycle`.

`--check` validates that file with `overlay_laws()`: the service set must be exactly `{prometheus}`,
the image must equal the constant the config is written against, the bundle mount must be `:ro`, the
TSDB must have its volume, nothing may be published beyond loopback, `wlct-internal` must be present,
no lifecycle flag may appear in `command`/`entrypoint`, and no `privileged:`/`network_mode: host`
outside a comment. Every one of those bites in the test suite - and they read the *parsed* service
block, not the text, which is why the file can explain the flag it refuses to set without tripping the
check. `docker compose config` was not run: there is no `docker` CLI in this environment (sec. 7).

What the overlay deliberately does not include, in its own banner rather than in a silence: no
Alertmanager (the platform owns the alert lifecycle - catalog, fold, dedupe, retention - and a second
store of the same alerts is a second truth to reconcile), no Grafana and no dashboard JSON (a
provisioning file needs a datasource UID and a layout that does not exist here; the document this
repository *does* own is the section/row one, and `--dashboard` renders it), no OpenTelemetry collector
(`.env.example` names `http://otel-collector:4318` as deployment-provided; a collector shipped here
would have to name a trace backend this tree does not have), no node-exporter or any other exporter
(each image is another pin and another surface, and the failure modes worth paging on are trading-path
ones), and no `--storage.tsdb.retention.time` (Part 14's retention law governs the execution store's
tables; nothing in this repository declares a retention policy for scraped telemetry, so the image
default stands and a number typed here would be a policy nobody chose).

## 5. `--dashboard`: the format the repository already has

Exposition text in, the library's own document out:

```sh
curl -s http://execution-engine:8093/metrics \
  | python3 libs/trading-core/scripts/gen_observability_bundle.py --dashboard execution-engine --from -
```

`parse_exposition` folds `_bucket`/`_sum`/`_count` back into the histogram series they describe, keeps
`le` as bucket geometry rather than a label (which is what `ObservabilityRegistry.snapshot()` does, so
a scrape and a live registry route identically), and refuses anything it cannot read: a line that is
not a sample, a `TYPE` outside `counter|gauge|histogram|untyped`, a `_sum` suffix on a family declared
`counter`. Skipping unreadable lines would print a calm dashboard over a broken one. `read_exposition`
caps the input at 8 MiB and refuses NUL bytes and empty input - a failed `curl` and an idle service
look the same at the byte level, and the tool declines to pick a meaning.

The document itself is built by `wlct_trading/observability/dashboard.py`'s `DashboardBuilder`, fed
through a one-method shim (`snapshot()`), which is the duck-typing that class documents for itself. The
tool adds nothing to it and synthesises no rows: `SYSTEM` and `ALERTS` are empty because a scrape-side
view runs no health checks and holds no alert records. What the tool prints *beside* the document is
the absence census, drawn from a stricter name set than everything else in this part - see sec. 6.

## 6. Two name sets, because the two errors differ

`collect_families` is a literal scan for `wlct_*` names in each service's source. It is wide on
purpose: a registration site the pattern missed would make a **real** family look unregistered, which
is the direction of error that could suppress a legitimate alert, so rule derivation uses it.

`registered_family_names` is the strict set: a name counts only where a registration site pairs it
with a help literal, which is what the exposition format requires for a family a service actually
serves. Absence is what it is used for, and a false "absent" sends an operator hunting for a metric
nobody can register. The engine's counter families are built at runtime (`wlct_execution_<field>_total`)
and are served, but not mentionable by either set as a *literal*; `test_the_strict_census_prefers_nothing_over_a_guess`
pins that asymmetry, and the catalog's per-service count is called `familiesNamedInSource` rather than
anything that sounds like a fact about an endpoint. The first version of this file used the wide set for
the census and printed `wlct_execution_`, `wlct_dataset_` and `wlct_trading` as "absent families", which
is exactly the kind of confident noise this part exists to prevent.

## 7. Verification, and its edge

Measured in this tree, at this commit:

* `python3 libs/trading-core/scripts/gen_observability_bundle.py --emit` then `--check` - 5 `ok` lines,
  exit 0. `--check` writes nothing; that is a test, not a promise.
* `python3 -m pytest -q libs/trading-core` - **1,767 passed**: 41 from Part 22's own file and 30 from
  the three section 9 added, on top of the 1,696 Part 21 recorded. `docs/PART22_HANDOVER_FULL_SOURCE.md`
  prints that sum as a measurement rather than as a sentence, and says which of the three numbers is
  remembered.
* `python3 -m ruff check wlct_trading tests` (in `libs/trading-core`) - all checks passed, including the
  new test file.
* `python3 -m ruff check scripts` - **17 findings**: 16 pre-existing in the other scripts, and the 17th
  is one `E402` in the generator, caused by the `sys.path` bootstrap that every sibling standalone
  script also uses. It is left unsuppressed, so the count above is the number a reviewer sees.
* the three test files section 9 added, run together - **30 passed**, and named here because they are not
  Part 22's files and would otherwise disappear into the suite total;
* `python3 -m mypy wlct_trading` - no issues in 152 source files (nothing in the package changed), and
  `python3 -m mypy tests/test_part22_scrape_bundle.py` - clean, which it was not on the first draft: the
  threshold test multiplied `AlertRule.threshold`, typed `float | None`, straight into `1_000_000`.
  `mypy` over the part's new test files is one of this chain's printed gates precisely because a test
  that does not type-check may be asserting against the wrong attribute; the fix is an explicit
  narrowing helper, not an annotation that quiets the tool.
* `services/market-data` - 19 passed, unchanged: the only file of a service this part touched was
  repaired to its original text after a test-helper incident (below).
* `overlay_laws` - 8 mutations of the compose file each produce exactly one message, and the committed
  file produces none.

The edge: **no Prometheus binary was ever run here.** There is no `docker` CLI in this environment, so
neither `docker compose config` nor `promtool check config` could be executed. The config's
well-formedness is therefore guaranteed only by (a) the structure of the renderer, (b) the six audits,
(c) the repository's own text format being parseable by `yaml.safe_load` (verified here, in the test
sandbox, not in the generator - the generator has no YAML dependency and keeps none), and (d) the
Prometheus features used being the plain documented ones. Anyone who runs the overlay for the first
time should expect `promtool` to be the real referee.

The test-helper incident is worth recording rather than quietly fixing: `_mirror_tree` built its
symlink tree in the wrong order, so writing a patched `services/market-data/app/routers/observability.py`
into a temporary root wrote *through* a symlink and into the repository. The file was restored to the
line its three siblings use, the service's own 19 tests pass, and `--check` agrees with the tree again -
but the lesson is in the helper's docstring now: a symlink cannot be written through safely, so every
ancestor of an override must be materialised as a real directory first.

## 8. What remains open after this part

Not absorbed, in the same spirit as the list it came from:

* **A real scrape.** The bundle has never been read by Prometheus. The first `docker compose -f
  docker-compose.yml -f docker-compose.observability.yml up -d prometheus` belongs to a host, and so
  does the `promtool` verdict.
* **The 20 refusals.** They stay refusals until a human decides a number. When `AlertRule` grows a
  `threshold` for a rule whose family exists, that rule renders on the next `--emit` with no change to
  this file's code, which is the point of deriving rather than listing.
* **Alertmanager routing, and any paging at all.** Nothing here pages anybody: no receiver, no
  `route:`, no escalation. `--web.enable-lifecycle` is refused for the same reason.
* **Grafana provisioning.** The `--dashboard` document is the format this repository owns. A Grafana
  JSON model would need a datasource UID, a panel layout and a refresh cadence, and this part ships
  none of the three.
* **Time-series retention.** The image default applies; no policy was declared here, and Part 14's
  retention law stays about the execution store's tables, not about this volume.
* **A cadence.** `scrape_interval` and `for:` remain absent by design. Adding one is a policy decision
  that belongs in a document that argues for it, not in a generated file that would silently carry it.
## 9. The sweep that followed (2026-09-19)

Part 22 shipped a bundle and a set of claims. The claims were then re-checked mechanically - a gap sweep
across the whole tree for empty files, `pass` bodies, unresolved imports, compose references, settings
fields with no documentation, modules with no test and paths with no file - and the sweep found one missing
file, seven wrong sentences, and eleven findings that were wrong about the tree.

**The missing file.** `services/execution-engine/app/routers/enablement.py` answers `503
ENABLEMENT_ROLE_UNKNOWN` with an instruction: apply Part 11's `grant.sql`. Nothing in this repository ever
wrote one. The message was accurate about a thing nobody had built, which is the shape of defect no unit
test can see - the test asserts the message text. `apps/api/prisma/rls/grant.sql` now exists (48 lines) and
is emitted by `scripts/gen_part11_rls.py`, the owner of that directory, so the directory stays reproducible
from `schema.prisma`; the other three artefacts came out of the generator byte-identical, which is the
check that adding a fourth disturbed none of them. It grants SELECT on one catalog view and states its own
inverse; it does not grant BYPASSRLS or superuser, because the privilege it lets an audit *read* is not a
privilege to hand out.

**The two laws that keep it from returning.** `libs/trading-core/tests/test_repo_reference_integrity.py`
(311 lines, 4 tests) requires every path a comment, a message or a document names to resolve - with the
exemptions argued in its docstring rather than listed: runtime artefacts like a dataset's `status.json`,
the `docs/dr/` ledgers an operator writes, fixture strings inside test files, sentences about renames, and
the handover documents, which are records of a diff at a moment.
`libs/trading-core/tests/test_env_example_coverage.py` (195 lines, 6 tests) requires every
environment-facing field a Python service declares to be named in an example file, requires every name those
files document to be read by something in the tree, refuses a name assigned twice in one file, and refuses a
`${NAME:?}` compose expansion the example file never mentions. A third file,
`libs/trading-core/tests/test_net_signed_sender.py` (264 lines, 20 tests), covers `net/signed_client.py`,
the one module that puts an API key on a socket, whose plaintext refusal had never been asserted even
though the unsigned sibling client's identical law has been since Part 9.

**The seven sentences.** Two rows of `docs/SECURITY.md`'s tenant table, a code-block label in
`docs/MULTI_TENANCY.md`, and references in `docs/PART13_DURABLE_STORE.md`, `docs/PART19_LIVE_ENABLEMENT.md`,
`docs/PART2_TRADING.md` and `docs/PART16_CORE_LAYER_GAP_AUDIT.md` named files or directories that were not
there - wrong directory, renamed document, a module that became a package in Part 8, and a coverage count
Part 17 moved from 42 to 43. A comment in `apps/api/src/modules/observability/engine-posture.service.ts`
pointed at the module's spec under a name missing a word; the file that exists is
`engine-posture.service.spec.ts`. In every case the mechanism was sound and the pointer was not, so the
pointer was fixed and nothing else moved - and the law described two paragraphs above bit this sentence
first: an earlier draft of it named the dead path in backticks, and a document that tells a reader to
open nothing is exactly what the check exists to refuse.

**What the second pass found, once the laws were in place.** A law is only worth what it catches next,
so the sweep was run again over the documentation surface, and it caught three things the first pass had
not asked about:

* **`.env.example` assigned three names twice.** `LOG_FORMAT` at `pretty` in the logging section and `json`
  in the shared section, `MARKET_DATA_SYMBOLS` at the same value in two sections, and
  `MAX_RISK_STATE_AGE_MS` at 5000 and 2000. The first two were presentation; none of them were harmless,
  because dotenv honours the first value of a repeated key while docker compose's `env_file` honours the
  last - which makes "what does the deployment get" a property of the loader rather than of the file. Each
  name is now assigned once, and the sections that lost their assignment say where the value lives.
* **The disagreement the deduplication exposed is left standing, on purpose.** `MAX_RISK_STATE_AGE_MS` is
  one name read by three planes whose code defaults differ: the execution plane's parser falls back to
  5000 (`wlct_trading/execution/config.py:377`), while `services/trading-engine/app/config.py:89` and
  `packages/config/src/env.schema.ts:405` both default to 2000 - and `wlct_trading/slo/catalog.py:27`
  derives its 4-second freshness SLO from the 2000 figure. An unset deployment gates a submission in the
  execution plane on a snapshot the trading engine would refuse. Choosing one of those numbers is a risk
  decision with a trading consequence, so the file documents the conflict and does not resolve it; the
  single assignment it keeps is the tighter value, which is what a deployment that sets the name explicitly
  will get in every plane.
* **A field was dead and a docstring said it could not be.** `apps/api/src/modules/health/health.service.ts:32`
  reads `process.env.GIT_COMMIT_SHA` with an `unknown` fallback, and nothing in this repository ever
  supplied it - no compose entry, no build arg in `infrastructure/docker/api.Dockerfile`, no line in
  `.env.example`. Meanwhile `apps/api/src/config/app-config.module.ts` asserted in its own docstring that
  "Nothing else in the codebase reads `process.env` directly", which three call sites had quietly disproved.
  Both sentences were wrong in opposite directions - one about a mechanism that did not exist, one about an
  invariant that did not hold. The docstring now names the two build-metadata reads and why a commit stamp is
  not a configuration knob; `.env.example` documents both names and says plainly that a build from this tree
  answers `unknown` until a CI supplies one; and
  `apps/api/src/config/env-example-coverage.spec.ts` (136 lines, 5 tests) refuses the pattern returning -
  every `packages/config/src/env.schema.ts` key documented (all 236 already were), one active assignment per
  name, every direct `process.env` read either a schema key or a documented name, and
  `validate: validateEnvironment` still wired into the module, because a parity test on a seam has to check
  the seam is installed. Spec files are skipped when collecting direct reads, for a stated reason: a test
  setting a variable is describing a scenario, not widening the deployment surface.

**The eleven findings that were wrong, and why they are listed.** A gap sweep that reports only its hits is
a sweep nobody can calibrate. Twenty-two execution-engine settings looked undocumented because the first
version of the audit read the root `.env.example` and not the service's own file; six of the names had been
documented there from the start and the rest were in one file or the other too, so the true count was zero -
which is why the test that came out of this reads both and says so in its failure text. Five `wlct_trading`
modules looked untested because the check asked whether a test file named the *module*, and tests import
functions, not modules: `walkforward`, `microstructure`, `deterministic_example` and `timesync` all have
tests that exercise them by symbol. `PRISMA_ONLY_DSN_PARAMS` looked like an undocumented setting and is a
module-level frozenset of DSN query parameters, not a setting at all. `apps/api/prisma/rls/grant.sql`'s
absence, by contrast, was found twice: once by a message and once by the sweep - the difference being that
a message is something an operator reads at 3 a.m.
**One gate that did not exist.** Sweeping the tree also swept the sweep: `services/notification-service` has
a `tsconfig.json`, a `typecheck` script and 582 lines of TypeScript, and the root `package.json`'s
`typecheck` aggregate ran only `@wlct/api` and `@wlct/admin-web` - so the third TypeScript deployable was
compiled by `npm run build` and typechecked by nothing, and it has no test script or spec files of its own
either. Its `tsconfig` is now in the aggregate, which passed on the first run (exit 0, clean today), and
the gap that remains is stated rather than papered over: a service with no tests has a stricter typecheck
gate and still no behavioural one, so the notification plane is verified by compilation and by its callers'
expectations, not by itself.
**What was deliberately not changed.** `services/execution-engine/app/routers/__init__.py` and
`services/execution-engine/tests/__init__.py` are empty where their sibling services have one-line
docstrings; they are valid Python, and the only handover that embeds them is Part 11's, which is not in the
regeneration chain - so the cosmetic gain was not worth silently invalidating a byte-exact record. The
pre-16 handovers that embed `docs/MULTI_TENANCY.md`, `docs/PART13_DURABLE_STORE.md` and
`docs/PART2_TRADING.md` were left as generated: the project keeps 16 through 22 byte-fresh and treats
earlier documents as records of their moment, which is a limitation of this workspace rather than a
decision to leave a record wrong on purpose. Nothing in the trading path changed: no engine, API, worker,
schema, migration, risk or placement file was touched, and the numbers in section 7 are the numbers this
sweep re-ran.
