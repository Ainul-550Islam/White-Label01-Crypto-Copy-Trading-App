"""Centralised symbol normalisation.

The same market is written differently by every venue: ``BTCUSDT`` on Binance
and Bybit, ``BTC-USDT`` on OKX, ``BTC-USD`` on Coinbase, ``XBT/USD`` on Kraken.
If those strings are converted ad hoc at each call site, two things go wrong
almost immediately — a position opened under one spelling cannot be found under
another, and Kraken's ``XBT`` silently becomes a different instrument from
``BTC``.

So conversion happens in exactly one place. The canonical form is
``BASE-QUOTE`` with upper-case assets and a single hyphen: ``BTC-USDT``.

Authoritative first, heuristic second
-------------------------------------
Splitting ``BTCUSDT`` into base and quote is genuinely ambiguous without
knowing the venue's asset list — ``BTCUSDT`` could in principle be ``BTCU``/
``SDT``. Every venue publishes the correct split in its instrument metadata, so
:meth:`SymbolRegistry.register_specification` records the authoritative answer
and it is always preferred. The heuristic in :func:`split_concatenated_symbol`
exists only for the bootstrap window before metadata has loaded, tries the
longest known quote assets first, and is documented as a fallback rather than a
source of truth.
"""

from __future__ import annotations

from dataclasses import dataclass

from wlct_trading.enums import ExchangeId, MarketType
from wlct_trading.market_data import SymbolRef

__all__ = [
    # Re-exported explicitly: net/feed and net/symbols import the canonical
    # symbol handle from here rather than from market_data, so under
    # no-implicit-reexport this module must own the export.
    "SymbolRef",
    "CANONICAL_SEPARATOR",
    "KNOWN_QUOTE_ASSETS",
    "KNOWN_BASE_ASSETS",
    "ASSET_ALIASES",
    "SymbolMapping",
    "SymbolRegistry",
    "UnknownSymbol",
    "canonicalise_asset",
    "split_concatenated_symbol",
    "to_canonical",
]

CANONICAL_SEPARATOR = "-"

#: Quote assets ordered longest-first so a greedy suffix match prefers the
#: longer candidate: ``ETHUSDT`` must split as ETH/USDT, not ETH/USD + stray T.
KNOWN_QUOTE_ASSETS: tuple[str, ...] = (
    "USDT",
    "USDC",
    "TUSD",
    "BUSD",
    "FDUSD",
    "DAI",
    "USD",
    "EUR",
    "GBP",
    "JPY",
    "TRY",
    "BRL",
    "AUD",
    "BTC",
    "ETH",
    "BNB",
    "SOL",
    "XBT",
)

#: Venue-specific asset spellings mapped to the canonical one. Kraken's use of
#: ``XBT`` for Bitcoin and its ``X``/``Z`` prefixes are the usual offenders.
ASSET_ALIASES: dict[str, str] = {
    "XBT": "BTC",
    "XXBT": "BTC",
    "XETH": "ETH",
    "XDG": "DOGE",
    "ZUSD": "USD",
    "ZEUR": "EUR",
    "ZGBP": "GBP",
    "ZJPY": "JPY",
}

#: Base assets used to disambiguate the fallback split. Longest-suffix matching
#: alone is wrong: ``XBTUSD`` ends with ``TUSD``, which would yield a base of
#: ``XB``. Preferring a candidate whose base is a recognised asset resolves it
#: to ``XBT``/``USD``. This list only has to cover the liquid majors — anything
#: else arrives with authoritative metadata anyway.
KNOWN_BASE_ASSETS: frozenset[str] = frozenset(
    {
        "BTC", "XBT", "ETH", "BNB", "SOL", "XRP", "ADA", "DOGE", "TRX", "TON",
        "AVAX", "DOT", "MATIC", "LINK", "LTC", "BCH", "NEAR", "UNI", "ICP",
        "APT", "ETC", "XLM", "ATOM", "FIL", "HBAR", "ARB", "OP", "INJ", "SUI",
        "SEI", "TIA", "RUNE", "AAVE", "ALGO", "VET", "GRT", "SAND", "MANA",
        "EOS", "XTZ", "THETA", "AXS", "FTM", "EGLD", "PEPE", "SHIB", "WIF",
        "USDT", "USDC", "DAI",
    }
)


class UnknownSymbol(Exception):
    """Raised when a symbol cannot be resolved for a venue."""


def canonicalise_asset(asset: str) -> str:
    """Upper-case an asset code and resolve venue-specific aliases."""
    upper = asset.strip().upper()
    return ASSET_ALIASES.get(upper, upper)


def split_concatenated_symbol(
    venue_symbol: str, *, quote_assets: tuple[str, ...] = KNOWN_QUOTE_ASSETS
) -> tuple[str, str] | None:
    """Best-effort split of a separator-less symbol into ``(base, quote)``.

    Fallback only — see the module docstring. Every quote asset that matches as
    a suffix is considered, and a candidate whose base is a recognised asset
    wins over one whose base is not; ties break towards the longer quote. That
    ordering is what makes ``XBTUSD`` resolve to ``XBT``/``USD`` instead of
    ``XB``/``TUSD``.

    Returns ``None`` when no known quote asset matches, which the caller must
    treat as "unknown" rather than guessing further.
    """
    cleaned = venue_symbol.strip().upper()
    if not cleaned:
        return None

    candidates: list[tuple[int, int, str, str]] = []
    for quote in quote_assets:
        if not cleaned.endswith(quote) or len(cleaned) <= len(quote):
            continue
        base = cleaned[: -len(quote)]
        if not base:
            continue
        base_is_known = base in KNOWN_BASE_ASSETS or base in ASSET_ALIASES
        candidates.append((1 if base_is_known else 0, len(quote), base, quote))

    if not candidates:
        return None

    _, _, base, quote = max(candidates, key=lambda c: (c[0], c[1]))
    return canonicalise_asset(base), canonicalise_asset(quote)


def to_canonical(base: str, quote: str) -> str:
    """Build the canonical ``BASE-QUOTE`` form."""
    return f"{canonicalise_asset(base)}{CANONICAL_SEPARATOR}{canonicalise_asset(quote)}"


@dataclass(slots=True, frozen=True)
class SymbolMapping:
    """Authoritative correspondence between a canonical symbol and a venue's."""

    canonical: str
    venue_symbol: str
    exchange: ExchangeId
    base_asset: str
    quote_asset: str
    market_type: MarketType = MarketType.SPOT

    @property
    def key(self) -> tuple[str, str, str]:
        return (self.exchange.value, self.market_type.value, self.canonical)

    def to_symbol_ref(self) -> SymbolRef:
        return SymbolRef(
            exchange=self.exchange,
            symbol=self.canonical,
            venue_symbol=self.venue_symbol,
            market_type=self.market_type,
        )


class SymbolRegistry:
    """Bidirectional symbol translation for every venue.

    One instance is shared by the market-data service and the execution engine
    so both resolve a symbol identically. Lookups are dictionary hits, cheap
    enough for the hot path.
    """

    __slots__ = ("_by_canonical", "_by_venue", "_quote_assets")

    def __init__(self, *, quote_assets: tuple[str, ...] = KNOWN_QUOTE_ASSETS) -> None:
        # (exchange, market_type, canonical) -> mapping
        self._by_canonical: dict[tuple[str, str, str], SymbolMapping] = {}
        # (exchange, market_type, venue_symbol_upper) -> mapping
        self._by_venue: dict[tuple[str, str, str], SymbolMapping] = {}
        self._quote_assets = quote_assets

    # ------------------------------------------------------------------
    # Registration
    # ------------------------------------------------------------------
    def register(self, mapping: SymbolMapping) -> SymbolMapping:
        """Record an authoritative mapping, replacing any previous one."""
        self._by_canonical[mapping.key] = mapping
        self._by_venue[
            (
                mapping.exchange.value,
                mapping.market_type.value,
                mapping.venue_symbol.upper(),
            )
        ] = mapping
        return mapping

    def register_specification(self, specification: object) -> SymbolMapping:
        """Register from an adapter's :class:`SymbolSpecification`.

        Duck-typed rather than imported to keep this module free of a
        dependency on ``adapters.base``, which would otherwise create an import
        cycle: adapters need symbols, and symbols would need adapters.
        """
        mapping = SymbolMapping(
            canonical=to_canonical(
                getattr(specification, "base_asset"),
                getattr(specification, "quote_asset"),
            ),
            venue_symbol=getattr(specification, "venue_symbol"),
            exchange=getattr(specification, "exchange"),
            base_asset=canonicalise_asset(getattr(specification, "base_asset")),
            quote_asset=canonicalise_asset(getattr(specification, "quote_asset")),
            market_type=getattr(specification, "market_type", MarketType.SPOT),
        )
        return self.register(mapping)

    def register_many(self, mappings: tuple[SymbolMapping, ...]) -> int:
        for mapping in mappings:
            self.register(mapping)
        return len(mappings)

    # ------------------------------------------------------------------
    # Resolution
    # ------------------------------------------------------------------
    def to_venue_symbol(
        self,
        canonical: str,
        exchange: ExchangeId,
        *,
        market_type: MarketType = MarketType.SPOT,
    ) -> str:
        """Canonical to venue-native. Raises if the pair is not registered.

        Deliberately strict: fabricating a venue symbol by string manipulation
        is how an order gets sent for an instrument that does not exist.
        """
        mapping = self._by_canonical.get(
            (exchange.value, market_type.value, canonical.upper())
        )
        if mapping is None:
            raise UnknownSymbol(
                f"{canonical} is not registered for {exchange.value} "
                f"{market_type.value}. Load instrument metadata first."
            )
        return mapping.venue_symbol

    def to_canonical_symbol(
        self,
        venue_symbol: str,
        exchange: ExchangeId,
        *,
        market_type: MarketType = MarketType.SPOT,
        allow_heuristic: bool = True,
    ) -> str:
        """Venue-native to canonical.

        Uses the registry first. Falls back to parsing only when
        ``allow_heuristic`` is set, which is appropriate for inbound market data
        during the metadata bootstrap window but not for anything order-related.
        """
        key = (exchange.value, market_type.value, venue_symbol.upper())
        mapping = self._by_venue.get(key)
        if mapping is not None:
            return mapping.canonical

        if not allow_heuristic:
            raise UnknownSymbol(
                f"{venue_symbol} is not registered for {exchange.value} "
                f"{market_type.value}."
            )

        parsed = self.parse_venue_symbol(venue_symbol)
        if parsed is None:
            raise UnknownSymbol(
                f"Cannot determine base/quote for {venue_symbol!r} on "
                f"{exchange.value}."
            )
        return to_canonical(*parsed)

    def parse_venue_symbol(self, venue_symbol: str) -> tuple[str, str] | None:
        """Parse a venue symbol into ``(base, quote)`` without the registry.

        Handles the three separator conventions plus the concatenated form.
        """
        cleaned = venue_symbol.strip().upper()
        if not cleaned:
            return None

        for separator in (CANONICAL_SEPARATOR, "/", "_", ":"):
            if separator in cleaned:
                parts = [p for p in cleaned.split(separator) if p]
                if len(parts) == 2:
                    return canonicalise_asset(parts[0]), canonicalise_asset(parts[1])
                return None

        return split_concatenated_symbol(cleaned, quote_assets=self._quote_assets)

    def get(
        self,
        canonical: str,
        exchange: ExchangeId,
        *,
        market_type: MarketType = MarketType.SPOT,
    ) -> SymbolMapping | None:
        return self._by_canonical.get(
            (exchange.value, market_type.value, canonical.upper())
        )

    def symbol_ref(
        self,
        canonical: str,
        exchange: ExchangeId,
        *,
        market_type: MarketType = MarketType.SPOT,
    ) -> SymbolRef:
        """Resolve to the Part 2 :class:`SymbolRef` used throughout the core."""
        mapping = self.get(canonical, exchange, market_type=market_type)
        if mapping is None:
            raise UnknownSymbol(
                f"{canonical} is not registered for {exchange.value} "
                f"{market_type.value}."
            )
        return mapping.to_symbol_ref()

    def is_registered(
        self,
        canonical: str,
        exchange: ExchangeId,
        *,
        market_type: MarketType = MarketType.SPOT,
    ) -> bool:
        return (
            exchange.value,
            market_type.value,
            canonical.upper(),
        ) in self._by_canonical

    def all_for_exchange(self, exchange: ExchangeId) -> tuple[SymbolMapping, ...]:
        return tuple(
            m for m in self._by_canonical.values() if m.exchange is exchange
        )

    @property
    def count(self) -> int:
        return len(self._by_canonical)

    def clear(self) -> None:
        self._by_canonical.clear()
        self._by_venue.clear()
