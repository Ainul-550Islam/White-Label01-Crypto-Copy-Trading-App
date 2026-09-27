# Part 5 — Authenticated Exchange Integration & Execution

Status: **Python execution core delivered.** 437 tests passing (407 from Parts 1–4, 30 new).
Live trading is **disabled by default and cannot be enabled by accident.**

---

## 1. What this part adds

Parts 1–4 built a platform that could *watch* an exchange. Part 5 builds the layer
that can *act* on one — and, more importantly, the layer that decides when it must not.

```
Strategy → Signal → Risk Engine → Order Request → Execution Engine
                                                        ↓
                                            Trading Adapter (signs)
                                                        ↓
                                                    Exchange
                                                        ↓
                                    private stream / REST → Execution Event
                                                        ↓
                                     Position Manager → Reconciliation → PostgreSQL
```

The execution engine is exchange-agnostic. It talks to `TradingAdapter` and
`AccountAdapter` — the Part 2 contracts, **extended, not duplicated** — and has no
idea whether the venue behind them is Binance, a simulator, or something not yet
written.

---

## 2. New modules

| Path | Lines | Role |
|---|---:|---|
| `wlct_trading/execution/credentials.py` | 707 | The secret boundary. Providers for env / secret-manager / static / null; self-redacting credential value |
| `wlct_trading/execution/config.py` | 366 | `ExecutionSettings` and the live-trading safety rules |
| `wlct_trading/execution/timesync.py` | 346 | Exchange clock offset measurement, skew refusal |
| `wlct_trading/execution/validation.py` | 477 | Ten pre-network checks |
| `wlct_trading/execution/safety.py` | 483 | Ten pre-submit gates |
| `wlct_trading/execution/locks.py` | 385 | Distributed execution locks (in-memory + Redis) |
| `wlct_trading/execution/store.py` | 391 | Durable order-record port + in-memory implementation |
| `wlct_trading/execution/incidents.py` | 360 | Execution error taxonomy + incident records |
| `wlct_trading/execution/engine.py` | 1283 | The pipeline |
| `wlct_trading/execution/reconciliation.py` | 844 | Local ↔ venue repair, without destroying history |
| `wlct_trading/execution/__init__.py` | 211 | Package exports |
| `wlct_trading/exchanges/binance/signing.py` | 279 | HMAC-SHA256 signing. The only file that knows how |
| `wlct_trading/exchanges/binance/trading.py` | 1154 | `BinanceTradingAdapter`, `BinanceAccountAdapter` |
| `wlct_trading/exchanges/binance/userstream.py` | 560 | Listen-key lifecycle + private event parsing |
| `tests/test_execution.py` | 1349 | 30 deterministic cases |

## 3. Modified files

| Path | Change |
|---|---|
| `wlct_trading/adapters/base.py` | Added `fetch_open_orders` + `exchange_time` to `TradingAdapter`; `fetch_account` to `AccountAdapter`; new `VenueAccount` model |
| `wlct_trading/adapters/paper.py` | Implements all three new methods. `can_withdraw` hard-coded `False` |
| `wlct_trading/orders.py` | `OrderIntent.metadata`; `Fill` gained `symbol`, `side`, `exchange`, `quote_quantity`, `exchange_order_id` — all defaulted, so every existing call site is untouched |
| `wlct_trading/metrics.py` | `ExecutionMetrics`, `ExecutionCounters`, 12 named pipeline stages |
| `wlct_trading/redis_keys.py` | Public `NAMESPACE`; 11 Part 5 key builders |
| `wlct_trading/__init__.py`, `pyproject.toml` | → v0.5.0 |
| `.env.example` | +151 lines of Part 5 configuration, heavily annotated |

**`OrderIntent.metadata` is deliberately excluded from the idempotency fingerprint.**
Two intents differing only in metadata are the *same trade*; hashing it would let a
changed correlation id defeat duplicate detection and submit twice.

---

## 4. Authentication flow

```
CredentialProvider.resolve(tenant, account, exchange)
  → ExchangeCredentials  (self-redacting; assert_safe() refuses withdrawal-capable keys)
  → ExchangeClock.timestamp_millis()   ← refuses if unsynchronised or skewed
  → build_signed_request(...)          ← appends recvWindow then timestamp, then signs
  → HMAC-SHA256(secret, exact query string) → hex → &signature=...
  → X-MBX-APIKEY header                ← key never in the payload
  → transmit
```

Two details cause most real-world signature failures, and both are handled
structurally rather than by convention:

1. **Parameter order must match between signing and sending.** Binance signs the
   literal string, not a canonicalised set. `build_signed_request` therefore
   produces the final encoded string itself and the caller transmits it verbatim.
2. **Encoding must match too.** `quote(safe="")` is used so every reserved
   character is escaped identically in the signed and transmitted strings.

`timestamp` and `recvWindow` are appended by the signer, in that fixed order,
immediately before `signature`. No call site can disagree about ordering, because
no call site is allowed to supply them — doing so raises.

### The credential security boundary

| Layer | Sees the secret? |
|---|---|
| Secret manager / env | Yes — this is where it lives |
| `CredentialProvider` | Yes, transiently |
| `signing.py` | Yes, as an HMAC key. Never returns it |
| `TradingAdapter` / `AccountAdapter` | Holds the provider, not the secret |
| Execution engine | **No** |
| Risk engine, strategies, signals | **No** |
| Order store, events, positions | **No** |
| API responses, WS payloads, mobile, admin | **No** |
| Logs, tracebacks, metrics, incidents | **No** |

Enforcement is not by discipline. `ExchangeCredentials` overrides `__repr__`,
`__str__`, `__format__`, `__reduce__` and `__getstate__`; `SignedRequest.__repr__`
renders `[redacted]` for both the headers and the query; `ExecutionIncident.create`
runs every detail value through `scrub_secret_like`. Test 8 asserts that six
different rendering paths — including `repr([creds])` and `repr({"c": creds})` —
contain neither the key nor the secret.

---

## 5. Order execution flow

```
0. placement review   (added by Part 16, before the gates; see below)
1. clientOrderId      deterministic, from the Part 2 intent fingerprint
2. validation         10 checks, all failures collected
3. safety gates       11 gates, all required, all fail-closed
4. risk engine        MANDATORY. An exception is a rejection, not a bypass
5. execution lock     one worker per account
6. reservation        cross-worker duplicate guard
7. persist            Order + SUBMITTED event, written BEFORE the network call
8. [DRY_RUN stops]    order is never marked SUBMITTED — nothing was submitted
9. transmit
10. interpret:
      accepted  → ACKNOWLEDGED/FILLED, fills → positions
      rejected  → REJECTED, terminal, no position change
      ambiguous → stays SUBMITTED, marked UNKNOWN, incident, reconcile
```

**Marking precedes acting.** The order and its unknown marker are persisted before
the request goes out. A process that dies mid-request leaves a record behind; one
that persists afterwards does not.

### The eleven pre-submit gates

| # | Gate | Blocks when |
|---|---|---|
| 1 | `GLOBAL_KILL_SWITCH` | Engaged |
| 2 | `EXCHANGE_KILL_SWITCH` | Engaged for this exchange |
| 3 | `STRATEGY_KILL_SWITCH` | Engaged for this strategy |
| 4 | `SYMBOL_KILL_SWITCH` | Engaged for this symbol |
| 5 | `TRADING_MODE` | Resolver says DISABLED |
| 6 | `LIVE_TRADING_AUTHORISED` | Live path without every flag explicitly set |
| 7 | `RISK_ENGINE_HEALTHY` | Unhealthy, unreachable, or state older than `MAX_RISK_STATE_AGE_MS` |
| 8 | `MARKET_DATA_HEALTHY` | Required but stale/absent/unusable |
| 9 | `CREDENTIALS_VALID` | Missing, expired, or withdrawal-capable |
| 10 | `EXCHANGE_HEALTHY` | Disconnected or degraded |
| 11 | `PLACEMENT_ATTESTED` | The review was run and refused; a runtime that transmits refuses to start with no reviewer at all (Part 16, [docs/PART16_PLACEMENT_REVIEW.md](PART16_PLACEMENT_REVIEW.md)) |

All eleven are evaluated even after the first blocks, so an operator sees every reason
at once. Gate 11 arrived with Part 16 and is a verdict input rather than a second
rejection path: the review is gathered once, before the gates, and its outcome is
merged into the same decision this table has always described. `ComponentHealth` defaults to `healthy=False` — a caller that forgets to
populate a field cannot accidentally open a gate.

### The ten validation checks

Identity fields · symbol known and tradeable · side/type supported · quantity finite
and positive · price present iff required · stop price present iff required · venue
lot/tick/min/max rules · notional ceiling · time-in-force supported · fat-finger
price band (default ±20% of reference).

---

## 6. The unknown-order-result flow

The single most dangerous state in the system.

```
submit → AdapterConnectionError | timeout | HTTP 5xx
   ↓
order.status stays SUBMITTED          ← true: we did submit it
ReconciliationState = UNKNOWN         ← durable, written before the call
CRITICAL incident raised
   ↓
wait ORDER_UNKNOWN_RECONCILIATION_DELAY_MS
   ↓
GET /api/v3/order?origClientOrderId=...
   ↓
found     → adopt the venue's status and fills, state → IN_SYNC
not found → order was never placed, → FAILED, state → IN_SYNC
error     → nothing changes, retry next pass
```

**It is never resubmitted.** Not by the engine, not by a caller, not by a sweeper.
A retry the venue deduplicates is harmless; a retry it does not is a doubled
position. `ReconciliationState.UNKNOWN.blocks_further_submission` is `True`, and
`ExecutionEngine.cancel()` refuses on it too — cancelling an order that may not
exist produces an error that is itself ambiguous.

**Why `OrderStatus` gained no `UNKNOWN` member.** Adding one would require deciding
which real statuses it may legally transition to, a question with no correct
answer, because an unknown order might be in any of them. `OrderStatus` describes
what the *venue* believes; `ReconciliationState` describes what *we* believe about
our own knowledge. Keeping them separate leaves the legal-transition table intact.

HTTP 5xx is classified as ambiguous, not as a failure, because Binance's own
documentation says a 5xx means the execution status is unknown.

---

## 7. Reconciliation flow

Runs on a timer, after every private-stream reconnect, and on demand after an
ambiguous submission. Serialised per account by a distributed lock.

| Divergence | Response |
|---|---|
| Unknown order | Query by clientOrderId; adopt or mark never-placed |
| Missed lifecycle event | Venue status wins, via a legal transition |
| Missed fill | Applied through the same path as a live fill |
| Order at venue we did not place | **Never adopted.** CRITICAL incident |
| Venue status not legally reachable | Local state unchanged, flagged `DIVERGED`, discrepancy reported |
| Balance mismatch | Reported, never corrected |
| Position mismatch | Reported, never overwritten |

Fills are applied **before** status. Applying `FILLED` before the fills exist would
leave an order claiming to be filled with nothing to show for it.

Balances and positions are deliberately not repaired. A balance difference is a
*symptom* — a missing fill, a wrong fee model, an external transfer. Overwriting it
treats the symptom and destroys the evidence. A position holds the cost basis the
venue does not provide; replacing it with a bare venue quantity would silently lose
the entry price and realised PnL.

---

## 8. Private stream flow

```
POST   /api/v3/userDataStream           → listen key
wss://.../ws/<listenKey>                → executionReport, outboundAccountPosition,
                                          balanceUpdate, listenKeyExpired
PUT    /api/v3/userDataStream  every 30m (key expires at 60m)
DELETE /api/v3/userDataStream  on shutdown
```

The listen key is a **bearer credential** — anyone holding it can read the account's
order flow. `ListenKeyManager` never exposes it: `acquire()` returns the stream URL,
and `masked_key` / `status()` render `abcd...wxyz`. A `ws://` base is refused
outright, because the URL contains the key.

`executionReport` handling has one genuinely surprising rule: on a cancellation,
Binance puts the *cancelled* order's id in `origClientOrderId` and a fresh id in
`clientOrderId`. `effective_client_order_id` resolves this; matching on the wrong
field leaves the real order stuck in `CANCEL_REQUESTED` forever.

`to_fill()` raises unless `execution_type == "TRADE"` and `last_filled_quantity > 0`.
A `NEW` or `CANCELED` report has zero filled quantity, and turning one into a fill
would book a phantom trade at price zero.

Every reconnect triggers reconciliation. Binance does not replay events missed
while disconnected, so a reconnect is a correctness event, not just an availability
one.

---

## 9. Configuration and the safety rules

| Variable | Default | Meaning |
|---|---|---|
| `BINANCE_API_KEY` / `BINANCE_API_SECRET` | *(empty)* | Dev only. Never printed |
| `LIVE_TRADING_ENABLED` | `false` | Master switch |
| `DRY_RUN` | `true` | Build and validate, transmit nothing |
| `PAPER_TRADING` | `true` | Route to the simulator |
| `ORDER_REQUEST_TIMEOUT_MS` | `10000` | Timeout ⇒ UNKNOWN, not failure |
| `ORDER_RECONCILIATION_INTERVAL_MS` | `60000` | Background sweep |
| `ORDER_UNKNOWN_RECONCILIATION_DELAY_MS` | `2000` | Delay before resolving an unknown |
| `EXCHANGE_TIME_SYNC_INTERVAL_MS` | `300000` | Clock re-measurement |
| `EXCHANGE_MAX_CLOCK_SKEW_MS` | `1000` | Above this, signing is refused |
| `EXCHANGE_RECV_WINDOW_MS` | `5000` | Venue cap is 60000 |
| `EXECUTION_IDEMPOTENCY_TTL_SECONDS` | `86400` | Redis fast-path TTL |
| `PRIVATE_STREAM_RECONNECT_ENABLED` | `true` | |
| `MAX_RISK_STATE_AGE_MS` | `5000` | Stale risk state ⇒ unavailable ⇒ refuse |
| `MAX_SUBMIT_ATTEMPTS` | `1` | Never applied to an ambiguous result |

**Rejected combinations** (startup fails, loudly):

- `LIVE_TRADING_ENABLED=true` **and** `DRY_RUN=true` — direct opposites, no
  defensible default
- `LIVE_TRADING_ENABLED=true` **and** `PAPER_TRADING=true`
- `LIVE_TRADING_ENABLED=true` without `TRADING_MODE=LIVE`, `TRADING_ENABLED=true`
  and `LIVE_TRADING_CONFIRMED=true`
- `recvWindow > 60000`

A garbled boolean (`"ture"`) also raises rather than defaulting to `false`. `false`
is the safe direction, but the operator's intent is unknown and must be clarified.

The engine additionally refuses to *construct* in these combinations:

- live + simulated adapter → simulated fills would be indistinguishable from real
- live + in-process lock manager → a second worker could submit concurrently
- live + non-durable store → a restart would lose the record of live orders

---

## 10. Test coverage

30 deterministic cases in `tests/test_execution.py`. **No test needs real
credentials, a network, a clock or a sleep.** Test 1 verifies the signature against
Binance's own published worked example, so the implementation is checked against
the venue's specification rather than against itself.

| # | Case |
|---|---|
| 1–7 | Signature vector · determinism · parameter ordering · key-in-header-only · plaintext/timestamp refusal · Decimal rendering and float rejection · clock skew |
| 8–9 | Redaction across six rendering paths · withdrawal-capable key refused |
| 10–13 | Signed request generation · 401/403/429/418 · 5xx ambiguous vs 4xx definitive · public mirror refused for signed traffic |
| 14–15 | All validation classes · fat-finger band |
| 16–18 | Four kill-switch scopes · fail-closed dependencies · live-off-by-default and contradiction rejection |
| 19–24 | Clean submit · duplicate prevention · **ambiguous result never resubmitted** · dry run · risk failure blocks · paper cannot reach a real endpoint |
| 25–26 | Illegal transitions refused · fill normalisation, dedupe, position update |
| 27–28 | Unknown order resolved both ways · foreign order never adopted |
| 29–30 | All five private-stream event types · listen-key lifecycle and masking |

```
437 passed in 0.92s
```

---

## 11. What the TS/DB increment added

Section 11 previously listed five things as "not built". Four are now built and
verified; the fifth is scoped below.

### Prisma models and migration — DONE

`apps/api/prisma/schema.prisma` is now **46 models / 39 enums** and validates. The
Part 5 changes are:

| Table | Change |
|---|---|
| `tenants` | 4 back-relations to the new Part 5 aggregates |
| `trading_accounts` | `credential_source`, `credential_ref`, `verified_permissions`, `credential_rotated_at`, `credential_expires_at`, `private_stream_enabled`, `live_trading_enabled`; the four ciphertext columns became nullable |
| `orders` | `reconciliation_state`, `reconciliation_detail`, `last_reconciled_at`, `metadata`, `was_dry_run`, 2 indexes |
| `fills` | `symbol`, `side`, `venue`, `quote_quantity`, `exchange_order_id`, `source`, 2 indexes |
| `account_balance_snapshots` | new — upsert-latest, unique `[accountId, asset]` |
| `exchange_stream_sessions` | new — listen key stored **masked only** |
| `reconciliation_runs` | new — a row is written even for a no-findings or failed pass |
| `reconciliation_discrepancies` | new — nullable `orderId`, values kept as text |
| `execution_incidents` | new — immutable except the four resolution columns |

Two migrations exist, because `apps/api/prisma/migrations/` had been deleted:

- `0_init/` — the Parts 1–4 baseline, generated from an empty database.
- `20260906120000_part5_authenticated_execution/` — the Part 5 delta, generated by
  `prisma migrate diff` between the pre-Part-5 datamodel and the current one.

The delta is **additive only**. Every new column on an existing table is nullable or
has a default, so it applies to a populated production database without a backfill
and without a rewrite lock on the hot path. The four `DROP NOT NULL` statements
widen the credential columns, which is safe in the direction it goes: existing rows
keep their ciphertext and default to `credential_source = ENVELOPE_DB`.

Verified by applying both migrations to a live PostgreSQL 17 instance and then
running `prisma migrate diff --from-url … --exit-code`, which reported no drift.

### RBAC registration — DONE

`packages/shared-types/src/rbac.ts` now declares **73 permissions** (54 + 19). The
seed reports `permissions .......... 73`.

One behavioural change came with them. `permissionMatches` previously let a
`resource:*` wildcard grant every action on that resource. Six permissions are now
excluded from wildcards and must be listed explicitly on a role:

```
exchange_account:enable_live
exchange_account:rotate_credentials
execution:submit
kill_switch:operate
reconciliation:resolve
platform:impersonate
```

The scenario this closes: an admin grants `exchange_account:*` meaning "let support
fix API keys" and hands out the ability to arm live trading. The platform super
admin's global `*` still matches everything — restricting the break-glass identity
produces a platform nobody can operate during the incident where it matters.

Role assignments worth noting:

- **TRADER** can submit and cancel, and can read everything about execution. It
  cannot arm live trading, rotate a credential, release a kill switch or close a
  discrepancy.
- **FOLLOWER** cannot submit — a follower's orders come from a copy subscription,
  not a button — but *can* cancel. A user must always be able to stop something
  already working against them.
- **TENANT_ADMIN** holds the safety controls, including `kill_switch:operate` and
  `exchange_account:enable_live`, but not `execution:submit`.
- **SUPPORT** and **FINANCE** get reads only, and not one write on the money path.
- **COMPLIANCE** can engage a kill switch. Stopping trading is never the wrong call
  for a compliance officer to be able to make.

### NestJS endpoints — DONE

`apps/api/src/modules/execution/`, 21 routes under `/api/v1/execution`:

```
GET    /execution/accounts                              exchange_account:read
GET    /execution/accounts/:id                          exchange_account:read
GET    /execution/accounts/:id/connectivity             exchange_account:read
GET    /execution/accounts/:id/balances                 balance:read
GET    /execution/accounts/:id/stream-sessions          private_stream:read
POST   /execution/accounts/:id/verify                   exchange_account:verify
POST   /execution/accounts/:id/balances/refresh         balance:refresh
POST   /execution/accounts/:id/stream/resync            private_stream:manage
POST   /execution/accounts/:id/enabled                  exchange_account:manage
POST   /execution/accounts/:id/live-trading             exchange_account:enable_live
POST   /execution/accounts/:id/private-stream           private_stream:manage
POST   /execution/accounts/:id/reconcile                reconciliation:trigger
GET    /execution/orders                                order:read
GET    /execution/orders/:id                            order:read
GET    /execution/orders/:id/events                     order_event:read
GET    /execution/orders/:id/fills                      fill:read
POST   /execution/orders/:id/cancel                     execution:cancel
GET    /execution/fills                                 fill:read
GET    /execution/positions                             position:read
GET    /execution/safety                                execution:read
GET    /execution/kill-switches                         kill_switch:read
POST   /execution/kill-switches                         kill_switch:operate
GET    /execution/reconciliation/runs                   reconciliation:read
GET    /execution/reconciliation/runs/:id               reconciliation:read
GET    /execution/reconciliation/discrepancies          reconciliation:read
POST   /execution/reconciliation/discrepancies/:id/resolve   reconciliation:resolve
GET    /execution/incidents                             execution_incident:read
GET    /execution/incidents/counts                      execution_incident:read
GET    /execution/incidents/:id                         execution_incident:read
POST   /execution/incidents/:id/resolve                 execution_incident:resolve
```

Four properties hold across all of them.

**There is no order-placement endpoint.** Placing an order requires ten validation
checks, ten pre-submit gates, a mandatory risk evaluation, a distributed lock and a
signed request. All of that lives in the trading worker. An HTTP route that skipped
any of it would be a risk bypass with a REST interface, so the route does not exist.
Cancellation *is* exposed, because cancelling is risk-reducing.

**The API process holds no credentials.** The four operations that need one —
verify, refresh balances, reconcile, resync stream — are queued to the trading
worker on the existing `trade-execution` queue and return `202 Accepted` with a job
id. The API has no signing code and no credential provider, so the credential
boundary is enforced by process topology rather than by code review.

**No Prisma row reaches a response.** Every payload is assembled field by field in
`execution.mapper.ts` from an explicitly typed input. There is no `...row` spread
anywhere in that file: a spread carries whatever columns exist today plus whatever
columns are added tomorrow, which is how `apiSecretCiphertext` ends up in JSON after
a routine migration. Decimals and BigInts are stringified, because an IEEE double
cannot hold a 28,12 quantity or a microsecond epoch exactly.

**`tenantId` always comes from the session.** No DTO accepts one. It is applied in
the `where` clause, never checked afterwards, so a caller who knows another tenant's
account UUID receives a 404 indistinguishable from "does not exist".

Arming live trading additionally requires the literal confirmation phrase
`ENABLE LIVE TRADING` in the request body, and is refused outright unless the
deployment configuration also permits it.

### Live execution harness — DONE

`scripts/live_execution_smoke_test.py`. Read-only by default; four independent
interlocks, all of which must be satisfied before it will place anything:

1. `WLCT_LIVE_EXECUTION` must be truthy, or the script refuses to run at all.
2. Exactly one of `--testnet` / `--allow-mainnet`. There is no default endpoint.
3. `--place-test-order` additionally requires
   `WLCT_LIVE_EXECUTION_CONFIRM=I_UNDERSTAND_THIS_PLACES_A_REAL_ORDER`.
4. Order placement is testnet-only, regardless of `--allow-mainnet`.

In read-only mode it synchronises the clock, verifies the credential (failing if the
key can withdraw), reads the account, balances and open orders, and finally asserts
that neither the key nor the secret appears in anything it printed.

### Still not built

- **The trading worker's job consumers.** The API produces
  `verify-exchange-credentials`, `refresh-account-balances`,
  `reconcile-trading-account`, `resync-private-stream` and `cancel-order` onto the
  `trade-execution` queue. The consumers belong in the Python trading service,
  alongside the credential provider and the signed transport, and are the natural
  next increment.
- **SQL implementations of the `OrderStore`, `IncidentRecorder` and `LockManager`
  ports.** The ports are defined and exercised by in-memory implementations; the
  tables they will write to now exist.
- **Admin-web screens** over the endpoints above.

> *Dated, because the three items above read as present tense and two of them are
> history:* (amended by Part 17: the `IncidentRecorder` port became durable with the
> engine plane's `engine_incidents` table, so of the three SQL implementations named
> here the store is Part 13's, the incidents are Part 17's, and the `LockManager`
> remains the one with no SQL implementation - the service composes
> `InMemoryLockManager` and the core ships `RedisLockManager`, which is what live
> mode's distributed-lock requirement would use. Stated that way because "the core
> supports them; this deployment does not wire them" is the sentence Part 11 already
> had to learn to write.) the job consumers arrived with Parts 11-13 - all except
> `resync-private-stream`, which still answers 501, the honest "supported by the
> queue contract, not wired in this build"; the SQL store shipped with Part 13; and
> the credential provider became the execution engine's own configuration in
> Part 16, while the signed transport has existed in the core since Part 4 and is
> still not constructed by that service. What remains genuinely unbuilt is the
> admin-web layer.

---

## 12. Commands

### SAFE OFFLINE — no network, no credentials, no venue

```bash
# --- Python trading core -------------------------------------------------
cd libs/trading-core
python3 -m pytest tests/ -q                      # 437 passed
python3 -m pytest tests/test_execution.py -q     # 30 passed (Part 5)

# The execution package must never pull in a network client
python3 -c "import wlct_trading; print(wlct_trading.__version__)"
python3 -c "import wlct_trading.execution as e; print(len(e.__all__), 'exports')"

# The default configuration cannot trade
python3 -c "
from wlct_trading.execution import ExecutionSettings
s = ExecutionSettings.from_env({})
print('willTransmitOrders =', s.will_transmit_orders)
print(s.mode_description)
"

# A contradictory configuration is rejected rather than resolved
python3 -c "
from wlct_trading.execution import ExecutionSettings
try:
    ExecutionSettings(live_trading_enabled=True, dry_run=True, paper_trading=False,
                      trading_mode_setting='LIVE', trading_enabled=True,
                      live_trading_confirmed=True)
except Exception as exc:
    print('correctly rejected:', exc)
"

# --- TypeScript ----------------------------------------------------------
cd /path/to/whitelabel-copytrade
npm install                       # 1131 packages
npm run build:packages            # shared-types, config, utils, validation
npm run typecheck                 # api + admin-web, 0 errors
npm run lint                      # eslint --max-warnings=0, clean
npm test                          # jest, 23 passed

# --- Prisma: schema only, no database contacted --------------------------
# Both variables are env()-referenced, so both must be present even for a
# purely offline check. Inline them if .env is absent.
DATABASE_URL="postgresql://u:p@localhost:5432/d?schema=public" \
DIRECT_DATABASE_URL="postgresql://u:p@localhost:5432/d?schema=public" \
  npx --no-install prisma format --schema apps/api/prisma/schema.prisma

DATABASE_URL="postgresql://u:p@localhost:5432/d?schema=public" \
DIRECT_DATABASE_URL="postgresql://u:p@localhost:5432/d?schema=public" \
  npx --no-install prisma validate --schema apps/api/prisma/schema.prisma

# The live harness refuses to run without an explicit opt-in. Exit code 2.
python3 scripts/live_execution_smoke_test.py; echo "exit=$?"
```

### DATABASE — a real PostgreSQL, still no venue and no credentials

```bash
# Never a destructive reset against an existing database.
npx --no-install prisma migrate deploy --schema apps/api/prisma/schema.prisma
npx --no-install prisma generate --schema apps/api/prisma/schema.prisma
npm run db:seed                   # permissions .......... 73

# Confirm the database matches the datamodel. Prints an empty migration when
# there is no drift.
npx --no-install prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel apps/api/prisma/schema.prisma \
  --exit-code --script

# Paper startup. executionEnabled=false, tradingMode=DISABLED.
npm run dev:api
curl -s localhost:4000/api/v1/execution/safety -H "Authorization: Bearer $TOKEN"

npm run verify                    # 24 passed, 0 failed, 2 skipped
npm run smoke                     # 36 passed, 0 failed
```

### NETWORK — public data only, still no credentials

```bash
# Part 4 public market-data smoke test. Reads only; places nothing.
python3 scripts/live_market_data_smoke_test.py

# Note: api.binance.com returns HTTP 451 from some regions. Public checks use
# data-api.binance.vision, which the signed client explicitly REFUSES for
# authenticated traffic - see test 13.
```

### LIVE TRADING — ⚠ real orders, real money

> **Read this before running anything in this section.**
>
> These commands can place real orders on a real exchange with real funds. They
> are excluded from every default startup path, from `docker compose up`, from
> the test suite and from CI. Nothing below runs unless a human types it.
>
> **Use testnet first.** `--testnet` costs nothing to get wrong.
>
> **Use a withdrawal-disabled, IP-allowlisted key.** The platform refuses a
> withdrawal-capable key, but the allowlist is your protection, not ours.
>
> **Start with a quantity you would not mind losing entirely.**

```bash
# Step 1 - verify connectivity and permissions on TESTNET. Places no order.
#          Fails if the key can withdraw.
WLCT_LIVE_EXECUTION=1 \
BINANCE_API_KEY=... BINANCE_API_SECRET=... \
  python3 scripts/live_execution_smoke_test.py --testnet

# Step 2 - place and cancel ONE order on testnet. Requires the second gate.
#          --test-price must be far from the market so the order rests.
WLCT_LIVE_EXECUTION=1 \
WLCT_LIVE_EXECUTION_CONFIRM=I_UNDERSTAND_THIS_PLACES_A_REAL_ORDER \
BINANCE_API_KEY=... BINANCE_API_SECRET=... \
  python3 scripts/live_execution_smoke_test.py --testnet \
    --place-test-order --test-quantity 0.001 --test-price 10000

# Step 3 - verify connectivity against PRODUCTION. Read-only; still no order.
WLCT_LIVE_EXECUTION=1 \
BINANCE_API_KEY=... BINANCE_API_SECRET=... \
  python3 scripts/live_execution_smoke_test.py --allow-mainnet

# Step 4 - arm the deployment. The API refuses to boot on a contradictory set.
EXECUTION_ENABLED=true \
LIVE_TRADING_ENABLED=true \
DRY_RUN=false \
PAPER_TRADING=false \
EXCHANGE_SANDBOX_MODE=false \
  npm run dev:api

# Step 5 - arm the account. Requires exchange_account:enable_live AND the
#          literal confirmation phrase.
curl -X POST localhost:4000/api/v1/execution/accounts/$ID/live-trading \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"enabled":true,"confirmation":"ENABLE LIVE TRADING","reason":"..."}'

# Step 6 - confirm what the platform believes before anything trades.
curl -s localhost:4000/api/v1/execution/safety -H "Authorization: Bearer $TOKEN"
# wouldTransmitLiveOrder must be true and blockingReasons must be empty.

# The stop button, reachable in under ten seconds:
curl -X POST localhost:4000/api/v1/execution/kill-switches \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"scope":"GLOBAL","engaged":true,"reason":"stop"}'
```
