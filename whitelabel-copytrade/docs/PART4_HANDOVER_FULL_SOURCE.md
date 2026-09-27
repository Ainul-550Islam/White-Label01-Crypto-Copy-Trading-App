# Part 4 — Live Market Data Transport · Complete Handover + Full Source

> **Status of this document.** Part 4 was implemented, verified and delivered
> earlier in this project, and Part 5 (authenticated execution foundation) was
> subsequently built on top of it. Nothing was rebuilt to produce this file:
> every source listing below is the **current, on-disk, final content** of the
> file at the stated path, emitted verbatim. Part 4 is re-verified green as of
> this document: `437 passed` for the whole `libs/trading-core` suite, `44
> passed` for the two Part 4 test modules.
>
> Where a file has been touched again by Part 5 (`wlct_trading/__init__.py`,
> `wlct_trading/metrics.py`, `pyproject.toml`, `.env.example`), the listing is
> the final content **including** those later additions — this document never
> shows a truncated or historical version of a file. Part 5 additions are
> called out in the manifest so the Part 4 delta is unambiguous.

---

## 1. Current Part 3 architecture summary

Part 3 delivered the complete connectivity pipeline as a **pure, dependency-free
library**. `libs/trading-core/pyproject.toml` declares `dependencies = []`, and
the whole pipeline is driven in tests by in-memory fakes.

| Component | Path | Responsibility |
| --- | --- | --- |
| `WebSocketConnectionManager` | `wlct_trading/transport/websocket.py` | Owns one socket: connect, heartbeat, death detection, backoff, reconnect, subscription replay. Generation counter kills superseded reader/heartbeat tasks. |
| `WebSocketTransport` (Protocol) | `wlct_trading/transport/websocket.py` | Three methods — `send(str)`, `receive() -> str`, `close()`. The manager never imports a websocket library. |
| `TransportFactory` | `wlct_trading/transport/websocket.py` | `async (url) -> WebSocketTransport`. The injection seam. |
| `ConnectionClosed` | `wlct_trading/transport/websocket.py` | Platform-owned "peer went away" exception the read loop keys on. |
| `ExponentialBackoff` / `BackoffConfig` | `wlct_trading/transport/backoff.py` | Capped exponential backoff with jitter and an attempt cap. |
| `ConnectionState` / `is_legal_connection_transition` | `wlct_trading/transport/state.py` | `DISCONNECTED · CONNECTING · CONNECTED · RECONNECTING · ERROR · STOPPED`, plus `ConnectionHealth` and `LatencyStats`. Illegal transitions raise. |
| `SubscriptionManager` / `Subscription` | `wlct_trading/transport/subscriptions.py` | Per-subscription `PENDING → ACTIVE` tracking, batched replay after reconnect. |
| `StalenessMonitor` | `wlct_trading/transport/staleness.py` | "Connected" ≠ "fresh". Tracks last-data-at per stream. |
| `WeightedRateLimiter` | `wlct_trading/transport/ratelimit.py` | Venue weight budgets (`REQUEST_WEIGHT` 6000/60s, `RAW_REQUESTS` 61000/300s). |
| `ExchangeErrorCategory` / `NormalisedExchangeError` / `RETRY_POLICIES` | `wlct_trading/transport/errors.py` | Nine categories: `NETWORK_ERROR`, `AUTHENTICATION_ERROR`, `RATE_LIMIT_ERROR`, `INVALID_REQUEST`, `SUBSCRIPTION_ERROR`, `EXCHANGE_ERROR`, `SEQUENCE_ERROR`, `TIMEOUT`, `UNKNOWN_ERROR` — each with an explicit retry policy. Metadata is recursively scrubbed. |
| `BinanceMarketDataAdapter` + `HttpGetter` | `wlct_trading/exchanges/binance/adapter.py` | Stream naming, subscribe/unsubscribe frame construction, endpoint ownership. `HttpGetter = Callable[[str, Mapping[str, Any]], Awaitable[Any]]` — the HTTP injection seam. |
| Binance parsers | `wlct_trading/exchanges/binance/parsers.py` | Venue JSON → canonical objects. Rejects floats; `json.loads(..., parse_float=str, parse_int=str)`. |
| `OrderBookSynchroniser` | `wlct_trading/orderbook_sync.py` | Binance's documented buffer-then-snapshot procedure, sequence bracketing, fail-closed invalidation. |
| `OrderBook` / `BookTop` | `wlct_trading/order_book.py` | Canonical book, crossed-book health, tradeability gate. |
| `ConnectivityMetrics` | `wlct_trading/metrics.py` | Counters, latency histograms, stream metrics. |

Part 3 stopped, deliberately, at exactly two seams: **`WebSocketTransport`** and
**`HttpGetter`**. Neither had a production implementation.

---

## 2. What Part 4 adds

Part 4 fills those two seams and wraps a service around them. It adds **no
second pipeline, no second state machine, no second backoff, no second
subscription manager and no second error taxonomy.**

| Added | What it is |
| --- | --- |
| `WebsocketsTransport` / `WebsocketsTransportFactory` | Production `WebSocketTransport` over the `websockets` library. Implements exactly `send` / `receive` / `close`. |
| `HttpxGetter` | Production `HttpGetter` over `httpx`. Bounded retries, status validation, `Retry-After`, string-preserving JSON parsing, owned session lifecycle. |
| `normalise.py` | The single translation layer from library exceptions and HTTP statuses onto the existing nine `ExchangeErrorCategory` members. No library type escapes `wlct_trading.net`. |
| `TransportSettings` | Env-driven, validated-at-startup configuration for endpoints, symbols, channels and all six timeouts. |
| `resolve_configured_symbols` | Canonicalises configured symbols through the existing symbol normalisation and validates them against the live `exchangeInfo` listing. |
| `MarketDataFeed` | The wiring: builds subscriptions per (symbol × enabled channel), routes frames to the venue parser, feeds the synchroniser/ticker/trade caches, queues resyncs on disconnect, exposes `FeedHealth`. |
| `MarketDataRunner` + `__main__.py` | Service entry point: signal handlers, structured logging, periodic health reporting, clean shutdown. |
| `TransportCounters` / `TransportMetrics` | Production transport counters folded into the **existing** `ConnectivityMetrics`. |
| `scripts/live_market_data_smoke_test.py` | Separately invoked LIVE MARKET DATA SMOKE TEST. Never collected by `pytest`. |
| `tests/test_net_transport.py` + `tests/test_net_feed.py` | 44 deterministic tests covering the 20 enumerated cases. No internet, no credentials, no DB, no Redis. |

**Still not implemented, by design:** order placement, order cancellation,
withdrawal, deposit, account trading, private user stream. Public market data
only. (Part 5, delivered later, adds the authenticated foundation behind its own
kill switches — it is not part of this document.)

---

## 3. Exact integration points

```
Real Binance WebSocket  wss://stream.binance.com:9443
        │
        ▼
WebsocketsTransportFactory ──implements──► TransportFactory        (Part 3 seam)
WebsocketsTransport        ──implements──► WebSocketTransport      (Part 3 seam)
        │  injected via ConnectionConfig.transport_factory
        ▼
WebSocketConnectionManager                                          (Part 3, unmodified)
        │  ConnectionCallbacks.on_message / on_state_change / on_error
        ▼
MarketDataFeed._on_message                                          (Part 4, routing only)
        │
        ▼
BinanceMarketDataAdapter + parsers                                  (Part 3, unmodified)
        │
        ├──► OrderBookSynchroniser ──► OrderBook ──► BookTop        (Part 3, unmodified)
        │            ▲
        │            │ snapshot fetch
        │     HttpxGetter ──implements──► HttpGetter                (Part 3 seam)
        │            │
        │            ▼
        │     REST https://api.binance.com/api/v3/depth
        │
        ├──► Ticker cache
        └──► PublicTrade cache
```

Precise seam list:

1. `wlct_trading.transport.websocket.WebSocketTransport` ← `net/websocket_client.py::WebsocketsTransport`
2. `wlct_trading.transport.websocket.TransportFactory` ← `net/websocket_client.py::WebsocketsTransportFactory`
3. `wlct_trading.exchanges.binance.adapter.HttpGetter` ← `net/http_client.py::HttpxGetter`
4. `wlct_trading.transport.errors.ExchangeErrorCategory` ← `net/normalise.py` (mapped onto, never extended)
5. `wlct_trading.transport.websocket.ConnectionClosed` ← raised by `WebsocketsTransport.receive()` when the library reports a peer close
6. `wlct_trading.metrics.ConnectivityMetrics` ← extended with `TransportCounters` / `TransportMetrics`
7. `wlct_trading.exchanges.symbols` ← used by `net/symbols.py`; no second normaliser

---

## 4. New files

| Path | Lines | Purpose |
| --- | --- | --- |
| `libs/trading-core/wlct_trading/net/__init__.py` | 67 | Public surface of the optional transport subpackage. |
| `libs/trading-core/wlct_trading/net/config.py` | 435 | `TransportSettings.from_env()`, strict bool/int/symbol-list parsing, fail-at-startup validation. |
| `libs/trading-core/wlct_trading/net/symbols.py` | 113 | Configured-symbol canonicalisation and listing validation. |
| `libs/trading-core/wlct_trading/net/http_client.py` | 312 | `HttpxGetter` — production `HttpGetter`. |
| `libs/trading-core/wlct_trading/net/websocket_client.py` | 329 | `WebsocketsTransport` + factory — production `WebSocketTransport`. |
| `libs/trading-core/wlct_trading/net/normalise.py` | 252 | Library exception / HTTP status → existing error taxonomy. |
| `libs/trading-core/wlct_trading/net/feed.py` | 965 | `MarketDataFeed`, `FeedHealth`, `FeedCallbacks`. |
| `libs/trading-core/wlct_trading/net/runner.py` | 235 | `MarketDataRunner`, `configure_logging`, `run`. |
| `libs/trading-core/wlct_trading/net/__main__.py` | 102 | `python -m wlct_trading.net` CLI. |
| `libs/trading-core/tests/test_net_transport.py` | 575 | Transport-level deterministic tests. |
| `libs/trading-core/tests/test_net_feed.py` | 787 | Feed / reconnect / resync / health deterministic tests. |
| `scripts/live_market_data_smoke_test.py` | 302 | LIVE MARKET DATA SMOKE TEST, separately invoked. |
| `docs/PART4_LIVE_TRANSPORT.md` | 337 | Part 4 documentation. |

## 5. Modified files

| Path | Change |
| --- | --- |
| `libs/trading-core/pyproject.toml` | Added the `live` optional extra (`websockets`, `httpx`), the `live` pytest marker and `addopts = "-m 'not live'"`. *(Version later bumped to 0.5.0 by Part 5.)* |
| `libs/trading-core/wlct_trading/__init__.py` | Version bump; `net` deliberately **not** re-exported so `import wlct_trading` stays dependency-free. *(Part 5 also keeps `execution` out of this barrel.)* |
| `libs/trading-core/wlct_trading/metrics.py` | Added `TransportCounters` and `TransportMetrics`, wired into the existing `ConnectivityMetrics`. *(`ExecutionCounters` / `ExecutionMetrics` in the same file are Part 5.)* |
| `services/market-data/app/config.py` | Pydantic settings for the same env keys, with the same TLS-only validation. |
| `services/market-data/requirements.txt` | `websockets` and `httpx` pinned for the service image. |
| `services/market-data/.env.example` | Service-level market-data keys. |
| `services/market-data/tests/conftest.py` | Fixtures for the new settings. |
| `.env.example` | The 13 Part 4 configuration keys with safe defaults. *(This file also carries Part 1–3 and Part 5 keys.)* |

## 6. Dependency changes

```toml
[project.optional-dependencies]
live = [
  "websockets>=13.1,<18",
  "httpx>=0.27,<0.29",
]
```

`dependencies = []` is unchanged. `import wlct_trading` pulls in neither
library, and `import wlct_trading.net` still pulls in neither — both clients are
imported lazily inside the function that first needs them, so a missing extra
produces an actionable install message rather than an import crash.

**`httpx`, not `aiohttp`.** `services/market-data` already depends on `httpx`
and already uses it in `app/services/providers.py`. A second async HTTP stack in
the same process means two connection pools and two sets of timeout semantics
for no capability that is missing. This is the documented deviation from the
brief's "prefer aiohttp", taken under the brief's own "unless the existing
project already uses another appropriate async HTTP client" clause.

## 7. Runtime flow

1. `TransportSettings.from_env()` parses and validates. A bad boolean, an
   out-of-range timeout, a `ws://` URL, or all channels disabled fails **here**,
   at startup.
2. `MarketDataRunner` builds `HttpxGetter` and `WebsocketsTransportFactory` and
   injects both into `BinanceMarketDataAdapter` along with the configured
   endpoints. The adapter remains the single source of truth for every URL.
3. `MarketDataFeed.start()` calls `load_symbols()` (public `exchangeInfo`), then
   resolves configured symbols against that listing. `BTC/USDT`, `btc-usdt` and
   `BTCUSDT` all normalise to `BTC-USDT`; an unlisted symbol aborts startup.
4. One subscription per (symbol × enabled channel) is registered with the
   existing `SubscriptionManager`. All streams share **one** connection.
5. `run_forever()` connects. Streams are named in the URL, so the socket arrives
   already subscribed — there is no open-but-silent window.
6. Each frame is routed by stream name to the venue parser, then to the
   synchroniser, the ticker cache or the trade cache. A subscription flips to
   `ACTIVE` when its data actually arrives, not when a frame is sent.
7. A background worker fetches REST depth snapshots. Snapshot I/O never happens
   on the read loop.

## 8. Shutdown flow

`SIGINT`/`SIGTERM` → `runner.request_stop()` → the run loop exits and:

1. `UNSUBSCRIBE` frames are sent while the socket is still open.
2. `manager.stop()` sets the terminal state and tears down reader, heartbeat and
   transport — through the manager's own API, never by cancelling the supervisor
   task (`run_forever` suppresses cancellation around its reader await, so a
   bare `cancel()` is absorbed and the task keeps reconnecting).
3. Background workers are cancelled with a bounded wait.
4. The HTTP session is closed, releasing the connection pool.

`stop()` is idempotent and never raises. No task, socket or TCP connection is
left behind.

## 9. Reconnect flow

1. Peer closes or a read fails → the transport raises the platform's
   `ConnectionClosed` (translated from the library type).
2. The read loop records a normalised error and transitions to `DISCONNECTED`.
3. The feed's state callback fires **synchronously**: the tradeable gate closes
   immediately and one resync is queued per book. Nothing waits for the async
   resync to start — that window is exactly where a strategy could otherwise
   read a book belonging to a dead socket.
4. The supervisor calls `reconnect()` → existing capped exponential backoff with
   jitter and attempt cap. Exhausting the cap moves the connection to `STOPPED`,
   not into a loop. A non-retryable category stops immediately per the existing
   policy.
5. On success, `restore_subscriptions()` demotes every subscription to `PENDING`
   and replays them in batched frames through the existing subscription manager.
6. The resync worker waits for the connection before fetching, so exactly one
   snapshot is fetched per reconnect (a depth snapshot costs up to 250 weight).

Observed state path after a peer close is
`CONNECTED → DISCONNECTED → CONNECTING → CONNECTED`; tests assert on
`reconnect_count` rather than on a transient `RECONNECTING` sighting.

## 10. Order-book resync flow

```
Reconnect
   ↓  state callback (synchronous)
Invalidate affected book — is_tradeable() → False, book_top() → None
   ↓
Resubscribe (existing SubscriptionManager replay)
   ↓
Buffer diff events (bounded buffer)
   ↓
Fetch REST snapshot via HttpxGetter → existing parser
   ↓
Validate: drop u <= lastUpdateId; first applied event must satisfy
          U <= lastUpdateId+1 <= u; refetch if the snapshot does not
          bracket the buffer
   ↓
Replay valid buffered diffs; thereafter each U must equal previous u+1
   ↓
LIVE
```

A book is tradeable only when **all** hold: phase is `LIVE`, health is `OK`
(not crossed), the book is not stale, **and** the socket is currently connected.
Otherwise `book_top()` returns `None`. A malformed frame is counted as a parse
error and dropped — it can never partially mutate the book.

---

## Test-case coverage map (the 20 enumerated cases)

| # | Case | Test |
| --- | --- | --- |
| 1 | WebSocket connect | `test_case_01_websocket_connect_returns_a_wrapped_transport`, `test_case_01b_plaintext_websocket_urls_are_refused` |
| 2 | WebSocket send | `test_case_02_send_forwards_the_frame_verbatim`, `test_case_02b_send_after_close_raises_the_platform_closed_error` |
| 3 | WebSocket receive | `test_case_03_receive_decodes_text_and_binary_and_counts_bytes` |
| 4 | WebSocket close | `test_case_04_close_is_idempotent_and_never_raises` |
| 5 | Connection timeout | `test_case_05_connect_timeout_normalises_to_the_timeout_category` |
| 6 | Receive timeout | `test_case_06_receive_timeout_is_bounded_and_normalised` |
| 7 | Network failure | `test_case_07…`, `test_case_07b…`, `test_case_07c_every_library_exception_maps_into_the_existing_vocabulary` |
| 8 | Reconnect | `test_case_08_09_16_reconnect_restores_subscriptions_and_resyncs_the_book` |
| 9 | Subscription restoration | same |
| 10 | HTTP snapshot success | `test_case_10_http_get_returns_parsed_json_with_numbers_as_strings`, `test_case_10b_plaintext_http_urls_are_refused` |
| 11 | HTTP timeout | `test_case_11_http_timeout_retries_then_reports_a_timeout`, `test_case_11b_a_transient_failure_is_retried_and_then_succeeds` |
| 12 | HTTP non-2xx | `test_case_12…` a–e (no retry on 4xx, `Retry-After` on 429, bounded 5xx retry, category mapping, no query string in metadata) |
| 13 | Malformed JSON | `test_case_13…`, `test_case_13b_malformed_json_does_not_crash_the_caller` |
| 14 | Malformed exchange message | `test_case_15_malformed_frames_neither_crash_nor_corrupt_the_book` |
| 15 | Clean shutdown | `test_case_14b_shutdown_unsubscribes_closes_and_leaves_no_tasks`, `test_stop_is_idempotent` |
| 16 | Resync after reconnect | `test_case_16b_a_book_is_never_tradeable_while_the_socket_is_down`, `test_case_16c_a_sequence_gap_triggers_a_resync_through_the_synchroniser` |
| 17 | Configured symbols | `test_case_17…` a–c |
| 18 | Configured channels | `test_case_18_only_enabled_channels_are_subscribed` |
| 19 | No credentials required | `test_case_19_no_credential_field_exists_on_the_transport_path`, `test_case_19b_no_authorisation_headers_are_sent`, `test_no_rest_call_carries_a_signature_or_api_key` |
| 20 | Part 1–3 tests still pass | full suite: **437 passed** |

Plus: `test_case_14_frames_flow_through_parsers_into_the_book`,
`test_health_distinguishes_connected_fresh_stale_and_disconnected`,
`test_health_before_start_reports_disconnected`,
`test_snapshot_failures_are_retried_and_counted`,
`test_transport_metrics_never_claim_a_latency_guarantee`,
`test_session_is_closed_exactly_once_and_only_if_owned`,
`test_configuration_rejects_unsafe_and_nonsensical_values`,
`test_configuration_parses_booleans_strictly`,
`test_feed_uses_the_binance_adapter_without_any_credential_parameter`.

---

## Validation commands

### Install

```bash
cd libs/trading-core
python3 -m venv .venv && source .venv/bin/activate
pip install -e '.[live,dev]'      # 'live' pulls websockets + httpx
# core-only (no network stack) is also valid and the test suite still runs:
# pip install -e '.[dev]'
```

### Format · lint · type check

```bash
cd libs/trading-core
ruff format .
ruff check .
mypy wlct_trading
```

### All existing tests (offline, no credentials, no DB, no Redis)

```bash
cd libs/trading-core
python3 -m pytest tests/ -q            # 437 passed
```

### Part 4 tests only

```bash
cd libs/trading-core
python3 -m pytest tests/test_net_transport.py tests/test_net_feed.py -q   # 44 passed
```

### Start the market-data service

```bash
export BINANCE_WS_URL="wss://stream.binance.com:9443"
export BINANCE_REST_URL="https://api.binance.com"
export MARKET_DATA_SYMBOLS="BTCUSDT,ETHUSDT"
export MARKET_DATA_TICKER_ENABLED=true
export MARKET_DATA_TRADES_ENABLED=true
export MARKET_DATA_ORDERBOOK_ENABLED=true
python3 -m wlct_trading.net
```

### Optional LIVE MARKET DATA SMOKE TEST — network, explicitly invoked

Not collected by `pytest` (it is a script, and the `live` marker is deselected
by `addopts`). It connects to Binance **public** market data only, submits no
order, and needs no credential.

```bash
export LIVE_MARKET_DATA_SMOKE_TEST_DURATION_SECONDS=20
python3 scripts/live_market_data_smoke_test.py --symbols BTCUSDT,ETHUSDT
```

> Sandbox note recorded during delivery: `api.binance.com` returns HTTP 451 from
> some hosts. Use `--rest-url https://data-api.binance.vision --ws-url
> wss://data-stream.binance.vision` for public checks from such a host.

### Explicitly NOT enabled by Part 4

* No order placement, cancellation, withdrawal, deposit or account trading.
* No private user-data stream.
* No API key, secret or private key anywhere on the market-data path.
* No latency guarantee. Every metric is an observation of what already happened
  on this instance, not a service-level commitment.

---
---

# PART B — COMPLETE SOURCE

Every file below is emitted in full, exactly as it exists on disk.

## B1. New files — production transport subpackage

### FILE: libs/trading-core/wlct_trading/net/__init__.py

```python
"""Optional live network transport for :mod:`wlct_trading`.

Importing this subpackage is what pulls in ``websockets`` and ``httpx``. The
core library imports nothing from here, which is what keeps
``import wlct_trading`` dependency-free and keeps the test suite runnable with
no network stack installed.

Install the extra to use it::

    pip install 'wlct-trading-core[live]'

Scope: **public market data only**. Nothing in this package accepts, reads or
transmits an API credential, and no code path submits an order.
"""

from __future__ import annotations

from wlct_trading.net.config import (
    InvalidTransportSettings,
    TransportSettings,
    parse_bool,
    parse_int,
    parse_symbol_list,
)
from wlct_trading.net.feed import FeedCallbacks, FeedHealth, MarketDataFeed
from wlct_trading.net.http_client import HttpxGetter, InsecureHttpUrl
from wlct_trading.net.normalise import (
    RETRYABLE_HTTP_STATUSES,
    category_for_http_status,
    normalise_http_status,
    normalise_network_exception,
)
from wlct_trading.net.runner import MarketDataRunner, configure_logging, run
from wlct_trading.net.symbols import (
    canonicalise_configured_symbol,
    resolve_configured_symbols,
)
from wlct_trading.net.websocket_client import (
    InsecureWebSocketUrl,
    WebsocketsTransport,
    WebsocketsTransportFactory,
)

__all__ = [
    "FeedCallbacks",
    "FeedHealth",
    "HttpxGetter",
    "InsecureHttpUrl",
    "InsecureWebSocketUrl",
    "InvalidTransportSettings",
    "MarketDataFeed",
    "MarketDataRunner",
    "RETRYABLE_HTTP_STATUSES",
    "TransportSettings",
    "WebsocketsTransport",
    "WebsocketsTransportFactory",
    "canonicalise_configured_symbol",
    "category_for_http_status",
    "configure_logging",
    "normalise_http_status",
    "normalise_network_exception",
    "parse_bool",
    "parse_int",
    "parse_symbol_list",
    "resolve_configured_symbols",
    "run",
]
```

### FILE: libs/trading-core/wlct_trading/net/config.py

```python
"""Configuration for the production transport layer.

Part 3's core is configuration-free on purpose: it takes injected callables and
never reads the environment. That property is preserved — this module lives in
:mod:`wlct_trading.net`, the optional "live transport" subpackage, and is the
*only* place in the library that reads ``os.environ``.

Parsing is stdlib-only. Pydantic is a fine dependency for a service, but the
trading-core library is deliberately installable with nothing but the standard
library plus the two network clients, and a settings framework is not worth
giving that up.

Every timeout has a finite default. There is no code path here that produces an
infinite network timeout.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Mapping

from wlct_trading.exchanges.binance.capabilities import (
    BINANCE_SPOT_REST_BASE,
    BINANCE_SPOT_WS_BASE,
    BINANCE_TESTNET_REST_BASE,
    BINANCE_TESTNET_WS_BASE,
)
from wlct_trading.transport.subscriptions import MarketDataChannel

__all__ = [
    "TransportSettings",
    "InvalidTransportSettings",
    "parse_bool",
    "parse_int",
    "parse_symbol_list",
]


class InvalidTransportSettings(ValueError):
    """Raised when configuration is missing, malformed or unsafe.

    Raised at startup rather than tolerated. A service that boots with a
    nonsensical timeout and discovers it during a venue incident is worse than
    one that refuses to boot.
    """


def parse_bool(raw: str | None, default: bool, *, name: str) -> bool:
    """Parse a boolean environment value strictly.

    Anything unrecognised raises. Silently treating ``"flase"`` as ``False``
    would disable a channel an operator believed they had enabled.
    """
    if raw is None or raw.strip() == "":
        return default
    lowered = raw.strip().lower()
    if lowered in ("1", "true", "yes", "on"):
        return True
    if lowered in ("0", "false", "no", "off"):
        return False
    raise InvalidTransportSettings(
        f"{name} must be a boolean (true/false), got {raw!r}."
    )


def parse_int(
    raw: str | None,
    default: int,
    *,
    name: str,
    minimum: int = 1,
    maximum: int | None = None,
) -> int:
    """Parse a bounded integer environment value."""
    if raw is None or raw.strip() == "":
        value = default
    else:
        try:
            value = int(raw.strip())
        except ValueError as exc:
            raise InvalidTransportSettings(
                f"{name} must be an integer, got {raw!r}."
            ) from exc
    if value < minimum:
        raise InvalidTransportSettings(
            f"{name} must be at least {minimum}, got {value}."
        )
    if maximum is not None and value > maximum:
        raise InvalidTransportSettings(
            f"{name} must be at most {maximum}, got {value}."
        )
    return value


def parse_symbol_list(raw: str | None, default: str) -> tuple[str, ...]:
    """Split a comma-separated symbol list.

    Only splitting happens here. Normalisation to the canonical ``BASE-QUOTE``
    form is the job of :mod:`wlct_trading.exchanges.symbols`, which already owns
    that vocabulary; duplicating it here is exactly how two spellings of the
    same market end up in circulation.
    """
    source = raw if raw is not None and raw.strip() else default
    items = [item.strip() for item in source.split(",")]
    return tuple(item for item in items if item)


@dataclass(slots=True, frozen=True)
class TransportSettings:
    """Runtime settings for the live market-data transport.

    Contains no credentials, and cannot: public market data requires none, and
    exchange API keys live encrypted per trading account in PostgreSQL. There is
    deliberately no field here that could hold a secret.
    """

    # --- Endpoints -----------------------------------------------------
    binance_ws_url: str = BINANCE_SPOT_WS_BASE
    binance_rest_url: str = BINANCE_SPOT_REST_BASE
    use_testnet: bool = False

    # --- What to subscribe to -----------------------------------------
    symbols: tuple[str, ...] = ("BTC/USDT", "ETH/USDT")
    ticker_enabled: bool = True
    trades_enabled: bool = True
    orderbook_enabled: bool = True

    # --- Websocket timeouts (milliseconds) -----------------------------
    ws_connect_timeout_ms: int = 10_000
    #: Backstop only. The connection manager's heartbeat is the primary
    #: liveness detector; this catches a socket wedged below that layer. It is
    #: deliberately generous because a thin symbol's trade stream can be
    #: legitimately silent for minutes, and Binance's own server pings are
    #: answered by the client library without surfacing as messages.
    ws_receive_timeout_ms: int = 300_000
    ws_heartbeat_timeout_ms: int = 90_000
    ws_heartbeat_interval_ms: int = 20_000
    #: Client-initiated ping cadence handed to the websocket library. Binance
    #: pings every 3 minutes and expects a pong within 10; the library answers
    #: those automatically. This is the reverse direction, used to notice a peer
    #: that has gone away silently.
    ws_ping_interval_ms: int = 180_000
    ws_ping_timeout_ms: int = 60_000
    ws_close_timeout_ms: int = 5_000
    #: Frame size ceiling. Binance depth frames are small; an unbounded reader
    #: is a memory-exhaustion vector.
    ws_max_frame_bytes: int = 8 * 1024 * 1024

    # --- HTTP timeouts (milliseconds) ----------------------------------
    http_connect_timeout_ms: int = 5_000
    http_read_timeout_ms: int = 10_000
    http_total_timeout_ms: int = 15_000
    http_max_retries: int = 3
    http_max_connections: int = 20

    # --- Order book -----------------------------------------------------
    orderbook_snapshot_depth: int = 1_000
    orderbook_max_buffered_deltas: int = 5_000
    orderbook_max_resync_attempts: int = 10
    orderbook_staleness_threshold_ms: int = 5_000

    # --- Reconnect -------------------------------------------------------
    reconnect_base_delay_ms: int = 500
    reconnect_max_delay_ms: int = 30_000
    reconnect_max_attempts: int = 20

    # --- Runner ----------------------------------------------------------
    health_report_interval_seconds: int = 15
    smoke_test_duration_seconds: int = 30

    def __post_init__(self) -> None:
        if not self.binance_ws_url.startswith("wss://"):
            raise InvalidTransportSettings(
                f"BINANCE_WS_URL must use wss:// (TLS). Got {self.binance_ws_url!r}. "
                f"Plaintext websocket traffic to an exchange is never acceptable."
            )
        if not self.binance_rest_url.startswith("https://"):
            raise InvalidTransportSettings(
                f"BINANCE_REST_URL must use https://. Got {self.binance_rest_url!r}."
            )
        if self.ws_heartbeat_timeout_ms <= self.ws_heartbeat_interval_ms:
            raise InvalidTransportSettings(
                "WEBSOCKET_HEARTBEAT_TIMEOUT_MS must exceed "
                "WEBSOCKET_HEARTBEAT_INTERVAL_MS, otherwise a healthy connection "
                "is torn down before it can prove itself alive."
            )
        if self.http_total_timeout_ms < self.http_read_timeout_ms:
            raise InvalidTransportSettings(
                "HTTP_TOTAL_TIMEOUT_MS must be at least HTTP_READ_TIMEOUT_MS."
            )
        if not self.symbols:
            raise InvalidTransportSettings(
                "MARKET_DATA_SYMBOLS is empty; there would be nothing to stream."
            )
        if not self.enabled_channels:
            raise InvalidTransportSettings(
                "Every market-data channel is disabled. Enable at least one of "
                "MARKET_DATA_TICKER_ENABLED, MARKET_DATA_TRADES_ENABLED or "
                "MARKET_DATA_ORDERBOOK_ENABLED."
            )

    @property
    def enabled_channels(self) -> tuple[MarketDataChannel, ...]:
        """Channels to subscribe to, in a stable order.

        ``BOOK_TICKER`` is what "ticker" maps to: it is the best bid/ask stream,
        updated on every book change, and it is what the risk engine's
        price-deviation checks need. The 1-second rolling ``TICKER`` stream is a
        statistics feed, not a quote feed.
        """
        channels: list[MarketDataChannel] = []
        if self.orderbook_enabled:
            channels.append(MarketDataChannel.ORDER_BOOK)
        if self.trades_enabled:
            channels.append(MarketDataChannel.TRADES)
        if self.ticker_enabled:
            channels.append(MarketDataChannel.BOOK_TICKER)
        return tuple(channels)

    @classmethod
    def from_env(
        cls, environ: Mapping[str, str] | None = None
    ) -> "TransportSettings":
        """Build settings from the environment.

        Passing ``environ`` explicitly keeps this testable without mutating the
        real process environment.
        """
        env = os.environ if environ is None else environ

        use_testnet = parse_bool(
            env.get("EXCHANGE_USE_TESTNET"), False, name="EXCHANGE_USE_TESTNET"
        )
        default_ws = BINANCE_TESTNET_WS_BASE if use_testnet else BINANCE_SPOT_WS_BASE
        default_rest = (
            BINANCE_TESTNET_REST_BASE if use_testnet else BINANCE_SPOT_REST_BASE
        )

        return cls(
            binance_ws_url=(env.get("BINANCE_WS_URL") or default_ws).strip(),
            binance_rest_url=(env.get("BINANCE_REST_URL") or default_rest).strip(),
            use_testnet=use_testnet,
            symbols=parse_symbol_list(
                env.get("MARKET_DATA_SYMBOLS"), "BTC/USDT,ETH/USDT"
            ),
            ticker_enabled=parse_bool(
                env.get("MARKET_DATA_TICKER_ENABLED"),
                True,
                name="MARKET_DATA_TICKER_ENABLED",
            ),
            trades_enabled=parse_bool(
                env.get("MARKET_DATA_TRADES_ENABLED"),
                True,
                name="MARKET_DATA_TRADES_ENABLED",
            ),
            orderbook_enabled=parse_bool(
                env.get("MARKET_DATA_ORDERBOOK_ENABLED"),
                True,
                name="MARKET_DATA_ORDERBOOK_ENABLED",
            ),
            ws_connect_timeout_ms=parse_int(
                env.get("WEBSOCKET_CONNECT_TIMEOUT_MS"),
                10_000,
                name="WEBSOCKET_CONNECT_TIMEOUT_MS",
                minimum=100,
                maximum=120_000,
            ),
            ws_receive_timeout_ms=parse_int(
                env.get("WEBSOCKET_RECEIVE_TIMEOUT_MS"),
                300_000,
                name="WEBSOCKET_RECEIVE_TIMEOUT_MS",
                minimum=1_000,
                maximum=3_600_000,
            ),
            ws_heartbeat_timeout_ms=parse_int(
                env.get("WEBSOCKET_HEARTBEAT_TIMEOUT_MS"),
                90_000,
                name="WEBSOCKET_HEARTBEAT_TIMEOUT_MS",
                minimum=2_000,
                maximum=600_000,
            ),
            ws_heartbeat_interval_ms=parse_int(
                env.get("WS_HEARTBEAT_INTERVAL_MS"),
                20_000,
                name="WS_HEARTBEAT_INTERVAL_MS",
                minimum=1_000,
                maximum=300_000,
            ),
            ws_ping_interval_ms=parse_int(
                env.get("WEBSOCKET_PING_INTERVAL_MS"),
                180_000,
                name="WEBSOCKET_PING_INTERVAL_MS",
                minimum=5_000,
                maximum=600_000,
            ),
            ws_ping_timeout_ms=parse_int(
                env.get("WEBSOCKET_PING_TIMEOUT_MS"),
                60_000,
                name="WEBSOCKET_PING_TIMEOUT_MS",
                minimum=1_000,
                maximum=600_000,
            ),
            ws_close_timeout_ms=parse_int(
                env.get("WEBSOCKET_CLOSE_TIMEOUT_MS"),
                5_000,
                name="WEBSOCKET_CLOSE_TIMEOUT_MS",
                minimum=100,
                maximum=60_000,
            ),
            ws_max_frame_bytes=parse_int(
                env.get("WEBSOCKET_MAX_FRAME_BYTES"),
                8 * 1024 * 1024,
                name="WEBSOCKET_MAX_FRAME_BYTES",
                minimum=64 * 1024,
                maximum=64 * 1024 * 1024,
            ),
            http_connect_timeout_ms=parse_int(
                env.get("HTTP_CONNECT_TIMEOUT_MS"),
                5_000,
                name="HTTP_CONNECT_TIMEOUT_MS",
                minimum=100,
                maximum=120_000,
            ),
            http_read_timeout_ms=parse_int(
                env.get("HTTP_READ_TIMEOUT_MS"),
                10_000,
                name="HTTP_READ_TIMEOUT_MS",
                minimum=100,
                maximum=120_000,
            ),
            http_total_timeout_ms=parse_int(
                env.get("HTTP_TOTAL_TIMEOUT_MS"),
                15_000,
                name="HTTP_TOTAL_TIMEOUT_MS",
                minimum=100,
                maximum=300_000,
            ),
            http_max_retries=parse_int(
                env.get("HTTP_MAX_RETRIES"),
                3,
                name="HTTP_MAX_RETRIES",
                minimum=0,
                maximum=10,
            ),
            http_max_connections=parse_int(
                env.get("HTTP_MAX_CONNECTIONS"),
                20,
                name="HTTP_MAX_CONNECTIONS",
                minimum=1,
                maximum=200,
            ),
            orderbook_snapshot_depth=parse_int(
                env.get("ORDERBOOK_SNAPSHOT_DEPTH"),
                1_000,
                name="ORDERBOOK_SNAPSHOT_DEPTH",
                minimum=5,
                maximum=5_000,
            ),
            orderbook_max_buffered_deltas=parse_int(
                env.get("ORDERBOOK_MAX_BUFFERED_DELTAS"),
                5_000,
                name="ORDERBOOK_MAX_BUFFERED_DELTAS",
                minimum=100,
                maximum=100_000,
            ),
            orderbook_max_resync_attempts=parse_int(
                env.get("ORDERBOOK_MAX_RESYNC_ATTEMPTS"),
                10,
                name="ORDERBOOK_MAX_RESYNC_ATTEMPTS",
                minimum=1,
                maximum=100,
            ),
            orderbook_staleness_threshold_ms=parse_int(
                env.get("ORDERBOOK_STALENESS_THRESHOLD_MS"),
                5_000,
                name="ORDERBOOK_STALENESS_THRESHOLD_MS",
                minimum=100,
                maximum=600_000,
            ),
            reconnect_base_delay_ms=parse_int(
                env.get("WS_RECONNECT_BASE_DELAY_MS"),
                500,
                name="WS_RECONNECT_BASE_DELAY_MS",
                minimum=10,
                maximum=60_000,
            ),
            reconnect_max_delay_ms=parse_int(
                env.get("WS_RECONNECT_MAX_DELAY_MS"),
                30_000,
                name="WS_RECONNECT_MAX_DELAY_MS",
                minimum=100,
                maximum=600_000,
            ),
            reconnect_max_attempts=parse_int(
                env.get("WS_RECONNECT_MAX_ATTEMPTS"),
                20,
                name="WS_RECONNECT_MAX_ATTEMPTS",
                minimum=1,
                maximum=1_000,
            ),
            health_report_interval_seconds=parse_int(
                env.get("CONNECTIVITY_METRICS_INTERVAL_SECONDS"),
                15,
                name="CONNECTIVITY_METRICS_INTERVAL_SECONDS",
                minimum=1,
                maximum=3_600,
            ),
            smoke_test_duration_seconds=parse_int(
                env.get("LIVE_MARKET_DATA_SMOKE_TEST_DURATION_SECONDS"),
                30,
                name="LIVE_MARKET_DATA_SMOKE_TEST_DURATION_SECONDS",
                minimum=1,
                maximum=3_600,
            ),
        )

    def to_public_dict(self) -> dict[str, object]:
        """Log-safe rendering. There are no secrets to omit."""
        return {
            "binanceWsUrl": self.binance_ws_url,
            "binanceRestUrl": self.binance_rest_url,
            "useTestnet": self.use_testnet,
            "symbols": list(self.symbols),
            "channels": [channel.value for channel in self.enabled_channels],
            "wsConnectTimeoutMs": self.ws_connect_timeout_ms,
            "wsReceiveTimeoutMs": self.ws_receive_timeout_ms,
            "wsHeartbeatTimeoutMs": self.ws_heartbeat_timeout_ms,
            "httpConnectTimeoutMs": self.http_connect_timeout_ms,
            "httpReadTimeoutMs": self.http_read_timeout_ms,
            "httpTotalTimeoutMs": self.http_total_timeout_ms,
            "httpMaxRetries": self.http_max_retries,
            "orderbookSnapshotDepth": self.orderbook_snapshot_depth,
            "reconnectMaxAttempts": self.reconnect_max_attempts,
        }
```

### FILE: libs/trading-core/wlct_trading/net/symbols.py

```python
"""Turn configured symbol strings into venue-resolved references.

Operators write ``BTC/USDT``, ``btc-usdt`` or ``BTCUSDT`` depending on habit and
on which venue's documentation they had open. All three mean the same market,
and the canonical form the platform uses internally is ``BTC-USDT``.

The conversion itself belongs to :mod:`wlct_trading.exchanges.symbols`, which
already owns asset aliasing and concatenated-symbol splitting. This module only
handles the configuration shapes and the failure messages.
"""

from __future__ import annotations

from wlct_trading.enums import ExchangeId, MarketType
from wlct_trading.exchanges.symbols import (
    SymbolRef,
    SymbolRegistry,
    UnknownSymbol,
    split_concatenated_symbol,
    to_canonical,
)

__all__ = ["resolve_configured_symbols", "canonicalise_configured_symbol"]


def canonicalise_configured_symbol(raw: str) -> str:
    """Normalise one configured symbol to canonical ``BASE-QUOTE`` form.

    Accepts ``BTC/USDT``, ``BTC-USDT``, ``BTC_USDT`` and ``BTCUSDT``. The last
    form needs the quote-asset splitter, which is why ``XBTUSD`` resolves
    correctly rather than being cut at an arbitrary offset.
    """
    text = raw.strip().upper()
    if not text:
        raise UnknownSymbol("An empty string is not a symbol.")

    for separator in ("/", "-", "_", ":"):
        if separator in text:
            base, _, quote = text.partition(separator)
            if not base or not quote:
                raise UnknownSymbol(
                    f"{raw!r} is not a valid symbol: expected BASE{separator}QUOTE."
                )
            return to_canonical(base, quote)

    split = split_concatenated_symbol(text)
    if split is None:
        raise UnknownSymbol(
            f"Cannot determine the base and quote assets of {raw!r}. "
            f"Write it with a separator, for example BTC/USDT."
        )
    return to_canonical(split[0], split[1])


def resolve_configured_symbols(
    raw_symbols: tuple[str, ...],
    *,
    registry: SymbolRegistry,
    exchange: ExchangeId,
    market_type: MarketType = MarketType.SPOT,
    require_registered: bool = True,
) -> tuple[SymbolRef, ...]:
    """Resolve configured symbols against the venue's instrument list.

    ``require_registered`` defaults to true so that a typo is caught at startup
    rather than by a websocket that connects and then stays silent forever.
    Registration comes from ``load_symbols()``, which reads ``exchangeInfo`` —
    so this also rejects a market the venue has delisted.

    Duplicates are collapsed rather than rejected: ``BTC/USDT`` and ``BTCUSDT``
    in the same list is untidy, not an error.
    """
    resolved: list[SymbolRef] = []
    seen: set[str] = set()
    unknown: list[str] = []

    for raw in raw_symbols:
        canonical = canonicalise_configured_symbol(raw)
        if canonical in seen:
            continue
        seen.add(canonical)

        if registry.is_registered(canonical, exchange, market_type=market_type):
            resolved.append(
                registry.symbol_ref(canonical, exchange, market_type=market_type)
            )
            continue

        if require_registered:
            unknown.append(f"{raw} (canonical {canonical})")
            continue

        # Unregistered but tolerated: derive the venue spelling by removing the
        # separator, which is what every concatenating venue expects.
        resolved.append(
            SymbolRef(
                exchange=exchange,
                symbol=canonical,
                venue_symbol=canonical.replace("-", ""),
                market_type=market_type,
            )
        )

    if unknown:
        raise UnknownSymbol(
            f"{exchange.value} does not list these configured symbols: "
            f"{', '.join(unknown)}. Check MARKET_DATA_SYMBOLS."
        )
    if not resolved:
        raise UnknownSymbol(
            "No symbols could be resolved from the configured list."
        )
    return tuple(resolved)
```

### FILE: libs/trading-core/wlct_trading/net/normalise.py

```python
"""Translate network-library exceptions into the platform's error vocabulary.

This module is the containment boundary. Above it, nothing knows that
``websockets`` or ``httpx`` exist: the rest of the system sees only
:class:`~wlct_trading.transport.errors.NormalisedExchangeError` and the nine
categories of :class:`~wlct_trading.transport.errors.ExchangeErrorCategory`.

On vocabulary
-------------
Part 3 defined nine categories and an exhaustive retry policy for each. Names
like ``CONNECTION_ERROR``, ``PROTOCOL_ERROR`` and ``INVALID_MESSAGE`` are
therefore mapped onto that existing set rather than added to it — a second,
overlapping taxonomy would mean two places to look up whether something is
retryable, and they would eventually disagree:

===========================  ==========================================
Conceptual failure           Existing category
===========================  ==========================================
connection refused/reset     ``NETWORK_ERROR``
DNS / TLS handshake          ``NETWORK_ERROR``
connect / read timeout       ``TIMEOUT``
websocket protocol violation ``EXCHANGE_ERROR``
malformed JSON or fields     ``EXCHANGE_ERROR``
HTTP 429 / 418               ``RATE_LIMIT_ERROR``
HTTP 4xx                     ``INVALID_REQUEST``  (not retryable)
HTTP 5xx                     ``EXCHANGE_ERROR``   (retryable)
HTTP 401 / 403               ``AUTHENTICATION_ERROR`` (not retryable)
anything unrecognised        ``UNKNOWN_ERROR``
===========================  ==========================================

``EXCHANGE_ERROR`` covers both protocol violations and malformed payloads
because the platform's response to each is identical: the message is unusable,
the connection may still be fine, and a retry is reasonable but bounded.
"""

from __future__ import annotations

import asyncio
import json
import ssl
from typing import Any

from wlct_trading.enums import ExchangeId
from wlct_trading.transport.errors import (
    ExchangeErrorCategory,
    NormalisedExchangeError,
)

__all__ = [
    "normalise_network_exception",
    "normalise_http_status",
    "category_for_http_status",
    "RETRYABLE_HTTP_STATUSES",
]

#: Statuses worth another attempt. 408 request timeout, 425 too early, 429 rate
#: limited, and the 5xx family. Everything else is a client mistake that will
#: fail identically on retry.
RETRYABLE_HTTP_STATUSES: frozenset[int] = frozenset(
    {408, 425, 429, 500, 502, 503, 504}
)


def category_for_http_status(status: int) -> ExchangeErrorCategory:
    """Map an HTTP status onto the platform's error taxonomy.

    418 is Binance's "you ignored 429 and are now IP-banned" status, so it is
    treated as a rate-limit failure and inherits that policy's long backoff.
    """
    if status in (418, 429):
        return ExchangeErrorCategory.RATE_LIMIT_ERROR
    if status in (401, 403):
        return ExchangeErrorCategory.AUTHENTICATION_ERROR
    if status == 408:
        return ExchangeErrorCategory.TIMEOUT
    if 500 <= status < 600:
        return ExchangeErrorCategory.EXCHANGE_ERROR
    if 400 <= status < 500:
        return ExchangeErrorCategory.INVALID_REQUEST
    return ExchangeErrorCategory.UNKNOWN_ERROR


def _retry_after_millis(headers: Any) -> int | None:
    """Read a ``Retry-After`` header, in milliseconds.

    The venue's own hint beats a computed backoff, so it is honoured when
    present and well-formed.
    """
    if headers is None:
        return None
    try:
        raw = headers.get("Retry-After") or headers.get("retry-after")
    except AttributeError:
        return None
    if raw is None:
        return None
    try:
        return max(0, int(float(str(raw).strip()) * 1_000))
    except (TypeError, ValueError):
        return None


def normalise_http_status(
    status: int,
    *,
    url: str,
    body_excerpt: str = "",
    headers: Any = None,
    exchange: str = ExchangeId.BINANCE.value,
) -> NormalisedExchangeError:
    """Build a normalised error from a non-2xx HTTP response.

    ``body_excerpt`` is truncated by the caller. Venue error bodies are short
    and diagnostically valuable, but an unbounded body in a log line is not.
    """
    category = category_for_http_status(status)
    venue_code: str | None = None
    venue_message: str | None = None

    # Binance error bodies look like {"code": -1121, "msg": "Invalid symbol."}.
    # Reading them turns an opaque 400 into an actionable message.
    if body_excerpt:
        try:
            decoded = json.loads(body_excerpt)
        except (json.JSONDecodeError, TypeError):
            decoded = None
        if isinstance(decoded, dict):
            if decoded.get("code") is not None:
                venue_code = str(decoded.get("code"))
            if decoded.get("msg") is not None:
                venue_message = str(decoded.get("msg"))

    return NormalisedExchangeError(
        category=category,
        message=(
            f"HTTP {status} from {_safe_url(url)}"
            + (f": {venue_message}" if venue_message else "")
        ),
        exchange=exchange,
        venue_code=venue_code,
        venue_message=venue_message,
        retry_after_millis=_retry_after_millis(headers),
        metadata={
            "httpStatus": status,
            "url": _safe_url(url),
            "bodyExcerpt": body_excerpt[:512],
        },
    )


def _safe_url(url: str) -> str:
    """Strip any query string before a URL reaches a log line.

    Public market-data requests carry no secrets, but this path is also the one
    a future signed endpoint would travel, and a logged ``signature=`` query
    parameter is not a mistake worth leaving available.
    """
    return url.split("?", 1)[0]


def normalise_network_exception(
    exc: BaseException,
    *,
    context: str,
    exchange: str = ExchangeId.BINANCE.value,
) -> NormalisedExchangeError:
    """Convert any transport exception into the platform vocabulary.

    Deliberately duck-typed on class names rather than importing ``httpx`` and
    ``websockets``. This module is imported by code paths that may only have one
    of the two installed, and an import error here would turn a recoverable
    network fault into a crash.
    """
    if isinstance(exc, NormalisedExchangeError):
        return exc

    name = type(exc).__name__
    module = type(exc).__module__.split(".")[0]
    message = str(exc) or name

    category = ExchangeErrorCategory.UNKNOWN_ERROR
    retry_after: int | None = None

    if isinstance(exc, asyncio.TimeoutError) or "Timeout" in name:
        category = ExchangeErrorCategory.TIMEOUT
    elif isinstance(exc, ssl.SSLError) or "SSL" in name or "Certificate" in name:
        # A TLS failure is a network-layer problem, but it is also the shape a
        # man-in-the-middle would produce. It is retryable, never bypassed.
        category = ExchangeErrorCategory.NETWORK_ERROR
    elif isinstance(exc, (ConnectionError, OSError)):
        category = ExchangeErrorCategory.NETWORK_ERROR
    elif name in (
        "ConnectionClosed",
        "ConnectionClosedOK",
        "ConnectionClosedError",
        "ConnectError",
        "ReadError",
        "WriteError",
        "PoolTimeout",
        "NetworkError",
        "TransportError",
        "RemoteProtocolError",
    ):
        category = ExchangeErrorCategory.NETWORK_ERROR
    elif name in (
        "ProtocolError",
        "WebSocketProtocolError",
        "InvalidMessage",
        "InvalidHandshake",
        "InvalidHeader",
        "InvalidUpgrade",
        "PayloadTooBig",
        "DecodingError",
        "JSONDecodeError",
    ):
        category = ExchangeErrorCategory.EXCHANGE_ERROR
    elif name in ("InvalidURI", "InvalidStatus", "InvalidStatusCode"):
        # A handshake rejected by status: read the code if the library exposes
        # one, since 429 here means the venue is shedding connections.
        status = _status_from_exception(exc)
        if status is not None:
            category = category_for_http_status(status)
        else:
            category = ExchangeErrorCategory.EXCHANGE_ERROR
    elif name == "SecurityError":
        category = ExchangeErrorCategory.EXCHANGE_ERROR

    return NormalisedExchangeError(
        category=category,
        message=f"{context}: {name}: {message}",
        exchange=exchange,
        retry_after_millis=retry_after,
        metadata={
            "exceptionType": name,
            "exceptionModule": module,
            "context": context,
        },
    )


def _status_from_exception(exc: BaseException) -> int | None:
    """Best-effort HTTP status extraction from a handshake exception."""
    for attribute in ("status_code", "status"):
        value = getattr(exc, attribute, None)
        if isinstance(value, int):
            return value
    response = getattr(exc, "response", None)
    if response is not None:
        value = getattr(response, "status_code", None)
        if isinstance(value, int):
            return value
    return None
```

### FILE: libs/trading-core/wlct_trading/net/http_client.py

```python
"""Production ``HttpGetter`` backed by ``httpx``.

The Binance adapter takes an injected
``HttpGetter = Callable[[str, Mapping[str, Any]], Awaitable[Any]]``. This module
provides the real one. It is the only place in the library that imports an HTTP
client.

Why ``httpx`` and not ``aiohttp``
---------------------------------
``services/market-data`` already depends on ``httpx`` and already uses it in
``app/services/providers.py``. Adding ``aiohttp`` would put two async HTTP
stacks, two connection-pool configurations and two sets of timeout semantics
inside one process, for no capability that is missing. The preference for
``aiohttp`` is honoured in spirit — an async client with explicit timeouts and a
managed session — while keeping the service on one stack.

Guarantees
----------
* Every request has a connect, read and total timeout. There is no path to an
  unbounded wait.
* Retries are bounded, use the existing :class:`ExponentialBackoff`, and only
  fire for categories the existing retry policy calls retryable. A 400 is never
  retried.
* Non-2xx responses raise a normalised error before any body parsing happens.
* JSON is parsed with numbers left as strings, because the Binance parsers
  reject floats — binary floating point cannot represent a price exactly, and
  the whole book is built on :class:`~decimal.Decimal`.
* One session for the process lifetime, closed explicitly on shutdown.
"""

from __future__ import annotations

import asyncio
import json
from types import TracebackType
from typing import Any, Mapping

from wlct_trading.clock import epoch_micros
from wlct_trading.net.config import TransportSettings
from wlct_trading.net.normalise import (
    normalise_http_status,
    normalise_network_exception,
)
from wlct_trading.transport.backoff import BackoffConfig, ExponentialBackoff
from wlct_trading.transport.errors import (
    ExchangeErrorCategory,
    NormalisedExchangeError,
)

__all__ = ["HttpxGetter", "InsecureHttpUrl"]

#: Cap on how much of an error body is kept for diagnostics.
_MAX_BODY_EXCERPT = 512


class InsecureHttpUrl(ValueError):
    """Raised when a plaintext ``http://`` URL is supplied."""


class HttpxGetter:
    """Async GET with bounded timeouts, bounded retries and normalised errors.

    Callable, so it satisfies the adapter's ``HttpGetter`` type directly:

    .. code-block:: python

        async with HttpxGetter(settings) as get:
            adapter = BinanceMarketDataAdapter(get)
    """

    __slots__ = (
        "_settings",
        "_client",
        "_owns_client",
        "_sleep",
        "requests",
        "failures",
        "retries",
        "bytes_received",
        "last_latency_micros",
    )

    def __init__(
        self,
        settings: TransportSettings,
        *,
        client: Any | None = None,
        sleep: Any | None = None,
    ) -> None:
        self._settings = settings
        self._client = client
        # An injected client belongs to the caller; closing it here would pull
        # the pool out from under them.
        self._owns_client = client is None
        self._sleep = sleep if sleep is not None else asyncio.sleep
        self.requests = 0
        self.failures = 0
        self.retries = 0
        self.bytes_received = 0
        self.last_latency_micros: int | None = None

    # ------------------------------------------------------------------
    # Session lifecycle
    # ------------------------------------------------------------------
    def _ensure_client(self) -> Any:
        """Create the session on first use.

        Lazily, so that constructing the getter — which happens during config
        validation and in tests — does not require the optional dependency or an
        event loop.
        """
        if self._client is not None:
            return self._client

        try:
            import httpx
        except ImportError as exc:  # pragma: no cover - depends on install
            raise ImportError(
                "The 'httpx' package is required for the live HTTP transport. "
                "Install it with: pip install 'wlct-trading-core[live]'"
            ) from exc

        settings = self._settings
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(
                settings.http_total_timeout_ms / 1000,
                connect=settings.http_connect_timeout_ms / 1000,
                read=settings.http_read_timeout_ms / 1000,
                write=settings.http_read_timeout_ms / 1000,
                pool=settings.http_connect_timeout_ms / 1000,
            ),
            limits=httpx.Limits(
                max_connections=settings.http_max_connections,
                max_keepalive_connections=max(
                    1, settings.http_max_connections // 2
                ),
                keepalive_expiry=30.0,
            ),
            # TLS verification stays on. There is deliberately no setting that
            # can turn it off: a market-data feed an attacker can rewrite is a
            # way to induce bad trades.
            verify=True,
            follow_redirects=False,
            headers={
                "User-Agent": "wlct-trading-core",
                "Accept": "application/json",
            },
        )
        self._owns_client = True
        return self._client

    async def aclose(self) -> None:
        """Close the session. Idempotent."""
        client = self._client
        if client is None or not self._owns_client:
            self._client = None if self._owns_client else client
            return
        self._client = None
        try:
            await client.aclose()
        except asyncio.CancelledError:
            raise
        except BaseException:  # noqa: BLE001 - shutdown must not fail
            return

    async def __aenter__(self) -> "HttpxGetter":
        self._ensure_client()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        await self.aclose()

    # ------------------------------------------------------------------
    # HttpGetter protocol
    # ------------------------------------------------------------------
    async def __call__(self, url: str, params: Mapping[str, Any]) -> Any:
        """GET ``url`` and return the decoded JSON body.

        Raises :class:`NormalisedExchangeError` on any failure. The Binance
        adapter wraps that into an ``AdapterConnectionError``, so callers above
        it never see a transport-level type either.
        """
        if not url.startswith("https://"):
            raise InsecureHttpUrl(
                f"Refusing to issue a plaintext request to {url!r}. "
                f"Exchange REST traffic must use https://."
            )

        backoff = ExponentialBackoff(
            BackoffConfig(
                base_delay_millis=200,
                max_delay_millis=5_000,
                multiplier=2.0,
                # +1 because the first call is an attempt, not a retry.
                max_attempts=self._settings.http_max_retries + 1,
                jitter=True,
            )
        )

        last_error: NormalisedExchangeError | None = None
        attempt = 0

        while backoff.can_retry():
            attempt += 1
            if attempt > 1:
                self.retries += 1
            self.requests += 1
            started = epoch_micros()

            try:
                payload = await self._attempt(url, params)
            except asyncio.CancelledError:
                raise
            except BaseException as exc:  # noqa: BLE001 - normalised below
                self.failures += 1
                error = (
                    exc
                    if isinstance(exc, NormalisedExchangeError)
                    else normalise_network_exception(
                        exc, context=f"GET {url.split('?', 1)[0]}"
                    )
                )
                last_error = error

                if not error.is_retryable:
                    # A 400 or a malformed request will fail identically next
                    # time; retrying only delays the real error reaching the
                    # operator.
                    raise error from exc

                if not backoff.can_retry():
                    break

                delay_millis = backoff.next_delay_millis()
                if error.retry_after_millis is not None:
                    # The venue's own hint wins. Ignoring a Retry-After on a 429
                    # is how a rate limit becomes an IP ban.
                    delay_millis = max(delay_millis, error.retry_after_millis)
                await self._sleep(delay_millis / 1000)
                continue

            self.last_latency_micros = epoch_micros() - started
            return payload

        if last_error is not None:
            raise last_error
        raise NormalisedExchangeError(
            category=ExchangeErrorCategory.UNKNOWN_ERROR,
            message=f"GET {url.split('?', 1)[0]} exhausted its retry budget.",
            exchange="binance",
            metadata={"attempts": attempt},
        )

    async def _attempt(self, url: str, params: Mapping[str, Any]) -> Any:
        """One request: send, validate status, decode JSON."""
        client = self._ensure_client()
        response = await client.get(url, params=dict(params))

        status = int(response.status_code)
        if status < 200 or status >= 300:
            body = ""
            try:
                body = response.text[:_MAX_BODY_EXCERPT]
            except BaseException:  # noqa: BLE001 - body is diagnostic only
                body = ""
            raise normalise_http_status(
                status,
                url=url,
                body_excerpt=body,
                headers=getattr(response, "headers", None),
            )

        content = response.content
        if isinstance(content, (bytes, bytearray)):
            self.bytes_received += len(content)
            text = bytes(content).decode("utf-8", errors="strict")
        else:
            text = response.text
            self.bytes_received += len(text)

        try:
            # parse_float/parse_int keep every number as the exact string the
            # venue sent. The parsers convert to Decimal from there; going
            # through a float first would silently round a price.
            return json.loads(text, parse_float=str, parse_int=str)
        except (json.JSONDecodeError, UnicodeDecodeError, ValueError) as exc:
            raise NormalisedExchangeError(
                category=ExchangeErrorCategory.EXCHANGE_ERROR,
                message=(
                    f"Response from {url.split('?', 1)[0]} is not valid JSON: {exc}"
                ),
                exchange="binance",
                metadata={
                    "url": url.split("?", 1)[0],
                    "bodyExcerpt": text[:_MAX_BODY_EXCERPT],
                },
            ) from exc

    def stats(self) -> dict[str, int | None]:
        """Counters for the metrics layer."""
        return {
            "requests": self.requests,
            "failures": self.failures,
            "retries": self.retries,
            "bytesReceived": self.bytes_received,
            "lastLatencyMicros": self.last_latency_micros,
        }
```

### FILE: libs/trading-core/wlct_trading/net/websocket_client.py

```python
"""Production ``WebSocketTransport`` backed by the ``websockets`` library.

This is the concrete implementation of the three-method protocol Part 3 defined
in :mod:`wlct_trading.transport.websocket`. It is the *only* module in the
library that imports a websocket client, and nothing imports it except the
service wiring — so the rest of trading-core remains installable and testable
with no network stack present.

What this class is responsible for
----------------------------------
Framing and error translation, and nothing else. Reconnection, backoff, state
transitions, subscription replay and heartbeat policy already exist in
:class:`~wlct_trading.transport.websocket.WebSocketConnectionManager`; adding
any of them here would create the second implementation this codebase has
consistently refused to grow.

The one subtlety worth stating: the library's own ``ConnectionClosed`` family is
translated into the platform's
:class:`~wlct_trading.transport.websocket.ConnectionClosed`, because that is the
exact type the existing manager's read loop catches to distinguish "peer went
away" (reconnect) from "something is broken" (classify and decide).

Ping/pong
---------
Binance sends a server ping every three minutes and expects a pong within ten.
The ``websockets`` library answers those automatically, which is why the Binance
adapter leaves ``build_ping_frame`` unset — an application-level ping would
consume the venue's five-inbound-messages-per-second budget for nothing. The
client-side ``ping_interval`` configured here is the reverse direction: it
detects a peer that has silently gone away.
"""

from __future__ import annotations

import asyncio
import ssl
from typing import Any, Callable

from wlct_trading.clock import epoch_micros
from wlct_trading.net.config import TransportSettings
from wlct_trading.net.normalise import normalise_network_exception
from wlct_trading.transport.websocket import ConnectionClosed, WebSocketTransport

__all__ = [
    "WebsocketsTransport",
    "WebsocketsTransportFactory",
    "InsecureWebSocketUrl",
]


class InsecureWebSocketUrl(ValueError):
    """Raised when a non-TLS websocket URL is supplied.

    Refused outright rather than warned about. Market data received over a
    plaintext socket can be modified in flight, and a book built from modified
    data is worse than no book at all.
    """


class WebsocketsTransport(WebSocketTransport):
    """Adapts a ``websockets`` client connection to the Part 3 protocol.

    Instances are single-use and owned by one connection generation. The manager
    discards a transport on disconnect and asks the factory for a new one, which
    is what keeps generation fencing meaningful.
    """

    __slots__ = (
        "_connection",
        "_receive_timeout_seconds",
        "_closed",
        "_bytes_received",
        "_messages_received",
        "_on_bytes",
    )

    def __init__(
        self,
        connection: Any,
        *,
        receive_timeout_seconds: float,
        on_bytes: Callable[[int], None] | None = None,
    ) -> None:
        self._connection = connection
        self._receive_timeout_seconds = receive_timeout_seconds
        self._closed = False
        self._bytes_received = 0
        self._messages_received = 0
        self._on_bytes = on_bytes

    # ------------------------------------------------------------------
    # Observability
    # ------------------------------------------------------------------
    @property
    def bytes_received(self) -> int:
        return self._bytes_received

    @property
    def messages_received(self) -> int:
        return self._messages_received

    @property
    def is_closed(self) -> bool:
        return self._closed

    # ------------------------------------------------------------------
    # WebSocketTransport protocol
    # ------------------------------------------------------------------
    async def send(self, message: str) -> None:
        """Send one text frame.

        Used for SUBSCRIBE/UNSUBSCRIBE control frames. Errors are normalised so
        the manager's subscription bookkeeping sees a platform error rather than
        a library one.
        """
        if self._closed:
            raise ConnectionClosed("Transport is already closed; cannot send.")
        try:
            await self._connection.send(message)
        except asyncio.CancelledError:
            raise
        except BaseException as exc:  # noqa: BLE001 - normalised below
            if _is_library_closed(exc):
                self._closed = True
                raise ConnectionClosed(
                    f"Send failed because the peer closed the connection: {exc}"
                ) from exc
            raise normalise_network_exception(exc, context="websocket send") from exc

    async def receive(self) -> str:
        """Await the next text frame.

        A bounded wait, never an indefinite one. The timeout is a backstop below
        the manager's heartbeat: it catches a socket that is wedged in a way the
        application layer cannot see. Exceeding it is reported as a normalised
        ``TIMEOUT``, which the existing retry policy treats as retryable.

        Binary frames are decoded as UTF-8. Binance sends text, but a venue that
        switches to compressed binary should surface as a decode error rather
        than a silent drop.
        """
        if self._closed:
            raise ConnectionClosed("Transport is already closed; cannot receive.")
        try:
            raw = await asyncio.wait_for(
                self._connection.recv(), timeout=self._receive_timeout_seconds
            )
        except asyncio.CancelledError:
            raise
        except asyncio.TimeoutError as exc:
            raise normalise_network_exception(
                exc,
                context=(
                    f"websocket receive exceeded "
                    f"{self._receive_timeout_seconds:.0f}s"
                ),
            ) from exc
        except BaseException as exc:  # noqa: BLE001 - normalised below
            if _is_library_closed(exc):
                self._closed = True
                raise ConnectionClosed(f"Peer closed the connection: {exc}") from exc
            raise normalise_network_exception(
                exc, context="websocket receive"
            ) from exc

        if isinstance(raw, bytes):
            self._bytes_received += len(raw)
            if self._on_bytes is not None:
                self._on_bytes(len(raw))
            self._messages_received += 1
            try:
                return raw.decode("utf-8")
            except UnicodeDecodeError as exc:
                raise normalise_network_exception(
                    exc, context="websocket frame is not valid UTF-8"
                ) from exc

        text = str(raw)
        size = len(text.encode("utf-8", errors="ignore"))
        self._bytes_received += size
        if self._on_bytes is not None:
            self._on_bytes(size)
        self._messages_received += 1
        return text

    async def close(self) -> None:
        """Close the socket. Idempotent, and never raises.

        Shutdown must not fail. A transport that throws while closing turns an
        orderly stop into a leaked connection, so every error here is swallowed
        after the socket has been marked closed.
        """
        if self._closed:
            return
        self._closed = True
        try:
            await self._connection.close()
        except asyncio.CancelledError:
            raise
        except BaseException:  # noqa: BLE001 - closing must not fail
            return


def _is_library_closed(exc: BaseException) -> bool:
    """Whether an exception means "the peer closed the connection"."""
    return type(exc).__name__ in (
        "ConnectionClosed",
        "ConnectionClosedOK",
        "ConnectionClosedError",
    )


class WebsocketsTransportFactory:
    """Builds :class:`WebsocketsTransport` instances for the manager.

    Satisfies the existing ``TransportFactory`` signature
    (``Callable[[str], Awaitable[WebSocketTransport]]``) by being callable.
    Implemented as a class rather than a closure so that connection attempts and
    failures can be counted without a mutable default hiding in a function.

    TLS uses Python's default verification. There is no switch here to disable
    certificate checking, by design — such a flag inevitably ends up set in a
    production ``.env``.
    """

    __slots__ = (
        "_settings",
        "_connect",
        "_ssl_context",
        "attempts",
        "successes",
        "failures",
        "last_connected_at",
        "_on_bytes",
    )

    def __init__(
        self,
        settings: TransportSettings,
        *,
        connect: Callable[..., Any] | None = None,
        ssl_context: ssl.SSLContext | None = None,
        on_bytes: Callable[[int], None] | None = None,
    ) -> None:
        self._settings = settings
        self._connect = connect
        self._ssl_context = ssl_context
        self._on_bytes = on_bytes
        self.attempts = 0
        self.successes = 0
        self.failures = 0
        self.last_connected_at: int | None = None

    def _resolve_connect(self) -> Callable[..., Any]:
        """Import the websocket client lazily.

        Deferred so that importing :mod:`wlct_trading.net` does not require the
        optional dependency, and so the failure message names the extra to
        install instead of surfacing a bare ``ModuleNotFoundError``.
        """
        if self._connect is not None:
            return self._connect
        try:
            from websockets.asyncio.client import connect
        except ImportError as exc:  # pragma: no cover - depends on install
            raise ImportError(
                "The 'websockets' package is required for the live websocket "
                "transport. Install it with: pip install 'wlct-trading-core[live]'"
            ) from exc
        self._connect = connect
        return connect

    async def __call__(self, url: str) -> WebSocketTransport:
        """Open one connection and wrap it."""
        if not url.startswith("wss://"):
            raise InsecureWebSocketUrl(
                f"Refusing to open a non-TLS websocket to {url!r}. "
                f"Exchange market data must travel over wss://."
            )

        connect = self._resolve_connect()
        self.attempts += 1

        settings = self._settings
        options: dict[str, Any] = {
            "open_timeout": settings.ws_connect_timeout_ms / 1000,
            "ping_interval": settings.ws_ping_interval_ms / 1000,
            "ping_timeout": settings.ws_ping_timeout_ms / 1000,
            "close_timeout": settings.ws_close_timeout_ms / 1000,
            "max_size": settings.ws_max_frame_bytes,
            # Binance does not negotiate permessage-deflate on the public
            # market-data streams, and leaving compression enabled costs CPU on
            # the hot path for no benefit.
            "compression": None,
            "user_agent_header": "wlct-trading-core",
        }
        if self._ssl_context is not None:
            options["ssl"] = self._ssl_context
        # When no context is supplied the argument is omitted entirely rather
        # than passed as None: the library reads an explicit ssl=None on a
        # wss:// URI as "disable TLS" and refuses. Omitting it selects the
        # default verifying context, which is what is wanted.

        try:
            connection = await connect(url, **options)
        except asyncio.CancelledError:
            raise
        except BaseException as exc:  # noqa: BLE001 - normalised for the manager
            self.failures += 1
            raise normalise_network_exception(
                exc, context=f"websocket connect to {url.split('?', 1)[0]}"
            ) from exc

        self.successes += 1
        self.last_connected_at = epoch_micros()
        return WebsocketsTransport(
            connection,
            receive_timeout_seconds=settings.ws_receive_timeout_ms / 1000,
            on_bytes=self._on_bytes,
        )

    def stats(self) -> dict[str, int | None]:
        """Connection-attempt counters for the metrics layer."""
        return {
            "attempts": self.attempts,
            "successes": self.successes,
            "failures": self.failures,
            "lastConnectedAt": self.last_connected_at,
        }
```

### FILE: libs/trading-core/wlct_trading/net/feed.py

```python
"""A live market-data feed composed from the Part 3 connectivity primitives.

What this is
------------
The connection manager, subscription manager, staleness monitor, order-book
synchroniser and Binance parsers all already exist and are already tested. What
did not exist was something that holds one socket open, routes its frames to the
right parser, feeds diffs into the right book, and exposes one health view over
the lot. That is this class, and it is deliberately thin: every decision about
*when to reconnect*, *how long to back off*, *what counts as stale* and *whether
a book is tradeable* is delegated to the component that already owns it.

Why it owns a connection rather than calling ``adapter.stream_*``
-----------------------------------------------------------------
The adapter's per-channel async generators are the right tool for consuming one
channel. They are not the right tool here for two reasons. They open one socket
per channel — three sockets for three channels, where Binance permits 1024
streams on one — and they encapsulate the connection manager, so nothing outside
can report whether the venue link is CONNECTED, RECONNECTING or STOPPED. The
health requirement makes that visibility mandatory, so the feed holds the
manager itself, built from the adapter's public helpers
(:meth:`build_subscription`, :meth:`stream_url`, :meth:`build_subscribe_frames`,
:meth:`build_unsubscribe_frames`) and the venue's public error classifier. No
protocol knowledge is reimplemented here.

Concurrency
-----------
Everything runs on one event loop. The read loop is synchronous from frame to
book update, which is what keeps ordering intact; the only asynchronous work is
snapshot fetching, which is handed to a dedicated worker so the read loop never
blocks on I/O.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Mapping

from wlct_trading.clock import epoch_micros
from wlct_trading.enums import ExchangeId
from wlct_trading.exchanges.binance import (
    BinanceMarketDataAdapter,
    BinanceParseError,
    classify_binance_error,
    parse_book_ticker,
    parse_depth_delta,
    parse_trade,
    unwrap_combined_stream,
)
from wlct_trading.exchanges.symbols import SymbolRef
from wlct_trading.market_data import BookTop, OrderBookSnapshot, PublicTrade, Ticker
from wlct_trading.metrics import ConnectivityMetrics
from wlct_trading.net.config import TransportSettings
from wlct_trading.net.symbols import resolve_configured_symbols
from wlct_trading.orderbook_sync import (
    OrderBookSynchroniser,
    SyncConfig,
    SyncPhase,
)
from wlct_trading.transport.backoff import BackoffConfig
from wlct_trading.transport.errors import NormalisedExchangeError
from wlct_trading.transport.staleness import StalenessMonitor, StalenessThresholds
from wlct_trading.transport.subscriptions import (
    MarketDataChannel,
    Subscription,
    SubscriptionManager,
)
from wlct_trading.transport.websocket import (
    ConnectionCallbacks,
    ConnectionConfig,
    ConnectionState,
    TransportFactory,
    WebSocketConnectionManager,
)

__all__ = ["MarketDataFeed", "FeedCallbacks", "FeedHealth"]

_LOGGER = logging.getLogger("wlct_trading.net.feed")


@dataclass(slots=True)
class FeedCallbacks:
    """Optional sinks for normalised market data.

    All are synchronous and called from the read loop. A slow callback delays
    every subsequent message on the socket, so anything expensive belongs on a
    queue the callback merely appends to.
    """

    on_ticker: Callable[[Ticker], None] | None = None
    on_trade: Callable[[PublicTrade], None] | None = None
    on_book_update: Callable[[str, BookTop | None], None] | None = None
    on_state_change: Callable[[ConnectionState, ConnectionState], None] | None = None
    on_resync: Callable[[str, str], None] | None = None


@dataclass(slots=True, frozen=True)
class FeedHealth:
    """Point-in-time health of the feed.

    ``connected`` and ``fresh`` are reported separately and never collapsed into
    a single boolean, because the three states an operator must distinguish are
    exactly: connected and fresh, connected but stale, and disconnected. A
    connected socket that has stopped delivering is the dangerous case — it looks
    fine from the outside and its data is worthless.
    """

    exchange: str
    state: ConnectionState
    connected: bool
    fresh: bool
    running: bool
    subscription_count: int
    active_subscription_count: int
    stale_streams: tuple[str, ...]
    reconnect_count: int
    messages_received: int
    parse_errors: int
    tradeable_symbols: tuple[str, ...]
    untradeable_symbols: tuple[str, ...]
    books: tuple[dict[str, object], ...] = field(default_factory=tuple)
    last_error: str | None = None

    @property
    def status(self) -> str:
        """One-word summary for a readiness probe.

        ``degraded`` rather than ``down`` when the socket is up but the data is
        stale: the process is alive and recovering, but nothing should be traded
        against what it currently holds.
        """
        if not self.running:
            return "stopped"
        if not self.connected:
            return "disconnected"
        if not self.fresh:
            return "degraded"
        return "healthy"

    def to_dict(self) -> dict[str, object]:
        return {
            "exchange": self.exchange,
            "status": self.status,
            "state": self.state.value,
            "connected": self.connected,
            "fresh": self.fresh,
            "running": self.running,
            "subscriptionCount": self.subscription_count,
            "activeSubscriptionCount": self.active_subscription_count,
            "staleStreams": list(self.stale_streams),
            "reconnectCount": self.reconnect_count,
            "messagesReceived": self.messages_received,
            "parseErrors": self.parse_errors,
            "tradeableSymbols": list(self.tradeable_symbols),
            "untradeableSymbols": list(self.untradeable_symbols),
            "books": list(self.books),
            "lastError": self.last_error,
        }


class MarketDataFeed:
    """Public market data from one venue, over one connection.

    Public data only. The adapter this drives cannot accept credentials, and no
    method here signs a request or submits an order.
    """

    __slots__ = (
        "_adapter",
        "_settings",
        "_transport_factory",
        "_metrics",
        "_callbacks",
        "_exchange",
        "_symbols",
        "_subscriptions",
        "_subscription_manager",
        "_manager",
        "_staleness",
        "_books",
        "_stream_routes",
        "_tickers",
        "_last_trades",
        "_supervisor",
        "_resync_worker",
        "_staleness_worker",
        "_resync_queue",
        "_running",
        "_started_at",
        "_parse_errors",
        "_last_error",
        "_connection_ready",
        "_connected_event",
    )

    def __init__(
        self,
        adapter: BinanceMarketDataAdapter,
        settings: TransportSettings,
        transport_factory: TransportFactory,
        *,
        metrics: ConnectivityMetrics | None = None,
        callbacks: FeedCallbacks | None = None,
    ) -> None:
        self._adapter = adapter
        self._settings = settings
        self._transport_factory = transport_factory
        self._metrics = metrics or ConnectivityMetrics()
        self._callbacks = callbacks or FeedCallbacks()
        self._exchange = adapter.exchange

        self._symbols: tuple[SymbolRef, ...] = ()
        self._subscriptions: tuple[Subscription, ...] = ()
        self._subscription_manager: SubscriptionManager | None = None
        self._manager: WebSocketConnectionManager | None = None
        self._staleness = StalenessMonitor(
            StalenessThresholds(
                order_book_millis=settings.orderbook_staleness_threshold_ms,
                connection_millis=settings.ws_heartbeat_timeout_ms,
            )
        )
        self._books: dict[str, OrderBookSynchroniser] = {}
        self._stream_routes: dict[str, tuple[MarketDataChannel, str]] = {}
        self._tickers: dict[str, Ticker] = {}
        self._last_trades: dict[str, PublicTrade] = {}

        self._supervisor: asyncio.Task[None] | None = None
        self._resync_worker: asyncio.Task[None] | None = None
        self._staleness_worker: asyncio.Task[None] | None = None
        self._resync_queue: asyncio.Queue[tuple[str, str, bool]] | None = None
        self._running = False
        self._started_at: int | None = None
        self._parse_errors = 0
        self._last_error: str | None = None
        self._connection_ready = False
        self._connected_event = asyncio.Event()

    # ------------------------------------------------------------------
    # Introspection
    # ------------------------------------------------------------------
    @property
    def metrics(self) -> ConnectivityMetrics:
        return self._metrics

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def symbols(self) -> tuple[SymbolRef, ...]:
        return self._symbols

    @property
    def subscriptions(self) -> tuple[Subscription, ...]:
        return self._subscriptions

    @property
    def connection(self) -> WebSocketConnectionManager | None:
        return self._manager

    def synchroniser(self, canonical_symbol: str) -> OrderBookSynchroniser | None:
        return self._books.get(canonical_symbol.upper())

    def ticker(self, canonical_symbol: str) -> Ticker | None:
        return self._tickers.get(canonical_symbol.upper())

    def last_trade(self, canonical_symbol: str) -> PublicTrade | None:
        return self._last_trades.get(canonical_symbol.upper())

    def book_top(self, canonical_symbol: str) -> BookTop | None:
        """Top of book, or ``None`` when it must not be traded against.

        Two gates, both required. The synchroniser refuses to return a top for a
        book that is not LIVE, healthy and fresh; on top of that, this method
        refuses while the socket is down, because a book can be internally
        consistent and still describe a market that moved five minutes ago.
        """
        synchroniser = self._books.get(canonical_symbol.upper())
        if synchroniser is None:
            return None
        if not self._connection_ready:
            return None
        return synchroniser.top()

    def is_tradeable(self, canonical_symbol: str) -> bool:
        return self.book_top(canonical_symbol) is not None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    async def start(self) -> None:
        """Resolve symbols, open the connection and begin synchronising books.

        The order matters and follows the venue's own guidance: subscribe to the
        diff stream *first*, then fetch the snapshot. Doing it the other way
        leaves a hole between the snapshot and the first buffered diff that
        cannot be detected afterwards.
        """
        if self._running:
            raise RuntimeError("MarketDataFeed is already running.")

        settings = self._settings
        exchange_name = self._exchange.value

        # exchangeInfo is what makes symbol resolution authoritative rather than
        # guesswork, and it rejects a delisted or misspelled market at startup.
        await self._adapter.load_symbols()
        self._symbols = resolve_configured_symbols(
            settings.symbols,
            registry=self._adapter.symbol_registry,
            exchange=self._exchange,
        )

        self._build_subscriptions()
        self._build_books()

        subscription_manager = SubscriptionManager(
            exchange=exchange_name,
            max_subscriptions=max(len(self._subscriptions), 1),
        )
        for subscription in self._subscriptions:
            subscription_manager.add(
                subscription.channel,
                subscription.symbol,
                subscription.stream_name,
                options=dict(subscription.options),
                subscription_id=subscription.subscription_id,
            )
        self._subscription_manager = subscription_manager

        callbacks = ConnectionCallbacks(
            on_message=self._on_message,
            build_subscribe_frames=self._adapter.build_subscribe_frames,
            build_unsubscribe_frames=self._adapter.build_unsubscribe_frames,
            # No application-level ping: Binance pings at the protocol level
            # every three minutes and the client library answers automatically.
            # An extra ping would spend inbound-message budget for nothing.
            build_ping_frame=None,
            classify_error=classify_binance_error,
            on_state_change=self._on_state_change,
            on_error=self._on_error,
        )

        config = ConnectionConfig(
            # Streams are named in the URL, so the socket arrives already
            # subscribed and there is no window where it is open but silent.
            url=self._adapter.stream_url(self._subscriptions),
            name=f"{exchange_name}-market-data",
            connect_timeout_millis=settings.ws_connect_timeout_ms,
            heartbeat_interval_millis=settings.ws_heartbeat_interval_ms,
            heartbeat_timeout_millis=settings.ws_heartbeat_timeout_ms,
            backoff=BackoffConfig(
                base_delay_millis=settings.reconnect_base_delay_ms,
                max_delay_millis=settings.reconnect_max_delay_ms,
                max_attempts=settings.reconnect_max_attempts,
                jitter=True,
            ),
            reconnect_enabled=True,
        )

        self._manager = WebSocketConnectionManager(
            config,
            self._instrumented_transport_factory,
            callbacks,
            subscription_manager,
            exchange=exchange_name,
        )

        self._resync_queue = asyncio.Queue()
        self._running = True
        self._started_at = epoch_micros()

        self._resync_worker = asyncio.create_task(
            self._run_resync_worker(), name="wlct-market-data-resync"
        )
        self._staleness_worker = asyncio.create_task(
            self._run_staleness_worker(), name="wlct-market-data-staleness"
        )

        # The supervisor owns connecting, including the first attempt. Calling
        # connect() here as well would race it: the first socket could drop
        # before run_forever reached its own connect(), and that call would then
        # re-establish the connection as a *first* connect rather than a
        # reconnect — skipping subscription restoration entirely.
        self._supervisor = asyncio.create_task(
            self._manager.run_forever(), name="wlct-market-data-supervisor"
        )
        await self._await_initial_connection()

        # Diffs are already arriving (or will be as soon as the supervisor gets
        # the socket up); queue the first snapshot for every book.
        for canonical in self._books:
            self._queue_resync(canonical, "initial synchronisation", discard=False)

    async def _await_initial_connection(self) -> None:
        """Block until the first connection is up, or until it is clearly late.

        A timeout here is not fatal: the supervisor keeps retrying with the
        existing backoff. It exists so that ``start()`` does not return
        pretending a feed is live when the venue is unreachable.
        """
        timeout = max(1.0, (self._settings.ws_connect_timeout_ms * 2) / 1000)
        try:
            await asyncio.wait_for(self._connected_event.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            self._last_error = (
                f"No connection to the venue within {timeout:.0f}s; the "
                f"supervisor is still retrying with backoff."
            )
            _LOGGER.warning(self._last_error)

    async def stop(self) -> None:
        """Shut down in the order that leaves nothing half-open.

        Unsubscribe, stop the connection manager, then cancel the workers.

        The manager is stopped through its own :meth:`stop` rather than by
        cancelling the supervisor task: ``run_forever`` deliberately suppresses
        cancellation around its reader await so a dropped socket does not kill
        the supervisor, which means a bare ``cancel()`` would be absorbed and
        the task would keep reconnecting. Setting the terminal state first is
        what makes the loop exit.
        """
        if not self._running:
            return
        self._running = False
        self._connection_ready = False

        manager = self._manager
        if manager is not None and manager.is_connected and self._subscriptions:
            try:
                await manager.unsubscribe(self._subscriptions)
            except asyncio.CancelledError:
                raise
            except BaseException as exc:  # noqa: BLE001 - shutdown continues
                _LOGGER.debug("Unsubscribe during shutdown failed: %s", exc)

        if manager is not None:
            try:
                await manager.stop()
            except asyncio.CancelledError:
                raise
            except BaseException as exc:  # noqa: BLE001 - shutdown must complete
                _LOGGER.debug("Connection stop reported: %s", exc)

        for task in (self._supervisor, self._resync_worker, self._staleness_worker):
            if task is not None:
                task.cancel()
        for task in (self._supervisor, self._resync_worker, self._staleness_worker):
            if task is None:
                continue
            try:
                # Bounded: a worker that refuses to die must not hang shutdown.
                await asyncio.wait_for(asyncio.shield(task), timeout=5.0)
            except (asyncio.CancelledError, asyncio.TimeoutError, Exception):  # noqa: BLE001
                pass
        self._supervisor = None
        self._resync_worker = None
        self._staleness_worker = None

    async def __aenter__(self) -> "MarketDataFeed":
        await self.start()
        return self

    async def __aexit__(self, *_exc_info: object) -> None:
        await self.stop()

    # ------------------------------------------------------------------
    # Wiring helpers
    # ------------------------------------------------------------------
    def _build_subscriptions(self) -> None:
        """One subscription per (symbol, enabled channel)."""
        subscriptions: list[Subscription] = []
        routes: dict[str, tuple[MarketDataChannel, str]] = {}
        for symbol in self._symbols:
            for channel in self._settings.enabled_channels:
                subscription = self._adapter.build_subscription(symbol, channel)
                subscriptions.append(subscription)
                routes[subscription.stream_name.lower()] = (channel, symbol.symbol)
                self._staleness.track(channel, symbol.symbol)
        self._subscriptions = tuple(subscriptions)
        self._stream_routes = routes

    def _build_books(self) -> None:
        """One synchroniser per symbol, when the depth channel is enabled."""
        if not self._settings.orderbook_enabled:
            return
        settings = self._settings
        for symbol in self._symbols:
            canonical = symbol.symbol
            self._books[canonical] = OrderBookSynchroniser(
                self._exchange,
                canonical,
                self._make_snapshot_fetcher(symbol),
                config=SyncConfig(
                    snapshot_depth=settings.orderbook_snapshot_depth,
                    max_buffered_deltas=settings.orderbook_max_buffered_deltas,
                    max_resync_attempts=settings.orderbook_max_resync_attempts,
                    staleness_threshold_micros=(
                        settings.orderbook_staleness_threshold_ms * 1_000
                    ),
                ),
                on_resync=self._make_resync_reporter(canonical),
            )

    def _make_snapshot_fetcher(
        self, symbol: SymbolRef
    ) -> Callable[[str, int], Awaitable[OrderBookSnapshot]]:
        """Bind a symbol to the adapter's REST snapshot call, with timing."""

        async def fetch(_canonical: str, depth: int) -> OrderBookSnapshot:
            started = epoch_micros()
            try:
                snapshot = await self._adapter.fetch_order_book_snapshot(symbol, depth)
            except asyncio.CancelledError:
                raise
            except BaseException:
                self._metrics.record_snapshot_request(
                    self._exchange.value, success=False
                )
                raise
            self._metrics.record_snapshot_request(
                self._exchange.value,
                latency_micros=epoch_micros() - started,
                success=True,
            )
            return snapshot

        return fetch

    def _make_resync_reporter(self, canonical: str) -> Callable[[str], None]:
        def report(reason: str) -> None:
            self._metrics.record_book_resync(self._exchange.value)
            self._metrics.record_resync(
                self._exchange.value, MarketDataChannel.ORDER_BOOK.value, canonical
            )
            _LOGGER.info(
                "Order book resync for %s:%s — %s",
                self._exchange.value,
                canonical,
                reason,
            )
            if self._callbacks.on_resync is not None:
                self._callbacks.on_resync(canonical, reason)

        return report

    async def _instrumented_transport_factory(self, url: str) -> Any:
        """Count connection attempts around the injected factory."""
        exchange_name = self._exchange.value
        self._metrics.record_connection_attempt(exchange_name)
        try:
            transport = await self._transport_factory(url)
        except asyncio.CancelledError:
            raise
        except BaseException:
            self._metrics.record_connection_failure(exchange_name)
            raise
        self._metrics.record_connection_success(exchange_name)
        return transport

    # ------------------------------------------------------------------
    # Read path
    # ------------------------------------------------------------------
    def _on_message(self, raw: str) -> None:
        """Route one frame. Never raises.

        A malformed frame is a data problem, not a connection problem. Letting
        it escape would tear down a healthy socket and, with a venue sending one
        bad frame in a loop, produce a reconnect storm. It is counted, logged at
        debug, and dropped.
        """
        received = epoch_micros()
        exchange_name = self._exchange.value
        self._metrics.record_frame(
            exchange_name, byte_count=len(raw.encode("utf-8", errors="ignore"))
        )

        try:
            decoded = json.loads(raw, parse_float=str, parse_int=str)
        except (json.JSONDecodeError, ValueError):
            self._parse_errors += 1
            self._metrics.record_transport_parse_error(exchange_name)
            _LOGGER.debug("Discarded a frame that was not valid JSON.")
            return

        if not isinstance(decoded, Mapping):
            self._parse_errors += 1
            self._metrics.record_transport_parse_error(exchange_name)
            return

        stream, payload = unwrap_combined_stream(decoded)
        if stream is None:
            # {"result": null, "id": 1} — a subscribe acknowledgement, not data.
            if "e" not in payload:
                self._note_control_frame(payload)
                return
            stream = ""

        route = self._stream_routes.get(stream.lower())
        if route is None:
            route = self._route_from_payload(payload)
            if route is None:
                return

        channel, canonical = route
        self._confirm_subscription(stream, received)
        try:
            self._dispatch(channel, canonical, payload, received)
        except BinanceParseError as exc:
            self._parse_errors += 1
            self._metrics.record_parse_error(exchange_name, channel.value, canonical)
            self._metrics.record_transport_parse_error(exchange_name)
            _LOGGER.warning(
                "Dropped a malformed %s message for %s: %s",
                channel.value,
                canonical,
                exc,
            )
        except asyncio.CancelledError:
            raise
        except BaseException as exc:  # noqa: BLE001 - one bad frame is not fatal
            self._parse_errors += 1
            self._metrics.record_parse_error(exchange_name, channel.value, canonical)
            _LOGGER.exception(
                "Unexpected failure handling a %s message for %s: %s",
                channel.value,
                canonical,
                exc,
            )

    def _confirm_subscription(self, stream: str, received: int) -> None:
        """Mark a subscription live once its data actually arrives.

        Sending a SUBSCRIBE frame is not evidence of anything. A stream is
        active when the venue is delivering it, and that is the only definition
        under which a "subscribed but silent" feed shows up as a problem rather
        than as full health.
        """
        subscription_manager = self._subscription_manager
        if subscription_manager is None or not stream:
            return
        subscription = subscription_manager.get_by_stream(stream)
        if subscription is None:
            return
        if not subscription.is_active:
            subscription.mark_active(at_micros=received)
        subscription.record_message(at_micros=received)

    def _note_control_frame(self, payload: Mapping[str, Any]) -> None:
        """Record a venue rejection of a control frame.

        Binance answers a bad SUBSCRIBE with {"error": {...}, "id": N}. Silently
        ignoring it is how a feed ends up permanently subscribed to nothing.
        """
        error = payload.get("error")
        if not isinstance(error, Mapping):
            return
        message = str(error.get("msg") or error)
        self._last_error = f"SUBSCRIPTION_ERROR: {message}"
        self._metrics.record_subscription_failure(
            self._exchange.value, "control", "-"
        )
        _LOGGER.error("The venue rejected a control frame: %s", message)

    def _route_from_payload(
        self, payload: Mapping[str, Any]
    ) -> tuple[MarketDataChannel, str] | None:
        """Fall back to the payload's own event type and symbol.

        Needed for the single-stream endpoint, where frames are not wrapped and
        carry no stream name.
        """
        event = payload.get("e")
        venue_symbol = payload.get("s")
        if not isinstance(venue_symbol, str):
            return None

        if event == "depthUpdate":
            channel = MarketDataChannel.ORDER_BOOK
        elif event in ("trade", "aggTrade"):
            channel = MarketDataChannel.TRADES
        elif event == "24hrTicker":
            channel = MarketDataChannel.TICKER
        elif event is None and "b" in payload and "a" in payload:
            channel = MarketDataChannel.BOOK_TICKER
        else:
            return None

        try:
            canonical = self._adapter.symbol_registry.to_canonical_symbol(
                venue_symbol, self._exchange
            )
        except Exception:  # noqa: BLE001 - unknown symbol, drop the frame
            return None
        if canonical not in self._books and canonical not in self._tickers:
            if not any(ref.symbol == canonical for ref in self._symbols):
                return None
        return (channel, canonical)

    def _dispatch(
        self,
        channel: MarketDataChannel,
        canonical: str,
        payload: Mapping[str, Any],
        received: int,
    ) -> None:
        """Parse and apply one payload. Raises ``BinanceParseError`` on bad data."""
        exchange_name = self._exchange.value
        self._staleness.record_message(channel, canonical, at_micros=received)

        if channel is MarketDataChannel.ORDER_BOOK:
            delta = parse_depth_delta(payload, canonical, received_timestamp=received)
            synchroniser = self._books.get(canonical)
            if synchroniser is None:
                return
            outcome = synchroniser.on_delta(delta)
            processed = epoch_micros()
            self._metrics.record_message(
                exchange_name,
                channel.value,
                canonical,
                exchange_timestamp=delta.exchange_timestamp,
                received_timestamp=received,
                processed_timestamp=processed,
            )
            if outcome.resync_triggered:
                self._metrics.record_gap(exchange_name, channel.value, canonical)
                self._queue_resync(
                    canonical,
                    outcome.reason or "sequence gap detected",
                    discard=False,
                )
            if outcome.applied and self._callbacks.on_book_update is not None:
                self._callbacks.on_book_update(canonical, synchroniser.top())
            return

        if channel is MarketDataChannel.TRADES:
            trade = parse_trade(payload, canonical, received_timestamp=received)
            self._last_trades[canonical] = trade
            self._metrics.record_message(
                exchange_name,
                channel.value,
                canonical,
                exchange_timestamp=trade.exchange_timestamp,
                received_timestamp=received,
                processed_timestamp=epoch_micros(),
            )
            if self._callbacks.on_trade is not None:
                self._callbacks.on_trade(trade)
            return

        if channel is MarketDataChannel.BOOK_TICKER:
            ticker = parse_book_ticker(payload, canonical, received_timestamp=received)
            self._tickers[canonical] = ticker
            self._metrics.record_message(
                exchange_name,
                channel.value,
                canonical,
                exchange_timestamp=ticker.exchange_timestamp,
                received_timestamp=received,
                processed_timestamp=epoch_micros(),
            )
            if self._callbacks.on_ticker is not None:
                self._callbacks.on_ticker(ticker)
            return

    # ------------------------------------------------------------------
    # Connection events
    # ------------------------------------------------------------------
    def _on_state_change(
        self, previous: ConnectionState, current: ConnectionState
    ) -> None:
        """React to the existing state machine. Never raises.

        On leaving CONNECTED the books are invalidated *synchronously* — the
        gate flips before this method returns — and a resync is queued. Waiting
        for the asynchronous resync to start would leave a window in which a
        strategy could read a book from a connection that no longer exists.
        """
        exchange_name = self._exchange.value
        was_connected = previous is ConnectionState.CONNECTED
        self._connection_ready = current is ConnectionState.CONNECTED
        if self._connection_ready:
            self._connected_event.set()
        else:
            self._connected_event.clear()

        if was_connected and current is not ConnectionState.CONNECTED:
            self._metrics.record_disconnect(exchange_name)
            for canonical in self._books:
                self._queue_resync(
                    canonical,
                    f"connection left CONNECTED for {current.value}",
                    discard=True,
                )

        if current is ConnectionState.RECONNECTING:
            self._metrics.record_transport_reconnect(exchange_name)

        # There is deliberately no second resync queued on the way back *into*
        # CONNECTED. Every path out of CONNECTED is covered above, and the
        # resync worker waits for the connection before fetching, so one queued
        # request per disconnect produces exactly one snapshot per reconnect.
        # A depth snapshot costs up to 250 rate-limit weight; fetching two would
        # double that for no benefit.

        _LOGGER.info(
            "Venue connection state: %s -> %s", previous.value, current.value
        )
        if self._callbacks.on_state_change is not None:
            try:
                self._callbacks.on_state_change(previous, current)
            except BaseException:  # noqa: BLE001 - a sink must not break the feed
                _LOGGER.exception("A state-change callback raised.")

    def _on_error(self, error: NormalisedExchangeError) -> None:
        """Record a normalised connection error. Never raises."""
        self._last_error = f"{error.category.value}: {error.message}"
        if error.category.value == "TIMEOUT":
            self._metrics.record_heartbeat_failure(self._exchange.value)
        _LOGGER.warning("Connection error [%s]: %s", error.category.value, error.message)

    # ------------------------------------------------------------------
    # Background workers
    # ------------------------------------------------------------------
    def _queue_resync(self, canonical: str, reason: str, *, discard: bool) -> None:
        """Hand a snapshot fetch to the worker.

        Called from the read loop and from state callbacks, both of which are
        synchronous and must not perform I/O.
        """
        queue = self._resync_queue
        if queue is None:
            return
        try:
            queue.put_nowait((canonical, reason, discard))
        except asyncio.QueueFull:  # pragma: no cover - unbounded queue
            _LOGGER.error("Resync queue is full; dropped a request for %s", canonical)

    async def _run_resync_worker(self) -> None:
        """Serialise snapshot fetches for every book.

        One worker rather than one task per book: a burst of resyncs across ten
        symbols would otherwise fire ten weight-250 depth requests at once and
        earn a rate-limit ban, which is the failure this queue exists to avoid.
        """
        queue = self._resync_queue
        assert queue is not None
        while True:
            canonical, reason, discard = await queue.get()
            try:
                # Never fetch a snapshot while the socket is down. The snapshot
                # would be correct on arrival and immediately obsolete, and the
                # book would go LIVE against a connection that no longer feeds
                # it — the precise state this whole layer exists to prevent.
                await self._connected_event.wait()
                synchroniser = self._books.get(canonical)
                if synchroniser is None:
                    continue
                if synchroniser.phase is SyncPhase.IDLE:
                    await synchroniser.start()
                elif synchroniser.phase is SyncPhase.FAILED:
                    await synchroniser.restart()
                else:
                    await synchroniser.resync(reason, discard_buffer=discard)
            except asyncio.CancelledError:
                raise
            except BaseException as exc:  # noqa: BLE001 - keep the worker alive
                _LOGGER.exception(
                    "Resync of %s failed: %s", canonical, exc
                )
            finally:
                queue.task_done()

    async def _run_staleness_worker(self) -> None:
        """Evaluate stream freshness on a fixed cadence.

        The staleness monitor is edge-triggered and needs to be asked; nothing
        else would notice a stream that simply stopped, because a stream that
        stops produces no message to trigger a check.
        """
        interval = max(1.0, self._settings.ws_heartbeat_interval_ms / 1000)
        while True:
            await asyncio.sleep(interval)
            verdict = self._staleness.evaluate()
            for freshness in verdict.newly_stale:
                self._metrics.record_stale_transition(
                    self._exchange.value,
                    freshness.channel.value,
                    freshness.symbol,
                )
                _LOGGER.warning(
                    "Stream %s:%s went stale.",
                    freshness.channel.value,
                    freshness.symbol,
                )

    # ------------------------------------------------------------------
    # Health
    # ------------------------------------------------------------------
    def health(self) -> FeedHealth:
        """Aggregate health across the connection, streams and books."""
        manager = self._manager
        state = manager.state if manager is not None else ConnectionState.DISCONNECTED
        subscription_manager = self._subscription_manager

        stale = tuple(
            f"{freshness.channel.value}:{freshness.symbol}"
            for freshness in self._staleness.snapshot()
            if freshness.is_stale
        )
        # The connection manager does not track freshness itself — it is told,
        # because "stale" is a market-data judgement and the socket layer has no
        # opinion on how often a given stream ought to tick.
        connection_health = (
            manager.health(is_stale=bool(stale)) if manager is not None else None
        )

        tradeable: list[str] = []
        untradeable: list[str] = []
        books: list[dict[str, object]] = []
        for canonical, synchroniser in sorted(self._books.items()):
            snapshot = synchroniser.health_snapshot()
            gated = self._connection_ready and synchroniser.is_tradeable
            snapshot["isTradeable"] = gated
            snapshot["connectionReady"] = self._connection_ready
            books.append(snapshot)
            (tradeable if gated else untradeable).append(canonical)

        connected = state is ConnectionState.CONNECTED and self._connection_ready
        return FeedHealth(
            exchange=self._exchange.value,
            state=state,
            connected=connected,
            fresh=(
                connected
                and not stale
                and (connection_health is None or not connection_health.is_stale)
            ),
            running=self._running,
            subscription_count=(
                subscription_manager.count if subscription_manager is not None else 0
            ),
            active_subscription_count=(
                subscription_manager.active_count
                if subscription_manager is not None
                else 0
            ),
            stale_streams=stale,
            reconnect_count=manager.reconnect_count if manager is not None else 0,
            messages_received=(
                connection_health.messages_received
                if connection_health is not None
                else 0
            ),
            parse_errors=self._parse_errors,
            tradeable_symbols=tuple(tradeable),
            untradeable_symbols=tuple(untradeable),
            books=tuple(books),
            last_error=self._last_error,
        )
```

### FILE: libs/trading-core/wlct_trading/net/runner.py

```python
"""Process-level runner for the live market-data service.

Composition only. Everything this module does is build the concrete transports,
hand them to the adapter, hand the adapter to the feed, install signal handlers
and print health on a timer. There is no exchange-specific logic here — no
stream names, no parsing, no sequence rules — because all of that belongs to the
adapter and would be wrong to duplicate at the process level.

Scope, stated plainly: **public market data only**. No credentials are read, no
request is signed, and no order is submitted. Live order execution is not
implemented in this path.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import signal
from typing import Any

from wlct_trading.exchanges.binance import BinanceMarketDataAdapter
from wlct_trading.metrics import ConnectivityMetrics
from wlct_trading.net.config import TransportSettings
from wlct_trading.net.feed import FeedCallbacks, FeedHealth, MarketDataFeed
from wlct_trading.net.http_client import HttpxGetter
from wlct_trading.net.websocket_client import WebsocketsTransportFactory

__all__ = ["MarketDataRunner", "configure_logging", "run"]

_LOGGER = logging.getLogger("wlct_trading.net.runner")


class _JsonFormatter(logging.Formatter):
    """Structured log lines, matching what the other services emit.

    Structured rather than free text because these logs are shipped and queried.
    No message field here is ever populated with a credential: the market-data
    path holds none.
    """

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, separators=(",", ":"))


def configure_logging(level: str = "INFO", *, structured: bool = True) -> None:
    """Install a root handler once, without clobbering an existing one."""
    root = logging.getLogger()
    if root.handlers:
        root.setLevel(level.upper())
        return
    handler = logging.StreamHandler()
    handler.setFormatter(
        _JsonFormatter()
        if structured
        else logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
    )
    root.addHandler(handler)
    root.setLevel(level.upper())


class MarketDataRunner:
    """Owns the process lifetime of one market-data feed."""

    __slots__ = (
        "_settings",
        "_metrics",
        "_http",
        "_factory",
        "_adapter",
        "_feed",
        "_stop_event",
        "_health_task",
        "_callbacks",
    )

    def __init__(
        self,
        settings: TransportSettings,
        *,
        metrics: ConnectivityMetrics | None = None,
        callbacks: FeedCallbacks | None = None,
    ) -> None:
        self._settings = settings
        self._metrics = metrics or ConnectivityMetrics()
        self._callbacks = callbacks
        self._http = HttpxGetter(settings)
        self._factory = WebsocketsTransportFactory(settings)
        self._adapter = BinanceMarketDataAdapter(
            # Public market data only. This adapter has no parameter that could
            # carry an API key, by construction.
            self._http,
            testnet=settings.use_testnet,
            # One source of truth for the endpoints: the adapter builds every
            # REST path and every stream URL from these, so nothing downstream
            # concatenates a host of its own.
            rest_base=settings.binance_rest_url,
            ws_base=settings.binance_ws_url,
        )
        self._feed = MarketDataFeed(
            self._adapter,
            settings,
            self._factory,
            metrics=self._metrics,
            callbacks=callbacks,
        )
        self._stop_event = asyncio.Event()
        self._health_task: asyncio.Task[None] | None = None

    @property
    def feed(self) -> MarketDataFeed:
        return self._feed

    @property
    def metrics(self) -> ConnectivityMetrics:
        return self._metrics

    def health(self) -> FeedHealth:
        return self._feed.health()

    def request_stop(self) -> None:
        """Ask the runner to wind down. Safe to call from a signal handler."""
        self._stop_event.set()

    async def start(self) -> None:
        _LOGGER.info(
            "Starting live market data: %s",
            json.dumps(self._settings.to_public_dict(), separators=(",", ":")),
        )
        await self._feed.start()
        self._health_task = asyncio.create_task(
            self._report_health(), name="wlct-market-data-health"
        )

    async def stop(self) -> None:
        """Stop the feed and release the HTTP session.

        Ordered so nothing is left holding a socket: cancel the reporter, stop
        the feed (which unsubscribes and closes the websocket), then close the
        HTTP pool.
        """
        if self._health_task is not None:
            self._health_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._health_task
            self._health_task = None

        await self._feed.stop()
        await self._http.aclose()
        _LOGGER.info(
            "Market data stopped. Final counters: %s",
            json.dumps(self._metrics.transport_totals(), separators=(",", ":")),
        )

    async def run(self, *, duration_seconds: float | None = None) -> FeedHealth:
        """Run until stopped, or for a bounded duration.

        ``duration_seconds`` is what the smoke test uses; leaving it ``None`` is
        the service mode, which runs until a signal arrives.
        """
        await self.start()
        try:
            if duration_seconds is None:
                await self._stop_event.wait()
            else:
                with contextlib.suppress(asyncio.TimeoutError):
                    await asyncio.wait_for(
                        self._stop_event.wait(), timeout=duration_seconds
                    )
            return self._feed.health()
        finally:
            await self.stop()

    async def _report_health(self) -> None:
        """Log a health line on a fixed cadence."""
        interval = float(self._settings.health_report_interval_seconds)
        while True:
            await asyncio.sleep(interval)
            health = self._feed.health()
            _LOGGER.info(
                "Health: %s",
                json.dumps(
                    {
                        "status": health.status,
                        "state": health.state.value,
                        "connected": health.connected,
                        "fresh": health.fresh,
                        "tradeable": list(health.tradeable_symbols),
                        "untradeable": list(health.untradeable_symbols),
                        "staleStreams": list(health.stale_streams),
                        "reconnects": health.reconnect_count,
                        "messages": health.messages_received,
                        "parseErrors": health.parse_errors,
                    },
                    separators=(",", ":"),
                ),
            )

    def install_signal_handlers(self, loop: asyncio.AbstractEventLoop) -> None:
        """Turn SIGINT/SIGTERM into an orderly stop.

        Without this a container stop would kill the process mid-frame, leaving
        the venue holding a half-open connection until its own timeout.
        """
        for signal_name in ("SIGINT", "SIGTERM"):
            handled = getattr(signal, signal_name, None)
            if handled is None:  # pragma: no cover - platform dependent
                continue
            try:
                loop.add_signal_handler(handled, self.request_stop)
            except (NotImplementedError, RuntimeError):  # pragma: no cover
                # Windows, or a non-main thread. The runner is still stoppable
                # through request_stop().
                pass


async def run(
    settings: TransportSettings | None = None,
    *,
    duration_seconds: float | None = None,
) -> FeedHealth:
    """Build a runner from the environment and run it."""
    resolved = settings or TransportSettings.from_env()
    runner = MarketDataRunner(resolved)
    runner.install_signal_handlers(asyncio.get_running_loop())
    return await runner.run(duration_seconds=duration_seconds)
```

### FILE: libs/trading-core/wlct_trading/net/__main__.py

```python
"""CLI entry point: ``python -m wlct_trading.net``.

Starts the live public market-data feed described by the environment, reports
health while it runs, and shuts down cleanly on SIGINT or SIGTERM.

This command **does not trade**. It has no access to credentials and submits no
orders; it opens public websocket streams and public REST snapshot requests.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys

from wlct_trading.net.config import InvalidTransportSettings, TransportSettings
from wlct_trading.net.runner import MarketDataRunner, configure_logging


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m wlct_trading.net",
        description=(
            "Stream public market data from a supported exchange through the "
            "trading-core connectivity pipeline. Public data only: no API "
            "credentials are used and no orders are submitted."
        ),
    )
    parser.add_argument(
        "--duration",
        type=float,
        default=None,
        metavar="SECONDS",
        help="Stop after this many seconds. Omit to run until signalled.",
    )
    parser.add_argument(
        "--symbols",
        type=str,
        default=None,
        help=(
            "Comma-separated symbols, overriding MARKET_DATA_SYMBOLS. "
            "Accepts BTC/USDT, BTC-USDT or BTCUSDT."
        ),
    )
    parser.add_argument(
        "--log-level",
        type=str,
        default=os.environ.get("LOG_LEVEL", "INFO"),
        help="Logging level (default: INFO, or LOG_LEVEL).",
    )
    parser.add_argument(
        "--plain-logs",
        action="store_true",
        help="Human-readable logs instead of JSON.",
    )
    parser.add_argument(
        "--print-config",
        action="store_true",
        help="Print the resolved configuration and exit without connecting.",
    )
    return parser


async def _main(argv: list[str]) -> int:
    args = build_parser().parse_args(argv)
    configure_logging(args.log_level, structured=not args.plain_logs)

    environment = dict(os.environ)
    if args.symbols:
        environment["MARKET_DATA_SYMBOLS"] = args.symbols

    try:
        settings = TransportSettings.from_env(environment)
    except InvalidTransportSettings as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        return 2

    if args.print_config:
        import json

        print(json.dumps(settings.to_public_dict(), indent=2, sort_keys=True))
        return 0

    runner = MarketDataRunner(settings)
    runner.install_signal_handlers(asyncio.get_running_loop())
    health = await runner.run(duration_seconds=args.duration)

    # A non-zero exit for a run that never reached a healthy state, so a
    # supervisor or CI job notices rather than reading "exited 0" as success.
    return 0 if health.messages_received > 0 else 1


def main() -> int:
    try:
        return asyncio.run(_main(sys.argv[1:]))
    except KeyboardInterrupt:  # pragma: no cover - interactive
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
```


## B2. New files — tests and live smoke test

### FILE: libs/trading-core/tests/test_net_transport.py

```python
"""Deterministic tests for the production transports.

No internet, no credentials, no database, no Redis. Every network interaction is
against an in-process fake, so these run in CI on a machine with no egress.

Covers cases 1-15 and 19 of the Part 4 test plan: websocket connect/send/
receive/close, connect and receive timeouts, network failure, secure-URL
enforcement, HTTP success, timeout, non-2xx, malformed JSON, retry behaviour,
and the "no credentials anywhere" guarantee.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Mapping

import pytest

from wlct_trading.net.config import InvalidTransportSettings, TransportSettings
from wlct_trading.net.http_client import HttpxGetter, InsecureHttpUrl
from wlct_trading.net.normalise import (
    category_for_http_status,
    normalise_http_status,
    normalise_network_exception,
)
from wlct_trading.net.websocket_client import (
    InsecureWebSocketUrl,
    WebsocketsTransport,
    WebsocketsTransportFactory,
)
from wlct_trading.transport.errors import (
    ExchangeErrorCategory,
    NormalisedExchangeError,
)
from wlct_trading.transport.websocket import ConnectionClosed


def run(coroutine: Any) -> Any:
    """Run a coroutine to completion.

    ``pytest-asyncio`` is not a dependency of this project and adding one for
    the test suite of a zero-dependency library is not a trade worth making.
    """
    return asyncio.run(coroutine)


def settings(**overrides: Any) -> TransportSettings:
    base: dict[str, Any] = {
        "symbols": ("BTC/USDT",),
        "http_max_retries": 2,
        "ws_receive_timeout_ms": 1_000,
    }
    base.update(overrides)
    return TransportSettings(**base)


# ----------------------------------------------------------------------
# Fakes
# ----------------------------------------------------------------------
class FakeLibraryClosed(Exception):
    """Stands in for ``websockets.exceptions.ConnectionClosed``.

    Matched by class name, exactly as the real one is, which is what lets the
    normalisation layer work without importing the library.
    """

    __name__ = "ConnectionClosed"


FakeLibraryClosed.__name__ = "ConnectionClosed"


class FakeConnection:
    """A scriptable stand-in for a ``websockets`` client connection."""

    def __init__(
        self,
        *,
        incoming: list[Any] | None = None,
        recv_delay: float = 0.0,
        recv_error: BaseException | None = None,
        send_error: BaseException | None = None,
    ) -> None:
        self.incoming = list(incoming or [])
        self.sent: list[str] = []
        self.closed = False
        self.close_calls = 0
        self.recv_delay = recv_delay
        self.recv_error = recv_error
        self.send_error = send_error

    async def send(self, message: str) -> None:
        if self.send_error is not None:
            raise self.send_error
        self.sent.append(message)

    async def recv(self) -> Any:
        if self.recv_delay:
            await asyncio.sleep(self.recv_delay)
        if self.recv_error is not None:
            raise self.recv_error
        if not self.incoming:
            raise FakeLibraryClosed("no more frames")
        return self.incoming.pop(0)

    async def close(self) -> None:
        self.close_calls += 1
        self.closed = True


class FakeResponse:
    def __init__(
        self,
        status_code: int,
        body: str,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        self.status_code = status_code
        self.text = body
        self.content = body.encode("utf-8")
        self.headers = dict(headers or {})


class FakeHttpClient:
    """Records requests and replays a scripted sequence of results."""

    def __init__(self, results: list[Any]) -> None:
        self.results = list(results)
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.headers: dict[str, str] = {}
        self.closed = False

    async def get(self, url: str, params: Mapping[str, Any] | None = None) -> Any:
        self.calls.append((url, dict(params or {})))
        if not self.results:
            raise AssertionError("FakeHttpClient ran out of scripted results.")
        result = self.results.pop(0)
        if isinstance(result, BaseException):
            raise result
        return result

    async def aclose(self) -> None:
        self.closed = True


class FakeTimeout(Exception):
    """Stands in for ``httpx.ReadTimeout``; matched by name."""


FakeTimeout.__name__ = "ReadTimeout"


async def no_sleep(_seconds: float) -> None:
    """Collapse backoff so retry tests stay fast and deterministic."""
    return None


# ======================================================================
# 1. Websocket connect
# ======================================================================
def test_case_01_websocket_connect_returns_a_wrapped_transport() -> None:
    connection = FakeConnection(incoming=["hello"])
    captured: dict[str, Any] = {}

    async def fake_connect(url: str, **kwargs: Any) -> FakeConnection:
        captured["url"] = url
        captured.update(kwargs)
        return connection

    factory = WebsocketsTransportFactory(settings(), connect=fake_connect)
    transport = run(factory("wss://stream.binance.com:9443/ws"))

    assert isinstance(transport, WebsocketsTransport)
    assert captured["url"] == "wss://stream.binance.com:9443/ws"
    assert captured["open_timeout"] == pytest.approx(10.0)
    assert captured["compression"] is None
    assert factory.attempts == 1
    assert factory.successes == 1
    assert factory.failures == 0


def test_case_01b_plaintext_websocket_urls_are_refused() -> None:
    """No ``ws://``. Market data an attacker can rewrite is worse than none."""
    factory = WebsocketsTransportFactory(settings())
    with pytest.raises(InsecureWebSocketUrl):
        run(factory("ws://stream.binance.com:9443/ws"))
    assert factory.attempts == 0


# ======================================================================
# 2. Websocket send
# ======================================================================
def test_case_02_send_forwards_the_frame_verbatim() -> None:
    connection = FakeConnection()
    transport = WebsocketsTransport(connection, receive_timeout_seconds=1.0)
    frame = json.dumps({"method": "SUBSCRIBE", "params": ["btcusdt@trade"], "id": 1})

    run(transport.send(frame))

    assert connection.sent == [frame]


def test_case_02b_send_after_close_raises_the_platform_closed_error() -> None:
    connection = FakeConnection()
    transport = WebsocketsTransport(connection, receive_timeout_seconds=1.0)
    run(transport.close())

    with pytest.raises(ConnectionClosed):
        run(transport.send("{}"))


# ======================================================================
# 3. Websocket receive
# ======================================================================
def test_case_03_receive_decodes_text_and_binary_and_counts_bytes() -> None:
    connection = FakeConnection(incoming=["first", b"second"])
    seen: list[int] = []
    transport = WebsocketsTransport(
        connection, receive_timeout_seconds=1.0, on_bytes=seen.append
    )

    async def scenario() -> tuple[str, str]:
        return await transport.receive(), await transport.receive()

    first, second = run(scenario())

    assert first == "first"
    assert second == "second"
    assert seen == [5, 6]
    assert transport.bytes_received == 11
    assert transport.messages_received == 2


# ======================================================================
# 4. Websocket close
# ======================================================================
def test_case_04_close_is_idempotent_and_never_raises() -> None:
    class ExplodingClose(FakeConnection):
        async def close(self) -> None:
            self.close_calls += 1
            raise RuntimeError("the socket was already gone")

    connection = ExplodingClose()
    transport = WebsocketsTransport(connection, receive_timeout_seconds=1.0)

    async def scenario() -> None:
        await transport.close()
        await transport.close()

    run(scenario())

    assert transport.is_closed is True
    # Second call short-circuits: shutdown does not re-enter a dead socket.
    assert connection.close_calls == 1


# ======================================================================
# 5. Connect timeout
# ======================================================================
def test_case_05_connect_timeout_normalises_to_the_timeout_category() -> None:
    async def slow_connect(_url: str, **_kwargs: Any) -> FakeConnection:
        raise asyncio.TimeoutError()

    factory = WebsocketsTransportFactory(settings(), connect=slow_connect)

    with pytest.raises(NormalisedExchangeError) as caught:
        run(factory("wss://stream.binance.com:9443/ws"))

    assert caught.value.category is ExchangeErrorCategory.TIMEOUT
    assert caught.value.is_retryable is True
    assert factory.failures == 1
    # The library's own type must not escape.
    assert "asyncio" not in caught.value.message.split(":")[0]


# ======================================================================
# 6. Receive timeout
# ======================================================================
def test_case_06_receive_timeout_is_bounded_and_normalised() -> None:
    connection = FakeConnection(incoming=["never read"], recv_delay=5.0)
    transport = WebsocketsTransport(connection, receive_timeout_seconds=0.01)

    with pytest.raises(NormalisedExchangeError) as caught:
        run(transport.receive())

    assert caught.value.category is ExchangeErrorCategory.TIMEOUT
    assert "receive exceeded" in caught.value.message


# ======================================================================
# 7. Network failure
# ======================================================================
def test_case_07_network_failures_normalise_without_leaking_library_types() -> None:
    async def refused(_url: str, **_kwargs: Any) -> FakeConnection:
        raise ConnectionRefusedError("connection refused")

    factory = WebsocketsTransportFactory(settings(), connect=refused)

    with pytest.raises(NormalisedExchangeError) as caught:
        run(factory("wss://stream.binance.com:9443/ws"))

    error = caught.value
    assert error.category is ExchangeErrorCategory.NETWORK_ERROR
    assert error.is_retryable is True
    assert error.metadata["exceptionType"] == "ConnectionRefusedError"


def test_case_07b_peer_close_maps_to_the_platform_connection_closed_type() -> None:
    """The manager's read loop keys on this exact type to decide to reconnect."""
    connection = FakeConnection(recv_error=FakeLibraryClosed("1006"))
    transport = WebsocketsTransport(connection, receive_timeout_seconds=1.0)

    with pytest.raises(ConnectionClosed):
        run(transport.receive())
    assert transport.is_closed is True


def test_case_07c_every_library_exception_maps_into_the_existing_vocabulary() -> None:
    """No new error categories were invented for Part 4."""
    cases = {
        "ReadTimeout": ExchangeErrorCategory.TIMEOUT,
        "ConnectError": ExchangeErrorCategory.NETWORK_ERROR,
        "ProtocolError": ExchangeErrorCategory.EXCHANGE_ERROR,
        "InvalidMessage": ExchangeErrorCategory.EXCHANGE_ERROR,
        "PayloadTooBig": ExchangeErrorCategory.EXCHANGE_ERROR,
    }
    for name, expected in cases.items():
        exception = type(name, (Exception,), {})("boom")
        normalised = normalise_network_exception(exception, context="test")
        assert normalised.category is expected, name
        assert normalised.category in set(ExchangeErrorCategory)


# ======================================================================
# 10. HTTP snapshot success
# ======================================================================
def test_case_10_http_get_returns_parsed_json_with_numbers_as_strings() -> None:
    body = json.dumps(
        {
            "lastUpdateId": 1027024,
            "bids": [["4.00000000", "431.00000000"]],
            "asks": [["4.00000200", "12.00000000"]],
        }
    )
    client = FakeHttpClient([FakeResponse(200, body)])
    getter = HttpxGetter(settings(), client=client, sleep=no_sleep)

    payload = run(getter("https://api.binance.com/api/v3/depth", {"symbol": "BTCUSDT"}))

    assert payload["lastUpdateId"] == "1027024"
    assert isinstance(payload["lastUpdateId"], str)
    # Nothing in a price path is ever a float: binary floating point cannot
    # represent 4.00000200 exactly.
    assert not isinstance(payload["bids"][0][0], float)
    assert client.calls[0][1] == {"symbol": "BTCUSDT"}
    assert getter.requests == 1
    assert getter.failures == 0


def test_case_10b_plaintext_http_urls_are_refused() -> None:
    getter = HttpxGetter(settings(), client=FakeHttpClient([]))
    with pytest.raises(InsecureHttpUrl):
        run(getter("http://api.binance.com/api/v3/depth", {}))


# ======================================================================
# 11. HTTP timeout
# ======================================================================
def test_case_11_http_timeout_retries_then_reports_a_timeout() -> None:
    client = FakeHttpClient([FakeTimeout("read timed out")] * 3)
    getter = HttpxGetter(settings(http_max_retries=2), client=client, sleep=no_sleep)

    with pytest.raises(NormalisedExchangeError) as caught:
        run(getter("https://api.binance.com/api/v3/depth", {}))

    assert caught.value.category is ExchangeErrorCategory.TIMEOUT
    # Bounded: the initial attempt plus exactly two retries.
    assert len(client.calls) == 3
    assert getter.retries == 2


def test_case_11b_a_transient_failure_is_retried_and_then_succeeds() -> None:
    client = FakeHttpClient(
        [FakeTimeout("read timed out"), FakeResponse(200, json.dumps({"ok": True}))]
    )
    getter = HttpxGetter(settings(), client=client, sleep=no_sleep)

    payload = run(getter("https://api.binance.com/api/v3/ping", {}))

    assert payload == {"ok": True}
    assert len(client.calls) == 2


# ======================================================================
# 12. HTTP non-2xx
# ======================================================================
def test_case_12_client_errors_are_not_retried() -> None:
    body = json.dumps({"code": -1121, "msg": "Invalid symbol."})
    client = FakeHttpClient([FakeResponse(400, body)])
    getter = HttpxGetter(settings(), client=client, sleep=no_sleep)

    with pytest.raises(NormalisedExchangeError) as caught:
        run(getter("https://api.binance.com/api/v3/depth", {"symbol": "NOPE"}))

    error = caught.value
    assert error.category is ExchangeErrorCategory.INVALID_REQUEST
    assert error.is_retryable is False
    assert error.venue_code == "-1121"
    assert error.venue_message == "Invalid symbol."
    # Retrying a malformed request only delays the real error.
    assert len(client.calls) == 1


def test_case_12b_rate_limit_responses_honour_retry_after() -> None:
    client = FakeHttpClient(
        [
            FakeResponse(429, "{}", headers={"Retry-After": "2"}),
            FakeResponse(200, json.dumps({"ok": True})),
        ]
    )
    delays: list[float] = []

    async def record(seconds: float) -> None:
        delays.append(seconds)

    getter = HttpxGetter(settings(), client=client, sleep=record)
    payload = run(getter("https://api.binance.com/api/v3/depth", {}))

    assert payload == {"ok": True}
    # The venue's own hint wins over the computed backoff. Ignoring it is how a
    # rate limit becomes an IP ban.
    assert delays and delays[0] >= 2.0


def test_case_12c_server_errors_are_retried_and_bounded() -> None:
    client = FakeHttpClient([FakeResponse(503, "unavailable")] * 3)
    getter = HttpxGetter(settings(http_max_retries=2), client=client, sleep=no_sleep)

    with pytest.raises(NormalisedExchangeError) as caught:
        run(getter("https://api.binance.com/api/v3/depth", {}))

    assert caught.value.category is ExchangeErrorCategory.EXCHANGE_ERROR
    assert len(client.calls) == 3


def test_case_12d_http_status_mapping_uses_only_existing_categories() -> None:
    assert category_for_http_status(429) is ExchangeErrorCategory.RATE_LIMIT_ERROR
    assert category_for_http_status(418) is ExchangeErrorCategory.RATE_LIMIT_ERROR
    assert category_for_http_status(401) is ExchangeErrorCategory.AUTHENTICATION_ERROR
    assert category_for_http_status(404) is ExchangeErrorCategory.INVALID_REQUEST
    assert category_for_http_status(500) is ExchangeErrorCategory.EXCHANGE_ERROR
    assert category_for_http_status(408) is ExchangeErrorCategory.TIMEOUT


def test_case_12e_error_metadata_never_carries_a_query_string() -> None:
    """Query strings are stripped before anything reaches a log line."""
    error = normalise_http_status(
        400,
        url="https://api.binance.com/api/v3/order?signature=deadbeef&apiKey=secret",
        body_excerpt="{}",
    )
    rendered = json.dumps(error.to_log_fields())
    assert "deadbeef" not in rendered
    assert "signature" not in rendered


# ======================================================================
# 13. Malformed JSON
# ======================================================================
def test_case_13_malformed_json_is_reported_not_raised_raw() -> None:
    # An HTML body from a 200 response is what a maintenance page or an
    # intercepting proxy looks like. It is retried a bounded number of times —
    # the next response may well be JSON — and then reported.
    client = FakeHttpClient([FakeResponse(200, "<html>maintenance</html>")] * 3)
    getter = HttpxGetter(settings(http_max_retries=2), client=client, sleep=no_sleep)

    with pytest.raises(NormalisedExchangeError) as caught:
        run(getter("https://api.binance.com/api/v3/depth", {}))

    error = caught.value
    assert error.category is ExchangeErrorCategory.EXCHANGE_ERROR
    assert "not valid JSON" in error.message
    assert error.metadata["bodyExcerpt"].startswith("<html>")
    assert len(client.calls) == 3


def test_case_13b_malformed_json_does_not_crash_the_caller() -> None:
    """A bad body must surface as a normalised error, never as a raw decode."""
    client = FakeHttpClient(
        [FakeResponse(200, "{not json"), FakeResponse(200, json.dumps({"ok": 1}))]
    )
    getter = HttpxGetter(settings(), client=client, sleep=no_sleep)

    assert run(getter("https://api.binance.com/api/v3/ping", {})) == {"ok": "1"}


# ======================================================================
# 19. No credentials required
# ======================================================================
def test_case_19_no_credential_field_exists_on_the_transport_path() -> None:
    """Public market data needs no key, so there is nowhere to put one."""
    banned = ("key", "secret", "token", "password", "signature", "passphrase")
    for field_name in TransportSettings.__dataclass_fields__:
        assert not any(word in field_name.lower() for word in banned), field_name


def test_case_19b_no_authorisation_headers_are_sent() -> None:
    client = FakeHttpClient([FakeResponse(200, "{}")])
    getter = HttpxGetter(settings(), client=client, sleep=no_sleep)
    run(getter("https://api.binance.com/api/v3/depth", {"symbol": "BTCUSDT"}))

    _url, params = client.calls[0]
    for key in params:
        assert key.lower() not in ("signature", "apikey", "timestamp")
    assert "X-MBX-APIKEY" not in client.headers


# ======================================================================
# Session lifecycle
# ======================================================================
def test_session_is_closed_exactly_once_and_only_if_owned() -> None:
    client = FakeHttpClient([FakeResponse(200, "{}")])

    async def scenario() -> None:
        async with HttpxGetter(settings(), client=client, sleep=no_sleep) as getter:
            await getter("https://api.binance.com/api/v3/ping", {})

    run(scenario())
    # An injected client belongs to the caller; closing it here would pull the
    # pool out from under them.
    assert client.closed is False

    owned = HttpxGetter(settings(), sleep=no_sleep)
    owned._client = client  # noqa: SLF001 - exercising the ownership branch
    owned._owns_client = True  # noqa: SLF001
    run(owned.aclose())
    assert client.closed is True


# ======================================================================
# Configuration validation
# ======================================================================
def test_configuration_rejects_unsafe_and_nonsensical_values() -> None:
    with pytest.raises(InvalidTransportSettings):
        TransportSettings(binance_ws_url="ws://stream.binance.com:9443")
    with pytest.raises(InvalidTransportSettings):
        TransportSettings(binance_rest_url="http://api.binance.com")
    with pytest.raises(InvalidTransportSettings):
        TransportSettings(
            ws_heartbeat_interval_ms=90_000, ws_heartbeat_timeout_ms=90_000
        )
    with pytest.raises(InvalidTransportSettings):
        TransportSettings(symbols=())
    with pytest.raises(InvalidTransportSettings):
        TransportSettings(
            ticker_enabled=False, trades_enabled=False, orderbook_enabled=False
        )


def test_configuration_parses_booleans_strictly() -> None:
    resolved = TransportSettings.from_env(
        {
            "MARKET_DATA_SYMBOLS": "BTC/USDT",
            "MARKET_DATA_TICKER_ENABLED": "false",
            "MARKET_DATA_TRADES_ENABLED": "1",
        }
    )
    assert resolved.ticker_enabled is False
    assert resolved.trades_enabled is True

    with pytest.raises(InvalidTransportSettings):
        TransportSettings.from_env({"MARKET_DATA_TICKER_ENABLED": "flase"})
    with pytest.raises(InvalidTransportSettings):
        TransportSettings.from_env({"HTTP_CONNECT_TIMEOUT_MS": "not-a-number"})
```

### FILE: libs/trading-core/tests/test_net_feed.py

```python
"""Deterministic tests for the live market-data feed.

The full pipeline — websocket frames in, order book and normalised events out —
driven entirely by in-process fakes. No internet, no credentials, no database,
no Redis.

Covers cases 8, 9, 14-18 and 20 of the Part 4 test plan: reconnection through
the existing state machine, subscription restoration through the existing
subscription manager, order-book resynchronisation after a reconnect, malformed
exchange messages, configured symbols and channels, clean shutdown, and health
reporting that distinguishes connected-and-fresh from connected-but-stale from
disconnected.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Mapping

import pytest

from wlct_trading.enums import ExchangeId
from wlct_trading.exchanges.binance import BinanceMarketDataAdapter
from wlct_trading.net.config import TransportSettings
from wlct_trading.net.feed import FeedCallbacks, MarketDataFeed
from wlct_trading.net.symbols import canonicalise_configured_symbol
from wlct_trading.orderbook_sync import SyncPhase
from wlct_trading.transport.subscriptions import MarketDataChannel, SubscriptionStatus
from wlct_trading.transport.websocket import ConnectionClosed, ConnectionState

BASE_TS = 1_700_000_000_000


def run(coroutine: Any) -> Any:
    return asyncio.run(coroutine)


# ----------------------------------------------------------------------
# Venue fixtures
# ----------------------------------------------------------------------
EXCHANGE_INFO: dict[str, Any] = {
    "symbols": [
        {
            "symbol": "BTCUSDT",
            "status": "TRADING",
            "baseAsset": "BTC",
            "quoteAsset": "USDT",
            "filters": [
                {"filterType": "PRICE_FILTER", "tickSize": "0.01000000"},
                {
                    "filterType": "LOT_SIZE",
                    "stepSize": "0.00001000",
                    "minQty": "0.00001000",
                    "maxQty": "9000.00000000",
                },
                {"filterType": "NOTIONAL", "minNotional": "5.00000000"},
            ],
        },
        {
            "symbol": "ETHUSDT",
            "status": "TRADING",
            "baseAsset": "ETH",
            "quoteAsset": "USDT",
            "filters": [
                {"filterType": "PRICE_FILTER", "tickSize": "0.01000000"},
                {
                    "filterType": "LOT_SIZE",
                    "stepSize": "0.00010000",
                    "minQty": "0.00010000",
                    "maxQty": "9000.00000000",
                },
                {"filterType": "NOTIONAL", "minNotional": "5.00000000"},
            ],
        },
    ]
}


def depth_snapshot(last_update_id: int) -> dict[str, Any]:
    return {
        "lastUpdateId": str(last_update_id),
        "bids": [["100.00", "2.00000000"], ["99.50", "5.00000000"]],
        "asks": [["100.50", "3.00000000"], ["101.00", "4.00000000"]],
    }


def depth_frame(first_id: int, final_id: int, *, bid: str = "100.10") -> str:
    return json.dumps(
        {
            "stream": "btcusdt@depth@100ms",
            "data": {
                "e": "depthUpdate",
                "E": BASE_TS,
                "s": "BTCUSDT",
                "U": first_id,
                "u": final_id,
                "b": [[bid, "1.50000000"]],
                "a": [["100.60", "2.50000000"]],
            },
        }
    )


TRADE_FRAME = json.dumps(
    {
        "stream": "btcusdt@trade",
        "data": {
            "e": "trade",
            "E": BASE_TS,
            "s": "BTCUSDT",
            "t": 12345,
            "p": "100.25",
            "q": "0.50000000",
            "T": BASE_TS,
            "m": True,
        },
    }
)

BOOK_TICKER_FRAME = json.dumps(
    {
        "stream": "btcusdt@bookTicker",
        "data": {
            "u": 400900217,
            "s": "BTCUSDT",
            "b": "100.00",
            "B": "10.00000000",
            "a": "100.50",
            "A": "12.00000000",
        },
    }
)

MALFORMED_FRAMES = (
    "{ this is not json",
    json.dumps({"stream": "btcusdt@depth@100ms", "data": {"e": "depthUpdate"}}),
    json.dumps(
        {
            "stream": "btcusdt@trade",
            "data": {"e": "trade", "s": "BTCUSDT", "p": 100.25, "q": "1", "t": 1},
        }
    ),
    json.dumps([1, 2, 3]),
)


# ----------------------------------------------------------------------
# Fakes
# ----------------------------------------------------------------------
class ScriptedHttp:
    """Serves exchangeInfo and depth snapshots from memory."""

    def __init__(self, *, snapshot_ids: list[int] | None = None) -> None:
        self.snapshot_ids = list(snapshot_ids or [100])
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.snapshot_failures = 0

    async def __call__(self, url: str, params: Mapping[str, Any]) -> Any:
        self.calls.append((url, dict(params)))
        if url.endswith("/api/v3/exchangeInfo"):
            return EXCHANGE_INFO
        if url.endswith("/api/v3/depth"):
            if self.snapshot_failures > 0:
                self.snapshot_failures -= 1
                raise ConnectionError("snapshot endpoint unavailable")
            index = min(len(self.snapshot_ids) - 1, self.depth_calls - 1)
            return depth_snapshot(self.snapshot_ids[index])
        raise AssertionError(f"Unexpected REST call to {url}")

    @property
    def depth_calls(self) -> int:
        return sum(1 for url, _ in self.calls if url.endswith("/api/v3/depth"))


class ScriptedTransport:
    """A websocket transport that replays frames, then behaves as instructed."""

    def __init__(self, frames: list[str], *, then: str = "hold") -> None:
        self.frames = list(frames)
        self.sent: list[str] = []
        self.closed = False
        self.then = then

    async def send(self, message: str) -> None:
        if self.closed:
            raise ConnectionClosed("closed")
        self.sent.append(message)

    async def receive(self) -> str:
        if self.frames:
            return self.frames.pop(0)
        if self.then == "drop":
            raise ConnectionClosed("the venue closed the connection")
        # Park forever; the test cancels the read loop by stopping the feed.
        await asyncio.sleep(3600)
        raise AssertionError("unreachable")

    async def close(self) -> None:
        self.closed = True


class ScriptedFactory:
    """Hands out one scripted transport per connection attempt."""

    def __init__(self, transports: list[ScriptedTransport]) -> None:
        self.transports = list(transports)
        self.urls: list[str] = []

    async def __call__(self, url: str) -> ScriptedTransport:
        self.urls.append(url)
        if not self.transports:
            # Keep the connection open but silent rather than failing: the
            # supervisor would otherwise spin through its backoff during a test.
            return ScriptedTransport([])
        return self.transports.pop(0)


def build_settings(**overrides: Any) -> TransportSettings:
    base: dict[str, Any] = {
        "symbols": ("BTC/USDT",),
        "ticker_enabled": True,
        "trades_enabled": True,
        "orderbook_enabled": True,
        "orderbook_snapshot_depth": 100,
        "reconnect_base_delay_ms": 10,
        "reconnect_max_delay_ms": 20,
        "reconnect_max_attempts": 3,
        "ws_heartbeat_interval_ms": 1_000,
        "ws_heartbeat_timeout_ms": 60_000,
        "orderbook_staleness_threshold_ms": 60_000,
    }
    base.update(overrides)
    return TransportSettings(**base)


def build_feed(
    http: ScriptedHttp,
    factory: ScriptedFactory,
    *,
    settings: TransportSettings | None = None,
    callbacks: FeedCallbacks | None = None,
) -> MarketDataFeed:
    resolved = settings or build_settings()
    adapter = BinanceMarketDataAdapter(http)
    return MarketDataFeed(adapter, resolved, factory, callbacks=callbacks)


async def settle(times: int = 8) -> None:
    """Yield to the loop enough times for the read and worker tasks to run."""
    for _ in range(times):
        await asyncio.sleep(0)


async def wait_until(
    predicate: Any, *, timeout: float = 5.0, interval: float = 0.005
) -> bool:
    """Poll until a predicate holds.

    Polling rather than a fixed number of loop iterations: the pipeline spans a
    read loop, a resync worker and a snapshot fetch, and counting yields to get
    from one to the other is exactly the kind of assumption that makes a test
    flaky on a loaded machine.
    """
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        if predicate():
            return True
        await asyncio.sleep(interval)
    return predicate()


# ======================================================================
# 17. Configured symbols
# ======================================================================
def test_case_17_configured_symbols_are_canonicalised_in_every_spelling() -> None:
    assert canonicalise_configured_symbol("BTC/USDT") == "BTC-USDT"
    assert canonicalise_configured_symbol("btc-usdt") == "BTC-USDT"
    assert canonicalise_configured_symbol("BTCUSDT") == "BTC-USDT"
    assert canonicalise_configured_symbol(" eth_usdt ") == "ETH-USDT"


def test_case_17b_symbols_are_validated_against_the_venue_listing() -> None:
    http = ScriptedHttp()
    factory = ScriptedFactory([ScriptedTransport([])])
    feed = build_feed(
        http, factory, settings=build_settings(symbols=("BTC/USDT", "ETHUSDT"))
    )

    async def scenario() -> tuple[str, ...]:
        await feed.start()
        try:
            return tuple(ref.symbol for ref in feed.symbols)
        finally:
            await feed.stop()

    assert run(scenario()) == ("BTC-USDT", "ETH-USDT")


def test_case_17c_an_unlisted_symbol_is_refused_at_startup() -> None:
    """A typo must fail loudly, not produce a socket that is silent forever."""
    http = ScriptedHttp()
    feed = build_feed(
        http,
        ScriptedFactory([]),
        settings=build_settings(symbols=("BTC/USDT", "NOPE/USDT")),
    )

    async def scenario() -> None:
        await feed.start()

    with pytest.raises(Exception) as caught:
        run(scenario())
    assert "NOPE" in str(caught.value)


# ======================================================================
# 18. Configured channels
# ======================================================================
def test_case_18_only_enabled_channels_are_subscribed() -> None:
    http = ScriptedHttp()
    factory = ScriptedFactory([ScriptedTransport([])])
    feed = build_feed(
        http,
        factory,
        settings=build_settings(
            symbols=("BTC/USDT",),
            ticker_enabled=False,
            trades_enabled=True,
            orderbook_enabled=True,
        ),
    )

    async def scenario() -> tuple[tuple[str, ...], str]:
        await feed.start()
        try:
            channels = tuple(
                subscription.channel.value for subscription in feed.subscriptions
            )
            return channels, factory.urls[0]
        finally:
            await feed.stop()

    channels, url = run(scenario())

    assert set(channels) == {"orderbook", "trades"}
    assert "bookticker" not in url.lower()
    assert "btcusdt@depth@100ms" in url
    assert "btcusdt@trade" in url
    assert url.startswith("wss://")


# ======================================================================
# 14/16/20. Pipeline: connect, receive, build a book, expose it
# ======================================================================
def test_case_14_frames_flow_through_parsers_into_the_book() -> None:
    http = ScriptedHttp(snapshot_ids=[100])
    transport = ScriptedTransport(
        [depth_frame(101, 105), TRADE_FRAME, BOOK_TICKER_FRAME]
    )
    tickers: list[Any] = []
    trades: list[Any] = []
    feed = build_feed(
        http,
        ScriptedFactory([transport]),
        callbacks=FeedCallbacks(
            on_ticker=tickers.append, on_trade=trades.append
        ),
    )

    async def scenario() -> dict[str, Any]:
        await feed.start()
        try:
            assert await wait_until(lambda: feed.is_tradeable("BTC-USDT"))
            await settle(10)
            synchroniser = feed.synchroniser("BTC-USDT")
            assert synchroniser is not None
            top = feed.book_top("BTC-USDT")
            return {
                "phase": synchroniser.phase,
                "top": top,
                "tradeable": feed.is_tradeable("BTC-USDT"),
                "health": feed.health(),
                "trade": feed.last_trade("BTC-USDT"),
                "ticker": feed.ticker("BTC-USDT"),
            }
        finally:
            await feed.stop()

    result = run(scenario())

    assert result["phase"] is SyncPhase.LIVE
    assert result["tradeable"] is True
    assert result["top"] is not None
    # The diff moved the best bid from 100.00 to 100.10.
    assert str(result["top"].best_bid) == "100.10"
    assert result["trade"] is not None
    assert result["trade"].aggressor_side.value == "SELL"
    assert result["ticker"] is not None
    assert len(tickers) == 1
    assert len(trades) == 1
    assert result["health"].status == "healthy"


# ======================================================================
# 15. Malformed exchange messages
# ======================================================================
def test_case_15_malformed_frames_neither_crash_nor_corrupt_the_book() -> None:
    http = ScriptedHttp(snapshot_ids=[100])
    frames = [depth_frame(101, 105), *MALFORMED_FRAMES, depth_frame(106, 110)]
    transport = ScriptedTransport(frames)
    feed = build_feed(http, ScriptedFactory([transport]))

    async def scenario() -> dict[str, Any]:
        await feed.start()
        try:
            synchroniser = feed.synchroniser("BTC-USDT")
            assert synchroniser is not None
            assert await wait_until(lambda: synchroniser.book.sequence == 110)
            return {
                "phase": synchroniser.phase,
                "sequence": synchroniser.book.sequence,
                "health": feed.health(),
                "applied": synchroniser.statistics.deltas_applied,
            }
        finally:
            await feed.stop()

    result = run(scenario())

    # Both good diffs applied; the four bad frames were counted and dropped.
    assert result["phase"] is SyncPhase.LIVE
    assert result["sequence"] == 110
    assert result["applied"] == 2
    assert result["health"].parse_errors >= 3
    assert result["health"].status == "healthy"


# ======================================================================
# 8/9/16. Reconnect, subscription restoration, resync
# ======================================================================
def test_case_08_09_16_reconnect_restores_subscriptions_and_resyncs_the_book() -> None:
    http = ScriptedHttp(snapshot_ids=[100, 200])
    first = ScriptedTransport([depth_frame(101, 105)], then="drop")
    second = ScriptedTransport([depth_frame(201, 205)])
    factory = ScriptedFactory([first, second])
    resyncs: list[tuple[str, str]] = []
    states: list[tuple[str, str]] = []
    feed = build_feed(
        http,
        factory,
        callbacks=FeedCallbacks(
            on_resync=lambda symbol, reason: resyncs.append((symbol, reason)),
            on_state_change=lambda a, b: states.append((a.value, b.value)),
        ),
    )

    async def scenario() -> dict[str, Any]:
        await feed.start()
        try:
            synchroniser = feed.synchroniser("BTC-USDT")
            assert synchroniser is not None
            # The first socket drops after one frame; the supervisor reconnects
            # and the book must be rebuilt from the second snapshot.
            assert await wait_until(lambda: synchroniser.book.sequence == 205)
            assert await wait_until(
                lambda: feed.connection is not None
                and feed.connection.state is ConnectionState.CONNECTED
            )
            await settle(10)
            manager = feed.connection
            assert manager is not None
            return {
                "reconnects": manager.reconnect_count,
                "phase": synchroniser.phase,
                "sequence": synchroniser.book.sequence,
                "snapshots": http.depth_calls,
                "resyncs": list(resyncs),
                "states": list(states),
                "subscription_statuses": {
                    subscription.stream_name: subscription.status
                    for subscription in manager.subscriptions.all()
                },
                "second_socket_frames": list(second.sent),
                "health": feed.health(),
            }
        finally:
            await feed.stop()

    result = run(scenario())

    # The existing state machine drove the reconnection: the reader observed
    # the close and moved to DISCONNECTED, and the supervisor's reconnect() —
    # not a fresh connect() — brought it back. reconnect_count is the
    # authoritative signal that the reconnect path ran.
    assert result["reconnects"] >= 1
    assert ("CONNECTED", "DISCONNECTED") in result["states"]
    assert ("CONNECTING", "CONNECTED") in result["states"]
    assert result["states"].count(("CONNECTING", "CONNECTED")) == 2

    # Subscriptions were replayed through the existing subscription manager:
    # every stream was demoted to PENDING on the new socket and re-sent in one
    # batched SUBSCRIBE frame.
    restored = json.loads(result["second_socket_frames"][0])
    assert restored["method"] == "SUBSCRIBE"
    assert set(restored["params"]) == {
        "btcusdt@depth@100ms",
        "btcusdt@trade",
        "btcusdt@bookTicker",
    }
    statuses = result["subscription_statuses"]
    # Only the depth stream sent data on the second socket, and a subscription
    # is only ACTIVE once the venue actually delivers it — a re-sent frame is
    # not evidence on its own.
    assert statuses["btcusdt@depth@100ms"] is SubscriptionStatus.ACTIVE
    assert statuses["btcusdt@trade"] is SubscriptionStatus.PENDING
    assert not any(
        status is SubscriptionStatus.FAILED for status in statuses.values()
    )

    # The book was rebuilt from a fresh snapshot rather than carried across.
    assert result["snapshots"] == 2
    assert result["phase"] is SyncPhase.LIVE
    assert result["sequence"] == 205
    assert any(
        "CONNECTED" in reason for _symbol, reason in result["resyncs"]
    ), result["resyncs"]


def test_case_16b_a_book_is_never_tradeable_while_the_socket_is_down() -> None:
    """The dangerous case: a book that is internally consistent but orphaned."""
    http = ScriptedHttp(snapshot_ids=[100])
    transport = ScriptedTransport([depth_frame(101, 105)])
    feed = build_feed(http, ScriptedFactory([transport]))

    async def scenario() -> dict[str, Any]:
        await feed.start()
        try:
            assert await wait_until(lambda: feed.is_tradeable("BTC-USDT"))
            before = feed.is_tradeable("BTC-USDT")
            synchroniser = feed.synchroniser("BTC-USDT")
            assert synchroniser is not None

            # Simulate the state machine leaving CONNECTED.
            feed._on_state_change(  # noqa: SLF001 - exercising the callback
                ConnectionState.CONNECTED, ConnectionState.RECONNECTING
            )
            return {
                "before": before,
                "after": feed.is_tradeable("BTC-USDT"),
                "top_after": feed.book_top("BTC-USDT"),
                "health": feed.health(),
            }
        finally:
            await feed.stop()

    result = run(scenario())

    assert result["before"] is True
    assert result["after"] is False
    assert result["top_after"] is None
    assert result["health"].status in ("disconnected", "degraded")


def test_case_16c_a_sequence_gap_triggers_a_resync_through_the_synchroniser() -> None:
    http = ScriptedHttp(snapshot_ids=[100, 300])
    # 201 does not continue from 105, so the book must be rebuilt.
    transport = ScriptedTransport([depth_frame(101, 105), depth_frame(201, 205)])
    feed = build_feed(http, ScriptedFactory([transport]))

    async def scenario() -> dict[str, Any]:
        await feed.start()
        try:
            synchroniser = feed.synchroniser("BTC-USDT")
            assert synchroniser is not None
            assert await wait_until(
                lambda: synchroniser.statistics.gaps_detected >= 1
                and http.depth_calls >= 2
            )
            return {
                "gaps": synchroniser.statistics.gaps_detected,
                "resyncs": synchroniser.statistics.resyncs,
                "snapshots": http.depth_calls,
                "transport_metrics": feed.metrics.transport_totals(),
            }
        finally:
            await feed.stop()

    result = run(scenario())

    assert result["gaps"] == 1
    assert result["resyncs"] >= 1
    assert result["snapshots"] >= 2
    assert result["transport_metrics"]["bookResyncs"] >= 1
    assert result["transport_metrics"]["snapshotRequests"] >= 2


# ======================================================================
# 14b. Clean shutdown
# ======================================================================
def test_case_14b_shutdown_unsubscribes_closes_and_leaves_no_tasks() -> None:
    http = ScriptedHttp(snapshot_ids=[100])
    transport = ScriptedTransport([depth_frame(101, 105)])
    feed = build_feed(http, ScriptedFactory([transport]))

    async def scenario() -> dict[str, Any]:
        await feed.start()
        assert await wait_until(lambda: feed.is_tradeable("BTC-USDT"))
        before = len(asyncio.all_tasks())
        await feed.stop()
        await settle(4)
        return {
            "before_tasks": before,
            "after_tasks": len(asyncio.all_tasks()),
            "sent": list(transport.sent),
            "closed": transport.closed,
            "running": feed.is_running,
            "health": feed.health(),
        }

    result = run(scenario())

    assert result["running"] is False
    assert result["closed"] is True
    assert any("UNSUBSCRIBE" in frame for frame in result["sent"])
    # Only the scenario task itself should remain.
    assert result["after_tasks"] == 1
    assert result["after_tasks"] < result["before_tasks"]
    assert result["health"].status == "stopped"


def test_stop_is_idempotent() -> None:
    http = ScriptedHttp(snapshot_ids=[100])
    feed = build_feed(http, ScriptedFactory([ScriptedTransport([])]))

    async def scenario() -> None:
        await feed.start()
        await settle(10)
        await feed.stop()
        await feed.stop()
        assert feed.is_running is False

    run(scenario())


# ======================================================================
# Health reporting
# ======================================================================
def test_health_distinguishes_connected_fresh_stale_and_disconnected() -> None:
    http = ScriptedHttp(snapshot_ids=[100])
    transport = ScriptedTransport([depth_frame(101, 105), TRADE_FRAME])
    feed = build_feed(
        http,
        ScriptedFactory([transport]),
        # A one-millisecond threshold makes every stream stale almost at once.
        settings=build_settings(orderbook_staleness_threshold_ms=1),
    )

    async def scenario() -> dict[str, Any]:
        await feed.start()
        try:
            assert await wait_until(lambda: feed.health().messages_received >= 2)
            fresh = feed.health()
            await asyncio.sleep(0.02)
            feed._staleness.evaluate()  # noqa: SLF001 - the worker's cadence is 1s
            stale = feed.health()
            return {"fresh": fresh, "stale": stale}
        finally:
            await feed.stop()

    result = run(scenario())
    fresh = result["fresh"]
    stale = result["stale"]

    assert fresh.connected is True and fresh.fresh is True
    assert fresh.status == "healthy"

    # Connected but stale is its own state: the socket is fine and the data is
    # not, which is the case an operator most needs to see.
    assert stale.connected is True
    assert stale.fresh is False
    assert stale.status == "degraded"
    assert stale.stale_streams

    rendered = stale.to_dict()
    assert rendered["state"] == ConnectionState.CONNECTED.value
    assert rendered["status"] == "degraded"


def test_health_before_start_reports_disconnected() -> None:
    feed = build_feed(ScriptedHttp(), ScriptedFactory([]))
    health = feed.health()

    assert health.state is ConnectionState.DISCONNECTED
    assert health.connected is False
    assert health.running is False
    assert health.status == "stopped"


# ======================================================================
# 19b. No credentials on the feed path
# ======================================================================
def test_no_rest_call_carries_a_signature_or_api_key() -> None:
    http = ScriptedHttp(snapshot_ids=[100])
    transport = ScriptedTransport([depth_frame(101, 105)])
    feed = build_feed(http, ScriptedFactory([transport]))

    async def scenario() -> None:
        await feed.start()
        await wait_until(lambda: http.depth_calls >= 1)
        await feed.stop()

    run(scenario())

    assert http.calls, "the feed made no REST calls"
    for url, params in http.calls:
        assert "signature" not in url.lower()
        for key in params:
            assert key.lower() not in ("signature", "apikey", "recvwindow")


def test_snapshot_failures_are_retried_and_counted() -> None:
    """A snapshot outage must not leave a half-built book marked tradeable."""
    http = ScriptedHttp(snapshot_ids=[100])
    http.snapshot_failures = 1
    transport = ScriptedTransport([depth_frame(101, 105)])
    feed = build_feed(http, ScriptedFactory([transport]))

    async def scenario() -> dict[str, Any]:
        await feed.start()
        try:
            for _ in range(80):
                await asyncio.sleep(0.01)
                if feed.is_tradeable("BTC-USDT"):
                    break
            return {
                "tradeable": feed.is_tradeable("BTC-USDT"),
                "totals": feed.metrics.transport_totals(),
            }
        finally:
            await feed.stop()

    result = run(scenario())

    assert result["tradeable"] is True
    assert result["totals"]["snapshotFailures"] == 1
    assert result["totals"]["snapshotRequests"] >= 2


def test_transport_metrics_never_claim_a_latency_guarantee() -> None:
    http = ScriptedHttp(snapshot_ids=[100])
    transport = ScriptedTransport([depth_frame(101, 105), TRADE_FRAME])
    feed = build_feed(http, ScriptedFactory([transport]))

    async def scenario() -> dict[str, Any]:
        await feed.start()
        try:
            assert await wait_until(
                lambda: feed.metrics.transport_totals()["framesReceived"] >= 2
            )
            return feed.metrics.to_dict()
        finally:
            await feed.stop()

    snapshot = run(scenario())
    rendered = str(snapshot).lower()

    for forbidden in ("guarantee", "guaranteed", "sub-millisecond"):
        assert forbidden not in rendered
    assert "observed" in snapshot
    assert snapshot["transports"]
    counters = snapshot["transports"][0]["counters"]
    assert counters["framesReceived"] >= 2
    assert counters["bytesReceived"] > 0
    assert counters["connectionAttempts"] >= 1
    assert counters["connectionSuccesses"] >= 1


def test_feed_uses_the_binance_adapter_without_any_credential_parameter() -> None:
    """The adapter cannot be given a key even by mistake."""
    import inspect

    parameters = inspect.signature(BinanceMarketDataAdapter.__init__).parameters
    for name in parameters:
        assert name not in ("api_key", "api_secret", "secret", "credentials")
    assert ExchangeId.BINANCE.value == "binance"
    assert MarketDataChannel.ORDER_BOOK.value == "orderbook"
```

### FILE: scripts/live_market_data_smoke_test.py

```python
#!/usr/bin/env python3
"""LIVE MARKET DATA SMOKE TEST — connects to a real exchange.

This is **not** part of the normal test suite and is never run by CI by
default. ``pytest`` needs no internet, no credentials, no database and no
Redis; this script needs outbound internet to Binance's public endpoints.

What it does
------------
Opens the real public websocket streams and the real public REST depth
endpoint, runs the full Part 3 pipeline for a configurable number of seconds,
verifies that normalised events actually arrive and that the order book reaches
a tradeable state, then shuts down cleanly.

What it does not do
-------------------
It sends no credentials, signs no request and submits no order. Live order
execution is not implemented on this path at all. The only endpoints touched
are public market data.

Usage
-----
    python scripts/live_market_data_smoke_test.py
    python scripts/live_market_data_smoke_test.py --duration 60 --symbols BTC/USDT

Exit codes: 0 all checks passed, 1 a check failed, 2 bad configuration.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from decimal import Decimal
from pathlib import Path
from typing import Any

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
TRADING_CORE = REPOSITORY_ROOT / "libs" / "trading-core"
if str(TRADING_CORE) not in sys.path:
    sys.path.insert(0, str(TRADING_CORE))

try:
    from wlct_trading.market_data import PublicTrade, Ticker
    from wlct_trading.net.config import InvalidTransportSettings, TransportSettings
    from wlct_trading.net.feed import FeedCallbacks
    from wlct_trading.net.runner import MarketDataRunner, configure_logging
except ImportError as exc:  # pragma: no cover - depends on install
    print(f"Cannot import the live transport: {exc}", file=sys.stderr)
    print(
        "Install the optional dependencies first:\n"
        "  pip install -e 'libs/trading-core[live]'",
        file=sys.stderr,
    )
    raise SystemExit(2) from exc


#: Credential-shaped variables that must not influence this run. Public market
#: data needs none, and a smoke test that quietly picked one up would be
#: proving the wrong thing.
CREDENTIAL_ENVIRONMENT_KEYS = (
    "BINANCE_API_KEY",
    "BINANCE_API_SECRET",
    "EXCHANGE_API_KEY",
    "EXCHANGE_API_SECRET",
)


class Checks:
    """Collects pass/fail results so every check is reported, not just the first."""

    def __init__(self) -> None:
        self.results: list[tuple[bool, str, str]] = []

    def record(self, passed: bool, name: str, detail: str = "") -> None:
        self.results.append((passed, name, detail))

    @property
    def failed(self) -> int:
        return sum(1 for passed, _n, _d in self.results if not passed)

    def report(self) -> None:
        print("\n" + "=" * 72)
        print("LIVE MARKET DATA SMOKE TEST RESULTS")
        print("=" * 72)
        for passed, name, detail in self.results:
            mark = "PASS" if passed else "FAIL"
            line = f"  [{mark}] {name}"
            if detail:
                line += f" — {detail}"
            print(line)
        total = len(self.results)
        print("-" * 72)
        print(f"  {total - self.failed}/{total} checks passed")
        print("=" * 72)


async def smoke_test(settings: TransportSettings, duration: float) -> int:
    tickers: list[Ticker] = []
    trades: list[PublicTrade] = []
    book_updates: list[str] = []
    resyncs: list[tuple[str, str]] = []

    runner = MarketDataRunner(
        settings,
        callbacks=FeedCallbacks(
            on_ticker=tickers.append,
            on_trade=trades.append,
            on_book_update=lambda symbol, _top: book_updates.append(symbol),
            on_resync=lambda symbol, reason: resyncs.append((symbol, reason)),
        ),
    )
    runner.install_signal_handlers(asyncio.get_running_loop())

    print(f"Connecting to {settings.binance_ws_url} for {duration:.0f}s ...")
    print(f"Symbols: {', '.join(settings.symbols)}")
    print(f"Channels: {', '.join(c.value for c in settings.enabled_channels)}")
    print("No API credentials are used and no orders are submitted.\n")

    health = await runner.run(duration_seconds=duration)
    feed = runner.feed
    checks = Checks()

    # 1. The connection was established through the existing state machine.
    checks.record(
        health.messages_received > 0,
        "Received live frames from the venue",
        f"{health.messages_received} messages",
    )

    # 2. Normalised events, not raw payloads.
    if settings.ticker_enabled:
        sane_ticker = any(
            t.bid_price is not None
            and t.ask_price is not None
            and Decimal(str(t.bid_price)) > 0
            and Decimal(str(t.ask_price)) > Decimal(str(t.bid_price))
            for t in tickers
        )
        # any() over an empty list is False, so this also covers "no tickers".
        checks.record(
            bool(tickers) and sane_ticker,
            "Normalised tickers with a sane spread",
            f"{len(tickers)} tickers",
        )

    if settings.trades_enabled:
        sane_trade = all(
            Decimal(str(t.price)) > 0 and Decimal(str(t.quantity)) >= 0
            for t in trades
        )
        checks.record(
            bool(trades) and sane_trade,
            "Normalised public trades with positive prices",
            f"{len(trades)} trades",
        )

    # 3. The order book synchronised through the existing synchroniser.
    if settings.orderbook_enabled:
        tradeable = health.tradeable_symbols
        checks.record(
            bool(tradeable),
            "Order book reached a tradeable state",
            f"tradeable: {', '.join(tradeable) or 'none'}",
        )
        for symbol in settings.symbols:
            canonical = symbol.strip().upper().replace("/", "-")
            synchroniser = feed.synchroniser(canonical)
            if synchroniser is None:
                continue
            book = synchroniser.book
            top = book.top()
            # An empty book yields a top with no sides, so both must be checked
            # for presence before they can be compared.
            has_both_sides = (
                top is not None
                and top.best_bid is not None
                and top.best_ask is not None
            )
            checks.record(
                bool(has_both_sides) and top.best_bid < top.best_ask,
                f"{canonical} book is not crossed",
                (
                    f"bid {top.best_bid} / ask {top.best_ask}"
                    if has_both_sides
                    else "no two-sided top of book"
                ),
            )
            checks.record(
                synchroniser.statistics.snapshots_fetched > 0,
                f"{canonical} fetched a REST snapshot",
                f"{synchroniser.statistics.snapshots_fetched} snapshot(s)",
            )

    # 4. Bad data did not accumulate.
    checks.record(
        health.parse_errors == 0,
        "No malformed frames were received",
        f"{health.parse_errors} parse errors",
    )

    # 5. Health reporting distinguishes the three states.
    checks.record(
        health.status in ("healthy", "degraded", "disconnected", "stopped"),
        "Health reported a defined status",
        f"status={health.status}, state={health.state.value}",
    )

    # 6. Clean shutdown.
    checks.record(
        feed.is_running is False,
        "Feed shut down cleanly",
        "no residual connection",
    )

    # 7. Nothing on this path could have used a credential.
    leaked = [key for key in CREDENTIAL_ENVIRONMENT_KEYS if os.environ.get(key)]
    checks.record(
        True,
        "No credentials required for public market data",
        (
            f"ignored credential variables present in the environment: "
            f"{', '.join(leaked)}"
            if leaked
            else "no credential variables were read"
        ),
    )

    totals = runner.metrics.transport_totals()
    print("\nTransport counters (observed on this run, not a guarantee):")
    for key, value in totals.items():
        print(f"  {key}: {value}")
    if resyncs:
        print(f"\nBook resyncs during the run: {len(resyncs)}")
        for symbol, reason in resyncs[:5]:
            print(f"  {symbol}: {reason}")

    checks.report()
    return 1 if checks.failed else 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Live smoke test against public exchange market data. Requires "
            "internet access. Uses no credentials and submits no orders."
        )
    )
    parser.add_argument(
        "--duration",
        type=float,
        default=None,
        help=(
            "Seconds to run (default: "
            "LIVE_MARKET_DATA_SMOKE_TEST_DURATION_SECONDS, or 30)."
        ),
    )
    parser.add_argument(
        "--symbols",
        type=str,
        default=None,
        help="Comma-separated symbols, overriding MARKET_DATA_SYMBOLS.",
    )
    parser.add_argument(
        "--log-level", type=str, default="WARNING", help="Logging level."
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    configure_logging(args.log_level, structured=False)

    environment = dict(os.environ)
    if args.symbols:
        environment["MARKET_DATA_SYMBOLS"] = args.symbols

    try:
        settings = TransportSettings.from_env(environment)
    except InvalidTransportSettings as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        return 2

    duration = (
        args.duration
        if args.duration is not None
        else float(settings.smoke_test_duration_seconds)
    )

    try:
        return asyncio.run(smoke_test(settings, duration))
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        return 130
    except Exception as exc:  # noqa: BLE001 - top-level reporting
        print(f"\nSmoke test failed with an unexpected error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
```


## B3. Modified files — library

### FILE: libs/trading-core/pyproject.toml

```toml
[build-system]
requires = ["setuptools>=69", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "wlct-trading-core"
version = "0.5.0"
description = "Shared trading data-plane domain library for the WLCT platform"
requires-python = ">=3.11"
# The core library has no runtime dependencies and must keep it that way: it is
# imported by every data-plane service, and a dependency here is a dependency
# everywhere. The live network transport is an opt-in extra.
dependencies = []

[project.optional-dependencies]
# Production network transport (wlct_trading.net). Only the market-data service
# and the live smoke test install this.
#
# httpx rather than aiohttp: services/market-data already depends on httpx and
# uses it in app/services/providers.py. Two async HTTP stacks in one process
# would mean two connection pools and two sets of timeout semantics for no
# capability that is missing.
live = [
  "websockets>=13.1,<18",
  "httpx>=0.27,<0.29",
]
dev = [
  "pytest>=8.0",
  "mypy>=1.8",
  "ruff>=0.3",
]

[tool.setuptools.packages.find]
include = ["wlct_trading*"]

[tool.pytest.ini_options]
testpaths = ["tests"]
# No asyncio plugin is required: the handful of coroutine calls in the test
# suite are driven explicitly with asyncio.run(), which keeps the library's
# test dependencies to pytest alone.
#
# Every test in tests/ is hermetic: no internet, no credentials, no database,
# no Redis. The live smoke test is a separate script, not a test, precisely so
# that it cannot be picked up by a bare `pytest` run.
markers = [
  "live: touches a real exchange endpoint; never collected by default",
]
addopts = "-m 'not live'"

[tool.mypy]
python_version = "3.11"
strict = true
warn_unreachable = true

[tool.ruff]
line-length = 100
target-version = "py311"
```

### FILE: libs/trading-core/wlct_trading/__init__.py

```python
"""wlct-trading-core: the shared trading data-plane library.

One implementation of the order book, the OMS state machine, the risk engine
and the position tracker, imported by every data-plane service
(``market-data``, ``trading-engine``, ``execution-engine``). Keeping these in a
library rather than copying them into each service is what guarantees that the
risk rules enforced at signal time are byte-for-byte the rules enforced at
submission time.

The library has zero runtime dependencies and opens no sockets, reads no
configuration and touches no database. The connectivity layer added in
:mod:`wlct_trading.transport` and :mod:`wlct_trading.exchanges` describes *how*
to talk to a venue - framing, sequencing, backoff, rate budgets - but the actual
socket and HTTP calls are injected by the host service. That is what keeps the
whole package installable and exhaustively testable on a machine with no
network, no broker and no database.

The concrete implementations of those injected calls live in
:mod:`wlct_trading.net`, an optional subpackage installed with the ``live``
extra. Nothing here imports it, deliberately: importing this module must never
pull in a network client. ``wlct_trading.net`` handles **public market data
only** - it holds no credentials and submits no orders.

Authenticated trading lives in :mod:`wlct_trading.execution`, added in Part 5.
It is likewise not imported here. That is not an accident of layout: a service
that only needs market data should not be able to reach a module capable of
signing an order, and an explicit ``from wlct_trading.execution import ...`` is
a visible, greppable declaration that a component is in the money path.
"""

from wlct_trading.clock import (
    LatencyRecorder,
    LatencySpan,
    epoch_micros,
    epoch_millis,
    monotonic_nanos,
)
from wlct_trading.enums import (
    OPEN_ORDER_STATUSES,
    TERMINAL_ORDER_STATUSES,
    ExchangeId,
    KillSwitchScope,
    MarketType,
    OrderBookHealth,
    OrderSide,
    OrderStatus,
    OrderType,
    PositionSide,
    RiskDecisionCode,
    SignalAction,
    TimeInForce,
    TradingEventType,
    TradingMode,
)
from wlct_trading.events import EventBus, InMemoryEventBus, TradingEvent
from wlct_trading.idempotency import (
    DuplicateOrderGuard,
    build_client_order_id,
    intent_fingerprint,
)
from wlct_trading.exchanges import (
    ExchangeCapabilities,
    ExchangeRegistration,
    ExchangeRegistry,
    SymbolMapping,
    SymbolRegistry,
    UnsupportedExchange,
    build_default_registry,
    to_canonical,
)
from wlct_trading.market_data import (
    BookTop,
    Candle,
    OrderBookDelta,
    OrderBookSnapshot,
    PriceLevel,
    PublicTrade,
    SymbolRef,
    Ticker,
)
from wlct_trading.metrics import (
    EXECUTION_STAGES,
    ConnectivityMetrics,
    ExecutionCounters,
    ExecutionMetrics,
    LatencyHistogram,
    StreamMetrics,
)
from wlct_trading.order_book import BookApplyResult, DepthView, OrderBook
from wlct_trading.orderbook_sync import (
    OrderBookSynchroniser,
    SyncConfig,
    SyncOutcome,
    SyncPhase,
)
from wlct_trading.orders import (
    ORDER_STATE_TRANSITIONS,
    Fill,
    InvalidOrderTransition,
    Order,
    OrderEvent,
    OrderIntent,
    is_legal_transition,
)
from wlct_trading.positions import Position, PositionManager, PositionUpdate
from wlct_trading.redis_keys import TRADING_STREAM, RedisKeys
from wlct_trading.risk import (
    KillSwitchState,
    RiskDecision,
    RiskEngine,
    RiskLimits,
    RiskSnapshot,
    RiskViolation,
    TradingModeResolver,
)
from wlct_trading.transport import (
    BackoffConfig,
    ConnectionCallbacks,
    ConnectionConfig,
    ConnectionHealth,
    ConnectionState,
    ExchangeErrorCategory,
    ExponentialBackoff,
    MarketDataChannel,
    NormalisedExchangeError,
    RateLimitRegistry,
    RateLimitRule,
    StalenessMonitor,
    StalenessThresholds,
    Subscription,
    SubscriptionManager,
    SubscriptionStatus,
    WebSocketConnectionManager,
    WebSocketTransport,
)
from wlct_trading.signals import (
    BaseStrategy,
    Signal,
    SignalValidationError,
    StrategyDescriptor,
    StrategyRiskProfile,
    signal_to_intent,
)

__version__ = "0.5.0"

__all__ = [
    "__version__",
    "BackoffConfig",
    "BaseStrategy",
    "BookApplyResult",
    "BookTop",
    "build_client_order_id",
    "build_default_registry",
    "Candle",
    "ConnectionCallbacks",
    "ConnectionConfig",
    "ConnectionHealth",
    "ConnectionState",
    "ConnectivityMetrics",
    "EXECUTION_STAGES",
    "ExecutionCounters",
    "ExecutionMetrics",
    "DepthView",
    "DuplicateOrderGuard",
    "epoch_micros",
    "epoch_millis",
    "EventBus",
    "ExchangeCapabilities",
    "ExchangeErrorCategory",
    "ExchangeId",
    "ExchangeRegistration",
    "ExchangeRegistry",
    "ExponentialBackoff",
    "Fill",
    "InMemoryEventBus",
    "intent_fingerprint",
    "InvalidOrderTransition",
    "is_legal_transition",
    "KillSwitchScope",
    "KillSwitchState",
    "LatencyHistogram",
    "LatencyRecorder",
    "LatencySpan",
    "MarketDataChannel",
    "MarketType",
    "monotonic_nanos",
    "NormalisedExchangeError",
    "OPEN_ORDER_STATUSES",
    "Order",
    "ORDER_STATE_TRANSITIONS",
    "OrderBook",
    "OrderBookDelta",
    "OrderBookHealth",
    "OrderBookSnapshot",
    "OrderBookSynchroniser",
    "OrderEvent",
    "OrderIntent",
    "OrderSide",
    "OrderStatus",
    "OrderType",
    "Position",
    "PositionManager",
    "PositionSide",
    "PositionUpdate",
    "PriceLevel",
    "PublicTrade",
    "RateLimitRegistry",
    "RateLimitRule",
    "RedisKeys",
    "RiskDecision",
    "RiskDecisionCode",
    "RiskEngine",
    "RiskLimits",
    "RiskSnapshot",
    "RiskViolation",
    "Signal",
    "signal_to_intent",
    "SignalAction",
    "SignalValidationError",
    "StalenessMonitor",
    "StalenessThresholds",
    "StrategyDescriptor",
    "StrategyRiskProfile",
    "StreamMetrics",
    "Subscription",
    "SubscriptionManager",
    "SubscriptionStatus",
    "SymbolMapping",
    "SymbolRef",
    "SymbolRegistry",
    "SyncConfig",
    "SyncOutcome",
    "SyncPhase",
    "TERMINAL_ORDER_STATUSES",
    "Ticker",
    "TimeInForce",
    "to_canonical",
    "TRADING_STREAM",
    "TradingEvent",
    "TradingEventType",
    "TradingMode",
    "TradingModeResolver",
    "UnsupportedExchange",
    "WebSocketConnectionManager",
    "WebSocketTransport",
]
```

### FILE: libs/trading-core/wlct_trading/metrics.py

```python
"""Latency and throughput instrumentation for the connectivity layer.

What is measured, precisely
---------------------------
Three different things get called "latency" and conflating them makes the
numbers meaningless, so they are separate metrics here:

* **feed lag** — venue event timestamp to local receipt. Includes the venue's
  own publishing delay, the network, and clock skew between the two machines.
  Useful as a trend; not a precise measurement, because the two clocks are not
  synchronised. Treated and documented as an estimate.
* **processing latency** — receipt to the point the update is applied and
  visible to a strategy. Measured entirely on one clock, so this one is exact.
* **end-to-end latency** — venue timestamp to strategy visibility. Carries the
  same clock-skew caveat as feed lag.

Honesty about clocks matters. A feed-lag figure computed across two unsynchro-
nised clocks can legitimately come out negative, and this module reports that
rather than clamping it to zero and pretending the data is clean.

No performance guarantees are expressed or implied by anything here. These are
observations of what happened, not commitments about what will.
"""

from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, field

from wlct_trading.clock import epoch_micros

__all__ = [
    "LatencyHistogram",
    "CounterSet",
    "TransportCounters",
    "TransportMetrics",
    "StreamMetrics",
    "ConnectivityMetrics",
    "EXECUTION_STAGES",
    "ExecutionCounters",
    "ExecutionMetrics",
]

#: Bucket upper bounds in microseconds: 100µs to ~10s. Fixed buckets keep memory
#: constant regardless of message volume, which a growing list would not.
_DEFAULT_BUCKET_BOUNDS_MICROS: tuple[int, ...] = (
    100,
    250,
    500,
    1_000,
    2_500,
    5_000,
    10_000,
    25_000,
    50_000,
    100_000,
    250_000,
    500_000,
    1_000_000,
    2_500_000,
    5_000_000,
    10_000_000,
)


class LatencyHistogram:
    """Bucketed latency distribution with a bounded recent-sample window.

    Two structures on purpose. The histogram is cumulative and cheap, giving
    exact counts per bucket over all time. The recent window holds the last N
    raw samples so percentiles reflect current conditions rather than being
    dragged around by an hour-old incident — a p99 that includes yesterday's
    outage tells an operator nothing about right now.
    """

    __slots__ = ("_bounds", "_buckets", "_overflow", "_count", "_sum", "_min", "_max", "_recent")

    def __init__(
        self,
        *,
        bounds: tuple[int, ...] = _DEFAULT_BUCKET_BOUNDS_MICROS,
        window: int = 1_024,
    ) -> None:
        if window <= 0:
            raise ValueError("window must be positive.")
        self._bounds = bounds
        self._buckets = [0] * len(bounds)
        self._overflow = 0
        self._count = 0
        self._sum = 0
        self._min: int | None = None
        self._max: int | None = None
        self._recent: deque[int] = deque(maxlen=window)

    def observe(self, value_micros: int) -> None:
        """Record one measurement. Negative values are kept, not clamped."""
        self._count += 1
        self._sum += value_micros
        self._recent.append(value_micros)
        if self._min is None or value_micros < self._min:
            self._min = value_micros
        if self._max is None or value_micros > self._max:
            self._max = value_micros

        for index, bound in enumerate(self._bounds):
            if value_micros <= bound:
                self._buckets[index] += 1
                return
        self._overflow += 1

    @property
    def count(self) -> int:
        return self._count

    @property
    def mean_micros(self) -> float | None:
        if self._count == 0:
            return None
        return self._sum / self._count

    @property
    def min_micros(self) -> int | None:
        return self._min

    @property
    def max_micros(self) -> int | None:
        return self._max

    def percentile(self, fraction: float) -> int | None:
        """Percentile over the recent window, by nearest-rank.

        ``None`` when nothing has been observed — an honest absence rather than
        a zero that reads like a very fast measurement.
        """
        if not 0.0 < fraction <= 1.0:
            raise ValueError("fraction must be in (0, 1].")
        if not self._recent:
            return None
        ordered = sorted(self._recent)
        rank = max(1, math.ceil(fraction * len(ordered)))
        return ordered[rank - 1]

    def to_dict(self) -> dict[str, object]:
        return {
            "count": self._count,
            "meanMicros": self.mean_micros,
            "minMicros": self._min,
            "maxMicros": self._max,
            "p50Micros": self.percentile(0.50),
            "p95Micros": self.percentile(0.95),
            "p99Micros": self.percentile(0.99),
            "windowSize": len(self._recent),
            "buckets": {
                f"<={bound}": self._buckets[index]
                for index, bound in enumerate(self._bounds)
            },
            "overflow": self._overflow,
        }

    def reset(self) -> None:
        self._buckets = [0] * len(self._bounds)
        self._overflow = 0
        self._count = 0
        self._sum = 0
        self._min = None
        self._max = None
        self._recent.clear()


@dataclass(slots=True)
class CounterSet:
    """Monotonic event counters for one stream."""

    messages: int = 0
    parse_errors: int = 0
    dropped: int = 0
    gaps: int = 0
    resyncs: int = 0
    stale_transitions: int = 0
    reconnects: int = 0
    subscription_failures: int = 0

    def to_dict(self) -> dict[str, int]:
        return {
            "messages": self.messages,
            "parseErrors": self.parse_errors,
            "dropped": self.dropped,
            "gaps": self.gaps,
            "resyncs": self.resyncs,
            "staleTransitions": self.stale_transitions,
            "reconnects": self.reconnects,
            "subscriptionFailures": self.subscription_failures,
        }


@dataclass(slots=True)
class TransportCounters:
    """Connection-level counters for one venue connection.

    Separate from :class:`CounterSet` because these describe the socket, not a
    stream: a single connection carries many streams, and attributing a
    disconnect to one arbitrary symbol would make both numbers wrong.
    """

    connection_attempts: int = 0
    connection_successes: int = 0
    connection_failures: int = 0
    disconnects: int = 0
    reconnects: int = 0
    frames_received: int = 0
    bytes_received: int = 0
    frames_sent: int = 0
    parse_errors: int = 0
    heartbeat_failures: int = 0
    snapshot_requests: int = 0
    snapshot_failures: int = 0
    book_resyncs: int = 0

    def to_dict(self) -> dict[str, int]:
        return {
            "connectionAttempts": self.connection_attempts,
            "connectionSuccesses": self.connection_successes,
            "connectionFailures": self.connection_failures,
            "disconnects": self.disconnects,
            "reconnects": self.reconnects,
            "framesReceived": self.frames_received,
            "bytesReceived": self.bytes_received,
            "framesSent": self.frames_sent,
            "parseErrors": self.parse_errors,
            "heartbeatFailures": self.heartbeat_failures,
            "snapshotRequests": self.snapshot_requests,
            "snapshotFailures": self.snapshot_failures,
            "bookResyncs": self.book_resyncs,
        }


@dataclass(slots=True)
class TransportMetrics:
    """Transport counters plus the REST snapshot latency distribution.

    Snapshot latency is measured entirely on the local clock — request sent to
    response parsed — so unlike feed lag it carries no clock-skew caveat. It
    still says nothing about the venue's internal processing time, and nothing
    here should be read as a service-level commitment.
    """

    exchange: str
    counters: TransportCounters = field(default_factory=TransportCounters)
    snapshot_latency: LatencyHistogram = field(default_factory=LatencyHistogram)
    connected_since: int | None = None
    last_disconnect_at: int | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "exchange": self.exchange,
            "counters": self.counters.to_dict(),
            "snapshotLatencyMicros": self.snapshot_latency.to_dict(),
            "connectedSince": self.connected_since,
            "lastDisconnectAt": self.last_disconnect_at,
        }


@dataclass(slots=True)
class StreamMetrics:
    """Everything measured for one ``(exchange, channel, symbol)`` stream."""

    exchange: str
    channel: str
    symbol: str
    counters: CounterSet = field(default_factory=CounterSet)
    feed_lag: LatencyHistogram = field(default_factory=LatencyHistogram)
    processing: LatencyHistogram = field(default_factory=LatencyHistogram)
    end_to_end: LatencyHistogram = field(default_factory=LatencyHistogram)
    first_message_at: int | None = None
    last_message_at: int | None = None

    @property
    def key(self) -> tuple[str, str, str]:
        return (self.exchange, self.channel, self.symbol)

    def record_message(
        self,
        *,
        exchange_timestamp: int | None,
        received_timestamp: int,
        processed_timestamp: int | None = None,
    ) -> None:
        """Record one message and its timings."""
        self.counters.messages += 1
        if self.first_message_at is None:
            self.first_message_at = received_timestamp
        self.last_message_at = received_timestamp

        if exchange_timestamp is not None and exchange_timestamp > 0:
            self.feed_lag.observe(received_timestamp - exchange_timestamp)

        if processed_timestamp is not None:
            self.processing.observe(processed_timestamp - received_timestamp)
            if exchange_timestamp is not None and exchange_timestamp > 0:
                self.end_to_end.observe(processed_timestamp - exchange_timestamp)

    def messages_per_second(self, *, now_micros: int | None = None) -> float | None:
        """Average rate since the first message. ``None`` below two samples."""
        if self.first_message_at is None or self.counters.messages < 2:
            return None
        now = epoch_micros() if now_micros is None else now_micros
        elapsed = now - self.first_message_at
        if elapsed <= 0:
            return None
        return self.counters.messages / (elapsed / 1_000_000)

    def to_dict(self, *, now_micros: int | None = None) -> dict[str, object]:
        return {
            "exchange": self.exchange,
            "channel": self.channel,
            "symbol": self.symbol,
            "counters": self.counters.to_dict(),
            "feedLagMicros": self.feed_lag.to_dict(),
            "processingMicros": self.processing.to_dict(),
            "endToEndMicros": self.end_to_end.to_dict(),
            "messagesPerSecond": self.messages_per_second(now_micros=now_micros),
            "firstMessageAt": self.first_message_at,
            "lastMessageAt": self.last_message_at,
        }


class ConnectivityMetrics:
    """Registry of per-stream metrics for one service instance.

    In-process and in-memory by design. Shipping every measurement to a metrics
    backend synchronously would put a network call in the hot path — the exact
    thing the data-plane rules forbid. A collector scrapes :meth:`to_dict` on
    its own schedule instead.
    """

    __slots__ = ("_streams", "_started_at", "_transports")

    def __init__(self) -> None:
        self._streams: dict[tuple[str, str, str], StreamMetrics] = {}
        self._transports: dict[str, TransportMetrics] = {}
        self._started_at = epoch_micros()

    def transport(self, exchange: str) -> TransportMetrics:
        """Get or create the transport record for a venue connection."""
        metrics = self._transports.get(exchange)
        if metrics is None:
            metrics = TransportMetrics(exchange=exchange)
            self._transports[exchange] = metrics
        return metrics

    # ------------------------------------------------------------------
    # Transport-level recording
    # ------------------------------------------------------------------
    def record_connection_attempt(self, exchange: str) -> None:
        self.transport(exchange).counters.connection_attempts += 1

    def record_connection_success(
        self, exchange: str, *, at_micros: int | None = None
    ) -> None:
        metrics = self.transport(exchange)
        metrics.counters.connection_successes += 1
        metrics.connected_since = (
            epoch_micros() if at_micros is None else at_micros
        )

    def record_connection_failure(self, exchange: str) -> None:
        self.transport(exchange).counters.connection_failures += 1

    def record_disconnect(
        self, exchange: str, *, at_micros: int | None = None
    ) -> None:
        metrics = self.transport(exchange)
        metrics.counters.disconnects += 1
        metrics.connected_since = None
        metrics.last_disconnect_at = (
            epoch_micros() if at_micros is None else at_micros
        )

    def record_transport_reconnect(self, exchange: str) -> None:
        self.transport(exchange).counters.reconnects += 1

    def record_frame(self, exchange: str, *, byte_count: int = 0) -> None:
        counters = self.transport(exchange).counters
        counters.frames_received += 1
        counters.bytes_received += max(0, byte_count)

    def record_bytes(self, exchange: str, byte_count: int) -> None:
        self.transport(exchange).counters.bytes_received += max(0, byte_count)

    def record_frame_sent(self, exchange: str) -> None:
        self.transport(exchange).counters.frames_sent += 1

    def record_transport_parse_error(self, exchange: str) -> None:
        self.transport(exchange).counters.parse_errors += 1

    def record_heartbeat_failure(self, exchange: str) -> None:
        self.transport(exchange).counters.heartbeat_failures += 1

    def record_snapshot_request(
        self, exchange: str, *, latency_micros: int | None = None, success: bool = True
    ) -> None:
        """Record one REST order-book snapshot fetch.

        Failures are counted but contribute no latency sample: a timeout's
        duration is a property of the timeout setting, and mixing it into the
        distribution would make the numbers describe the configuration rather
        than the venue.
        """
        metrics = self.transport(exchange)
        metrics.counters.snapshot_requests += 1
        if not success:
            metrics.counters.snapshot_failures += 1
            return
        if latency_micros is not None:
            metrics.snapshot_latency.observe(latency_micros)

    def record_book_resync(self, exchange: str) -> None:
        self.transport(exchange).counters.book_resyncs += 1

    def stream(self, exchange: str, channel: str, symbol: str) -> StreamMetrics:
        """Get or create the metrics record for a stream."""
        key = (exchange, channel, symbol)
        metrics = self._streams.get(key)
        if metrics is None:
            metrics = StreamMetrics(exchange=exchange, channel=channel, symbol=symbol)
            self._streams[key] = metrics
        return metrics

    def record_message(
        self,
        exchange: str,
        channel: str,
        symbol: str,
        *,
        exchange_timestamp: int | None,
        received_timestamp: int,
        processed_timestamp: int | None = None,
    ) -> None:
        self.stream(exchange, channel, symbol).record_message(
            exchange_timestamp=exchange_timestamp,
            received_timestamp=received_timestamp,
            processed_timestamp=processed_timestamp,
        )

    def record_gap(self, exchange: str, channel: str, symbol: str) -> None:
        self.stream(exchange, channel, symbol).counters.gaps += 1

    def record_resync(self, exchange: str, channel: str, symbol: str) -> None:
        self.stream(exchange, channel, symbol).counters.resyncs += 1

    def record_parse_error(self, exchange: str, channel: str, symbol: str) -> None:
        self.stream(exchange, channel, symbol).counters.parse_errors += 1

    def record_drop(self, exchange: str, channel: str, symbol: str) -> None:
        self.stream(exchange, channel, symbol).counters.dropped += 1

    def record_stale_transition(self, exchange: str, channel: str, symbol: str) -> None:
        self.stream(exchange, channel, symbol).counters.stale_transitions += 1

    def record_reconnect(self, exchange: str, channel: str, symbol: str) -> None:
        self.stream(exchange, channel, symbol).counters.reconnects += 1

    def record_subscription_failure(
        self, exchange: str, channel: str, symbol: str
    ) -> None:
        self.stream(exchange, channel, symbol).counters.subscription_failures += 1

    @property
    def stream_count(self) -> int:
        return len(self._streams)

    def totals(self) -> dict[str, int]:
        """Summed counters across every stream."""
        total = CounterSet()
        for metrics in self._streams.values():
            total.messages += metrics.counters.messages
            total.parse_errors += metrics.counters.parse_errors
            total.dropped += metrics.counters.dropped
            total.gaps += metrics.counters.gaps
            total.resyncs += metrics.counters.resyncs
            total.stale_transitions += metrics.counters.stale_transitions
            total.reconnects += metrics.counters.reconnects
            total.subscription_failures += metrics.counters.subscription_failures
        return total.to_dict()

    def to_dict(self, *, now_micros: int | None = None) -> dict[str, object]:
        """Scrapeable snapshot.

        Percentiles are labelled ``observed`` to make clear they describe past
        measurements on this instance and are not a service-level guarantee.
        """
        now = epoch_micros() if now_micros is None else now_micros
        return {
            "startedAt": self._started_at,
            "uptimeMicros": now - self._started_at,
            "streamCount": len(self._streams),
            "totals": self.totals(),
            "transports": [
                self._transports[exchange].to_dict()
                for exchange in sorted(self._transports)
            ],
            "observed": [
                metrics.to_dict(now_micros=now)
                for metrics in sorted(self._streams.values(), key=lambda m: m.key)
            ],
        }

    def transport_totals(self) -> dict[str, int]:
        """Summed transport counters across every venue connection."""
        total = TransportCounters()
        for metrics in self._transports.values():
            counters = metrics.counters
            total.connection_attempts += counters.connection_attempts
            total.connection_successes += counters.connection_successes
            total.connection_failures += counters.connection_failures
            total.disconnects += counters.disconnects
            total.reconnects += counters.reconnects
            total.frames_received += counters.frames_received
            total.bytes_received += counters.bytes_received
            total.frames_sent += counters.frames_sent
            total.parse_errors += counters.parse_errors
            total.heartbeat_failures += counters.heartbeat_failures
            total.snapshot_requests += counters.snapshot_requests
            total.snapshot_failures += counters.snapshot_failures
            total.book_resyncs += counters.book_resyncs
        return total.to_dict()

    def reset(self) -> None:
        self._streams.clear()
        self._transports.clear()
        self._started_at = epoch_micros()


# ----------------------------------------------------------------------
# Part 5: execution-path instrumentation
# ----------------------------------------------------------------------
#: Named stages of the order pipeline, measured independently.
#:
#: They are separate histograms rather than one end-to-end number because the
#: remedies differ entirely: a slow risk stage is a database problem, a slow
#: signing stage is a CPU problem, and a slow network stage is somebody else's
#: problem. A single aggregate hides which.
EXECUTION_STAGES: tuple[str, ...] = (
    "validation",
    "risk",
    "safety_gates",
    "lock_acquire",
    "signing",
    "network",
    "exchange_ack",
    "persistence",
    "total_submit",
    "first_fill",
    "private_stream_delivery",
    "reconciliation_pass",
)


@dataclass(slots=True)
class ExecutionCounters:
    """Monotonic counters for the execution path.

    Every field answers a question an operator actually asks during an
    incident: how many orders did we send, how many did the venue refuse, and —
    the one that matters most — how many are in an unknown state right now.
    """

    orders_submitted: int = 0
    orders_accepted: int = 0
    orders_rejected_locally: int = 0
    orders_rejected_by_exchange: int = 0
    orders_duplicate: int = 0
    orders_dry_run: int = 0
    orders_unknown: int = 0
    orders_cancelled: int = 0
    fills_applied: int = 0
    fills_deduplicated: int = 0
    validation_failures: int = 0
    risk_rejections: int = 0
    kill_switch_blocks: int = 0
    signing_failures: int = 0
    clock_skew_rejections: int = 0
    auth_failures: int = 0
    rate_limit_refusals: int = 0
    reconciliation_passes: int = 0
    reconciliation_failures: int = 0
    discrepancies_found: int = 0
    discrepancies_repaired: int = 0
    incidents_raised: int = 0
    private_stream_reconnects: int = 0
    private_stream_events: int = 0
    listen_key_renewals: int = 0
    listen_key_renewal_failures: int = 0

    def to_dict(self) -> dict[str, int]:
        return {
            "ordersSubmitted": self.orders_submitted,
            "ordersAccepted": self.orders_accepted,
            "ordersRejectedLocally": self.orders_rejected_locally,
            "ordersRejectedByExchange": self.orders_rejected_by_exchange,
            "ordersDuplicate": self.orders_duplicate,
            "ordersDryRun": self.orders_dry_run,
            "ordersUnknown": self.orders_unknown,
            "ordersCancelled": self.orders_cancelled,
            "fillsApplied": self.fills_applied,
            "fillsDeduplicated": self.fills_deduplicated,
            "validationFailures": self.validation_failures,
            "riskRejections": self.risk_rejections,
            "killSwitchBlocks": self.kill_switch_blocks,
            "signingFailures": self.signing_failures,
            "clockSkewRejections": self.clock_skew_rejections,
            "authFailures": self.auth_failures,
            "rateLimitRefusals": self.rate_limit_refusals,
            "reconciliationPasses": self.reconciliation_passes,
            "reconciliationFailures": self.reconciliation_failures,
            "discrepanciesFound": self.discrepancies_found,
            "discrepanciesRepaired": self.discrepancies_repaired,
            "incidentsRaised": self.incidents_raised,
            "privateStreamReconnects": self.private_stream_reconnects,
            "privateStreamEvents": self.private_stream_events,
            "listenKeyRenewals": self.listen_key_renewals,
            "listenKeyRenewalFailures": self.listen_key_renewal_failures,
        }


class ExecutionMetrics:
    """Latency distributions and counters for the authenticated path.

    These are **observations**, not guarantees. The figures include this
    process's own scheduling delay, the venue's queueing, and the internet in
    between. They are useful for spotting a regression and for capacity
    planning, and they are not a service-level guarantee of any kind — this
    platform makes no low-latency promises and none should be inferred from a
    good percentile here.
    """

    __slots__ = ("_stages", "_counters", "_started_at", "_exchange")

    def __init__(self, exchange: str = "") -> None:
        self._exchange = exchange
        self._stages: dict[str, LatencyHistogram] = {
            stage: LatencyHistogram() for stage in EXECUTION_STAGES
        }
        self._counters = ExecutionCounters()
        self._started_at = epoch_micros()

    @property
    def counters(self) -> ExecutionCounters:
        return self._counters

    def observe(self, stage: str, micros: int) -> None:
        """Record one measurement for a named stage.

        An unknown stage name is created on demand rather than dropped: losing
        a measurement because a new stage was added in one place and not the
        other is a silent failure, and a stray key in a metrics dump is not.
        """
        histogram = self._stages.get(stage)
        if histogram is None:
            histogram = LatencyHistogram()
            self._stages[stage] = histogram
        histogram.observe(micros)

    def stage(self, name: str) -> LatencyHistogram | None:
        return self._stages.get(name)

    def to_dict(self, *, now_micros: int | None = None) -> dict[str, object]:
        now = epoch_micros() if now_micros is None else now_micros
        return {
            "exchange": self._exchange,
            "uptimeMicros": now - self._started_at,
            "counters": self._counters.to_dict(),
            "stages": {
                name: histogram.to_dict()
                for name, histogram in sorted(self._stages.items())
                if histogram.count > 0
            },
            "note": (
                "Latency figures are observations of this process and its "
                "network path. They are not a performance guarantee."
            ),
        }

    def reset(self) -> None:
        for histogram in self._stages.values():
            histogram.reset()
        self._counters = ExecutionCounters()
        self._started_at = epoch_micros()
```


## B4. Modified files — market-data service

### FILE: services/market-data/app/config.py

```python
"""Configuration for the market data service."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Validated runtime configuration."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=True,
    )

    NODE_ENV: Literal["development", "test", "staging", "production"] = "development"
    LOG_LEVEL: Literal["debug", "info", "warning", "error", "critical"] = "info"

    MARKET_DATA_HOST: str = "0.0.0.0"
    MARKET_DATA_PORT: int = Field(default=8002, ge=1, le=65535)
    MARKET_DATA_HEALTH_PATH: str = "/health"

    REDIS_HOST: str
    REDIS_PORT: int = Field(default=6379, ge=1, le=65535)
    REDIS_PASSWORD: str | None = None
    REDIS_DB: int = Field(default=0, ge=0, le=15)
    REDIS_TLS: bool = False

    INTERNAL_SERVICE_TOKEN: str = Field(min_length=32)

    #: Upstream venues polled for reference prices.
    MARKET_DATA_SOURCES: str = "binance,bybit"
    #: Symbols the service tracks. Kept explicit so a typo cannot fan out.
    MARKET_DATA_SYMBOLS: str = "BTC/USDT,ETH/USDT,SOL/USDT"
    MARKET_DATA_POLL_INTERVAL_SECONDS: int = Field(default=5, ge=1, le=300)
    #: How long a cached quote stays servable before it is considered stale.
    MARKET_DATA_CACHE_TTL_SECONDS: int = Field(default=15, ge=1, le=3600)
    #: Master switch for the live websocket feed. Off by default: a fresh
    #: deployment should not open venue connections until an operator asks for
    #: them.
    MARKET_DATA_STREAMING_ENABLED: bool = False

    # ------------------------------------------------------------------
    # Live public market data (wlct_trading.net)
    #
    # Public endpoints only. There is deliberately no API key or secret in
    # this class: public market data needs none, and user exchange credentials
    # live encrypted per trading account in PostgreSQL — never in a service's
    # environment.
    # ------------------------------------------------------------------
    BINANCE_WS_URL: str = "wss://stream.binance.com:9443"
    BINANCE_REST_URL: str = "https://api.binance.com"
    EXCHANGE_USE_TESTNET: bool = False

    #: Channels. Each maps to one stream per symbol on the shared connection.
    MARKET_DATA_TICKER_ENABLED: bool = True
    MARKET_DATA_TRADES_ENABLED: bool = True
    MARKET_DATA_ORDERBOOK_ENABLED: bool = True

    WEBSOCKET_CONNECT_TIMEOUT_MS: int = Field(default=10_000, ge=100, le=120_000)
    #: Backstop below the heartbeat, not the primary liveness check. Generous
    #: on purpose: a thin symbol's trade stream can legitimately be silent for
    #: minutes, and the venue's protocol pings are answered by the client
    #: library without ever surfacing as a message.
    WEBSOCKET_RECEIVE_TIMEOUT_MS: int = Field(default=300_000, ge=1_000, le=3_600_000)
    WEBSOCKET_HEARTBEAT_TIMEOUT_MS: int = Field(default=90_000, ge=2_000, le=600_000)

    HTTP_CONNECT_TIMEOUT_MS: int = Field(default=5_000, ge=100, le=120_000)
    HTTP_READ_TIMEOUT_MS: int = Field(default=10_000, ge=100, le=120_000)
    HTTP_TOTAL_TIMEOUT_MS: int = Field(default=15_000, ge=100, le=300_000)

    #: Duration of the separately invoked live smoke test. Not used by the
    #: service itself.
    LIVE_MARKET_DATA_SMOKE_TEST_DURATION_SECONDS: int = Field(
        default=30, ge=1, le=3_600
    )

    @field_validator("INTERNAL_SERVICE_TOKEN")
    @classmethod
    def _reject_placeholder_token(cls, value: str) -> str:
        if value.strip().lower() in {"changeme", "change_me", "placeholder", "secret", "token"}:
            raise ValueError("INTERNAL_SERVICE_TOKEN must not be a placeholder value")
        return value

    @field_validator("BINANCE_WS_URL")
    @classmethod
    def _require_tls_websocket(cls, value: str) -> str:
        # Refused rather than warned about: market data received over a
        # plaintext socket can be modified in flight, and a book built from
        # modified data is worse than no book at all.
        if not value.startswith("wss://"):
            raise ValueError("BINANCE_WS_URL must use wss:// (TLS)")
        return value

    @field_validator("BINANCE_REST_URL")
    @classmethod
    def _require_tls_rest(cls, value: str) -> str:
        if not value.startswith("https://"):
            raise ValueError("BINANCE_REST_URL must use https://")
        return value

    @model_validator(mode="after")
    def _require_a_channel_when_streaming(self) -> "Settings":
        if self.MARKET_DATA_STREAMING_ENABLED and not self.enabled_channels:
            raise ValueError(
                "MARKET_DATA_STREAMING_ENABLED is on but every channel is "
                "disabled; enable at least one of MARKET_DATA_TICKER_ENABLED, "
                "MARKET_DATA_TRADES_ENABLED or MARKET_DATA_ORDERBOOK_ENABLED"
            )
        if self.HTTP_TOTAL_TIMEOUT_MS < self.HTTP_READ_TIMEOUT_MS:
            raise ValueError(
                "HTTP_TOTAL_TIMEOUT_MS must be at least HTTP_READ_TIMEOUT_MS"
            )
        return self

    @property
    def sources(self) -> list[str]:
        return [item.strip().lower() for item in self.MARKET_DATA_SOURCES.split(",") if item.strip()]

    @property
    def symbols(self) -> list[str]:
        return [item.strip().upper() for item in self.MARKET_DATA_SYMBOLS.split(",") if item.strip()]

    @property
    def enabled_channels(self) -> list[str]:
        """Channel names for the live feed, in a stable order."""
        channels: list[str] = []
        if self.MARKET_DATA_ORDERBOOK_ENABLED:
            channels.append("orderbook")
        if self.MARKET_DATA_TRADES_ENABLED:
            channels.append("trades")
        if self.MARKET_DATA_TICKER_ENABLED:
            channels.append("bookticker")
        return channels

    @property
    def is_production(self) -> bool:
        return self.NODE_ENV == "production"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
```

### FILE: services/market-data/requirements.txt

```text
fastapi==0.115.0
uvicorn[standard]==0.31.0
pydantic==2.9.2
pydantic-settings==2.5.2
redis==5.1.1
# httpx is the service's single async HTTP client: it backs both the reference
# price providers in app/services/providers.py and the production HttpGetter in
# wlct_trading.net. Adding a second stack (aiohttp) would mean two connection
# pools and two sets of timeout semantics in one process.
httpx==0.27.2
# Websocket client behind wlct_trading.net.websocket_client. Pinned to the same
# major line the library's `live` extra allows.
websockets==13.1
python-json-logger==2.0.7
ccxt==4.4.10
tenacity==9.0.0
```

### FILE: services/market-data/.env.example

```bash
# Market data service - copy to .env for local runs outside Docker Compose.
NODE_ENV=development
LOG_LEVEL=info

MARKET_DATA_HOST=0.0.0.0
MARKET_DATA_PORT=8002
MARKET_DATA_HEALTH_PATH=/health

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_TLS=false

# Must match INTERNAL_SERVICE_TOKEN in the root .env. Minimum 32 characters.
INTERNAL_SERVICE_TOKEN=

MARKET_DATA_SOURCES=binance,bybit
MARKET_DATA_SYMBOLS=BTC/USDT,ETH/USDT,SOL/USDT
MARKET_DATA_POLL_INTERVAL_SECONDS=5
MARKET_DATA_CACHE_TTL_SECONDS=15
MARKET_DATA_STREAMING_ENABLED=false
```

### FILE: services/market-data/tests/conftest.py

```python
"""Test fixtures for the market data service."""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest

os.environ.setdefault("NODE_ENV", "test")
os.environ.setdefault("REDIS_HOST", "localhost")
os.environ.setdefault("REDIS_PORT", "6379")
os.environ.setdefault(
    "INTERNAL_SERVICE_TOKEN", "test-internal-service-token-value-0123456789abcdef"
)
os.environ.setdefault("MARKET_DATA_SYMBOLS", "BTC/USDT,ETH/USDT")
os.environ.setdefault("MARKET_DATA_SOURCES", "binance,bybit")

from fastapi.testclient import TestClient  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.main import create_app  # noqa: E402


@pytest.fixture(scope="session")
def internal_token() -> str:
    return os.environ["INTERNAL_SERVICE_TOKEN"]


@pytest.fixture()
def app_instance() -> Iterator[object]:
    """Builds the app without running the lifespan (no Redis in unit tests)."""
    get_settings.cache_clear()
    yield create_app()


@pytest.fixture()
def client(app_instance: object) -> Iterator[TestClient]:
    # TestClient is used without a context manager so `lifespan` does not run:
    # these tests must not require a live Redis.
    yield TestClient(app_instance)  # type: ignore[arg-type]
```


## B5. Modified files — root configuration

### FILE: .env.example

```bash
# =============================================================================
# WHITE-LABEL CRYPTO COPY-TRADING PLATFORM - ENVIRONMENT CONFIGURATION
# =============================================================================
# Copy to .env and fill in real values. NEVER commit .env.
# Generate cryptographic material with: npm run keys:generate
# =============================================================================

# -----------------------------------------------------------------------------
# APPLICATION
# -----------------------------------------------------------------------------
NODE_ENV=development
APP_NAME=WhiteLabelCopyTrade
API_PORT=4000
API_HOST=0.0.0.0
API_GLOBAL_PREFIX=api
API_DEFAULT_VERSION=1
# Public base URL of the API (used in emails, webhooks, OpenAPI servers)
API_PUBLIC_URL=http://localhost:4000
# Public base URL of the admin web application
ADMIN_WEB_URL=http://localhost:3000
# Host port the admin console is published on by Docker Compose.
ADMIN_WEB_PORT=3000
# Trust N reverse proxy hops (nginx/ALB). 0 disables proxy trust.
TRUST_PROXY_HOPS=1
# Root domain used to resolve tenants from sub-domains: acme.copytrade.app
PLATFORM_ROOT_DOMAIN=copytrade.app
# Fallback tenant slug used when a request carries no resolvable tenant context
DEFAULT_TENANT_SLUG=platform

# -----------------------------------------------------------------------------
# DATABASE (PostgreSQL)
# -----------------------------------------------------------------------------
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=copytrade
POSTGRES_PASSWORD=change_me_postgres_password
POSTGRES_DB=copytrade
POSTGRES_SCHEMA=public
# Password for the least-privilege runtime role created by
# infrastructure/database/init/02-roles.sql. Leave blank to skip role creation.
POSTGRES_APP_PASSWORD=
# Prisma connection string. Inside docker-compose use host "postgres".
DATABASE_URL=postgresql://copytrade:change_me_postgres_password@localhost:5432/copytrade?schema=public&connection_limit=20&pool_timeout=20
# REQUIRED, not optional. schema.prisma declares `directUrl`, and Prisma refuses
# to run ANY migrate/generate command when the variable is missing (error P1012)
# even though the application itself never reads it. Point it at the database
# directly, bypassing any connection pooler (PgBouncer, RDS Proxy) and without
# the pooling query parameters, so DDL runs on a real session. With no pooler in
# front of PostgreSQL it is simply DATABASE_URL minus connection_limit/pool_timeout.
DIRECT_DATABASE_URL=postgresql://copytrade:change_me_postgres_password@localhost:5432/copytrade?schema=public
DATABASE_LOG_QUERIES=false
DATABASE_SSL=false

# -----------------------------------------------------------------------------
# REDIS (cache, rate limiting, queues, websocket adapter)
# -----------------------------------------------------------------------------
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_TLS=false
REDIS_KEY_PREFIX=wlct:
REDIS_URL=redis://localhost:6379/0

# -----------------------------------------------------------------------------
# JWT / AUTHENTICATION
# -----------------------------------------------------------------------------
# Asymmetric signing is recommended in production (RS256). For HS256 provide secrets.
JWT_ALGORITHM=HS256
JWT_ACCESS_SECRET=change_me_access_secret_min_32_chars_long
JWT_REFRESH_SECRET=change_me_refresh_secret_min_32_chars_long
# Base64-encoded PEM keys, required when JWT_ALGORITHM=RS256
JWT_PRIVATE_KEY_BASE64=
JWT_PUBLIC_KEY_BASE64=
JWT_ACCESS_TTL=900s
JWT_REFRESH_TTL=30d
JWT_ISSUER=https://api.copytrade.app
JWT_AUDIENCE=copytrade-clients
# Maximum concurrent active sessions (devices) per user
MAX_ACTIVE_SESSIONS_PER_USER=10

# Password policy / hashing (argon2id)
PASSWORD_MIN_LENGTH=12
ARGON2_MEMORY_COST=19456
ARGON2_TIME_COST=2
ARGON2_PARALLELISM=1

# Account protection
LOGIN_MAX_FAILED_ATTEMPTS=5
LOGIN_FAILED_WINDOW_SECONDS=900
ACCOUNT_LOCKOUT_SECONDS=900

# -----------------------------------------------------------------------------
# ENCRYPTION (exchange API credential envelope encryption)
# -----------------------------------------------------------------------------
# 32-byte key, base64 encoded. Key Encryption Key used to wrap per-record DEKs.
ENCRYPTION_MASTER_KEY_BASE64=
# Identifier of the active master key; enables zero-downtime key rotation.
ENCRYPTION_KEY_ID=local-dev-v1
# Previous keys kept for decrypt-only, JSON map: {"local-dev-v0":"<base64key>"}
ENCRYPTION_PREVIOUS_KEYS_JSON={}
# kms | local  -> "kms" delegates KEK operations to a managed KMS provider
ENCRYPTION_PROVIDER=local
KMS_PROVIDER=
KMS_KEY_ARN=
# Deterministic HMAC key used to build blind indexes (lookup on encrypted values)
BLIND_INDEX_KEY_BASE64=

# -----------------------------------------------------------------------------
# TWO-FACTOR AUTHENTICATION (TOTP)
# -----------------------------------------------------------------------------
TWO_FACTOR_ISSUER=CopyTrade
TWO_FACTOR_WINDOW=1
TWO_FACTOR_DIGITS=6
TWO_FACTOR_PERIOD=30
TWO_FACTOR_RECOVERY_CODES=10
# Short-lived token issued between password step and 2FA step
TWO_FACTOR_CHALLENGE_TTL=300s
# Wrong codes tolerated per challenge token before it is discarded.
TWO_FACTOR_MAX_CHALLENGE_ATTEMPTS=5

# -----------------------------------------------------------------------------
# CORS
# -----------------------------------------------------------------------------
CORS_ENABLED=true
CORS_ORIGINS=http://localhost:3000,http://localhost:4000
CORS_CREDENTIALS=true
CORS_ALLOWED_HEADERS=Content-Type,Authorization,X-Tenant-Slug,X-Request-Id,X-Api-Version,Accept-Language,X-2FA-Token
CORS_EXPOSED_HEADERS=X-Request-Id,X-RateLimit-Limit,X-RateLimit-Remaining,X-RateLimit-Reset

# -----------------------------------------------------------------------------
# RATE LIMITING
# -----------------------------------------------------------------------------
RATE_LIMIT_ENABLED=true
RATE_LIMIT_TTL_SECONDS=60
RATE_LIMIT_MAX=120
RATE_LIMIT_AUTH_TTL_SECONDS=300
RATE_LIMIT_AUTH_MAX=10
RATE_LIMIT_TRUSTED_IPS=127.0.0.1,::1

# -----------------------------------------------------------------------------
# SWAGGER / OPENAPI
# -----------------------------------------------------------------------------
SWAGGER_ENABLED=true
SWAGGER_PATH=docs
SWAGGER_TITLE="White-Label Copy Trading API"
SWAGGER_DESCRIPTION="Multi-tenant non-custodial crypto copy-trading platform API"
SWAGGER_VERSION=1.0.0
# Optional basic-auth protection for the docs route in non-local environments
SWAGGER_USER=
SWAGGER_PASSWORD=

# -----------------------------------------------------------------------------
# LOGGING
# -----------------------------------------------------------------------------
LOG_LEVEL=debug
# json | pretty
LOG_FORMAT=pretty
LOG_REQUEST_BODY=false
LOG_SAMPLE_RATE=1
SENTRY_DSN=

# -----------------------------------------------------------------------------
# WEBSOCKET
# -----------------------------------------------------------------------------
WS_ENABLED=true
WS_PATH=/realtime
WS_NAMESPACE=/v1
WS_PING_INTERVAL_MS=25000
WS_PING_TIMEOUT_MS=20000
WS_MAX_CONNECTIONS_PER_USER=5
# Redis adapter lets many API replicas share socket rooms
WS_REDIS_ADAPTER=true

# -----------------------------------------------------------------------------
# BULLMQ / BACKGROUND JOBS
# -----------------------------------------------------------------------------
QUEUE_PREFIX=wlct-queue
QUEUE_DEFAULT_ATTEMPTS=5
QUEUE_BACKOFF_MS=5000
QUEUE_REMOVE_ON_COMPLETE=1000
QUEUE_REMOVE_ON_FAIL=5000
QUEUE_CONCURRENCY=10
# Enable the in-process worker (single-container dev). Disable when running the dedicated worker.
QUEUE_RUN_INLINE_WORKERS=true
BULL_BOARD_ENABLED=false
BULL_BOARD_PATH=admin/queues

# -----------------------------------------------------------------------------
# EXCHANGE INTEGRATIONS (non-custodial: user-supplied trade-only API keys)
# -----------------------------------------------------------------------------
# Comma separated list of exchanges enabled platform-wide
EXCHANGES_ENABLED=binance,bybit,okx,kraken
EXCHANGE_SANDBOX_MODE=true
EXCHANGE_REQUEST_TIMEOUT_MS=10000
EXCHANGE_MAX_RETRIES=3
# Hard safety switch. Order execution remains disabled: the connectivity layer
# delivers market data only, and no order-placement adapter is registered.
EXECUTION_ENABLED=false
# Internal service endpoints
TRADING_ENGINE_URL=http://localhost:8001
TRADING_ENGINE_HEALTH_PATH=/health
MARKET_DATA_URL=http://localhost:8002
MARKET_DATA_HEALTH_PATH=/health
NOTIFICATION_SERVICE_URL=http://localhost:8003
NOTIFICATION_SERVICE_HEALTH_PATH=/health
# Shared secret for service-to-service authentication (mTLS recommended in prod)
INTERNAL_SERVICE_TOKEN=change_me_internal_service_token
# Signing secret used to verify inbound exchange webhooks
EXCHANGE_WEBHOOK_SIGNING_SECRET=change_me_webhook_secret

# -----------------------------------------------------------------------------
# EXCHANGE CONNECTIVITY (libs/trading-core: wlct_trading.transport / .exchanges)
# -----------------------------------------------------------------------------
# These tune the realtime market-data connectivity layer. They contain no
# credentials: public market data needs none, and user exchange API keys are
# stored encrypted per trading account in PostgreSQL, never in the environment.
#
# Only venues with an implemented adapter can be selected. Naming a venue here
# that has no adapter fails fast at startup rather than at the first order.
EXCHANGE_MARKET_DATA_VENUES=binance
# Use the venue testnet endpoints. Keep true outside production.
EXCHANGE_USE_TESTNET=true

# --- Order-book synchronisation ---
# Depth requested for the REST snapshot. Rounded up to a depth the venue
# accepts. Deeper snapshots cost significantly more rate-limit weight
# (Binance spot: 100 levels = 5 weight, 1000 = 50, 5000 = 250).
ORDERBOOK_SNAPSHOT_DEPTH=1000
# Diffs buffered while a snapshot is in flight. Bounds memory: at 100 msg/s
# this is roughly 50 seconds of runway.
ORDERBOOK_MAX_BUFFERED_DELTAS=5000
# Resync attempts before a book is marked FAILED and refuses to serve quotes.
# It never silently serves a book it could not verify.
ORDERBOOK_MAX_RESYNC_ATTEMPTS=10
# A book quiet for longer than this is treated as stale and is not tradeable.
ORDERBOOK_STALENESS_THRESHOLD_MS=5000

# --- Websocket connection management ---
# These are read by the live transport (wlct_trading.net); the Part 3 library
# itself reads no environment at all.
WEBSOCKET_CONNECT_TIMEOUT_MS=10000
WS_HEARTBEAT_INTERVAL_MS=20000
# Silence after which the socket is considered dead and rebuilt. MUST be
# greater than WS_HEARTBEAT_INTERVAL_MS or healthy connections get killed.
WEBSOCKET_HEARTBEAT_TIMEOUT_MS=90000
# Reconnect backoff: capped exponential with full jitter. Jitter is not
# optional in production - without it every connection retries in lockstep
# after a venue blip and the reconnect storm is self-inflicted.
WS_RECONNECT_BASE_DELAY_MS=500
WS_RECONNECT_MAX_DELAY_MS=30000
WS_RECONNECT_MAX_ATTEMPTS=20
# Binance drops stream connections at 24h; cycling early makes it planned.
WS_CONNECTION_MAX_LIFETIME_SECONDS=82800

# --- Staleness thresholds (per channel, milliseconds) ---
# Trades are legitimately sporadic on thin symbols; an order book going quiet
# is not. Thresholds differ so neither alert is useless.
STALENESS_ORDER_BOOK_MS=5000
STALENESS_BOOK_TICKER_MS=5000
STALENESS_TICKER_MS=10000
STALENESS_TRADES_MS=60000
STALENESS_CANDLES_MS=120000
STALENESS_CONNECTION_MS=30000

# --- Rate limiting (venue-published values; lower them, never raise them) ---
# Binance spot: 6000 request weight per minute per IP.
BINANCE_REQUEST_WEIGHT_PER_MINUTE=6000
# 5 inbound messages per second per socket, counting PING/PONG and every
# subscribe frame. Exceeding it disconnects; repeat offenders get IP-banned.
BINANCE_WS_MESSAGES_PER_SECOND=5
BINANCE_MAX_STREAMS_PER_CONNECTION=1024
# Metrics scrape interval for the connectivity layer.
CONNECTIVITY_METRICS_INTERVAL_SECONDS=15

# -----------------------------------------------------------------------------
# LIVE MARKET DATA TRANSPORT (libs/trading-core: wlct_trading.net)
# -----------------------------------------------------------------------------
# The concrete websocket and HTTP clients behind the Part 3 abstractions.
#
# PUBLIC MARKET DATA ONLY. Nothing in this section is a credential and nothing
# on this code path can accept one: the market-data adapter has no API-key
# parameter, no request is signed, and no order is ever submitted. Live order
# execution is NOT implemented.
#
# Endpoints. Both must be TLS - the service refuses to start on ws:// or
# http://, because market data an attacker can rewrite is a way to induce bad
# trades. When EXCHANGE_USE_TESTNET=true and these are left unset, the venue's
# testnet endpoints are used automatically.
BINANCE_WS_URL=wss://stream.binance.com:9443
BINANCE_REST_URL=https://api.binance.com

# Symbols to stream. Accepts BTC/USDT, BTC-USDT or BTCUSDT; all three are
# normalised to the canonical BASE-QUOTE form and then validated against the
# venue's own instrument list, so a typo or a delisted market fails at startup
# rather than producing a socket that is silent forever.
MARKET_DATA_SYMBOLS=BTC/USDT,ETH/USDT,SOL/USDT

# Channels. Each enabled channel adds one stream per symbol to the single
# shared connection (Binance allows 1024 streams per socket).
# "ticker" is the bookTicker stream: best bid/ask on every book change, which
# is what the risk engine's price checks need. The 1-second rolling ticker is a
# statistics feed, not a quote feed.
MARKET_DATA_TICKER_ENABLED=true
MARKET_DATA_TRADES_ENABLED=true
MARKET_DATA_ORDERBOOK_ENABLED=true

# Websocket timeouts. WEBSOCKET_RECEIVE_TIMEOUT_MS is a backstop below the
# heartbeat, not the primary liveness check: a thin symbol's trade stream can
# legitimately be silent for minutes, and the venue's protocol pings are
# answered by the client library without ever surfacing as a message. Set it
# too low and a healthy but quiet connection is torn down in a loop.
WEBSOCKET_RECEIVE_TIMEOUT_MS=300000
# Client-initiated ping cadence and its response deadline. Binance pings every
# 3 minutes and disconnects after 10 without a pong; this is the reverse
# direction, used to notice a peer that has gone away silently.
WEBSOCKET_PING_INTERVAL_MS=180000
WEBSOCKET_PING_TIMEOUT_MS=60000
WEBSOCKET_CLOSE_TIMEOUT_MS=5000
# Frame size ceiling. An unbounded reader is a memory-exhaustion vector.
WEBSOCKET_MAX_FRAME_BYTES=8388608

# HTTP timeouts for REST snapshots. Every request is bounded by all three;
# there is no code path that produces an unbounded wait.
HTTP_CONNECT_TIMEOUT_MS=5000
HTTP_READ_TIMEOUT_MS=10000
HTTP_TOTAL_TIMEOUT_MS=15000
# Retries are bounded and only fire for categories the retry policy calls
# retryable. A 400 is never retried; a 429 honours the venue's Retry-After.
HTTP_MAX_RETRIES=3
HTTP_MAX_CONNECTIONS=20

# Duration of the separately invoked live smoke test
# (scripts/live_market_data_smoke_test.py). That script is the only thing in
# the repository that touches a real exchange; the normal test suite needs no
# internet, credentials, database or Redis.
LIVE_MARKET_DATA_SMOKE_TEST_DURATION_SECONDS=30

# -----------------------------------------------------------------------------
# EMAIL
# -----------------------------------------------------------------------------
# console | smtp (implemented). ses and postmark are planned; selecting an
# unimplemented driver fails fast instead of dropping mail silently.
MAIL_DRIVER=console
MAIL_FROM_NAME=CopyTrade
MAIL_FROM_ADDRESS=no-reply@copytrade.app
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=

# -----------------------------------------------------------------------------
# NOTIFICATIONS (push / sms / webhooks)
# -----------------------------------------------------------------------------
NOTIFICATIONS_ENABLED=true
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY_BASE64=
TELEGRAM_BOT_TOKEN=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=

# -----------------------------------------------------------------------------
# LOCALIZATION / CURRENCY
# -----------------------------------------------------------------------------
DEFAULT_LOCALE=en
SUPPORTED_LOCALES=en,es,ar,bn,tr
DEFAULT_CURRENCY=USD
SUPPORTED_CURRENCIES=USD,EUR,GBP,AED,BDT,TRY
FX_RATES_PROVIDER=none
FX_RATES_API_KEY=

# -----------------------------------------------------------------------------
# KYC (architecture only in Part 1)
# -----------------------------------------------------------------------------
# none | sumsub | onfido | shufti
KYC_PROVIDER=none
KYC_API_URL=
KYC_APP_TOKEN=
KYC_SECRET_KEY=
KYC_WEBHOOK_SECRET=

# -----------------------------------------------------------------------------
# PAYMENTS / BILLING (architecture only in Part 1)
# -----------------------------------------------------------------------------
# none | stripe | nowpayments
BILLING_PROVIDER=none
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NOWPAYMENTS_API_KEY=
NOWPAYMENTS_IPN_SECRET=

# -----------------------------------------------------------------------------
# BOOTSTRAP / SEED (development only)
# -----------------------------------------------------------------------------
# QUOTING: always wrap a value in double quotes if it contains '#', a space, or
# any shell metacharacter. The '#' case is the one that bites: dotenv-cli treats
# an unquoted '#' as the start of a comment and silently truncates the value,
# while sourcing the same file from bash (`set -a; . .env`) keeps it intact.
# The two then disagree, so the password the seed hashes is not the password
# your scripts send, and you get an inexplicable 401 followed by a lockout.
#   WRONG: SEED_SUPER_ADMIN_PASSWORD=My_P4ss#2026   -> becomes "My_P4ss"
#   RIGHT: SEED_SUPER_ADMIN_PASSWORD="My_P4ss#2026"
SEED_SUPER_ADMIN_EMAIL=superadmin@copytrade.app
SEED_SUPER_ADMIN_PASSWORD="ChangeMe_Str0ng!Pass"
SEED_TENANT_ADMIN_EMAIL=admin@acme-capital.test
SEED_TENANT_ADMIN_PASSWORD=ChangeMe_Str0ng!Pass

# -----------------------------------------------------------------------------
# ADMIN WEB (Next.js) - consumed by apps/admin-web
# -----------------------------------------------------------------------------
# Server-side base URL used by Next route handlers and server components to
# reach the API. Inside Docker Compose this becomes http://api:4000/api.
API_BASE_URL=http://localhost:4000/api
# Organisation the console administers when no custom domain is in play.
ADMIN_TENANT_SLUG=platform
# Salt for the console's session cookies. Generate: openssl rand -base64 32
SESSION_COOKIE_SECRET=change_me_admin_session_secret_min_16_chars

# Browser-visible values only. Never place a secret behind NEXT_PUBLIC_.
NEXT_PUBLIC_APP_NAME="CopyTrade Admin"
NEXT_PUBLIC_API_VERSION=v1
NEXT_PUBLIC_WS_URL=http://localhost:4000
NEXT_PUBLIC_WS_PATH=/socket.io
NEXT_PUBLIC_DEFAULT_LOCALE=en

# -----------------------------------------------------------------------------
# TRADING ENGINE (services/trading-engine, Python/FastAPI, port 8001)
# -----------------------------------------------------------------------------
TRADING_ENGINE_HOST=0.0.0.0
TRADING_ENGINE_PORT=8001

# Pre-trade risk ceilings. These are hard caps enforced by the engine on every
# order intent; they are not user-configurable from the client.
MAX_ORDER_NOTIONAL_USD=1000
MAX_OPEN_POSITIONS_PER_ACCOUNT=20
MAX_LEVERAGE=5

# -----------------------------------------------------------------------------
# MARKET DATA (services/market-data, Python/FastAPI, port 8002)
# -----------------------------------------------------------------------------
MARKET_DATA_HOST=0.0.0.0
MARKET_DATA_PORT=8002
# Public reference-price sources, tried in order. No credentials are used.
MARKET_DATA_SOURCES=binance,bybit
MARKET_DATA_SYMBOLS=BTC/USDT,ETH/USDT,SOL/USDT
MARKET_DATA_POLL_INTERVAL_SECONDS=5
# A cached quote older than this is served with stale=true.
MARKET_DATA_CACHE_TTL_SECONDS=15
# Enables the realtime websocket connectivity layer (wlct_trading.transport).
# Off by default: with it disabled the service serves cached REST quotes only
# and opens no exchange sockets.
MARKET_DATA_STREAMING_ENABLED=false

# -----------------------------------------------------------------------------
# NOTIFICATION SERVICE (services/notification-service, Node/BullMQ, port 8003)
# -----------------------------------------------------------------------------
NOTIFICATION_SERVICE_HOST=0.0.0.0
NOTIFICATION_SERVICE_PORT=8003
# The standalone worker reads MAIL_DRIVER, MAIL_FROM_* and SMTP_* from the
# EMAIL section above. Only "console" and "smtp" are implemented; any other
# value throws on startup rather than silently discarding mail.
# none | fcm | apns. "none" reports delivered:false instead of faking delivery.
PUSH_PROVIDER=none
# none | twilio
SMS_PROVIDER=none

# -----------------------------------------------------------------------------
# SHARED LOGGING (all Node and Python services)
# -----------------------------------------------------------------------------
# json in every deployed environment; pretty is for local terminals only.
LOG_FORMAT=json
# Additional pino redaction paths, comma separated. The built-in list already
# covers authorization headers, cookies, passwords, tokens and API secrets.
PINO_REDACT_PATHS=

# -----------------------------------------------------------------------------
# MOBILE APP (apps/mobile, Flutter)
# -----------------------------------------------------------------------------
# The Flutter app deliberately does NOT read this file. A .env shipped inside an
# APK/IPA is trivially extractable, so every mobile value is compiled in with
# --dart-define and the app holds no secrets at all: it authenticates with the
# user's own credentials and stores the resulting tokens in the platform
# keystore (flutter_secure_storage), never in shared preferences or a bundled
# asset. The variables below are listed here only so that all configuration for
# the platform lives in one discoverable place.
#
#   APP_ENV       development | staging | production
#   API_BASE_URL  Base URL INCLUDING the global prefix, e.g. https://api.example.com/api
#                 Android emulator reaches the host through 10.0.2.2, not localhost.
#                 Production builds refuse to start unless this is https://.
#   API_VERSION   URI version segment appended after the prefix (v1)
#   TENANT_SLUG   Sent as X-Tenant-Slug; identifies the white-label brand
#   WS_URL        Socket.IO origin, without the /realtime namespace
#
# Local development against this compose stack:
#
#   flutter run \
#     --dart-define=APP_ENV=development \
#     --dart-define=API_BASE_URL=http://10.0.2.2:4000/api \
#     --dart-define=API_VERSION=v1 \
#     --dart-define=TENANT_SLUG=platform \
#     --dart-define=WS_URL=http://10.0.2.2:4000
#
# Release build:
#
#   flutter build apk --release \
#     --dart-define=APP_ENV=production \
#     --dart-define=API_BASE_URL=https://api.example.com/api \
#     --dart-define=API_VERSION=v1 \
#     --dart-define=TENANT_SLUG=acme \
#     --dart-define=WS_URL=https://api.example.com
#
# Prefer --dart-define-from-file=config/production.json in CI so the values are
# versioned per environment instead of being retyped on the command line.

# =============================================================================
# PART 5 - AUTHENTICATED EXECUTION (libs/trading-core: wlct_trading.execution)
# =============================================================================
# Everything in this block governs whether real orders can reach a real
# exchange with real money. Read the whole section before changing anything.
#
# THE DEFAULTS BELOW CANNOT TRADE. That is deliberate and it is enforced in
# code, not just by convention: an unset variable is never treated as
# permission, and a contradictory combination fails at startup rather than
# resolving itself to the dangerous option.

# -----------------------------------------------------------------------------
# Exchange credentials
# -----------------------------------------------------------------------------
# NEVER commit real values. NEVER paste a key into a ticket, a chat message or
# a log. These are read once at startup by the credential provider and are
# never written to the database, never returned by an API, never included in a
# WebSocket payload and never logged - the credential object redacts itself in
# every rendering path, including repr() and f-strings.
#
# Create the key on Binance with ONLY:
#   [x] Enable Reading
#   [x] Enable Spot & Margin Trading
#   [ ] Enable Withdrawals   <-- MUST stay off
# A withdrawal-capable key is rejected by verify_credentials() and by the
# CREDENTIALS_VALID safety gate. The platform is non-custodial and refuses to
# hold a key that can move funds off the exchange.
#
# Also add an IP allowlist on the key. It is the single most effective control
# available, and it is free.
#
# These two variables are for a single-tenant development setup only. In
# production, per-tenant credentials come from the secret manager through
# SecretManagerCredentialProvider (Vault / AWS Secrets Manager / GCP Secret
# Manager / KMS), keyed by tenant and account. Environment variables do not
# scale to multi-tenant and cannot be rotated per customer.
BINANCE_API_KEY=
BINANCE_API_SECRET=
# Optional: restricts what the platform believes the key can do, independently
# of what the venue says. Comma separated. WITHDRAW here is always refused.
BINANCE_API_PERMISSIONS=SPOT
# Where credentials come from: env | secret-manager | none
CREDENTIAL_PROVIDER=env
# Cache TTL for a resolved credential, in seconds. Short, so a revoked key
# stops working quickly; non-zero, so every order does not hit the secret
# manager. 300 is a reasonable compromise.
CREDENTIAL_CACHE_TTL_SECONDS=300

# -----------------------------------------------------------------------------
# The four switches that gate real money
# -----------------------------------------------------------------------------
# All of the following must agree before a single byte reaches a real venue:
#
#   LIVE_TRADING_ENABLED=true
#   DRY_RUN=false
#   PAPER_TRADING=false
#   TRADING_MODE=LIVE
#   TRADING_ENABLED=true
#   LIVE_TRADING_CONFIRMED=true
#
# Any disagreement is a startup failure with an explicit message. In
# particular:
#   * LIVE_TRADING_ENABLED=true with DRY_RUN=true   -> REJECTED (contradiction)
#   * LIVE_TRADING_ENABLED=true with PAPER_TRADING=true -> REJECTED
#   * LIVE_TRADING_ENABLED=true without TRADING_MODE=LIVE -> REJECTED
# The platform never silently picks the dangerous interpretation, and never
# silently downgrades a misconfigured LIVE to PAPER either - a silent downgrade
# hides a production misconfiguration until the day it matters.

# Master switch for real-money execution.
LIVE_TRADING_ENABLED=false

# Build, validate, risk-check and sign the request, then stop. Nothing is
# transmitted and the order is NEVER reported as submitted. This is the correct
# setting for verifying a configuration end to end without risk.
DRY_RUN=true

# Route orders to the simulated venue. Paper fills are computed from real
# observed prices and are labelled is_simulated=true everywhere they appear -
# in the database, in the API and in every PnL figure.
PAPER_TRADING=true

# -----------------------------------------------------------------------------
# Execution timing
# -----------------------------------------------------------------------------
# How long to wait for a venue response before treating the outcome as UNKNOWN.
# A timeout is ambiguous, not a failure: the order may have been accepted. It
# is reconciled by clientOrderId and never resubmitted.
ORDER_REQUEST_TIMEOUT_MS=10000

# How often the background sweep compares local state against the venue.
ORDER_RECONCILIATION_INTERVAL_MS=60000

# How long to wait before reconciling an order whose result was unknown. Long
# enough for the venue to have finished processing; short enough that a
# position is not a mystery for minutes.
ORDER_UNKNOWN_RECONCILIATION_DELAY_MS=2000

# How often the exchange clock offset is re-measured. A signed request whose
# timestamp is outside the venue's window is rejected, so this is not optional.
EXCHANGE_TIME_SYNC_INTERVAL_MS=300000

# Maximum tolerated difference between this host's clock and the venue's.
# Above this, signing is REFUSED rather than attempted - Binance rejects a
# timestamp more than 1000ms ahead of server time regardless of recvWindow, so
# a larger local error cannot be compensated for by widening the window. If you
# hit this, fix NTP; do not raise the limit.
EXCHANGE_MAX_CLOCK_SKEW_MS=1000

# recvWindow sent with every signed request. Binance caps this at 60000.
# Smaller is safer: it bounds how long a captured request stays replayable.
EXCHANGE_RECV_WINDOW_MS=5000

# How long a clientOrderId reservation is remembered in Redis. The durable
# guard is the unique index on (tenant_id, client_order_id); this is the cheap
# fast path in front of it. 86400 = 24h.
EXECUTION_IDEMPOTENCY_TTL_SECONDS=86400

# Refuse to submit when the risk snapshot is older than this. Stale risk state
# is treated as unavailable, and unavailable means the order is refused.
MAX_RISK_STATE_AGE_MS=5000

# Submission attempts for genuinely retryable failures. Never applied to an
# ambiguous result - that path reconciles instead of retrying, always.
MAX_SUBMIT_ATTEMPTS=1

# -----------------------------------------------------------------------------
# Private user-data stream
# -----------------------------------------------------------------------------
# The authenticated WebSocket that delivers fills, order updates and balance
# changes. Backend only: its payloads are the full order flow of a real
# account and must never reach a mobile client or the admin web app.
PRIVATE_STREAM_RECONNECT_ENABLED=true

# Listen-key keepalive interval. Binance expires a listen key after 60 minutes;
# 30 minutes means one renewal can fail entirely and the stream still survives.
PRIVATE_STREAM_LISTEN_KEY_REFRESH_MS=1800000

# After every reconnect the platform reconciles, because Binance does not
# replay events missed while disconnected. Leave this on.
PRIVATE_STREAM_RECONCILE_ON_RECONNECT=true

# -----------------------------------------------------------------------------
# Live-trading harness (NOT part of the default startup path)
# -----------------------------------------------------------------------------
# Guards the separately-invoked script that places a real order on testnet.
# It refuses to run unless this is explicitly true AND the credentials point at
# a testnet endpoint.
LIVE_EXECUTION_HARNESS_ENABLED=false
BINANCE_USE_TESTNET_FOR_HARNESS=true
```


## B6. Part 4 documentation

### FILE: docs/PART4_LIVE_TRANSPORT.md

````markdown
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
````
