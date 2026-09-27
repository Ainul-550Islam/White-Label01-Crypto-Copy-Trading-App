"""The replay bridge: dataset version in, Part 6 ``HistoricalDataset`` out.

This module exists so the Part 6 engine never learns that persistence
happened. It is handed a ``HistoricalDataset`` - the same type an in-memory
test builds - built from streamed, checksummed, validated files. Everything
Part 6 guarantees about that type (total ordering, no look-ahead,
checksum-over-content reproducibility) is preserved by construction, because
the bridge *reuses* the guarantees instead of restating them:

* ordering comes from the streaming reader, whose merge key extends the Part 6
  ``ordering_key``;
* the descriptor is the manifest's own identity, so
  :attr:`~wlct_trading.backtest.dataset.DatasetDescriptor.is_reproducible`
  means exactly "this came from a finalised, checksummed version";
* materialisation is window-bounded with an explicit event ceiling: the engine
  is memory-resident today, and the honest answer at the boundary is a loud
  refusal - narrow the window - not an unbounded load that dies mid-replay.

The validity gate lives here too, and it is deliberately unglamorous: ask the
registry for the version, refuse unless the status says usable, and make any
override carry a written reason that lands in the descriptor's notes - the one
field every persisted result echoes back. "Backtests over quarantined data" is
a sentence that can only be written by somebody who chose the words
``override_reason``; nothing here reaches it by accident.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass

from wlct_trading.backtest.dataset import (
    DatasetError,
    HistoricalDataset,
    MarketEvent,
)
from wlct_trading.datasets.manifest import DatasetManifest
from wlct_trading.datasets.readers.streaming import StreamingDatasetReader
from wlct_trading.datasets.registry import DatasetRegistry, VersionRecord
from wlct_trading.datasets.storage.base import DatasetStorage
from wlct_trading.enums import DatasetStatus, ExchangeId, MarketEventKind
from wlct_trading.observability.tracing import SpanStatus, Tracer

__all__ = [
    "DatasetReplayBundle",
    "DatasetReplayError",
    "load_for_backtest",
    "stream_events",
    "status_is_valid",
]


class DatasetReplayError(DatasetError):
    """The dataset refused the replay, or failed the checks it was opened for."""


@dataclass(slots=True, frozen=True)
class DatasetReplayBundle:
    """Everything a backtest run needs to *say* what it replayed.

    ``dataset`` feeds the engine; ``manifest`` and ``version_record`` feed the
    result's provenance fields; ``reader_stats`` belong in operational logs,
    never in the canonical result - bytes-read is a fact about this machine,
    and the reproducibility contract says two machines agree on the market,
    not on the I/O.
    """

    dataset: HistoricalDataset
    manifest: DatasetManifest
    version_record: VersionRecord
    reader_stats: dict[str, int]

    @property
    def dataset_key(self) -> str:
        return self.manifest.dataset_key

    @property
    def version(self) -> int:
        return self.manifest.version

    @property
    def content_checksum(self) -> str:
        return self.manifest.content_checksum

    def descriptor_dataset_id(self) -> str:
        return self.manifest.descriptor_dataset_id()


def stream_events(
    storage: DatasetStorage,
    manifest: DatasetManifest,
    *,
    start_micros: int | None = None,
    end_micros: int | None = None,
    kinds: tuple[MarketEventKind, ...] | None = None,
    symbols: tuple[str, ...] | None = None,
    verify_checksums: bool = False,
    buffer_bytes: int = 65_536,
    tracer: Tracer | None = None,
) -> Iterator[MarketEvent]:
    """The raw streaming path for validators and re-hashers.

    Exists as a separate entry point from :func:`load_for_backtest` because
    *verification* of a huge dataset should not pay for materialisation it
    then throws away. The backtest path materialises; the audit path streams;
    both read through one reader, so their opinions of the bytes cannot
    differ.
    """
    reader = StreamingDatasetReader(
        storage,
        manifest,
        start_micros=start_micros,
        end_micros=end_micros,
        kinds=kinds,
        symbols=symbols,
        verify_checksums=verify_checksums,
        buffer_bytes=buffer_bytes,
    )
    if tracer is None:
        return reader.events()
    return _traced_stream(
        tracer,
        reader,
        manifest,
        verify_checksums=verify_checksums,
    )


def _traced_stream(
    tracer: Tracer,
    reader: StreamingDatasetReader,
    manifest: DatasetManifest,
    *,
    verify_checksums: bool,
) -> Iterator[MarketEvent]:
    """Stream a dataset inside one ``dataset.replay`` span.

    The span records that the integrity path ran (``verify_checksums`` is the
    boundary the replay contract enforces) and how much was consumed; it is
    ended on every exit path, including a stream the consumer abandoned.
    """
    span = tracer.start_span(
        "dataset.replay",
        attributes={
            "dataset.key": manifest.dataset_key,
            "dataset.version": manifest.version,
            "dataset.verify_checksums": "true" if verify_checksums else "false",
        },
    )
    count = 0
    outcome = "completed"
    try:
        for event in reader.events():
            count += 1
            yield event
    except Exception as exc:
        outcome = "error"
        span.record_exception(exc)
        span.set_status(SpanStatus.ERROR, description="dataset stream failed")
        raise
    finally:
        span.set_attribute("dataset.event_count", count)
        span.set_attribute("dataset.outcome", outcome)
        if outcome == "completed":
            span.set_status(SpanStatus.OK)
        span.end()


def load_for_backtest(
    registry: DatasetRegistry,
    dataset_key: str,
    *,
    symbol: str,
    version: int | None = None,
    start_micros: int | None = None,
    end_micros: int | None = None,
    kinds: tuple[MarketEventKind, ...] | None = None,
    exchange: ExchangeId | None = None,
    expected_checksum: str | None = None,
    max_events: int = 5_000_000,
    override_reason: str | None = None,
    buffer_bytes: int = 65_536,
) -> DatasetReplayBundle:
    """Open one dataset window as an engine-ready dataset.

    ``version=None`` selects the *latest VALID* version, which is a registry
    query, not a mutable pointer: the chosen version number is recorded in the
    dataset id of every result (``<key>@v<N>``) and folded into the
    configuration hash, so "latest" can be convenient once and wrong never -
    the result always says which version it meant, and a later re-run can pin
    it explicitly.
    """
    if max_events < 1:
        raise DatasetReplayError("max_events must be positive.")

    record: VersionRecord | None
    if version is None:
        record = registry.latest_valid(dataset_key)
    else:
        record = registry.record(dataset_key, version)
    if record is None:
        raise DatasetReplayError(
            f"No readable version of dataset {dataset_key}"
            + (f" v{version}" if version is not None else " at all")
            + "."
        )
    manifest = record.manifest

    if not record.usable_for_backtest:
        if override_reason is None or len(override_reason.strip()) < 5:
            raise DatasetReplayError(
                f"Dataset {dataset_key} v{manifest.version} has status "
                f"{record.status.value}; it is not usable for backtests. Re-running with a "
                "written override_reason is the only path, and the reason is recorded in "
                "the dataset identity of every result built from it."
            )
    if symbol not in manifest.symbols:
        raise DatasetReplayError(
            f"Dataset covers {sorted(manifest.symbols)}; {symbol!r} is not in it."
        )
    if exchange is not None and manifest.exchange is not exchange:
        raise DatasetReplayError(
            f"Requested exchange {exchange.value} but the dataset is "
            f"{manifest.exchange.value}; a venue mix is a loading bug, not a filter."
        )

    window_start, window_end = _resolve_window(manifest, start_micros, end_micros)
    if expected_checksum is not None and expected_checksum != manifest.content_checksum:
        raise DatasetReplayError(
            f"Caller expects checksum {expected_checksum} but {dataset_key} "
            f"v{manifest.version} carries {manifest.content_checksum}. Refusing to "
            "attribute a result to data it did not read."
        )

    storage = registry.storage
    reader = StreamingDatasetReader(
        storage,
        manifest,
        start_micros=window_start,
        end_micros=window_end,
        kinds=kinds,
        symbols=(symbol,),
        verify_checksums=False,
        buffer_bytes=buffer_bytes,
    )
    events: list[MarketEvent] = []
    for event in reader.events():
        events.append(event)
        if len(events) > max_events:
            raise DatasetReplayError(
                f"Window holds more than max_events ({max_events}) events; the engine "
                "would materialise it all. Narrow the window - replay determinism is not "
                "a memory guarantee this function will silently break."
            )
    if not events:
        raise DatasetReplayError(
            f"Dataset {dataset_key} v{manifest.version} has no {symbol} events inside "
            "the requested window; an empty replay that produced a 'clean' result is "
            "the failure mode this refuses."
        )

    dataset = HistoricalDataset.from_events(
        events,
        dataset_id=manifest.descriptor_dataset_id(),
        source=f"{manifest.identity.source_kind.value}:{manifest.identity.source_label}",
        granularity=manifest.identity.granularity,
        market_type=manifest.identity.market_type,
        notes=_descriptor_notes(manifest, record, window_start, window_end, override_reason),
    )
    if (
        window_start == manifest.start_micros
        and window_end == manifest.end_micros
        and kinds is None
        and dataset.descriptor.checksum is not None
        and dataset.descriptor.checksum != manifest.content_checksum
    ):
        raise DatasetReplayError(
            "Full-window materialisation does not reproduce the manifest content "
            "checksum; the files on disk are not the files that were finalised. "
            "Quarantine the version."
        )
    return DatasetReplayBundle(
        dataset=dataset,
        manifest=manifest,
        version_record=record,
        reader_stats=reader.stats.to_dict(),
    )


def _resolve_window(
    manifest: DatasetManifest,
    start_micros: int | None,
    end_micros: int | None,
) -> tuple[int, int]:
    lo = start_micros if start_micros is not None else manifest.start_micros
    hi = end_micros if end_micros is not None else manifest.end_micros
    if hi < lo:
        raise DatasetReplayError("Requested window end precedes its start.")
    if lo > manifest.end_micros or hi < manifest.start_micros:
        raise DatasetReplayError(
            f"Requested window [{lo}, {hi}] lies outside the dataset's recorded "
            f"[{manifest.start_micros}, {manifest.end_micros}]."
        )
    return lo, hi


def _descriptor_notes(
    manifest: DatasetManifest,
    record: VersionRecord,
    start_micros: int,
    end_micros: int,
    override_reason: str | None,
) -> str:
    parts = [
        f"dataset {manifest.dataset_key} v{manifest.version}",
        f"status {record.status.value}",
        f"completeness {manifest.completeness.value}",
        f"window [{start_micros}, {end_micros}]",
    ]
    if override_reason is not None:
        parts.append(f"REPLAY-OVERRIDE: {override_reason}")
    return "; ".join(parts)


def status_is_valid(status: DatasetStatus) -> bool:
    """One place that knows what "valid" means for replay purposes."""
    return status is DatasetStatus.VALID
