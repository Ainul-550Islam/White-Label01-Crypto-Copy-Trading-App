"""Binance USD-M futures capability declaration.

Responsibility: state the futures endpoints, rate limits and operation weights
as data - transcribed from Binance's published USDⓈ-M futures API
documentation - so adapters, rate registries and the admin surface read one
source of truth. Nothing here performs I/O; construction of live objects
belongs to :mod:`wlct_trading.exchanges.binance_futures.adapter` and
:mod:`wlct_trading.exchanges.binance_futures.trading`.

Spot parity law
---------------
This module deliberately mirrors the shape of
:mod:`wlct_trading.exchanges.binance.capabilities` rather than extending it:
futures is a different API tree (``/fapi`` vs ``/api``), a different weight
ledger (USD-M request weight is charged per UID on signed endpoints and per
IP on public ones, not the spot IP-wide 6 000 budget) and different rules for
symbol filters. Folding them together would let a spot-only regression leak
into the futures path; the batches' "spot behaviour byte-identical" contract
forbids that.

Observation-only pieces
-----------------------
Public market-data endpoints (``ping``, ``time``, ``exchangeInfo``, premium
index) are keyless. Every signed endpoint listed below is still gated by the
execution-engine composition: default stays ``simulated`` and nothing here
can transmit on its own.
"""

from __future__ import annotations

from wlct_trading.enums import ExchangeId, MarketType, OrderType, TimeInForce
from wlct_trading.exchanges.capabilities import ExchangeCapabilities, OrderBookSyncStyle
from wlct_trading.transport.subscriptions import MarketDataChannel
from wlct_trading.transport.ratelimit import RateLimitRule
from wlct_trading.transport.subscriptions import MarketDataChannel

__all__ = [
    "BINANCE_FUTURES_REST_BASE",
    "BINANCE_FUTURES_WS_BASE",
    "BINANCE_FUTURES_TESTNET_REST_BASE",
    "BINANCE_FUTURES_TESTNET_WS_BASE",
    "FUTURES_REQUEST_WEIGHT_RULE",
    "FUTURES_RAW_REQUEST_RULE",
    "FUTURES_WS_MESSAGE_RULE",
    "FUTURES_WS_CONNECTION_RULE",
    "FUTURES_REST_WEIGHTS",
    "BINANCE_FUTURES_CAPABILITIES",
    "futures_depth_endpoint_weight",
]

#: Production USD-M futures REST host.
BINANCE_FUTURES_REST_BASE = "https://fapi.binance.com"
#: Production USD-M futures public stream host.
BINANCE_FUTURES_WS_BASE = "wss://fstream.binance.com"
#: USD-M futures testnet. Orders on this host are "real" as far as the venue
#: protocol is concerned - the venue accepts and fills them against fictitious
#: balances - so the platform treats them as live-grade traffic requiring the
#: same gates, merely against a testnet credential set.
BINANCE_FUTURES_TESTNET_REST_BASE = "https://testnet.binancefuture.com"
BINANCE_FUTURES_TESTNET_WS_BASE = "wss://stream.binancefuture.com"

#: USD-M request weight, shared per IP across parallel connections. The
#: published 2024 revision states 2 400 weight per IP per minute; signed
#: endpoints additionally charge a per-UID budget we model conservatively by
#: counting everything against the smaller IP envelope: under-counting weight
#: is what gets an IP banned, never over-counting.
FUTURES_REQUEST_WEIGHT_RULE = RateLimitRule(
    name="FUTURES_REQUEST_WEIGHT", capacity=2_400, window_seconds=60
)
#: Raw requests per 5 minutes per IP, independent of weight.
FUTURES_RAW_REQUEST_RULE = RateLimitRule(
    name="FUTURES_RAW_REQUESTS", capacity=61_000, window_seconds=300
)
#: 10 inbound messages per second per socket on futures streams.
FUTURES_WS_MESSAGE_RULE = RateLimitRule(
    name="FUTURES_WS_MESSAGES", capacity=10, window_seconds=1
)
#: 300 connections per 5 minutes per IP; a reconnect storm burns this fast.
FUTURES_WS_CONNECTION_RULE = RateLimitRule(
    name="FUTURES_WS_CONNECTIONS", capacity=300, window_seconds=300
)

#: Weight charged per REST operation. Keys are platform operation names, not
#: URLs, so the generic rate-limit layer stays venue-agnostic. Transcribed
#: from the USD-M API docs' per-endpoint tables (interim weights).
FUTURES_REST_WEIGHTS: dict[str, int] = {
    "ping": 1,
    "time": 1,
    "exchange_info": 1,
    "depth_5_50": 2,
    "depth_100": 5,
    "depth_500": 10,
    "depth_1000": 20,
    "agg_trades": 20,
    "klines_1_99": 1,
    "klines_100_499": 2,
    "klines_500_1000": 5,
    "premium_index_all": 10,
    "premium_index_symbol": 1,
    "funding_rate": 1,
    # Binance publishes 0 weight for order placement (orders count against
    # the separate order-rate buckets the venue enforces itself). The
    # registry ledger here models weight only - and its accounting assumes a
    # positive charge - so the platform bills placement as 1, the same
    # doctrine this table documents at the top: over-counting is what never
    # gets an IP banned.
    "order_place": 1,
    "order_cancel": 1,
    "order_query": 1,
    "open_orders_symbol": 1,
    "open_orders_all": 40,
    "account_v2": 5,
    "position_risk_v2": 5,
    "leverage_change": 1,
    "margin_type_change": 1,
    "position_mode_change": 1,
    "user_stream_place": 1,
    "user_stream_keepalive": 1,
    "user_stream_close": 1,
}


def futures_depth_endpoint_weight(limit: int) -> int:
    """Weight table for the partial-book depth endpoint by requested limit."""
    if limit <= 50:
        return FUTURES_REST_WEIGHTS["depth_5_50"]
    if limit <= 100:
        return FUTURES_REST_WEIGHTS["depth_100"]
    if limit <= 500:
        return FUTURES_REST_WEIGHTS["depth_500"]
    return FUTURES_REST_WEIGHTS["depth_1000"]


BINANCE_FUTURES_CAPABILITIES = ExchangeCapabilities(
    exchange=ExchangeId.BINANCE,
    display_name="Binance USD-M Futures",
    market_types=frozenset({MarketType.FUTURES_USDT}),
    order_types=frozenset({OrderType.MARKET, OrderType.LIMIT}),
    time_in_force=frozenset({TimeInForce.GTC, TimeInForce.IOC, TimeInForce.FOK}),
    channels=frozenset(
        {
            MarketDataChannel.ORDER_BOOK,
            MarketDataChannel.TRADES,
            MarketDataChannel.TICKER,
            MarketDataChannel.CANDLES,
        }
    ),
    supports_reduce_only=True,
    supports_user_data_stream=True,
    requires_listen_key_renewal=True,
    order_book_sync_style=OrderBookSyncStyle.SNAPSHOT_THEN_BUFFERED_DIFF,
    rate_limit_rules=(
        FUTURES_REQUEST_WEIGHT_RULE,
        FUTURES_RAW_REQUEST_RULE,
        FUTURES_WS_MESSAGE_RULE,
        FUTURES_WS_CONNECTION_RULE,
    ),
    rest_weights=dict(FUTURES_REST_WEIGHTS),
    supports_testnet=True,
)
