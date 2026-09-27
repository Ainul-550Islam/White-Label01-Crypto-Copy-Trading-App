"""Exchange integrations and the pluggability seam that hosts them.

Layering, outermost first:

* :mod:`wlct_trading.exchanges.symbols` — one canonical symbol vocabulary.
* :mod:`wlct_trading.exchanges.capabilities` — what a venue can do, as data.
* :mod:`wlct_trading.exchanges.registry` — venue to adapter factory.
* :mod:`wlct_trading.exchanges.binance` — the first concrete venue.

:func:`build_default_registry` returns a registry with every implemented venue
already registered, which is what the market-data and execution services call at
startup. Adding a venue is one entry here plus its package; no generic code
changes.
"""

from wlct_trading.enums import ExchangeId
from wlct_trading.exchanges.binance import (
    BINANCE_SPOT_CAPABILITIES,
    BinanceMarketDataAdapter,
)
from wlct_trading.exchanges.capabilities import (
    CapabilityViolation,
    ExchangeCapabilities,
    OrderBookSyncStyle,
)
from wlct_trading.exchanges.registry import (
    DuplicateRegistration,
    ExchangeRegistration,
    ExchangeRegistry,
    MarketDataAdapterFactory,
    TradingAdapterFactory,
    UnsupportedExchange,
)
from wlct_trading.exchanges.symbols import (
    ASSET_ALIASES,
    CANONICAL_SEPARATOR,
    KNOWN_BASE_ASSETS,
    KNOWN_QUOTE_ASSETS,
    SymbolMapping,
    SymbolRegistry,
    UnknownSymbol,
    canonicalise_asset,
    split_concatenated_symbol,
    to_canonical,
)

__all__ = [
    "ASSET_ALIASES",
    "BINANCE_SPOT_CAPABILITIES",
    "BinanceMarketDataAdapter",
    "CANONICAL_SEPARATOR",
    "CapabilityViolation",
    "DuplicateRegistration",
    "ExchangeCapabilities",
    "ExchangeRegistration",
    "ExchangeRegistry",
    "KNOWN_BASE_ASSETS",
    "KNOWN_QUOTE_ASSETS",
    "MarketDataAdapterFactory",
    "OrderBookSyncStyle",
    "SymbolMapping",
    "SymbolRegistry",
    "TradingAdapterFactory",
    "UnknownSymbol",
    "UnsupportedExchange",
    "build_default_registry",
    "canonicalise_asset",
    "split_concatenated_symbol",
    "to_canonical",
]


def build_default_registry() -> ExchangeRegistry:
    """Registry containing every venue with a working adapter.

    Only Binance is registered. The other members of :class:`ExchangeId` exist
    in the enum because the database schema and the shared TypeScript types
    already model them, but registering a venue whose adapter is not written
    would let an operator select it and receive a runtime failure instead of a
    clear "unsupported" answer.

    ``trading_factory`` is left unset: this part of the platform delivers the
    market-data path, and claiming an order-placement capability that is not
    implemented is exactly the kind of false affordance that ends in a
    surprised operator.
    """
    registry = ExchangeRegistry()
    registry.register(
        ExchangeRegistration(
            exchange=ExchangeId.BINANCE,
            capabilities=BINANCE_SPOT_CAPABILITIES,
            market_data_factory=BinanceMarketDataAdapter,
            trading_factory=None,
            enabled=True,
        )
    )
    return registry
