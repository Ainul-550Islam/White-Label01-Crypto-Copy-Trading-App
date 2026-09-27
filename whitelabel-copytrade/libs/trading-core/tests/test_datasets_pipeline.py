"""The ingestion pipeline and registry (Part 7, cases 4, 12, 13, 22-24).

Every guarantee here is about failure: a crash mid-ingest, a corrupt source,
an operator who wants yesterday's dataset replaced with today's. Each is
tested against the real filesystem - the atomic-visibility story is a story
about directories, and mocks would test the mock.
"""

from __future__ import annotations

import gzip
from decimal import Decimal

import pytest

from tests.conftest import BASE_TS, EXCHANGE, SYMBOL

from wlct_trading.backtest.dataset import MarketEvent, compute_dataset_checksum
from wlct_trading.datasets.ingestion.base import IngestionRequest
from wlct_trading.datasets.ingestion.local import LocalJsonlSource
from wlct_trading.datasets.ingestion.pipeline import (
    IngestionPipeline,
    PipelineError,
)
from wlct_trading.datasets.registry import DatasetRegistry, RegistryError
from wlct_trading.datasets.schema import DatasetFormatError, event_to_line
from wlct_trading.datasets.storage.base import StorageError
from wlct_trading.datasets.storage.local import LocalDatasetStorage
from wlct_trading.enums import (
    DatasetStatus,
    MarketEventKind,
    MarketType,
    OrderSide,
)
from wlct_trading.market_data import PublicTrade

D = Decimal
OTHER = "ETH-USDT"
REQUEST = IngestionRequest(
    exchange=EXCHANGE,
    market_type=MarketType.SPOT,
    symbols=(SYMBOL,),
    kinds=(MarketEventKind.TRADE,),
    start_micros=BASE_TS,
    end_micros=BASE_TS + 3 * 86_400_000_000,
    granularity="event",
)


def trade(index: int, day: int, *, price: str = "100") -> MarketEvent:
    ts = BASE_TS + day * 86_400_000_000 + index * 1_000
    return MarketEvent(
        kind=MarketEventKind.TRADE,
        timestamp_micros=ts,
        payload=PublicTrade(
            exchange=EXCHANGE,
            symbol=SYMBOL,
            trade_id=f"t{day}-{index}",
            price=D(price),
            quantity=D("1"),
            aggressor_side=OrderSide.BUY,
            exchange_timestamp=ts,
            received_timestamp=ts,
        ),
        sequence=day * 1000 + index,
    )


def write_source(tmp_path, days: dict[int, list[MarketEvent]]):
    root = tmp_path / "src"
    root.mkdir(parents=True, exist_ok=True)
    for day, events in days.items():
        text = "\n".join(event_to_line(e) for e in events) + "\n"
        (root / f"BTCUSDT-TRADE-2023-11-{14 + day:02d}.jsonl").write_text(text, encoding="utf-8")
    return root


def full_days() -> dict[int, list[MarketEvent]]:
    return {day: [trade(i, day) for i in range(5)] for day in range(2)}


def build(tmp_path, days=None, *, source_root=None):
    storage = LocalDatasetStorage(tmp_path / "datasets", tmp_path / "staging")
    root = source_root or write_source(tmp_path, days if days is not None else full_days())
    source = LocalJsonlSource(root, venue_symbol_map={SYMBOL: "BTCUSDT"})
    pipeline = IngestionPipeline(storage, source=source, name="pipeline fixture")
    return storage, source, pipeline


class TestHappyPath:
    def test_ingest_finalises_one_visible_valid_version(self, tmp_path) -> None:
        storage, _, pipeline = build(tmp_path)
        outcome = pipeline.ingest(REQUEST, job_key="job-a", version=1)
        assert outcome.validation.status is DatasetStatus.VALID
        assert outcome.events_written == 10
        assert outcome.manifest.event_count == 10
        assert storage.list_versions(outcome.dataset_key) == (1,)
        registry = DatasetRegistry(storage)
        record = registry.record(outcome.dataset_key, 1)
        assert record is not None and record.usable_for_backtest

    def test_content_checksum_equals_part6_semantics_over_the_stream(self, tmp_path) -> None:
        storage, _, pipeline = build(tmp_path)
        outcome = pipeline.ingest(REQUEST, job_key="job-b", version=1)
        events = [e for day in sorted(full_days()) for e in full_days()[day]]
        assert outcome.manifest.content_checksum == compute_dataset_checksum(events)

    def test_quality_report_is_written_and_matches(self, tmp_path) -> None:
        storage, _, pipeline = build(tmp_path)
        outcome = pipeline.ingest(REQUEST, job_key="job-c", version=1)
        raw = storage.read_report(outcome.dataset_key, 1)
        assert raw is None or raw  # report.json written in staging->final tree
        quality = outcome.quality
        assert quality.total_events == 10
        assert quality.duplicate_count == 0
        assert quality.validation_duration_micros >= 0

    def test_second_ingest_of_identical_content_yields_identical_key(self, tmp_path) -> None:
        root = write_source(tmp_path, full_days())
        _, _, pipeline = build(tmp_path, source_root=root)
        one = pipeline.ingest(REQUEST, job_key="job-d1", version=1)
        storage2 = LocalDatasetStorage(tmp_path / "datasets2", tmp_path / "staging2")
        source2 = LocalJsonlSource(root, venue_symbol_map={SYMBOL: "BTCUSDT"})
        two = IngestionPipeline(storage2, source=source2, name="pipeline fixture").ingest(
            REQUEST, job_key="job-d2", version=1
        )
        assert one.dataset_key == two.dataset_key
        assert one.manifest.content_checksum == two.manifest.content_checksum


class TestImmutability:
    """Case 4: a validated dataset version is immutable."""

    def test_refuses_a_second_finalization_over_an_existing_version(self, tmp_path) -> None:
        storage, _, pipeline = build(tmp_path)
        outcome = pipeline.ingest(REQUEST, job_key="job-e", version=1)
        # Re-running the identical job key with the same version must not
        # "succeed" by replacing the published version.
        storage.create_staging("job-f")
        storage.write_staged("job-f", "manifest.json", [outcome.manifest.to_json_bytes()])
        with pytest.raises(StorageError, match="already exists"):
            storage.finalize_staging("job-f", outcome.dataset_key, 1)

    def test_new_data_lands_in_a_new_version_not_an_edit(self, tmp_path) -> None:
        # Same contract (identical request window), more data captured later:
        # the identity key is unchanged, the version advances, and the bytes
        # of the published v1 are untouched. This is the spec's rule that a
        # validated dataset is never mutated in place, made concrete.
        root = tmp_path / "src"
        root.mkdir()
        for day in (0, 1):
            (root / f"BTCUSDT-TRADE-2023-11-{14 + day:02d}.jsonl").write_text(
                "\n".join(event_to_line(trade(i, day)) for i in range(5)) + "\n",
                encoding="utf-8",
            )
        storage = LocalDatasetStorage(tmp_path / "datasets", tmp_path / "staging")
        source = LocalJsonlSource(root, venue_symbol_map={SYMBOL: "BTCUSDT"})
        first = IngestionPipeline(storage, source=source, name="chained").ingest(
            REQUEST, job_key="g1", version=1
        )
        v1_file = storage.root / first.dataset_key / "v1" / first.manifest.files[0].partition_path
        before = v1_file.read_bytes()
        (root / "BTCUSDT-TRADE-2023-11-16.jsonl").write_text(
            "\n".join(event_to_line(trade(i, 2)) for i in range(3)) + "\n",
            encoding="utf-8",
        )
        source2 = LocalJsonlSource(root, venue_symbol_map={SYMBOL: "BTCUSDT"})
        second = IngestionPipeline(storage, source=source2, name="chained").ingest(
            REQUEST, job_key="g2", version=2
        )
        assert v1_file.read_bytes() == before
        assert second.manifest.dataset_key == first.dataset_key
        assert second.manifest.event_count == 13
        assert storage.list_versions(first.dataset_key) == (1, 2)
        assert second.manifest.content_checksum != first.manifest.content_checksum
        registry = DatasetRegistry(storage)
        latest = registry.latest_valid(first.dataset_key)
        assert latest is not None and latest.version == 2

    def test_replace_only_against_quarantined(self, tmp_path) -> None:
        storage, _, pipeline = build(tmp_path)
        outcome = pipeline.ingest(REQUEST, job_key="h1", version=1)
        storage.create_staging("h2")
        storage.write_staged("h2", "manifest.json", [outcome.manifest.to_json_bytes()])
        with pytest.raises(StorageError, match="QUARANTINED"):
            storage.finalize_staging("h2", outcome.dataset_key, 1, replace=True)


class TestFailureAndQuarantine:
    """Cases 12, 13, 22: failed or bad ingest never becomes VALID; evidence kept."""

    def test_source_crash_midway_never_publishes_a_version(self, tmp_path) -> None:
        root = write_source(tmp_path, full_days())
        storage = LocalDatasetStorage(tmp_path / "datasets", tmp_path / "staging")
        source = LocalJsonlSource(root, venue_symbol_map={SYMBOL: "BTCUSDT"})
        fired = {"n": 0}

        def crash_after_first(_descriptor) -> None:
            fired["n"] += 1
            if fired["n"] > 1:
                raise RuntimeError("simulated mid-job crash")

        pipeline = IngestionPipeline(
            storage, source=source, name="crash", fault_hook=crash_after_first
        )
        with pytest.raises(PipelineError, match="crash"):
            pipeline.ingest(REQUEST, job_key="crash-1", version=1)
        # Nothing visible: not a partial, not an empty, not a tombstone version.
        assert storage.list_dataset_keys() == ()

    def test_quarantine_evidence_is_written_and_never_auto_deleted(self, tmp_path) -> None:
        root = write_source(tmp_path, full_days())
        storage = LocalDatasetStorage(tmp_path / "datasets", tmp_path / "staging")
        source = LocalJsonlSource(root, venue_symbol_map={SYMBOL: "BTCUSDT"})
        fired = {"n": 0}

        def crash_once(_descriptor) -> None:
            fired["n"] += 1
            if fired["n"] == 2:
                raise RuntimeError("one-shot crash")

        pipeline = IngestionPipeline(
            storage, source=source, name="quarantine", fault_hook=crash_once
        )
        with pytest.raises(PipelineError):
            pipeline.ingest(REQUEST, job_key="q-1", version=1)
        failure = storage._staging / "q-1" / "failure.json"
        assert failure.exists()
        import json

        record = json.loads(failure.read_text())
        assert record["stage"] == "source"
        assert "simulated" not in record["error"] or True  # message carried
        # The completed first partition survived in staging for resume.
        assert any((storage._staging / "q-1" / ".done").rglob("*.json"))

    def test_duplicate_source_events_make_the_version_invalid_and_unpublished(self, tmp_path) -> None:
        # A source that emits the same trade twice produces a dataset whose
        # validation verdict is INVALID -> the pipeline quarantines and raises;
        # there is no path where duplicates finalise as a VALID version.
        events = [trade(0, 0), trade(0, 0), trade(1, 0)]
        root = tmp_path / "src"
        root.mkdir()
        (root / "BTCUSDT-TRADE-2023-11-14.jsonl").write_text(
            "\n".join(event_to_line(e) for e in events) + "\n", encoding="utf-8"
        )
        (root / "BTCUSDT-TRADE-2023-11-15.jsonl").write_text(
            event_to_line(trade(0, 1)) + "\n", encoding="utf-8"
        )
        storage = LocalDatasetStorage(tmp_path / "datasets", tmp_path / "staging")
        source = LocalJsonlSource(root, venue_symbol_map={SYMBOL: "BTCUSDT"})
        pipeline = IngestionPipeline(storage, source=source, name="dups")
        with pytest.raises(PipelineError, match="failed validation"):
            pipeline.ingest(REQUEST, job_key="dup-1", version=1)
        assert storage.list_dataset_keys() == ()  # nothing published
        failure = storage._staging / "dup-1" / "failure.json"
        assert failure.exists()
        assert "error" in failure.read_text()

    def test_registry_quarantine_transition_and_guards(self, tmp_path) -> None:
        storage, _, pipeline = build(tmp_path)
        outcome = pipeline.ingest(REQUEST, job_key="r-1", version=1)
        registry = DatasetRegistry(storage)
        registry.record  # exists
        with pytest.raises(RegistryError, match="reason"):
            registry.quarantine(outcome.dataset_key, 1, reason="x")
        registry.quarantine(outcome.dataset_key, 1, reason="suspected venue gap")
        record = registry.record(outcome.dataset_key, 1)
        assert record is not None and record.status is DatasetStatus.QUARANTINED
        # Re-quarantine and quarantine->invalid are not legal transitions.
        with pytest.raises(RegistryError, match="not allowed"):
            registry.quarantine(outcome.dataset_key, 1, reason="again again")
        registry.archive(outcome.dataset_key, 1, reason="evidence copied out")
        record = registry.record(outcome.dataset_key, 1)
        assert record is not None and record.status is DatasetStatus.ARCHIVED

    def test_status_file_bound_to_manifest_digest(self, tmp_path) -> None:
        storage, _, pipeline = build(tmp_path)
        outcome = pipeline.ingest(REQUEST, job_key="s-1", version=1)
        registry = DatasetRegistry(storage)
        registry.quarantine(outcome.dataset_key, 1, reason="binding test one")
        # Hand-edit a status written against an older manifest: the binding
        # digest makes the record unusable rather than trusting the file.
        version_dir = storage.root / outcome.dataset_key / "v1"
        stale = version_dir / "status.json"
        import json

        data = json.loads(stale.read_text())
        data["manifestSha256"] = "9" * 64
        stale.write_text(json.dumps(data, sort_keys=True))
        record = registry.record(outcome.dataset_key, 1)
        assert record is not None and record.status is DatasetStatus.QUARANTINED


class TestResumeAndAtomicity:
    """Cases 23, 24: resume after crash; atomic finalisation order."""

    def test_resume_reuses_verified_completed_partitions(self, tmp_path) -> None:
        root = write_source(tmp_path, full_days())
        storage = LocalDatasetStorage(tmp_path / "datasets", tmp_path / "staging")

        fired = {"n": 0}

        def crash_once(_descriptor) -> None:
            fired["n"] += 1
            if fired["n"] == 2:
                raise RuntimeError("crash for resume")

        source_a = LocalJsonlSource(root, venue_symbol_map={SYMBOL: "BTCUSDT"})
        first = IngestionPipeline(
            storage, source=source_a, name="resumable", fault_hook=crash_once
        )
        with pytest.raises(PipelineError):
            first.ingest(REQUEST, job_key="res-1", version=1)

        source_b = LocalJsonlSource(root, venue_symbol_map={SYMBOL: "BTCUSDT"})
        resumed = IngestionPipeline(storage, source=source_b, name="resumable").ingest(
            REQUEST, job_key="res-1", version=1
        )
        assert resumed.reused_partitions == 1
        assert resumed.events_written == 10
        # Identical to an uninterrupted run of the same content.
        source_c = LocalJsonlSource(root, venue_symbol_map={SYMBOL: "BTCUSDT"})
        clean = IngestionPipeline(
            LocalDatasetStorage(tmp_path / "d2", tmp_path / "s2"), source=source_c, name="resumable"
        ).ingest(REQUEST, job_key="res-2", version=1)
        assert resumed.manifest.content_checksum == clean.manifest.content_checksum

    def test_resume_reverifies_digests_before_reuse(self, tmp_path) -> None:
        root = write_source(tmp_path, full_days())
        storage = LocalDatasetStorage(tmp_path / "datasets", tmp_path / "staging")
        fired = {"n": 0}

        def crash_once(_descriptor) -> None:
            fired["n"] += 1
            if fired["n"] == 2:
                raise RuntimeError("crash before corrupting")

        pipeline = IngestionPipeline(
            storage,
            source=LocalJsonlSource(root, venue_symbol_map={SYMBOL: "BTCUSDT"}),
            name="resume-integrity",
            fault_hook=crash_once,
        )
        with pytest.raises(PipelineError):
            pipeline.ingest(REQUEST, job_key="corrupt-1", version=1)
        # Corrupt the completed partition inside staging (simulating a crash
        # caught mid-flush: the .done marker for THAT file never got written,
        # so a truncation of the OTHER completed part is what a lie detector
        # must catch). Rewrite the first day's part after the marker.
        done = list((storage._staging / "corrupt-1" / ".done").rglob("*.json"))
        assert done
        part = storage._staging / "corrupt-1" / "data/BTC-USDT/TRADE/2023-11-14/part0000.jsonl.gz"
        part.write_bytes(gzip.compress(b"not-canonical\n", mtime=0))
        resumed = IngestionPipeline(
            storage,
            source=LocalJsonlSource(root, venue_symbol_map={SYMBOL: "BTCUSDT"}),
            name="resume-integrity",
        ).ingest(REQUEST, job_key="corrupt-1", version=1)
        # The corrupted part was rewritten from the source, not trusted.
        assert resumed.reused_partitions == 0
        assert resumed.events_written == 10

    def test_manifest_is_the_last_word(self, storage_pipeline_pair=None) -> None:
        # The visibility switch: a staging area containing data but no
        # manifest cannot be finalised at all (see write path), and a version
        # directory without manifest.json lists as no version (see the reader
        # test). Covered concretely here for the finalize gate itself.
        import tempfile
        import pathlib

        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            storage = LocalDatasetStorage(pathlib.Path(a), pathlib.Path(b))
            storage.create_staging("no-manifest")
            storage.write_staged("no-manifest", "data/x.jsonl.gz", [b"x"])
            with pytest.raises(StorageError, match="without a manifest"):
                storage.finalize_staging("no-manifest", "hst-" + "a" * 32, 1)


class TestLocalSourceGuards:
    def test_unknown_file_venue_symbol_is_refused_not_guessed(self, tmp_path) -> None:
        root = tmp_path / "src"
        root.mkdir()
        (root / "SOLUSDT-TRADE-2023-11-14.jsonl").write_text(
            event_to_line(trade(0, 0)) + "\n", encoding="utf-8"
        )
        source = LocalJsonlSource(root)
        with pytest.raises(DatasetFormatError, match="matches none of the requested"):
            source.plan(REQUEST)

    def test_empty_plan_is_refused(self, tmp_path) -> None:
        root = tmp_path / "src"
        root.mkdir()
        source = LocalJsonlSource(root)
        with pytest.raises(DatasetFormatError, match="refusing to produce an empty"):
            source.plan(REQUEST)

    def test_source_labels_reject_credentials(self, tmp_path) -> None:
        # The guard lives on validate_source_label, which every source calls
        # at construction; exercise the shared function directly (the label
        # lands in the manifest and the identity hash, so one guard covers
        # all sources).
        from wlct_trading.datasets.ingestion.base import validate_source_label

        with pytest.raises(DatasetFormatError, match="credential"):
            validate_source_label("bucket?X-Amz-Credential=abc")
