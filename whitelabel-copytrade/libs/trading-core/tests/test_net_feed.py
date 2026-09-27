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
