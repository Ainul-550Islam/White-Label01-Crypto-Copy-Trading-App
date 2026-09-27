"""A deliberately simple, fully transparent example strategy.

**This strategy is not a trading recommendation and no claim is made that it is
profitable.** Top-of-book imbalance is a widely known, widely arbitraged
statistic; a threshold rule over it has no edge, ignores queue position,
adverse selection, fees and market impact, and would very likely lose money
after costs. It exists here for one reason: to exercise the strategy
architecture end to end with logic simple enough that every test assertion can
be verified by hand.

The rule, in full:

* Compute top-of-book imbalance ``(bid_size - ask_size) / (bid_size + ask_size)``.
* If imbalance ``>= entry_threshold`` and the position is not already long,
  emit ``BUY`` for ``order_quantity``.
* If imbalance ``<= -entry_threshold`` and the position is not already short,
  emit ``SELL`` for ``order_quantity``.
* If a position is open and ``|imbalance| <= exit_threshold``, emit ``CLOSE``.
* Otherwise emit nothing.

Every branch is deterministic given the inputs. There is no randomness, no
clock read, no I/O and no hidden state beyond the counters this class keeps in
its own :class:`~wlct_trading.strategies.state.StrategyState`, which makes the
strategy reproducible under replay by construction.

Safety properties inherited from the base class, not re-implemented here: the
strategy cannot see a credential, cannot see whether execution is paper or
live, cannot reach an exchange, and cannot approve its own risk.
"""

from __future__ import annotations

from decimal import Decimal

from wlct_trading.enums import OrderType, SignalAction, TimeInForce
from wlct_trading.market_data import BookTop
from wlct_trading.signals import Signal
from wlct_trading.strategies.base import Strategy
from wlct_trading.strategies.context import StrategyContext
from wlct_trading.strategies.parameters import (
    ParameterSchema,
    ParameterSpec,
    ParameterType,
)

__all__ = ["DeterministicImbalanceStrategy"]

_ZERO = Decimal(0)
_ONE = Decimal(1)

#: State keys. Namespaced so a future revision of this strategy cannot collide
#: with another strategy sharing the store.
_STATE_DECISIONS = "decisions"
_STATE_LAST_ACTION = "last_action"
_STATE_LAST_IMBALANCE = "last_imbalance"


class DeterministicImbalanceStrategy(Strategy):
    """Threshold rule over top-of-book imbalance. Example only."""

    strategy_key = "DETERMINISTIC_IMBALANCE_V1"
    strategy_version = "1.0.0"
    description = (
        "Reference implementation used to exercise the strategy architecture. "
        "Emits BUY/SELL when top-of-book imbalance crosses a threshold and "
        "CLOSE when it reverts. No profitability claim is made or implied."
    )
    parameter_schema = ParameterSchema.of(
        (
            ParameterSpec(
                name="entry_threshold",
                kind=ParameterType.DECIMAL,
                description=(
                    "Absolute imbalance at or beyond which a position is opened. "
                    "Bounded to (0, 1] because imbalance itself is bounded to "
                    "[-1, +1]."
                ),
                default=Decimal("0.6"),
                minimum=Decimal("0.000001"),
                maximum=Decimal("1"),
            ),
            ParameterSpec(
                name="exit_threshold",
                kind=ParameterType.DECIMAL,
                description=(
                    "Absolute imbalance at or below which an open position is "
                    "closed. Must be below entry_threshold or the strategy would "
                    "open and close on the same tick."
                ),
                default=Decimal("0.2"),
                minimum=_ZERO,
                maximum=Decimal("1"),
            ),
            ParameterSpec(
                name="order_quantity",
                kind=ParameterType.DECIMAL,
                description="Base-asset quantity requested per entry signal.",
                default=Decimal("0.001"),
                minimum=Decimal("0.000000000001"),
            ),
            ParameterSpec(
                name="max_position",
                kind=ParameterType.DECIMAL,
                description=(
                    "Self-imposed absolute position cap. The risk engine's limits "
                    "still apply and are always the binding ones; this only lets "
                    "the strategy restrict itself further."
                ),
                default=Decimal("0.01"),
                minimum=Decimal("0.000000000001"),
            ),
            ParameterSpec(
                name="signal_cooldown_micros",
                kind=ParameterType.INT,
                description=(
                    "Minimum spacing between actionable signals, enforced by the "
                    "engine's cooldown gate."
                ),
                default=1_000_000,
                minimum=0,
                maximum=3_600_000_000,
            ),
            ParameterSpec(
                name="use_limit_orders",
                kind=ParameterType.BOOL,
                description=(
                    "When true the strategy prices at the touch and requests a "
                    "LIMIT order; when false it requests a MARKET order."
                ),
                default=True,
            ),
            ParameterSpec(
                name="signal_ttl_micros",
                kind=ParameterType.INT,
                description=(
                    "How long an emitted signal remains actionable. Expiry is "
                    "enforced by the signal validator."
                ),
                default=2_000_000,
                minimum=1_000,
                maximum=60_000_000,
            ),
        )
    )

    # -- lifecycle -------------------------------------------------------
    def on_initialize(self) -> None:
        """Deterministic initial state: three counters, all at their zero."""
        self._state.set(_STATE_DECISIONS, 0)
        self._state.set(_STATE_LAST_ACTION, SignalAction.HOLD.value)
        self._state.set(_STATE_LAST_IMBALANCE, Decimal(0))
        entry = self._parameters["entry_threshold"]
        exit_level = self._parameters["exit_threshold"]
        if exit_level >= entry:
            raise ValueError(
                f"exit_threshold ({exit_level}) must be below entry_threshold "
                f"({entry}); otherwise the strategy would open and close on the "
                "same event."
            )

    def on_order_book_update(self, top: BookTop) -> None:
        """No work needed here: the engine has already fed the feature engine.

        Overridden to document that fact rather than to do anything. Keeping
        book state in the strategy would duplicate what the feature engine
        already maintains, and the two copies would eventually disagree.
        """

    # -- decision ---------------------------------------------------------
    def evaluate(self, context: StrategyContext) -> Signal | None:
        """Apply the threshold rule. Pure function of the context."""
        imbalance = context.features.order_book_imbalance
        if imbalance is None:
            # No usable two-sided book. Emitting nothing is the correct
            # behaviour: a missing feature is not a neutral reading.
            return None

        self._state.increment(_STATE_DECISIONS)
        self._state.set(_STATE_LAST_IMBALANCE, imbalance)

        entry: Decimal = self._parameters["entry_threshold"]
        exit_level: Decimal = self._parameters["exit_threshold"]
        quantity: Decimal = self._parameters["order_quantity"]
        max_position: Decimal = self._parameters["max_position"]
        use_limit: bool = bool(self._parameters["use_limit_orders"])
        ttl: int = int(self._parameters["signal_ttl_micros"])

        position = context.position_quantity
        top = context.book_top

        # -- exit first: reducing risk always takes precedence -----------
        if position != _ZERO and abs(imbalance) <= exit_level:
            return self._emit(
                context,
                action=SignalAction.CLOSE,
                quantity=None,
                imbalance=imbalance,
                use_limit=False,
                ttl=ttl,
                reason=(
                    f"Imbalance {imbalance} reverted inside the exit band "
                    f"+/-{exit_level}; closing."
                ),
            )

        if imbalance >= entry and position < max_position:
            headroom = max_position - position
            size = quantity if quantity <= headroom else headroom
            if size <= _ZERO:
                return None
            return self._emit(
                context,
                action=SignalAction.BUY,
                quantity=size,
                imbalance=imbalance,
                use_limit=use_limit,
                ttl=ttl,
                price=top.best_bid if top is not None and use_limit else None,
                reason=f"Imbalance {imbalance} at or above entry threshold {entry}.",
            )

        if imbalance <= -entry and position > -max_position:
            headroom = max_position + position
            size = quantity if quantity <= headroom else headroom
            if size <= _ZERO:
                return None
            return self._emit(
                context,
                action=SignalAction.SELL,
                quantity=size,
                imbalance=imbalance,
                use_limit=use_limit,
                ttl=ttl,
                price=top.best_ask if top is not None and use_limit else None,
                reason=f"Imbalance {imbalance} at or below entry threshold -{entry}.",
            )

        return None

    # -- helpers -----------------------------------------------------------
    def _emit(
        self,
        context: StrategyContext,
        *,
        action: SignalAction,
        quantity: Decimal | None,
        imbalance: Decimal,
        use_limit: bool,
        ttl: int,
        price: Decimal | None = None,
        reason: str,
    ) -> Signal | None:
        """Build the signal, or nothing when a limit price is unavailable.

        A LIMIT order with no price is structurally invalid, so rather than
        quietly downgrading to MARKET - which would change the strategy's risk
        profile without anybody asking - the strategy emits nothing.
        """
        if use_limit and price is None:
            return None
        if use_limit and price is not None and price <= _ZERO:
            return None

        self._state.set(_STATE_LAST_ACTION, action.value)
        order_type = OrderType.LIMIT if use_limit else OrderType.MARKET
        return self.build_signal(
            context,
            action=action,
            confidence=self._confidence(imbalance),
            target_quantity=quantity,
            order_type=order_type,
            limit_price=price if use_limit else None,
            time_in_force=TimeInForce.GTC,
            reason=reason,
            valid_for_micros=ttl,
            feature_keys=(
                "order_book_imbalance",
                "mid_price",
                "spread",
                "bid_size",
                "ask_size",
            ),
            metadata={"rule": "imbalance_threshold"},
        )

    def _confidence(self, imbalance: Decimal) -> Decimal:
        """Absolute imbalance, clamped to ``[0, 1]``.

        Confidence here is a scaled reading of the driving feature, nothing
        more. It is explicitly **not** a probability and carries no statistical
        guarantee - the sizing layer may use it to scale, and that is all.
        """
        magnitude = abs(imbalance)
        if magnitude > _ONE:
            return _ONE
        if magnitude < _ZERO:  # pragma: no cover - abs() is non-negative
            return _ZERO
        return magnitude

    # -- introspection ------------------------------------------------------
    @property
    def decision_count(self) -> int:
        return self._state.get_int(_STATE_DECISIONS, 0)

    @property
    def last_action(self) -> str:
        value = self._state.get(_STATE_LAST_ACTION, SignalAction.HOLD.value)
        return str(value)

    @property
    def last_imbalance(self) -> Decimal | None:
        return self._state.get_decimal(_STATE_LAST_IMBALANCE)
