"""Binance USD-M futures private user-data stream.

Composes :class:`~wlct_trading.exchanges.binance.userstream.ListenKeyManager`
(it is key-venue semantics, not spot-specific) against the futures listen-key
endpoints, and parses ACCOUNT_UPDATE / ORDER_TRADE_UPDATE / listenKeyExpired
frames. The frame-level semantics match the spot stream for ORDER_TRADE_UPDATE
(fill math, decimal strings); ACCOUNT_UPDATE is futures-specific (positions +
balances in the same push) and parsed total here.

Key custody rules carried over from spot:

- the key never escapes in any string representation - only masked;
- the REST calls it rides are keyed (``X-MBX-APIKEY``) but unsigned: a leaked
  listen key grants read on the account's flow, never write;
- stream URL is fetched via :meth:`ListenKeyManager.stream_url`, never by
  interpolating the key ourselves.
"""

from __future__ import annotations

import json
from decimal import Decimal
from typing import Any, Awaitable, Callable, Mapping, Sequence

from wlct_trading.adapters.base import AdapterError
from wlct_trading.clock import epoch_micros
from wlct_trading.enums import ExchangeId, OrderSide, OrderStatus
from wlct_trading.exchanges.binance.userstream import ListenKeyManager
from wlct_trading.exchanges.binance_futures.capabilities import (
    BINANCE_FUTURES_TESTNET_WS_BASE,
    BINANCE_FUTURES_WS_BASE,
    FUTURES_REST_WEIGHTS,
)
from wlct_trading.exchanges.binance_futures.parsers import (
    FuturesParseError,
    parse_decimal_strict,
    parse_futures_order_status,
    parse_futures_order_type,
    parse_futures_time_in_force,
)
from wlct_trading.orders import Fill

__all__ = [
    "FuturesListenKeyClient",
    "FuturesUserStream",
    "parse_futures_execution_report",
    "parse_account_update",
]

#: Futures listen-key endpoints relative to the REST base (``/fapi/v1``).
LISTEN_KEY_PATH = "/fapi/v1/listenKey"


# The two helpers below wrap the injected keyed REST caller; a plain typed
# callable keeps the futures package free of any SDK import while exercising
# auth+request exactly the way the runtime will.

KeyedSender = Callable[..., Awaitable[Any]]


class FuturesListenKeyClient:
    """Keyed REST calls for ``POST/PUT/DELETE /fapi/v1/listenKey``.

    These endpoints are key-authenticated, never signed (independent of the
    trading signed path): an unsigned key call leaking would expose the read-
    only key, not account authority - still treat the key as credential-
    sensitive by never rendering it.
    """

    __slots__ = ("_keyed",)

    def __init__(self, *, keyed: KeyedSender) -> None:
        """``keyed`` matches the futures signed client ``.keyed(...)`` verb."""

        self._keyed = keyed

    async def create(self, *, tenant_id: str, account_id: str) -> str:
        result = await self._keyed(
            method="POST",
            path=LISTEN_KEY_PATH,
            params=(),
            tenant_id=tenant_id,
            account_id=account_id,
            weight=FUTURES_REST_WEIGHTS["user_stream_place"],
        )
        if not isinstance(result, Mapping) or not isinstance(result.get("listenKey"), str):
            raise AdapterError("Binance USD-M listen key create returned no listenKey")
        return result["listenKey"]

    async def keepalive(self, listen_key: str, *, tenant_id: str, account_id: str) -> None:
        # listenKey is sent as a query param; keyed (not signed); value never
        # interpolated into logs (callers log outcomes, not keys).
        await self._keyed(
            method="PUT",
            path=LISTEN_KEY_PATH,
            params=(("listenKey", listen_key),),
            tenant_id=tenant_id,
            account_id=account_id,
            weight=FUTURES_REST_WEIGHTS["user_stream_keepalive"],
        )

    async def close(self, listen_key: str, *, tenant_id: str, account_id: str) -> None:
        await self._keyed(
            method="DELETE",
            path=LISTEN_KEY_PATH,
            params=(("listenKey", listen_key),),
            tenant_id=tenant_id,
            account_id=account_id,
            weight=FUTURES_REST_WEIGHTS["user_stream_close"],
        )


def _side(raw: Any) -> OrderSide:
    if raw == "BUY":
        return OrderSide.BUY
    if raw == "SELL":
        return OrderSide.SELL
    raise FuturesParseError(f"futures userstream side unseen: {raw!r}")


def parse_futures_execution_report(
    payload: Mapping[str, Any],
    *,
    exchange: ExchangeId = ExchangeId.BINANCE,
) -> dict[str, Any]:
    """Parse ORDER_TRADE_UPDATE (executionReport-shaped o field).

    Returns a mapping with the Fill-bearing fields the engine reconciler reads;
    floating point never enters here (parse_decimal_strict strings only).
    """
    if not isinstance(payload, Mapping):
        raise FuturesParseError("execution report payload is not an object")
    order = payload.get("o")
    if not isinstance(order, Mapping):
        raise FuturesParseError("ORDER_TRADE_UPDATE missing 'o' object")

    status = parse_futures_order_status(order.get("x", order.get("X", "")), field="o.x")
    executed_qty = parse_decimal_strict(order.get("z", "0"), "o.z")
    last_qty = parse_decimal_strict(order.get("l", "0"), "o.l")
    last_price = parse_decimal_strict(order.get("L", "0"), "o.L")
    avg_price = parse_decimal_strict(order.get("ap", "0"), "o.ap")
    commission_raw = order.get("n", "0")
    commission = parse_decimal_strict(commission_raw, "o.n")
    commission_asset = order.get("N", "")
    trade_id = order.get("t", 0)
    return {
        "exchange": exchange,
        "symbol": str(order.get("s", "")),
        "client_order_id": str(order.get("c", "")),
        "venue_order_id": str(order.get("i", "")),
        "side": _side(order.get("S")),
        "order_type": parse_futures_order_type(order.get("o", "MARKET"), field="o.o"),
        "time_in_force": parse_futures_time_in_force(order.get("f", "GTC"), field="o.f"),
        "status": status,
        "cumulative_filled_quantity": executed_qty,
        "last_executed_quantity": last_qty,
        "last_executed_price": last_price,
        "average_price": avg_price if executed_qty > 0 else None,
        "commission": commission,
        "commission_asset": str(commission_asset),
        "trade_id": trade_id if isinstance(trade_id, int) else int(trade_id or 0),
        "is_maker": bool(order.get("m", False)),
        "trade_time_micros": int(order.get("T", 0)) * 1_000,
        "reduce_only": bool(order.get("R", False)),
    }


def parse_account_update(payload: Mapping[str, Any]) -> dict[str, Any]:
    """Parse ACCOUNT_UPDATE (balances + positions in one push)."""
    if not isinstance(payload, Mapping):
        raise FuturesParseError("ACCOUNT_UPDATE payload is not an object")
    a = payload.get("a")
    if not isinstance(a, Mapping):
        raise FuturesParseError("ACCOUNT_UPDATE missing 'a' object")
    balances_raw = a.get("B", [])
    positions_raw = a.get("P", [])
    if not isinstance(balances_raw, list) or not isinstance(positions_raw, list):
        raise FuturesParseError("ACCOUNT_UPDATE B/P not arrays")

    balances = []
    for entry in balances_raw:
        if not isinstance(entry, Mapping):
            raise FuturesParseError("balance entry is not an object")
        balances.append(
            {
                "asset": str(entry.get("a", "")),
                "wallet_balance": parse_decimal_strict(entry.get("wb", "0"), "wb"),
                "cross_wallet_balance": parse_decimal_strict(entry.get("cw", "0"), "cw"),
                "balance_change": parse_decimal_strict(entry.get("bc", "0"), "bc"),
            }
        )
    positions = []
    for entry in positions_raw:
        if not isinstance(entry, Mapping):
            raise FuturesParseError("position entry is not an object")
        amt = parse_decimal_strict(entry.get("pa", "0"), "pa")
        if amt == 0:
            continue
        positions.append(
            {
                "symbol": str(entry.get("s", "")),
                "position_amt": amt,
                "entry_price": parse_decimal_strict(entry.get("ep", "0"), "ep"),
                "unrealized_pnl": parse_decimal_strict(entry.get("up", "0"), "up"),
                "margin_type": str(entry.get("mt", "")),
            }
        )
    return {
        "reason": str(a.get("m", "")),
        "balances": tuple(balances),
        "positions": tuple(positions),
        "event_time_micros": int(payload.get("E", 0)) * 1_000,
        "transaction_time_micros": int(payload.get("T", 0)) * 1_000,
    }


class FuturesUserStream:
    """Orchestrates one futures listen-key lifecycle (create/renew/close) and
    emits typed parse results to an injected consumer callback. Socket wiring
    itself stays in the execution engine; this object owns key custody and
    message decoding only.
    """

    def __init__(
        self,
        *,
        keyed_client: FuturesListenKeyClient,
        tenant_id: str,
        account_id: str,
        testnet: bool = False,
        ws_base: str | None = None,
        refresh_interval_millis: int = 1_800_000,
    ) -> None:
        base = (ws_base or (BINANCE_FUTURES_TESTNET_WS_BASE if testnet else BINANCE_FUTURES_WS_BASE)).strip().rstrip("/")
        self._tenant_id = tenant_id
        self._account_id = account_id
        self._key_manager = ListenKeyManager(
            create=lambda: keyed_client.create(tenant_id=tenant_id, account_id=account_id),
            keepalive=lambda key: keyed_client.keepalive(key, tenant_id=tenant_id, account_id=account_id),
            close=lambda key: keyed_client.close(key, tenant_id=tenant_id, account_id=account_id),
            ws_base=base,
            refresh_interval_millis=refresh_interval_millis,
        )

    @property
    def key_manager(self) -> ListenKeyManager:
        return self._key_manager

    async def acquire(self) -> str:
        """Acquire the listen key and return the stream URL (not the key)."""
        return await self._key_manager.acquire()

    async def renew(self) -> bool:
        return await self._key_manager.renew()

    async def release(self) -> None:
        await self._key_manager.release()

    def handle_frame(self, raw: str) -> dict[str, Any] | None:
        """Decode one websocket text frame into a typed event, or None for
        frames that are intentionally ignorable (pings, subscribe ACKs).

        Raises AdapterError/FuturesParseError on protocol violations - the
        socket loop closes and resyncs on those, never silently swallows.
        """
        try:
            parsed = json.loads(raw, parse_float=str)
        except ValueError as exc:
            raise FuturesParseError("futures userstream frame is not valid JSON") from exc
        if not isinstance(parsed, Mapping):
            raise FuturesParseError("futures userstream frame is not an object")
        event_type = parsed.get("e")
        if event_type is None:
            # subscribe result / pong control frame
            return None
        if event_type == "ORDER_TRADE_UPDATE":
            return {"kind": "execution_report", "report": parse_futures_execution_report(parsed)}
        if event_type == "ACCOUNT_UPDATE":
            return {"kind": "account_update", "update": parse_account_update(parsed)}
        if event_type == "listenKeyExpired":
            self._key_manager.invalidate()
            return {"kind": "listen_key_expired"}
        # Other USD-M stream types (MARGIN_CALL, ACCOUNT_CONFIG_UPDATE) are
        # parsed separately by the engine's liquidation surface; here they are
        # intentionally passed through untyped so the dedup layer sees the
        # event name but the significance stays with the stream router.
        return {"kind": "passthrough", "event_type": str(event_type), "event": dict(parsed)}
