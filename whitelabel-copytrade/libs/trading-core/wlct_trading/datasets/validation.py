"""Dataset validation: observe every corruption, repair none of them.

The validator is a stream processor. It is fed the exact event sequence the
writer stored, in storage order, and it accumulates findings - nothing more.
This module deliberately contains no "fix", "clean", "repair" or "resample"
logic anywhere: silently repairing market-data corruption is how a backtest
ends up replaying a dataset that never existed. Findings are counted,
classified and reported, and the *policy* decides whether the dataset is
usable - both are visible, neither is silent.

Severity model
--------------
Each rule has a default severity; :class:`ValidationPolicy` can override any
of them, and the policy itself is hashed into the manifest (``policyDigest``)
so a dataset validated under a lenient policy can never be mistaken for one
validated under the default. The defaults encode the specification's examples
exactly:

* metadata disagreement between manifest and files -> WARNING;
* a duplicate event -> ERROR;
* a corrupted order-book sequence -> FATAL, because a book with a hole in the
  middle has no defensible next state - the *only* recovery is a snapshot,
  and inventing one from later data is look-ahead.

The gap rules are per-kind by construction: trades and tickers have no
universal cadence (quiet markets are real), so a timestamp gap there is a
WARNING at most, while a book stream's continuity is defined by the venue's
own update ids and a violation of *that* is the corruption case above.

State topology follows the data, not the enum
----------------------------------------------
Ordering, sequences and duplicate memory are properties of a *stream* - a
symbol's trade tape has its own cadence and id space - so they key on
``(symbol, kind)``. The order book, by contrast, is one structure fed by two
kinds (snapshots and deltas); it keys on the symbol alone. Splitting the book
per kind would check every delta against a state the snapshot never touched
and report no gap at all - which is precisely the failure the book rules exist
to catch.

Memory bounds
-------------
Exact global duplicate detection would remember every id ever seen. The policy
carries ``duplicate_memory_events`` (default 1_000_000): up to that many
trade ids per (symbol, kind) are remembered exactly; beyond it, adjacency
detection continues and a single INFO finding records that global detection
was truncated. The alternative - silently skipping the rule on large datasets
- would report "no duplicates" about a scan that never looked.
"""

from __future__ import annotations

import hashlib
from collections import Counter
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from types import MappingProxyType
from typing import Any, Iterable, Mapping

from wlct_trading.backtest.dataset import MarketEvent
from wlct_trading.datasets.schema import DatasetFormatError, canonical_json
from wlct_trading.enums import (
    DatasetStatus,
    DatasetValidationSeverity,
    ExchangeId,
    MarketEventKind,
)
from wlct_trading.market_data import (
    Candle,
    OrderBookDelta,
    OrderBookSnapshot,
    PriceLevel,
    PublicTrade,
    Ticker,
)

__all__ = [
    "VALIDATION_RULES",
    "SEVERITY_RANK",
    "ValidationFinding",
    "ValidationPolicy",
    "DatasetValidationReport",
    "DatasetValidator",
]

_ZERO = Decimal(0)

#: Every rule the validator can emit, with its default severity. The table is
#: public so operators (and the admin console) can enumerate what a report
#: might contain without reading the scanner's source.
VALIDATION_RULES: Mapping[str, DatasetValidationSeverity] = MappingProxyType(
    {
        "TIMESTAMP_NOT_MONOTONIC": DatasetValidationSeverity.ERROR,
        "DUPLICATE_EVENT": DatasetValidationSeverity.ERROR,
        "DUPLICATE_SCAN_TRUNCATED": DatasetValidationSeverity.INFO,
        "NEGATIVE_PRICE": DatasetValidationSeverity.ERROR,
        "NEGATIVE_QUANTITY": DatasetValidationSeverity.ERROR,
        "ZERO_QUANTITY_PRINT": DatasetValidationSeverity.ERROR,
        "CANDLE_RANGE_INCONSISTENT": DatasetValidationSeverity.ERROR,
        "CROSSED_BOOK": DatasetValidationSeverity.ERROR,
        "LOCKED_BOOK": DatasetValidationSeverity.WARNING,
        "BOOK_LEVELS_UNORDERED": DatasetValidationSeverity.WARNING,
        "BOOK_SEQUENCE_GAP": DatasetValidationSeverity.FATAL,
        "BOOK_SEQUENCE_REPLAY": DatasetValidationSeverity.WARNING,
        "TIMESTAMP_GAP": DatasetValidationSeverity.WARNING,
        "DATE_GAP": DatasetValidationSeverity.WARNING,
        "SYMBOL_MISMATCH": DatasetValidationSeverity.FATAL,
        "EXCHANGE_MISMATCH": DatasetValidationSeverity.FATAL,
        "EVENT_KIND_UNDECLARED": DatasetValidationSeverity.FATAL,
        "FORMAT_ERROR": DatasetValidationSeverity.FATAL,
        "UNRELIABLE_RANGE": DatasetValidationSeverity.WARNING,
    }
)

#: Severity ranks for comparison. ``StrEnum`` members compare lexically as
#: strings, and ``"ERROR" < "FATAL" < "INFO" < "WARNING"`` is a nonsense
#: ordering for policy checks - so nothing in this package uses ``>=`` on the
#: enum itself, only on these ranks.
SEVERITY_RANK: Mapping[DatasetValidationSeverity, int] = MappingProxyType(
    {
        DatasetValidationSeverity.INFO: 0,
        DatasetValidationSeverity.WARNING: 1,
        DatasetValidationSeverity.ERROR: 2,
        DatasetValidationSeverity.FATAL: 3,
    }
)


@dataclass(slots=True, frozen=True)
class ValidationFinding:
    """One observation about one event (or one boundary between events)."""

    rule: str
    severity: DatasetValidationSeverity
    message: str
    symbol: str | None = None
    timestamp_micros: int | None = None
    partition_path: str | None = None
    line_number: int | None = None
    details: Mapping[str, str] = field(default_factory=dict)

    def to_wire(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "rule": self.rule,
            "severity": self.severity.value,
            "msg": self.message,
        }
        if self.symbol is not None:
            out["symbol"] = self.symbol
        if self.timestamp_micros is not None:
            out["ts"] = self.timestamp_micros
        if self.partition_path is not None:
            out["partition"] = self.partition_path
        if self.line_number is not None:
            out["line"] = self.line_number
        if self.details:
            out["details"] = dict(sorted(self.details.items()))
        return out


@dataclass(slots=True, frozen=True)
class ValidationPolicy:
    """How strict to be, and how loudly. Hashed into the manifest.

    ``reject_at`` is the *lowest* severity that makes a dataset unusable for
    normal replay. The default is ``ERROR``: warnings and infos are reported
    but never block. Moving it to ``WARNING`` turns any finding into a
    quarantine candidate, which is a legitimate stance for compliance-facing
    archives and a poor one for daily research - hence a setting, and hence
    recorded in the manifest so every reader knows which one produced a given
    verdict.
    """

    severity_overrides: Mapping[str, DatasetValidationSeverity] = field(default_factory=dict)
    reject_at: DatasetValidationSeverity = DatasetValidationSeverity.ERROR
    max_findings: int = 1_000
    max_gap_findings: int = 100
    duplicate_memory_events: int = 1_000_000
    timestamp_gap_micros: Mapping[MarketEventKind, int] = field(default_factory=dict)
    expected_dates_per_stream: bool = True

    def __post_init__(self) -> None:
        for rule, severity in self.severity_overrides.items():
            if rule not in VALIDATION_RULES:
                raise DatasetFormatError(f"Unknown validation rule in policy: {rule!r}.")
            if not isinstance(severity, DatasetValidationSeverity):
                raise DatasetFormatError(f"Override for {rule!r} must be a severity member.")
        if self.reject_at not in (
            DatasetValidationSeverity.WARNING,
            DatasetValidationSeverity.ERROR,
            DatasetValidationSeverity.FATAL,
        ):
            raise DatasetFormatError(
                "reject_at must be WARNING, ERROR or FATAL; INFO would reject everything."
            )
        if self.max_findings < 1:
            raise DatasetFormatError("max_findings must be positive.")
        if self.max_gap_findings < 1:
            raise DatasetFormatError("max_gap_findings must be positive.")
        if self.duplicate_memory_events < 1:
            raise DatasetFormatError("duplicate_memory_events must be positive.")
        for kind, limit in self.timestamp_gap_micros.items():
            if limit <= 0:
                raise DatasetFormatError(f"Gap bound for {kind.value} must be positive.")

    def severity_for(self, rule: str) -> DatasetValidationSeverity:
        default = VALIDATION_RULES[rule]
        return self.severity_overrides.get(rule, default)

    def to_wire(self) -> dict[str, Any]:
        return {
            "overrides": {
                rule: severity.value
                for rule, severity in sorted(self.severity_overrides.items())
            },
            "rejectAt": self.reject_at.value,
            "maxFindings": self.max_findings,
            "maxGapFindings": self.max_gap_findings,
            "duplicateMemoryEvents": self.duplicate_memory_events,
            "timestampGapMicros": {
                kind.value: self.timestamp_gap_micros[kind]
                for kind in sorted(self.timestamp_gap_micros, key=lambda item: item.value)
            },
            "expectedDatesPerStream": self.expected_dates_per_stream,
        }

    def digest(self) -> str:
        return hashlib.sha256(canonical_json(self.to_wire()).encode("utf-8")).hexdigest()


@dataclass(slots=True, frozen=True)
class DatasetValidationReport:
    """The complete verdict for one validation pass, in stored form."""

    status: DatasetStatus
    findings: tuple[ValidationFinding, ...]
    counts_by_severity: Mapping[str, int]
    counts_by_rule: Mapping[str, int]
    truncated_findings: int
    events_observed: int
    first_timestamp_micros: int | None
    last_timestamp_micros: int | None
    unreliable_ranges: tuple[tuple[str, int, int | None], ...]
    duration_micros: int
    policy_digest: str

    def to_wire(self) -> dict[str, Any]:
        return {
            "status": self.status.value,
            "eventsObserved": self.events_observed,
            "firstTs": self.first_timestamp_micros,
            "lastTs": self.last_timestamp_micros,
            "countsBySeverity": dict(sorted(self.counts_by_severity.items())),
            "countsByRule": dict(sorted(self.counts_by_rule.items())),
            "truncatedFindings": self.truncated_findings,
            "unreliableRanges": [
                {"symbol": symbol, "from": start, "to": end}
                for symbol, start, end in self.unreliable_ranges
            ],
            "durationMicros": self.duration_micros,
            "policyDigest": self.policy_digest,
            "findings": [finding.to_wire() for finding in self.findings],
        }

    def to_json_bytes(self) -> bytes:
        return (canonical_json(self.to_wire()) + "\n").encode("utf-8")

    @property
    def digest(self) -> str:
        return hashlib.sha256(self.to_json_bytes()).hexdigest()


class _StreamState:
    """Per (symbol, kind) ordering and duplicate memory. Mutable on purpose."""

    __slots__ = ("last_ts", "seen_trade_ids", "duplicate_memory_exhausted", "last_source")

    def __init__(self) -> None:
        self.last_ts: int | None = None
        self.seen_trade_ids: set[str] = set()
        self.duplicate_memory_exhausted = False
        self.last_source: str | None = None


class _BookState:
    """Per symbol, across snapshot and delta kinds: one book, one chain."""

    __slots__ = ("last_final_update_id", "ready", "best_bid", "best_ask", "unreliable_since")

    def __init__(self) -> None:
        self.last_final_update_id: int | None = None
        self.ready = False
        self.best_bid: Decimal | None = None
        self.best_ask: Decimal | None = None
        self.unreliable_since: int | None = None


class DatasetValidator:
    """Streaming validator for canonical historical events.

    Feed it :meth:`observe` calls in storage order - exactly the order the
    writer flushed and the order a partition replays - then :meth:`finalize`
    for the report. A validator that has finalised is spent; build a new one
    for a new pass rather than resetting state in place, because a
    partially-reset scanner is how half of a dataset silently inherits
    yesterday's verdict.
    """

    def __init__(
        self,
        *,
        exchange: ExchangeId,
        symbols: Iterable[str],
        kinds: Iterable[MarketEventKind],
        policy: ValidationPolicy | None = None,
    ) -> None:
        symbol_set = frozenset(symbols)
        kind_set = frozenset(kinds)
        if not symbol_set:
            raise DatasetFormatError("Validator requires the dataset's symbol scope.")
        if not kind_set:
            raise DatasetFormatError("Validator requires the dataset's event-kind scope.")
        self._exchange = exchange
        self._symbols = symbol_set
        self._kinds = kind_set
        self._policy = policy or ValidationPolicy()
        self._streams: dict[tuple[str, MarketEventKind], _StreamState] = {}
        self._books: dict[str, _BookState] = {}
        self._findings: list[ValidationFinding] = []
        self._rule_counts: Counter[str] = Counter()
        self._severity_counts: Counter[DatasetValidationSeverity] = Counter()
        self._truncated = 0
        self._events = 0
        self._first_ts: int | None = None
        self._last_ts: int | None = None
        self._dates: dict[tuple[str, MarketEventKind], set[str]] = {}
        self._gap_reported: Counter[tuple[str, MarketEventKind]] = Counter()
        self._finished = False

    @property
    def policy(self) -> ValidationPolicy:
        return self._policy

    # -- ingestion ------------------------------------------------------------------
    def observe(
        self,
        event: MarketEvent,
        *,
        partition_path: str = "",
        line_number: int | None = None,
    ) -> None:
        """One event, in storage order. Never raises for bad *data*.

        Malformed events are findings, not exceptions - the pipeline must not
        lose the other 4.9 million observations because one line is corrupt.
        Structural misuse of the *validator* still raises: that is a
        programming error, and those must not masquerade as data.
        """
        if self._finished:
            raise DatasetFormatError("This validator has finalised; build a new one.")
        self._events += 1
        ts = event.timestamp_micros
        self._first_ts = ts if self._first_ts is None else min(self._first_ts, ts)
        self._last_ts = ts if self._last_ts is None else max(self._last_ts, ts)

        payload = event.payload
        if payload.symbol not in self._symbols:
            self._emit(
                "SYMBOL_MISMATCH",
                f"Event carries symbol {payload.symbol!r}; dataset scope is "
                f"{sorted(self._symbols)}.",
                symbol=payload.symbol,
                timestamp_micros=ts,
                partition_path=partition_path,
                line_number=line_number,
            )
            return
        if event.kind not in self._kinds:
            self._emit(
                "EVENT_KIND_UNDECLARED",
                f"Event kind {event.kind.value} is outside the dataset's declared schema "
                f"{sorted(kind.value for kind in self._kinds)}.",
                symbol=payload.symbol,
                timestamp_micros=ts,
                partition_path=partition_path,
                line_number=line_number,
            )
            return
        if payload.exchange is not self._exchange:
            self._emit(
                "EXCHANGE_MISMATCH",
                f"Event carries exchange {payload.exchange.value!r}; dataset declares "
                f"{self._exchange.value!r}. Cross-venue mixing is a loading bug, not a market.",
                symbol=payload.symbol,
                timestamp_micros=ts,
                partition_path=partition_path,
                line_number=line_number,
            )
            return

        state = self._streams.setdefault((payload.symbol, event.kind), _StreamState())
        self._check_ordering(state, event, partition_path, line_number)
        self._check_duplicates(state, event, partition_path, line_number)

        if isinstance(payload, Ticker):
            self._check_ticker(payload, partition_path, line_number)
        elif isinstance(payload, PublicTrade):
            self._check_trade(payload, partition_path, line_number)
        elif isinstance(payload, OrderBookSnapshot):
            self._check_book_snapshot(payload, partition_path, line_number)
        elif isinstance(payload, OrderBookDelta):
            self._check_book_delta(payload, partition_path, line_number)
        else:
            self._check_candle(payload, partition_path, line_number)

        state.last_ts = ts

    def note_format_error(self, message: str, *, partition_path: str, line_number: int) -> None:
        """Record a parse failure the reader hit. Fatal by definition.

        A line the parser rejected is exactly the corruption the quarantine
        state exists for: the file is no longer self-describing, and every
        downstream position count would silently disagree with the manifest.
        """
        if self._finished:
            raise DatasetFormatError("This validator has finalised; build a new one.")
        self._emit("FORMAT_ERROR", message, partition_path=partition_path, line_number=line_number)

    def note_partition_dates(
        self, *, symbol: str, kind: MarketEventKind, dates: tuple[str, ...]
    ) -> None:
        """Record which calendar dates a partition stream claims to cover."""
        if self._finished:
            raise DatasetFormatError("This validator has finalised; build a new one.")
        bucket = self._dates.setdefault((symbol, kind), set())
        bucket.update(dates)

    # -- rules ------------------------------------------------------------------------
    def _check_ordering(
        self,
        state: _StreamState,
        event: MarketEvent,
        partition_path: str,
        line_number: int | None,
    ) -> None:
        ts = event.timestamp_micros
        if state.last_ts is None:
            return
        if ts < state.last_ts:
            self._emit(
                "TIMESTAMP_NOT_MONOTONIC",
                f"Timestamp {ts} is earlier than the previous {state.last_ts}; storage "
                "order inside a partition is part of the dataset contract.",
                symbol=event.payload.symbol,
                timestamp_micros=ts,
                partition_path=partition_path,
                line_number=line_number,
                details={"previous": str(state.last_ts)},
            )
        limit = self._policy.timestamp_gap_micros.get(event.kind)
        if limit is not None and ts - state.last_ts > limit:
            key = (event.payload.symbol, event.kind)
            # The *finding* is capped so one quiet week does not fill the
            # report with identical lines; the *count* never is, or a capped
            # report would understate the dataset it describes.
            self._count_rule("TIMESTAMP_GAP")
            if self._gap_reported[key] < self._policy.max_gap_findings:
                self._gap_reported[key] += 1
                self._add_finding(
                    "TIMESTAMP_GAP",
                    f"{event.kind.value} stream silent for {ts - state.last_ts}us "
                    f"(policy bound {limit}us).",
                    symbol=event.payload.symbol,
                    timestamp_micros=ts,
                    partition_path=partition_path,
                    line_number=line_number,
                    details={"gapMicros": str(ts - state.last_ts)},
                )

    def _check_duplicates(
        self,
        state: _StreamState,
        event: MarketEvent,
        partition_path: str,
        line_number: int | None,
    ) -> None:
        source = event.checksum_source()
        if state.last_source == source:
            self._emit(
                "DUPLICATE_EVENT",
                "Event repeats the immediately preceding canonical event exactly.",
                symbol=event.payload.symbol,
                timestamp_micros=event.timestamp_micros,
                partition_path=partition_path,
                line_number=line_number,
                details={"kind": "adjacent"},
            )
        state.last_source = source

        payload = event.payload
        if isinstance(payload, PublicTrade):
            native_id = payload.trade_id
            if len(state.seen_trade_ids) >= self._policy.duplicate_memory_events:
                if not state.duplicate_memory_exhausted:
                    state.duplicate_memory_exhausted = True
                    self._emit(
                        "DUPLICATE_SCAN_TRUNCATED",
                        f"Global trade-id duplicate memory "
                        f"({self._policy.duplicate_memory_events} ids) exhausted; later "
                        "duplicates can only be found by adjacency.",
                        symbol=payload.symbol,
                        partition_path=partition_path,
                    )
                return
            if native_id in state.seen_trade_ids:
                self._emit(
                    "DUPLICATE_EVENT",
                    f"Trade id {native_id!r} appears more than once in the stream.",
                    symbol=payload.symbol,
                    timestamp_micros=event.timestamp_micros,
                    partition_path=partition_path,
                    line_number=line_number,
                    details={"tradeId": native_id, "kind": "global"},
                )
            state.seen_trade_ids.add(native_id)

    def _check_ticker(
        self, payload: Ticker, partition_path: str, line_number: int | None
    ) -> None:
        bid, ask = payload.bid_price, payload.ask_price
        for name, value in (("bid", bid), ("ask", ask), ("last", payload.last_price)):
            if value is not None and value < _ZERO:
                self._emit(
                    "NEGATIVE_PRICE",
                    f"Ticker {name} price is negative: {value!s}.",
                    symbol=payload.symbol,
                    timestamp_micros=payload.exchange_timestamp,
                    partition_path=partition_path,
                    line_number=line_number,
                )
        if bid is not None and ask is not None:
            if bid > ask:
                self._emit(
                    "CROSSED_BOOK",
                    f"Ticker quotes bid {bid!s} above ask {ask!s}.",
                    symbol=payload.symbol,
                    timestamp_micros=payload.exchange_timestamp,
                    partition_path=partition_path,
                    line_number=line_number,
                )
            elif bid == ask:
                self._emit(
                    "LOCKED_BOOK",
                    f"Ticker quotes a locked market at {bid!s}; legal at halt times, "
                    "suspicious in a continuous stream.",
                    symbol=payload.symbol,
                    timestamp_micros=payload.exchange_timestamp,
                    partition_path=partition_path,
                    line_number=line_number,
                )

    def _check_trade(
        self, payload: PublicTrade, partition_path: str, line_number: int | None
    ) -> None:
        if payload.price < _ZERO:
            self._emit(
                "NEGATIVE_PRICE",
                f"Trade price is negative: {payload.price!s}.",
                symbol=payload.symbol,
                timestamp_micros=payload.exchange_timestamp,
                partition_path=partition_path,
                line_number=line_number,
            )
        if payload.quantity < _ZERO:
            self._emit(
                "NEGATIVE_QUANTITY",
                f"Trade quantity is negative: {payload.quantity!s}.",
                symbol=payload.symbol,
                timestamp_micros=payload.exchange_timestamp,
                partition_path=partition_path,
                line_number=line_number,
            )
        elif payload.quantity == _ZERO:
            self._emit(
                "ZERO_QUANTITY_PRINT",
                "Trade printed with zero size; venue tape has no such print.",
                symbol=payload.symbol,
                timestamp_micros=payload.exchange_timestamp,
                partition_path=partition_path,
                line_number=line_number,
            )

    def _check_book_snapshot(
        self,
        payload: OrderBookSnapshot,
        partition_path: str,
        line_number: int | None,
    ) -> None:
        book = self._books.setdefault(payload.symbol, _BookState())
        self._note_levels(
            payload.bids,
            payload.asks,
            payload.exchange_timestamp,
            payload.symbol,
            partition_path,
            line_number,
        )
        top = _top(payload.bids, payload.asks)
        book.best_bid, book.best_ask = top
        book.ready = True
        book.last_final_update_id = payload.last_update_id
        if book.unreliable_since is not None:
            self._emit(
                "UNRELIABLE_RANGE",
                "Book state was unreliable between the corruption and this snapshot.",
                symbol=payload.symbol,
                timestamp_micros=payload.exchange_timestamp,
                partition_path=partition_path,
                details={"since": str(book.unreliable_since)},
            )
            book.unreliable_since = None
        if top[0] is not None and top[1] is not None:
            if top[0] > top[1]:
                self._emit(
                    "CROSSED_BOOK",
                    f"Snapshot is crossed: best bid {top[0]!s} above best ask "
                    f"{top[1]!s}. A crossed book is corruption, not a market state.",
                    symbol=payload.symbol,
                    timestamp_micros=payload.exchange_timestamp,
                    partition_path=partition_path,
                    line_number=line_number,
                )
            elif top[0] == top[1]:
                self._emit(
                    "LOCKED_BOOK",
                    f"Snapshot quotes a locked market at {top[0]!s}; legal at halt "
                    "times, suspicious in a continuous stream.",
                    symbol=payload.symbol,
                    timestamp_micros=payload.exchange_timestamp,
                    partition_path=partition_path,
                    line_number=line_number,
                )

    def _check_book_delta(
        self,
        payload: OrderBookDelta,
        partition_path: str,
        line_number: int | None,
    ) -> None:
        book = self._books.setdefault(payload.symbol, _BookState())
        self._note_levels(
            payload.bids,
            payload.asks,
            payload.exchange_timestamp,
            payload.symbol,
            partition_path,
            line_number,
        )
        if book.ready and book.last_final_update_id is not None:
            if payload.first_update_id > book.last_final_update_id + 1:
                if book.unreliable_since is None:
                    book.unreliable_since = payload.exchange_timestamp
                self._emit(
                    "BOOK_SEQUENCE_GAP",
                    f"Book delta starts at update {payload.first_update_id} but the "
                    f"previous final id was {book.last_final_update_id}: "
                    f"{payload.first_update_id - book.last_final_update_id - 1} "
                    "update(s) are missing. The book cannot be trusted until a "
                    "snapshot rebuilds it; inventing the gap away is look-ahead.",
                    symbol=payload.symbol,
                    timestamp_micros=payload.exchange_timestamp,
                    partition_path=partition_path,
                    line_number=line_number,
                    details={
                        "expectedFirst": str(book.last_final_update_id + 1),
                        "observedFirst": str(payload.first_update_id),
                    },
                )
                # The book is untrustworthy from here until the next
                # snapshot; suppressing top-of-book checks keeps a broken
                # chain from producing a cascade of "crossed" errors that
                # describe the validator's confusion, not the venue.
                book.ready = False
                return
            if payload.first_update_id <= book.last_final_update_id:
                self._emit(
                    "BOOK_SEQUENCE_REPLAY",
                    f"Book delta covers {payload.first_update_id}..{payload.final_update_id}, "
                    f"already applied through {book.last_final_update_id}; replayed or "
                    "overlapping update.",
                    symbol=payload.symbol,
                    timestamp_micros=payload.exchange_timestamp,
                    partition_path=partition_path,
                    line_number=line_number,
                )
        if not book.ready:
            return
        previous = book.last_final_update_id
        book.last_final_update_id = (
            payload.final_update_id
            if previous is None
            else max(payload.final_update_id, previous)
        )
        _apply_delta_to_top(book, payload)
        if (
            book.best_bid is not None
            and book.best_ask is not None
            and book.best_bid > book.best_ask
        ):
            self._emit(
                "CROSSED_BOOK",
                f"Book crossed after delta: best bid {book.best_bid!s} above best ask "
                f"{book.best_ask!s}.",
                symbol=payload.symbol,
                timestamp_micros=payload.exchange_timestamp,
                partition_path=partition_path,
                line_number=line_number,
            )

    def _check_candle(
        self, payload: Candle, partition_path: str, line_number: int | None
    ) -> None:
        if payload.close_time <= payload.open_time:
            self._emit(
                "CANDLE_RANGE_INCONSISTENT",
                f"Candle closes at {payload.close_time} but opened {payload.open_time}.",
                symbol=payload.symbol,
                timestamp_micros=payload.open_time,
                partition_path=partition_path,
                line_number=line_number,
            )
        if payload.high < payload.low:
            self._emit(
                "CANDLE_RANGE_INCONSISTENT",
                f"Candle high {payload.high!s} below low {payload.low!s}.",
                symbol=payload.symbol,
                timestamp_micros=payload.open_time,
                partition_path=partition_path,
                line_number=line_number,
            )
        for name, value in (
            ("open", payload.open),
            ("high", payload.high),
            ("low", payload.low),
            ("close", payload.close),
            ("volume", payload.volume),
        ):
            if value < _ZERO:
                self._emit(
                    "NEGATIVE_QUANTITY" if name == "volume" else "NEGATIVE_PRICE",
                    f"Candle {name} is negative: {value!s}.",
                    symbol=payload.symbol,
                    timestamp_micros=payload.open_time,
                    partition_path=partition_path,
                    line_number=line_number,
                )

    def _note_levels(
        self,
        bids: tuple[PriceLevel, ...],
        asks: tuple[PriceLevel, ...],
        timestamp_micros: int,
        symbol: str,
        partition_path: str,
        line_number: int | None,
    ) -> None:
        """Level shape checks shared by snapshots and deltas."""
        for name, levels in (("bids", bids), ("asks", asks)):
            for level in levels:
                if level.price < _ZERO:
                    self._emit(
                        "NEGATIVE_PRICE",
                        f"{name} level at negative price {level.price!s}.",
                        symbol=symbol,
                        timestamp_micros=timestamp_micros,
                        partition_path=partition_path,
                        line_number=line_number,
                    )
                if level.quantity < _ZERO:
                    self._emit(
                        "NEGATIVE_QUANTITY",
                        f"{name} level with negative quantity {level.quantity!s}.",
                        symbol=symbol,
                        timestamp_micros=timestamp_micros,
                        partition_path=partition_path,
                        line_number=line_number,
                    )
        bid_prices = [level.price for level in bids if level.price > _ZERO]
        if bid_prices != sorted(bid_prices, reverse=True):
            self._emit(
                "BOOK_LEVELS_UNORDERED",
                "Book bids are not price-descending; readers sort defensively, but "
                "the venue's own ordering was not preserved in storage.",
                symbol=symbol,
                timestamp_micros=timestamp_micros,
                partition_path=partition_path,
                line_number=line_number,
            )
        ask_prices = [level.price for level in asks if level.price > _ZERO]
        if ask_prices != sorted(ask_prices):
            self._emit(
                "BOOK_LEVELS_UNORDERED",
                "Book asks are not price-ascending; readers sort defensively, but "
                "the venue's own ordering was not preserved in storage.",
                symbol=symbol,
                timestamp_micros=timestamp_micros,
                partition_path=partition_path,
                line_number=line_number,
            )

    # -- output -------------------------------------------------------------------------
    def _count_rule(self, rule: str) -> None:
        self._rule_counts[rule] += 1
        self._severity_counts[self._policy.severity_for(rule)] += 1

    def _add_finding(
        self,
        rule: str,
        message: str,
        *,
        symbol: str | None = None,
        timestamp_micros: int | None = None,
        partition_path: str | None = None,
        line_number: int | None = None,
        details: Mapping[str, str] | None = None,
    ) -> None:
        severity = self._policy.severity_for(rule)
        if len(self._findings) < self._policy.max_findings:
            self._findings.append(
                ValidationFinding(
                    rule=rule,
                    severity=severity,
                    message=message,
                    symbol=symbol,
                    timestamp_micros=timestamp_micros,
                    partition_path=partition_path,
                    line_number=line_number,
                    details=dict(details or {}),
                )
            )
        else:
            self._truncated += 1

    def _emit(
        self,
        rule: str,
        message: str,
        *,
        symbol: str | None = None,
        timestamp_micros: int | None = None,
        partition_path: str | None = None,
        line_number: int | None = None,
        details: Mapping[str, str] | None = None,
    ) -> None:
        self._count_rule(rule)
        self._add_finding(
            rule,
            message,
            symbol=symbol,
            timestamp_micros=timestamp_micros,
            partition_path=partition_path,
            line_number=line_number,
            details=details,
        )

    def finalize(self, *, duration_micros: int = 0) -> DatasetValidationReport:
        """Produce the report; completeness of the promised calendar first."""
        if self._finished:
            raise DatasetFormatError("finalize() called twice on the same validator.")
        self._finished = True
        if self._policy.expected_dates_per_stream:
            for (symbol, kind), dates in sorted(self._dates.items()):
                for missing in _missing_dates(dates):
                    self._emit(
                        "DATE_GAP",
                        f"{kind.value} stream for {symbol} has no partition for "
                        f"{missing}; the dataset is not continuous across its own "
                        "claimed days.",
                        symbol=symbol,
                        details={"date": missing},
                    )
        threshold = SEVERITY_RANK[self._policy.reject_at]
        blocking = any(
            SEVERITY_RANK[severity] >= threshold and count > 0
            for severity, count in self._severity_counts.items()
        )
        status = DatasetStatus.INVALID if blocking else DatasetStatus.VALID
        unreliable: list[tuple[str, int, int | None]] = []
        for symbol, book in sorted(self._books.items()):
            if book.unreliable_since is not None:
                unreliable.append((symbol, book.unreliable_since, None))
        return DatasetValidationReport(
            status=status,
            findings=tuple(self._findings),
            counts_by_severity={
                severity.value: self._severity_counts[severity]
                for severity in (
                    DatasetValidationSeverity.INFO,
                    DatasetValidationSeverity.WARNING,
                    DatasetValidationSeverity.ERROR,
                    DatasetValidationSeverity.FATAL,
                )
            },
            counts_by_rule=dict(self._rule_counts),
            truncated_findings=self._truncated,
            events_observed=self._events,
            first_timestamp_micros=self._first_ts,
            last_timestamp_micros=self._last_ts,
            unreliable_ranges=tuple(unreliable),
            duration_micros=duration_micros,
            policy_digest=self._policy.digest(),
        )


def _top(
    bids: tuple[PriceLevel, ...], asks: tuple[PriceLevel, ...]
) -> tuple[Decimal | None, Decimal | None]:
    bid = max((level.price for level in bids if level.quantity > _ZERO), default=None)
    ask = min((level.price for level in asks if level.quantity > _ZERO), default=None)
    return bid, ask


def _apply_delta_to_top(book: _BookState, payload: OrderBookDelta) -> None:
    """Fold one delta into the remembered top, best-effort.

    A zero-quantity at the remembered top removes it, and the replacement
    level is not in this message; the top is then set to ``None`` and stays
    unknown until the next snapshot. An *unknown* top suppresses crossed-book
    checks - which is correct, because there is no book to judge - while the
    sequence chain, the corruption story, continues unimpeded.
    """
    for level in payload.bids:
        if level.quantity == _ZERO:
            if book.best_bid is not None and level.price == book.best_bid:
                book.best_bid = None
        elif book.best_bid is None or level.price > book.best_bid:
            book.best_bid = level.price
    for level in payload.asks:
        if level.quantity == _ZERO:
            if book.best_ask is not None and level.price == book.best_ask:
                book.best_ask = None
        elif book.best_ask is None or level.price < book.best_ask:
            book.best_ask = level.price


def _missing_dates(dates: set[str]) -> tuple[str, ...]:
    """Interior calendar holes in an inclusive set of ISO dates."""
    if len(dates) < 2:
        return ()
    parsed: list[date] = []
    for raw in sorted(dates):
        try:
            parsed.append(date.fromisoformat(raw))
        except ValueError:
            continue
    missing: list[str] = []
    for previous, current in zip(parsed, parsed[1:]):
        day = previous.toordinal() + 1
        while day < current.toordinal():
            missing.append(date.fromordinal(day).isoformat())
            day += 1
    return tuple(missing)
