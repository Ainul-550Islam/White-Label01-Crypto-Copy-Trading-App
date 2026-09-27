"""Reusable websocket connection manager.

This owns the lifecycle of exactly one websocket: connecting, heartbeating,
detecting death, backing off, reconnecting, and replaying subscriptions. It is
venue-agnostic — everything venue-specific (URL construction, subscribe frame
format, ping/pong dialect) is supplied by the adapter through
:class:`ConnectionCallbacks`.

Testability
-----------
The manager never imports a websocket library. It talks to a
:class:`WebSocketTransport` protocol supplied by a factory, so the entire
lifecycle — including reconnect storms, heartbeat timeouts and subscription
restoration — is driven in tests by an in-memory fake with no network, no
sleeping and no flakiness. The production factory that wraps ``websockets`` is
a thin adapter implementing three methods.

Concurrency safety
------------------
Two bugs are specifically designed out:

* **Double connections.** Every connect path goes through ``_connect_lock``, and
  each successful connect increments a generation counter. Reader and heartbeat
  tasks capture their generation and exit immediately if it has moved on, so a
  task belonging to a superseded socket cannot resurrect itself or write to the
  new one.
* **Runaway reconnects.** Backoff is mandatory, the attempt cap is honoured, and
  a non-retryable error category drives the connection to ``STOPPED`` rather
  than looping.
"""

from __future__ import annotations

import asyncio
import contextlib
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Protocol, runtime_checkable

from wlct_trading.clock import epoch_micros
from wlct_trading.transport.backoff import BackoffConfig, ExponentialBackoff
from wlct_trading.transport.errors import (
    RETRY_POLICIES,
    ExchangeErrorCategory,
    NormalisedExchangeError,
)
from wlct_trading.transport.state import (
    ConnectionHealth,
    ConnectionState,
    InvalidConnectionTransition,
    LatencyStats,
    is_legal_connection_transition,
)
from wlct_trading.transport.subscriptions import Subscription, SubscriptionManager

__all__ = [
    "WebSocketTransport",
    "TransportFactory",
    "ConnectionCallbacks",
    "ConnectionConfig",
    "WebSocketConnectionManager",
    "ConnectionClosed",
    # Re-exported explicitly: consumers (wlct_trading.net.feed) read the
    # transport state through this module, and under no-implicit-reexport a
    # bare import would make that a type error for them.
    "ConnectionState",
]


class ConnectionClosed(Exception):
    """Raised by a transport when the peer has gone away."""


@runtime_checkable
class WebSocketTransport(Protocol):
    """Minimal websocket surface the manager depends on.

    Deliberately three methods. A wider interface would couple the manager to
    one library's semantics and make the test double harder to trust.
    """

    async def send(self, message: str) -> None:
        """Send one text frame."""
        ...

    async def receive(self) -> str:
        """Await the next text frame. Raise :class:`ConnectionClosed` on close."""
        ...

    async def close(self) -> None:
        """Close the socket. Must be idempotent."""
        ...


#: Builds a transport for a URL. Raising from here is a connect failure and is
#: normalised into a ``NETWORK_ERROR`` unless it is already normalised.
TransportFactory = Callable[[str], Awaitable[WebSocketTransport]]


@dataclass(slots=True)
class ConnectionCallbacks:
    """Venue-specific behaviour injected into the generic manager.

    Every field is optional except ``on_message``; a venue that needs no
    application-level heartbeat simply leaves the ping hooks unset and relies on
    protocol-level pings.
    """

    #: Handle one decoded inbound frame. Runs on the read loop, so it must not
    #: block: hand expensive work to a queue.
    on_message: Callable[[str], Awaitable[None] | None]
    #: Build the frame(s) that subscribe to the given streams.
    build_subscribe_frames: Callable[[tuple[Subscription, ...]], tuple[str, ...]] | None = None
    #: Build the frame(s) that unsubscribe from the given streams.
    build_unsubscribe_frames: Callable[[tuple[Subscription, ...]], tuple[str, ...]] | None = None
    #: Build an application-level ping frame. ``None`` means the venue uses
    #: protocol-level ping/pong and needs no application frame.
    build_ping_frame: Callable[[], str] | None = None
    #: Classify a raw exception into the normalised taxonomy.
    classify_error: Callable[[BaseException], NormalisedExchangeError] | None = None
    #: Notified on every state change, for event emission and logging.
    on_state_change: Callable[[ConnectionState, ConnectionState], None] | None = None
    #: Notified when a normalised error occurs.
    on_error: Callable[[NormalisedExchangeError], None] | None = None


@dataclass(slots=True, frozen=True)
class ConnectionConfig:
    """Timing and policy for one connection.

    Defaults suit exchange market-data sockets. ``heartbeat_timeout_millis``
    must exceed ``heartbeat_interval_millis``, otherwise a connection would be
    declared dead before its first ping could possibly be answered.
    """

    url: str
    name: str = "market-data"
    connect_timeout_millis: int = 10_000
    heartbeat_interval_millis: int = 20_000
    #: Silence after which the socket is considered dead and torn down.
    heartbeat_timeout_millis: int = 60_000
    backoff: BackoffConfig = field(default_factory=BackoffConfig)
    reconnect_enabled: bool = True
    #: Delay between individual subscribe frames, to respect per-second caps.
    subscribe_pacing_millis: int = 250

    def __post_init__(self) -> None:
        if self.connect_timeout_millis <= 0:
            raise ValueError("connect_timeout_millis must be positive.")
        if self.heartbeat_interval_millis <= 0:
            raise ValueError("heartbeat_interval_millis must be positive.")
        if self.heartbeat_timeout_millis <= self.heartbeat_interval_millis:
            raise ValueError(
                "heartbeat_timeout_millis must exceed heartbeat_interval_millis, "
                "otherwise a healthy connection is killed before it can respond."
            )


class WebSocketConnectionManager:
    """Manages one websocket connection end to end."""

    __slots__ = (
        "_config",
        "_factory",
        "_callbacks",
        "_subscriptions",
        "_exchange",
        "_state",
        "_transport",
        "_backoff",
        "_connect_lock",
        "_generation",
        "_reader_task",
        "_heartbeat_task",
        "_connected_at",
        "_last_message_at",
        "_last_heartbeat_at",
        "_last_error",
        "_last_error_at",
        "_reconnect_count",
        "_messages_received",
        "_latency",
        "_stopped",
    )

    def __init__(
        self,
        config: ConnectionConfig,
        transport_factory: TransportFactory,
        callbacks: ConnectionCallbacks,
        subscriptions: SubscriptionManager,
        *,
        exchange: str = "unknown",
    ) -> None:
        self._config = config
        self._factory = transport_factory
        self._callbacks = callbacks
        self._subscriptions = subscriptions
        self._exchange = exchange

        self._state = ConnectionState.DISCONNECTED
        self._transport: WebSocketTransport | None = None
        self._backoff = ExponentialBackoff(config.backoff)
        self._connect_lock = asyncio.Lock()
        self._generation = 0
        self._reader_task: asyncio.Task[None] | None = None
        self._heartbeat_task: asyncio.Task[None] | None = None

        self._connected_at: int | None = None
        self._last_message_at: int | None = None
        self._last_heartbeat_at: int | None = None
        self._last_error: NormalisedExchangeError | None = None
        self._last_error_at: int | None = None
        self._reconnect_count = 0
        self._messages_received = 0
        self._latency = LatencyStats()
        self._stopped = False

    # ------------------------------------------------------------------
    # Observable state
    # ------------------------------------------------------------------
    @property
    def state(self) -> ConnectionState:
        return self._state

    @property
    def is_connected(self) -> bool:
        return self._state is ConnectionState.CONNECTED

    @property
    def subscriptions(self) -> SubscriptionManager:
        return self._subscriptions

    @property
    def generation(self) -> int:
        """Increments on every successful connect. Used to fence stale tasks."""
        return self._generation

    @property
    def reconnect_count(self) -> int:
        return self._reconnect_count

    def health(self, *, is_stale: bool = False) -> ConnectionHealth:
        """Current health snapshot, safe to publish."""
        return ConnectionHealth(
            exchange=self._exchange,
            connection_name=self._config.name,
            state=self._state,
            connected_at=self._connected_at,
            last_message_at=self._last_message_at,
            last_heartbeat_at=self._last_heartbeat_at,
            last_error_at=self._last_error_at,
            last_error_category=(
                self._last_error.category.value if self._last_error else None
            ),
            last_error_message=self._last_error.message if self._last_error else None,
            reconnect_count=self._reconnect_count,
            subscription_count=self._subscriptions.active_count,
            messages_received=self._messages_received,
            is_stale=is_stale,
            latency=self._latency,
        )

    # ------------------------------------------------------------------
    # State machine
    # ------------------------------------------------------------------
    def _transition(self, target: ConnectionState) -> None:
        """Move to ``target``, refusing illegal edges."""
        if target is self._state:
            return
        if not is_legal_connection_transition(self._state, target):
            raise InvalidConnectionTransition(self._config.name, self._state, target)
        previous = self._state
        self._state = target
        if self._callbacks.on_state_change is not None:
            self._callbacks.on_state_change(previous, target)

    def _try_transition(self, target: ConnectionState) -> bool:
        """Non-raising transition, for teardown paths that may race."""
        if target is self._state:
            return True
        if not is_legal_connection_transition(self._state, target):
            return False
        self._transition(target)
        return True

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    async def connect(self) -> bool:
        """Open the socket and start the reader and heartbeat tasks.

        Returns ``True`` on success. Serialised by a lock so two concurrent
        callers cannot open two sockets.
        """
        async with self._connect_lock:
            if self._stop_requested():
                return False
            if self._state is ConnectionState.CONNECTED:
                return True
            return await self._open()

    async def _open(self) -> bool:
        """Perform one connect attempt. Caller must hold ``_connect_lock``."""
        if self._state not in (
            ConnectionState.CONNECTING,
            ConnectionState.RECONNECTING,
        ):
            self._transition(ConnectionState.CONNECTING)

        try:
            transport = await asyncio.wait_for(
                self._factory(self._config.url),
                timeout=self._config.connect_timeout_millis / 1000,
            )
        except asyncio.TimeoutError as exc:
            self._record_error(
                self._normalise(
                    exc,
                    default_category=ExchangeErrorCategory.TIMEOUT,
                    message=(
                        f"Connect to {self._config.name} timed out after "
                        f"{self._config.connect_timeout_millis}ms."
                    ),
                )
            )
            self._try_transition(ConnectionState.ERROR)
            return False
        except BaseException as exc:  # noqa: BLE001 - normalised below
            self._record_error(
                self._normalise(
                    exc, default_category=ExchangeErrorCategory.NETWORK_ERROR
                )
            )
            self._try_transition(ConnectionState.ERROR)
            return False

        self._transport = transport
        self._generation += 1
        self._connected_at = epoch_micros()
        self._last_message_at = self._connected_at
        self._last_heartbeat_at = self._connected_at
        self._transition(ConnectionState.CONNECTED)
        self._backoff.reset()

        generation = self._generation
        self._reader_task = asyncio.create_task(
            self._read_loop(generation), name=f"ws-read-{self._config.name}"
        )
        self._heartbeat_task = asyncio.create_task(
            self._heartbeat_loop(generation), name=f"ws-hb-{self._config.name}"
        )
        return True

    async def disconnect(self) -> None:
        """Close the socket without stopping the manager.

        The connection may be reconnected afterwards; use :meth:`stop` for a
        permanent shutdown.
        """
        await self._teardown()
        self._try_transition(ConnectionState.DISCONNECTED)

    def _stop_requested(self) -> bool:
        """Read the stop flag through a call site mypy cannot narrow.

        ``_stopped`` is set by :meth:`stop`, potentially from another task
        while a caller of this loop is suspended at an ``await``. Attribute
        narrowing across awaits cannot see that write, so flow analysis on the
        bare ``self._stopped`` would wrongly mark every later "am I stopped?"
        check unreachable. The indirection is the fix, and it documents
        itself.
        """
        return self._stopped

    async def stop(self) -> None:
        """Permanently stop. Terminal — the manager will not reconnect."""
        self._stopped = True
        await self._teardown()
        self._try_transition(ConnectionState.STOPPED)

    async def _teardown(self) -> None:
        """Cancel tasks and close the transport. Safe to call repeatedly."""
        # Bump the generation first so in-flight tasks observe that they are
        # stale even before cancellation is delivered.
        self._generation += 1

        for task in (self._reader_task, self._heartbeat_task):
            if task is not None and not task.done():
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await task
        self._reader_task = None
        self._heartbeat_task = None

        if self._transport is not None:
            with contextlib.suppress(Exception):
                await self._transport.close()
            self._transport = None

    async def reconnect(self) -> bool:
        """Tear down and reconnect once, honouring backoff and the attempt cap.

        Returns ``True`` if the connection was re-established. Callers that want
        persistent retry should use :meth:`run_forever`.
        """
        if self._stop_requested() or not self._config.reconnect_enabled:
            return False

        await self._teardown()

        if not self._backoff.can_retry():
            self._record_error(
                NormalisedExchangeError(
                    category=ExchangeErrorCategory.NETWORK_ERROR,
                    message=(
                        f"Giving up on {self._config.name} after "
                        f"{self._backoff.attempt} reconnect attempts."
                    ),
                    exchange=self._exchange,
                )
            )
            self._try_transition(ConnectionState.ERROR)
            self._try_transition(ConnectionState.STOPPED)
            self._stopped = True
            return False

        self._try_transition(ConnectionState.RECONNECTING)

        multiplier = 1.0
        if self._last_error is not None:
            multiplier = RETRY_POLICIES[self._last_error.category].backoff_multiplier
        delay_millis = self._backoff.next_delay_millis(multiplier=multiplier)
        await asyncio.sleep(delay_millis / 1000)

        if self._stop_requested():
            return False

        self._reconnect_count += 1

        async with self._connect_lock:
            connected = await self._open()

        if connected:
            await self.restore_subscriptions()
        return connected

    async def run_forever(self) -> None:
        """Connect and keep the connection alive until :meth:`stop`.

        This is the supervisor loop. It exits only on an explicit stop, a
        non-retryable error, or exhaustion of the attempt cap — never silently.
        """
        if not await self.connect():
            if not self._should_keep_retrying():
                return

        while not self._stop_requested():
            # Wait for the reader to finish, which happens on disconnect.
            if self._reader_task is not None:
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await self._reader_task

            if self._stop_requested():
                break
            if not self._should_keep_retrying():
                self._try_transition(ConnectionState.ERROR)
                self._try_transition(ConnectionState.STOPPED)
                self._stopped = True
                break
            if not await self.reconnect():
                if self._stop_requested():
                    break

    def _should_keep_retrying(self) -> bool:
        """Whether the last error permits another attempt."""
        if not self._config.reconnect_enabled:
            return False
        if self._last_error is None:
            return True
        return self._last_error.is_retryable

    # ------------------------------------------------------------------
    # Subscriptions
    # ------------------------------------------------------------------
    async def subscribe(self, subscriptions: tuple[Subscription, ...]) -> bool:
        """Send subscribe frames for the given subscriptions."""
        if not subscriptions:
            return True
        if self._transport is None or not self.is_connected:
            return False
        if self._callbacks.build_subscribe_frames is None:
            return False

        frames = self._callbacks.build_subscribe_frames(subscriptions)
        try:
            for index, frame in enumerate(frames):
                if index > 0 and self._config.subscribe_pacing_millis > 0:
                    await asyncio.sleep(self._config.subscribe_pacing_millis / 1000)
                await self._transport.send(frame)
        except BaseException as exc:  # noqa: BLE001 - normalised below
            error = self._normalise(
                exc, default_category=ExchangeErrorCategory.SUBSCRIPTION_ERROR
            )
            self._record_error(error)
            for subscription in subscriptions:
                subscription.mark_failed(error.message)
            return False
        return True

    async def unsubscribe(self, subscriptions: tuple[Subscription, ...]) -> bool:
        """Send unsubscribe frames for the given subscriptions."""
        if not subscriptions:
            return True
        if self._transport is None or not self.is_connected:
            return False
        if self._callbacks.build_unsubscribe_frames is None:
            return False

        frames = self._callbacks.build_unsubscribe_frames(subscriptions)
        try:
            for frame in frames:
                await self._transport.send(frame)
        except BaseException as exc:  # noqa: BLE001 - normalised below
            self._record_error(
                self._normalise(
                    exc, default_category=ExchangeErrorCategory.SUBSCRIPTION_ERROR
                )
            )
            return False
        return True

    async def restore_subscriptions(self) -> bool:
        """Replay every non-cancelled subscription onto the new socket.

        The new socket has confirmed nothing, so everything is demoted to
        PENDING first. Without that step a reconnected-but-unsubscribed feed
        would keep reporting itself fully subscribed while delivering nothing.
        """
        self._subscriptions.mark_all_pending()
        restorable = self._subscriptions.restorable()
        if not restorable:
            return True
        return await self.subscribe(restorable)

    # ------------------------------------------------------------------
    # Read and heartbeat loops
    # ------------------------------------------------------------------
    async def _read_loop(self, generation: int) -> None:
        """Consume frames until the socket closes or the generation moves on."""
        transport = self._transport
        if transport is None:
            return

        try:
            while not self._stop_requested() and generation == self._generation:
                try:
                    raw = await transport.receive()
                except (ConnectionClosed, asyncio.IncompleteReadError) as exc:
                    self._record_error(
                        self._normalise(
                            exc,
                            default_category=ExchangeErrorCategory.NETWORK_ERROR,
                            message=f"{self._config.name} closed by peer.",
                        )
                    )
                    break
                except asyncio.CancelledError:
                    raise
                except BaseException as exc:  # noqa: BLE001 - normalised below
                    self._record_error(
                        self._normalise(
                            exc, default_category=ExchangeErrorCategory.NETWORK_ERROR
                        )
                    )
                    break

                # Stamp arrival before any parsing work, so the recorded
                # receive time reflects the wire, not our own processing.
                received_at = epoch_micros()
                if generation != self._generation:
                    break

                self._last_message_at = received_at
                self._messages_received += 1

                try:
                    result = self._callbacks.on_message(raw)
                    if asyncio.iscoroutine(result):
                        await result
                except asyncio.CancelledError:
                    raise
                except BaseException as exc:  # noqa: BLE001 - isolate handler bugs
                    # A malformed frame or a bug in one handler must not kill
                    # the feed; record and keep reading.
                    self._record_error(
                        self._normalise(
                            exc, default_category=ExchangeErrorCategory.EXCHANGE_ERROR
                        )
                    )
        except asyncio.CancelledError:
            raise
        finally:
            if generation == self._generation and not self._stop_requested():
                self._try_transition(ConnectionState.DISCONNECTED)

    async def _heartbeat_loop(self, generation: int) -> None:
        """Send periodic pings and enforce the silence timeout."""
        interval = self._config.heartbeat_interval_millis / 1000
        timeout_micros = self._config.heartbeat_timeout_millis * 1_000

        try:
            while not self._stop_requested() and generation == self._generation:
                await asyncio.sleep(interval)
                if self._stop_requested() or generation != self._generation:
                    return

                now = epoch_micros()
                last = self._last_message_at or self._connected_at or now
                if now - last > timeout_micros:
                    # Socket looks open but nothing is arriving. Treat as dead
                    # and let the supervisor reconnect; this is the failure the
                    # heartbeat exists to catch.
                    self._record_error(
                        NormalisedExchangeError(
                            category=ExchangeErrorCategory.TIMEOUT,
                            message=(
                                f"{self._config.name} received no data for "
                                f"{(now - last) // 1000}ms, exceeding the "
                                f"{self._config.heartbeat_timeout_millis}ms timeout."
                            ),
                            exchange=self._exchange,
                        )
                    )
                    await self._teardown()
                    self._try_transition(ConnectionState.DISCONNECTED)
                    return

                if self._callbacks.build_ping_frame is None or self._transport is None:
                    continue

                sent_at = epoch_micros()
                try:
                    await self._transport.send(self._callbacks.build_ping_frame())
                    self._last_heartbeat_at = sent_at
                    self._latency = self._latency.with_ping(epoch_micros() - sent_at)
                except asyncio.CancelledError:
                    raise
                except BaseException as exc:  # noqa: BLE001 - normalised below
                    self._record_error(
                        self._normalise(
                            exc, default_category=ExchangeErrorCategory.NETWORK_ERROR
                        )
                    )
                    return
        except asyncio.CancelledError:
            raise

    # ------------------------------------------------------------------
    # Bookkeeping
    # ------------------------------------------------------------------
    def record_feed_lag(self, lag_micros: int) -> None:
        """Record exchange-timestamp-to-receipt lag for the latest message."""
        self._latency = self._latency.with_feed_lag(lag_micros)

    def record_heartbeat(self, *, at_micros: int | None = None) -> None:
        """Note an inbound pong or server heartbeat."""
        self._last_heartbeat_at = at_micros if at_micros is not None else epoch_micros()

    def _record_error(self, error: NormalisedExchangeError) -> None:
        self._last_error = error
        self._last_error_at = epoch_micros()
        if self._callbacks.on_error is not None:
            self._callbacks.on_error(error)

    def _normalise(
        self,
        exc: BaseException,
        *,
        default_category: ExchangeErrorCategory,
        message: str | None = None,
    ) -> NormalisedExchangeError:
        """Convert a raw exception into the normalised taxonomy."""
        if isinstance(exc, NormalisedExchangeError):
            return exc
        if self._callbacks.classify_error is not None:
            try:
                return self._callbacks.classify_error(exc)
            except Exception:  # noqa: BLE001 - fall through to the default
                pass
        return NormalisedExchangeError(
            category=default_category,
            message=message or f"{type(exc).__name__}: {exc}",
            exchange=self._exchange,
            metadata={"exceptionType": type(exc).__name__},
        )
