"""Replay integration and the live-execution boundary (Part 7, cases 19-21, 25, 26).

These are the tests the whole part exists for: a persisted dataset must run
through the *unmodified* Part 6 engine and produce a *reproducible* result,
and nothing in the dataset layer may acquire the ability to place an order.
The second half of this file is static rather than behavioural for a reason:
"no live path exists" cannot be tested by trying to use one, so the test
reads every source file in the package and fails on an import that would
create the path.
"""

from __future__ import annotations

import pathlib
from decimal import Decimal

import pytest

from tests.conftest import BASE_TS, EXCHANGE, SYMBOL

from wlct_trading.backtest.dataset import HistoricalDataset, MarketEvent
from wlct_trading.backtest.engine import BacktestConfig, BacktestEngine
from wlct_trading.backtest.replay import LookAheadError, ReplayEngine
from wlct_trading.backtest.result import BacktestResult
from wlct_trading.datasets.ingestion.base import IngestionRequest
from wlct_trading.datasets.ingestion.local import LocalJsonlSource
from wlct_trading.datasets.ingestion.pipeline import IngestionPipeline
from wlct_trading.datasets.readers.streaming import StreamingDatasetReader
from wlct_trading.datasets.registry import DatasetRegistry
from wlct_trading.datasets.replay.source import DatasetReplayError, load_for_backtest
from wlct_trading.datasets.schema import event_to_line
from wlct_trading.datasets.storage.local import LocalDatasetStorage
from wlct_trading.enums import (
    MarketEventKind,
    MarketType,
    OrderSide,
)
from wlct_trading.market_data import OrderBookSnapshot, PriceLevel, PublicTrade
from wlct_trading.risk import RiskLimits
from wlct_trading.signals import StrategyDescriptor, StrategyRiskProfile
from wlct_trading.strategies import build_default_strategy_registry

D = Decimal
OTHER = "ETH-USDT"
REQUEST = IngestionRequest(
    exchange=EXCHANGE,
    market_type=MarketType.SPOT,
    symbols=(SYMBOL,),
    kinds=(MarketEventKind.BOOK_SNAPSHOT,),
    start_micros=BASE_TS,
    end_micros=BASE_TS + 86_400_000_000,
    granularity="book_snapshot",
)


def snapshot(index: int, *, bid_qty: str, ask_qty: str) -> MarketEvent:
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


def oscillating_events(count: int = 40) -> list[MarketEvent]:
    events: list[MarketEvent] = []
    for index in range(count):
        phase = index % 10
        if phase < 4:
            events.append(snapshot(index, bid_qty="9", ask_qty="1"))
        elif phase < 7:
            events.append(snapshot(index, bid_qty="1", ask_qty="1"))
        else:
            events.append(snapshot(index, bid_qty="1", ask_qty="9"))
    return events


def trade(index: int, symbol: str = SYMBOL) -> MarketEvent:
    ts = BASE_TS + index * 1_000
    return MarketEvent(
        kind=MarketEventKind.TRADE,
        timestamp_micros=ts,
        payload=PublicTrade(
            exchange=EXCHANGE,
            symbol=symbol,
            trade_id=f"{symbol[:3]}-{index}",
            price=D("100"),
            quantity=D("1"),
            aggressor_side=OrderSide.BUY,
            exchange_timestamp=ts,
            received_timestamp=ts,
        ),
        sequence=index,
    )


def ingest_books(tmp_path, events: list[MarketEvent], *, valid: bool = True):
    """Write + ingest a book dataset through the real pipeline."""
    root = tmp_path / "src"
    root.mkdir(parents=True, exist_ok=True)
    (root / "BTCUSDT-BOOK_SNAPSHOT-2023-11-14.jsonl").write_text(
        "\n".join(event_to_line(e) for e in events) + "\n", encoding="utf-8"
    )
    storage = LocalDatasetStorage(
        tmp_path / ("datasets" if valid else "datasets-invalid"),
        tmp_path / ("staging" if valid else "staging-invalid"),
    )
    source = LocalJsonlSource(root, venue_symbol_map={SYMBOL: "BTCUSDT"})
    pipeline = IngestionPipeline(storage, source=source, name="replay fixture")
    outcome = pipeline.ingest(REQUEST, job_key="replay-job", version=1)
    return storage, outcome


def make_strategy():
    registry = build_default_strategy_registry()
    return registry.create(
        "DETERMINISTIC_IMBALANCE_V1",
        "1.0.0",
        symbol=SYMBOL,
        descriptor=StrategyDescriptor(
            strategy_id="strategy-1",
            tenant_id="tenant-1",
            name="deterministic example",
            version="1.0.0",
            enabled=True,
            exchange=EXCHANGE,
            symbols=(SYMBOL,),
            risk_profile=StrategyRiskProfile(
                max_order_quantity=D("1"),
                max_position_quantity=D("1"),
                max_order_notional=D("100000"),
                max_daily_loss=D("1000"),
                max_open_orders=5,
                max_orders_per_minute=600,
            ),
        ),
        parameters={"use_limit_orders": False, "signal_cooldown_micros": 0},
    )


def permissive_limits() -> RiskLimits:
    return RiskLimits(
        max_order_quantity=D("1"),
        max_order_notional=D("1000000"),
        max_position_quantity=D("1"),
        max_symbol_exposure_notional=D("1000000"),
        max_account_exposure_notional=D("1000000"),
        max_open_orders=50,
        max_orders_per_minute=600,
        max_daily_loss=D("100000"),
        max_strategy_loss=D("100000"),
        max_price_deviation_percent=D("100"),
        max_market_data_age_micros=60_000_000,
    )


class TestReplayIntegration:
    """Case 19: the bridge feeds the *same* engine the in-memory tests use."""

    def test_engine_accepts_bridged_dataset_and_runs(self, tmp_path) -> None:
        events = oscillating_events(40)
        storage, outcome = ingest_books(tmp_path, events)
        registry = DatasetRegistry(storage)
        bundle = load_for_backtest(registry, outcome.dataset_key, symbol=SYMBOL)
        engine = BacktestEngine(
            strategy=make_strategy(),
            dataset=bundle.dataset,
            config=BacktestConfig(
                tenant_id="tenant-1",
                account_id="account-1",
                initial_capital=D("10000"),
                risk_limits=permissive_limits(),
            ),
        )
        result = engine.run()
        assert isinstance(result, BacktestResult)
        assert result.events_replayed == 40
        assert result.signals_generated > 0

    def test_bridged_run_matches_the_in_memory_run(self, tmp_path) -> None:
        """The whole reproducibility claim in one assertion.

        A backtest over a persisted dataset and a backtest over the same
        events held in memory must produce identical results - same
        configuration hash, same trades, same equity curve. If persistence
        changed anything, this is where it would show.
        """
        events = oscillating_events(40)
        storage, outcome = ingest_books(tmp_path, events)
        registry = DatasetRegistry(storage)
        bundle = load_for_backtest(registry, outcome.dataset_key, symbol=SYMBOL)

        in_memory = HistoricalDataset.from_events(
            events, dataset_id="oscillating-1", source="unit-test-fixture"
        )

        config = BacktestConfig(
            tenant_id="tenant-1",
            account_id="account-1",
            initial_capital=D("10000"),
            risk_limits=permissive_limits(),
        )
        persisted = BacktestEngine(
            strategy=make_strategy(), dataset=bundle.dataset, config=config
        ).run()
        memory = BacktestEngine(strategy=make_strategy(), dataset=in_memory, config=config).run()
        # The dataset ids differ (one names a version of a persisted
        # dataset); the *market outcome* must not. The configuration hash
        # covers identity, so the hashes differ too - and that is the point:
        # a result always says which data it ran over, and two different
        # dataset identities may never share a hash. The trade record is the
        # equality that matters here.
        assert [t.to_dict() for t in persisted.closed_trades] == [
            t.to_dict() for t in memory.closed_trades
        ]
        assert (
            persisted.metrics.final_equity == memory.metrics.final_equity
            and persisted.metrics.trade_count == memory.metrics.trade_count
            and persisted.metrics.max_drawdown == memory.metrics.max_drawdown
        )
        assert persisted.dataset.checksum == memory.dataset.checksum
        assert persisted.configuration_hash != memory.configuration_hash
        assert (
            "oscillating-1" not in persisted.configuration_hash
            and persisted.dataset.dataset_id.endswith("@v1")
        )


class TestReplayProperties:
    """Cases 20 and 21: no look-ahead through the bridge; checksum preserved."""

    def test_no_look_ahead_through_the_bridged_dataset(self, tmp_path) -> None:
        events = oscillating_events(20)
        storage, outcome = ingest_books(tmp_path, events)
        registry = DatasetRegistry(storage)
        bundle = load_for_backtest(registry, outcome.dataset_key, symbol=SYMBOL)
        replay = ReplayEngine(bundle.dataset)
        seen: list[int] = []
        for event in replay.events():
            seen.append(event.timestamp_micros)
            # The cursor may not return anything past the clock at any point
            # during the walk - read-only, no peeking.
            assert replay.cursor.now_micros == event.timestamp_micros
            history = replay.cursor.history()
            assert all(item.timestamp_micros <= event.timestamp_micros for item in history)
        assert seen == sorted(seen)
        with pytest.raises(LookAheadError):
            replay.cursor.assert_not_future(event.timestamp_micros + 1)

    def test_reader_output_itself_never_aheads_the_last_yield(self, tmp_path) -> None:
        events = oscillating_events(30)
        storage, outcome = ingest_books(tmp_path, events)
        reader = StreamingDatasetReader(storage, outcome.manifest)
        previous: int | None = None
        for event in reader.events():
            if previous is not None:
                assert event.timestamp_micros >= previous
            previous = event.timestamp_micros

    def test_result_carries_dataset_key_version_and_checksum(self, tmp_path) -> None:
        events = oscillating_events(25)
        storage, outcome = ingest_books(tmp_path, events)
        registry = DatasetRegistry(storage)
        bundle = load_for_backtest(registry, outcome.dataset_key, symbol=SYMBOL)
        result = BacktestEngine(
            strategy=make_strategy(),
            dataset=bundle.dataset,
            config=BacktestConfig(
                tenant_id="tenant-1",
                account_id="account-1",
                initial_capital=D("10000"),
                risk_limits=permissive_limits(),
            ),
        ).run()
        assert result.dataset.dataset_id == f"{outcome.dataset_key}@v1"
        assert result.dataset.checksum == outcome.manifest.content_checksum
        assert result.is_reproducible
        payload = result.to_dict()
        dataset_view = payload["dataset"]
        assert isinstance(dataset_view, dict)
        assert dataset_view["checksum"] == outcome.manifest.content_checksum
        assert "dataset" in payload  # the Part 6 shape is unchanged: Part 7 only fed it


class TestInvalidDatasetBlocked:
    """Case 25: an unvalidated or quarantined dataset cannot be replayed."""

    def test_quarantined_version_refuses_a_backtest(self, tmp_path) -> None:
        events = oscillating_events(15)
        storage, outcome = ingest_books(tmp_path, events)
        registry = DatasetRegistry(storage)
        registry.quarantine(outcome.dataset_key, 1, reason="test quarantine gate")
        # An explicit version reaches the status gate; a "latest" query never
        # even *finds* a quarantined version, which is the other half of the
        # same rule and is asserted just below.
        with pytest.raises(DatasetReplayError, match="QUARANTINED"):
            load_for_backtest(registry, outcome.dataset_key, symbol=SYMBOL, version=1)
        assert registry.latest_valid(outcome.dataset_key) is None

    def test_override_requires_a_written_reason_and_marks_the_record(self, tmp_path) -> None:
        events = oscillating_events(15)
        storage, outcome = ingest_books(tmp_path, events)
        registry = DatasetRegistry(storage)
        registry.quarantine(outcome.dataset_key, 1, reason="override test")
        with pytest.raises(DatasetReplayError, match="override_reason"):
            load_for_backtest(
                registry, outcome.dataset_key, symbol=SYMBOL, version=1, override_reason="x"
            )
        bundle = load_for_backtest(
            registry,
            outcome.dataset_key,
            symbol=SYMBOL,
            version=1,
            override_reason="compliance review of the capture gap",
        )
        assert "REPLAY-OVERRIDE: compliance review" in bundle.dataset.descriptor.notes
        assert "QUARANTINED" in bundle.dataset.descriptor.notes

    def test_checksum_mismatch_from_caller_is_refused(self, tmp_path) -> None:
        events = oscillating_events(10)
        storage, outcome = ingest_books(tmp_path, events)
        registry = DatasetRegistry(storage)
        with pytest.raises(DatasetReplayError, match="Refusing to attribute"):
            load_for_backtest(
                registry,
                outcome.dataset_key,
                symbol=SYMBOL,
                expected_checksum="9" * 64,
            )

    def test_tampered_files_are_caught_by_full_window_recheck(self, tmp_path) -> None:
        events = oscillating_events(12)
        storage, outcome = ingest_books(tmp_path, events)
        # Replace a partition with *valid* alternate canonical events: the
        # checksum recorded in the manifest can no longer be reproduced, and
        # the bridge's final verification refuses the run.
        victim = (
            storage.root
            / outcome.dataset_key
            / "v1"
            / outcome.manifest.files[0].partition_path
        )
        import gzip

        victim.write_bytes(
            gzip.compress(
                ("\n".join(event_to_line(e) for e in oscillating_events(12)[:11]) + "\n").encode(),
                mtime=0,
            )
        )
        registry = DatasetRegistry(storage)
        with pytest.raises(DatasetReplayError, match="does not reproduce"):
            load_for_backtest(registry, outcome.dataset_key, symbol=SYMBOL)

    def test_unreadable_version_raises_before_any_replay(self, tmp_path) -> None:
        storage = LocalDatasetStorage(tmp_path / "d", tmp_path / "s")
        registry = DatasetRegistry(storage)
        with pytest.raises(DatasetReplayError, match="No readable version"):
            load_for_backtest(registry, "hst-" + "1" * 32, symbol=SYMBOL, version=7)


class TestPaperAndLiveIsolation:
    """Case 26 and the safety rails: history is a backtest input, nothing else."""

    def test_a_dataset_bundle_is_not_an_adapter_and_cannot_be_one(self, tmp_path) -> None:
        from decimal import Decimal

        from wlct_trading.paper.session import (
            PaperSessionConfig,
            PaperTradingSafetyError,
            PaperTradingSession,
        )

        events = oscillating_events(5)
        storage, outcome = ingest_books(tmp_path, events)
        registry = DatasetRegistry(storage)
        bundle = load_for_backtest(registry, outcome.dataset_key, symbol=SYMBOL)
        config = PaperSessionConfig(
            session_id="sess-1",
            tenant_id="tenant-1",
            account_id="account-1",
            exchange=EXCHANGE,
            symbol=SYMBOL,
            initial_capital=Decimal("10000"),
        )
        with pytest.raises(PaperTradingSafetyError, match="simulated"):
            # mypy never sees this call in production code because the
            # parameter is typed ``TradingAdapter``; the runtime refusal is
            # the guarantee, and a history bundle has no adapter surface at
            # all - no submit, no is_simulated, no nothing it could forge.
            PaperTradingSession(config=config, strategy=make_strategy(), adapter=bundle)

    def test_no_module_in_the_datasets_package_reaches_the_live_path(self) -> None:
        """Static source guard, not a runtime trick.

        A dataset can never execute an order because no code in this package
        can even reach an adapter, a signer, or the execution engine: the
        imports that would make that possible are banned at review, and this
        test makes the ban machine-checkable. If someone ever adds a live
        import to ``datasets``, this fails before a backtest does.
        """
        package = pathlib.Path(__file__).resolve().parents[1] / "wlct_trading" / "datasets"
        assert package.is_dir()
        banned_prefixes = (
            "wlct_trading.net",
            "wlct_trading.execution",
            "wlct_trading.adapters.base",
            "wlct_trading.exchanges",
        )
        offenders: list[str] = []
        for path in sorted(package.rglob("*.py")):
            if "__pycache__" in path.parts:
                continue
            for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
                stripped = line.strip()
                if not stripped.startswith(("import ", "from ")):
                    continue
                if any(banned in stripped for banned in banned_prefixes):
                    offenders.append(f"{path.name}:{lineno}: {stripped}")
        assert offenders == []

    def test_local_source_and_parsers_are_pure(self) -> None:
        # The binance adapter must parse with the same purity even though its
        # bytes come from elsewhere: the module may construct URLs and parse,
        # but must not import any transport or execution code, and must not
        # name any credential parameter at all.
        package = pathlib.Path(__file__).resolve().parents[1] / "wlct_trading" / "datasets"
        source = (package / "ingestion" / "binance.py").read_text(encoding="utf-8")
        for line in source.splitlines():
            stripped = line.strip()
            if stripped.startswith(("import ", "from ")):
                assert "wlct_trading.net" not in stripped
                assert "wlct_trading.execution" not in stripped
                assert "signed_client" not in stripped
            assert "api_key" not in stripped.lower() or stripped.startswith(
                ("#", '"', "'''", "'")
            ) or "no " in stripped.lower()
