"""The read-only view a strategy is given when it is asked to decide.

:class:`StrategyContext` is the *entire* surface a strategy sees. Everything it
is allowed to know is a field on this object, and everything it is not allowed
to know is absent - not hidden behind a permission check, absent.

What is deliberately not here, and why:

``credentials``
    No API key, secret, signing key or listen key. Authentication belongs to
    the Part 5 adapter layer and never leaves it. A strategy that cannot see a
    credential cannot leak one into a log line, a metric label or a signal.
``trading mode``
    A strategy is not told whether its signals will be executed on paper or
    live. If it knew, it could behave differently in the two modes, and the
    paper results would stop being evidence about the live path. The Part 5
    execution layer decides what happens to a signal.
``the risk engine``
    The context carries a read-only :class:`StrategyRiskView` so a strategy can
    size sensibly, but there is no method on it that approves anything. Only
    :class:`~wlct_trading.risk.RiskEngine` can approve an order, and it runs
    after the strategy has finished.
``any way to place an order``
    No adapter, no client, no callback that reaches a venue. A strategy's only
    output is a :class:`~wlct_trading.signals.Signal` returned from
    :meth:`~wlct_trading.strategies.base.Strategy.evaluate`.

The context is a frozen dataclass rebuilt per decision, so a strategy cannot
retain one and mutate it into a stale view of the world.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal

from wlct_trading.enums import ExchangeId, MarketType
from wlct_trading.market_data import BookTop, Candle, PublicTrade, Ticker
from wlct_trading.orders import Order
from wlct_trading.positions import Position
from wlct_trading.strategies.features.engine import FeatureSnapshot
from wlct_trading.strategies.state import StrategyInstanceKey, StrategyState

__all__ = ["StrategyRiskView", "StrategyContext"]

_ZERO = Decimal(0)


@dataclass(slots=True, frozen=True)
class StrategyRiskView:
    """What a strategy may know about risk. Read-only by construction.

    There is no ``approve``, ``authorise`` or ``override`` method here and
    there never will be: the risk engine is the only component that can permit
    an order, and it is invoked after the strategy returns.

    ``is_available`` is the fail-closed flag. When the host could not load risk
    state it passes ``is_available=False``, and the signal validator refuses
    every signal produced against that view rather than letting a strategy size
    against unknown exposure.
    """

    is_available: bool
    max_position_quantity: Decimal | None = None
    max_order_quantity: Decimal | None = None
    current_position_quantity: Decimal = _ZERO
    symbol_exposure_notional: Decimal = _ZERO
    account_exposure_notional: Decimal = _ZERO
    open_order_count: int = 0
    realised_pnl_today: Decimal | None = None

    @property
    def available_position_budget(self) -> Decimal | None:
        """Remaining quantity before the position limit binds.

        ``None`` when no limit is known - which a strategy must treat as "do
        not size up", never as "unlimited". Never negative: an already-breached
        limit reports zero headroom.
        """
        if not self.is_available or self.max_position_quantity is None:
            return None
        headroom = self.max_position_quantity - abs(self.current_position_quantity)
        return headroom if headroom > _ZERO else _ZERO

    def to_dict(self) -> dict[str, object]:
        return {
            "isAvailable": self.is_available,
            "maxPositionQuantity": (
                str(self.max_position_quantity)
                if self.max_position_quantity is not None
                else None
            ),
            "maxOrderQuantity": (
                str(self.max_order_quantity)
                if self.max_order_quantity is not None
                else None
            ),
            "currentPositionQuantity": str(self.current_position_quantity),
            "symbolExposureNotional": str(self.symbol_exposure_notional),
            "accountExposureNotional": str(self.account_exposure_notional),
            "openOrderCount": self.open_order_count,
            "availablePositionBudget": (
                str(self.available_position_budget)
                if self.available_position_budget is not None
                else None
            ),
        }


@dataclass(slots=True, frozen=True)
class StrategyContext:
    """Everything a strategy is given for one decision.

    ``event_timestamp_micros`` is the timestamp of the market event that
    triggered this decision, and it is the *only* notion of "now" a strategy
    should use. Under replay it is the historical instant, which is what keeps
    a backtest free of wall-clock dependence.

    ``processing_timestamp_micros`` is when the platform started handling the
    event. It exists for observability - the difference between the two is
    feed lag plus queueing - and must not be used in a trading decision, since
    it differs between live and replay.
    """

    key: StrategyInstanceKey
    event_timestamp_micros: int
    processing_timestamp_micros: int
    features: FeatureSnapshot
    state: StrategyState
    parameters: dict[str, object] = field(default_factory=dict)
    book_top: BookTop | None = None
    ticker: Ticker | None = None
    last_trade: PublicTrade | None = None
    last_candle: Candle | None = None
    position: Position | None = None
    open_orders: tuple[Order, ...] = field(default_factory=tuple)
    risk: StrategyRiskView = field(
        default_factory=lambda: StrategyRiskView(is_available=False)
    )
    #: Whether the market data backing this decision is considered fresh by the
    #: host's staleness monitor. A strategy may read it; the validator enforces
    #: it regardless, so a strategy that ignores it still cannot act on stale
    #: data.
    market_data_is_fresh: bool = True

    # -- identity passthrough -------------------------------------------
    @property
    def instance_id(self) -> str:
        return self.key.instance_id

    @property
    def tenant_id(self) -> str:
        return self.key.tenant_id

    @property
    def strategy_key(self) -> str:
        return self.key.strategy_key

    @property
    def strategy_version(self) -> str:
        return self.key.strategy_version

    @property
    def exchange(self) -> ExchangeId:
        return self.key.exchange

    @property
    def market_type(self) -> MarketType:
        return self.key.market_type

    @property
    def symbol(self) -> str:
        return self.key.symbol

    # -- convenience -----------------------------------------------------
    @property
    def position_quantity(self) -> Decimal:
        """Signed position size, zero when flat or unknown."""
        return self.position.quantity if self.position is not None else _ZERO

    @property
    def is_flat(self) -> bool:
        return self.position_quantity == _ZERO

    @property
    def open_order_count(self) -> int:
        return len(self.open_orders)

    @property
    def mid_price(self) -> Decimal | None:
        """Best available mid. Book first, ticker second, then nothing.

        Never falls back to the last trade price: a trade print is a
        transaction that already happened, not a current quote, and using one
        as a mid silently changes what every spread-based feature means.
        """
        if self.features.mid_price is not None:
            return self.features.mid_price
        if self.ticker is not None:
            return self.ticker.mid_price
        return None

    def parameter(self, name: str, default: object = None) -> object:
        return self.parameters.get(name, default)

    def decimal_parameter(self, name: str) -> Decimal | None:
        value = self.parameters.get(name)
        if isinstance(value, Decimal):
            return value
        if isinstance(value, int) and not isinstance(value, bool):
            return Decimal(value)
        return None

    def int_parameter(self, name: str, default: int = 0) -> int:
        value = self.parameters.get(name)
        if isinstance(value, bool):
            return default
        if isinstance(value, int):
            return value
        return default

    def to_log_fields(self) -> dict[str, object]:
        """Structured-log fields for this decision.

        Contains identity, timestamps and a small set of features. It cannot
        contain a credential because the context never holds one.
        """
        return {
            "instanceId": self.instance_id,
            "tenantId": self.tenant_id,
            "strategyKey": self.strategy_key,
            "strategyVersion": self.strategy_version,
            "exchange": self.exchange.value,
            "symbol": self.symbol,
            "eventTimestampMicros": self.event_timestamp_micros,
            "processingTimestampMicros": self.processing_timestamp_micros,
            "positionQuantity": str(self.position_quantity),
            "openOrderCount": self.open_order_count,
            "marketDataIsFresh": self.market_data_is_fresh,
        }
