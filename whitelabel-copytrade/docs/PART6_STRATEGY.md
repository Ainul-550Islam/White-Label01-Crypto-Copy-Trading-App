# Part 6 — Strategy engine, backtesting and paper trading

> **BACKTEST PERFORMANCE IS NOT INDICATIVE OF FUTURE PERFORMANCE.**
> **PAPER PERFORMANCE IS NOT INDICATIVE OF LIVE PERFORMANCE.**
> **SIMULATION DOES NOT GUARANTEE REAL EXECUTION QUALITY.**
>
> These three statements are repeated in the code, in every result object, in
> every session summary and in `.env.example`. They are not boilerplate. A
> simulated fill is produced by a model that ignores queue position, market
> impact, venue rejections and latency variance, and it is therefore
> systematically optimistic. No strategy in this repository carries a
> profitability claim, and the only bundled implementation exists to prove the
> architecture works.

---

## 1. What Part 6 adds

Parts 1–5 built a platform that can hold an order book, evaluate risk, submit a
signed order to a real venue and reconcile the result. What it could not do was
*decide* anything: every order originated outside the system.

Part 6 adds the deciding layer, and nothing else:

```
Market Data → Normalised Event → Feature Engine → Strategy Instance → Signal
    → Signal Validation → Risk Engine → Execution Engine
```

Everything to the left of `Signal Validation` is new. Everything to the right
already existed and is unchanged. That is the central design constraint: the
strategy layer is a *producer of intent*, and the parts of the system that can
move money were not touched.

### What the strategy layer cannot do

| Capability | Available to a strategy? | Why not |
|---|---|---|
| Call an exchange API | **No** | No module in `wlct_trading/strategies/` imports `adapters`, `net` or `execution`. Enforced by a test that scans every import line. |
| See a credential | **No** | `StrategyContext` has no field for one; `ParameterSchema` refuses a credential-shaped parameter name outright. |
| Know whether execution is PAPER or LIVE | **No** | The mode is not in the context. A strategy that behaved differently in paper would make paper testing worthless. |
| Authorise its own order | **No** | `StrategyRiskView` is read-only: no `approve`, no `override`, no `submit`. Asserted by test. |
| Bypass the validator | **No** | The engine calls the validator on every signal before returning it as accepted. |
| Bypass the risk engine | **No** | Both consumers (backtest engine, paper session) have exactly one call site into execution and it sits behind `decision.approved`. |

---

## 2. Integration points with Parts 1–5

Part 6 extends the existing abstractions. It introduces no parallel protocol.

| Existing component | How Part 6 uses it |
|---|---|
| `signals.py::Signal` | **Extended, append-only.** New optional fields: `strategy_version`, `expires_at`, `features`, plus `is_expired()` and `age_micros()`. Every existing call site is unaffected because every addition has a default. |
| `signals.py::BaseStrategy` | **Extended.** `Strategy` in `strategies/base.py` subclasses it, keeps the Part 2 handler names (`on_market_data`, `on_order_book_update`, `on_trade`, `on_candle`) and adds `evaluate(context)`. `on_timer()` was added to the base. |
| `signals.py::StrategyDescriptor` | Used unchanged as the tenant/exchange/symbol/risk-profile envelope for an instance. |
| `signals.py::signal_to_intent` | The **only** signal→order translation. Part 6 calls it; it does not reimplement it. |
| `market_data.py` | The normalised event types are the replay event types. There is no separate "backtest event" hierarchy, which is what lets one strategy run unchanged live, on paper and in replay. |
| `order_book.py::OrderBook` | Rebuilds book state from replayed snapshots and deltas, with the same sequence validation used live. |
| `risk.py::RiskEngine` | Called with `TradingMode.PAPER` on both the backtest and paper paths. A rejection is counted and the order is dropped. |
| `positions.py::PositionManager` | The only implementation of weighted-average position and realised PnL. `SimulatedPortfolio` delegates to it rather than reimplementing the arithmetic. |
| `adapters/paper.py::PaperTradingAdapter` | **Refactored, behaviour preserved.** It now delegates its fill rules to `SimulatedMatchingEngine` instead of holding a second copy. Its public API, its defaults and its observable behaviour are unchanged; all 437 pre-existing tests still pass. |
| `metrics.py` | `StrategyCounters` / `StrategyMetrics` / `STRATEGY_STAGES` sit beside `ExecutionMetrics`, same shape, same caveats. |
| `enums.py` | Seven new enums, twelve new `TradingEventType` members. Nothing removed or renumbered. |
| `idempotency.py::build_client_order_id` | Used for the simulated client order id, with `intent.created_at` set from the simulated clock so the id is deterministic under replay. |

---

## 3. Strategy data flow (live and paper)

```
                      ┌──────────────────────────┐
  venue WebSocket ───►│  Part 3/4 transport      │  (unchanged)
                      └────────────┬─────────────┘
                                   │ normalised BookTop / Trade / Ticker / Candle
                                   ▼
                      ┌──────────────────────────┐
                      │  StrategyEngine.dispatch │  per-symbol fan-out
                      └────────────┬─────────────┘
                 ┌─────────────────┼─────────────────┐
                 ▼                 ▼                 ▼
          instance A         instance B         instance C     (isolated)
                 │
                 ├─► FeatureEngine.observe_*        Decimal only, bounded windows
                 ├─► strategy.on_order_book_update  Part 2 handler
                 ├─► FeatureEngine.snapshot()       immutable, event-timestamped
                 ├─► StrategyContext                read-only, no credentials
                 └─► strategy.evaluate(context) ──► Signal | None
                                   │
                                   ▼
                      ┌──────────────────────────┐
                      │  SignalValidator         │  rejects, never modifies
                      └────────────┬─────────────┘
                                   │ accepted only
                                   ▼
                          signal_to_intent()
                                   │
                                   ▼
                      ┌──────────────────────────┐
                      │  RiskEngine.evaluate     │  the only authoriser
                      └────────────┬─────────────┘
                                   │ approved && would_route
                                   ▼
                      ┌──────────────────────────┐
                      │  Execution (Part 5)      │  or PaperTradingAdapter
                      └──────────────────────────┘
```

Every arrow that crosses a box can refuse. A strategy exception never crosses
the `StrategyEngine.dispatch` boundary: it is caught, converted to a
`StrategyFailure`, counted, and handed to the failure policy while the other
instances continue.

---

## 4. Backtest data flow

```
HistoricalDataset (checksummed, pre-sorted)
        │
        ▼
ReplayEngine ──advance──► SimulatedClock        the only source of time
        │
        │ one event, in total order (timestamp, kind rank, sequence)
        ▼
OrderBook.apply_snapshot / apply_delta          real sequence validation
        │
        ├─► SimulatedMatchingEngine.on_book_update   resting orders fill here
        │            │
        │            └─► SimulatedPortfolio.apply_fill
        ▼
StrategyEngine.dispatch_book_top
        │
        ▼
SignalValidator ──► signal_to_intent ──► RiskEngine.evaluate
        │
        ▼ approved
SimulatedMatchingEngine.submit
        │
        ▼
SimulatedPortfolio.apply_fill ──► mark_to_market ──► equity curve
        │
        ▼
compute_performance ──► BacktestResult (configuration hash + dataset identity)
```

**No look-ahead is structural.** The consumer receives one event at a time plus
a `ReplayCursor` whose `history()` is filtered against the clock and whose
`assert_not_future()` raises. The remaining events live in a private tuple
behind a private index; there is no method anywhere that returns a future
event.

**Determinism** comes from four rules, all enforced in code:

1. The dataset is sorted by `(timestamp, kind rank, sequence)` at construction.
2. Time comes only from `SimulatedClock`, which refuses to move backwards.
3. Ids come from `SimulatedIdFactory`, a counter — never `uuid4`.
4. `OrderIntent.created_at` is set from the simulated clock, so
   `build_client_order_id` is deterministic too.

`BacktestResult.matches()` compares the configuration hash, the headline
figures, every closed trade and every equity point. `to_dict()` deliberately
omits the wall-clock duration, because that genuinely does differ between two
identical runs; it is available from `operational_dict()`.

---

## 5. Paper-trading data flow

Identical to the live flow, with one substitution and three refusals.

```
live feed ──► StrategyEngine ──► SignalValidator ──► RiskEngine
                                                          │
                                                          ▼
                                            PaperTradingAdapter  (is_simulated)
                                                          │
                                                          ▼
                                            SimulatedPortfolio + PositionManager
```

`PaperTradingSession.__init__` refuses, fatally, to be constructed when:

1. the adapter does not report `is_simulated == True`;
2. the trading mode is anything other than `PAPER`;
3. the strategy's symbol or exchange disagrees with the session's.

A constructed session therefore has no object capable of reaching a venue.
`PaperSessionConfig` has no field that could carry a credential, and the class
exposes no setter for the adapter — asserted by test.

Fills are produced only against real observed prices. If the book is
unavailable the order rests unfilled; the simulator never invents a price.

---

## 6. Strategy lifecycle

```
        register()                        add() to engine
            │                                    │
            ▼                                    ▼
      ┌──────────┐  initialize()  ┌───────────────┐  start()  ┌─────────┐
      │ CREATED  │───────────────►│  INITIALISED  │──────────►│ RUNNING │
      └──────────┘                └───────────────┘           └────┬────┘
                                          ▲                        │
                            clear_failure()│                stop() │  exception
                                          │                        ▼      │
                                    ┌─────┴─────┐            ┌─────────┐  │
                                    │  FAILED   │◄───────────│ STOPPED │  │
                                    └───────────┘   policy   └─────────┘◄─┘
```

* `initialize()` resets state, the signal sequence and the cached context, then
  runs the subclass hook. Two instances initialised from the same configuration
  are byte-identical.
* An exception anywhere in feature calculation, an event handler or `evaluate`
  is caught at the engine boundary. The instance is marked `FAILED`, the error
  is counted, and the failure policy runs:
  * `STOP_INSTANCE` (default) — that instance stops; the others keep running.
  * `HALT_ALL` — every instance stops and the engine refuses further dispatch
    until `resume()` plus an explicit restart.
  There is no policy that continues with possibly-corrupted state.
* A failed instance cannot be restarted until `clear_failure()`, which resets
  the strategy, its features, its deduplicator and its cooldown gate.

**Instance identity** is `sha256(tenant | strategy key | version | exchange |
market type | symbol | configuration version)[:32]`. Change any component and
you get a different instance with a different state namespace
(`strategy:{tenant}:{instance_id}`). That is what makes isolation structural
rather than a matter of care.

---

## 7. Signal lifecycle

1. **Construction** — `Strategy.build_signal()` derives `sig-<24 hex>` from the
   instance fingerprint, the action, the event timestamp, the quantity, the
   price and a per-instance counter. Nothing reads a clock; `created_at` is the
   context's *event* timestamp, so replay reproduces the same ids.
2. **Provenance** — the feature values that drove the decision are attached as
   strings, limited to the keys the strategy names.
3. **Expiry** — optional `expires_at`. Validated to be after `created_at`.
4. **Validation** — in this order, cheapest and most decisive first:
   kill switch → strategy enabled and `RUNNING` → identity (strategy id,
   tenant, non-empty version, exchange, allowed symbol) → structural validity →
   freshness (future skew, max age, expiry) → market-data state (present,
   fresh, within limit, risk state available) → quantity and price sanity →
   cooldown → duplicate.
5. **Verdict** — a `SignalValidationResult` carrying the *original* signal and
   a `SignalRejectionCode`. The validator never mutates a signal. If a signal is
   wrong, it is refused; it is not repaired.
6. **Translation** — `signal_to_intent()`, unchanged from Part 2.
7. **Authorisation** — `RiskEngine.evaluate()`.
8. **Execution** — Part 5 for live, `PaperTradingAdapter` for paper,
   `SimulatedMatchingEngine` for a backtest.

Deduplication is a bounded in-memory guard: TTL plus LRU cap, keyed on an
identity that excludes timestamps, confidence, reason and features. It is *not*
a second idempotency system — order idempotency remains the unique index on
`(tenant_id, client_order_id)` from Part 5.

---

## 8. The risk boundary

* A strategy receives `StrategyRiskView`: limits, current exposure, open order
  count, realised PnL. Read-only. `available_position_budget` returns `None`
  when no limit is known, and a strategy must treat that as "do not size up" —
  never as "unlimited".
* `is_available=False` is the fail-closed flag. The default provider in
  `StrategyEngine` returns exactly that, so a host that forgets to wire risk
  state gets every actionable signal refused rather than a strategy sizing
  against unknown exposure.
* The risk engine runs *after* the strategy returns, on the intent, with the
  authoritative snapshot. A strategy cannot see its verdict in advance and
  cannot appeal it.
* With no `RiskLimits` configured at any layer, `RiskEngine` rejects
  everything. Two tests assert that a backtest and a paper session with empty
  limits place zero orders.

---

## 9. The live-execution boundary

Nothing in Part 6 can place a live order. Specifically:

* `wlct_trading/strategies/**`, `wlct_trading/backtest/**` and
  `wlct_trading/paper/**` import no adapter, no network module and no
  execution module. Three tests scan every import line in those trees.
* `BacktestEngine` has no adapter attribute at all — there is nothing to send
  an order to.
* `PaperTradingSession` refuses a non-simulated adapter at construction.
* No new HTTP route was added that can submit an order. The Part 5 rule stands:
  the API has no order-placement endpoint, only cancel plus queued credentialed
  commands.
* No configuration variable added in Part 6 can enable live trading.
  `AppConfigService.tradingMode` is unchanged, and
  `strategySafetySummary.liveExecutionReachable` reports the honest answer so
  an operator can see at a glance that enabling strategies did not enable live
  orders.

---

## 10. New directory tree

```
libs/trading-core/
├── wlct_trading/
│   ├── strategies/
│   │   ├── __init__.py                    barrel (not re-exported from the top level)
│   │   ├── parameters.py                  ParameterType/Spec/Schema, credential-name refusal
│   │   ├── state.py                       StrategyInstanceKey, StrategyState, StrategyStateStore
│   │   ├── context.py                     StrategyContext, StrategyRiskView
│   │   ├── base.py                        Strategy (subclass of Part 2 BaseStrategy)
│   │   ├── signals.py                     signal_identity, SignalDeduplicator, CooldownGate
│   │   ├── validation.py                  SignalValidationConfig/Result/Validator
│   │   ├── registry.py                    StrategyRegistry, RESERVED_STRATEGY_KEYS
│   │   ├── lifecycle.py                   StrategyInstance, StrategyEngine, failure policy
│   │   ├── features/
│   │   │   ├── __init__.py
│   │   │   ├── rolling.py                 RollingWindow, RollingReturns, safe_ratio
│   │   │   ├── microstructure.py          imbalance, weighted mid, spread
│   │   │   ├── statistics.py              Sharpe/Sortino/drawdown/profit factor
│   │   │   └── engine.py                  FeatureConfig, FeatureSnapshot, FeatureEngine
│   │   └── implementations/
│   │       ├── __init__.py
│   │       └── deterministic_example.py   DeterministicImbalanceStrategy
│   ├── backtest/
│   │   ├── __init__.py
│   │   ├── clock.py                       SimulatedClock
│   │   ├── dataset.py                     MarketEvent, HistoricalDataset, DatasetDescriptor
│   │   ├── replay.py                      ReplayEngine, ReplayCursor, LookAheadError
│   │   ├── simulator.py                   ExecutionAssumptions, SimulatedMatchingEngine
│   │   ├── portfolio.py                   SimulatedPortfolio, ClosedTrade, EquityPoint
│   │   ├── metrics.py                     PerformanceMetrics, compute_performance
│   │   ├── result.py                      BacktestResult, compute_configuration_hash
│   │   ├── walkforward.py                 WalkForwardSplit, split_dataset, rolling_windows
│   │   └── engine.py                      BacktestConfig, BacktestEngine
│   └── paper/
│       ├── __init__.py
│       └── session.py                     PaperSessionConfig/Summary/Session, safety error
└── tests/
    ├── test_strategy_features.py          39 cases
    ├── test_strategy_engine.py            67 cases
    ├── test_backtest.py                   71 cases
    └── test_paper_trading.py              20 cases
```

---

## 11. Configuration

| Variable | Default | Meaning |
|---|---|---|
| `STRATEGY_ENGINE_ENABLED` | `false` | Master switch for the strategy engine. |
| `PAPER_TRADING_ENABLED` | `true` | Whether paper sessions may be started. |
| `BACKTEST_ENABLED` | `true` | Whether backtests may be submitted. |
| `STRATEGY_EVENT_QUEUE_SIZE` | `10000` | Bounded market-data queue (100 – 1 000 000). |
| `STRATEGY_MAX_INSTANCES` | `50` | Cap on concurrent instances (1 – 1000). |
| `STRATEGY_MAX_PROCESSING_LATENCY_MS` | `50` | Slow-dispatch *observation* budget. Not a guarantee. |
| `SIGNAL_MAX_AGE_MS` | `2000` | Older signals are refused. |
| `SIGNAL_DEDUP_TTL_SECONDS` | `5` | Dedup memory. Must cover `SIGNAL_MAX_AGE_MS`. |
| `BACKTEST_DEFAULT_INITIAL_CAPITAL` | `10000` | Decimal string. |
| `BACKTEST_DEFAULT_MAKER_FEE` | `0.001` | Rate, not bps. |
| `BACKTEST_DEFAULT_TAKER_FEE` | `0.001` | Rate, not bps. |
| `BACKTEST_DEFAULT_SLIPPAGE_BPS` | `1` | Basis points against every taker fill. |

Cross-field rules that fail at boot:

1. `STRATEGY_ENGINE_ENABLED` with none of `PAPER_TRADING_ENABLED`,
   `BACKTEST_ENABLED`, `EXECUTION_ENABLED` — the engine would discard every
   signal it produced.
2. `SIGNAL_DEDUP_TTL_SECONDS * 1000 < SIGNAL_MAX_AGE_MS` — a dedup entry that
   expires while its signal is still valid stops preventing duplicates.
3. `STRATEGY_MAX_PROCESSING_LATENCY_MS >= SIGNAL_MAX_AGE_MS` — every signal
   would be stale by construction.
4. `STRATEGY_EVENT_QUEUE_SIZE` outside 100 – 1 000 000.
5. `STRATEGY_MAX_INSTANCES` outside 1 – 1000.
6. `BACKTEST_DEFAULT_INITIAL_CAPITAL <= 0`.
7. Zero taker fee **and** zero slippage in production — that pair produces
   results no real account could achieve.

The eight Part 5 rules are unchanged and still apply. No Part 6 variable
participates in the live-trading decision.

---

## 12. Metrics and observability

`StrategyMetrics` mirrors `ExecutionMetrics`: counters plus latency histograms,
in memory, never shipped synchronously (a network call on the strategy path is
exactly what the data-plane rules forbid).

Counters: instances registered/started/stopped/failed/quarantined, engine
halts, events processed, timer ticks, signals generated/accepted/rejected/
deduplicated, strategy errors, feature errors, feature resets, provider errors,
slow dispatches, risk rejections, simulated orders/fills/rejections, paper
sessions started/stopped, backtests completed, replay events.

Stages: `feature_calculation`, `strategy_processing`, `signal_validation`,
`simulated_execution`, `paper_dispatch`, `backtest_run`.

Log fields on the strategy path: strategy key, version, instance id, tenant id,
symbol, event timestamp, processing timestamp. Never a credential, never a
token, never a raw payload that could contain one.

Every latency figure is an observation of this process including its own
scheduling delay. It is not a guarantee, and this platform makes no
"sub-millisecond" or HFT claim of any kind.

---

## 13. Metric honesty rules

* A ratio with a zero denominator is `None`, never `0`. "Both sides empty" and
  "both sides equal" are different facts.
* Sharpe and Sortino are withheld below **20** observations and when dispersion
  is zero. `PerformanceMetrics.has_sufficient_observations` says which.
* Win rate, average trade, average win/loss and profit factor are `None` when
  there is nothing to average. A strategy that never traded does not have a
  0 % win rate.
* Wins are net of the closing fee. A trade profitable before costs and
  unprofitable after is a loss.
* A round trip that realises exactly zero is still recorded as a closed trade,
  because it still paid fees. Omitting it would quietly improve the win rate.
* Unrealised PnL is `None` when flat or unmarked, never `0`.
* `BacktestResult.is_reproducible` is `false` when the dataset has no checksum.

---

## 14. The bundled strategy

`DETERMINISTIC_IMBALANCE_V1` @ `1.0.0` — `DeterministicImbalanceStrategy`.

Parameters: `entry_threshold` (0.6), `exit_threshold` (0.2, must be below
entry), `order_quantity` (0.001), `max_position` (0.01),
`signal_cooldown_micros` (1 000 000), `use_limit_orders` (true),
`signal_ttl_micros` (2 000 000).

It buys when top-of-book imbalance exceeds the entry threshold, sells when it
falls below the negative of it, and flattens inside the exit band. Exit is
evaluated before entry. It emits nothing when imbalance is `None` or when a
limit price is unavailable. Confidence is `|imbalance|` clamped to `[0, 1]` and
is explicitly **not** a probability.

**It exists to prove the architecture end to end and carries no profitability
claim.** In the bundled test it loses money, which is the expected result of
crossing the spread repeatedly and paying fees.

`MARKET_MAKING_V1`, `MOMENTUM_V1`, `MEAN_REVERSION_V1` and
`MICROSTRUCTURE_V1` are reserved in `RESERVED_STRATEGY_KEYS` so the ids cannot
be taken by something else. They are deliberately unimplemented.

---

## 15. Test plan

`cd libs/trading-core && python3 -m pytest tests/ -q` → **634 passed**
(437 pre-existing, 197 new). No internet, no credentials, no database, no
Redis, no real order.

| # | Case | Where |
|---|---|---|
| 1 | Strategy registration | `test_strategy_engine.py::TestRegistry` |
| 2 | Version validation / no silent rebind | same |
| 3 | Parameter validation, credential-name refusal | `TestParameters` |
| 4 | Deterministic initialisation | `TestInstanceIdentityAndState` |
| 5 | Per-instance state isolation, snapshot/restore | same |
| 6 | Feature calculation | `test_strategy_features.py::TestFeatureEngine` |
| 7 | Imbalance incl. zero denominator | `TestOrderBookImbalance` |
| 8 | Bounded rolling windows | `TestRollingWindow` |
| 9 | Insufficient history is explicit | `TestRollingWindow`, `TestRollingReturns` |
| 10 | Signal generation | `TestDeterministicExampleStrategy` |
| 11 | Signal validation, reject-never-modify | `TestSignalValidation` |
| 12 | Deterministic signal identity | `TestSignalIdentityAndDedup` |
| 13 | Bounded deduplication and cooldown | same |
| 14 | Failure isolation across instances | `TestEngineLifecycleAndIsolation` |
| 15 | Failure policy (`STOP_INSTANCE`, `HALT_ALL`) | same |
| 16 | Event ordering and replay determinism | `test_backtest.py::TestReplayOrdering` |
| 17 | No look-ahead | same |
| 18 | Simulated market execution | `TestSimulatedExecution` |
| 19 | Simulated limit execution, resting fills | same |
| 20 | Maker/taker fees | same |
| 21 | Slippage and latency | same |
| 22 | Portfolio accounting | `TestSimulatedPortfolio` |
| 23 | Realised and unrealised PnL | same |
| 24 | Drawdown | same |
| 25 | Metrics withheld on insufficient observations | `TestRiskStatistics`, `TestBacktestRun` |
| 26 | Configuration hashing | `TestConfigurationHash`, `TestBacktestRun` |
| 27 | Dataset identification and checksum | `TestDatasetIdentification` |
| 28 | **Paper trading cannot call the live adapter** | `test_paper_trading.py::TestPaperTradingSafety` |
| 29 | No strategy/backtest/paper module imports an adapter | three import-scan tests |
| 30 | **Strategy cannot bypass the risk engine** | `TestBacktestRun`, `TestPaperSessionBehaviour` |
| 31 | Walk-forward window separation | `TestWalkForward` |
| — | **Mandatory: backtest reproducibility** | `test_the_same_inputs_produce_an_identical_result` |
| — | **Mandatory: Parts 1–5 still pass** | the 437 pre-existing tests |

---

## 16. Persistence policy

Part 6 writes **nothing** per tick. What is durable, and when:

| Data | When written | Store |
|---|---|---|
| Strategy definition, version, parameters | On operator change | PostgreSQL |
| Instance configuration | On operator change | PostgreSQL |
| Lifecycle events (start/stop/fail/quarantine) | On transition | PostgreSQL |
| State checkpoints | On a schedule, and on clean stop | PostgreSQL |
| Backtest results and trades | Once, at completion | PostgreSQL |
| Paper session summaries and snapshots | On a slow schedule, and on stop | PostgreSQL |
| Incidents | On occurrence | PostgreSQL |
| Hot state (features, dedup, cooldown) | Never durable | In memory / Redis |

Redis is never the source of financial truth. PostgreSQL never appears in the
hot path.

---

## 17. Persistence, API surface and clients

Section 16 states the policy. This section is the delivered implementation of
it: the schema, the migration, the HTTP surface, and the two read-only clients.

### 17.1 Schema and migration

Eleven models were added to `apps/api/prisma/schema.prisma` and applied by
`apps/api/prisma/migrations/20260907120000_part6_strategy_layer/migration.sql`.
The migration is **additive only** — it creates enums, tables, indexes and
foreign keys, and alters no existing column. It was produced with
`prisma migrate diff` against the pre-Part-6 datamodel, so it is exactly the
delta and nothing else.

| Model | Holds | Written when |
|---|---|---|
| `StrategyDefinition` | Catalogue entry, one per strategy key | Seed / operator change |
| `StrategyVersion` | Immutable behaviour version, parameter schema, behaviour hash | On publish |
| `Strategy` (instance) | Tenant-scoped instance, risk profile, health | Operator change |
| `StrategyConfiguration` | Versioned parameter set for an instance | On activation |
| `StrategyCheckpoint` | State snapshot for restore | Scheduled / clean stop |
| `StrategyRun` | One lifecycle span of an instance | Start, stop, failure |
| `StrategyIncident` | Failure, quarantine, breach | On occurrence |
| `BacktestRun` | Normalised `BacktestResult` including configuration hash and dataset identity | Once, at completion |
| `BacktestMetric` | One metric per row, with observation count and sufficiency | Once, at completion |
| `BacktestTrade` | Closed simulated trades | Once, at completion |
| `PaperTradingSession` | Session summary and counters | Start, stop |
| `PaperPortfolioSnapshot` | Periodic simulated equity snapshot | Slow schedule |

Three schema decisions worth stating, because each of them prevents a specific
false statement being stored:

* **`isSimulated Boolean @default(true)`** on `BacktestRun`, `BacktestTrade`,
  `PaperTradingSession` and `PaperPortfolioSnapshot`. The default is `true`, so
  a row inserted by code that forgot the flag is labelled simulated rather than
  real. The safe default is the one that under-claims.
* **Nullable, not zero.** `winRate`, `unrealisedPnl` and `BacktestMetric.value`
  are nullable, and `BacktestMetric` carries `observationCount`, `isSufficient`
  and `note`. A Sharpe ratio computed from four observations is not stored as a
  number; it is stored as `NULL` with the reason. `0` and "we do not know" are
  different facts and the column type keeps them different.
* **`Strategy.versionRecord`.** `Strategy.version` already existed as a semver
  string, so the relation to `StrategyVersion` is named `versionRecord`. It
  reads awkwardly and it stays: renaming the existing column would have been a
  destructive change to working code.

Every tenant-scoped table has `tenantId` first in its composite indexes and
uniques (`Strategy[tenantId, instanceKey]`, `BacktestRun[tenantId,
runIdentifier]`, `PaperTradingSession[tenantId, sessionIdentifier]`), so a
query that forgets the tenant filter cannot accidentally use an index that
spans tenants.

### 17.2 API surface

Two controllers, both under `@Controller({ path: 'strategies', version: '1' })`,
in `apps/api/src/modules/strategy/`. `StrategyModule` is not `@Global()` and
exports nothing: no other module can reach into it.

| Method | Path | Permission |
|---|---|---|
| GET | `/api/v1/strategies/definitions` | `strategy_version:read` |
| GET | `/api/v1/strategies/definitions/:key` | `strategy_version:read` |
| GET | `/api/v1/strategies/definitions/:key/versions` | `strategy_version:read` |
| GET | `/api/v1/strategies/instances` | `strategy_instance:read` |
| GET | `/api/v1/strategies/instances/:id` | `strategy_instance:read` |
| GET | `/api/v1/strategies/instances/:id/status` | `strategy_instance:read` |
| GET | `/api/v1/strategies/instances/:id/runs` | `strategy_instance:read` |
| POST | `/api/v1/strategies/instances/:id/enable` | `strategy_instance:enable` |
| POST | `/api/v1/strategies/instances/:id/disable` | `strategy_instance:disable` |
| GET | `/api/v1/strategies/incidents` | `strategy_incident:read` |
| POST | `/api/v1/strategies/incidents/:id/resolve` | `strategy_incident:resolve` |
| GET | `/api/v1/strategies/metrics` | `strategy_metrics:read` |
| POST | `/api/v1/strategies/backtests` | `backtest:submit` |
| GET | `/api/v1/strategies/backtests` | `backtest:read` |
| GET | `/api/v1/strategies/backtests/:id` | `backtest:read` |
| GET | `/api/v1/strategies/backtests/:id/metrics` | `backtest:read` |
| GET | `/api/v1/strategies/backtests/:id/trades` | `backtest:read` |
| POST | `/api/v1/strategies/paper-sessions` | `paper_session:operate` |
| POST | `/api/v1/strategies/paper-sessions/:id/stop` | `paper_session:operate` |
| GET | `/api/v1/strategies/paper-sessions` | `paper_session:read` |
| GET | `/api/v1/strategies/paper-sessions/:id` | `paper_session:read` |
| GET | `/api/v1/strategies/paper-sessions/:id/snapshots` | `paper_session:read` |

**There is no route that places an order, and no route that switches a strategy
into live execution.** Enabling an instance makes it emit signals; whether a
signal becomes an order is decided afterwards by the Part 5 risk engine and
execution gates, none of which this module can call.

Invariants the module holds to:

* **The API executes nothing.** Every state change is a command enqueued onto
  `strategy-control` via `enqueueOrThrow`, answered `202` with a job id. If
  Redis is down the caller gets `503` and the row is marked `QUEUE_UNAVAILABLE`
  — never a silent success.
* **Risk-reducing operations write the database first**, then dispatch
  best-effort. Disabling an instance or stopping a session must survive a queue
  outage; enabling must not.
* **Arming a strategy under a live-armed deployment requires the typed phrase**
  `ENABLE STRATEGY IN LIVE MODE` (`StrategyInstancesService.LIVE_CONFIRMATION`),
  mirroring Part 5's `ENABLE LIVE TRADING`. A mis-click cannot do it.
* **`strategy_instance:enable` is in `NON_WILDCARD_PERMISSIONS`** — a `*` or
  `strategy_instance:*` grant does not confer it; it must be granted by name.
  `disable` is deliberately wildcard-reachable: making it *harder* to stop a
  strategy than to start one would be the wrong asymmetry.
* **The mapper never spreads a row.** Every field is copied by name, Decimal and
  BigInt are stringified, and `isSimulated: true` plus the disclaimer are
  attached in the mapper rather than at each call site — a label that depends on
  being remembered is a label that will eventually be forgotten.

`apps/api/src/modules/strategy/strategy-safety.spec.ts` (24 cases) asserts the
permission wiring, the boot-fail rules, the simulated labelling and the
confirmation phrase.

### 17.3 Admin console

`apps/admin-web/src/app/(console)/strategies/page.tsx` — a server component
that loads five panels in parallel, each degrading independently.

It is **read-only in this increment**, deliberately. Starting a strategy needs a
written reason, a runnable published version and, under a live-armed
deployment, a typed confirmation phrase. A one-click toggle on a dashboard is
the wrong shape for that, and shipping the toggle before the confirmation flow
is how a "quick test" becomes a running strategy.

The first card on the page is the execution boundary — engine, paper,
backtesting, trading mode, and whether live execution is reachable at all —
because that is the single most misread fact about a strategy screen. Withheld
metrics render as "insufficient data", never as `0`, and the page closes with
an explicit list of what the numbers are not.

### 17.4 Mobile client

`apps/mobile/lib/features/strategies/` — a read-only viewer answering three
questions: what is running, is any of it unhealthy, and what did the simulator
produce.

`StrategyRepository` declares GET methods and nothing else. There is no enable,
disable, start, stop or submit anywhere in the feature, and
`apps/mobile/test/strategy_view_test.dart` asserts that from the source: a unit
test cannot prove the absence of a capability by calling it, so it reads the
repository file and fails if a mutating verb ever appears. The API enforces the
same boundary independently — the mobile role is not granted
`strategy_instance:enable`.

Decimals arrive as strings and stay strings; parsing money into a `double` to
render it is how a UI starts disagreeing with the ledger. A missing
`isSimulated` flag is read as `true`. Every simulated card carries a SIMULATED
badge and the three disclaimers are on the screen, not in a settings page.

**Verified with a real toolchain.** Flutter 3.24.5 / Dart 3.5.4 — the newest
release matching the app's `intl ^0.19.0` and `flutter_lints ^4` pins — ran
`flutter pub get`, `flutter gen-l10n`, `flutter analyze` (zero issues) and
`flutter test` (**20 passed**: 10 pre-existing auth tests plus the 10 new
strategy-view tests). Two latent defects surfaced that no amount of reading had
caught, both in files written before Part 6: `error_mapper.dart`'s exhaustive
`DioExceptionType` switch did not cover `transformTimeout` (added in dio 5.9;
the app's `^5.7.0` caret resolves to 5.11.1), and `app.dart` carried an unused
`flutter_localizations` import. The first is fixed by folding
`transformTimeout` into the timeout group — same user-facing message, because a
stalled response transform is a stalled response to the person holding the
phone. `apps/mobile/pubspec.lock` is now committed alongside, so CI resolves
exactly the version set these gates were run against.

### 17.5 The verification sweep (2026-09-11)

Flutter, ruff and mypy had never actually run against this repository — no
sandbox in any part so far carried their toolchains. When they finally ran,
they found real findings, and the policy was **fix, never suppress**: not one
`type: ignore`, `noqa` or `pragma` was added.

* **Mobile** — `error_mapper.dart`'s exhaustive `DioExceptionType` switch
  lacked `transformTimeout` (dio 5.9 added it; the `^5.7.0` caret resolves to
  5.11.1), and `app.dart` had a dead import. Three const-literal lints in the
  new test file were folded in. Now: `flutter analyze` reports nothing, 20/20
  tests pass, and `apps/mobile/pubspec.lock` is committed so CI resolves the
  identical version set.
* **Python lint** — `ruff check` found 32 unused imports (Parts 2–5 and the
  Part 6 tests). All removed. The ruleset is now pinned in
  `libs/trading-core/pyproject.toml` (`E4/E7/E9/F`) so the gate cannot change
  colour with a ruff release; `select = ["ALL"]` is deliberately not used —
  formatting has never been a gate in this repo and hand-wrapped lines are
  part of its reading style.
* **Python types** — the repo's own `[tool.mypy] strict` config had never been
  executed; 26 errors were live across 13 files. Every one fixed: Decimal
  narrowing before `is_finite()` in `strategies/state.py`; a provably-dead
  guard deleted from `features/statistics.py`; the redundant `DISABLED`
  re-test dropped from `risk.py` (the authoritative guard stays);
  `async def -> AsyncIterator` abstract stream methods redeclared as the
  async-generator signatures mypy's own note recommends; the paper adapter's
  empty stream became a two-method ABC instead of an unreachable `yield`;
  barrel re-exports (`SymbolRef`, `RiskDecisionCode`, `ConnectionState`)
  made explicit; `getattr`-leaked `Any`s pinned with a local and a cast;
  `_gate_error_code` became a table so its fallback for forgotten gates stays
  visible instead of provably dead. The `_stopped` flag reads in
  `transport/websocket.py` go through `_stop_requested()` because mypy's
  member narrowing across `await` points cannot see the cross-task write
  that the guards exist to detect. Green under mypy 1.11.2 **and** 2.3.1.

Full contents of every file the sweep touched: Part 6-owned ones in
`docs/PART6_HANDOVER_FULL_SOURCE.md`, pre-existing-parts ones in
`docs/PART6_PERSISTENCE_HANDOVER_FULL_SOURCE.md` Part C.

---

## 18. What Part 6 deliberately does **not** include

* **No parameter optimisation and no ML.** `walkforward.py` provides labelled,
  non-overlapping, separately-checksummed windows and stops there. An optimiser
  that picks the best of many parameter sets on the same data manufactures
  overfitting; shipping one without the surrounding discipline would be worse
  than shipping none.
* **No exchange-fidelity claim.** No queue model, no market impact, no venue
  rejection modelling, no latency distribution.
* **No new live path.** Not one line of Part 5's execution code changed.

---

## 19. Commands

### OFFLINE SAFE TESTS — no network, no credentials, no orders

```bash
# Dependencies
npm install
cd libs/trading-core && python3 -m pip install -e ".[dev]" && cd -

# Build the shared TypeScript packages (must precede api typecheck)
npm run build:packages

# Generate the Prisma client (must precede api typecheck and the api tests)
./node_modules/.bin/prisma generate --schema apps/api/prisma/schema.prisma

# Lint and type gates. This repo runs no TypeScript formatter on purpose:
# eslint with --max-warnings=0 (root script, api workspace) plus `next lint`
# is the style gate. `ruff format` likewise does not gate the Python side;
# ruff's LINT rules are pinned in libs/trading-core/pyproject.toml so the
# gate does not shift colour with tool releases.
npm run lint
npm run lint --workspace=@wlct/admin-web
npm run typecheck
cd libs/trading-core && python3 -m ruff check wlct_trading tests && cd -
cd libs/trading-core && python3 -m mypy wlct_trading && cd -

# The whole Python suite: Parts 1-6
cd libs/trading-core && python3 -m pytest tests/ -q

# Part 6 by area
cd libs/trading-core && python3 -m pytest tests/test_strategy_features.py -q
cd libs/trading-core && python3 -m pytest tests/test_strategy_engine.py -q
cd libs/trading-core && python3 -m pytest tests/test_backtest.py -q
cd libs/trading-core && python3 -m pytest tests/test_paper_trading.py -q

# The two mandatory safety tests, by name
cd libs/trading-core && python3 -m pytest -q \
  tests/test_backtest.py::TestBacktestRun::test_the_same_inputs_produce_an_identical_result
cd libs/trading-core && python3 -m pytest -q tests/test_paper_trading.py::TestPaperTradingSafety

# Prove no live adapter is reachable from the new code
cd libs/trading-core && python3 -m pytest -q -k "imports_an_adapter or live_transport"

# TypeScript unit tests, including the strategy API safety spec
npm test
npm test --workspace=@wlct/api -- strategy-safety

# Mobile: analyse, and prove the client has no write path into the strategy
# layer. Run from apps/mobile so the source-reading test resolves its paths.
cd apps/mobile && flutter pub get && flutter analyze && cd -
cd apps/mobile && flutter test && cd -
cd apps/mobile && flutter test test/strategy_view_test.dart && cd -
```

### DATABASE

```bash
# The client was generated in the offline block above; re-running it after a
# deploy is harmless (it reads only the schema file, never the database).
./node_modules/.bin/prisma generate --schema apps/api/prisma/schema.prisma

# Inspect the Part 6 migration before applying it. It is additive only:
# CREATE TYPE / CREATE TABLE / CREATE INDEX / ADD CONSTRAINT and nothing else.
grep -Ev '^(--|$)' apps/api/prisma/migrations/20260907120000_part6_strategy_layer/migration.sql \
  | grep -Eiv '^(CREATE (TYPE|TABLE|UNIQUE INDEX|INDEX)|ALTER TABLE .* ADD CONSTRAINT|\s|\)|\()' \
  || echo 'additive only: no DROP, no destructive ALTER'

# Apply migrations. Never a destructive reset, never `migrate reset`.
./node_modules/.bin/prisma migrate deploy --schema apps/api/prisma/schema.prisma

# Confirm the schema still validates and the migration history is in sync.
./node_modules/.bin/prisma validate --schema apps/api/prisma/schema.prisma
./node_modules/.bin/prisma migrate status --schema apps/api/prisma/schema.prisma
```

### PAPER / LIVE MARKET DATA — real public feed, still no orders

```bash
# Public market-data smoke test (read-only, no credentials)
python3 scripts/live_market_data_smoke_test.py --duration 30

# Start the services with strategies on and execution off
STRATEGY_ENGINE_ENABLED=true \
PAPER_TRADING_ENABLED=true \
BACKTEST_ENABLED=true \
EXECUTION_ENABLED=false \
LIVE_TRADING_ENABLED=false \
DRY_RUN=true \
PAPER_TRADING=true \
npm run dev:api

# Paper mode: simulated fills against the real feed
STRATEGY_ENGINE_ENABLED=true PAPER_TRADING_ENABLED=true PAPER_TRADING=true \
LIVE_TRADING_ENABLED=false npm run dev:trading-engine
```

### BACKTEST

```bash
# Deterministic run twice; the results must be identical
cd libs/trading-core && python3 -m pytest -q \
  tests/test_backtest.py::TestBacktestRun::test_the_same_inputs_produce_an_identical_result

# Verify no live order adapter was reached anywhere in the new code
cd libs/trading-core && python3 - <<'PY'
import pathlib
roots = ["strategies", "backtest", "paper"]
bad = []
for name in roots:
    for path in pathlib.Path("wlct_trading", name).rglob("*.py"):
        for line in path.read_text().splitlines():
            if line.startswith(("import ", "from ")) and any(
                token in line
                for token in ("wlct_trading.net", "wlct_trading.execution")
            ):
                bad.append(f"{path}: {line}")
print("live-execution imports found:", bad or "NONE")
raise SystemExit(1 if bad else 0)
PY
```

### LIVE EXECUTION — does not enable live orders automatically

```bash
# This block places NO order. Every command below is a check.
# Live trading still requires all five Part 5 switches to agree, and every one
# of them defaults to the safe value.

# 1. Show the effective mode without changing anything.
node -e "require('./packages/config/dist/index.js'); console.log('config loaded; mode is decided by AppConfigService.tradingMode')"

# 2. The live harness refuses to run unless armed explicitly. Expect exit 2.
python3 scripts/live_execution_smoke_test.py --testnet ; echo "exit=$?"

# 3. Arming is deliberate, testnet-only, and needs a second confirmation:
#      WLCT_LIVE_EXECUTION=1
#      WLCT_LIVE_EXECUTION_CONFIRM=I_UNDERSTAND_THIS_PLACES_A_REAL_ORDER
#      --testnet --place-test-order --test-price <far-from-market>
#    Those variables are intentionally NOT set here.

# 4. Prove the strategy API exposes no order-placing route. Enable and disable
#    are strategy lifecycle only; there is no POST that sends an order.
grep -Rn "@Post(" apps/api/src/modules/strategy/ | grep -Ei "order|trade|execute|submit-order" \
  || echo 'no order-placing route in the strategy module'

# 5. Prove the strategy module cannot reach the live execution adapter.
grep -RnE "from '.*(execution/execution-(orders|adapter|live))" apps/api/src/modules/strategy/ \
  || echo 'strategy module imports no live execution service'

# 6. Prove the mobile client has no write path into the strategy layer.
grep -RnE "_apiClient\.(post|patch|put|delete)" apps/mobile/lib/features/strategies/ \
  || echo 'mobile strategy feature is read-only'

# 7. Arming a strategy under a live-armed deployment needs the typed phrase
#    ENABLE STRATEGY IN LIVE MODE. Show the constant; do not set anything.
grep -n "LIVE_CONFIRMATION" apps/api/src/modules/strategy/strategy-instances.service.ts
```
