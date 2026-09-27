"""Turn configured symbol strings into venue-resolved references.

Operators write ``BTC/USDT``, ``btc-usdt`` or ``BTCUSDT`` depending on habit and
on which venue's documentation they had open. All three mean the same market,
and the canonical form the platform uses internally is ``BTC-USDT``.

The conversion itself belongs to :mod:`wlct_trading.exchanges.symbols`, which
already owns asset aliasing and concatenated-symbol splitting. This module only
handles the configuration shapes and the failure messages.
"""

from __future__ import annotations

from wlct_trading.enums import ExchangeId, MarketType
from wlct_trading.exchanges.symbols import (
    SymbolRef,
    SymbolRegistry,
    UnknownSymbol,
    split_concatenated_symbol,
    to_canonical,
)

__all__ = ["resolve_configured_symbols", "canonicalise_configured_symbol"]


def canonicalise_configured_symbol(raw: str) -> str:
    """Normalise one configured symbol to canonical ``BASE-QUOTE`` form.

    Accepts ``BTC/USDT``, ``BTC-USDT``, ``BTC_USDT`` and ``BTCUSDT``. The last
    form needs the quote-asset splitter, which is why ``XBTUSD`` resolves
    correctly rather than being cut at an arbitrary offset.
    """
    text = raw.strip().upper()
    if not text:
        raise UnknownSymbol("An empty string is not a symbol.")

    for separator in ("/", "-", "_", ":"):
        if separator in text:
            base, _, quote = text.partition(separator)
            if not base or not quote:
                raise UnknownSymbol(
                    f"{raw!r} is not a valid symbol: expected BASE{separator}QUOTE."
                )
            return to_canonical(base, quote)

    split = split_concatenated_symbol(text)
    if split is None:
        raise UnknownSymbol(
            f"Cannot determine the base and quote assets of {raw!r}. "
            f"Write it with a separator, for example BTC/USDT."
        )
    return to_canonical(split[0], split[1])


def resolve_configured_symbols(
    raw_symbols: tuple[str, ...],
    *,
    registry: SymbolRegistry,
    exchange: ExchangeId,
    market_type: MarketType = MarketType.SPOT,
    require_registered: bool = True,
) -> tuple[SymbolRef, ...]:
    """Resolve configured symbols against the venue's instrument list.

    ``require_registered`` defaults to true so that a typo is caught at startup
    rather than by a websocket that connects and then stays silent forever.
    Registration comes from ``load_symbols()``, which reads ``exchangeInfo`` —
    so this also rejects a market the venue has delisted.

    Duplicates are collapsed rather than rejected: ``BTC/USDT`` and ``BTCUSDT``
    in the same list is untidy, not an error.
    """
    resolved: list[SymbolRef] = []
    seen: set[str] = set()
    unknown: list[str] = []

    for raw in raw_symbols:
        canonical = canonicalise_configured_symbol(raw)
        if canonical in seen:
            continue
        seen.add(canonical)

        if registry.is_registered(canonical, exchange, market_type=market_type):
            resolved.append(
                registry.symbol_ref(canonical, exchange, market_type=market_type)
            )
            continue

        if require_registered:
            unknown.append(f"{raw} (canonical {canonical})")
            continue

        # Unregistered but tolerated: derive the venue spelling by removing the
        # separator, which is what every concatenating venue expects.
        resolved.append(
            SymbolRef(
                exchange=exchange,
                symbol=canonical,
                venue_symbol=canonical.replace("-", ""),
                market_type=market_type,
            )
        )

    if unknown:
        raise UnknownSymbol(
            f"{exchange.value} does not list these configured symbols: "
            f"{', '.join(unknown)}. Check MARKET_DATA_SYMBOLS."
        )
    if not resolved:
        raise UnknownSymbol(
            "No symbols could be resolved from the configured list."
        )
    return tuple(resolved)
