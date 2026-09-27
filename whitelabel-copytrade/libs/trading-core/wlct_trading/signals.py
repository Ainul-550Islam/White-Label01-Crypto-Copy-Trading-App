"""Strategy signals and the strategy base class.

A signal is a strategy's *opinion*. It is never an instruction: nothing in this
module can place an order. Signals are converted to
:class:`~wlct_trading.orders.OrderIntent` by the signal router, and every
intent must clear the risk engine before the execution engine will look at it.
That ordering is what makes "a strategy cannot bypass risk" a structural
property rather than a convention.

``BaseStrategy`` defines the full lifecycle the platform drives. Handlers are
plain (non-async) methods called from the feed loop: a strategy that wants to
do I/O must hand work to a queue rather than block the loop that is
maintaining every order book.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from decimal import Decimal

from wlct_trading.clock import epoch_micros
from wlct_trading.enums import (
    ExchangeId,
    OrderSide,
    OrderType,
    SignalAction,
    TimeInForce,
)
from wlct_trading.market_data import BookTop, Candle, PublicTrade, Ticker
from wlct_trading.orders import OrderIntent

__all__ = [
    "Signal",
    "SignalValidationError",
    "StrategyRiskProfile",
    "StrategyDescriptor",
    "BaseStrategy",
    "signal_to_intent",
]

_ZERO = Decimal(0)
_ONE = Decimal(1)


class SignalValidationError(Exception):
    """Raised when a signal is structurally unusable."""


@dataclass(slots=True, frozen=True)
class Signal:
    """A normalised trading opinion emitted by a strategy.

    ``confidence`` is a 0..1 scalar the sizing layer may use to scale the
    order; it is not a probability and carries no statistical guarantee.
    """

    signal_id: str
    tenant_id: str
    strategy_id: str
    exchange: ExchangeId
    symbol: str
    action: SignalAction
    confidence: Decimal
    reference_price: Decimal | None
    target_quantity: Decimal | None = None
    order_type: OrderType = OrderType.LIMIT
    limit_price: Decimal | None = None
    stop_price: Decimal | None = None
    time_in_force: TimeInForce = TimeInForce.GTC
    reason: str | None = None
    created_at: int = field(default_factory=epoch_micros)
    metadata: dict[str, str] = field(default_factory=dict)

    # -- Part 6 additions ------------------------------------------------
    # Appended with defaults so every existing construction site keeps working
    # unchanged. The strategy layer always populates them; the Part 2 code
    # paths that predate them continue to compile and behave identically.
    #
    #: Version of the strategy implementation that produced this signal.
    #: Recorded on every downstream artefact so a decision can always be
    #: attributed to the exact code that made it.
    strategy_version: str = ""
    #: Wall-clock microseconds after which this opinion must not be acted on.
    #: ``None`` means the signal does not expire on its own and is governed
    #: solely by the validator's freshness window.
    expires_at: int | None = None
    #: Selected feature values, stringified, that explain the decision. Values
    #: are strings so the whole map is persistable, publishable and loggable
    #: with no serialisation step. Never carries a credential: the strategy
    #: layer is never given one.
    features: dict[str, str] = field(default_factory=dict)

    def is_expired(self, now_micros: int) -> bool:
        """Whether this signal's own expiry has passed."""
        if self.expires_at is None:
            return False
        return now_micros > self.expires_at

    def age_micros(self, now_micros: int) -> int:
        """How long ago the signal was created. Negative means clock skew."""
        return now_micros - self.created_at

    def validation_errors(self) -> list[str]:
        """All structural problems with this signal, in one pass."""
        errors: list[str] = []
        if not self.signal_id:
            errors.append("signal_id is required.")
        if not self.tenant_id:
            errors.append("tenant_id is required.")
        if not self.strategy_id:
            errors.append("strategy_id is required.")
        if not self.symbol:
            errors.append("symbol is required.")
        if self.confidence < _ZERO or self.confidence > _ONE:
            errors.append("confidence must be between 0 and 1 inclusive.")

        if self.action is SignalAction.HOLD:
            # HOLD carries no execution parameters; nothing further to check.
            return errors

        if self.action in (SignalAction.BUY, SignalAction.SELL):
            if self.target_quantity is None:
                errors.append(f"{self.action.value} signals require a target_quantity.")
            elif self.target_quantity <= _ZERO:
                errors.append("target_quantity must be greater than zero.")

        if self.order_type.requires_price and self.limit_price is None:
            errors.append(f"{self.order_type.value} signals require a limit_price.")
        if self.order_type.requires_stop_price and self.stop_price is None:
            errors.append(f"{self.order_type.value} signals require a stop_price.")
        if self.limit_price is not None and self.limit_price <= _ZERO:
            errors.append("limit_price must be greater than zero.")
        if self.stop_price is not None and self.stop_price <= _ZERO:
            errors.append("stop_price must be greater than zero.")
        if self.order_type is OrderType.MARKET and self.limit_price is not None:
            errors.append("MARKET signals must not carry a limit_price.")
        if self.expires_at is not None and self.expires_at <= self.created_at:
            errors.append("expires_at must be after created_at.")
        return errors

    @property
    def is_valid(self) -> bool:
        return not self.validation_errors()

    def raise_if_invalid(self) -> None:
        errors = self.validation_errors()
        if errors:
            raise SignalValidationError("; ".join(errors))


@dataclass(slots=True, frozen=True)
class StrategyRiskProfile:
    """Per-strategy limits, layered *under* the account and global limits.

    The effective limit is always the tightest of the three. A strategy can
    therefore restrict itself further but can never widen an account or
    platform limit.
    """

    max_order_quantity: Decimal
    max_position_quantity: Decimal
    max_order_notional: Decimal
    max_daily_loss: Decimal
    max_open_orders: int
    max_orders_per_minute: int
    max_price_deviation_percent: Decimal = Decimal("2")


@dataclass(slots=True, frozen=True)
class StrategyDescriptor:
    """Immutable identity and configuration of a strategy instance."""

    strategy_id: str
    tenant_id: str
    name: str
    version: str
    enabled: bool
    exchange: ExchangeId
    symbols: tuple[str, ...]
    risk_profile: StrategyRiskProfile
    config: dict[str, str] = field(default_factory=dict)


class BaseStrategy:
    """Lifecycle contract every strategy implements.

    Subclasses override the ``on_*`` handlers they care about and implement
    :meth:`generate_signal`. The default handlers are no-ops so a strategy that
    only reacts to trades does not have to stub out the book callbacks.
    """

    def __init__(self, descriptor: StrategyDescriptor) -> None:
        self.descriptor = descriptor
        self._running = False
        self._initialised = False

    # -- identity ------------------------------------------------------
    @property
    def strategy_id(self) -> str:
        return self.descriptor.strategy_id

    @property
    def name(self) -> str:
        return self.descriptor.name

    @property
    def version(self) -> str:
        return self.descriptor.version

    @property
    def symbols(self) -> tuple[str, ...]:
        return self.descriptor.symbols

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def is_initialised(self) -> bool:
        return self._initialised

    # -- lifecycle -----------------------------------------------------
    def initialize(self) -> None:
        """Prepare internal state. Called once before the first ``start``."""
        self._initialised = True

    def start(self) -> None:
        """Begin consuming market data.

        Refuses to start a strategy the control plane has disabled, so a stale
        in-memory registry cannot resurrect a strategy an operator switched
        off.
        """
        if not self._initialised:
            self.initialize()
        if not self.descriptor.enabled:
            raise RuntimeError(
                f"Strategy {self.strategy_id} is disabled and cannot be started."
            )
        self._running = True

    def stop(self) -> None:
        """Stop consuming market data. Idempotent."""
        self._running = False

    # -- market data handlers -----------------------------------------
    def on_market_data(self, ticker: Ticker) -> None:
        """Called for each normalised ticker update."""

    def on_order_book_update(self, top: BookTop) -> None:
        """Called for each top-of-book change on a subscribed symbol."""

    def on_trade(self, trade: PublicTrade) -> None:
        """Called for each public trade print."""

    def on_candle(self, candle: Candle) -> None:
        """Called for each candle update."""

    def on_timer(self, now_micros: int) -> None:
        """Called on the engine's timer tick.

        Gives a strategy a way to act on the passage of time - expiring a
        quote, flattening at a cut-off - without waiting for the next market
        event. ``now_micros`` is the engine's notion of now: wall clock when
        live, and the *simulated* clock during a backtest, so a strategy that
        uses it stays deterministic under replay.
        """

    # -- signal generation ---------------------------------------------
    def generate_signal(self, symbol: str) -> Signal | None:
        """Produce the strategy's current opinion for ``symbol``.

        Returning ``None`` means "no opinion" and is distinct from returning a
        ``HOLD`` signal, which is an explicit, recorded decision to stay flat.
        """
        raise NotImplementedError(
            f"Strategy {self.descriptor.name} must implement generate_signal()."
        )

    # -- helpers --------------------------------------------------------
    def new_signal_id(self) -> str:
        return str(uuid.uuid4())


def signal_to_intent(
    signal: Signal,
    *,
    account_id: str,
    current_position_quantity: Decimal,
) -> OrderIntent | None:
    """Translate a validated signal into an order intent.

    Returns ``None`` for ``HOLD``, and for ``CLOSE`` when the position is
    already flat - in both cases there is nothing to send.

    ``CLOSE`` is resolved here rather than in the strategy so that the closing
    quantity always reflects the position the execution engine actually holds,
    not what the strategy believed it held.
    """
    signal.raise_if_invalid()

    if signal.action is SignalAction.HOLD:
        return None

    if signal.action is SignalAction.CLOSE:
        if current_position_quantity == _ZERO:
            return None
        side = OrderSide.SELL if current_position_quantity > _ZERO else OrderSide.BUY
        quantity = abs(current_position_quantity)
        reduce_only = True
    else:
        side = OrderSide.BUY if signal.action is SignalAction.BUY else OrderSide.SELL
        if signal.target_quantity is None:
            raise SignalValidationError(
                f"Signal {signal.signal_id} has no target_quantity."
            )
        quantity = signal.target_quantity
        reduce_only = False

    return OrderIntent(
        tenant_id=signal.tenant_id,
        account_id=account_id,
        strategy_id=signal.strategy_id,
        exchange=signal.exchange,
        symbol=signal.symbol,
        side=side,
        order_type=signal.order_type,
        quantity=quantity,
        price=signal.limit_price,
        stop_price=signal.stop_price,
        time_in_force=signal.time_in_force,
        reduce_only=reduce_only,
        signal_id=signal.signal_id,
    )
