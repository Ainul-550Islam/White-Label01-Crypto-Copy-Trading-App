"""Signal validation: the gate between a strategy and the risk engine.

Ordering, which is the whole point of this module::

    Strategy -> Signal -> [SignalValidator] -> RiskEngine -> ExecutionEngine

Validation asks whether a signal is *well-formed, fresh and permitted to
exist*. Risk asks whether the resulting trade is within limits. They are
separate questions with separate vocabularies, and both must pass.

Three properties are enforced structurally:

* **Nothing is silently modified.** The validator returns a verdict about the
  signal it was given. It never rounds a quantity, clamps a price or downgrades
  an action - a strategy's output is either acceptable as written or rejected
  with a reason.
* **Fail closed.** Missing state is a rejection. If the validator cannot
  establish that the strategy is enabled, that the market data is fresh, or
  that risk state was available, it refuses.
* **Kill switches are honoured here too.** The risk engine checks them again -
  that redundancy is deliberate - but a signal blocked by a kill switch should
  never even reach risk evaluation.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal

from wlct_trading.enums import (
    ExchangeId,
    KillSwitchScope,
    OrderType,
    SignalAction,
    SignalRejectionCode,
    StrategyStatus,
)
from wlct_trading.risk import KillSwitchState
from wlct_trading.signals import Signal
from wlct_trading.strategies.signals import CooldownGate, SignalDeduplicator

__all__ = [
    "SignalValidationConfig",
    "SignalValidationResult",
    "SignalValidator",
]

_ZERO = Decimal(0)


@dataclass(slots=True, frozen=True)
class SignalValidationConfig:
    """Freshness and sizing bounds applied to every signal.

    Defaults are conservative on purpose. A signal older than two seconds is
    refused, and market data older than five seconds is treated as unusable -
    both are generous for a decision made from a live feed and both are far
    tighter than "no limit at all", which is the only genuinely dangerous
    setting.
    """

    #: Maximum age of the signal itself, measured from ``Signal.created_at``.
    max_signal_age_micros: int = 2_000_000
    #: Maximum age of the market data the decision was based on.
    max_market_data_age_micros: int = 5_000_000
    #: Tolerance for a signal timestamped slightly in the future. Small skew
    #: between a venue clock and ours is normal; a large one is not.
    max_future_skew_micros: int = 1_000_000
    #: Reject an actionable signal whose quantity exceeds this, when set. This
    #: is a sanity bound against a broken strategy, not a risk limit - the risk
    #: engine owns real limits and runs afterwards regardless.
    max_signal_quantity: Decimal | None = None
    #: Require that a decision-driving feature snapshot accompany the signal.
    require_feature_provenance: bool = False

    def __post_init__(self) -> None:
        for name in (
            "max_signal_age_micros",
            "max_market_data_age_micros",
            "max_future_skew_micros",
        ):
            value = getattr(self, name)
            if not isinstance(value, int) or value <= 0:
                raise ValueError(f"SignalValidationConfig.{name} must be positive.")
        if self.max_signal_quantity is not None and self.max_signal_quantity <= _ZERO:
            raise ValueError(
                "SignalValidationConfig.max_signal_quantity must be positive when set."
            )


@dataclass(slots=True, frozen=True)
class SignalValidationResult:
    """The verdict. Carries the original signal, never a modified copy."""

    accepted: bool
    code: SignalRejectionCode
    signal: Signal
    messages: tuple[str, ...] = field(default_factory=tuple)
    kill_switch_scope: KillSwitchScope | None = None
    identity: str | None = None
    evaluated_at_micros: int = 0

    @property
    def summary(self) -> str:
        if self.accepted:
            return "accepted"
        return "; ".join(self.messages) if self.messages else self.code.value

    def to_dict(self) -> dict[str, object]:
        return {
            "accepted": self.accepted,
            "code": self.code.value,
            "signalId": self.signal.signal_id,
            "strategyId": self.signal.strategy_id,
            "strategyVersion": self.signal.strategy_version,
            "symbol": self.signal.symbol,
            "messages": list(self.messages),
            "killSwitchScope": (
                self.kill_switch_scope.value
                if self.kill_switch_scope is not None
                else None
            ),
            "identity": self.identity,
            "evaluatedAtMicros": self.evaluated_at_micros,
        }


class SignalValidator:
    """Validates one instance's signals. Stateless except for the caches.

    The deduplicator and cooldown gate are per-instance and are supplied by the
    caller, which is what keeps one strategy from suppressing another's
    signals.
    """

    __slots__ = ("_config",)

    def __init__(self, config: SignalValidationConfig | None = None) -> None:
        self._config = config or SignalValidationConfig()

    @property
    def config(self) -> SignalValidationConfig:
        return self._config

    def validate(
        self,
        signal: Signal,
        *,
        now_micros: int,
        instance_id: str,
        tenant_id: str,
        exchange: ExchangeId,
        allowed_symbols: frozenset[str],
        strategy_status: StrategyStatus,
        strategy_enabled: bool,
        kill_switches: KillSwitchState,
        market_data_age_micros: int | None,
        market_data_is_fresh: bool,
        risk_state_available: bool,
        deduplicator: SignalDeduplicator | None = None,
        cooldown: CooldownGate | None = None,
    ) -> SignalValidationResult:
        """Run every check in fail-closed order.

        Checks are ordered cheapest-and-most-decisive first: an engaged kill
        switch or a disabled strategy short-circuits before any arithmetic or
        cache lookup happens.
        """
        messages: list[str] = []

        def reject(
            code: SignalRejectionCode,
            message: str,
            *,
            scope: KillSwitchScope | None = None,
        ) -> SignalValidationResult:
            return SignalValidationResult(
                accepted=False,
                code=code,
                signal=signal,
                messages=(message,),
                kill_switch_scope=scope,
                evaluated_at_micros=now_micros,
            )

        # -- 0. Kill switches ------------------------------------------
        scope = kill_switches.engaged_scope(
            signal.exchange, signal.strategy_id, signal.symbol
        )
        if scope is not None:
            reason = f": {kill_switches.reason}" if kill_switches.reason else "."
            return reject(
                SignalRejectionCode.KILL_SWITCH_ENGAGED,
                f"{scope.value} kill switch is engaged{reason}",
                scope=scope,
            )

        # -- 1. Strategy is permitted to emit --------------------------
        if not strategy_enabled:
            return reject(
                SignalRejectionCode.STRATEGY_DISABLED,
                f"Strategy instance {instance_id} is disabled.",
            )
        if not strategy_status.can_emit_signals:
            return reject(
                SignalRejectionCode.STRATEGY_NOT_RUNNING,
                f"Strategy instance {instance_id} is {strategy_status.value}, "
                "not RUNNING.",
            )

        # -- 2. Identity and provenance --------------------------------
        if signal.strategy_id != instance_id:
            return reject(
                SignalRejectionCode.STRATEGY_UNKNOWN,
                f"Signal claims strategy {signal.strategy_id!r} but was emitted "
                f"by {instance_id!r}.",
            )
        if signal.tenant_id != tenant_id:
            return reject(
                SignalRejectionCode.TENANT_MISMATCH,
                "Signal tenant does not match the instance's tenant.",
            )
        if not signal.strategy_version:
            return reject(
                SignalRejectionCode.STRATEGY_VERSION_MISSING,
                "Signal carries no strategy_version; a decision must be "
                "attributable to an exact implementation version.",
            )
        if signal.exchange is not exchange:
            return reject(
                SignalRejectionCode.EXCHANGE_MISMATCH,
                f"Signal is for {signal.exchange.value} but the instance trades "
                f"{exchange.value}.",
            )
        if signal.symbol not in allowed_symbols:
            return reject(
                SignalRejectionCode.SYMBOL_NOT_ALLOWED,
                f"Symbol {signal.symbol} is not configured for this instance.",
            )

        # -- 3. Structure -----------------------------------------------
        structural = signal.validation_errors()
        if structural:
            return SignalValidationResult(
                accepted=False,
                code=SignalRejectionCode.STRUCTURALLY_INVALID,
                signal=signal,
                messages=tuple(structural),
                evaluated_at_micros=now_micros,
            )

        # -- 4. Freshness -----------------------------------------------
        age = signal.age_micros(now_micros)
        if age < -self._config.max_future_skew_micros:
            return reject(
                SignalRejectionCode.SIGNAL_FROM_FUTURE,
                f"Signal is timestamped {-age}us in the future, beyond the "
                f"{self._config.max_future_skew_micros}us skew tolerance.",
            )
        if age > self._config.max_signal_age_micros:
            return reject(
                SignalRejectionCode.SIGNAL_STALE,
                f"Signal is {age}us old, older than the "
                f"{self._config.max_signal_age_micros}us limit.",
            )
        if signal.is_expired(now_micros):
            return reject(
                SignalRejectionCode.SIGNAL_EXPIRED,
                f"Signal expired at {signal.expires_at}.",
            )

        # -- 5. Market data ----------------------------------------------
        if signal.action.is_actionable:
            if market_data_age_micros is None:
                return reject(
                    SignalRejectionCode.MARKET_DATA_UNAVAILABLE,
                    "No market-data age is available; refusing to act.",
                )
            if not market_data_is_fresh:
                return reject(
                    SignalRejectionCode.MARKET_DATA_STALE,
                    "Market data is flagged stale by the staleness monitor.",
                )
            if market_data_age_micros > self._config.max_market_data_age_micros:
                return reject(
                    SignalRejectionCode.MARKET_DATA_STALE,
                    f"Market data is {market_data_age_micros}us old, older than "
                    f"the {self._config.max_market_data_age_micros}us limit.",
                )
            if not risk_state_available:
                return reject(
                    SignalRejectionCode.VALIDATION_STATE_UNAVAILABLE,
                    "Risk state was unavailable when the decision was made; "
                    "failing closed.",
                )
            if self._config.require_feature_provenance and not signal.features:
                return reject(
                    SignalRejectionCode.VALIDATION_STATE_UNAVAILABLE,
                    "Signal carries no feature provenance and provenance is "
                    "required by configuration.",
                )

        # -- 6. Sizing sanity ---------------------------------------------
        if signal.action in (SignalAction.BUY, SignalAction.SELL):
            quantity = signal.target_quantity
            if quantity is None or quantity <= _ZERO:
                return reject(
                    SignalRejectionCode.QUANTITY_INVALID,
                    "Actionable signal has no positive target_quantity.",
                )
            if (
                self._config.max_signal_quantity is not None
                and quantity > self._config.max_signal_quantity
            ):
                return reject(
                    SignalRejectionCode.QUANTITY_INVALID,
                    f"Quantity {quantity} exceeds the validator's sanity bound "
                    f"{self._config.max_signal_quantity}.",
                )
        if signal.order_type is not OrderType.MARKET and signal.action.is_actionable:
            if signal.limit_price is not None and signal.limit_price <= _ZERO:
                return reject(
                    SignalRejectionCode.PRICE_INVALID,
                    "Limit price must be positive.",
                )

        # -- 7. Cooldown and deduplication ----------------------------------
        identity: str | None = None
        if signal.action.is_actionable:
            if cooldown is not None and not cooldown.is_open(now_micros=now_micros):
                return reject(
                    SignalRejectionCode.COOLDOWN_ACTIVE,
                    f"Cooldown active for another "
                    f"{cooldown.remaining_micros(now_micros=now_micros)}us.",
                )
            if deduplicator is not None:
                decision = deduplicator.check_and_register(signal, now_micros=now_micros)
                identity = decision.identity
                if decision.is_duplicate:
                    return SignalValidationResult(
                        accepted=False,
                        code=SignalRejectionCode.DUPLICATE_SIGNAL,
                        signal=signal,
                        messages=(
                            f"Identical signal seen {decision.age_micros}us ago.",
                        ),
                        identity=identity,
                        evaluated_at_micros=now_micros,
                    )
            if cooldown is not None:
                cooldown.record_emission(now_micros=now_micros)

        return SignalValidationResult(
            accepted=True,
            code=SignalRejectionCode.ACCEPTED,
            signal=signal,
            messages=tuple(messages),
            identity=identity,
            evaluated_at_micros=now_micros,
        )
