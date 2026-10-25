# Part 2 — Algorithmic Trading Core

Status of this document: it describes what is **built and tested** as of this
milestone, and states plainly what is not built yet. Nothing below is
aspirational unless it appears under "Not yet built".

---

## 1. Architecture

Part 1 delivered a multi-tenant SaaS control plane. Part 2 adds a trading data
plane beside it. The two are separated deliberately and the boundary is
enforced by what each side is allowed to import.

```
┌─────────────────────────── CONTROL PLANE (tenant-scoped) ───────────────────────────┐
│                                                                                      │
│  apps/api (NestJS + Prisma)          apps/admin-web        apps/mobile               │
│  · tenants, RBAC, audit              · operator console    · read-only trading views │
│  · trading configuration                                                             │
│  · orders/positions/risk READ                                                        │
│                                                                                      │
│                          PostgreSQL  ·  durable financial record                     │
└──────────────────────────────────────────┬───────────────────────────────────────────┘
                                           │ config down / facts up
                                           │ (never in the hot loop)
┌──────────────────────────────────────────┴───────────────────────────────────────────┐
│                        TRADING DATA PLANE (tenant-agnostic hot path)                 │
│                                                                                      │
│  services/market-data ──► services/trading-engine ──► services/execution-engine      │
│  · WS ingest, normalise    · strategies, signals        · OMS, risk gate, adapters   │
│  · order books                                                                       │
│                                                                                      │
│              libs/trading-core  ·  ONE implementation, imported by all three         │
│              Redis  ·  hot state: books, kill switches, counters, idempotency        │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### The two hard rules

**No PostgreSQL in the hot loop.** The market-data path — receive frame,
normalise, apply to book, publish top — performs zero database queries. Order
books live in process memory; kill switches, exposure counters and idempotency
markers live in Redis. PostgreSQL is written to only on events that are rare
relative to market data: an order transition, a fill, a risk rejection.

**One implementation of the rules.** `libs/trading-core` is a dependency-free
Python library holding the order book, the OMS state machine, the risk engine
and the position tracker. All three services import it. This is why the risk
rules applied at signal time are byte-for-byte the rules applied at submission
time — they are the same code, not two copies that drift.

### Why market data is not tenant-scoped

The best bid for BTC-USDT is the same fact for every tenant. Duplicating the
book per tenant would multiply memory and exchange feed load for no isolation
benefit. Tenancy is enforced where it means something: orders, positions, risk
configuration and accounts all carry `tenantId` and follow the Part 1 isolation
invariant unchanged.

---

## 2. Data flow

```
exchange websocket
   │
   ▼  MarketDataAdapter.stream_order_book()      ← venue-specific code ENDS here
normalised OrderBookDelta
   │
   ▼  OrderBook.apply_delta()                    ← sequence validated, gap ⇒ resync
BookTop  ──► Redis (shared)  ──► strategies
   │
   ▼  Strategy.on_order_book_update()
Signal  ──► validated ──► signal_to_intent()
   │
   ▼  OrderIntent
RiskEngine.evaluate()                            ← FAIL CLOSED, cannot be bypassed
   │
   ├─ rejected ──► RiskEvent (PostgreSQL) + RiskLimitBreached event
   │
   ▼ approved
build_client_order_id()                          ← deterministic idempotency key
   │
   ▼  TradingAdapter.submit_order()
SubmitResult ──► Order.transition_to()           ← state machine validates the edge
   │
   ▼  Fill (real or clearly-labelled simulated)
Order.apply_fill()  ──►  PositionManager.apply_fill()
   │
   ▼
PositionUpdated event ──► Redis ──► API websocket ──► admin console / mobile
```

Every arrow after the adapter boundary carries a normalised type. No strategy
ever sees a Binance field name.

---

## 3. What is built and tested

### `libs/trading-core` — 167 passing tests

| Module | Responsibility |
|---|---|
| `enums.py` | Canonical vocabulary; wire values shared with TypeScript and Prisma |
| `clock.py` | Monotonic latency measurement vs wall-clock timestamps, kept distinct |
| `market_data.py` | Normalised `Ticker`, `PublicTrade`, `OrderBookSnapshot/Delta`, `Candle`, `BookTop` |
| `order_book.py` | In-memory book: snapshot, deltas, sequence validation, depth, spread |
| `orders.py` | `OrderIntent`, `Order`, `Fill`, the state-transition table |
| `positions.py` | Weighted-average position accounting from fills only |
| `risk/` | Layered limits, four kill switches, fail-closed evaluation, mode resolver (a single module here, a package since Part 8) |
| `signals.py` | `Signal` validation, `BaseStrategy` lifecycle, signal→intent translation |
| `idempotency.py` | Deterministic client order ids, duplicate guard |
| `events.py` | Trading event envelope with correlation/causation chain |
| `redis_keys.py` | Every Redis key in one place |
| `adapters/base.py` | `ExchangeAdapter` / `MarketDataAdapter` / `TradingAdapter` / `AccountAdapter` |
| `adapters/paper.py` | Simulated venue that fills only against real observed prices |

Test coverage of the required scenarios:

| Required scenario | Where |
|---|---|
| Order-book snapshot | `TestOrderBookSnapshot` (5 tests) |
| Order-book update | `TestOrderBookUpdate` (7) |
| Sequence validation | `TestSequenceValidation` (9) |
| Best bid/ask | `TestBestBidAsk` (3) |
| Spread calculation | `TestSpreadCalculation` (5) |
| Signal validation | `TestSignalValidation` (13) |
| Risk rejection | `TestFailClosed`, `TestGating` (8) |
| Max order size | `TestMaxOrderSize` (3) |
| Max position size | `TestMaxPositionSize` (5) |
| Kill switch | `TestKillSwitch` (6) |
| Duplicate-order protection | `TestDuplicateOrderProtection` (6) |
| Order state transitions | `TestOrderStateTransitions` (12) |
| Position update from fills | `TestPositionFromFills` (11) |

Plus `test_pipeline.py`, which wires the real components together with no mocks
between them and asserts a signal becomes a position with consistent state.

### Database — additive migration, applied and verified

Two migrations, both non-destructive. `20260905160554_part2_trading_domain`
contains 14 `CREATE TABLE`, 14 `CREATE TYPE`, 49 indexes and 26 foreign keys,
and **zero** `DROP`, `TRUNCATE` or `DELETE`. `20260905161500_part2_trading_constraints`
adds integrity guards Prisma cannot express.

New models: `Exchange`, `TradingSymbol`, `TradingAccount`, `Strategy`,
`StrategyConfiguration`, `Order`, `OrderEvent`, `Fill`, `Position`,
`RiskConfiguration`, `RiskEvent`, `KillSwitch`, `TradingSession`,
`MarketDataRecord`. Total schema: 40 models, up from 26.

Database-level guards, each verified to reject bad data:

- `positions_side_matches_quantity` — the denormalised side can never drift
  from the signed quantity that drives PnL.
- `orders_price_matches_type` — a MARKET order carrying a limit price, or a
  LIMIT order without one, is refused.
- `strategy_configurations_one_active_per_strategy` — a partial unique index,
  so many historical revisions may exist but only one may be live.
- `kill_switches_single_global` — exactly one GLOBAL switch row can exist.
- Positivity checks on every risk limit, order quantity and fill price.
- OHLC consistency on candles.

### `packages/shared-types/src/trading.ts`

Wire contracts for API, admin console and mobile. All enum string values match
the Python and Prisma definitions exactly.

---

## 4. Safety properties, and how each is enforced

**Trading is off by default.** `TradingModeResolver` requires `TRADING_ENABLED`,
`TRADING_MODE=LIVE` and `LIVE_TRADING_CONFIRMED` to all agree before it returns
`LIVE`. An omitted variable yields `DISABLED`. A misconfiguration that names
LIVE without confirming it resolves to `DISABLED` rather than quietly falling
back to paper, because a silent downgrade would hide the mistake in production.
Seven tests cover this.

**Risk fails closed.** An incomplete `RiskSnapshot`, an unusable order book,
stale market data, or a limit that is not configured at any layer all produce a
rejection. There is no path where an unknown becomes an approval. A limit of
`None` means "this layer has no opinion", never "unlimited".

**Limits layer, tightest wins.** Platform, account and strategy limits combine
via `RiskLimits.tightest_with`. A strategy can restrict itself further; it can
never widen a limit above it.

**Corrupt books are discarded, not served.** A sequence gap empties the book and
marks it `RESYNC_REQUIRED`; it then refuses every delta until a fresh snapshot
arrives. A crossed book (bid ≥ ask) is marked `CROSSED` and becomes unusable.
Both states make `is_usable` false, and the risk engine refuses to price against
a book that is not usable.

**Simulated results cannot masquerade as real.** `is_simulated` originates on the
paper adapter and propagates onto the fill, the order, the position and the
database columns. `Position.contains_simulated_fills` is sticky once set.

**Paper fills use real prices.** The simulator is handed a live top-of-book and
fills at the observed touch, capped by the observed resting quantity. Given no
usable book it rests the order rather than inventing a price. It models neither
queue position nor market impact and is documented as optimistic.

**Idempotency has three layers.** A deterministic client order id derived from
the intent's economic fields (so two workers racing on one signal collide
rather than both filling), an in-process guard, and a unique index on
`(tenant_id, client_order_id)`.

**Credentials.** Envelope-encrypted with the Part 1 helper, AAD bound to
`trading_account:{tenantId}:{accountId}`. No view type in `trading.ts` carries a
secret; the only key-derived value a client receives is `apiKeyLastFour`. The
`AccountAdapter.verify_credentials` contract requires implementations to refuse
a key with withdrawal permission.

**No latency claims.** `LatencyRecorder` measures observed stage timings with a
monotonic clock. Nothing in the codebase promises a latency bound.

---

## 5. Not yet built

Honest inventory of what this milestone does **not** include:

- **NestJS trading module.** Controllers, DTOs, guards and services for
  exchanges / accounts / symbols / strategies / risk config / orders /
  positions / status / kill switches / sessions. The Prisma models and the
  TypeScript contracts they will use are in place; the HTTP surface is not.
- **Trading permissions wired into RBAC.** `TradingPermission` is defined in
  `trading.ts` but is not yet added to the seed's 54 permissions or the 7 role
  templates.
- **Live exchange adapter.** Only the abstract contracts and the paper venue
  exist. No Binance/Bybit/OKX/Kraken implementation has been written.
- **Service wiring.** `services/market-data` and `services/trading-engine` still
  contain their Part 1 implementations; they have not yet been refactored onto
  `libs/trading-core`. `services/execution-engine` does not exist yet.
- **BullMQ trading workers**, Redis hot-state repositories, and the websocket
  fan-out of trading events.
- **Admin console and Flutter screens.**

The order of work that follows from here: RBAC permissions and the NestJS module
first (it unblocks the console), then refactoring the two Python services onto
the core, then the execution engine, then one real exchange adapter behind the
existing contracts.

---

## 6. Commands

```bash
# dependencies
npm install

# database — additive, never destructive
cd apps/api
npm run prisma:migrate -- --name <name>   # create + apply a new migration
npx --no-install prisma migrate deploy    # apply existing migrations only
npm run db:seed

# infrastructure (local, without Docker)
/usr/lib/postgresql/17/bin/postgres -D ~/.pgdata -p 5432 -k ~/.pgrun -c listen_addresses=127.0.0.1
redis-server --port 6379 --bind 127.0.0.1 --requirepass "$REDIS_PASSWORD" --save '' --appendonly no

# build
npm run build:packages
npm run build --workspace=@wlct/api

# tests
cd libs/trading-core && python -m pytest tests/ -q     # 167 tests
cd services/trading-engine && python -m pytest -q      # 9
cd services/market-data && python -m pytest -q         # 6

# verification
npm run verify   # static invariants — 24 passed, 0 failed, 2 skipped
npm run smoke    # runtime assertions — 36 passed, 0 failed

# health
curl localhost:4000/health
curl localhost:4000/health/ready
curl localhost:4000/health/deep
```

### A note on `.env` quoting

Always quote a value containing `#`. `dotenv-cli` treats an unquoted `#` as the
start of a comment and truncates the value; bash sourcing the same file keeps it.
The two then disagree, so the password the seed hashes is not the password your
scripts send — producing an inexplicable 401 followed by an account lockout.

```
WRONG: SEED_SUPER_ADMIN_PASSWORD=My_P4ss#2026    -> becomes "My_P4ss"
RIGHT: SEED_SUPER_ADMIN_PASSWORD="My_P4ss#2026"
```
