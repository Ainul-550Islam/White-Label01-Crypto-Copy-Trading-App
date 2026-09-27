# Part 4 — Live Market Data Transport

**Status:** delivered. `libs/trading-core` v0.4.0, 407 tests passing offline,
verified end to end against real Binance public market data.

---

## 1. What this part enables, in plain terms

| Capability | Status |
| --- | --- |
| **Public market data over a real exchange websocket** | **Enabled.** Ticker (best bid/ask), public trades and full depth order books stream from Binance spot through the existing Part 3 pipeline. |
| **Live order execution** | **NOT implemented.** No code path in this layer signs a request or submits an order. |
| **API credentials** | **Not required and not accepted.** Public market data needs none. The market-data adapter has no parameter that could hold a key. |
| **Latency** | **Not guaranteed.** Every number the metrics layer reports is an observation of what already happened on this instance. Nothing here is a service-level commitment, and feed-lag figures are computed across two unsynchronised clocks. |

If you need order execution, that is a later part. `EXECUTION_ENABLED` remains
`false` and the execution path is still gated.

---

## 2. What existed before, and what Part 4 added

Part 3 built the whole connectivity pipeline but deliberately stopped at two
seams: `WebSocketTransport` (a three-method protocol) and `HttpGetter` (a
callable type). Both were injected, so the library stayed installable and
testable with no network stack present.

Part 4 supplies the concrete implementations of those two seams and a service
runner around them. It added no second pipeline: reconnection, backoff, state
transitions, subscription tracking, staleness, sequence validation and
order-book synchronisation are all the Part 3 components, unmodified.

```
                    ┌──────────────────────── Part 4 (new) ────────────────────────┐
   env vars ──────► TransportSettings ──► MarketDataRunner ──► MarketDataFeed
                                                │                     │
                          WebsocketsTransportFactory          routes frames
                          HttpxGetter                                 │
                    └──────────────┬───────────────────────────────────┘
                                   │ injected into
                    ┌──────────────▼──────────────── Part 3 (unchanged) ───────────┐
                    │ WebSocketConnectionManager ── SubscriptionManager            │
                    │   ExponentialBackoff · ConnectionState · StalenessMonitor    │
                    │ BinanceMarketDataAdapter ── parsers ── WeightedRateLimiter   │
                    │ OrderBookSynchroniser ── OrderBook ── BookTop                │
                    └──────────────────────────────────────────────────────────────┘
```

---

## 3. Dependencies

`wlct-trading-core` still declares `dependencies = []`. The network clients live
in an optional extra:

```toml
[project.optional-dependencies]
live = ["websockets>=13.1,<18", "httpx>=0.27,<0.29"]
```

`import wlct_trading` pulls in neither, and `import wlct_trading.net` still
pulls in neither — both clients are imported lazily inside the function that
first needs them, so a missing extra produces an actionable install message
instead of an import crash at startup.

**httpx rather than aiohttp.** `services/market-data` already depends on `httpx`
and already uses it in `app/services/providers.py`. A second async HTTP stack in
the same process would mean two connection pools and two sets of timeout
semantics for no capability that is missing.

---

## 4. Error vocabulary: mapped, not extended

Part 3 defined nine error categories and an exhaustive retry policy for each.
Part 4 maps every library exception onto that set rather than adding to it — two
overlapping taxonomies would mean two places to look up whether something is
retryable, and they would eventually disagree.

| Conceptual failure | Existing category | Retryable |
| --- | --- | --- |
| connection refused / reset / DNS / TLS handshake | `NETWORK_ERROR` | yes |
| connect or read timeout | `TIMEOUT` | yes |
| websocket protocol violation, malformed JSON, malformed fields | `EXCHANGE_ERROR` | yes, bounded |
| HTTP 429 / 418 | `RATE_LIMIT_ERROR` | yes, honours `Retry-After` |
| HTTP 4xx | `INVALID_REQUEST` | **no** |
| HTTP 401 / 403 | `AUTHENTICATION_ERROR` | **no** |
| HTTP 5xx | `EXCHANGE_ERROR` | yes, bounded |
| anything unrecognised | `UNKNOWN_ERROR` | yes, 3 attempts |

The same reasoning applies to connection states. `SUBSCRIBING` and `STREAMING`
were not added to `ConnectionState`: subscription progress is already tracked
per subscription (`PENDING` → `ACTIVE`), and "streaming" is answered precisely by
`CONNECTED` plus freshness. Adding states would have widened a state machine
whose existing tests assert that illegal transitions are impossible.

No library exception escapes `wlct_trading.net`. Callers see
`NormalisedExchangeError`, or — from the adapter — `AdapterConnectionError`.

---

## 5. Runtime flow

1. `TransportSettings.from_env()` parses and validates configuration. A bad
   boolean, an out-of-range timeout, a `ws://` URL or an all-channels-disabled
   configuration fails here, at startup.
2. `MarketDataRunner` builds `HttpxGetter` and `WebsocketsTransportFactory`, and
   injects both into `BinanceMarketDataAdapter` along with the configured
   endpoints. The adapter is the single source of truth for every URL.
3. `MarketDataFeed.start()` calls `load_symbols()` (public `exchangeInfo`), then
   resolves the configured symbols against that listing. `BTC/USDT`, `btc-usdt`
   and `BTCUSDT` all normalise to `BTC-USDT`; an unlisted symbol aborts startup.
4. One subscription is built per (symbol × enabled channel) and registered with
   the existing `SubscriptionManager`. All streams go on **one** connection.
5. The supervisor (`run_forever`) connects. Streams are named in the URL, so the
   socket arrives already subscribed — there is no window where it is open but
   silent.
6. Each frame is routed by stream name to the venue parser, then to the order
   book synchroniser, the ticker cache or the trade cache. A subscription is
   marked `ACTIVE` when its data actually arrives, not when a frame is sent.
7. A background worker fetches REST depth snapshots. Snapshot I/O never happens
   on the read loop.

### Order-book synchronisation

Follows Binance's documented procedure exactly, which Part 3 already implements:
subscribe to the diff stream first, buffer diffs, then fetch the snapshot, drop
every buffered event with `u <= lastUpdateId`, require the first applied event to
satisfy `U <= lastUpdateId+1 <= u`, and refetch if the snapshot does not bracket
the buffer. Afterwards each event's `U` must equal the previous `u + 1`, or the
book is invalidated.

A book is tradeable only when **all** of these hold: phase is `LIVE`, health is
`OK` (not crossed), the book is not stale, **and** the socket is currently
connected. `book_top()` returns `None` otherwise — a stale book is never exposed
as tradeable.

---

## 6. Reconnect flow

1. The peer closes, or a read fails. The transport raises the platform's
   `ConnectionClosed` (translated from the library's own type — this is the exact
   type the existing read loop keys on).
2. The read loop records a normalised error and transitions to `DISCONNECTED`.
3. The feed's state callback fires **synchronously**: the tradeable gate closes
   immediately, and one resync is queued per book. Nothing waits for the
   asynchronous resync to begin, because that window is where a strategy could
   otherwise read a book belonging to a dead connection.
4. The supervisor calls `reconnect()`, which honours the existing capped
   exponential backoff with jitter and the attempt cap. Exhausting the cap moves
   the connection to `STOPPED` rather than looping forever.
5. On success, `restore_subscriptions()` demotes every subscription to `PENDING`
   and replays them in batched `SUBSCRIBE` frames through the existing
   subscription manager.
6. The resync worker waits for the connection before fetching, so exactly one
   snapshot is fetched per reconnect. A depth snapshot costs up to 250 rate-limit
   weight; fetching two would double that for nothing.
7. Books rebuild from the fresh snapshot and become tradeable again only after
   the sequence brackets cleanly.

---

## 7. Shutdown flow

`SIGINT`/`SIGTERM` → `runner.request_stop()` → the run loop exits and:

1. `UNSUBSCRIBE` frames are sent while the socket is still open.
2. `manager.stop()` sets the terminal state and tears down the reader,
   heartbeat and transport. This is done through the manager's own API rather
   than by cancelling the supervisor task: `run_forever` deliberately suppresses
   cancellation around its reader await, so a bare `cancel()` would be absorbed
   and the task would keep reconnecting.
3. Background workers are cancelled with a bounded wait.
4. The HTTP session is closed, releasing the connection pool.

`stop()` is idempotent and never raises.

---

## 8. Security

* **TLS only.** `ws://` and `http://` are refused at three independent layers:
  `TransportSettings`, the transport factory, and the service's own pydantic
  settings. There is no flag anywhere that disables certificate verification —
  such a flag inevitably ends up set in a production `.env`.
* **No credentials.** No field in `TransportSettings` can hold one (enforced by a
  test), no `Authorization` or `X-MBX-APIKEY` header is ever sent, and no request
  is signed.
* **No secrets in logs.** Query strings are stripped from URLs before they reach
  a log line, and error metadata passes through the existing recursive
  `scrub_metadata`.
* **Bounded everything.** Frame size, buffered diffs, retry counts, reconnect
  attempts and every timeout are capped. There is no unbounded wait or unbounded
  buffer on this path.

---

## 9. Configuration

All keys live in `.env.example` under **LIVE MARKET DATA TRANSPORT**. The ones
you are most likely to change:

| Key | Default | Notes |
| --- | --- | --- |
| `BINANCE_WS_URL` | `wss://stream.binance.com:9443` | Must be `wss://`. |
| `BINANCE_REST_URL` | `https://api.binance.com` | Must be `https://`. |
| `MARKET_DATA_SYMBOLS` | `BTC/USDT,ETH/USDT,SOL/USDT` | Any of three spellings. |
| `MARKET_DATA_TICKER_ENABLED` | `true` | `bookTicker` — best bid/ask per change. |
| `MARKET_DATA_TRADES_ENABLED` | `true` | |
| `MARKET_DATA_ORDERBOOK_ENABLED` | `true` | Depth diffs at 100 ms. |
| `WEBSOCKET_CONNECT_TIMEOUT_MS` | `10000` | |
| `WEBSOCKET_RECEIVE_TIMEOUT_MS` | `300000` | Backstop below the heartbeat; see below. |
| `WEBSOCKET_HEARTBEAT_TIMEOUT_MS` | `90000` | Primary liveness detector. |
| `HTTP_CONNECT_TIMEOUT_MS` / `HTTP_READ_TIMEOUT_MS` / `HTTP_TOTAL_TIMEOUT_MS` | `5000` / `10000` / `15000` | All three always apply. |
| `LIVE_MARKET_DATA_SMOKE_TEST_DURATION_SECONDS` | `30` | Smoke test only. |

`WEBSOCKET_RECEIVE_TIMEOUT_MS` is deliberately generous. A thin symbol's trade
stream can legitimately be silent for minutes, and Binance's protocol pings are
answered by the client library without ever surfacing as a message — so a short
receive timeout tears down healthy connections in a loop. The heartbeat is the
liveness check; this is the backstop beneath it.

### Regional note

`api.binance.com` returns HTTP 451 in restricted regions. Binance publishes a
market-data-only mirror that speaks the same public API:

```bash
BINANCE_REST_URL=https://data-api.binance.vision
BINANCE_WS_URL=wss://data-stream.binance.vision
```

This is exactly why the endpoints are configurable in one place rather than
compiled in.

---

## 10. Metrics

Transport counters were added to the existing `ConnectivityMetrics`, alongside
the per-stream metrics Part 3 already collected:

`connectionAttempts`, `connectionSuccesses`, `connectionFailures`, `disconnects`,
`reconnects`, `framesReceived`, `bytesReceived`, `framesSent`, `parseErrors`,
`heartbeatFailures`, `snapshotRequests`, `snapshotFailures`, `bookResyncs`, plus
a snapshot-latency histogram.

Snapshot latency is measured entirely on the local clock, so unlike feed lag it
carries no clock-skew caveat. It still says nothing about the venue's internal
processing time. Failed requests are counted but contribute no latency sample: a
timeout's duration is a property of the timeout setting, not of the venue.

### Health

`feed.health().status` is one of:

| Status | Meaning |
| --- | --- |
| `healthy` | Connected **and** every stream fresh. Books may be traded against. |
| `degraded` | Connected but one or more streams are stale. **The dangerous case** — the socket looks fine and the data is worthless. |
| `disconnected` | No venue connection. All books gated off. |
| `stopped` | The feed is not running. |

---

## 11. Testing

**The normal suite needs no internet, credentials, database or Redis.**

```bash
cd libs/trading-core && python3 -m pytest tests/ -q      # 407 passed
```

`tests/test_net_transport.py` (27) covers connect, send, receive, close, connect
timeout, receive timeout, network failure, plaintext-URL refusal, exception
mapping, HTTP success, HTTP timeout, non-2xx, rate limiting, malformed JSON,
session lifecycle and the no-credentials guarantee.

`tests/test_net_feed.py` (17) covers the full pipeline, malformed exchange
messages, reconnection through the existing state machine, subscription
restoration, order-book resync after a reconnect, gap-triggered resync,
configured symbols and channels, clean shutdown and the three health states.

### Live smoke test (separately invoked, needs internet)

```bash
python3 scripts/live_market_data_smoke_test.py --duration 30
```

It runs the real pipeline against public endpoints, verifies normalised events
and a two-sided uncrossed book, shuts down cleanly, and **submits no orders**.
A recent run against `data-stream.binance.vision`:

```
  [PASS] Received live frames from the venue — 3289 messages
  [PASS] Normalised tickers with a sane spread — 2096 tickers
  [PASS] Normalised public trades with positive prices — 697 trades
  [PASS] Order book reached a tradeable state — tradeable: BTC-USDT, ETH-USDT
  [PASS] BTC-USDT book is not crossed — bid 79916.00000000 / ask 79916.01000000
  [PASS] No malformed frames were received — 0 parse errors
  [PASS] Feed shut down cleanly — no residual connection
  12/12 checks passed
```

---

## 12. Running it

```bash
# Install the optional network clients
pip install -e 'libs/trading-core[live]'

# Print the resolved configuration without connecting
python3 -m wlct_trading.net --print-config

# Stream until interrupted
python3 -m wlct_trading.net --symbols BTC/USDT,ETH/USDT

# Or the whole service
cd services/market-data && uvicorn app.main:app --host 0.0.0.0 --port 8002
```

---

## 13. Explicitly NOT built in Part 4

* Live order execution, order signing, or any authenticated endpoint.
* User-data streams (they require a listen key, therefore credentials).
* Any venue other than Binance spot. The registry still contains one adapter.
* Persisting market data to PostgreSQL or Redis from this path. The feed holds
  state in memory; wiring it to the hot-state layer is separate work.
* A metrics exporter. `ConnectivityMetrics.to_dict()` is scrapeable; nothing
  scrapes it yet.
* Multi-connection sharding. One connection carries every stream, which is well
  within Binance's 1024-streams-per-socket limit but is not a sharding strategy.
