"""Historical datasets and their identification.

A backtest whose input cannot be identified is not reproducible, and a
non-reproducible backtest is an anecdote. Every run therefore records a
:class:`DatasetDescriptor`: what the data is, where it came from, the window it
covers, how many events it contains and a checksum over the events themselves.

The checksum is computed from the normalised events, not from a file on disk,
so it is stable across storage formats and catches the case that matters most -
somebody re-ran "the same backtest" against silently different data.

The events are the *same normalised types* the live feed produces
(:class:`~wlct_trading.market_data.Ticker`,
:class:`~wlct_trading.market_data.PublicTrade`,
:class:`~wlct_trading.market_data.OrderBookSnapshot`,
:class:`~wlct_trading.market_data.OrderBookDelta`,
:class:`~wlct_trading.market_data.Candle`). There is no parallel "backtest
event" hierarchy, which is what allows one strategy implementation to run
unchanged live, on paper and in replay.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Iterable, Iterator, Sequence

from wlct_trading.enums import ExchangeId, MarketEventKind, MarketType
from wlct_trading.market_data import (
    Candle,
    OrderBookDelta,
    OrderBookSnapshot,
    PublicTrade,
    Ticker,
)

__all__ = [
    "MarketEvent",
    "DatasetDescriptor",
    "HistoricalDataset",
    "DatasetError",
    "compute_dataset_checksum",
    "EVENT_KIND_ORDER",
]

#: Deterministic ordering for events sharing a timestamp.
#:
#: Book state must be applied before anything that reads it, and a snapshot
#: must precede the deltas that build on it. Trades come next because they
#: describe what already happened at that instant, and the ticker - a summary -
#: last. Without a fixed rule here, two runs over the same data could evaluate
#: a strategy against different book states.
EVENT_KIND_ORDER: dict[MarketEventKind, int] = {
    MarketEventKind.BOOK_SNAPSHOT: 0,
    MarketEventKind.BOOK_DELTA: 1,
    MarketEventKind.TRADE: 2,
    MarketEventKind.TICKER: 3,
    MarketEventKind.CANDLE: 4,
    MarketEventKind.TIMER: 5,
}

_PayloadType = Ticker | PublicTrade | OrderBookSnapshot | OrderBookDelta | Candle


class DatasetError(ValueError):
    """Raised when a dataset is malformed or internally inconsistent."""


@dataclass(slots=True, frozen=True)
class MarketEvent:
    """One historical market-data event with its ordering key.

    ``sequence`` is the tie-breaker of last resort: when two events share a
    timestamp *and* a kind, the lower sequence is replayed first. Datasets that
    carry a venue sequence number should use it; otherwise the loader assigns
    the source order, which keeps replay stable without inventing information.
    """

    kind: MarketEventKind
    timestamp_micros: int
    payload: _PayloadType
    sequence: int = 0

    def __post_init__(self) -> None:
        if self.timestamp_micros < 0:
            raise DatasetError("MarketEvent timestamp must not be negative.")
        expected = {
            MarketEventKind.TICKER: Ticker,
            MarketEventKind.TRADE: PublicTrade,
            MarketEventKind.BOOK_SNAPSHOT: OrderBookSnapshot,
            MarketEventKind.BOOK_DELTA: OrderBookDelta,
            MarketEventKind.CANDLE: Candle,
        }.get(self.kind)
        if expected is None:
            raise DatasetError(
                f"MarketEvent kind {self.kind.value} cannot appear in a dataset."
            )
        if not isinstance(self.payload, expected):
            raise DatasetError(
                f"MarketEvent of kind {self.kind.value} must carry a "
                f"{expected.__name__}, got {type(self.payload).__name__}."
            )

    @property
    def symbol(self) -> str:
        return self.payload.symbol

    @property
    def exchange(self) -> ExchangeId:
        return self.payload.exchange

    @property
    def ordering_key(self) -> tuple[int, int, int]:
        """``(timestamp, kind rank, sequence)`` - the total replay order."""
        return (
            self.timestamp_micros,
            EVENT_KIND_ORDER[self.kind],
            self.sequence,
        )

    def checksum_source(self) -> str:
        """Canonical string used for the dataset checksum.

        Includes only fields that change the meaning of the event. Local
        receive timestamps are excluded: they describe *our* capture, not the
        market, and including them would make two identical datasets captured
        on different days hash differently.
        """
        parts: list[str] = [
            self.kind.value,
            str(self.timestamp_micros),
            str(self.sequence),
            self.payload.exchange.value,
            self.payload.symbol,
        ]
        payload = self.payload
        if isinstance(payload, Ticker):
            parts += [
                _decimal(payload.bid_price),
                _decimal(payload.ask_price),
                _decimal(payload.last_price),
            ]
        elif isinstance(payload, PublicTrade):
            parts += [
                payload.trade_id,
                _decimal(payload.price),
                _decimal(payload.quantity),
                payload.aggressor_side.value,
            ]
        elif isinstance(payload, OrderBookSnapshot):
            parts += [str(payload.last_update_id), _levels(payload.bids), _levels(payload.asks)]
        elif isinstance(payload, OrderBookDelta):
            parts += [
                str(payload.first_update_id),
                str(payload.final_update_id),
                _levels(payload.bids),
                _levels(payload.asks),
            ]
        else:
            parts += [
                payload.interval,
                str(payload.open_time),
                str(payload.close_time),
                _decimal(payload.open),
                _decimal(payload.high),
                _decimal(payload.low),
                _decimal(payload.close),
                _decimal(payload.volume),
                str(payload.trade_count),
                "1" if payload.is_closed else "0",
            ]
        return "|".join(parts)


def _decimal(value: Decimal | None) -> str:
    return "-" if value is None else str(value)


def _levels(levels: tuple[object, ...]) -> str:
    return ",".join(
        f"{getattr(level, 'price')}:{getattr(level, 'quantity')}" for level in levels
    )


def compute_dataset_checksum(events: Iterable[MarketEvent]) -> str:
    """SHA-256 over the canonical form of every event, in replay order.

    Order is imposed here rather than assumed, so a dataset assembled in a
    different order but containing the same events hashes identically - which
    is the property that makes the checksum a statement about *content*.
    """
    digest = hashlib.sha256()
    for event in sorted(events, key=lambda item: item.ordering_key):
        digest.update(event.checksum_source().encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


@dataclass(slots=True, frozen=True)
class DatasetDescriptor:
    """Identifies the exact input of a backtest.

    ``dataset_id`` and ``source`` are the operator's labels: which capture,
    from where. ``checksum`` is computed from the events. A run whose
    descriptor lacks a checksum is flagged non-reproducible in the result.
    """

    dataset_id: str
    source: str
    exchange: ExchangeId
    symbol: str
    market_type: MarketType
    start_micros: int
    end_micros: int
    granularity: str
    event_count: int
    checksum: str | None = None
    notes: str = ""

    def __post_init__(self) -> None:
        if not self.dataset_id:
            raise DatasetError("DatasetDescriptor requires a dataset_id.")
        if not self.source:
            raise DatasetError("DatasetDescriptor requires a source.")
        if self.end_micros < self.start_micros:
            raise DatasetError("DatasetDescriptor end_micros precedes start_micros.")
        if self.event_count < 0:
            raise DatasetError("DatasetDescriptor event_count cannot be negative.")

    @property
    def is_reproducible(self) -> bool:
        """Whether this input can be identified well enough to re-run.

        Requires a checksum and at least one event. Anything else is a dataset
        somebody could change without the result noticing.
        """
        return bool(self.checksum) and self.event_count > 0

    @property
    def duration_micros(self) -> int:
        return self.end_micros - self.start_micros

    def canonical_form(self) -> tuple[tuple[str, str], ...]:
        """Deterministic key/value pairs for the configuration hash."""
        return (
            ("dataset_id", self.dataset_id),
            ("source", self.source),
            ("exchange", self.exchange.value),
            ("symbol", self.symbol),
            ("market_type", self.market_type.value),
            ("start_micros", str(self.start_micros)),
            ("end_micros", str(self.end_micros)),
            ("granularity", self.granularity),
            ("event_count", str(self.event_count)),
            ("checksum", self.checksum or "none"),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "datasetId": self.dataset_id,
            "source": self.source,
            "exchange": self.exchange.value,
            "symbol": self.symbol,
            "marketType": self.market_type.value,
            "startMicros": self.start_micros,
            "endMicros": self.end_micros,
            "granularity": self.granularity,
            "eventCount": self.event_count,
            "checksum": self.checksum,
            "isReproducible": self.is_reproducible,
            "notes": self.notes,
        }


@dataclass(slots=True, frozen=True)
class HistoricalDataset:
    """An ordered, self-describing set of historical events.

    Construct with :meth:`from_events`, which sorts, validates and checksums in
    one pass. The stored tuple is already in replay order, so the replay engine
    does no sorting of its own and cannot reorder anything.
    """

    descriptor: DatasetDescriptor
    events: tuple[MarketEvent, ...] = field(default_factory=tuple)

    def __len__(self) -> int:
        return len(self.events)

    def __iter__(self) -> Iterator[MarketEvent]:
        return iter(self.events)

    @property
    def symbol(self) -> str:
        return self.descriptor.symbol

    @property
    def exchange(self) -> ExchangeId:
        return self.descriptor.exchange

    def kinds_present(self) -> tuple[MarketEventKind, ...]:
        return tuple(sorted({event.kind for event in self.events}, key=lambda k: k.value))

    def slice(self, *, start_micros: int, end_micros: int) -> "HistoricalDataset":
        """A sub-window as its own dataset, re-checksummed.

        Used by walk-forward splitting. The slice gets its own descriptor and
        its own checksum so a training-window result can never be confused with
        a test-window result.
        """
        if end_micros < start_micros:
            raise DatasetError("slice end precedes start.")
        selected = tuple(
            event
            for event in self.events
            if start_micros <= event.timestamp_micros <= end_micros
        )
        checksum = compute_dataset_checksum(selected)
        descriptor = DatasetDescriptor(
            dataset_id=f"{self.descriptor.dataset_id}#{start_micros}-{end_micros}",
            source=self.descriptor.source,
            exchange=self.descriptor.exchange,
            symbol=self.descriptor.symbol,
            market_type=self.descriptor.market_type,
            start_micros=start_micros,
            end_micros=end_micros,
            granularity=self.descriptor.granularity,
            event_count=len(selected),
            checksum=checksum,
            notes=f"Slice of {self.descriptor.dataset_id}.",
        )
        return HistoricalDataset(descriptor=descriptor, events=selected)

    @classmethod
    def from_events(
        cls,
        events: Sequence[MarketEvent],
        *,
        dataset_id: str,
        source: str,
        granularity: str = "event",
        market_type: MarketType = MarketType.SPOT,
        notes: str = "",
    ) -> "HistoricalDataset":
        """Validate, order and checksum a sequence of events.

        Rejects an empty dataset, and rejects one mixing symbols or venues: a
        strategy instance trades exactly one symbol on one venue, so a mixed
        dataset is a loading mistake rather than a multi-symbol feature.
        """
        if not events:
            raise DatasetError("A dataset must contain at least one event.")

        symbols = {event.symbol for event in events}
        if len(symbols) != 1:
            raise DatasetError(
                f"A dataset must cover exactly one symbol; found {sorted(symbols)}."
            )
        exchanges = {event.exchange for event in events}
        if len(exchanges) != 1:
            raise DatasetError(
                "A dataset must cover exactly one exchange; found "
                f"{sorted(exchange.value for exchange in exchanges)}."
            )

        ordered = tuple(sorted(events, key=lambda item: item.ordering_key))
        checksum = compute_dataset_checksum(ordered)
        descriptor = DatasetDescriptor(
            dataset_id=dataset_id,
            source=source,
            exchange=ordered[0].exchange,
            symbol=ordered[0].symbol,
            market_type=market_type,
            start_micros=ordered[0].timestamp_micros,
            end_micros=ordered[-1].timestamp_micros,
            granularity=granularity,
            event_count=len(ordered),
            checksum=checksum,
            notes=notes,
        )
        return cls(descriptor=descriptor, events=ordered)
