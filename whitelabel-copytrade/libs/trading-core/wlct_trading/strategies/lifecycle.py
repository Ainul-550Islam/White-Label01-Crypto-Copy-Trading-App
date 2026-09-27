"""Strategy instance lifecycle and the multi-strategy engine.

Two objects live here:

:class:`StrategyInstance`
    One running strategy, its feature engine, its deduplication caches and its
    health. Owns the isolation boundary: nothing it holds is shared with any
    other instance.

:class:`StrategyEngine`
    Dispatches normalised market events to the instances subscribed to that
    symbol, times each dispatch, and turns strategy output into validated
    signals. It is the component the host service drives.

Failure handling is the reason this module is not simply a loop. A strategy is
third-party-ish code: it can raise, and when it does the engine must not take
the other strategies down with it, must not keep trading from state that might
be half-updated, and must leave enough evidence to diagnose the problem. Every
dispatch is therefore wrapped, and the configured
:class:`~wlct_trading.enums.StrategyFailurePolicy` decides what happens next.
Every policy is fail-closed - there is no "log it and carry on" option.

What this engine does **not** do, on purpose:

* It never calls the risk engine. It produces validated signals; the host
  passes them to :class:`~wlct_trading.risk.RiskEngine` and only then to the
  Part 5 execution engine.
* It never reaches an exchange, holds a credential, or knows whether execution
  is paper or live.
* It performs no I/O at all: no database, no Redis, no logging calls in the
  hot path. Counters are incremented in memory and scraped separately.
"""

from __future__ import annotations

import traceback
from dataclasses import dataclass, field
from typing import Callable

from wlct_trading.clock import epoch_micros, monotonic_nanos
from wlct_trading.enums import (
    MarketEventKind,
    SignalRejectionCode,
    StrategyFailurePolicy,
    StrategyStatus,
)
from wlct_trading.market_data import BookTop, Candle, PublicTrade, Ticker
from wlct_trading.metrics import StrategyMetrics
from wlct_trading.observability.tracing import SpanStatus, Tracer
from wlct_trading.orders import Order
from wlct_trading.positions import Position
from wlct_trading.risk import KillSwitchState
from wlct_trading.signals import Signal
from wlct_trading.strategies.base import Strategy
from wlct_trading.strategies.context import StrategyContext, StrategyRiskView
from wlct_trading.strategies.features.engine import FeatureEngine
from wlct_trading.strategies.signals import (
    DEFAULT_DEDUP_CAPACITY,
    CooldownGate,
    SignalDeduplicator,
)
from wlct_trading.strategies.state import StrategyInstanceKey
from wlct_trading.strategies.validation import (
    SignalValidationConfig,
    SignalValidationResult,
    SignalValidator,
)

__all__ = [
    "StrategyEngineConfig",
    "StrategyFailure",
    "SignalOutcome",
    "StrategyInstance",
    "StrategyEngine",
    "PositionProvider",
    "OpenOrdersProvider",
    "RiskViewProvider",
    "KillSwitchProvider",
    "FreshnessProvider",
]

#: Supplies the current position for an instance, or ``None`` when flat/unknown.
PositionProvider = Callable[[StrategyInstanceKey], "Position | None"]
#: Supplies the instance's currently open orders.
OpenOrdersProvider = Callable[[StrategyInstanceKey], tuple[Order, ...]]
#: Supplies the read-only risk view. Must report ``is_available=False`` when
#: risk state could not be loaded - the validator then fails closed.
RiskViewProvider = Callable[[StrategyInstanceKey], StrategyRiskView]
#: Supplies the current kill-switch state for the whole engine.
KillSwitchProvider = Callable[[], KillSwitchState]
#: Supplies ``(is_fresh, age_micros)`` for an instance's market data.
FreshnessProvider = Callable[[StrategyInstanceKey], tuple[bool, "int | None"]]


@dataclass(slots=True, frozen=True)
class StrategyEngineConfig:
    """Engine-wide limits and policy.

    ``max_processing_latency_micros`` is an **observation threshold**, not a
    guarantee. Exceeding it increments a counter so an operator can see that
    strategy code is slower than budgeted. Nothing in this platform promises a
    latency bound, and this setting does not create one.
    """

    max_instances: int = 64
    failure_policy: StrategyFailurePolicy = StrategyFailurePolicy.STOP_INSTANCE
    validation: SignalValidationConfig = field(default_factory=SignalValidationConfig)
    dedup_ttl_micros: int = 5_000_000
    dedup_capacity: int = DEFAULT_DEDUP_CAPACITY
    default_cooldown_micros: int = 0
    max_processing_latency_micros: int | None = 50_000
    #: Reset an instance's feature engine when its book is invalidated. On by
    #: default: rolling statistics spanning a data gap silently blend two
    #: disjoint periods.
    reset_features_on_invalidation: bool = True

    def __post_init__(self) -> None:
        if self.max_instances < 1:
            raise ValueError("StrategyEngineConfig.max_instances must be at least 1.")
        if self.dedup_ttl_micros <= 0:
            raise ValueError("StrategyEngineConfig.dedup_ttl_micros must be positive.")
        if self.dedup_capacity < 1:
            raise ValueError("StrategyEngineConfig.dedup_capacity must be at least 1.")
        if self.default_cooldown_micros < 0:
            raise ValueError(
                "StrategyEngineConfig.default_cooldown_micros must not be negative."
            )
        if (
            self.max_processing_latency_micros is not None
            and self.max_processing_latency_micros <= 0
        ):
            raise ValueError(
                "StrategyEngineConfig.max_processing_latency_micros must be positive "
                "when set."
            )


@dataclass(slots=True, frozen=True)
class StrategyFailure:
    """A captured strategy exception.

    The traceback is retained as a string for the incident record. The message
    is the exception's own text: strategies are never given a credential, so
    there is nothing secret to redact, and truncating the message would hide
    the diagnosis.
    """

    instance_id: str
    stage: str
    exception_type: str
    message: str
    occurred_at_micros: int
    traceback_text: str

    def to_dict(self) -> dict[str, object]:
        return {
            "instanceId": self.instance_id,
            "stage": self.stage,
            "exceptionType": self.exception_type,
            "message": self.message,
            "occurredAtMicros": self.occurred_at_micros,
        }


@dataclass(slots=True, frozen=True)
class SignalOutcome:
    """One signal and the validator's verdict on it."""

    instance_id: str
    signal: Signal
    validation: SignalValidationResult

    @property
    def accepted(self) -> bool:
        return self.validation.accepted

    @property
    def rejection_code(self) -> SignalRejectionCode:
        return self.validation.code


class StrategyInstance:
    """One running strategy plus everything that belongs only to it."""

    __slots__ = (
        "_strategy",
        "_features",
        "_deduplicator",
        "_cooldown",
        "_status",
        "_enabled",
        "_last_failure",
        "_error_count",
        "_event_count",
        "_signal_count",
        "_accepted_count",
        "_rejected_count",
        "_slow_dispatch_count",
        "_started_at",
        "_stopped_at",
        "_last_event_micros",
    )

    def __init__(
        self,
        strategy: Strategy,
        *,
        dedup_ttl_micros: int,
        dedup_capacity: int,
        cooldown_micros: int,
    ) -> None:
        self._strategy = strategy
        self._features = FeatureEngine(
            exchange=strategy.exchange,
            symbol=strategy.symbol,
            config=strategy.feature_config,
        )
        self._deduplicator = SignalDeduplicator(
            ttl_micros=dedup_ttl_micros, capacity=dedup_capacity
        )
        self._cooldown = CooldownGate(cooldown_micros=cooldown_micros)
        self._status = StrategyStatus.CREATED
        self._enabled = strategy.descriptor.enabled
        self._last_failure: StrategyFailure | None = None
        self._error_count = 0
        self._event_count = 0
        self._signal_count = 0
        self._accepted_count = 0
        self._rejected_count = 0
        self._slow_dispatch_count = 0
        self._started_at: int | None = None
        self._stopped_at: int | None = None
        self._last_event_micros = 0

    # -- identity ---------------------------------------------------------
    @property
    def strategy(self) -> Strategy:
        return self._strategy

    @property
    def key(self) -> StrategyInstanceKey:
        return self._strategy.key

    @property
    def instance_id(self) -> str:
        return self._strategy.instance_id

    @property
    def symbol(self) -> str:
        return self._strategy.symbol

    @property
    def features(self) -> FeatureEngine:
        return self._features

    @property
    def deduplicator(self) -> SignalDeduplicator:
        return self._deduplicator

    @property
    def cooldown(self) -> CooldownGate:
        return self._cooldown

    # -- health -----------------------------------------------------------
    @property
    def status(self) -> StrategyStatus:
        return self._status

    @property
    def is_enabled(self) -> bool:
        return self._enabled

    @property
    def is_healthy(self) -> bool:
        """Running and never failed. A quarantined instance is not healthy."""
        return self._status is StrategyStatus.RUNNING and self._last_failure is None

    @property
    def last_failure(self) -> StrategyFailure | None:
        return self._last_failure

    @property
    def error_count(self) -> int:
        return self._error_count

    @property
    def event_count(self) -> int:
        return self._event_count

    @property
    def signal_count(self) -> int:
        return self._signal_count

    @property
    def accepted_signal_count(self) -> int:
        return self._accepted_count

    @property
    def rejected_signal_count(self) -> int:
        return self._rejected_count

    @property
    def slow_dispatch_count(self) -> int:
        return self._slow_dispatch_count

    # -- lifecycle --------------------------------------------------------
    def initialize(self) -> None:
        self._strategy.initialize()
        self._status = StrategyStatus.INITIALISED

    def start(self, *, now_micros: int | None = None) -> None:
        if not self._enabled:
            raise RuntimeError(
                f"Strategy instance {self.instance_id} is disabled and cannot start."
            )
        if self._status is StrategyStatus.CREATED:
            self.initialize()
        self._strategy.start()
        self._status = StrategyStatus.RUNNING
        self._started_at = epoch_micros() if now_micros is None else now_micros

    def stop(self, *, now_micros: int | None = None) -> None:
        self._strategy.stop()
        if self._status not in (StrategyStatus.FAILED, StrategyStatus.QUARANTINED):
            self._status = StrategyStatus.STOPPED
        self._stopped_at = epoch_micros() if now_micros is None else now_micros

    def disable(self) -> None:
        self._enabled = False
        self.stop()

    def enable(self) -> None:
        """Re-enable a stopped instance. Refuses while a failure stands.

        Clearing a failure is an explicit operator action
        (:meth:`clear_failure`), because re-enabling an instance whose state may
        be corrupt is exactly what the failure policy exists to prevent.
        """
        if self._last_failure is not None:
            raise RuntimeError(
                f"Instance {self.instance_id} has an unresolved failure; call "
                "clear_failure() after inspecting it."
            )
        self._enabled = True

    def clear_failure(self) -> None:
        """Discard the recorded failure and reset the strategy's state.

        State is reset rather than kept: the whole reason the instance stopped
        is that its state might be inconsistent, so resuming from it would
        defeat the policy.
        """
        self._last_failure = None
        self._strategy.reset()
        self._features.reset()
        self._deduplicator.reset()
        self._cooldown.reset()
        self._status = StrategyStatus.INITIALISED

    def invalidate_market_data(self) -> None:
        """Drop accumulated feature state after a book invalidation."""
        self._features.reset()

    def record_failure(self, failure: StrategyFailure, policy: StrategyFailurePolicy) -> None:
        self._last_failure = failure
        self._error_count += 1
        self._strategy.stop()
        if policy is StrategyFailurePolicy.QUARANTINE_INSTANCE:
            self._status = StrategyStatus.QUARANTINED
        else:
            self._status = StrategyStatus.FAILED

    # -- counters ----------------------------------------------------------
    def note_event(self, event_micros: int) -> None:
        self._event_count += 1
        if event_micros > self._last_event_micros:
            self._last_event_micros = event_micros

    def note_signal(self, accepted: bool) -> None:
        self._signal_count += 1
        if accepted:
            self._accepted_count += 1
        else:
            self._rejected_count += 1

    def note_slow_dispatch(self) -> None:
        self._slow_dispatch_count += 1

    def to_dict(self) -> dict[str, object]:
        return {
            "instanceId": self.instance_id,
            "status": self._status.value,
            "enabled": self._enabled,
            "healthy": self.is_healthy,
            **self.key.to_dict(),
            "eventCount": self._event_count,
            "signalCount": self._signal_count,
            "acceptedSignalCount": self._accepted_count,
            "rejectedSignalCount": self._rejected_count,
            "errorCount": self._error_count,
            "slowDispatchCount": self._slow_dispatch_count,
            "startedAtMicros": self._started_at,
            "stoppedAtMicros": self._stopped_at,
            "lastEventMicros": self._last_event_micros,
            "lastFailure": (
                self._last_failure.to_dict() if self._last_failure is not None else None
            ),
        }


def _default_position(_key: StrategyInstanceKey) -> Position | None:
    return None


def _default_open_orders(_key: StrategyInstanceKey) -> tuple[Order, ...]:
    return ()


def _default_risk_view(_key: StrategyInstanceKey) -> StrategyRiskView:
    # Fail closed: with no risk provider wired in, risk state is *unavailable*,
    # and the validator refuses every actionable signal. A permissive default
    # here would be a silent bypass of the platform's central rule.
    return StrategyRiskView(is_available=False)


def _default_kill_switches() -> KillSwitchState:
    return KillSwitchState()


def _default_freshness(_key: StrategyInstanceKey) -> tuple[bool, int | None]:
    return True, 0


class StrategyEngine:
    """Runs many strategy instances over one normalised market-data stream."""

    __slots__ = (
        "_config",
        "_instances",
        "_by_symbol",
        "_validator",
        "_metrics",
        "_tracer",
        "_position_provider",
        "_open_orders_provider",
        "_risk_view_provider",
        "_kill_switch_provider",
        "_freshness_provider",
        "_failures",
        "_halted",
    )

    def __init__(
        self,
        *,
        config: StrategyEngineConfig | None = None,
        metrics: StrategyMetrics | None = None,
        position_provider: PositionProvider | None = None,
        open_orders_provider: OpenOrdersProvider | None = None,
        risk_view_provider: RiskViewProvider | None = None,
        kill_switch_provider: KillSwitchProvider | None = None,
        freshness_provider: FreshnessProvider | None = None,
        tracer: Tracer | None = None,
    ) -> None:
        self._config = config or StrategyEngineConfig()
        self._instances: dict[str, StrategyInstance] = {}
        self._by_symbol: dict[str, list[str]] = {}
        self._validator = SignalValidator(self._config.validation)
        self._metrics = metrics or StrategyMetrics()
        self._tracer = tracer
        self._position_provider = position_provider or _default_position
        self._open_orders_provider = open_orders_provider or _default_open_orders
        self._risk_view_provider = risk_view_provider or _default_risk_view
        self._kill_switch_provider = kill_switch_provider or _default_kill_switches
        self._freshness_provider = freshness_provider or _default_freshness
        self._failures: list[StrategyFailure] = []
        self._halted = False

    # -- registry ----------------------------------------------------------
    @property
    def config(self) -> StrategyEngineConfig:
        return self._config

    @property
    def metrics(self) -> StrategyMetrics:
        return self._metrics

    @property
    def validator(self) -> SignalValidator:
        return self._validator

    @property
    def is_halted(self) -> bool:
        return self._halted

    @property
    def instance_count(self) -> int:
        return len(self._instances)

    @property
    def failures(self) -> tuple[StrategyFailure, ...]:
        return tuple(self._failures)

    def instances(self) -> tuple[StrategyInstance, ...]:
        return tuple(self._instances[key] for key in sorted(self._instances))

    def instance(self, instance_id: str) -> StrategyInstance | None:
        return self._instances.get(instance_id)

    def instances_for_symbol(self, symbol: str) -> tuple[StrategyInstance, ...]:
        return tuple(
            self._instances[instance_id]
            for instance_id in self._by_symbol.get(symbol, ())
            if instance_id in self._instances
        )

    def add(self, strategy: Strategy, *, cooldown_micros: int | None = None) -> StrategyInstance:
        """Register one strategy instance.

        The cooldown defaults to the strategy's own ``signal_cooldown_micros``
        parameter when it declares one, then to the engine default. A strategy
        may therefore restrict itself further; it cannot loosen the engine's
        floor below zero.
        """
        if len(self._instances) >= self._config.max_instances:
            raise RuntimeError(
                f"Engine already holds {len(self._instances)} instances "
                f"(max_instances={self._config.max_instances})."
            )
        instance_id = strategy.instance_id
        if instance_id in self._instances:
            raise RuntimeError(
                f"Instance {instance_id} is already registered: "
                f"{strategy.key.describe()}."
            )

        declared = strategy.parameters.get("signal_cooldown_micros")
        resolved_cooldown = (
            cooldown_micros
            if cooldown_micros is not None
            else (
                int(declared)
                if isinstance(declared, int) and not isinstance(declared, bool)
                else self._config.default_cooldown_micros
            )
        )

        instance = StrategyInstance(
            strategy,
            dedup_ttl_micros=self._config.dedup_ttl_micros,
            dedup_capacity=self._config.dedup_capacity,
            cooldown_micros=resolved_cooldown,
        )
        self._instances[instance_id] = instance
        self._by_symbol.setdefault(strategy.symbol, []).append(instance_id)
        self._metrics.counters.instances_registered += 1
        return instance

    def remove(self, instance_id: str) -> None:
        instance = self._instances.pop(instance_id, None)
        if instance is None:
            return
        instance.stop()
        symbol_ids = self._by_symbol.get(instance.symbol)
        if symbol_ids and instance_id in symbol_ids:
            symbol_ids.remove(instance_id)
            if not symbol_ids:
                del self._by_symbol[instance.symbol]

    # -- lifecycle ----------------------------------------------------------
    def start_all(self, *, now_micros: int | None = None) -> None:
        for instance in self.instances():
            if instance.is_enabled and instance.status in (
                StrategyStatus.CREATED,
                StrategyStatus.INITIALISED,
                StrategyStatus.STOPPED,
            ):
                instance.start(now_micros=now_micros)
                self._metrics.counters.instances_started += 1

    def stop_all(self, *, now_micros: int | None = None) -> None:
        for instance in self.instances():
            if instance.status is StrategyStatus.RUNNING:
                instance.stop(now_micros=now_micros)
                self._metrics.counters.instances_stopped += 1

    def halt(self, reason: str) -> None:
        """Stop every instance and refuse further dispatch until reset."""
        self._halted = True
        for instance in self.instances():
            instance.stop()
        self._metrics.counters.engine_halts += 1

    def resume(self) -> None:
        """Clear the halted flag. Instances must be restarted explicitly."""
        self._halted = False

    # -- dispatch ------------------------------------------------------------
    def dispatch_book_top(self, top: BookTop) -> tuple[SignalOutcome, ...]:
        return self._dispatch(
            symbol=top.symbol,
            kind=MarketEventKind.BOOK_SNAPSHOT,
            event_micros=top.exchange_timestamp,
            observe=lambda instance: instance.features.observe_book_top(top),
            notify=lambda strategy: strategy.on_order_book_update(top),
        )

    def dispatch_ticker(self, ticker: Ticker) -> tuple[SignalOutcome, ...]:
        return self._dispatch(
            symbol=ticker.symbol,
            kind=MarketEventKind.TICKER,
            event_micros=ticker.exchange_timestamp,
            observe=lambda instance: instance.features.observe_ticker(ticker),
            notify=lambda strategy: strategy.on_market_data(ticker),
        )

    def dispatch_trade(self, trade: PublicTrade) -> tuple[SignalOutcome, ...]:
        return self._dispatch(
            symbol=trade.symbol,
            kind=MarketEventKind.TRADE,
            event_micros=trade.exchange_timestamp,
            observe=lambda instance: instance.features.observe_trade(trade),
            notify=lambda strategy: strategy.on_trade(trade),
        )

    def dispatch_candle(self, candle: Candle) -> tuple[SignalOutcome, ...]:
        return self._dispatch(
            symbol=candle.symbol,
            kind=MarketEventKind.CANDLE,
            event_micros=candle.close_time,
            observe=lambda instance: instance.features.observe_candle(candle),
            notify=lambda strategy: strategy.on_candle(candle),
        )

    def dispatch_timer(self, now_micros: int) -> tuple[SignalOutcome, ...]:
        """Tick every running instance regardless of symbol."""
        if self._halted:
            return ()
        outcomes: list[SignalOutcome] = []
        self._metrics.counters.timer_ticks += 1
        for instance in self.instances():
            if instance.status is not StrategyStatus.RUNNING:
                continue
            outcome = self._run_one(
                instance,
                event_micros=now_micros,
                observe=None,
                notify=lambda strategy: strategy.on_timer(now_micros),
            )
            if outcome is not None:
                outcomes.append(outcome)
        return tuple(outcomes)

    def invalidate_symbol(self, symbol: str) -> None:
        """Tell every instance on ``symbol`` that its book is untrustworthy."""
        if not self._config.reset_features_on_invalidation:
            return
        for instance in self.instances_for_symbol(symbol):
            instance.invalidate_market_data()
            self._metrics.counters.feature_resets += 1

    def _dispatch(
        self,
        *,
        symbol: str,
        kind: MarketEventKind,
        event_micros: int,
        observe: Callable[[StrategyInstance], None],
        notify: Callable[[Strategy], None],
    ) -> tuple[SignalOutcome, ...]:
        tracer = self._tracer
        span = (
            tracer.start_span(
                "strategy.dispatch",
                attributes={
                    "market.symbol": symbol,
                    "market.kind": kind.value,
                    "market.event_time_micros": event_micros,
                },
            )
            if tracer is not None
            else None
        )

        def emit(
            outcomes: tuple[SignalOutcome, ...], *, halted: bool
        ) -> tuple[SignalOutcome, ...]:
            if span is not None:
                span.set_attribute(
                    "strategy.halted", "true" if halted else "false"
                )
                span.set_attribute("strategy.outcome_count", len(outcomes))
                span.set_attribute(
                    "strategy.approved_count",
                    sum(1 for o in outcomes if o.accepted),
                )
                span.set_status(SpanStatus.OK)
                span.end()
            return outcomes

        if self._halted:
            return emit((), halted=True)
        outcomes: list[SignalOutcome] = []
        for instance in self.instances_for_symbol(symbol):
            if instance.status is not StrategyStatus.RUNNING:
                continue
            outcome = self._run_one(
                instance,
                event_micros=event_micros,
                observe=observe,
                notify=notify,
            )
            if outcome is not None:
                outcomes.append(outcome)
        return emit(tuple(outcomes), halted=False)

    def _run_one(
        self,
        instance: StrategyInstance,
        *,
        event_micros: int,
        observe: Callable[[StrategyInstance], None] | None,
        notify: Callable[[Strategy], None],
    ) -> SignalOutcome | None:
        """Feed one event to one instance. Never raises.

        Any exception from strategy or feature code is captured, converted to a
        :class:`StrategyFailure` and handed to the failure policy. The engine
        continues with the next instance - isolation is the point.
        """
        started = monotonic_nanos()
        instance.note_event(event_micros)
        self._metrics.counters.events_processed += 1

        try:
            if observe is not None:
                feature_started = monotonic_nanos()
                observe(instance)
                self._metrics.observe(
                    "feature_calculation",
                    (monotonic_nanos() - feature_started) // 1_000,
                )
        except Exception as exc:  # noqa: BLE001 - deliberate isolation boundary
            self._metrics.counters.feature_errors += 1
            self._fail(instance, exc, stage="feature_calculation")
            return None

        try:
            notify(instance.strategy)
        except Exception as exc:  # noqa: BLE001 - deliberate isolation boundary
            self._fail(instance, exc, stage="event_handler")
            return None

        snapshot = instance.features.snapshot(as_of_micros=event_micros)
        risk_view = self._safe_risk_view(instance)
        is_fresh, age = self._safe_freshness(instance)

        context = StrategyContext(
            key=instance.key,
            event_timestamp_micros=event_micros,
            processing_timestamp_micros=epoch_micros(),
            features=snapshot,
            state=instance.strategy.state,
            parameters=instance.strategy.parameters,
            book_top=instance.features.book_top,
            ticker=instance.features.ticker,
            last_trade=instance.features.last_trade,
            last_candle=instance.features.last_candle,
            position=self._safe_position(instance),
            open_orders=self._safe_open_orders(instance),
            risk=risk_view,
            market_data_is_fresh=is_fresh,
        )
        instance.strategy.remember_context(context)

        try:
            signal = instance.strategy.evaluate(context)
        except Exception as exc:  # noqa: BLE001 - deliberate isolation boundary
            self._fail(instance, exc, stage="evaluate")
            return None
        finally:
            elapsed_micros = (monotonic_nanos() - started) // 1_000
            self._metrics.observe("strategy_processing", elapsed_micros)
            budget = self._config.max_processing_latency_micros
            if budget is not None and elapsed_micros > budget:
                instance.note_slow_dispatch()
                self._metrics.counters.slow_dispatches += 1

        if signal is None:
            return None

        self._metrics.counters.signals_generated += 1
        validation_started = monotonic_nanos()
        result = self._validate(instance, signal, now_micros=event_micros, age=age, fresh=is_fresh, risk_view=risk_view)
        self._metrics.observe(
            "signal_validation", (monotonic_nanos() - validation_started) // 1_000
        )

        instance.note_signal(result.accepted)
        if result.accepted:
            self._metrics.counters.signals_accepted += 1
        else:
            self._metrics.counters.signals_rejected += 1
            if result.code is SignalRejectionCode.DUPLICATE_SIGNAL:
                self._metrics.counters.signals_deduplicated += 1

        return SignalOutcome(
            instance_id=instance.instance_id, signal=signal, validation=result
        )

    def _validate(
        self,
        instance: StrategyInstance,
        signal: Signal,
        *,
        now_micros: int,
        age: int | None,
        fresh: bool,
        risk_view: StrategyRiskView,
    ) -> SignalValidationResult:
        return self._validator.validate(
            signal,
            now_micros=now_micros,
            instance_id=instance.instance_id,
            tenant_id=instance.key.tenant_id,
            exchange=instance.key.exchange,
            allowed_symbols=frozenset({instance.symbol}),
            strategy_status=instance.status,
            strategy_enabled=instance.is_enabled,
            kill_switches=self._safe_kill_switches(),
            market_data_age_micros=age,
            market_data_is_fresh=fresh,
            risk_state_available=risk_view.is_available,
            deduplicator=instance.deduplicator,
            cooldown=instance.cooldown,
        )

    # -- provider guards -----------------------------------------------------
    def _safe_position(self, instance: StrategyInstance) -> Position | None:
        try:
            return self._position_provider(instance.key)
        except Exception:  # noqa: BLE001 - a broken provider must not kill dispatch
            self._metrics.counters.provider_errors += 1
            return None

    def _safe_open_orders(self, instance: StrategyInstance) -> tuple[Order, ...]:
        try:
            return self._open_orders_provider(instance.key)
        except Exception:  # noqa: BLE001
            self._metrics.counters.provider_errors += 1
            return ()

    def _safe_risk_view(self, instance: StrategyInstance) -> StrategyRiskView:
        try:
            return self._risk_view_provider(instance.key)
        except Exception:  # noqa: BLE001
            self._metrics.counters.provider_errors += 1
            # Fail closed: an unreadable risk view is an unavailable one.
            return StrategyRiskView(is_available=False)

    def _safe_kill_switches(self) -> KillSwitchState:
        try:
            return self._kill_switch_provider()
        except Exception:  # noqa: BLE001
            self._metrics.counters.provider_errors += 1
            # Fail closed: if kill-switch state cannot be read, behave as if the
            # global switch were engaged.
            return KillSwitchState(
                global_engaged=True,
                reason="Kill-switch state could not be read; failing closed.",
            )

    def _safe_freshness(self, instance: StrategyInstance) -> tuple[bool, int | None]:
        try:
            return self._freshness_provider(instance.key)
        except Exception:  # noqa: BLE001
            self._metrics.counters.provider_errors += 1
            return False, None

    # -- failure handling ------------------------------------------------------
    def _fail(self, instance: StrategyInstance, exc: BaseException, *, stage: str) -> None:
        failure = StrategyFailure(
            instance_id=instance.instance_id,
            stage=stage,
            exception_type=type(exc).__name__,
            message=str(exc),
            occurred_at_micros=epoch_micros(),
            traceback_text="".join(
                traceback.format_exception(type(exc), exc, exc.__traceback__)
            ),
        )
        self._failures.append(failure)
        self._metrics.counters.strategy_errors += 1

        policy = self._config.failure_policy
        instance.record_failure(failure, policy)
        if policy is StrategyFailurePolicy.QUARANTINE_INSTANCE:
            self._metrics.counters.instances_quarantined += 1
        else:
            self._metrics.counters.instances_failed += 1

        if policy is StrategyFailurePolicy.HALT_ALL:
            self.halt(f"Instance {instance.instance_id} failed during {stage}.")

    # -- reporting ---------------------------------------------------------------
    def health(self) -> dict[str, object]:
        instances = self.instances()
        return {
            "halted": self._halted,
            "instanceCount": len(instances),
            "runningCount": sum(
                1 for i in instances if i.status is StrategyStatus.RUNNING
            ),
            "failedCount": sum(1 for i in instances if i.status is StrategyStatus.FAILED),
            "quarantinedCount": sum(
                1 for i in instances if i.status is StrategyStatus.QUARANTINED
            ),
            "failurePolicy": self._config.failure_policy.value,
            "instances": [instance.to_dict() for instance in instances],
        }
