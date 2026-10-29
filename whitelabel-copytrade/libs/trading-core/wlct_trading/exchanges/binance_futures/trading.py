"""Binance USD-M futures signed trading + account adapters.

Responsibility: the only futures objects that transmit. Shares exact signing
primitives with spot (:func:`build_signed_request`,
:func:`build_keyed_request`, :class:`ExchangeClock`) and the venue error
taxonomy, but does not share instances or module state with the spot
adapters: the batches' spot-parity contract forbids editing
``wlct_trading.exchanges.binance`` and a shared singleton would let a futures
wiring bug saturate the spot weight budget (different budget names prevent
that here exactly).

Placement posture
-----------------
Every outgoing order goes through :class:`FuturesGuardedTradingAdapter`
(:mod:`wlct_trading.exchanges.binance_futures.risk_guards` verdicts recorded
and enforced) rather than the raw adapter directly; the raw adapter stays
importable for outcome resolution and account reads, where guards don't
apply. ``is_simulated`` is False - these adapters are the live path hiding
behind the engine's gates; nothing here decides to run, the engine does.

Serialization law: quantities and prices are formatted with
:func:`~wlct_trading.exchanges.binance.signing.format_decimal` (no float, no
scientific notation, trailing zeros stripped); the venue's filter field
names (``stepSize``, ``tickSize``, ``minQty``...) surface through
``exchangeInfo`` parsing in the engine's placement review, not here.
"""

from __future__ import annotations

import json
from decimal import Decimal
from typing import Any, Awaitable, Callable, Mapping, Sequence

from wlct_trading.adapters.base import (
    AccountAdapter,
    AdapterConnectionError,
    AdapterError,
    AdapterRateLimitedError,
    AdapterRejectedError,
    SubmitResult,
    CancelResult,
    TradingAdapter,
    VenueAccount,
    VenuePosition,
    AccountBalance,
)
from wlct_trading.clock import epoch_micros
from wlct_trading.enums import ExchangeId, OrderSide, OrderStatus, OrderType, TimeInForce
from wlct_trading.execution.credentials import CredentialProvider, ExchangeCredentials
from wlct_trading.execution.timesync import ExchangeClock
from wlct_trading.exchanges.binance.signing import (
    SignatureError,
    SignedRequest,
    build_keyed_request,
    build_signed_request,
    format_decimal,
)
from wlct_trading.exchanges.binance.trading import HttpResponse, SignedRequestSender
from wlct_trading.exchanges.binance_futures.adapter import (
    BinanceFuturesMarketData,
    FuturesClientError,
    FuturesRateLimited,
    build_futures_registry,
)
from wlct_trading.exchanges.binance_futures.capabilities import (
    BINANCE_FUTURES_CAPABILITIES,
    BINANCE_FUTURES_REST_BASE,
    BINANCE_FUTURES_TESTNET_REST_BASE,
    FUTURES_REST_WEIGHTS,
)
from wlct_trading.exchanges.binance_futures.parsers import (
    FuturesParseError,
    classify_futures_error,
    order_client_id,
    parse_decimal_strict,
    parse_futures_account_v2,
    parse_futures_order_status,
    parse_futures_order_type,
    parse_futures_time_in_force,
    parse_position_risk_entry,
)
from wlct_trading.orders import Fill, Order, OrderIntent
from wlct_trading.transport.errors import ExchangeErrorCategory
from wlct_trading.transport.ratelimit import RateLimitRegistry

__all__ = [
    "FuturesTradingParams",
    "BinanceFuturesTradingAdapter",
    "BinanceFuturesAccountAdapter",
    "to_futures_order_type",
    "venue_symbol",
]

_FUTURES_ORDER_TYPE_MAP: dict[OrderType, str] = {
    OrderType.MARKET: "MARKET",
    OrderType.LIMIT: "LIMIT",
    OrderType.STOP: "STOP_MARKET",
    OrderType.STOP_LIMIT: "STOP",
}

_FUTURES_TIF_MAP: dict[TimeInForce, str] = {
    TimeInForce.GTC: "GTC",
    TimeInForce.IOC: "IOC",
    TimeInForce.FOK: "FOK",
}


def venue_symbol(symbol: str) -> str:
    """Futures symbols carry no separator (BTC/USDT -> BTCUSDT)."""
    return symbol.replace("/", "").replace("-", "").upper()


def to_futures_order_type(order_type: OrderType) -> str:
    """Platform -> Binance USD-M order type vocabulary."""
    try:
        return _FUTURES_ORDER_TYPE_MAP[order_type]
    except KeyError as exc:  # enum is closed; defensive against future members
        raise AdapterRejectedError(
            "UNSUPPORTED_ORDER_TYPE",
            f"Binance USD-M futures does not carry order type {order_type.value}.",
        ) from exc


class FuturesTradingParams:
    """Sender callable plus rest-base choice, packaged for the two adapters."""

    __slots__ = ("send", "rest_base", "rate_limits", "recv_window_ms", "timeout_ms")

    def __init__(
        self,
        *,
        send: SignedRequestSender,
        rest_base: str,
        rate_limits: RateLimitRegistry,
        recv_window_ms: int = 5_000,
        timeout_ms: int = 10_000,
    ) -> None:
        if not rest_base.startswith("https://"):
            raise ValueError("futures signed endpoints require HTTPS")
        self.send = send
        self.rest_base = rest_base.rstrip("/")
        self.rate_limits = rate_limits
        self.recv_window_ms = recv_window_ms
        self.timeout_ms = timeout_ms


def futures_rest_base(*, testnet: bool, override: str | None = None) -> str:
    base = override or (BINANCE_FUTURES_TESTNET_REST_BASE if testnet else BINANCE_FUTURES_REST_BASE)
    cleaned = base.strip().rstrip("/")
    if not cleaned.startswith("https://"):
        raise ValueError(f"futures rest_base must be HTTPS; got {base!r}")
    if "data-api.binance.vision" in cleaned or "data-stream" in cleaned:
        raise ValueError(f"{cleaned} is the spot public mirror; futures traffic cannot route there")
    return cleaned


class _FuturesSignedClient:
    """Signing, rate limiting and response decoding, composed alias-style with
    the spot client rather than inherited: adapters hold one, nothing else."""

    __slots__ = ("_params", "_credentials", "_clock")

    def __init__(
        self,
        *,
        params: FuturesTradingParams,
        credentials: CredentialProvider,
        clock: ExchangeClock,
    ) -> None:
        self._params = params
        self._credentials = credentials
        self._clock = clock

    @property
    def recv_window_ms(self) -> int:
        return self._params.recv_window_ms

    @property
    def rest_base(self) -> str:
        return self._params.rest_base

    @property
    def clock_skew_millis(self) -> int | None:
        offset = self._clock.offset_millis
        return None if offset is None else abs(int(offset))

    def _reserve(self, weight: int) -> None:
        allowed, decisions = self._params.rate_limits.try_acquire_all(
            {"FUTURES_REQUEST_WEIGHT": weight, "FUTURES_RAW_REQUESTS": 1}
        )
        if not allowed:
            blocking = next((d for d in decisions if not d.allowed), decisions[0])
            raise AdapterRateLimitedError(blocking.retry_after_millis)

    async def _resolve(self, tenant_id: str, account_id: str) -> ExchangeCredentials:
        try:
            credentials = await self._credentials.resolve(tenant_id, account_id, ExchangeId.BINANCE)
        except Exception as exc:  # noqa: BLE001 - already redacted upstream
            raise AdapterRejectedError(
                "CREDENTIALS_UNAVAILABLE",
                f"could not resolve futures credentials for account {account_id}: {type(exc).__name__}",
            ) from exc
        credentials.assert_safe()
        return credentials

    def _error_from_response(self, response: HttpResponse) -> AdapterRejectedError | AdapterConnectionError | FuturesRateLimited:
        code: int | None = None
        message_text = ""
        try:
            body = json.loads(response.body, parse_float=str)
            if isinstance(body, Mapping):
                raw_code = body.get("code")
                if isinstance(raw_code, int):
                    code = raw_code
                raw_msg = body.get("msg")
                if isinstance(raw_msg, str):
                    message_text = raw_msg
        except Exception:
            pass
        category = classify_futures_error(code, response.status)
        if response.status in (418, 429):
            return FuturesRateLimited(
                code=code,
                http_status=response.status,
                category=category,
                message=f"futures venue rate-limited (http={response.status} code={code})",
                retry_after_millis=response.retry_after_millis,
            )
        # The venue's message text is operator-owned (Binance sentences about
        # its own view of the order); still, by law we strip to token length.
        detail = message_text[:200]
        if category in (ExchangeErrorCategory.NETWORK_ERROR, ExchangeErrorCategory.TIMEOUT):
            return AdapterConnectionError(
                f"futures venue transient failure: code={code} http={response.status} ({detail})"
            )
        rejected = AdapterRejectedError(
            f"futures code={code} http={response.status}",
            detail,
        )
        # The venue's numeric code, carried as structured data so callers
        # (outcome resolution on -2013, margin/leverage handling on -2019/-2027)
        # never parse it back out of a formatted string.
        rejected.venue_code = code  # type: ignore[attr-defined]
        return rejected

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
        self._reserve(weight)
        credentials = await self._resolve(tenant_id, account_id)
        timestamp = self._clock.timestamp_millis()
        try:
            request = build_signed_request(
                method=method,
                base_url=self._params.rest_base,
                path=path,
                params=params,
                credentials=credentials,
                timestamp_millis=timestamp,
                recv_window_millis=self._params.recv_window_ms,
            )
        except SignatureError as exc:
            raise AdapterRejectedError("SIGNING_FAILED", str(exc)) from exc
        response = await self._params.send(request, self._params.timeout_ms)
        if response.status >= 400:
            raise self._error_from_response(response)
        try:
            return json.loads(response.body, parse_float=str)
        except Exception as exc:
            raise FuturesParseError(
                f"futures {path} answered non-JSON (http={response.status})"
            ) from exc

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
        self._reserve(weight)
        credentials = await self._resolve(tenant_id, account_id)
        request = build_keyed_request(
            method=method,
            base_url=self._params.rest_base,
            path=path,
            params=params,
            credentials=credentials,
        )
        response = await self._params.send(request, self._params.timeout_ms)
        if response.status >= 400:
            raise self._error_from_response(response)
        if response.status == 204 or response.body.strip() == "":
            return {}
        try:
            return json.loads(response.body, parse_float=str)
        except Exception as exc:
            raise FuturesParseError(f"futures {path} answered non-JSON") from exc


class BinanceFuturesTradingAdapter(TradingAdapter):
    """Order entry for Binance USD-M futures (``/fapi/v1/order``)."""

    def __init__(
        self,
        *,
        params: FuturesTradingParams,
        credentials: CredentialProvider,
        clock: ExchangeClock,
    ) -> None:
        self._client = _FuturesSignedClient(params=params, credentials=credentials, clock=clock)

    @property
    def exchange(self) -> ExchangeId:
        return ExchangeId.BINANCE

    @property
    def is_simulated(self) -> bool:
        # The adapter is the live-keyed path; the engine decides whether to run it.
        return False

    @property
    def recv_window_ms(self) -> int:
        return self._client.recv_window_ms

    @property
    def clock_skew_millis(self) -> int | None:
        return self._client.clock_skew_millis

    def venue_symbol(self, symbol: str) -> str:
        """Futures symbols carry no separator (BTC/USDT -> BTCUSDT)."""
        return venue_symbol(symbol)

    def stream_fills(
        self, tenant_id: str, account_id: str
    ):  # -> AsyncIterator[Fill]: deliberately un-implemented, same law as spot.
        """Private fills live on the user-data stream, not here.

        Same refusal as the spot adapter: :class:`FuturesUserStream` owns the
        listen-key lifecycle, ORDER_TRADE_UPDATE decoding and reconnect gap
        fill; a bare generator would hide exactly the connection state the
        platform must report. Refuse at call time.
        """
        raise AdapterError(
            "Use FuturesUserStream for private fills; it exposes the "
            "connection state and reconnect behaviour that a bare generator "
            "cannot."
        )

    async def submit_order(self, intent: OrderIntent, client_order_id: str) -> SubmitResult:
        symbol = self.venue_symbol(intent.symbol)
        params: list[tuple[str, Any]] = [
            ("symbol", symbol),
            ("side", "BUY" if intent.side is OrderSide.BUY else "SELL"),
            ("type", to_futures_order_type(intent.order_type)),
            ("newClientOrderId", client_order_id),
            ("quantity", format_decimal(intent.quantity)),
            ("newOrderRespType", "RESULT"),
        ]
        if intent.order_type == OrderType.LIMIT:
            if intent.price is None:
                raise AdapterRejectedError("MISSING_PRICE", "LIMIT order requires a price")
            params.extend(
                [
                    ("timeInForce", _FUTURES_TIF_MAP[intent.time_in_force]),
                    ("price", format_decimal(intent.price)),
                ]
            )
        elif intent.time_in_force != TimeInForce.GTC and intent.order_type != OrderType.MARKET:
            params.append(("timeInForce", _FUTURES_TIF_MAP[intent.time_in_force]))
        if intent.stop_price is not None and intent.order_type in (OrderType.STOP, OrderType.STOP_LIMIT):
            params.append(("stopPrice", format_decimal(intent.stop_price)))
        if intent.reduce_only:
            params.append(("reduceOnly", "true"))

        result = await self._client.signed(
            method="POST",
            path="/fapi/v1/order",
            params=params,
            tenant_id=intent.tenant_id,
            account_id=intent.account_id,
            weight=FUTURES_REST_WEIGHTS["order_place"],
        )
        if not isinstance(result, Mapping):
            raise FuturesParseError("order placement returned a non-object")
        status = parse_futures_order_status(result.get("status"), field="order status")
        executed_qty = parse_decimal_strict(result.get("executedQty", "0"), "executedQty")
        avg_price_raw = result.get("avgPrice")
        avg_price = None if avg_price_raw is None or avg_price_raw in ("0", "0.0") else parse_decimal_strict(avg_price_raw, "avgPrice")
        fills: tuple[Fill, ...] = tuple()
        exchange_order_id = str(result.get("orderId")) if result.get("orderId") is not None else None
        update_micros = int(result.get("updateTime", 0)) * 1_000 or epoch_micros()
        if executed_qty > 0 and avg_price is not None:
            fills = (
                Fill(
                    # Deterministic per order: the RESULT payload is one
                    # aggregated fill, so the same submission answer re-read
                    # deduplicates on this id instead of double-counting.
                    fill_id=f"{exchange_order_id or client_order_id}:agg-result",
                    order_id=exchange_order_id or client_order_id,
                    trade_id="",
                    quantity=executed_qty,
                    price=avg_price,
                    fee=Decimal("0"),
                    fee_currency="USDT",
                    is_maker=False,
                    is_simulated=False,
                    exchange_timestamp=update_micros,
                    received_timestamp=epoch_micros(),
                    symbol=str(result.get("symbol", symbol)),
                    side=intent.side,
                    exchange=ExchangeId.BINANCE,
                    quote_quantity=avg_price * executed_qty,
                    exchange_order_id=exchange_order_id,
                ),
            )
        return SubmitResult(
            accepted=status in (OrderStatus.ACKNOWLEDGED, OrderStatus.PARTIALLY_FILLED, OrderStatus.FILLED),
            exchange_order_id=exchange_order_id,
            status=status,
            rejection_code=None if status not in (OrderStatus.REJECTED,) else str(result.get("status")),
            rejection_reason=None,
            is_simulated=False,
            submitted_at_micros=update_micros,
            fills=fills,
        )

    async def cancel_order(self, order: Order) -> CancelResult:
        params: list[tuple[str, Any]] = [
            ("symbol", self.venue_symbol(order.symbol)),
            ("origClientOrderId", order.client_order_id),
        ]
        try:
            result = await self._client.signed(
                method="DELETE",
                path="/fapi/v1/order",
                params=params,
                tenant_id=order.tenant_id,
                account_id=order.account_id,
                weight=FUTURES_REST_WEIGHTS["order_cancel"],
            )
        except AdapterRejectedError as exc:
            if getattr(exc, "venue_code", None) == -2011:
                # -2011 "Unknown order sent": already filled, cancelled or
                # expired - not an error for a cancel. Structured venue code,
                # never a string match on message text.
                return CancelResult(
                    accepted=False,
                    status=order.status,
                    reason=(
                        "The futures venue has no such open order; it was "
                        "already filled, cancelled or expired."
                    ),
                    is_simulated=False,
                )
            raise
        if not isinstance(result, Mapping):
            raise FuturesParseError("cancel response is not an object")
        status = parse_futures_order_status(result.get("status", ""), field="cancel status")
        return CancelResult(
            accepted=status is OrderStatus.CANCELLED,
            status=status,
            reason="Cancelled at the venue." if status is OrderStatus.CANCELLED else f"Venue answered {status.value}.",
            is_simulated=False,
        )

    async def fetch_order(self, tenant_id: str, account_id: str, client_order_id: str, *, symbol_hint: str | None = None) -> Order | None:
        symbol = symbol_hint
        if symbol is None:
            raise AdapterRejectedError(
                "SYMBOL_REQUIRED",
                "futures fetch_order requires a symbol hint; the venue's order endpoint scopes by symbol",
            )
        result = await self._query_order(
            tenant_id=tenant_id, account_id=account_id,
            client_order_id=client_order_id, symbol=symbol,
        )
        if result is None:
            return None
        return self._order_from_payload(result, tenant_id=tenant_id, account_id=account_id)

    async def fetch_order_for(self, order: Order) -> Order | None:
        """Query ``GET /fapi/v1/order`` for a known local order - the outcome path.

        Returns ``None`` only on Binance's explicit ``-2013`` ("order does not
        exist"): the single answer after which resubmission cannot duplicate
        anything. Every other failure raises, because "could not ask" and "not
        there" must never be confused. The symbol comes from the local record
        (the durable store), never re-derived.
        """
        result = await self._query_order(
            tenant_id=order.tenant_id, account_id=order.account_id,
            client_order_id=order.client_order_id, symbol=order.symbol,
        )
        if result is None:
            return None
        return self._order_from_payload(result, tenant_id=order.tenant_id, account_id=order.account_id)

    async def _query_order(
        self,
        *,
        tenant_id: str,
        account_id: str,
        client_order_id: str,
        symbol: str,
    ) -> Mapping[str, Any] | None:
        try:
            result = await self._client.signed(
                method="GET",
                path="/fapi/v1/order",
                params=(("symbol", self.venue_symbol(symbol)), ("origClientOrderId", client_order_id)),
                tenant_id=tenant_id,
                account_id=account_id,
                weight=FUTURES_REST_WEIGHTS["order_query"],
            )
        except AdapterRejectedError as exc:
            if getattr(exc, "venue_code", None) == -2013:
                # The venue's positive "no such order" for origClientOrderId:
                # the only answer after which resubmission cannot duplicate
                # anything. Structured venue code, never a string match on
                # free-text message content.
                return None
            raise
        if not isinstance(result, Mapping):
            raise FuturesParseError("fetch_order: response is not an object")
        return result

    async def fetch_open_orders(
        self, tenant_id: str, account_id: str, symbol: str | None = None
    ) -> tuple[Order, ...]:
        path = "/fapi/v1/openOrders"
        params: list[tuple[str, Any]] = [("symbol", self.venue_symbol(symbol))] if symbol else []
        result = await self._client.signed(
            method="GET",
            path=path,
            params=params,
            tenant_id=tenant_id,
            account_id=account_id,
            weight=(
                FUTURES_REST_WEIGHTS["open_orders_symbol"]
                if symbol
                else FUTURES_REST_WEIGHTS["open_orders_all"]
            ),
        )
        if not isinstance(result, list):
            raise FuturesParseError("openOrders response is not an array")
        orders: list[Order] = []
        for entry in result:
            if isinstance(entry, Mapping):
                orders.append(self._order_from_payload(entry, tenant_id=tenant_id, account_id=account_id))
        return tuple(orders)

    async def exchange_time(self) -> int:
        """Proxy the public time via the internal sender (recorder-audited)."""
        md = BinanceFuturesMarketData(
            send=self._client._params.send,  # noqa: SLF001 - same harness, keyed paths differ
            rate_limits=self._client._params.rate_limits,  # noqa: SLF001 - one budget for the venue IP
            rest_base=self._client._params.rest_base,  # noqa: SLF001
        )
        return await md.fetch_server_time_micros()

    def _order_from_payload(
        self, payload: Mapping[str, Any], *, tenant_id: str, account_id: str
    ) -> Order:
        status = parse_futures_order_status(payload.get("status"), field="status")
        order_type = parse_futures_order_type(payload.get("type"), field="type")
        side_raw = str(payload.get("side", "")).upper()
        side = OrderSide.BUY if side_raw == "BUY" else OrderSide.SELL if side_raw == "SELL" else None
        if side is None:
            raise FuturesParseError(f"side unseen: {payload.get('side')!r}")
        qty = parse_decimal_strict(payload.get("origQty", payload.get("quantity", "0")), "origQty")
        executed = parse_decimal_strict(payload.get("executedQty", "0"), "executedQty")
        price_raw = payload.get("price")
        price = None if price_raw is None or str(price_raw) == "0" else parse_decimal_strict(price_raw, "price")
        stop_raw = payload.get("stopPrice")
        stop_price = None if stop_raw is None or str(stop_raw) == "0" else parse_decimal_strict(stop_raw, "stopPrice")
        updated_raw = payload.get("updateTime", payload.get("time", 0))
        avg_raw = payload.get("avgPrice")
        avg_price = None if avg_raw is None or str(avg_raw) == "0" else parse_decimal_strict(avg_raw, "avgPrice")
        order = Order(
            order_id=str(payload.get("orderId", "")),
            client_order_id=order_client_id(payload.get("clientOrderId"), field="clientOrderId"),
            tenant_id=tenant_id,
            account_id=account_id,
            strategy_id=None,
            exchange=ExchangeId.BINANCE,
            symbol=str(payload.get("symbol", "")),
            side=side,
            order_type=order_type,
            quantity=qty,
            price=price,
            stop_price=stop_price,
            time_in_force=parse_futures_time_in_force(payload.get("timeInForce", "GTC")),
            reduce_only=bool(payload.get("reduceOnly", False)),
            is_simulated=False,
            status=status,
            exchange_order_id=str(payload.get("orderId", "")) or None,
            created_at=int(payload.get("time", 0)) * 1_000,
            updated_at=int(updated_raw) * 1_000,
            filled_quantity=executed,
            average_fill_price=avg_price,
        )
        return order


class BinanceFuturesAccountAdapter(AccountAdapter):
    """Account/position observation on ``/fapi/v2/account`` + ``v2/positionRisk``."""

    def __init__(
        self,
        *,
        params: FuturesTradingParams,
        credentials: CredentialProvider,
        clock: ExchangeClock,
    ) -> None:
        self._client = _FuturesSignedClient(params=params, credentials=credentials, clock=clock)

    @property
    def exchange(self) -> ExchangeId:
        return ExchangeId.BINANCE

    async def fetch_account(self, tenant_id: str, account_id: str) -> dict[str, Any]:
        result = await self._client.signed(
            method="GET",
            path="/fapi/v2/account",
            params=(),
            tenant_id=tenant_id,
            account_id=account_id,
            weight=FUTURES_REST_WEIGHTS["account_v2"],
        )
        if not isinstance(result, Mapping):
            raise FuturesParseError("account v2 is not an object")
        return parse_futures_account_v2(result)

    async def fetch_balances(self, tenant_id: str, account_id: str) -> tuple[AccountBalance, ...]:
        account = await self.fetch_account(tenant_id, account_id)
        balances: list[AccountBalance] = []
        for entry in account["balances"]:
            balances.append(
                AccountBalance(
                    asset=str(entry["asset"]),
                    available=entry["available_balance"],
                    locked=entry["wallet_balance"] - entry["available_balance"],
                    is_simulated=False,
                )
            )
        return tuple(balances)

    async def fetch_positions(
        self, tenant_id: str, account_id: str, symbol: str | None = None
    ) -> tuple[VenuePosition, ...]:
        params: list[tuple[str, Any]] = []
        if symbol:
            params.append(("symbol", venue_symbol(symbol)))
        result = await self._client.signed(
            method="GET",
            path="/fapi/v2/positionRisk",
            params=params,
            tenant_id=tenant_id,
            account_id=account_id,
            weight=FUTURES_REST_WEIGHTS["position_risk_v2"],
        )
        if not isinstance(result, list):
            raise FuturesParseError("positionRisk response is not an array")
        positions: list[VenuePosition] = []
        for entry in result:
            if not isinstance(entry, Mapping):
                raise FuturesParseError("positionRisk entry is not an object")
            parsed = parse_position_risk_entry(entry)
            if parsed["position_amt"] == 0:
                continue
            positions.append(
                VenuePosition(
                    symbol=parsed["symbol"],
                    # The magnitude is the platform's holding; direction is
                    # signed away from the venue's +/- convention by callers
                    # that need it, never guessed here: a negative positionAmt
                    # is a SHORT leg, absolute value is the quantity held.
                    quantity=abs(parsed["position_amt"]),
                    entry_price=parsed["entry_price"],
                    unrealised_pnl=parsed["unrealized_pnl"],
                    leverage=parsed["leverage"],
                )
            )
        return tuple(positions)

    async def set_leverage(
        self, tenant_id: str, account_id: str, symbol: str, leverage: int
    ) -> dict[str, Any]:
        result = await self._client.signed(
            method="POST",
            path="/fapi/v1/leverage",
            params=(("symbol", symbol), ("leverage", leverage)),
            tenant_id=tenant_id,
            account_id=account_id,
            weight=FUTURES_REST_WEIGHTS["leverage_change"],
        )
        if not isinstance(result, Mapping):
            raise FuturesParseError("leverage response is not an object")
        return {
            "symbol": result.get("symbol"),
            "leverage": parse_decimal_strict(result.get("leverage", "0"), "leverage"),
            "max_notional_value": parse_decimal_strict(
                result.get("maxNotionalValue", "0"), "maxNotionalValue"
            ),
        }

    async def set_margin_type(
        self, tenant_id: str, account_id: str, symbol: str, margin_type: str
    ) -> None:
        normalized = margin_type.strip().upper()
        if normalized not in ("ISOLATED", "CROSSED"):
            raise AdapterRejectedError(
                "INVALID_MARGIN_TYPE", f"margin type must be ISOLATED or CROSSED; got {margin_type!r}"
            )
        try:
            await self._client.signed(
                method="POST",
                path="/fapi/v1/marginType",
                params=(("symbol", symbol), ("marginType", normalized)),
                tenant_id=tenant_id,
                account_id=account_id,
                weight=FUTURES_REST_WEIGHTS["margin_type_change"],
            )
        except AdapterRejectedError as exc:
            # -4059 NO_NEED_TO_CHANGE_POSITION_SIDE... for margin type the
            # venue answers -4059 (no-op) when the account is already on the
            # requested mode: idempotent success, same law the dev server
            # documents for the spot duplicate-order path. Structured venue
            # code, never a string match on message text.
            if getattr(exc, "venue_code", None) == -4059:
                return
            raise

    async def verify_credentials(
        self, tenant_id: str, account_id: str
    ) -> dict[str, Any]:
        """Light key-context probe: ``/fapi/v2/account`` reports tradeable state."""
        account = await self.fetch_account(tenant_id, account_id)
        return {
            "can_trade": account["can_trade"],
            "fee_tier": account["fee_tier"],
            "read_only": False,
            "permissions": ["FUTURES_EARMARKED", "MARGIN_READ"],
        }
