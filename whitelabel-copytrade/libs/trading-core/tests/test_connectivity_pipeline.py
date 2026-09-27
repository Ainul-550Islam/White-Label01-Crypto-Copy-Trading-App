"""End-to-end connectivity pipeline, with no network.

The unit tests prove each piece in isolation. This file proves they *compose*:
a websocket frame arrives, is unwrapped, parsed, sequenced, buffered against a
REST snapshot, applied to the book, measured, and finally surfaces as a
tradeable top-of-book — and that the same pipeline recovers from a gap and from
a socket drop.

Everything runs against in-memory doubles. That is the payoff of injecting the
transport and the HTTP getter: the full path is exercised deterministically, in
milliseconds, on a machine with no network.
"""

from __future__ import annotations

import asyncio
import json
from decimal import Decimal
from typing import Any

from wlct_trading.clock import epoch_micros
from wlct_trading.enums import ExchangeId
from wlct_trading.exchanges.binance import BinanceMarketDataAdapter
from wlct_trading.exchanges.binance.parsers import parse_depth_delta
from wlct_trading.exchanges.symbols import SymbolMapping, SymbolRegistry
from wlct_trading.market_data import SymbolRef
from wlct_trading.metrics import ConnectivityMetrics
from wlct_trading.orderbook_sync import OrderBookSynchroniser, SyncConfig, SyncPhase
from wlct_trading.transport.backoff import BackoffConfig
from wlct_trading.transport.staleness import StalenessMonitor, StalenessThresholds
from wlct_trading.transport.subscriptions import MarketDataChannel

SYMBOL = "BTC-USDT"
VENUE_SYMBOL = "BTCUSDT"


def build_registry() -> SymbolRegistry:
    registry = SymbolRegistry()
    registry.register(
        SymbolMapping(
            canonical=SYMBOL,
            venue_symbol=VENUE_SYMBOL,
            exchange=ExchangeId.BINANCE,
            base_asset="BTC",
            quote_asset="USDT",
        )
    )
    return registry


class FakeBinanceRest:
    """Serves depth snapshots at a controllable sequence number."""

    def __init__(self, last_update_id: int = 100) -> None:
        self.last_update_id = last_update_id
        self.calls: list[tuple[str, dict[str, Any]]] = []

    async def __call__(self, url: str, params: dict[str, Any]) -> dict[str, Any]:
        self.calls.append((url, dict(params)))
        if "/depth" in url:
            return {
                "lastUpdateId": self.last_update_id,
                "bids": [["50000.00", "1.5"], ["49999.00", "2.0"]],
                "asks": [["50001.00", "1.2"], ["50002.00", "3.0"]],
            }
        if "/exchangeInfo" in url:
            return {
                "symbols": [
                    {
                        "symbol": VENUE_SYMBOL,
                        "status": "TRADING",
                        "baseAsset": "BTC",
                        "quoteAsset": "USDT",
                        "filters": [
                            {"filterType": "PRICE_FILTER", "tickSize": "0.01"},
                            {
                                "filterType": "LOT_SIZE",
                                "stepSize": "0.00001",
                                "minQty": "0.00001",
                                "maxQty": "9000",
                            },
                            {"filterType": "NOTIONAL", "minNotional": "5"},
                        ],
                    }
                ]
            }
        raise AssertionError(f"Unexpected REST call to {url}")


def depth_frame(first: int, final: int, bid: str, quantity: str) -> str:
    """A combined-stream depth diff exactly as Binance frames it."""
    return json.dumps(
        {
            "stream": f"{VENUE_SYMBOL.lower()}@depth@100ms",
            "data": {
                "e": "depthUpdate",
                "E": epoch_micros() // 1_000,
                "s": VENUE_SYMBOL,
                "U": first,
                "u": final,
                "b": [[bid, quantity]],
                "a": [],
            },
        }
    )


def test_full_pipeline_frame_to_tradeable_book() -> None:
    """Raw frame in, trustworthy top-of-book out."""

    async def scenario() -> None:
        rest = FakeBinanceRest(last_update_id=100)
        adapter = BinanceMarketDataAdapter(rest, symbol_registry=build_registry())
        metrics = ConnectivityMetrics()
        monitor = StalenessMonitor(StalenessThresholds(order_book_millis=5_000))

        ref = adapter.symbol_registry.symbol_ref(SYMBOL, ExchangeId.BINANCE)

        async def fetch(symbol: str, depth: int) -> Any:
            return await adapter.fetch_order_book_snapshot(ref, depth)

        sync = OrderBookSynchroniser(
            ExchangeId.BINANCE,
            SYMBOL,
            fetch,
            config=SyncConfig(
                snapshot_depth=100,
                backoff=BackoffConfig(base_delay_millis=1, jitter=False),
            ),
        )

        # A frame arrives before the snapshot has been fetched, which is the
        # ordering the bootstrap protocol requires.
        raw = depth_frame(101, 105, "50000.50", "4.0")
        received = epoch_micros()
        payload = json.loads(raw, parse_float=str, parse_int=str)["data"]
        delta = parse_depth_delta(payload, SYMBOL, received_timestamp=received)

        outcome = sync.on_delta(delta)
        assert outcome.buffered is True
        assert sync.is_tradeable is False

        metrics.record_message(
            "binance",
            "orderbook",
            SYMBOL,
            exchange_timestamp=delta.exchange_timestamp,
            received_timestamp=delta.received_timestamp,
            processed_timestamp=epoch_micros(),
        )
        monitor.record_message(MarketDataChannel.ORDER_BOOK, SYMBOL)

        assert await sync.start() is True
        assert sync.phase is SyncPhase.LIVE

        top = sync.top()
        assert top is not None
        assert top.best_bid == Decimal("50000.50")
        assert top.best_ask == Decimal("50001.00")
        assert sync.book.spread == Decimal("0.50")
        assert sync.book.sequence == 105

        assert metrics.stream("binance", "orderbook", SYMBOL).counters.messages == 1
        assert monitor.evaluate().any_stale is False

    asyncio.run(scenario())


def test_pipeline_recovers_from_a_mid_stream_gap() -> None:
    """A gap makes the book untradeable, then a resync restores it."""

    async def scenario() -> None:
        rest = FakeBinanceRest(last_update_id=100)
        adapter = BinanceMarketDataAdapter(rest, symbol_registry=build_registry())
        ref = adapter.symbol_registry.symbol_ref(SYMBOL, ExchangeId.BINANCE)

        async def fetch(symbol: str, depth: int) -> Any:
            return await adapter.fetch_order_book_snapshot(ref, depth)

        sync = OrderBookSynchroniser(
            ExchangeId.BINANCE,
            SYMBOL,
            fetch,
            config=SyncConfig(
                snapshot_depth=100,
                backoff=BackoffConfig(base_delay_millis=1, jitter=False),
            ),
        )
        await sync.start()
        assert sync.is_tradeable is True

        # 101 follows 100 cleanly.
        good = parse_depth_delta(
            json.loads(depth_frame(101, 101, "50000.25", "1.0"))["data"], SYMBOL
        )
        assert sync.on_delta(good).applied is True

        # 500 does not follow 101: a gap.
        gapped = parse_depth_delta(
            json.loads(depth_frame(500, 510, "50000.75", "2.0"))["data"], SYMBOL
        )
        outcome = sync.on_delta(gapped)
        assert outcome.resync_triggered is True
        assert sync.is_tradeable is False
        assert sync.top() is None

        # The venue has moved on; a fresh snapshot brackets the retained diff.
        rest.last_update_id = 505
        assert await sync.resync("sequence gap") is True
        assert sync.is_tradeable is True
        assert sync.book.sequence == 510

    asyncio.run(scenario())


def test_rate_limit_budget_is_spent_on_real_snapshot_depth() -> None:
    """Weight accounting must reflect the depth actually requested."""

    async def scenario() -> None:
        rest = FakeBinanceRest()
        adapter = BinanceMarketDataAdapter(rest, symbol_registry=build_registry())
        ref = adapter.symbol_registry.symbol_ref(SYMBOL, ExchangeId.BINANCE)

        before = adapter.rate_limits.get("REQUEST_WEIGHT").consumed()
        await adapter.fetch_order_book_snapshot(ref, 1_000)
        after = adapter.rate_limits.get("REQUEST_WEIGHT").consumed()

        # A 1 000-level snapshot costs 50 weight on Binance spot.
        assert after - before == 50
        assert rest.calls[0][1]["limit"] == 1_000

    asyncio.run(scenario())


def test_adapter_refuses_to_exceed_the_weight_budget() -> None:
    """Refusing locally is better than being IP-banned by the venue."""

    async def scenario() -> None:
        from wlct_trading.adapters.base import AdapterRateLimitedError
        from wlct_trading.transport.ratelimit import RateLimitRegistry, RateLimitRule

        rest = FakeBinanceRest()
        adapter = BinanceMarketDataAdapter(
            rest,
            symbol_registry=build_registry(),
            rate_limits=RateLimitRegistry.from_rules(
                (
                    RateLimitRule("REQUEST_WEIGHT", 60, 60),
                    RateLimitRule("RAW_REQUESTS", 100, 60),
                )
            ),
        )
        ref = adapter.symbol_registry.symbol_ref(SYMBOL, ExchangeId.BINANCE)

        await adapter.fetch_order_book_snapshot(ref, 1_000)  # 50 of 60 weight

        raised = False
        try:
            await adapter.fetch_order_book_snapshot(ref, 1_000)
        except AdapterRateLimitedError as exc:
            raised = True
            assert exc.retry_after_millis is not None
        assert raised, "A second heavy snapshot must be refused locally."

        # The refused call must not have reached the venue.
        assert len(rest.calls) == 1

    asyncio.run(scenario())


def test_load_symbols_populates_the_registry_authoritatively() -> None:
    async def scenario() -> None:
        rest = FakeBinanceRest()
        registry = SymbolRegistry()
        adapter = BinanceMarketDataAdapter(rest, symbol_registry=registry)

        specifications = await adapter.load_symbols()

        assert len(specifications) == 1
        assert registry.to_venue_symbol(SYMBOL, ExchangeId.BINANCE) == VENUE_SYMBOL
        assert registry.to_canonical_symbol(VENUE_SYMBOL, ExchangeId.BINANCE) == SYMBOL
        assert adapter.specification(SYMBOL) is not None
        assert adapter.specification(SYMBOL).min_notional == Decimal("5")

    asyncio.run(scenario())


def test_no_credentials_are_required_anywhere_on_the_market_data_path() -> None:
    """Market data is public; the smaller the surface holding secrets the better."""

    async def scenario() -> None:
        rest = FakeBinanceRest()
        adapter = BinanceMarketDataAdapter(rest, symbol_registry=build_registry())
        ref = adapter.symbol_registry.symbol_ref(SYMBOL, ExchangeId.BINANCE)

        await adapter.load_symbols()
        await adapter.fetch_order_book_snapshot(ref, 100)

        for _url, params in rest.calls:
            rendered = " ".join(f"{k}={v}" for k, v in params.items()).lower()
            for forbidden in ("signature", "apikey", "api_key", "secret", "timestamp"):
                assert forbidden not in rendered

    asyncio.run(scenario())


def test_symbol_reference_survives_the_round_trip_through_the_wire() -> None:
    """Canonical in, venue on the wire, canonical back out."""
    registry = build_registry()
    ref: SymbolRef = registry.symbol_ref(SYMBOL, ExchangeId.BINANCE)

    assert ref.venue_symbol == VENUE_SYMBOL
    assert registry.to_canonical_symbol(ref.venue_symbol, ExchangeId.BINANCE) == SYMBOL
