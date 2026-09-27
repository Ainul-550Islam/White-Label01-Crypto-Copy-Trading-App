"""Authenticated Binance Spot adapters.

The first venue where this platform can move real money. Everything
venue-specific about authenticated trading is confined to this module and to
:mod:`wlct_trading.exchanges.binance.signing`: the execution engine above it
sees only :class:`~wlct_trading.adapters.base.TradingAdapter` and
:class:`~wlct_trading.adapters.base.AccountAdapter`.

Design notes that matter more than the endpoint list:

**The ambiguity contract is honoured precisely.** A transport failure raises
:class:`AdapterConnectionError`, which the engine treats as "the order may
exist". A venue error response raises :class:`AdapterRejectedError`, which means
"the order definitively does not exist". Getting this distinction wrong in
either direction is a money bug: conflating them either duplicates orders or
strands them. The classification is therefore made from the HTTP status and the
venue's own error code, never from a string match on a message.

**Numbers are strings until they are Decimals.** The JSON body is parsed with
``parse_float=str`` so no quantity ever passes through a binary float. A
``0.1 + 0.2`` in an order size is not a rounding curiosity, it is a rejected
order or a wrong position.

**Nothing here logs.** Not the request, not the response, not the headers. The
API key is in a header on every single call, and a debug log left switched on
is the most ordinary way for a key to end up in a log aggregator.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, AsyncIterator, Awaitable, Callable, Mapping, Sequence

from wlct_trading.adapters.base import (
    AccountAdapter,
    AccountBalance,
    AdapterConnectionError,
    AdapterError,
    AdapterRateLimitedError,
    AdapterRejectedError,
    CancelResult,
    SubmitResult,
    TradingAdapter,
    VenueAccount,
    VenuePosition,
)
from wlct_trading.clock import epoch_micros
from wlct_trading.enums import (
    ExchangeId,
    OrderSide,
    OrderStatus,
    OrderType,
    TimeInForce,
)
from wlct_trading.exchanges.binance.capabilities import (
    BINANCE_REST_WEIGHTS,
    BINANCE_SPOT_CAPABILITIES,
    BINANCE_SPOT_REST_BASE,
    BINANCE_TESTNET_REST_BASE,
)
from wlct_trading.exchanges.binance.parsers import BinanceParseError, parse_decimal
from wlct_trading.exchanges.binance.signing import (
    SignatureError,
    SignedRequest,
    build_keyed_request,
    build_signed_request,
    format_decimal,
)
from wlct_trading.execution.credentials import CredentialProvider, ExchangeCredentials
from wlct_trading.execution.timesync import ClockSyncError, ExchangeClock
from wlct_trading.orders import Fill, Order, OrderIntent
from wlct_trading.transport.ratelimit import RateLimitRegistry

__all__ = [
    "HttpResponse",
    "SignedRequestSender",
    "BinanceTradingAdapter",
    "BinanceAccountAdapter",
    "BINANCE_ORDER_STATUS_MAP",
    "to_binance_order_type",
    "from_binance_status",
]


@dataclass(frozen=True, slots=True)
class HttpResponse:
    """A raw HTTP response.

    The body stays a string. Decoding is done here with ``parse_float=str`` so
    the transport cannot silently hand back floats, which is what a naive
    ``response.json()`` would do.
    """

    status: int
    headers: Mapping[str, str]
    body: str

    def json(self) -> Any:
        """Decode, keeping every number as a string."""
        try:
            return json.loads(self.body, parse_float=str, parse_int=str)
        except (ValueError, TypeError) as exc:
            raise BinanceParseError(
                f"Binance returned a body that is not valid JSON "
                f"(HTTP {self.status})."
            ) from exc

    def header(self, name: str) -> str | None:
        """Case-insensitive header lookup."""
        lowered = name.lower()
        for key, value in self.headers.items():
            if key.lower() == lowered:
                return value
        return None

    @property
    def retry_after_millis(self) -> int | None:
        """``Retry-After``, in milliseconds. Binance sends it in seconds."""
        raw = self.header("Retry-After")
        if raw is None:
            return None
        try:
            return int(float(raw) * 1000)
        except (TypeError, ValueError):
            return None

    @property
    def used_weight_1m(self) -> int | None:
        """The venue's own view of consumed weight this minute.

        Worth reading even though the local limiter tracks it too: the venue
        counts across every process sharing the IP, and the local one does not.
        """
        raw = self.header("X-MBX-USED-WEIGHT-1M") or self.header("X-MBX-USED-WEIGHT")
        try:
            return int(raw) if raw is not None else None
        except (TypeError, ValueError):
            return None


#: Transmits a prepared signed request. Implemented in the service layer over
#: ``httpx``; kept as a callable so trading-core stays dependency-free and so a
#: test can substitute a deterministic sender with no network at all.
SignedRequestSender = Callable[[SignedRequest, int], Awaitable[HttpResponse]]


#: Venue status -> platform status. Binance's ``EXPIRED_IN_MATCH`` is a
#: self-trade-prevention expiry and is folded into EXPIRED; the distinction is
#: preserved in the order event payload rather than in the enum.
BINANCE_ORDER_STATUS_MAP: dict[str, OrderStatus] = {
    "NEW": OrderStatus.ACKNOWLEDGED,
    "PENDING_NEW": OrderStatus.SUBMITTED,
    "PARTIALLY_FILLED": OrderStatus.PARTIALLY_FILLED,
    "FILLED": OrderStatus.FILLED,
    "CANCELED": OrderStatus.CANCELLED,
    "PENDING_CANCEL": OrderStatus.CANCEL_REQUESTED,
    "REJECTED": OrderStatus.REJECTED,
    "EXPIRED": OrderStatus.EXPIRED,
    "EXPIRED_IN_MATCH": OrderStatus.EXPIRED,
}

#: Platform order type -> Binance order type.
_ORDER_TYPE_MAP: dict[OrderType, str] = {
    OrderType.MARKET: "MARKET",
    OrderType.LIMIT: "LIMIT",
    OrderType.STOP: "STOP_LOSS",
    OrderType.STOP_LIMIT: "STOP_LOSS_LIMIT",
}

#: Binance error codes that mean "the venue definitively refused this order".
#: Everything not listed, on a 4xx, is also a refusal; this set exists to make
#: the intent explicit for the codes that matter most.
_DEFINITIVE_REJECTION_CODES: frozenset[int] = frozenset(
    {
        -1013,  # filter failure: lot size, min notional, price filter
        -1021,  # timestamp outside recvWindow
        -1022,  # invalid signature
        -1100,  # illegal characters in a parameter
        -1102,  # mandatory parameter missing
        -1104,  # too many parameters
        -1111,  # precision over the maximum for this asset
        -1117,  # invalid timeInForce
        -1121,  # invalid symbol
        -2010,  # NEW_ORDER_REJECTED (includes insufficient balance)
        -2011,  # CANCEL_REJECTED
        -2013,  # order does not exist
        -2015,  # invalid API key, IP, or permissions
        -2026,  # order was canceled or expired with no executed qty
    }
)


def to_binance_order_type(order_type: OrderType) -> str:
    """Map a platform order type onto Binance's vocabulary."""
    try:
        return _ORDER_TYPE_MAP[order_type]
    except KeyError as exc:  # pragma: no cover - enum is closed
        raise AdapterRejectedError(
            "UNSUPPORTED_ORDER_TYPE",
            f"Binance Spot does not support order type {order_type.value}.",
        ) from exc


def from_binance_status(raw: str) -> OrderStatus:
    """Map a Binance status string onto the platform lifecycle.

    An unrecognised status raises rather than defaulting. A new status the
    platform has never seen is exactly the situation where guessing — and
    especially guessing ``FILLED`` or ``CANCELLED`` — would corrupt a position.
    """
    try:
        return BINANCE_ORDER_STATUS_MAP[raw.upper()]
    except KeyError as exc:
        raise BinanceParseError(
            f"Binance returned an unrecognised order status {raw!r}. Refusing "
            f"to guess what it means for the order's lifecycle."
        ) from exc


class _BinanceSignedClient:
    """Shared signing, rate limiting and error handling.

    Composed into both adapters rather than inherited: the trading adapter and
    the account adapter are separate interfaces on purpose (a service can hold
    one without the other), and a shared base class would quietly reunite them.
    """

    __slots__ = (
        "_send",
        "_credentials",
        "_clock",
        "_limits",
        "_rest_base",
        "_recv_window_ms",
        "_timeout_ms",
    )

    def __init__(
        self,
        *,
        send: SignedRequestSender,
        credentials: CredentialProvider,
        clock: ExchangeClock,
        rate_limits: RateLimitRegistry | None = None,
        testnet: bool = False,
        rest_base: str | None = None,
        recv_window_ms: int = 5_000,
        timeout_ms: int = 10_000,
    ) -> None:
        base = rest_base or (
            BINANCE_TESTNET_REST_BASE if testnet else BINANCE_SPOT_REST_BASE
        )
        cleaned = base.strip().rstrip("/")
        if not cleaned.startswith("https://"):
            raise ValueError(
                f"Binance rest_base must be HTTPS for signed requests; got "
                f"{base!r}. A signed request over plaintext leaks the API key."
            )
        if "data-api.binance.vision" in cleaned or "data-stream" in cleaned:
            # The public mirror serves market data only and has no authenticated
            # endpoints. Pointing signed traffic at it produces a confusing 404
            # rather than an obvious failure, so it is rejected up front.
            raise ValueError(
                f"{cleaned} is Binance's public market-data mirror and does not "
                f"accept signed requests. Use api.binance.com or "
                f"testnet.binance.vision."
            )
        self._send = send
        self._credentials = credentials
        self._clock = clock
        self._limits = rate_limits or RateLimitRegistry.from_rules(
            BINANCE_SPOT_CAPABILITIES.rate_limit_rules
        )
        self._rest_base = cleaned
        self._recv_window_ms = recv_window_ms
        self._timeout_ms = timeout_ms

    @property
    def rest_base(self) -> str:
        return self._rest_base

    @property
    def recv_window_ms(self) -> int:
        """The signature freshness window this client stamps requests with.

        The placement review needs this because the venue's own rejection
        threshold, not the platform's comfort with skew, is what decides whether a
        signed order is accepted - so the review measures skew against the number
        that will actually be applied.
        """
        return self._recv_window_ms

    @property
    def clock_skew_millis(self) -> int | None:
        """``|local - venue|`` in milliseconds, or ``None`` if never measured.

        ``None`` and ``0`` are deliberately different answers: the first means the
        clock was never synchronised (a configuration gap), the second that it was
        measured and is aligned. The sign is dropped here because the remedy for
        too much skew is the same in either direction, and a direction belongs in
        a gatherer's log line rather than in a review's arithmetic.
        """
        offset = self._clock.offset_millis
        return None if offset is None else abs(int(offset))

    def _reserve(self, weight: int) -> None:
        """Reserve rate-limit budget before sending, or refuse locally.

        Refusing locally is strictly better than being refused by the venue: a
        429 costs a round trip and repeated 429s escalate to a 418 IP ban that
        affects every tenant sharing the address.
        """
        allowed, decisions = self._limits.try_acquire_all(
            {"REQUEST_WEIGHT": weight, "RAW_REQUESTS": 1}
        )
        if not allowed:
            blocking = next(
                (item for item in decisions if not item.allowed), decisions[0]
            )
            raise AdapterRateLimitedError(blocking.retry_after_millis)

    async def signed(
        self,
        *,
        method: str,
        path: str,
        params: Sequence[tuple[str, Any]],
        tenant_id: str,
        account_id: str,
        weight: int,
    ) -> Any:
        """Build, sign, send and interpret one authenticated request."""
        self._reserve(weight)
        credentials = await self._resolve(tenant_id, account_id)

        try:
            timestamp = self._clock.timestamp_millis()
        except ClockSyncError:
            # Propagated unchanged. The engine distinguishes a clock problem
            # from a venue problem, and nothing was transmitted either way.
            raise

        try:
            request = build_signed_request(
                method=method,
                base_url=self._rest_base,
                path=path,
                params=params,
                credentials=credentials,
                timestamp_millis=timestamp,
                recv_window_millis=self._recv_window_ms,
            )
        except SignatureError as exc:
            raise AdapterRejectedError("SIGNING_FAILED", str(exc)) from exc

        return await self._dispatch(request)

    async def keyed(
        self,
        *,
        method: str,
        path: str,
        params: Sequence[tuple[str, Any]] = (),
        tenant_id: str,
        account_id: str,
        weight: int,
    ) -> Any:
        """Send a key-authenticated, unsigned request (user-stream endpoints)."""
        self._reserve(weight)
        credentials = await self._resolve(tenant_id, account_id)
        request = build_keyed_request(
            method=method,
            base_url=self._rest_base,
            path=path,
            params=params,
            credentials=credentials,
        )
        return await self._dispatch(request)

    async def _resolve(self, tenant_id: str, account_id: str) -> ExchangeCredentials:
        try:
            credentials = await self._credentials.resolve(
                tenant_id, account_id, ExchangeId.BINANCE
            )
        except Exception as exc:  # noqa: BLE001 - message is already redacted
            raise AdapterRejectedError(
                "CREDENTIALS_UNAVAILABLE",
                f"Could not resolve credentials for account {account_id}: "
                f"{type(exc).__name__}.",
            ) from exc
        credentials.assert_safe()
        return credentials

    async def _dispatch(self, request: SignedRequest) -> Any:
        """Transmit and classify.

        The classification is the whole point of this method, so it is worth
        being explicit about each branch:

        * A transport exception is **ambiguous**. The request may have been
          received and the response lost.
        * ``429``/``418`` are **definitive refusals** — the venue tells us it
          did not process the request — and carry a retry hint.
        * ``401``/``403`` are definitive and mean the key is wrong or lacks
          permission. Never retried; retrying a bad key is how an account gets
          rate-limited into a ban.
        * ``5xx`` is **ambiguous**. Binance documents that a 5xx means the
          execution status is unknown and the request may have succeeded.
        * ``4xx`` is a definitive rejection.
        """
        try:
            response = await self._send(request, self._timeout_ms)
        except Exception as exc:  # noqa: BLE001
            raise AdapterConnectionError(
                f"No response from Binance for {request.method} {request.url}: "
                f"{type(exc).__name__}. The request's fate is unknown."
            ) from exc

        if 200 <= response.status < 300:
            return response.json()

        if response.status in (418, 429):
            raise AdapterRateLimitedError(response.retry_after_millis)

        if response.status >= 500:
            # Binance's own documentation is explicit: a 5xx is not a failure
            # response, it means the execution status is unknown.
            raise AdapterConnectionError(
                f"Binance returned HTTP {response.status}; per the venue's "
                f"documentation the execution status of this request is "
                f"UNKNOWN and it must be reconciled, not retried."
            )

        code, message = _extract_error(response)
        if response.status in (401, 403):
            raise AdapterRejectedError(
                str(code) if code is not None else "AUTH",
                f"Binance rejected the credentials (HTTP {response.status}): "
                f"{message}",
            )
        raise AdapterRejectedError(
            str(code) if code is not None else f"HTTP_{response.status}", message
        )


def _extract_error(response: HttpResponse) -> tuple[int | None, str]:
    """Pull ``{"code": -1121, "msg": "..."}`` out of an error body.

    Falls back to a generic message rather than raising: an unparseable error
    body must not turn a clean rejection into a confusing parse failure.
    """
    try:
        payload = response.json()
    except BinanceParseError:
        return (None, f"Binance returned HTTP {response.status} with a non-JSON body.")
    if not isinstance(payload, Mapping):
        return (None, f"Binance returned HTTP {response.status}.")
    raw_code = payload.get("code")
    try:
        code = int(raw_code) if raw_code is not None else None
    except (TypeError, ValueError):
        code = None
    message = str(payload.get("msg") or f"Binance returned HTTP {response.status}.")
    return (code, message)


class BinanceTradingAdapter(TradingAdapter):
    """Order entry against Binance Spot.

    ``is_simulated`` is hard-coded ``False``. This adapter can only talk to a
    real venue, and a real venue is the only thing it will ever claim to be.
    """

    __slots__ = ("_client", "_symbol_for", "_venue_symbol_for", "_symbol_hints")

    def __init__(
        self,
        *,
        send: SignedRequestSender,
        credentials: CredentialProvider,
        clock: ExchangeClock,
        rate_limits: RateLimitRegistry | None = None,
        testnet: bool = False,
        rest_base: str | None = None,
        recv_window_ms: int = 5_000,
        timeout_ms: int = 10_000,
        venue_symbol_for: Callable[[str], str] | None = None,
        symbol_for: Callable[[str], str] | None = None,
    ) -> None:
        """
        ``venue_symbol_for`` converts a platform symbol (``BTC/USDT``) into the
        venue's form (``BTCUSDT``); ``symbol_for`` reverses it. Defaults strip
        and restore the separator, which is correct for spot pairs; a registry
        can be injected where it is not.
        """
        self._client = _BinanceSignedClient(
            send=send,
            credentials=credentials,
            clock=clock,
            rate_limits=rate_limits,
            testnet=testnet,
            rest_base=rest_base,
            recv_window_ms=recv_window_ms,
            timeout_ms=timeout_ms,
        )
        self._venue_symbol_for = venue_symbol_for or (
            lambda symbol: symbol.replace("/", "").replace("-", "").upper()
        )
        self._symbol_for = symbol_for or (lambda venue_symbol: venue_symbol.upper())
        # Binance addresses an order by (symbol, clientOrderId), but the
        # platform's reconciliation contract is "look it up by clientOrderId
        # alone". This bridges the two: every submission remembers its symbol,
        # and a process that restarts seeds the map from the durable record via
        # register_symbol_hint rather than guessing.
        self._symbol_hints: dict[str, str] = {}

    @property
    def exchange(self) -> ExchangeId:
        return ExchangeId.BINANCE

    @property
    def is_simulated(self) -> bool:
        return False

    # ------------------------------------------------------------------
    # Placement review support (Part 16)
    # ------------------------------------------------------------------
    def venue_symbol(self, symbol: str) -> str:
        """The venue's spelling of a platform symbol.

        Public because the placement review resolves the same symbol the order
        path will use, through the same mapping - two spellings would mean a
        review that attested ``BTC-USDT`` while the order went out as ``BTCUSDT``,
        or (more likely) a symbol the review could not find at all.
        """
        return self._venue_symbol_for(symbol)

    @property
    def clock_skew_millis(self) -> int | None:
        """Measured venue-clock skew for this adapter's clock, or ``None``."""
        return self._client.clock_skew_millis

    @property
    def recv_window_ms(self) -> int:
        """The ``recvWindow`` this adapter stamps onto every signed request."""
        return self._client.recv_window_ms

    async def fetch_key_restrictions(
        self, tenant_id: str, account_id: str
    ) -> Mapping[str, object]:
        """``GET /sapi/v1/account/apiRestrictions``, returned as the venue sent it.

        Not normalised into a dataclass, unlike :meth:`BinanceAccountAdapter
        .fetch_account`'s treatment of ``/api/v3/account``: the caller is the
        placement review, whose subject is *which fields were present*. A missing
        ``enableWithdrawals`` is evidence in a way a missing balance never is, and
        a normaliser that filled in defaults would erase the difference between
        "the venue said no" and "the venue did not answer". The reading of the
        payload therefore lives in ``attestation.py``, next to the codes it
        produces, and this method only guarantees the shape is an object.
        """
        payload = await self._client.signed(
            method="GET",
            path="/sapi/v1/account/apiRestrictions",
            params=[],
            tenant_id=tenant_id,
            account_id=account_id,
            weight=BINANCE_REST_WEIGHTS["api_restrictions"],
        )
        if not isinstance(payload, Mapping):
            raise BinanceParseError(
                "Binance returned a non-object response to an apiRestrictions "
                "query."
            )
        return payload

    # ------------------------------------------------------------------
    # Orders
    # ------------------------------------------------------------------
    async def submit_order(
        self, intent: OrderIntent, client_order_id: str
    ) -> SubmitResult:
        """Place an order via ``POST /api/v3/order``.

        ``newClientOrderId`` carries the platform's deterministic idempotency
        key to the venue, so a request that is somehow sent twice is rejected
        venue-side with ``-2010 Duplicate order sent`` rather than filling
        twice. That is the last line of defence behind the local lock and the
        unique index, and it is the only one that still works when the platform
        itself is confused.

        ``newOrderRespType=FULL`` asks for the fill list in the response, which
        removes a round trip for a market order that fills immediately — and,
        more importantly, means an immediately-filled order is never briefly
        recorded as unfilled.
        """
        params: list[tuple[str, Any]] = [
            ("symbol", self._venue_symbol_for(intent.symbol)),
            ("side", intent.side.value),
            ("type", to_binance_order_type(intent.order_type)),
        ]

        if intent.order_type is not OrderType.MARKET:
            params.append(("timeInForce", intent.time_in_force.value))

        params.append(("quantity", format_decimal(intent.quantity)))

        if intent.order_type in (OrderType.LIMIT, OrderType.STOP_LIMIT):
            if intent.price is None:
                raise AdapterRejectedError(
                    "PRICE_REQUIRED",
                    f"A {intent.order_type.value} order requires a price.",
                )
            params.append(("price", format_decimal(intent.price)))

        if intent.order_type in (OrderType.STOP, OrderType.STOP_LIMIT):
            if intent.stop_price is None:
                raise AdapterRejectedError(
                    "STOP_PRICE_REQUIRED",
                    f"A {intent.order_type.value} order requires a stop price.",
                )
            params.append(("stopPrice", format_decimal(intent.stop_price)))

        if intent.reduce_only:
            # Binance Spot has no reduce-only flag. Refusing is the only safe
            # answer: dropping it would convert a position-closing order into a
            # position-opening one.
            raise AdapterRejectedError(
                "REDUCE_ONLY_UNSUPPORTED",
                "Binance Spot has no reduce-only flag; refusing to send the "
                "order without it.",
            )

        params.append(("newClientOrderId", client_order_id))
        params.append(("newOrderRespType", "FULL"))

        self.register_symbol_hint(client_order_id, intent.symbol)

        payload = await self._client.signed(
            method="POST",
            path="/api/v3/order",
            params=params,
            tenant_id=intent.tenant_id,
            account_id=intent.account_id,
            weight=BINANCE_REST_WEIGHTS["order_place"],
        )

        return self._parse_submit_response(payload, intent, client_order_id)

    def _parse_submit_response(
        self, payload: Any, intent: OrderIntent, client_order_id: str
    ) -> SubmitResult:
        if not isinstance(payload, Mapping):
            raise BinanceParseError(
                "Binance returned a non-object response to an order placement."
            )
        status = from_binance_status(str(payload.get("status", "NEW")))
        exchange_order_id = payload.get("orderId")
        order_id_text = str(exchange_order_id) if exchange_order_id is not None else None
        transact_time = payload.get("transactTime") or payload.get("time")
        submitted_at = (
            int(transact_time) * 1_000 if transact_time is not None else epoch_micros()
        )

        fills = self._parse_fill_list(
            payload.get("fills") or (),
            order_id=intent.client_order_id or client_order_id,
            symbol=intent.symbol,
            side=intent.side,
            exchange_order_id=order_id_text,
            fallback_timestamp_micros=submitted_at,
        )

        return SubmitResult(
            accepted=status is not OrderStatus.REJECTED,
            exchange_order_id=order_id_text,
            status=status,
            rejection_code=None,
            rejection_reason=None,
            is_simulated=False,
            submitted_at_micros=submitted_at,
            fills=fills,
        )

    def _parse_fill_list(
        self,
        raw_fills: Any,
        *,
        order_id: str,
        symbol: str,
        side: OrderSide,
        exchange_order_id: str | None,
        fallback_timestamp_micros: int,
    ) -> tuple[Fill, ...]:
        """Normalise Binance's ``fills`` array.

        Each entry is a real execution the venue performed. Nothing here
        synthesises a fill: an empty array means the order has not traded, and
        that is reported as an empty tuple.
        """
        if not isinstance(raw_fills, Sequence) or isinstance(raw_fills, (str, bytes)):
            return ()
        fills: list[Fill] = []
        for entry in raw_fills:
            if not isinstance(entry, Mapping):
                continue
            trade_id = str(entry.get("tradeId", ""))
            price = parse_decimal(entry.get("price"), "fill.price")
            quantity = parse_decimal(entry.get("qty"), "fill.qty")
            commission = parse_decimal(entry.get("commission", "0"), "fill.commission")
            fills.append(
                Fill(
                    # Deterministic per (order, trade): the same execution
                    # arriving again on the private stream deduplicates against
                    # this id instead of double-counting.
                    fill_id=f"{exchange_order_id or order_id}:{trade_id}"
                    if trade_id
                    else str(uuid.uuid4()),
                    order_id=order_id,
                    trade_id=trade_id,
                    price=price,
                    quantity=quantity,
                    fee=commission,
                    fee_currency=str(entry.get("commissionAsset") or ""),
                    is_maker=False,
                    is_simulated=False,
                    exchange_timestamp=fallback_timestamp_micros,
                    received_timestamp=epoch_micros(),
                    symbol=symbol,
                    side=side,
                    exchange=ExchangeId.BINANCE,
                    quote_quantity=price * quantity,
                    exchange_order_id=exchange_order_id,
                )
            )
        return tuple(fills)

    async def cancel_order(self, order: Order) -> CancelResult:
        """Cancel via ``DELETE /api/v3/order``, addressed by clientOrderId.

        Addressed by ``origClientOrderId`` rather than the venue's order id
        because the client id is known even when the submission response was
        lost — which is precisely the situation where a cancel is most urgent.
        """
        try:
            payload = await self._client.signed(
                method="DELETE",
                path="/api/v3/order",
                params=[
                    ("symbol", self._venue_symbol_for(order.symbol)),
                    ("origClientOrderId", order.client_order_id),
                ],
                tenant_id=order.tenant_id,
                account_id=order.account_id,
                weight=BINANCE_REST_WEIGHTS["order_cancel"],
            )
        except AdapterRejectedError as exc:
            if exc.code == "-2011":
                # "Unknown order sent": already gone. Not an error for a cancel.
                return CancelResult(
                    accepted=False,
                    status=order.status,
                    reason=(
                        "The venue has no such open order; it was already filled, "
                        "cancelled or expired."
                    ),
                    is_simulated=False,
                )
            raise

        if not isinstance(payload, Mapping):
            raise BinanceParseError(
                "Binance returned a non-object response to a cancellation."
            )
        status = from_binance_status(str(payload.get("status", "CANCELED")))
        return CancelResult(
            accepted=status in (OrderStatus.CANCELLED, OrderStatus.CANCEL_REQUESTED),
            status=status,
            reason="Cancelled at the venue.",
            is_simulated=False,
        )

    def register_symbol_hint(self, client_order_id: str, symbol: str) -> None:
        """Remember which instrument a clientOrderId belongs to.

        Bounded at 10 000 entries. An unbounded map on a long-running process
        that submits thousands of orders an hour is a slow memory leak, and the
        durable record can always re-seed a hint that has been evicted.
        """
        if len(self._symbol_hints) >= 10_000:
            self._symbol_hints.clear()
        self._symbol_hints[client_order_id] = symbol

    async def fetch_order(
        self, tenant_id: str, account_id: str, client_order_id: str
    ) -> Order | None:
        """Query one order by clientOrderId — the reconciliation path.

        Returns ``None`` only when the venue positively says the order does not
        exist (``-2013``). Any other failure raises, because "I could not ask"
        and "it is not there" must never be confused: the first means try again,
        the second means the order was never placed.

        Binance needs the symbol as well, which comes from the hint recorded at
        submission. When no hint is available the call raises rather than
        scanning every symbol: a scan would cost hundreds of weight and could
        still miss the order.
        """
        symbol = self._symbol_hints.get(client_order_id)
        if symbol is None:
            raise AdapterError(
                f"No symbol is known for clientOrderId {client_order_id}, and "
                f"Binance requires one to query an order. Call "
                f"register_symbol_hint() with the symbol from the durable "
                f"record, or use fetch_order_for() with the local Order."
            )
        return await self._fetch_order(
            tenant_id=tenant_id,
            account_id=account_id,
            client_order_id=client_order_id,
            symbol=symbol,
            template=None,
        )

    async def fetch_order_for(self, order: Order) -> Order | None:
        """Query the venue for a known local order.

        Binance's ``GET /api/v3/order`` requires the symbol alongside the client
        order id, so the local record supplies it. The returned object is a
        *venue view*: a fresh :class:`Order` carrying the venue's status and
        quantities, never the local one mutated in place, so the caller can
        compare the two before deciding what to adopt.
        """
        self.register_symbol_hint(order.client_order_id, order.symbol)
        return await self._fetch_order(
            tenant_id=order.tenant_id,
            account_id=order.account_id,
            client_order_id=order.client_order_id,
            symbol=order.symbol,
            template=order,
        )

    async def _fetch_order(
        self,
        *,
        tenant_id: str,
        account_id: str,
        client_order_id: str,
        symbol: str,
        template: Order | None,
    ) -> Order | None:
        """``GET /api/v3/order`` with the symbol resolved."""
        try:
            payload = await self._client.signed(
                method="GET",
                path="/api/v3/order",
                params=[
                    ("symbol", self._venue_symbol_for(symbol)),
                    ("origClientOrderId", client_order_id),
                ],
                tenant_id=tenant_id,
                account_id=account_id,
                weight=BINANCE_REST_WEIGHTS["order_status"],
            )
        except AdapterRejectedError as exc:
            if exc.code == "-2013":
                return None
            raise

        if not isinstance(payload, Mapping):
            raise BinanceParseError(
                "Binance returned a non-object response to an order query."
            )
        return self._order_from_payload(
            payload,
            template=template,
            tenant_id=tenant_id,
            account_id=account_id,
        )

    async def fetch_open_orders(
        self, tenant_id: str, account_id: str, *, symbol: str | None = None
    ) -> tuple[Order, ...]:
        """Every order the venue currently considers live.

        Without a symbol this costs 80 weight against a 6000/minute budget, so
        the reconciliation loop passes one where it can.
        """
        params: list[tuple[str, Any]] = []
        weight = 80
        if symbol is not None:
            params.append(("symbol", self._venue_symbol_for(symbol)))
            weight = BINANCE_REST_WEIGHTS["open_orders"]

        payload = await self._client.signed(
            method="GET",
            path="/api/v3/openOrders",
            params=params,
            tenant_id=tenant_id,
            account_id=account_id,
            weight=weight,
        )
        if not isinstance(payload, Sequence) or isinstance(payload, (str, bytes)):
            raise BinanceParseError(
                "Binance returned a non-array response to an open-orders query."
            )
        orders: list[Order] = []
        for entry in payload:
            if not isinstance(entry, Mapping):
                continue
            orders.append(
                self._order_from_payload(
                    entry, tenant_id=tenant_id, account_id=account_id
                )
            )
        return tuple(orders)

    async def exchange_time(self) -> int:
        """``GET /api/v3/time``. Unauthenticated, but venue-specific.

        Sent through the same rate-limited client so the clock probe cannot
        exhaust the budget the orders need.
        """
        self._client._reserve(BINANCE_REST_WEIGHTS["server_time"])
        request = SignedRequest(
            method="GET",
            url=f"{self._client.rest_base}/api/v3/time",
            query="",
            headers={},
        )
        payload = await self._client._dispatch(request)
        if not isinstance(payload, Mapping) or "serverTime" not in payload:
            raise BinanceParseError(
                "Binance returned an unexpected payload for server time."
            )
        return int(payload["serverTime"])

    def stream_fills(
        self, tenant_id: str, account_id: str
    ) -> AsyncIterator[Fill]:
        """Fills arrive on the private user-data stream.

        Deliberately not implemented here. The listen-key lifecycle, the
        reconnect policy and the post-reconnect reconciliation are substantial
        enough to own their own module
        (:mod:`wlct_trading.exchanges.binance.userstream`), and folding them
        into a generator would hide the connection state the platform needs to
        report. The refusal happens at call time rather than at first
        iteration: a caller asking this adapter for fills has chosen the wrong
        object, and saying so immediately is kinder than raising from inside
        a loop they have already started.
        """
        raise AdapterError(
            "Use BinanceUserDataStream for private fills; it exposes the "
            "connection state and reconnect behaviour that a bare generator "
            "cannot."
        )

    # ------------------------------------------------------------------
    # Parsing
    # ------------------------------------------------------------------
    def _order_from_payload(
        self,
        payload: Mapping[str, Any],
        *,
        template: Order | None = None,
        tenant_id: str | None = None,
        account_id: str | None = None,
    ) -> Order:
        """Build a venue-view :class:`Order` from a REST payload.

        Populates only what the venue actually told us. Fields the venue does
        not report — strategy id, signal id — are taken from the local template
        when one exists and left empty otherwise, rather than invented.
        """
        venue_symbol = str(payload.get("symbol", ""))
        symbol = template.symbol if template is not None else self._symbol_for(
            venue_symbol
        )
        raw_side = str(payload.get("side", "BUY")).upper()
        side = OrderSide.BUY if raw_side == "BUY" else OrderSide.SELL
        status = from_binance_status(str(payload.get("status", "NEW")))

        quantity = parse_decimal(payload.get("origQty", "0"), "origQty")
        executed = parse_decimal(payload.get("executedQty", "0"), "executedQty")
        quote_executed = parse_decimal(
            payload.get("cummulativeQuoteQty", "0"), "cummulativeQuoteQty"
        )
        raw_price = payload.get("price")
        price = (
            parse_decimal(raw_price, "price")
            if raw_price is not None and str(raw_price) not in ("0", "0.00000000")
            else None
        )
        raw_stop = payload.get("stopPrice")
        stop_price = (
            parse_decimal(raw_stop, "stopPrice")
            if raw_stop is not None and str(raw_stop) not in ("0", "0.00000000")
            else None
        )

        order_type = _order_type_from_venue(str(payload.get("type", "LIMIT")))
        raw_tif = str(payload.get("timeInForce", "GTC")).upper()
        time_in_force = (
            TimeInForce[raw_tif] if raw_tif in TimeInForce.__members__ else TimeInForce.GTC
        )

        update_time = payload.get("updateTime") or payload.get("time")
        updated_at = int(update_time) * 1_000 if update_time is not None else epoch_micros()

        average = (quote_executed / executed) if executed > 0 else None

        return Order(
            order_id=template.order_id if template is not None else str(uuid.uuid4()),
            client_order_id=str(payload.get("clientOrderId", "")),
            tenant_id=template.tenant_id if template is not None else (tenant_id or ""),
            account_id=(
                template.account_id if template is not None else (account_id or "")
            ),
            strategy_id=template.strategy_id if template is not None else None,
            exchange=ExchangeId.BINANCE,
            symbol=symbol,
            side=side,
            order_type=order_type,
            quantity=quantity,
            price=price,
            stop_price=stop_price,
            time_in_force=time_in_force,
            reduce_only=False,
            signal_id=template.signal_id if template is not None else None,
            is_simulated=False,
            status=status,
            exchange_order_id=(
                str(payload["orderId"]) if payload.get("orderId") is not None else None
            ),
            filled_quantity=executed,
            average_fill_price=average,
            cumulative_fee=Decimal(0),
            fee_currency=None,
            rejection_reason=None,
            created_at=(
                template.created_at if template is not None else updated_at
            ),
            updated_at=updated_at,
            submitted_at=template.submitted_at if template is not None else updated_at,
            terminal_at=(
                updated_at if status in _TERMINAL_VENUE_STATUSES else None
            ),
        )


_TERMINAL_VENUE_STATUSES = frozenset(
    {
        OrderStatus.FILLED,
        OrderStatus.CANCELLED,
        OrderStatus.REJECTED,
        OrderStatus.EXPIRED,
    }
)

_VENUE_ORDER_TYPES: dict[str, OrderType] = {
    "MARKET": OrderType.MARKET,
    "LIMIT": OrderType.LIMIT,
    "LIMIT_MAKER": OrderType.LIMIT,
    "STOP_LOSS": OrderType.STOP,
    "TAKE_PROFIT": OrderType.STOP,
    "STOP_LOSS_LIMIT": OrderType.STOP_LIMIT,
    "TAKE_PROFIT_LIMIT": OrderType.STOP_LIMIT,
}


def _order_type_from_venue(raw: str) -> OrderType:
    try:
        return _VENUE_ORDER_TYPES[raw.upper()]
    except KeyError as exc:
        raise BinanceParseError(
            f"Binance returned an unrecognised order type {raw!r}."
        ) from exc


class BinanceAccountAdapter(AccountAdapter):
    """Balances, permissions and credential verification for Binance Spot."""

    __slots__ = ("_client",)

    def __init__(
        self,
        *,
        send: SignedRequestSender,
        credentials: CredentialProvider,
        clock: ExchangeClock,
        rate_limits: RateLimitRegistry | None = None,
        testnet: bool = False,
        rest_base: str | None = None,
        recv_window_ms: int = 5_000,
        timeout_ms: int = 10_000,
    ) -> None:
        self._client = _BinanceSignedClient(
            send=send,
            credentials=credentials,
            clock=clock,
            rate_limits=rate_limits,
            testnet=testnet,
            rest_base=rest_base,
            recv_window_ms=recv_window_ms,
            timeout_ms=timeout_ms,
        )

    @property
    def exchange(self) -> ExchangeId:
        return ExchangeId.BINANCE

    async def fetch_balances(
        self, tenant_id: str, account_id: str
    ) -> tuple[AccountBalance, ...]:
        account = await self.fetch_account(tenant_id, account_id)
        return account.balances

    async def fetch_account(self, tenant_id: str, account_id: str) -> VenueAccount:
        """``GET /api/v3/account``, normalised.

        ``omitZeroBalances`` is not requested: the full list is fetched so a
        balance that has just gone to zero is reported as zero rather than
        vanishing, which would look identical to a parse failure.
        """
        payload = await self._client.signed(
            method="GET",
            path="/api/v3/account",
            params=[],
            tenant_id=tenant_id,
            account_id=account_id,
            weight=BINANCE_REST_WEIGHTS["account"],
        )
        if not isinstance(payload, Mapping):
            raise BinanceParseError(
                "Binance returned a non-object response to an account query."
            )

        raw_balances = payload.get("balances") or ()
        balances: list[AccountBalance] = []
        if isinstance(raw_balances, Sequence) and not isinstance(
            raw_balances, (str, bytes)
        ):
            for entry in raw_balances:
                if not isinstance(entry, Mapping):
                    continue
                balances.append(
                    AccountBalance(
                        asset=str(entry.get("asset", "")),
                        free=parse_decimal(entry.get("free", "0"), "balance.free"),
                        locked=parse_decimal(
                            entry.get("locked", "0"), "balance.locked"
                        ),
                    )
                )

        update_time = payload.get("updateTime")
        return VenueAccount(
            exchange=ExchangeId.BINANCE,
            balances=tuple(balances),
            can_trade=bool(payload.get("canTrade", False)),
            can_withdraw=bool(payload.get("canWithdraw", False)),
            can_deposit=bool(payload.get("canDeposit", False)),
            account_type=str(payload.get("accountType", "SPOT")),
            updated_at_micros=int(update_time) * 1_000 if update_time else None,
            maker_commission_bps=_commission_bps(payload.get("makerCommission")),
            taker_commission_bps=_commission_bps(payload.get("takerCommission")),
        )

    async def fetch_positions(
        self, tenant_id: str, account_id: str
    ) -> tuple[VenuePosition, ...]:
        """Spot has no positions.

        Returning an empty tuple is the honest answer. A spot balance is not a
        position: it has no entry price, no leverage and no liquidation, and
        presenting one as a position would give the reconciliation service a
        cost basis it would then compare against a real one and always find
        wrong.
        """
        return ()

    async def verify_credentials(
        self, tenant_id: str, account_id: str
    ) -> tuple[bool, str]:
        """Check the key works and is safe to hold.

        Withdrawal capability is a hard failure. The platform is non-custodial;
        a key that can move funds off the exchange turns a compromise of this
        platform into a loss of customer funds, and no feature is worth that.
        """
        try:
            account = await self.fetch_account(tenant_id, account_id)
        except AdapterRejectedError as exc:
            return (False, f"The venue rejected these credentials: {exc}")
        except AdapterRateLimitedError as exc:
            return (False, f"Could not verify: {exc}")
        except AdapterConnectionError as exc:
            return (False, f"Could not reach the venue to verify: {exc}")

        if account.can_withdraw:
            return (
                False,
                "This API key has WITHDRAWAL permission enabled. The platform "
                "refuses withdrawal-capable keys. Recreate the key on Binance "
                "with only 'Enable Reading' and 'Enable Spot & Margin Trading', "
                "and consider adding an IP allowlist.",
            )
        if not account.can_trade:
            return (
                False,
                "This API key cannot trade. Enable 'Enable Spot & Margin "
                "Trading' on Binance, or connect it as a read-only account.",
            )
        return (
            True,
            f"Verified: spot trading enabled, withdrawals disabled, "
            f"{len(account.non_zero_balances)} funded asset(s).",
        )


def _commission_bps(raw: Any) -> Decimal | None:
    """Binance reports commission in units of 0.01%, i.e. basis points."""
    if raw is None:
        return None
    try:
        return Decimal(str(raw))
    except (TypeError, ValueError, ArithmeticError):
        return None
