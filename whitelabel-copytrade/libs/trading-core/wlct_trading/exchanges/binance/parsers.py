"""Binance wire format to canonical domain objects.

Every function here is pure: JSON in, immutable domain object out. No I/O, no
sockets, no clock beyond the receipt stamp. That is what allows the whole
normalisation layer to be tested against captured payloads with no network.

Three rules the parsers hold to:

* **Decimal, never float.** Binance sends prices as strings precisely so they
  survive the trip intact. ``float("0.1")`` is not ``0.1``, and a rounding error
  in a price is a real loss. Strings are fed straight to :class:`Decimal`.
* **Timestamps in microseconds.** Binance publishes milliseconds; the platform
  standardised on microseconds in Part 2. Conversion happens once, here.
* **Reject rather than guess.** A malformed or partial message raises
  :class:`BinanceParseError`. Substituting a default would inject a fabricated
  price into the book, which is the worst possible failure mode.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any, Mapping, Sequence

from wlct_trading.adapters.base import SymbolSpecification
from wlct_trading.clock import epoch_micros
from wlct_trading.enums import ExchangeId, MarketType, OrderSide
from wlct_trading.market_data import (
    Candle,
    OrderBookDelta,
    OrderBookSnapshot,
    PriceLevel,
    PublicTrade,
    Ticker,
)

__all__ = [
    "BinanceParseError",
    "MILLIS_TO_MICROS",
    "parse_decimal",
    "parse_levels",
    "parse_depth_snapshot",
    "parse_depth_delta",
    "parse_trade",
    "parse_book_ticker",
    "parse_ticker",
    "parse_kline",
    "parse_rest_kline",
    "parse_exchange_info",
    "unwrap_combined_stream",
    "stream_name",
]

MILLIS_TO_MICROS = 1_000
_EXCHANGE = ExchangeId.BINANCE


class BinanceParseError(ValueError):
    """A Binance payload could not be normalised.

    Carries no credential material — these messages reach the logs.
    """


def parse_decimal(value: Any, field: str) -> Decimal:
    """Convert a venue-supplied numeric string to :class:`Decimal`."""
    if value is None:
        raise BinanceParseError(f"Field {field!r} is missing.")
    if isinstance(value, Decimal):
        return value
    if isinstance(value, float):
        # Binance does not send floats; if one appears the payload has already
        # been through a lossy JSON parser and the precision is gone.
        raise BinanceParseError(
            f"Field {field!r} arrived as a float, which has already lost "
            f"precision. Parse Binance JSON with strings preserved."
        )
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise BinanceParseError(f"Field {field!r} is not numeric: {value!r}") from exc


def _require(payload: Mapping[str, Any], key: str, context: str) -> Any:
    if key not in payload:
        raise BinanceParseError(f"{context} is missing required field {key!r}.")
    return payload[key]


def _millis_to_micros(value: Any, field: str) -> int:
    try:
        return int(value) * MILLIS_TO_MICROS
    except (TypeError, ValueError) as exc:
        raise BinanceParseError(
            f"Field {field!r} is not a millisecond timestamp: {value!r}"
        ) from exc


def parse_levels(raw: Sequence[Any], side: str) -> tuple[PriceLevel, ...]:
    """Parse ``[["price", "qty"], ...]`` into price levels.

    Zero-quantity levels are preserved: on a diff stream they are deletions and
    dropping them here would leave stale levels resting in the book forever.
    """
    levels: list[PriceLevel] = []
    for index, entry in enumerate(raw):
        if not isinstance(entry, (list, tuple)) or len(entry) < 2:
            raise BinanceParseError(
                f"{side} level {index} is malformed: expected [price, quantity], "
                f"got {entry!r}"
            )
        levels.append(
            PriceLevel(
                price=parse_decimal(entry[0], f"{side}[{index}].price"),
                quantity=parse_decimal(entry[1], f"{side}[{index}].quantity"),
            )
        )
    return tuple(levels)


def parse_depth_snapshot(
    payload: Mapping[str, Any],
    symbol: str,
    *,
    received_timestamp: int | None = None,
) -> OrderBookSnapshot:
    """Parse ``GET /api/v3/depth``.

    The REST snapshot carries no timestamp of its own, so the receipt time is
    used for both. Inventing an exchange timestamp would make the staleness
    monitor lie.
    """
    received = received_timestamp if received_timestamp is not None else epoch_micros()
    # As in parse_depth_delta, _require runs outside the try so a missing
    # field is reported as missing rather than as a type error.
    last_update_id = _require(payload, "lastUpdateId", "Depth snapshot")
    try:
        sequence = int(last_update_id)
    except (TypeError, ValueError) as exc:
        raise BinanceParseError(
            f"Depth snapshot lastUpdateId is not an integer: {last_update_id!r}"
        ) from exc

    return OrderBookSnapshot(
        exchange=_EXCHANGE,
        symbol=symbol,
        bids=parse_levels(_require(payload, "bids", "Depth snapshot"), "bids"),
        asks=parse_levels(_require(payload, "asks", "Depth snapshot"), "asks"),
        last_update_id=sequence,
        exchange_timestamp=received,
        received_timestamp=received,
    )


def parse_depth_delta(
    payload: Mapping[str, Any],
    symbol: str,
    *,
    received_timestamp: int | None = None,
) -> OrderBookDelta:
    """Parse a ``<symbol>@depth`` diff event.

    Binance spot sends ``U`` (first update id) and ``u`` (final update id) and
    guarantees each event's ``U`` equals the previous event's ``u + 1``. It does
    *not* send an explicit predecessor id, so ``previous_final_update_id`` is
    left unset and the book validates using the range form — exactly the shape
    :meth:`OrderBook._validate_sequence` handles.
    """
    received = received_timestamp if received_timestamp is not None else epoch_micros()
    # _require is called outside the try: BinanceParseError subclasses
    # ValueError, so a missing field would otherwise be caught below and
    # reported as a type problem, losing the far more useful "which field is
    # absent" diagnostic.
    raw_first = _require(payload, "U", "Depth delta")
    raw_final = _require(payload, "u", "Depth delta")
    try:
        first_update_id = int(raw_first)
        final_update_id = int(raw_final)
    except (TypeError, ValueError) as exc:
        raise BinanceParseError(
            f"Depth delta update ids are not integers: "
            f"U={raw_first!r} u={raw_final!r}"
        ) from exc

    if final_update_id < first_update_id:
        raise BinanceParseError(
            f"Depth delta has an inverted range: U={first_update_id} > "
            f"u={final_update_id}."
        )

    return OrderBookDelta(
        exchange=_EXCHANGE,
        symbol=symbol,
        bids=parse_levels(payload.get("b", ()), "b"),
        asks=parse_levels(payload.get("a", ()), "a"),
        first_update_id=first_update_id,
        final_update_id=final_update_id,
        exchange_timestamp=_millis_to_micros(_require(payload, "E", "Depth delta"), "E"),
        received_timestamp=received,
    )


def parse_trade(
    payload: Mapping[str, Any],
    symbol: str,
    *,
    received_timestamp: int | None = None,
) -> PublicTrade:
    """Parse a ``<symbol>@trade`` or ``<symbol>@aggTrade`` event.

    ``m`` is ``isBuyerMaker``. When the buyer was the maker, the *seller* lifted
    the book, so the aggressor is a SELL. Getting this backwards inverts every
    order-flow signal built on the tape, so it is asserted in the tests.
    """
    received = received_timestamp if received_timestamp is not None else epoch_micros()
    is_buyer_maker = payload.get("m")
    if not isinstance(is_buyer_maker, bool):
        raise BinanceParseError(
            f"Trade event field 'm' (isBuyerMaker) must be a boolean, got "
            f"{is_buyer_maker!r}."
        )

    trade_id = payload.get("t", payload.get("a"))
    if trade_id is None:
        raise BinanceParseError("Trade event has neither 't' nor 'a' trade id.")

    return PublicTrade(
        exchange=_EXCHANGE,
        symbol=symbol,
        trade_id=str(trade_id),
        price=parse_decimal(_require(payload, "p", "Trade event"), "p"),
        quantity=parse_decimal(_require(payload, "q", "Trade event"), "q"),
        aggressor_side=OrderSide.SELL if is_buyer_maker else OrderSide.BUY,
        exchange_timestamp=_millis_to_micros(
            payload.get("T", _require(payload, "E", "Trade event")), "T"
        ),
        received_timestamp=received,
    )


def parse_book_ticker(
    payload: Mapping[str, Any],
    symbol: str,
    *,
    received_timestamp: int | None = None,
) -> Ticker:
    """Parse a ``<symbol>@bookTicker`` event.

    Best bid/ask only — there is no last price on this stream, so ``last_price``
    is ``None`` rather than a mid-price standing in for one.
    """
    received = received_timestamp if received_timestamp is not None else epoch_micros()
    event_time = payload.get("E")
    return Ticker(
        exchange=_EXCHANGE,
        symbol=symbol,
        bid_price=parse_decimal(_require(payload, "b", "Book ticker"), "b"),
        ask_price=parse_decimal(_require(payload, "a", "Book ticker"), "a"),
        last_price=None,
        exchange_timestamp=(
            _millis_to_micros(event_time, "E") if event_time is not None else received
        ),
        received_timestamp=received,
    )


def parse_ticker(
    payload: Mapping[str, Any],
    symbol: str,
    *,
    received_timestamp: int | None = None,
) -> Ticker:
    """Parse a ``<symbol>@ticker`` 24-hour rolling statistics event."""
    received = received_timestamp if received_timestamp is not None else epoch_micros()
    return Ticker(
        exchange=_EXCHANGE,
        symbol=symbol,
        bid_price=parse_decimal(_require(payload, "b", "Ticker"), "b"),
        ask_price=parse_decimal(_require(payload, "a", "Ticker"), "a"),
        last_price=parse_decimal(_require(payload, "c", "Ticker"), "c"),
        exchange_timestamp=_millis_to_micros(_require(payload, "E", "Ticker"), "E"),
        received_timestamp=received,
    )


def parse_kline(
    payload: Mapping[str, Any],
    symbol: str,
    *,
    received_timestamp: int | None = None,
) -> Candle:
    """Parse a ``<symbol>@kline_<interval>`` event.

    ``k.x`` marks the bar closed. Only closed bars should be persisted; an open
    bar is repeatedly revised and storing it produces a table of contradictory
    rows for the same interval.
    """
    received = received_timestamp if received_timestamp is not None else epoch_micros()
    kline = _require(payload, "k", "Kline event")
    if not isinstance(kline, Mapping):
        raise BinanceParseError("Kline event field 'k' is not an object.")

    return Candle(
        exchange=_EXCHANGE,
        symbol=symbol,
        interval=str(_require(kline, "i", "Kline")),
        open_time=_millis_to_micros(_require(kline, "t", "Kline"), "k.t"),
        close_time=_millis_to_micros(_require(kline, "T", "Kline"), "k.T"),
        open=parse_decimal(_require(kline, "o", "Kline"), "k.o"),
        high=parse_decimal(_require(kline, "h", "Kline"), "k.h"),
        low=parse_decimal(_require(kline, "l", "Kline"), "k.l"),
        close=parse_decimal(_require(kline, "c", "Kline"), "k.c"),
        volume=parse_decimal(_require(kline, "v", "Kline"), "k.v"),
        trade_count=int(kline.get("n", 0)),
        is_closed=bool(kline.get("x", False)),
        received_timestamp=received,
    )


def parse_rest_kline(
    row: Sequence[Any],
    symbol: str,
    interval: str,
    *,
    received_timestamp: int | None = None,
) -> Candle:
    """Parse one row of ``GET /api/v3/klines``.

    REST returns positional arrays rather than objects. Only bars whose close
    time has passed are marked closed; the final row of a live query is still
    forming.
    """
    received = received_timestamp if received_timestamp is not None else epoch_micros()
    if len(row) < 9:
        raise BinanceParseError(
            f"Kline row has {len(row)} fields; at least 9 are required."
        )

    close_time = _millis_to_micros(row[6], "closeTime")
    return Candle(
        exchange=_EXCHANGE,
        symbol=symbol,
        interval=interval,
        open_time=_millis_to_micros(row[0], "openTime"),
        close_time=close_time,
        open=parse_decimal(row[1], "open"),
        high=parse_decimal(row[2], "high"),
        low=parse_decimal(row[3], "low"),
        close=parse_decimal(row[4], "close"),
        volume=parse_decimal(row[5], "volume"),
        trade_count=int(row[8]),
        is_closed=close_time < received,
        received_timestamp=received,
    )


def _filter_value(
    filters: Sequence[Any], filter_type: str, key: str
) -> Decimal | None:
    for entry in filters:
        if isinstance(entry, Mapping) and entry.get("filterType") == filter_type:
            raw = entry.get(key)
            if raw is None:
                return None
            return parse_decimal(raw, f"{filter_type}.{key}")
    return None


def _precision_from_step(step: Decimal) -> int:
    """Decimal places implied by a tick or step size.

    Binance publishes ``tickSize: "0.01000000"``; the meaningful precision is 2,
    not 8. The exponent of the normalised value gives it directly.
    """
    if step <= 0:
        return 0
    exponent = step.normalize().as_tuple().exponent
    if not isinstance(exponent, int):
        return 0
    return max(0, -exponent)


def parse_exchange_info(payload: Mapping[str, Any]) -> tuple[SymbolSpecification, ...]:
    """Parse ``GET /api/v3/exchangeInfo`` into instrument specifications.

    This is the authoritative source for base/quote splitting and for the
    tick/step/min-notional rules the OMS validates against locally. Symbols
    whose filters cannot be read are skipped rather than defaulted: a fabricated
    tick size produces orders the venue rejects.
    """
    symbols_raw = payload.get("symbols")
    if not isinstance(symbols_raw, Sequence):
        raise BinanceParseError("exchangeInfo payload has no 'symbols' array.")

    specifications: list[SymbolSpecification] = []
    for entry in symbols_raw:
        if not isinstance(entry, Mapping):
            continue

        venue_symbol = entry.get("symbol")
        base_asset = entry.get("baseAsset")
        quote_asset = entry.get("quoteAsset")
        if not venue_symbol or not base_asset or not quote_asset:
            continue

        filters = entry.get("filters", ())
        if not isinstance(filters, Sequence):
            continue

        price_tick = _filter_value(filters, "PRICE_FILTER", "tickSize")
        quantity_step = _filter_value(filters, "LOT_SIZE", "stepSize")
        min_quantity = _filter_value(filters, "LOT_SIZE", "minQty")
        max_quantity = _filter_value(filters, "LOT_SIZE", "maxQty")
        min_notional = _filter_value(filters, "NOTIONAL", "minNotional")
        if min_notional is None:
            # Older listings still carry the superseded MIN_NOTIONAL filter.
            min_notional = _filter_value(filters, "MIN_NOTIONAL", "minNotional")

        if price_tick is None or quantity_step is None or min_quantity is None:
            continue

        specifications.append(
            SymbolSpecification(
                symbol=f"{str(base_asset).upper()}-{str(quote_asset).upper()}",
                venue_symbol=str(venue_symbol).upper(),
                exchange=_EXCHANGE,
                market_type=MarketType.SPOT,
                base_asset=str(base_asset).upper(),
                quote_asset=str(quote_asset).upper(),
                price_tick=price_tick,
                quantity_step=quantity_step,
                min_quantity=min_quantity,
                max_quantity=max_quantity,
                min_notional=min_notional if min_notional is not None else Decimal(0),
                is_tradeable=entry.get("status") == "TRADING",
                price_precision=_precision_from_step(price_tick),
                quantity_precision=_precision_from_step(quantity_step),
            )
        )

    return tuple(specifications)


def unwrap_combined_stream(
    payload: Mapping[str, Any],
) -> tuple[str | None, Mapping[str, Any]]:
    """Unwrap ``{"stream": ..., "data": ...}`` from the combined endpoint.

    Returns ``(stream_name, inner_payload)``. A raw single-stream message is
    returned unchanged with a ``None`` stream name, so both endpoint shapes flow
    through the same dispatch path.
    """
    stream = payload.get("stream")
    data = payload.get("data")
    if isinstance(stream, str) and isinstance(data, Mapping):
        return stream, data
    return None, payload


def stream_name(venue_symbol: str, channel_suffix: str) -> str:
    """Build a Binance stream name. Binance requires lower-case symbols here.

    An upper-case symbol is silently accepted by the endpoint and then never
    delivers data, which is a genuinely hard bug to spot from the outside.
    """
    return f"{venue_symbol.lower()}@{channel_suffix}"
