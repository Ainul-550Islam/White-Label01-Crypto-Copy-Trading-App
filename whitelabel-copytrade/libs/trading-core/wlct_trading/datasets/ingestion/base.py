"""The ingestion source abstraction.

A historical data source is asked four things - what does this request look
like on you, what will you give me, give it to me, and what were you - and the
interface here is those four questions and nothing else. There is no "write",
no "checksum", no "manifest" in this module: persistence belongs to the
pipeline, and a source that could touch storage would be a source that can
corrupt datasets.

Normalization is the source's job, deliberately: every venue's CSV columns,
zip layout and timestamp units are that venue's vocabulary, and the only
place allowed to learn a vocabulary is the mouth that speaks it. What leaves
a source is canonical - the same ``MarketEvent`` the live pipeline and the
Part 6 replay engine already agree on. The pipeline never sees raw JSON, and
so does not need a parser, a fixer, or the opinions that come with them.

The ``raw_text`` field on each record exists for *retention*, not for
parsing: an operator may choose to keep the venue's own bytes alongside the
canonical events (``retain_raw``), because "what did the venue actually send"
is the first question when a normalisation bug is suspected. It is a sibling
artefact, excluded from the dataset checksum and never read by the replay
path.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any, Mapping

from wlct_trading.backtest.dataset import MarketEvent
from wlct_trading.datasets.schema import DatasetFormatError
from wlct_trading.enums import ExchangeId, HistoricalSourceKind, MarketEventKind, MarketType

__all__ = ["IngestionRequest", "SourceFileDescriptor", "SourceRecord", "HistoricalDataSource"]


@dataclass(slots=True, frozen=True)
class IngestionRequest:
    """What the operator asked for, in venue-independent terms."""

    exchange: ExchangeId
    market_type: MarketType
    symbols: tuple[str, ...]
    kinds: tuple[MarketEventKind, ...]
    start_micros: int
    end_micros: int
    granularity: str = "event"
    retain_raw: bool = False

    def __post_init__(self) -> None:
        if not self.symbols:
            raise DatasetFormatError("IngestionRequest requires at least one symbol.")
        if len(set(self.symbols)) != len(self.symbols):
            raise DatasetFormatError("IngestionRequest symbols contain duplicates.")
        if not self.kinds:
            raise DatasetFormatError("IngestionRequest requires at least one event kind.")
        if set(self.kinds) - {
            MarketEventKind.TICKER,
            MarketEventKind.TRADE,
            MarketEventKind.BOOK_SNAPSHOT,
            MarketEventKind.BOOK_DELTA,
            MarketEventKind.CANDLE,
        }:
            raise DatasetFormatError(
                "Only TICKER, TRADE, BOOK_SNAPSHOT, BOOK_DELTA and CANDLE may be "
                "persisted; TIMER is a replay-time fiction with no bytes to capture."
            )
        if self.end_micros < self.start_micros:
            raise DatasetFormatError("IngestionRequest window end precedes start.")
        if not self.granularity:
            raise DatasetFormatError("IngestionRequest requires a granularity label.")


@dataclass(slots=True, frozen=True)
class SourceFileDescriptor:
    """One file the source *will* offer, named the way the source names it."""

    source_key: str
    symbol: str
    kind: MarketEventKind
    date: str
    expected_bytes: int | None = None
    optional: bool = False

    def __post_init__(self) -> None:
        if not self.source_key:
            raise DatasetFormatError("SourceFileDescriptor requires a source_key.")
        if not self.date:
            raise DatasetFormatError("SourceFileDescriptor requires a date.")


@dataclass(slots=True, frozen=True)
class SourceRecord:
    """One canonical event, plus - if retention is on - the venue's own line."""

    event: MarketEvent
    raw_text: str | None = None


class HistoricalDataSource(ABC):
    """Discover, stream, describe. Never write, never authenticate."""

    @property
    @abstractmethod
    def kind(self) -> HistoricalSourceKind:
        """Which flavour of source this is, for the manifest's provenance."""

    @property
    @abstractmethod
    def label(self) -> str:
        """A human-quotable name ("data.binance.vision/spot/daily/aggTrades").

        Validated against the credential pattern at construction - this string
        lands in the manifest and the identity hash, so a label carrying a
        secret would be baked into a dataset's very id. Sources enforce that
        their own constructors take no credentials at all; this is the second
        door, not the only one.
        """

    @abstractmethod
    def plan(self, request: IngestionRequest) -> tuple[SourceFileDescriptor, ...]:
        """The files this request maps to, sorted deterministically.

        Returning the plan before fetching anything is what lets the pipeline
        show an operator the size and count of a job before bytes move, and
        what lets a *missing* file be reported as a gap rather than as a
        silent short run.
        """

    @abstractmethod
    def stream(self, descriptor: SourceFileDescriptor, request: IngestionRequest) -> Iterator[SourceRecord]:
        """Yield canonical events for one described file, in source order."""

    def metadata(self) -> Mapping[str, str]:
        """Free-form provenance to record in the manifest (string only)."""
        return {}

    def describe(self) -> dict[str, Any]:
        """Loggable description: kind and label only. Deliberately exhaustive."""
        return {"kind": self.kind.value, "label": self.label}


def validate_source_label(label: str) -> str:
    """Every source label passes here, at construction, not at first write."""
    from wlct_trading.datasets.identity import validate_credential_free

    if not label or not label.strip():
        raise DatasetFormatError("A historical source must have a non-empty label.")
    if len(label) > 200:
        raise DatasetFormatError("Source labels must fit within 200 characters.")
    validate_credential_free("source label", label)
    return label
