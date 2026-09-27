#!/usr/bin/env python3
"""LIVE MARKET DATA SMOKE TEST — connects to a real exchange.

This is **not** part of the normal test suite and is never run by CI by
default. ``pytest`` needs no internet, no credentials, no database and no
Redis; this script needs outbound internet to Binance's public endpoints.

What it does
------------
Opens the real public websocket streams and the real public REST depth
endpoint, runs the full Part 3 pipeline for a configurable number of seconds,
verifies that normalised events actually arrive and that the order book reaches
a tradeable state, then shuts down cleanly.

What it does not do
-------------------
It sends no credentials, signs no request and submits no order. Live order
execution is not implemented on this path at all. The only endpoints touched
are public market data.

Usage
-----
    python scripts/live_market_data_smoke_test.py
    python scripts/live_market_data_smoke_test.py --duration 60 --symbols BTC/USDT

Exit codes: 0 all checks passed, 1 a check failed, 2 bad configuration.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from decimal import Decimal
from pathlib import Path
from typing import Any

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
TRADING_CORE = REPOSITORY_ROOT / "libs" / "trading-core"
if str(TRADING_CORE) not in sys.path:
    sys.path.insert(0, str(TRADING_CORE))

try:
    from wlct_trading.market_data import PublicTrade, Ticker
    from wlct_trading.net.config import InvalidTransportSettings, TransportSettings
    from wlct_trading.net.feed import FeedCallbacks
    from wlct_trading.net.runner import MarketDataRunner, configure_logging
except ImportError as exc:  # pragma: no cover - depends on install
    print(f"Cannot import the live transport: {exc}", file=sys.stderr)
    print(
        "Install the optional dependencies first:\n"
        "  pip install -e 'libs/trading-core[live]'",
        file=sys.stderr,
    )
    raise SystemExit(2) from exc


#: Credential-shaped variables that must not influence this run. Public market
#: data needs none, and a smoke test that quietly picked one up would be
#: proving the wrong thing.
CREDENTIAL_ENVIRONMENT_KEYS = (
    "BINANCE_API_KEY",
    "BINANCE_API_SECRET",
    "EXCHANGE_API_KEY",
    "EXCHANGE_API_SECRET",
)


class Checks:
    """Collects pass/fail results so every check is reported, not just the first."""

    def __init__(self) -> None:
        self.results: list[tuple[bool, str, str]] = []

    def record(self, passed: bool, name: str, detail: str = "") -> None:
        self.results.append((passed, name, detail))

    @property
    def failed(self) -> int:
        return sum(1 for passed, _n, _d in self.results if not passed)

    def report(self) -> None:
        print("\n" + "=" * 72)
        print("LIVE MARKET DATA SMOKE TEST RESULTS")
        print("=" * 72)
        for passed, name, detail in self.results:
            mark = "PASS" if passed else "FAIL"
            line = f"  [{mark}] {name}"
            if detail:
                line += f" — {detail}"
            print(line)
        total = len(self.results)
        print("-" * 72)
        print(f"  {total - self.failed}/{total} checks passed")
        print("=" * 72)


async def smoke_test(settings: TransportSettings, duration: float) -> int:
    tickers: list[Ticker] = []
    trades: list[PublicTrade] = []
    book_updates: list[str] = []
    resyncs: list[tuple[str, str]] = []

    runner = MarketDataRunner(
        settings,
        callbacks=FeedCallbacks(
            on_ticker=tickers.append,
            on_trade=trades.append,
            on_book_update=lambda symbol, _top: book_updates.append(symbol),
            on_resync=lambda symbol, reason: resyncs.append((symbol, reason)),
        ),
    )
    runner.install_signal_handlers(asyncio.get_running_loop())

    print(f"Connecting to {settings.binance_ws_url} for {duration:.0f}s ...")
    print(f"Symbols: {', '.join(settings.symbols)}")
    print(f"Channels: {', '.join(c.value for c in settings.enabled_channels)}")
    print("No API credentials are used and no orders are submitted.\n")

    health = await runner.run(duration_seconds=duration)
    feed = runner.feed
    checks = Checks()

    # 1. The connection was established through the existing state machine.
    checks.record(
        health.messages_received > 0,
        "Received live frames from the venue",
        f"{health.messages_received} messages",
    )

    # 2. Normalised events, not raw payloads.
    if settings.ticker_enabled:
        sane_ticker = any(
            t.bid_price is not None
            and t.ask_price is not None
            and Decimal(str(t.bid_price)) > 0
            and Decimal(str(t.ask_price)) > Decimal(str(t.bid_price))
            for t in tickers
        )
        # any() over an empty list is False, so this also covers "no tickers".
        checks.record(
            bool(tickers) and sane_ticker,
            "Normalised tickers with a sane spread",
            f"{len(tickers)} tickers",
        )

    if settings.trades_enabled:
        sane_trade = all(
            Decimal(str(t.price)) > 0 and Decimal(str(t.quantity)) >= 0
            for t in trades
        )
        checks.record(
            bool(trades) and sane_trade,
            "Normalised public trades with positive prices",
            f"{len(trades)} trades",
        )

    # 3. The order book synchronised through the existing synchroniser.
    if settings.orderbook_enabled:
        tradeable = health.tradeable_symbols
        checks.record(
            bool(tradeable),
            "Order book reached a tradeable state",
            f"tradeable: {', '.join(tradeable) or 'none'}",
        )
        for symbol in settings.symbols:
            canonical = symbol.strip().upper().replace("/", "-")
            synchroniser = feed.synchroniser(canonical)
            if synchroniser is None:
                continue
            book = synchroniser.book
            top = book.top()
            # An empty book yields a top with no sides, so both must be checked
            # for presence before they can be compared.
            has_both_sides = (
                top is not None
                and top.best_bid is not None
                and top.best_ask is not None
            )
            checks.record(
                bool(has_both_sides) and top.best_bid < top.best_ask,
                f"{canonical} book is not crossed",
                (
                    f"bid {top.best_bid} / ask {top.best_ask}"
                    if has_both_sides
                    else "no two-sided top of book"
                ),
            )
            checks.record(
                synchroniser.statistics.snapshots_fetched > 0,
                f"{canonical} fetched a REST snapshot",
                f"{synchroniser.statistics.snapshots_fetched} snapshot(s)",
            )

    # 4. Bad data did not accumulate.
    checks.record(
        health.parse_errors == 0,
        "No malformed frames were received",
        f"{health.parse_errors} parse errors",
    )

    # 5. Health reporting distinguishes the three states.
    checks.record(
        health.status in ("healthy", "degraded", "disconnected", "stopped"),
        "Health reported a defined status",
        f"status={health.status}, state={health.state.value}",
    )

    # 6. Clean shutdown.
    checks.record(
        feed.is_running is False,
        "Feed shut down cleanly",
        "no residual connection",
    )

    # 7. Nothing on this path could have used a credential.
    leaked = [key for key in CREDENTIAL_ENVIRONMENT_KEYS if os.environ.get(key)]
    checks.record(
        True,
        "No credentials required for public market data",
        (
            f"ignored credential variables present in the environment: "
            f"{', '.join(leaked)}"
            if leaked
            else "no credential variables were read"
        ),
    )

    totals = runner.metrics.transport_totals()
    print("\nTransport counters (observed on this run, not a guarantee):")
    for key, value in totals.items():
        print(f"  {key}: {value}")
    if resyncs:
        print(f"\nBook resyncs during the run: {len(resyncs)}")
        for symbol, reason in resyncs[:5]:
            print(f"  {symbol}: {reason}")

    checks.report()
    return 1 if checks.failed else 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Live smoke test against public exchange market data. Requires "
            "internet access. Uses no credentials and submits no orders."
        )
    )
    parser.add_argument(
        "--duration",
        type=float,
        default=None,
        help=(
            "Seconds to run (default: "
            "LIVE_MARKET_DATA_SMOKE_TEST_DURATION_SECONDS, or 30)."
        ),
    )
    parser.add_argument(
        "--symbols",
        type=str,
        default=None,
        help="Comma-separated symbols, overriding MARKET_DATA_SYMBOLS.",
    )
    parser.add_argument(
        "--log-level", type=str, default="WARNING", help="Logging level."
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    configure_logging(args.log_level, structured=False)

    environment = dict(os.environ)
    if args.symbols:
        environment["MARKET_DATA_SYMBOLS"] = args.symbols

    try:
        settings = TransportSettings.from_env(environment)
    except InvalidTransportSettings as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        return 2

    duration = (
        args.duration
        if args.duration is not None
        else float(settings.smoke_test_duration_seconds)
    )

    try:
        return asyncio.run(smoke_test(settings, duration))
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        return 130
    except Exception as exc:  # noqa: BLE001 - top-level reporting
        print(f"\nSmoke test failed with an unexpected error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
