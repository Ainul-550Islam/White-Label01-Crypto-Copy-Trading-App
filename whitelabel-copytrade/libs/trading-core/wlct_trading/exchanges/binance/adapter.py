"""Binance spot market-data adapter.

Implements the Part 2 :class:`~wlct_trading.adapters.base.MarketDataAdapter`
contract using the generic transport layer. Nothing above this file knows that
Binance uses lower-case stream names, millisecond timestamps or ``U``/``u``
sequence ranges.

No credentials
--------------
This adapter is market-data only and never accepts an API key. Binance spot
market data is public, so requiring credentials here would mean handling secrets
in a service that has no need for them — the smaller the surface holding key
material, the better. Order placement lives behind ``TradingAdapter``, which
takes a credential *resolver* rather than raw secrets.

Dependency injection
--------------------
HTTP and websocket access arrive as injected callables. In production they wrap
``aiohttp`` and ``websockets``; in tests they are dictionaries and lists. The
adapter's own logic — weight accounting, symbol mapping, parsing, stream
assembly — is therefore covered without a network.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncIterator, Awaitable, Callable, Mapping, Sequence

from wlct_trading.adapters.base import (
    AdapterConnectionError,
    AdapterError,
    AdapterRateLimitedError,
    MarketDataAdapter,
    SymbolSpecification,
)
from wlct_trading.clock import epoch_micros
from wlct_trading.enums import ExchangeId
from wlct_trading.exchanges.binance.capabilities import (
    BINANCE_SPOT_CAPABILITIES,
    BINANCE_SPOT_REST_BASE,
    BINANCE_SPOT_WS_BASE,
    BINANCE_TESTNET_REST_BASE,
    BINANCE_TESTNET_WS_BASE,
    depth_endpoint_weight,
)
from wlct_trading.exchanges.binance.parsers import (
    BinanceParseError,
    parse_book_ticker,
    parse_depth_delta,
    parse_depth_snapshot,
    parse_exchange_info,
    parse_kline,
    parse_rest_kline,
    parse_ticker,
    parse_trade,
    stream_name,
    unwrap_combined_stream,
)
from wlct_trading.exchanges.symbols import SymbolMapping, SymbolRegistry
from wlct_trading.market_data import (
    Candle,
    OrderBookDelta,
    OrderBookSnapshot,
    PublicTrade,
    SymbolRef,
    Ticker,
)
from wlct_trading.transport.errors import (
    ExchangeErrorCategory,
    NormalisedExchangeError,
)
from wlct_trading.transport.ratelimit import RateLimitRegistry
from wlct_trading.transport.subscriptions import (
    MarketDataChannel,
    Subscription,
    SubscriptionManager,
)
from wlct_trading.transport.websocket import (
    ConnectionCallbacks,
    ConnectionConfig,
    TransportFactory,
    WebSocketConnectionManager,
)

__all__ = [
    "HttpGetter",
    "BinanceMarketDataAdapter",
    "classify_binance_error",
    "BINANCE_ERROR_CODE_CATEGORIES",
    "channel_suffix",
]

#: ``(url, params) -> decoded JSON``. Must parse numbers as strings; see
#: :func:`~wlct_trading.exchanges.binance.parsers.parse_decimal`.
HttpGetter = Callable[[str, Mapping[str, Any]], Awaitable[Any]]

#: Binance error codes mapped to the platform's error taxonomy. Codes not listed
#: fall back to a category derived from the HTTP status, and finally to
#: ``EXCHANGE_ERROR`` — never to "retry forever".
BINANCE_ERROR_CODE_CATEGORIES: dict[int, ExchangeErrorCategory] = {
    -1000: ExchangeErrorCategory.EXCHANGE_ERROR,  # UNKNOWN
    -1001: ExchangeErrorCategory.NETWORK_ERROR,  # DISCONNECTED
    -1002: ExchangeErrorCategory.AUTHENTICATION_ERROR,  # UNAUTHORIZED
    -1003: ExchangeErrorCategory.RATE_LIMIT_ERROR,  # TOO_MANY_REQUESTS
    -1006: ExchangeErrorCategory.EXCHANGE_ERROR,  # UNEXPECTED_RESP
    -1007: ExchangeErrorCategory.TIMEOUT,  # TIMEOUT
    -1013: ExchangeErrorCategory.INVALID_REQUEST,  # INVALID_MESSAGE / filters
    -1015: ExchangeErrorCategory.RATE_LIMIT_ERROR,  # TOO_MANY_ORDERS
    -1021: ExchangeErrorCategory.INVALID_REQUEST,  # INVALID_TIMESTAMP
    -1022: ExchangeErrorCategory.AUTHENTICATION_ERROR,  # INVALID_SIGNATURE
    -1100: ExchangeErrorCategory.INVALID_REQUEST,  # ILLEGAL_CHARS
    -1121: ExchangeErrorCategory.INVALID_REQUEST,  # BAD_SYMBOL
    -2010: ExchangeErrorCategory.INVALID_REQUEST,  # NEW_ORDER_REJECTED
    -2011: ExchangeErrorCategory.INVALID_REQUEST,  # CANCEL_REJECTED
    -2013: ExchangeErrorCategory.INVALID_REQUEST,  # NO_SUCH_ORDER
    -2014: ExchangeErrorCategory.AUTHENTICATION_ERROR,  # BAD_API_KEY_FMT
    -2015: ExchangeErrorCategory.AUTHENTICATION_ERROR,  # REJECTED_MBX_KEY
}


def classify_binance_error(
    exc: BaseException, *, http_status: int | None = None
) -> NormalisedExchangeError:
    """Map a Binance failure onto the platform's error taxonomy.

    HTTP 418 is Binance's "you have been banned for ignoring 429" status and is
    treated as a rate-limit error so the retry policy applies its long backoff
    rather than hammering a banned IP.
    """
    if isinstance(exc, NormalisedExchangeError):
        return exc

    code: int | None = None
    message = str(exc)
    raw_code = getattr(exc, "code", None)
    if isinstance(raw_code, int):
        code = raw_code
    elif isinstance(raw_code, str):
        try:
            code = int(raw_code)
        except ValueError:
            code = None

    if code is not None and code in BINANCE_ERROR_CODE_CATEGORIES:
        category = BINANCE_ERROR_CODE_CATEGORIES[code]
    elif http_status in (418, 429):
        category = ExchangeErrorCategory.RATE_LIMIT_ERROR
    elif http_status in (401, 403):
        category = ExchangeErrorCategory.AUTHENTICATION_ERROR
    elif http_status is not None and 500 <= http_status < 600:
        category = ExchangeErrorCategory.EXCHANGE_ERROR
    elif http_status is not None and 400 <= http_status < 500:
        category = ExchangeErrorCategory.INVALID_REQUEST
    elif isinstance(exc, BinanceParseError):
        category = ExchangeErrorCategory.EXCHANGE_ERROR
    elif isinstance(exc, asyncio.TimeoutError):
        category = ExchangeErrorCategory.TIMEOUT
    else:
        category = ExchangeErrorCategory.NETWORK_ERROR

    metadata: dict[str, Any] = {"exceptionType": type(exc).__name__}
    if http_status is not None:
        metadata["httpStatus"] = http_status

    return NormalisedExchangeError(
        category=category,
        message=message,
        exchange=ExchangeId.BINANCE.value,
        venue_code=str(code) if code is not None else None,
        venue_message=getattr(exc, "msg", None),
        retry_after_millis=getattr(exc, "retry_after_millis", None),
        metadata=metadata,
    )


def channel_suffix(
    channel: MarketDataChannel, *, interval: str = "1m", update_speed_ms: int = 100
) -> str:
    """Binance stream suffix for a channel.

    The book uses the ``@100ms`` diff cadence rather than the 1 000 ms default:
    a full second of aggregated changes is a long time to be blind, and the
    faster stream costs nothing extra in weight.
    """
    if channel is MarketDataChannel.ORDER_BOOK:
        return f"depth@{update_speed_ms}ms"
    if channel is MarketDataChannel.TRADES:
        return "trade"
    if channel is MarketDataChannel.BOOK_TICKER:
        return "bookTicker"
    if channel is MarketDataChannel.TICKER:
        return "ticker"
    if channel is MarketDataChannel.CANDLES:
        return f"kline_{interval}"
    raise ValueError(f"Binance has no stream for channel {channel.value}.")


def _validated_base(base: str, *, scheme: str, name: str) -> str:
    """Reject a non-TLS or empty endpoint, and strip a trailing slash.

    The trailing slash matters: every path in this module is written with a
    leading one, and ``https://host//api/v3/depth`` is a 404 on some proxies.
    """
    cleaned = base.strip().rstrip("/")
    if not cleaned.startswith(scheme):
        raise ValueError(
            f"Binance {name} must start with {scheme!r}; got {base!r}."
        )
    return cleaned


class BinanceMarketDataAdapter(MarketDataAdapter):
    """Public market data from Binance spot."""

    __slots__ = (
        "_http_get",
        "_transport_factory",
        "_symbols",
        "_rest_base",
        "_ws_base",
        "_limits",
        "_testnet",
        "_request_id",
        "_specifications",
    )

    def __init__(
        self,
        http_get: HttpGetter,
        *,
        symbol_registry: SymbolRegistry | None = None,
        transport_factory: TransportFactory | None = None,
        testnet: bool = False,
        rate_limits: RateLimitRegistry | None = None,
        rest_base: str | None = None,
        ws_base: str | None = None,
    ) -> None:
        """Public market data from Binance spot.

        ``rest_base`` and ``ws_base`` override the endpoints derived from
        ``testnet``. They exist because the venue publishes more than two hosts
        that speak the same public API — notably the market-data-only mirror
        used in regions where the main host is unavailable — and because the
        alternative is every caller string-concatenating its own URLs, which is
        how a service ends up streaming from one host and snapshotting from
        another.

        Both are validated as TLS. There is no way to configure a plaintext
        endpoint: market data an attacker can rewrite is a way to induce bad
        trades.
        """
        self._http_get = http_get
        self._transport_factory = transport_factory
        self._symbols = symbol_registry or SymbolRegistry()
        self._testnet = testnet
        self._rest_base = _validated_base(
            rest_base
            or (BINANCE_TESTNET_REST_BASE if testnet else BINANCE_SPOT_REST_BASE),
            scheme="https://",
            name="rest_base",
        )
        self._ws_base = _validated_base(
            ws_base or (BINANCE_TESTNET_WS_BASE if testnet else BINANCE_SPOT_WS_BASE),
            scheme="wss://",
            name="ws_base",
        )
        self._limits = rate_limits or RateLimitRegistry.from_rules(
            BINANCE_SPOT_CAPABILITIES.rate_limit_rules
        )
        self._request_id = 0
        self._specifications: dict[str, SymbolSpecification] = {}

    # ------------------------------------------------------------------
    # Identity
    # ------------------------------------------------------------------
    @property
    def exchange(self) -> ExchangeId:
        return ExchangeId.BINANCE

    @property
    def symbol_registry(self) -> SymbolRegistry:
        return self._symbols

    @property
    def rate_limits(self) -> RateLimitRegistry:
        return self._limits

    @property
    def is_testnet(self) -> bool:
        return self._testnet

    @property
    def rest_base(self) -> str:
        """The REST host actually in use, after any override."""
        return self._rest_base

    @property
    def ws_base(self) -> str:
        """The websocket host actually in use, after any override."""
        return self._ws_base

    def specification(self, canonical_symbol: str) -> SymbolSpecification | None:
        """Trading rules for a symbol, once :meth:`load_symbols` has run."""
        return self._specifications.get(canonical_symbol.upper())

    # ------------------------------------------------------------------
    # REST
    # ------------------------------------------------------------------
    def _spend(self, operation: str, weight: int, raw_requests: int = 1) -> None:
        """Reserve rate-limit budget before a request leaves.

        Raises rather than queueing. The caller — the synchroniser or a
        scheduled refresh — already has a backoff policy, and adding a second
        implicit one inside the adapter makes the real delay unknowable.
        """
        allowed, decisions = self._limits.try_acquire_all(
            {"REQUEST_WEIGHT": weight, "RAW_REQUESTS": raw_requests}
        )
        if not allowed:
            decision = decisions[0]
            # Refuse locally instead of letting the venue ban the IP. The
            # retry hint is the caller's, and the backoff policy already
            # knows what to do with it.
            raise AdapterRateLimitedError(decision.retry_after_millis)

    async def _get(self, path: str, params: Mapping[str, Any], operation: str) -> Any:
        try:
            return await self._http_get(f"{self._rest_base}{path}", params)
        except asyncio.CancelledError:
            raise
        except AdapterError:
            raise
        except BaseException as exc:  # noqa: BLE001 - normalised for the caller
            normalised = classify_binance_error(exc)
            raise AdapterConnectionError(
                f"Binance {operation} failed: {normalised.message}"
            ) from exc

    async def load_symbols(self) -> tuple[SymbolSpecification, ...]:
        """Fetch instrument metadata and populate the symbol registry.

        This is what makes symbol translation authoritative rather than
        heuristic, so it runs before any subscription or order.
        """
        self._spend("exchangeInfo", BINANCE_SPOT_CAPABILITIES.rest_weight("exchange_info", 20))
        payload = await self._get("/api/v3/exchangeInfo", {}, "exchangeInfo")
        if not isinstance(payload, Mapping):
            raise AdapterError("Binance exchangeInfo did not return an object.")

        specifications = parse_exchange_info(payload)
        for specification in specifications:
            self._symbols.register_specification(specification)
            self._specifications[specification.symbol] = specification
        return specifications

    async def fetch_order_book_snapshot(
        self, symbol: SymbolRef, depth: int
    ) -> OrderBookSnapshot:
        """Fetch a depth image for the synchroniser."""
        legal_depth = BINANCE_SPOT_CAPABILITIES.nearest_snapshot_depth(depth)
        self._spend(f"depth(limit={legal_depth})", depth_endpoint_weight(legal_depth))

        payload = await self._get(
            "/api/v3/depth",
            {"symbol": symbol.venue_symbol.upper(), "limit": legal_depth},
            "depth",
        )
        if not isinstance(payload, Mapping):
            raise AdapterError("Binance depth did not return an object.")
        return parse_depth_snapshot(payload, symbol.symbol)

    async def fetch_candles(
        self, symbol: SymbolRef, interval: str, limit: int
    ) -> tuple[Candle, ...]:
        """Fetch historical bars. Candles are the one shape worth persisting."""
        self._spend("klines", BINANCE_SPOT_CAPABILITIES.rest_weight("klines", 2))
        payload = await self._get(
            "/api/v3/klines",
            {
                "symbol": symbol.venue_symbol.upper(),
                "interval": interval,
                "limit": min(max(limit, 1), 1_000),
            },
            "klines",
        )
        if not isinstance(payload, Sequence):
            raise AdapterError("Binance klines did not return an array.")

        received = epoch_micros()
        return tuple(
            parse_rest_kline(row, symbol.symbol, interval, received_timestamp=received)
            for row in payload
            if isinstance(row, Sequence) and not isinstance(row, (str, bytes))
        )

    # ------------------------------------------------------------------
    # Websocket plumbing
    # ------------------------------------------------------------------
    def _next_request_id(self) -> int:
        self._request_id += 1
        return self._request_id

    def build_subscribe_frames(
        self, subscriptions: tuple[Subscription, ...]
    ) -> tuple[str, ...]:
        """Batch streams into SUBSCRIBE frames.

        Batching is not an optimisation here, it is a requirement: Binance
        allows five inbound messages per second, so one frame per stream would
        disconnect the socket while subscribing to a handful of symbols.
        """
        if not subscriptions:
            return ()
        batch_size = max(1, BINANCE_SPOT_CAPABILITIES.max_subscriptions_per_request)
        frames: list[str] = []
        for start in range(0, len(subscriptions), batch_size):
            batch = subscriptions[start : start + batch_size]
            frames.append(
                json.dumps(
                    {
                        "method": "SUBSCRIBE",
                        "params": [s.stream_name for s in batch],
                        "id": self._next_request_id(),
                    }
                )
            )
        return tuple(frames)

    def build_unsubscribe_frames(
        self, subscriptions: tuple[Subscription, ...]
    ) -> tuple[str, ...]:
        if not subscriptions:
            return ()
        batch_size = max(1, BINANCE_SPOT_CAPABILITIES.max_subscriptions_per_request)
        frames: list[str] = []
        for start in range(0, len(subscriptions), batch_size):
            batch = subscriptions[start : start + batch_size]
            frames.append(
                json.dumps(
                    {
                        "method": "UNSUBSCRIBE",
                        "params": [s.stream_name for s in batch],
                        "id": self._next_request_id(),
                    }
                )
            )
        return tuple(frames)

    def build_subscription(
        self,
        symbol: SymbolRef,
        channel: MarketDataChannel,
        *,
        interval: str = "1m",
        update_speed_ms: int = 100,
    ) -> Subscription:
        """Create a tracked subscription with its venue stream name."""
        suffix = channel_suffix(
            channel, interval=interval, update_speed_ms=update_speed_ms
        )
        options: dict[str, str] = {}
        if channel is MarketDataChannel.CANDLES:
            options["interval"] = interval
        if channel is MarketDataChannel.ORDER_BOOK:
            options["updateSpeedMs"] = str(update_speed_ms)

        return Subscription(
            subscription_id=f"{ExchangeId.BINANCE.value}:{channel.value}:{symbol.symbol}",
            exchange=ExchangeId.BINANCE.value,
            channel=channel,
            symbol=symbol.symbol,
            stream_name=stream_name(symbol.venue_symbol, suffix),
            options=options,
        )

    def stream_url(self, subscriptions: tuple[Subscription, ...]) -> str:
        """Combined-stream URL.

        Streams are named in the URL rather than subscribed after connecting.
        The socket then arrives already subscribed, which removes the window in
        which it is open but silent — and saves inbound-message budget.
        """
        if not subscriptions:
            return f"{self._ws_base}/ws"
        names = "/".join(s.stream_name for s in subscriptions)
        return f"{self._ws_base}/stream?streams={names}"

    def _connection_manager(
        self,
        subscriptions: tuple[Subscription, ...],
        on_payload: Callable[[str, Mapping[str, Any], int], None],
        *,
        name: str,
    ) -> tuple[WebSocketConnectionManager, SubscriptionManager]:
        """Wire a connection manager for a set of streams."""
        if self._transport_factory is None:
            raise AdapterError(
                "BinanceMarketDataAdapter was constructed without a transport "
                "factory; streaming is unavailable. Inject one to stream."
            )

        manager_subscriptions = SubscriptionManager(
            exchange=ExchangeId.BINANCE.value,
            max_subscriptions=BINANCE_SPOT_CAPABILITIES.max_streams_per_connection,
        )
        for subscription in subscriptions:
            manager_subscriptions.add(
                subscription.channel,
                subscription.symbol,
                subscription.stream_name,
                options=dict(subscription.options),
                subscription_id=subscription.subscription_id,
            )

        def on_message(raw: str) -> None:
            received = epoch_micros()
            try:
                decoded = json.loads(raw, parse_float=str, parse_int=str)
            except json.JSONDecodeError as exc:
                raise BinanceParseError(f"Frame is not valid JSON: {exc}") from exc

            if not isinstance(decoded, Mapping):
                return

            stream, payload = unwrap_combined_stream(decoded)
            if stream is None:
                # Control acknowledgements ({"result": null, "id": 1}) carry no
                # market data and are not an error.
                if "e" not in payload:
                    return
                stream = ""
            on_payload(stream, payload, received)

        callbacks = ConnectionCallbacks(
            on_message=on_message,
            build_subscribe_frames=self.build_subscribe_frames,
            build_unsubscribe_frames=self.build_unsubscribe_frames,
            # Binance's server sends protocol-level pings every three minutes
            # and expects a pong within ten. The websocket library answers those
            # automatically, so no application-level ping frame is needed — and
            # sending one would consume inbound-message budget for nothing.
            build_ping_frame=None,
            classify_error=classify_binance_error,
        )

        config = ConnectionConfig(
            url=self.stream_url(subscriptions),
            name=f"binance-{name}",
            heartbeat_interval_millis=20_000,
            heartbeat_timeout_millis=90_000,
        )

        manager = WebSocketConnectionManager(
            config,
            self._transport_factory,
            callbacks,
            manager_subscriptions,
            exchange=ExchangeId.BINANCE.value,
        )
        return manager, manager_subscriptions

    async def _stream(
        self,
        symbols: tuple[SymbolRef, ...],
        channel: MarketDataChannel,
        parse: Callable[[Mapping[str, Any], str, int], Any],
        *,
        name: str,
        interval: str = "1m",
    ) -> AsyncIterator[Any]:
        """Shared streaming machinery for every channel.

        One implementation rather than four near-identical ones: the channels
        differ only in stream suffix and parser.
        """
        if not symbols:
            return

        by_stream: dict[str, str] = {}
        subscriptions: list[Subscription] = []
        for symbol in symbols:
            subscription = self.build_subscription(symbol, channel, interval=interval)
            subscriptions.append(subscription)
            by_stream[subscription.stream_name.lower()] = symbol.symbol
            # Register the mapping so an inbound frame identified only by its
            # venue symbol can be resolved without the heuristic splitter.
            if not self._symbols.is_registered(
                symbol.symbol, ExchangeId.BINANCE, market_type=symbol.market_type
            ):
                base, _, quote = symbol.symbol.partition("-")
                self._symbols.register(
                    SymbolMapping(
                        canonical=symbol.symbol,
                        venue_symbol=symbol.venue_symbol,
                        exchange=ExchangeId.BINANCE,
                        base_asset=base,
                        quote_asset=quote or base,
                        market_type=symbol.market_type,
                    )
                )

        queue: asyncio.Queue[Any] = asyncio.Queue(maxsize=10_000)

        def on_payload(stream: str, payload: Mapping[str, Any], received: int) -> None:
            canonical = by_stream.get(stream.lower())
            if canonical is None:
                venue_symbol = payload.get("s")
                if not isinstance(venue_symbol, str):
                    return
                try:
                    canonical = self._symbols.to_canonical_symbol(
                        venue_symbol, ExchangeId.BINANCE
                    )
                except Exception:  # noqa: BLE001 - unknown symbol, drop the frame
                    return

            parsed = parse(payload, canonical, received)
            try:
                queue.put_nowait(parsed)
            except asyncio.QueueFull:
                # Dropping the newest is wrong for a book and wrong for a tape.
                # Shed the oldest so the consumer sees current data and the gap
                # is detected by sequence validation rather than hidden.
                try:
                    queue.get_nowait()
                    queue.put_nowait(parsed)
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    pass

        manager, _ = self._connection_manager(
            tuple(subscriptions), on_payload, name=name
        )
        supervisor = asyncio.create_task(
            manager.run_forever(), name=f"binance-{name}-supervisor"
        )
        try:
            while True:
                getter = asyncio.create_task(queue.get())
                done, _pending = await asyncio.wait(
                    {getter, supervisor}, return_when=asyncio.FIRST_COMPLETED
                )
                if getter in done:
                    yield getter.result()
                    continue

                getter.cancel()
                # The supervisor exited, which only happens on a permanent stop
                # or an unrecoverable error. Drain what arrived before it did,
                # then end the iterator rather than hanging forever.
                while not queue.empty():
                    yield queue.get_nowait()
                return
        finally:
            supervisor.cancel()
            try:
                await supervisor
            except (asyncio.CancelledError, Exception):
                pass
            await manager.stop()

    # ------------------------------------------------------------------
    # Streams
    # ------------------------------------------------------------------
    async def stream_order_book(
        self, symbols: tuple[SymbolRef, ...]
    ) -> AsyncIterator[OrderBookDelta]:
        """Yield normalised depth diffs.

        These are raw diffs. They must be fed to an
        :class:`~wlct_trading.orderbook_sync.OrderBookSynchroniser`, which
        pairs them with a REST snapshot; applying them directly to an empty book
        produces a book with a hole in it.
        """
        async for delta in self._stream(
            symbols,
            MarketDataChannel.ORDER_BOOK,
            lambda payload, symbol, received: parse_depth_delta(
                payload, symbol, received_timestamp=received
            ),
            name="depth",
        ):
            yield delta

    async def stream_trades(
        self, symbols: tuple[SymbolRef, ...]
    ) -> AsyncIterator[PublicTrade]:
        async for trade in self._stream(
            symbols,
            MarketDataChannel.TRADES,
            lambda payload, symbol, received: parse_trade(
                payload, symbol, received_timestamp=received
            ),
            name="trade",
        ):
            yield trade

    async def stream_tickers(
        self, symbols: tuple[SymbolRef, ...]
    ) -> AsyncIterator[Ticker]:
        """Yield best bid/ask updates from the ``bookTicker`` stream.

        ``bookTicker`` rather than ``ticker``: it fires on every book change
        instead of once a second, and top-of-book is what the risk engine needs
        for price-deviation checks.
        """
        async for ticker in self._stream(
            symbols,
            MarketDataChannel.BOOK_TICKER,
            lambda payload, symbol, received: parse_book_ticker(
                payload, symbol, received_timestamp=received
            ),
            name="bookticker",
        ):
            yield ticker

    async def stream_rolling_tickers(
        self, symbols: tuple[SymbolRef, ...]
    ) -> AsyncIterator[Ticker]:
        """Yield 24-hour rolling statistics, which do include a last price."""
        async for ticker in self._stream(
            symbols,
            MarketDataChannel.TICKER,
            lambda payload, symbol, received: parse_ticker(
                payload, symbol, received_timestamp=received
            ),
            name="ticker",
        ):
            yield ticker

    async def stream_candles(
        self, symbols: tuple[SymbolRef, ...], interval: str = "1m"
    ) -> AsyncIterator[Candle]:
        """Yield candle updates. Only bars with ``is_closed`` should be stored."""
        async for candle in self._stream(
            symbols,
            MarketDataChannel.CANDLES,
            lambda payload, symbol, received: parse_kline(
                payload, symbol, received_timestamp=received
            ),
            name=f"kline-{interval}",
            interval=interval,
        ):
            yield candle
