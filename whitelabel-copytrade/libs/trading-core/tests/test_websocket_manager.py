"""WebSocket connection manager, driven entirely by an in-memory transport.

No sockets, no network, no sleeping on wall time. The fake transport below
implements the three-method :class:`WebSocketTransport` protocol, which is the
whole point of that interface being three methods: the reconnect, heartbeat and
subscription-restore paths are the ones most likely to harbour bugs and the
hardest to exercise against a live venue, so they are made cheap to test.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from wlct_trading.transport.backoff import BackoffConfig
from wlct_trading.transport.errors import (
    ExchangeErrorCategory,
    NormalisedExchangeError,
)
from wlct_trading.transport.state import ConnectionState
from wlct_trading.transport.subscriptions import (
    MarketDataChannel,
    SubscriptionManager,
    SubscriptionStatus,
)
from wlct_trading.transport.websocket import (
    ConnectionCallbacks,
    ConnectionClosed,
    ConnectionConfig,
    WebSocketConnectionManager,
)


class FakeTransport:
    """Scriptable in-memory websocket.

    Frames are pushed in by the test and read by the manager. ``close()`` makes
    the pending ``receive()`` raise :class:`ConnectionClosed`, which is how a
    real peer disconnect is simulated.
    """

    def __init__(self, url: str) -> None:
        self.url = url
        self.sent: list[str] = []
        self.closed = False
        self._inbox: asyncio.Queue[str | BaseException] = asyncio.Queue()

    async def send(self, message: str) -> None:
        if self.closed:
            raise ConnectionClosed("Transport is closed.")
        self.sent.append(message)

    async def receive(self) -> str:
        item = await self._inbox.get()
        if isinstance(item, BaseException):
            raise item
        return item

    async def close(self) -> None:
        self.closed = True
        self._inbox.put_nowait(ConnectionClosed("Closed locally."))

    # -- test helpers --------------------------------------------------
    def push(self, message: str) -> None:
        self._inbox.put_nowait(message)

    def fail(self, exc: BaseException) -> None:
        self._inbox.put_nowait(exc)


class TransportFactoryStub:
    """Hands out fake transports and records every connect attempt."""

    def __init__(self, *, fail_times: int = 0, error: BaseException | None = None) -> None:
        self.transports: list[FakeTransport] = []
        self.attempts = 0
        self._fail_times = fail_times
        self._error = error or ConnectionError("connect refused")

    async def __call__(self, url: str) -> FakeTransport:
        self.attempts += 1
        if self.attempts <= self._fail_times:
            raise self._error
        transport = FakeTransport(url)
        self.transports.append(transport)
        return transport

    @property
    def latest(self) -> FakeTransport:
        return self.transports[-1]


def build_manager(
    factory: TransportFactoryStub,
    *,
    received: list[str] | None = None,
    subscriptions: SubscriptionManager | None = None,
    heartbeat_interval_millis: int = 20_000,
    heartbeat_timeout_millis: int = 60_000,
    reconnect_enabled: bool = True,
    on_message_error: BaseException | None = None,
) -> tuple[WebSocketConnectionManager, list[tuple[ConnectionState, ConnectionState]]]:
    sink = received if received is not None else []
    states: list[tuple[ConnectionState, ConnectionState]] = []

    def on_message(raw: str) -> None:
        if on_message_error is not None:
            raise on_message_error
        sink.append(raw)

    def build_subscribe_frames(subs: tuple[Any, ...]) -> tuple[str, ...]:
        return tuple(f"SUBSCRIBE:{s.stream_name}" for s in subs)

    def build_unsubscribe_frames(subs: tuple[Any, ...]) -> tuple[str, ...]:
        return tuple(f"UNSUBSCRIBE:{s.stream_name}" for s in subs)

    callbacks = ConnectionCallbacks(
        on_message=on_message,
        build_subscribe_frames=build_subscribe_frames,
        build_unsubscribe_frames=build_unsubscribe_frames,
        build_ping_frame=lambda: "PING",
        on_state_change=lambda previous, current: states.append((previous, current)),
    )

    config = ConnectionConfig(
        url="wss://example.invalid/stream",
        name="test-feed",
        connect_timeout_millis=1_000,
        heartbeat_interval_millis=heartbeat_interval_millis,
        heartbeat_timeout_millis=heartbeat_timeout_millis,
        backoff=BackoffConfig(base_delay_millis=1, max_delay_millis=4, jitter=False),
        reconnect_enabled=reconnect_enabled,
        subscribe_pacing_millis=0,
    )

    manager = WebSocketConnectionManager(
        config,
        factory,
        callbacks,
        subscriptions or SubscriptionManager(exchange="binance"),
        exchange="binance",
    )
    return manager, states


async def drain(iterations: int = 6) -> None:
    """Yield control so the manager's tasks can run."""
    for _ in range(iterations):
        await asyncio.sleep(0)


# ----------------------------------------------------------------------
# Connect / disconnect
# ----------------------------------------------------------------------
def test_connect_transitions_through_connecting_to_connected() -> None:
    async def scenario() -> None:
        factory = TransportFactoryStub()
        manager, states = build_manager(factory)

        assert await manager.connect() is True
        assert manager.state is ConnectionState.CONNECTED
        assert states[0] == (ConnectionState.DISCONNECTED, ConnectionState.CONNECTING)
        assert states[1] == (ConnectionState.CONNECTING, ConnectionState.CONNECTED)
        await manager.stop()

    asyncio.run(scenario())


def test_failed_connect_moves_to_error_and_reports_false() -> None:
    async def scenario() -> None:
        factory = TransportFactoryStub(fail_times=99)
        manager, _ = build_manager(factory)

        assert await manager.connect() is False
        assert manager.state is ConnectionState.ERROR
        await manager.stop()

    asyncio.run(scenario())


def test_concurrent_connects_open_exactly_one_socket() -> None:
    """Two callers racing must not produce two live sockets.

    Duplicated connections double the data rate, double the subscription count
    against the venue's cap, and leave an orphaned socket nobody closes.
    """

    async def scenario() -> None:
        factory = TransportFactoryStub()
        manager, _ = build_manager(factory)

        results = await asyncio.gather(*(manager.connect() for _ in range(5)))
        assert all(results)
        assert factory.attempts == 1
        assert len(factory.transports) == 1
        await manager.stop()

    asyncio.run(scenario())


def test_stop_is_terminal_and_refuses_further_connects() -> None:
    async def scenario() -> None:
        factory = TransportFactoryStub()
        manager, _ = build_manager(factory)
        await manager.connect()
        await manager.stop()

        assert manager.state is ConnectionState.STOPPED
        assert await manager.connect() is False
        assert factory.attempts == 1

    asyncio.run(scenario())


def test_stop_closes_the_underlying_transport() -> None:
    async def scenario() -> None:
        factory = TransportFactoryStub()
        manager, _ = build_manager(factory)
        await manager.connect()
        transport = factory.latest
        await manager.stop()
        assert transport.closed is True

    asyncio.run(scenario())


# ----------------------------------------------------------------------
# Message flow
# ----------------------------------------------------------------------
def test_inbound_frames_reach_the_handler() -> None:
    async def scenario() -> None:
        factory = TransportFactoryStub()
        received: list[str] = []
        manager, _ = build_manager(factory, received=received)
        await manager.connect()

        factory.latest.push('{"e":"depthUpdate"}')
        factory.latest.push('{"e":"trade"}')
        await drain()

        assert received == ['{"e":"depthUpdate"}', '{"e":"trade"}']
        await manager.stop()

    asyncio.run(scenario())


def test_handler_exception_does_not_kill_the_feed() -> None:
    """One malformed frame must not take down the whole connection.

    A venue occasionally emits something unexpected; dropping the feed for it
    would turn a cosmetic problem into an outage.
    """

    async def scenario() -> None:
        factory = TransportFactoryStub()
        manager, _ = build_manager(
            factory, on_message_error=ValueError("bad frame")
        )
        await manager.connect()

        factory.latest.push("garbage")
        await drain()

        assert manager.state is ConnectionState.CONNECTED
        health = manager.health()
        assert health.last_error_message is not None
        await manager.stop()

    asyncio.run(scenario())


def test_message_counter_and_health_track_activity() -> None:
    async def scenario() -> None:
        factory = TransportFactoryStub()
        manager, _ = build_manager(factory)
        await manager.connect()

        for index in range(3):
            factory.latest.push(f"msg-{index}")
        await drain()

        health = manager.health()
        assert health.messages_received == 3
        assert health.last_message_at is not None
        assert health.is_healthy is True
        await manager.stop()

    asyncio.run(scenario())


def test_peer_close_moves_the_connection_to_disconnected() -> None:
    async def scenario() -> None:
        factory = TransportFactoryStub()
        manager, _ = build_manager(factory)
        await manager.connect()

        factory.latest.fail(ConnectionClosed("peer went away"))
        await drain()

        assert manager.state is ConnectionState.DISCONNECTED
        await manager.stop()

    asyncio.run(scenario())


# ----------------------------------------------------------------------
# Subscriptions
# ----------------------------------------------------------------------
def test_subscribe_sends_frames_for_each_subscription() -> None:
    async def scenario() -> None:
        factory = TransportFactoryStub()
        subscriptions = SubscriptionManager(exchange="binance")
        first = subscriptions.add(
            MarketDataChannel.ORDER_BOOK, "BTC-USDT", "btcusdt@depth@100ms"
        )
        second = subscriptions.add(MarketDataChannel.TRADES, "BTC-USDT", "btcusdt@trade")

        manager, _ = build_manager(factory, subscriptions=subscriptions)
        await manager.connect()
        assert await manager.subscribe((first, second)) is True

        assert factory.latest.sent == [
            "SUBSCRIBE:btcusdt@depth@100ms",
            "SUBSCRIBE:btcusdt@trade",
        ]
        await manager.stop()

    asyncio.run(scenario())


def test_subscribe_while_disconnected_is_refused() -> None:
    async def scenario() -> None:
        factory = TransportFactoryStub()
        subscriptions = SubscriptionManager(exchange="binance")
        subscription = subscriptions.add(
            MarketDataChannel.TRADES, "BTC-USDT", "btcusdt@trade"
        )
        manager, _ = build_manager(factory, subscriptions=subscriptions)

        assert await manager.subscribe((subscription,)) is False

    asyncio.run(scenario())


def test_restore_demotes_subscriptions_to_pending_before_replaying() -> None:
    """A fresh socket has confirmed nothing.

    Leaving them ACTIVE would report a fully-subscribed feed that is in fact
    delivering nothing — silent data loss.
    """

    async def scenario() -> None:
        factory = TransportFactoryStub()
        subscriptions = SubscriptionManager(exchange="binance")
        subscription = subscriptions.add(
            MarketDataChannel.ORDER_BOOK, "BTC-USDT", "btcusdt@depth@100ms"
        )
        subscription.mark_active()
        assert subscription.status is SubscriptionStatus.ACTIVE

        manager, _ = build_manager(factory, subscriptions=subscriptions)
        await manager.connect()
        await manager.restore_subscriptions()

        assert subscription.status is SubscriptionStatus.PENDING
        assert "SUBSCRIBE:btcusdt@depth@100ms" in factory.latest.sent
        await manager.stop()

    asyncio.run(scenario())


def test_cancelled_subscriptions_are_not_restored() -> None:
    async def scenario() -> None:
        factory = TransportFactoryStub()
        subscriptions = SubscriptionManager(exchange="binance")
        keep = subscriptions.add(
            MarketDataChannel.ORDER_BOOK, "BTC-USDT", "btcusdt@depth@100ms"
        )
        drop = subscriptions.add(MarketDataChannel.TRADES, "ETH-USDT", "ethusdt@trade")
        drop.mark_cancelled()

        manager, _ = build_manager(factory, subscriptions=subscriptions)
        await manager.connect()
        await manager.restore_subscriptions()

        sent = factory.latest.sent
        assert f"SUBSCRIBE:{keep.stream_name}" in sent
        assert f"SUBSCRIBE:{drop.stream_name}" not in sent
        await manager.stop()

    asyncio.run(scenario())


def test_subscription_send_failure_marks_them_failed() -> None:
    async def scenario() -> None:
        factory = TransportFactoryStub()
        subscriptions = SubscriptionManager(exchange="binance")
        subscription = subscriptions.add(
            MarketDataChannel.TRADES, "BTC-USDT", "btcusdt@trade"
        )
        manager, _ = build_manager(factory, subscriptions=subscriptions)
        await manager.connect()

        await factory.latest.close()
        assert await manager.subscribe((subscription,)) is False
        assert subscription.status is SubscriptionStatus.FAILED
        assert subscription.failure_reason is not None
        await manager.stop()

    asyncio.run(scenario())


# ----------------------------------------------------------------------
# Reconnection
# ----------------------------------------------------------------------
def test_reconnect_opens_a_new_socket_and_replays_subscriptions() -> None:
    async def scenario() -> None:
        factory = TransportFactoryStub()
        subscriptions = SubscriptionManager(exchange="binance")
        subscriptions.add(
            MarketDataChannel.ORDER_BOOK, "BTC-USDT", "btcusdt@depth@100ms"
        )
        manager, _ = build_manager(factory, subscriptions=subscriptions)

        await manager.connect()
        first = factory.latest
        assert await manager.reconnect() is True

        assert manager.state is ConnectionState.CONNECTED
        assert len(factory.transports) == 2
        assert factory.latest is not first
        assert first.closed is True
        assert "SUBSCRIBE:btcusdt@depth@100ms" in factory.latest.sent
        assert manager.reconnect_count == 1
        await manager.stop()

    asyncio.run(scenario())


def test_reconnect_increments_the_generation_so_stale_tasks_stand_down() -> None:
    """Fencing check: an old reader must not write into the new socket."""

    async def scenario() -> None:
        factory = TransportFactoryStub()
        manager, _ = build_manager(factory)
        await manager.connect()
        first_generation = manager.generation

        await manager.reconnect()
        assert manager.generation > first_generation
        await manager.stop()

    asyncio.run(scenario())


def test_frames_from_a_superseded_socket_are_ignored() -> None:
    async def scenario() -> None:
        factory = TransportFactoryStub()
        received: list[str] = []
        manager, _ = build_manager(factory, received=received)
        await manager.connect()
        stale = factory.latest

        await manager.reconnect()
        stale.push("from-the-dead-socket")
        await drain()

        assert "from-the-dead-socket" not in received
        await manager.stop()

    asyncio.run(scenario())


def test_reconnect_is_refused_when_disabled() -> None:
    async def scenario() -> None:
        factory = TransportFactoryStub()
        manager, _ = build_manager(factory, reconnect_enabled=False)
        await manager.connect()
        assert await manager.reconnect() is False
        await manager.stop()

    asyncio.run(scenario())


def test_reconnect_gives_up_after_the_attempt_cap_and_stops() -> None:
    """Exhausted retries must end in STOPPED, not an infinite loop."""

    async def scenario() -> None:
        factory = TransportFactoryStub(fail_times=1_000)
        manager, _ = build_manager(factory)

        await manager.connect()  # fails, leaving the manager in ERROR
        for _ in range(20):
            if not await manager.reconnect():
                break

        assert manager.state in (ConnectionState.STOPPED, ConnectionState.ERROR)
        assert factory.attempts <= 15

    asyncio.run(scenario())


def test_run_forever_stops_on_a_non_retryable_error() -> None:
    """An authentication failure must not be retried in a loop."""

    async def scenario() -> None:
        auth_error = NormalisedExchangeError(
            category=ExchangeErrorCategory.AUTHENTICATION_ERROR,
            message="Invalid API key.",
            exchange="binance",
        )
        factory = TransportFactoryStub(fail_times=1_000, error=auth_error)
        manager, _ = build_manager(factory)

        await asyncio.wait_for(manager.run_forever(), timeout=5)

        assert manager.state in (ConnectionState.STOPPED, ConnectionState.ERROR)
        assert factory.attempts == 1

    asyncio.run(scenario())


def test_run_forever_recovers_after_a_transient_drop() -> None:
    async def scenario() -> None:
        factory = TransportFactoryStub()
        received: list[str] = []
        manager, _ = build_manager(factory, received=received)

        supervisor = asyncio.create_task(manager.run_forever())
        for _ in range(20):
            await asyncio.sleep(0)
            if factory.transports:
                break

        factory.latest.fail(ConnectionClosed("transient drop"))

        for _ in range(200):
            await asyncio.sleep(0.001)
            if len(factory.transports) >= 2 and manager.is_connected:
                break

        assert len(factory.transports) >= 2
        assert manager.is_connected is True

        factory.latest.push("after-recovery")
        await drain()
        assert "after-recovery" in received

        await manager.stop()
        supervisor.cancel()
        try:
            await supervisor
        except asyncio.CancelledError:
            pass

    asyncio.run(scenario())


# ----------------------------------------------------------------------
# Heartbeat
# ----------------------------------------------------------------------
def test_heartbeat_timeout_must_exceed_the_interval() -> None:
    """A timeout below the ping interval would kill every healthy connection."""
    with pytest.raises(ValueError, match="heartbeat_timeout_millis"):
        ConnectionConfig(
            url="wss://example.invalid",
            heartbeat_interval_millis=30_000,
            heartbeat_timeout_millis=10_000,
        )


def test_heartbeat_sends_a_ping_frame() -> None:
    async def scenario() -> None:
        factory = TransportFactoryStub()
        manager, _ = build_manager(
            factory, heartbeat_interval_millis=1, heartbeat_timeout_millis=60_000
        )
        await manager.connect()

        for _ in range(50):
            await asyncio.sleep(0.001)
            if "PING" in factory.latest.sent:
                break

        assert "PING" in factory.latest.sent
        await manager.stop()

    asyncio.run(scenario())


def test_silent_connection_is_torn_down_by_the_heartbeat_timeout() -> None:
    """An open socket delivering nothing is dead and must be treated as such."""

    async def scenario() -> None:
        factory = TransportFactoryStub()
        manager, _ = build_manager(
            factory, heartbeat_interval_millis=1, heartbeat_timeout_millis=2
        )
        await manager.connect()

        for _ in range(200):
            await asyncio.sleep(0.001)
            if manager.state is not ConnectionState.CONNECTED:
                break

        assert manager.state is ConnectionState.DISCONNECTED
        health = manager.health()
        assert health.last_error_category == ExchangeErrorCategory.TIMEOUT.value
        await manager.stop()

    asyncio.run(scenario())
