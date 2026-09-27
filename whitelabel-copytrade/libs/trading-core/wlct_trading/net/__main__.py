"""CLI entry point: ``python -m wlct_trading.net``.

Starts the live public market-data feed described by the environment, reports
health while it runs, and shuts down cleanly on SIGINT or SIGTERM.

This command **does not trade**. It has no access to credentials and submits no
orders; it opens public websocket streams and public REST snapshot requests.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys

from wlct_trading.net.config import InvalidTransportSettings, TransportSettings
from wlct_trading.net.runner import MarketDataRunner, configure_logging


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m wlct_trading.net",
        description=(
            "Stream public market data from a supported exchange through the "
            "trading-core connectivity pipeline. Public data only: no API "
            "credentials are used and no orders are submitted."
        ),
    )
    parser.add_argument(
        "--duration",
        type=float,
        default=None,
        metavar="SECONDS",
        help="Stop after this many seconds. Omit to run until signalled.",
    )
    parser.add_argument(
        "--symbols",
        type=str,
        default=None,
        help=(
            "Comma-separated symbols, overriding MARKET_DATA_SYMBOLS. "
            "Accepts BTC/USDT, BTC-USDT or BTCUSDT."
        ),
    )
    parser.add_argument(
        "--log-level",
        type=str,
        default=os.environ.get("LOG_LEVEL", "INFO"),
        help="Logging level (default: INFO, or LOG_LEVEL).",
    )
    parser.add_argument(
        "--plain-logs",
        action="store_true",
        help="Human-readable logs instead of JSON.",
    )
    parser.add_argument(
        "--print-config",
        action="store_true",
        help="Print the resolved configuration and exit without connecting.",
    )
    return parser


async def _main(argv: list[str]) -> int:
    args = build_parser().parse_args(argv)
    configure_logging(args.log_level, structured=not args.plain_logs)

    environment = dict(os.environ)
    if args.symbols:
        environment["MARKET_DATA_SYMBOLS"] = args.symbols

    try:
        settings = TransportSettings.from_env(environment)
    except InvalidTransportSettings as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        return 2

    if args.print_config:
        import json

        print(json.dumps(settings.to_public_dict(), indent=2, sort_keys=True))
        return 0

    runner = MarketDataRunner(settings)
    runner.install_signal_handlers(asyncio.get_running_loop())
    health = await runner.run(duration_seconds=args.duration)

    # A non-zero exit for a run that never reached a healthy state, so a
    # supervisor or CI job notices rather than reading "exited 0" as success.
    return 0 if health.messages_received > 0 else 1


def main() -> int:
    try:
        return asyncio.run(_main(sys.argv[1:]))
    except KeyboardInterrupt:  # pragma: no cover - interactive
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
