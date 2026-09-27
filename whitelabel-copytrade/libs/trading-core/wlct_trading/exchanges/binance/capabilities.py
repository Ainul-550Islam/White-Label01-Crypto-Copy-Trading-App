"""Binance spot capability declaration.

Endpoints, limits and weights are transcribed from Binance's published spot API
documentation. They are stated as data rather than scattered through the adapter
so that a venue-side change is a one-line edit here, and so the admin console
can show operators what the platform believes the limits to be.

Weights reflect the 2023-10-19 revision of the depth endpoint tiers, which is
the schedule currently in force. They are deliberately conservative — under-
counting weight is what gets an IP banned.
"""

from __future__ import annotations

from wlct_trading.enums import ExchangeId, MarketType, OrderType, TimeInForce
from wlct_trading.exchanges.capabilities import ExchangeCapabilities, OrderBookSyncStyle
from wlct_trading.transport.ratelimit import RateLimitRule
from wlct_trading.transport.subscriptions import MarketDataChannel

__all__ = [
    "BINANCE_SPOT_REST_BASE",
    "BINANCE_SPOT_WS_BASE",
    "BINANCE_TESTNET_REST_BASE",
    "BINANCE_TESTNET_WS_BASE",
    "REQUEST_WEIGHT_RULE",
    "RAW_REQUEST_RULE",
    "WS_MESSAGE_RULE",
    "WS_CONNECTION_RULE",
    "BINANCE_REST_WEIGHTS",
    "BINANCE_SPOT_CAPABILITIES",
    "depth_endpoint_weight",
]

BINANCE_SPOT_REST_BASE = "https://api.binance.com"
BINANCE_SPOT_WS_BASE = "wss://stream.binance.com:9443"
BINANCE_TESTNET_REST_BASE = "https://testnet.binance.vision"
BINANCE_TESTNET_WS_BASE = "wss://stream.testnet.binance.vision"

#: 6 000 weight per minute per IP, shared across every connection from that IP.
REQUEST_WEIGHT_RULE = RateLimitRule(
    name="REQUEST_WEIGHT", capacity=6_000, window_seconds=60
)
#: 61 000 raw requests per 5 minutes per IP, independent of weight.
RAW_REQUEST_RULE = RateLimitRule(
    name="RAW_REQUESTS", capacity=61_000, window_seconds=300
)
#: 5 inbound messages per second per socket, counting PING, PONG and every JSON
#: control frame. Exceeding it drops the connection; repeat offenders are banned.
WS_MESSAGE_RULE = RateLimitRule(name="WS_MESSAGES", capacity=5, window_seconds=1)
#: 300 connection attempts per 5 minutes per IP. A reconnect loop without
#: backoff burns this in under a minute, which is why backoff is mandatory.
WS_CONNECTION_RULE = RateLimitRule(
    name="WS_CONNECTIONS", capacity=300, window_seconds=300
)

#: Weight charged per REST operation. Keys are platform operation names, not
#: URLs, so the generic rate-limit layer stays venue-agnostic.
BINANCE_REST_WEIGHTS: dict[str, int] = {
    "exchange_info": 20,
    "depth_1_100": 5,
    "depth_101_500": 25,
    "depth_501_1000": 50,
    "depth_1001_5000": 250,
    "klines": 2,
    "trades": 10,
    "agg_trades": 2,
    "ticker_book": 2,
    "ticker_24hr": 2,
    "avg_price": 2,
    "server_time": 1,
    "account": 20,
    # ``GET /sapi/v1/account/apiRestrictions``. SAPI endpoints are metered on a
    # separate "SAPI" weight budget from the /api spot weights, but they also
    # count against the shared per-IP 6 000/minute pool, so the reservation here
    # uses the same REQUEST_WEIGHT bucket the rest of this client reserves from:
    # over-reserving costs a slightly early local refusal, under-reserving costs
    # a 429, and 1 is what the venue documents for this endpoint.
    "api_restrictions": 1,
    "order_place": 1,
    "order_cancel": 1,
    "order_status": 4,
    "open_orders": 6,
    "all_orders": 20,
    "my_trades": 20,
    "user_data_stream": 2,
}


def depth_endpoint_weight(limit: int) -> int:
    """Weight charged by ``GET /api/v3/depth`` for a given depth limit.

    Tiered, and steeply: a 5 000-level snapshot costs 250 — fifty times a
    100-level one. Charging a flat rate would silently overrun the budget.
    """
    if limit <= 100:
        return BINANCE_REST_WEIGHTS["depth_1_100"]
    if limit <= 500:
        return BINANCE_REST_WEIGHTS["depth_101_500"]
    if limit <= 1_000:
        return BINANCE_REST_WEIGHTS["depth_501_1000"]
    return BINANCE_REST_WEIGHTS["depth_1001_5000"]


BINANCE_SPOT_CAPABILITIES = ExchangeCapabilities(
    exchange=ExchangeId.BINANCE,
    display_name="Binance Spot",
    market_types=frozenset({MarketType.SPOT}),
    order_types=frozenset(
        {OrderType.MARKET, OrderType.LIMIT, OrderType.STOP, OrderType.STOP_LIMIT}
    ),
    time_in_force=frozenset({TimeInForce.GTC, TimeInForce.IOC, TimeInForce.FOK}),
    channels=frozenset(
        {
            MarketDataChannel.ORDER_BOOK,
            MarketDataChannel.TRADES,
            MarketDataChannel.TICKER,
            MarketDataChannel.BOOK_TICKER,
            MarketDataChannel.CANDLES,
        }
    ),
    supports_post_only=True,
    supports_reduce_only=False,  # Spot has no positions to reduce.
    supports_client_order_id=True,
    supports_cancel_replace=True,
    supports_batch_orders=False,  # Spot REST places one order per request.
    supports_user_data_stream=True,
    requires_listen_key_renewal=True,
    listen_key_renewal_interval_seconds=1_800,  # Key expires at 60 min; renew at 30.
    order_book_sync_style=OrderBookSyncStyle.SNAPSHOT_THEN_BUFFERED_DIFF,
    snapshot_depth_options=(5, 10, 20, 50, 100, 500, 1_000, 5_000),
    max_streams_per_connection=1_024,
    #: One SUBSCRIBE frame may carry many streams, but the 5-messages-per-second
    #: cap means batching is the only safe way to subscribe in bulk.
    max_subscriptions_per_request=200,
    #: Binance closes every stream connection at the 24-hour mark. Cycling at 23
    #: hours turns a forced disconnect into a planned one.
    connection_max_lifetime_seconds=23 * 60 * 60,
    rate_limit_rules=(
        REQUEST_WEIGHT_RULE,
        RAW_REQUEST_RULE,
        WS_MESSAGE_RULE,
        WS_CONNECTION_RULE,
    ),
    rest_weights=BINANCE_REST_WEIGHTS,
    requires_credentials_for_market_data=False,
    supports_testnet=True,
)
