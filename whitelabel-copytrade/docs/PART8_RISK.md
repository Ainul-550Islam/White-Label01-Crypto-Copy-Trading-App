# Part 8 — Real-time risk engine: the authoritative gate

> **Risk controls reduce operational risk but cannot guarantee against all
> losses.** This sentence is the contract of the entire part. Everything
> below exists to make it true, precise and testable — not to oversell it.

Part 8 inserts an authoritative, fail-closed risk gate between SIGNAL /
ORDER INTENT and EXECUTION on **every** path that can put an order in front
of a venue, and gives operators a versioned control plane (limits, kill
switches, protection lifecycle, mirrored state) around it.

---

## 1. What was built, in one paragraph

The Python core's single-module `risk.py` (Parts 2/5) became a package,
`wlct_trading.risk`, whose `core.py` is the old engine verbatim. New
modules add the 22-rule catalog with per-rule units, a five-layer limit
hierarchy (GLOBAL → EXCHANGE → ACCOUNT → STRATEGY → SYMBOL) in which a
child can only ever tighten, automatic protection policies whose every
action removes capability, account kill switches with a five-state
lifecycle, a reservation ledger that projects open-order exposure, Redis
rate limiters, an immutable versioned risk snapshot with freshness
enforcement, and a `RiskGate` that composes all of it into one
approve/refuse decision per order. The API plane gets a `risk` module
(config versioning with digest binding and typed confirmation, switch
lifecycle, mirrored reads), the admin console gets a risk page with stop
and clear ceremony, and PostgreSQL gets additive tables. Nothing in this
part changes what a venue sees, except that fewer bad orders arrive.

## 2. The gate: where it runs and what "fail closed" means

`ExecutionEngine.submit` (Part 5) now evaluates, in order: validation →
safety gates → the core numeric risk engine → **the Part 8 RiskGate** →
symbol lock → reservation persist → transmit. The wiring is required:
if `ExecutionSettings.risk_gate_required` is true and no gate is attached,
the engine **refuses to construct**; if the gate is attached but no risk
state is supplied with the order, or the state raises, or the state is
stale, corrupt, or mismatched with the configuration digest, the order is
**refused**. A refused order is final: nothing in this part creates a
retry, bypass, override, or "submit anyway" path.

`RiskGate.evaluate` runs eleven stages, in order (each stage's refusal
emits a decision with the same shape as an approval, so telemetry can
count *why*):

| Stage | Check | Refusal codes (examples) |
|---|---|---|
| 0 | wiring: config complete, gate consistent | `GATE_MISWIRED` |
| 1 | request id assigned | — |
| 2 | core composed evaluation (`evaluate_numeric_limits=False` for the internal core — the catalog shadows it, deliberately) | core violation codes |
| 3 | tenant/simulated pairing, config-digest binding, `is_consistent` | `SNAPSHOT_CONFIG_MISMATCH`, `INVALID_RISK_STATE` |
| 4a/4b | account match; projection integrity | `INVALID_POSITION_STATE` |
| 4c | freshness budget (`MAX_RISK_STATE_AGE`) | `STALE_RISK_STATE` |
| 5b | balance sufficiency against projected use | `INSUFFICIENT_BALANCE` |
| 7a/7b | six-scope kill-switch scan with the risk-reducing exemption (only TRIGGERED/ACKNOWLEDGED can exempt; ACTIVE manual switches never do) | `KILL_SWITCH_ENGAGED`, `RISK_PROTECTION_TRIGGERED` |
| 8 | signed `exposure_delta` projection of the candidate order | — |
| 9 | rule catalog over projected state (22 rules × scopes, tightest applicable wins) | `RISK_RULE_*` codes, `UNVERIFIABLE_STATE` |
| 10 | rate windows consumed + ledger reservation taken (atomic) | `RATE_LIMIT_EXCEEDED`, `RESERVATION_EXCEEDED` |
| 11 | approval (with reservation handles attached to the outcome) | — |

Every non-approval outcome — and every post-gate failure that ends before
the order exists at the venue — releases the rate consumption and the
reservation. `outcome.order_exists_at_venue` is the only case that must
not release, and that predicate is checked once, centrally.

## 3. The rule catalog (22)

Catalog order is defined once, in Python (`RISK_RULE_ORDER` in
`wlct_trading/enums.py`); the TypeScript control plane mirrors it and a
jest test parses the Python source to assert equality, entry for entry.
Each rule declares its units; the API refuses an entry whose unit does not
belong to its rule.

```
MAX_STALE_DATA_AGE     MAX_ORDER_QUANTITY      MAX_ORDER_NOTIONAL
MAX_POSITION_QUANTITY  MAX_POSITION_NOTIONAL   MAX_SYMBOL_EXPOSURE
MAX_STRATEGY_EXPOSURE  MAX_CORRELATION_GROUP_EXPOSURE
MAX_EXCHANGE_EXPOSURE  MAX_ACCOUNT_EXPOSURE     MAX_OPEN_ORDERS
MAX_ORDER_RATE         MAX_CANCEL_RATE          MAX_DAILY_LOSS
MAX_STRATEGY_DAILY_LOSS MAX_DRAWDOWN           MAX_CONSECUTIVE_LOSSES
MAX_ACTIVE_STRATEGIES  MAX_TOTAL_VOLUME         MAX_FEE_BUDGET
MAX_PRICE_DEVIATION    MAX_LEVERAGE
```

Notable semantics:

* **Open-order reservation.** Exposure used by a new order is projected as
  `current ⊕ open reservations ⊕ candidate`. A reservation is taken inside
  the same atomic step that admits the order, so N concurrent orders in
  different processes cannot each be told "room for one more". Reduce-only
  orders are clipped at flat and never flip, so the projection can shrink.
* **Risk-reducing exemption — computed, not configured.** When protection
  triggered a switch, the exemption is decided per order by projecting the
  order against the *current* state: an order that would leave every
  gross bucket at or below where it stands now (or would improve a
  breached cap) may pass; anything that adds risk may not. There is no
  "close-only mode" toggle anyone can set wrong: no order-approval queue,
  no exempt-list UI, no flag. A manual ACTIVE switch halts everything,
  including risk-reducing orders — that asymmetry is deliberate: a manual
  halt is a human saying *stop*, a protection trigger is a system saying
  *do not add*.
* **Daily loss.** Realised net PnL for the UTC trading day, fees included
  by default; `dailyLossIncludesFees=false` and `dailyLossIncludesUnrealized`
  are explicit configuration (both travel in the canonical document, so
  both are auditable). `MAX_STRATEGY_DAILY_LOSS` is attributed through the
  strategy-tagged fill ledger.
* **Rate rules.** Only windows 1 000 000 µs and 60 000 000 µs exist —
  enforced at config-write time in both languages. Counts come from Redis
  fixed-window buckets shared across workers (a local fallback exists for
  single-process paper runs). A rate rule with no ceiling configured
  **denies** rather than assuming unlimited.
* **Correlation.** Groups are operator-declared only — name, exchange,
  members, optional group notional. There is no statistical correlation
  engine, on purpose: a live bet on the correlation matrix *is* a strategy,
  not a control. Group ceilings cap the union; they do not replace the
  members' symbol limits (the API enforces that each group with a ceiling
  has per-member `MAX_SYMBOL_EXPOSURE` entries).
* **Leverage.** Isolated-margin futures only; a spot account configuring
  `MAX_LEVERAGE` enabled is refused (it cannot be honoured). Ceiling < 1×
  is refused: no position satisfies it; disable the rule instead.
* **All money math is `Decimal`.** Floats are rejected at the DTO boundary
  (`@Matches` plain-decimal strings) and the stored document keeps the
  canonical `str(Decimal(x).normalize())` form — a TypeScript replica of
  that normalisation (including Python's scientific-notation rendering
  rules, `5000 → "5E+3"`) is fixture-tested against values generated by
  Python itself (`docs/fixtures/risk_digest_fixtures.json`, produced by
  `libs/trading-core/scripts/gen_risk_digest_fixtures.py`).

## 4. Snapshots, freshness, versioning — and the cache that isn't

A `RiskStateSnapshot` is immutable and content-addressed: a monotonic
`snapshot_version`, the trading day it belongs to, a digest of its state,
and **the digest of the configuration it was evaluated under**. The gate
refuses any snapshot whose `config_digest` does not match the live
configuration digest — which is how *changing config invalidates active
snapshots*: the next order simply refuses until a fresher snapshot (bound
to the new digest) is published by the state worker.

Freshness is integer microseconds compared against
`MAX_STALE_DATA_AGE` (deployment default 2 000 ms); the environment schema
refuses to boot if `RISK_SNAPSHOT_REFRESH_MS >= MAX_RISK_STATE_AGE_MS` —
the refresh cadence must outpace the staleness budget or the system is
just scheduled downtime.

**There is no decision cache, and none may be added.** A `RiskDecision`
is bound to `(snapshot_version, config_version)`; the same intent replayed
against the same *inputs* re-evaluates against *current* state. The guard
`decision_is_current()` exists so a caller can prove its decision is
stale-by-binding — never to reuse one.

## 5. Consistency model — stated honestly

The reservation ledger and rate windows live in Redis as hashes keyed by
account, mutated by Lua scripts that check-and-reserve in one atomic step
per account. Redis provides the atomicity, but this system makes **no
linearizability claim**: between the gate's approval and the exchange's
acknowledge, other actors trade the same account. What the reservation
model guarantees is *within-cluster agreement*: concurrent gate
evaluations in different processes serialise through the per-account hash,
TTL (default 300 s, `RISK_RESERVATION_TTL_MS`) reclaims slots for dead
workers, and a Redis error at step 10 denies the order (fail closed —
the outage mode is "no new risk", never "assume the reservation"). The
ledger holds *intentions*, not truth: anything the venue accepted becomes
durable position/fill state through the Part 5 pipeline, and reservations
for outcomes that never reached the venue are explicitly released.

Hot-path reads go to Redis-mirrored state; PostgreSQL carries the durable
config rows, switch rows, event log and snapshot metadata mirror. The API
never reads Redis on the request path: "GET /v1/risk/status" serves the
latest *mirrored* metadata, timestamped as such. The console never
presents a mirror as a live read; there is no on-demand venue-refresh
endpoint, because a synchronous one would be either a lie (already stale
when it answers) or a load on the hot path.

## 6. Protection lifecycle

`INACTIVE → ACTIVE → INACTIVE` is the manual loop. An engine trip is
different: `INACTIVE → TRIGGERED → ACKNOWLEDGED → CLEARED → INACTIVE` (or
`TRIGGERED → CLEARED`), and **a triggered switch never auto-clears**,
whatever PnL recovers in between. The transition table lives in one place
per language (`RISK_SWITCH_TRANSITIONS` in Python `enums.py` and TS
`risk.constants.ts`) with a parity test parsing the Python source; the
engine refuses illegal transitions at decision time and the API refuses
them at write time — same table, two enforcers.

API ceremony, and the console cannot bypass it:

* `POST /v1/risk/kill-switches/engage` — scope ACCOUNT/STRATEGY/SYMBOL
  (GLOBAL/EXCHANGE belong to the execution console; RISK-scoped switches
  are the engine's own brake, `target = account:<id>`), reason ≥ 10 chars.
* `.../:id/acknowledge` — for TRIGGERED rows only; reason ≥ 10 chars.
* `.../:id/clear` — reason ≥ 20 chars **and** the typed phrase
  `CLEAR RISK PROTECTION`; if `requiresExplicitClear`, acknowledgement
  first, non-negotiable.
* The Part 5 execution console gained a matching guard: releasing a row
  whose `requiresExplicitClear` is set is refused *there* too, so the
  older surface cannot be used to sneak past the newer lifecycle.

Config writes carry their own ceremony: any revision that *widens* an
effective ceiling (detected by comparing resolved GLOBAL+ACCOUNT maps —
child scopes can only tighten, by construction) must repeat
`WIDEN RISK LIMITS`; GLOBAL-scope entries above the deployment's platform
ceilings are refused outright regardless of confirmation, because a
confirmation phrase is consent, not capability.

## 7. The API plane (control, never execution)

`/v1/risk` exposes: `status`, `events`, `accounts/:id/limits` (GET + POST
replace), `accounts/:id/limits/rollback`, `accounts/:id/exposure`,
`accounts/:id/snapshots`, `accounts/:id/daily-pnl`, `accounts/:id/summary`,
`strategies/:id/summary`, `kill-switches` (GET + `engage`,
`acknowledge`, `clear`), `protections`. Every route is `risk:read` or an
explicit mutation permission (`risk:config:update`,
`risk:kill_switch_update`, `risk:protection_clear` — the latter two
non-wildcard, and widening a limit or disarming a protection is exactly
the pair `resource:*` grants must not hand out by accident). Every
mutation validates, audits (`RISK_CONFIG_UPDATED`, `RISK_CONFIG_ROLLED_BACK`,
`RISK_SNAPSHOT_INVALIDATED`, `RISK_KILL_SWITCH_ACKNOWLEDGED/_CLEARED`,
`RISK_PROTECTION_CLEARED`) and queues only `risk-control` jobs —
never the execution queue. There is no order-approval route, no PUT/PATCH
anywhere in the module (a spec test greps for it), and no import of the
execution module's order path (a spec test greps for that too).
Tenant isolation is structural: every read and write is scoped by the
authenticated tenant; a cross-tenant probe of a version row 404s the same
as a missing one.

Redis hot state and PG durable state share the key/namespace discipline
from Parts 2–5 (`wlct:trading:t:{tenant}:risk:*`, documented in
`redis_keys.py`; the TS side mirrors the exact strings). Events are
persisted with a `(tenantId, dedupeKey)` unique constraint so re-delivery
is idempotent, and a Redis stream publishes them for fan-out.

## 8. Replay, backtest, paper

`RiskReplay` (audit-only — its module imports no execution code, enforced
by `test_risk_package_boundaries.py` per-file scan) reconstructs historical
decisions from fill + order events and reports agreement, with one
deliberate exception: the projection always starts from the known end
state and walks backwards, because replay knows what the live path at
stage N could not.

`BacktestEngine` and the paper session take an optional `risk_gate=` built
by `build_simulated_state(...)` — a *simulated* gate, refused at
construction for anything that isn't. The live path is unchanged by its
absence or presence: only Part 5 reaches a venue, and backtest/paper
refusals are counted (`GATE_*` counters) and labelled simulated in events
(`isSimulated`) — never mixed into live metrics unlabelled.

## 9. Durable schema (additive, verified)

Migration `20260911150000_part8_realtime_risk_engine` is pure addition:
new enum values on existing enums (including `EMERGENCY` on kill-switch
severity and `ACCOUNT`/`RISK` on scopes; PG 12+ note about
`ALTER TYPE ADD VALUE` inside-transaction is documented in the migration
header), new columns on `RiskConfiguration` / `RiskEvent` / `KillSwitch`,
and three new tables — `risk_configuration_versions` (the version chain,
`@@unique([accountId, version])`, `loosenedCeilings` recorded),
`risk_snapshot_metadata` (the mirror, unique per `(accountId,
snapshotVersion)`), `risk_protection_actions` (trips with lifecycle).
Additive-only was verified mechanically by diffing `prisma migrate diff`
output against a reconstructed pre-Part-8 schema and grepping the SQL for
DROP/TRUNCATE/RENAME/ALTER — zero hits.

## 10. Environment (19 new keys)

`RISK_ENGINE_ENABLED` (must be true in production),
`RISK_FAIL_CLOSED` (**only true is valid, everywhere** — the false case is
rejected by the schema in every NODE_ENV, because "fail open on Fridays"
is not a configuration), `MAX_RISK_STATE_AGE_MS=2000`,
`RISK_SNAPSHOT_REFRESH_MS=250`, `RISK_RESERVATION_TTL_MS=300000`,
`RISK_EVENTS_RETENTION_DAYS=365`, and platform ceilings
`MAX_ORDER_NOTIONAL=1000`, `MAX_POSITION_NOTIONAL=5000`,
`MAX_ACCOUNT_EXPOSURE=10000`, `MAX_STRATEGY_EXPOSURE=5000`,
`MAX_SYMBOL_EXPOSURE=5000`, `MAX_OPEN_ORDERS=20`, `MAX_DAILY_LOSS=500`,
`MAX_STRATEGY_DAILY_LOSS=250`, `MAX_DRAWDOWN=10`,
`MAX_ORDERS_PER_SECOND=2`, `MAX_ORDERS_PER_MINUTE=30`,
`MAX_CANCELS_PER_SECOND=2`, `MAX_CANCELS_PER_MINUTE=30`,
`MAX_PRICE_DEVIATION_BPS=250`, `MAX_CONSECUTIVE_LOSSES=5` — cross-checked
by superRefine (minute ≥ second for both rate families; refresh < age;
production ⇒ engine). These are the *ceiling of the ceilings*: the API
refuses GLOBAL entries above them, and the numbers themselves live in the
environment, never in code.

## 11. What Part 8 does not do

It does not guarantee profits, stop losses that already happened, prevent
an exchange outage, protect against a mislabelled instrument, or catch a
strategy that is *allowed* to lose money. It does not stop trading faster
than the venue can match, and no latency claim is made anywhere in this
part — the gate adds work to the submit path and the honest statement is
"bounded, versioned, measurable via decision latency metadata". Risk
controls reduce operational risk but cannot guarantee against all losses.

## 12. Verification map (where each claim above is pinned)

* Python: 224 new tests across `test_risk_configuration|state|gate|
  protections|rate_ledger_events|execution_bridge|replay|package_boundaries`
  — including "no `time.sleep`, no network, Decimal-only" per-file scans,
  the reservation release matrix, and stale→deny behaviour.
* API: `risk-safety.spec.ts` (28 tests) — env gate, live Python-source
  parity for rule order/units/lifecycle tables, canonicalisation fixture
  parity (digests computed by Python, replicated by TS), forbidden-shape
  source scans, DTO discipline, RBAC split ("stop is safe, loosen is not").
* Schema: `prisma validate` + additive-diff proof (§9).
* Admin: page compiles under the console's strict TS; controls call only
  `/v1/risk` routes.
* Mobile: static verification only (see caveat below) — l10n key
  cross-check, API-shape cross-check, delimiter balance; the Flutter SDK
  is absent from this environment so analyze/test were not executed.

Mobile: included, strictly as a viewer. `RiskScreen`
(`apps/mobile/lib/features/risk/`) renders three panels — posture
(`GET /v1/risk/status`), kill switches (`GET /v1/risk/kill-switches`),
recent events (`GET /v1/risk/events?limit=25`) — with per-panel failure
isolation, exactly like the strategies feature's pattern. The repository
implements three `get` calls and nothing else; there is no engage,
acknowledge, clear, config, or any other mutation method anywhere in
`lib/features/risk/`, and the home tile is gated on `risk:read`. What
mobile shows it mirrors: a mirror without a `capturedAt` it can parse is
rendered stale, the simulated badge rides any `isSimulated` row, and the
disclaimer line ("Risk controls reduce operational risk but cannot
guarantee against all losses.") is on-screen. Nothing on a phone pulls a
kill switch, and nothing on a phone can.

Caveat, stated plainly: this environment has no Dart/Flutter SDK, so
`flutter analyze` and the widget tests could **not** be re-run against
Part 8's mobile changes. The Dart was written by mirroring the compiling
strategies feature line-for-line, every `l10n` key was verified to exist
in the generated localization getters, every parsed JSON field was
verified against the API view types (`RiskStatusView`,
`RiskSwitchView`, `RiskEventView`, `PaginatedResult.items`), and a
delimiter-balance check passes on all 13 touched files — but the Flutter
gates themselves are unverified here and should be run (`flutter analyze`,
`flutter test`, `flutter gen-l10n` should be a no-op diff) before shipping.
