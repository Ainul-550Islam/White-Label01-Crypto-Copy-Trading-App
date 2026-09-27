"""Symbol normalisation, capability declarations and the adapter registry.

These are the pluggability seams. The tests assert the properties that make a
second venue cheap to add: symbols convert in both directions through one place,
capabilities are declared as data, and nothing venue-specific is required by the
generic layers.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from wlct_trading.adapters.base import SymbolSpecification
from wlct_trading.enums import ExchangeId, MarketType, OrderType, TimeInForce
from wlct_trading.exchanges.binance import (
    BINANCE_SPOT_CAPABILITIES,
    BinanceMarketDataAdapter,
    depth_endpoint_weight,
)
from wlct_trading.exchanges.capabilities import ExchangeCapabilities
from wlct_trading.exchanges.registry import (
    DuplicateRegistration,
    ExchangeRegistration,
    ExchangeRegistry,
    UnsupportedExchange,
)
from wlct_trading.exchanges.symbols import (
    SymbolMapping,
    SymbolRegistry,
    UnknownSymbol,
    canonicalise_asset,
    split_concatenated_symbol,
    to_canonical,
)
from wlct_trading.exchanges import build_default_registry
from wlct_trading.transport.subscriptions import MarketDataChannel


# ----------------------------------------------------------------------
# Symbols
# ----------------------------------------------------------------------
def test_canonical_form_is_upper_case_and_hyphenated() -> None:
    assert to_canonical("btc", "usdt") == "BTC-USDT"


def test_kraken_xbt_is_normalised_to_btc() -> None:
    """XBT and BTC are the same asset.

    Treating them as different instruments splits a position across two
    identities, and neither one shows the real exposure.
    """
    assert canonicalise_asset("XBT") == "BTC"
    assert canonicalise_asset("XXBT") == "BTC"
    assert to_canonical("XBT", "ZUSD") == "BTC-USD"


@pytest.mark.parametrize(
    ("venue_symbol", "expected"),
    [
        ("BTCUSDT", ("BTC", "USDT")),
        ("ETHBTC", ("ETH", "BTC")),
        ("SOLUSDC", ("SOL", "USDC")),
        ("DOGEUSDT", ("DOGE", "USDT")),
        ("FDUSDUSDT", ("FDUSD", "USDT")),
    ],
)
def test_concatenated_symbols_split_correctly(
    venue_symbol: str, expected: tuple[str, str]
) -> None:
    assert split_concatenated_symbol(venue_symbol) == expected


def test_longest_suffix_alone_would_split_xbtusd_wrongly() -> None:
    """Regression: XBTUSD ends with TUSD, so naive longest-match yields XB/TUSD.

    Preferring a candidate whose base is a recognised asset resolves it.
    """
    assert split_concatenated_symbol("XBTUSD") == ("BTC", "USD")


def test_unknown_quote_asset_returns_none_rather_than_guessing() -> None:
    assert split_concatenated_symbol("WHATEVERXYZ") is None


@pytest.mark.parametrize(
    ("venue_symbol", "expected"),
    [
        ("BTC-USDT", ("BTC", "USDT")),
        ("XBT/USD", ("BTC", "USD")),
        ("BTC_USDT", ("BTC", "USDT")),
        ("BTC:USDT", ("BTC", "USDT")),
    ],
)
def test_separator_conventions_are_all_understood(
    venue_symbol: str, expected: tuple[str, str]
) -> None:
    assert SymbolRegistry().parse_venue_symbol(venue_symbol) == expected


def test_registered_mapping_round_trips_in_both_directions() -> None:
    registry = SymbolRegistry()
    registry.register(
        SymbolMapping(
            canonical="BTC-USDT",
            venue_symbol="BTCUSDT",
            exchange=ExchangeId.BINANCE,
            base_asset="BTC",
            quote_asset="USDT",
        )
    )
    assert registry.to_venue_symbol("BTC-USDT", ExchangeId.BINANCE) == "BTCUSDT"
    assert registry.to_canonical_symbol("BTCUSDT", ExchangeId.BINANCE) == "BTC-USDT"


def test_unregistered_symbol_will_not_be_fabricated_for_an_order() -> None:
    """Strictness on the order path is deliberate.

    Guessing a venue symbol here means sending an order for an instrument that
    may not exist.
    """
    registry = SymbolRegistry()
    with pytest.raises(UnknownSymbol):
        registry.to_venue_symbol("BTC-USDT", ExchangeId.BINANCE)


def test_heuristic_can_be_refused_on_inbound_resolution() -> None:
    registry = SymbolRegistry()
    assert registry.to_canonical_symbol("BTCUSDT", ExchangeId.BINANCE) == "BTC-USDT"
    with pytest.raises(UnknownSymbol):
        registry.to_canonical_symbol(
            "BTCUSDT", ExchangeId.BINANCE, allow_heuristic=False
        )


def test_registering_a_specification_is_authoritative() -> None:
    """Venue metadata beats the heuristic, including for odd pairs."""
    registry = SymbolRegistry()
    registry.register_specification(
        SymbolSpecification(
            symbol="USDT-TRY",
            venue_symbol="USDTTRY",
            exchange=ExchangeId.BINANCE,
            market_type=MarketType.SPOT,
            base_asset="USDT",
            quote_asset="TRY",
            price_tick=Decimal("0.001"),
            quantity_step=Decimal("0.01"),
            min_quantity=Decimal("1"),
            max_quantity=None,
            min_notional=Decimal("10"),
            is_tradeable=True,
            price_precision=3,
            quantity_precision=2,
        )
    )
    assert registry.to_canonical_symbol("USDTTRY", ExchangeId.BINANCE) == "USDT-TRY"
    assert registry.to_venue_symbol("USDT-TRY", ExchangeId.BINANCE) == "USDTTRY"


def test_same_symbol_on_two_venues_stays_distinct() -> None:
    registry = SymbolRegistry()
    registry.register(
        SymbolMapping("BTC-USDT", "BTCUSDT", ExchangeId.BINANCE, "BTC", "USDT")
    )
    registry.register(
        SymbolMapping("BTC-USDT", "BTC-USDT", ExchangeId.OKX, "BTC", "USDT")
    )
    assert registry.to_venue_symbol("BTC-USDT", ExchangeId.BINANCE) == "BTCUSDT"
    assert registry.to_venue_symbol("BTC-USDT", ExchangeId.OKX) == "BTC-USDT"


def test_symbol_ref_carries_both_spellings() -> None:
    registry = SymbolRegistry()
    registry.register(
        SymbolMapping("BTC-USDT", "BTCUSDT", ExchangeId.BINANCE, "BTC", "USDT")
    )
    ref = registry.symbol_ref("BTC-USDT", ExchangeId.BINANCE)
    assert ref.symbol == "BTC-USDT"
    assert ref.venue_symbol == "BTCUSDT"
    assert ref.key == "binance:SPOT:BTC-USDT"


# ----------------------------------------------------------------------
# Capabilities
# ----------------------------------------------------------------------
def test_unsupported_order_type_is_reported_before_it_reaches_the_venue() -> None:
    capabilities = ExchangeCapabilities(
        exchange=ExchangeId.PAPER,
        display_name="Test Venue",
        order_types=frozenset({OrderType.LIMIT}),
        time_in_force=frozenset({TimeInForce.GTC}),
    )
    violations = capabilities.validate_order(
        order_type=OrderType.STOP_LIMIT, time_in_force=TimeInForce.GTC
    )
    assert len(violations) == 1
    assert violations[0].capability == "order_type"


def test_all_violations_are_reported_at_once() -> None:
    """An operator should see the whole problem, not fix it one error at a time."""
    capabilities = ExchangeCapabilities(
        exchange=ExchangeId.PAPER,
        display_name="Test Venue",
        order_types=frozenset({OrderType.LIMIT}),
        time_in_force=frozenset({TimeInForce.GTC}),
    )
    violations = capabilities.validate_order(
        order_type=OrderType.STOP,
        time_in_force=TimeInForce.FOK,
        post_only=True,
        reduce_only=True,
    )
    assert {v.capability for v in violations} == {
        "order_type",
        "time_in_force",
        "post_only",
        "reduce_only",
    }


def test_a_supported_order_produces_no_violations() -> None:
    violations = BINANCE_SPOT_CAPABILITIES.validate_order(
        order_type=OrderType.LIMIT, time_in_force=TimeInForce.GTC
    )
    assert violations == ()


def test_binance_spot_has_no_reduce_only() -> None:
    """Spot has no positions to reduce; claiming otherwise would mislead."""
    assert BINANCE_SPOT_CAPABILITIES.supports_reduce_only is False
    violations = BINANCE_SPOT_CAPABILITIES.validate_order(
        order_type=OrderType.LIMIT, time_in_force=TimeInForce.GTC, reduce_only=True
    )
    assert any(v.capability == "reduce_only" for v in violations)


def test_snapshot_depth_is_rounded_up_to_a_legal_value() -> None:
    """Requesting an unsupported depth is an error on most venues."""
    assert BINANCE_SPOT_CAPABILITIES.nearest_snapshot_depth(1) == 5
    assert BINANCE_SPOT_CAPABILITIES.nearest_snapshot_depth(150) == 500
    assert BINANCE_SPOT_CAPABILITIES.nearest_snapshot_depth(1_000) == 1_000
    assert BINANCE_SPOT_CAPABILITIES.nearest_snapshot_depth(99_999) == 5_000


@pytest.mark.parametrize(
    ("limit", "weight"),
    [(1, 5), (100, 5), (101, 25), (500, 25), (501, 50), (1_000, 50), (5_000, 250)],
)
def test_binance_depth_weight_tiers(limit: int, weight: int) -> None:
    """Weight is tiered steeply; a flat assumption overruns the budget."""
    assert depth_endpoint_weight(limit) == weight


def test_capabilities_serialise_without_credentials() -> None:
    public = BINANCE_SPOT_CAPABILITIES.to_public_dict()
    rendered = str(public).lower()
    for fragment in ("secret", "apikey", "password", "token"):
        assert fragment not in rendered


def test_binance_declares_the_channels_it_actually_implements() -> None:
    for channel in (
        MarketDataChannel.ORDER_BOOK,
        MarketDataChannel.TRADES,
        MarketDataChannel.BOOK_TICKER,
        MarketDataChannel.CANDLES,
    ):
        assert BINANCE_SPOT_CAPABILITIES.supports_channel(channel)


# ----------------------------------------------------------------------
# Registry
# ----------------------------------------------------------------------
def test_default_registry_exposes_binance() -> None:
    registry = build_default_registry()
    assert ExchangeId.BINANCE in registry.supported_exchanges()
    assert registry.is_supported(ExchangeId.BINANCE) is True


def test_unimplemented_venues_are_not_registered() -> None:
    """Better an explicit 'unsupported' than a runtime failure mid-order."""
    registry = build_default_registry()
    for exchange in (ExchangeId.BYBIT, ExchangeId.OKX, ExchangeId.KRAKEN):
        assert registry.is_supported(exchange) is False
        with pytest.raises(UnsupportedExchange):
            registry.get(exchange)


def test_market_data_only_venue_refuses_to_build_a_trading_adapter() -> None:
    """The registry must not imply an order path that does not exist."""
    registry = build_default_registry()
    with pytest.raises(UnsupportedExchange, match="market data only"):
        registry.create_trading_adapter(ExchangeId.BINANCE)
    assert registry.tradeable_exchanges() == ()


def test_duplicate_registration_is_refused_unless_explicit() -> None:
    """A silent overwrite would route orders through an unexpected adapter."""
    registry = build_default_registry()
    registration = ExchangeRegistration(
        exchange=ExchangeId.BINANCE,
        capabilities=BINANCE_SPOT_CAPABILITIES,
        market_data_factory=BinanceMarketDataAdapter,
    )
    with pytest.raises(DuplicateRegistration):
        registry.register(registration)
    registry.register(registration, replace=True)


def test_disabled_registration_is_not_routable() -> None:
    registry = ExchangeRegistry()
    registry.register(
        ExchangeRegistration(
            exchange=ExchangeId.BINANCE,
            capabilities=BINANCE_SPOT_CAPABILITIES,
            market_data_factory=BinanceMarketDataAdapter,
            enabled=False,
        )
    )
    assert registry.supported_exchanges() == ()
    with pytest.raises(UnsupportedExchange, match="disabled"):
        registry.get(ExchangeId.BINANCE)


def test_registry_builds_a_market_data_adapter_without_credentials() -> None:
    """Market data needs no secrets, so the factory must not require any."""

    async def http_get(url: str, params: dict[str, object]) -> dict[str, object]:
        return {}

    registry = build_default_registry()
    adapter = registry.create_market_data_adapter(
        ExchangeId.BINANCE, http_get=http_get
    )
    assert adapter.exchange is ExchangeId.BINANCE


def test_registry_describe_is_serialisable_for_the_admin_console() -> None:
    described = build_default_registry().describe()
    assert len(described) == 1
    assert described[0]["exchange"] == "binance"
    assert described[0]["supportsTrading"] is False
    assert described[0]["enabled"] is True
