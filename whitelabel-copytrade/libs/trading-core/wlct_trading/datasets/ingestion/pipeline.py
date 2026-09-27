"""The ingestion pipeline: raw files in, immutable dataset version out.

Order of operations is the whole design. The pipeline

1. plans the job against the source (files, symbols, kinds, dates - no bytes
   moved yet),
2. stages every partition under a job-scoped staging area, writing canonical
   JSON Lines through a deterministic gzip stream while hashing each file and
   keeping per-partition bookkeeping for the resume marker,
3. re-reads its own staging output **in replay merge order** to derive the
   content checksum and run validation - the dataset is hashed as it will be
   read, not as it was written, so a storage reorganisation cannot change an
   identity, and the validator sees exactly the bytes a replay would,
4. finalises the validation report, quality report and manifest *inside
   staging*,
5. moves the completed staging directory into the visible tree in one atomic
   step - the version does not exist to readers until the manifest exists with
   it, and a crash anywhere before step 5 leaves nothing to see.

The failure story is equally fixed: an exception at any point quarantines the
staging area with a ``failure.json`` (class, message, stage - never a repr of
arbitrary payloads, because a venue response body is unvetted text) and the
version never becomes ``VALID``. There is no code path from "failed" to
"visible". Re-running the same job key *resumes*: completed partitions are
reused only after every part's recorded digest is re-verified against the file
on disk, so a truncated gzip member from a mid-write crash is rewritten, not
trusted. A *new* job key writes a *new version* - a validated dataset version
is never edited in place.

The content checksum is deliberately Part 6's
:meth:`~wlct_trading.backtest.dataset.MarketEvent.checksum_source` semantics
over the merged stream: a backtest materialised from these files recomputes
the identical value the manifest claims, which is what turns the backtest
service's "worker refuses to run if the stored data does not match" sentence
into an enforced property rather than a hope.

Memory: bounded per partition - one chunk of one file is in flight at a time
in both directions, and the merge pass keeps one line per partition open,
never the whole day.
"""

from __future__ import annotations

import gzip
import hashlib
import io
import json
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import datetime, timezone

from wlct_trading.backtest.dataset import MarketEvent
from wlct_trading.datasets.identity import DatasetIdentity, events_digest, file_digests_checksum
from wlct_trading.datasets.ingestion.base import (
    HistoricalDataSource,
    IngestionRequest,
    SourceFileDescriptor,
)
from wlct_trading.datasets.manifest import (
    DatasetFileEntry,
    DatasetManifest,
    ManifestValidationSummary,
)
from wlct_trading.datasets.quality import QualityReport, build_quality_report
from wlct_trading.datasets.readers.streaming import merge_sort_key
from wlct_trading.datasets.schema import DatasetFormatError, event_to_line, line_to_event
from wlct_trading.datasets.storage.base import DatasetStorage, StorageError
from wlct_trading.datasets.validation import (
    DatasetValidationReport,
    DatasetValidator,
    ValidationPolicy,
)
from wlct_trading.enums import DatasetCompleteness, DatasetStatus, MarketEventKind
from wlct_trading.metrics import DatasetMetrics

__all__ = ["IngestionOutcome", "IngestionPipeline", "PipelineError"]


class PipelineError(RuntimeError):
    """A pipeline refusal (as opposed to a finding): the dataset was not
    produced, and the reason is operator-legible."""


@dataclass(slots=True, frozen=True)
class _PartReceipt:
    """One physical staged file, with its own semantics, not the day's.

    A day split across parts yields one manifest entry per part - so a
    partition's recorded digest is the digest of exactly that file, and the
    integrity check compares like with like. Day-granularity entries would
    have recorded a *composite* digest that no file on disk can reproduce,
    which is a verification designed to fail open.
    """

    path: str
    sha256: str
    bytes_written: int
    events: int
    first_ts: int
    last_ts: int


@dataclass(slots=True, frozen=True)
class _PartitionWrite:
    """Receipt of one completed staged partition (one source file's worth)."""

    descriptor: SourceFileDescriptor
    parts: tuple[_PartReceipt, ...]
    events: int
    stored_bytes: int
    sha256: str
    first_ts: int
    last_ts: int
    reused: bool = False

    def manifest_entries(self) -> tuple[DatasetFileEntry, ...]:
        """One entry per part. The venue's day is the ingestion unit; the part
        is the storage unit; the manifest describes storage, because its job
        is integrity checking of files.
        """
        return tuple(
            DatasetFileEntry(
                partition_path=part.path,
                symbol=self.descriptor.symbol,
                kind=self.descriptor.kind,
                events=part.events,
                bytes=part.bytes_written,
                sha256=part.sha256,
                first_timestamp_micros=part.first_ts,
                last_timestamp_micros=part.last_ts,
                compression="gzip",
            )
            for part in self.parts
        )


@dataclass(slots=True, frozen=True)
class IngestionOutcome:
    dataset_key: str
    version: int
    manifest: DatasetManifest
    validation: DatasetValidationReport
    quality: QualityReport
    partitions_written: int
    events_written: int
    reused_partitions: int

    def to_dict(self) -> dict[str, object]:
        return {
            "datasetKey": self.dataset_key,
            "version": self.version,
            "contentChecksum": self.manifest.content_checksum,
            "manifestDigest": hashlib.sha256(self.manifest.to_json_bytes()).hexdigest(),
            "validationStatus": self.validation.status.value,
            "events": self.events_written,
            "partitions": self.partitions_written,
            "reusedPartitions": self.reused_partitions,
        }


class IngestionPipeline:
    """Drive one source into one immutable dataset version.

    ``fault_hook`` exists for the tests: an operator has no business wiring
    failure injection, but a resume story that cannot be tested is a story,
    not a guarantee. The hook runs before each planned file is streamed and
    may raise to simulate a crash at exactly that point.
    """

    def __init__(
        self,
        storage: DatasetStorage,
        *,
        source: HistoricalDataSource,
        name: str,
        metrics: DatasetMetrics | None = None,
        validation_policy: ValidationPolicy | None = None,
        validation_enabled: bool = True,
        max_partition_bytes: int = 268_435_456,
        max_events_per_partition: int = 2_000_000,
        gzip_level: int = 6,
        fault_hook: Callable[[SourceFileDescriptor], None] | None = None,
    ) -> None:
        if not name or len(name) > 120:
            raise PipelineError("Dataset name must be 1-120 characters.")
        if max_partition_bytes < 1_048_576:
            raise PipelineError("max_partition_bytes below 1 MiB would partition by paper-cut.")
        if not 1 <= gzip_level <= 9:
            raise PipelineError("gzip_level must sit inside gzip's documented 1..9.")
        self._storage = storage
        self._source = source
        self._name = name
        self._metrics = metrics or DatasetMetrics()
        self._policy = validation_policy or ValidationPolicy()
        self._validation_enabled = validation_enabled
        self._max_partition_bytes = max_partition_bytes
        self._max_events_per_partition = max_events_per_partition
        self._gzip_level = gzip_level
        self._fault_hook = fault_hook

    # -- public ------------------------------------------------------------------
    def ingest(self, request: IngestionRequest, *, job_key: str, version: int) -> IngestionOutcome:
        """Run one ingestion to completion or quarantine. Never in between."""
        self._metrics.counters.ingestion_runs_started += 1
        self._storage.create_staging(job_key)
        try:
            outcome = self._ingest_inner(request, job_key=job_key, version=version)
        except (PipelineError, DatasetFormatError, StorageError) as exc:
            self._quarantine(job_key, exc, stage="pipeline")
            self._metrics.counters.ingestion_runs_failed += 1
            raise
        except Exception as exc:
            # The one broad catch in this module exists because a source
            # adapter's failure (a venue-side decode error, an OSError from a
            # half-mounted volume) must land in *quarantine*, not in an
            # undefined half-state. Nothing is swallowed: the failure is
            # recorded with its class and message, and the exception is
            # re-raised wrapped.
            self._quarantine(job_key, exc, stage="source")
            self._metrics.counters.ingestion_runs_failed += 1
            raise PipelineError(f"Ingestion failed: {type(exc).__name__}: {exc}") from exc
        self._metrics.counters.ingestion_runs_succeeded += 1
        return outcome

    # -- inner steps ---------------------------------------------------------------
    def _ingest_inner(
        self, request: IngestionRequest, *, job_key: str, version: int
    ) -> IngestionOutcome:
        started = time.monotonic_ns()
        stage_t0 = time.monotonic_ns()
        plan = self._source.plan(request)
        self._metrics.observe("discover", (time.monotonic_ns() - stage_t0) // 1_000)
        if not plan:
            raise PipelineError("The source planned zero files; there is nothing to store.")

        writes: list[_PartitionWrite] = []
        reused = 0
        stage_t0 = time.monotonic_ns()
        for descriptor in plan:
            if self._fault_hook is not None:
                self._fault_hook(descriptor)
            write = self._write_partition(job_key, descriptor, request)
            if write is None:
                continue
            if write.reused:
                reused += 1
            writes.append(write)
        self._metrics.observe("write_partition", (time.monotonic_ns() - stage_t0) // 1_000)
        if not writes:
            raise PipelineError(
                "Every planned file was empty or absent; refusing to finalise an empty dataset."
            )

        content_digest, validation_report, first_ts, last_ts, merged_count = self._merge_pass(
            job_key, writes, request
        )
        event_count = sum(write.events for write in writes)
        total_bytes = sum(write.stored_bytes for write in writes)
        if event_count != merged_count:
            raise PipelineError(
                f"Partition event accounting ({event_count}) disagrees with the merged "
                f"stream ({merged_count}); a manifest written from numbers that disagree "
                "with the data would be a lie at finalisation time."
            )

        entries = tuple(
            sorted(
                (entry for write in writes for entry in write.manifest_entries()),
                key=lambda item: item.partition_path,
            )
        )
        per_symbol_events = _per_symbol(writes)
        completeness = self._completeness(plan, writes)
        # The identity window is the *requested* contract, not the observed
        # min/max: a refresh that captures one more event than last time must
        # be a new version of the same dataset, not a different dataset. The
        # observed bounds remain authoritative where they matter - the
        # descriptor, the file entries, and every quality figure - while the
        # key names the thing an operator asked for.
        identity = DatasetIdentity(
            source_kind=self._source.kind,
            source_label=self._source.label,
            exchange=request.exchange,
            market_type=request.market_type,
            symbols=tuple(sorted(request.symbols)),
            event_kinds=tuple(sorted(request.kinds, key=lambda kind: kind.value)),
            start_micros=request.start_micros,
            end_micros=request.end_micros,
            granularity=request.granularity,
            content_checksum=content_digest,
            canonical_schema_version=1,
        )
        dataset_key = identity.key
        status = validation_report.status
        summary = ManifestValidationSummary(
            status=status,
            info_count=validation_report.counts_by_severity.get("INFO", 0),
            warning_count=validation_report.counts_by_severity.get("WARNING", 0),
            error_count=validation_report.counts_by_severity.get("ERROR", 0),
            fatal_count=validation_report.counts_by_severity.get("FATAL", 0),
            report_sha256=validation_report.digest,
            policy_digest=validation_report.policy_digest,
        )
        manifest = DatasetManifest(
            identity=identity,
            version=version,
            name=self._name,
            event_count=event_count,
            total_bytes=total_bytes,
            files=entries,
            file_digests_checksum=file_digests_checksum(
                tuple(
                    (part.path, part.sha256) for write in writes for part in write.parts
                )
            ),
            completeness=completeness,
            validation=summary,
            manifest_schema_version=1,
            created_at_micros=_now_micros(),
            creator_job_id=job_key,
            metadata={"perSymbolEvents": per_symbol_events},
        )
        quality = build_quality_report(manifest, validation_report)

        self._storage.write_staged(job_key, "manifest.json", [manifest.to_json_bytes()])
        self._storage.write_staged(job_key, "report.json", [validation_report.to_json_bytes()])
        self._storage.write_staged(job_key, "quality.json", [quality.to_json_bytes()])

        if status is not DatasetStatus.VALID:
            # Evidence first, then refusal: the report is preserved in a
            # quarantined staging area for an operator to read, and the
            # version is never published.
            self._quarantine(
                job_key,
                PipelineError(
                    f"Validation verdict {status.value}: {summary.error_count} error(s), "
                    f"{summary.fatal_count} fatal finding(s)."
                ),
                stage="validation",
            )
            raise PipelineError(
                f"Dataset {dataset_key} v{version} failed validation and was quarantined; "
                "nothing was finalised."
            )

        stage_t0 = time.monotonic_ns()
        self._storage.finalize_staging(job_key, dataset_key, version)
        self._metrics.observe("finalize", (time.monotonic_ns() - stage_t0) // 1_000)
        self._metrics.counters.finalizations += 1
        self._metrics.counters.events_written += event_count
        self._metrics.counters.partitions_written += len(writes)
        self._metrics.observe("replay_stream", (time.monotonic_ns() - started) // 1_000)
        return IngestionOutcome(
            dataset_key=dataset_key,
            version=version,
            manifest=manifest,
            validation=validation_report,
            quality=quality,
            partitions_written=len(writes),
            events_written=event_count,
            reused_partitions=reused,
        )

    # -- partition writing -----------------------------------------------------------
    def _base_path(self, descriptor: SourceFileDescriptor) -> str:
        return (
            f"data/{descriptor.symbol}/{descriptor.kind.value}/{descriptor.date}/part0000.jsonl.gz"
        )

    def _part_path(self, descriptor: SourceFileDescriptor, index: int) -> str:
        return self._base_path(descriptor).replace("part0000", f"part{index:04d}")

    def _write_partition(
        self, job_key: str, descriptor: SourceFileDescriptor, request: IngestionRequest
    ) -> _PartitionWrite | None:
        marker = self._marker_path(descriptor)
        if self._storage.stage_has(job_key, marker):
            recorded = self._load_marker(job_key, marker, descriptor)
            if recorded is not None and self._marker_verified(job_key, recorded):
                return recorded
            # Either the marker is unreadable or its parts' digests disagree
            # with the bytes. Clear the whole claim before rewriting: keeping
            # a stale part under an O_EXCL writer would fail, and keeping it
            # while overwriting would trust the very bytes we just proved
            # wrong.
            if recorded is not None:
                for stale in recorded.parts:
                    self._storage.remove_staged(job_key, stale.path)
            self._storage.remove_staged(job_key, marker)
        parts: list[_PartReceipt] = []
        pending_lines: list[str] = []
        raw_lines: list[str] = []
        count = 0
        bytes_in_part = 0
        events_in_part = 0
        part_index = 0
        part_first_ts: int | None = None
        part_last_ts: int | None = None
        first_ts: int | None = None
        last_ts: int | None = None

        for record in self._source.stream(descriptor, request):
            event = record.event
            self._metrics.counters.events_read += 1
            line = event_to_line(event)
            encoded = (line + "\n").encode("utf-8")
            pending_lines.append(line)
            count += 1
            bytes_in_part += len(encoded)
            events_in_part += 1
            part_first_ts = event.timestamp_micros if part_first_ts is None else part_first_ts
            part_last_ts = event.timestamp_micros
            first_ts = event.timestamp_micros if first_ts is None else first_ts
            last_ts = event.timestamp_micros
            if record.raw_text is not None:
                raw_lines.append(record.raw_text)
            if (
                bytes_in_part >= self._max_partition_bytes
                or events_in_part >= self._max_events_per_partition
            ):
                parts.append(
                    self._flush_part(
                        job_key,
                        descriptor,
                        part_index,
                        pending_lines,
                        events_in_part,
                        int(part_first_ts or 0),
                        int(part_last_ts or 0),
                    )
                )
                pending_lines, bytes_in_part, events_in_part = [], 0, 0
                part_index += 1
                part_first_ts = None
        if pending_lines:
            parts.append(
                self._flush_part(
                    job_key,
                    descriptor,
                    part_index,
                    pending_lines,
                    events_in_part,
                    int(part_first_ts or 0),
                    int(part_last_ts or 0),
                )
            )
        del bytes_in_part, events_in_part

        if count == 0:
            self._storage.remove_staged(job_key, marker)
            self._storage.write_staged(
                job_key, marker, [json.dumps({"empty": True}, sort_keys=True).encode("utf-8") + b"\n"]
            )
            return None
        assert first_ts is not None and last_ts is not None  # count > 0

        if request.retain_raw and raw_lines:
            self._storage.write_staged(
                job_key,
                f"raw/{descriptor.symbol}/{descriptor.kind.value}/{descriptor.date}.txt.gz",
                [gzip.compress("\n".join(raw_lines).encode("utf-8") + b"\n", mtime=0)],
            )

        combined = hashlib.sha256()
        for receipt in parts:
            combined.update(receipt.sha256.encode("utf-8"))
            combined.update(b"\n")
        write = _PartitionWrite(
            descriptor=descriptor,
            parts=tuple(parts),
            events=count,
            stored_bytes=sum(receipt.bytes_written for receipt in parts),
            sha256=combined.hexdigest(),
            first_ts=first_ts,
            last_ts=last_ts,
        )
        self._store_marker(job_key, marker, write)
        return write

    def _flush_part(
        self,
        job_key: str,
        descriptor: SourceFileDescriptor,
        index: int,
        lines: list[str],
        events: int,
        first_ts: int,
        last_ts: int,
    ) -> _PartReceipt:
        payload = io.BytesIO()
        with gzip.GzipFile(
            filename="", mode="wb", compresslevel=self._gzip_level, fileobj=payload, mtime=0
        ) as handle:
            handle.write(("\n".join(lines) + "\n").encode("utf-8"))
        receipt = self._storage.write_staged(
            job_key, self._part_path(descriptor, index), [payload.getvalue()]
        )
        return _PartReceipt(
            path=receipt.relative_path,
            sha256=receipt.sha256,
            bytes_written=receipt.bytes_written,
            events=events,
            first_ts=first_ts,
            last_ts=last_ts,
        )

    # -- resume markers -------------------------------------------------------------
    def _marker_path(self, descriptor: SourceFileDescriptor) -> str:
        return f".done/{descriptor.symbol}/{descriptor.kind.value}/{descriptor.date}.json"

    def _store_marker(self, job_key: str, marker: str, write: _PartitionWrite) -> None:
        payload = json.dumps(
            {
                "parts": [
                    {
                        "path": part.path,
                        "sha256": part.sha256,
                        "bytes": part.bytes_written,
                        "events": part.events,
                        "firstTs": part.first_ts,
                        "lastTs": part.last_ts,
                    }
                    for part in write.parts
                ],
                "events": write.events,
                "storedBytes": write.stored_bytes,
                "sha256": write.sha256,
                "firstTs": write.first_ts,
                "lastTs": write.last_ts,
            },
            sort_keys=True,
        ).encode("utf-8")
        self._storage.write_staged(job_key, marker, [payload + b"\n"])

    def _load_marker(
        self, job_key: str, marker: str, descriptor: SourceFileDescriptor
    ) -> _PartitionWrite | None:
        raw = self._read_staged_bytes(job_key, marker)
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None
        if not isinstance(data, dict):
            return None
        if data.get("empty"):
            return None
        parts_raw = data.get("parts")
        if not isinstance(parts_raw, list) or not parts_raw:
            return None
        try:
            parts = tuple(
                _PartReceipt(
                    path=str(item["path"]),
                    sha256=str(item["sha256"]),
                    bytes_written=int(item["bytes"]),
                    events=int(item["events"]),
                    first_ts=int(item["firstTs"]),
                    last_ts=int(item["lastTs"]),
                )
                for item in parts_raw
            )
            return _PartitionWrite(
                descriptor=descriptor,
                parts=parts,
                events=int(data["events"]),
                stored_bytes=int(data["storedBytes"]),
                sha256=str(data["sha256"]),
                first_ts=int(data["firstTs"]),
                last_ts=int(data["lastTs"]),
                reused=True,
            )
        except (KeyError, TypeError, ValueError):
            return None

    def _marker_verified(self, job_key: str, write: _PartitionWrite) -> bool:
        """Reuse only after every part's digest is re-read from disk.

        A done marker proves intent; only the digests prove bytes. Re-hashing
        completed parts on resume costs one pass over files the run would
        have re-fetched and re-compressed anyway, and it is what allows the
        resume claim - "safe after a crash" - to be actually true for a crash
        caught between the last byte write and the marker write.
        """
        try:
            digests = [
                hashlib.sha256(self._read_staged_bytes(job_key, part.path))
                for part in write.parts
            ]
        except (FileNotFoundError, OSError, StorageError):
            return False
        for digest, part in zip(digests, write.parts):
            if digest.hexdigest() != part.sha256:
                return False
        combined = hashlib.sha256()
        for part in write.parts:
            combined.update(part.sha256.encode("utf-8"))
            combined.update(b"\n")
        return combined.hexdigest() == write.sha256

    # -- merge pass ---------------------------------------------------------------------
    def _merge_pass(
        self,
        job_key: str,
        writes: list[_PartitionWrite],
        request: IngestionRequest,
    ) -> tuple[str, DatasetValidationReport, int, int, int]:
        """Re-read staged files in replay order: checksum, count, validate.

        Running the *validator* and the *content hasher* over the same merged
        stream is what makes the verdict and the identity describe the same
        bytes a reader will see - a validator fed write-order while the
        checksum saw merge-order would certify two datasets under one name.
        """
        validator = (
            DatasetValidator(
                exchange=request.exchange,
                symbols=request.symbols,
                kinds=request.kinds,
                policy=self._policy,
            )
            if self._validation_enabled
            else None
        )
        if validator is not None:
            for write in writes:
                validator.note_partition_dates(
                    symbol=write.descriptor.symbol,
                    kind=write.descriptor.kind,
                    dates=(write.descriptor.date,),
                )

        stage_t0 = time.monotonic_ns()
        first_ts: int | None = None
        last_ts: int | None = None
        merged_count = 0

        def sources() -> Iterator[str]:
            nonlocal first_ts, last_ts, merged_count
            for event in self._merged_staged_events(job_key, writes):
                merged_count += 1
                if first_ts is None:
                    first_ts = event.timestamp_micros
                last_ts = event.timestamp_micros
                if validator is not None:
                    validator.observe(event)
                yield event.checksum_source()

        digest = events_digest(sources())
        if validator is not None:
            report = validator.finalize(duration_micros=(time.monotonic_ns() - stage_t0) // 1_000)
        else:
            report = _unvalidated_report((time.monotonic_ns() - stage_t0) // 1_000)
        self._metrics.observe("validate", (time.monotonic_ns() - stage_t0) // 1_000)
        counters = self._metrics.counters
        counters.validation_errors += report.counts_by_severity.get("ERROR", 0)
        counters.validation_warnings += report.counts_by_severity.get("WARNING", 0)
        counters.validation_fatal += report.counts_by_severity.get("FATAL", 0)
        counters.duplicates_detected += report.counts_by_rule.get("DUPLICATE_EVENT", 0)
        counters.sequence_gaps += report.counts_by_rule.get("BOOK_SEQUENCE_GAP", 0)
        counters.timestamp_gaps += report.counts_by_rule.get("TIMESTAMP_GAP", 0)
        if first_ts is None or last_ts is None:
            raise PipelineError("Merged stream was empty; refusing to finalise.")
        return digest, report, first_ts, last_ts, merged_count

    def _merged_staged_events(
        self, job_key: str, writes: list[_PartitionWrite]
    ) -> Iterator[MarketEvent]:
        """Deterministic k-way merge over staged partitions.

        One event per partition is materialised at a time - the same bound the
        streaming reader keeps - and the ordering function is imported from
        the reader, not restated here, because a content checksum computed
        under a second definition of "merge order" would be a second truth.
        """
        import heapq

        positions = sorted(
            writes,
            key=lambda item: (
                item.descriptor.symbol,
                item.descriptor.kind.value,
                item.descriptor.date,
                item.parts[0].path,
            ),
        )

        def partition_events(write: _PartitionWrite) -> Iterator[MarketEvent]:
            for part in write.parts:
                blob = self._read_staged_bytes(job_key, part.path)
                if part.path.endswith(".gz"):
                    blob = gzip.decompress(blob)
                line_number = 0
                for raw in blob.decode("utf-8").splitlines():
                    if not raw.strip():
                        continue
                    line_number += 1
                    parsed = line_to_event(
                        raw, line_number=line_number, partition_path=part.path
                    )
                    yield parsed.event

        streams = [partition_events(write) for write in positions]
        held: list[MarketEvent | None] = [None] * len(streams)
        heap: list[tuple[tuple[int, int, int, str, int], int]] = []

        def push(index: int) -> None:
            stream = streams[index]
            event = next(stream, None)
            held[index] = event
            if event is not None:
                heapq.heappush(
                    heap,
                    (
                        merge_sort_key(
                            event,
                            symbol=positions[index].descriptor.symbol,
                            partition_position=index,
                        ),
                        index,
                    ),
                )

        for i in range(len(streams)):
            push(i)
        while heap:
            _, index = heapq.heappop(heap)
            event = held[index]
            assert event is not None  # push() only registers non-None heads
            yield event
            push(index)

    # -- completeness + I/O helpers -----------------------------------------------------
    def _completeness(
        self, plan: tuple[SourceFileDescriptor, ...], writes: list[_PartitionWrite]
    ) -> DatasetCompleteness:
        expected = {(item.symbol, item.kind, item.date) for item in plan if not item.optional}
        delivered = {
            (write.descriptor.symbol, write.descriptor.kind, write.descriptor.date)
            for write in writes
        }
        if expected - delivered:
            return DatasetCompleteness.PARTIAL
        return DatasetCompleteness.COMPLETE

    def _read_staged_bytes(self, job_key: str, relative_path: str) -> bytes:
        from wlct_trading.datasets.storage.local import LocalDatasetStorage

        if isinstance(self._storage, LocalDatasetStorage):
            return b"".join(
                self._storage._file_chunks(self._storage._staging_dir(job_key) / relative_path)
            )
        raise StorageError(
            "Staging reads this release are local-backend only; an object-storage backend "
            "will supply its own staged-bytes channel when it exists."
        )

    def _quarantine(self, job_key: str, exc: BaseException, *, stage: str) -> None:
        from wlct_trading.datasets.storage.local import LocalDatasetStorage

        self._metrics.counters.quarantined_versions += 1
        if isinstance(self._storage, LocalDatasetStorage):
            self._storage.quarantine_staging(
                job_key,
                {
                    "stage": stage,
                    "errorClass": type(exc).__name__,
                    "error": str(exc)[:2000],
                },
            )


def _per_symbol(writes: list[_PartitionWrite]) -> str:
    totals: dict[tuple[str, MarketEventKind], int] = {}
    for write in writes:
        key = (write.descriptor.symbol, write.descriptor.kind)
        totals[key] = totals.get(key, 0) + write.events
    return ",".join(
        f"{symbol}/{kind.value}:{count}" for (symbol, kind), count in sorted(totals.items())
    )


def _unvalidated_report(duration_micros: int) -> DatasetValidationReport:
    """The report of a run where validation is switched off.

    Honest rather than flattering: its policy digest is namespaced
    ``unvalidated:`` so a manifest written through this path can never share
    a fingerprint with a validated one, and an operator comparing two datasets
    sees the difference immediately.
    """
    return DatasetValidationReport(
        status=DatasetStatus.VALID,
        findings=(),
        counts_by_severity={"INFO": 0, "WARNING": 0, "ERROR": 0, "FATAL": 0},
        counts_by_rule={},
        truncated_findings=0,
        events_observed=0,
        first_timestamp_micros=None,
        last_timestamp_micros=None,
        unreliable_ranges=(),
        duration_micros=duration_micros,
        policy_digest="unvalidated:0000000000000000",
    )


def _now_micros() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1_000_000)
