"""Local-file historical source.

Reads a directory of canonical JSONL (optionally gzipped) files named
``<SYMBOL>-<KIND>-<YYYY-MM-DD>.jsonl[.gz]``. It exists for three reasons, and
the third is the important one:

1. tests need a source that is deterministic, offline and free;
2. operators converting an existing dump need the "just index what I already
   have" path, which this is;
3. the ingestion pipeline is only *proven* source-agnostic if something other
   than the venue adapter drives it end to end - a pipeline that only ever
   ran against Binance would quietly accumulate Binance assumptions in its
   "generic" parts, exactly where nobody looks.

The naming rule is the whole index: date from filename, symbol from filename,
kind from filename. A file that does not follow the rule is not renamed,
skipped, or guessed at - it is refused, loudly, because a silently-skipped
file is a silently missing day.
"""

from __future__ import annotations

import gzip
import re
from datetime import datetime, timezone
from collections.abc import Iterator
from pathlib import Path

from wlct_trading.datasets.ingestion.base import (
    HistoricalDataSource,
    IngestionRequest,
    SourceFileDescriptor,
    SourceRecord,
    validate_source_label,
)
from wlct_trading.datasets.schema import DatasetFormatError, line_to_event
from wlct_trading.enums import HistoricalSourceKind, MarketEventKind

__all__ = ["LocalJsonlSource"]

_FILE_RE = re.compile(r"^(?P<venue>[A-Z0-9]+)-(?P<kind>[A-Z_]+)-(?P<date>\d{4}-\d{2}-\d{2})\.jsonl(\.gz)?$")


class LocalJsonlSource(HistoricalDataSource):
    """A directory of pre-canonicalised JSONL partitions."""

    def __init__(self, root: Path, *, venue_symbol_map: dict[str, str] | None = None) -> None:
        self._root = Path(root)
        if not self._root.is_dir():
            raise DatasetFormatError(f"Local source root {self._root} is not a directory.")
        self._venue_symbols = dict(venue_symbol_map or {})
        self._label = validate_source_label(f"local:{self._root.name}")

    @property
    def kind(self) -> HistoricalSourceKind:
        return HistoricalSourceKind.LOCAL_FILES

    @property
    def label(self) -> str:
        return self._label

    def plan(self, request: IngestionRequest) -> tuple[SourceFileDescriptor, ...]:
        descriptors: list[SourceFileDescriptor] = []
        for entry in self._root.iterdir():
            match = _FILE_RE.fullmatch(entry.name)
            if match is None:
                continue
            kind = MarketEventKind(match.group("kind"))
            date = match.group("date")
            if date is not None and not self._in_window(date, request):
                continue
            if kind not in request.kinds:
                continue
            symbol = self._symbol_for_venue(match.group("venue"), request)
            if symbol not in request.symbols:
                continue
            descriptors.append(
                SourceFileDescriptor(
                    source_key=entry.name,
                    symbol=symbol,
                    kind=kind,
                    date=date,
                    expected_bytes=entry.stat().st_size,
                )
            )
        descriptors.sort(key=lambda item: (item.symbol, item.kind.value, item.date, item.source_key))
        if not descriptors:
            raise DatasetFormatError(
                f"No files under {self._root} match <VENUE>-<KIND>-<date>.jsonl[.gz] "
                "within the requested window; refusing to produce an empty dataset."
            )
        return tuple(descriptors)

    def stream(
        self, descriptor: SourceFileDescriptor, request: IngestionRequest
    ) -> Iterator[SourceRecord]:
        path = self._root / descriptor.source_key
        raw_text = path.read_text(encoding="utf-8") if path.suffix != ".gz" else gzip.decompress(path.read_bytes()).decode("utf-8")
        line_number = 0
        for line in raw_text.splitlines():
            if not line.strip():
                continue
            line_number += 1
            parsed = line_to_event(
                line, line_number=line_number, partition_path=descriptor.source_key
            )
            raw = line if request.retain_raw else None
            yield SourceRecord(event=parsed.event, raw_text=raw)

    # -- helpers ------------------------------------------------------------------
    @staticmethod
    def _in_window(date: str, request: IngestionRequest) -> bool:
        day_start = int(datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp() * 1_000_000)
        day_end = day_start + 86_400_000_000 - 1
        return day_end >= request.start_micros and day_start <= request.end_micros

    def _symbol_for_venue(self, venue_symbol: str, request: IngestionRequest) -> str:
        # A file is claimed only under an explicit mapping or the canonical
        # de-separator rule. The earlier "default to the venue string itself"
        # made the lookup self-matching - every file matched every request -
        # which is exactly the silent mis-attribution this guard exists to
        # prevent, so there is now no fallback to be clever about.
        for symbol in request.symbols:
            mapped = self._venue_symbols.get(symbol)
            if mapped == venue_symbol or _canonical_to_venue(symbol) == venue_symbol:
                return symbol
        raise DatasetFormatError(
            f"File venue symbol {venue_symbol!r} matches none of the requested symbols; "
            "refusing to guess which instrument a partition describes."
        )


def _canonical_to_venue(symbol: str) -> str:
    return symbol.replace("-", "")
