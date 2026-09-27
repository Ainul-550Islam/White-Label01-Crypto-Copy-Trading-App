# Core trading / execution layer: gap audit (evidence, not assertion)

Written in response to a request framed as "Part 1 of 10: implement the first
major missing production layer - core trading engine, event processing,
execution abstractions, exchange adapter foundations, order lifecycle, failure
handling".

That premise does not match this repository. The layers it asks for were
built in Parts 1-15 and are shipped with their own handover documents
(`docs/PART*_.md`, `docs/PART*_HANDOVER_FULL_SOURCE.md`). This audit therefore
records, area by area, **where each requested capability actually lives**, and
names the gaps that are real. No production file was modified to produce it;
every line reference below was opened and read this session.

## 1. Verdict per requested area

| # | Requested | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | Core trading engine, order lifecycle incl. ack/partial fill/cancel/reject/timeout/retry/reconcile | Implemented | `wlct_trading/execution/engine.py` (1,516 lines); module header states the outcome table incl. `ambiguous -> stays SUBMITTED, marked UNKNOWN, incident, reconcile` and `It never retries, because a retry that the venue deduplicates is harmless and a retry that it does not is a doubled position` |
| 2 | Event system: typed envelope, timestamps, correlation + causation ids, tenant/source, handler error isolation | Implemented (in-process) | `wlct_trading/events.py` (155 lines): `TradingEvent.create()` sets `event_id`, `occurred_at`, `correlation_id` (self-rooting), `causation_id`, `tenant_id`, `source`; `InMemoryEventBus.publish` isolates handler failures into `handler_errors` instead of aborting the fan-out |
| 3 | Signal -> validation -> risk -> intent -> normalized order -> request -> result -> events | Implemented | `signals.py:277` (`generate_signal` is a strategy extension point, not a stub), `signal_to_intent()` resolves CLOSE against the position the engine holds; `execution/validation.py` (485); `execution/engine.py:543` risk gate + `_release_risk_slots()` (643-688) which returns budget when an order *might* exist; typed `ExecutionResult` with `outcome`, `requires_reconciliation`, `order_exists_at_venue` (130-208) |
| 4 | Execution domain: idempotency, duplicate submit, network failure, unknown response, partial fills, stale orders, cancel races, retry exhaustion, inconsistent state, incidents, reconciliation | Implemented | `orders.py` header (three ids, distinct jobs; `client_order_id` is the idempotency key) + `ORDER_STATE_TRANSITIONS` with the cancel-race edge documented; `execution/reconciliation.py` (847); `execution/incidents.py` (366) with severity/component/`retryability`/remediation (`resolved`, `resolution_note`); `execution/locks.py` (385); `execution/timesync.py` (346); duplicate handling as `ExecutionOutcome.DUPLICATE` (engine.py:731) |
| 5 | Binance adapter foundation: auth, signing, recvWindow, symbol normalization, submission, cancel, status, balances, open orders, fills, error normalization, rate limits, retry safety, idempotency, typed conversion | Implemented | `exchanges/binance/trading.py` (1,156): `signed()`, `_reserve(weight)`, `used_weight_1m`, `retry_after_millis`, venue-code normalization incl. `-1021` (timestamp outside recvWindow), `-1022` (bad signature), `-1100`; `submit_order(intent, client_order_id)` sends `newClientOrderId` (`:508-575`) precisely so a retry is the same order; `cancel_order` by `origClientOrderId`; `fetch_order`, `fetch_open_orders`, `exchange_time`, `stream_fills`. `exchanges/binance/adapter.py` (744) is the **market-data** adapter and is credential-free by design - its docstring says requiring a key there "would mean handling secrets in a service that has no need for them" |
| 6 | Normalized exchange interface for future venues | Implemented | `adapters/base.py` (458): `MarketDataAdapter`, `SymbolSpecification`, `AdapterRateLimitedError`, error taxonomy in `transport/errors.py` with `RETRY_POLICIES`; symbol normalization in `exchanges/symbols.py` (362); capability declaration in `binance/capabilities.py`; no venue branch inside the domain (enforced by `tests/test_risk_package_boundaries.py`-style boundary tests) |
| 7 | Strict transition validation | Implemented | `orders.py:51-99` explicit edge table ("anything absent from this table is rejected"), `TERMINAL_ORDER_STATUSES`/`OPEN_ORDER_STATUSES` in `enums.py:155-174`, and `engine.py:904-907` records an illegal venue status via `_record_illegal_transition` rather than forcing one |
| 8 | Idempotency for submission and execution commands | Implemented | deterministic `client_order_id` (orders.py header), `DUPLICATE` outcome, `execution/store.py` + `store_sql.py` unique order keys, worker-side dedupe in the Part 11 consumer, `coordination/lease.py` + `execution/locks.py` for single-writer order handling |
| 9 | Incident model | Implemented | `execution/incidents.py`: type, severity, timestamp, component, tenant/account, symbol, `orderId`, `clientOrderId`, `errorCode`, message, retryability, `resolved`/`resolutionNote`; `IncidentRecorder` port whose contract is "Recording must never raise into the execution path", `InMemoryIncidentRecorder` reference impl |
| 10 | Observability for this layer, no second system | Implemented | one registry per language with a cardinality law (`observability/labels.py:189-196` raises `CardinalityError`), `PIPELINE_TRANSITIONS` latency/transition metrics (`observability/metrics.py:113,448`), OTLP tracing with redaction (`observability/tracing.py`, `services/trading-engine/app/tracing.py`), engine spans tagging `outcome` (`engine.py:393`) |
| 11 | Deterministic tests incl. failure paths, transitions, idempotency, parsing, retry/timeout, reconciliation | Implemented | core `tests/` = 29,568 lines, 1,767 collected (the figures this row carried, 22,999 and 1,425, were Part 16's and had not been touched since); engine service `tests/` = 8,319 lines, 428 passed + 12 name-skipped live-Postgres tests; chaos/fault-injection tests exist (`tests/test_part10_faults.py`, `test_part11_observe_only.py` drives a publisher that raises). Two rows of this document's own evidence had gone stale by the 2026-09-19 sweep (row 11's counts, row 12's 42-table figure), which is why `tests/test_repo_reference_integrity.py` and `tests/test_env_example_coverage.py` exist: they police the documentation surface, not the code, and refuse a path claim that resolves to nothing and a settings knob that no example file names |
| 12 | Config, DB, migrations | Implemented | fail-closed `Settings` in `services/execution-engine/app/config.py` (332) and `services/trading-engine/app/config.py` (213); engine tables Prisma-owned with automatic RLS coverage (`apps/api/prisma/rls/enable.sql`, `rls_coverage.json`: 42 covered / 7 excluded at this writing, 43 since Part 17's incident table entered the generated set), migrations under `apps/api/prisma/migrations/` |
| 13 | Security: no logged secrets, env-only credentials, validated responses | Implemented | `execution/credentials.py` (730) with `redact_secrets`, `scrub_secret_like`, `UnsafeCredential`/`CredentialPermission`, and five providers (Static, Environment, SecretManager, Caching, Null); response validation in the parsers; secret-shape scanning in `scripts/dr-manifest.mjs` |

## 2. What is genuinely open

Named here in the repository's own words, not invented - and, as of the
2026-09-19 sweep, kept honest about *when*: the items below were true as
written in Part 16, several have since been built, and line numbers in this
document are Part 16's own (the reference-integrity law checks paths, not
line ranges, so a moved line is not what it catches).

`services/execution-engine/app/composition.py:457-467` refuses live mode with
the graded refusal the source renders now, from `wlct_trading/execution/live_enablement.py`:

```
EXECUTION_MODE=live is not wired in this build and is refused by code, not by
an unset default. Graded against the wiring this process actually built -
missing: credential source configured, credential fetcher wired, venue
attestor wired, operator confirmation accepted, durable store wired,
distributed locks wired, signed transport wired; satisfied: ip allowlist
enforced. Of those, signed transport wired cannot be satisfied by any
configuration available here: this composition root never constructs a live
venue adapter, so no environment value reaches into that absence and simulated
mode remains the only mode this build transmits in. No order was sent and none
will be.
```

1. **Live credential wiring.** *Superseded by Part 19*: the fetcher seam
   exists (`EXECUTION_CREDENTIAL_FETCHER=vault-kv2`, `app/secret_fetcher.py`)
   and a deployment on another KMS injects its own, which is what Part 16 left
   open and Part 19 deliberately did not close for anybody. What remains is the
   selector's counterpart: no composition branch constructs the *venue* side.
2. **The authenticated order-placement review.** *Superseded by Parts 16 and 19*:
   the review exists with permissions, symbol filter, per-account capability,
   key-age limits, an IP-allowlist requirement that `false` cannot relax, and an
   operator confirmation whose value is the hash of the plan being approved.
   The ladder now grades exactly one prerequisite as unmeetable here
   (`HARD_BLOCKERS = {SIGNED_TRANSPORT_WIRED}`), so the open work is the signed
   transport branch, the live/testnet base-URL selection, the enablement-evidence
   runbook the refusal names, and Part 5's progressive rollout - the last of
   which has no code anywhere in the tree (`grep -rl "allowlist cohort" .` finds
   the phrase only in prose).
3. **Event transport declared but not built.** `events.py` says "Ordering and
   delivery are the transport's job (a Redis Stream)" and `EventBus` says it is
   "implemented by the Redis and in-memory buses". Only the in-memory bus
   exists. The related consequence is measurable rather than implied: the
   engine's own publication seam is dead in production, because
   `ExecutionEngine._emit` returns early when no `publish_event` was injected
   (`execution/engine.py:1417`) and `services/execution-engine/app/composition.py:242`
   constructs the engine without one - `grep -rn publish_event` finds the
   parameter only in the core module and in core tests. The order facts are not
   lost (the store writes `engine_order_events`), but nothing outside the
   process is told: `grep -rn "xadd\|XADD\|xreadgroup\|xack" libs services apps packages`
   returns nothing, and `redis_keys.TRADING_STREAM` (`:27`) plus
   `RedisKeys.risk_events_stream()` (`:330`) have no callers outside their own
   declaration. `TradingEvent` has `to_wire()` and no `from_wire()`. Note the
   overlap risk before "fixing" this: the platform already moves side effects
   through BullMQ (`services/notification-service/src/main.ts` is a BullMQ
   `Worker` with explicit unknown-job handling) and already persists the
   durable facts (`engine_order_events` written at `store_sql.py:280`, read at
   `:284-288`; plus `OrderEvent`, `RiskEvent`, `AuditLog` in Prisma). A second
   fan-out path is only justified with a consumer that needs it.
4. **Operational items the ROADMAP keeps open** (`docs/ROADMAP.md:194-215`):
   time-series retention behind the Prometheus exposition, RED dashboards
   beyond the built-in panel, disaster-recovery rehearsals against real
   infrastructure, the `dr-manifest.mjs --due` -> scheduler wiring (the exit
   code exists, nothing runs it), and the full chaos/failover matrix against
   real infrastructure (the invariants are unit-pinned; the staging run is a
   deployment step).

## 3. What this turn deliberately did NOT build

* **No re-implementation of the requested areas.** Re-adding an order state
  machine, an incident model, a Binance trading adapter or an idempotency layer
  would either shadow the shipped one or fork it, and a fork in the money path
  is the exact failure this codebase is structured to prevent. The request
  itself rules it out ("do not duplicate functionality that already exists",
  "do not add code simply to hit a line-count target"); the audit is the
  honest response to a premise that does not hold.
* **No 20,000-60,000 new lines.** Nothing in this layer is missing at that
  scale, and the LOC ledger below is the measurement that says so.
* **No live mode.** `EXECUTION_MODE=live` still refuses at startup, unchanged.

## 4. LOC ledger, measured this session

Same rule as every prior part: line counts read off the files that exist now,
generated/vendored trees and lockfiles excluded.

| Tree | production | test |
|------|-----------:|-----:|
| `libs/trading-core` | 53,268 | 22,999 |
| `services/execution-engine` | 3,474 | 4,444 |
| `services/trading-engine` | 2,295 | 848 |
| `services/market-data` | 2,075 | 351 |
| `apps/api` | 42,027 | 7,160 |
| `apps/admin-web` | 6,644 | 0 |
| `services/notification-service` | 535 | 0 |
| `packages` | 6,050 | 0 |
| `scripts` | 5,911 | 878 |
| **Total** | **122,279** | **36,680** |

Whole tree (code only, no docs): **184,106** lines; including the docs tree
(narrative documents and the regenerable `docs/source/` views, minus the
handover dumps): **228,174**. New production code written this turn: **0
lines** - one document, this one, plus the measurements it quotes.

## 5. Gates (all re-run this session, on this tree)

| Gate | Result |
|------|--------|
| `cd libs/trading-core && python3 -m pytest -q` | 1,425 passed |
| `cd libs/trading-core && python3 -m ruff check wlct_trading tests` | green |
| `cd libs/trading-core && python3 -m mypy wlct_trading` | no issues, 145 files |
| `cd services/execution-engine && python3 -m pytest -q` | 195 passed, 12 skipped |
| `cd services/execution-engine && ruff check app tests` / `mypy app` | green / no issues, 16 files |
| `node --test scripts/` | 52 passed, 0 failed |
| `node scripts/dr-manifest.mjs --check` | valid, exit 0 |
| `node scripts/dr-manifest.mjs --check-rls` | exit 1 - no audit recorded (by design) |
| `cd apps/api && npx jest --silent` | 386 passed, 17 suites |
| `cd apps/api && npx tsc --noEmit` / `eslint src --max-warnings 0` | 0 errors / clean |
| `cd apps/api && npx prisma validate` | valid (needs placeholder datasource env; no `.env` is committed) |
| `cd apps/admin-web && npx tsc --noEmit` | 0 errors |
| `services/trading-engine` / `services/market-data` pytest | 43 passed / 19 passed |

## 6. Where the next part should go

The two self-declared gaps are the only places in this layer where a
production capability is missing rather than merely unwired, and both sit on
the live path, so they change the platform's risk posture. They are offered as
option A below; B and C do not touch the money path.

* **A. Complete the live-enablement pair** - live credential provider selection
  with permission attestation, and the authenticated order-placement review
  that has to exist before live mode is honest (permissions, symbol filter,
  per-account capability, key-rotation state, a recorded verdict per order).
  Live mode keeps refusing at startup until both are present and wired. Largest
  honest scope inside the requested area.
* **B. Finish the event plane** - versioned codec with `from_wire`, a Redis
  Stream transport implementing the existing `EventBus` port, and a consumer
  runtime with dedupe, dead-lettering and lag metrics - **plus** a named
  consumer that makes it non-redundant. Without that consumer it is a second
  fan-out path over ground that BullMQ and `engine_order_events` already
  cover, which is duplication with a new name.
* **C. The operational tail** - `--due` scheduler wiring, the chaos/failover
  matrix against real infrastructure, DR rehearsals, RED beyond the panel.
  Smallest risk; closes the ROADMAP's open rows.

Part 19 note: option A is closed end to end - its second half (a concrete credential
fetcher, a typed operator confirmation, an axis to count refusals by, and a live-enablement
report computed from the wiring rather than recited) shipped in
[`PART19_LIVE_ENABLEMENT.md`](PART19_LIVE_ENABLEMENT.md), with live mode still refused at
startup. B and C stand exactly as written above, including B's condition: an event plane
without a named consumer is a second fan-out over ground `engine_order_events` and the
BullMQ worker already hold, and nothing has since named that consumer.

---

**Disposition.** Both gaps named above were built in Part 16 and are
documented in [`PART16_PLACEMENT_REVIEW.md`](PART16_PLACEMENT_REVIEW.md): the
review is gate 11 of 11, the credential source is configuration with a refused-in-
production `environment` mode, and live mode remains refused at boot so the money
path is unchanged by the part that made it checkable.
