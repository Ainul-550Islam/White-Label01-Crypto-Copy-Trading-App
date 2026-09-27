"""Normalised market-data value objects.

Every adapter converts its venue's wire format into exactly these types, so
strategies and the order-book engine never see an exchange-specific field name.

Design notes
------------
* ``Decimal`` is used for every price and quantity. Binary floats silently lose
  precision on values like ``0.1`` and that error compounds through position
  and PnL maths, so floats are not acceptable for money.
* The containers are frozen ``slots`` dataclasses: cheap to allocate, immutable
  once published (so a downstream consumer cannot mutate an event another
  consumer is about to read), and free of per-instance ``__dict__``.
* Timestamps are integer microseconds since the epoch. ``exchange_timestamp``
  is what the venue told us; ``received_timestamp`` is when we saw it. Keeping
  both is what makes feed-lag observable.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal

from wlct_trading.clock import epoch_micros
from wlct_trading.enums import ExchangeId, MarketType, OrderSide

__all__ = [
    "SymbolRef",
    "PriceLevel",
    "Ticker",
    "PublicTrade",
    "OrderBookSnapshot",
    "OrderBookDelta",
    "Candle",
    "BookTop",
]


@dataclass(slots=True, frozen=True)
class SymbolRef:
    """Identifies an instrument on a specific venue.

    ``symbol`` is the platform's canonical, venue-independent form
    (``"BTC-USDT"``); ``venue_symbol`` is whatever that venue calls it
    (``"BTCUSDT"``). Adapters own the mapping in both directions.
    """

    exchange: ExchangeId
    symbol: str
    venue_symbol: str
    market_type: MarketType = MarketType.SPOT

    @property
    def key(self) -> str:
        """Stable composite key used for Redis namespacing and dict lookups."""
        return f"{self.exchange.value}:{self.market_type.value}:{self.symbol}"


@dataclass(slots=True, frozen=True)
class PriceLevel:
    """One resting level of an order book."""

    price: Decimal
    quantity: Decimal

    @property
    def notional(self) -> Decimal:
        return self.price * self.quantity


@dataclass(slots=True, frozen=True)
class Ticker:
    """Best-effort summary quote for a symbol."""

    exchange: ExchangeId
    symbol: str
    bid_price: Decimal | None
    ask_price: Decimal | None
    last_price: Decimal | None
    exchange_timestamp: int
    received_timestamp: int = field(default_factory=epoch_micros)

    @property
    def mid_price(self) -> Decimal | None:
        if self.bid_price is None or self.ask_price is None:
            return None
        return (self.bid_price + self.ask_price) / Decimal(2)

    @property
    def feed_lag_micros(self) -> int:
        return self.received_timestamp - self.exchange_timestamp


@dataclass(slots=True, frozen=True)
class PublicTrade:
    """A trade printed on the public tape.

    ``aggressor_side`` is the side of the *taker*. Venues express this in
    several ways (``m``/``isBuyerMaker``/``side``); adapters normalise it here.
    """

    exchange: ExchangeId
    symbol: str
    trade_id: str
    price: Decimal
    quantity: Decimal
    aggressor_side: OrderSide
    exchange_timestamp: int
    received_timestamp: int = field(default_factory=epoch_micros)

    @property
    def notional(self) -> Decimal:
        return self.price * self.quantity


@dataclass(slots=True, frozen=True)
class OrderBookSnapshot:
    """Full depth image used to (re)initialise a book.

    ``last_update_id`` is the venue's sequence number for this image. Deltas
    older than it must be discarded; a gap above it means the book is stale and
    has to be rebuilt.
    """

    exchange: ExchangeId
    symbol: str
    bids: tuple[PriceLevel, ...]
    asks: tuple[PriceLevel, ...]
    last_update_id: int
    exchange_timestamp: int
    received_timestamp: int = field(default_factory=epoch_micros)


@dataclass(slots=True, frozen=True)
class OrderBookDelta:
    """Incremental book update.

    A level with ``quantity == 0`` is a deletion, which is how every major
    venue encodes removal.

    ``first_update_id``/``final_update_id`` describe the inclusive range of
    sequence numbers this message covers. Venues that publish a single id set
    both to the same value; the order book's sequence validation handles both
    shapes uniformly.
    """

    exchange: ExchangeId
    symbol: str
    bids: tuple[PriceLevel, ...]
    asks: tuple[PriceLevel, ...]
    first_update_id: int
    final_update_id: int
    exchange_timestamp: int
    received_timestamp: int = field(default_factory=epoch_micros)
    previous_final_update_id: int | None = None


@dataclass(slots=True, frozen=True)
class Candle:
    """OHLCV bar. This is the one market-data shape worth persisting."""

    exchange: ExchangeId
    symbol: str
    interval: str
    open_time: int
    close_time: int
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: Decimal
    trade_count: int
    is_closed: bool
    received_timestamp: int = field(default_factory=epoch_micros)


@dataclass(slots=True, frozen=True)
class BookTop:
    """Derived top-of-book view produced by the order-book engine.

    This is the object strategies and the risk engine actually consume; it is
    a plain immutable snapshot so it can be published without the reader
    holding any lock on the live book.
    """

    exchange: ExchangeId
    symbol: str
    best_bid: Decimal | None
    best_bid_quantity: Decimal | None
    best_ask: Decimal | None
    best_ask_quantity: Decimal | None
    sequence: int
    exchange_timestamp: int
    received_timestamp: int

    @property
    def mid_price(self) -> Decimal | None:
        """Arithmetic mid. ``None`` unless both sides are present."""
        if self.best_bid is None or self.best_ask is None:
            return None
        return (self.best_bid + self.best_ask) / Decimal(2)

    @property
    def spread(self) -> Decimal | None:
        """Absolute spread in quote currency."""
        if self.best_bid is None or self.best_ask is None:
            return None
        return self.best_ask - self.best_bid

    @property
    def spread_percent(self) -> Decimal | None:
        """Spread as a percentage of the mid price.

        Mid is the conventional denominator: using the bid or the ask would
        make the figure asymmetric for the two sides of the same book.
        """
        mid = self.mid_price
        spread = self.spread
        if mid is None or spread is None or mid == 0:
            return None
        return (spread / mid) * Decimal(100)

    @property
    def is_crossed(self) -> bool:
        """A crossed book (bid >= ask) indicates corrupt or stale state."""
        if self.best_bid is None or self.best_ask is None:
            return False
        return self.best_bid >= self.best_ask
