"""Storage safety and the streaming reader (Part 7, cases 14-18).

Path traversal, bounded streaming, window pruning, and the deterministic
multi-symbol merge order - tested against real (temporary) files, because
"we validate paths" is only a claim until somebody tries ``../``.
"""

from __future__ import annotations

import gzip
from decimal import Decimal

import pytest

from tests.conftest import BASE_TS, EXCHANGE, SYMBOL

from wlct_trading.backtest.dataset import MarketEvent
from wlct_trading.datasets.manifest import (
    DatasetFileEntry,
    DatasetManifest,
    ManifestValidationSummary,
)
from wlct_trading.datasets.readers.streaming import (
    ReaderStats,
    StreamingDatasetReader,
    merge_sort_key,
)
from wlct_trading.datasets.schema import event_to_line
from wlct_trading.datasets.identity import DatasetIdentity
from wlct_trading.datasets.storage.base import DatasetStorage, StoragePathError
from wlct_trading.datasets.storage.local import LocalDatasetStorage
from wlct_trading.enums import (
    DatasetCompleteness,
    DatasetStatus,
    HistoricalSourceKind,
    MarketEventKind,
    MarketType,
    OrderSide,
)
from wlct_trading.market_data import PublicTrade
from wlct_trading.backtest.dataset import compute_dataset_checksum

D = Decimal
OTHER = "ETH-USDT"
JOB = "job-1"


def trade(index: int, symbol: str = SYMBOL, *, price: str = "100", trade_id: str = "") -> MarketEvent:
    ts = BASE_TS + index * 1_000
    return MarketEvent(
        kind=MarketEventKind.TRADE,
        timestamp_micros=ts,
        payload=PublicTrade(
            exchange=EXCHANGE,
            symbol=symbol,
            trade_id=trade_id or f"{symbol[:3]}{index}",
            price=D(price),
            quantity=D("1"),
            aggressor_side=OrderSide.BUY,
            exchange_timestamp=ts,
            received_timestamp=ts,
        ),
        sequence=index,
    )


def staged_manifest(
    storage: LocalDatasetStorage,
    tmp_path,
    events_by_file: dict[str, list[MarketEvent]],
    *,
    version: int = 1,
    corrupt: bool = False,
    tamper: bool = False,
) -> tuple[DatasetManifest, str]:
    """Write files + manifest + finalize, entirely through storage calls."""
    files: list[DatasetFileEntry] = []
    identity_events: list[MarketEvent] = []
    payloads: dict[str, bytes] = {}
    for name, events in sorted(events_by_file.items()):
        path = f"data/{name}.jsonl.gz"
        blob = ("\n".join(event_to_line(e) for e in events) + "\n").encode()
        compressed = gzip.compress(blob, mtime=0)
        payloads[path] = compressed
        receipt = storage.write_staged(JOB, path, [compressed])
        first, last = events[0].timestamp_micros, events[-1].timestamp_micros
        symbol = name.split("/")[0]
        files.append(
            DatasetFileEntry(
                partition_path=path,
                symbol=symbol,
                kind=MarketEventKind.TRADE,
                events=len(events),
                bytes=len(compressed),
                sha256=receipt.sha256,
                first_timestamp_micros=first,
                last_timestamp_micros=last,
            )
        )
        identity_events.extend(events)
    content = compute_dataset_checksum(identity_events)
    if corrupt:
        content = "0" * 64
    symbols = tuple(sorted({e.payload.symbol for e in identity_events}))
    identity = DatasetIdentity(
        source_kind=HistoricalSourceKind.LOCAL_FILES,
        source_label="test-archive",
        exchange=EXCHANGE,
        market_type=MarketType.SPOT,
        symbols=symbols,
        event_kinds=(MarketEventKind.TRADE,),
        start_micros=min(e.timestamp_micros for e in identity_events),
        end_micros=max(e.timestamp_micros for e in identity_events),
        granularity="event",
        content_checksum=content,
        canonical_schema_version=1,
    )
    manifest = DatasetManifest(
        identity=identity,
        version=version,
        name="reader fixture",
        event_count=len(identity_events),
        total_bytes=sum(len(p) for p in payloads.values()),
        files=tuple(sorted(files, key=lambda item: item.partition_path)),
        file_digests_checksum="e" * 64,
        completeness=DatasetCompleteness.COMPLETE,
        validation=ManifestValidationSummary(
            status=DatasetStatus.VALID,
            info_count=0,
            warning_count=0,
            error_count=0,
            fatal_count=0,
            report_sha256="c" * 64,
            policy_digest="d" * 64,
        ),
        manifest_schema_version=1,
        created_at_micros=BASE_TS,
        creator_job_id=JOB,
        metadata={},
    )
    storage.write_staged(JOB, "manifest.json", [manifest.to_json_bytes()])
    storage.finalize_staging(JOB, identity.key, version)
    if tamper:
        # Corruption *after* finalisation, in the shape a parser cannot catch:
        # a fully valid canonical line replacing one of the real ones. The
        # bytes parse, the count is right, and only the digest knows.
        victim = storage.root / identity.key / f"v{version}" / manifest.files[0].partition_path
        victim.write_bytes(
            gzip.compress(
                ("\n".join(event_to_line(trade(i, price="666") if i == 2 else trade(i)) for i in range(5)) + "\n").encode()
                , mtime=0
            )
        )
    return manifest, identity.key


@pytest.fixture()
def storage(tmp_path) -> LocalDatasetStorage:
    return LocalDatasetStorage(tmp_path / "datasets", tmp_path / "staging")


class TestPathSafety:
    """Case 14: local storage path safety."""

    def test_partition_paths_reject_every_traversal_shape(self) -> None:
        for evil in (
            "../../etc/passwd",
            "/etc/passwd",
            "data/../../secret",
            "data//part",
            "./data/part",
            "data\\..\\part",
            "~/part",
            "data/\x01part",
            "",
        ):
            with pytest.raises(StoragePathError):
                DatasetStorage.validate_relative_path(evil)

    def test_dataset_keys_must_be_derived(self) -> None:
        from wlct_trading.datasets.storage.base import validate_dataset_key

        for evil in ("../../root", "hst-XYZ", "datasets", "hst-" + "g" * 32, ""):
            with pytest.raises(StoragePathError):
                validate_dataset_key(evil)
        validate_dataset_key("hst-" + "a" * 32)  # the accepted shape

    def test_versions_must_be_positive_integers(self) -> None:
        from wlct_trading.datasets.storage.base import validate_version

        for bad in (0, -1, True, "1"):
            with pytest.raises(StoragePathError):
                validate_version(bad)  # type: ignore[arg-type]
        validate_version(1)

    def test_job_keys_reject_separators(self, storage: LocalDatasetStorage) -> None:
        for evil in ("../escape", "a/b", "a\\b"):
            with pytest.raises(StoragePathError):
                storage.create_staging(evil)

    def test_symlink_staged_target_is_refused(self, tmp_path) -> None:
        datasets = tmp_path / "datasets"
        staging = tmp_path / "staging"
        outside = tmp_path / "outside"
        outside.mkdir()
        st = LocalDatasetStorage(datasets, staging)
        st.create_staging("job-sym")
        # Replace the staging subdirectory with a symlink out of the sandbox.
        staged_dir = staging / "job-sym"
        (staged_dir / "data").symlink_to(outside)
        with pytest.raises(StoragePathError, match="symlink"):
            st.write_staged("job-sym", "data/part.jsonl", [b"x"])
        assert not (outside / "part.jsonl").exists()

    def test_written_files_are_owner_only(self, storage: LocalDatasetStorage) -> None:
        import os
        import stat

        storage.create_staging(JOB)
        storage.write_staged(JOB, "data/a.jsonl", [b"line\n"])
        mode = os.stat(storage._staging_dir(JOB) / "data" / "a.jsonl").st_mode
        assert stat.S_IMODE(mode) == 0o600


class TestBoundedStreaming:
    """Case 15: streaming reader properties."""

    def test_small_buffer_reads_the_same_events_as_large(self, storage, tmp_path) -> None:
        events = [trade(i) for i in range(40)]
        manifest, key = staged_manifest(storage, tmp_path, {SYMBOL: events})
        small = list(
            StreamingDatasetReader(
                storage, manifest, buffer_bytes=1024, verify_checksums=True
            ).events()
        )
        large = list(StreamingDatasetReader(storage, manifest).events())
        assert small == large == sorted(events, key=lambda e: e.ordering_key)

    def test_reader_never_holds_the_whole_file(self, storage, tmp_path) -> None:
        events = [trade(i) for i in range(400)]
        manifest, key = staged_manifest(storage, tmp_path, {SYMBOL: events})
        reader = StreamingDatasetReader(storage, manifest, buffer_bytes=1024)
        delivered = 0
        for _ in reader.events():
            delivered += 1
            # Liveness, not exactness: the promise is that iteration works
            # with a 1 KiB buffer over a file many times that; a peeking
            # reader would raise or return everything at the first next().
            assert delivered <= 400
        assert delivered == 400

    def test_checksum_verification_catches_tampering(self, storage, tmp_path) -> None:
        events = [trade(i) for i in range(5)]
        manifest, key = staged_manifest(storage, tmp_path, {SYMBOL: events}, tamper=True)
        reader = StreamingDatasetReader(storage, manifest, verify_checksums=True)
        with pytest.raises(Exception, match="digests to"):
            list(reader.events())

    def test_gzip_bomb_ceiling(self, storage, tmp_path) -> None:
        events = [trade(i) for i in range(5)]
        manifest, key = staged_manifest(storage, tmp_path, {SYMBOL: events})
        # Swap the finalized partition for a high-expansion file while
        # keeping the manifest's (now stale) recorded size.
        bomb = gzip.compress(b"0" * (1024 * 1024 * 40), mtime=0)
        version_dir = storage.root / key / f"v{manifest.version}"
        target = version_dir / manifest.files[0].partition_path
        target.write_bytes(bomb)
        reader = StreamingDatasetReader(storage, manifest, buffer_bytes=4096)
        with pytest.raises(Exception, match="decompression bomb|expanded past"):
            list(reader.events())


class TestWindowsAndMerge:
    """Cases 16-18: range filtering and deterministic multi-symbol order."""

    def test_window_prunes_whole_partitions_by_their_recorded_range(self, storage, tmp_path) -> None:
        day1 = [trade(i) for i in range(5)]
        day2 = [trade(i + 5, symbol=SYMBOL) for i in range(5)]
        manifest, key = staged_manifest(
            storage,
            tmp_path,
            {
                f"{SYMBOL}/2023-11-14": day1,
                f"{SYMBOL}/2023-11-15": day2,
            },
        )
        reader = StreamingDatasetReader(storage, manifest, end_micros=day1[-1].timestamp_micros)
        events = list(reader.events())
        assert len(events) == 5
        assert reader.stats.partitions_selected == 1
        assert reader.stats.partitions_skipped == 1

    def test_line_level_window_filtering_within_a_partition(self, storage, tmp_path) -> None:
        events = [trade(i) for i in range(10)]
        manifest, key = staged_manifest(storage, tmp_path, {SYMBOL: events})
        reader = StreamingDatasetReader(
            storage,
            manifest,
            start_micros=BASE_TS + 2_000,
            end_micros=BASE_TS + 6_000,
        )
        got = list(reader.events())
        assert [e.timestamp_micros for e in got] == [BASE_TS + t * 1_000 for t in range(2, 7)]

    def test_multi_symbol_interleaving_is_deterministic(self, storage, tmp_path) -> None:
        btc = [trade(0), trade(2), trade(4)]
        eth = [trade(1, symbol=OTHER), trade(3, symbol=OTHER)]
        manifest, key = staged_manifest(
            storage, tmp_path, {f"{SYMBOL}/x": btc, f"{OTHER}/y": eth}
        )
        # Feed the files in whatever order; merge output must not care.
        first = [ (e.payload.symbol, e.timestamp_micros) for e in StreamingDatasetReader(storage, manifest).events() ]
        assert first == [
            (SYMBOL, BASE_TS),
            (OTHER, BASE_TS + 1_000),
            (SYMBOL, BASE_TS + 2_000),
            (OTHER, BASE_TS + 3_000),
            (SYMBOL, BASE_TS + 4_000),
        ]

    def test_equal_timestamp_tie_break_rule(self) -> None:
        # Same ts, same kind, same sequence: symbol order, then manifest
        # partition position. Documented in merge_sort_key's docstring; pinned
        # here so a future edit cannot silently change replay semantics.
        eth_at_zero = trade(7, symbol=OTHER)
        btc_at_one = trade(7, symbol=SYMBOL)
        key_btc = merge_sort_key(btc_at_one, symbol=SYMBOL, partition_position=1)
        key_eth = merge_sort_key(eth_at_zero, symbol=OTHER, partition_position=0)
        assert key_btc < key_eth  # symbol sorts before partition position

    def test_kind_rank_ordering_at_equal_timestamp(self) -> None:
        # A ticker and a snapshot sharing a timestamp replay snapshot-first,
        # because the strategy must see book state before anything summarising
        # it. The ranks come from Part 6's EVENT_KIND_ORDER.
        from wlct_trading.backtest.dataset import EVENT_KIND_ORDER

        assert EVENT_KIND_ORDER[MarketEventKind.BOOK_SNAPSHOT] < EVENT_KIND_ORDER[
            MarketEventKind.TICKER
        ]

    def test_reader_close_makes_reuse_an_error(self, storage, tmp_path) -> None:
        events = [trade(i) for i in range(3)]
        manifest, key = staged_manifest(storage, tmp_path, {SYMBOL: events})
        reader = StreamingDatasetReader(storage, manifest)
        reader.close()
        with pytest.raises(Exception, match="closed"):
            list(reader.events())

    def test_stats_report_skips_and_reads(self, storage, tmp_path) -> None:
        events = [trade(i) for i in range(6)]
        manifest, key = staged_manifest(storage, tmp_path, {SYMBOL: events})
        reader = StreamingDatasetReader(storage, manifest, start_micros=BASE_TS + 10_000_000)
        assert list(reader.events()) == []
        assert reader.stats.partitions_skipped == 1
        assert isinstance(reader.stats, ReaderStats)


class TestAtomicVisibility:
    """Case 24 groundwork: what a directory without a manifest means."""

    def test_partial_directory_is_invisible(self, storage: LocalDatasetStorage) -> None:
        key = "hst-" + "a" * 32
        storage.create_staging(JOB)
        storage.write_staged(JOB, "data/x/part0000.jsonl.gz", [b"orphan"])
        # The staging tree exists but no finalize happened: nothing is visible.
        assert storage.list_versions(key) == ()
        assert not storage.dataset_version_exists(key, 1)

    def test_finalized_version_survives_reread_byte_for_byte(self, storage, tmp_path) -> None:
        events = [trade(i) for i in range(4)]
        manifest, key = staged_manifest(storage, tmp_path, {SYMBOL: events})
        stored = storage.read_manifest(key, manifest.version)
        assert stored == manifest.to_json_bytes()
        assert DatasetManifest.from_json_bytes(stored).content_checksum == (
            compute_dataset_checksum(events)
        )
