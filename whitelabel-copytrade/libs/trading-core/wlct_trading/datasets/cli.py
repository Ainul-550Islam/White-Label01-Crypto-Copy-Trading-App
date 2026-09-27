"""Operator CLI for historical datasets: ``python -m wlct_trading.datasets.cli``.

Every subcommand here is deterministic and offline unless an operator names
the network explicitly:

* ``ingest-local`` - build a dataset from a directory of canonical JSONL
  files (the fixture path, the migration path, and the offline tests' path);
* ``ingest-binance`` - fetch Binance's public daily archives; requires
  ``--yes-network`` because normal operations of this CLI never touch a
  socket, and a command that does must say so on its own command line;
* ``list`` / ``info`` / ``validate`` / ``coverage`` - read the registry;
* ``quarantine`` / ``archive`` - status transitions with mandatory reasons;
* ``replay`` - stream a window and report what the reader saw (no strategy);
* ``backtest`` - run the Part 6 engine over a dataset window, twice, and
  assert the two results match before printing the summary.

Output is JSON on stdout (one object) so operators can pipe it; diagnostics
go to stderr. Nothing here talks to Postgres: the database projection of a
finalised dataset is the registration step's job, and ``--emit-registration``
writes the exact JSON document that step consumes.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from wlct_trading.datasets.ingestion.base import IngestionRequest
from wlct_trading.datasets.ingestion.local import LocalJsonlSource
from wlct_trading.datasets.ingestion.pipeline import IngestionPipeline
from wlct_trading.datasets.readers.streaming import StreamingDatasetReader
from wlct_trading.datasets.registry import DatasetRegistry
from wlct_trading.datasets.replay.source import load_for_backtest
from wlct_trading.datasets.storage.local import LocalDatasetStorage
from wlct_trading.enums import ExchangeId, MarketEventKind, MarketType

__all__ = ["main", "build_parser"]


def _micros(value: str) -> int:
    """Accept ISO-8601 dates or raw epoch microseconds, both unambiguously."""
    text = value.strip()
    if text.isdigit():
        return int(text)
    normalized = text.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(
            f"{value!r} is neither epoch microseconds nor an ISO-8601 timestamp"
        ) from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp() * 1_000_000)


def _storage(args: argparse.Namespace) -> LocalDatasetStorage:
    return LocalDatasetStorage(Path(args.datasets_root), Path(args.staging_root))


def _report(payload: object) -> None:
    json.dump(payload, sys.stdout, indent=2, sort_keys=True, default=str)
    sys.stdout.write("\n")


def cmd_ingest(args: argparse.Namespace) -> int:
    from wlct_trading.datasets.ingestion.base import HistoricalDataSource

    source: HistoricalDataSource
    if args.source == "local":
        source = LocalJsonlSource(
            Path(args.input),
            venue_symbol_map=_venue_map(args.venue_symbol),
        )
    else:
        if not args.yes_network:
            print(
                "error: --source binance fetches from data.binance.vision; add --yes-network "
                "to confirm you intend the download.",
                file=sys.stderr,
            )
            return 2
        from wlct_trading.datasets.ingestion.binance import BinanceVisionSource
        from urllib.request import urlopen

        def fetch(url: str) -> bytes:
            # https public archive, fixed host validated upstream; timeout is
            # explicit because a stalled CDN socket must not hang a job.
            with urlopen(url, timeout=60) as response:
                blob = response.read()
            return bytes(blob)

        source = BinanceVisionSource(fetch=fetch)
    request = IngestionRequest(
        exchange=ExchangeId(args.exchange),
        market_type=MarketType(args.market_type),
        symbols=tuple(args.symbol),
        kinds=tuple(MarketEventKind(kind) for kind in args.kind),
        start_micros=args.start,
        end_micros=args.end,
        granularity=args.granularity,
        retain_raw=args.retain_raw,
    )
    storage = _storage(args)
    pipeline = IngestionPipeline(
        storage,
        source=source,
        name=args.name,
        max_partition_bytes=args.max_partition_bytes,
        max_events_per_partition=args.max_events_per_partition,
        validation_enabled=not args.skip_validation,
    )
    outcome = pipeline.ingest(request, job_key=args.job_key, version=args.version)
    payload: dict[str, object] = {
        "ok": True,
        **outcome.to_dict(),
        "quality": outcome.quality.to_wire(),
    }
    if args.emit_registration:
        registration = {
            "datasetKey": outcome.dataset_key,
            "version": outcome.version,
            "name": args.name,
            "exchange": outcome.manifest.exchange.value,
            "symbols": list(outcome.manifest.symbols),
            "marketType": outcome.manifest.identity.market_type.value,
            "eventKinds": [kind.value for kind in outcome.manifest.event_kinds],
            "startMicros": str(outcome.manifest.start_micros),
            "endMicros": str(outcome.manifest.end_micros),
            "contentChecksum": outcome.manifest.content_checksum,
            "manifestJson": json.loads(outcome.manifest.to_json_bytes().decode("utf-8")),
            "validation": {
                "status": outcome.validation.status.value,
                "countsBySeverity": dict(outcome.validation.counts_by_severity),
                "countsByRule": dict(outcome.validation.counts_by_rule),
                "reportSha256": outcome.validation.digest,
                "policyDigest": outcome.validation.policy_digest,
                "durationMicros": str(outcome.validation.duration_micros),
            },
            "files": [entry.to_wire() for entry in outcome.manifest.files],
        }
        Path(args.emit_registration).write_text(
            json.dumps(registration, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        payload["registration"] = args.emit_registration
    _report(payload)
    return 0


def _venue_map(entries: list[str] | None) -> dict[str, str] | None:
    if not entries:
        return None
    mapping: dict[str, str] = {}
    for entry in entries:
        if "=" not in entry:
            raise SystemExit(f"--venue-symbol expects CANONICAL=VENUE, got {entry!r}")
        canonical, venue = entry.split("=", 1)
        mapping[canonical] = venue
    return mapping


def cmd_list(args: argparse.Namespace) -> int:
    registry = DatasetRegistry(_storage(args))
    rows = []
    for key in registry.datasets():
        for record in registry.versions(key):
            rows.append(
                {
                    "datasetKey": key,
                    "version": record.version,
                    "status": record.status.value,
                    "exchange": record.manifest.exchange.value,
                    "symbols": list(record.manifest.symbols),
                    "startMicros": record.manifest.start_micros,
                    "endMicros": record.manifest.end_micros,
                    "events": record.manifest.event_count,
                    "contentChecksum": record.manifest.content_checksum[:16],
                    "completeness": record.manifest.completeness.value,
                }
            )
    _report({"datasets": rows})
    return 0


def cmd_info(args: argparse.Namespace) -> int:
    registry = DatasetRegistry(_storage(args))
    record = registry.record(args.dataset_key, args.version)
    if record is None:
        print("error: no such version", file=sys.stderr)
        return 2
    storage = _storage(args)
    manifest = record.manifest
    report_bytes = storage.read_report(args.dataset_key, args.version)
    _report(
        {
            "manifest": json.loads(manifest.to_json_bytes().decode("utf-8")),
            "status": record.status.value,
            "manifestSha256": record.manifest_sha256,
            "report": json.loads(report_bytes.decode("utf-8")) if report_bytes is not None else None,
        }
    )
    return 0


def cmd_validate(args: argparse.Namespace) -> int:
    """Re-validate a published version from its bytes (never from its word)."""
    storage = _storage(args)
    registry = DatasetRegistry(storage)
    record = registry.record(args.dataset_key, args.version)
    if record is None:
        print("error: no such version", file=sys.stderr)
        return 2
    mismatches = registry.verify_manifest_integrity(args.dataset_key, args.version)
    if mismatches:
        _report({"ok": False, "integrity": "FAILED", "mismatches": list(mismatches)})
        return 1
    from wlct_trading.backtest.dataset import compute_dataset_checksum

    reader = StreamingDatasetReader(
        storage,
        record.manifest,
        verify_checksums=False,
    )
    content = compute_dataset_checksum(reader.events())
    matches = content == record.manifest.content_checksum
    _report(
        {
            "ok": matches,
            "fileIntegrity": "CLEAN",
            "contentChecksum": content,
            "matchesManifest": matches,
            "eventsRead": reader.stats.events_yielded,
            "bytesRead": reader.stats.bytes_read,
        }
    )
    return 0 if matches else 1


def cmd_coverage(args: argparse.Namespace) -> int:
    registry = DatasetRegistry(_storage(args))
    ranges = registry.coverage_ranges(
        exchange=ExchangeId(args.exchange),
        symbol=args.symbol,
        kind=MarketEventKind(args.kind) if args.kind else None,
    )
    _report(
        {
            "coverage": [
                {
                    "startMicros": start,
                    "endMicros": end,
                    "datasetKey": key,
                    "version": version,
                }
                for start, end, key, version in ranges
            ]
        }
    )
    return 0


def cmd_replay(args: argparse.Namespace) -> int:
    registry = DatasetRegistry(_storage(args))
    bundle = load_for_backtest(
        registry,
        args.dataset_key,
        symbol=args.symbol,
        version=args.version,
        start_micros=args.start,
        end_micros=args.end,
    )
    _report(
        {
            "events": len(bundle.dataset),
            "datasetId": bundle.dataset.descriptor.dataset_id,
            "checksum": bundle.dataset.descriptor.checksum,
            "readerStats": bundle.reader_stats,
            "firstEventMicros": (
                bundle.dataset.events[0].timestamp_micros if len(bundle.dataset) else None
            ),
            "lastEventMicros": (
                bundle.dataset.events[-1].timestamp_micros if len(bundle.dataset) else None
            ),
        }
    )
    return 0


def cmd_backtest(args: argparse.Namespace) -> int:
    from wlct_trading.backtest.engine import BacktestConfig, BacktestEngine
    from wlct_trading.risk import RiskLimits
    from wlct_trading.strategies import build_default_strategy_registry
    from wlct_trading.signals import StrategyDescriptor, StrategyRiskProfile

    registry = DatasetRegistry(_storage(args))
    capital = Decimal(args.initial_capital)
    limits = RiskLimits(
        max_order_quantity=Decimal(args.max_order_quantity),
        max_order_notional=Decimal("1000000"),
        max_position_quantity=Decimal(args.max_order_quantity),
        max_symbol_exposure_notional=Decimal("1000000"),
        max_account_exposure_notional=Decimal("1000000"),
        max_open_orders=50,
        max_orders_per_minute=600,
        max_daily_loss=capital,
        max_strategy_loss=capital,
        max_price_deviation_percent=Decimal("100"),
        max_market_data_age_micros=60_000_000,
    )

    def build_engine() -> BacktestEngine:
        bundle = load_for_backtest(
            registry,
            args.dataset_key,
            symbol=args.symbol,
            version=args.version,
            start_micros=args.start,
            end_micros=args.end,
        )
        strategy_registry = build_default_strategy_registry()
        strategy = strategy_registry.create(
            "DETERMINISTIC_IMBALANCE_V1",
            "1.0.0",
            symbol=args.symbol,
            descriptor=StrategyDescriptor(
                strategy_id="cli-strategy",
                tenant_id="cli",
                name="deterministic example",
                version="1.0.0",
                enabled=True,
                exchange=ExchangeId(args.exchange),
                symbols=(args.symbol,),
                risk_profile=StrategyRiskProfile(
                    max_order_quantity=Decimal(args.max_order_quantity),
                    max_position_quantity=Decimal(args.max_order_quantity),
                    max_order_notional=Decimal("1000000"),
                    max_daily_loss=capital,
                    max_open_orders=50,
                    max_orders_per_minute=600,
                ),
            ),
            parameters={"use_limit_orders": False, "signal_cooldown_micros": 0},
        )
        config = BacktestConfig(
            tenant_id="cli",
            account_id="cli-account",
            initial_capital=capital,
            risk_limits=limits,
            run_label=args.label,
        )
        return BacktestEngine(strategy=strategy, dataset=bundle.dataset, config=config)

    first = build_engine().run()
    second = build_engine().run()
    reproducible = first.matches(second)
    _report(
        {
            "runId": first.run_id,
            "identicalOnRerun": reproducible,
            "configurationHash": first.configuration_hash,
            "dataset": first.dataset.to_dict(),
            "metrics": first.metrics.to_dict(),
            "isSimulated": first.is_simulated,
            "disclaimer": first.to_dict()["disclaimer"],
        }
    )
    return 0 if reproducible else 1


def cmd_quarantine(args: argparse.Namespace) -> int:
    registry = DatasetRegistry(_storage(args))
    registry.quarantine(args.dataset_key, args.version, reason=args.reason)
    _report({"ok": True, "action": "quarantine", "datasetKey": args.dataset_key,
              "version": args.version})
    return 0


def cmd_archive(args: argparse.Namespace) -> int:
    registry = DatasetRegistry(_storage(args))
    if args.confirm != "ARCHIVE DATASET VERSION":
        print(
            'error: archiving requires --confirm "ARCHIVE DATASET VERSION" exactly.',
            file=sys.stderr,
        )
        return 2
    registry.archive(args.dataset_key, args.version, reason=args.reason)
    _report({"ok": True, "action": "archive", "datasetKey": args.dataset_key,
              "version": args.version})
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="wlct-trading-datasets",
        description="Historical dataset operations for the Part 6 backtest engine.",
    )
    parser.add_argument("--datasets-root", default="./data/datasets")
    parser.add_argument("--staging-root", default="./data/staging")
    sub = parser.add_subparsers(dest="command", required=True)

    def window(sp: argparse.ArgumentParser) -> None:
        sp.add_argument("--start", type=_micros, default=None)
        sp.add_argument("--end", type=_micros, default=None)

    ingest = sub.add_parser("ingest-local", help="ingest a directory of canonical JSONL")
    ingest.add_argument("--input", required=True)
    ingest.add_argument("--name", required=True)
    ingest.add_argument("--exchange", default="binance")
    ingest.add_argument("--market-type", default="SPOT")
    ingest.add_argument("--symbol", action="append", required=True)
    ingest.add_argument(
        "--kind", action="append", required=True,
        help="TICKER | TRADE | BOOK_SNAPSHOT | BOOK_DELTA | CANDLE",
    )
    ingest.add_argument("--venue-symbol", action="append", default=None)
    ingest.add_argument("--job-key", required=True)
    ingest.add_argument("--version", type=int, default=1)
    ingest.add_argument("--granularity", default="event")
    ingest.add_argument("--max-partition-bytes", type=int, default=268_435_456)
    ingest.add_argument("--max-events-per-partition", type=int, default=2_000_000)
    ingest.add_argument("--skip-validation", action="store_true")
    ingest.add_argument("--retain-raw", action="store_true")
    ingest.add_argument("--emit-registration", default=None)
    window(ingest)
    ingest.set_defaults(func=cmd_ingest, source="local", yes_network=False)

    bingest = sub.add_parser("ingest-binance", help="fetch public Binance daily archives")
    bingest.add_argument("--name", required=True)
    bingest.add_argument("--symbol", action="append", required=True)
    bingest.add_argument("--kind", action="append", required=True)
    bingest.add_argument("--job-key", required=True)
    bingest.add_argument("--version", type=int, default=1)
    bingest.add_argument("--exchange", default="binance")
    bingest.add_argument("--market-type", default="SPOT")
    bingest.add_argument("--granularity", default="event")
    bingest.add_argument("--max-partition-bytes", type=int, default=268_435_456)
    bingest.add_argument("--max-events-per-partition", type=int, default=2_000_000)
    bingest.add_argument("--skip-validation", action="store_true")
    bingest.add_argument("--retain-raw", action="store_true")
    bingest.add_argument("--emit-registration", default=None)
    bingest.add_argument(
        "--yes-network",
        action="store_true",
        help="required confirmation: this subcommand opens HTTPS connections",
    )
    window(bingest)
    bingest.set_defaults(func=cmd_ingest, source="binance")

    listing = sub.add_parser("list", help="list datasets and versions")
    listing.set_defaults(func=cmd_list)

    info = sub.add_parser("info", help="print one version's manifest and status")
    info.add_argument("dataset_key")
    info.add_argument("version", type=int)
    info.set_defaults(func=cmd_info)

    validate = sub.add_parser("validate", help="re-hash files and re-verify content")
    validate.add_argument("dataset_key")
    validate.add_argument("version", type=int)
    validate.set_defaults(func=cmd_validate)

    coverage = sub.add_parser("coverage", help="usable replay windows for a symbol")
    coverage.add_argument("--exchange", default="binance")
    coverage.add_argument("--symbol", required=True)
    coverage.add_argument("--kind", default=None)
    coverage.set_defaults(func=cmd_coverage)

    replay = sub.add_parser("replay", help="stream a window and report what it contains")
    replay.add_argument("dataset_key")
    replay.add_argument("--symbol", required=True)
    replay.add_argument("--version", type=int, default=None)
    window(replay)
    replay.set_defaults(func=cmd_replay)

    backtest = sub.add_parser("backtest", help="Part 6 backtest over a dataset window")
    backtest.add_argument("dataset_key")
    backtest.add_argument("--symbol", required=True)
    backtest.add_argument("--version", type=int, default=None)
    backtest.add_argument("--exchange", default="binance")
    backtest.add_argument("--initial-capital", default="10000")
    backtest.add_argument("--max-order-quantity", default="1")
    backtest.add_argument("--label", default="")
    window(backtest)
    backtest.set_defaults(func=cmd_backtest)

    quarantine = sub.add_parser("quarantine", help="mark a version unusable")
    quarantine.add_argument("dataset_key")
    quarantine.add_argument("version", type=int)
    quarantine.add_argument("--reason", required=True)
    quarantine.set_defaults(func=cmd_quarantine)

    archive = sub.add_parser("archive", help="retire a version (typed confirmation)")
    archive.add_argument("dataset_key")
    archive.add_argument("version", type=int)
    archive.add_argument("--reason", required=True)
    archive.add_argument("--confirm", required=True)
    archive.set_defaults(func=cmd_archive)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except Exception as exc:
        print(f"error: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":  # pragma: no cover - process entry point
    raise SystemExit(main())
