#!/usr/bin/env python3
"""OPTIONAL: public Binance historical ingestion smoke test.

Not part of the offline suite and never run by CI. A normal test run must not
reach the network; this script exists so an operator can verify, on purpose
and out loud, that the ingestion path works against the real public archive.

What it does:
  1. downloads ONE day of public aggTrades for the configured symbol from
     data.binance.vision (no credentials - the archive is public);
  2. normalises, stages, validates and finalises it as a dataset version;
  3. re-verifies content checksum through the replay reader;
  4. runs the Part 6 engine over the dataset and asserts two runs are
     byte-identical.

What it never does: place an order, read a credential, write anything outside
the dataset/staging roots. Exit codes: 0 ok, 1 verification failure,
2 refused invocation.
"""

from __future__ import annotations

import argparse
import sys
import tempfile
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

TRADING_CORE = Path(__file__).resolve().parents[1] / "libs" / "trading-core"
if str(TRADING_CORE) not in sys.path:
    sys.path.insert(0, str(TRADING_CORE))

from wlct_trading.backtest.engine import BacktestConfig, BacktestEngine
from wlct_trading.datasets.ingestion.base import IngestionRequest
from wlct_trading.datasets.ingestion.binance import (
    BinanceFetchError,
    BinanceVisionSource,
)
from wlct_trading.datasets.ingestion.pipeline import IngestionPipeline
from wlct_trading.datasets.registry import DatasetRegistry
from wlct_trading.datasets.replay.source import load_for_backtest
from wlct_trading.datasets.storage.local import LocalDatasetStorage
from wlct_trading.enums import ExchangeId, MarketEventKind, MarketType
from wlct_trading.risk import RiskLimits
from wlct_trading.signals import StrategyDescriptor, StrategyRiskProfile
from wlct_trading.strategies import build_default_strategy_registry

_SYMBOL = "BTC-USDT"
_MICROS_PER_DAY = 86_400_000_000


def _utc_midnight_micros(day: date) -> int:
    import calendar
    import time

    return calendar.timegm(time.strptime(day.isoformat(), "%Y-%m-%d")) * 1_000_000


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--i-understand-this-downloads",
        action="store_true",
        help="required: this script opens an HTTPS connection to the public archive",
    )
    parser.add_argument("--symbol", default=_SYMBOL, help="canonical symbol, e.g. BTC-USDT")
    parser.add_argument(
        "--days-back",
        type=int,
        default=4,
        help="how many days before today to fetch (venues delay publication)",
    )
    parser.add_argument("--datasets-root", default=None, help="default: a temp directory")
    parser.add_argument("--keep", action="store_true", help="keep the temp dataset tree")
    args = parser.parse_args(argv)

    if not args.i_understand_this_downloads:
        print(
            "refusing to run: add --i-understand-this-downloads. This smoke test fetches\n"
            "from data.binance.vision. Public data, no credentials, no orders - but CI\n"
            "stays offline, so the network flag has to be the operator typing it.",
            file=sys.stderr,
        )
        return 2
    if args.days_back < 2 or args.days_back > 30:
        print("days-back must be between 2 and 30 (archive publication lag is real)", file=sys.stderr)
        return 2

    from urllib.request import URLError, urlopen

    def fetch(url: str) -> bytes:
        with urlopen(url, timeout=120) as response:
            return bytes(response.read())

    day = date.today() - timedelta(days=args.days_back)
    start = _utc_midnight_micros(day)
    end = start + _MICROS_PER_DAY - 1

    root_ctx = None
    if args.datasets_root is None:
        root_ctx = tempfile.TemporaryDirectory(prefix="wlct-dataset-smoke-")
        base = Path(root_ctx.name)
    else:
        base = Path(args.datasets_root)

    try:
        storage = LocalDatasetStorage(base / "datasets", base / "staging")
        source = BinanceVisionSource(fetch=fetch)
        request = IngestionRequest(
            exchange=ExchangeId.BINANCE,
            market_type=MarketType.SPOT,
            symbols=(args.symbol,),
            kinds=(MarketEventKind.TRADE,),
            start_micros=start,
            end_micros=end,
            granularity="event",
        )
        print(f"fetching {args.symbol} aggTrades for {day.isoformat()} ...")
        pipeline = IngestionPipeline(storage, source=source, name="smoke ingestion")
        try:
            outcome = pipeline.ingest(request, job_key=f"smoke-{day.isoformat()}", version=1)
        except BinanceFetchError as exc:
            print(f"fetch failed cleanly: {exc}", file=sys.stderr)
            return 1
        print(
            f"finalised {outcome.dataset_key} v{outcome.version}: {outcome.events_written} "
            f"events, checksum {outcome.manifest.content_checksum[:16]}..."
        )

        registry = DatasetRegistry(storage)
        mismatches = registry.verify_manifest_integrity(outcome.dataset_key, outcome.version)
        if mismatches:
            print(f"file integrity FAILED: {mismatches}", file=sys.stderr)
            return 1
        print("file integrity: clean")

        results = []
        for attempt in (1, 2):
            bundle = load_for_backtest(registry, outcome.dataset_key, symbol=args.symbol)
            registry_strat = build_default_strategy_registry()
            strategy = registry_strat.create(
                "DETERMINISTIC_IMBALANCE_V1",
                "1.0.0",
                symbol=args.symbol,
                descriptor=StrategyDescriptor(
                    strategy_id="smoke",
                    tenant_id="smoke",
                    name="smoke",
                    version="1.0.0",
                    enabled=True,
                    exchange=ExchangeId.BINANCE,
                    symbols=(args.symbol,),
                    risk_profile=StrategyRiskProfile(
                        max_order_quantity=Decimal("1"),
                        max_position_quantity=Decimal("1"),
                        max_order_notional=Decimal("1000000"),
                        max_daily_loss=Decimal("100000"),
                        max_open_orders=50,
                        max_orders_per_minute=600,
                    ),
                ),
                parameters={"use_limit_orders": False, "signal_cooldown_micros": 0},
            )
            config = BacktestConfig(
                tenant_id="smoke",
                account_id="smoke",
                initial_capital=Decimal("10000"),
                risk_limits=RiskLimits(
                    max_order_quantity=Decimal("1"),
                    max_order_notional=Decimal("1000000"),
                    max_position_quantity=Decimal("1"),
                    max_symbol_exposure_notional=Decimal("1000000"),
                    max_account_exposure_notional=Decimal("1000000"),
                    max_open_orders=50,
                    max_orders_per_minute=600,
                    max_daily_loss=Decimal("1000000"),
                    max_strategy_loss=Decimal("1000000"),
                    max_price_deviation_percent=Decimal("100"),
                    max_market_data_age_micros=60_000_000,
                ),
            )
            results.append(BacktestEngine(strategy=strategy, dataset=bundle.dataset, config=config).run())

        if not results[0].matches(results[1]):
            print("reproducibility FAILED: two runs over one dataset version differed", file=sys.stderr)
            return 1
        print(
            "reproducible: two independent backtests over the same dataset version are "
            "identical\n"
            f"dataset id in result: {results[0].dataset.dataset_id}\n"
            f"events replayed: {results[0].events_replayed}\n"
        )
        print(
            "BACKTEST PERFORMANCE IS NOT INDICATIVE OF FUTURE PERFORMANCE.\n"
            "SIMULATION DOES NOT GUARANTEE REAL EXECUTION QUALITY."
        )
        return 0
    except URLError as exc:
        print(f"network unavailable (expected offline): {exc.reason}", file=sys.stderr)
        return 1
    finally:
        if root_ctx is not None and not args.keep:
            root_ctx.cleanup()
        elif root_ctx is not None:
            print(f"dataset tree kept at {base}")


if __name__ == "__main__":
    raise SystemExit(main())
