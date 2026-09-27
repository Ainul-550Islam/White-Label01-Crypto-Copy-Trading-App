"""The feature engine: normalised market data in, a feature snapshot out.

One :class:`FeatureEngine` belongs to exactly one strategy instance and one
symbol. That is not an efficiency compromise, it is the isolation boundary:
two instances trading the same symbol keep entirely separate rolling state, so
one cannot see the other's history or be perturbed by its reset.

The engine is:

* **synchronous and allocation-light** - it runs on the market-data loop and
  performs no I/O, no logging and no database access;
* **deterministic** - identical event sequences produce identical snapshots,
  which is what makes the backtest reproducible;
* **``None``-honest** - a feature that lacks history is absent from the
  snapshot rather than defaulted to zero.

Nothing here calls a clock. Every timestamp comes from the event or from the
caller, so the engine behaves identically under live data and under replay.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Mapping

from wlct_trading.enums import ExchangeId, OrderSide
from wlct_trading.market_data import BookTop, Candle, PublicTrade, Ticker
from wlct_trading.strategies.features.microstructure import (
    mid_price,
    order_book_imbalance,
    spread,
    spread_basis_points,
    spread_percent,
    weighted_mid_price,
)
from wlct_trading.strategies.features.rolling import RollingReturns, RollingWindow

__all__ = [
    "FeatureConfig",
    "FeatureSnapshot",
    "FeatureEngine",
]

_ZERO = Decimal(0)


@dataclass(slots=True, frozen=True)
class FeatureConfig:
    """Window sizes for the derived features.

    Every window is bounded, so total memory per instance is fixed at
    construction. ``min_samples`` mirrors the capacity for each window: the
    engine reports a rolling feature only once its window is full.
    """

    return_window: int = 20
    volatility_window: int = 20
    volume_window: int = 50
    spread_window: int = 20
    trade_window: int = 50

    def __post_init__(self) -> None:
        for name in (
            "return_window",
            "volatility_window",
            "volume_window",
            "spread_window",
            "trade_window",
        ):
            value = getattr(self, name)
            if not isinstance(value, int) or value < 1:
                raise ValueError(f"FeatureConfig.{name} must be a positive integer.")
            if value > 100_000:
                raise ValueError(
                    f"FeatureConfig.{name} is implausibly large ({value}); "
                    "windows are bounded on purpose."
                )


@dataclass(slots=True, frozen=True)
class FeatureSnapshot:
    """Immutable view of every feature at one instant.

    A field is ``None`` when it could not be computed - missing side of the
    book, not enough history, zero denominator. Consumers must handle ``None``;
    the signal validator refuses any signal whose stated driver is ``None``.

    ``as_of_micros`` is the *event* timestamp the snapshot describes, not the
    time the snapshot was taken, so a snapshot replayed from history carries
    the historical instant.
    """

    exchange: ExchangeId
    symbol: str
    as_of_micros: int

    # -- touch-derived -------------------------------------------------
    best_bid: Decimal | None = None
    best_ask: Decimal | None = None
    bid_size: Decimal | None = None
    ask_size: Decimal | None = None
    mid_price: Decimal | None = None
    weighted_mid_price: Decimal | None = None
    spread: Decimal | None = None
    spread_percent: Decimal | None = None
    spread_basis_points: Decimal | None = None
    order_book_imbalance: Decimal | None = None
    last_trade_price: Decimal | None = None

    # -- rolling -------------------------------------------------------
    short_term_return: Decimal | None = None
    rolling_return_mean: Decimal | None = None
    rolling_volatility: Decimal | None = None
    rolling_spread_mean: Decimal | None = None
    rolling_volume: Decimal | None = None

    # -- tape ----------------------------------------------------------
    trade_count: int = 0
    buy_volume: Decimal = _ZERO
    sell_volume: Decimal = _ZERO

    #: Number of book updates the engine has processed for this instance.
    book_update_count: int = 0

    def value(self, name: str) -> Decimal | None:
        """Look a feature up by name. Unknown names return ``None``."""
        return self.as_mapping().get(name)

    def as_mapping(self) -> Mapping[str, Decimal | None]:
        """Every numeric feature keyed by its snake_case name."""
        return {
            "best_bid": self.best_bid,
            "best_ask": self.best_ask,
            "bid_size": self.bid_size,
            "ask_size": self.ask_size,
            "mid_price": self.mid_price,
            "weighted_mid_price": self.weighted_mid_price,
            "spread": self.spread,
            "spread_percent": self.spread_percent,
            "spread_basis_points": self.spread_basis_points,
            "order_book_imbalance": self.order_book_imbalance,
            "last_trade_price": self.last_trade_price,
            "short_term_return": self.short_term_return,
            "rolling_return_mean": self.rolling_return_mean,
            "rolling_volatility": self.rolling_volatility,
            "rolling_spread_mean": self.rolling_spread_mean,
            "rolling_volume": self.rolling_volume,
            "buy_volume": self.buy_volume,
            "sell_volume": self.sell_volume,
        }

    def to_string_map(self, *, only: tuple[str, ...] | None = None) -> dict[str, str]:
        """Stringified features for signal metadata and structured logs.

        ``None`` values are omitted rather than rendered as ``"None"``, so a
        reader can distinguish "not computed" from a real value. Contains no
        credential material: the feature engine is never given one.
        """
        mapping = self.as_mapping()
        keys = only if only is not None else tuple(mapping.keys())
        out: dict[str, str] = {}
        for key in keys:
            value = mapping.get(key)
            if value is None:
                continue
            out[key] = str(value)
        out["trade_count"] = str(self.trade_count)
        out["as_of_micros"] = str(self.as_of_micros)
        return out

    def to_dict(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "exchange": self.exchange.value,
            "symbol": self.symbol,
            "asOfMicros": self.as_of_micros,
            "tradeCount": self.trade_count,
            "bookUpdateCount": self.book_update_count,
        }
        for key, value in self.as_mapping().items():
            payload[key] = str(value) if value is not None else None
        return payload


class FeatureEngine:
    """Accumulates rolling state for one ``(exchange, symbol)`` instance.

    Feed it normalised market data through the ``observe_*`` methods and ask
    for a :meth:`snapshot` whenever a decision is due. The engine never decides
    anything itself and never emits a signal.
    """

    __slots__ = (
        "_exchange",
        "_symbol",
        "_config",
        "_returns",
        "_spreads",
        "_volumes",
        "_top",
        "_ticker",
        "_last_trade",
        "_last_candle",
        "_trade_count",
        "_buy_volume",
        "_sell_volume",
        "_book_update_count",
        "_last_event_micros",
        "_error_count",
    )

    def __init__(
        self,
        *,
        exchange: ExchangeId,
        symbol: str,
        config: FeatureConfig | None = None,
    ) -> None:
        if not symbol:
            raise ValueError("FeatureEngine requires a symbol.")
        self._exchange = exchange
        self._symbol = symbol
        self._config = config or FeatureConfig()
        self._returns = RollingReturns(capacity=self._config.return_window)
        self._spreads = RollingWindow(capacity=self._config.spread_window)
        self._volumes = RollingWindow(capacity=self._config.volume_window)
        self._top: BookTop | None = None
        self._ticker: Ticker | None = None
        self._last_trade: PublicTrade | None = None
        self._last_candle: Candle | None = None
        self._trade_count = 0
        self._buy_volume = _ZERO
        self._sell_volume = _ZERO
        self._book_update_count = 0
        self._last_event_micros = 0
        self._error_count = 0

    # -- identity ------------------------------------------------------
    @property
    def exchange(self) -> ExchangeId:
        return self._exchange

    @property
    def symbol(self) -> str:
        return self._symbol

    @property
    def config(self) -> FeatureConfig:
        return self._config

    @property
    def error_count(self) -> int:
        """Number of observations rejected as unusable."""
        return self._error_count

    @property
    def book_top(self) -> BookTop | None:
        return self._top

    @property
    def ticker(self) -> Ticker | None:
        return self._ticker

    @property
    def last_trade(self) -> PublicTrade | None:
        return self._last_trade

    @property
    def last_candle(self) -> Candle | None:
        return self._last_candle

    @property
    def last_event_micros(self) -> int:
        return self._last_event_micros

    # -- observation ---------------------------------------------------
    def observe_book_top(self, top: BookTop) -> None:
        """Record a top-of-book update.

        A crossed book is counted as an error and ignored: it means the book is
        corrupt or mid-resync, and folding it into the rolling statistics would
        contaminate them for the whole window length.
        """
        if top.symbol != self._symbol or top.exchange is not self._exchange:
            self._error_count += 1
            return
        if top.is_crossed:
            self._error_count += 1
            return
        self._top = top
        self._book_update_count += 1
        self._last_event_micros = max(self._last_event_micros, top.exchange_timestamp)

        mid = mid_price(top)
        if mid is not None and mid > _ZERO:
            self._returns.push_price(mid)
        absolute_spread = spread(top)
        if absolute_spread is not None and absolute_spread >= _ZERO:
            self._spreads.push(absolute_spread)

    def observe_ticker(self, ticker: Ticker) -> None:
        """Record a ticker update.

        The ticker is kept for reference and freshness, but rolling price
        statistics are driven from the order book when one is available: the
        book is the higher-fidelity source and mixing the two would produce a
        return series with inconsistent sampling.
        """
        if ticker.symbol != self._symbol or ticker.exchange is not self._exchange:
            self._error_count += 1
            return
        self._ticker = ticker
        self._last_event_micros = max(self._last_event_micros, ticker.exchange_timestamp)
        if self._top is None:
            mid = ticker.mid_price
            if mid is not None and mid > _ZERO:
                self._returns.push_price(mid)

    def observe_trade(self, trade: PublicTrade) -> None:
        """Record one public trade print."""
        if trade.symbol != self._symbol or trade.exchange is not self._exchange:
            self._error_count += 1
            return
        if trade.quantity < _ZERO or trade.price <= _ZERO:
            self._error_count += 1
            return
        self._last_trade = trade
        self._trade_count += 1
        self._last_event_micros = max(self._last_event_micros, trade.exchange_timestamp)
        self._volumes.push(trade.quantity)
        if trade.aggressor_side is OrderSide.BUY:
            self._buy_volume += trade.quantity
        else:
            self._sell_volume += trade.quantity

    def observe_candle(self, candle: Candle) -> None:
        """Record a candle. Only closed candles update rolling statistics."""
        if candle.symbol != self._symbol or candle.exchange is not self._exchange:
            self._error_count += 1
            return
        self._last_candle = candle
        self._last_event_micros = max(self._last_event_micros, candle.close_time)
        if candle.is_closed and self._top is None and candle.close > _ZERO:
            self._returns.push_price(candle.close)

    # -- output --------------------------------------------------------
    def snapshot(self, *, as_of_micros: int | None = None) -> FeatureSnapshot:
        """Materialise the current feature values.

        ``as_of_micros`` defaults to the latest observed event timestamp, never
        to the wall clock: a snapshot must describe the data it has seen, and
        reading a clock here would make replay non-deterministic.
        """
        top = self._top
        best_bid = top.best_bid if top is not None else None
        best_ask = top.best_ask if top is not None else None
        bid_size = top.best_bid_quantity if top is not None else None
        ask_size = top.best_ask_quantity if top is not None else None

        return FeatureSnapshot(
            exchange=self._exchange,
            symbol=self._symbol,
            as_of_micros=(
                self._last_event_micros if as_of_micros is None else as_of_micros
            ),
            best_bid=best_bid,
            best_ask=best_ask,
            bid_size=bid_size,
            ask_size=ask_size,
            mid_price=mid_price(top) if top is not None else None,
            weighted_mid_price=weighted_mid_price(top) if top is not None else None,
            spread=spread(top) if top is not None else None,
            spread_percent=spread_percent(top) if top is not None else None,
            spread_basis_points=spread_basis_points(top) if top is not None else None,
            order_book_imbalance=order_book_imbalance(bid_size, ask_size),
            last_trade_price=(
                self._last_trade.price if self._last_trade is not None else None
            ),
            short_term_return=self._returns.latest,
            rolling_return_mean=self._returns.mean,
            rolling_volatility=self._returns.volatility,
            rolling_spread_mean=self._spreads.mean,
            rolling_volume=self._volumes.total,
            trade_count=self._trade_count,
            buy_volume=self._buy_volume,
            sell_volume=self._sell_volume,
            book_update_count=self._book_update_count,
        )

    def reset(self) -> None:
        """Return to the deterministic initial state.

        Used when a book is invalidated after a reconnect: continuing a rolling
        window across a gap in the data would silently blend two disjoint
        periods into one statistic.
        """
        self._returns.reset()
        self._spreads.reset()
        self._volumes.reset()
        self._top = None
        self._ticker = None
        self._last_trade = None
        self._last_candle = None
        self._trade_count = 0
        self._buy_volume = _ZERO
        self._sell_volume = _ZERO
        self._book_update_count = 0
        self._last_event_micros = 0
        self._error_count = 0
