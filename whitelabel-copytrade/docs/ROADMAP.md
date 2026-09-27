# Roadmap

Part 1 is the foundation. Everything below builds on it in an order chosen so
that each part is shippable, testable and reversible on its own.

The ordering rule: **nothing that touches money ships before the thing that
constrains it.** Risk, limits and audit come before execution; execution comes
before automation.

---

## Part 1 - Foundation (delivered)

Multi-tenancy, identity, RBAC, security, the API skeleton, the admin console
foundation, the mobile foundation, service skeletons, Docker.

Execution is hard-disabled.

---

## Part 2 - Exchange connectivity (non-custodial)

**Goal:** a user can securely attach a real exchange account, and the platform
can read from it. Still no order placement.

* Prisma: `ExchangeAccount`, `ExchangeCredential`, `ExchangeBalanceSnapshot`,
  `ExchangeAccountAudit`.
* Credential intake: submitted once, encrypted with envelope encryption at the
  edge, never returned. A validation call proves the key works and, critically,
  proves that withdrawal permission is **absent** - a key with withdrawal rights
  is rejected outright.
* `trading-engine`: real `ccxt` clients per venue, per-account rate limiting,
  a circuit breaker per venue, clock-skew detection.
* Read-only endpoints: balances, positions, open orders, trade history.
* `market-data`: authenticated feeds, websocket ingestion, the streaming flag
  turned on.
* Mobile and admin: connect-account flow, balance display.

**Ships when:** a real exchange key can be attached, validated and read from,
and the plaintext secret is provably absent from the database, the logs and
every API response.

---

## Part 3 - Trader profiles and strategy definitions

**Goal:** the objects copy-trading will reference, with no copying yet.

* Prisma: `TraderProfile`, `Strategy`, `StrategyVersion`, `PerformanceSnapshot`,
  `TraderFollowerLink`.
* Verified performance only: metrics are computed from executed fills recorded
  by the platform. No self-reported numbers, no backtests presented as results.
* Trader onboarding and approval, with a compliance gate.
* Discovery: search, filter and rank traders.
* Admin: trader approval queue, performance review.
* Mobile: trader list and detail screens.

**Ships when:** a trader can be onboarded and approved, and their performance is
derived exclusively from platform-recorded fills.

---

## Part 4 - The copy engine (paper first)

**Goal:** the full copy pipeline, executing against paper accounts only.

* Prisma: `CopySubscription`, `CopyRule`, `SignalEvent`, `MirrorOrder`,
  `PaperFill`.
* Signal pipeline: detect a leader's fill, translate it through the follower's
  sizing rule, apply risk, place a paper order.
* Sizing modes: fixed notional, proportional to equity, fixed multiplier.
* Risk per follower: max notional, max open positions, max leverage, per-symbol
  allow/deny, daily loss cap.
* Latency budget and slippage accounting, measured and exposed.
* Reconciliation: a periodic job that detects and reports divergence between the
  intended and actual mirrored state.
* `EXECUTION_ENABLED` stays `false`; `paper_trading` stays on.

**Ships when:** a follower's paper account mirrors a leader correctly under
adversarial tests - partial fills, rejects, disconnects, duplicate signals - and
reconciliation reports zero unexplained divergence.

---

## Part 5 - Live execution

**Goal:** real orders, on the user's own exchange account.

This is the highest-risk change in the project and gets treated accordingly.

* Order state machine with idempotency keys; a retried request never
  double-places.
* Exchange error taxonomy: which errors are retryable, which are fatal, which
  require human review.
* Kill switches: platform-wide, per tenant, per trader, per follower.
* Position reconciliation against the exchange as the source of truth.
* Progressive rollout: an allowlist of accounts, then a percentage rollout via
  the existing feature-flag bucketing.
* A dry-run mode that logs the exact payload that *would* be sent.

**Ships when:** a full audit trail exists for every order, every kill switch is
verified under load, and reconciliation has run clean for a sustained period on
the allowlist cohort.

---

## Part 6 - Billing and monetisation

* Payment provider integration (Stripe first). The platform stores no card data;
  it holds provider references only.
* Performance fees: high-water mark accounting, crystallisation periods,
  trader revenue share.
* Invoices, dunning, and a subscription lifecycle driven by provider webhooks
  with signature verification and replay protection.
* Payout ledger for trader earnings.

Money movement is double-entry from day one. A single-entry ledger is not
auditable and cannot be reconciled.

---

## Part 7 - Compliance and operations

* KYC/AML provider integration behind the existing `KycProfile` model.
* Jurisdiction rules: which tenants may onboard users from where.
* Suitability and risk questionnaires; risk-profile gating on copy limits.
* Data subject rights: export and erasure, honouring audit-retention duties.
* Regulatory reporting exports.
* SIEM export for the security event stream.

---

## Part 8 - Scale and reliability

* Read replicas and query routing.
* Time-series storage for market data and performance history.
* Horizontal scaling of the copy engine with partitioned work and leader
  election.
* Row-level security in Postgres as defence in depth behind the application-layer
  tenant scoping.
* Full observability: OpenTelemetry traces, RED metrics per endpoint,
  service-level objectives with alerting.
* Chaos testing: exchange outage, Redis failover, database failover.
* Disaster recovery with a rehearsed, timed restore.

---

## Cross-cutting work, continuous

| Track | Detail |
| --- | --- |
| Testing | unit, integration against a real Postgres, contract tests between the API and the Python services, load tests on the copy path |
| Security | dependency scanning in CI, an external penetration test before Part 5, secret-rotation drills |
| Documentation | an ADR for every consequential decision; an operational runbook per service |
| Accessibility | WCAG 2.1 AA on the admin console; screen-reader support in the mobile client |

## Sequencing constraints

These cannot be reordered:

1. **Part 2 before Part 4.** No copying without a validated exchange connection.
2. **Part 4 before Part 5.** Paper trading is how the pipeline earns the right
   to touch real money.
3. **Risk limits before execution.** The constraint ships before the capability.
4. **Audit before money.** Every financial action must be reconstructable from
   the audit trail on the day the feature launches, not retrofitted afterwards.

---

## Delivery log (as of Part 9)

The delivered parts renumbered relative to this early roadmap (which described
a backlog, not a sequence contract). What has shipped, with its authoritative
document:

| Part | Delivered | Document |
| --- | --- | --- |
| 1 | Platform foundation: multi-tenancy, auth/RBAC, audit, API + admin console + mobile skeletons, the pre-trade risk engine skeleton, connectivity transport | docs/PART1_*.md |
| 2 | Trading core library: order book, market data pipeline, clock/latency discipline | docs/PART2_*.md |
| 3 | Billing, notifications, feature flags, security-event pipeline | docs/PART3_*.md |
| 4 | Execution engine and exchange adapters (authenticated REST/WS, paper-first) | docs/PART4_*.md |
| 5 | Live execution control plane: credentials, kill switches, reconciliation, execution incidents | docs/PART5_*.md |
| 6 | Strategy layer: definitions, instances, backtest and paper sessions, metrics | docs/PART6_*.md |
| 7 | Historical datasets: ingestion, manifests, validation, storage, replay | docs/PART7_*.md |
| 8 | Real-time risk engine: the authoritative fail-closed gate, 22-rule catalog, snapshots, reservations, rate windows, switch lifecycle, risk console (+ read-only mobile viewer) | docs/PART8_RISK.md |
| 9 | Observability & operations: Prometheus exposition (both languages, cardinality-lawed), health/readiness/trading-readiness, alert fold with durable dedupe, incident correlation, shared redaction, queue observability, operations console | docs/PART9_OBSERVABILITY.md |
| 10 | Reliability: OTLP tracing (both planes, sampled, redaction-bound, honest export accounting), SLO/error-budget evaluator with burn alerts, queue-depth law, fault injection (non-prod, self-disabling), production config guards | docs/PART10_RELIABILITY.md |
| 11 | Scale & coordination: cross-language lease/partition foundation (fixture-pinned), the trading-worker plane (partitioned TRADE_EXECUTION consumer with deferral accounting and a strict engine failure taxonomy), services/execution-engine hosting the real core ExecutionEngine (simulated; live refuses by code), read-replica fail-closed routing policy, read-only worker ops view, generated + spec-pinned row-level security (dormant until the checklist-gated enablement), DR manifest with validator and timed-drill contract | docs/PART11_WORKER_SCALING.md, docs/DR.md |
| 12 | Self-registering worker membership (heartbeat-zset registry, fixture-pinned staleness law, config list demoted to fallback, resign-on-shutdown fast path, registry read in the ops view) and the DR backup-freshness ledger (manifest cadences or explicit waivers, --due grading with a cron-able exit code, --record with secret-scan and parse-refusal) | docs/PART12_WORKER_MEMBERSHIP.md, docs/DR.md |
| 13 | Durable execution-engine store: PostgresOrderStore over the core OrderStore port (orders/events/fills/reconciliation state), engine_* tables in Prisma with automatic RLS coverage and per-transaction tenant GUC, opt-in EXECUTION_STORE_BACKEND with no silent fallback either direction, and the worker ack-policy re-review that turned the durable-engine tripwire into a coherence check | docs/PART13_DURABLE_STORE.md |
| 14 | Journal retention: the core's pure retention law (terminal_at-not-status, whole-story-or-none, nonsense-proof policy), the engine executor over the store's own transaction contract (one deletable table, seq-listed batches, ceiling-then-resume), the never-pruned `engine_retention_runs` ledger with dry-runs recorded, apply dark behind config, and the cron-able tenant-per-call CLI with exit-code law | docs/PART14_RETENTION.md |
| 15 | RLS enablement made VERIFIABLE, read-only: the core's pure enablement law (probe shape, platform-scoped bare-read exception, role-attribute veto, pass/fail/unverified grading, nonsense-proof evidence window), the engine's six-statement audit executor (scoped count inside the tenant transaction, bare count outside it, nothing seeded, no write verb by construction), one internal endpoint that answers 200 with a FAIL finding, `scripts/rls-enablement.mjs` (audit/check/print-sql) with no database access of its own, and the append-only `docs/dr/rls-evidence.jsonl` ledger aged by `dr-manifest.mjs --check-rls` under a manifest-declared cadence | docs/PART15_RLS_ENABLEMENT.md |
| 16 | Placement attestation made a GATE rather than a second rejection path: the core's pure review law (absence outranks everything, the review can only tighten, staleness and skew are findings, six rules ending in a digest-stable verdict id over canonical JSON), four gatherers behind one ABC (unattested / local / a TTL cache keyed by the ORDER SHAPE after a coarse key proved to be a fail-open / Binance over the deployment's own signed adapter and weight budget), the service's eight source-and-cost knobs with no enable switch and production `environment` refused at Settings construction, one internal endpoint that answers 200 with a refusal because a refusal is data and carries `transmitted: false` as a constant, that posture published on `/status` as a typed block (the credential SOURCE and the gatherer's provenance, never a key), the venue package's export rule written down and tested rather than improvised, and live mode still refused at boot with the four remaining prerequisites listed in order | docs/PART16_PLACEMENT_REVIEW.md |
| 17 | Incident records made as durable as the orders they explain: the engine plane's own `engine_incidents` table (BIGSERIAL read order, uuid identity unique by constraint, VARCHAR vocabularies, no composite FK to orders, tenant FK that restricts), the SQL sink over the same pool as the store with the write law that never raises and the read law that never lies, the composition refusal for a durable store paired with a memory sink (and the mirror), one internal read route that returns 503 rather than an empty list, the sink published on `/status` through a typed view, and the fifth engine-plane table inside the generated row-level-security set (43 covered) so the audit can prove the isolation | docs/PART17_DURABLE_INCIDENTS.md |
| 18 | The engine's measurements made readable at the edge of the process that produces them: `GET /metrics` on `services/execution-engine` over the core's lawed registry (29 counter families DERIVED from `ExecutionCounters`' fields so an exporter cannot fall behind its instrument, one `stage`-bounded histogram copied whole per scrape instead of re-observed, seven wiring gauges read from `describe()` rather than from settings so a renamed key publishes 0 instead of a guess, and a reset counter because `inc` refuses a negative amount), the four spans the engine actually contains timed with the eight stages that cross a process or transport boundary left unrecorded and the reason written down, the shared adapter's nine-part cumulative double-accumulation found and killed by the first process that ever rendered it, `OBSERVABILITY_ENABLED` with production refusing it off (the knob `docker-compose.yml` had been passing to this service unread since the block existed), and the instrument the service had never handed its engine - which is how the counters Parts 5-17 documented as measurable were being accumulated by nothing, plus the three Python image commands that could never start a process (an `app.main:app` target this module does not define, and a `--log-config /dev/null` that `logging.config.fileConfig` has refused since python 3.11) | docs/PART18_METRICS_EXPOSITION.md |
| 19 | Live enablement made AUDITABLE without being made possible: the credential provider selection given its one concrete fetcher (`VaultKvSecretFetcher` over KV v2 - https-only with `user:pass@host` refused even over TLS, mount and path template validated at boot, identifiers matched against `[A-Za-z0-9._-]{1,64}` BEFORE a request is built, the rendered path bounded at 512 characters, the response bounded at 1 KiB..4 MiB and refused without being consumed, every non-200 one refusal that keeps its status and drops its body, and no field on `Settings` that could hold the token), the operator confirmation as a typed record rather than a flag (`LiveOperatorConfirmation`: HMAC-SHA256 over sorted-key canonical JSON, a 90-day ceiling on the window expressed in milliseconds against microsecond stamps, `nonce` >= 16 so two ceremonies over one scope are not byte-equal, `symbols`/`orderTypes` scoped per axis with an empty set meaning `all-configured` and never `nothing`, `SCOPE_MISMATCH` naming which axis, and no `required` without a key), the confirmation graded per order by the existing six-group law instead of a parallel gate (`CONFIRMATION` findings on the verdict, a reviewer that refuses to be built when the policy asks and nothing was supplied, a verifier that RAISES becoming a blocking `UNVERIFIED` naming the exception type and not its message), the axis that makes the whole picture countable (`ReviewArea`, seven areas, seven derived counters taking `ExecutionCounters` to 36 ints and the exposition to 36 families with no exporter change, `blocking_areas` in declaration order so one refusal renders one list), the live-enablement report graded from the wiring this process built rather than from a settings dump (eight `LivePrerequisite`s, `LIVE_*` codes spelled from the enum so they cannot disagree, `hardBlockersPresent` naming the one absence no configuration reaches, prose for the operator and names for machines), `/status` and `/health/ready` carrying the report plus a `public_summary()` whose fingerprint is 12 hex characters because an unauthenticated route may correlate a ceremony and must not reproduce it, boot log fields renamed `provider*` because `RedactionFilter` scrubs any credential-SHAPED KEY and `[REDACTED]` where 'which fetcher did I get' belongs is a boot line nobody can debug from, and 174 tests across five files - `EXECUTION_MODE=live` STILL refused, with the refusal now printing what it was graded against | docs/PART19_LIVE_ENABLEMENT.md |
| 20 | The operational tail's last two code-able gaps, both display and derivation and neither a gate: `/internal/v1/status` given ONE strict TypeScript mirror (20 keys, required-and-defaulted read differently, unknown keys reported, a spec that parses `schemas.py` and refuses to let the languages drift), and the engine's posture rendered on the ops panel as `ENGINE POSTURE` with a tone law in which absence never reads as health; plus `docs/dr/schedule/dr.cron`, generated from the manifest's cadences by `dr-manifest.mjs --emit-schedule` and drift-gated by `--check-schedule`, which may schedule the three read-only modes and never the ledger's writes. And one defect the audit only found by running the composition: `/internal/v1/status` demanded a tenant header its only caller cannot send, so `assertEngineCompatible()` got a retryable 400 and the reference worker exited 1 at startup - fixed by splitting the engine's internal law into a command scope (refusal text unchanged to the byte) and a read scope used by exactly one route and pinned by a route-table walk, with `docker-compose.yml` pointed at the engine so the new panel lights up. 3 Python files and 1 compose file moved; no gate, verdict or refusal threshold did, and live still refuses at startup, unchanged. `docs/PART20_ENGINE_STATUS_EDGE.md` |

Still open from the original backlog, deliberately NOT absorbed: time-series
storage behind the exposition (metrics are published, not retained; retention
beyond the durable alert/incident state remains future work - Part 14 closed
the EXECUTION STORE's journal retention, docs/PART14_RETENTION.md, which is
a different table and a different problem, and this item's wording is kept
deliberately so the two are never conflated), RED dashboards
beyond the built-in panel, disaster-recovery rehearsals, and the remaining
Part 8-scale items - enabling the shipped row-level-security policies in
staging per the enable.sql checklist (the Part 13 engine tables are
and Part 17's incident table are covered by the same generated machinery (43
covered tables today), so enabling remains one checklist for every tenant table - Part 15 did NOT retire that operator step, it made
enablement auditable, gradable and age-trackable afterwards, so the open item
is now "run the audit on staging", see docs/PART15_RLS_ENABLEMENT.md), the
full
chaos/failover matrix against real infrastructure (the invariants are
unit-pinned; a staging run remains a deployment step, see
docs/PART11_WORKER_SCALING.md sec. 18). Part 12 retired two items from this
list: worker membership is now self-registering (WORKER_MEMBERSHIP_MODE,
docs/PART12_WORKER_MEMBERSHIP.md) and backup cadence has its checking
mechanism (`dr-manifest.mjs --due`, exit-code alertable); Part 13 retired
the durable execution-engine store wiring (docs/PART13_DURABLE_STORE.md -
the store ships, the schema is Prisma-owned, and the worker gate's
ack-policy condition is resolved). Part 18 retired one backlog item and none of the deployment-side ones: the numbers a scrape needs are now published by the process that measures them, while the alert rules, the dashboards and the scrape targets stay in the deployment (docs/PART18_METRICS_EXPOSITION.md). Part 16 shipped its layers dark (docs/PART16_PLACEMENT_REVIEW.md) and retired no deployment item on purpose: the review now runs on every order a runtime could transmit and on paper orders only in practice, and the live path's remaining prerequisites - venue attestor instance, per-tenant key source, signed transport with an egress allowlist registered at the venue, durable store and distributed locks - are named there in order rather than implied. Part 19 retired the per-tenant key source and left the rest of that sentence standing, with one correction worth naming: the list is now COMPUTED from the wiring a process built instead of asserted in prose (docs/PART19_LIVE_ENABLEMENT.md sec. 7), and it reports `DISTRIBUTED_LOCKS_WIRED` as unsatisfied for a different reason than `SIGNED_TRANSPORT_WIRED` - the core already ships a Redis lock manager and `app/composition.py:338` does not select it, whereas nothing in this build could be put over a signed transport that was never constructed (the same section's note on the two kinds of absence). Two of the five items Part 19 was asked to close were already shipped by Parts 13-18, so its diff is the fetcher, the confirmation, the counting axis and the report, plus tests pinning the eight items the audit found done. What remains of
the backup item is deployment-side WIRING of that command into a scheduler
- the ledger refuses to fake its own seed data, so the first real
`--record` is the first real backup evidence. Part 20 shipped the scheduler side of that
sentence's first half - the schedule is a generated file with a drift gate rather than a
habit (`--emit-schedule` / `--check-schedule`, `docs/dr/schedule/dr.cron`,
`docs/PART20_ENGINE_STATUS_EDGE.md` sec. 6) - so what is left is the one command a host
runs (`crontab <file>`) and, still, the first real `--record`.


Part 21 took the operational tail end of this list and made it checkable, without
pretending to be infrastructure. `scripts/dr-schedule-install.mjs` installs, verifies,
idempotently re-applies and removes the generated schedule in a host crontab, refusing
on any drift it would have to author and exiting 4 rather than lying about a host with
no cron; `scripts/dr-rehearsal.mjs` is the drill record as data - a deterministic plan
built from `restoreProcedure`, per-component path and environment-name preflight, four
allowlisted probes, closed grades (pass/fail/unverified/planned/skipped), production and
unknown targets refused before anything is read, `--execute` gated on a confirmation that
must echo the plan's own hash, and an append-only evidence line that cannot legally
record a dry run as a pass; `--status` folds those laws into one exit code.
`scripts/dr-manifest.mjs --verify-rls` answers "what is verified about row-level security
right now" in machine-readable form - 43 covered tables agreeing in both directions with
enable.sql and disable.sql, matching schema stamps, and an evidence ledger that has never
been written, which is why the grade is `UNVERIFIED` and the tool's own `enabled` field is
`null`: verifying the scope of a policy is not the same act as claiming enforcement
(docs/PART15_RLS_ENABLEMENT.md remains the enablement path, unchanged). The chaos and
failover matrix is now a module rather than a paragraph
(`wlct_trading.observability.chaos`: ten scenarios A-J, each with setup, injection, the
invariant the runbooks already assert, observation, recovery, cleanup, a bounded timeout,
and a fault point drawn only from the closed set in `faults.py`), and a run in this
repository grades all ten `UNVERIFIED` and exits 2 by design - a harness result is labelled
`source=harness` and cannot be laundered into an infrastructure claim. RED is a *view*
(`wlct_trading.observability.red`) over the registry families the services already
register, rendered as existing `DashboardRow`s, with `no-data`, `zero-traffic`,
`measured`, `healthy` and `over-budget` kept distinct and with no default error budget
anywhere in the file: a verdict requires a caller-supplied `RedBudget` that names its
source, so the SLO and alert catalogs stay the only thresholds the platform has. What
remains open after Part 21 is the part no repository can close: running the drill, running
the matrix against real processes, wiring a scrape and a dashboard export into a
deployment, and the first real `--record`. Part 22 has since taken the scrape half of
that sentence (below): the jobs, the rule file and the reader now exist as generated files
under `infrastructure/observability/`, and the 17 catalog rules that carry `threshold: None`
still refuse to render rather than being given numbers they never had
(docs/PART21_DR_OPERATIONS.md, docs/PART22_SCRAPE_SIDE.md).


Part 22 took the deployment half of Part 18's boundary and made it a file in the tree.
`libs/trading-core/scripts/gen_observability_bundle.py` renders `infrastructure/observability/` -
a scrape config whose four jobs, two paths and one header come out of `docker-compose.yml`, each
service's own `@router.get("/metrics")` and `.env.example`; a rule file in which every numeric
literal must appear in the `AlertRule` it is derived from; and a JSON catalog carrying the evidence
field by field - and refuses to invent the rest. 4 of the 24 catalog rules became alerts and the 20
that did not are listed with the reason each stayed unwritten (17 have `threshold: None`, 3 name a
unit no registered family in this tree exposes), because a rules file is where an invented number
goes to look official. No cadence and no dwell time are declared anywhere in the repository, so
none is emitted; there is no relabeling and no `external_labels`, because `labels.py` decides
cardinality at registration and the monitoring side does not get a route around a law the code
cannot break; the single rule that is not in the catalog is `WLCTScrapeTargetDown`, whose only
literal is the `0` that defines a failed scrape, with its job list generated from the same evidence
as the jobs, so a target that cannot be reported down is not possible.
`docker-compose.observability.yml` adds exactly one service - `prom/prometheus:v3.5.0`, pinned
because `http_headers` needs >= 2.53 - mounted read-only, published on `127.0.0.1`, with no
lifecycle endpoint and no retention flag, and `--check` reads it back through structural laws
against the parsed service block rather than by grepping text, so the banner explaining those
absences cannot itself trip the check. No Alertmanager (the platform owns the alert lifecycle, and a
second store of the same alerts is a second truth to reconcile), no Grafana JSON (the dashboard
format this repository owns is the section/row document, which `--dashboard` renders from scraped
exposition with a strict-name absence census printed beside it), no collector, no exporter, no
paging, and no container run: the bundle has never been read by a real Prometheus, which the part
document states as its verification edge rather than as a detail. 41 tests, most of them asserting
that an audit objects when it should, on top of the one that makes the rest reviewable - the
committed bundle is byte-identical to a fresh render (docs/PART22_SCRAPE_SIDE.md).


The sweep after Part 22 (2026-09-19) was a gap audit rather than a feature: every file in the tree was
checked for emptiness, for `pass` bodies outside abstract interfaces, for unresolved first-party imports,
for compose references, for settings with no documentation, for modules with no test and for paths with no
file. One artefact was genuinely missing and it was the one an operator reads at 3 a.m.: the execution
engine's `503 ENABLEMENT_ROLE_UNKNOWN` instructs whoever sees it to apply Part 11's `grant.sql`, and no
such file had ever been written. `apps/api/prisma/rls/grant.sql` now exists (48 lines, SELECT on one catalog
view, its inverse stated, no BYPASSRLS and no superuser) and is emitted by `scripts/gen_part11_rls.py`
beside the enable and disable scripts it belongs with, so the directory stays reproducible from
`schema.prisma` and the three existing artefacts came out byte-identical. Two laws came with it, because a
fix without a law is a fix until the next part: `tests/test_repo_reference_integrity.py` refuses a
path named by a comment, a message or a document that does not resolve, with every exemption argued in the
docstring rather than skipped; `tests/test_env_example_coverage.py` refuses a settings field no example
file names and an example file name nothing reads. A third file, `tests/test_net_signed_sender.py`, covers
the one module in the library that puts an API key on a socket, whose plaintext-endpoint refusal had never
been asserted although its unsigned sibling's has been since Part 9. Seven sentences were also wrong - two
`docs/SECURITY.md` table rows naming directories that never held those files, a `docs/MULTI_TENANCY.md`
code-block label, three cross-references to documents that were renamed or never written, and a gap audit
still quoting 42 covered tables where Part 17 moved the generated set to 43 - and each mechanism was sound
while only its pointer was stale, so the pointer was fixed and nothing else moved. Eleven of the audit's
findings were themselves wrong and are listed as such in docs/PART22_SCRAPE_SIDE.md §9 rather than quietly
dropped: the "22 undocumented engine settings" were documented in the service's own example file, and the
"five untested core modules" have tests that import their functions instead of naming their modules. No
file in the trading path changed; the bundle's `--check`, `--emit`, `--rules`, `--catalog` and `--dashboard`
gates and every suite above were re-run afterwards and are green (docs/PART22_SCRAPE_SIDE.md §9).

The second pass of that sweep - the same instruments pointed at the documentation surface - found three
things worth naming because each is a class rather than a typo. `.env.example` assigned three names twice,
one of them a risk budget (`MAX_RISK_STATE_AGE_MS` at 5000 and at 2000), which is not a style problem but a
loader problem: dotenv takes the first value of a repeated key and docker compose's `env_file` takes the
last, so the deployment's answer depended on which one read the file. Each name is assigned once now, and
the disagreement that deduplication exposed - the execution plane's fallback is looser than the trading
engine's and the API's, while the SLO catalog derives its 4-second budget from the tighter figure - is
documented as an open decision rather than resolved by a comment, because choosing a risk default is a
trading decision. `apps/api/src/modules/health/health.service.ts` read `GIT_COMMIT_SHA` that nothing in the
repository sets, while `apps/api/src/config/app-config.module.ts` claimed no other file reads
`process.env` directly; both sentences were corrected, the two build-metadata names are documented as
build-time rather than operator-set, and `apps/api/src/config/env-example-coverage.spec.ts` now refuses
either pattern returning, including a check that the validation seam itself is still wired. Row 11 and row 12
of `docs/PART16_CORE_LAYER_GAP_AUDIT.md` were carrying Part 16-era figures (22,999 core test lines, 42
covered tables) where the tree now reads 29,568 and 43; `services/notification-service` turned out to have
a `typecheck` script that the root aggregate never ran, so the third TypeScript service was compiled by
`npm run build` and typechecked by nothing until it joined `typecheck` (it passed unchanged, exit 0, and
still has no tests of its own - a gap named here rather than filled by invention), and the document's
live-mode section was quoting a
refusal paragraph `services/execution-engine/app/composition.py` no longer renders, so it quotes the graded
one instead and states which of its own items Parts 16 and 19 have since superseded (docs/PART22_SCRAPE_SIDE.md §9).

Records and freshness, said out loud rather than practised silently: the handover documents for **Parts 16
through 22** are kept byte-identical to a fresh generation, by the chain that regenerates them in order and
then checks them; the generators for Parts 11 through 15 still exist in `scripts/` and are deliberately not
re-run, because their headers would then print today's suites as though they had been measured for those
parts. The consequence is stated here rather than left to be discovered - a later edit to a file embedded
only in a pre-16 handover (the sweep touched `docs/MULTI_TENANCY.md`, `docs/PART13_DURABLE_STORE.md`,
`docs/PART2_TRADING.md`, and two empty `__init__.py` files under `services/execution-engine`) leaves that
earlier record describing the tree as it was, including Part 11's list, which does not contain the
`grant.sql` the sweep added to the directory Part 11's generator owns. The gap sweep's own script, and the
per-language census that sits beside it, stay outside the repository for a stated reason: both report on the
tree, so shipping them inside would let an instrument move the thing it counts - and a heuristic tool that
produces false positives by design belongs beside the tree as a review aid, while the durable conclusions it
reached moved inside as tests, where they can fail a build.
