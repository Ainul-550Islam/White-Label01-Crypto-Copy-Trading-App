"""Venue-agnostic transport layer: sockets, subscriptions, limits, health.

Nothing in this package knows about any specific exchange. Venue behaviour
enters through :class:`~wlct_trading.transport.websocket.ConnectionCallbacks`,
which is what allows one connection manager, one backoff policy and one
staleness monitor to serve every venue the platform integrates.
"""

from wlct_trading.transport.backoff import BackoffConfig, ExponentialBackoff
from wlct_trading.transport.errors import (
    RETRY_POLICIES,
    ExchangeErrorCategory,
    NormalisedExchangeError,
    RetryPolicy,
    scrub_metadata,
)
from wlct_trading.transport.ratelimit import (
    RateLimitDecision,
    RateLimitRegistry,
    RateLimitRule,
    WeightedRateLimiter,
)
from wlct_trading.transport.staleness import (
    StalenessMonitor,
    StalenessThresholds,
    StalenessVerdict,
    StreamFreshness,
)
from wlct_trading.transport.state import (
    CONNECTION_STATE_TRANSITIONS,
    ConnectionHealth,
    ConnectionState,
    InvalidConnectionTransition,
    LatencyStats,
    is_legal_connection_transition,
)
from wlct_trading.transport.subscriptions import (
    DuplicateSubscription,
    MarketDataChannel,
    Subscription,
    SubscriptionLimitExceeded,
    SubscriptionManager,
    SubscriptionStatus,
)
from wlct_trading.transport.websocket import (
    ConnectionCallbacks,
    ConnectionClosed,
    ConnectionConfig,
    TransportFactory,
    WebSocketConnectionManager,
    WebSocketTransport,
)

__all__ = [
    "BackoffConfig",
    "CONNECTION_STATE_TRANSITIONS",
    "ConnectionCallbacks",
    "ConnectionClosed",
    "ConnectionConfig",
    "ConnectionHealth",
    "ConnectionState",
    "DuplicateSubscription",
    "ExchangeErrorCategory",
    "ExponentialBackoff",
    "InvalidConnectionTransition",
    "LatencyStats",
    "MarketDataChannel",
    "NormalisedExchangeError",
    "RETRY_POLICIES",
    "RateLimitDecision",
    "RateLimitRegistry",
    "RateLimitRule",
    "RetryPolicy",
    "StalenessMonitor",
    "StalenessThresholds",
    "StalenessVerdict",
    "StreamFreshness",
    "Subscription",
    "SubscriptionLimitExceeded",
    "SubscriptionManager",
    "SubscriptionStatus",
    "TransportFactory",
    "WebSocketConnectionManager",
    "WebSocketTransport",
    "WeightedRateLimiter",
    "is_legal_connection_transition",
    "scrub_metadata",
]
