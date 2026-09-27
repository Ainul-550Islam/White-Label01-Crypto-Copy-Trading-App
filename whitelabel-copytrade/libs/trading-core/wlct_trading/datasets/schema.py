"""The canonical on-disk event format for persisted historical datasets.

One dataset partition is one line-oriented file: one JSON object per line,
each line exactly one canonical :class:`~wlct_trading.backtest.dataset.Market
Event`. The line is *not* the venue's payload - strategies and the replay
engine must never parse exchange JSON, so exchange-specific shapes end at the
ingestion adapter. The line is also not a free-form dump: the schema below is
versioned, and a future field addition must bump ``CANONICAL_SCHEMA_VERSION``
rather than silently reinterpret files that old readers already hold.

Why JSON Lines rather than Parquet
---------------------------------
This library carries no runtime dependencies and must keep it that way (see
``pyproject.toml``). Parquet would need pyarrow - a heavyweight columnar stack
whose decimals are float64 by default unless every column type is pinned, and
whose value-add (random column projection) buys nothing for a sequential
replay that reads every field anyway. JSON Lines round-trips ``Decimal``
exactly as strings, compresses ~10x with gzip, and is diffable with tools
every operator already has. If a future deployment needs columnar scans, the
reader boundary here is where a second format would attach - the manifest,
not the strategy layer, is what would change.

Determinism rules, enforced in :func:`canonical_json`
-----------------------------------------------------
* keys sorted, separators ``(",", ":")``, ``ensure_ascii=True``;
* every price and quantity is a ``str`` holding an exact ``Decimal`` - a float
  in this format is an error, not a lossy convenience;
* timestamps are integer microseconds;
* nothing is written that the reader could not reconstruct byte-for-byte.

The receive timestamp (``rts``) is preserved when present - it describes the
capture, and quality analysis wants it - but the replay ordering and the
content checksum ignore it, exactly as
:meth:`~wlct_trading.backtest.dataset.MarketEvent.checksum_source` does. Two
identical market captures taken on different days therefore carry the same
content checksum while still recording when each byte arrived.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any, Mapping

from wlct_trading.backtest.dataset import DatasetError, MarketEvent
from wlct_trading.enums import ExchangeId, MarketEventKind, OrderSide
from wlct_trading.market_data import (
    Candle,
    OrderBookDelta,
    OrderBookSnapshot,
    PriceLevel,
    PublicTrade,
    Ticker,
)

__all__ = [
    "CANONICAL_SCHEMA_VERSION",
    "MANIFEST_SCHEMA_VERSION",
    "DATASET_KEY_PATTERN",
    "DatasetFormatError",
    "canonical_json",
    "decimal_to_wire",
    "decimal_from_wire",
    "payload_to_wire",
    "payload_from_wire",
    "event_to_line",
    "line_to_event",
    "ParsedLine",
]

#: Schema version of one canonical event line. Bump only on a change that
#: alters the meaning of existing keys; additive optional keys are allowed
#: with reader tolerance documented here, because a reader that refuses a
#: future-but-compatible line turns a version bump into a data migration.
CANONICAL_SCHEMA_VERSION = 1

#: Schema version of ``manifest.json`` itself.
MANIFEST_SCHEMA_VERSION = 1

#: Dataset keys are derived, never typed: the pattern is what lets storage
#: treat the key as a safe directory name instead of untrusted input.
DATASET_KEY_PATTERN = r"^hst-[0-9a-f]{32}$"


class DatasetFormatError(DatasetError):
    """A dataset file violates the canonical schema.

    Subclasses the backtest package's ``DatasetError`` on purpose: to the
    replay engine it makes no difference whether malformed data arrived from a
    caller or from a disk read, and one exception family means one catch
    boundary in :meth:`~wlct_trading.backtest.engine.BacktestEngine.run`.
    """


def canonical_json(obj: object) -> str:
    """The one serialisation this package writes and parses with."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def decimal_to_wire(value: Decimal | None) -> str | None:
    """``Decimal`` to its exact string. Never ``float``.

    ``str(Decimal)`` is already round-trip exact for finite values; this
    function exists so the rule lives in one place and so non-finite Decimals
    are refused at the writer rather than producing ``NaN`` tokens that JSON
    parsers everywhere disagree about.
    """
    if value is None:
        return None
    if not value.is_finite():
        raise DatasetFormatError(f"Non-finite decimal cannot be stored: {value!s}")
    return str(value)


def decimal_from_wire(value: object, *, field: str) -> Decimal | None:
    """Parse the exact string form back, refusing floats loudly.

    A float here means something upstream serialised money wrong. Silently
    ``Decimal(str(0.1))`` would launder that mistake into data that *looks*
    canonical, so it is a format error instead.
    """
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, str):
        raise DatasetFormatError(
            f"{field} must be a decimal string; got {type(value).__name__}."
        )
    try:
        parsed = Decimal(value)
    except InvalidOperation as exc:
        raise DatasetFormatError(f"{field} is not a valid decimal: {value!r}") from exc
    if not parsed.is_finite():
        raise DatasetFormatError(f"{field} must be finite: {value!r}")
    return parsed


def _int_from_wire(value: object, *, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise DatasetFormatError(f"{field} must be an integer; got {type(value).__name__}.")
    return value


def _str_from_wire(value: object, *, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise DatasetFormatError(f"{field} must be a non-empty string.")
    return value


def _levels_to_wire(levels: tuple[PriceLevel, ...]) -> list[list[str]]:
    level: list[list[str]] = [[str(item.price), str(item.quantity)] for item in levels]
    return level


def _levels_from_wire(value: object, *, field: str) -> tuple[PriceLevel, ...]:
    if not isinstance(value, list):
        raise DatasetFormatError(f"{field} must be a list of [price, quantity].")
    levels: list[PriceLevel] = []
    for item in value:
        if not isinstance(item, list) or len(item) != 2:
            raise DatasetFormatError(f"{field} entries must be [price, quantity] pairs.")
        price = decimal_from_wire(item[0], field=f"{field} price")
        quantity = decimal_from_wire(item[1], field=f"{field} quantity")
        if price is None or quantity is None:
            raise DatasetFormatError(f"{field} entries must carry price and quantity.")
        levels.append(PriceLevel(price=price, quantity=quantity))
    return tuple(levels)


def payload_to_wire(payload: Ticker | PublicTrade | OrderBookSnapshot | OrderBookDelta | Candle) -> dict[str, Any]:
    """Canonical event payload to its JSON-ready dict.

    Key names are short on purpose - they repeat millions of times per dataset
    and every byte matters once before the compression does - and each is
    documented at its :func:`payload_from_wire` counterpart, where the format
    is defined by the reader rather than by hopeful prose.
    """
    # ``ets`` is written per kind below: a Candle has no exchange timestamp of
    # its own (its open time IS the timestamp), and reaching for a missing
    # attribute on the union just to delete it later is how the two would
    # eventually disagree.
    wire: dict[str, Any] = {"ex": payload.exchange.value, "sym": payload.symbol}
    if isinstance(payload, Ticker):
        wire["ets"] = payload.exchange_timestamp
        wire["bid"] = decimal_to_wire(payload.bid_price)
        wire["ask"] = decimal_to_wire(payload.ask_price)
        wire["last"] = decimal_to_wire(payload.last_price)
    elif isinstance(payload, PublicTrade):
        wire["ets"] = payload.exchange_timestamp
        wire["tid"] = payload.trade_id
        wire["p"] = decimal_to_wire(payload.price)
        wire["q"] = decimal_to_wire(payload.quantity)
        wire["side"] = payload.aggressor_side.value
    elif isinstance(payload, OrderBookSnapshot):
        wire["ets"] = payload.exchange_timestamp
        wire["bids"] = _levels_to_wire(payload.bids)
        wire["asks"] = _levels_to_wire(payload.asks)
        wire["lui"] = payload.last_update_id
    elif isinstance(payload, OrderBookDelta):
        wire["ets"] = payload.exchange_timestamp
        wire["bids"] = _levels_to_wire(payload.bids)
        wire["asks"] = _levels_to_wire(payload.asks)
        wire["fui"] = payload.first_update_id
        wire["lui"] = payload.final_update_id
        if payload.previous_final_update_id is not None:
            wire["pfui"] = payload.previous_final_update_id
    else:  # Candle
        # ``ets`` is kept uniform across kinds and carries the candle's open
        # time - the parser reads ``ot`` as the authoritative pair, and a
        # divergent ``ets`` is exactly the two-truths bug to avoid.
        wire["iv"] = payload.interval
        wire["ot"] = payload.open_time
        wire["ct"] = payload.close_time
        wire["o"] = decimal_to_wire(payload.open)
        wire["h"] = decimal_to_wire(payload.high)
        wire["l"] = decimal_to_wire(payload.low)
        wire["c"] = decimal_to_wire(payload.close)
        wire["v"] = decimal_to_wire(payload.volume)
        wire["tc"] = payload.trade_count
        wire["closed"] = payload.is_closed
    # The capture timestamp is metadata, preserved when it differs from the
    # exchange timestamp; readers must not order by it (see module docstring).
    exchange_ts = (
        payload.exchange_timestamp if not isinstance(payload, Candle) else payload.open_time
    )
    received = payload.received_timestamp
    if received != exchange_ts:
        wire["rts"] = received
    return wire


def payload_from_wire(
    kind: MarketEventKind,
    wire: Mapping[str, object],
) -> Ticker | PublicTrade | OrderBookSnapshot | OrderBookDelta | Candle:
    """Parse one canonical payload, rejecting anything ambiguous.

    Every rejection here is a corruption the validator would otherwise have to
    infer after the fact. Malformed data fails at the boundary that received
    it, which is also the only moment its filename and line number are known.
    """
    exchange = ExchangeId(_str_from_wire(wire.get("ex"), field="ex"))
    symbol = _str_from_wire(wire.get("sym"), field="sym")
    raw_received = wire.get("rts")
    received = (
        raw_received if isinstance(raw_received, int) and not isinstance(raw_received, bool) else 0
    )

    if kind is MarketEventKind.TICKER:
        exchange_timestamp = _int_from_wire(wire.get("ets"), field="ets")
        return Ticker(
            exchange=exchange,
            symbol=symbol,
            bid_price=decimal_from_wire(wire.get("bid"), field="bid"),
            ask_price=decimal_from_wire(wire.get("ask"), field="ask"),
            last_price=decimal_from_wire(wire.get("last"), field="last"),
            exchange_timestamp=exchange_timestamp,
            received_timestamp=received or exchange_timestamp,
        )
    if kind is MarketEventKind.TRADE:
        exchange_timestamp = _int_from_wire(wire.get("ets"), field="ets")
        return PublicTrade(
            exchange=exchange,
            symbol=symbol,
            trade_id=_str_from_wire(wire.get("tid"), field="tid"),
            price=decimal_from_wire(wire.get("p"), field="p") or Decimal(0),
            quantity=decimal_from_wire(wire.get("q"), field="q") or Decimal(0),
            aggressor_side=OrderSide(_str_from_wire(wire.get("side"), field="side")),
            exchange_timestamp=exchange_timestamp,
            received_timestamp=received or exchange_timestamp,
        )
    if kind is MarketEventKind.BOOK_SNAPSHOT:
        exchange_timestamp = _int_from_wire(wire.get("ets"), field="ets")
        return OrderBookSnapshot(
            exchange=exchange,
            symbol=symbol,
            bids=_levels_from_wire(wire.get("bids"), field="bids"),
            asks=_levels_from_wire(wire.get("asks"), field="asks"),
            last_update_id=_int_from_wire(wire.get("lui"), field="lui"),
            exchange_timestamp=exchange_timestamp,
            received_timestamp=received or exchange_timestamp,
        )
    if kind is MarketEventKind.BOOK_DELTA:
        exchange_timestamp = _int_from_wire(wire.get("ets"), field="ets")
        previous = wire.get("pfui")
        return OrderBookDelta(
            exchange=exchange,
            symbol=symbol,
            bids=_levels_from_wire(wire.get("bids"), field="bids"),
            asks=_levels_from_wire(wire.get("asks"), field="asks"),
            first_update_id=_int_from_wire(wire.get("fui"), field="fui"),
            final_update_id=_int_from_wire(wire.get("lui"), field="lui"),
            exchange_timestamp=exchange_timestamp,
            received_timestamp=received or exchange_timestamp,
            previous_final_update_id=(
                None if previous is None else _int_from_wire(previous, field="pfui")
            ),
        )
    if kind is MarketEventKind.CANDLE:
        # A candle's open_time *is* its exchange timestamp; no separate field
        # is stored, and requiring one would invite the two to disagree.
        open_time = _int_from_wire(wire.get("ot"), field="ot")
        return Candle(
            exchange=exchange,
            symbol=symbol,
            interval=_str_from_wire(wire.get("iv"), field="iv"),
            open_time=open_time,
            close_time=_int_from_wire(wire.get("ct"), field="ct"),
            open=decimal_from_wire(wire.get("o"), field="o") or Decimal(0),
            high=decimal_from_wire(wire.get("h"), field="h") or Decimal(0),
            low=decimal_from_wire(wire.get("l"), field="l") or Decimal(0),
            close=decimal_from_wire(wire.get("c"), field="c") or Decimal(0),
            volume=decimal_from_wire(wire.get("v"), field="v") or Decimal(0),
            trade_count=_int_from_wire(wire.get("tc"), field="tc"),
            is_closed=bool(wire.get("closed", True)),
            received_timestamp=received or open_time,
        )
    raise DatasetFormatError(f"Event kind {kind.value} cannot appear in a persisted dataset.")


@dataclass(slots=True, frozen=True)
class ParsedLine:
    """One parsed line plus the position it was parsed from.

    ``line_number`` is 1-based within the partition. Findings that reference a
    corruption the reader can quote must say where it is; a number computed
    later from a filtered stream could never point back at the file.
    """

    event: MarketEvent
    line_number: int
    partition_path: str


_LINE_KEYS = frozenset({"schema", "kind", "ts", "seq", "payload"})


def event_to_line(event: MarketEvent) -> str:
    """Serialise one canonical event to its stored line (no newline)."""
    wire = payload_to_wire(event.payload)
    line: dict[str, Any] = {
        "schema": CANONICAL_SCHEMA_VERSION,
        "kind": event.kind.value,
        "ts": event.timestamp_micros,
        "seq": event.sequence,
        "payload": wire,
    }
    return canonical_json(line)


def line_to_event(
    line: str,
    *,
    line_number: int = 0,
    partition_path: str = "",
) -> ParsedLine:
    """Parse one stored line back into a :class:`MarketEvent`.

    Unknown keys are refused, not ignored: a line carrying a key today's
    reader does not know is a line from a newer schema, and quietly dropping
    the unknown field would present *less data* as if it were the same event.
    """
    try:
        raw = json.loads(line)
    except json.JSONDecodeError as exc:
        raise DatasetFormatError(f"Partition line {line_number} is not valid JSON.") from exc
    if not isinstance(raw, dict):
        raise DatasetFormatError(f"Partition line {line_number} is not a JSON object.")
    keys = frozenset(raw.keys())
    if keys != _LINE_KEYS:
        raise _unknown_keys_error(keys, line_number)
    schema_version = _int_from_wire(raw["schema"], field="schema")
    if schema_version != CANONICAL_SCHEMA_VERSION:
        raise DatasetFormatError(
            f"Partition line {line_number} carries canonical schema v{schema_version}; "
            f"this reader understands exactly v{CANONICAL_SCHEMA_VERSION}."
        )
    kind = MarketEventKind(_str_from_wire(raw["kind"], field="kind"))
    timestamp_micros = _int_from_wire(raw["ts"], field="ts")
    sequence = _int_from_wire(raw["seq"], field="seq")
    payload_wire = raw["payload"]
    if not isinstance(payload_wire, dict):
        raise DatasetFormatError(f"Partition line {line_number} payload is not an object.")
    payload = payload_from_wire(kind, payload_wire)
    event = MarketEvent(
        kind=kind,
        timestamp_micros=timestamp_micros,
        payload=payload,
        sequence=sequence,
    )
    return ParsedLine(event=event, line_number=line_number, partition_path=partition_path)


def _unknown_keys_error(keys: frozenset[str], line_number: int) -> DatasetFormatError:
    """The unknown/missing-keys message lives with the single place that
    knows the line schema, so the text and the schema cannot drift apart."""
    missing = sorted(_LINE_KEYS - keys)
    extra = sorted(keys - _LINE_KEYS)
    parts: list[str] = []
    if missing:
        parts.append(f"missing keys {missing}")
    if extra:
        parts.append(f"unknown keys {extra}")
    return DatasetFormatError(
        f"Partition line {line_number} has {' and '.join(parts)}; expected exactly "
        f"{sorted(_LINE_KEYS)}."
    )
