"""Binance spot venue integration.

Chosen as the first venue for concrete reasons rather than popularity: its
public documentation is the most complete of the major exchanges, its order-book
synchronisation protocol is explicitly specified (and is the strictest of the
common ones, so an implementation that satisfies it generalises downward), and
its testnet allows the trading path to be exercised without real funds.

The package is deliberately thin. Everything reusable — connection management,
backoff, subscriptions, rate limiting, book synchronisation — lives in the
generic layers; what remains here is the wire format and the venue's published
limits.

What is exported, and what is not, follows one rule: a name is exported when a
caller needs it to *configure* this venue, and stays module-path-local when
obtaining it would drag the transport vocabulary into the package root. That is
why the market-data adapter, its parsers and its published limits are here, and
so is the placement-attestation surface (Part 16): a deployment wires
``BinancePlacementAttestor(adapter=...)`` and reads back ``KeyEvidence``, and
neither of those needs anything beyond this module's own types. The trading
adapter is not exported, because constructing one takes a
``SignedRequestSender``, an ``ExchangeClock`` and a ``RateLimitRegistry`` — names
the package deliberately does not re-export, since a venue-agnostic component
that imports them from here would silently acquire a Binance dependency.
"""

from wlct_trading.exchanges.binance.adapter import (
    BINANCE_ERROR_CODE_CATEGORIES,
    BinanceMarketDataAdapter,
    HttpGetter,
    channel_suffix,
    classify_binance_error,
)
from wlct_trading.exchanges.binance.attestation import (
    AccountFlagReader,
    BINANCE_REVIEW_SOURCE,
    BinancePlacementAttestor,
    KeyEvidence,
    SymbolRegistry,
    VenueAccountFlags,
    exchange_info_symbol_facts,
    key_evidence_from_restrictions,
    symbol_facts_from_market,
)
from wlct_trading.exchanges.binance.capabilities import (
    BINANCE_REST_WEIGHTS,
    BINANCE_SPOT_CAPABILITIES,
    BINANCE_SPOT_REST_BASE,
    BINANCE_SPOT_WS_BASE,
    BINANCE_TESTNET_REST_BASE,
    BINANCE_TESTNET_WS_BASE,
    RAW_REQUEST_RULE,
    REQUEST_WEIGHT_RULE,
    WS_CONNECTION_RULE,
    WS_MESSAGE_RULE,
    depth_endpoint_weight,
)
from wlct_trading.exchanges.binance.parsers import (
    BinanceParseError,
    parse_book_ticker,
    parse_depth_delta,
    parse_depth_snapshot,
    parse_exchange_info,
    parse_kline,
    parse_rest_kline,
    parse_levels,
    parse_ticker,
    parse_trade,
    stream_name,
    unwrap_combined_stream,
)

__all__ = [
    "AccountFlagReader",
    "BINANCE_ERROR_CODE_CATEGORIES",
    "BINANCE_REST_WEIGHTS",
    "BINANCE_REVIEW_SOURCE",
    "BINANCE_SPOT_CAPABILITIES",
    "BINANCE_SPOT_REST_BASE",
    "BINANCE_SPOT_WS_BASE",
    "BINANCE_TESTNET_REST_BASE",
    "BINANCE_TESTNET_WS_BASE",
    "BinanceMarketDataAdapter",
    "BinanceParseError",
    "BinancePlacementAttestor",
    "HttpGetter",
    "KeyEvidence",
    "RAW_REQUEST_RULE",
    "REQUEST_WEIGHT_RULE",
    "SymbolRegistry",
    "VenueAccountFlags",
    "WS_CONNECTION_RULE",
    "WS_MESSAGE_RULE",
    "channel_suffix",
    "classify_binance_error",
    "depth_endpoint_weight",
    "exchange_info_symbol_facts",
    "key_evidence_from_restrictions",
    "parse_book_ticker",
    "parse_depth_delta",
    "parse_depth_snapshot",
    "parse_exchange_info",
    "parse_kline",
    "parse_levels",
    "parse_rest_kline",
    "parse_ticker",
    "parse_trade",
    "stream_name",
    "symbol_facts_from_market",
    "unwrap_combined_stream",
]
