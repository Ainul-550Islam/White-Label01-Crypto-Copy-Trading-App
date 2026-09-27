"""Declared venue capabilities.

Strategies and the OMS must not carry ``if exchange == BINANCE`` branches — that
is precisely the leakage the adapter contract exists to prevent. Instead every
adapter declares what its venue can do, and the generic layers query the
declaration.

The practical value is failing early and locally. If a strategy asks for a
post-only stop-limit on a venue that supports neither, the platform can reject
it at signal time with a clear reason, rather than discovering it from an opaque
venue rejection after an order has been counted against risk limits.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from wlct_trading.enums import ExchangeId, MarketType, OrderType, TimeInForce
from wlct_trading.transport.ratelimit import RateLimitRule
from wlct_trading.transport.subscriptions import MarketDataChannel

__all__ = [
    "OrderBookSyncStyle",
    "ExchangeCapabilities",
    "CapabilityViolation",
]


class OrderBookSyncStyle(str):
    """How a venue expects an order book to be synchronised.

    Not an enum by accident — these are documented protocol names and are
    compared as strings in adapter code and logs.
    """

    #: REST snapshot, then apply buffered diffs whose sequence range brackets
    #: the snapshot's ``lastUpdateId``. Binance spot.
    SNAPSHOT_THEN_BUFFERED_DIFF = "SNAPSHOT_THEN_BUFFERED_DIFF"
    #: The stream itself opens with a full snapshot message. OKX, Bybit.
    SNAPSHOT_IN_STREAM = "SNAPSHOT_IN_STREAM"
    #: Fixed-depth full books on every tick; no sequencing needed.
    FULL_DEPTH_EVERY_TICK = "FULL_DEPTH_EVERY_TICK"


@dataclass(slots=True, frozen=True)
class CapabilityViolation:
    """A specific reason a request is impossible on a venue."""

    capability: str
    message: str


@dataclass(slots=True, frozen=True)
class ExchangeCapabilities:
    """What one venue supports. Declared by its adapter, queried by everyone.

    Defaults describe a conservative spot venue: the safe assumption is that a
    feature is absent until an adapter states otherwise.
    """

    exchange: ExchangeId
    display_name: str
    market_types: frozenset[MarketType] = frozenset({MarketType.SPOT})
    order_types: frozenset[OrderType] = frozenset({OrderType.MARKET, OrderType.LIMIT})
    time_in_force: frozenset[TimeInForce] = frozenset({TimeInForce.GTC})
    channels: frozenset[MarketDataChannel] = frozenset()

    supports_post_only: bool = False
    supports_reduce_only: bool = False
    supports_client_order_id: bool = True
    supports_cancel_replace: bool = False
    supports_batch_orders: bool = False
    supports_user_data_stream: bool = False
    #: Whether the venue requires a periodically renewed listen key for the
    #: private stream (Binance does; OKX authenticates the socket instead).
    requires_listen_key_renewal: bool = False
    listen_key_renewal_interval_seconds: int = 1_800

    order_book_sync_style: str = OrderBookSyncStyle.SNAPSHOT_THEN_BUFFERED_DIFF
    #: Depth limits the REST snapshot endpoint accepts, smallest first.
    snapshot_depth_options: tuple[int, ...] = (5, 10, 20, 50, 100, 500, 1_000)
    #: Streams one socket may carry. Exceeding it gets the connection dropped.
    max_streams_per_connection: int = 200
    max_subscriptions_per_request: int = 1
    #: Some venues silently disconnect a socket after a fixed lifetime; the
    #: manager can pre-emptively cycle it instead of taking a surprise drop.
    connection_max_lifetime_seconds: int | None = None

    rate_limit_rules: tuple[RateLimitRule, ...] = field(default_factory=tuple)
    #: Weight this venue charges for each REST operation.
    rest_weights: dict[str, int] = field(default_factory=dict)

    requires_credentials_for_market_data: bool = False
    supports_testnet: bool = True

    # ------------------------------------------------------------------
    # Queries
    # ------------------------------------------------------------------
    def supports_order_type(self, order_type: OrderType) -> bool:
        return order_type in self.order_types

    def supports_channel(self, channel: MarketDataChannel) -> bool:
        return channel in self.channels

    def supports_market_type(self, market_type: MarketType) -> bool:
        return market_type in self.market_types

    def nearest_snapshot_depth(self, requested: int) -> int:
        """Smallest supported snapshot depth that covers ``requested``.

        Asking for an unsupported depth is an error on most venues, so the
        request is rounded up to a legal value rather than sent as-is.
        """
        if not self.snapshot_depth_options:
            return requested
        for option in sorted(self.snapshot_depth_options):
            if option >= requested:
                return option
        return max(self.snapshot_depth_options)

    def rest_weight(self, operation: str, default: int = 1) -> int:
        return self.rest_weights.get(operation, default)

    def validate_order(
        self,
        *,
        order_type: OrderType,
        time_in_force: TimeInForce,
        market_type: MarketType = MarketType.SPOT,
        post_only: bool = False,
        reduce_only: bool = False,
    ) -> tuple[CapabilityViolation, ...]:
        """Every reason this order shape is impossible here.

        All violations are returned rather than the first, so an operator sees
        the whole problem in one message instead of fixing them one at a time.
        """
        violations: list[CapabilityViolation] = []

        if market_type not in self.market_types:
            violations.append(
                CapabilityViolation(
                    capability="market_type",
                    message=(
                        f"{self.display_name} does not support "
                        f"{market_type.value} markets."
                    ),
                )
            )
        if order_type not in self.order_types:
            violations.append(
                CapabilityViolation(
                    capability="order_type",
                    message=(
                        f"{self.display_name} does not support "
                        f"{order_type.value} orders."
                    ),
                )
            )
        if time_in_force not in self.time_in_force:
            violations.append(
                CapabilityViolation(
                    capability="time_in_force",
                    message=(
                        f"{self.display_name} does not support "
                        f"{time_in_force.value} time-in-force."
                    ),
                )
            )
        if post_only and not self.supports_post_only:
            violations.append(
                CapabilityViolation(
                    capability="post_only",
                    message=f"{self.display_name} does not support post-only orders.",
                )
            )
        if reduce_only and not self.supports_reduce_only:
            violations.append(
                CapabilityViolation(
                    capability="reduce_only",
                    message=(
                        f"{self.display_name} does not support reduce-only orders."
                    ),
                )
            )
        return tuple(violations)

    def to_public_dict(self) -> dict[str, object]:
        """Serialisable form for the admin console. Contains no credentials."""
        return {
            "exchange": self.exchange.value,
            "displayName": self.display_name,
            "marketTypes": sorted(m.value for m in self.market_types),
            "orderTypes": sorted(o.value for o in self.order_types),
            "timeInForce": sorted(t.value for t in self.time_in_force),
            "channels": sorted(c.value for c in self.channels),
            "supportsPostOnly": self.supports_post_only,
            "supportsReduceOnly": self.supports_reduce_only,
            "supportsCancelReplace": self.supports_cancel_replace,
            "supportsBatchOrders": self.supports_batch_orders,
            "supportsUserDataStream": self.supports_user_data_stream,
            "orderBookSyncStyle": self.order_book_sync_style,
            "maxStreamsPerConnection": self.max_streams_per_connection,
            "snapshotDepthOptions": list(self.snapshot_depth_options),
            "supportsTestnet": self.supports_testnet,
        }
