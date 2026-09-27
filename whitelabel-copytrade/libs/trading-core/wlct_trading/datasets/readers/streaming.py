"""The streaming dataset reader.

A four-gigabyte dataset must be replayable on a laptop. That single sentence
decides the shape of everything below:

* partitions are read one chunk at a time - the caller's ``buffer_bytes`` is
  the only in-flight bound, and there is no code path that grows with file
  size;
* gzip decompresses incrementally through a ``zlib`` decompressobj, with a
  hard ceiling on expanded bytes (``_MAX_GZIP_EXPANSION`` times the recorded
  stored size): a file claiming to hold a 1 MiB partition is refused the
  moment its expansion exceeds the bound, because an unbounded decompression
  path is a denial of service even when the source "was only" 1 MiB;
* the multi-symbol merge is a heap over per-partition cursors whose key is
  ``(timestamp, kind rank, sequence, symbol, partition position)`` - the first
  three components are the Part 6 replay order itself, from
  :data:`~wlct_trading.backtest.dataset.EVENT_KIND_ORDER`, and the last two
  are *tie-breakers of total order*, defined here once: events equal on the
  Part 6 key are ordered by canonical symbol, then by the manifest's own
  partition order (itself derived from recorded data, never from filesystem
  enumeration). Two runs that read one manifest merge identically on any
  machine.

Range filtering prunes at the *partition* level using the manifest's recorded
first/last timestamps, then at the line level within open partitions. Events
outside the requested window are never yielded - the window is the contract,
and "silently replay data outside the requested range" is a bug class this
reader exists to make impossible rather than unlikely.

This reader validates nothing about market semantics - crossed books and
sequence holes are the validator's domain. What it does enforce is the
integrity of *its own* contract: manifest-vs-disk digests when asked, the
canonical schema version per line, and the ordering it promises.
"""

from __future__ import annotations

import hashlib
import heapq
import zlib
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Final

from wlct_trading.backtest.dataset import MarketEvent
from wlct_trading.datasets.manifest import DatasetFileEntry, DatasetManifest
from wlct_trading.datasets.schema import DatasetFormatError, line_to_event
from wlct_trading.datasets.storage.base import DatasetStorage
from wlct_trading.enums import MarketEventKind

__all__ = ["ReaderStats", "StreamingDatasetReader", "merge_sort_key"]

#: Compressed-to-expanded ratio a gzip partition may legitimately reach. JSON
#: market lines routinely compress 5-15x; 64x is generous enough that no real
#: capture trips it and low enough that a bomb dies after at most that factor
#: of the recorded size rather than unboundedly.
_MAX_GZIP_EXPANSION: Final = 64


def merge_sort_key(
    event: MarketEvent, *, symbol: str, partition_position: int
) -> tuple[int, int, int, str, int]:
    """The total order a merged multi-stream replay reads in.

    Public and exact because a *documented* tie-break rule has to be testable
    without reimplementing it: timestamp first, kind rank second, sequence
    third - all three inherited from Part 6's ``ordering_key`` - then symbol
    ascending, then manifest partition order. Reusing the Part 6 key rather
    than restating it means there is exactly one definition of replay order in
    the repository; a second one would eventually disagree with the first,
    and that disagreement would be the subtlest bug in the system.
    """
    return (*event.ordering_key, symbol, partition_position)


@dataclass(slots=True)
class ReaderStats:
    """What one streaming pass touched. Bounded, so it is cheap on a hot loop."""

    partitions_selected: int = 0
    partitions_skipped: int = 0
    partitions_read: int = 0
    bytes_read: int = 0
    events_yielded: int = 0
    events_out_of_range: int = 0

    def to_dict(self) -> dict[str, int]:
        return {
            "partitionsSelected": self.partitions_selected,
            "partitionsSkipped": self.partitions_skipped,
            "partitionsRead": self.partitions_read,
            "bytesRead": self.bytes_read,
            "eventsYielded": self.events_yielded,
            "eventsOutOfRange": self.events_out_of_range,
        }


@dataclass(slots=True)
class _PartitionCursor:
    """Per-partition streaming state: byte chunks -> lines -> events."""

    partition_path: str
    position: int
    symbol: str
    kind: MarketEventKind
    compression: str
    recorded_sha256: str
    recorded_bytes: int
    chunks: Iterator[bytes]
    hasher: "hashlib._Hash"
    decompressor: "zlib._Decompress" | None = None
    pending: bytearray = field(default_factory=bytearray, repr=False)
    decompressed_bytes: int = 0
    line_number: int = 0
    done: bool = False
    stream_exhausted: bool = False


class StreamingDatasetReader:
    """Merge a manifest's partitions into one ordered event stream.

    Construct, iterate :meth:`events`, read :attr:`stats`. The reader is
    single-pass: re-reading a dataset means a new reader, which is also what
    makes "did I mutate anything between passes?" impossible to hide inside a
    reused object.
    """

    def __init__(
        self,
        storage: DatasetStorage,
        manifest: DatasetManifest,
        *,
        start_micros: int | None = None,
        end_micros: int | None = None,
        kinds: tuple[MarketEventKind, ...] | None = None,
        symbols: tuple[str, ...] | None = None,
        buffer_bytes: int = 65_536,
        verify_checksums: bool = False,
    ) -> None:
        if buffer_bytes < 1_024 or buffer_bytes > 67_108_864:
            raise ValueError("buffer_bytes must sit between 1 KiB and 64 MiB.")
        if start_micros is not None and end_micros is not None and end_micros < start_micros:
            raise ValueError("Reader window end precedes its start.")
        self._storage = storage
        self._manifest = manifest
        self._start = start_micros if start_micros is not None else manifest.start_micros
        self._end = end_micros if end_micros is not None else manifest.end_micros
        self._kinds = frozenset(kinds) if kinds is not None else None
        self._symbols = frozenset(symbols) if symbols is not None else None
        self._buffer_bytes = buffer_bytes
        self._verify_checksums = verify_checksums
        self._stats = ReaderStats()
        self._heap: list[
            tuple[tuple[int, int, int, str, int], int, _PartitionCursor, MarketEvent]
        ] = []
        self._prepared = False
        self._closed = False

    @property
    def stats(self) -> ReaderStats:
        return self._stats

    @property
    def manifest(self) -> DatasetManifest:
        return self._manifest

    # -- selection ------------------------------------------------------------------
    def _selected_entries(self) -> list[tuple[int, DatasetFileEntry]]:
        """Manifest file entries in merge order, after window/kind/symbol pruning.

        The sort key is ``(symbol, kind, first timestamp, path)`` - a function
        of *recorded* data only, which is what makes the resulting positions a
        property of the dataset rather than of the machine reading it.
        """
        ordered = sorted(
            self._manifest.files,
            key=lambda entry: (
                entry.symbol,
                entry.kind.value,
                entry.first_timestamp_micros,
                entry.partition_path,
            ),
        )
        selected: list[tuple[int, DatasetFileEntry]] = []
        for entry in ordered:
            if self._kinds is not None and entry.kind not in self._kinds:
                self._stats.partitions_skipped += 1
                continue
            if self._symbols is not None and entry.symbol not in self._symbols:
                self._stats.partitions_skipped += 1
                continue
            if (
                entry.last_timestamp_micros < self._start
                or entry.first_timestamp_micros > self._end
            ):
                # Whole-day pruning straight from the manifest's recorded
                # window per file: no bytes are opened for a day that cannot
                # intersect the request.
                self._stats.partitions_skipped += 1
                continue
            selected.append((len(selected), entry))
            self._stats.partitions_selected += 1
        return selected

    def _prepare(self) -> None:
        if self._prepared:
            return
        self._prepared = True
        for position, entry in self._selected_entries():
            cursor = self._open_entry(entry, position)
            event = self._advance(cursor)
            if event is not None:
                heapq.heappush(
                    self._heap,
                    (
                        merge_sort_key(
                            event, symbol=cursor.symbol, partition_position=cursor.position
                        ),
                        position,
                        cursor,
                        event,
                    ),
                )

    def _open_entry(self, entry: DatasetFileEntry, position: int) -> _PartitionCursor:
        chunks = self._storage.open_partition(
            self._manifest.dataset_key, self._manifest.version, entry.partition_path
        )
        return _PartitionCursor(
            partition_path=entry.partition_path,
            position=position,
            symbol=entry.symbol,
            kind=entry.kind,
            compression=entry.compression,
            recorded_sha256=entry.sha256,
            recorded_bytes=entry.bytes,
            chunks=chunks,
            hasher=hashlib.sha256(),
        )

    # -- streaming -------------------------------------------------------------------
    def _raw_chunk(self, cursor: _PartitionCursor) -> bytes | None:
        """The next decompressed block, reading exactly one stored chunk per call."""
        for chunk in cursor.chunks:
            # The digest is over the *stored* bytes - the manifest recorded the
            # file as written, and integrity means the file, not its meaning.
            cursor.hasher.update(chunk)
            self._stats.bytes_read += len(chunk)
            if cursor.compression == "gzip":
                if cursor.decompressor is None:
                    cursor.decompressor = zlib.decompressobj(zlib.MAX_WBITS | 16)
                expanded: bytes = cursor.decompressor.decompress(chunk)
                cursor.decompressed_bytes += len(expanded)
                ceiling = max(
                    cursor.recorded_bytes * _MAX_GZIP_EXPANSION,
                    1_048_576,
                )
                if cursor.decompressed_bytes > ceiling:
                    raise DatasetFormatError(
                        f"Partition {cursor.partition_path} expanded past "
                        f"{ceiling} bytes from {cursor.recorded_bytes} stored "
                        "bytes. That is a decompression bomb, not a market capture."
                    )
                if not expanded:
                    # Header consumed with no output yet; pull another chunk
                    # instead of handing the caller a meaningless empty line.
                    continue
                return expanded
            return chunk
        if not cursor.stream_exhausted:
            cursor.stream_exhausted = True
            if cursor.decompressor is not None and not cursor.decompressor.eof:
                raise DatasetFormatError(
                    f"Partition {cursor.partition_path} ended mid-gzip-stream; the "
                    "file is truncated, and a replay that stopped 'successfully' at a "
                    "truncation is a wrong answer, not a partial one."
                )
            self._finish(cursor)
            cursor.done = True
        return None

    def _retire(self, cursor: _PartitionCursor) -> None:
        """End a partition deliberately, with the integrity check honoured.

        The chunk iteration here skips decompression: the remaining bytes
        are hashed for the digest, not parsed, because the partition's story
        is already over as far as this reader is concerned. Verification
        cost is one pass over bytes this call was going to leave unread
        otherwise - the only other option is to make ``verify_checksums``
        quietly mean "only when the window ends at EOF", which is not what
        anyone would sign up for.
        """
        cursor.done = True
        cursor.stream_exhausted = True
        if self._verify_checksums:
            for chunk in cursor.chunks:
                cursor.hasher.update(chunk)
        self._finish(cursor)

    def _finish(self, cursor: _PartitionCursor) -> None:
        if self._verify_checksums:
            computed = cursor.hasher.hexdigest()
            if computed != cursor.recorded_sha256:
                raise DatasetFormatError(
                    f"Partition {cursor.partition_path} digests to {computed}; the manifest "
                    f"records {cursor.recorded_sha256}. The bytes on disk are not the bytes "
                    "that were finalised - quarantine the version, do not replay it."
                )

    def _next_line(self, cursor: _PartitionCursor) -> str | None:
        """Return the next complete line, or None at end of stream.

        Lines split across chunk boundaries stay in ``pending`` and are
        joined without ever materialising more than one line plus one chunk -
        the bound the ``buffer_bytes`` knob promises. ``buffer_bytes`` is the
        *storage* chunk size; a single absurd line is still read to
        completion, which is a deliberate liveness trade-off: refusing a long
        legitimate line would corrupt data as silently as accepting a bomb.
        """
        while True:
            newline = cursor.pending.find(b"\n")
            if newline != -1:
                line = bytes(cursor.pending[: newline + 1]).decode("utf-8")
                del cursor.pending[: newline + 1]
                return line
            if cursor.done:
                if cursor.pending:
                    tail = bytes(cursor.pending).decode("utf-8")
                    cursor.pending.clear()
                    return tail + "\n"
                return None
            chunk = self._raw_chunk(cursor)
            if chunk is None:
                continue
            cursor.pending.extend(chunk)

    def _advance(self, cursor: _PartitionCursor) -> MarketEvent | None:
        """Pull the next in-window event from one partition, or retire it.

        A format error propagates with its partition and line number attached:
        a corrupt *finalised* file is corruption, and the reader is where it
        becomes visible. Rewriting, skipping or clamping the line here would
        be the silent repair this package forbids.
        """
        while True:
            line = self._next_line(cursor)
            if line is None:
                return None
            cursor.line_number += 1
            parsed = line_to_event(
                line,
                line_number=cursor.line_number,
                partition_path=cursor.partition_path,
            )
            event = parsed.event
            if event.timestamp_micros < self._start:
                self._stats.events_out_of_range += 1
                continue
            if event.timestamp_micros > self._end:
                # Past the window: retire the partition. Streams within a
                # partition are ordered by construction, so nothing later can
                # come back into range - but "retired" is not "verified":
                # _retire still drains the remainder when checksums are on,
                # or a reader that stopped at noon would certify an afternoon
                # it never read.
                self._retire(cursor)
                self._stats.events_out_of_range += 1
                return None
            return event

    # -- iteration --------------------------------------------------------------------
    def events(self) -> Iterator[MarketEvent]:
        """Yield the merged stream. No-look-ahead by construction.

        One event is materialised per partition (the heap heads), never a
        window of future data, so nothing here can hand a strategy an event it
        has not yet reached: the iterator returns exactly what the *smallest
        key* partition has next, and it pulls one line at a time to get it.
        """
        if self._closed:
            raise DatasetFormatError(
                "This reader is closed; a closed reader yielding an empty stream "
                "would turn a finished replay into a dataset that 'had no events'."
            )
        self._prepare()
        while self._heap:
            _, _, cursor, event = self._heap[0]
            replacement = self._advance(cursor)
            if replacement is None:
                heapq.heappop(self._heap)
                self._stats.partitions_read += 1
            else:
                heapq.heapreplace(
                    self._heap,
                    (
                        merge_sort_key(
                            replacement,
                            symbol=cursor.symbol,
                            partition_position=cursor.position,
                        ),
                        cursor.position,
                        cursor,
                        replacement,
                    ),
                )
            self._stats.events_yielded += 1
            yield event
        self._closed = True

    def __iter__(self) -> Iterator[MarketEvent]:
        return self.events()

    def close(self) -> None:
        """Release cursors. Iterating after ``close`` raises rather than
        yielding nothing: an empty replay that *looked* complete is the worst
        outcome this class could manufacture."""
        self._closed = True
        self._heap.clear()
