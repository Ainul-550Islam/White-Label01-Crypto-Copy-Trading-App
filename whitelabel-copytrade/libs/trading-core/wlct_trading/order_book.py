"""In-memory limit order book with strict sequence validation.

This is the hottest object in the platform. Every design choice below trades
generality for predictability:

* **No database access.** Nothing in this module performs I/O. The book lives
  entirely in process memory; persistence happens elsewhere, off the hot path.
* **Dict-of-levels, cached tops.** Levels live in ``dict[Decimal, Decimal]``
  (price -> quantity) which gives O(1) insert, update and delete. Best bid and
  best ask are cached and only recomputed when the cached level is actually
  removed or beaten, so the common case (a level deep in the book changing)
  costs one dict write.
* **Fail loud, never guess.** If the venue's sequence numbers show a gap, the
  book is *emptied* and marked ``RESYNC_REQUIRED``. It will refuse to serve a
  top-of-book until a fresh snapshot arrives. A book that quietly kept applying
  deltas across a gap would look healthy while pricing orders off fiction,
  which is precisely the failure mode this class exists to prevent.

Sequence semantics
------------------
Venues publish depth diffs in two shapes and both are handled:

1. **Explicit predecessor** - the message carries the previous message's final
   id (``previous_final_update_id``). Contiguity requires
   ``previous_final_update_id == current_sequence``.
2. **Range only** - the message carries ``[first_update_id, final_update_id]``.
   Contiguity requires the range to cover ``current_sequence + 1``.

Messages entirely at or below the current sequence are duplicates/replays from
a reconnect and are ignored without error. Anything else is a gap.
"""

from __future__ import annotations

import heapq
from dataclasses import dataclass
from decimal import Decimal

from wlct_trading.clock import epoch_micros
from wlct_trading.enums import ExchangeId, OrderBookHealth, OrderSide
from wlct_trading.market_data import (
    BookTop,
    OrderBookDelta,
    OrderBookSnapshot,
    PriceLevel,
)

__all__ = ["OrderBook", "BookApplyResult", "DepthView"]

_ZERO = Decimal(0)


@dataclass(slots=True, frozen=True)
class BookApplyResult:
    """Outcome of feeding one message to the book."""

    applied: bool
    health: OrderBookHealth
    sequence: int
    reason: str | None = None
    resync_required: bool = False
    ignored_duplicate: bool = False


@dataclass(slots=True, frozen=True)
class DepthView:
    """Aggregated depth to a requested number of levels."""

    bids: tuple[PriceLevel, ...]
    asks: tuple[PriceLevel, ...]
    sequence: int

    @property
    def bid_notional(self) -> Decimal:
        return sum((level.notional for level in self.bids), _ZERO)

    @property
    def ask_notional(self) -> Decimal:
        return sum((level.notional for level in self.asks), _ZERO)


class OrderBook:
    """Mutable order book for a single symbol on a single venue.

    Not thread-safe by design: each book is owned by exactly one asyncio task
    (the feed handler for its symbol), and readers consume the immutable
    :class:`BookTop` values it publishes rather than touching internals. Adding
    a lock would put contention on the hot path for no benefit.
    """

    __slots__ = (
        "exchange",
        "symbol",
        "_bids",
        "_asks",
        "_best_bid",
        "_best_ask",
        "_sequence",
        "_health",
        "_exchange_timestamp",
        "_received_timestamp",
        "_snapshot_count",
        "_gap_count",
        "_applied_count",
        "_ignored_count",
    )

    def __init__(self, exchange: ExchangeId, symbol: str) -> None:
        self.exchange = exchange
        self.symbol = symbol
        self._bids: dict[Decimal, Decimal] = {}
        self._asks: dict[Decimal, Decimal] = {}
        self._best_bid: Decimal | None = None
        self._best_ask: Decimal | None = None
        self._sequence: int = 0
        self._health: OrderBookHealth = OrderBookHealth.UNINITIALISED
        self._exchange_timestamp: int = 0
        self._received_timestamp: int = 0
        self._snapshot_count: int = 0
        self._gap_count: int = 0
        self._applied_count: int = 0
        self._ignored_count: int = 0

    # ------------------------------------------------------------------
    # State
    # ------------------------------------------------------------------
    @property
    def health(self) -> OrderBookHealth:
        return self._health

    @property
    def sequence(self) -> int:
        return self._sequence

    @property
    def is_initialised(self) -> bool:
        return self._health is not OrderBookHealth.UNINITIALISED

    @property
    def is_usable(self) -> bool:
        """Whether the book may be used to price an order.

        Only ``OK`` qualifies. Callers must not fall back to a stale top when
        this is ``False``; the risk engine turns it into a hard rejection.
        """
        return self._health is OrderBookHealth.OK

    @property
    def statistics(self) -> dict[str, int]:
        """Counters for observability dashboards and health probes."""
        return {
            "snapshots": self._snapshot_count,
            "gaps": self._gap_count,
            "applied": self._applied_count,
            "ignored": self._ignored_count,
            "bid_levels": len(self._bids),
            "ask_levels": len(self._asks),
            "sequence": self._sequence,
        }

    def is_stale(self, max_age_micros: int, *, now_micros: int | None = None) -> bool:
        """Whether the last update is older than ``max_age_micros``."""
        if self._received_timestamp == 0:
            return True
        now = epoch_micros() if now_micros is None else now_micros
        return (now - self._received_timestamp) > max_age_micros

    def mark_stale(self) -> None:
        """Flag the book as stale (called by the feed's heartbeat watchdog)."""
        if self._health is OrderBookHealth.OK:
            self._health = OrderBookHealth.STALE

    def require_resync(self, reason: str = "external") -> None:
        """Force a resync, e.g. after a websocket reconnect."""
        self._reset_for_resync()

    # ------------------------------------------------------------------
    # Mutation
    # ------------------------------------------------------------------
    def apply_snapshot(self, snapshot: OrderBookSnapshot) -> BookApplyResult:
        """Replace the entire book with a depth image.

        A snapshot is authoritative: it always wins, clearing any prior state
        including a resync flag. Zero-quantity levels are dropped rather than
        stored, so the book never contains phantom levels.
        """
        if snapshot.symbol != self.symbol or snapshot.exchange != self.exchange:
            return BookApplyResult(
                applied=False,
                health=self._health,
                sequence=self._sequence,
                reason=(
                    f"Snapshot for {snapshot.exchange.value}:{snapshot.symbol} "
                    f"routed to book for {self.exchange.value}:{self.symbol}."
                ),
            )

        self._bids.clear()
        self._asks.clear()
        for level in snapshot.bids:
            if level.quantity > _ZERO:
                self._bids[level.price] = level.quantity
        for level in snapshot.asks:
            if level.quantity > _ZERO:
                self._asks[level.price] = level.quantity

        self._sequence = snapshot.last_update_id
        self._exchange_timestamp = snapshot.exchange_timestamp
        self._received_timestamp = snapshot.received_timestamp
        self._snapshot_count += 1
        self._recompute_best_bid()
        self._recompute_best_ask()
        self._health = OrderBookHealth.OK
        self._validate_not_crossed()

        return BookApplyResult(
            applied=True,
            health=self._health,
            sequence=self._sequence,
            reason=None,
        )

    def apply_delta(self, delta: OrderBookDelta) -> BookApplyResult:
        """Apply an incremental update after validating its sequence.

        Returns a result describing what happened rather than raising, because
        a gap is an expected operational event on a long-lived feed, not an
        exceptional one - the caller reacts by requesting a fresh snapshot.
        """
        if delta.symbol != self.symbol or delta.exchange != self.exchange:
            return BookApplyResult(
                applied=False,
                health=self._health,
                sequence=self._sequence,
                reason=(
                    f"Delta for {delta.exchange.value}:{delta.symbol} routed to "
                    f"book for {self.exchange.value}:{self.symbol}."
                ),
            )

        if not self.is_initialised:
            return BookApplyResult(
                applied=False,
                health=self._health,
                sequence=self._sequence,
                reason="Book has no snapshot yet; delta cannot be applied.",
                resync_required=True,
            )

        if self._health is OrderBookHealth.RESYNC_REQUIRED:
            return BookApplyResult(
                applied=False,
                health=self._health,
                sequence=self._sequence,
                reason="Book is awaiting resync; deltas are refused until a snapshot arrives.",
                resync_required=True,
            )

        verdict, reason = self._validate_sequence(delta)
        if verdict == "duplicate":
            self._ignored_count += 1
            return BookApplyResult(
                applied=False,
                health=self._health,
                sequence=self._sequence,
                reason=reason,
                ignored_duplicate=True,
            )
        if verdict == "gap":
            self._gap_count += 1
            self._reset_for_resync()
            return BookApplyResult(
                applied=False,
                health=self._health,
                sequence=self._sequence,
                reason=reason,
                resync_required=True,
            )

        for level in delta.bids:
            self._apply_level(self._bids, OrderSide.BUY, level)
        for level in delta.asks:
            self._apply_level(self._asks, OrderSide.SELL, level)

        self._sequence = delta.final_update_id
        self._exchange_timestamp = delta.exchange_timestamp
        self._received_timestamp = delta.received_timestamp
        self._applied_count += 1
        self._health = OrderBookHealth.OK
        self._validate_not_crossed()

        return BookApplyResult(
            applied=True,
            health=self._health,
            sequence=self._sequence,
            reason=None,
        )

    # ------------------------------------------------------------------
    # Reads
    # ------------------------------------------------------------------
    @property
    def best_bid(self) -> Decimal | None:
        return self._best_bid

    @property
    def best_ask(self) -> Decimal | None:
        return self._best_ask

    def best_bid_level(self) -> PriceLevel | None:
        if self._best_bid is None:
            return None
        return PriceLevel(price=self._best_bid, quantity=self._bids[self._best_bid])

    def best_ask_level(self) -> PriceLevel | None:
        if self._best_ask is None:
            return None
        return PriceLevel(price=self._best_ask, quantity=self._asks[self._best_ask])

    @property
    def mid_price(self) -> Decimal | None:
        if self._best_bid is None or self._best_ask is None:
            return None
        return (self._best_bid + self._best_ask) / Decimal(2)

    @property
    def spread(self) -> Decimal | None:
        if self._best_bid is None or self._best_ask is None:
            return None
        return self._best_ask - self._best_bid

    @property
    def spread_percent(self) -> Decimal | None:
        mid = self.mid_price
        spread = self.spread
        if mid is None or spread is None or mid == _ZERO:
            return None
        return (spread / mid) * Decimal(100)

    def top(self) -> BookTop:
        """Immutable top-of-book snapshot safe to publish to consumers."""
        bid = self._best_bid
        ask = self._best_ask
        return BookTop(
            exchange=self.exchange,
            symbol=self.symbol,
            best_bid=bid,
            best_bid_quantity=self._bids.get(bid) if bid is not None else None,
            best_ask=ask,
            best_ask_quantity=self._asks.get(ask) if ask is not None else None,
            sequence=self._sequence,
            exchange_timestamp=self._exchange_timestamp,
            received_timestamp=self._received_timestamp,
        )

    def depth(self, levels: int = 10) -> DepthView:
        """Top ``levels`` of each side, best price first.

        ``heapq.nlargest``/``nsmallest`` is O(n log k), which beats sorting the
        whole book when only a shallow view is wanted - the usual case.
        """
        if levels <= 0:
            return DepthView(bids=(), asks=(), sequence=self._sequence)

        best_bids = heapq.nlargest(levels, self._bids.items(), key=lambda item: item[0])
        best_asks = heapq.nsmallest(levels, self._asks.items(), key=lambda item: item[0])
        return DepthView(
            bids=tuple(PriceLevel(price=p, quantity=q) for p, q in best_bids),
            asks=tuple(PriceLevel(price=p, quantity=q) for p, q in best_asks),
            sequence=self._sequence,
        )

    def quantity_at(self, side: OrderSide, price: Decimal) -> Decimal:
        """Resting quantity at an exact price, or zero."""
        book = self._bids if side is OrderSide.BUY else self._asks
        return book.get(price, _ZERO)

    def notional_within(self, side: OrderSide, limit_price: Decimal) -> Decimal:
        """Total notional resting between the touch and ``limit_price``.

        For ``BUY`` this walks the ask side up to ``limit_price`` (what a buy
        would have to lift); for ``SELL`` it walks the bid side down. Used to
        estimate whether an order can be absorbed before it is sent.
        """
        total = _ZERO
        if side is OrderSide.BUY:
            for price, qty in self._asks.items():
                if price <= limit_price:
                    total += price * qty
        else:
            for price, qty in self._bids.items():
                if price >= limit_price:
                    total += price * qty
        return total

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------
    def _validate_sequence(self, delta: OrderBookDelta) -> tuple[str, str | None]:
        """Classify a delta as ``ok``, ``duplicate`` or ``gap``."""
        if delta.final_update_id <= self._sequence:
            return (
                "duplicate",
                (
                    f"Delta final id {delta.final_update_id} is at or below current "
                    f"sequence {self._sequence}; treated as a replay and ignored."
                ),
            )

        if delta.previous_final_update_id is not None:
            if delta.previous_final_update_id != self._sequence:
                return (
                    "gap",
                    (
                        f"Sequence gap: delta expects predecessor "
                        f"{delta.previous_final_update_id} but book is at {self._sequence}."
                    ),
                )
            return ("ok", None)

        # Range form: the message must cover the very next id we need.
        if delta.first_update_id > self._sequence + 1:
            return (
                "gap",
                (
                    f"Sequence gap: delta range starts at {delta.first_update_id} but the "
                    f"next expected id is {self._sequence + 1}."
                ),
            )
        return ("ok", None)

    def _apply_level(
        self,
        book: dict[Decimal, Decimal],
        side: OrderSide,
        level: PriceLevel,
    ) -> None:
        """Insert, update or delete a single level and maintain the cached top."""
        price = level.price
        quantity = level.quantity

        if quantity <= _ZERO:
            if book.pop(price, None) is not None:
                # Only a removal of the current best invalidates the cache.
                if side is OrderSide.BUY and price == self._best_bid:
                    self._recompute_best_bid()
                elif side is OrderSide.SELL and price == self._best_ask:
                    self._recompute_best_ask()
            return

        book[price] = quantity
        if side is OrderSide.BUY:
            if self._best_bid is None or price > self._best_bid:
                self._best_bid = price
        else:
            if self._best_ask is None or price < self._best_ask:
                self._best_ask = price

    def _recompute_best_bid(self) -> None:
        self._best_bid = max(self._bids) if self._bids else None

    def _recompute_best_ask(self) -> None:
        self._best_ask = min(self._asks) if self._asks else None

    def _validate_not_crossed(self) -> None:
        """Mark a crossed book unusable.

        Bid >= ask is arbitrage that cannot exist on a real venue, so it means
        our reconstruction is wrong. Downgrading health here stops the corrupt
        state from reaching the risk engine.
        """
        if self._best_bid is not None and self._best_ask is not None:
            if self._best_bid >= self._best_ask:
                self._health = OrderBookHealth.CROSSED

    def _reset_for_resync(self) -> None:
        """Drop all state and refuse deltas until a snapshot arrives."""
        self._bids.clear()
        self._asks.clear()
        self._best_bid = None
        self._best_ask = None
        self._health = OrderBookHealth.RESYNC_REQUIRED
