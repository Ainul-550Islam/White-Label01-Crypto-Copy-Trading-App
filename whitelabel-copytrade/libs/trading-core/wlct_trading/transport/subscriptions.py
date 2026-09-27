"""Subscription tracking, deduplication and restoration after reconnect.

A websocket subscription is not fire-and-forget. Three things routinely go
wrong and this module exists to make each impossible:

1. **Duplicates.** Subscribing twice to the same stream doubles the message
   rate and, worse, means an unsubscribe leaves one copy still running. The
   manager keys subscriptions by ``(channel, symbol)`` and refuses the second.
2. **Silent loss after reconnect.** A new socket starts with no subscriptions.
   If they are not replayed, the feed looks connected and healthy while
   delivering nothing. :meth:`SubscriptionManager.restorable` returns exactly
   what must be re-sent.
3. **Unbounded growth.** Venues cap subscriptions per connection. The manager
   enforces a configured ceiling rather than discovering it via a rejection.

Nothing here performs I/O. The manager records intent; the connection manager
acts on it. That split is what makes the restoration logic testable without a
socket.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from enum import Enum

from wlct_trading.clock import epoch_micros

__all__ = [
    "MarketDataChannel",
    "SubscriptionStatus",
    "Subscription",
    "SubscriptionManager",
    "SubscriptionLimitExceeded",
    "DuplicateSubscription",
]


class MarketDataChannel(str, Enum):
    """Public market-data stream types.

    Not every venue offers every channel; the capability model records which
    are actually available and the manager refuses to subscribe otherwise.
    """

    TICKER = "ticker"
    TRADES = "trades"
    ORDER_BOOK = "orderbook"
    #: Best bid/ask only. A separate channel from TICKER because venues publish
    #: it on a distinct, much faster stream and it carries no last price.
    BOOK_TICKER = "bookticker"
    CANDLES = "candles"

    def __str__(self) -> str:  # pragma: no cover - trivial
        return str(self.value)


class SubscriptionStatus(str, Enum):
    """Where a subscription is in its own small lifecycle."""

    PENDING = "PENDING"
    ACTIVE = "ACTIVE"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"

    def __str__(self) -> str:  # pragma: no cover - trivial
        return str(self.value)


class DuplicateSubscription(Exception):
    """Raised when the same channel/symbol pair is subscribed twice."""


class SubscriptionLimitExceeded(Exception):
    """Raised when a subscription would exceed the venue's per-connection cap."""


@dataclass(slots=True)
class Subscription:
    """One tracked market-data subscription."""

    subscription_id: str
    exchange: str
    channel: MarketDataChannel
    symbol: str
    #: Venue-native stream name, e.g. ``btcusdt@depth@100ms``. Kept so a
    #: restore replays byte-identical to the original request.
    stream_name: str
    status: SubscriptionStatus = SubscriptionStatus.PENDING
    created_at: int = field(default_factory=epoch_micros)
    activated_at: int | None = None
    last_message_at: int | None = None
    message_count: int = 0
    failure_reason: str | None = None
    #: Channel-specific options (depth level, candle interval).
    options: dict[str, str] = field(default_factory=dict)

    @property
    def key(self) -> tuple[str, str]:
        """Identity for deduplication: one subscription per channel+symbol."""
        return (self.channel.value, self.symbol)

    @property
    def is_active(self) -> bool:
        return self.status is SubscriptionStatus.ACTIVE

    def mark_active(self, *, at_micros: int | None = None) -> None:
        self.status = SubscriptionStatus.ACTIVE
        self.activated_at = at_micros if at_micros is not None else epoch_micros()
        self.failure_reason = None

    def mark_failed(self, reason: str) -> None:
        self.status = SubscriptionStatus.FAILED
        self.failure_reason = reason

    def mark_cancelled(self) -> None:
        self.status = SubscriptionStatus.CANCELLED

    def record_message(self, *, at_micros: int | None = None) -> None:
        self.message_count += 1
        self.last_message_at = at_micros if at_micros is not None else epoch_micros()

    def to_log_fields(self) -> dict[str, object]:
        return {
            "subscriptionId": self.subscription_id,
            "exchange": self.exchange,
            "channel": self.channel.value,
            "symbol": self.symbol,
            "stream": self.stream_name,
            "status": self.status.value,
            "messageCount": self.message_count,
        }


class SubscriptionManager:
    """Registry of subscriptions for a single connection.

    Deliberately not thread-safe: one manager belongs to one connection, which
    is driven by one asyncio task. Adding a lock would serialise the hot path
    for no benefit.
    """

    __slots__ = ("_exchange", "_max_subscriptions", "_by_key", "_by_id")

    def __init__(self, exchange: str, *, max_subscriptions: int = 200) -> None:
        if max_subscriptions <= 0:
            raise ValueError("max_subscriptions must be positive.")
        self._exchange = exchange
        self._max_subscriptions = max_subscriptions
        self._by_key: dict[tuple[str, str], Subscription] = {}
        self._by_id: dict[str, Subscription] = {}

    # ------------------------------------------------------------------
    # Registration
    # ------------------------------------------------------------------
    def add(
        self,
        channel: MarketDataChannel,
        symbol: str,
        stream_name: str,
        *,
        options: dict[str, str] | None = None,
        subscription_id: str | None = None,
    ) -> Subscription:
        """Register a new subscription.

        Raises :class:`DuplicateSubscription` if the channel/symbol pair is
        already tracked in a non-cancelled state, and
        :class:`SubscriptionLimitExceeded` at the configured ceiling.
        """
        key = (channel.value, symbol)
        existing = self._by_key.get(key)
        if existing is not None and existing.status is not SubscriptionStatus.CANCELLED:
            raise DuplicateSubscription(
                f"{self._exchange} already has a {channel.value} subscription for "
                f"{symbol} (id {existing.subscription_id}, status "
                f"{existing.status.value})."
            )

        if len(self._active_or_pending()) >= self._max_subscriptions:
            raise SubscriptionLimitExceeded(
                f"{self._exchange} connection is at its limit of "
                f"{self._max_subscriptions} subscriptions."
            )

        subscription = Subscription(
            subscription_id=subscription_id or str(uuid.uuid4()),
            exchange=self._exchange,
            channel=channel,
            symbol=symbol,
            stream_name=stream_name,
            options=dict(options or {}),
        )
        self._by_key[key] = subscription
        self._by_id[subscription.subscription_id] = subscription
        return subscription

    def add_if_absent(
        self,
        channel: MarketDataChannel,
        symbol: str,
        stream_name: str,
        *,
        options: dict[str, str] | None = None,
    ) -> tuple[Subscription, bool]:
        """Idempotent :meth:`add`.

        Returns ``(subscription, created)``. Convenient for reconciling a
        desired symbol set against what is already subscribed without
        try/except around the common case.
        """
        existing = self.get(channel, symbol)
        if existing is not None and existing.status is not SubscriptionStatus.CANCELLED:
            return existing, False
        return (
            self.add(channel, symbol, stream_name, options=options),
            True,
        )

    def remove(self, channel: MarketDataChannel, symbol: str) -> Subscription | None:
        """Cancel and forget a subscription. Returns it, or ``None``."""
        key = (channel.value, symbol)
        subscription = self._by_key.pop(key, None)
        if subscription is None:
            return None
        subscription.mark_cancelled()
        self._by_id.pop(subscription.subscription_id, None)
        return subscription

    def remove_by_id(self, subscription_id: str) -> Subscription | None:
        subscription = self._by_id.get(subscription_id)
        if subscription is None:
            return None
        return self.remove(subscription.channel, subscription.symbol)

    def clear(self) -> None:
        """Forget everything. Used when a connection is permanently stopped."""
        self._by_key.clear()
        self._by_id.clear()

    # ------------------------------------------------------------------
    # Lookup
    # ------------------------------------------------------------------
    def get(
        self, channel: MarketDataChannel, symbol: str
    ) -> Subscription | None:
        return self._by_key.get((channel.value, symbol))

    def get_by_id(self, subscription_id: str) -> Subscription | None:
        return self._by_id.get(subscription_id)

    def get_by_stream(self, stream_name: str) -> Subscription | None:
        """Reverse lookup used when routing an inbound message to its stream."""
        for subscription in self._by_key.values():
            if subscription.stream_name == stream_name:
                return subscription
        return None

    def all(self) -> tuple[Subscription, ...]:
        return tuple(self._by_key.values())

    def active(self) -> tuple[Subscription, ...]:
        return tuple(s for s in self._by_key.values() if s.is_active)

    def for_symbol(self, symbol: str) -> tuple[Subscription, ...]:
        return tuple(s for s in self._by_key.values() if s.symbol == symbol)

    def for_channel(self, channel: MarketDataChannel) -> tuple[Subscription, ...]:
        return tuple(s for s in self._by_key.values() if s.channel is channel)

    @property
    def count(self) -> int:
        return len(self._by_key)

    @property
    def active_count(self) -> int:
        return len(self.active())

    @property
    def max_subscriptions(self) -> int:
        return self._max_subscriptions

    def remaining_capacity(self) -> int:
        return max(0, self._max_subscriptions - len(self._active_or_pending()))

    # ------------------------------------------------------------------
    # Reconnect handling
    # ------------------------------------------------------------------
    def mark_all_pending(self) -> None:
        """Demote every subscription to PENDING after a socket drop.

        The new socket has confirmed nothing, so nothing may be reported as
        ACTIVE until the venue acknowledges it again. Without this step a
        reconnected-but-unsubscribed feed would still look fully subscribed.
        """
        for subscription in self._by_key.values():
            if subscription.status is not SubscriptionStatus.CANCELLED:
                subscription.status = SubscriptionStatus.PENDING
                subscription.activated_at = None

    def restorable(self) -> tuple[Subscription, ...]:
        """Subscriptions that must be replayed on a new connection.

        Cancelled subscriptions are excluded; previously failed ones are
        included, because a failure caused by the old connection may not
        recur on the new one.
        """
        return tuple(
            s
            for s in self._by_key.values()
            if s.status is not SubscriptionStatus.CANCELLED
        )

    def stream_names(self) -> tuple[str, ...]:
        """Venue stream names for every restorable subscription."""
        return tuple(s.stream_name for s in self.restorable())

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------
    def _active_or_pending(self) -> list[Subscription]:
        return [
            s
            for s in self._by_key.values()
            if s.status in (SubscriptionStatus.ACTIVE, SubscriptionStatus.PENDING)
        ]
