"""Dataset manifest, identity and checksum determinism (Part 7, cases 1-3).

Everything here is pure arithmetic over records: no storage, no network, no
filesystem. Determinism claims that need a temp directory to test are tested
in the pipeline and reader files, not faked here.

No helper in this file takes ``**dict`` bags or carries a suppression
comment: overrides go through ``dataclasses.replace`` or named arguments, so
the type checker verifies the fixtures exactly like it verifies production.
"""

from __future__ import annotations

import gzip
import json
from dataclasses import replace
from decimal import Decimal

import pytest

from tests.conftest import BASE_TS, EXCHANGE, SYMBOL

from wlct_trading.backtest.dataset import MarketEvent, compute_dataset_checksum
from wlct_trading.datasets.identity import (
    DatasetIdentity,
    build_dataset_key,
    events_digest,
    file_digests_checksum,
    is_safe_dataset_key,
)
from wlct_trading.datasets.manifest import (
    DatasetFileEntry,
    DatasetManifest,
    ManifestValidationSummary,
    manifest_digest,
)
from wlct_trading.datasets.schema import (
    CANONICAL_SCHEMA_VERSION,
    DatasetFormatError,
    event_to_line,
    line_to_event,
)
from wlct_trading.enums import (
    DatasetCompleteness,
    DatasetStatus,
    ExchangeId,
    HistoricalSourceKind,
    MarketEventKind,
    MarketType,
    OrderSide,
)
from wlct_trading.market_data import (
    Candle,
    OrderBookDelta,
    OrderBookSnapshot,
    PriceLevel,
    PublicTrade,
    Ticker,
)

D = Decimal


def snapshot_event(index: int, *, bid_qty: str = "1", ask_qty: str = "1") -> MarketEvent:
    ts = BASE_TS + index * 1_000
    return MarketEvent(
        kind=MarketEventKind.BOOK_SNAPSHOT,
        timestamp_micros=ts,
        payload=OrderBookSnapshot(
            exchange=EXCHANGE,
            symbol=SYMBOL,
            bids=(PriceLevel(D("100"), D(bid_qty)),),
            asks=(PriceLevel(D("101"), D(ask_qty)),),
            last_update_id=index + 1,
            exchange_timestamp=ts,
            received_timestamp=ts,
        ),
        sequence=index,
    )


def trade_event(index: int, *, price: str = "43123.45000000") -> MarketEvent:
    ts = BASE_TS + index * 1_000
    return MarketEvent(
        kind=MarketEventKind.TRADE,
        timestamp_micros=ts,
        payload=PublicTrade(
            exchange=EXCHANGE,
            symbol=SYMBOL,
            trade_id=f"t{index}",
            price=D(price),
            quantity=D("0.5"),
            aggressor_side=OrderSide.BUY,
            exchange_timestamp=ts,
            received_timestamp=ts,
        ),
        sequence=index,
    )


def canonical_identity() -> DatasetIdentity:
    return DatasetIdentity(
        source_kind=HistoricalSourceKind.LOCAL_FILES,
        source_label="unit-test-archive",
        exchange=EXCHANGE,
        market_type=MarketType.SPOT,
        symbols=(SYMBOL,),
        event_kinds=(MarketEventKind.TRADE,),
        start_micros=BASE_TS,
        end_micros=BASE_TS + 10_000,
        granularity="event",
        content_checksum="a" * 64,
        canonical_schema_version=CANONICAL_SCHEMA_VERSION,
    )


def canonical_entry(*, events: int = 2) -> DatasetFileEntry:
    payload = gzip.compress(b"two lines\n", mtime=0)
    return DatasetFileEntry(
        partition_path=f"data/{SYMBOL}/TRADE/2023-11-14/part0000.jsonl.gz",
        symbol=SYMBOL,
        kind=MarketEventKind.TRADE,
        events=events,
        bytes=len(payload),
        sha256="b" * 64,
        first_timestamp_micros=BASE_TS,
        last_timestamp_micros=BASE_TS + 1_000,
    )


def canonical_manifest(
    *,
    event_count: int = 2,
    entry_events: int = 2,
    fatal_count: int = 0,
    warning_count: int = 0,
    manifest_schema_version: int = 1,
    metadata: dict[str, str] | None = None,
) -> DatasetManifest:
    entry = canonical_entry(events=entry_events)
    payload_bytes = gzip.compress(b"two lines\n", mtime=0)
    return DatasetManifest(
        identity=canonical_identity(),
        version=1,
        name="unit dataset",
        event_count=event_count,
        total_bytes=len(payload_bytes),
        files=(entry,),
        file_digests_checksum="e" * 64,
        completeness=DatasetCompleteness.COMPLETE,
        validation=ManifestValidationSummary(
            status=DatasetStatus.VALID,
            info_count=0,
            warning_count=warning_count,
            error_count=0,
            fatal_count=fatal_count,
            report_sha256="c" * 64,
            policy_digest="d" * 64,
        ),
        manifest_schema_version=manifest_schema_version,
        created_at_micros=BASE_TS,
        creator_job_id="job-1",
        metadata=dict(metadata or {}),
    )


class TestCanonicalLineFormat:
    """Case 1 groundwork: the line format is deterministic in both directions."""

    def test_every_kind_round_trips_exactly(self) -> None:
        cases = [
            MarketEvent(
                kind=MarketEventKind.TICKER,
                timestamp_micros=BASE_TS,
                payload=Ticker(
                    exchange=EXCHANGE,
                    symbol=SYMBOL,
                    bid_price=D("1"),
                    ask_price=None,
                    last_price=D("2.50000000"),
                    exchange_timestamp=BASE_TS,
                    received_timestamp=BASE_TS + 3,
                ),
                sequence=0,
            ),
            trade_event(1),
            snapshot_event(2),
            MarketEvent(
                kind=MarketEventKind.BOOK_DELTA,
                timestamp_micros=BASE_TS,
                payload=OrderBookDelta(
                    exchange=EXCHANGE,
                    symbol=SYMBOL,
                    bids=(),
                    asks=(PriceLevel(D("101"), D("0")),),
                    first_update_id=5,
                    final_update_id=6,
                    exchange_timestamp=BASE_TS,
                    received_timestamp=BASE_TS,
                    previous_final_update_id=4,
                ),
                sequence=3,
            ),
            MarketEvent(
                kind=MarketEventKind.CANDLE,
                timestamp_micros=BASE_TS + 60_000_000,
                payload=Candle(
                    exchange=EXCHANGE,
                    symbol=SYMBOL,
                    interval="1m",
                    open_time=BASE_TS,
                    close_time=BASE_TS + 59_999_000,
                    open=D("1"),
                    high=D("2"),
                    low=D("0.5"),
                    close=D("1.5"),
                    volume=D("100"),
                    trade_count=42,
                    is_closed=True,
                    received_timestamp=BASE_TS,
                ),
                sequence=4,
            ),
        ]
        for event in cases:
            parsed = line_to_event(event_to_line(event))
            assert parsed.event == event, event.kind

    def test_serialisation_is_byte_stable_and_tight(self) -> None:
        event = trade_event(0)
        line = event_to_line(event)
        assert line == event_to_line(event)
        assert b", " not in line.encode() and b'": ' not in line.encode()
        assert '"p":"43123.45000000"' in line  # Decimal keeps its exact scale

    def test_floats_are_refused_not_rescaled(self) -> None:
        with pytest.raises(DatasetFormatError, match="decimal string"):
            line_to_event(
                '{"schema":1,"kind":"TRADE","ts":5,"seq":0,"payload":{"ets":5,'
                '"ex":"binance","sym":"BTC-USDT","tid":"t","p":0.1,"q":2,"side":"BUY"}}'
            )

    def test_null_decimals_are_legal_and_stay_none(self) -> None:
        parsed = line_to_event(
            '{"schema":1,"kind":"TICKER","ts":5,"seq":0,"payload":{"ets":5,'
            '"ex":"binance","sym":"BTC-USDT","bid":null,"ask":null,"last":null}}'
        )
        payload = parsed.event.payload
        assert isinstance(payload, Ticker)
        assert payload.bid_price is None

    def test_future_schema_version_is_refused_not_guessed(self) -> None:
        with pytest.raises(DatasetFormatError, match="schema"):
            line_to_event('{"schema":999,"kind":"TRADE","ts":1,"seq":0,"payload":{}}')

    def test_unknown_and_missing_line_keys_are_refused(self) -> None:
        with pytest.raises(DatasetFormatError, match="unknown keys"):
            line_to_event(
                '{"schema":1,"kind":"TRADE","ts":1,"seq":0,"payload":{},"extra":true}'
            )
        with pytest.raises(DatasetFormatError, match="missing keys"):
            line_to_event('{"schema":1,"kind":"TRADE","ts":1,"payload":{}}')

    def test_schema_version_constant_is_recorded_in_every_line(self) -> None:
        line = json.loads(event_to_line(trade_event(0)))
        assert line["schema"] == CANONICAL_SCHEMA_VERSION


class TestIdentity:
    """Case 2: dataset identity determinism and its discriminations."""

    def test_same_inputs_same_key(self) -> None:
        assert canonical_identity().key == canonical_identity().key

    def test_key_shape_is_derived_and_path_safe(self) -> None:
        key = canonical_identity().key
        assert is_safe_dataset_key(key)
        assert key.startswith("hst-") and len(key) == 36

    @pytest.mark.parametrize(
        ("field", "value"),
        [
            ("exchange", ExchangeId.BYBIT),
            ("market_type", MarketType.FUTURES_USDT),
            ("source_label", "another-archive"),
            ("source_kind", HistoricalSourceKind.STREAM_CAPTURE),
            ("start_micros", BASE_TS - 1),
            ("end_micros", BASE_TS + 10_001),
            ("canonical_schema_version", 2),
            ("granularity", "1m"),
        ],
    )
    def test_every_distinguishing_input_moves_the_key(self, field: str, value: object) -> None:
        changed = replace(canonical_identity(), **{field: value})
        assert changed.key != canonical_identity().key

    def test_symbol_and_kind_sets_move_the_key_as_sets(self) -> None:
        two_symbols = replace(canonical_identity(), symbols=(SYMBOL, "ETH-USDT"))
        assert two_symbols.key != canonical_identity().key
        two_kinds = replace(
            canonical_identity(),
            event_kinds=(MarketEventKind.BOOK_SNAPSHOT, MarketEventKind.TRADE),
        )
        assert two_kinds.key != canonical_identity().key

    def test_symbols_must_be_sorted(self) -> None:
        with pytest.raises(DatasetFormatError, match="sorted"):
            replace(canonical_identity(), symbols=("ETH-USDT", SYMBOL))

    def test_credential_shaped_inputs_are_refused(self) -> None:
        with pytest.raises(DatasetFormatError, match="credential"):
            replace(canonical_identity(), source_label="bucket?X-Amz-Credential=AKIAX")

    def test_random_uuid_is_not_an_identity(self) -> None:
        # The spec's demand restated as a test: identity comes from content,
        # and re-deriving reproduces it. A uuid4 would fail this property by
        # construction, which is why the key is a digest, not a draw.
        first = build_dataset_key(canonical_identity().canonical_fields())
        second = build_dataset_key(canonical_identity().canonical_fields())
        assert first == second == canonical_identity().key

    def test_content_is_recorded_but_the_key_is_the_contract(self) -> None:
        # Distinct bytes share a dataset *name* and can never share a version:
        # the key describes the contract, and the content checksum recorded in
        # each version's manifest is what distinguishes their bytes. The
        # replay bridge verifies the pair, which is the enforcement half.
        one = replace(canonical_identity(), content_checksum="ab" * 32)
        two = replace(canonical_identity(), content_checksum="ac" * 32)
        assert one.key == two.key
        assert one.content_checksum != two.content_checksum
        assert ("content", "ab" * 32) not in one.canonical_fields()
        assert all(name != "content" for name, _ in one.canonical_fields())


class TestChecksums:
    """Case 3: the two digests, and what each one is allowed to prove."""

    def test_events_digest_matches_part6_over_the_same_events(self) -> None:
        events = [trade_event(i) for i in range(5)]
        part6 = compute_dataset_checksum(events)
        ours = events_digest(
            event.checksum_source()
            for event in sorted(events, key=lambda item: item.ordering_key)
        )
        assert part6 == ours

    def test_events_digest_refuses_empty_streams(self) -> None:
        with pytest.raises(DatasetFormatError, match="empty stream"):
            events_digest(iter(()))

    def test_events_digest_refuses_a_bare_string(self) -> None:
        with pytest.raises(TypeError):
            events_digest("not-a-stream")

    def test_file_digests_are_order_insensitive_over_sorted_input(self) -> None:
        a = ("data/x/part0000.jsonl.gz", "1" * 64)
        b = ("data/y/part0000.jsonl.gz", "2" * 64)
        assert file_digests_checksum((a, b)) == file_digests_checksum((b, a))
        assert file_digests_checksum((a, b)) != file_digests_checksum(
            (a, ("data/y/part0000.jsonl.gz", "3" * 64))
        )


class TestManifest:
    """Case 1: generation, canonical bytes, strict parsing, internal agreement."""

    def test_canonical_bytes_are_byte_stable(self) -> None:
        raw = canonical_manifest().to_json_bytes()
        assert raw == canonical_manifest().to_json_bytes()
        assert raw.endswith(b"\n")
        assert b", " not in raw and b'": ' not in raw  # structural whitespace absent

    def test_round_trip_preserves_identity(self) -> None:
        original = canonical_manifest()
        restored = DatasetManifest.from_json_bytes(original.to_json_bytes())
        assert restored.dataset_key == original.dataset_key
        assert restored.version == original.version
        assert manifest_digest(restored) == manifest_digest(original)

    def test_event_counts_must_be_internal_to_the_files(self) -> None:
        with pytest.raises(DatasetFormatError, match="sum to"):
            canonical_manifest(event_count=99)

    def test_zero_event_partitions_are_refused(self) -> None:
        with pytest.raises(DatasetFormatError):
            canonical_manifest(event_count=0, entry_events=0)

    def test_partition_windows_must_be_ordered(self) -> None:
        with pytest.raises(DatasetFormatError):
            DatasetFileEntry(
                partition_path="data/x/part0000.jsonl.gz",
                symbol=SYMBOL,
                kind=MarketEventKind.TRADE,
                events=1,
                bytes=10,
                sha256="b" * 64,
                first_timestamp_micros=BASE_TS + 5_000,
                last_timestamp_micros=BASE_TS,
            )

    def test_partition_digests_must_be_lowercase_hex(self) -> None:
        with pytest.raises(DatasetFormatError, match="hex digest"):
            DatasetFileEntry(
                partition_path="data/x/part0000.jsonl.gz",
                symbol=SYMBOL,
                kind=MarketEventKind.TRADE,
                events=1,
                bytes=10,
                sha256="not-hex",
                first_timestamp_micros=BASE_TS,
                last_timestamp_micros=BASE_TS,
            )

    def test_future_manifest_schema_is_refused(self) -> None:
        with pytest.raises(DatasetFormatError, match="schema"):
            canonical_manifest(manifest_schema_version=2)

    def test_edited_identity_field_is_caught_on_parse(self) -> None:
        raw = json.loads(canonical_manifest().to_json_bytes())
        # Forging the key without re-deriving the identity must fail: the
        # parse path recomputes the key from the identity fields it stores.
        raw["datasetKey"] = "hst-" + "0" * 32
        with pytest.raises(DatasetFormatError, match="re-derived"):
            DatasetManifest.from_json_bytes(json.dumps(raw).encode())

    def test_metadata_credential_shaped_values_are_refused(self) -> None:
        with pytest.raises(DatasetFormatError, match="credential"):
            canonical_manifest(metadata={"note": "see api_key sk-live-xyz for provenance"})

    def test_descriptor_dataset_id_names_the_exact_version(self) -> None:
        ident = canonical_identity()
        assert canonical_manifest().descriptor_dataset_id() == f"{ident.key}@v1"

    def test_verify_against_files_spots_every_failure_mode(self) -> None:
        original = canonical_manifest()
        entry = original.files[0]
        assert original.verify_against_files({entry.partition_path: entry.sha256}) == ()
        assert "digest differs" in original.verify_against_files({entry.partition_path: "9" * 64})[0]
        assert "missing" in original.verify_against_files({})[0]
        assert "not in the manifest" in original.verify_against_files(
            {entry.partition_path: entry.sha256, "data/extra/part.jsonl.gz": "1" * 64}
        )[0]

    def test_worst_severity_is_derived_from_counts(self) -> None:
        assert canonical_manifest().worst_severity().value == "INFO"
        assert canonical_manifest(fatal_count=2, warning_count=0).worst_severity().value == "FATAL"
        assert canonical_manifest(warning_count=1).worst_severity().value == "WARNING"
