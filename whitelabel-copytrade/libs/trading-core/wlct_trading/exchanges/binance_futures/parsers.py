"""Binance USD-M futures payload parsers.

Responsibility: every byte the futures venue emits crosses this module before
anything else in the platform may read it. Parsing is *total*: fields the
platform depends on are required and type-checked, unknown order statuses are
rejected rather than coerced, and every numeric is parsed through
:class:`decimal.Decimal` - never through ``float`` - because a float in the
futures path is how a copy leg quietly overbuys its hedge.

Nothing here performs I/O. Adapters feed raw JSON dicts; this module returns
typed platform structures or raises :class:`FuturesParseError`.

Error classification lives here too: :func:`classify_futures_error` maps the
published ``fapi`` error-code table onto the transport taxonomy so retries,
circuit breakers and the engine all agree on what is retryable.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any, Mapping

from wlct_trading.enums import OrderSide, OrderStatus, OrderType, TimeInForce
from wlct_trading.transport.errors import ExchangeErrorCategory

__all__ = [
    "FuturesParseError",
    "classify_futures_error",
    "parse_decimal_strict",
    "parse_futures_order_status",
    "parse_futures_order_type",
    "parse_futures_time_in_force",
    "parse_position_risk_entry",
    "parse_futures_account_v2",
    "parse_premium_index",
    "parse_funding_rate_history_entry",
    "parse_commission_rate",
    "order_client_id",
]


class FuturesParseError(ValueError):
    """A futures payload failed total validation."""


def parse_decimal_strict(raw: Any, field: str) -> Decimal:
    """Parse a venue numeric string into ``Decimal`` or raise; never ``float``.

    Venue payloads carry numerics as JSON strings; accepting a JSON number
    (which Python already parsed as float) would silently accept precision loss
    before we ever see it. Strings are the only honest representation.
    """
    if isinstance(raw, bool):
        raise FuturesParseError(f"{field}: boolean is not a decimal quantity")
    if isinstance(raw, Decimal):
        return raw
    if isinstance(raw, int):
        return Decimal(raw)
    if isinstance(raw, float):
        raise FuturesParseError(f"{field}: float value rejected (precision-fatal)")
    if isinstance(raw, str):
        text = raw.strip()
        if text in ("", "None"):
            raise FuturesParseError(f"{field}: empty value is not a quantity")
        try:
            return Decimal(text)
        except InvalidOperation as exc:
            raise FuturesParseError(f"{field}: {raw!r} is not a decimal") from exc
    raise FuturesParseError(f"{field}: unsupported type {type(raw).__name__}")


#: Published USD-M lifecycle strings -> platform status. An unknown value
#: raises: guessing "FILLED"-ish statuses is how reconciliation corrupts a
#: position ledger.
_FUTURES_STATUS_MAP: dict[str, OrderStatus] = {
    "NEW": OrderStatus.ACKNOWLEDGED,
    "PARTIALLY_FILLED": OrderStatus.PARTIALLY_FILLED,
    "FILLED": OrderStatus.FILLED,
    "CANCELED": OrderStatus.CANCELLED,
    "REJECTED": OrderStatus.REJECTED,
    "EXPIRED": OrderStatus.EXPIRED,
    "EXPIRED_IN_MATCH": OrderStatus.CANCELLED,
    # Insurance/ADL clawback markers: the venue rejected the order's margin.
    "NEW_INSURANCE": OrderStatus.REJECTED,
    "NEW_ADL": OrderStatus.REJECTED,
}


def parse_futures_order_status(raw: Any, *, field: str = "status") -> OrderStatus:
    if not isinstance(raw, str):
        raise FuturesParseError(f"{field}: status must be a string, got {type(raw).__name__}")
    key = raw.strip().upper()
    try:
        return _FUTURES_STATUS_MAP[key]
    except KeyError as exc:
        raise FuturesParseError(
            f"{field}: unseen futures order status {raw!r}; refusing to guess."
        ) from exc


def parse_futures_order_type(raw: Any, *, field: str = "type") -> OrderType:
    if not isinstance(raw, str):
        raise FuturesParseError(f"{field}: order type must be a string")
    key = raw.strip().upper()
    mapping = {
        "MARKET": OrderType.MARKET,
        "LIMIT": OrderType.LIMIT,
        # Binance futures trigger orders map onto the platform's stop surface:
        # STOP_MARKET carries only a stop price; STOP is the limit-protected
        # variant. Neither survives here as a native platform OrderType beyond
        # the base four, so unsupported futures-native variants refuse closed.
        "STOP_MARKET": OrderType.STOP,
        "STOP": OrderType.STOP_LIMIT,
        "TAKE_PROFIT_MARKET": OrderType.STOP,
    }
    try:
        return mapping[key]
    except KeyError as exc:
        raise FuturesParseError(
            f"{field}: unseen futures order type {raw!r}; refusing to guess."
        ) from exc


def parse_futures_time_in_force(raw: Any, *, field: str = "timeInForce") -> TimeInForce:
    if not isinstance(raw, str):
        raise FuturesParseError(f"{field}: time-in-force must be a string")
    mapping = {
        "GTC": TimeInForce.GTC,
        "IOC": TimeInForce.IOC,
        "FOK": TimeInForce.FOK,
    }
    try:
        return mapping[raw.strip().upper()]
    except KeyError as exc:
        raise FuturesParseError(
            f"{field}: unseen time-in-force {raw!r}; refusing to guess."
        ) from exc


def order_client_id(raw: Any, *, field: str = "clientOrderId") -> str:
    if not isinstance(raw, str) or raw.strip() == "":
        raise FuturesParseError(f"{field}: missing or empty client order id")
    return raw


# ---------------------------------------------------------------------------
# Error classification. USD-M fault codes are documented in the futures API
# reference; anything off the table classifies EXCHANGE_ERROR (a definite
# venue answer whose meaning we did not audit) and never as retryable-by-
# default label. Transport-level ambiguity is decided by the HTTP status.
# ---------------------------------------------------------------------------

#: Exact published USD-M fault codes -> transport taxonomy bucket.
_EXACT: dict[int, ExchangeErrorCategory] = {
    -1000: ExchangeErrorCategory.UNKNOWN_ERROR,  # UNKNOWN
    -1001: ExchangeErrorCategory.NETWORK_ERROR,  # DISCONNECTED
    -1003: ExchangeErrorCategory.RATE_LIMIT_ERROR,  # TOO_MANY_REQUESTS
    -1006: ExchangeErrorCategory.NETWORK_ERROR,  # UNEXPECTED_RESP
    -1007: ExchangeErrorCategory.TIMEOUT,  # TIMEOUT
    -1013: ExchangeErrorCategory.EXCHANGE_ERROR,  # unknown filter: venue changed contract
    -1015: ExchangeErrorCategory.RATE_LIMIT_ERROR,  # TOO_MANY_NEW_ORDERS
    -1016: ExchangeErrorCategory.TIMEOUT,  # SERVICE_SHUTTING_DOWN: venue is draining
    -1020: ExchangeErrorCategory.EXCHANGE_ERROR,  # unsupported operation for this account group
    -1021: ExchangeErrorCategory.TIMEOUT,  # INVALID_TIMESTAMP: our clock is stale
    -1022: ExchangeErrorCategory.AUTHENTICATION_ERROR,  # INVALID_SIGNATURE
    -1100: ExchangeErrorCategory.INVALID_REQUEST,  # ILLEGAL_CHARS
    -1102: ExchangeErrorCategory.INVALID_REQUEST,  # MANDATORY_PARAM_EMPTY_OR_MALFORMED
    -1103: ExchangeErrorCategory.INVALID_REQUEST,  # UNKNOWN_PARAM / param count mismatch
    -1111: ExchangeErrorCategory.INVALID_REQUEST,  # BAD_PRECISION
    -1112: ExchangeErrorCategory.INVALID_REQUEST,  # NO_DEPTH
    -1115: ExchangeErrorCategory.INVALID_REQUEST,  # INVALID_TIF
    -1116: ExchangeErrorCategory.INVALID_REQUEST,  # INVALID_ORDER_TYPE
    -1117: ExchangeErrorCategory.INVALID_REQUEST,  # INVALID_SIDE
    -1118: ExchangeErrorCategory.INVALID_REQUEST,  # EMPTY_NEW_CL_ORD_ID
    -1121: ExchangeErrorCategory.INVALID_REQUEST,  # BAD_SYMBOL
    -1125: ExchangeErrorCategory.AUTHENTICATION_ERROR,  # INVALID_API_KEY
    -1130: ExchangeErrorCategory.INVALID_REQUEST,  # invalid data sent for a parameter
    -2010: ExchangeErrorCategory.EXCHANGE_ERROR,  # NEW_ORDER_REJECTED: venue refused
    -2011: ExchangeErrorCategory.EXCHANGE_ERROR,  # CANCEL_REJECTED
    -2013: ExchangeErrorCategory.EXCHANGE_ERROR,  # NO_SUCH_ORDER
    -2019: ExchangeErrorCategory.EXCHANGE_ERROR,  # MARGIN_NOT_SUFFICIENT
    -2021: ExchangeErrorCategory.EXCHANGE_ERROR,  # ORDER_WOULD_IMMEDIATELY_TRIGGER
    -2022: ExchangeErrorCategory.INVALID_REQUEST,  # REDUCE_ONLY_REJECT (GV flags wrong)
    -2027: ExchangeErrorCategory.EXCHANGE_ERROR,  # EXCEEDED_MAX_LEVERAGE on this symbol
    -2028: ExchangeErrorCategory.EXCHANGE_ERROR,  # LEVERAGE below minimum
    -4000: ExchangeErrorCategory.EXCHANGE_ERROR,  # margin adjustment below floor
    -4059: ExchangeErrorCategory.INVALID_REQUEST,  # NO_NEED_TO_CHANGE_POSITION_SIDE
    -4061: ExchangeErrorCategory.INVALID_REQUEST,  # POSITION_SIDE_NOT_MATCH
    -4088: ExchangeErrorCategory.AUTHENTICATION_ERROR,  # PERMISSION_DENIED for futures
    -4164: ExchangeErrorCategory.INVALID_REQUEST,  # LEVERAGE switch failed
}


def classify_futures_error(code: int | None, http_status: int | None = None) -> ExchangeErrorCategory:
    """Map a USD-M fault to the nine-bucket transport taxonomy.

    A fault the platform never audited is EXCHANGE_ERROR - the caller chooses
    whether to retry; this layer never defaults to "retryable".
    """
    if code is not None:
        category = _EXACT.get(code)
        if category is not None:
            return category
        return ExchangeErrorCategory.EXCHANGE_ERROR
    if http_status is not None:
        if http_status in (418, 429):
            return ExchangeErrorCategory.RATE_LIMIT_ERROR
        if http_status == 403:
            return ExchangeErrorCategory.AUTHENTICATION_ERROR
        if http_status == 401:
            return ExchangeErrorCategory.AUTHENTICATION_ERROR
        if http_status == 400:
            return ExchangeErrorCategory.INVALID_REQUEST
        if 500 <= http_status:
            return ExchangeErrorCategory.TIMEOUT
    return ExchangeErrorCategory.UNKNOWN_ERROR


# ---------------------------------------------------------------------------
# Structured payload parsers.
# ---------------------------------------------------------------------------


def _required(payload: Mapping[str, Any], key: str) -> Any:
    if key not in payload:
        raise FuturesParseError(f"payload missing required field {key!r}")
    return payload[key]


def parse_position_risk_entry(payload: Mapping[str, Any]) -> dict[str, Any]:
    """``GET /fapi/v2/positionRisk`` entry.

    Returns a dict with Decimal fields; empty/absent positions keep full field
    presence so callers diff stable schemas instead of hunting missing keys.
    """
    symbol = _required(payload, "symbol")
    position_amt = parse_decimal_strict(_required(payload, "positionAmt"), "positionAmt")
    entry_price = parse_decimal_strict(_required(payload, "entryPrice"), "entryPrice")
    mark_price = parse_decimal_strict(
        payload.get("markPrice", payload.get("mark_price", "0")), "markPrice"
    )
    liquidation_price_raw = payload.get("liquidationPrice", "0")
    liquidation_price = parse_decimal_strict(liquidation_price_raw, "liquidationPrice")
    unrealized_pnl = parse_decimal_strict(
        payload.get("unRealizedProfit", payload.get("unrealizedPnl", "0")), "unRealizedProfit"
    )
    leverage_raw = payload.get("leverage", "0")
    leverage = parse_decimal_strict(leverage_raw, "leverage")
    margin_type = payload.get("marginType", "cross")
    position_side = payload.get("positionSide", "BOTH")
    update_time = int(payload.get("updateTime", 0))
    if not isinstance(symbol, str) or not symbol:
        raise FuturesParseError("symbol: missing in position risk entry")
    if leverage <= 0:
        raise FuturesParseError(f"leverage: non-positive value {leverage_raw!r} on position risk")
    if not isinstance(margin_type, str) or margin_type.lower() not in ("cross", "isolated"):
        raise FuturesParseError(f"marginType: unseen value {margin_type!r}")
    if str(position_side).upper() not in ("LONG", "SHORT", "BOTH"):
        raise FuturesParseError(f"positionSide: unseen value {position_side!r}")
    return {
        "symbol": symbol,
        "position_amt": position_amt,
        "entry_price": entry_price,
        "mark_price": mark_price,
        "liquidation_price": liquidation_price,
        "unrealized_pnl": unrealized_pnl,
        "leverage": leverage,
        "margin_type": margin_type.lower(),
        "position_side": str(position_side).upper(),
        "update_time_micros": update_time * 1_000,
    }


def parse_futures_account_v2(payload: Mapping[str, Any]) -> dict[str, Any]:
    """``GET /fapi/v2/account`` (V2): balances + positions with Decimal types."""
    assets_raw = payload.get("assets")
    positions_raw = payload.get("positions")
    if not isinstance(assets_raw, list):
        raise FuturesParseError("account v2 payload missing 'assets' array")
    if not isinstance(positions_raw, list):
        raise FuturesParseError("account v2 payload missing 'positions' array")

    balances = []
    for entry in assets_raw:
        if not isinstance(entry, Mapping):
            raise FuturesParseError("asset entry is not an object")
        balances.append(
            {
                "asset": _required(entry, "asset"),
                "wallet_balance": parse_decimal_strict(_required(entry, "walletBalance"), "walletBalance"),
                "unrealized_profit": parse_decimal_strict(
                    _required(entry, "unrealizedProfit"), "unrealizedProfit"
                ),
                "available_balance": parse_decimal_strict(
                    _required(entry, "availableBalance"), "availableBalance"
                ),
                "margin_balance": parse_decimal_strict(
                    _required(entry, "marginBalance"), "marginBalance"
                ),
                "maint_margin": parse_decimal_strict(
                    _required(entry, "maintMargin"), "maintMargin"
                ),
            }
        )
    can_withdraw = parse_decimal_strict(
        payload.get("canWithdraw", "0"), "canWithdraw"
    )
    total_margin_balance = parse_decimal_strict(
        payload.get("totalMarginBalance", "0"), "totalMarginBalance"
    )
    total_maint_margin = parse_decimal_strict(
        payload.get("totalMaintMargin", "0"), "totalMaintMargin"
    )

    positions = [parse_position_risk_entry(p) for p in positions_raw if isinstance(p, Mapping)]
    return {
        "balances": balances,
        "positions": positions,
        "can_withdraw": can_withdraw,
        "total_margin_balance": total_margin_balance,
        "total_maint_margin": total_maint_margin,
        "fee_tier": int(payload.get("feeTier", 0)),
        "can_trade": bool(payload.get("canTrade", False)),
    }


def parse_premium_index(payload: Mapping[str, Any]) -> dict[str, Any]:
    """``GET /fapi/v1/premiumIndex``: current mark/spot/funding snapshot."""
    symbol = _required(payload, "symbol")
    return {
        "symbol": symbol,
        "mark_price": parse_decimal_strict(_required(payload, "markPrice"), "markPrice"),
        "index_price": parse_decimal_strict(_required(payload, "indexPrice"), "indexPrice"),
        "last_funding_rate": parse_decimal_strict(
            _required(payload, "lastFundingRate"), "lastFundingRate"
        ),
        "interest_rate": parse_decimal_strict(
            payload.get("interestRate", "0"), "interestRate"
        ),
        "estimated_settle_price": parse_decimal_strict(
            payload.get("estimatedSettlePrice", "0"), "estimatedSettlePrice"
        ),
        "next_funding_time_micros": int(payload.get("nextFundingTime", 0)) * 1_000,
    }


def parse_funding_rate_history_entry(payload: Mapping[str, Any]) -> dict[str, Any]:
    """``GET /fapi/v1/fundingRate`` history entry."""
    return {
        "symbol": _required(payload, "symbol"),
        "funding_rate": parse_decimal_strict(_required(payload, "fundingRate"), "fundingRate"),
        "funding_time_micros": int(_required(payload, "fundingTime")) * 1_000,
    }


def parse_commission_rate(payload: Mapping[str, Any]) -> dict[str, Any]:
    """``GET /fapi/v1/commissionRate``."""
    return {
        "symbol": _required(payload, "symbol"),
        "maker_commission_rate": parse_decimal_strict(
            _required(payload, "makerCommissionRate"), "makerCommissionRate"
        ),
        "taker_commission_rate": parse_decimal_strict(
            _required(payload, "takerCommissionRate"), "takerCommissionRate"
        ),
    }


__all_T = (parse_decimal_strict,)
