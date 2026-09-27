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
