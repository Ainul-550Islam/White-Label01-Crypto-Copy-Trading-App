# Part 3 — Real-Time Exchange Connectivity

The connectivity layer that turns a raw exchange websocket into a market-data
feed the rest of the platform can trust. It sits inside `libs/trading-core`
(Python package `wlct_trading`, now v0.3.0) and is shared by every data-plane
service.

---

## 1. What this layer is responsible for

| Concern | Module | Why it is separate |
|---|---|---|
| Socket lifecycle, heartbeat, reconnect | `transport/websocket.py` | One implementation, every venue |
| Reconnect pacing | `transport/backoff.py` | Capped exponential + full jitter |
| Error vocabulary and retry policy | `transport/errors.py` | Retryable vs not, decided once |
| Connection state machine | `transport/state.py` | Illegal transitions are impossible |
| Stream tracking and replay | `transport/subscriptions.py` | Reconnect must restore subscriptions |
| "Is this feed actually alive?" | `transport/staleness.py` | Open socket ≠ working feed |
| Weighted rate budgets | `transport/ratelimit.py` | Venues bill weight, not requests |
| Canonical symbols | `exchanges/symbols.py` | One vocabulary, one conversion point |
| Declared venue features | `exchanges/capabilities.py` | Removes `if exchange == ...` branches |
| Venue → adapter | `exchanges/registry.py` | The pluggability seam |
| Binance wire format | `exchanges/binance/` | The only venue-specific code |
| Snapshot + diff reconciliation | `orderbook_sync.py` | The correctness-critical piece |
| Latency and throughput | `metrics.py` | Observation, never a guarantee |

---

## 2. Data flow

```
Binance websocket
      │  raw JSON text frame
      ▼
WebSocketConnectionManager ── heartbeat ── staleness monitor
      │  (generation-fenced read loop)
      ▼
unwrap_combined_stream ──▶ parsers.py ──▶ canonical domain object
      │                                    (Decimal prices, micros)
      ▼
OrderBookSynchroniser ──── buffer ────▶ REST snapshot (rate-limited)
      │  bracketing check: U ≤ lastUpdateId+1 ≤ u
      ▼
OrderBook (Part 2)  ── sequence validation, gap → RESYNC_REQUIRED
      │
      ▼
BookTop  ── only when LIVE + healthy + fresh, else None
      │
      ▼
Strategies / risk engine / Redis fan-out
```

The **only** value that escapes to a strategy is a `BookTop`, and it is withheld
entirely unless the book is provably good. There is no state in which a
half-synchronised book is presented as usable.

---

## 3. The three problems this layer exists to solve

### 3.1 The bootstrap race

Fetching a snapshot and *then* subscribing loses every update in between. The
book looks plausible, prices look reasonable, and it is permanently wrong.

The implemented protocol is Binance's documented one:

1. Attach the stream first, buffer everything.
2. Fetch the REST snapshot (`lastUpdateId`).
3. Drop buffered diffs with `u <= lastUpdateId`.
4. **Require** that the first surviving diff satisfies
   `U <= lastUpdateId + 1 <= u`. If nothing brackets it, refetch — do not apply.
5. Apply the snapshot, replay the buffer in order.
6. Go live.

Step 4 is the one that is usually skipped, and skipping it is what bakes a
permanent hole into the book.

### 3.2 An open socket is not a working feed

The failure that quietly breaks trading systems is a connection that stays
open and stops delivering. Three independent mechanisms catch it:

- **Heartbeat timeout** — silence beyond `WS_HEARTBEAT_TIMEOUT_MS` tears the
  socket down and reconnects.
- **Staleness monitor** — per-channel thresholds, because trades are
  legitimately sporadic while a quiet order book is alarming.
- **`is_tradeable`** — requires LIVE *and* healthy *and* fresh, all three.

`ConnectionHealth.is_healthy` is defined as `is_connected and not is_stale`, so
a connected-but-stale feed can never report itself healthy.

### 3.3 Reconnect storms

Every reconnect path goes through capped exponential backoff with **full
jitter**. Without jitter, every connection retries in lockstep after a venue
blip and the resulting stampede is self-inflicted. Binance permits 300
connection attempts per 5 minutes per IP; an unbacked-off loop burns that in
under a minute and earns a ban.

Non-retryable categories (authentication, invalid request) drive the connection
to `STOPPED` rather than looping. Retrying an auth failure only locks the key
out faster.

---

## 4. Safety properties, and where they are enforced

| Property | Enforced by | Test |
|---|---|---|
| Book is never tradeable while syncing | `SyncPhase != LIVE` → `top()` returns `None` | `test_book_is_not_tradeable_while_buffering` |
| Gaps are never silently absorbed | `apply_delta` → `resync_required` | `test_sequence_gap_drops_the_book_out_of_live` |
| A crossed book is refused | `OrderBookHealth.CROSSED` | `test_crossed_book_is_not_tradeable` |
| Exhausted retries stop, never loop | `SyncPhase.FAILED`, `ConnectionState.STOPPED` | `test_exhausted_snapshot_attempts_end_in_failed_not_a_loop` |
| No duplicate sockets | `asyncio.Lock` + generation counter | `test_concurrent_connects_open_exactly_one_socket` |
| Stale sockets cannot write | generation fencing | `test_frames_from_a_superseded_socket_are_ignored` |
| Subscriptions restored on reconnect | `mark_all_pending()` then replay | `test_restore_demotes_subscriptions_to_pending_before_replaying` |
| Rate budget respected locally | reserve-before-send | `test_adapter_refuses_to_exceed_the_weight_budget` |
| No credentials in logs | recursive `scrub_metadata` | `test_scrubbing_recurses_into_nested_metadata` |
| Market data needs no secrets | `MarketDataAdapter` takes no resolver | `test_no_credentials_are_required_anywhere_on_the_market_data_path` |

---

## 5. Design decisions worth stating

**Precision.** Prices are parsed from strings straight to `Decimal`. A float
input is *rejected*, not coerced — a float means precision was already lost
upstream, and silently accepting it corrupts prices.

**Timestamps.** Binance publishes milliseconds; the platform uses microseconds.
Conversion happens once, in the parsers.

**Feed lag is an estimate.** It is computed across two unsynchronised clocks and
can legitimately be negative. The metrics module records negative values rather
than clamping them, because clamping hides skew and makes a number look
trustworthy when it is not. Processing latency, measured on one clock, is exact.
Nothing in this layer expresses a latency guarantee.

**Symbol splitting is authoritative first.** `BTCUSDT` is genuinely ambiguous
without the venue's asset list, so `exchangeInfo` metadata is preferred and the
heuristic is a documented bootstrap fallback. The heuristic itself prefers
candidates whose base is a recognised asset — naive longest-suffix matching
splits `XBTUSD` into `XB`/`TUSD`.

**Buffer eviction is honest.** When the diff buffer overflows the oldest entry
is dropped and counted. That can break bracketing, so the synchroniser refetches
rather than pretending continuity it does not have.

**Resync keeps the buffer by default.** After a mid-stream gap the buffered
diffs are still valid and are what lets the next snapshot be bracketed.
`discard_buffer=True` is passed only on socket reconnect, where sequence
continuity genuinely cannot be assumed.

---

## 6. Adding a venue

Nothing generic changes. Write `exchanges/<venue>/` with:

1. `capabilities.py` — declare order types, channels, limits, weights.
2. `parsers.py` — pure functions, venue JSON → canonical objects.
3. `adapter.py` — implement `MarketDataAdapter`, supply `ConnectionCallbacks`.

Then one entry in `build_default_registry()`. The connection manager, backoff,
subscriptions, rate limiting, staleness detection and book synchronisation are
all inherited.

Binance was chosen first because its documentation is the most complete of the
major venues and its book-sync protocol is the strictest of the common ones — an
implementation satisfying it generalises downward.

---

## 7. Testability

The library has **zero runtime dependencies** and opens no sockets. Transport
and HTTP arrive as injected callables:

```python
TransportFactory = Callable[[str], Awaitable[WebSocketTransport]]
HttpGetter       = Callable[[str, Mapping[str, Any]], Awaitable[Any]]
```

`WebSocketTransport` is deliberately three methods (`send`, `receive`, `close`)
so the test double is trivial and trustworthy. The result: reconnect storms,
heartbeat timeouts, subscription restoration and the bootstrap race — the paths
that are nearly impossible to reproduce against a live venue — are all
deterministic unit tests that run in milliseconds with no network.

```
356 passed in 0.33s
```

| Suite | Tests | Covers |
|---|---|---|
| `test_transport.py` | 40 | backoff, error taxonomy, state machine, rate limits |
| `test_websocket_manager.py` | 24 | connect, reconnect, heartbeat, fencing, restore |
| `test_orderbook_sync.py` | 25 | bootstrap, bracketing, gaps, fail-closed |
| `test_exchanges.py` | 40 | symbols, capabilities, registry |
| `test_binance.py` | 35 | wire format, error mapping, framing |
| `test_connectivity_health.py` | 25 | subscriptions, staleness, metrics |
| `test_connectivity_pipeline.py` | 7 | full frame → tradeable book |
| Part 2 suites | 160 | unchanged, no regressions |

---

## 8. Commands

```bash
# Tests (no venv, no network, no database required)
cd libs/trading-core && python3 -m pytest tests/ -q

# One suite
python3 -m pytest tests/test_orderbook_sync.py -v

# Type check and lint (dev extras)
pip install -e '.[dev]' && mypy wlct_trading && ruff check wlct_trading tests
```

---

## 9. Explicitly NOT built

Stated plainly so nothing is assumed present:

- **No production websocket client is wired in.** The `websockets`/`aiohttp`
  adapters implementing `WebSocketTransport` and `HttpGetter` are not written;
  the layer is complete and tested behind those two interfaces.
- **No order placement.** `BinanceMarketDataAdapter` is market-data only. No
  `TradingAdapter` is registered, and `create_trading_adapter` raises
  `UnsupportedExchange` rather than implying a path that does not exist.
- **No user-data stream.** Listen-key renewal is declared in capabilities but
  not implemented.
- **Bybit, OKX, Kraken.** Present in `ExchangeId` because the schema models
  them; deliberately not registered, so selecting one fails clearly.
- **No REST API endpoints, admin console, or Flutter screens** for this layer.
- **No Redis fan-out or Prisma persistence wiring** of these streams.
- `EXECUTION_ENABLED` remains `false`.
