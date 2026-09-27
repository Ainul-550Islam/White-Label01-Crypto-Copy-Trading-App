# Part 6 — full source handover

> **BACKTEST PERFORMANCE IS NOT INDICATIVE OF FUTURE PERFORMANCE.**  
> **PAPER PERFORMANCE IS NOT INDICATIVE OF LIVE PERFORMANCE.**  
> **SIMULATION DOES NOT GUARANTEE REAL EXECUTION QUALITY.**

Complete content of every file created or modified by Part 6. Nothing is
abbreviated, summarised or elided: each block below is the entire final file
as it exists in the repository.

Generated 2026-09-06 · `libs/trading-core` v0.6.0 · `python3 -m pytest tests/ -q` → **634 passed**.

Updated 2026-09-11 after the repository-wide lint/type verification sweep.
`python3 -m ruff check` (ruleset pinned in `pyproject.toml`), `python3 -m mypy`
under both 1.11.2 and 2.3.1 with the repo's `strict`/`warn_unreachable` config,
`next lint`, and the mobile gates (`flutter analyze`, `flutter test` → 20
passed) are all green on top of the pytest result above. The sweep touched a
handful of Part 6 files with type-level fixes (Decimal narrowing in
`strategies/state.py`, one provably-dead guard removed in
`features/statistics.py`, the empty-fill iterator in `adapters/paper.py`,
explicit re-export lists) plus files owned by earlier parts; runtime behaviour
is unchanged, and the full current content of every Part 6 file follows below.
The pre-existing-parts files the sweep also fixed are dumped in full in
`docs/PART6_PERSISTENCE_HANDOVER_FULL_SOURCE.md`, Part C.

The narrative documentation for this part is a separate file in the same
repository, `docs/PART6_STRATEGY.md`, and is not reproduced here.

---

## Contents

### New files

* `libs/trading-core/wlct_trading/strategies/__init__.py` — 124 lines
* `libs/trading-core/wlct_trading/strategies/base.py` — 417 lines
* `libs/trading-core/wlct_trading/strategies/context.py` — 240 lines
* `libs/trading-core/wlct_trading/strategies/features/__init__.py` — 88 lines
* `libs/trading-core/wlct_trading/strategies/features/engine.py` — 409 lines
* `libs/trading-core/wlct_trading/strategies/features/microstructure.py` — 179 lines
* `libs/trading-core/wlct_trading/strategies/features/rolling.py` — 342 lines
* `libs/trading-core/wlct_trading/strategies/features/statistics.py` — 221 lines
* `libs/trading-core/wlct_trading/strategies/implementations/__init__.py` — 14 lines
* `libs/trading-core/wlct_trading/strategies/implementations/deterministic_example.py` — 312 lines
* `libs/trading-core/wlct_trading/strategies/lifecycle.py` — 886 lines
* `libs/trading-core/wlct_trading/strategies/parameters.py` — 308 lines
* `libs/trading-core/wlct_trading/strategies/registry.py` — 258 lines
* `libs/trading-core/wlct_trading/strategies/signals.py` — 225 lines
* `libs/trading-core/wlct_trading/strategies/state.py` — 345 lines
* `libs/trading-core/wlct_trading/strategies/validation.py` — 360 lines
* `libs/trading-core/wlct_trading/backtest/__init__.py` — 115 lines
* `libs/trading-core/wlct_trading/backtest/clock.py` — 97 lines
* `libs/trading-core/wlct_trading/backtest/dataset.py` — 382 lines
* `libs/trading-core/wlct_trading/backtest/engine.py` — 621 lines
* `libs/trading-core/wlct_trading/backtest/metrics.py` — 243 lines
* `libs/trading-core/wlct_trading/backtest/portfolio.py` — 498 lines
* `libs/trading-core/wlct_trading/backtest/replay.py` — 263 lines
* `libs/trading-core/wlct_trading/backtest/result.py` — 244 lines
* `libs/trading-core/wlct_trading/backtest/simulator.py` — 565 lines
* `libs/trading-core/wlct_trading/backtest/walkforward.py` — 185 lines
* `libs/trading-core/wlct_trading/paper/__init__.py` — 30 lines
* `libs/trading-core/wlct_trading/paper/session.py` — 585 lines
* `libs/trading-core/tests/test_strategy_features.py` — 382 lines
* `libs/trading-core/tests/test_strategy_engine.py` — 840 lines
* `libs/trading-core/tests/test_backtest.py` — 1029 lines
* `libs/trading-core/tests/test_paper_trading.py` — 384 lines

### Modified files (complete final content)

* `libs/trading-core/wlct_trading/enums.py` — 425 lines
* `libs/trading-core/wlct_trading/signals.py` — 335 lines
* `libs/trading-core/wlct_trading/metrics.py` — 829 lines
* `libs/trading-core/wlct_trading/adapters/paper.py` — 317 lines
* `libs/trading-core/wlct_trading/__init__.py` — 280 lines
* `libs/trading-core/pyproject.toml` — 73 lines
* `packages/config/src/env.schema.ts` — 681 lines
* `apps/api/src/config/app-config.service.ts` — 836 lines
* `.env.example` — 753 lines

---

# Part A — new files

## FILE: libs/trading-core/wlct_trading/strategies/__init__.py

```py
"""The strategy layer: features, decisions, validation and lifecycle.

This subpackage is pure domain logic. It has no dependencies beyond the
standard library, opens no sockets, reads no configuration and touches no
database - the same rules the rest of ``wlct_trading`` follows.

Layout::

    parameters.py            validated, hashable strategy configuration
    state.py                 per-instance identity and isolated runtime state
    context.py               the read-only view handed to a strategy
    base.py                  Strategy, a subclass of Part 2's BaseStrategy
    registry.py              stable (key, version) -> implementation mapping
    signals.py               deterministic signal identity, dedup, cooldown
    validation.py            the gate between a strategy and the risk engine
    lifecycle.py             StrategyInstance and the multi-strategy engine
    features/                rolling windows, microstructure, statistics
    implementations/         the deterministic example strategy

Safety boundary, restated because it is the point of the design: a strategy
receives normalised market data and returns a signal. It cannot see a
credential, cannot see whether execution is paper or live, cannot reach an
exchange, and cannot approve its own risk. Signals travel
``strategy -> validation -> risk engine -> Part 5 execution engine``, and every
one of those stages can refuse.

This package is deliberately **not** re-exported from ``wlct_trading``'s top
level, for the same reason ``execution`` is not: an explicit
``from wlct_trading.strategies import ...`` is a greppable declaration that a
component runs strategy code.
"""

from __future__ import annotations

from wlct_trading.strategies.base import (
    Strategy,
    StrategyDefinitionError,
    instance_key_for,
)
from wlct_trading.strategies.context import StrategyContext, StrategyRiskView
from wlct_trading.strategies.features import (
    FeatureConfig,
    FeatureEngine,
    FeatureSnapshot,
    RollingReturns,
    RollingWindow,
    order_book_imbalance,
)
from wlct_trading.strategies.lifecycle import (
    SignalOutcome,
    StrategyEngine,
    StrategyEngineConfig,
    StrategyFailure,
    StrategyInstance,
)
from wlct_trading.strategies.parameters import (
    ParameterError,
    ParameterSchema,
    ParameterSpec,
    ParameterType,
)
from wlct_trading.strategies.registry import (
    RESERVED_STRATEGY_KEYS,
    StrategyNotRegistered,
    StrategyRegistration,
    StrategyRegistry,
    StrategyVersionConflict,
    build_default_strategy_registry,
)
from wlct_trading.strategies.signals import (
    CooldownGate,
    SignalDeduplicator,
    signal_identity,
)
from wlct_trading.strategies.state import (
    StrategyInstanceKey,
    StrategyState,
    StrategyStateError,
    StrategyStateStore,
)
from wlct_trading.strategies.validation import (
    SignalValidationConfig,
    SignalValidationResult,
    SignalValidator,
)

__all__ = [
    "build_default_strategy_registry",
    "CooldownGate",
    "FeatureConfig",
    "FeatureEngine",
    "FeatureSnapshot",
    "instance_key_for",
    "order_book_imbalance",
    "ParameterError",
    "ParameterSchema",
    "ParameterSpec",
    "ParameterType",
    "RESERVED_STRATEGY_KEYS",
    "RollingReturns",
    "RollingWindow",
    "signal_identity",
    "SignalDeduplicator",
    "SignalOutcome",
    "SignalValidationConfig",
    "SignalValidationResult",
    "SignalValidator",
    "Strategy",
    "StrategyContext",
    "StrategyDefinitionError",
    "StrategyEngine",
    "StrategyEngineConfig",
    "StrategyFailure",
    "StrategyInstance",
    "StrategyInstanceKey",
    "StrategyNotRegistered",
    "StrategyRegistration",
    "StrategyRegistry",
    "StrategyRiskView",
    "StrategyState",
    "StrategyStateError",
    "StrategyStateStore",
    "StrategyVersionConflict",
]
```

---

## FILE: libs/trading-core/wlct_trading/strategies/base.py

```py
"""The strategy base class.

This does **not** introduce a second strategy protocol. The platform already
has one - :class:`wlct_trading.signals.BaseStrategy`, added in Part 2 - and
:class:`Strategy` is a subclass of it. Every existing lifecycle method
(``initialize``, ``start``, ``stop``, ``on_market_data``,
``on_order_book_update``, ``on_trade``, ``on_candle``, ``on_timer``,
``generate_signal``) keeps its signature and its meaning. What this class adds
is the context-driven decision entry point, validated parameters, per-instance
state, and the identity a strategy needs to be reproducible.

Naming note, to avoid inventing aliases: the ticker handler is
``on_market_data`` and the book handler is ``on_order_book_update``. Those are
the names Part 2 established and the engine calls them; adding ``on_ticker``
and ``on_order_book`` as second spellings would be duplicate surface for no
capability.

The contract in one paragraph: a strategy receives normalised market data and a
read-only :class:`~wlct_trading.strategies.context.StrategyContext`, and
returns at most one :class:`~wlct_trading.signals.Signal` per decision. It
cannot see a credential, cannot see the trading mode, cannot reach an exchange
and cannot approve its own risk. Those are structural properties of what it is
given, not rules it is asked to follow.
"""

from __future__ import annotations

import hashlib
from decimal import Decimal
from typing import Any, ClassVar, Mapping

from wlct_trading.enums import (
    ExchangeId,
    MarketType,
    OrderType,
    SignalAction,
    TimeInForce,
)
from wlct_trading.market_data import BookTop, Candle, PublicTrade, Ticker
from wlct_trading.signals import BaseStrategy, Signal, StrategyDescriptor
from wlct_trading.strategies.context import StrategyContext
from wlct_trading.strategies.features.engine import FeatureConfig, FeatureSnapshot
from wlct_trading.strategies.parameters import ParameterSchema
from wlct_trading.strategies.state import StrategyInstanceKey, StrategyState

__all__ = [
    "Strategy",
    "StrategyDefinitionError",
    "instance_key_for",
]

_ZERO = Decimal(0)
_ONE = Decimal(1)


class StrategyDefinitionError(ValueError):
    """Raised when a strategy class or instance is defined incoherently."""


def instance_key_for(
    descriptor: StrategyDescriptor,
    *,
    strategy_key: str,
    strategy_version: str,
    symbol: str,
    configuration_version: str = "1",
    market_type: MarketType = MarketType.SPOT,
) -> StrategyInstanceKey:
    """Build the instance key for one symbol of a descriptor.

    Kept as a free function so the registry, the engine and the backtest runner
    all derive identity the same way instead of each assembling a key by hand.
    """
    return StrategyInstanceKey(
        tenant_id=descriptor.tenant_id,
        strategy_key=strategy_key,
        strategy_version=strategy_version,
        exchange=descriptor.exchange,
        symbol=symbol,
        configuration_version=configuration_version,
        market_type=market_type,
    )


class Strategy(BaseStrategy):
    """Context-driven strategy. One instance trades one symbol.

    Subclasses must declare three class attributes and implement
    :meth:`evaluate`:

    ``strategy_key``
        Stable registry id, e.g. ``"DETERMINISTIC_IMBALANCE_V1"``. Never
        changes for the life of the strategy.
    ``strategy_version``
        Semantic version of *this implementation*. Any behavioural change
        requires a new version - the registry refuses to re-register the same
        key and version pointing at different code.
    ``parameter_schema``
        A :class:`~wlct_trading.strategies.parameters.ParameterSchema`. An
        empty schema means the strategy takes no parameters, and a caller who
        passes one gets an error rather than a silently ignored setting.
    """

    #: Stable registry identifier.
    strategy_key: ClassVar[str] = ""
    #: Version of this implementation.
    strategy_version: ClassVar[str] = ""
    #: Human-readable description. Must not make a profitability claim.
    description: ClassVar[str] = ""
    #: Declared parameters.
    parameter_schema: ClassVar[ParameterSchema] = ParameterSchema()

    def __init__(
        self,
        descriptor: StrategyDescriptor,
        *,
        symbol: str,
        parameters: Mapping[str, Any] | None = None,
        configuration_version: str = "1",
        market_type: MarketType = MarketType.SPOT,
        feature_config: FeatureConfig | None = None,
    ) -> None:
        cls = type(self)
        if not cls.strategy_key:
            raise StrategyDefinitionError(
                f"{cls.__name__} must declare a non-empty strategy_key."
            )
        if not cls.strategy_version:
            raise StrategyDefinitionError(
                f"{cls.__name__} must declare a non-empty strategy_version."
            )
        if symbol not in descriptor.symbols:
            raise StrategyDefinitionError(
                f"Symbol {symbol!r} is not in the descriptor's symbol list "
                f"{list(descriptor.symbols)}."
            )
        if descriptor.version and descriptor.version != cls.strategy_version:
            # A descriptor pinned to one version must not be run by a different
            # implementation version: that is precisely the silent behavioural
            # change the versioning rules exist to prevent.
            raise StrategyDefinitionError(
                f"Descriptor pins version {descriptor.version!r} but "
                f"{cls.__name__} is version {cls.strategy_version!r}."
            )

        super().__init__(descriptor)

        self._symbol = symbol
        self._parameters: dict[str, Any] = cls.parameter_schema.validate(parameters)
        self._key = instance_key_for(
            descriptor,
            strategy_key=cls.strategy_key,
            strategy_version=cls.strategy_version,
            symbol=symbol,
            configuration_version=configuration_version,
            market_type=market_type,
        )
        self._state = StrategyState(key=self._key)
        self._feature_config = feature_config or FeatureConfig()
        self._signal_sequence = 0
        self._last_context: StrategyContext | None = None

    # -- identity --------------------------------------------------------
    @property
    def key(self) -> StrategyInstanceKey:
        return self._key

    @property
    def instance_id(self) -> str:
        return self._key.instance_id

    @property
    def symbol(self) -> str:
        return self._symbol

    @property
    def exchange(self) -> ExchangeId:
        return self.descriptor.exchange

    @property
    def state(self) -> StrategyState:
        return self._state

    @property
    def parameters(self) -> dict[str, Any]:
        """Validated parameters. A copy, so a strategy cannot mutate its own
        configuration and thereby change behaviour without a version bump."""
        return dict(self._parameters)

    @property
    def feature_config(self) -> FeatureConfig:
        return self._feature_config

    @property
    def signal_count(self) -> int:
        return self._signal_sequence

    @classmethod
    def implementation_id(cls) -> str:
        """Fully qualified path of the implementing class.

        Recorded on every backtest result so a run can be traced back to the
        exact class, not merely to a version string somebody could have reused.
        """
        return f"{cls.__module__}.{cls.__qualname__}"

    @classmethod
    def describe_definition(cls) -> dict[str, object]:
        return {
            "strategyKey": cls.strategy_key,
            "strategyVersion": cls.strategy_version,
            "implementationId": cls.implementation_id(),
            "description": cls.description,
            "parameters": cls.parameter_schema.to_dict()["parameters"],
        }

    # -- lifecycle -------------------------------------------------------
    def initialize(self) -> None:
        """Prepare deterministic initial state, then run the subclass hook."""
        self._state.reset()
        self._signal_sequence = 0
        self._last_context = None
        super().initialize()
        self.on_initialize()

    def start(self) -> None:
        super().start()
        self.on_start()

    def stop(self) -> None:
        was_running = self.is_running
        super().stop()
        if was_running:
            self.on_stop()

    def reset(self) -> None:
        """Full reset: state, counters and cached context.

        Called when the host must discard accumulated state - after an
        order-book invalidation, or between backtest folds - so that the next
        decision is made from a known-clean starting point.
        """
        self._state.reset()
        self._signal_sequence = 0
        self._last_context = None
        self.on_reset()

    # -- subclass hooks --------------------------------------------------
    def on_initialize(self) -> None:
        """Called once from :meth:`initialize`."""

    def on_start(self) -> None:
        """Called after the instance transitions to running."""

    def on_stop(self) -> None:
        """Called when a running instance is stopped."""

    def on_reset(self) -> None:
        """Called after state has been cleared."""

    # -- market-data handlers (Part 2 signatures, unchanged) -------------
    def on_market_data(self, ticker: Ticker) -> None:
        """Ticker update. Override if the strategy needs it."""

    def on_order_book_update(self, top: BookTop) -> None:
        """Top-of-book update. Override if the strategy needs it."""

    def on_trade(self, trade: PublicTrade) -> None:
        """Public trade print. Override if the strategy needs it."""

    def on_candle(self, candle: Candle) -> None:
        """Candle update. Override if the strategy needs it."""

    def on_timer(self, now_micros: int) -> None:
        """Timer tick. ``now_micros`` is the engine clock, simulated in
        backtests."""

    # -- decision --------------------------------------------------------
    def evaluate(self, context: StrategyContext) -> Signal | None:
        """Produce at most one signal for this context.

        Returning ``None`` means "no opinion". Returning a ``HOLD`` signal is
        an explicit, recorded decision to stay flat - the two are different and
        both are useful, so neither is collapsed into the other.
        """
        raise NotImplementedError(
            f"{type(self).__name__} must implement evaluate(context)."
        )

    def generate_signal(self, symbol: str) -> Signal | None:
        """Part 2 entry point, satisfied from the most recent context.

        Kept so that anything written against ``BaseStrategy`` keeps working.
        It cannot manufacture a context, so it returns ``None`` before the
        first event rather than deciding on empty data.
        """
        context = self._last_context
        if context is None or symbol != self._symbol:
            return None
        return self.evaluate(context)

    def remember_context(self, context: StrategyContext) -> None:
        """Record the context the engine is about to evaluate with."""
        self._last_context = context

    @property
    def last_context(self) -> StrategyContext | None:
        return self._last_context

    # -- signal construction ---------------------------------------------
    def build_signal(
        self,
        context: StrategyContext,
        *,
        action: SignalAction,
        confidence: Decimal = _ONE,
        target_quantity: Decimal | None = None,
        order_type: OrderType = OrderType.LIMIT,
        limit_price: Decimal | None = None,
        stop_price: Decimal | None = None,
        time_in_force: TimeInForce = TimeInForce.GTC,
        reason: str | None = None,
        reference_price: Decimal | None = None,
        valid_for_micros: int | None = None,
        feature_keys: tuple[str, ...] = (),
        metadata: Mapping[str, str] | None = None,
    ) -> Signal:
        """Construct a signal with deterministic identity and full provenance.

        Determinism matters: the id is derived from the instance key, the
        decision content and a per-instance emission counter, so replaying the
        same events produces the same ids. Nothing here reads a clock -
        ``created_at`` is the context's event timestamp, which under replay is
        the historical instant.

        The feature snapshot attached to the signal is limited to
        ``feature_keys`` when supplied, so a signal records the values that
        actually drove it rather than everything the engine happened to hold.
        """
        self._signal_sequence += 1
        created_at = context.event_timestamp_micros
        expires_at = (
            created_at + valid_for_micros
            if valid_for_micros is not None and valid_for_micros > 0
            else None
        )

        signal_id = self._deterministic_signal_id(
            action=action,
            created_at=created_at,
            target_quantity=target_quantity,
            limit_price=limit_price,
        )

        features: dict[str, str] = context.features.to_string_map(
            only=feature_keys or None
        )
        if metadata:
            for name, value in metadata.items():
                if not isinstance(value, str):
                    raise StrategyDefinitionError(
                        f"Signal metadata {name!r} must be a string."
                    )
                features[name] = value

        return Signal(
            signal_id=signal_id,
            tenant_id=context.tenant_id,
            strategy_id=context.instance_id,
            exchange=context.exchange,
            symbol=context.symbol,
            action=action,
            confidence=confidence,
            reference_price=(
                reference_price if reference_price is not None else context.mid_price
            ),
            target_quantity=target_quantity,
            order_type=order_type,
            limit_price=limit_price,
            stop_price=stop_price,
            time_in_force=time_in_force,
            reason=reason,
            created_at=created_at,
            metadata={
                "strategyKey": context.strategy_key,
                "instanceId": context.instance_id,
                "sequence": str(self._signal_sequence),
            },
            strategy_version=context.strategy_version,
            expires_at=expires_at,
            features=features,
        )

    def _deterministic_signal_id(
        self,
        *,
        action: SignalAction,
        created_at: int,
        target_quantity: Decimal | None,
        limit_price: Decimal | None,
    ) -> str:
        source = "|".join(
            (
                self._key.fingerprint_source(),
                action.value,
                str(created_at),
                str(target_quantity) if target_quantity is not None else "-",
                str(limit_price) if limit_price is not None else "-",
                str(self._signal_sequence),
            )
        )
        return "sig-" + hashlib.sha256(source.encode("utf-8")).hexdigest()[:24]

    # -- helpers -----------------------------------------------------------
    @staticmethod
    def feature_or_none(snapshot: FeatureSnapshot, name: str) -> Decimal | None:
        return snapshot.value(name)
```

---

## FILE: libs/trading-core/wlct_trading/strategies/context.py

```py
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
```

---

## FILE: libs/trading-core/wlct_trading/strategies/features/__init__.py

```py
"""Feature calculation for the strategy layer.

Three layers, deliberately separated:

``rolling``
    Bounded, resettable windows and the safe arithmetic helpers every other
    module uses. No market-data types appear here.
``microstructure``
    Pure functions of one normalised market-data object: mid, spread,
    imbalance. Stateless.
``statistics``
    Descriptive statistics used by the performance layer: dispersion,
    risk-adjusted ratios, drawdown.
``engine``
    The stateful per-instance accumulator that ties the three together and
    produces a :class:`FeatureSnapshot`.

Everything is ``Decimal``-based and ``None``-honest: a feature that cannot be
computed is ``None``, never zero and never a non-finite value.
"""

from __future__ import annotations

from wlct_trading.strategies.features.engine import (
    FeatureConfig,
    FeatureEngine,
    FeatureSnapshot,
)
from wlct_trading.strategies.features.microstructure import (
    depth_imbalance,
    mid_price,
    order_book_imbalance,
    spread,
    spread_basis_points,
    spread_percent,
    top_of_book_notional,
    weighted_mid_price,
)
from wlct_trading.strategies.features.rolling import (
    ROLLING_DECIMAL_PRECISION,
    RollingReturns,
    RollingWindow,
    decimal_sqrt,
    safe_ratio,
    sequence_to_window,
)
from wlct_trading.strategies.features.statistics import (
    MIN_RISK_METRIC_OBSERVATIONS,
    annualisation_factor,
    downside_deviation,
    max_drawdown,
    mean,
    profit_factor,
    sharpe_ratio,
    sortino_ratio,
    standard_deviation,
    variance,
)

__all__ = [
    "annualisation_factor",
    "decimal_sqrt",
    "depth_imbalance",
    "downside_deviation",
    "FeatureConfig",
    "FeatureEngine",
    "FeatureSnapshot",
    "max_drawdown",
    "mean",
    "mid_price",
    "MIN_RISK_METRIC_OBSERVATIONS",
    "order_book_imbalance",
    "profit_factor",
    "ROLLING_DECIMAL_PRECISION",
    "RollingReturns",
    "RollingWindow",
    "safe_ratio",
    "sequence_to_window",
    "sharpe_ratio",
    "sortino_ratio",
    "spread",
    "spread_basis_points",
    "spread_percent",
    "standard_deviation",
    "top_of_book_notional",
    "variance",
    "weighted_mid_price",
]
```

---

## FILE: libs/trading-core/wlct_trading/strategies/features/engine.py

```py
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
```

---

## FILE: libs/trading-core/wlct_trading/strategies/features/microstructure.py

```py
"""Order-book microstructure features.

Every function here is a pure function of one normalised market-data object.
None of them holds state, none of them reads a clock, and none of them can
raise on ordinary input: a value that cannot be computed is returned as
``None``.

Definitions are written out explicitly because "imbalance" and "spread" both
have several defensible definitions in the literature, and a strategy tuned
against one behaves differently under another.
"""

from __future__ import annotations

from decimal import Decimal

from wlct_trading.market_data import BookTop, OrderBookSnapshot, PriceLevel
from wlct_trading.strategies.features.rolling import safe_ratio

__all__ = [
    "mid_price",
    "spread",
    "spread_percent",
    "spread_basis_points",
    "order_book_imbalance",
    "weighted_mid_price",
    "depth_imbalance",
    "top_of_book_notional",
]

_ZERO = Decimal(0)
_TWO = Decimal(2)
_HUNDRED = Decimal(100)
_TEN_THOUSAND = Decimal(10_000)


def mid_price(top: BookTop) -> Decimal | None:
    """Arithmetic mid: ``(best_bid + best_ask) / 2``.

    ``None`` when either side is missing - a one-sided book has no mid, and
    substituting the single available side would silently misprice everything
    downstream.
    """
    if top.best_bid is None or top.best_ask is None:
        return None
    return (top.best_bid + top.best_ask) / _TWO


def spread(top: BookTop) -> Decimal | None:
    """Absolute spread in quote currency: ``best_ask - best_bid``."""
    if top.best_bid is None or top.best_ask is None:
        return None
    return top.best_ask - top.best_bid


def spread_percent(top: BookTop) -> Decimal | None:
    """Spread as a percentage of the mid price.

    Mid is the denominator by convention: using bid or ask would make the
    figure asymmetric between the two sides of the same book.
    """
    mid = mid_price(top)
    absolute = spread(top)
    if mid is None or absolute is None:
        return None
    ratio = safe_ratio(absolute, mid)
    if ratio is None:
        return None
    return ratio * _HUNDRED


def spread_basis_points(top: BookTop) -> Decimal | None:
    """Spread in basis points of the mid price. ``1 bp = 0.01%``."""
    mid = mid_price(top)
    absolute = spread(top)
    if mid is None or absolute is None:
        return None
    ratio = safe_ratio(absolute, mid)
    if ratio is None:
        return None
    return ratio * _TEN_THOUSAND


def order_book_imbalance(
    bid_quantity: Decimal | None, ask_quantity: Decimal | None
) -> Decimal | None:
    """Top-of-book volume imbalance.

    Definition used throughout this project::

        imbalance = (bid_volume - ask_volume) / (bid_volume + ask_volume)

    The result is bounded in ``[-1, +1]``:

    * ``+1``  all displayed volume is on the bid (no ask size)
    * ``0``   both sides show equal size
    * ``-1``  all displayed volume is on the ask (no bid size)

    ``None`` is returned when either quantity is missing, when either is
    negative (a corrupt book), or when the denominator is zero. A zero
    denominator is *not* reported as zero imbalance: "both sides empty" and
    "both sides equal" are different facts, and collapsing them would let an
    empty book look balanced.

    This is a displayed-size statistic at the touch only. It says nothing about
    hidden liquidity, queue position or the depth behind the touch, and it is
    not a prediction of the next price move.
    """
    if bid_quantity is None or ask_quantity is None:
        return None
    if bid_quantity < _ZERO or ask_quantity < _ZERO:
        return None
    total = bid_quantity + ask_quantity
    return safe_ratio(bid_quantity - ask_quantity, total)


def weighted_mid_price(top: BookTop) -> Decimal | None:
    """Size-weighted mid, sometimes called the micro-price.

    ::

        weighted_mid = (bid * ask_size + ask * bid_size) / (bid_size + ask_size)

    The larger side pulls the estimate towards the *opposite* price, which is
    the usual formulation: heavy bid size means the next trade is more likely
    to happen at the ask. Falls back to ``None`` - never to the arithmetic mid -
    when sizes are unavailable, so a caller cannot mistake one for the other.
    """
    if top.best_bid is None or top.best_ask is None:
        return None
    bid_size = top.best_bid_quantity
    ask_size = top.best_ask_quantity
    if bid_size is None or ask_size is None:
        return None
    if bid_size < _ZERO or ask_size < _ZERO:
        return None
    total = bid_size + ask_size
    return safe_ratio(top.best_bid * ask_size + top.best_ask * bid_size, total)


def _sum_quantity(levels: tuple[PriceLevel, ...], depth: int) -> Decimal | None:
    if depth < 1:
        return None
    if len(levels) < depth:
        return None
    total = _ZERO
    for level in levels[:depth]:
        if level.quantity < _ZERO:
            return None
        total += level.quantity
    return total


def depth_imbalance(snapshot: OrderBookSnapshot, *, depth: int = 5) -> Decimal | None:
    """Imbalance over the first ``depth`` levels of each side.

    Same definition as :func:`order_book_imbalance`, applied to summed depth
    rather than the touch. ``None`` when either side has fewer than ``depth``
    levels: truncating one side would bias the ratio towards the deeper book.
    """
    bid_volume = _sum_quantity(snapshot.bids, depth)
    ask_volume = _sum_quantity(snapshot.asks, depth)
    return order_book_imbalance(bid_volume, ask_volume)


def top_of_book_notional(top: BookTop) -> Decimal | None:
    """Combined quote-currency value resting at the touch.

    ``bid * bid_size + ask * ask_size``. A rough liquidity gauge; ``None`` when
    any component is missing.
    """
    if (
        top.best_bid is None
        or top.best_ask is None
        or top.best_bid_quantity is None
        or top.best_ask_quantity is None
    ):
        return None
    return top.best_bid * top.best_bid_quantity + top.best_ask * top.best_ask_quantity
```

---

## FILE: libs/trading-core/wlct_trading/strategies/features/rolling.py

```py
"""Bounded, deterministic rolling-window primitives.

Every window here is fixed-capacity: memory is bounded by construction, not by
hoping the caller resets it. Adding one observation to a full window evicts the
oldest, so a strategy that runs for a month uses exactly as much memory as one
that has run for a second.

Two rules govern every accessor:

* **Insufficient history returns ``None``, never a number.** A mean over two
  samples when twenty were asked for is not a smaller-sample estimate of the
  same thing; it is a different statistic. Returning ``None`` forces the caller
  to decide, and the signal validator refuses to act on a ``None``.
* **``Decimal`` throughout.** Binary floats lose precision on ordinary decimal
  prices and that error compounds through variance and PnL. The project's
  convention is ``Decimal`` for anything that is a price, a quantity or is
  derived from one, and these windows keep it.

Nothing in this module can produce ``NaN`` or ``Infinity``: division is guarded
at every site, and :func:`safe_ratio` is the only division helper used.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation, localcontext
from typing import Deque, Iterable, Iterator, Sequence

__all__ = [
    "ROLLING_DECIMAL_PRECISION",
    "RollingWindow",
    "RollingReturns",
    "safe_ratio",
    "decimal_sqrt",
]

_ZERO = Decimal(0)
_ONE = Decimal(1)

#: Precision used for every derived statistic. Fixed rather than inherited from
#: the ambient context so that a caller who has changed the global decimal
#: context cannot change a backtest's results.
ROLLING_DECIMAL_PRECISION = 28


def safe_ratio(numerator: Decimal, denominator: Decimal) -> Decimal | None:
    """``numerator / denominator``, or ``None`` when it is undefined.

    A zero denominator returns ``None`` rather than raising or producing an
    infinity. Letting a non-finite value into strategy state is how a feature
    silently poisons every downstream comparison, so it is refused here.
    """
    if denominator == _ZERO:
        return None
    with localcontext() as ctx:
        ctx.prec = ROLLING_DECIMAL_PRECISION
        try:
            result = numerator / denominator
        except (InvalidOperation, ZeroDivisionError):  # pragma: no cover - guarded
            return None
    if not result.is_finite():  # pragma: no cover - guarded above
        return None
    return result


def decimal_sqrt(value: Decimal) -> Decimal | None:
    """Square root at fixed precision. ``None`` for negative input.

    A negative variance is arithmetically impossible but a caller could pass
    one; returning ``None`` beats raising inside a metrics computation.
    """
    if value < _ZERO:
        return None
    with localcontext() as ctx:
        ctx.prec = ROLLING_DECIMAL_PRECISION
        try:
            return value.sqrt()
        except InvalidOperation:  # pragma: no cover - guarded above
            return None


@dataclass(slots=True)
class RollingWindow:
    """Fixed-capacity window of ``Decimal`` observations.

    ``capacity`` is the number of observations retained. ``min_samples``
    defaults to ``capacity``: the window reports nothing until it is full,
    which is the conservative default for a feature feeding a trading
    decision. A caller that genuinely wants a partial estimate must say so.
    """

    capacity: int
    min_samples: int = 0
    _values: Deque[Decimal] = field(default_factory=deque, init=False, repr=False)
    _sum: Decimal = field(default=_ZERO, init=False, repr=False)

    def __post_init__(self) -> None:
        if self.capacity < 1:
            raise ValueError("RollingWindow capacity must be at least 1.")
        if self.min_samples <= 0:
            self.min_samples = self.capacity
        if self.min_samples > self.capacity:
            raise ValueError(
                "RollingWindow min_samples cannot exceed capacity "
                f"({self.min_samples} > {self.capacity})."
            )
        self._values = deque(maxlen=self.capacity)
        self._sum = _ZERO

    # -- mutation ------------------------------------------------------
    def push(self, value: Decimal) -> None:
        """Append one observation, evicting the oldest when full.

        Non-finite input is refused outright: a ``NaN`` in a rolling sum
        poisons every subsequent value it touches, and the failure would
        surface far from its cause.
        """
        if not isinstance(value, Decimal):
            raise TypeError(
                f"RollingWindow accepts Decimal observations, got {type(value)!r}."
            )
        if not value.is_finite():
            raise ValueError("RollingWindow refuses a non-finite observation.")
        if len(self._values) == self.capacity and self._values:
            self._sum -= self._values[0]
        self._values.append(value)
        self._sum += value

    def extend(self, values: Iterable[Decimal]) -> None:
        for value in values:
            self.push(value)

    def reset(self) -> None:
        """Drop every observation. The window behaves as freshly constructed."""
        self._values.clear()
        self._sum = _ZERO

    # -- inspection ----------------------------------------------------
    def __len__(self) -> int:
        return len(self._values)

    def __iter__(self) -> Iterator[Decimal]:
        return iter(self._values)

    @property
    def count(self) -> int:
        return len(self._values)

    @property
    def is_ready(self) -> bool:
        """Whether enough history exists for the window to report a value."""
        return len(self._values) >= self.min_samples

    @property
    def is_full(self) -> bool:
        return len(self._values) == self.capacity

    def values(self) -> tuple[Decimal, ...]:
        return tuple(self._values)

    @property
    def latest(self) -> Decimal | None:
        return self._values[-1] if self._values else None

    @property
    def oldest(self) -> Decimal | None:
        return self._values[0] if self._values else None

    # -- statistics ----------------------------------------------------
    @property
    def total(self) -> Decimal | None:
        """Sum of the window. ``None`` below ``min_samples``."""
        if not self.is_ready:
            return None
        return self._sum

    @property
    def mean(self) -> Decimal | None:
        if not self.is_ready or not self._values:
            return None
        return safe_ratio(self._sum, Decimal(len(self._values)))

    @property
    def minimum(self) -> Decimal | None:
        if not self.is_ready or not self._values:
            return None
        return min(self._values)

    @property
    def maximum(self) -> Decimal | None:
        if not self.is_ready or not self._values:
            return None
        return max(self._values)

    @property
    def variance(self) -> Decimal | None:
        """Sample variance (Bessel-corrected, ``ddof=1``).

        Sample rather than population: the window is a sample of an ongoing
        process, not the entire population of prices. Requires at least two
        observations regardless of ``min_samples`` - variance of one point is
        not zero, it is undefined.
        """
        if not self.is_ready or len(self._values) < 2:
            return None
        mean = self.mean
        if mean is None:  # pragma: no cover - implied by is_ready
            return None
        with localcontext() as ctx:
            ctx.prec = ROLLING_DECIMAL_PRECISION
            squared = sum(((v - mean) * (v - mean) for v in self._values), _ZERO)
        return safe_ratio(squared, Decimal(len(self._values) - 1))

    @property
    def standard_deviation(self) -> Decimal | None:
        variance = self.variance
        if variance is None:
            return None
        return decimal_sqrt(variance)

    def zscore(self, value: Decimal) -> Decimal | None:
        """How many standard deviations ``value`` sits from the window mean."""
        mean = self.mean
        deviation = self.standard_deviation
        if mean is None or deviation is None or deviation == _ZERO:
            return None
        return safe_ratio(value - mean, deviation)

    def to_dict(self) -> dict[str, object]:
        return {
            "capacity": self.capacity,
            "minSamples": self.min_samples,
            "count": self.count,
            "isReady": self.is_ready,
            "mean": str(self.mean) if self.mean is not None else None,
            "standardDeviation": (
                str(self.standard_deviation)
                if self.standard_deviation is not None
                else None
            ),
        }


@dataclass(slots=True)
class RollingReturns:
    """Simple returns computed from a stream of prices.

    A return needs two prices, so the first observation produces nothing. The
    definition used is the simple (arithmetic) return::

        r_t = (p_t - p_{t-1}) / p_{t-1}

    Log returns are not used: the portfolio and PnL maths elsewhere in the
    project is arithmetic, and mixing the two conventions in one report is a
    reliable way to produce numbers that do not reconcile.
    """

    capacity: int
    min_samples: int = 0
    _window: RollingWindow = field(init=False, repr=False)
    _previous_price: Decimal | None = field(default=None, init=False, repr=False)

    def __post_init__(self) -> None:
        self._window = RollingWindow(
            capacity=self.capacity, min_samples=self.min_samples
        )
        self._previous_price = None

    def push_price(self, price: Decimal) -> Decimal | None:
        """Record a price and return the resulting simple return, if any."""
        if not isinstance(price, Decimal):
            raise TypeError(f"RollingReturns accepts Decimal prices, got {type(price)!r}.")
        if not price.is_finite():
            raise ValueError("RollingReturns refuses a non-finite price.")
        previous = self._previous_price
        self._previous_price = price
        if previous is None or previous == _ZERO:
            return None
        change = safe_ratio(price - previous, previous)
        if change is None:  # pragma: no cover - guarded by the zero check
            return None
        self._window.push(change)
        return change

    def reset(self) -> None:
        self._window.reset()
        self._previous_price = None

    @property
    def window(self) -> RollingWindow:
        return self._window

    @property
    def count(self) -> int:
        return self._window.count

    @property
    def is_ready(self) -> bool:
        return self._window.is_ready

    @property
    def latest(self) -> Decimal | None:
        return self._window.latest

    @property
    def mean(self) -> Decimal | None:
        return self._window.mean

    @property
    def volatility(self) -> Decimal | None:
        """Standard deviation of the returns in the window.

        This is a realised, unannualised dispersion measure over the window
        length. It is not a forecast and carries no distributional assumption.
        """
        return self._window.standard_deviation

    def values(self) -> tuple[Decimal, ...]:
        return self._window.values()

    def cumulative_return(self) -> Decimal | None:
        """Return from the oldest retained price to the latest.

        Compounded from the retained simple returns; ``None`` until the window
        reports ready.
        """
        if not self._window.is_ready:
            return None
        with localcontext() as ctx:
            ctx.prec = ROLLING_DECIMAL_PRECISION
            product = _ONE
            for value in self._window:
                product *= _ONE + value
        return product - _ONE


def sequence_to_window(values: Sequence[Decimal], *, min_samples: int = 0) -> RollingWindow:
    """Build a window sized exactly to ``values``. Convenience for tests."""
    window = RollingWindow(capacity=max(len(values), 1), min_samples=min_samples)
    window.extend(values)
    return window
```

---

## FILE: libs/trading-core/wlct_trading/strategies/features/statistics.py

```py
"""Deterministic descriptive statistics on ``Decimal`` sequences.

These back the performance-metric layer and any strategy that needs a summary
statistic. They share three properties with the rolling windows:

* fixed decimal precision, so the result does not depend on the caller's
  ambient decimal context;
* ``None`` rather than a number when there are too few observations;
* no possibility of ``NaN`` or ``Infinity`` escaping.

Nothing here annualises anything by default. Annualisation requires knowing how
many observation periods make a year, which only the caller knows, so it is an
explicit argument and never a hidden assumption.
"""

from __future__ import annotations

from decimal import Decimal, localcontext
from typing import Sequence

from wlct_trading.strategies.features.rolling import (
    ROLLING_DECIMAL_PRECISION,
    decimal_sqrt,
    safe_ratio,
)

__all__ = [
    "MIN_RISK_METRIC_OBSERVATIONS",
    "mean",
    "variance",
    "standard_deviation",
    "downside_deviation",
    "sharpe_ratio",
    "sortino_ratio",
    "max_drawdown",
    "profit_factor",
    "annualisation_factor",
]

_ZERO = Decimal(0)

#: Below this many observations a risk-adjusted ratio is not reported at all.
#: Two points can always be made to look like a fine Sharpe ratio; the number
#: would be arithmetic without being information.
MIN_RISK_METRIC_OBSERVATIONS = 20


def mean(values: Sequence[Decimal]) -> Decimal | None:
    """Arithmetic mean. ``None`` for an empty sequence."""
    if not values:
        return None
    with localcontext() as ctx:
        ctx.prec = ROLLING_DECIMAL_PRECISION
        total = sum(values, _ZERO)
    return safe_ratio(total, Decimal(len(values)))


def variance(values: Sequence[Decimal]) -> Decimal | None:
    """Sample variance (``ddof=1``). ``None`` below two observations."""
    if len(values) < 2:
        return None
    average = mean(values)
    if average is None:  # pragma: no cover - implied by the length check
        return None
    with localcontext() as ctx:
        ctx.prec = ROLLING_DECIMAL_PRECISION
        squared = sum(((v - average) * (v - average) for v in values), _ZERO)
    return safe_ratio(squared, Decimal(len(values) - 1))


def standard_deviation(values: Sequence[Decimal]) -> Decimal | None:
    result = variance(values)
    if result is None:
        return None
    return decimal_sqrt(result)


def downside_deviation(
    values: Sequence[Decimal], *, threshold: Decimal = _ZERO
) -> Decimal | None:
    """Dispersion of observations below ``threshold``.

    Deviations above the threshold contribute zero rather than being dropped,
    which is the standard Sortino formulation: excluding them entirely would
    shrink the denominator and inflate the ratio for a strategy that is simply
    inactive most of the time.
    """
    if len(values) < 2:
        return None
    with localcontext() as ctx:
        ctx.prec = ROLLING_DECIMAL_PRECISION
        squared = _ZERO
        for value in values:
            if value < threshold:
                shortfall = threshold - value
                squared += shortfall * shortfall
    result = safe_ratio(squared, Decimal(len(values) - 1))
    if result is None:  # pragma: no cover - length checked above
        return None
    return decimal_sqrt(result)


def annualisation_factor(periods_per_year: int) -> Decimal | None:
    """``sqrt(periods_per_year)``, the usual scaling for a ratio of returns."""
    if periods_per_year < 1:
        return None
    return decimal_sqrt(Decimal(periods_per_year))


def sharpe_ratio(
    returns: Sequence[Decimal],
    *,
    risk_free_rate_per_period: Decimal = _ZERO,
    periods_per_year: int | None = None,
    min_observations: int = MIN_RISK_METRIC_OBSERVATIONS,
) -> Decimal | None:
    """Mean excess return divided by its standard deviation.

    Returns ``None`` when there are fewer than ``min_observations`` samples or
    when dispersion is zero. Assumptions, stated rather than buried:

    * ``returns`` are per-period simple returns of *equity*, in order;
    * the risk-free rate is expressed per period, not annualised;
    * the result is unannualised unless ``periods_per_year`` is supplied;
    * no distributional assumption is made, and this figure says nothing about
      whether the strategy will make money in future.
    """
    if len(returns) < max(2, min_observations):
        return None
    excess = [value - risk_free_rate_per_period for value in returns]
    average = mean(excess)
    deviation = standard_deviation(excess)
    if average is None or deviation is None or deviation == _ZERO:
        return None
    ratio = safe_ratio(average, deviation)
    if ratio is None:  # pragma: no cover - deviation checked above
        return None
    if periods_per_year is None:
        return ratio
    factor = annualisation_factor(periods_per_year)
    if factor is None:
        return ratio
    with localcontext() as ctx:
        ctx.prec = ROLLING_DECIMAL_PRECISION
        return ratio * factor


def sortino_ratio(
    returns: Sequence[Decimal],
    *,
    target_return_per_period: Decimal = _ZERO,
    periods_per_year: int | None = None,
    min_observations: int = MIN_RISK_METRIC_OBSERVATIONS,
) -> Decimal | None:
    """Mean excess return divided by downside deviation.

    Same caveats as :func:`sharpe_ratio`. ``None`` when downside deviation is
    zero, which happens when nothing ever fell below the target - a case where
    the ratio is infinite and therefore meaningless rather than excellent.
    """
    if len(returns) < max(2, min_observations):
        return None
    excess = [value - target_return_per_period for value in returns]
    average = mean(excess)
    deviation = downside_deviation(excess, threshold=_ZERO)
    if average is None or deviation is None or deviation == _ZERO:
        return None
    ratio = safe_ratio(average, deviation)
    if ratio is None:  # pragma: no cover - deviation checked above
        return None
    if periods_per_year is None:
        return ratio
    factor = annualisation_factor(periods_per_year)
    if factor is None:
        return ratio
    with localcontext() as ctx:
        ctx.prec = ROLLING_DECIMAL_PRECISION
        return ratio * factor


def max_drawdown(equity_curve: Sequence[Decimal]) -> tuple[Decimal, Decimal | None]:
    """Largest peak-to-trough decline of an equity curve.

    Returns ``(absolute_drawdown, fractional_drawdown)``. The absolute figure
    is in account currency and is always defined (zero for a curve that never
    falls). The fractional figure is ``None`` when the running peak is zero or
    negative, because a percentage of nothing is not a number.

    Drawdown is computed on the curve as given; it is a property of the
    observed path, not an estimate of future risk.
    """
    peak: Decimal | None = None
    worst_absolute = _ZERO
    worst_fraction: Decimal | None = None
    for value in equity_curve:
        if peak is None or value > peak:
            peak = value
        # ``peak`` cannot still be None here: the branch above assigns it on
        # the first element of every iteration path. The defensive guard that
        # used to sit between them was unreachable code, proven so by mypy.
        decline = peak - value
        if decline > worst_absolute:
            worst_absolute = decline
            if peak > _ZERO:
                worst_fraction = safe_ratio(decline, peak)
            else:
                worst_fraction = None
    return worst_absolute, worst_fraction


def profit_factor(gross_profit: Decimal, gross_loss: Decimal) -> Decimal | None:
    """``gross_profit / abs(gross_loss)``.

    ``gross_loss`` is expected as a positive magnitude or a negative number;
    both are handled. ``None`` when there were no losses at all - an undefined
    ratio, not an infinitely good one.
    """
    magnitude = abs(gross_loss)
    if magnitude == _ZERO:
        return None
    return safe_ratio(gross_profit, magnitude)
```

---

## FILE: libs/trading-core/wlct_trading/strategies/implementations/__init__.py

```py
"""Reference strategy implementations shipped with the library.

There is exactly one, and it is a **test fixture with a production-grade
implementation**, not a trading recommendation. See
:mod:`wlct_trading.strategies.implementations.deterministic_example`.
"""

from __future__ import annotations

from wlct_trading.strategies.implementations.deterministic_example import (
    DeterministicImbalanceStrategy,
)

__all__ = ["DeterministicImbalanceStrategy"]
```

---

## FILE: libs/trading-core/wlct_trading/strategies/implementations/deterministic_example.py

```py
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
```

---

## FILE: libs/trading-core/wlct_trading/strategies/lifecycle.py

```py
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
    ) -> None:
        self._config = config or StrategyEngineConfig()
        self._instances: dict[str, StrategyInstance] = {}
        self._by_symbol: dict[str, list[str]] = {}
        self._validator = SignalValidator(self._config.validation)
        self._metrics = metrics or StrategyMetrics()
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
        if self._halted:
            return ()
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
        return tuple(outcomes)

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
```

---

## FILE: libs/trading-core/wlct_trading/strategies/parameters.py

```py
"""Strongly validated strategy parameters.

A strategy's behaviour is a function of its code *and* its parameters, so
parameters get the same treatment as any other untrusted input: an explicit
schema, type coercion from strings, range checks, and rejection of anything
unknown. A malformed configuration must fail at construction, not produce a
subtly different strategy at runtime.

Three rules that are enforced structurally rather than by convention:

* **Unknown keys are refused.** A typo in a parameter name would otherwise
  leave the default silently in place, and the operator would believe they had
  changed something.
* **Numeric parameters are ``Decimal`` or ``int``, never ``float``.** The
  project's precision convention applies to configuration too: a threshold
  compared against a ``Decimal`` price must itself be exact.
* **Secret-looking names are refused outright.** A strategy is never given a
  credential, so a parameter called ``api_secret`` is either a mistake or an
  attempt to smuggle one into a code path that logs and hashes its inputs.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable, Mapping

__all__ = [
    "ParameterError",
    "ParameterType",
    "ParameterSpec",
    "ParameterSchema",
    "FORBIDDEN_PARAMETER_PATTERN",
]

#: Parameter names that must never appear. Matched case-insensitively against
#: the whole name. The strategy layer has no use for any of them.
FORBIDDEN_PARAMETER_PATTERN = re.compile(
    r"(secret|password|passwd|api[_-]?key|private[_-]?key|token|credential|passphrase)",
    re.IGNORECASE,
)

_BOOL_TRUE = frozenset({"1", "true", "yes", "on"})
_BOOL_FALSE = frozenset({"0", "false", "no", "off"})


class ParameterError(ValueError):
    """Raised when a parameter set is missing, unknown, or out of range."""


class ParameterType:
    """The supported parameter types.

    A deliberately small set. Anything a strategy needs can be expressed as an
    integer, an exact decimal, a boolean or a constrained string; richer types
    would need richer validation and would not survive a configuration hash
    unambiguously.
    """

    INT = "INT"
    DECIMAL = "DECIMAL"
    BOOL = "BOOL"
    STRING = "STRING"

    ALL = (INT, DECIMAL, BOOL, STRING)


@dataclass(slots=True, frozen=True)
class ParameterSpec:
    """Declaration of one parameter.

    ``minimum``/``maximum`` are inclusive bounds and apply to ``INT`` and
    ``DECIMAL``. ``choices`` constrains ``STRING``. ``default`` is used when
    the key is absent; a spec with no default is required.
    """

    name: str
    kind: str
    description: str
    default: Any = None
    minimum: Decimal | int | None = None
    maximum: Decimal | int | None = None
    choices: tuple[str, ...] | None = None
    required: bool = False

    def __post_init__(self) -> None:
        if not self.name:
            raise ParameterError("ParameterSpec requires a name.")
        if FORBIDDEN_PARAMETER_PATTERN.search(self.name):
            raise ParameterError(
                f"Parameter name {self.name!r} looks like a credential. Strategies "
                "are never given credentials."
            )
        if self.kind not in ParameterType.ALL:
            raise ParameterError(
                f"Parameter {self.name!r} has unknown type {self.kind!r}."
            )
        if self.required and self.default is not None:
            raise ParameterError(
                f"Parameter {self.name!r} is required and must not carry a default."
            )
        if self.choices is not None and self.kind != ParameterType.STRING:
            raise ParameterError(
                f"Parameter {self.name!r} declares choices but is not a STRING."
            )

    # -- coercion -------------------------------------------------------
    def coerce(self, raw: Any) -> Any:
        """Convert ``raw`` to this parameter's type, or raise.

        Strings are accepted for every type so that a parameter set loaded from
        the database, an environment variable or a JSON payload validates the
        same way as one written in Python.
        """
        if self.kind == ParameterType.BOOL:
            return self._coerce_bool(raw)
        if self.kind == ParameterType.INT:
            return self._coerce_int(raw)
        if self.kind == ParameterType.DECIMAL:
            return self._coerce_decimal(raw)
        return self._coerce_string(raw)

    def _coerce_bool(self, raw: Any) -> bool:
        if isinstance(raw, bool):
            return raw
        if isinstance(raw, str):
            lowered = raw.strip().lower()
            if lowered in _BOOL_TRUE:
                return True
            if lowered in _BOOL_FALSE:
                return False
        raise ParameterError(
            f"Parameter {self.name!r} must be a boolean; got {raw!r}."
        )

    def _coerce_int(self, raw: Any) -> int:
        if isinstance(raw, bool):
            raise ParameterError(
                f"Parameter {self.name!r} must be an integer, not a boolean."
            )
        if isinstance(raw, int):
            value = raw
        elif isinstance(raw, str):
            try:
                value = int(raw.strip())
            except ValueError as exc:
                raise ParameterError(
                    f"Parameter {self.name!r} must be an integer; got {raw!r}."
                ) from exc
        else:
            raise ParameterError(
                f"Parameter {self.name!r} must be an integer; got {type(raw).__name__}."
            )
        self._check_bounds(Decimal(value))
        return value

    def _coerce_decimal(self, raw: Any) -> Decimal:
        if isinstance(raw, bool):
            raise ParameterError(
                f"Parameter {self.name!r} must be a decimal, not a boolean."
            )
        if isinstance(raw, Decimal):
            value = raw
        elif isinstance(raw, int):
            value = Decimal(raw)
        elif isinstance(raw, str):
            try:
                value = Decimal(raw.strip())
            except InvalidOperation as exc:
                raise ParameterError(
                    f"Parameter {self.name!r} must be a decimal; got {raw!r}."
                ) from exc
        elif isinstance(raw, float):
            # Refused rather than converted: Decimal(0.1) is 0.1000000000000000055...
            # and a strategy threshold that is almost the number the operator
            # typed is worse than an error.
            raise ParameterError(
                f"Parameter {self.name!r} must not be a float; pass a string or "
                "Decimal so the exact value is preserved."
            )
        else:
            raise ParameterError(
                f"Parameter {self.name!r} must be a decimal; got {type(raw).__name__}."
            )
        if not value.is_finite():
            raise ParameterError(f"Parameter {self.name!r} must be finite.")
        self._check_bounds(value)
        return value

    def _coerce_string(self, raw: Any) -> str:
        if not isinstance(raw, str):
            raise ParameterError(
                f"Parameter {self.name!r} must be a string; got {type(raw).__name__}."
            )
        value = raw.strip()
        if self.choices is not None and value not in self.choices:
            raise ParameterError(
                f"Parameter {self.name!r} must be one of {list(self.choices)}; "
                f"got {value!r}."
            )
        return value

    def _check_bounds(self, value: Decimal) -> None:
        if self.minimum is not None and value < Decimal(str(self.minimum)):
            raise ParameterError(
                f"Parameter {self.name!r} must be >= {self.minimum}; got {value}."
            )
        if self.maximum is not None and value > Decimal(str(self.maximum)):
            raise ParameterError(
                f"Parameter {self.name!r} must be <= {self.maximum}; got {value}."
            )

    def to_dict(self) -> dict[str, object]:
        return {
            "name": self.name,
            "kind": self.kind,
            "description": self.description,
            "default": str(self.default) if self.default is not None else None,
            "minimum": str(self.minimum) if self.minimum is not None else None,
            "maximum": str(self.maximum) if self.maximum is not None else None,
            "choices": list(self.choices) if self.choices else None,
            "required": self.required,
        }


@dataclass(slots=True, frozen=True)
class ParameterSchema:
    """An ordered set of :class:`ParameterSpec`.

    Order matters: :meth:`canonical_form` emits parameters sorted by name so
    that two logically identical configurations hash identically regardless of
    the order the operator supplied them in.
    """

    specs: tuple[ParameterSpec, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        seen: set[str] = set()
        for spec in self.specs:
            if spec.name in seen:
                raise ParameterError(f"Duplicate parameter {spec.name!r} in schema.")
            seen.add(spec.name)

    @property
    def names(self) -> tuple[str, ...]:
        return tuple(spec.name for spec in self.specs)

    def spec_for(self, name: str) -> ParameterSpec | None:
        for spec in self.specs:
            if spec.name == name:
                return spec
        return None

    def validate(self, raw: Mapping[str, Any] | None) -> dict[str, Any]:
        """Validate and coerce a parameter mapping.

        Returns a new dict containing every declared parameter, with defaults
        filled in. Raises :class:`ParameterError` on an unknown key, a missing
        required key, a wrong type, or an out-of-range value.
        """
        supplied = dict(raw or {})

        for key in supplied:
            if FORBIDDEN_PARAMETER_PATTERN.search(key):
                raise ParameterError(
                    f"Parameter {key!r} looks like a credential and is refused."
                )

        unknown = sorted(set(supplied) - set(self.names))
        if unknown:
            raise ParameterError(
                "Unknown strategy parameter(s): "
                + ", ".join(unknown)
                + f". Declared parameters are: {', '.join(self.names) or '(none)'}."
            )

        resolved: dict[str, Any] = {}
        for spec in self.specs:
            if spec.name in supplied:
                resolved[spec.name] = spec.coerce(supplied[spec.name])
            elif spec.required:
                raise ParameterError(f"Parameter {spec.name!r} is required.")
            else:
                resolved[spec.name] = (
                    spec.coerce(spec.default) if spec.default is not None else None
                )
        return resolved

    def canonical_form(self, values: Mapping[str, Any]) -> tuple[tuple[str, str], ...]:
        """Deterministic ``(name, string_value)`` pairs for hashing.

        Sorted by name and stringified with ``str()``, which is exact for
        ``Decimal`` and ``int``. This is the only representation used by the
        configuration hash, so a hash never depends on dict ordering or on the
        caller's decimal context.
        """
        return tuple(
            (name, "null" if values.get(name) is None else str(values.get(name)))
            for name in sorted(values)
        )

    def to_dict(self) -> dict[str, object]:
        return {"parameters": [spec.to_dict() for spec in self.specs]}

    @classmethod
    def of(cls, specs: Iterable[ParameterSpec]) -> "ParameterSchema":
        return cls(specs=tuple(specs))
```

---

## FILE: libs/trading-core/wlct_trading/strategies/registry.py

```py
"""Strategy registry and factory.

Strategies are addressed by a stable ``(strategy_key, strategy_version)`` pair.
The registry maps that pair to exactly one implementation class and refuses to
let it mean anything else afterwards - registering the same key and version
against a different class raises :class:`StrategyVersionConflict`.

That refusal is the whole point. A backtest result records a key and a version;
if the code behind that pair could change, the record would be a claim about
something unreproducible. Behaviour changes require a new version, always.

The registry holds *classes*, not instances. Instantiation goes through
:meth:`StrategyRegistry.create`, which validates parameters against the
declared schema before the object exists, so a misconfigured strategy fails at
construction rather than on its first market event.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterator, Mapping

from wlct_trading.enums import MarketType
from wlct_trading.signals import StrategyDescriptor
from wlct_trading.strategies.base import Strategy, StrategyDefinitionError
from wlct_trading.strategies.features.engine import FeatureConfig
from wlct_trading.strategies.parameters import ParameterSchema

__all__ = [
    "RESERVED_STRATEGY_KEYS",
    "StrategyRegistration",
    "StrategyRegistry",
    "StrategyNotRegistered",
    "StrategyVersionConflict",
    "build_default_strategy_registry",
]

#: Names reserved for future strategy families so that nothing else claims
#: them. **None of these is implemented**, and listing a name here is not a
#: statement that such a strategy works, is safe, or would be profitable. The
#: only implementation shipped in this part is the deterministic example, which
#: exists to exercise the architecture.
RESERVED_STRATEGY_KEYS: tuple[str, ...] = (
    "MARKET_MAKING_V1",
    "MOMENTUM_V1",
    "MEAN_REVERSION_V1",
    "MICROSTRUCTURE_V1",
)


class StrategyNotRegistered(KeyError):
    """Raised when an unknown strategy key or version is requested."""


class StrategyVersionConflict(ValueError):
    """Raised when a key and version would be rebound to different code."""


@dataclass(slots=True, frozen=True)
class StrategyRegistration:
    """One registered strategy implementation."""

    strategy_key: str
    strategy_version: str
    implementation_id: str
    strategy_class: type[Strategy]
    parameter_schema: ParameterSchema
    description: str

    @property
    def registry_id(self) -> str:
        return f"{self.strategy_key}@{self.strategy_version}"

    def to_dict(self) -> dict[str, object]:
        return {
            "strategyKey": self.strategy_key,
            "strategyVersion": self.strategy_version,
            "implementationId": self.implementation_id,
            "description": self.description,
            "parameters": self.parameter_schema.to_dict()["parameters"],
        }


class StrategyRegistry:
    """Maps stable ids to strategy classes and builds instances from them."""

    __slots__ = ("_registrations",)

    def __init__(self) -> None:
        self._registrations: dict[tuple[str, str], StrategyRegistration] = {}

    # -- registration ----------------------------------------------------
    def register(self, strategy_class: type[Strategy]) -> StrategyRegistration:
        """Register a strategy class by its declared key and version.

        Re-registering the identical class is a no-op, which keeps module
        reloads and repeated imports harmless. Re-registering a *different*
        class under the same key and version raises.
        """
        if not isinstance(strategy_class, type) or not issubclass(
            strategy_class, Strategy
        ):
            raise StrategyDefinitionError(
                f"{strategy_class!r} is not a Strategy subclass."
            )
        key = strategy_class.strategy_key
        version = strategy_class.strategy_version
        if not key:
            raise StrategyDefinitionError(
                f"{strategy_class.__name__} declares no strategy_key."
            )
        if not version:
            raise StrategyDefinitionError(
                f"{strategy_class.__name__} declares no strategy_version."
            )

        implementation_id = strategy_class.implementation_id()
        existing = self._registrations.get((key, version))
        if existing is not None:
            if existing.implementation_id == implementation_id:
                return existing
            raise StrategyVersionConflict(
                f"{key}@{version} is already registered to "
                f"{existing.implementation_id}; refusing to rebind it to "
                f"{implementation_id}. Behaviour changes require a new version."
            )

        registration = StrategyRegistration(
            strategy_key=key,
            strategy_version=version,
            implementation_id=implementation_id,
            strategy_class=strategy_class,
            parameter_schema=strategy_class.parameter_schema,
            description=strategy_class.description,
        )
        self._registrations[(key, version)] = registration
        return registration

    def unregister(self, strategy_key: str, strategy_version: str) -> None:
        self._registrations.pop((strategy_key, strategy_version), None)

    # -- lookup -----------------------------------------------------------
    def get(self, strategy_key: str, strategy_version: str) -> StrategyRegistration:
        registration = self._registrations.get((strategy_key, strategy_version))
        if registration is None:
            raise StrategyNotRegistered(
                f"No strategy registered as {strategy_key}@{strategy_version}. "
                f"Known: {', '.join(self.registry_ids()) or '(none)'}."
            )
        return registration

    def has(self, strategy_key: str, strategy_version: str) -> bool:
        return (strategy_key, strategy_version) in self._registrations

    def versions_of(self, strategy_key: str) -> tuple[str, ...]:
        return tuple(
            sorted(
                version
                for (key, version) in self._registrations
                if key == strategy_key
            )
        )

    def keys(self) -> tuple[str, ...]:
        return tuple(sorted({key for (key, _version) in self._registrations}))

    def registry_ids(self) -> tuple[str, ...]:
        return tuple(sorted(reg.registry_id for reg in self._registrations.values()))

    def all(self) -> tuple[StrategyRegistration, ...]:
        return tuple(
            sorted(self._registrations.values(), key=lambda reg: reg.registry_id)
        )

    def __len__(self) -> int:
        return len(self._registrations)

    def __iter__(self) -> Iterator[StrategyRegistration]:
        return iter(self.all())

    def describe(self) -> list[dict[str, object]]:
        return [registration.to_dict() for registration in self.all()]

    # -- construction ------------------------------------------------------
    def create(
        self,
        strategy_key: str,
        strategy_version: str,
        *,
        descriptor: StrategyDescriptor,
        symbol: str,
        parameters: Mapping[str, Any] | None = None,
        configuration_version: str = "1",
        market_type: MarketType = MarketType.SPOT,
        feature_config: FeatureConfig | None = None,
    ) -> Strategy:
        """Instantiate a registered strategy for one symbol.

        Parameters are validated by the strategy's own schema inside the
        constructor, so an unknown key or an out-of-range value raises here and
        no partially configured instance is ever produced.
        """
        registration = self.get(strategy_key, strategy_version)
        return registration.strategy_class(
            descriptor,
            symbol=symbol,
            parameters=parameters,
            configuration_version=configuration_version,
            market_type=market_type,
            feature_config=feature_config,
        )

    def create_for_descriptor(
        self,
        strategy_key: str,
        strategy_version: str,
        *,
        descriptor: StrategyDescriptor,
        parameters: Mapping[str, Any] | None = None,
        configuration_version: str = "1",
        market_type: MarketType = MarketType.SPOT,
        feature_config: FeatureConfig | None = None,
    ) -> tuple[Strategy, ...]:
        """One instance per symbol in the descriptor.

        Symbol-specific instances rather than one instance handling every
        symbol: state stays isolated per symbol, and a failure in one symbol's
        instance cannot corrupt another's.
        """
        return tuple(
            self.create(
                strategy_key,
                strategy_version,
                descriptor=descriptor,
                symbol=symbol,
                parameters=parameters,
                configuration_version=configuration_version,
                market_type=market_type,
                feature_config=feature_config,
            )
            for symbol in descriptor.symbols
        )


def build_default_strategy_registry() -> StrategyRegistry:
    """Registry containing every strategy shipped with the library.

    That is currently one strategy: the deterministic example. It exists to
    exercise and test the architecture end to end. No claim is made that it is
    profitable, and it should not be run with real money.
    """
    from wlct_trading.strategies.implementations.deterministic_example import (
        DeterministicImbalanceStrategy,
    )

    registry = StrategyRegistry()
    registry.register(DeterministicImbalanceStrategy)
    return registry
```

---

## FILE: libs/trading-core/wlct_trading/strategies/signals.py

```py
"""Signal identity, deduplication and cooldown.

Scope, stated up front so this is not confused with the Part 5 machinery: this
is *strategy-level* deduplication. It stops a strategy that re-evaluates on
every book tick from emitting the same opinion two hundred times a second. It
is bounded, in-memory and best-effort.

It is **not** exchange-order idempotency. That remains
:mod:`wlct_trading.idempotency` and the Part 5 execution engine, which derive a
deterministic ``clientOrderId`` and hold the authoritative duplicate guard. A
signal surviving deduplication here still passes through validation, the risk
engine and the execution engine's own duplicate detection before anything is
sent anywhere.

Both structures are bounded by construction. An unbounded dedup cache in a
process that sees a million events an hour is a memory leak with extra steps.
"""

from __future__ import annotations

import hashlib
from collections import OrderedDict
from dataclasses import dataclass
from decimal import Decimal

from wlct_trading.signals import Signal

__all__ = [
    "signal_identity",
    "SignalDeduplicator",
    "CooldownGate",
    "DEFAULT_DEDUP_CAPACITY",
]

#: Default number of identities retained. At ~40 bytes per entry this is well
#: under a megabyte and covers a busy instance for minutes.
DEFAULT_DEDUP_CAPACITY = 4_096


def signal_identity(signal: Signal) -> str:
    """Deterministic content identity of a signal.

    Two signals share an identity when they express the *same opinion*: same
    tenant, strategy instance, venue, symbol, action, size, order type and
    prices. Deliberately excluded:

    ``created_at`` / ``expires_at``
        Time is what makes a repeat a repeat. Including it would give every
        re-evaluation a fresh identity and defeat the purpose.
    ``signal_id``
        Unique per emission by construction.
    ``confidence``, ``reason``, ``features``, ``metadata``
        Explanatory, not instructive. A signal whose confidence moved from
        0.80 to 0.81 is the same instruction, and letting that through would
        turn a jittery feature into an order flood.
    """
    parts = (
        signal.tenant_id,
        signal.strategy_id,
        signal.strategy_version,
        signal.exchange.value,
        signal.symbol,
        signal.action.value,
        signal.order_type.value,
        signal.time_in_force.value,
        _decimal_token(signal.target_quantity),
        _decimal_token(signal.limit_price),
        _decimal_token(signal.stop_price),
    )
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()[:32]


def _decimal_token(value: Decimal | None) -> str:
    if value is None:
        return "-"
    # Normalised so that 1.50 and 1.5 are the same opinion.
    return str(value.normalize())


@dataclass(slots=True, frozen=True)
class DedupDecision:
    """Outcome of a deduplication check."""

    is_duplicate: bool
    identity: str
    first_seen_micros: int | None
    age_micros: int | None


class SignalDeduplicator:
    """Bounded TTL cache of recently seen signal identities.

    Eviction is least-recently-inserted once ``capacity`` is reached, and
    entries older than ``ttl_micros`` are treated as absent. Both bounds apply
    simultaneously: the TTL keeps the cache semantically correct and the
    capacity keeps it small even if the TTL is set generously.

    Not thread-safe and not shared between instances. One deduplicator belongs
    to one strategy instance, which is also what stops two instances from
    suppressing each other's signals.
    """

    __slots__ = ("_ttl_micros", "_capacity", "_seen")

    def __init__(
        self, *, ttl_micros: int, capacity: int = DEFAULT_DEDUP_CAPACITY
    ) -> None:
        if ttl_micros <= 0:
            raise ValueError("SignalDeduplicator ttl_micros must be positive.")
        if capacity < 1:
            raise ValueError("SignalDeduplicator capacity must be at least 1.")
        self._ttl_micros = ttl_micros
        self._capacity = capacity
        self._seen: "OrderedDict[str, int]" = OrderedDict()

    @property
    def ttl_micros(self) -> int:
        return self._ttl_micros

    @property
    def capacity(self) -> int:
        return self._capacity

    @property
    def size(self) -> int:
        return len(self._seen)

    def check(self, signal: Signal, *, now_micros: int) -> DedupDecision:
        """Test a signal without recording it."""
        identity = signal_identity(signal)
        first_seen = self._seen.get(identity)
        if first_seen is None:
            return DedupDecision(False, identity, None, None)
        age = now_micros - first_seen
        if age > self._ttl_micros:
            return DedupDecision(False, identity, first_seen, age)
        return DedupDecision(True, identity, first_seen, age)

    def register(self, signal: Signal, *, now_micros: int) -> str:
        """Record a signal as seen. Returns its identity."""
        identity = signal_identity(signal)
        self._seen.pop(identity, None)
        self._seen[identity] = now_micros
        self._evict(now_micros)
        return identity

    def check_and_register(self, signal: Signal, *, now_micros: int) -> DedupDecision:
        """Atomic test-then-record.

        A duplicate does **not** refresh the stored timestamp. Refreshing would
        let a strategy repeating the same opinion every millisecond keep the
        entry alive forever and never re-emit, which is the opposite of what a
        TTL is for.
        """
        decision = self.check(signal, now_micros=now_micros)
        if not decision.is_duplicate:
            self.register(signal, now_micros=now_micros)
        return decision

    def _evict(self, now_micros: int) -> None:
        cutoff = now_micros - self._ttl_micros
        while self._seen:
            oldest_identity, oldest_at = next(iter(self._seen.items()))
            if oldest_at >= cutoff:
                break
            self._seen.popitem(last=False)
        while len(self._seen) > self._capacity:
            self._seen.popitem(last=False)

    def reset(self) -> None:
        self._seen.clear()

    def to_dict(self) -> dict[str, object]:
        return {
            "size": self.size,
            "capacity": self._capacity,
            "ttlMicros": self._ttl_micros,
        }


class CooldownGate:
    """Minimum spacing between actionable signals for one instance.

    Separate from deduplication because it answers a different question.
    Deduplication asks "have I said this already?"; the cooldown asks "have I
    said *anything* recently?". A strategy that alternates BUY and SELL every
    tick defeats deduplication entirely and is exactly what this catches.

    ``HOLD`` never starts a cooldown: it is a recorded non-action, and letting
    it suppress the next real decision would be wrong.
    """

    __slots__ = ("_cooldown_micros", "_last_emitted_micros")

    def __init__(self, *, cooldown_micros: int) -> None:
        if cooldown_micros < 0:
            raise ValueError("CooldownGate cooldown_micros must not be negative.")
        self._cooldown_micros = cooldown_micros
        self._last_emitted_micros: int | None = None

    @property
    def cooldown_micros(self) -> int:
        return self._cooldown_micros

    @property
    def last_emitted_micros(self) -> int | None:
        return self._last_emitted_micros

    def is_open(self, *, now_micros: int) -> bool:
        """Whether an actionable signal may be emitted now."""
        if self._cooldown_micros == 0 or self._last_emitted_micros is None:
            return True
        return now_micros - self._last_emitted_micros >= self._cooldown_micros

    def remaining_micros(self, *, now_micros: int) -> int:
        if self._last_emitted_micros is None:
            return 0
        remaining = self._cooldown_micros - (now_micros - self._last_emitted_micros)
        return remaining if remaining > 0 else 0

    def record_emission(self, *, now_micros: int) -> None:
        self._last_emitted_micros = now_micros

    def reset(self) -> None:
        self._last_emitted_micros = None
```

---

## FILE: libs/trading-core/wlct_trading/strategies/state.py

```py
"""Per-instance strategy identity and runtime state.

A "strategy instance" is one running copy of one strategy version, trading one
symbol, for one tenant, on one exchange, under one configuration version. That
five-part identity is what :class:`StrategyInstanceKey` captures, and it is
what guarantees isolation: two instances that differ in *any* component get
different keys, different state objects and different feature engines.

The state itself is intentionally boring - a typed key/value map with snapshot
and restore. Strategies that need richer structures build them on top; keeping
the persisted surface flat is what makes a snapshot comparable across restarts
and safe to store in Redis as hot state.

Nothing in this module performs I/O. Persistence is the host service's job: it
takes a :meth:`StrategyState.snapshot` and writes it wherever it belongs. The
hot path never blocks on a database.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any, Iterator, Mapping

from wlct_trading.enums import ExchangeId, MarketType

__all__ = [
    "StrategyInstanceKey",
    "StrategyState",
    "StrategyStateError",
    "StrategyStateStore",
]

#: The value types a strategy may keep in persisted state. Deliberately narrow:
#: everything here must survive a round trip through JSON or a Redis hash
#: without losing precision or type.
StateValue = str | int | bool | Decimal


class StrategyStateError(ValueError):
    """Raised when state is written or restored with an unusable value."""


@dataclass(slots=True, frozen=True)
class StrategyInstanceKey:
    """The five-part identity of one running strategy instance.

    ``instance_id`` is derived, not assigned: it is a deterministic hash of the
    five components, so the same logical instance gets the same id on every
    machine and across restarts. That makes it usable as a Redis key and as a
    correlation id in logs without a central allocator.
    """

    tenant_id: str
    strategy_key: str
    strategy_version: str
    exchange: ExchangeId
    symbol: str
    configuration_version: str = "1"
    market_type: MarketType = MarketType.SPOT

    def __post_init__(self) -> None:
        for name in (
            "tenant_id",
            "strategy_key",
            "strategy_version",
            "symbol",
            "configuration_version",
        ):
            value = getattr(self, name)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"StrategyInstanceKey.{name} must be a non-empty string.")

    @property
    def instance_id(self) -> str:
        """Stable 32-hex-character identity derived from the components."""
        digest = hashlib.sha256(self.fingerprint_source().encode("utf-8")).hexdigest()
        return digest[:32]

    def fingerprint_source(self) -> str:
        """The exact string that is hashed. Contains no secret material."""
        return "|".join(
            (
                self.tenant_id,
                self.strategy_key,
                self.strategy_version,
                self.exchange.value,
                self.market_type.value,
                self.symbol,
                self.configuration_version,
            )
        )

    @property
    def redis_namespace(self) -> str:
        """Namespace for this instance's hot state.

        Tenant first so that a tenant's keys can be enumerated, expired or
        audited as a unit, matching the convention used elsewhere in the
        platform.
        """
        return f"strategy:{self.tenant_id}:{self.instance_id}"

    def describe(self) -> str:
        return (
            f"{self.strategy_key}@{self.strategy_version} "
            f"{self.symbol} on {self.exchange.value} "
            f"(tenant={self.tenant_id}, config={self.configuration_version})"
        )

    def to_dict(self) -> dict[str, str]:
        return {
            "instanceId": self.instance_id,
            "tenantId": self.tenant_id,
            "strategyKey": self.strategy_key,
            "strategyVersion": self.strategy_version,
            "exchange": self.exchange.value,
            "marketType": self.market_type.value,
            "symbol": self.symbol,
            "configurationVersion": self.configuration_version,
        }


@dataclass(slots=True)
class StrategyState:
    """Isolated mutable state belonging to exactly one instance.

    Deterministic initialisation: a freshly constructed state, and a state that
    has been :meth:`reset`, are indistinguishable. That property is what makes
    a backtest reproducible after the engine has been reused.
    """

    key: StrategyInstanceKey
    _values: dict[str, StateValue] = field(default_factory=dict, init=False, repr=False)
    _version: int = field(default=0, init=False, repr=False)

    # -- access --------------------------------------------------------
    def get(self, name: str, default: StateValue | None = None) -> StateValue | None:
        return self._values.get(name, default)

    def get_decimal(self, name: str, default: Decimal | None = None) -> Decimal | None:
        value = self._values.get(name)
        if value is None:
            return default
        if isinstance(value, Decimal):
            return value
        if isinstance(value, bool):
            raise StrategyStateError(f"State {name!r} holds a boolean, not a decimal.")
        try:
            return Decimal(str(value))
        except InvalidOperation as exc:  # pragma: no cover - guarded by set()
            raise StrategyStateError(
                f"State {name!r} does not hold a decimal value."
            ) from exc

    def get_int(self, name: str, default: int = 0) -> int:
        value = self._values.get(name)
        if value is None:
            return default
        if isinstance(value, bool):
            raise StrategyStateError(f"State {name!r} holds a boolean, not an integer.")
        if isinstance(value, int):
            return value
        raise StrategyStateError(f"State {name!r} does not hold an integer value.")

    def get_bool(self, name: str, default: bool = False) -> bool:
        value = self._values.get(name)
        if value is None:
            return default
        if isinstance(value, bool):
            return value
        raise StrategyStateError(f"State {name!r} does not hold a boolean value.")

    def set(self, name: str, value: StateValue) -> None:
        """Write one value. Rejects unusable types and non-finite decimals."""
        if not name:
            raise StrategyStateError("State keys must be non-empty.")
        if isinstance(value, float):
            raise StrategyStateError(
                f"State {name!r}: floats are refused; use Decimal so precision "
                "survives persistence."
            )
        if isinstance(value, Decimal) and not value.is_finite():
            raise StrategyStateError(f"State {name!r}: refusing a non-finite Decimal.")
        if not isinstance(value, (str, int, bool, Decimal)):
            raise StrategyStateError(
                f"State {name!r}: unsupported type {type(value).__name__}."
            )
        self._values[name] = value
        self._version += 1

    def increment(self, name: str, amount: int = 1) -> int:
        current = self.get_int(name, 0)
        updated = current + amount
        self.set(name, updated)
        return updated

    def delete(self, name: str) -> None:
        if name in self._values:
            del self._values[name]
            self._version += 1

    def __contains__(self, name: object) -> bool:
        return name in self._values

    def __len__(self) -> int:
        return len(self._values)

    def __iter__(self) -> Iterator[str]:
        return iter(self._values)

    @property
    def version(self) -> int:
        """Monotonic write counter. Useful for detecting a no-op tick."""
        return self._version

    # -- lifecycle -----------------------------------------------------
    def reset(self) -> None:
        """Clear every value. The state returns to its initial condition."""
        self._values.clear()
        self._version = 0

    def snapshot(self) -> dict[str, str]:
        """Serialise to a flat string map.

        Strings throughout so the snapshot can be written to Redis, persisted
        as JSON, or embedded in an audit record with no further encoding. Type
        information is preserved by prefixing: ``d:`` decimal, ``i:`` integer,
        ``b:`` boolean, ``s:`` string.
        """
        out: dict[str, str] = {}
        for name, value in sorted(self._values.items()):
            if isinstance(value, bool):
                out[name] = f"b:{'1' if value else '0'}"
            elif isinstance(value, Decimal):
                out[name] = f"d:{value}"
            elif isinstance(value, int):
                out[name] = f"i:{value}"
            else:
                out[name] = f"s:{value}"
        return out

    def restore(self, snapshot: Mapping[str, str]) -> None:
        """Replace the current state with a previously taken snapshot.

        Restoring is all-or-nothing: the snapshot is decoded into a fresh dict
        first, so a corrupt entry leaves the existing state untouched rather
        than half-overwritten. A strategy resuming from partially applied state
        is exactly the corrupted-state case the failure policy exists to avoid.
        """
        decoded: dict[str, StateValue] = {}
        for name, encoded in snapshot.items():
            if not isinstance(encoded, str) or len(encoded) < 2 or encoded[1] != ":":
                raise StrategyStateError(
                    f"State snapshot entry {name!r} is not a tagged value."
                )
            tag, raw = encoded[0], encoded[2:]
            if tag == "d":
                try:
                    decimal_value = Decimal(raw)
                except InvalidOperation as exc:
                    raise StrategyStateError(
                        f"State snapshot entry {name!r} is not a valid decimal."
                    ) from exc
                if not decimal_value.is_finite():
                    raise StrategyStateError(
                        f"State snapshot entry {name!r} is not finite."
                    )
                # The finite check runs on the concrete Decimal before the
                # value widens back to StateValue; checking is_finite() on the
                # union would be a type error and an unconditional pass, not
                # a guard.
                value: StateValue = decimal_value
            elif tag == "i":
                try:
                    value = int(raw)
                except ValueError as exc:
                    raise StrategyStateError(
                        f"State snapshot entry {name!r} is not a valid integer."
                    ) from exc
            elif tag == "b":
                if raw not in ("0", "1"):
                    raise StrategyStateError(
                        f"State snapshot entry {name!r} is not a valid boolean."
                    )
                value = raw == "1"
            elif tag == "s":
                value = raw
            else:
                raise StrategyStateError(
                    f"State snapshot entry {name!r} has unknown tag {tag!r}."
                )
            decoded[name] = value

        self._values = decoded
        self._version += 1

    def as_dict(self) -> dict[str, Any]:
        """Plain copy for logging. Values are stringified."""
        return {name: str(value) for name, value in sorted(self._values.items())}


class StrategyStateStore:
    """In-memory registry of per-instance state.

    The isolation guarantee lives here: :meth:`for_instance` returns the state
    object belonging to one key and never shares an object between keys. There
    is no global namespace a strategy could reach into.
    """

    __slots__ = ("_states",)

    def __init__(self) -> None:
        self._states: dict[str, StrategyState] = {}

    def for_instance(self, key: StrategyInstanceKey) -> StrategyState:
        state = self._states.get(key.instance_id)
        if state is None:
            state = StrategyState(key=key)
            self._states[key.instance_id] = state
        return state

    def has(self, key: StrategyInstanceKey) -> bool:
        return key.instance_id in self._states

    def drop(self, key: StrategyInstanceKey) -> None:
        self._states.pop(key.instance_id, None)

    def reset_all(self) -> None:
        for state in self._states.values():
            state.reset()

    def clear(self) -> None:
        self._states.clear()

    @property
    def instance_count(self) -> int:
        return len(self._states)

    def snapshot_all(self) -> dict[str, dict[str, str]]:
        return {
            instance_id: state.snapshot()
            for instance_id, state in sorted(self._states.items())
        }
```

---

## FILE: libs/trading-core/wlct_trading/strategies/validation.py

```py
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
```

---

## FILE: libs/trading-core/wlct_trading/backtest/__init__.py

```py
"""Deterministic historical replay, simulated execution and backtest results.

This package answers one question honestly: *what would this strategy have
done over this data, under these stated execution assumptions?* It does not
answer what the strategy will earn, and nothing in it should be read as a
performance claim.

Layout::

    clock.py         SimulatedClock - the only source of time in a replay
    dataset.py       MarketEvent, HistoricalDataset, DatasetDescriptor
    replay.py        ReplayEngine - ordered, no-look-ahead event delivery
    simulator.py     SimulatedMatchingEngine - the one set of fill rules
    portfolio.py     SimulatedPortfolio - cash, exposure, costs, equity curve
    metrics.py       PerformanceMetrics computed from simulator output
    result.py        BacktestResult and the configuration hash
    walkforward.py   TRAINING/VALIDATION/TEST windowing (no optimisation)
    engine.py        BacktestEngine - wires all of the above together

Three warnings this package exists to make unavoidable:

* **BACKTEST PERFORMANCE IS NOT INDICATIVE OF FUTURE PERFORMANCE.**
* **PAPER PERFORMANCE IS NOT INDICATIVE OF LIVE PERFORMANCE.**
* **SIMULATION DOES NOT GUARANTEE REAL EXECUTION QUALITY.**

The simulator models neither queue position, market impact, venue rejections,
nor variable latency. Its fills are systematically optimistic. Treat a
favourable result as a reason to investigate, never as evidence of profit.
"""

from __future__ import annotations

from wlct_trading.backtest.clock import ClockError, SimulatedClock
from wlct_trading.backtest.dataset import (
    EVENT_KIND_ORDER,
    DatasetDescriptor,
    DatasetError,
    HistoricalDataset,
    MarketEvent,
    compute_dataset_checksum,
)
from wlct_trading.backtest.engine import BacktestConfig, BacktestEngine
from wlct_trading.backtest.metrics import (
    PerformanceMetrics,
    compute_performance,
    equity_returns,
)
from wlct_trading.backtest.portfolio import (
    ClosedTrade,
    EquityPoint,
    PortfolioError,
    SimulatedPortfolio,
)
from wlct_trading.backtest.replay import (
    LookAheadError,
    ReplayCursor,
    ReplayEngine,
    ReplayStats,
)
from wlct_trading.backtest.result import (
    BACKTEST_DISCLAIMER,
    BacktestResult,
    compute_configuration_hash,
    parameters_to_canonical,
)
from wlct_trading.backtest.simulator import (
    ExecutionAssumptions,
    SimulatedFillEvent,
    SimulatedIdFactory,
    SimulatedMatch,
    SimulatedMatchingEngine,
)
from wlct_trading.backtest.walkforward import (
    WalkForwardSplit,
    WalkForwardWindow,
    rolling_windows,
    split_dataset,
)

__all__ = [
    "BACKTEST_DISCLAIMER",
    "BacktestConfig",
    "BacktestEngine",
    "BacktestResult",
    "ClockError",
    "ClosedTrade",
    "compute_configuration_hash",
    "compute_dataset_checksum",
    "compute_performance",
    "DatasetDescriptor",
    "DatasetError",
    "EquityPoint",
    "equity_returns",
    "EVENT_KIND_ORDER",
    "ExecutionAssumptions",
    "HistoricalDataset",
    "LookAheadError",
    "MarketEvent",
    "parameters_to_canonical",
    "PerformanceMetrics",
    "PortfolioError",
    "ReplayCursor",
    "ReplayEngine",
    "ReplayStats",
    "rolling_windows",
    "SimulatedClock",
    "SimulatedFillEvent",
    "SimulatedIdFactory",
    "SimulatedMatch",
    "SimulatedMatchingEngine",
    "SimulatedPortfolio",
    "split_dataset",
    "WalkForwardSplit",
    "WalkForwardWindow",
]
```

---

## FILE: libs/trading-core/wlct_trading/backtest/clock.py

```py
"""The backtest clock.

A backtest must never read the wall clock. If it did, two runs over the same
data would differ, timestamps in the output would describe when the analysis
happened rather than when the market moved, and any strategy that consulted
"now" would behave differently on a fast machine.

:class:`SimulatedClock` is therefore the only notion of time inside a replay.
It is driven forward by the replay engine, one event at a time, and it refuses
to move backwards - a monotonicity guarantee that turns an out-of-order event
into an immediate, loud failure instead of a subtly wrong result.

The class deliberately exposes no ``sleep`` and no way to advance itself by a
duration chosen by a strategy. Time advances because an event happened.
"""

from __future__ import annotations

__all__ = ["SimulatedClock", "ClockError"]


class ClockError(RuntimeError):
    """Raised when time is asked to move in an impossible way."""


class SimulatedClock:
    """Monotonic, externally driven clock measured in epoch microseconds."""

    __slots__ = ("_now_micros", "_start_micros", "_advance_count")

    def __init__(self, start_micros: int) -> None:
        if start_micros < 0:
            raise ClockError("SimulatedClock cannot start before the epoch.")
        self._start_micros = start_micros
        self._now_micros = start_micros
        self._advance_count = 0

    # -- reading ---------------------------------------------------------
    def now_micros(self) -> int:
        """Current simulated time in microseconds since the epoch."""
        return self._now_micros

    def now_millis(self) -> int:
        return self._now_micros // 1_000

    @property
    def start_micros(self) -> int:
        return self._start_micros

    @property
    def elapsed_micros(self) -> int:
        return self._now_micros - self._start_micros

    @property
    def advance_count(self) -> int:
        """How many times the clock has been moved. Useful in assertions."""
        return self._advance_count

    # -- driving ----------------------------------------------------------
    def advance_to(self, timestamp_micros: int) -> None:
        """Move the clock to ``timestamp_micros``.

        Moving to the *same* instant is allowed - several events routinely
        share a timestamp - but moving backwards raises. A replay that tried to
        would be feeding events out of order, which is a bug in the data or in
        the sort, and continuing would silently produce look-ahead.
        """
        if timestamp_micros < self._now_micros:
            raise ClockError(
                f"SimulatedClock cannot move backwards: now={self._now_micros}, "
                f"requested={timestamp_micros}."
            )
        if timestamp_micros > self._now_micros:
            self._now_micros = timestamp_micros
        self._advance_count += 1

    def advance_by(self, delta_micros: int) -> None:
        """Move the clock forward by a non-negative duration."""
        if delta_micros < 0:
            raise ClockError("SimulatedClock cannot advance by a negative duration.")
        self._now_micros += delta_micros
        self._advance_count += 1

    def reset(self, start_micros: int | None = None) -> None:
        """Return to the start instant so the same clock can drive a new run."""
        if start_micros is not None:
            if start_micros < 0:
                raise ClockError("SimulatedClock cannot start before the epoch.")
            self._start_micros = start_micros
        self._now_micros = self._start_micros
        self._advance_count = 0

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return (
            f"SimulatedClock(now={self._now_micros}, start={self._start_micros}, "
            f"advances={self._advance_count})"
        )
```

---

## FILE: libs/trading-core/wlct_trading/backtest/dataset.py

```py
"""Historical datasets and their identification.

A backtest whose input cannot be identified is not reproducible, and a
non-reproducible backtest is an anecdote. Every run therefore records a
:class:`DatasetDescriptor`: what the data is, where it came from, the window it
covers, how many events it contains and a checksum over the events themselves.

The checksum is computed from the normalised events, not from a file on disk,
so it is stable across storage formats and catches the case that matters most -
somebody re-ran "the same backtest" against silently different data.

The events are the *same normalised types* the live feed produces
(:class:`~wlct_trading.market_data.Ticker`,
:class:`~wlct_trading.market_data.PublicTrade`,
:class:`~wlct_trading.market_data.OrderBookSnapshot`,
:class:`~wlct_trading.market_data.OrderBookDelta`,
:class:`~wlct_trading.market_data.Candle`). There is no parallel "backtest
event" hierarchy, which is what allows one strategy implementation to run
unchanged live, on paper and in replay.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Iterable, Iterator, Sequence

from wlct_trading.enums import ExchangeId, MarketEventKind, MarketType
from wlct_trading.market_data import (
    Candle,
    OrderBookDelta,
    OrderBookSnapshot,
    PublicTrade,
    Ticker,
)

__all__ = [
    "MarketEvent",
    "DatasetDescriptor",
    "HistoricalDataset",
    "DatasetError",
    "compute_dataset_checksum",
    "EVENT_KIND_ORDER",
]

#: Deterministic ordering for events sharing a timestamp.
#:
#: Book state must be applied before anything that reads it, and a snapshot
#: must precede the deltas that build on it. Trades come next because they
#: describe what already happened at that instant, and the ticker - a summary -
#: last. Without a fixed rule here, two runs over the same data could evaluate
#: a strategy against different book states.
EVENT_KIND_ORDER: dict[MarketEventKind, int] = {
    MarketEventKind.BOOK_SNAPSHOT: 0,
    MarketEventKind.BOOK_DELTA: 1,
    MarketEventKind.TRADE: 2,
    MarketEventKind.TICKER: 3,
    MarketEventKind.CANDLE: 4,
    MarketEventKind.TIMER: 5,
}

_PayloadType = Ticker | PublicTrade | OrderBookSnapshot | OrderBookDelta | Candle


class DatasetError(ValueError):
    """Raised when a dataset is malformed or internally inconsistent."""


@dataclass(slots=True, frozen=True)
class MarketEvent:
    """One historical market-data event with its ordering key.

    ``sequence`` is the tie-breaker of last resort: when two events share a
    timestamp *and* a kind, the lower sequence is replayed first. Datasets that
    carry a venue sequence number should use it; otherwise the loader assigns
    the source order, which keeps replay stable without inventing information.
    """

    kind: MarketEventKind
    timestamp_micros: int
    payload: _PayloadType
    sequence: int = 0

    def __post_init__(self) -> None:
        if self.timestamp_micros < 0:
            raise DatasetError("MarketEvent timestamp must not be negative.")
        expected = {
            MarketEventKind.TICKER: Ticker,
            MarketEventKind.TRADE: PublicTrade,
            MarketEventKind.BOOK_SNAPSHOT: OrderBookSnapshot,
            MarketEventKind.BOOK_DELTA: OrderBookDelta,
            MarketEventKind.CANDLE: Candle,
        }.get(self.kind)
        if expected is None:
            raise DatasetError(
                f"MarketEvent kind {self.kind.value} cannot appear in a dataset."
            )
        if not isinstance(self.payload, expected):
            raise DatasetError(
                f"MarketEvent of kind {self.kind.value} must carry a "
                f"{expected.__name__}, got {type(self.payload).__name__}."
            )

    @property
    def symbol(self) -> str:
        return self.payload.symbol

    @property
    def exchange(self) -> ExchangeId:
        return self.payload.exchange

    @property
    def ordering_key(self) -> tuple[int, int, int]:
        """``(timestamp, kind rank, sequence)`` - the total replay order."""
        return (
            self.timestamp_micros,
            EVENT_KIND_ORDER[self.kind],
            self.sequence,
        )

    def checksum_source(self) -> str:
        """Canonical string used for the dataset checksum.

        Includes only fields that change the meaning of the event. Local
        receive timestamps are excluded: they describe *our* capture, not the
        market, and including them would make two identical datasets captured
        on different days hash differently.
        """
        parts: list[str] = [
            self.kind.value,
            str(self.timestamp_micros),
            str(self.sequence),
            self.payload.exchange.value,
            self.payload.symbol,
        ]
        payload = self.payload
        if isinstance(payload, Ticker):
            parts += [
                _decimal(payload.bid_price),
                _decimal(payload.ask_price),
                _decimal(payload.last_price),
            ]
        elif isinstance(payload, PublicTrade):
            parts += [
                payload.trade_id,
                _decimal(payload.price),
                _decimal(payload.quantity),
                payload.aggressor_side.value,
            ]
        elif isinstance(payload, OrderBookSnapshot):
            parts += [str(payload.last_update_id), _levels(payload.bids), _levels(payload.asks)]
        elif isinstance(payload, OrderBookDelta):
            parts += [
                str(payload.first_update_id),
                str(payload.final_update_id),
                _levels(payload.bids),
                _levels(payload.asks),
            ]
        else:
            parts += [
                payload.interval,
                str(payload.open_time),
                str(payload.close_time),
                _decimal(payload.open),
                _decimal(payload.high),
                _decimal(payload.low),
                _decimal(payload.close),
                _decimal(payload.volume),
                str(payload.trade_count),
                "1" if payload.is_closed else "0",
            ]
        return "|".join(parts)


def _decimal(value: Decimal | None) -> str:
    return "-" if value is None else str(value)


def _levels(levels: tuple[object, ...]) -> str:
    return ",".join(
        f"{getattr(level, 'price')}:{getattr(level, 'quantity')}" for level in levels
    )


def compute_dataset_checksum(events: Iterable[MarketEvent]) -> str:
    """SHA-256 over the canonical form of every event, in replay order.

    Order is imposed here rather than assumed, so a dataset assembled in a
    different order but containing the same events hashes identically - which
    is the property that makes the checksum a statement about *content*.
    """
    digest = hashlib.sha256()
    for event in sorted(events, key=lambda item: item.ordering_key):
        digest.update(event.checksum_source().encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


@dataclass(slots=True, frozen=True)
class DatasetDescriptor:
    """Identifies the exact input of a backtest.

    ``dataset_id`` and ``source`` are the operator's labels: which capture,
    from where. ``checksum`` is computed from the events. A run whose
    descriptor lacks a checksum is flagged non-reproducible in the result.
    """

    dataset_id: str
    source: str
    exchange: ExchangeId
    symbol: str
    market_type: MarketType
    start_micros: int
    end_micros: int
    granularity: str
    event_count: int
    checksum: str | None = None
    notes: str = ""

    def __post_init__(self) -> None:
        if not self.dataset_id:
            raise DatasetError("DatasetDescriptor requires a dataset_id.")
        if not self.source:
            raise DatasetError("DatasetDescriptor requires a source.")
        if self.end_micros < self.start_micros:
            raise DatasetError("DatasetDescriptor end_micros precedes start_micros.")
        if self.event_count < 0:
            raise DatasetError("DatasetDescriptor event_count cannot be negative.")

    @property
    def is_reproducible(self) -> bool:
        """Whether this input can be identified well enough to re-run.

        Requires a checksum and at least one event. Anything else is a dataset
        somebody could change without the result noticing.
        """
        return bool(self.checksum) and self.event_count > 0

    @property
    def duration_micros(self) -> int:
        return self.end_micros - self.start_micros

    def canonical_form(self) -> tuple[tuple[str, str], ...]:
        """Deterministic key/value pairs for the configuration hash."""
        return (
            ("dataset_id", self.dataset_id),
            ("source", self.source),
            ("exchange", self.exchange.value),
            ("symbol", self.symbol),
            ("market_type", self.market_type.value),
            ("start_micros", str(self.start_micros)),
            ("end_micros", str(self.end_micros)),
            ("granularity", self.granularity),
            ("event_count", str(self.event_count)),
            ("checksum", self.checksum or "none"),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "datasetId": self.dataset_id,
            "source": self.source,
            "exchange": self.exchange.value,
            "symbol": self.symbol,
            "marketType": self.market_type.value,
            "startMicros": self.start_micros,
            "endMicros": self.end_micros,
            "granularity": self.granularity,
            "eventCount": self.event_count,
            "checksum": self.checksum,
            "isReproducible": self.is_reproducible,
            "notes": self.notes,
        }


@dataclass(slots=True, frozen=True)
class HistoricalDataset:
    """An ordered, self-describing set of historical events.

    Construct with :meth:`from_events`, which sorts, validates and checksums in
    one pass. The stored tuple is already in replay order, so the replay engine
    does no sorting of its own and cannot reorder anything.
    """

    descriptor: DatasetDescriptor
    events: tuple[MarketEvent, ...] = field(default_factory=tuple)

    def __len__(self) -> int:
        return len(self.events)

    def __iter__(self) -> Iterator[MarketEvent]:
        return iter(self.events)

    @property
    def symbol(self) -> str:
        return self.descriptor.symbol

    @property
    def exchange(self) -> ExchangeId:
        return self.descriptor.exchange

    def kinds_present(self) -> tuple[MarketEventKind, ...]:
        return tuple(sorted({event.kind for event in self.events}, key=lambda k: k.value))

    def slice(self, *, start_micros: int, end_micros: int) -> "HistoricalDataset":
        """A sub-window as its own dataset, re-checksummed.

        Used by walk-forward splitting. The slice gets its own descriptor and
        its own checksum so a training-window result can never be confused with
        a test-window result.
        """
        if end_micros < start_micros:
            raise DatasetError("slice end precedes start.")
        selected = tuple(
            event
            for event in self.events
            if start_micros <= event.timestamp_micros <= end_micros
        )
        checksum = compute_dataset_checksum(selected)
        descriptor = DatasetDescriptor(
            dataset_id=f"{self.descriptor.dataset_id}#{start_micros}-{end_micros}",
            source=self.descriptor.source,
            exchange=self.descriptor.exchange,
            symbol=self.descriptor.symbol,
            market_type=self.descriptor.market_type,
            start_micros=start_micros,
            end_micros=end_micros,
            granularity=self.descriptor.granularity,
            event_count=len(selected),
            checksum=checksum,
            notes=f"Slice of {self.descriptor.dataset_id}.",
        )
        return HistoricalDataset(descriptor=descriptor, events=selected)

    @classmethod
    def from_events(
        cls,
        events: Sequence[MarketEvent],
        *,
        dataset_id: str,
        source: str,
        granularity: str = "event",
        market_type: MarketType = MarketType.SPOT,
        notes: str = "",
    ) -> "HistoricalDataset":
        """Validate, order and checksum a sequence of events.

        Rejects an empty dataset, and rejects one mixing symbols or venues: a
        strategy instance trades exactly one symbol on one venue, so a mixed
        dataset is a loading mistake rather than a multi-symbol feature.
        """
        if not events:
            raise DatasetError("A dataset must contain at least one event.")

        symbols = {event.symbol for event in events}
        if len(symbols) != 1:
            raise DatasetError(
                f"A dataset must cover exactly one symbol; found {sorted(symbols)}."
            )
        exchanges = {event.exchange for event in events}
        if len(exchanges) != 1:
            raise DatasetError(
                "A dataset must cover exactly one exchange; found "
                f"{sorted(exchange.value for exchange in exchanges)}."
            )

        ordered = tuple(sorted(events, key=lambda item: item.ordering_key))
        checksum = compute_dataset_checksum(ordered)
        descriptor = DatasetDescriptor(
            dataset_id=dataset_id,
            source=source,
            exchange=ordered[0].exchange,
            symbol=ordered[0].symbol,
            market_type=market_type,
            start_micros=ordered[0].timestamp_micros,
            end_micros=ordered[-1].timestamp_micros,
            granularity=granularity,
            event_count=len(ordered),
            checksum=checksum,
            notes=notes,
        )
        return cls(descriptor=descriptor, events=ordered)
```

---

## FILE: libs/trading-core/wlct_trading/backtest/engine.py

```py
"""The backtest engine: replay, strategy, risk, simulation, portfolio.

This is the component that wires the Part 6 pieces into one deterministic run.
It reproduces the *production* path exactly - the same strategy engine, the
same signal validator, the same risk engine, the same position manager - and
substitutes only two things: a
:class:`~wlct_trading.backtest.replay.ReplayEngine` in place of the live feed,
and a :class:`~wlct_trading.backtest.simulator.SimulatedMatchingEngine` in
place of the venue.

Two boundaries are structural rather than advisory:

* **No live adapter exists here.** This module imports no adapter, holds no
  credential, opens no socket and has no configuration field that could point
  at one. A backtest cannot send an order because there is nothing to send it
  to.
* **The risk engine is not bypassed.** Every signal that passes validation is
  converted to an intent and put through :class:`~wlct_trading.risk.RiskEngine`
  before it can reach the simulator, in ``TradingMode.PAPER``. A rejected
  intent is counted and dropped. There is no branch that submits an unapproved
  intent.

Determinism is maintained by never consulting a wall clock, a random number
generator or a UUID on the result path. Timestamps come from the simulated
clock; ids come from a counter. Running the same dataset with the same
configuration twice produces two results whose
:meth:`~wlct_trading.backtest.result.BacktestResult.matches` comparison is
true, trade for trade and equity point for equity point.

BACKTEST PERFORMANCE IS NOT INDICATIVE OF FUTURE PERFORMANCE. Simulation does
not guarantee real execution quality.
"""

from __future__ import annotations

import hashlib
import logging
from collections import Counter, deque
from dataclasses import dataclass, field
from decimal import Decimal

from wlct_trading.backtest.clock import SimulatedClock
from wlct_trading.backtest.dataset import HistoricalDataset, MarketEvent
from wlct_trading.backtest.metrics import compute_performance
from wlct_trading.backtest.portfolio import SimulatedPortfolio
from wlct_trading.backtest.replay import ReplayCursor, ReplayEngine
from wlct_trading.backtest.result import (
    BacktestResult,
    compute_configuration_hash,
    parameters_to_canonical,
)
from wlct_trading.backtest.simulator import (
    ExecutionAssumptions,
    SimulatedIdFactory,
    SimulatedMatchingEngine,
)
from wlct_trading.clock import monotonic_nanos
from wlct_trading.enums import (
    BacktestPhase,
    TradingMode,
)
from wlct_trading.idempotency import build_client_order_id
from wlct_trading.market_data import BookTop, Candle, OrderBookDelta, OrderBookSnapshot, PublicTrade, Ticker
from wlct_trading.order_book import OrderBook
from wlct_trading.orders import Order
from wlct_trading.positions import Position
from wlct_trading.risk import KillSwitchState, RiskEngine, RiskLimits, RiskSnapshot
from wlct_trading.signals import Signal, signal_to_intent
from wlct_trading.strategies.base import Strategy
from wlct_trading.strategies.context import StrategyRiskView
from wlct_trading.strategies.lifecycle import (
    SignalOutcome,
    StrategyEngine,
    StrategyEngineConfig,
)
from wlct_trading.strategies.state import StrategyInstanceKey
from wlct_trading.strategies.validation import SignalValidationConfig

__all__ = ["BacktestConfig", "BacktestEngine"]

_LOG = logging.getLogger(__name__)
_ZERO = Decimal(0)
_ONE_MINUTE_MICROS = 60_000_000


@dataclass(slots=True, frozen=True)
class BacktestConfig:
    """Everything that defines a run other than the strategy and the data.

    ``risk_limits`` is required in effect: the risk engine fails closed when no
    layer expresses a limit, so a config without one produces a run in which
    every order is rejected. That is the correct default - a backtest that
    quietly ran without limits would not resemble production.
    """

    tenant_id: str
    account_id: str
    initial_capital: Decimal
    assumptions: ExecutionAssumptions = field(default_factory=ExecutionAssumptions)
    risk_limits: RiskLimits | None = None
    phase: BacktestPhase = BacktestPhase.TEST
    quote_asset: str = "USDT"
    base_asset: str = "BTC"
    #: Fires ``on_timer`` at fixed simulated intervals. ``None`` disables it.
    timer_interval_micros: int | None = None
    #: Equity is recorded on every event by default. Setting a positive value
    #: records at most one point per interval, which keeps the curve bounded on
    #: very long datasets at the cost of resolution.
    mark_interval_micros: int | None = None
    #: Passed to the Sharpe/Sortino calculation. ``None`` leaves the ratios
    #: unannualised, which is the honest default when the observation interval
    #: is "per market event" rather than a calendar period.
    periods_per_year: int | None = None
    validation: SignalValidationConfig | None = None
    engine_config: StrategyEngineConfig | None = None
    run_label: str = ""

    def __post_init__(self) -> None:
        if not self.tenant_id:
            raise ValueError("BacktestConfig requires a tenant_id.")
        if not self.account_id:
            raise ValueError("BacktestConfig requires an account_id.")
        if not isinstance(self.initial_capital, Decimal):
            raise TypeError("BacktestConfig.initial_capital must be a Decimal.")
        if self.initial_capital <= _ZERO:
            raise ValueError("BacktestConfig.initial_capital must be positive.")
        if self.timer_interval_micros is not None and self.timer_interval_micros <= 0:
            raise ValueError("timer_interval_micros must be positive when set.")
        if self.mark_interval_micros is not None and self.mark_interval_micros <= 0:
            raise ValueError("mark_interval_micros must be positive when set.")
        if self.periods_per_year is not None and self.periods_per_year <= 0:
            raise ValueError("periods_per_year must be positive when set.")


class BacktestEngine:
    """Runs one strategy over one dataset and produces one result."""

    __slots__ = (
        "_strategy",
        "_dataset",
        "_config",
        "_clock",
        "_replay",
        "_portfolio",
        "_simulator",
        "_strategy_engine",
        "_risk_engine",
        "_book",
        "_book_top",
        "_last_price",
        "_order_sequence",
        "_recent_order_times",
        "_open_orders",
        "_rejections",
        "_signals_generated",
        "_signals_accepted",
        "_signals_rejected",
        "_risk_rejections",
        "_simulated_orders",
        "_simulated_fills",
        "_last_mark_micros",
        "_has_run",
    )

    def __init__(
        self,
        *,
        strategy: Strategy,
        dataset: HistoricalDataset,
        config: BacktestConfig,
        risk_engine: RiskEngine | None = None,
    ) -> None:
        if strategy.symbol != dataset.symbol:
            raise ValueError(
                f"Strategy trades {strategy.symbol} but the dataset covers "
                f"{dataset.symbol}."
            )
        if strategy.descriptor.exchange is not dataset.exchange:
            raise ValueError(
                f"Strategy is configured for "
                f"{strategy.descriptor.exchange.value} but the dataset is from "
                f"{dataset.exchange.value}."
            )

        self._strategy = strategy
        self._dataset = dataset
        self._config = config

        start = dataset.descriptor.start_micros
        self._clock = SimulatedClock(start_micros=start)
        self._replay = ReplayEngine(
            dataset,
            clock=self._clock,
            timer_interval_micros=config.timer_interval_micros,
        )

        self._portfolio = SimulatedPortfolio(
            initial_cash=config.initial_capital,
            tenant_id=config.tenant_id,
            account_id=config.account_id,
            exchange=dataset.exchange,
            symbol=dataset.symbol,
            quote_asset=config.quote_asset,
            base_asset=config.base_asset,
        )
        self._simulator = SimulatedMatchingEngine(
            config.assumptions,
            id_factory=SimulatedIdFactory(prefix="sim", deterministic=True),
            exchange=dataset.exchange,
        )
        self._risk_engine = risk_engine or RiskEngine(config.risk_limits or RiskLimits())

        engine_config = config.engine_config or StrategyEngineConfig(
            validation=config.validation or SignalValidationConfig(),
        )
        self._strategy_engine = StrategyEngine(
            config=engine_config,
            position_provider=self._provide_position,
            open_orders_provider=self._provide_open_orders,
            risk_view_provider=self._provide_risk_view,
            kill_switch_provider=KillSwitchState,
            freshness_provider=self._provide_freshness,
        )
        self._strategy_engine.add(strategy)

        self._book = OrderBook(dataset.exchange, dataset.symbol)
        self._book_top: BookTop | None = None
        self._last_price: Decimal | None = None
        self._order_sequence = 0
        self._recent_order_times: deque[int] = deque()
        self._open_orders: dict[str, Order] = {}
        self._rejections: Counter[str] = Counter()
        self._signals_generated = 0
        self._signals_accepted = 0
        self._signals_rejected = 0
        self._risk_rejections = 0
        self._simulated_orders = 0
        self._simulated_fills = 0
        self._last_mark_micros: int | None = None
        self._has_run = False

    # -- inspection -----------------------------------------------------------
    @property
    def portfolio(self) -> SimulatedPortfolio:
        return self._portfolio

    @property
    def clock(self) -> SimulatedClock:
        return self._clock

    @property
    def strategy_engine(self) -> StrategyEngine:
        return self._strategy_engine

    @property
    def simulator(self) -> SimulatedMatchingEngine:
        return self._simulator

    @property
    def is_simulated(self) -> bool:
        """Always ``True``. There is no live path through this class."""
        return True

    # -- providers for the strategy engine -------------------------------------
    def _provide_position(self, _key: StrategyInstanceKey) -> Position | None:
        return self._portfolio.position

    def _provide_open_orders(self, _key: StrategyInstanceKey) -> tuple[Order, ...]:
        return tuple(self._open_orders.values())

    def _provide_risk_view(self, _key: StrategyInstanceKey) -> StrategyRiskView:
        """Read-only risk view. Never authorises anything.

        Marked available because in a backtest the exposure state is known
        exactly - it is held in this process. The live host passes
        ``is_available=False`` when Redis cannot be read, and the validator then
        refuses every actionable signal.
        """
        limits = self._config.risk_limits or RiskLimits()
        quantity = self._portfolio.base_quantity
        mark = self._last_price or _ZERO
        return StrategyRiskView(
            is_available=True,
            max_position_quantity=limits.max_position_quantity,
            max_order_quantity=limits.max_order_quantity,
            current_position_quantity=quantity,
            symbol_exposure_notional=abs(quantity) * mark,
            account_exposure_notional=abs(quantity) * mark,
            open_order_count=len(self._open_orders),
            realised_pnl_today=self._portfolio.realised_pnl,
        )

    def _provide_freshness(self, _key: StrategyInstanceKey) -> tuple[bool, int | None]:
        """Market data age in simulated time.

        Historical data is by definition not fresh in wall-clock terms, so the
        age is computed against the replay clock. Reporting the true wall-clock
        age would make the validator reject every signal and the backtest would
        produce nothing.
        """
        if self._book_top is None:
            return (False, None)
        age = self._clock.now_micros() - self._book_top.exchange_timestamp
        return (age >= 0, max(age, 0))

    # -- the run ---------------------------------------------------------------
    def run(self) -> BacktestResult:
        """Replay the dataset once and produce a result.

        A single engine runs once. Re-running would compound state onto an
        already-traded portfolio, which is a mistake rather than a feature; a
        second run means a second engine.
        """
        if self._has_run:
            raise RuntimeError(
                "This BacktestEngine has already run. Construct a new one for a "
                "second run so that state cannot leak between them."
            )
        self._has_run = True

        wall_started = monotonic_nanos()
        start_micros = self._dataset.descriptor.start_micros
        self._strategy_engine.start_all(now_micros=start_micros)

        stats = self._replay.run(
            on_event=self._on_event,
            on_timer=self._on_timer if self._config.timer_interval_micros else None,
        )

        end_micros = self._clock.now_micros()
        # Final mark so the equity curve ends at the last observed price rather
        # than at whatever the last recorded point happened to be.
        self._portfolio.mark_to_market(
            timestamp_micros=end_micros, mark_price=self._last_price
        )
        self._strategy_engine.stop_all(now_micros=end_micros)

        wall_elapsed_micros = (monotonic_nanos() - wall_started) // 1_000
        return self._build_result(
            events_replayed=stats.events_replayed,
            wall_clock_duration_micros=wall_elapsed_micros,
        )

    # -- event handling ---------------------------------------------------------
    def _on_timer(self, now_micros: int) -> None:
        for outcome in self._strategy_engine.dispatch_timer(now_micros):
            self._handle_outcome(outcome, now_micros)

    def _on_event(self, event: MarketEvent, cursor: ReplayCursor) -> None:
        now = self._clock.now_micros()
        # Guards against a future read even if a dataset were mis-sorted.
        cursor.assert_not_future(event.timestamp_micros)

        payload = event.payload
        outcomes: tuple[SignalOutcome, ...] = ()

        if isinstance(payload, OrderBookSnapshot):
            self._book.apply_snapshot(payload)
            self._refresh_book(now)
            if self._book_top is not None:
                outcomes = self._strategy_engine.dispatch_book_top(self._book_top)
        elif isinstance(payload, OrderBookDelta):
            result = self._book.apply_delta(payload)
            if not result.applied:
                # A gap in historical data is not something to trade through.
                self._strategy_engine.invalidate_symbol(self._dataset.symbol)
                self._book_top = None
                return
            self._refresh_book(now)
            if self._book_top is not None:
                outcomes = self._strategy_engine.dispatch_book_top(self._book_top)
        elif isinstance(payload, Ticker):
            if payload.last_price is not None:
                self._last_price = payload.last_price
            outcomes = self._strategy_engine.dispatch_ticker(payload)
        elif isinstance(payload, PublicTrade):
            self._last_price = payload.price
            outcomes = self._strategy_engine.dispatch_trade(payload)
        elif isinstance(payload, Candle):
            self._last_price = payload.close
            outcomes = self._strategy_engine.dispatch_candle(payload)

        for outcome in outcomes:
            self._handle_outcome(outcome, now)

        self._maybe_mark(now)

    def _refresh_book(self, now_micros: int) -> None:
        """Publish the new top of book and match resting orders against it."""
        if not self._book.is_usable:
            self._book_top = None
            return
        top = self._book.top()
        self._book_top = top
        mid = top.mid_price
        if mid is not None:
            self._last_price = mid

        for fill_event in self._simulator.on_book_update(top, now_micros=now_micros):
            self._simulated_fills += 1
            self._strategy_engine.metrics.counters.simulated_fills += 1
            self._portfolio.apply_fill(
                fill_event.fill, slippage_cost=fill_event.slippage_cost
            )
            if fill_event.status.name == "FILLED":
                self._open_orders.pop(fill_event.client_order_id, None)

    def _maybe_mark(self, now_micros: int) -> None:
        interval = self._config.mark_interval_micros
        if interval is None:
            self._portfolio.mark_to_market(
                timestamp_micros=now_micros, mark_price=self._last_price
            )
            self._last_mark_micros = now_micros
            return
        if (
            self._last_mark_micros is None
            or now_micros - self._last_mark_micros >= interval
        ):
            self._portfolio.mark_to_market(
                timestamp_micros=now_micros, mark_price=self._last_price
            )
            self._last_mark_micros = now_micros

    # -- signal handling ---------------------------------------------------------
    def _handle_outcome(self, outcome: SignalOutcome, now_micros: int) -> None:
        self._signals_generated += 1
        if not outcome.accepted:
            self._signals_rejected += 1
            self._rejections[outcome.rejection_code.value] += 1
            return
        self._signals_accepted += 1
        self._route(outcome.signal, now_micros)

    def _route(self, signal: Signal, now_micros: int) -> None:
        """Signal -> intent -> risk -> simulator. No step is skippable."""
        intent = signal_to_intent(
            signal,
            account_id=self._config.account_id,
            current_position_quantity=self._portfolio.base_quantity,
        )
        if intent is None:
            return

        # Deterministic idempotency key: the client order id is derived from
        # the intent's fields including created_at, so it must come from the
        # simulated clock rather than the wall clock.
        intent.created_at = now_micros
        client_order_id = build_client_order_id(intent)
        intent.client_order_id = client_order_id

        decision = self._risk_engine.evaluate(
            intent,
            snapshot=self._risk_snapshot(now_micros),
            kill_switches=KillSwitchState(),
            # PAPER, always. A backtest has no live mode to select.
            trading_mode=TradingMode.PAPER,
            book_top=self._book_top,
            strategy_enabled=True,
        )
        if not decision.approved or not decision.would_route:
            self._risk_rejections += 1
            self._strategy_engine.metrics.counters.risk_rejections += 1
            self._rejections[f"RISK_{decision.code.value}"] += 1
            return

        self._order_sequence += 1
        order_id = f"sim-order-{self._order_sequence:012d}"
        match = self._simulator.submit(
            intent,
            client_order_id=client_order_id,
            order_id=order_id,
            book=self._book_top,
            now_micros=now_micros,
        )
        self._simulated_orders += 1
        self._strategy_engine.metrics.counters.simulated_orders += 1
        self._recent_order_times.append(now_micros)

        if not match.accepted:
            self._strategy_engine.metrics.counters.simulated_orders_rejected += 1
            self._rejections[f"SIMULATOR_{match.reason or 'REJECTED'}"] += 1
            return

        order = Order.from_intent(
            intent,
            client_order_id=client_order_id,
            order_id=order_id,
            is_simulated=True,
        )
        if match.rests:
            self._open_orders[client_order_id] = order

        for fill in match.fills:
            self._simulated_fills += 1
            self._strategy_engine.metrics.counters.simulated_fills += 1
            self._portfolio.apply_fill(fill, slippage_cost=match.slippage_cost)

    def _risk_snapshot(self, now_micros: int) -> RiskSnapshot:
        """Exposure state assembled from the simulated portfolio.

        In production this comes from Redis hot state; here it is exact,
        because the only positions that exist are the ones this engine created.
        """
        while (
            self._recent_order_times
            and now_micros - self._recent_order_times[0] > _ONE_MINUTE_MICROS
        ):
            self._recent_order_times.popleft()

        quantity = self._portfolio.base_quantity
        reference = self._last_price
        exposure = abs(quantity) * (reference or _ZERO)
        age: int | None = None
        if self._book_top is not None:
            age = max(now_micros - self._book_top.exchange_timestamp, 0)

        return RiskSnapshot(
            position_quantity=quantity,
            symbol_exposure_notional=exposure,
            account_exposure_notional=exposure,
            open_order_count=len(self._open_orders),
            orders_in_last_minute=len(self._recent_order_times),
            realised_pnl_today=self._portfolio.realised_pnl,
            strategy_realised_pnl_today=self._portfolio.realised_pnl,
            reference_price=reference,
            market_data_age_micros=age,
            book_usable=self._book_top is not None,
            is_complete=True,
        )

    # -- result assembly ------------------------------------------------------------
    def _build_result(
        self, *, events_replayed: int, wall_clock_duration_micros: int
    ) -> BacktestResult:
        parameters = parameters_to_canonical(self._strategy.parameters)
        configuration_hash = compute_configuration_hash(
            strategy_key=self._strategy.strategy_key,
            strategy_version=self._strategy.strategy_version,
            implementation_id=type(self._strategy).implementation_id(),
            parameters=parameters,
            assumptions=self._config.assumptions,
            dataset=self._dataset.descriptor,
            initial_capital=self._config.initial_capital,
        )
        run_id = self._derive_run_id(configuration_hash)

        metrics = compute_performance(
            initial_capital=self._config.initial_capital,
            final_equity=self._portfolio.final_equity,
            realised_pnl=self._portfolio.realised_pnl,
            unrealised_pnl=self._portfolio.unrealised_pnl,
            fees=self._portfolio.fees_paid,
            slippage_cost=self._portfolio.slippage_cost,
            turnover=self._portfolio.turnover,
            closed_trades=self._portfolio.closed_trades,
            equity_curve=self._portfolio.equity_curve,
            exposure_fraction=self._portfolio.exposure_fraction,
            periods_per_year=self._config.periods_per_year,
        )

        instance = self._strategy_engine.instances()[0]
        counters = self._strategy_engine.metrics.counters

        result = BacktestResult(
            run_id=run_id,
            strategy_key=self._strategy.strategy_key,
            strategy_version=self._strategy.strategy_version,
            implementation_id=type(self._strategy).implementation_id(),
            tenant_id=self._config.tenant_id,
            exchange=self._dataset.exchange,
            symbol=self._dataset.symbol,
            phase=self._config.phase,
            started_at_micros=self._dataset.descriptor.start_micros,
            ended_at_micros=self._clock.now_micros(),
            initial_capital=self._config.initial_capital,
            configuration_hash=configuration_hash,
            parameters=parameters,
            assumptions=self._config.assumptions,
            dataset=self._dataset.descriptor,
            metrics=metrics,
            closed_trades=self._portfolio.closed_trades,
            equity_curve=self._portfolio.equity_curve,
            signals_generated=self._signals_generated,
            signals_accepted=self._signals_accepted,
            signals_rejected=self._signals_rejected,
            risk_rejections=self._risk_rejections,
            simulated_orders=self._simulated_orders,
            simulated_fills=self._simulated_fills,
            events_replayed=events_replayed,
            strategy_errors=instance.error_count,
            wall_clock_duration_micros=wall_clock_duration_micros,
            rejection_counts=tuple(sorted(self._rejections.items())),
        )
        counters.backtests_completed += 1
        counters.replay_events += events_replayed
        _LOG.info(
            "backtest complete run_id=%s strategy=%s@%s symbol=%s events=%d "
            "orders=%d fills=%d simulated=True",
            run_id,
            self._strategy.strategy_key,
            self._strategy.strategy_version,
            self._dataset.symbol,
            events_replayed,
            self._simulated_orders,
            self._simulated_fills,
        )
        return result

    def _derive_run_id(self, configuration_hash: str) -> str:
        """Deterministic run id.

        Derived from the configuration hash and an optional label rather than
        from a UUID, so that re-running an identical experiment produces an
        identical id and the two results can be compared directly.
        """
        digest = hashlib.sha256()
        digest.update(configuration_hash.encode("utf-8"))
        digest.update(b"|")
        digest.update(self._config.run_label.encode("utf-8"))
        return f"bt-{digest.hexdigest()[:24]}"
```

---

## FILE: libs/trading-core/wlct_trading/backtest/metrics.py

```py
"""Performance metrics computed from simulated portfolio state.

Every figure here is derived from the equity curve and the closed trades that
the :class:`~wlct_trading.backtest.portfolio.SimulatedPortfolio` recorded. None
of them is estimated, annualised by default, or computed from anything other
than what the simulator actually did.

Assumptions, stated rather than buried:

* **Returns are simple, per equity observation.** One observation is recorded
  per marked event, so "per period" means "per marked event", not per day. Any
  annualisation is the caller's explicit choice via ``periods_per_year``.
* **Wins are measured net of the closing fee.** A trade that was profitable
  before costs and unprofitable after is a loss.
* **Risk-adjusted ratios are withheld below 20 observations.** Two data points
  can be made to produce any Sharpe ratio at all; reporting one would be
  arithmetic without information. Those fields are ``None`` and
  :attr:`PerformanceMetrics.has_sufficient_observations` says why.
* **Drawdown is a property of the observed path**, not a forecast.

Nothing here is a claim about future performance. A positive result is a
statement about one historical sample under one set of execution assumptions,
and nothing more.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Sequence

from wlct_trading.backtest.portfolio import ClosedTrade, EquityPoint
from wlct_trading.strategies.features.rolling import safe_ratio
from wlct_trading.strategies.features.statistics import (
    MIN_RISK_METRIC_OBSERVATIONS,
    max_drawdown,
    profit_factor,
    sharpe_ratio,
    sortino_ratio,
)

__all__ = ["PerformanceMetrics", "compute_performance", "equity_returns"]

_ZERO = Decimal(0)
_HUNDRED = Decimal(100)


def equity_returns(equity_curve: Sequence[EquityPoint]) -> tuple[Decimal, ...]:
    """Per-observation simple returns of the equity curve.

    An observation whose predecessor was zero or negative equity is skipped
    rather than producing an undefined or absurd return.
    """
    returns: list[Decimal] = []
    previous: Decimal | None = None
    for point in equity_curve:
        if previous is not None and previous > _ZERO:
            change = safe_ratio(point.equity - previous, previous)
            if change is not None:
                returns.append(change)
        previous = point.equity
    return tuple(returns)


@dataclass(slots=True, frozen=True)
class PerformanceMetrics:
    """The complete metric set for one simulated run.

    Fields that could not be computed are ``None``. That is a deliberate choice
    over defaulting to zero: a strategy that never traded has no win rate, and
    reporting ``0%`` would look like a hundred losses.
    """

    initial_capital: Decimal
    final_equity: Decimal
    total_return: Decimal | None
    realised_pnl: Decimal
    unrealised_pnl: Decimal | None
    net_pnl: Decimal
    gross_profit: Decimal
    gross_loss: Decimal
    fees: Decimal
    slippage_cost: Decimal
    turnover: Decimal

    trade_count: int
    winning_trades: int
    losing_trades: int
    breakeven_trades: int
    win_rate: Decimal | None
    average_trade: Decimal | None
    average_win: Decimal | None
    average_loss: Decimal | None
    largest_win: Decimal | None
    largest_loss: Decimal | None
    profit_factor: Decimal | None

    max_drawdown: Decimal
    max_drawdown_fraction: Decimal | None
    exposure_fraction: Decimal | None

    observation_count: int
    sharpe_ratio: Decimal | None
    sortino_ratio: Decimal | None
    min_observations_for_ratios: int = MIN_RISK_METRIC_OBSERVATIONS

    @property
    def has_sufficient_observations(self) -> bool:
        """Whether the risk-adjusted ratios were computed at all."""
        return self.observation_count >= self.min_observations_for_ratios

    @property
    def total_return_percent(self) -> Decimal | None:
        if self.total_return is None:
            return None
        return self.total_return * _HUNDRED

    def to_dict(self) -> dict[str, object]:
        def d(value: Decimal | None) -> str | None:
            return str(value) if value is not None else None

        return {
            "initialCapital": str(self.initial_capital),
            "finalEquity": str(self.final_equity),
            "totalReturn": d(self.total_return),
            "totalReturnPercent": d(self.total_return_percent),
            "realisedPnl": str(self.realised_pnl),
            "unrealisedPnl": d(self.unrealised_pnl),
            "netPnl": str(self.net_pnl),
            "grossProfit": str(self.gross_profit),
            "grossLoss": str(self.gross_loss),
            "fees": str(self.fees),
            "slippageCost": str(self.slippage_cost),
            "turnover": str(self.turnover),
            "tradeCount": self.trade_count,
            "winningTrades": self.winning_trades,
            "losingTrades": self.losing_trades,
            "breakevenTrades": self.breakeven_trades,
            "winRate": d(self.win_rate),
            "averageTrade": d(self.average_trade),
            "averageWin": d(self.average_win),
            "averageLoss": d(self.average_loss),
            "largestWin": d(self.largest_win),
            "largestLoss": d(self.largest_loss),
            "profitFactor": d(self.profit_factor),
            "maxDrawdown": str(self.max_drawdown),
            "maxDrawdownFraction": d(self.max_drawdown_fraction),
            "exposureFraction": d(self.exposure_fraction),
            "observationCount": self.observation_count,
            "sharpeRatio": d(self.sharpe_ratio),
            "sortinoRatio": d(self.sortino_ratio),
            "hasSufficientObservations": self.has_sufficient_observations,
            "minObservationsForRatios": self.min_observations_for_ratios,
            "disclaimer": (
                "Simulated results derived from historical data under stated "
                "execution assumptions. Backtest performance is not indicative "
                "of future performance and does not guarantee live execution "
                "quality."
            ),
        }


def compute_performance(
    *,
    initial_capital: Decimal,
    final_equity: Decimal,
    realised_pnl: Decimal,
    unrealised_pnl: Decimal | None,
    fees: Decimal,
    slippage_cost: Decimal,
    turnover: Decimal,
    closed_trades: Sequence[ClosedTrade],
    equity_curve: Sequence[EquityPoint],
    exposure_fraction: Decimal | None,
    periods_per_year: int | None = None,
    min_observations_for_ratios: int = MIN_RISK_METRIC_OBSERVATIONS,
) -> PerformanceMetrics:
    """Compute the full metric set. Pure function of simulator output."""
    wins = [trade for trade in closed_trades if trade.net_pnl > _ZERO]
    losses = [trade for trade in closed_trades if trade.net_pnl < _ZERO]
    breakeven = [trade for trade in closed_trades if trade.net_pnl == _ZERO]

    gross_profit = sum((trade.net_pnl for trade in wins), _ZERO)
    gross_loss = sum((trade.net_pnl for trade in losses), _ZERO)
    trade_count = len(closed_trades)

    total_pnl_from_trades = sum((trade.net_pnl for trade in closed_trades), _ZERO)

    returns = equity_returns(equity_curve)
    equity_values = [point.equity for point in equity_curve]
    drawdown_absolute, drawdown_fraction = max_drawdown(equity_values)

    return PerformanceMetrics(
        initial_capital=initial_capital,
        final_equity=final_equity,
        total_return=safe_ratio(final_equity - initial_capital, initial_capital),
        realised_pnl=realised_pnl,
        unrealised_pnl=unrealised_pnl,
        net_pnl=realised_pnl - fees,
        gross_profit=gross_profit,
        gross_loss=gross_loss,
        fees=fees,
        slippage_cost=slippage_cost,
        turnover=turnover,
        trade_count=trade_count,
        winning_trades=len(wins),
        losing_trades=len(losses),
        breakeven_trades=len(breakeven),
        win_rate=(
            safe_ratio(Decimal(len(wins)), Decimal(trade_count))
            if trade_count > 0
            else None
        ),
        average_trade=(
            safe_ratio(total_pnl_from_trades, Decimal(trade_count))
            if trade_count > 0
            else None
        ),
        average_win=(
            safe_ratio(gross_profit, Decimal(len(wins))) if wins else None
        ),
        average_loss=(
            safe_ratio(gross_loss, Decimal(len(losses))) if losses else None
        ),
        largest_win=max((trade.net_pnl for trade in wins), default=None),
        largest_loss=min((trade.net_pnl for trade in losses), default=None),
        profit_factor=profit_factor(gross_profit, gross_loss),
        max_drawdown=drawdown_absolute,
        max_drawdown_fraction=drawdown_fraction,
        exposure_fraction=exposure_fraction,
        observation_count=len(returns),
        sharpe_ratio=sharpe_ratio(
            returns,
            periods_per_year=periods_per_year,
            min_observations=min_observations_for_ratios,
        ),
        sortino_ratio=sortino_ratio(
            returns,
            periods_per_year=periods_per_year,
            min_observations=min_observations_for_ratios,
        ),
        min_observations_for_ratios=min_observations_for_ratios,
    )
```

---

## FILE: libs/trading-core/wlct_trading/backtest/portfolio.py

```py
"""The simulated portfolio.

Every number this class reports is derived from simulated fills. There is no
method that sets an equity, a PnL or a trade count directly, and no path that
produces a performance figure without a fill behind it. That is the whole
design: performance statistics are a *consequence* of the simulated execution,
never an independent calculation of what the strategy "should" have made.

Position and realised-PnL accounting is delegated to the existing
:class:`~wlct_trading.positions.PositionManager` - the same weighted-average
implementation used on the live path - rather than reimplemented here. Two
accounting engines would eventually disagree, and the paper numbers would stop
being evidence about the live path.

What this class adds on top of the position manager is the cash side: balance,
reserved margin for resting orders, fees, slippage cost, the equity curve and
drawdown. All of it is labelled simulated, and
:attr:`SimulatedPortfolio.is_simulated` is a constant ``True``.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from wlct_trading.enums import ExchangeId, OrderSide, PositionSide
from wlct_trading.orders import Fill
from wlct_trading.positions import Position, PositionManager, PositionUpdate

__all__ = [
    "PortfolioError",
    "ClosedTrade",
    "EquityPoint",
    "SimulatedPortfolio",
]

_ZERO = Decimal(0)


class PortfolioError(ValueError):
    """Raised when the portfolio is asked to do something incoherent."""


@dataclass(slots=True, frozen=True)
class EquityPoint:
    """One observation of account equity, in simulated time."""

    timestamp_micros: int
    equity: Decimal
    cash: Decimal
    position_quantity: Decimal
    mark_price: Decimal | None

    def to_dict(self) -> dict[str, object]:
        return {
            "timestampMicros": self.timestamp_micros,
            "equity": str(self.equity),
            "cash": str(self.cash),
            "positionQuantity": str(self.position_quantity),
            "markPrice": str(self.mark_price) if self.mark_price is not None else None,
            "isSimulated": True,
        }


@dataclass(slots=True, frozen=True)
class ClosedTrade:
    """A round trip: exposure opened and later reduced or closed.

    One :class:`ClosedTrade` is recorded per *reducing* fill, not per position.
    A position built with three fills and closed with one produces one closed
    trade; a position closed in three fills produces three. That is the
    convention the trade statistics use, and it is stated here because the
    alternative convention would give different win-rate numbers from the same
    data.
    """

    symbol: str
    direction: PositionSide
    quantity: Decimal
    entry_price: Decimal
    exit_price: Decimal
    realised_pnl: Decimal
    fee: Decimal
    opened_at_micros: int | None
    closed_at_micros: int
    is_simulated: bool = True

    @property
    def net_pnl(self) -> Decimal:
        """Realised PnL after the fee charged on the closing fill."""
        return self.realised_pnl - self.fee

    @property
    def is_win(self) -> bool:
        """Wins are measured net of fees. A trade that only made money before
        costs did not make money."""
        return self.net_pnl > _ZERO

    def to_dict(self) -> dict[str, object]:
        return {
            "symbol": self.symbol,
            "direction": self.direction.value,
            "quantity": str(self.quantity),
            "entryPrice": str(self.entry_price),
            "exitPrice": str(self.exit_price),
            "realisedPnl": str(self.realised_pnl),
            "fee": str(self.fee),
            "netPnl": str(self.net_pnl),
            "openedAtMicros": self.opened_at_micros,
            "closedAtMicros": self.closed_at_micros,
            "isSimulated": True,
        }


class SimulatedPortfolio:
    """Cash, exposure, costs and the equity curve for one simulated account."""

    __slots__ = (
        "_initial_cash",
        "_cash",
        "_reserved",
        "_quote_asset",
        "_base_asset",
        "_tenant_id",
        "_account_id",
        "_exchange",
        "_symbol",
        "_positions",
        "_fees_paid",
        "_slippage_cost",
        "_fill_count",
        "_buy_quantity",
        "_sell_quantity",
        "_turnover",
        "_closed_trades",
        "_equity_curve",
        "_peak_equity",
        "_max_drawdown",
        "_max_drawdown_fraction",
        "_exposed_observations",
        "_total_observations",
    )

    def __init__(
        self,
        *,
        initial_cash: Decimal,
        tenant_id: str,
        account_id: str,
        exchange: ExchangeId,
        symbol: str,
        quote_asset: str = "USDT",
        base_asset: str = "BTC",
    ) -> None:
        if not isinstance(initial_cash, Decimal):
            raise PortfolioError("initial_cash must be a Decimal.")
        if initial_cash <= _ZERO:
            raise PortfolioError("initial_cash must be positive.")

        self._initial_cash = initial_cash
        self._cash = initial_cash
        self._reserved = _ZERO
        self._quote_asset = quote_asset
        self._base_asset = base_asset
        self._tenant_id = tenant_id
        self._account_id = account_id
        self._exchange = exchange
        self._symbol = symbol
        self._positions = PositionManager()
        self._fees_paid = _ZERO
        self._slippage_cost = _ZERO
        self._fill_count = 0
        self._buy_quantity = _ZERO
        self._sell_quantity = _ZERO
        self._turnover = _ZERO
        self._closed_trades: list[ClosedTrade] = []
        self._equity_curve: list[EquityPoint] = []
        self._peak_equity = initial_cash
        self._max_drawdown = _ZERO
        self._max_drawdown_fraction: Decimal | None = None
        self._exposed_observations = 0
        self._total_observations = 0

    # -- identity ----------------------------------------------------------
    @property
    def is_simulated(self) -> bool:
        """Always ``True``. Every figure here derives from simulated fills."""
        return True

    @property
    def symbol(self) -> str:
        return self._symbol

    @property
    def exchange(self) -> ExchangeId:
        return self._exchange

    @property
    def positions(self) -> PositionManager:
        return self._positions

    # -- balances -----------------------------------------------------------
    @property
    def initial_cash(self) -> Decimal:
        return self._initial_cash

    @property
    def cash(self) -> Decimal:
        return self._cash

    @property
    def reserved(self) -> Decimal:
        return self._reserved

    @property
    def available_cash(self) -> Decimal:
        return self._cash - self._reserved

    @property
    def base_quantity(self) -> Decimal:
        position = self.position
        return position.quantity if position is not None else _ZERO

    @property
    def position(self) -> Position | None:
        return self._positions.get(self._account_id, self._exchange, self._symbol)

    # -- costs ---------------------------------------------------------------
    @property
    def fees_paid(self) -> Decimal:
        return self._fees_paid

    @property
    def slippage_cost(self) -> Decimal:
        return self._slippage_cost

    @property
    def fill_count(self) -> int:
        return self._fill_count

    @property
    def turnover(self) -> Decimal:
        """Total traded notional, both directions."""
        return self._turnover

    # -- PnL -------------------------------------------------------------------
    @property
    def realised_pnl(self) -> Decimal:
        position = self.position
        return position.realised_pnl if position is not None else _ZERO

    @property
    def unrealised_pnl(self) -> Decimal | None:
        """``None`` when flat or when no mark price is available.

        Deliberately not zero: "no mark" and "break even" are different facts
        and collapsing them would misreport risk.
        """
        position = self.position
        if position is None:
            return None
        return position.unrealised_pnl

    @property
    def net_pnl(self) -> Decimal:
        """Realised PnL less fees. Excludes unrealised by construction.

        A net figure that silently included an unrealised mark would change
        whenever the last price moved, which is not what "net PnL" should mean
        in a trade report.
        """
        return self.realised_pnl - self._fees_paid

    def equity(self, mark_price: Decimal | None) -> Decimal:
        """Cash plus the marked value of the position.

        With no mark price the position is valued at its cost basis rather than
        dropped, so equity does not jump when a mark becomes unavailable. The
        equity point records that the mark was absent.
        """
        position = self.position
        if position is None or position.is_flat:
            return self._cash
        if mark_price is not None:
            return self._cash + position.quantity * mark_price
        if position.average_entry_price is not None:
            return self._cash + position.quantity * position.average_entry_price
        return self._cash

    # -- mutation ---------------------------------------------------------------
    def reserve(self, amount: Decimal) -> None:
        """Set aside cash for a resting order."""
        if amount < _ZERO:
            raise PortfolioError("Cannot reserve a negative amount.")
        self._reserved += amount

    def release(self, amount: Decimal) -> None:
        """Release previously reserved cash. Clamped at zero."""
        if amount < _ZERO:
            raise PortfolioError("Cannot release a negative amount.")
        self._reserved = self._reserved - amount
        if self._reserved < _ZERO:
            self._reserved = _ZERO

    def apply_fill(
        self, fill: Fill, *, slippage_cost: Decimal = _ZERO
    ) -> PositionUpdate:
        """Apply one simulated fill to cash, position and cost tallies.

        Refuses a fill that is not marked simulated. A real fill reaching a
        simulated portfolio would mean the two paths had been crossed
        somewhere, and continuing would produce a report mixing real and
        imaginary money.
        """
        if not fill.is_simulated:
            raise PortfolioError(
                "SimulatedPortfolio refuses a fill that is not marked simulated."
            )
        if fill.side is None:
            raise PortfolioError("A simulated fill must carry its side.")
        if fill.symbol is not None and fill.symbol != self._symbol:
            raise PortfolioError(
                f"Fill is for {fill.symbol} but this portfolio holds "
                f"{self._symbol}."
            )

        position_before = self.position
        entry_before = (
            position_before.average_entry_price if position_before is not None else None
        )
        opened_at = position_before.opened_at if position_before is not None else None

        notional = fill.price * fill.quantity
        if fill.side is OrderSide.BUY:
            self._cash -= notional + fill.fee
            self._buy_quantity += fill.quantity
        else:
            self._cash += notional - fill.fee
            self._sell_quantity += fill.quantity

        self._fees_paid += fill.fee
        self._slippage_cost += slippage_cost
        self._turnover += notional
        self._fill_count += 1

        update = self._positions.apply_fill(
            self._tenant_id,
            self._account_id,
            self._exchange,
            self._symbol,
            fill.side,
            fill,
        )

        reduced = (
            entry_before is not None
            and update.previous_quantity != _ZERO
            and (
                abs(update.new_quantity) < abs(update.previous_quantity)
                or update.flipped
                or update.closed
            )
        )
        if reduced and entry_before is not None:
            # Recorded on any exposure-reducing fill, including one that
            # realises exactly zero: a flat round trip still cost the fees, and
            # omitting it would quietly improve the win rate.
            direction = (
                PositionSide.LONG if update.previous_quantity > _ZERO else PositionSide.SHORT
            )
            closed_quantity = abs(update.previous_quantity) - abs(update.new_quantity)
            if closed_quantity < _ZERO:
                closed_quantity = abs(update.previous_quantity)
            self._closed_trades.append(
                ClosedTrade(
                    symbol=self._symbol,
                    direction=direction,
                    quantity=closed_quantity,
                    entry_price=entry_before,
                    exit_price=fill.price,
                    realised_pnl=update.realised_delta,
                    fee=fill.fee,
                    opened_at_micros=opened_at,
                    closed_at_micros=fill.exchange_timestamp,
                )
            )

        return update

    def mark_to_market(
        self, *, timestamp_micros: int, mark_price: Decimal | None
    ) -> EquityPoint:
        """Record one equity observation and update the drawdown tallies."""
        if mark_price is not None:
            self._positions.set_mark_price(
                self._account_id, self._exchange, self._symbol, mark_price
            )
        equity = self.equity(mark_price)
        position_quantity = self.base_quantity

        point = EquityPoint(
            timestamp_micros=timestamp_micros,
            equity=equity,
            cash=self._cash,
            position_quantity=position_quantity,
            mark_price=mark_price,
        )
        self._equity_curve.append(point)

        self._total_observations += 1
        if position_quantity != _ZERO:
            self._exposed_observations += 1

        if equity > self._peak_equity:
            self._peak_equity = equity
        decline = self._peak_equity - equity
        if decline > self._max_drawdown:
            self._max_drawdown = decline
            self._max_drawdown_fraction = (
                decline / self._peak_equity if self._peak_equity > _ZERO else None
            )

        return point

    # -- reporting ---------------------------------------------------------------
    @property
    def equity_curve(self) -> tuple[EquityPoint, ...]:
        return tuple(self._equity_curve)

    @property
    def equity_values(self) -> tuple[Decimal, ...]:
        return tuple(point.equity for point in self._equity_curve)

    @property
    def closed_trades(self) -> tuple[ClosedTrade, ...]:
        return tuple(self._closed_trades)

    @property
    def peak_equity(self) -> Decimal:
        return self._peak_equity

    @property
    def max_drawdown(self) -> Decimal:
        return self._max_drawdown

    @property
    def max_drawdown_fraction(self) -> Decimal | None:
        return self._max_drawdown_fraction

    @property
    def final_equity(self) -> Decimal:
        if self._equity_curve:
            return self._equity_curve[-1].equity
        return self._cash

    @property
    def exposure_fraction(self) -> Decimal | None:
        """Share of observations during which a position was held.

        ``None`` before any observation exists - a fraction of nothing is not
        zero exposure, it is an unanswered question.
        """
        if self._total_observations == 0:
            return None
        return Decimal(self._exposed_observations) / Decimal(self._total_observations)

    def to_dict(self) -> dict[str, object]:
        unrealised = self.unrealised_pnl
        return {
            "isSimulated": True,
            "quoteAsset": self._quote_asset,
            "baseAsset": self._base_asset,
            "initialCash": str(self._initial_cash),
            "cash": str(self._cash),
            "reserved": str(self._reserved),
            "positionQuantity": str(self.base_quantity),
            "realisedPnl": str(self.realised_pnl),
            "unrealisedPnl": str(unrealised) if unrealised is not None else None,
            "netPnl": str(self.net_pnl),
            "feesPaid": str(self._fees_paid),
            "slippageCost": str(self._slippage_cost),
            "turnover": str(self._turnover),
            "fillCount": self._fill_count,
            "closedTradeCount": len(self._closed_trades),
            "finalEquity": str(self.final_equity),
            "peakEquity": str(self._peak_equity),
            "maxDrawdown": str(self._max_drawdown),
            "maxDrawdownFraction": (
                str(self._max_drawdown_fraction)
                if self._max_drawdown_fraction is not None
                else None
            ),
            "exposureFraction": (
                str(self.exposure_fraction)
                if self.exposure_fraction is not None
                else None
            ),
        }
```

---

## FILE: libs/trading-core/wlct_trading/backtest/replay.py

```py
"""Deterministic historical replay with a structural no-look-ahead guarantee.

The engine walks a :class:`~wlct_trading.backtest.dataset.HistoricalDataset` in
total order, advancing a :class:`~wlct_trading.backtest.clock.SimulatedClock`
to each event's timestamp before handing the event to the consumer.

**No look-ahead is enforced by construction, not by discipline.** The consumer
is handed one event at a time and a :class:`ReplayCursor` that can only see
what has already been replayed. There is no method anywhere on the cursor that
returns a future event, and :meth:`ReplayCursor.history` is filtered against
the clock, so even a consumer holding a reference to the engine cannot read
ahead. The remaining events live in a private tuple with a private index.

Determinism comes from three properties:

* the dataset is pre-sorted by ``(timestamp, kind rank, sequence)``;
* the clock is the only source of time and is driven by the events;
* nothing in the loop consults a random number generator, a wall clock, a
  network or a filesystem.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Iterator

from wlct_trading.backtest.clock import SimulatedClock
from wlct_trading.backtest.dataset import HistoricalDataset, MarketEvent
from wlct_trading.enums import MarketEventKind

__all__ = ["ReplayCursor", "ReplayEngine", "LookAheadError", "ReplayStats"]


class LookAheadError(RuntimeError):
    """Raised when something asks for data the replay has not reached."""


@dataclass(slots=True, frozen=True)
class ReplayStats:
    """What a completed replay did."""

    events_replayed: int
    timer_ticks: int
    first_timestamp_micros: int | None
    last_timestamp_micros: int | None

    def to_dict(self) -> dict[str, object]:
        return {
            "eventsReplayed": self.events_replayed,
            "timerTicks": self.timer_ticks,
            "firstTimestampMicros": self.first_timestamp_micros,
            "lastTimestampMicros": self.last_timestamp_micros,
        }


class ReplayCursor:
    """The past-only view a consumer is allowed to hold.

    Everything here is bounded by the clock. ``history`` returns events already
    replayed, and it filters on the clock rather than on an internal index, so
    it stays correct even if a caller keeps the cursor after the replay has
    finished.
    """

    __slots__ = ("_clock", "_seen", "_history_limit")

    def __init__(self, clock: SimulatedClock, *, history_limit: int = 1_000) -> None:
        if history_limit < 0:
            raise ValueError("history_limit must not be negative.")
        self._clock = clock
        self._seen: list[MarketEvent] = []
        self._history_limit = history_limit

    def _record(self, event: MarketEvent) -> None:
        self._seen.append(event)
        if self._history_limit and len(self._seen) > self._history_limit:
            # Bounded memory: a replay of ten million events must not retain
            # ten million objects just so a consumer *could* look back.
            del self._seen[0 : len(self._seen) - self._history_limit]

    @property
    def now_micros(self) -> int:
        return self._clock.now_micros()

    @property
    def observed_count(self) -> int:
        return len(self._seen)

    def latest(self, kind: MarketEventKind | None = None) -> MarketEvent | None:
        """Most recent event at or before now, optionally filtered by kind."""
        now = self._clock.now_micros()
        for event in reversed(self._seen):
            if event.timestamp_micros > now:
                continue
            if kind is None or event.kind is kind:
                return event
        return None

    def history(self, *, kind: MarketEventKind | None = None) -> tuple[MarketEvent, ...]:
        """Every retained event at or before now.

        The clock filter is the guard: an event cannot appear here before the
        replay has advanced to it, so no consumer can see the future through
        this method.
        """
        now = self._clock.now_micros()
        return tuple(
            event
            for event in self._seen
            if event.timestamp_micros <= now
            and (kind is None or event.kind is kind)
        )

    def assert_not_future(self, timestamp_micros: int) -> None:
        """Raise if ``timestamp_micros`` is beyond the replay's current instant."""
        now = self._clock.now_micros()
        if timestamp_micros > now:
            raise LookAheadError(
                f"Attempted to read data at {timestamp_micros} while the replay "
                f"clock stands at {now}. Look-ahead is not permitted."
            )


class ReplayEngine:
    """Walks a dataset in order, driving the clock and a consumer callback."""

    __slots__ = (
        "_dataset",
        "_clock",
        "_cursor",
        "_index",
        "_timer_interval_micros",
        "_next_timer_micros",
        "_timer_ticks",
        "_finished",
    )

    def __init__(
        self,
        dataset: HistoricalDataset,
        *,
        clock: SimulatedClock | None = None,
        timer_interval_micros: int | None = None,
        history_limit: int = 1_000,
    ) -> None:
        if len(dataset) == 0:
            raise ValueError("ReplayEngine requires a non-empty dataset.")
        if timer_interval_micros is not None and timer_interval_micros <= 0:
            raise ValueError("timer_interval_micros must be positive when set.")

        self._dataset = dataset
        start = dataset.events[0].timestamp_micros
        self._clock = clock or SimulatedClock(start_micros=start)
        if self._clock.now_micros() > start:
            raise ValueError(
                "The supplied clock is already past the dataset's first event; "
                "reset it before replaying."
            )
        self._cursor = ReplayCursor(self._clock, history_limit=history_limit)
        self._index = 0
        self._timer_interval_micros = timer_interval_micros
        self._next_timer_micros = (
            start + timer_interval_micros if timer_interval_micros else None
        )
        self._timer_ticks = 0
        self._finished = False

    # -- inspection --------------------------------------------------------
    @property
    def dataset(self) -> HistoricalDataset:
        return self._dataset

    @property
    def clock(self) -> SimulatedClock:
        return self._clock

    @property
    def cursor(self) -> ReplayCursor:
        return self._cursor

    @property
    def is_finished(self) -> bool:
        return self._finished

    @property
    def events_replayed(self) -> int:
        return self._index

    @property
    def remaining(self) -> int:
        return len(self._dataset) - self._index

    # -- driving -----------------------------------------------------------
    def events(self) -> Iterator[MarketEvent]:
        """Yield events in order, advancing the clock before each is seen.

        A generator rather than a callback so a caller can interleave its own
        work. The clock is advanced *before* the event is yielded, so a
        consumer reading ``clock.now_micros()`` sees the event's own instant.
        """
        while self._index < len(self._dataset):
            event = self._dataset.events[self._index]
            self._index += 1
            self._clock.advance_to(event.timestamp_micros)
            self._cursor._record(event)
            yield event
        self._finished = True

    def run(
        self,
        *,
        on_event: Callable[[MarketEvent, ReplayCursor], None],
        on_timer: Callable[[int], None] | None = None,
    ) -> ReplayStats:
        """Replay everything, calling ``on_event`` for each event in order.

        When a timer interval is configured, ``on_timer`` fires for every
        interval boundary crossed *before* the event that crossed it, so a
        strategy's timed logic runs at the right simulated instant rather than
        after the fact. Timer ticks never move the clock past the next event.
        """
        first: int | None = None
        last: int | None = None

        for event in self.events():
            if first is None:
                first = event.timestamp_micros
            last = event.timestamp_micros

            if (
                on_timer is not None
                and self._timer_interval_micros is not None
                and self._next_timer_micros is not None
            ):
                while self._next_timer_micros <= event.timestamp_micros:
                    on_timer(self._next_timer_micros)
                    self._timer_ticks += 1
                    self._next_timer_micros += self._timer_interval_micros

            on_event(event, self._cursor)

        return ReplayStats(
            events_replayed=self._index,
            timer_ticks=self._timer_ticks,
            first_timestamp_micros=first,
            last_timestamp_micros=last,
        )

    def reset(self) -> None:
        """Rewind to the beginning so the identical run can be repeated.

        Used by the reproducibility test: two runs from a reset engine over the
        same dataset must produce byte-identical results.
        """
        start = self._dataset.events[0].timestamp_micros
        self._clock.reset(start)
        self._cursor = ReplayCursor(self._clock)
        self._index = 0
        self._timer_ticks = 0
        self._next_timer_micros = (
            start + self._timer_interval_micros if self._timer_interval_micros else None
        )
        self._finished = False
```

---

## FILE: libs/trading-core/wlct_trading/backtest/result.py

```py
"""The normalised backtest result and its configuration hash.

A result is only useful if somebody can reproduce it. That requires knowing
four things exactly: which implementation ran, with which parameters, under
which execution assumptions, over which data. :func:`compute_configuration_hash`
folds all four into one hex digest, and :class:`BacktestResult` records the
components alongside it so an operator can see *why* two hashes differ rather
than only that they do.

The hash never includes a secret. Strategy parameters are validated by
:class:`~wlct_trading.strategies.parameters.ParameterSchema`, which refuses
credential-shaped names outright, and nothing else fed into the hash comes from
a credential store.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Mapping, Sequence

from wlct_trading.backtest.dataset import DatasetDescriptor
from wlct_trading.backtest.metrics import PerformanceMetrics
from wlct_trading.backtest.portfolio import ClosedTrade, EquityPoint
from wlct_trading.backtest.simulator import ExecutionAssumptions
from wlct_trading.enums import BacktestPhase, ExchangeId

__all__ = [
    "BACKTEST_DISCLAIMER",
    "compute_configuration_hash",
    "BacktestResult",
]

#: Attached to every result. Not decoration - a backtest number shown without
#: this context invites exactly the wrong conclusion.
BACKTEST_DISCLAIMER = (
    "Simulated result. Backtest performance is not indicative of future "
    "performance, does not account for every real-world cost or constraint, "
    "and does not guarantee live execution quality. No profitability claim is "
    "made for any strategy in this system."
)

_ZERO = Decimal(0)


def compute_configuration_hash(
    *,
    strategy_key: str,
    strategy_version: str,
    implementation_id: str,
    parameters: Sequence[tuple[str, str]],
    assumptions: ExecutionAssumptions,
    dataset: DatasetDescriptor,
    initial_capital: Decimal,
) -> str:
    """Deterministic SHA-256 over everything that defines a run.

    Inputs are canonicalised before hashing - parameters sorted by name,
    decimals stringified exactly, enums by wire value - so the digest depends
    on the configuration and on nothing else. Two runs with the same digest
    used the same code, the same settings and the same data.
    """
    digest = hashlib.sha256()
    fields: list[tuple[str, str]] = [
        ("strategy_key", strategy_key),
        ("strategy_version", strategy_version),
        ("implementation_id", implementation_id),
        ("initial_capital", str(initial_capital)),
    ]
    fields.extend(("param." + name, value) for name, value in parameters)
    fields.extend(("assumption." + name, value) for name, value in assumptions.canonical_form())
    fields.extend(("dataset." + name, value) for name, value in dataset.canonical_form())

    for name, value in fields:
        digest.update(name.encode("utf-8"))
        digest.update(b"=")
        digest.update(value.encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


@dataclass(slots=True, frozen=True)
class BacktestResult:
    """Everything one backtest produced, in a form that can be persisted.

    ``is_reproducible`` is not cosmetic: a run over a dataset with no checksum
    cannot be re-verified, and the flag says so rather than letting the numbers
    imply a rigour they do not have.
    """

    run_id: str
    strategy_key: str
    strategy_version: str
    implementation_id: str
    tenant_id: str
    exchange: ExchangeId
    symbol: str
    phase: BacktestPhase
    started_at_micros: int
    ended_at_micros: int
    initial_capital: Decimal
    configuration_hash: str
    parameters: tuple[tuple[str, str], ...]
    assumptions: ExecutionAssumptions
    dataset: DatasetDescriptor
    metrics: PerformanceMetrics
    closed_trades: tuple[ClosedTrade, ...] = field(default_factory=tuple)
    equity_curve: tuple[EquityPoint, ...] = field(default_factory=tuple)
    signals_generated: int = 0
    signals_accepted: int = 0
    signals_rejected: int = 0
    risk_rejections: int = 0
    simulated_orders: int = 0
    simulated_fills: int = 0
    events_replayed: int = 0
    strategy_errors: int = 0
    wall_clock_duration_micros: int = 0
    #: Rejection reasons, counted. Lets an operator see that a run produced no
    #: trades because risk refused everything rather than because the strategy
    #: was silent.
    rejection_counts: tuple[tuple[str, int], ...] = field(default_factory=tuple)

    @property
    def is_simulated(self) -> bool:
        """Always ``True``. This object can only describe a simulation."""
        return True

    @property
    def is_reproducible(self) -> bool:
        return self.dataset.is_reproducible and bool(self.configuration_hash)

    @property
    def duration_micros(self) -> int:
        return self.ended_at_micros - self.started_at_micros

    @property
    def final_equity(self) -> Decimal:
        return self.metrics.final_equity

    @property
    def net_pnl(self) -> Decimal:
        return self.metrics.net_pnl

    def matches(self, other: "BacktestResult") -> bool:
        """Whether two runs were the same experiment with the same outcome.

        Used by the reproducibility test. Compares the configuration hash, the
        headline figures and the trade-by-trade record - identical inputs must
        produce an identical record, not merely a similar summary.
        """
        return (
            self.configuration_hash == other.configuration_hash
            and self.metrics.final_equity == other.metrics.final_equity
            and self.metrics.net_pnl == other.metrics.net_pnl
            and self.metrics.trade_count == other.metrics.trade_count
            and self.metrics.max_drawdown == other.metrics.max_drawdown
            and [trade.to_dict() for trade in self.closed_trades]
            == [trade.to_dict() for trade in other.closed_trades]
            and [point.to_dict() for point in self.equity_curve]
            == [point.to_dict() for point in other.equity_curve]
        )

    def to_dict(self, *, include_curve: bool = False) -> dict[str, object]:
        payload: dict[str, object] = {
            "runId": self.run_id,
            "isSimulated": True,
            "strategyKey": self.strategy_key,
            "strategyVersion": self.strategy_version,
            "implementationId": self.implementation_id,
            "tenantId": self.tenant_id,
            "exchange": self.exchange.value,
            "symbol": self.symbol,
            "phase": self.phase.value,
            "startedAtMicros": self.started_at_micros,
            "endedAtMicros": self.ended_at_micros,
            "durationMicros": self.duration_micros,
            "initialCapital": str(self.initial_capital),
            "configurationHash": self.configuration_hash,
            "parameters": {name: value for name, value in self.parameters},
            "assumptions": self.assumptions.to_dict(),
            "dataset": self.dataset.to_dict(),
            "metrics": self.metrics.to_dict(),
            "signalsGenerated": self.signals_generated,
            "signalsAccepted": self.signals_accepted,
            "signalsRejected": self.signals_rejected,
            "riskRejections": self.risk_rejections,
            "simulatedOrders": self.simulated_orders,
            "simulatedFills": self.simulated_fills,
            "eventsReplayed": self.events_replayed,
            "strategyErrors": self.strategy_errors,
            "rejectionCounts": {name: count for name, count in self.rejection_counts},
            "closedTrades": [trade.to_dict() for trade in self.closed_trades],
            "isReproducible": self.is_reproducible,
            "disclaimer": BACKTEST_DISCLAIMER,
        }
        if include_curve:
            payload["equityCurve"] = [point.to_dict() for point in self.equity_curve]
        return payload

    def operational_dict(self) -> dict[str, object]:
        """The result plus measurements of *this process*, not of the market.

        ``wallClockDurationMicros`` is deliberately absent from
        :meth:`to_dict`: it changes between two otherwise identical runs, and
        including it would break a byte-comparison of two reproductions. It is
        still worth recording, so it lives here.
        """
        payload = self.to_dict()
        payload["wallClockDurationMicros"] = self.wall_clock_duration_micros
        return payload

    def summary_lines(self) -> list[str]:
        """Operator-readable summary. Always ends with the disclaimer."""
        metrics = self.metrics
        return [
            f"Backtest {self.run_id} [SIMULATED]",
            f"  strategy        {self.strategy_key}@{self.strategy_version}",
            f"  implementation  {self.implementation_id}",
            f"  symbol          {self.symbol} on {self.exchange.value}",
            f"  dataset         {self.dataset.dataset_id} "
            f"({self.dataset.event_count} events, "
            f"checksum {self.dataset.checksum[:12] if self.dataset.checksum else 'none'})",
            f"  config hash     {self.configuration_hash[:16]}",
            f"  initial capital {self.initial_capital}",
            f"  final equity    {metrics.final_equity}",
            f"  net PnL         {metrics.net_pnl} (fees {metrics.fees}, "
            f"slippage {metrics.slippage_cost})",
            f"  trades          {metrics.trade_count} "
            f"(win {metrics.winning_trades} / loss {metrics.losing_trades})",
            f"  max drawdown    {metrics.max_drawdown}",
            f"  sharpe          "
            f"{metrics.sharpe_ratio if metrics.sharpe_ratio is not None else 'n/a (insufficient observations)'}",
            f"  reproducible    {self.is_reproducible}",
            f"  {BACKTEST_DISCLAIMER}",
        ]


def parameters_to_canonical(parameters: Mapping[str, object]) -> tuple[tuple[str, str], ...]:
    """Sorted ``(name, str(value))`` pairs. Shared by the engine and the hash."""
    return tuple(
        (name, "null" if parameters[name] is None else str(parameters[name]))
        for name in sorted(parameters)
    )
```

---

## FILE: libs/trading-core/wlct_trading/backtest/simulator.py

```py
"""The simulated matching engine: the single implementation of "how a
simulated order fills".

There is exactly one set of fill rules in this project and it lives here. The
Part 2 :class:`~wlct_trading.adapters.paper.PaperTradingAdapter` delegates to
this engine rather than carrying a second copy, so a fill produced during a
backtest and a fill produced during live-data paper trading come from the same
code.

Honesty rules, enforced structurally:

* Every :class:`~wlct_trading.orders.Fill` this engine produces has
  ``is_simulated=True``. There is no code path that can clear that flag, and it
  is carried into the position manager, the database and the API.
* Fills are only ever produced against an **observed** price. If no usable book
  is supplied the order rests unfilled; the engine never invents a price.
* Fees and slippage are explicit inputs, recorded per fill, and never netted
  away into the fill price silently.

**This simulator does not reproduce a real exchange.** It has no queue model,
no order-book impact, no partial-fill microstructure beyond the displayed size
cap, no venue-side latency variance and no rejection modelling. Results
obtained here are an upper bound on execution quality, usually an optimistic
one. Nothing about a simulated result implies a live result.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from decimal import Decimal

from wlct_trading.enums import (
    ExchangeId,
    LimitFillRule,
    MarketFillPriceModel,
    OrderSide,
    OrderStatus,
    OrderType,
)
from wlct_trading.market_data import BookTop
from wlct_trading.orders import Fill, OrderIntent

__all__ = [
    "ExecutionAssumptions",
    "SimulatedMatch",
    "SimulatedFillEvent",
    "SimulatedIdFactory",
    "SimulatedMatchingEngine",
]

_ZERO = Decimal(0)
_ONE = Decimal(1)
_BPS = Decimal(10_000)


@dataclass(slots=True, frozen=True)
class ExecutionAssumptions:
    """Every assumption the simulator makes, in one hashable object.

    This object is part of the backtest configuration hash. Two runs that
    differ in any field here are different experiments and will not be
    confused with one another.

    Fees are **rates**, not basis points, to match the venue convention used
    elsewhere in the project: ``0.001`` is ten basis points. Slippage is in
    basis points because that is how execution desks discuss it, and mixing the
    two units in one object with clear names is less error-prone than picking
    one and forcing awkward numbers.
    """

    maker_fee_rate: Decimal = Decimal("0.001")
    taker_fee_rate: Decimal = Decimal("0.001")
    slippage_bps: Decimal = _ZERO
    fee_currency: str = "USDT"
    #: Simulated delay between submission and the order becoming executable.
    #: A non-zero value means an order cannot fill against the book that was
    #: current when it was sent - which is the single most flattering
    #: assumption a naive backtest makes.
    latency_micros: int = 0
    allow_partial_fills: bool = True
    #: Fills are capped by the displayed size at the touch. Turning this off
    #: assumes unlimited depth and will overstate achievable size.
    cap_by_displayed_size: bool = True
    #: Fills smaller than this are not produced at all; the remainder rests.
    min_fill_quantity: Decimal = _ZERO
    market_price_model: MarketFillPriceModel = MarketFillPriceModel.TOUCH
    limit_fill_rule: LimitFillRule = LimitFillRule.TOUCH_OR_BETTER

    def __post_init__(self) -> None:
        for name in ("maker_fee_rate", "taker_fee_rate", "slippage_bps"):
            value = getattr(self, name)
            if not isinstance(value, Decimal):
                raise TypeError(f"ExecutionAssumptions.{name} must be a Decimal.")
            if not value.is_finite() or value < _ZERO:
                raise ValueError(
                    f"ExecutionAssumptions.{name} must be finite and non-negative."
                )
        if self.maker_fee_rate > _ONE or self.taker_fee_rate > _ONE:
            raise ValueError("Fee rates are rates, not percentages; 0.001 is 10 bps.")
        if self.latency_micros < 0:
            raise ValueError("ExecutionAssumptions.latency_micros must not be negative.")
        if self.min_fill_quantity < _ZERO:
            raise ValueError(
                "ExecutionAssumptions.min_fill_quantity must not be negative."
            )
        if not self.fee_currency:
            raise ValueError("ExecutionAssumptions.fee_currency is required.")

    def canonical_form(self) -> tuple[tuple[str, str], ...]:
        """Deterministic key/value pairs for the configuration hash."""
        return (
            ("maker_fee_rate", str(self.maker_fee_rate)),
            ("taker_fee_rate", str(self.taker_fee_rate)),
            ("slippage_bps", str(self.slippage_bps)),
            ("fee_currency", self.fee_currency),
            ("latency_micros", str(self.latency_micros)),
            ("allow_partial_fills", "1" if self.allow_partial_fills else "0"),
            ("cap_by_displayed_size", "1" if self.cap_by_displayed_size else "0"),
            ("min_fill_quantity", str(self.min_fill_quantity)),
            ("market_price_model", self.market_price_model.value),
            ("limit_fill_rule", self.limit_fill_rule.value),
        )

    def to_dict(self) -> dict[str, object]:
        return {name: value for name, value in self.canonical_form()}


@dataclass(slots=True, frozen=True)
class SimulatedMatch:
    """Outcome of submitting one order to the simulator."""

    accepted: bool
    status: OrderStatus
    fills: tuple[Fill, ...] = field(default_factory=tuple)
    rests: bool = False
    reason: str | None = None
    slippage_cost: Decimal = _ZERO

    @property
    def filled_quantity(self) -> Decimal:
        return sum((fill.quantity for fill in self.fills), _ZERO)

    @property
    def is_simulated(self) -> bool:
        """Always true. Kept as a property so callers can assert on it."""
        return True


@dataclass(slots=True, frozen=True)
class SimulatedFillEvent:
    """A fill produced later, when a resting order became executable."""

    order_id: str
    client_order_id: str
    fill: Fill
    status: OrderStatus
    slippage_cost: Decimal = _ZERO


class SimulatedIdFactory:
    """Deterministic id source.

    A backtest that used ``uuid4`` would produce different fill ids on every
    run and could never be byte-compared. This factory emits a monotonically
    numbered sequence from a fixed prefix, so the same replay produces the same
    ids. The paper adapter, which has no reproducibility requirement, keeps
    using random ids by passing ``deterministic=False``.
    """

    __slots__ = ("_prefix", "_counter", "_deterministic")

    def __init__(self, prefix: str = "sim", *, deterministic: bool = True) -> None:
        self._prefix = prefix
        self._counter = 0
        self._deterministic = deterministic

    def next_id(self, kind: str) -> str:
        self._counter += 1
        if self._deterministic:
            return f"{self._prefix}-{kind}-{self._counter:012d}"
        return f"{self._prefix}-{kind}-{uuid.uuid4().hex[:16]}"

    def reset(self) -> None:
        self._counter = 0

    @property
    def issued(self) -> int:
        return self._counter


@dataclass(slots=True)
class _RestingOrder:
    """One order waiting for the market to come to it."""

    order_id: str
    client_order_id: str
    intent: OrderIntent
    remaining: Decimal
    activate_at_micros: int
    filled_quantity: Decimal = _ZERO


class SimulatedMatchingEngine:
    """Matches order intents against observed top-of-book data.

    Stateful only in the resting-order book. One engine belongs to one
    simulated account; sharing one between accounts would let their resting
    orders interact, which no real venue does across accounts in this way.
    """

    __slots__ = ("_assumptions", "_ids", "_resting", "_exchange")

    def __init__(
        self,
        assumptions: ExecutionAssumptions | None = None,
        *,
        id_factory: SimulatedIdFactory | None = None,
        exchange: ExchangeId = ExchangeId.PAPER,
    ) -> None:
        self._assumptions = assumptions or ExecutionAssumptions()
        self._ids = id_factory or SimulatedIdFactory()
        self._resting: dict[str, _RestingOrder] = {}
        self._exchange = exchange

    # -- inspection ---------------------------------------------------------
    @property
    def assumptions(self) -> ExecutionAssumptions:
        return self._assumptions

    @property
    def resting_count(self) -> int:
        return len(self._resting)

    def resting_order_ids(self) -> tuple[str, ...]:
        return tuple(sorted(self._resting))

    def reset(self) -> None:
        self._resting.clear()
        self._ids.reset()

    # -- submission ----------------------------------------------------------
    def submit(
        self,
        intent: OrderIntent,
        *,
        client_order_id: str,
        order_id: str,
        book: BookTop | None,
        now_micros: int,
    ) -> SimulatedMatch:
        """Submit an order to the simulator.

        Returns immediately with whatever it can do against ``book``. An order
        that cannot fill now rests and will be re-examined on every subsequent
        :meth:`on_book_update`.
        """
        errors = intent.validation_errors()
        if errors:
            return SimulatedMatch(
                accepted=False,
                status=OrderStatus.REJECTED,
                reason="; ".join(errors),
            )

        activate_at = now_micros + self._assumptions.latency_micros

        if self._assumptions.latency_micros > 0:
            # With a latency model the order cannot interact with the book that
            # was current when it was sent. Resting it is the honest treatment;
            # filling it against that book is the classic backtest cheat.
            self._rest(intent, order_id, client_order_id, activate_at)
            return SimulatedMatch(
                accepted=True,
                status=OrderStatus.ACKNOWLEDGED,
                rests=True,
                reason="Resting until the simulated latency has elapsed.",
            )

        if book is None:
            self._rest(intent, order_id, client_order_id, activate_at)
            return SimulatedMatch(
                accepted=True,
                status=OrderStatus.ACKNOWLEDGED,
                rests=True,
                reason="No usable market data; the order rests unfilled.",
            )

        fill_price, is_taker = self._resolve_fill_price(intent, book)
        if fill_price is None:
            self._rest(intent, order_id, client_order_id, activate_at)
            return SimulatedMatch(
                accepted=True,
                status=OrderStatus.ACKNOWLEDGED,
                rests=True,
                reason="Not marketable against the observed touch.",
            )

        quantity = self._fillable_quantity(intent.side, intent.quantity, book)
        if quantity <= _ZERO:
            self._rest(intent, order_id, client_order_id, activate_at)
            return SimulatedMatch(
                accepted=True,
                status=OrderStatus.ACKNOWLEDGED,
                rests=True,
                reason="No displayed size available at the touch.",
            )

        executed_price, slippage_cost = self._apply_slippage(
            intent.side, fill_price, quantity, is_taker
        )
        fill = self._build_fill(
            intent=intent,
            order_id=order_id,
            price=executed_price,
            quantity=quantity,
            is_maker=not is_taker,
            book=book,
            now_micros=now_micros,
        )

        if quantity < intent.quantity:
            self._rest(
                intent,
                order_id,
                client_order_id,
                activate_at,
                remaining=intent.quantity - quantity,
                filled=quantity,
            )
            status = OrderStatus.PARTIALLY_FILLED
        else:
            status = OrderStatus.FILLED

        return SimulatedMatch(
            accepted=True,
            status=status,
            fills=(fill,),
            rests=status is OrderStatus.PARTIALLY_FILLED,
            slippage_cost=slippage_cost,
        )

    def cancel(self, client_order_id: str) -> bool:
        """Remove a resting order. Returns whether anything was removed."""
        for order_id, resting in list(self._resting.items()):
            if resting.client_order_id == client_order_id:
                del self._resting[order_id]
                return True
        return False

    # -- resting-order matching -------------------------------------------------
    def on_book_update(
        self, book: BookTop, *, now_micros: int
    ) -> tuple[SimulatedFillEvent, ...]:
        """Re-examine every resting order against a new book.

        Orders are processed in insertion order, which is deterministic. A real
        venue would use price/time priority across the whole book including
        other participants; this engine models only our own orders and makes no
        claim to reproduce queue position.
        """
        if book.is_crossed:
            # A crossed book is corrupt or mid-resync. Filling against it would
            # manufacture free money in a backtest.
            return ()

        events: list[SimulatedFillEvent] = []
        for order_id in list(self._resting):
            resting = self._resting.get(order_id)
            if resting is None:  # pragma: no cover - defensive
                continue
            if now_micros < resting.activate_at_micros:
                continue

            fill_price, is_taker = self._resolve_fill_price(
                resting.intent, book, resting=True
            )
            if fill_price is None:
                continue

            quantity = self._fillable_quantity(
                resting.intent.side, resting.remaining, book
            )
            if quantity <= _ZERO:
                continue

            executed_price, slippage_cost = self._apply_slippage(
                resting.intent.side, fill_price, quantity, is_taker
            )
            fill = self._build_fill(
                intent=resting.intent,
                order_id=resting.order_id,
                price=executed_price,
                quantity=quantity,
                is_maker=not is_taker,
                book=book,
                now_micros=now_micros,
            )

            resting.remaining -= quantity
            resting.filled_quantity += quantity
            status = (
                OrderStatus.FILLED
                if resting.remaining <= _ZERO
                else OrderStatus.PARTIALLY_FILLED
            )
            if resting.remaining <= _ZERO:
                del self._resting[order_id]

            events.append(
                SimulatedFillEvent(
                    order_id=resting.order_id,
                    client_order_id=resting.client_order_id,
                    fill=fill,
                    status=status,
                    slippage_cost=slippage_cost,
                )
            )
        return tuple(events)

    # -- internals ---------------------------------------------------------------
    def _rest(
        self,
        intent: OrderIntent,
        order_id: str,
        client_order_id: str,
        activate_at: int,
        *,
        remaining: Decimal | None = None,
        filled: Decimal = _ZERO,
    ) -> None:
        self._resting[order_id] = _RestingOrder(
            order_id=order_id,
            client_order_id=client_order_id,
            intent=intent,
            remaining=intent.quantity if remaining is None else remaining,
            activate_at_micros=activate_at,
            filled_quantity=filled,
        )

    def _resolve_fill_price(
        self, intent: OrderIntent, book: BookTop, *, resting: bool = False
    ) -> tuple[Decimal | None, bool]:
        """``(price, is_taker)`` or ``(None, False)`` when it would not fill.

        A marketable order lifts the opposite touch and pays the taker fee. A
        resting limit order that the market reaches is treated as a maker fill,
        which is the assumption that most flatters a passive strategy - queue
        position is not modelled, so a real order at the same price might well
        not have traded.
        """
        touch = book.best_ask if intent.side is OrderSide.BUY else book.best_bid
        if touch is None:
            return None, False

        if intent.order_type is OrderType.MARKET:
            if self._assumptions.market_price_model is MarketFillPriceModel.MID:
                mid = book.mid_price
                return (mid, True) if mid is not None else (touch, True)
            return touch, True

        if intent.order_type is OrderType.LIMIT:
            if intent.price is None:
                return None, False
            if intent.side is OrderSide.BUY:
                crosses = (
                    intent.price >= touch
                    if self._assumptions.limit_fill_rule
                    is LimitFillRule.TOUCH_OR_BETTER
                    else intent.price > touch
                )
            else:
                crosses = (
                    intent.price <= touch
                    if self._assumptions.limit_fill_rule
                    is LimitFillRule.TOUCH_OR_BETTER
                    else intent.price < touch
                )
            if not crosses:
                return None, False
            # Price improvement: a marketable limit fills at the touch, never
            # at its own worse limit price.
            return touch, not resting

        # STOP and STOP_LIMIT need trigger monitoring, which this engine does
        # not model. They rest rather than fill on an assumption.
        return None, False

    def _fillable_quantity(
        self, side: OrderSide, requested: Decimal, book: BookTop
    ) -> Decimal:
        available = (
            book.best_ask_quantity if side is OrderSide.BUY else book.best_bid_quantity
        ) or _ZERO

        if not self._assumptions.cap_by_displayed_size or available <= _ZERO:
            # Preserves the Part 2 behaviour: when the venue reports no size at
            # the touch the simulator does not pretend to know better and fills
            # the request in full. Documented rather than silent.
            quantity = requested
        elif self._assumptions.allow_partial_fills:
            quantity = requested if requested <= available else available
        else:
            quantity = requested if requested <= available else _ZERO

        if quantity < self._assumptions.min_fill_quantity:
            return _ZERO
        return quantity

    def _apply_slippage(
        self, side: OrderSide, price: Decimal, quantity: Decimal, is_taker: bool
    ) -> tuple[Decimal, Decimal]:
        """Worsen a taker price by the configured slippage.

        Slippage is applied against us on both sides - a buy pays more, a sell
        receives less - and only to taker fills. A resting order that the
        market came to did not cross a spread, so charging it slippage would
        double-count the cost.
        """
        bps = self._assumptions.slippage_bps
        if bps == _ZERO or not is_taker:
            return price, _ZERO
        adjustment = price * bps / _BPS
        executed = price + adjustment if side is OrderSide.BUY else price - adjustment
        if executed <= _ZERO:
            return price, _ZERO
        return executed, adjustment * quantity

    def _build_fill(
        self,
        *,
        intent: OrderIntent,
        order_id: str,
        price: Decimal,
        quantity: Decimal,
        is_maker: bool,
        book: BookTop,
        now_micros: int,
    ) -> Fill:
        notional = price * quantity
        fee_rate = (
            self._assumptions.maker_fee_rate
            if is_maker
            else self._assumptions.taker_fee_rate
        )
        return Fill(
            fill_id=self._ids.next_id("fill"),
            order_id=order_id,
            trade_id=self._ids.next_id("trade"),
            price=price,
            quantity=quantity,
            fee=notional * fee_rate,
            fee_currency=self._assumptions.fee_currency,
            is_maker=is_maker,
            # Not a parameter and never will be. Everything this engine
            # produces is simulated.
            is_simulated=True,
            exchange_timestamp=book.exchange_timestamp or now_micros,
            received_timestamp=now_micros,
            symbol=intent.symbol,
            side=intent.side,
            exchange=intent.exchange,
            quote_quantity=notional,
            exchange_order_id=None,
        )
```

---

## FILE: libs/trading-core/wlct_trading/backtest/walkforward.py

```py
"""Walk-forward foundation.

This provides the *structure* for walk-forward evaluation - splitting a dataset
into training, validation and test windows and running the same strategy over
each - and deliberately stops there. There is no parameter search, no
optimiser and no machine learning in this module, because an optimiser that
selects the best of many parameter sets on the same data manufactures
overfitting, and shipping one without the surrounding discipline would be worse
than shipping none.

What the structure buys today: a run is labelled with the
:class:`~wlct_trading.enums.BacktestPhase` it belongs to, each window is a
separately checksummed dataset slice, and a result computed on a training
window can never be mistaken for one computed on the test window.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Iterator

from wlct_trading.backtest.dataset import HistoricalDataset
from wlct_trading.enums import BacktestPhase

__all__ = ["WalkForwardWindow", "WalkForwardSplit", "split_dataset", "rolling_windows"]

_ZERO = Decimal(0)
_ONE = Decimal(1)


@dataclass(slots=True, frozen=True)
class WalkForwardWindow:
    """One labelled time window and the dataset slice covering it."""

    phase: BacktestPhase
    start_micros: int
    end_micros: int
    dataset: HistoricalDataset

    @property
    def duration_micros(self) -> int:
        return self.end_micros - self.start_micros

    @property
    def event_count(self) -> int:
        return len(self.dataset)

    def to_dict(self) -> dict[str, object]:
        return {
            "phase": self.phase.value,
            "startMicros": self.start_micros,
            "endMicros": self.end_micros,
            "durationMicros": self.duration_micros,
            "eventCount": self.event_count,
            "datasetId": self.dataset.descriptor.dataset_id,
            "checksum": self.dataset.descriptor.checksum,
        }


@dataclass(slots=True, frozen=True)
class WalkForwardSplit:
    """A training/validation/test partition of one dataset.

    The three windows are contiguous and non-overlapping. Overlap would leak
    information from one phase into the next, which is the specific failure
    walk-forward analysis exists to avoid.
    """

    training: WalkForwardWindow
    validation: WalkForwardWindow
    test: WalkForwardWindow

    def windows(self) -> tuple[WalkForwardWindow, ...]:
        return (self.training, self.validation, self.test)

    @property
    def is_non_overlapping(self) -> bool:
        return (
            self.training.end_micros < self.validation.start_micros
            and self.validation.end_micros < self.test.start_micros
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "training": self.training.to_dict(),
            "validation": self.validation.to_dict(),
            "test": self.test.to_dict(),
            "isNonOverlapping": self.is_non_overlapping,
            "note": (
                "Window labels carry no statistical claim on their own. This "
                "module performs no parameter optimisation."
            ),
        }


def split_dataset(
    dataset: HistoricalDataset,
    *,
    training_fraction: Decimal = Decimal("0.6"),
    validation_fraction: Decimal = Decimal("0.2"),
) -> WalkForwardSplit:
    """Split a dataset by time into training, validation and test windows.

    Fractions are of the dataset's *time span*, not of its event count: an
    event-count split would put more wall-clock time in the quiet periods and
    make the windows incomparable.

    The test fraction is whatever remains, and must be positive - a split with
    no test window is not a walk-forward split.
    """
    if training_fraction <= _ZERO or validation_fraction <= _ZERO:
        raise ValueError("Walk-forward fractions must be positive.")
    test_fraction = _ONE - training_fraction - validation_fraction
    if test_fraction <= _ZERO:
        raise ValueError(
            "training_fraction + validation_fraction must leave a positive test "
            f"window; they sum to {training_fraction + validation_fraction}."
        )

    start = dataset.descriptor.start_micros
    end = dataset.descriptor.end_micros
    span = end - start
    if span <= 0:
        raise ValueError("Cannot split a dataset that spans no time.")

    training_end = start + int(Decimal(span) * training_fraction)
    validation_end = training_end + int(Decimal(span) * validation_fraction)

    training = WalkForwardWindow(
        phase=BacktestPhase.TRAINING,
        start_micros=start,
        end_micros=training_end,
        dataset=dataset.slice(start_micros=start, end_micros=training_end),
    )
    validation = WalkForwardWindow(
        phase=BacktestPhase.VALIDATION,
        start_micros=training_end + 1,
        end_micros=validation_end,
        dataset=dataset.slice(start_micros=training_end + 1, end_micros=validation_end),
    )
    test = WalkForwardWindow(
        phase=BacktestPhase.TEST,
        start_micros=validation_end + 1,
        end_micros=end,
        dataset=dataset.slice(start_micros=validation_end + 1, end_micros=end),
    )
    return WalkForwardSplit(training=training, validation=validation, test=test)


def rolling_windows(
    dataset: HistoricalDataset,
    *,
    window_micros: int,
    step_micros: int,
    phase: BacktestPhase = BacktestPhase.TEST,
) -> Iterator[WalkForwardWindow]:
    """Yield fixed-length windows advancing by ``step_micros``.

    The foundation for anchored or rolling walk-forward runs. Windows with no
    events are skipped rather than yielded empty, because a backtest over zero
    events produces metrics that are all ``None`` and would only add noise to a
    fold table.
    """
    if window_micros <= 0 or step_micros <= 0:
        raise ValueError("window_micros and step_micros must be positive.")

    start = dataset.descriptor.start_micros
    end = dataset.descriptor.end_micros
    cursor = start
    while cursor <= end:
        window_end = cursor + window_micros
        if window_end > end:
            window_end = end
        sliced = dataset.slice(start_micros=cursor, end_micros=window_end)
        if len(sliced) > 0:
            yield WalkForwardWindow(
                phase=phase,
                start_micros=cursor,
                end_micros=window_end,
                dataset=sliced,
            )
        if window_end >= end:
            break
        cursor += step_micros
```

---

## FILE: libs/trading-core/wlct_trading/paper/__init__.py

```py
"""Paper trading against a live feed.

One module, one class: :class:`~wlct_trading.paper.session.PaperTradingSession`.
It runs the production strategy path - real normalised market data, the real
signal validator, the real risk engine - and substitutes a simulated execution
adapter for a credentialed one.

The session refuses to be constructed with an adapter that is not marked
simulated, and refuses any trading mode other than ``PAPER`` or ``DRY_RUN``.
It carries no credential and has no field that could hold one.

PAPER PERFORMANCE IS NOT INDICATIVE OF LIVE PERFORMANCE. Simulated fills ignore
queue position, market impact, venue rejections and latency variance.
"""

from __future__ import annotations

from wlct_trading.paper.session import (
    PaperSessionConfig,
    PaperSessionSummary,
    PaperTradingSafetyError,
    PaperTradingSession,
)

__all__ = [
    "PaperSessionConfig",
    "PaperSessionSummary",
    "PaperTradingSafetyError",
    "PaperTradingSession",
]
```

---

## FILE: libs/trading-core/wlct_trading/paper/session.py

```py
"""Paper trading: real market data, simulated execution.

A paper session runs the production path against a live feed and stops one step
short of the venue. Market data is real, the strategy is the real strategy, the
signal validator and the risk engine are the real ones, and the only substitution
is the execution adapter - a
:class:`~wlct_trading.adapters.paper.PaperTradingAdapter` in place of a
credentialed one.

The safety boundary is enforced in the constructor, not by convention:

* the adapter must report ``is_simulated=True`` or the session refuses to be
  created;
* the trading mode must be ``PAPER``; ``LIVE`` and ``DISABLED`` both raise;
* the session holds no credential, no API key and no signer, and there is no
  constructor argument that could carry one.

Those three checks are what the mandatory paper-trading safety test asserts.
A session that has been constructed cannot reach a live venue, because it has
no object capable of reaching one.

PAPER PERFORMANCE IS NOT INDICATIVE OF LIVE PERFORMANCE. The simulator ignores
queue position, market impact, venue rejections and latency variance, all of
which cost real money on a real venue.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from decimal import Decimal

from wlct_trading.adapters.base import TradingAdapter
from wlct_trading.backtest.portfolio import SimulatedPortfolio
from wlct_trading.clock import epoch_micros
from wlct_trading.enums import ExchangeId, MarketType, TradingMode
from wlct_trading.idempotency import build_client_order_id
from wlct_trading.market_data import BookTop, Candle, PublicTrade, Ticker
from wlct_trading.metrics import StrategyMetrics
from wlct_trading.orders import Order
from wlct_trading.positions import Position
from wlct_trading.risk import KillSwitchState, RiskEngine, RiskLimits, RiskSnapshot
from wlct_trading.signals import Signal, signal_to_intent
from wlct_trading.strategies.base import Strategy
from wlct_trading.strategies.context import StrategyRiskView
from wlct_trading.strategies.lifecycle import (
    SignalOutcome,
    StrategyEngine,
    StrategyEngineConfig,
)
from wlct_trading.strategies.state import StrategyInstanceKey

__all__ = [
    "PaperTradingSafetyError",
    "PaperSessionConfig",
    "PaperSessionSummary",
    "PaperTradingSession",
]

_LOG = logging.getLogger(__name__)
_ZERO = Decimal(0)
_ONE_MINUTE_MICROS = 60_000_000

#: The only mode a paper session may run in. ``LIVE`` is absent deliberately,
#: ``DISABLED`` because a disabled session should not have been started at all,
#: and no code path adds to this set at runtime.
_PERMITTED_MODES = frozenset({TradingMode.PAPER})


class PaperTradingSafetyError(RuntimeError):
    """Raised when a paper session is asked to do something unsafe.

    Always fatal at construction time. A session that could route to a live
    venue must not exist, so this is raised instead of logged.
    """


@dataclass(slots=True, frozen=True)
class PaperSessionConfig:
    """Configuration for one paper session.

    Notice what is *not* here: no API key, no secret, no signer, no endpoint
    override. A paper session has no use for a credential and therefore has no
    field to put one in.
    """

    session_id: str
    tenant_id: str
    account_id: str
    exchange: ExchangeId
    symbol: str
    initial_capital: Decimal
    risk_limits: RiskLimits | None = None
    market_type: MarketType = MarketType.SPOT
    trading_mode: TradingMode = TradingMode.PAPER
    quote_asset: str = "USDT"
    base_asset: str = "BTC"
    engine_config: StrategyEngineConfig | None = None
    #: How often the session records an equity snapshot, in microseconds.
    #: Snapshots are in-memory; persistence is the host's decision and happens
    #: on a schedule, never per tick.
    snapshot_interval_micros: int = 60_000_000

    def __post_init__(self) -> None:
        if not self.session_id:
            raise PaperTradingSafetyError("PaperSessionConfig requires a session_id.")
        if not self.tenant_id:
            raise PaperTradingSafetyError("PaperSessionConfig requires a tenant_id.")
        if not self.account_id:
            raise PaperTradingSafetyError("PaperSessionConfig requires an account_id.")
        if not isinstance(self.initial_capital, Decimal):
            raise PaperTradingSafetyError("initial_capital must be a Decimal.")
        if self.initial_capital <= _ZERO:
            raise PaperTradingSafetyError("initial_capital must be positive.")
        if self.trading_mode not in _PERMITTED_MODES:
            raise PaperTradingSafetyError(
                f"A paper session cannot run in {self.trading_mode.value} mode. "
                "The only permitted mode is PAPER."
            )
        if self.snapshot_interval_micros <= 0:
            raise PaperTradingSafetyError(
                "snapshot_interval_micros must be positive."
            )


@dataclass(slots=True, frozen=True)
class PaperSessionSummary:
    """A durable summary of a session, safe to persist and to display.

    Everything is labelled simulated. This is the object a host writes to
    PostgreSQL when a session ends or on a slow schedule - never per tick.
    """

    session_id: str
    tenant_id: str
    strategy_key: str
    strategy_version: str
    exchange: ExchangeId
    symbol: str
    trading_mode: TradingMode
    started_at_micros: int
    ended_at_micros: int | None
    initial_capital: Decimal
    final_equity: Decimal
    realised_pnl: Decimal
    unrealised_pnl: Decimal | None
    fees_paid: Decimal
    max_drawdown: Decimal
    simulated_orders: int
    simulated_fills: int
    signals_generated: int
    signals_accepted: int
    signals_rejected: int
    risk_rejections: int
    strategy_errors: int
    is_simulated: bool = True

    def to_dict(self) -> dict[str, object]:
        return {
            "sessionId": self.session_id,
            "tenantId": self.tenant_id,
            "strategyKey": self.strategy_key,
            "strategyVersion": self.strategy_version,
            "exchange": self.exchange.value,
            "symbol": self.symbol,
            "tradingMode": self.trading_mode.value,
            "startedAtMicros": self.started_at_micros,
            "endedAtMicros": self.ended_at_micros,
            "initialCapital": str(self.initial_capital),
            "finalEquity": str(self.final_equity),
            "realisedPnl": str(self.realised_pnl),
            "unrealisedPnl": (
                str(self.unrealised_pnl) if self.unrealised_pnl is not None else None
            ),
            "feesPaid": str(self.fees_paid),
            "maxDrawdown": str(self.max_drawdown),
            "simulatedOrders": self.simulated_orders,
            "simulatedFills": self.simulated_fills,
            "signalsGenerated": self.signals_generated,
            "signalsAccepted": self.signals_accepted,
            "signalsRejected": self.signals_rejected,
            "riskRejections": self.risk_rejections,
            "strategyErrors": self.strategy_errors,
            "isSimulated": True,
            "disclaimer": (
                "SIMULATED session. Paper performance is not indicative of live "
                "performance and does not guarantee real execution quality."
            ),
        }


class PaperTradingSession:
    """One strategy trading one symbol on simulated execution, live data."""

    __slots__ = (
        "_config",
        "_adapter",
        "_strategy",
        "_strategy_engine",
        "_risk_engine",
        "_portfolio",
        "_metrics",
        "_book_top",
        "_last_price",
        "_open_orders",
        "_recent_order_times",
        "_started_at",
        "_ended_at",
        "_running",
        "_simulated_orders",
        "_simulated_fills",
        "_signals_generated",
        "_signals_accepted",
        "_signals_rejected",
        "_risk_rejections",
        "_last_snapshot_micros",
        "_snapshots",
    )

    def __init__(
        self,
        *,
        config: PaperSessionConfig,
        strategy: Strategy,
        adapter: TradingAdapter,
        risk_engine: RiskEngine | None = None,
        metrics: StrategyMetrics | None = None,
    ) -> None:
        # -- the safety gate. Nothing else in this class may run first. -----
        if not getattr(adapter, "is_simulated", False):
            raise PaperTradingSafetyError(
                "A paper session refuses an execution adapter that is not "
                f"marked simulated (got {type(adapter).__name__}). Paper "
                "trading must never reach a live venue."
            )
        if config.trading_mode not in _PERMITTED_MODES:  # pragma: no cover
            raise PaperTradingSafetyError(
                f"Refusing to start a paper session in {config.trading_mode.value}."
            )
        if strategy.symbol != config.symbol:
            raise PaperTradingSafetyError(
                f"Strategy trades {strategy.symbol}; session is for {config.symbol}."
            )
        if strategy.descriptor.exchange is not config.exchange:
            raise PaperTradingSafetyError(
                f"Strategy is configured for {strategy.descriptor.exchange.value}; "
                f"session is for {config.exchange.value}."
            )

        self._config = config
        self._adapter = adapter
        self._strategy = strategy
        self._metrics = metrics or StrategyMetrics()
        self._risk_engine = risk_engine or RiskEngine(config.risk_limits or RiskLimits())
        self._portfolio = SimulatedPortfolio(
            initial_cash=config.initial_capital,
            tenant_id=config.tenant_id,
            account_id=config.account_id,
            exchange=config.exchange,
            symbol=config.symbol,
            quote_asset=config.quote_asset,
            base_asset=config.base_asset,
        )
        self._strategy_engine = StrategyEngine(
            config=config.engine_config or StrategyEngineConfig(),
            metrics=self._metrics,
            position_provider=self._provide_position,
            open_orders_provider=self._provide_open_orders,
            risk_view_provider=self._provide_risk_view,
            kill_switch_provider=KillSwitchState,
            freshness_provider=self._provide_freshness,
        )
        self._strategy_engine.add(strategy)

        self._book_top: BookTop | None = None
        self._last_price: Decimal | None = None
        self._open_orders: dict[str, Order] = {}
        self._recent_order_times: list[int] = []
        self._started_at: int | None = None
        self._ended_at: int | None = None
        self._running = False
        self._simulated_orders = 0
        self._simulated_fills = 0
        self._signals_generated = 0
        self._signals_accepted = 0
        self._signals_rejected = 0
        self._risk_rejections = 0
        self._last_snapshot_micros: int | None = None
        self._snapshots: list[dict[str, object]] = []

    # -- identity -------------------------------------------------------------
    @property
    def is_simulated(self) -> bool:
        """Always ``True``. A paper session cannot produce a real fill."""
        return True

    @property
    def session_id(self) -> str:
        return self._config.session_id

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def portfolio(self) -> SimulatedPortfolio:
        return self._portfolio

    @property
    def metrics(self) -> StrategyMetrics:
        return self._metrics

    @property
    def strategy_engine(self) -> StrategyEngine:
        return self._strategy_engine

    @property
    def snapshots(self) -> tuple[dict[str, object], ...]:
        """Equity snapshots taken so far. In memory; persistence is the host's."""
        return tuple(self._snapshots)

    # -- lifecycle ---------------------------------------------------------------
    def start(self, *, now_micros: int | None = None) -> None:
        now = epoch_micros() if now_micros is None else now_micros
        if self._running:
            raise PaperTradingSafetyError(
                f"Paper session {self._config.session_id} is already running."
            )
        self._started_at = now
        self._ended_at = None
        self._running = True
        self._strategy_engine.start_all(now_micros=now)
        self._metrics.counters.paper_sessions_started += 1
        _LOG.info(
            "paper session started session_id=%s tenant_id=%s strategy=%s@%s "
            "symbol=%s mode=%s simulated=True",
            self._config.session_id,
            self._config.tenant_id,
            self._strategy.strategy_key,
            self._strategy.strategy_version,
            self._config.symbol,
            self._config.trading_mode.value,
        )

    def stop(self, *, now_micros: int | None = None) -> PaperSessionSummary:
        now = epoch_micros() if now_micros is None else now_micros
        self._strategy_engine.stop_all(now_micros=now)
        self._running = False
        self._ended_at = now
        self._metrics.counters.paper_sessions_stopped += 1
        summary = self.summary()
        _LOG.info(
            "paper session stopped session_id=%s orders=%d fills=%d "
            "final_equity=%s simulated=True",
            self._config.session_id,
            self._simulated_orders,
            self._simulated_fills,
            summary.final_equity,
        )
        return summary

    # -- providers ----------------------------------------------------------------
    def _provide_position(self, _key: StrategyInstanceKey) -> Position | None:
        return self._portfolio.position

    def _provide_open_orders(self, _key: StrategyInstanceKey) -> tuple[Order, ...]:
        return tuple(self._open_orders.values())

    def _provide_risk_view(self, _key: StrategyInstanceKey) -> StrategyRiskView:
        limits = self._config.risk_limits or RiskLimits()
        quantity = self._portfolio.base_quantity
        mark = self._last_price or _ZERO
        return StrategyRiskView(
            is_available=True,
            max_position_quantity=limits.max_position_quantity,
            max_order_quantity=limits.max_order_quantity,
            current_position_quantity=quantity,
            symbol_exposure_notional=abs(quantity) * mark,
            account_exposure_notional=abs(quantity) * mark,
            open_order_count=len(self._open_orders),
            realised_pnl_today=self._portfolio.realised_pnl,
        )

    def _provide_freshness(self, _key: StrategyInstanceKey) -> tuple[bool, int | None]:
        """Real wall-clock freshness. Paper trading uses live data, so a stale
        feed must stop it exactly as it would stop live trading."""
        if self._book_top is None:
            return (False, None)
        age = epoch_micros() - self._book_top.exchange_timestamp
        if age < 0:
            return (False, None)
        return (True, age)

    # -- market data ---------------------------------------------------------------
    async def on_book_top(self, top: BookTop) -> tuple[SignalOutcome, ...]:
        self._require_running()
        self._book_top = top
        mid = top.mid_price
        if mid is not None:
            self._last_price = mid
        outcomes = self._strategy_engine.dispatch_book_top(top)
        await self._handle_outcomes(outcomes)
        self._maybe_snapshot()
        return outcomes

    async def on_ticker(self, ticker: Ticker) -> tuple[SignalOutcome, ...]:
        self._require_running()
        if ticker.last_price is not None:
            self._last_price = ticker.last_price
        outcomes = self._strategy_engine.dispatch_ticker(ticker)
        await self._handle_outcomes(outcomes)
        self._maybe_snapshot()
        return outcomes

    async def on_trade(self, trade: PublicTrade) -> tuple[SignalOutcome, ...]:
        self._require_running()
        self._last_price = trade.price
        outcomes = self._strategy_engine.dispatch_trade(trade)
        await self._handle_outcomes(outcomes)
        self._maybe_snapshot()
        return outcomes

    async def on_candle(self, candle: Candle) -> tuple[SignalOutcome, ...]:
        self._require_running()
        self._last_price = candle.close
        outcomes = self._strategy_engine.dispatch_candle(candle)
        await self._handle_outcomes(outcomes)
        self._maybe_snapshot()
        return outcomes

    def invalidate_market_data(self) -> None:
        """Feed became untrustworthy: drop the book and reset features."""
        self._book_top = None
        self._strategy_engine.invalidate_symbol(self._config.symbol)

    # -- routing ------------------------------------------------------------------
    async def _handle_outcomes(self, outcomes: tuple[SignalOutcome, ...]) -> None:
        for outcome in outcomes:
            self._signals_generated += 1
            if not outcome.accepted:
                self._signals_rejected += 1
                continue
            self._signals_accepted += 1
            await self._route(outcome.signal)

    async def _route(self, signal: Signal) -> None:
        """Signal -> intent -> risk -> simulated adapter.

        The risk engine is not optional and not bypassable: there is exactly
        one call to the adapter in this class and it sits behind the approval
        check below.
        """
        intent = signal_to_intent(
            signal,
            account_id=self._config.account_id,
            current_position_quantity=self._portfolio.base_quantity,
        )
        if intent is None:
            return

        client_order_id = build_client_order_id(intent)
        intent.client_order_id = client_order_id
        now = epoch_micros()

        decision = self._risk_engine.evaluate(
            intent,
            snapshot=self._risk_snapshot(now),
            kill_switches=KillSwitchState(),
            trading_mode=self._config.trading_mode,
            book_top=self._book_top,
            strategy_enabled=True,
        )
        if not decision.approved or not decision.would_route:
            self._risk_rejections += 1
            self._metrics.counters.risk_rejections += 1
            _LOG.info(
                "paper signal rejected by risk session_id=%s signal_id=%s code=%s",
                self._config.session_id,
                signal.signal_id,
                decision.code.value,
            )
            return

        result = await self._adapter.submit_order(intent, client_order_id)
        self._simulated_orders += 1
        self._metrics.counters.simulated_orders += 1
        self._recent_order_times.append(now)
        self._recent_order_times = [
            timestamp
            for timestamp in self._recent_order_times
            if now - timestamp <= _ONE_MINUTE_MICROS
        ]

        if not result.accepted:
            self._metrics.counters.simulated_orders_rejected += 1
            return
        if not result.is_simulated:
            # Structurally impossible with a simulated adapter, and fatal if it
            # ever happened: a real fill has entered a simulated portfolio.
            raise PaperTradingSafetyError(
                "A paper session received a result that is not marked "
                "simulated. Refusing to continue."
            )

        order = Order.from_intent(
            intent,
            client_order_id=client_order_id,
            order_id=result.exchange_order_id or client_order_id,
            is_simulated=True,
        )
        if not result.fills:
            self._open_orders[client_order_id] = order

        for fill in result.fills:
            self._simulated_fills += 1
            self._metrics.counters.simulated_fills += 1
            self._portfolio.apply_fill(fill)

    def _risk_snapshot(self, now_micros: int) -> RiskSnapshot:
        quantity = self._portfolio.base_quantity
        reference = self._last_price
        exposure = abs(quantity) * (reference or _ZERO)
        age: int | None = None
        if self._book_top is not None:
            age = max(now_micros - self._book_top.exchange_timestamp, 0)
        return RiskSnapshot(
            position_quantity=quantity,
            symbol_exposure_notional=exposure,
            account_exposure_notional=exposure,
            open_order_count=len(self._open_orders),
            orders_in_last_minute=len(self._recent_order_times),
            realised_pnl_today=self._portfolio.realised_pnl,
            strategy_realised_pnl_today=self._portfolio.realised_pnl,
            reference_price=reference,
            market_data_age_micros=age,
            book_usable=self._book_top is not None,
            is_complete=True,
        )

    # -- reporting --------------------------------------------------------------------
    def _require_running(self) -> None:
        if not self._running:
            raise PaperTradingSafetyError(
                f"Paper session {self._config.session_id} is not running."
            )

    def _maybe_snapshot(self) -> None:
        now = epoch_micros()
        if (
            self._last_snapshot_micros is None
            or now - self._last_snapshot_micros >= self._config.snapshot_interval_micros
        ):
            point = self._portfolio.mark_to_market(
                timestamp_micros=now, mark_price=self._last_price
            )
            self._snapshots.append(point.to_dict())
            self._last_snapshot_micros = now

    def summary(self) -> PaperSessionSummary:
        """A persistable snapshot of the session so far."""
        instance = self._strategy_engine.instances()[0]
        return PaperSessionSummary(
            session_id=self._config.session_id,
            tenant_id=self._config.tenant_id,
            strategy_key=self._strategy.strategy_key,
            strategy_version=self._strategy.strategy_version,
            exchange=self._config.exchange,
            symbol=self._config.symbol,
            trading_mode=self._config.trading_mode,
            started_at_micros=self._started_at or 0,
            ended_at_micros=self._ended_at,
            initial_capital=self._config.initial_capital,
            final_equity=self._portfolio.equity(self._last_price),
            realised_pnl=self._portfolio.realised_pnl,
            unrealised_pnl=self._portfolio.unrealised_pnl,
            fees_paid=self._portfolio.fees_paid,
            max_drawdown=self._portfolio.max_drawdown,
            simulated_orders=self._simulated_orders,
            simulated_fills=self._simulated_fills,
            signals_generated=self._signals_generated,
            signals_accepted=self._signals_accepted,
            signals_rejected=self._signals_rejected,
            risk_rejections=self._risk_rejections,
            strategy_errors=instance.error_count,
        )
```

---

## FILE: libs/trading-core/tests/test_strategy_features.py

```py
"""Part 6: feature engine tests.

Determinism, bounded memory, explicit insufficient-history handling and safe
arithmetic. Every value in these tests is a ``Decimal`` written as a string -
no binary float ever enters a price or a quantity, and a test that used one
would be asserting the wrong contract.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from wlct_trading.enums import OrderSide
from wlct_trading.market_data import BookTop, Candle, PublicTrade, Ticker
from wlct_trading.strategies.features import (
    FeatureConfig,
    FeatureEngine,
    RollingReturns,
    RollingWindow,
    depth_imbalance,
    max_drawdown,
    order_book_imbalance,
    profit_factor,
    safe_ratio,
    sharpe_ratio,
    sortino_ratio,
    spread_basis_points,
    weighted_mid_price,
)
from wlct_trading.strategies.features.statistics import MIN_RISK_METRIC_OBSERVATIONS

from tests.conftest import BASE_TS, EXCHANGE, SYMBOL

D = Decimal


def top(
    *,
    bid: str | None = "29995.00",
    bid_qty: str | None = "2.0",
    ask: str | None = "30005.00",
    ask_qty: str | None = "1.0",
    timestamp: int = BASE_TS,
) -> BookTop:
    return BookTop(
        exchange=EXCHANGE,
        symbol=SYMBOL,
        best_bid=D(bid) if bid is not None else None,
        best_bid_quantity=D(bid_qty) if bid_qty is not None else None,
        best_ask=D(ask) if ask is not None else None,
        best_ask_quantity=D(ask_qty) if ask_qty is not None else None,
        sequence=1,
        exchange_timestamp=timestamp,
        received_timestamp=timestamp + 100,
    )


class TestOrderBookImbalance:
    """Case 6/7: the imbalance definition and its zero denominator."""

    def test_definition_matches_the_specification(self) -> None:
        # (9 - 1) / (9 + 1) = 0.8
        assert order_book_imbalance(D("9"), D("1")) == D("0.8")

    def test_equal_sizes_are_exactly_zero(self) -> None:
        assert order_book_imbalance(D("5"), D("5")) == D("0")

    def test_all_volume_on_one_side_saturates_at_one(self) -> None:
        assert order_book_imbalance(D("3"), D("0")) == D("1")
        assert order_book_imbalance(D("0"), D("3")) == D("-1")

    def test_empty_book_is_none_not_zero(self) -> None:
        """A zero denominator must not be reported as a balanced book."""
        assert order_book_imbalance(D("0"), D("0")) is None

    def test_missing_side_is_none(self) -> None:
        assert order_book_imbalance(None, D("1")) is None
        assert order_book_imbalance(D("1"), None) is None

    def test_negative_quantity_is_rejected(self) -> None:
        assert order_book_imbalance(D("-1"), D("1")) is None

    def test_result_is_always_finite_and_bounded(self) -> None:
        for bid, ask in (("1", "1"), ("0", "7"), ("7", "0"), ("0.00001", "9999")):
            value = order_book_imbalance(D(bid), D(ask))
            assert value is not None
            assert value.is_finite()
            assert D("-1") <= value <= D("1")

    def test_safe_ratio_never_divides_by_zero(self) -> None:
        assert safe_ratio(D("1"), D("0")) is None
        assert safe_ratio(D("0"), D("0")) is None
        assert safe_ratio(D("1"), D("4")) == D("0.25")


class TestMicrostructureHelpers:
    def test_weighted_mid_leans_towards_the_lighter_side(self) -> None:
        # Heavy bid (2.0) versus light ask (1.0) pushes the estimate up.
        value = weighted_mid_price(top(bid_qty="2.0", ask_qty="1.0"))
        assert value is not None
        assert value > D("30000.00")

    def test_weighted_mid_is_none_without_sizes(self) -> None:
        """No silent fallback to the arithmetic mid."""
        assert weighted_mid_price(top(bid_qty=None, ask_qty=None)) is None

    def test_spread_basis_points(self) -> None:
        value = spread_basis_points(top())
        assert value is not None
        # 10.00 wide on a 30 000 mid is 3.33 bps.
        assert value.quantize(D("0.01")) == D("3.33")

    def test_depth_imbalance_uses_the_requested_depth(self, snapshot) -> None:
        shallow = depth_imbalance(snapshot, depth=1)
        deep = depth_imbalance(snapshot, depth=5)
        assert shallow is not None and deep is not None
        assert shallow != deep


class TestRollingWindow:
    """Cases 8 and 9: bounded windows and explicit insufficient history."""

    def test_capacity_is_never_exceeded(self) -> None:
        window = RollingWindow(capacity=3)
        for value in ("1", "2", "3", "4", "5"):
            window.push(D(value))
        assert len(window) == 3
        assert window.values() == (D("3"), D("4"), D("5"))

    def test_statistics_are_none_until_the_window_is_full(self) -> None:
        window = RollingWindow(capacity=4)
        window.extend([D("1"), D("2")])
        assert window.is_ready is False
        assert window.mean is None
        assert window.standard_deviation is None
        window.extend([D("3"), D("4")])
        assert window.is_ready is True
        assert window.mean == D("2.5")

    def test_variance_uses_the_sample_convention(self) -> None:
        window = RollingWindow(capacity=4, min_samples=2)
        window.extend([D("2"), D("4"), D("4"), D("6")])
        # Sample variance (ddof=1) of 2,4,4,6 is 8/3.
        variance = window.variance
        assert variance is not None
        assert variance.quantize(D("0.0001")) == D("2.6667")

    def test_single_observation_has_no_variance(self) -> None:
        window = RollingWindow(capacity=4, min_samples=1)
        window.push(D("7"))
        assert window.mean == D("7")
        assert window.variance is None

    def test_reset_clears_everything(self) -> None:
        window = RollingWindow(capacity=2)
        window.extend([D("1"), D("2")])
        window.reset()
        assert len(window) == 0
        assert window.mean is None

    def test_rejects_a_non_decimal(self) -> None:
        window = RollingWindow(capacity=2)
        with pytest.raises(TypeError):
            window.push(1.5)  # type: ignore[arg-type]

    def test_identical_inputs_produce_identical_output(self) -> None:
        """Case 1 of determinism: the same values give the same statistics."""
        values = [D("1.5"), D("2.5"), D("3.5"), D("4.5")]
        first = RollingWindow(capacity=4)
        second = RollingWindow(capacity=4)
        first.extend(values)
        second.extend(values)
        assert first.to_dict() == second.to_dict()


class TestRollingReturns:
    def test_first_price_yields_no_return(self) -> None:
        returns = RollingReturns(capacity=3)
        assert returns.push_price(D("100")) is None
        assert returns.push_price(D("110")) == D("0.1")

    def test_zero_price_does_not_raise(self) -> None:
        returns = RollingReturns(capacity=3)
        returns.push_price(D("0"))
        assert returns.push_price(D("100")) is None

    def test_volatility_requires_a_full_window(self) -> None:
        returns = RollingReturns(capacity=3)
        for price in ("100", "101", "102"):
            returns.push_price(D(price))
        assert returns.volatility is None
        returns.push_price(D("103"))
        assert returns.volatility is not None


class TestRiskStatistics:
    """Case 25: a metric must not be presented on insufficient observations."""

    def test_sharpe_is_withheld_below_the_observation_floor(self) -> None:
        few = [D("0.01")] * (MIN_RISK_METRIC_OBSERVATIONS - 1)
        assert sharpe_ratio(few) is None

    def test_sharpe_is_computed_once_there_are_enough_varied_observations(self) -> None:
        values = [D("0.01") if index % 2 else D("-0.005") for index in range(40)]
        assert sharpe_ratio(values) is not None

    def test_sharpe_of_a_constant_series_is_none(self) -> None:
        """Zero dispersion is not an infinite Sharpe ratio."""
        assert sharpe_ratio([D("0.01")] * 40) is None

    def test_sortino_ignores_upside_dispersion(self) -> None:
        upside_only = [D("0.01")] * 40
        assert sortino_ratio(upside_only) is None

    def test_max_drawdown_measures_the_worst_peak_to_trough(self) -> None:
        absolute, fraction = max_drawdown(
            [D("100"), D("120"), D("90"), D("110"), D("80")]
        )
        assert absolute == D("40")
        assert fraction is not None
        assert fraction.quantize(D("0.0001")) == D("0.3333")

    def test_max_drawdown_of_a_rising_curve_is_zero(self) -> None:
        absolute, fraction = max_drawdown([D("100"), D("110"), D("120")])
        assert absolute == D("0")
        assert fraction == D("0") or fraction is None

    def test_profit_factor_is_none_without_losses(self) -> None:
        assert profit_factor(D("100"), D("0")) is None
        assert profit_factor(D("100"), D("-50")) == D("2")


class TestFeatureEngine:
    """Cases 6-9 at the engine level, plus determinism and reset."""

    def make(self) -> FeatureEngine:
        return FeatureEngine(
            exchange=EXCHANGE,
            symbol=SYMBOL,
            config=FeatureConfig(
                return_window=3, volatility_window=3, volume_window=3,
                spread_window=3, trade_window=3,
            ),
        )

    def test_snapshot_before_any_data_is_all_none(self) -> None:
        snapshot = self.make().snapshot(as_of_micros=BASE_TS)
        assert snapshot.mid_price is None
        assert snapshot.order_book_imbalance is None
        assert snapshot.rolling_volatility is None
        assert snapshot.book_update_count == 0

    def test_book_top_populates_touch_features(self) -> None:
        engine = self.make()
        engine.observe_book_top(top(bid_qty="9", ask_qty="1"))
        snapshot = engine.snapshot(as_of_micros=BASE_TS)
        assert snapshot.mid_price == D("30000.00")
        assert snapshot.order_book_imbalance == D("0.8")
        assert snapshot.spread == D("10.00")
        assert snapshot.book_update_count == 1

    def test_crossed_book_is_ignored_and_counted(self) -> None:
        engine = self.make()
        engine.observe_book_top(top(bid="30010.00", ask="30005.00"))
        assert engine.error_count == 1
        assert engine.snapshot(as_of_micros=BASE_TS).mid_price is None

    def test_rolling_features_need_history(self) -> None:
        engine = self.make()
        for index in range(3):
            engine.observe_book_top(
                top(
                    bid=str(29995 + index),
                    ask=str(30005 + index),
                    timestamp=BASE_TS + index * 1_000,
                )
            )
        snapshot = engine.snapshot(as_of_micros=BASE_TS)
        assert snapshot.rolling_volatility is None
        engine.observe_book_top(top(bid="30000", ask="30010"))
        assert engine.snapshot(as_of_micros=BASE_TS).rolling_volatility is not None

    def test_trades_accumulate_into_tape_features(self) -> None:
        engine = self.make()
        for index in range(2):
            engine.observe_trade(
                PublicTrade(
                    exchange=EXCHANGE,
                    symbol=SYMBOL,
                    trade_id=f"t{index}",
                    price=D("30000"),
                    quantity=D("0.5"),
                    aggressor_side=OrderSide.BUY,
                    exchange_timestamp=BASE_TS + index,
                    received_timestamp=BASE_TS + index,
                )
            )
        snapshot = engine.snapshot(as_of_micros=BASE_TS)
        assert snapshot.trade_count == 2
        assert snapshot.buy_volume == D("1.0")
        assert snapshot.sell_volume == D("0")

    def test_ticker_and_candle_are_observed(self) -> None:
        engine = self.make()
        engine.observe_ticker(
            Ticker(
                exchange=EXCHANGE,
                symbol=SYMBOL,
                bid_price=D("29995"),
                ask_price=D("30005"),
                last_price=D("30000"),
                exchange_timestamp=BASE_TS,
                received_timestamp=BASE_TS,
            )
        )
        engine.observe_trade(
            PublicTrade(
                exchange=EXCHANGE,
                symbol=SYMBOL,
                trade_id="t-last",
                price=D("30005"),
                quantity=D("0.25"),
                aggressor_side=OrderSide.SELL,
                exchange_timestamp=BASE_TS,
                received_timestamp=BASE_TS,
            )
        )
        engine.observe_candle(
            Candle(
                exchange=EXCHANGE,
                symbol=SYMBOL,
                interval="1m",
                open=D("30000"),
                high=D("30010"),
                low=D("29990"),
                close=D("30005"),
                volume=D("12"),
                open_time=BASE_TS,
                close_time=BASE_TS + 60_000_000,
                trade_count=10,
                is_closed=True,
                received_timestamp=BASE_TS,
            )
        )
        snapshot = engine.snapshot(as_of_micros=BASE_TS)
        assert snapshot.last_trade_price == D("30005")

    def test_reset_returns_the_engine_to_its_initial_state(self) -> None:
        engine = self.make()
        engine.observe_book_top(top())
        engine.reset()
        snapshot = engine.snapshot(as_of_micros=BASE_TS)
        assert snapshot.mid_price is None
        assert snapshot.book_update_count == 0
        assert engine.book_top is None

    def test_two_engines_fed_identically_agree_exactly(self) -> None:
        first, second = self.make(), self.make()
        for index in range(6):
            book = top(
                bid=str(29990 + index),
                ask=str(30010 - index),
                timestamp=BASE_TS + index,
            )
            first.observe_book_top(book)
            second.observe_book_top(book)
        assert first.snapshot(as_of_micros=BASE_TS).to_dict() == second.snapshot(
            as_of_micros=BASE_TS
        ).to_dict()

    def test_snapshot_carries_the_event_instant_not_the_wall_clock(self) -> None:
        engine = self.make()
        engine.observe_book_top(top())
        assert engine.snapshot(as_of_micros=BASE_TS).as_of_micros == BASE_TS

    def test_no_feature_is_a_binary_float(self) -> None:
        engine = self.make()
        engine.observe_book_top(top())
        for value in engine.snapshot(as_of_micros=BASE_TS).as_mapping().values():
            assert value is None or isinstance(value, Decimal)
```

---

## FILE: libs/trading-core/tests/test_strategy_engine.py

```py
"""Part 6: strategy registration, parameters, state, lifecycle and validation.

These tests cover the contract that keeps many strategies running side by side
without interfering with one another, and the boundary that stops a strategy
reaching an exchange or authorising its own risk.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from wlct_trading.enums import (
    ExchangeId,
    MarketType,
    OrderType,
    SignalAction,
    SignalRejectionCode,
    StrategyFailurePolicy,
    StrategyStatus,
)
from wlct_trading.market_data import BookTop
from wlct_trading.risk import KillSwitchState
from wlct_trading.signals import Signal, StrategyDescriptor, StrategyRiskProfile
from wlct_trading.strategies import (
    RESERVED_STRATEGY_KEYS,
    CooldownGate,
    ParameterError,
    ParameterSchema,
    ParameterSpec,
    ParameterType,
    SignalDeduplicator,
    SignalValidationConfig,
    SignalValidator,
    Strategy,
    StrategyContext,
    StrategyDefinitionError,
    StrategyEngine,
    StrategyEngineConfig,
    StrategyInstanceKey,
    StrategyNotRegistered,
    StrategyRegistry,
    StrategyRiskView,
    StrategyState,
    StrategyStateError,
    StrategyVersionConflict,
    build_default_strategy_registry,
    signal_identity,
)
from wlct_trading.strategies.implementations import DeterministicImbalanceStrategy

from tests.conftest import BASE_TS, EXCHANGE, SYMBOL

D = Decimal
OTHER_SYMBOL = "ETH-USDT"


def make_descriptor(
    *,
    strategy_id: str = "strategy-1",
    tenant_id: str = "tenant-1",
    version: str = "1.0.0",
    symbols: tuple[str, ...] = (SYMBOL,),
    enabled: bool = True,
) -> StrategyDescriptor:
    return StrategyDescriptor(
        strategy_id=strategy_id,
        tenant_id=tenant_id,
        name="test strategy",
        version=version,
        enabled=enabled,
        exchange=EXCHANGE,
        symbols=symbols,
        risk_profile=StrategyRiskProfile(
            max_order_quantity=D("1"),
            max_position_quantity=D("1"),
            max_order_notional=D("100000"),
            max_daily_loss=D("1000"),
            max_open_orders=5,
            max_orders_per_minute=60,
        ),
    )


def book(
    *,
    bid_qty: str = "9",
    ask_qty: str = "1",
    timestamp: int = BASE_TS,
    symbol: str = SYMBOL,
) -> BookTop:
    return BookTop(
        exchange=EXCHANGE,
        symbol=symbol,
        best_bid=D("29995.00"),
        best_bid_quantity=D(bid_qty),
        best_ask=D("30005.00"),
        best_ask_quantity=D(ask_qty),
        sequence=1,
        exchange_timestamp=timestamp,
        received_timestamp=timestamp,
    )


class AlwaysBuyStrategy(Strategy):
    """Minimal deterministic strategy used as a test fixture."""

    strategy_key = "TEST_ALWAYS_BUY_V1"
    strategy_version = "1.0.0"
    description = "Emits one BUY per event. Test fixture; makes no profit claim."
    parameter_schema = ParameterSchema(
        specs=(
            ParameterSpec(
                name="order_quantity",
                kind=ParameterType.DECIMAL,
                description="Quantity per signal.",
                default=D("0.001"),
                minimum=D("0.000001"),
                maximum=D("1"),
            ),
        )
    )

    def evaluate(self, context: StrategyContext) -> Signal | None:
        if context.features.best_bid is None:
            return None
        return self.build_signal(
            context,
            action=SignalAction.BUY,
            confidence=D("0.5"),
            target_quantity=self.parameters["order_quantity"],
            order_type=OrderType.LIMIT,
            limit_price=context.features.best_bid,
            reason="Test fixture always buys.",
        )


class ExplodingStrategy(Strategy):
    """Raises on every event. Used to prove failure isolation."""

    strategy_key = "TEST_EXPLODING_V1"
    strategy_version = "1.0.0"
    description = "Always raises. Test fixture."

    def evaluate(self, context: StrategyContext) -> Signal | None:
        raise RuntimeError("deliberate strategy failure")


class SilentStrategy(Strategy):
    """Never signals. Proves a quiet strategy is not treated as broken."""

    strategy_key = "TEST_SILENT_V1"
    strategy_version = "1.0.0"
    description = "Emits nothing. Test fixture."

    def evaluate(self, context: StrategyContext) -> Signal | None:
        return None


def available_risk(_key: StrategyInstanceKey) -> StrategyRiskView:
    return StrategyRiskView(
        is_available=True,
        max_position_quantity=D("1"),
        max_order_quantity=D("1"),
    )


def fresh(_key: StrategyInstanceKey) -> tuple[bool, int | None]:
    return (True, 1_000)


def build_engine(
    *,
    policy: StrategyFailurePolicy = StrategyFailurePolicy.STOP_INSTANCE,
    risk_view=available_risk,
    freshness=fresh,
    kill_switches=None,
    cooldown_micros: int = 0,
) -> StrategyEngine:
    return StrategyEngine(
        config=StrategyEngineConfig(
            failure_policy=policy,
            default_cooldown_micros=cooldown_micros,
        ),
        risk_view_provider=risk_view,
        freshness_provider=freshness,
        kill_switch_provider=kill_switches or KillSwitchState,
    )


class TestRegistry:
    """Case 1 and 2: registration and version validation."""

    def test_default_registry_exposes_only_the_example_strategy(self) -> None:
        registry = build_default_strategy_registry()
        assert registry.registry_ids() == ("DETERMINISTIC_IMBALANCE_V1@1.0.0",)

    def test_reserved_keys_are_declared_but_not_implemented(self) -> None:
        registry = build_default_strategy_registry()
        for key in RESERVED_STRATEGY_KEYS:
            assert key not in registry.keys()

    def test_registration_and_lookup_round_trip(self) -> None:
        registry = StrategyRegistry()
        registration = registry.register(AlwaysBuyStrategy)
        assert registration.registry_id == "TEST_ALWAYS_BUY_V1@1.0.0"
        assert registry.has("TEST_ALWAYS_BUY_V1", "1.0.0") is True

    def test_reregistering_the_same_class_is_a_no_op(self) -> None:
        registry = StrategyRegistry()
        first = registry.register(AlwaysBuyStrategy)
        assert registry.register(AlwaysBuyStrategy) is first

    def test_rebinding_a_version_to_another_class_is_refused(self) -> None:
        """Behaviour must not change under an unchanged version string."""

        class Impostor(Strategy):
            strategy_key = AlwaysBuyStrategy.strategy_key
            strategy_version = AlwaysBuyStrategy.strategy_version
            description = "Different implementation, same version. Test fixture."

            def evaluate(self, context: StrategyContext) -> Signal | None:
                return None

        registry = StrategyRegistry()
        registry.register(AlwaysBuyStrategy)
        with pytest.raises(StrategyVersionConflict):
            registry.register(Impostor)

    def test_unknown_strategy_raises(self) -> None:
        registry = StrategyRegistry()
        with pytest.raises(StrategyNotRegistered):
            registry.get("NOPE", "1.0.0")

    def test_a_class_without_a_key_cannot_be_registered(self) -> None:
        class Anonymous(Strategy):
            strategy_version = "1.0.0"

            def evaluate(self, context: StrategyContext) -> Signal | None:
                return None

        registry = StrategyRegistry()
        with pytest.raises(StrategyDefinitionError):
            registry.register(Anonymous)

    def test_descriptor_pinned_to_another_version_is_refused(self) -> None:
        """Behaviour must not change silently under one version string."""
        registry = StrategyRegistry()
        registry.register(AlwaysBuyStrategy)
        with pytest.raises(StrategyDefinitionError):
            registry.create(
                "TEST_ALWAYS_BUY_V1",
                "1.0.0",
                descriptor=make_descriptor(version="9.9.9"),
                symbol=SYMBOL,
            )

    def test_symbol_outside_the_descriptor_is_refused(self) -> None:
        registry = StrategyRegistry()
        registry.register(AlwaysBuyStrategy)
        with pytest.raises(StrategyDefinitionError):
            registry.create(
                "TEST_ALWAYS_BUY_V1",
                "1.0.0",
                descriptor=make_descriptor(),
                symbol=OTHER_SYMBOL,
            )

    def test_describe_disclaims_profitability(self) -> None:
        for entry in build_default_strategy_registry().describe():
            description = str(entry["description"]).lower()
            assert "no profitability claim" in description
            for banned in ("guaranteed profit", "risk-free", "always wins"):
                assert banned not in description


class TestParameters:
    """Case 3: strongly validated parameters."""

    schema = ParameterSchema(
        specs=(
            ParameterSpec(
                name="threshold",
                kind=ParameterType.DECIMAL,
                description="Entry threshold.",
                default=D("0.5"),
                minimum=D("0"),
                maximum=D("1"),
            ),
            ParameterSpec(
                name="lookback",
                kind=ParameterType.INT,
                description="Lookback length.",
                default=20,
                minimum=1,
                maximum=1000,
            ),
        )
    )

    def test_defaults_are_applied(self) -> None:
        values = self.schema.validate(None)
        assert values == {"threshold": D("0.5"), "lookback": 20}

    def test_unknown_key_is_refused(self) -> None:
        with pytest.raises(ParameterError):
            self.schema.validate({"nonsense": 1})

    def test_out_of_range_is_refused(self) -> None:
        with pytest.raises(ParameterError):
            self.schema.validate({"threshold": D("2")})

    def test_float_is_refused_for_a_decimal_parameter(self) -> None:
        with pytest.raises(ParameterError):
            self.schema.validate({"threshold": 0.5})

    def test_credential_shaped_names_are_refused(self) -> None:
        for name in ("api_key", "secret", "private_key", "signing_secret", "password"):
            with pytest.raises(ParameterError):
                ParameterSpec(
                    name=name, kind=ParameterType.STRING, description="x", default="y"
                )

    def test_parameters_are_copied_not_shared(self) -> None:
        strategy = AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL)
        parameters = strategy.parameters
        parameters["order_quantity"] = D("999")
        assert strategy.parameters["order_quantity"] == D("0.001")


class TestInstanceIdentityAndState:
    """Cases 4 and 5: deterministic init and per-instance isolation."""

    def test_instance_id_is_deterministic(self) -> None:
        first = AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL)
        second = AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL)
        assert first.instance_id == second.instance_id

    def test_instance_id_varies_with_every_key_component(self) -> None:
        base = AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL).instance_id
        other_tenant = AlwaysBuyStrategy(
            make_descriptor(tenant_id="tenant-2"), symbol=SYMBOL
        ).instance_id
        other_symbol = AlwaysBuyStrategy(
            make_descriptor(symbols=(SYMBOL, OTHER_SYMBOL)), symbol=OTHER_SYMBOL
        ).instance_id
        other_config = AlwaysBuyStrategy(
            make_descriptor(), symbol=SYMBOL, configuration_version="2"
        ).instance_id
        other_market = AlwaysBuyStrategy(
            make_descriptor(), symbol=SYMBOL, market_type=MarketType.FUTURES_USDT
        ).instance_id
        assert len({base, other_tenant, other_symbol, other_config, other_market}) == 5

    def test_redis_namespace_is_tenant_scoped(self) -> None:
        strategy = AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL)
        assert strategy.key.redis_namespace.startswith("strategy:tenant-1:")

    def test_state_is_isolated_between_instances(self) -> None:
        first = AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL)
        second = AlwaysBuyStrategy(
            make_descriptor(tenant_id="tenant-2"), symbol=SYMBOL
        )
        first.state.set("counter", 5)
        assert second.state.get("counter") is None

    def test_state_snapshot_and_restore_round_trip(self) -> None:
        strategy = AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL)
        strategy.state.set("quantity", D("1.5"))
        strategy.state.set("count", 3)
        strategy.state.set("armed", True)
        strategy.state.set("label", "ready")
        snapshot = strategy.state.snapshot()

        restored = StrategyState(key=strategy.key)
        restored.restore(snapshot)
        assert restored.get_decimal("quantity") == D("1.5")
        assert restored.get_int("count") == 3
        assert restored.get_bool("armed") is True
        assert restored.get("label") == "ready"

    def test_restore_is_all_or_nothing(self) -> None:
        strategy = AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL)
        strategy.state.set("good", 1)
        with pytest.raises(StrategyStateError):
            strategy.state.restore({"good": "i:2", "bad": "unparseable"})
        assert strategy.state.get_int("good") == 1

    def test_initialize_is_deterministic(self) -> None:
        strategy = AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL)
        strategy.initialize()
        strategy.state.set("scratch", 9)
        strategy.initialize()
        assert strategy.state.get("scratch") is None


class TestSignalIdentityAndDedup:
    """Cases 12 and 13: deterministic identity and bounded dedup."""

    def make_signal(self, *, signal_id: str = "sig-1", created_at: int = BASE_TS) -> Signal:
        return Signal(
            signal_id=signal_id,
            tenant_id="tenant-1",
            strategy_id="strategy-1",
            strategy_version="1.0.0",
            exchange=EXCHANGE,
            symbol=SYMBOL,
            action=SignalAction.BUY,
            confidence=D("0.5"),
            reference_price=D("30000"),
            target_quantity=D("0.001"),
            order_type=OrderType.LIMIT,
            limit_price=D("29995"),
            created_at=created_at,
        )

    def test_identity_ignores_timestamp_and_confidence(self) -> None:
        first = self.make_signal(signal_id="a", created_at=BASE_TS)
        second = self.make_signal(signal_id="b", created_at=BASE_TS + 5)
        assert signal_identity(first) == signal_identity(second)

    def test_duplicate_within_ttl_is_detected(self) -> None:
        dedup = SignalDeduplicator(ttl_micros=1_000_000)
        first = dedup.check_and_register(self.make_signal(), now_micros=BASE_TS)
        second = dedup.check_and_register(
            self.make_signal(signal_id="other"), now_micros=BASE_TS + 10
        )
        assert first.is_duplicate is False
        assert second.is_duplicate is True

    def test_the_entry_expires_after_the_ttl(self) -> None:
        dedup = SignalDeduplicator(ttl_micros=1_000)
        dedup.check_and_register(self.make_signal(), now_micros=BASE_TS)
        later = dedup.check_and_register(
            self.make_signal(signal_id="other"), now_micros=BASE_TS + 2_000
        )
        assert later.is_duplicate is False

    def test_capacity_is_bounded(self) -> None:
        dedup = SignalDeduplicator(ttl_micros=10_000_000, capacity=4)
        for index in range(20):
            signal = Signal(
                signal_id=f"sig-{index}",
                tenant_id="tenant-1",
                strategy_id="strategy-1",
                strategy_version="1.0.0",
                exchange=EXCHANGE,
                symbol=SYMBOL,
                action=SignalAction.BUY,
                confidence=D("0.5"),
                reference_price=D("30000"),
                target_quantity=D("0.001") * (index + 1),
                order_type=OrderType.LIMIT,
                limit_price=D("29995"),
                created_at=BASE_TS,
            )
            dedup.check_and_register(signal, now_micros=BASE_TS)
        assert dedup.size <= 4

    def test_cooldown_blocks_then_reopens(self) -> None:
        gate = CooldownGate(cooldown_micros=1_000)
        assert gate.is_open(now_micros=BASE_TS) is True
        gate.record_emission(now_micros=BASE_TS)
        assert gate.is_open(now_micros=BASE_TS + 500) is False
        assert gate.is_open(now_micros=BASE_TS + 1_000) is True


class TestSignalValidation:
    """Case 11: the validator rejects; it never modifies."""

    def make_signal(self, **overrides: object) -> Signal:
        payload: dict[str, object] = {
            "signal_id": "sig-1",
            "tenant_id": "tenant-1",
            "strategy_id": "strategy-1",
            "strategy_version": "1.0.0",
            "exchange": EXCHANGE,
            "symbol": SYMBOL,
            "action": SignalAction.BUY,
            "confidence": D("0.5"),
            "reference_price": D("30000"),
            "target_quantity": D("0.001"),
            "order_type": OrderType.LIMIT,
            "limit_price": D("29995"),
            "created_at": BASE_TS,
        }
        payload.update(overrides)
        return Signal(**payload)  # type: ignore[arg-type]

    def validate(self, signal: Signal, **overrides: object):
        kwargs: dict[str, object] = {
            "now_micros": BASE_TS,
            "instance_id": "strategy-1",
            "tenant_id": "tenant-1",
            "exchange": EXCHANGE,
            "allowed_symbols": frozenset({SYMBOL}),
            "strategy_status": StrategyStatus.RUNNING,
            "strategy_enabled": True,
            "kill_switches": KillSwitchState(),
            "market_data_age_micros": 1_000,
            "market_data_is_fresh": True,
            "risk_state_available": True,
        }
        kwargs.update(overrides)
        return SignalValidator(SignalValidationConfig()).validate(signal, **kwargs)  # type: ignore[arg-type]

    def test_a_good_signal_is_accepted_unmodified(self) -> None:
        signal = self.make_signal()
        result = self.validate(signal)
        assert result.accepted is True
        assert result.code is SignalRejectionCode.ACCEPTED
        assert result.signal is signal

    def test_a_rejected_signal_is_returned_unmodified(self) -> None:
        signal = self.make_signal(tenant_id="tenant-2")
        result = self.validate(signal)
        assert result.accepted is False
        assert result.signal is signal
        assert result.signal.tenant_id == "tenant-2"

    def test_wrong_exchange_is_rejected(self) -> None:
        signal = self.make_signal(exchange=ExchangeId.PAPER)
        assert self.validate(signal).accepted is False

    def test_symbol_outside_the_allow_list_is_rejected(self) -> None:
        result = self.validate(self.make_signal(symbol=OTHER_SYMBOL))
        assert result.code is SignalRejectionCode.SYMBOL_NOT_ALLOWED

    def test_stale_signal_is_rejected(self) -> None:
        result = self.validate(self.make_signal(), now_micros=BASE_TS + 10_000_000)
        assert result.code is SignalRejectionCode.SIGNAL_STALE

    def test_future_signal_is_rejected(self) -> None:
        result = self.validate(self.make_signal(created_at=BASE_TS + 10_000_000))
        assert result.code is SignalRejectionCode.SIGNAL_FROM_FUTURE

    def test_expired_signal_is_rejected(self) -> None:
        signal = self.make_signal(expires_at=BASE_TS + 10)
        result = self.validate(signal, now_micros=BASE_TS + 20)
        assert result.code is SignalRejectionCode.SIGNAL_EXPIRED

    def test_stale_market_data_is_rejected(self) -> None:
        result = self.validate(self.make_signal(), market_data_is_fresh=False)
        assert result.code is SignalRejectionCode.MARKET_DATA_STALE

    def test_unavailable_risk_state_fails_closed(self) -> None:
        result = self.validate(self.make_signal(), risk_state_available=False)
        assert result.accepted is False
        assert result.code is SignalRejectionCode.VALIDATION_STATE_UNAVAILABLE

    def test_kill_switch_blocks_every_signal(self) -> None:
        switches = KillSwitchState(global_engaged=True, reason="drill")
        result = self.validate(self.make_signal(), kill_switches=switches)
        assert result.code is SignalRejectionCode.KILL_SWITCH_ENGAGED

    def test_a_stopped_strategy_cannot_emit(self) -> None:
        result = self.validate(
            self.make_signal(), strategy_status=StrategyStatus.STOPPED
        )
        assert result.code is SignalRejectionCode.STRATEGY_NOT_RUNNING

    def test_missing_strategy_version_is_rejected(self) -> None:
        result = self.validate(self.make_signal(strategy_version=""))
        assert result.code is SignalRejectionCode.STRATEGY_VERSION_MISSING

    def test_hold_is_accepted_even_when_risk_state_is_unavailable(self) -> None:
        """A HOLD asks for nothing, so refusing it would be theatre."""
        signal = self.make_signal(
            action=SignalAction.HOLD, target_quantity=None, limit_price=None
        )
        result = self.validate(signal, risk_state_available=False)
        assert result.accepted is True


class TestEngineLifecycleAndIsolation:
    """Cases 4, 5, 14, 15: lifecycle, multi-strategy isolation, failure policy."""

    def test_instances_start_and_stop(self) -> None:
        engine = build_engine()
        instance = engine.add(AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL))
        assert instance.status is StrategyStatus.CREATED
        engine.start_all(now_micros=BASE_TS)
        assert instance.status is StrategyStatus.RUNNING
        engine.stop_all(now_micros=BASE_TS + 1)
        assert instance.status is StrategyStatus.STOPPED

    def test_a_running_instance_emits_an_accepted_signal(self) -> None:
        engine = build_engine()
        engine.add(AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL))
        engine.start_all(now_micros=BASE_TS)
        outcomes = engine.dispatch_book_top(book())
        assert len(outcomes) == 1
        assert outcomes[0].accepted is True
        assert outcomes[0].signal.action is SignalAction.BUY

    def test_a_stopped_instance_receives_nothing(self) -> None:
        engine = build_engine()
        engine.add(AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL))
        assert engine.dispatch_book_top(book()) == ()

    def test_one_failure_does_not_stop_the_others(self) -> None:
        engine = build_engine()
        good = engine.add(AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL))
        bad = engine.add(
            ExplodingStrategy(make_descriptor(strategy_id="strategy-2"), symbol=SYMBOL)
        )
        engine.start_all(now_micros=BASE_TS)

        outcomes = engine.dispatch_book_top(book())

        assert bad.status is StrategyStatus.FAILED
        assert bad.is_healthy is False
        assert good.status is StrategyStatus.RUNNING
        assert [outcome.instance_id for outcome in outcomes] == [good.instance_id]
        assert engine.metrics.counters.strategy_errors >= 1

    def test_a_failed_instance_stays_stopped_until_cleared(self) -> None:
        engine = build_engine()
        bad = engine.add(ExplodingStrategy(make_descriptor(), symbol=SYMBOL))
        engine.start_all(now_micros=BASE_TS)
        engine.dispatch_book_top(book())
        engine.dispatch_book_top(book(timestamp=BASE_TS + 1))
        assert bad.error_count == 1  # not dispatched to a second time

    def test_halt_all_policy_stops_every_instance(self) -> None:
        engine = build_engine(policy=StrategyFailurePolicy.HALT_ALL)
        good = engine.add(AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL))
        engine.add(
            ExplodingStrategy(make_descriptor(strategy_id="strategy-2"), symbol=SYMBOL)
        )
        engine.start_all(now_micros=BASE_TS)
        engine.dispatch_book_top(book())
        assert engine.is_halted is True
        assert good.status is not StrategyStatus.RUNNING
        assert engine.dispatch_book_top(book(timestamp=BASE_TS + 1)) == ()

    def test_clear_failure_resets_state_before_restart(self) -> None:
        engine = build_engine()
        bad = engine.add(ExplodingStrategy(make_descriptor(), symbol=SYMBOL))
        engine.start_all(now_micros=BASE_TS)
        engine.dispatch_book_top(book())
        bad.clear_failure()
        assert bad.last_failure is None
        assert bad.status is StrategyStatus.INITIALISED

    def test_state_of_one_instance_is_untouched_by_another_failing(self) -> None:
        engine = build_engine()
        good = engine.add(AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL))
        engine.add(
            ExplodingStrategy(make_descriptor(strategy_id="strategy-2"), symbol=SYMBOL)
        )
        engine.start_all(now_micros=BASE_TS)
        good.strategy.state.set("marker", 42)
        engine.dispatch_book_top(book())
        assert good.strategy.state.get_int("marker") == 42

    def test_events_are_delivered_in_order_to_each_instance(self) -> None:
        engine = build_engine()
        instance = engine.add(AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL))
        engine.start_all(now_micros=BASE_TS)
        for index in range(5):
            engine.dispatch_book_top(book(timestamp=BASE_TS + index))
        assert instance.event_count == 5

    def test_a_symbol_only_reaches_its_own_instances(self) -> None:
        engine = build_engine()
        engine.add(
            AlwaysBuyStrategy(
                make_descriptor(symbols=(SYMBOL, OTHER_SYMBOL)), symbol=OTHER_SYMBOL
            )
        )
        engine.start_all(now_micros=BASE_TS)
        assert engine.dispatch_book_top(book(symbol=SYMBOL)) == ()

    def test_dedup_suppresses_a_repeated_identical_signal(self) -> None:
        engine = build_engine()
        engine.add(AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL))
        engine.start_all(now_micros=BASE_TS)
        first = engine.dispatch_book_top(book())
        second = engine.dispatch_book_top(book(timestamp=BASE_TS + 1))
        assert first[0].accepted is True
        assert second[0].accepted is False
        assert second[0].rejection_code is SignalRejectionCode.DUPLICATE_SIGNAL

    def test_silent_strategy_produces_no_outcome_and_no_error(self) -> None:
        engine = build_engine()
        instance = engine.add(SilentStrategy(make_descriptor(), symbol=SYMBOL))
        engine.start_all(now_micros=BASE_TS)
        assert engine.dispatch_book_top(book()) == ()
        assert instance.error_count == 0

    def test_metrics_count_events_and_signals(self) -> None:
        engine = build_engine()
        engine.add(AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL))
        engine.start_all(now_micros=BASE_TS)
        engine.dispatch_book_top(book())
        counters = engine.metrics.counters
        assert counters.events_processed >= 1
        assert counters.signals_generated >= 1
        assert counters.signals_accepted >= 1


class TestRiskAndCredentialBoundary:
    """Cases 29 and 30: no risk bypass, no credentials in the context."""

    def test_default_risk_provider_fails_closed(self) -> None:
        """With no risk provider wired, actionable signals must be refused."""
        engine = StrategyEngine(
            config=StrategyEngineConfig(default_cooldown_micros=0),
            freshness_provider=fresh,
        )
        engine.add(AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL))
        engine.start_all(now_micros=BASE_TS)
        outcomes = engine.dispatch_book_top(book())
        assert outcomes[0].accepted is False
        assert outcomes[0].rejection_code is SignalRejectionCode.VALIDATION_STATE_UNAVAILABLE

    def test_risk_view_cannot_authorise_anything(self) -> None:
        view = StrategyRiskView(is_available=True, max_position_quantity=D("1"))
        for forbidden in ("approve", "authorise", "authorize", "override", "submit"):
            assert not hasattr(view, forbidden)

    def test_risk_view_headroom_is_never_negative(self) -> None:
        view = StrategyRiskView(
            is_available=True,
            max_position_quantity=D("1"),
            current_position_quantity=D("5"),
        )
        assert view.available_position_budget == D("0")

    def test_unknown_limits_do_not_mean_unlimited(self) -> None:
        view = StrategyRiskView(is_available=True)
        assert view.available_position_budget is None

    def test_the_context_carries_no_credential_field(self) -> None:
        engine = build_engine()
        instance = engine.add(AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL))
        engine.start_all(now_micros=BASE_TS)
        engine.dispatch_book_top(book())
        context = instance.strategy.last_context
        assert context is not None
        banned = (
            "api_key", "apikey", "secret", "token", "credential", "password",
            "signature", "private",
        )
        for field_name in getattr(type(context), "__slots__", ()) or ():
            assert not any(word in field_name.lower() for word in banned)
        rendered = str(context.to_log_fields()).lower()
        for word in ("secret", "apikey", "api_key", "private_key", "password"):
            assert word not in rendered

    def test_a_strategy_has_no_adapter_and_no_submit_method(self) -> None:
        strategy = AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL)
        for forbidden in ("submit_order", "adapter", "client", "api_key", "secret"):
            assert not hasattr(strategy, forbidden)

    def test_no_strategy_module_imports_an_exchange_adapter(self) -> None:
        """Structural: the strategy layer cannot reach a venue."""
        import pathlib

        root = pathlib.Path(__file__).resolve().parents[1] / "wlct_trading" / "strategies"
        for path in root.rglob("*.py"):
            imports = [
                line
                for line in path.read_text(encoding="utf-8").splitlines()
                if line.startswith(("import ", "from "))
            ]
            for line in imports:
                assert "wlct_trading.adapters" not in line, f"{path}: {line}"
                assert "wlct_trading.net" not in line, f"{path}: {line}"
                assert "wlct_trading.execution" not in line, f"{path}: {line}"


class TestDeterministicExampleStrategy:
    """Case 10: the example strategy emits signals deterministically."""

    def build(self, **parameters: object) -> DeterministicImbalanceStrategy:
        registry = build_default_strategy_registry()
        strategy = registry.create(
            "DETERMINISTIC_IMBALANCE_V1",
            "1.0.0",
            descriptor=make_descriptor(),
            symbol=SYMBOL,
            parameters=parameters or None,
        )
        assert isinstance(strategy, DeterministicImbalanceStrategy)
        return strategy

    def test_it_buys_when_the_bid_dominates(self) -> None:
        engine = build_engine()
        engine.add(self.build(signal_cooldown_micros=0))
        engine.start_all(now_micros=BASE_TS)
        outcomes = engine.dispatch_book_top(book(bid_qty="9", ask_qty="1"))
        assert outcomes and outcomes[0].signal.action is SignalAction.BUY

    def test_it_sells_when_the_ask_dominates(self) -> None:
        engine = build_engine()
        engine.add(self.build(signal_cooldown_micros=0))
        engine.start_all(now_micros=BASE_TS)
        outcomes = engine.dispatch_book_top(book(bid_qty="1", ask_qty="9"))
        assert outcomes and outcomes[0].signal.action is SignalAction.SELL

    def test_it_is_silent_on_a_balanced_book(self) -> None:
        engine = build_engine()
        engine.add(self.build(signal_cooldown_micros=0))
        engine.start_all(now_micros=BASE_TS)
        assert engine.dispatch_book_top(book(bid_qty="1", ask_qty="1")) == ()

    def test_exit_threshold_must_be_below_entry(self) -> None:
        with pytest.raises(Exception):
            strategy = self.build(entry_threshold=D("0.2"), exit_threshold=D("0.6"))
            strategy.initialize()

    def test_confidence_is_bounded_and_not_a_probability(self) -> None:
        engine = build_engine()
        engine.add(self.build(signal_cooldown_micros=0))
        engine.start_all(now_micros=BASE_TS)
        outcomes = engine.dispatch_book_top(book(bid_qty="9", ask_qty="1"))
        confidence = outcomes[0].signal.confidence
        assert D("0") <= confidence <= D("1")

    def test_signal_ids_repeat_across_identical_replays(self) -> None:
        ids: list[tuple[str, ...]] = []
        for _ in range(2):
            engine = build_engine()
            engine.add(self.build(signal_cooldown_micros=0))
            engine.start_all(now_micros=BASE_TS)
            emitted: list[str] = []
            for index in range(4):
                for outcome in engine.dispatch_book_top(
                    book(
                        bid_qty="9" if index % 2 == 0 else "1",
                        ask_qty="1" if index % 2 == 0 else "9",
                        timestamp=BASE_TS + index,
                    )
                ):
                    emitted.append(outcome.signal.signal_id)
            ids.append(tuple(emitted))
        assert ids[0] == ids[1]
```

---

## FILE: libs/trading-core/tests/test_backtest.py

```py
"""Part 6: replay, simulated execution, portfolio accounting and results.

The determinism and no-look-ahead tests here are the load-bearing ones. A
backtest that is not reproducible is not evidence of anything, and a backtest
that can see the future is worse than no backtest at all because it produces
confident nonsense.

Nothing in this file touches the network, a credential, a database or a real
order. The dataset is constructed in memory from fixed Decimals.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from wlct_trading.backtest import (
    BacktestConfig,
    BacktestEngine,
    DatasetError,
    ExecutionAssumptions,
    HistoricalDataset,
    LookAheadError,
    MarketEvent,
    ReplayEngine,
    SimulatedClock,
    SimulatedIdFactory,
    SimulatedMatchingEngine,
    SimulatedPortfolio,
    compute_configuration_hash,
    compute_dataset_checksum,
    rolling_windows,
    split_dataset,
)
from wlct_trading.backtest.clock import ClockError
from wlct_trading.enums import (
    BacktestPhase,
    MarketEventKind,
    OrderSide,
    OrderStatus,
    OrderType,
)
from wlct_trading.market_data import BookTop, OrderBookSnapshot, PriceLevel, PublicTrade
from wlct_trading.orders import Fill, OrderIntent
from wlct_trading.risk import RiskLimits
from wlct_trading.signals import StrategyDescriptor, StrategyRiskProfile
from wlct_trading.strategies import build_default_strategy_registry

from tests.conftest import BASE_TS, EXCHANGE, SYMBOL

D = Decimal


# ---------------------------------------------------------------------------
# Builders
# ---------------------------------------------------------------------------
def snapshot_event(
    index: int,
    *,
    bid_qty: str,
    ask_qty: str,
    bid: str = "29995",
    ask: str = "30005",
    step_micros: int = 1_000_000,
) -> MarketEvent:
    timestamp = BASE_TS + index * step_micros
    return MarketEvent(
        kind=MarketEventKind.BOOK_SNAPSHOT,
        timestamp_micros=timestamp,
        sequence=index,
        payload=OrderBookSnapshot(
            exchange=EXCHANGE,
            symbol=SYMBOL,
            bids=(
                PriceLevel(price=D(bid), quantity=D(bid_qty)),
                PriceLevel(price=D(bid) - D("5"), quantity=D("2")),
            ),
            asks=(
                PriceLevel(price=D(ask), quantity=D(ask_qty)),
                PriceLevel(price=D(ask) + D("5"), quantity=D("2")),
            ),
            last_update_id=1_000 + index,
            exchange_timestamp=timestamp,
            received_timestamp=timestamp + 500,
        ),
    )


def trade_event(index: int, *, price: str) -> MarketEvent:
    timestamp = BASE_TS + index * 1_000_000
    return MarketEvent(
        kind=MarketEventKind.TRADE,
        timestamp_micros=timestamp,
        sequence=index,
        payload=PublicTrade(
            exchange=EXCHANGE,
            symbol=SYMBOL,
            trade_id=f"trade-{index}",
            price=D(price),
            quantity=D("0.5"),
            aggressor_side=OrderSide.BUY,
            exchange_timestamp=timestamp,
            received_timestamp=timestamp,
        ),
    )


def oscillating_dataset(count: int = 40) -> HistoricalDataset:
    """Bid-heavy, balanced and ask-heavy books in a fixed repeating cycle."""
    events: list[MarketEvent] = []
    for index in range(count):
        phase = index % 10
        if phase < 4:
            events.append(snapshot_event(index, bid_qty="9", ask_qty="1"))
        elif phase < 7:
            events.append(snapshot_event(index, bid_qty="1", ask_qty="1"))
        else:
            events.append(snapshot_event(index, bid_qty="1", ask_qty="9"))
    return HistoricalDataset.from_events(
        events,
        dataset_id="oscillating-1",
        source="unit-test-fixture",
        granularity="book_snapshot",
    )


def descriptor() -> StrategyDescriptor:
    return StrategyDescriptor(
        strategy_id="strategy-1",
        tenant_id="tenant-1",
        name="deterministic example",
        version="1.0.0",
        enabled=True,
        exchange=EXCHANGE,
        symbols=(SYMBOL,),
        risk_profile=StrategyRiskProfile(
            max_order_quantity=D("1"),
            max_position_quantity=D("1"),
            max_order_notional=D("100000"),
            max_daily_loss=D("1000"),
            max_open_orders=5,
            max_orders_per_minute=600,
        ),
    )


def permissive() -> RiskLimits:
    return RiskLimits(
        max_order_quantity=D("1"),
        max_order_notional=D("1000000"),
        max_position_quantity=D("1"),
        max_symbol_exposure_notional=D("1000000"),
        max_account_exposure_notional=D("1000000"),
        max_open_orders=50,
        max_orders_per_minute=600,
        max_daily_loss=D("100000"),
        max_strategy_loss=D("100000"),
        max_price_deviation_percent=D("100"),
        max_market_data_age_micros=60_000_000,
    )


def build_backtest(
    dataset: HistoricalDataset,
    *,
    assumptions: ExecutionAssumptions | None = None,
    initial_capital: str = "10000",
    limits: RiskLimits | None = None,
    parameters: dict[str, object] | None = None,
) -> BacktestEngine:
    registry = build_default_strategy_registry()
    strategy = registry.create(
        "DETERMINISTIC_IMBALANCE_V1",
        "1.0.0",
        descriptor=descriptor(),
        symbol=SYMBOL,
        parameters=parameters
        or {"use_limit_orders": False, "signal_cooldown_micros": 0},
    )
    return BacktestEngine(
        strategy=strategy,
        dataset=dataset,
        config=BacktestConfig(
            tenant_id="tenant-1",
            account_id="account-1",
            initial_capital=D(initial_capital),
            assumptions=assumptions or ExecutionAssumptions(),
            risk_limits=limits if limits is not None else permissive(),
        ),
    )


def book(
    *, bid_qty: str = "5", ask_qty: str = "5", bid: str = "29995", ask: str = "30005"
) -> BookTop:
    return BookTop(
        exchange=EXCHANGE,
        symbol=SYMBOL,
        best_bid=D(bid),
        best_bid_quantity=D(bid_qty),
        best_ask=D(ask),
        best_ask_quantity=D(ask_qty),
        sequence=1,
        exchange_timestamp=BASE_TS,
        received_timestamp=BASE_TS,
    )


def intent(
    *,
    side: OrderSide = OrderSide.BUY,
    order_type: OrderType = OrderType.MARKET,
    quantity: str = "1",
    price: str | None = None,
) -> OrderIntent:
    return OrderIntent(
        tenant_id="tenant-1",
        account_id="account-1",
        strategy_id="strategy-1",
        exchange=EXCHANGE,
        symbol=SYMBOL,
        side=side,
        order_type=order_type,
        quantity=D(quantity),
        price=D(price) if price is not None else None,
        created_at=BASE_TS,
    )


# ---------------------------------------------------------------------------
# Clock, dataset, replay
# ---------------------------------------------------------------------------
class TestSimulatedClock:
    def test_clock_starts_where_told(self) -> None:
        assert SimulatedClock(start_micros=BASE_TS).now_micros() == BASE_TS

    def test_clock_refuses_to_move_backwards(self) -> None:
        clock = SimulatedClock(start_micros=BASE_TS)
        clock.advance_to(BASE_TS + 10)
        with pytest.raises(ClockError):
            clock.advance_to(BASE_TS + 9)

    def test_repeating_an_instant_is_allowed(self) -> None:
        clock = SimulatedClock(start_micros=BASE_TS)
        clock.advance_to(BASE_TS)
        clock.advance_to(BASE_TS)
        assert clock.advance_count == 2

    def test_reset_returns_to_the_start(self) -> None:
        clock = SimulatedClock(start_micros=BASE_TS)
        clock.advance_to(BASE_TS + 1_000)
        clock.reset()
        assert clock.now_micros() == BASE_TS


class TestDatasetIdentification:
    """Case 27: a run must be able to say exactly what data it used."""

    def test_descriptor_records_the_window_and_count(self) -> None:
        dataset = oscillating_dataset(10)
        assert dataset.descriptor.event_count == 10
        assert dataset.descriptor.start_micros == BASE_TS
        assert dataset.descriptor.symbol == SYMBOL
        assert dataset.descriptor.exchange is EXCHANGE
        assert dataset.descriptor.granularity == "book_snapshot"

    def test_checksum_is_stable_across_input_order(self) -> None:
        events = [snapshot_event(index, bid_qty="5", ask_qty="5") for index in range(6)]
        forward = compute_dataset_checksum(events)
        backward = compute_dataset_checksum(list(reversed(events)))
        assert forward == backward

    def test_checksum_changes_when_a_price_changes(self) -> None:
        base = [snapshot_event(index, bid_qty="5", ask_qty="5") for index in range(4)]
        altered = base[:-1] + [snapshot_event(3, bid_qty="5", ask_qty="6")]
        assert compute_dataset_checksum(base) != compute_dataset_checksum(altered)

    def test_a_dataset_without_a_checksum_is_not_reproducible(self) -> None:
        dataset = oscillating_dataset(4)
        descriptor_without = type(dataset.descriptor)(
            dataset_id="x",
            source="y",
            exchange=EXCHANGE,
            symbol=SYMBOL,
            market_type=dataset.descriptor.market_type,
            start_micros=BASE_TS,
            end_micros=BASE_TS + 1,
            granularity="event",
            event_count=4,
            checksum=None,
        )
        assert descriptor_without.is_reproducible is False

    def test_mixed_symbols_are_refused(self) -> None:
        other = snapshot_event(0, bid_qty="1", ask_qty="1")
        mismatched = MarketEvent(
            kind=MarketEventKind.TRADE,
            timestamp_micros=BASE_TS,
            payload=PublicTrade(
                exchange=EXCHANGE,
                symbol="ETH-USDT",
                trade_id="t",
                price=D("2000"),
                quantity=D("1"),
                aggressor_side=OrderSide.BUY,
                exchange_timestamp=BASE_TS,
                received_timestamp=BASE_TS,
            ),
        )
        with pytest.raises(DatasetError):
            HistoricalDataset.from_events(
                [other, mismatched], dataset_id="bad", source="test"
            )

    def test_an_empty_dataset_is_refused(self) -> None:
        with pytest.raises(DatasetError):
            HistoricalDataset.from_events([], dataset_id="empty", source="test")


class TestReplayOrdering:
    """Case 16 and 17: deterministic ordering and no look-ahead."""

    def test_events_arrive_in_timestamp_order(self) -> None:
        dataset = oscillating_dataset(12)
        replay = ReplayEngine(dataset)
        seen = [event.timestamp_micros for event in replay.events()]
        assert seen == sorted(seen)

    def test_ties_are_broken_by_kind_then_sequence(self) -> None:
        """A book update must be applied before a trade at the same instant."""
        book_event = snapshot_event(0, bid_qty="1", ask_qty="1")
        trade = trade_event(0, price="30000")
        dataset = HistoricalDataset.from_events(
            [trade, book_event], dataset_id="tie", source="test"
        )
        kinds = [event.kind for event in dataset]
        assert kinds == [MarketEventKind.BOOK_SNAPSHOT, MarketEventKind.TRADE]

    def test_clock_matches_the_event_being_delivered(self) -> None:
        dataset = oscillating_dataset(5)
        replay = ReplayEngine(dataset)
        for event in replay.events():
            assert replay.clock.now_micros() == event.timestamp_micros

    def test_cursor_cannot_see_the_future(self) -> None:
        dataset = oscillating_dataset(5)
        replay = ReplayEngine(dataset)
        iterator = replay.events()
        first = next(iterator)
        history = replay.cursor.history()
        assert len(history) == 1
        assert history[0] is first
        with pytest.raises(LookAheadError):
            replay.cursor.assert_not_future(first.timestamp_micros + 1)

    def test_history_never_exceeds_its_limit(self) -> None:
        dataset = oscillating_dataset(30)
        replay = ReplayEngine(dataset, history_limit=5)
        for _ in replay.events():
            pass
        assert len(replay.cursor.history()) <= 5

    def test_timer_ticks_fire_between_events(self) -> None:
        dataset = oscillating_dataset(6)
        replay = ReplayEngine(dataset, timer_interval_micros=2_000_000)
        ticks: list[int] = []
        stats = replay.run(on_event=lambda event, cursor: None, on_timer=ticks.append)
        assert stats.timer_ticks == len(ticks) > 0
        assert ticks == sorted(ticks)

    def test_reset_replays_the_identical_sequence(self) -> None:
        dataset = oscillating_dataset(8)
        replay = ReplayEngine(dataset)
        first = [event.checksum_source() for event in replay.events()]
        replay.reset()
        second = [event.checksum_source() for event in replay.events()]
        assert first == second


# ---------------------------------------------------------------------------
# Simulated execution
# ---------------------------------------------------------------------------
class TestSimulatedExecution:
    """Cases 18-21: market and limit execution, fees, slippage."""

    def engine(self, **kwargs: object) -> SimulatedMatchingEngine:
        return SimulatedMatchingEngine(
            ExecutionAssumptions(**kwargs),  # type: ignore[arg-type]
            id_factory=SimulatedIdFactory(prefix="test"),
        )

    def test_market_buy_lifts_the_observed_ask(self) -> None:
        match = self.engine().submit(
            intent(quantity="1"),
            client_order_id="c1",
            order_id="o1",
            book=book(),
            now_micros=BASE_TS,
        )
        assert match.status is OrderStatus.FILLED
        assert match.fills[0].price == D("30005")
        assert match.fills[0].is_simulated is True

    def test_market_sell_hits_the_observed_bid(self) -> None:
        match = self.engine().submit(
            intent(side=OrderSide.SELL),
            client_order_id="c1",
            order_id="o1",
            book=book(),
            now_micros=BASE_TS,
        )
        assert match.fills[0].price == D("29995")

    def test_no_book_means_no_invented_fill(self) -> None:
        match = self.engine().submit(
            intent(), client_order_id="c1", order_id="o1", book=None, now_micros=BASE_TS
        )
        assert match.fills == ()
        assert match.rests is True

    def test_non_marketable_limit_rests(self) -> None:
        match = self.engine().submit(
            intent(order_type=OrderType.LIMIT, price="29000"),
            client_order_id="c1",
            order_id="o1",
            book=book(),
            now_micros=BASE_TS,
        )
        assert match.fills == ()
        assert match.rests is True
        assert match.status is OrderStatus.ACKNOWLEDGED

    def test_marketable_limit_gets_price_improvement(self) -> None:
        match = self.engine().submit(
            intent(order_type=OrderType.LIMIT, price="30100"),
            client_order_id="c1",
            order_id="o1",
            book=book(),
            now_micros=BASE_TS,
        )
        assert match.fills[0].price == D("30005")

    def test_a_resting_bid_fills_when_the_ask_comes_down(self) -> None:
        engine = self.engine()
        engine.submit(
            intent(order_type=OrderType.LIMIT, price="29000"),
            client_order_id="c1",
            order_id="o1",
            book=book(),
            now_micros=BASE_TS,
        )
        assert engine.resting_count == 1
        events = engine.on_book_update(
            book(bid="28900", ask="28950"), now_micros=BASE_TS + 1_000
        )
        assert len(events) == 1
        assert events[0].fill.is_maker is True
        assert engine.resting_count == 0

    def test_a_crossed_book_produces_no_resting_fill(self) -> None:
        engine = self.engine()
        engine.submit(
            intent(order_type=OrderType.LIMIT, price="29000"),
            client_order_id="c1",
            order_id="o1",
            book=book(),
            now_micros=BASE_TS,
        )
        crossed = BookTop(
            exchange=EXCHANGE,
            symbol=SYMBOL,
            best_bid=D("30010"),
            best_bid_quantity=D("1"),
            best_ask=D("28000"),
            best_ask_quantity=D("1"),
            sequence=2,
            exchange_timestamp=BASE_TS,
            received_timestamp=BASE_TS,
        )
        assert engine.on_book_update(crossed, now_micros=BASE_TS + 10) == ()

    def test_fill_is_capped_by_displayed_size(self) -> None:
        match = self.engine().submit(
            intent(quantity="10"),
            client_order_id="c1",
            order_id="o1",
            book=book(ask_qty="1.5"),
            now_micros=BASE_TS,
        )
        assert match.fills[0].quantity == D("1.5")
        assert match.status is OrderStatus.PARTIALLY_FILLED

    def test_partial_fills_can_be_disabled(self) -> None:
        match = self.engine(allow_partial_fills=False).submit(
            intent(quantity="10"),
            client_order_id="c1",
            order_id="o1",
            book=book(ask_qty="1.5"),
            now_micros=BASE_TS,
        )
        assert match.fills == ()

    def test_min_fill_quantity_suppresses_dust(self) -> None:
        match = self.engine(min_fill_quantity=D("2")).submit(
            intent(quantity="1"),
            client_order_id="c1",
            order_id="o1",
            book=book(ask_qty="1"),
            now_micros=BASE_TS,
        )
        assert match.fills == ()

    def test_taker_and_maker_fees_are_separate(self) -> None:
        engine = self.engine(
            maker_fee_rate=D("0.0001"), taker_fee_rate=D("0.001")
        )
        taker = engine.submit(
            intent(quantity="1"),
            client_order_id="c1",
            order_id="o1",
            book=book(),
            now_micros=BASE_TS,
        )
        assert taker.fills[0].is_maker is False
        assert taker.fills[0].fee == D("30005") * D("1") * D("0.001")

        engine.submit(
            intent(order_type=OrderType.LIMIT, price="29000"),
            client_order_id="c2",
            order_id="o2",
            book=book(),
            now_micros=BASE_TS,
        )
        maker_events = engine.on_book_update(
            book(bid="28900", ask="28950"), now_micros=BASE_TS + 10
        )
        maker_fill = maker_events[0].fill
        assert maker_fill.is_maker is True
        assert maker_fill.fee == maker_fill.price * maker_fill.quantity * D("0.0001")

    def test_slippage_worsens_the_taker_price_on_both_sides(self) -> None:
        engine = self.engine(slippage_bps=D("10"))
        buy = engine.submit(
            intent(),
            client_order_id="c1",
            order_id="o1",
            book=book(),
            now_micros=BASE_TS,
        )
        sell = engine.submit(
            intent(side=OrderSide.SELL),
            client_order_id="c2",
            order_id="o2",
            book=book(),
            now_micros=BASE_TS,
        )
        assert buy.fills[0].price > D("30005")
        assert sell.fills[0].price < D("29995")
        assert buy.slippage_cost > D("0")

    def test_zero_slippage_leaves_the_touch_untouched(self) -> None:
        match = self.engine(slippage_bps=D("0")).submit(
            intent(),
            client_order_id="c1",
            order_id="o1",
            book=book(),
            now_micros=BASE_TS,
        )
        assert match.fills[0].price == D("30005")
        assert match.slippage_cost == D("0")

    def test_latency_prevents_filling_against_the_submission_book(self) -> None:
        engine = self.engine(latency_micros=500_000)
        match = engine.submit(
            intent(),
            client_order_id="c1",
            order_id="o1",
            book=book(),
            now_micros=BASE_TS,
        )
        assert match.fills == ()
        assert engine.on_book_update(book(), now_micros=BASE_TS + 100) == ()
        events = engine.on_book_update(book(), now_micros=BASE_TS + 500_000)
        assert len(events) == 1

    def test_every_fill_is_flagged_simulated(self) -> None:
        engine = self.engine()
        match = engine.submit(
            intent(),
            client_order_id="c1",
            order_id="o1",
            book=book(),
            now_micros=BASE_TS,
        )
        assert all(fill.is_simulated for fill in match.fills)
        assert match.is_simulated is True

    def test_ids_are_deterministic(self) -> None:
        first = self.engine().submit(
            intent(),
            client_order_id="c1",
            order_id="o1",
            book=book(),
            now_micros=BASE_TS,
        )
        second = self.engine().submit(
            intent(),
            client_order_id="c1",
            order_id="o1",
            book=book(),
            now_micros=BASE_TS,
        )
        assert first.fills[0].fill_id == second.fills[0].fill_id

    def test_a_structurally_invalid_intent_is_rejected(self) -> None:
        broken = intent(quantity="1")
        broken.quantity = D("-1")
        match = self.engine().submit(
            broken,
            client_order_id="c1",
            order_id="o1",
            book=book(),
            now_micros=BASE_TS,
        )
        assert match.accepted is False
        assert match.status is OrderStatus.REJECTED

    def test_assumptions_reject_a_percentage_style_fee(self) -> None:
        with pytest.raises(ValueError):
            ExecutionAssumptions(taker_fee_rate=D("10"))

    def test_assumptions_reject_negative_slippage(self) -> None:
        with pytest.raises(ValueError):
            ExecutionAssumptions(slippage_bps=D("-1"))


# ---------------------------------------------------------------------------
# Portfolio
# ---------------------------------------------------------------------------
class TestSimulatedPortfolio:
    """Cases 22-24: portfolio accounting, PnL and drawdown."""

    def make(self, cash: str = "10000") -> SimulatedPortfolio:
        return SimulatedPortfolio(
            initial_cash=D(cash),
            tenant_id="tenant-1",
            account_id="account-1",
            exchange=EXCHANGE,
            symbol=SYMBOL,
        )

    def fill(
        self,
        *,
        side: OrderSide,
        price: str,
        quantity: str,
        fee: str = "0",
        index: int = 0,
    ) -> Fill:
        return Fill(
            fill_id=f"sim-fill-{index}",
            order_id=f"sim-order-{index}",
            trade_id=f"sim-trade-{index}",
            price=D(price),
            quantity=D(quantity),
            fee=D(fee),
            fee_currency="USDT",
            is_maker=False,
            is_simulated=True,
            exchange_timestamp=BASE_TS + index,
            received_timestamp=BASE_TS + index,
            symbol=SYMBOL,
            side=side,
            exchange=EXCHANGE,
        )

    def test_a_buy_spends_cash_and_adds_exposure(self) -> None:
        portfolio = self.make()
        portfolio.apply_fill(
            self.fill(side=OrderSide.BUY, price="30000", quantity="0.1", fee="3")
        )
        assert portfolio.cash == D("10000") - D("3000") - D("3")
        assert portfolio.base_quantity == D("0.1")
        assert portfolio.fees_paid == D("3")

    def test_a_round_trip_realises_pnl_net_of_fees(self) -> None:
        portfolio = self.make()
        portfolio.apply_fill(
            self.fill(side=OrderSide.BUY, price="30000", quantity="0.1", fee="3", index=0)
        )
        portfolio.apply_fill(
            self.fill(side=OrderSide.SELL, price="31000", quantity="0.1", fee="3", index=1)
        )
        assert portfolio.realised_pnl == D("100")
        assert portfolio.net_pnl == D("94")
        assert portfolio.base_quantity == D("0")
        assert len(portfolio.closed_trades) == 1
        assert portfolio.closed_trades[0].is_win is True

    def test_a_losing_round_trip_is_recorded_as_a_loss(self) -> None:
        portfolio = self.make()
        portfolio.apply_fill(
            self.fill(side=OrderSide.BUY, price="30000", quantity="0.1", index=0)
        )
        portfolio.apply_fill(
            self.fill(side=OrderSide.SELL, price="29000", quantity="0.1", index=1)
        )
        assert portfolio.realised_pnl == D("-100")
        assert portfolio.closed_trades[0].is_win is False

    def test_a_fee_only_trade_counts_as_a_loss(self) -> None:
        """Break-even before costs is a loss after them."""
        portfolio = self.make()
        portfolio.apply_fill(
            self.fill(side=OrderSide.BUY, price="30000", quantity="0.1", index=0)
        )
        portfolio.apply_fill(
            self.fill(side=OrderSide.SELL, price="30000", quantity="0.1", fee="1", index=1)
        )
        assert portfolio.closed_trades[0].is_win is False

    def test_unrealised_pnl_is_none_when_flat(self) -> None:
        assert self.make().unrealised_pnl is None

    def test_unrealised_pnl_follows_the_mark(self) -> None:
        portfolio = self.make()
        portfolio.apply_fill(
            self.fill(side=OrderSide.BUY, price="30000", quantity="0.1")
        )
        portfolio.mark_to_market(timestamp_micros=BASE_TS, mark_price=D("31000"))
        assert portfolio.unrealised_pnl == D("100")

    def test_equity_combines_cash_and_marked_exposure(self) -> None:
        portfolio = self.make()
        portfolio.apply_fill(
            self.fill(side=OrderSide.BUY, price="30000", quantity="0.1")
        )
        assert portfolio.equity(D("30000")) == D("10000")

    def test_drawdown_tracks_the_worst_decline(self) -> None:
        portfolio = self.make()
        portfolio.mark_to_market(timestamp_micros=BASE_TS, mark_price=None)
        portfolio.apply_fill(
            self.fill(side=OrderSide.BUY, price="30000", quantity="0.1")
        )
        portfolio.mark_to_market(timestamp_micros=BASE_TS + 1, mark_price=D("31000"))
        portfolio.mark_to_market(timestamp_micros=BASE_TS + 2, mark_price=D("29000"))
        assert portfolio.peak_equity == D("10100")
        assert portfolio.max_drawdown == D("200")

    def test_a_real_fill_is_refused(self) -> None:
        """A simulated portfolio must never absorb a real fill."""
        portfolio = self.make()
        real = Fill(
            fill_id="real-1",
            order_id="o",
            trade_id="t",
            price=D("30000"),
            quantity=D("0.1"),
            fee=D("0"),
            fee_currency="USDT",
            is_maker=False,
            is_simulated=False,
            exchange_timestamp=BASE_TS,
            received_timestamp=BASE_TS,
            symbol=SYMBOL,
            side=OrderSide.BUY,
            exchange=EXCHANGE,
        )
        with pytest.raises(Exception):
            portfolio.apply_fill(real)

    def test_exposure_fraction_is_none_before_any_observation(self) -> None:
        assert self.make().exposure_fraction is None

    def test_reserved_cash_reduces_availability(self) -> None:
        portfolio = self.make()
        portfolio.reserve(D("1000"))
        assert portfolio.available_cash == D("9000")
        portfolio.release(D("5000"))
        assert portfolio.reserved == D("0")


# ---------------------------------------------------------------------------
# Full backtest
# ---------------------------------------------------------------------------
class TestBacktestRun:
    """Cases 16, 25, 26, 28: determinism, metrics, hashing, reproducibility."""

    def test_a_run_produces_a_complete_result(self) -> None:
        result = build_backtest(oscillating_dataset()).run()
        assert result.is_simulated is True
        assert result.strategy_key == "DETERMINISTIC_IMBALANCE_V1"
        assert result.strategy_version == "1.0.0"
        assert result.symbol == SYMBOL
        assert result.exchange is EXCHANGE
        assert result.phase is BacktestPhase.TEST
        assert result.events_replayed == 40
        assert result.dataset.checksum
        assert result.configuration_hash
        assert result.is_reproducible is True

    def test_the_same_inputs_produce_an_identical_result(self) -> None:
        """The mandatory backtest-reproducibility test."""
        dataset = oscillating_dataset()
        first = build_backtest(dataset).run()
        second = build_backtest(dataset).run()

        assert first.matches(second)
        assert first.run_id == second.run_id
        assert first.configuration_hash == second.configuration_hash
        assert first.to_dict(include_curve=True) == second.to_dict(include_curve=True)

    def test_changing_a_fee_changes_the_configuration_hash(self) -> None:
        dataset = oscillating_dataset(20)
        cheap = build_backtest(
            dataset, assumptions=ExecutionAssumptions(taker_fee_rate=D("0.0001"))
        ).run()
        dear = build_backtest(
            dataset, assumptions=ExecutionAssumptions(taker_fee_rate=D("0.002"))
        ).run()
        assert cheap.configuration_hash != dear.configuration_hash
        assert cheap.metrics.fees != dear.metrics.fees

    def test_changing_the_dataset_changes_the_hash(self) -> None:
        first = build_backtest(oscillating_dataset(20)).run()
        second = build_backtest(oscillating_dataset(30)).run()
        assert first.configuration_hash != second.configuration_hash

    def test_the_configuration_hash_contains_no_secret_material(self) -> None:
        result = build_backtest(oscillating_dataset(10)).run()
        rendered = str(result.to_dict()).lower()
        for word in ("secret", "api_key", "apikey", "private_key", "password", "token"):
            assert word not in rendered

    def test_higher_fees_reduce_the_result(self) -> None:
        dataset = oscillating_dataset()
        cheap = build_backtest(
            dataset, assumptions=ExecutionAssumptions(taker_fee_rate=D("0.0001"))
        ).run()
        dear = build_backtest(
            dataset, assumptions=ExecutionAssumptions(taker_fee_rate=D("0.005"))
        ).run()
        assert dear.metrics.final_equity < cheap.metrics.final_equity

    def test_slippage_costs_money(self) -> None:
        dataset = oscillating_dataset()
        none = build_backtest(
            dataset, assumptions=ExecutionAssumptions(slippage_bps=D("0"))
        ).run()
        some = build_backtest(
            dataset, assumptions=ExecutionAssumptions(slippage_bps=D("25"))
        ).run()
        assert some.metrics.slippage_cost > D("0")
        assert some.metrics.final_equity < none.metrics.final_equity

    def test_every_fill_in_the_run_is_simulated(self) -> None:
        engine = build_backtest(oscillating_dataset())
        engine.run()
        position = engine.portfolio.position
        assert position is None or position.contains_simulated_fills is True

    def test_a_run_cannot_be_repeated_on_the_same_engine(self) -> None:
        engine = build_backtest(oscillating_dataset(10))
        engine.run()
        with pytest.raises(RuntimeError):
            engine.run()

    def test_risk_rejections_are_counted_not_hidden(self) -> None:
        """Case 30: the strategy cannot bypass the risk engine."""
        tiny = RiskLimits(
            max_order_quantity=D("0.0000001"),
            max_order_notional=D("1000000"),
            max_market_data_age_micros=60_000_000,
        )
        result = build_backtest(oscillating_dataset(), limits=tiny).run()
        assert result.signals_accepted > 0
        assert result.risk_rejections == result.signals_accepted
        assert result.simulated_orders == 0
        assert result.metrics.trade_count == 0

    def test_absent_risk_limits_reject_everything(self) -> None:
        """Fail closed: no limits configured means no orders."""
        result = build_backtest(oscillating_dataset(), limits=RiskLimits()).run()
        assert result.simulated_orders == 0
        assert result.risk_rejections > 0

    def test_metrics_withhold_ratios_on_a_flat_curve(self) -> None:
        result = build_backtest(oscillating_dataset(6)).run()
        assert result.metrics.sharpe_ratio is None or result.metrics.has_sufficient_observations

    def test_no_trades_means_no_win_rate(self) -> None:
        result = build_backtest(oscillating_dataset(), limits=RiskLimits()).run()
        assert result.metrics.trade_count == 0
        assert result.metrics.win_rate is None
        assert result.metrics.average_trade is None

    def test_the_summary_always_carries_the_disclaimer(self) -> None:
        result = build_backtest(oscillating_dataset(10)).run()
        text = "\n".join(result.summary_lines()).lower()
        assert "not indicative of future performance" in text
        assert "simulated" in text

    def test_the_engine_holds_no_execution_adapter(self) -> None:
        """Case 29: a backtest cannot reach a venue."""
        engine = build_backtest(oscillating_dataset(5))
        for forbidden in ("adapter", "client", "session", "api_key", "secret"):
            assert not hasattr(engine, forbidden)

    def test_no_backtest_module_imports_an_adapter(self) -> None:
        import pathlib

        root = pathlib.Path(__file__).resolve().parents[1] / "wlct_trading" / "backtest"
        for path in root.rglob("*.py"):
            imports = [
                line
                for line in path.read_text(encoding="utf-8").splitlines()
                if line.startswith(("import ", "from "))
            ]
            for line in imports:
                assert "wlct_trading.adapters" not in line, f"{path}: {line}"
                assert "wlct_trading.net" not in line, f"{path}: {line}"
                assert "wlct_trading.execution" not in line, f"{path}: {line}"

    def test_the_result_carries_the_dataset_identity(self) -> None:
        result = build_backtest(oscillating_dataset(10)).run()
        payload = result.to_dict()["dataset"]
        assert isinstance(payload, dict)
        assert payload["datasetId"] == "oscillating-1"
        assert payload["source"] == "unit-test-fixture"
        assert payload["checksum"]


class TestConfigurationHash:
    def test_hash_is_stable_for_the_same_inputs(self) -> None:
        dataset = oscillating_dataset(5)
        arguments = dict(
            strategy_key="K",
            strategy_version="1.0.0",
            implementation_id="module.Class",
            parameters=(("a", "1"), ("b", "2")),
            assumptions=ExecutionAssumptions(),
            dataset=dataset.descriptor,
            initial_capital=D("10000"),
        )
        assert compute_configuration_hash(**arguments) == compute_configuration_hash(
            **arguments
        )

    def test_hash_changes_with_a_parameter(self) -> None:
        dataset = oscillating_dataset(5)
        base = dict(
            strategy_key="K",
            strategy_version="1.0.0",
            implementation_id="module.Class",
            assumptions=ExecutionAssumptions(),
            dataset=dataset.descriptor,
            initial_capital=D("10000"),
        )
        first = compute_configuration_hash(parameters=(("a", "1"),), **base)
        second = compute_configuration_hash(parameters=(("a", "2"),), **base)
        assert first != second


class TestWalkForward:
    """Case 31 foundation: labelled, non-overlapping windows."""

    def test_split_produces_three_ordered_windows(self) -> None:
        split = split_dataset(oscillating_dataset(60))
        phases = [window.phase for window in split.windows()]
        assert phases == [
            BacktestPhase.TRAINING,
            BacktestPhase.VALIDATION,
            BacktestPhase.TEST,
        ]
        assert split.is_non_overlapping is True

    def test_each_window_is_checksummed_separately(self) -> None:
        split = split_dataset(oscillating_dataset(60))
        checksums = {window.dataset.descriptor.checksum for window in split.windows()}
        assert len(checksums) == 3

    def test_fractions_must_leave_a_test_window(self) -> None:
        with pytest.raises(ValueError):
            split_dataset(
                oscillating_dataset(20),
                training_fraction=D("0.8"),
                validation_fraction=D("0.3"),
            )

    def test_rolling_windows_advance_and_stay_bounded(self) -> None:
        dataset = oscillating_dataset(30)
        windows = list(
            rolling_windows(
                dataset, window_micros=5_000_000, step_micros=5_000_000
            )
        )
        assert windows
        assert all(window.event_count > 0 for window in windows)
        starts = [window.start_micros for window in windows]
        assert starts == sorted(starts)

    def test_a_training_result_is_labelled_as_such(self) -> None:
        dataset = oscillating_dataset(60)
        split = split_dataset(dataset)
        registry = build_default_strategy_registry()
        strategy = registry.create(
            "DETERMINISTIC_IMBALANCE_V1",
            "1.0.0",
            descriptor=descriptor(),
            symbol=SYMBOL,
            parameters={"use_limit_orders": False, "signal_cooldown_micros": 0},
        )
        engine = BacktestEngine(
            strategy=strategy,
            dataset=split.training.dataset,
            config=BacktestConfig(
                tenant_id="tenant-1",
                account_id="account-1",
                initial_capital=D("10000"),
                risk_limits=permissive(),
                phase=BacktestPhase.TRAINING,
            ),
        )
        result = engine.run()
        assert result.phase is BacktestPhase.TRAINING
        assert result.dataset.dataset_id.startswith("oscillating-1#")
```

---

## FILE: libs/trading-core/tests/test_paper_trading.py

```py
"""Part 6: paper-trading safety.

The mandatory paper-trading safety test lives here. The property being proven
is narrow and absolute: **a paper session cannot reach a live execution
adapter.** Not "does not by default" - cannot, because the constructor refuses
any adapter that is not marked simulated and the class holds no other object
capable of talking to a venue.

Everything runs against an in-memory simulated adapter. No network, no
credentials, no real orders.
"""

from __future__ import annotations

import asyncio
import pathlib
from decimal import Decimal
from typing import AsyncIterator

import pytest

from wlct_trading.adapters.base import CancelResult, SubmitResult, TradingAdapter
from wlct_trading.adapters.paper import PaperTradingAdapter
from wlct_trading.clock import epoch_micros
from wlct_trading.enums import (
    ExchangeId,
    OrderSide,
    OrderStatus,
    OrderType,
    TradingMode,
)
from wlct_trading.market_data import BookTop
from wlct_trading.orders import Fill, Order, OrderIntent
from wlct_trading.paper import (
    PaperSessionConfig,
    PaperTradingSafetyError,
    PaperTradingSession,
)
from wlct_trading.risk import RiskLimits
from wlct_trading.signals import StrategyDescriptor, StrategyRiskProfile
from wlct_trading.strategies import build_default_strategy_registry

from tests.conftest import EXCHANGE, SYMBOL

D = Decimal


def run(coro):
    return asyncio.run(coro)


class ForbiddenLiveAdapter(TradingAdapter):
    """Stands in for a credentialed adapter. Must never be reachable.

    Every method raises. If a paper session ever manages to call one of them
    the test fails loudly rather than silently "succeeding".
    """

    called = False

    @property
    def exchange(self) -> ExchangeId:
        return ExchangeId.BINANCE

    @property
    def is_simulated(self) -> bool:
        return False

    async def submit_order(
        self, intent: OrderIntent, client_order_id: str
    ) -> SubmitResult:
        ForbiddenLiveAdapter.called = True
        raise AssertionError("A live adapter was reached from paper trading.")

    async def cancel_order(self, order: Order) -> CancelResult:
        ForbiddenLiveAdapter.called = True
        raise AssertionError("A live adapter was reached from paper trading.")

    async def fetch_order(
        self, tenant_id: str, account_id: str, client_order_id: str
    ) -> Order | None:
        raise AssertionError("A live adapter was reached from paper trading.")

    async def fetch_open_orders(
        self, tenant_id: str, account_id: str, *, symbol: str | None = None
    ) -> tuple[Order, ...]:
        raise AssertionError("A live adapter was reached from paper trading.")

    async def exchange_time(self) -> int:
        raise AssertionError("A live adapter was reached from paper trading.")

    async def stream_fills(
        self, tenant_id: str, account_id: str
    ) -> AsyncIterator[Fill]:
        raise AssertionError("A live adapter was reached from paper trading.")
        yield  # pragma: no cover


def descriptor() -> StrategyDescriptor:
    return StrategyDescriptor(
        strategy_id="strategy-1",
        tenant_id="tenant-1",
        name="deterministic example",
        version="1.0.0",
        enabled=True,
        exchange=EXCHANGE,
        symbols=(SYMBOL,),
        risk_profile=StrategyRiskProfile(
            max_order_quantity=D("1"),
            max_position_quantity=D("1"),
            max_order_notional=D("100000"),
            max_daily_loss=D("1000"),
            max_open_orders=5,
            max_orders_per_minute=600,
        ),
    )


def make_strategy(**parameters: object):
    registry = build_default_strategy_registry()
    return registry.create(
        "DETERMINISTIC_IMBALANCE_V1",
        "1.0.0",
        descriptor=descriptor(),
        symbol=SYMBOL,
        parameters=parameters
        or {"use_limit_orders": False, "signal_cooldown_micros": 0},
    )


def limits() -> RiskLimits:
    return RiskLimits(
        max_order_quantity=D("1"),
        max_order_notional=D("1000000"),
        max_position_quantity=D("1"),
        max_symbol_exposure_notional=D("1000000"),
        max_account_exposure_notional=D("1000000"),
        max_open_orders=50,
        max_orders_per_minute=600,
        max_daily_loss=D("100000"),
        max_strategy_loss=D("100000"),
        max_price_deviation_percent=D("100"),
        max_market_data_age_micros=60_000_000,
    )


def config(**overrides: object) -> PaperSessionConfig:
    payload: dict[str, object] = {
        "session_id": "paper-1",
        "tenant_id": "tenant-1",
        "account_id": "account-1",
        "exchange": EXCHANGE,
        "symbol": SYMBOL,
        "initial_capital": D("10000"),
        "risk_limits": limits(),
        "snapshot_interval_micros": 1,
    }
    payload.update(overrides)
    return PaperSessionConfig(**payload)  # type: ignore[arg-type]


def top(*, bid_qty: str, ask_qty: str) -> BookTop:
    now = epoch_micros()
    return BookTop(
        exchange=EXCHANGE,
        symbol=SYMBOL,
        best_bid=D("29995"),
        best_bid_quantity=D(bid_qty),
        best_ask=D("30005"),
        best_ask_quantity=D(ask_qty),
        sequence=1,
        exchange_timestamp=now,
        received_timestamp=now,
    )


class Feed:
    """Holds the latest book so the adapter and the session agree on price."""

    def __init__(self) -> None:
        self.book: BookTop | None = None

    def provider(self, _exchange: ExchangeId, _symbol: str) -> BookTop | None:
        return self.book


def build_session(feed: Feed | None = None, **overrides: object):
    feed = feed or Feed()
    session = PaperTradingSession(
        config=config(**overrides),
        strategy=make_strategy(),
        adapter=PaperTradingAdapter(feed.provider),
    )
    return session, feed


class TestPaperTradingSafety:
    """Case 28: paper trading cannot call the live execution adapter."""

    def test_a_live_adapter_is_refused_at_construction(self) -> None:
        ForbiddenLiveAdapter.called = False
        with pytest.raises(PaperTradingSafetyError):
            PaperTradingSession(
                config=config(),
                strategy=make_strategy(),
                adapter=ForbiddenLiveAdapter(),
            )
        assert ForbiddenLiveAdapter.called is False

    def test_live_mode_is_refused(self) -> None:
        with pytest.raises(PaperTradingSafetyError):
            config(trading_mode=TradingMode.LIVE)

    def test_disabled_mode_is_refused(self) -> None:
        with pytest.raises(PaperTradingSafetyError):
            config(trading_mode=TradingMode.DISABLED)

    def test_the_session_config_has_no_credential_field(self) -> None:
        fields = set(PaperSessionConfig.__dataclass_fields__)
        for banned in (
            "api_key",
            "apiKey",
            "secret",
            "api_secret",
            "private_key",
            "passphrase",
            "token",
            "credential",
        ):
            assert banned not in fields

    def test_the_session_exposes_no_way_to_swap_the_adapter(self) -> None:
        session, _ = build_session()
        for forbidden in ("set_adapter", "adapter", "use_live", "enable_live"):
            assert not hasattr(session, forbidden)

    def test_the_paper_module_never_imports_a_live_transport(self) -> None:
        root = pathlib.Path(__file__).resolve().parents[1] / "wlct_trading" / "paper"
        for path in root.rglob("*.py"):
            imports = [
                line
                for line in path.read_text(encoding="utf-8").splitlines()
                if line.startswith(("import ", "from "))
            ]
            for line in imports:
                assert "wlct_trading.net" not in line, f"{path}: {line}"
                assert "wlct_trading.execution" not in line, f"{path}: {line}"
                assert "binance" not in line.lower(), f"{path}: {line}"

    def test_the_session_reports_itself_as_simulated(self) -> None:
        session, _ = build_session()
        assert session.is_simulated is True
        assert session.portfolio.is_simulated is True


class TestPaperSessionBehaviour:
    def test_a_session_must_be_started_before_it_accepts_data(self) -> None:
        session, feed = build_session()
        feed.book = top(bid_qty="9", ask_qty="1")
        with pytest.raises(PaperTradingSafetyError):
            run(session.on_book_top(feed.book))

    def test_starting_twice_is_refused(self) -> None:
        session, _ = build_session()
        session.start()
        with pytest.raises(PaperTradingSafetyError):
            session.start()

    def test_a_signal_becomes_a_simulated_fill(self) -> None:
        session, feed = build_session()
        session.start()
        feed.book = top(bid_qty="9", ask_qty="1")
        outcomes = run(session.on_book_top(feed.book))
        assert outcomes
        summary = session.stop()
        assert summary.simulated_orders >= 1
        assert summary.simulated_fills >= 1
        assert summary.is_simulated is True

    def test_the_position_is_marked_as_containing_simulated_fills(self) -> None:
        session, feed = build_session()
        session.start()
        feed.book = top(bid_qty="9", ask_qty="1")
        run(session.on_book_top(feed.book))
        position = session.portfolio.position
        assert position is not None
        assert position.contains_simulated_fills is True

    def test_risk_limits_are_enforced_in_paper_mode_too(self) -> None:
        """Case 30 again: paper is not a way around the risk engine."""
        session, feed = build_session(
            risk_limits=RiskLimits(
                max_order_quantity=D("0.0000001"),
                max_order_notional=D("1000000"),
                max_market_data_age_micros=60_000_000,
            )
        )
        session.start()
        feed.book = top(bid_qty="9", ask_qty="1")
        run(session.on_book_top(feed.book))
        summary = session.stop()
        assert summary.signals_accepted >= 1
        assert summary.simulated_orders == 0
        assert summary.risk_rejections >= 1

    def test_absent_risk_limits_fail_closed(self) -> None:
        session, feed = build_session(risk_limits=RiskLimits())
        session.start()
        feed.book = top(bid_qty="9", ask_qty="1")
        run(session.on_book_top(feed.book))
        assert session.stop().simulated_orders == 0

    def test_no_book_means_no_fill(self) -> None:
        session, feed = build_session()
        session.start()
        feed.book = None
        # The strategy still needs a book to produce a signal, so nothing is
        # emitted and nothing is filled. The point is that the absence of data
        # produces silence rather than an invented execution.
        summary = session.stop()
        assert summary.simulated_fills == 0

    def test_the_summary_is_labelled_and_disclaimed(self) -> None:
        session, feed = build_session()
        session.start()
        feed.book = top(bid_qty="9", ask_qty="1")
        run(session.on_book_top(feed.book))
        payload = session.stop().to_dict()
        assert payload["isSimulated"] is True
        assert "not indicative of live performance" in str(payload["disclaimer"])

    def test_snapshots_are_recorded_in_memory_only(self) -> None:
        session, feed = build_session()
        session.start()
        feed.book = top(bid_qty="9", ask_qty="1")
        run(session.on_book_top(feed.book))
        assert session.snapshots
        assert all(point["isSimulated"] is True for point in session.snapshots)

    def test_stopping_reports_a_final_summary(self) -> None:
        session, feed = build_session()
        session.start()
        feed.book = top(bid_qty="9", ask_qty="1")
        run(session.on_book_top(feed.book))
        summary = session.stop()
        assert summary.ended_at_micros is not None
        assert summary.trading_mode is TradingMode.PAPER
        assert session.is_running is False

    def test_a_strategy_for_another_symbol_is_refused(self) -> None:
        with pytest.raises(PaperTradingSafetyError):
            PaperTradingSession(
                config=config(symbol="ETH-USDT"),
                strategy=make_strategy(),
                adapter=PaperTradingAdapter(Feed().provider),
            )


class TestPaperAdapterLabelling:
    """The adapter itself must never present a simulated fill as real."""

    def test_the_adapter_declares_itself_simulated(self) -> None:
        assert PaperTradingAdapter(Feed().provider).is_simulated is True

    def test_every_fill_is_flagged(self) -> None:
        feed = Feed()
        feed.book = top(bid_qty="9", ask_qty="1")
        adapter = PaperTradingAdapter(feed.provider)
        intent = OrderIntent(
            tenant_id="tenant-1",
            account_id="account-1",
            strategy_id="strategy-1",
            exchange=EXCHANGE,
            symbol=SYMBOL,
            side=OrderSide.BUY,
            order_type=OrderType.MARKET,
            quantity=D("0.5"),
        )
        result = run(adapter.submit_order(intent, "client-1"))
        assert result.is_simulated is True
        assert result.status is OrderStatus.FILLED
        assert all(fill.is_simulated for fill in result.fills)
        # The fill price is the observed ask, never an invented number.
        assert result.fills[0].price == D("30005")
```

---

# Part B — modified files (complete final content)

## FILE: libs/trading-core/wlct_trading/enums.py

```py
"""Canonical trading enumerations shared by every data-plane service.

These values are the *internal* vocabulary of the platform. Exchange-specific
strings (``"NEW"``, ``"PARTIALLY_FILLED"``, ``"buy"``, ``"Sell"``, ...) are
translated at the adapter boundary and never leak past it, so a strategy can be
written once and run against any venue.

The string values are stable wire values: they are persisted to PostgreSQL,
published on Redis and returned by the REST API, so they must not be renamed
without a migration.
"""

from __future__ import annotations

from enum import Enum

__all__ = [
    "ExchangeId",
    "MarketType",
    "OrderSide",
    "OrderType",
    "TimeInForce",
    "OrderStatus",
    "TERMINAL_ORDER_STATUSES",
    "OPEN_ORDER_STATUSES",
    "PositionSide",
    "SignalAction",
    "TradingMode",
    "KillSwitchScope",
    "RiskDecisionCode",
    "TradingEventType",
    "OrderBookHealth",
    "StrategyStatus",
    "StrategyFailurePolicy",
    "SignalRejectionCode",
    "MarketEventKind",
    "MarketFillPriceModel",
    "LimitFillRule",
    "BacktestPhase",
]


class StrEnum(str, Enum):
    """``str`` mixin enum.

    Subclassing ``str`` means members serialise directly to JSON and compare
    equal to their wire value, which keeps Redis payloads and Prisma enum
    columns free of ``Enum.MEMBER`` repr leakage.
    """

    def __str__(self) -> str:  # pragma: no cover - trivial
        return str(self.value)


class ExchangeId(StrEnum):
    """Venues the platform knows how to talk to.

    Mirrors ``ExchangeId`` in ``packages/shared-types/src/exchange.ts``. The
    ``PAPER`` member is a first-class simulated venue used for paper trading;
    it is never a real exchange and every fill it produces is labelled
    simulated.
    """

    BINANCE = "binance"
    BYBIT = "bybit"
    OKX = "okx"
    KRAKEN = "kraken"
    PAPER = "paper"


class MarketType(StrEnum):
    SPOT = "SPOT"
    MARGIN = "MARGIN"
    FUTURES_USDT = "FUTURES_USDT"
    FUTURES_COIN = "FUTURES_COIN"


class OrderSide(StrEnum):
    BUY = "BUY"
    SELL = "SELL"

    @property
    def opposite(self) -> "OrderSide":
        return OrderSide.SELL if self is OrderSide.BUY else OrderSide.BUY

    @property
    def sign(self) -> int:
        """``+1`` for BUY, ``-1`` for SELL - used for signed position maths."""
        return 1 if self is OrderSide.BUY else -1


class OrderType(StrEnum):
    MARKET = "MARKET"
    LIMIT = "LIMIT"
    STOP = "STOP"
    STOP_LIMIT = "STOP_LIMIT"

    @property
    def requires_price(self) -> bool:
        """LIMIT and STOP_LIMIT are the only types carrying a limit price."""
        return self in (OrderType.LIMIT, OrderType.STOP_LIMIT)

    @property
    def requires_stop_price(self) -> bool:
        """STOP and STOP_LIMIT are the only types carrying a trigger price."""
        return self in (OrderType.STOP, OrderType.STOP_LIMIT)


class TimeInForce(StrEnum):
    GTC = "GTC"
    IOC = "IOC"
    FOK = "FOK"
    DAY = "DAY"


class OrderStatus(StrEnum):
    """Lifecycle states of an order in the OMS.

    The legal transitions between these states are declared in
    ``wlct_trading.orders.ORDER_STATE_TRANSITIONS`` and enforced centrally, so
    an out-of-order or duplicated exchange callback can never corrupt an
    order's recorded history.
    """

    PENDING = "PENDING"
    SUBMITTED = "SUBMITTED"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    PARTIALLY_FILLED = "PARTIALLY_FILLED"
    FILLED = "FILLED"
    CANCEL_REQUESTED = "CANCEL_REQUESTED"
    CANCELLED = "CANCELLED"
    REJECTED = "REJECTED"
    EXPIRED = "EXPIRED"
    FAILED = "FAILED"


#: States from which no further transition is possible.
TERMINAL_ORDER_STATUSES: frozenset[OrderStatus] = frozenset(
    {
        OrderStatus.FILLED,
        OrderStatus.CANCELLED,
        OrderStatus.REJECTED,
        OrderStatus.EXPIRED,
        OrderStatus.FAILED,
    }
)

#: States in which the order still consumes exposure and open-order budget.
OPEN_ORDER_STATUSES: frozenset[OrderStatus] = frozenset(
    {
        OrderStatus.PENDING,
        OrderStatus.SUBMITTED,
        OrderStatus.ACKNOWLEDGED,
        OrderStatus.PARTIALLY_FILLED,
        OrderStatus.CANCEL_REQUESTED,
    }
)


class PositionSide(StrEnum):
    LONG = "LONG"
    SHORT = "SHORT"
    FLAT = "FLAT"


class SignalAction(StrEnum):
    BUY = "BUY"
    SELL = "SELL"
    CLOSE = "CLOSE"
    HOLD = "HOLD"

    @property
    def is_actionable(self) -> bool:
        """``HOLD`` signals are recorded for observability but never routed."""
        return self is not SignalAction.HOLD


class TradingMode(StrEnum):
    """How order intents are resolved.

    ``DISABLED`` is the default everywhere. ``PAPER`` routes to the simulated
    venue. ``LIVE`` is the only mode that can reach a real exchange and it
    requires several independent environment variables to agree - see
    ``wlct_trading.risk.TradingModeResolver``.
    """

    DISABLED = "DISABLED"
    PAPER = "PAPER"
    LIVE = "LIVE"


class KillSwitchScope(StrEnum):
    """Granularity at which trading can be halted.

    Checked from broadest to narrowest; any engaged switch halts the order.
    """

    GLOBAL = "GLOBAL"
    EXCHANGE = "EXCHANGE"
    STRATEGY = "STRATEGY"
    SYMBOL = "SYMBOL"


class RiskDecisionCode(StrEnum):
    """Machine-readable reason a risk check approved or refused an intent."""

    APPROVED = "APPROVED"
    KILL_SWITCH_ENGAGED = "KILL_SWITCH_ENGAGED"
    TRADING_DISABLED = "TRADING_DISABLED"
    STRATEGY_DISABLED = "STRATEGY_DISABLED"
    MAX_ORDER_SIZE_EXCEEDED = "MAX_ORDER_SIZE_EXCEEDED"
    MAX_ORDER_NOTIONAL_EXCEEDED = "MAX_ORDER_NOTIONAL_EXCEEDED"
    MAX_POSITION_SIZE_EXCEEDED = "MAX_POSITION_SIZE_EXCEEDED"
    MAX_SYMBOL_EXPOSURE_EXCEEDED = "MAX_SYMBOL_EXPOSURE_EXCEEDED"
    MAX_ACCOUNT_EXPOSURE_EXCEEDED = "MAX_ACCOUNT_EXPOSURE_EXCEEDED"
    MAX_OPEN_ORDERS_EXCEEDED = "MAX_OPEN_ORDERS_EXCEEDED"
    ORDER_RATE_EXCEEDED = "ORDER_RATE_EXCEEDED"
    DAILY_LOSS_LIMIT_BREACHED = "DAILY_LOSS_LIMIT_BREACHED"
    STRATEGY_LOSS_LIMIT_BREACHED = "STRATEGY_LOSS_LIMIT_BREACHED"
    PRICE_DEVIATION_EXCEEDED = "PRICE_DEVIATION_EXCEEDED"
    STALE_MARKET_DATA = "STALE_MARKET_DATA"
    DUPLICATE_ORDER = "DUPLICATE_ORDER"
    INVALID_INTENT = "INVALID_INTENT"
    SYMBOL_NOT_TRADEABLE = "SYMBOL_NOT_TRADEABLE"
    RISK_STATE_UNAVAILABLE = "RISK_STATE_UNAVAILABLE"


class TradingEventType(StrEnum):
    """Every event that can travel on the internal trading event bus.

    Part 3 added the connectivity and market-data lifecycle events. They share
    this one enum, and therefore the one bus, on purpose: an operator
    reconstructing an incident needs "the feed dropped" and "the order was
    rejected" on a single ordered timeline, which a second parallel bus would
    make impossible.
    """

    # -- Part 2: signal, order and position lifecycle ---------------------
    MARKET_DATA_RECEIVED = "MarketDataReceived"
    ORDER_BOOK_UPDATED = "OrderBookUpdated"
    TRADE_RECEIVED = "TradeReceived"
    SIGNAL_GENERATED = "SignalGenerated"
    RISK_CHECK_REQUESTED = "RiskCheckRequested"
    ORDER_REQUESTED = "OrderRequested"
    ORDER_SUBMITTED = "OrderSubmitted"
    ORDER_ACCEPTED = "OrderAccepted"
    ORDER_REJECTED = "OrderRejected"
    ORDER_PARTIALLY_FILLED = "OrderPartiallyFilled"
    ORDER_FILLED = "OrderFilled"
    ORDER_CANCELLED = "OrderCancelled"
    POSITION_UPDATED = "PositionUpdated"
    RISK_LIMIT_BREACHED = "RiskLimitBreached"

    # -- Part 3: connection lifecycle -------------------------------------
    MARKET_DATA_CONNECTED = "MarketDataConnected"
    MARKET_DATA_DISCONNECTED = "MarketDataDisconnected"
    MARKET_DATA_RECONNECTED = "MarketDataReconnected"

    # -- Part 3: market-data lifecycle ------------------------------------
    TICKER_RECEIVED = "TickerReceived"
    ORDER_BOOK_SNAPSHOT_RECEIVED = "OrderBookSnapshotReceived"
    ORDER_BOOK_INVALIDATED = "OrderBookInvalidated"
    ORDER_BOOK_RESYNC_STARTED = "OrderBookResyncStarted"
    ORDER_BOOK_RESYNC_COMPLETED = "OrderBookResyncCompleted"
    MARKET_DATA_STALE = "MarketDataStale"
    MARKET_DATA_RECOVERED = "MarketDataRecovered"

    # -- Part 3: subscription lifecycle -----------------------------------
    SUBSCRIPTION_CREATED = "SubscriptionCreated"
    SUBSCRIPTION_REMOVED = "SubscriptionRemoved"
    SUBSCRIPTION_FAILED = "SubscriptionFailed"

    # -- Part 6: strategy, backtest and paper-session lifecycle -----------
    STRATEGY_REGISTERED = "StrategyRegistered"
    STRATEGY_STARTED = "StrategyStarted"
    STRATEGY_STOPPED = "StrategyStopped"
    STRATEGY_FAILED = "StrategyFailed"
    STRATEGY_QUARANTINED = "StrategyQuarantined"
    SIGNAL_REJECTED = "SignalRejected"
    BACKTEST_STARTED = "BacktestStarted"
    BACKTEST_COMPLETED = "BacktestCompleted"
    PAPER_SESSION_STARTED = "PaperSessionStarted"
    PAPER_SESSION_STOPPED = "PaperSessionStopped"
    SIMULATED_ORDER_SUBMITTED = "SimulatedOrderSubmitted"
    SIMULATED_FILL = "SimulatedFill"


class OrderBookHealth(StrEnum):
    """Whether a book may be trusted for pricing decisions.

    A book that is not ``OK`` must never be used to value an order. The risk
    engine treats anything else as unavailable state and fails closed.
    """

    OK = "OK"
    UNINITIALISED = "UNINITIALISED"
    RESYNC_REQUIRED = "RESYNC_REQUIRED"
    STALE = "STALE"
    CROSSED = "CROSSED"


class StrategyStatus(StrEnum):
    """Lifecycle status of one strategy *instance*.

    ``QUARANTINED`` is distinct from ``FAILED``: a quarantined instance is kept
    in the engine so an operator can inspect its last error and its state, but
    it receives no further events. Both are terminal for signal emission - a
    strategy whose state may be corrupted never emits again without an explicit
    operator action.
    """

    CREATED = "CREATED"
    INITIALISED = "INITIALISED"
    RUNNING = "RUNNING"
    STOPPED = "STOPPED"
    FAILED = "FAILED"
    QUARANTINED = "QUARANTINED"

    @property
    def can_emit_signals(self) -> bool:
        return self is StrategyStatus.RUNNING


class StrategyFailurePolicy(StrEnum):
    """What the engine does when a strategy instance raises.

    Every option is fail-closed. There is deliberately no ``CONTINUE`` member:
    an instance that raised may hold half-updated state, and continuing to
    trade from state that is known to be suspect is exactly the behaviour this
    enum exists to prevent.
    """

    #: Stop the offending instance. Other instances keep running.
    STOP_INSTANCE = "STOP_INSTANCE"
    #: Stop the offending instance but retain it for inspection.
    QUARANTINE_INSTANCE = "QUARANTINE_INSTANCE"
    #: Stop every instance in the engine. For strategies that share a book.
    HALT_ALL = "HALT_ALL"


class SignalRejectionCode(StrEnum):
    """Machine-readable reason the signal validator refused a signal.

    Signal validation sits *before* the risk engine and answers a different
    question: "is this signal well-formed, fresh, and permitted to exist?"
    Risk answers "is this trade within limits?". Keeping the vocabularies
    separate means an operator can tell a broken strategy from a risky one.
    """

    ACCEPTED = "ACCEPTED"
    STRUCTURALLY_INVALID = "STRUCTURALLY_INVALID"
    STRATEGY_UNKNOWN = "STRATEGY_UNKNOWN"
    STRATEGY_DISABLED = "STRATEGY_DISABLED"
    STRATEGY_NOT_RUNNING = "STRATEGY_NOT_RUNNING"
    STRATEGY_VERSION_MISSING = "STRATEGY_VERSION_MISSING"
    KILL_SWITCH_ENGAGED = "KILL_SWITCH_ENGAGED"
    SYMBOL_NOT_ALLOWED = "SYMBOL_NOT_ALLOWED"
    EXCHANGE_MISMATCH = "EXCHANGE_MISMATCH"
    TENANT_MISMATCH = "TENANT_MISMATCH"
    SIGNAL_EXPIRED = "SIGNAL_EXPIRED"
    SIGNAL_STALE = "SIGNAL_STALE"
    SIGNAL_FROM_FUTURE = "SIGNAL_FROM_FUTURE"
    MARKET_DATA_STALE = "MARKET_DATA_STALE"
    MARKET_DATA_UNAVAILABLE = "MARKET_DATA_UNAVAILABLE"
    DUPLICATE_SIGNAL = "DUPLICATE_SIGNAL"
    COOLDOWN_ACTIVE = "COOLDOWN_ACTIVE"
    QUANTITY_INVALID = "QUANTITY_INVALID"
    PRICE_INVALID = "PRICE_INVALID"
    VALIDATION_STATE_UNAVAILABLE = "VALIDATION_STATE_UNAVAILABLE"


class MarketEventKind(StrEnum):
    """The normalised market-event shapes a strategy can be driven by.

    The same four kinds are produced by the live feed and by the backtest
    replay engine, which is what allows one strategy implementation to run
    unchanged in ``BACKTEST``, ``PAPER`` and live-market-data modes.
    """

    TICKER = "TICKER"
    TRADE = "TRADE"
    BOOK_SNAPSHOT = "BOOK_SNAPSHOT"
    BOOK_DELTA = "BOOK_DELTA"
    CANDLE = "CANDLE"
    TIMER = "TIMER"


class MarketFillPriceModel(StrEnum):
    """How the simulator prices a marketable order.

    ``TOUCH`` crosses the spread and pays the opposite side's best price, which
    is the pessimistic and more realistic of the two. ``MID`` fills at the mid
    price and is provided only for comparison; it systematically flatters
    results by half the spread and is never the default.
    """

    TOUCH = "TOUCH"
    MID = "MID"


class LimitFillRule(StrEnum):
    """When the simulator considers a resting limit order executed.

    ``TOUCH_OR_BETTER`` fills when the opposite touch reaches the limit price.
    ``THROUGH_ONLY`` requires the market to trade strictly through the limit,
    which is a crude stand-in for queue position: it will not fill you merely
    because your price was equalled.
    """

    TOUCH_OR_BETTER = "TOUCH_OR_BETTER"
    THROUGH_ONLY = "THROUGH_ONLY"


class BacktestPhase(StrEnum):
    """Walk-forward period labels.

    The engine records which phase a run belongs to. It does **not** perform
    any optimisation or parameter search - that is deliberately out of scope,
    and a phase label on its own carries no statistical claim.
    """

    TRAINING = "TRAINING"
    VALIDATION = "VALIDATION"
    TEST = "TEST"
    FULL = "FULL"
```

---

## FILE: libs/trading-core/wlct_trading/signals.py

```py
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
```

---

## FILE: libs/trading-core/wlct_trading/metrics.py

```py
"""Latency and throughput instrumentation for the connectivity layer.

What is measured, precisely
---------------------------
Three different things get called "latency" and conflating them makes the
numbers meaningless, so they are separate metrics here:

* **feed lag** — venue event timestamp to local receipt. Includes the venue's
  own publishing delay, the network, and clock skew between the two machines.
  Useful as a trend; not a precise measurement, because the two clocks are not
  synchronised. Treated and documented as an estimate.
* **processing latency** — receipt to the point the update is applied and
  visible to a strategy. Measured entirely on one clock, so this one is exact.
* **end-to-end latency** — venue timestamp to strategy visibility. Carries the
  same clock-skew caveat as feed lag.

Honesty about clocks matters. A feed-lag figure computed across two unsynchro-
nised clocks can legitimately come out negative, and this module reports that
rather than clamping it to zero and pretending the data is clean.

No performance guarantees are expressed or implied by anything here. These are
observations of what happened, not commitments about what will.
"""

from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, field

from wlct_trading.clock import epoch_micros

__all__ = [
    "LatencyHistogram",
    "CounterSet",
    "TransportCounters",
    "TransportMetrics",
    "StreamMetrics",
    "ConnectivityMetrics",
    "EXECUTION_STAGES",
    "ExecutionCounters",
    "ExecutionMetrics",
]

#: Bucket upper bounds in microseconds: 100µs to ~10s. Fixed buckets keep memory
#: constant regardless of message volume, which a growing list would not.
_DEFAULT_BUCKET_BOUNDS_MICROS: tuple[int, ...] = (
    100,
    250,
    500,
    1_000,
    2_500,
    5_000,
    10_000,
    25_000,
    50_000,
    100_000,
    250_000,
    500_000,
    1_000_000,
    2_500_000,
    5_000_000,
    10_000_000,
)


class LatencyHistogram:
    """Bucketed latency distribution with a bounded recent-sample window.

    Two structures on purpose. The histogram is cumulative and cheap, giving
    exact counts per bucket over all time. The recent window holds the last N
    raw samples so percentiles reflect current conditions rather than being
    dragged around by an hour-old incident — a p99 that includes yesterday's
    outage tells an operator nothing about right now.
    """

    __slots__ = ("_bounds", "_buckets", "_overflow", "_count", "_sum", "_min", "_max", "_recent")

    def __init__(
        self,
        *,
        bounds: tuple[int, ...] = _DEFAULT_BUCKET_BOUNDS_MICROS,
        window: int = 1_024,
    ) -> None:
        if window <= 0:
            raise ValueError("window must be positive.")
        self._bounds = bounds
        self._buckets = [0] * len(bounds)
        self._overflow = 0
        self._count = 0
        self._sum = 0
        self._min: int | None = None
        self._max: int | None = None
        self._recent: deque[int] = deque(maxlen=window)

    def observe(self, value_micros: int) -> None:
        """Record one measurement. Negative values are kept, not clamped."""
        self._count += 1
        self._sum += value_micros
        self._recent.append(value_micros)
        if self._min is None or value_micros < self._min:
            self._min = value_micros
        if self._max is None or value_micros > self._max:
            self._max = value_micros

        for index, bound in enumerate(self._bounds):
            if value_micros <= bound:
                self._buckets[index] += 1
                return
        self._overflow += 1

    @property
    def count(self) -> int:
        return self._count

    @property
    def mean_micros(self) -> float | None:
        if self._count == 0:
            return None
        return self._sum / self._count

    @property
    def min_micros(self) -> int | None:
        return self._min

    @property
    def max_micros(self) -> int | None:
        return self._max

    def percentile(self, fraction: float) -> int | None:
        """Percentile over the recent window, by nearest-rank.

        ``None`` when nothing has been observed — an honest absence rather than
        a zero that reads like a very fast measurement.
        """
        if not 0.0 < fraction <= 1.0:
            raise ValueError("fraction must be in (0, 1].")
        if not self._recent:
            return None
        ordered = sorted(self._recent)
        rank = max(1, math.ceil(fraction * len(ordered)))
        return ordered[rank - 1]

    def to_dict(self) -> dict[str, object]:
        return {
            "count": self._count,
            "meanMicros": self.mean_micros,
            "minMicros": self._min,
            "maxMicros": self._max,
            "p50Micros": self.percentile(0.50),
            "p95Micros": self.percentile(0.95),
            "p99Micros": self.percentile(0.99),
            "windowSize": len(self._recent),
            "buckets": {
                f"<={bound}": self._buckets[index]
                for index, bound in enumerate(self._bounds)
            },
            "overflow": self._overflow,
        }

    def reset(self) -> None:
        self._buckets = [0] * len(self._bounds)
        self._overflow = 0
        self._count = 0
        self._sum = 0
        self._min = None
        self._max = None
        self._recent.clear()


@dataclass(slots=True)
class CounterSet:
    """Monotonic event counters for one stream."""

    messages: int = 0
    parse_errors: int = 0
    dropped: int = 0
    gaps: int = 0
    resyncs: int = 0
    stale_transitions: int = 0
    reconnects: int = 0
    subscription_failures: int = 0

    def to_dict(self) -> dict[str, int]:
        return {
            "messages": self.messages,
            "parseErrors": self.parse_errors,
            "dropped": self.dropped,
            "gaps": self.gaps,
            "resyncs": self.resyncs,
            "staleTransitions": self.stale_transitions,
            "reconnects": self.reconnects,
            "subscriptionFailures": self.subscription_failures,
        }


@dataclass(slots=True)
class TransportCounters:
    """Connection-level counters for one venue connection.

    Separate from :class:`CounterSet` because these describe the socket, not a
    stream: a single connection carries many streams, and attributing a
    disconnect to one arbitrary symbol would make both numbers wrong.
    """

    connection_attempts: int = 0
    connection_successes: int = 0
    connection_failures: int = 0
    disconnects: int = 0
    reconnects: int = 0
    frames_received: int = 0
    bytes_received: int = 0
    frames_sent: int = 0
    parse_errors: int = 0
    heartbeat_failures: int = 0
    snapshot_requests: int = 0
    snapshot_failures: int = 0
    book_resyncs: int = 0

    def to_dict(self) -> dict[str, int]:
        return {
            "connectionAttempts": self.connection_attempts,
            "connectionSuccesses": self.connection_successes,
            "connectionFailures": self.connection_failures,
            "disconnects": self.disconnects,
            "reconnects": self.reconnects,
            "framesReceived": self.frames_received,
            "bytesReceived": self.bytes_received,
            "framesSent": self.frames_sent,
            "parseErrors": self.parse_errors,
            "heartbeatFailures": self.heartbeat_failures,
            "snapshotRequests": self.snapshot_requests,
            "snapshotFailures": self.snapshot_failures,
            "bookResyncs": self.book_resyncs,
        }


@dataclass(slots=True)
class TransportMetrics:
    """Transport counters plus the REST snapshot latency distribution.

    Snapshot latency is measured entirely on the local clock — request sent to
    response parsed — so unlike feed lag it carries no clock-skew caveat. It
    still says nothing about the venue's internal processing time, and nothing
    here should be read as a service-level commitment.
    """

    exchange: str
    counters: TransportCounters = field(default_factory=TransportCounters)
    snapshot_latency: LatencyHistogram = field(default_factory=LatencyHistogram)
    connected_since: int | None = None
    last_disconnect_at: int | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "exchange": self.exchange,
            "counters": self.counters.to_dict(),
            "snapshotLatencyMicros": self.snapshot_latency.to_dict(),
            "connectedSince": self.connected_since,
            "lastDisconnectAt": self.last_disconnect_at,
        }


@dataclass(slots=True)
class StreamMetrics:
    """Everything measured for one ``(exchange, channel, symbol)`` stream."""

    exchange: str
    channel: str
    symbol: str
    counters: CounterSet = field(default_factory=CounterSet)
    feed_lag: LatencyHistogram = field(default_factory=LatencyHistogram)
    processing: LatencyHistogram = field(default_factory=LatencyHistogram)
    end_to_end: LatencyHistogram = field(default_factory=LatencyHistogram)
    first_message_at: int | None = None
    last_message_at: int | None = None

    @property
    def key(self) -> tuple[str, str, str]:
        return (self.exchange, self.channel, self.symbol)

    def record_message(
        self,
        *,
        exchange_timestamp: int | None,
        received_timestamp: int,
        processed_timestamp: int | None = None,
    ) -> None:
        """Record one message and its timings."""
        self.counters.messages += 1
        if self.first_message_at is None:
            self.first_message_at = received_timestamp
        self.last_message_at = received_timestamp

        if exchange_timestamp is not None and exchange_timestamp > 0:
            self.feed_lag.observe(received_timestamp - exchange_timestamp)

        if processed_timestamp is not None:
            self.processing.observe(processed_timestamp - received_timestamp)
            if exchange_timestamp is not None and exchange_timestamp > 0:
                self.end_to_end.observe(processed_timestamp - exchange_timestamp)

    def messages_per_second(self, *, now_micros: int | None = None) -> float | None:
        """Average rate since the first message. ``None`` below two samples."""
        if self.first_message_at is None or self.counters.messages < 2:
            return None
        now = epoch_micros() if now_micros is None else now_micros
        elapsed = now - self.first_message_at
        if elapsed <= 0:
            return None
        return self.counters.messages / (elapsed / 1_000_000)

    def to_dict(self, *, now_micros: int | None = None) -> dict[str, object]:
        return {
            "exchange": self.exchange,
            "channel": self.channel,
            "symbol": self.symbol,
            "counters": self.counters.to_dict(),
            "feedLagMicros": self.feed_lag.to_dict(),
            "processingMicros": self.processing.to_dict(),
            "endToEndMicros": self.end_to_end.to_dict(),
            "messagesPerSecond": self.messages_per_second(now_micros=now_micros),
            "firstMessageAt": self.first_message_at,
            "lastMessageAt": self.last_message_at,
        }


class ConnectivityMetrics:
    """Registry of per-stream metrics for one service instance.

    In-process and in-memory by design. Shipping every measurement to a metrics
    backend synchronously would put a network call in the hot path — the exact
    thing the data-plane rules forbid. A collector scrapes :meth:`to_dict` on
    its own schedule instead.
    """

    __slots__ = ("_streams", "_started_at", "_transports")

    def __init__(self) -> None:
        self._streams: dict[tuple[str, str, str], StreamMetrics] = {}
        self._transports: dict[str, TransportMetrics] = {}
        self._started_at = epoch_micros()

    def transport(self, exchange: str) -> TransportMetrics:
        """Get or create the transport record for a venue connection."""
        metrics = self._transports.get(exchange)
        if metrics is None:
            metrics = TransportMetrics(exchange=exchange)
            self._transports[exchange] = metrics
        return metrics

    # ------------------------------------------------------------------
    # Transport-level recording
    # ------------------------------------------------------------------
    def record_connection_attempt(self, exchange: str) -> None:
        self.transport(exchange).counters.connection_attempts += 1

    def record_connection_success(
        self, exchange: str, *, at_micros: int | None = None
    ) -> None:
        metrics = self.transport(exchange)
        metrics.counters.connection_successes += 1
        metrics.connected_since = (
            epoch_micros() if at_micros is None else at_micros
        )

    def record_connection_failure(self, exchange: str) -> None:
        self.transport(exchange).counters.connection_failures += 1

    def record_disconnect(
        self, exchange: str, *, at_micros: int | None = None
    ) -> None:
        metrics = self.transport(exchange)
        metrics.counters.disconnects += 1
        metrics.connected_since = None
        metrics.last_disconnect_at = (
            epoch_micros() if at_micros is None else at_micros
        )

    def record_transport_reconnect(self, exchange: str) -> None:
        self.transport(exchange).counters.reconnects += 1

    def record_frame(self, exchange: str, *, byte_count: int = 0) -> None:
        counters = self.transport(exchange).counters
        counters.frames_received += 1
        counters.bytes_received += max(0, byte_count)

    def record_bytes(self, exchange: str, byte_count: int) -> None:
        self.transport(exchange).counters.bytes_received += max(0, byte_count)

    def record_frame_sent(self, exchange: str) -> None:
        self.transport(exchange).counters.frames_sent += 1

    def record_transport_parse_error(self, exchange: str) -> None:
        self.transport(exchange).counters.parse_errors += 1

    def record_heartbeat_failure(self, exchange: str) -> None:
        self.transport(exchange).counters.heartbeat_failures += 1

    def record_snapshot_request(
        self, exchange: str, *, latency_micros: int | None = None, success: bool = True
    ) -> None:
        """Record one REST order-book snapshot fetch.

        Failures are counted but contribute no latency sample: a timeout's
        duration is a property of the timeout setting, and mixing it into the
        distribution would make the numbers describe the configuration rather
        than the venue.
        """
        metrics = self.transport(exchange)
        metrics.counters.snapshot_requests += 1
        if not success:
            metrics.counters.snapshot_failures += 1
            return
        if latency_micros is not None:
            metrics.snapshot_latency.observe(latency_micros)

    def record_book_resync(self, exchange: str) -> None:
        self.transport(exchange).counters.book_resyncs += 1

    def stream(self, exchange: str, channel: str, symbol: str) -> StreamMetrics:
        """Get or create the metrics record for a stream."""
        key = (exchange, channel, symbol)
        metrics = self._streams.get(key)
        if metrics is None:
            metrics = StreamMetrics(exchange=exchange, channel=channel, symbol=symbol)
            self._streams[key] = metrics
        return metrics

    def record_message(
        self,
        exchange: str,
        channel: str,
        symbol: str,
        *,
        exchange_timestamp: int | None,
        received_timestamp: int,
        processed_timestamp: int | None = None,
    ) -> None:
        self.stream(exchange, channel, symbol).record_message(
            exchange_timestamp=exchange_timestamp,
            received_timestamp=received_timestamp,
            processed_timestamp=processed_timestamp,
        )

    def record_gap(self, exchange: str, channel: str, symbol: str) -> None:
        self.stream(exchange, channel, symbol).counters.gaps += 1

    def record_resync(self, exchange: str, channel: str, symbol: str) -> None:
        self.stream(exchange, channel, symbol).counters.resyncs += 1

    def record_parse_error(self, exchange: str, channel: str, symbol: str) -> None:
        self.stream(exchange, channel, symbol).counters.parse_errors += 1

    def record_drop(self, exchange: str, channel: str, symbol: str) -> None:
        self.stream(exchange, channel, symbol).counters.dropped += 1

    def record_stale_transition(self, exchange: str, channel: str, symbol: str) -> None:
        self.stream(exchange, channel, symbol).counters.stale_transitions += 1

    def record_reconnect(self, exchange: str, channel: str, symbol: str) -> None:
        self.stream(exchange, channel, symbol).counters.reconnects += 1

    def record_subscription_failure(
        self, exchange: str, channel: str, symbol: str
    ) -> None:
        self.stream(exchange, channel, symbol).counters.subscription_failures += 1

    @property
    def stream_count(self) -> int:
        return len(self._streams)

    def totals(self) -> dict[str, int]:
        """Summed counters across every stream."""
        total = CounterSet()
        for metrics in self._streams.values():
            total.messages += metrics.counters.messages
            total.parse_errors += metrics.counters.parse_errors
            total.dropped += metrics.counters.dropped
            total.gaps += metrics.counters.gaps
            total.resyncs += metrics.counters.resyncs
            total.stale_transitions += metrics.counters.stale_transitions
            total.reconnects += metrics.counters.reconnects
            total.subscription_failures += metrics.counters.subscription_failures
        return total.to_dict()

    def to_dict(self, *, now_micros: int | None = None) -> dict[str, object]:
        """Scrapeable snapshot.

        Percentiles are labelled ``observed`` to make clear they describe past
        measurements on this instance and are not a service-level guarantee.
        """
        now = epoch_micros() if now_micros is None else now_micros
        return {
            "startedAt": self._started_at,
            "uptimeMicros": now - self._started_at,
            "streamCount": len(self._streams),
            "totals": self.totals(),
            "transports": [
                self._transports[exchange].to_dict()
                for exchange in sorted(self._transports)
            ],
            "observed": [
                metrics.to_dict(now_micros=now)
                for metrics in sorted(self._streams.values(), key=lambda m: m.key)
            ],
        }

    def transport_totals(self) -> dict[str, int]:
        """Summed transport counters across every venue connection."""
        total = TransportCounters()
        for metrics in self._transports.values():
            counters = metrics.counters
            total.connection_attempts += counters.connection_attempts
            total.connection_successes += counters.connection_successes
            total.connection_failures += counters.connection_failures
            total.disconnects += counters.disconnects
            total.reconnects += counters.reconnects
            total.frames_received += counters.frames_received
            total.bytes_received += counters.bytes_received
            total.frames_sent += counters.frames_sent
            total.parse_errors += counters.parse_errors
            total.heartbeat_failures += counters.heartbeat_failures
            total.snapshot_requests += counters.snapshot_requests
            total.snapshot_failures += counters.snapshot_failures
            total.book_resyncs += counters.book_resyncs
        return total.to_dict()

    def reset(self) -> None:
        self._streams.clear()
        self._transports.clear()
        self._started_at = epoch_micros()


# ----------------------------------------------------------------------
# Part 5: execution-path instrumentation
# ----------------------------------------------------------------------
#: Named stages of the order pipeline, measured independently.
#:
#: They are separate histograms rather than one end-to-end number because the
#: remedies differ entirely: a slow risk stage is a database problem, a slow
#: signing stage is a CPU problem, and a slow network stage is somebody else's
#: problem. A single aggregate hides which.
EXECUTION_STAGES: tuple[str, ...] = (
    "validation",
    "risk",
    "safety_gates",
    "lock_acquire",
    "signing",
    "network",
    "exchange_ack",
    "persistence",
    "total_submit",
    "first_fill",
    "private_stream_delivery",
    "reconciliation_pass",
)


@dataclass(slots=True)
class ExecutionCounters:
    """Monotonic counters for the execution path.

    Every field answers a question an operator actually asks during an
    incident: how many orders did we send, how many did the venue refuse, and —
    the one that matters most — how many are in an unknown state right now.
    """

    orders_submitted: int = 0
    orders_accepted: int = 0
    orders_rejected_locally: int = 0
    orders_rejected_by_exchange: int = 0
    orders_duplicate: int = 0
    orders_dry_run: int = 0
    orders_unknown: int = 0
    orders_cancelled: int = 0
    fills_applied: int = 0
    fills_deduplicated: int = 0
    validation_failures: int = 0
    risk_rejections: int = 0
    kill_switch_blocks: int = 0
    signing_failures: int = 0
    clock_skew_rejections: int = 0
    auth_failures: int = 0
    rate_limit_refusals: int = 0
    reconciliation_passes: int = 0
    reconciliation_failures: int = 0
    discrepancies_found: int = 0
    discrepancies_repaired: int = 0
    incidents_raised: int = 0
    private_stream_reconnects: int = 0
    private_stream_events: int = 0
    listen_key_renewals: int = 0
    listen_key_renewal_failures: int = 0

    def to_dict(self) -> dict[str, int]:
        return {
            "ordersSubmitted": self.orders_submitted,
            "ordersAccepted": self.orders_accepted,
            "ordersRejectedLocally": self.orders_rejected_locally,
            "ordersRejectedByExchange": self.orders_rejected_by_exchange,
            "ordersDuplicate": self.orders_duplicate,
            "ordersDryRun": self.orders_dry_run,
            "ordersUnknown": self.orders_unknown,
            "ordersCancelled": self.orders_cancelled,
            "fillsApplied": self.fills_applied,
            "fillsDeduplicated": self.fills_deduplicated,
            "validationFailures": self.validation_failures,
            "riskRejections": self.risk_rejections,
            "killSwitchBlocks": self.kill_switch_blocks,
            "signingFailures": self.signing_failures,
            "clockSkewRejections": self.clock_skew_rejections,
            "authFailures": self.auth_failures,
            "rateLimitRefusals": self.rate_limit_refusals,
            "reconciliationPasses": self.reconciliation_passes,
            "reconciliationFailures": self.reconciliation_failures,
            "discrepanciesFound": self.discrepancies_found,
            "discrepanciesRepaired": self.discrepancies_repaired,
            "incidentsRaised": self.incidents_raised,
            "privateStreamReconnects": self.private_stream_reconnects,
            "privateStreamEvents": self.private_stream_events,
            "listenKeyRenewals": self.listen_key_renewals,
            "listenKeyRenewalFailures": self.listen_key_renewal_failures,
        }


class ExecutionMetrics:
    """Latency distributions and counters for the authenticated path.

    These are **observations**, not guarantees. The figures include this
    process's own scheduling delay, the venue's queueing, and the internet in
    between. They are useful for spotting a regression and for capacity
    planning, and they are not a service-level guarantee of any kind — this
    platform makes no low-latency promises and none should be inferred from a
    good percentile here.
    """

    __slots__ = ("_stages", "_counters", "_started_at", "_exchange")

    def __init__(self, exchange: str = "") -> None:
        self._exchange = exchange
        self._stages: dict[str, LatencyHistogram] = {
            stage: LatencyHistogram() for stage in EXECUTION_STAGES
        }
        self._counters = ExecutionCounters()
        self._started_at = epoch_micros()

    @property
    def counters(self) -> ExecutionCounters:
        return self._counters

    def observe(self, stage: str, micros: int) -> None:
        """Record one measurement for a named stage.

        An unknown stage name is created on demand rather than dropped: losing
        a measurement because a new stage was added in one place and not the
        other is a silent failure, and a stray key in a metrics dump is not.
        """
        histogram = self._stages.get(stage)
        if histogram is None:
            histogram = LatencyHistogram()
            self._stages[stage] = histogram
        histogram.observe(micros)

    def stage(self, name: str) -> LatencyHistogram | None:
        return self._stages.get(name)

    def to_dict(self, *, now_micros: int | None = None) -> dict[str, object]:
        now = epoch_micros() if now_micros is None else now_micros
        return {
            "exchange": self._exchange,
            "uptimeMicros": now - self._started_at,
            "counters": self._counters.to_dict(),
            "stages": {
                name: histogram.to_dict()
                for name, histogram in sorted(self._stages.items())
                if histogram.count > 0
            },
            "note": (
                "Latency figures are observations of this process and its "
                "network path. They are not a performance guarantee."
            ),
        }

    def reset(self) -> None:
        for histogram in self._stages.values():
            histogram.reset()
        self._counters = ExecutionCounters()
        self._started_at = epoch_micros()


#: Stages measured on the strategy path. Same caveat as ``EXECUTION_STAGES``:
#: these are observations of this process, never a guarantee.
STRATEGY_STAGES: tuple[str, ...] = (
    "feature_calculation",
    "strategy_processing",
    "signal_validation",
    "simulated_execution",
    "paper_dispatch",
    "backtest_run",
)


@dataclass(slots=True)
class StrategyCounters:
    """Monotonic counters for the strategy, paper and backtest layers.

    Kept in one counter set rather than three because an operator diagnosing
    "why did this strategy stop trading?" needs the strategy, validation and
    simulation numbers on one screen, and splitting them across registries
    would make that a join.
    """

    instances_registered: int = 0
    instances_started: int = 0
    instances_stopped: int = 0
    instances_failed: int = 0
    instances_quarantined: int = 0
    engine_halts: int = 0
    events_processed: int = 0
    timer_ticks: int = 0
    signals_generated: int = 0
    signals_accepted: int = 0
    signals_rejected: int = 0
    signals_deduplicated: int = 0
    strategy_errors: int = 0
    feature_errors: int = 0
    feature_resets: int = 0
    provider_errors: int = 0
    slow_dispatches: int = 0
    risk_rejections: int = 0
    simulated_orders: int = 0
    simulated_fills: int = 0
    simulated_orders_rejected: int = 0
    paper_sessions_started: int = 0
    paper_sessions_stopped: int = 0
    backtests_completed: int = 0
    replay_events: int = 0

    def to_dict(self) -> dict[str, int]:
        return {
            "instancesRegistered": self.instances_registered,
            "instancesStarted": self.instances_started,
            "instancesStopped": self.instances_stopped,
            "instancesFailed": self.instances_failed,
            "instancesQuarantined": self.instances_quarantined,
            "engineHalts": self.engine_halts,
            "eventsProcessed": self.events_processed,
            "timerTicks": self.timer_ticks,
            "signalsGenerated": self.signals_generated,
            "signalsAccepted": self.signals_accepted,
            "signalsRejected": self.signals_rejected,
            "signalsDeduplicated": self.signals_deduplicated,
            "strategyErrors": self.strategy_errors,
            "featureErrors": self.feature_errors,
            "featureResets": self.feature_resets,
            "providerErrors": self.provider_errors,
            "slowDispatches": self.slow_dispatches,
            "riskRejections": self.risk_rejections,
            "simulatedOrders": self.simulated_orders,
            "simulatedFills": self.simulated_fills,
            "simulatedOrdersRejected": self.simulated_orders_rejected,
            "paperSessionsStarted": self.paper_sessions_started,
            "paperSessionsStopped": self.paper_sessions_stopped,
            "backtestsCompleted": self.backtests_completed,
            "replayEvents": self.replay_events,
        }


class StrategyMetrics:
    """Counters and latency distributions for the Part 6 strategy layer.

    Mirrors :class:`ExecutionMetrics` in shape so an operator reads both the
    same way, and carries the same warning: every figure is an observation of
    what this process did, including its own scheduling delay. Nothing here is
    a latency guarantee, and a good percentile is not a promise about the next
    event.

    In-process and in-memory. No metric is shipped synchronously, because a
    network call on the strategy path is exactly what the data-plane rules
    forbid.
    """

    __slots__ = ("_stages", "_counters", "_started_at")

    def __init__(self) -> None:
        self._stages: dict[str, LatencyHistogram] = {
            stage: LatencyHistogram() for stage in STRATEGY_STAGES
        }
        self._counters = StrategyCounters()
        self._started_at = epoch_micros()

    @property
    def counters(self) -> StrategyCounters:
        return self._counters

    def observe(self, stage: str, micros: int) -> None:
        """Record one measurement. Unknown stages are created on demand."""
        histogram = self._stages.get(stage)
        if histogram is None:
            histogram = LatencyHistogram()
            self._stages[stage] = histogram
        histogram.observe(micros)

    def stage(self, name: str) -> LatencyHistogram | None:
        return self._stages.get(name)

    def to_dict(self, *, now_micros: int | None = None) -> dict[str, object]:
        now = epoch_micros() if now_micros is None else now_micros
        return {
            "uptimeMicros": now - self._started_at,
            "counters": self._counters.to_dict(),
            "stages": {
                name: histogram.to_dict()
                for name, histogram in sorted(self._stages.items())
                if histogram.count > 0
            },
            "note": (
                "Strategy latency figures are observations of this process. "
                "They are not a performance guarantee, and no strategy "
                "profitability is implied by any counter here."
            ),
        }

    def reset(self) -> None:
        for histogram in self._stages.values():
            histogram.reset()
        self._counters = StrategyCounters()
        self._started_at = epoch_micros()
```

---

## FILE: libs/trading-core/wlct_trading/adapters/paper.py

```py
"""Paper-trading venue.

A simulated matching engine used to exercise the full order path - strategy,
risk, OMS, position tracking - without sending anything to a real exchange.

Honesty rules, enforced structurally rather than by convention:

* ``is_simulated`` is ``True`` on the adapter, on every :class:`SubmitResult`
  and on every :class:`Fill` it produces. The OMS copies that flag onto the
  order and the position manager onto the position, so a simulated result
  cannot be displayed or reported as a real one anywhere downstream.
* Fills are produced only against **real observed market data**. The adapter is
  given a live top-of-book and will not invent a price. If no usable book is
  available the order simply rests unfilled - it never fabricates an execution.
* Marketable orders cross the real spread and are filled at the real touch
  price, capped by the real resting quantity, so the simulation inherits the
  actual liquidity conditions rather than assuming infinite depth.

This is a simulator and is labelled as one. It models neither queue position
nor market impact, so its fills are optimistic relative to live trading.

Where the fill rules live
-------------------------
The matching rules themselves are **not** implemented here. They live in
:class:`~wlct_trading.backtest.simulator.SimulatedMatchingEngine`, which is the
one implementation shared by this adapter and by the backtest engine. Two
copies of "when does a simulated order fill" would eventually disagree, and the
difference between paper results and backtest results would then be an artefact
of the code rather than of the market. This class configures that engine with
assumptions that reproduce the adapter's established behaviour exactly -
immediate taker fill at the observed touch, capped by displayed size, no
slippage, no latency model - and adds the venue-shaped API around it.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import AsyncIterator, Callable

from wlct_trading.backtest.simulator import (
    ExecutionAssumptions,
    SimulatedIdFactory,
    SimulatedMatchingEngine,
)
from wlct_trading.clock import epoch_micros
from wlct_trading.enums import ExchangeId, OrderStatus
from wlct_trading.market_data import BookTop
from wlct_trading.orders import Fill, Order, OrderIntent
from wlct_trading.adapters.base import (
    AccountAdapter,
    AccountBalance,
    CancelResult,
    SubmitResult,
    TradingAdapter,
    VenueAccount,
    VenuePosition,
)

__all__ = ["PaperTradingAdapter", "PaperAccountAdapter", "BookProvider"]

_ZERO = Decimal(0)

#: Supplies the current real top-of-book for a symbol, or ``None`` when the
#: book is unavailable or untrustworthy.
BookProvider = Callable[[ExchangeId, str], BookTop | None]


class _EmptyFillStream(AsyncIterator[Fill]):
    """An ``AsyncIterator[Fill]`` that stops immediately, for adapters with
    no fill stream.

    The explicit ABC inheritance is load-bearing for the type gate: without a
    declared base, mypy must infer whether this class satisfies a Protocol it
    nominally claims in ``stream_fills``, and refuses to.

    A do-nothing async generator would read better but is either an
    unreachable ``yield`` or a plain function returning ``None``; both are
    lies of a kind the strict type gate is right to refuse.
    """

    __slots__ = ()

    def __aiter__(self) -> AsyncIterator[Fill]:
        return self

    async def __anext__(self) -> Fill:
        raise StopAsyncIteration


class PaperTradingAdapter(TradingAdapter):
    """Simulated order entry backed by real observed prices."""

    __slots__ = (
        "_book_provider",
        "_exchange",
        "_resting",
        "_fee_rate",
        "_fee_currency",
        "_engine",
    )

    def __init__(
        self,
        book_provider: BookProvider,
        *,
        exchange: ExchangeId = ExchangeId.PAPER,
        fee_rate: Decimal = Decimal("0.001"),
        fee_currency: str = "USDT",
    ) -> None:
        self._book_provider = book_provider
        self._exchange = exchange
        self._resting: dict[str, Order] = {}
        self._fee_rate = fee_rate
        self._fee_currency = fee_currency
        # Assumptions chosen to reproduce this adapter's historical behaviour
        # exactly: one fee rate for both sides, no slippage, no latency, fills
        # capped by displayed size, partial fills permitted.
        self._engine = SimulatedMatchingEngine(
            ExecutionAssumptions(
                maker_fee_rate=fee_rate,
                taker_fee_rate=fee_rate,
                slippage_bps=_ZERO,
                fee_currency=fee_currency,
                latency_micros=0,
                allow_partial_fills=True,
                cap_by_displayed_size=True,
                min_fill_quantity=_ZERO,
            ),
            # Random ids: this adapter runs against live data where
            # reproducibility is neither achievable nor expected. The backtest
            # engine supplies a deterministic factory instead.
            id_factory=SimulatedIdFactory(prefix="paper", deterministic=False),
            exchange=exchange,
        )

    @property
    def exchange(self) -> ExchangeId:
        return self._exchange

    @property
    def is_simulated(self) -> bool:
        return True

    @property
    def fee_rate(self) -> Decimal:
        return self._fee_rate

    @property
    def fee_currency(self) -> str:
        return self._fee_currency

    async def submit_order(
        self, intent: OrderIntent, client_order_id: str
    ) -> SubmitResult:
        """Accept the order and fill it if the real book says it would cross."""
        now = epoch_micros()
        book = self._book_provider(intent.exchange, intent.symbol)
        exchange_order_id = f"paper-{uuid.uuid4().hex[:16]}"

        match = self._engine.submit(
            intent,
            client_order_id=client_order_id,
            order_id="",
            book=book,
            now_micros=now,
        )

        if match.rests:
            # This adapter has no book-update callback, so a resting order
            # would never be revisited. Dropping it from the engine keeps the
            # engine's resting book from growing without bound; the order is
            # still reported as ACKNOWLEDGED, exactly as before.
            self._engine.cancel(client_order_id)

        if not match.accepted:
            return SubmitResult(
                accepted=False,
                exchange_order_id=None,
                status=OrderStatus.REJECTED,
                rejection_code="SIMULATED_VALIDATION",
                rejection_reason=match.reason,
                is_simulated=True,
                submitted_at_micros=now,
                fills=(),
            )

        return SubmitResult(
            accepted=True,
            exchange_order_id=exchange_order_id,
            status=(
                OrderStatus.ACKNOWLEDGED if not match.fills else match.status
            ),
            is_simulated=True,
            submitted_at_micros=now,
            fills=match.fills,
        )

    async def cancel_order(self, order: Order) -> CancelResult:
        self._resting.pop(order.client_order_id, None)
        self._engine.cancel(order.client_order_id)
        return CancelResult(
            accepted=True,
            status=OrderStatus.CANCELLED,
            reason="Cancelled on the simulated venue.",
            is_simulated=True,
        )

    async def fetch_order(
        self, tenant_id: str, account_id: str, client_order_id: str
    ) -> Order | None:
        return self._resting.get(client_order_id)

    async def fetch_open_orders(
        self, tenant_id: str, account_id: str, *, symbol: str | None = None
    ) -> tuple[Order, ...]:
        """Resting simulated orders for this account.

        Scoped by tenant and account even though the simulator is process-local:
        the reconciliation code path is shared with the live adapters, and a
        paper run that quietly ignored the scoping would not exercise the same
        behaviour it is meant to rehearse.
        """
        return tuple(
            order
            for order in self._resting.values()
            if order.tenant_id == tenant_id
            and order.account_id == account_id
            and (symbol is None or order.symbol == symbol)
        )

    async def exchange_time(self) -> int:
        """Local wall clock, in milliseconds.

        The simulated venue has no clock of its own, so the offset it reports is
        always zero. That is honest rather than convenient: there is genuinely
        no skew between this process and a venue running inside it.
        """
        return epoch_micros() // 1_000

    def stream_fills(
        self, tenant_id: str, account_id: str
    ) -> AsyncIterator[Fill]:
        """The simulator fills synchronously in ``submit_order``.

        There is therefore no asynchronous fill stream; this yields nothing.
        An immediate-stop iterator is used instead of an empty async
        generator because an async generator with no reachable ``yield`` is
        either dead code or a syntax error, and neither is honest.
        """
        return _EmptyFillStream()


class PaperAccountAdapter(AccountAdapter):
    """Account view for the simulated venue.

    Balances are configured by the operator rather than fetched, and are
    labelled simulated wherever they surface.
    """

    __slots__ = ("_exchange", "_balances")

    def __init__(
        self,
        balances: dict[str, Decimal] | None = None,
        *,
        exchange: ExchangeId = ExchangeId.PAPER,
    ) -> None:
        self._exchange = exchange
        self._balances = balances or {}

    @property
    def exchange(self) -> ExchangeId:
        return self._exchange

    async def fetch_balances(
        self, tenant_id: str, account_id: str
    ) -> tuple[AccountBalance, ...]:
        return tuple(
            AccountBalance(asset=asset, free=amount, locked=_ZERO)
            for asset, amount in sorted(self._balances.items())
        )

    async def fetch_positions(
        self, tenant_id: str, account_id: str
    ) -> tuple[VenuePosition, ...]:
        """The simulator holds no venue-side positions.

        Position state for paper trading is derived from simulated fills by the
        platform's own position manager, exactly as it is for live trading.
        """
        return ()

    async def fetch_account(self, tenant_id: str, account_id: str) -> VenueAccount:
        """Simulated account snapshot.

        ``can_withdraw`` is hard-coded ``False``: the simulator must never
        present itself as capable of moving funds, and a paper account that
        claimed withdrawal rights would be rejected by the platform's own
        safety check anyway.
        """
        return VenueAccount(
            exchange=self._exchange,
            balances=await self.fetch_balances(tenant_id, account_id),
            can_trade=True,
            can_withdraw=False,
            can_deposit=False,
            account_type="SIMULATED",
            updated_at_micros=epoch_micros(),
            maker_commission_bps=None,
            taker_commission_bps=None,
        )

    async def verify_credentials(
        self, tenant_id: str, account_id: str
    ) -> tuple[bool, str]:
        return (True, "Simulated venue; no credentials are required or stored.")
```

---

## FILE: libs/trading-core/wlct_trading/__init__.py

```py
"""wlct-trading-core: the shared trading data-plane library.

One implementation of the order book, the OMS state machine, the risk engine
and the position tracker, imported by every data-plane service
(``market-data``, ``trading-engine``, ``execution-engine``). Keeping these in a
library rather than copying them into each service is what guarantees that the
risk rules enforced at signal time are byte-for-byte the rules enforced at
submission time.

The library has zero runtime dependencies and opens no sockets, reads no
configuration and touches no database. The connectivity layer added in
:mod:`wlct_trading.transport` and :mod:`wlct_trading.exchanges` describes *how*
to talk to a venue - framing, sequencing, backoff, rate budgets - but the actual
socket and HTTP calls are injected by the host service. That is what keeps the
whole package installable and exhaustively testable on a machine with no
network, no broker and no database.

The concrete implementations of those injected calls live in
:mod:`wlct_trading.net`, an optional subpackage installed with the ``live``
extra. Nothing here imports it, deliberately: importing this module must never
pull in a network client. ``wlct_trading.net`` handles **public market data
only** - it holds no credentials and submits no orders.

Authenticated trading lives in :mod:`wlct_trading.execution`, added in Part 5.
It is likewise not imported here. That is not an accident of layout: a service
that only needs market data should not be able to reach a module capable of
signing an order, and an explicit ``from wlct_trading.execution import ...`` is
a visible, greppable declaration that a component is in the money path.

The Part 6 strategy layer follows the same rule. :mod:`wlct_trading.strategies`
(features, strategy instances, signal validation, lifecycle),
:mod:`wlct_trading.backtest` (replay, simulated matching, portfolio, metrics)
and :mod:`wlct_trading.paper` (paper sessions) are importable but not
re-exported here, so a component that runs strategy code has to say so in its
imports. The shared vocabulary they depend on - :class:`Signal`,
:class:`BaseStrategy`, :class:`StrategyDescriptor`, the enums and the metrics
types - is exported below, because that vocabulary is genuinely shared.

None of those packages can reach an exchange. A strategy receives normalised
market data and returns a signal; the risk engine and the execution engine
decide what happens next.
"""

from wlct_trading.clock import (
    LatencyRecorder,
    LatencySpan,
    epoch_micros,
    epoch_millis,
    monotonic_nanos,
)
from wlct_trading.enums import (
    OPEN_ORDER_STATUSES,
    TERMINAL_ORDER_STATUSES,
    BacktestPhase,
    ExchangeId,
    KillSwitchScope,
    LimitFillRule,
    MarketEventKind,
    MarketFillPriceModel,
    MarketType,
    OrderBookHealth,
    OrderSide,
    OrderStatus,
    OrderType,
    PositionSide,
    RiskDecisionCode,
    SignalAction,
    SignalRejectionCode,
    StrategyFailurePolicy,
    StrategyStatus,
    TimeInForce,
    TradingEventType,
    TradingMode,
)
from wlct_trading.events import EventBus, InMemoryEventBus, TradingEvent
from wlct_trading.idempotency import (
    DuplicateOrderGuard,
    build_client_order_id,
    intent_fingerprint,
)
from wlct_trading.exchanges import (
    ExchangeCapabilities,
    ExchangeRegistration,
    ExchangeRegistry,
    SymbolMapping,
    SymbolRegistry,
    UnsupportedExchange,
    build_default_registry,
    to_canonical,
)
from wlct_trading.market_data import (
    BookTop,
    Candle,
    OrderBookDelta,
    OrderBookSnapshot,
    PriceLevel,
    PublicTrade,
    SymbolRef,
    Ticker,
)
from wlct_trading.metrics import (
    EXECUTION_STAGES,
    STRATEGY_STAGES,
    ConnectivityMetrics,
    ExecutionCounters,
    ExecutionMetrics,
    LatencyHistogram,
    StrategyCounters,
    StrategyMetrics,
    StreamMetrics,
)
from wlct_trading.order_book import BookApplyResult, DepthView, OrderBook
from wlct_trading.orderbook_sync import (
    OrderBookSynchroniser,
    SyncConfig,
    SyncOutcome,
    SyncPhase,
)
from wlct_trading.orders import (
    ORDER_STATE_TRANSITIONS,
    Fill,
    InvalidOrderTransition,
    Order,
    OrderEvent,
    OrderIntent,
    is_legal_transition,
)
from wlct_trading.positions import Position, PositionManager, PositionUpdate
from wlct_trading.redis_keys import TRADING_STREAM, RedisKeys
from wlct_trading.risk import (
    KillSwitchState,
    RiskDecision,
    RiskEngine,
    RiskLimits,
    RiskSnapshot,
    RiskViolation,
    TradingModeResolver,
)
from wlct_trading.transport import (
    BackoffConfig,
    ConnectionCallbacks,
    ConnectionConfig,
    ConnectionHealth,
    ConnectionState,
    ExchangeErrorCategory,
    ExponentialBackoff,
    MarketDataChannel,
    NormalisedExchangeError,
    RateLimitRegistry,
    RateLimitRule,
    StalenessMonitor,
    StalenessThresholds,
    Subscription,
    SubscriptionManager,
    SubscriptionStatus,
    WebSocketConnectionManager,
    WebSocketTransport,
)
from wlct_trading.signals import (
    BaseStrategy,
    Signal,
    SignalValidationError,
    StrategyDescriptor,
    StrategyRiskProfile,
    signal_to_intent,
)

__version__ = "0.6.0"

__all__ = [
    "__version__",
    "BackoffConfig",
    "BacktestPhase",
    "BaseStrategy",
    "BookApplyResult",
    "BookTop",
    "build_client_order_id",
    "build_default_registry",
    "Candle",
    "ConnectionCallbacks",
    "ConnectionConfig",
    "ConnectionHealth",
    "ConnectionState",
    "ConnectivityMetrics",
    "DepthView",
    "DuplicateOrderGuard",
    "epoch_micros",
    "epoch_millis",
    "EventBus",
    "ExchangeCapabilities",
    "ExchangeErrorCategory",
    "ExchangeId",
    "ExchangeRegistration",
    "ExchangeRegistry",
    "EXECUTION_STAGES",
    "ExecutionCounters",
    "ExecutionMetrics",
    "ExponentialBackoff",
    "Fill",
    "InMemoryEventBus",
    "intent_fingerprint",
    "InvalidOrderTransition",
    "is_legal_transition",
    "KillSwitchScope",
    "KillSwitchState",
    "LatencyHistogram",
    "LatencyRecorder",
    "LatencySpan",
    "LimitFillRule",
    "MarketDataChannel",
    "MarketEventKind",
    "MarketFillPriceModel",
    "MarketType",
    "monotonic_nanos",
    "NormalisedExchangeError",
    "OPEN_ORDER_STATUSES",
    "Order",
    "ORDER_STATE_TRANSITIONS",
    "OrderBook",
    "OrderBookDelta",
    "OrderBookHealth",
    "OrderBookSnapshot",
    "OrderBookSynchroniser",
    "OrderEvent",
    "OrderIntent",
    "OrderSide",
    "OrderStatus",
    "OrderType",
    "Position",
    "PositionManager",
    "PositionSide",
    "PositionUpdate",
    "PriceLevel",
    "PublicTrade",
    "RateLimitRegistry",
    "RateLimitRule",
    "RedisKeys",
    "RiskDecision",
    "RiskDecisionCode",
    "RiskEngine",
    "RiskLimits",
    "RiskSnapshot",
    "RiskViolation",
    "Signal",
    "signal_to_intent",
    "SignalAction",
    "SignalRejectionCode",
    "SignalValidationError",
    "StalenessMonitor",
    "StalenessThresholds",
    "STRATEGY_STAGES",
    "StrategyCounters",
    "StrategyDescriptor",
    "StrategyFailurePolicy",
    "StrategyMetrics",
    "StrategyRiskProfile",
    "StrategyStatus",
    "StreamMetrics",
    "Subscription",
    "SubscriptionManager",
    "SubscriptionStatus",
    "SymbolMapping",
    "SymbolRef",
    "SymbolRegistry",
    "SyncConfig",
    "SyncOutcome",
    "SyncPhase",
    "TERMINAL_ORDER_STATUSES",
    "Ticker",
    "TimeInForce",
    "to_canonical",
    "TRADING_STREAM",
    "TradingEvent",
    "TradingEventType",
    "TradingMode",
    "TradingModeResolver",
    "UnsupportedExchange",
    "WebSocketConnectionManager",
    "WebSocketTransport",
]
```

---

## FILE: libs/trading-core/pyproject.toml

```toml
[build-system]
requires = ["setuptools>=69", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "wlct-trading-core"
version = "0.6.0"
description = "Shared trading data-plane domain library for the WLCT platform"
requires-python = ">=3.11"
# The core library has no runtime dependencies and must keep it that way: it is
# imported by every data-plane service, and a dependency here is a dependency
# everywhere. The live network transport is an opt-in extra.
dependencies = []

[project.optional-dependencies]
# Production network transport (wlct_trading.net). Only the market-data service
# and the live smoke test install this.
#
# httpx rather than aiohttp: services/market-data already depends on httpx and
# uses it in app/services/providers.py. Two async HTTP stacks in one process
# would mean two connection pools and two sets of timeout semantics for no
# capability that is missing.
live = [
  "websockets>=13.1,<18",
  "httpx>=0.27,<0.29",
]
dev = [
  "pytest>=8.0",
  "mypy>=1.8",
  "ruff>=0.3",
]

[tool.setuptools.packages.find]
include = ["wlct_trading*"]

[tool.pytest.ini_options]
testpaths = ["tests"]
# No asyncio plugin is required: the handful of coroutine calls in the test
# suite are driven explicitly with asyncio.run(), which keeps the library's
# test dependencies to pytest alone.
#
# Every test in tests/ is hermetic: no internet, no credentials, no database,
# no Redis. The live smoke test is a separate script, not a test, precisely so
# that it cannot be picked up by a bare `pytest` run.
markers = [
  "live: touches a real exchange endpoint; never collected by default",
]
addopts = "-m 'not live'"

[tool.mypy]
python_version = "3.11"
strict = true
warn_unreachable = true

# websockets is an optional ([live] extra) dependency imported lazily inside a
# try/except with a purposeful error message; when it is not installed the
# guarded import must not become a type error.
[[tool.mypy.overrides]]
module = ["websockets.*"]
ignore_missing_imports = true

[tool.ruff]
line-length = 100
target-version = "py311"

# The ruleset is pinned rather than inherited from ruff's defaults, because
# those defaults have grown between releases and a CI gate that changes
# colour with the tool version is not a gate. E4/E7/E9/F is the classic
# default: syntax-level errors, imports, pyflakes. Correctness is gated;
# wrapping is not -- `ruff format` deliberately does not gate this repo, and
# the hand-wrapped line shapes are part of the reading experience.
[tool.ruff.lint]
select = ["E4", "E7", "E9", "F"]
```

---

## FILE: packages/config/src/env.schema.ts

```ts
import { z } from 'zod';

/**
 * Single source of truth for environment configuration.
 *
 * The schema is intentionally strict: the API refuses to boot when a value is
 * missing or malformed, which prevents an environment from silently starting
 * with, for example, an empty JWT secret.
 */

const booleanFromString = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === 'boolean') {
      return value;
    }
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  });

const intFromString = (defaultValue: number) =>
  z
    .union([z.number(), z.string()])
    .default(defaultValue)
    .transform((value, ctx) => {
      const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
      if (Number.isNaN(parsed)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Expected an integer value' });
        return z.NEVER;
      }
      return parsed;
    });

/**
 * A fixed-point decimal carried as a string.
 *
 * Deliberately not parsed into a JavaScript `number`. Fees, capital and
 * slippage end up in Decimal arithmetic in the Python data plane and in
 * Prisma `Decimal` columns; round-tripping them through a binary float here
 * would introduce exactly the representation error the rest of the platform
 * takes care to avoid. The value is validated as finite and in range, then
 * passed on verbatim.
 */
const decimalFromString = (
  defaultValue: string,
  { min, max }: { min: number; max: number },
) =>
  z
    .union([z.number(), z.string()])
    .default(defaultValue)
    .transform((value, ctx) => {
      const text = typeof value === 'number' ? String(value) : value.trim();
      if (!/^-?\d+(\.\d+)?$/.test(text)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Expected a plain decimal number, for example 0.001',
        });
        return z.NEVER;
      }
      const parsed = Number.parseFloat(text);
      if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Expected a decimal between ${min} and ${max}`,
        });
        return z.NEVER;
      }
      return text;
    });

const csv = (defaultValue: string) =>
  z
    .string()
    .default(defaultValue)
    .transform((value) =>
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    );

const jsonRecord = z
  .string()
  .default('{}')
  .transform((value, ctx) => {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Expected a JSON object' });
        return z.NEVER;
      }
      return parsed as Record<string, string>;
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Expected valid JSON' });
      return z.NEVER;
    }
  });

export const NodeEnvSchema = z.enum(['development', 'test', 'staging', 'production']);
export type NodeEnvironment = z.infer<typeof NodeEnvSchema>;

export const envSchema = z
  .object({
    // Application
    NODE_ENV: NodeEnvSchema.default('development'),
    APP_NAME: z.string().min(1).default('WhiteLabelCopyTrade'),
    API_PORT: intFromString(4000),
    API_HOST: z.string().default('0.0.0.0'),
    API_GLOBAL_PREFIX: z.string().default('api'),
    API_DEFAULT_VERSION: z.string().default('1'),
    API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
    ADMIN_WEB_URL: z.string().url().default('http://localhost:3000'),
    TRUST_PROXY_HOPS: intFromString(1),
    PLATFORM_ROOT_DOMAIN: z.string().default('copytrade.app'),
    DEFAULT_TENANT_SLUG: z.string().default('platform'),

    // Database
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DIRECT_DATABASE_URL: z.string().optional(),
    DATABASE_LOG_QUERIES: booleanFromString.default(false),
    DATABASE_SSL: booleanFromString.default(false),

    // Redis
    REDIS_HOST: z.string().default('localhost'),
    REDIS_PORT: intFromString(6379),
    REDIS_PASSWORD: z.string().optional(),
    REDIS_DB: intFromString(0),
    REDIS_TLS: booleanFromString.default(false),
    REDIS_KEY_PREFIX: z.string().default('wlct:'),

    // JWT
    JWT_ALGORITHM: z.enum(['HS256', 'HS512', 'RS256', 'RS512']).default('HS256'),
    JWT_ACCESS_SECRET: z.string().optional(),
    JWT_REFRESH_SECRET: z.string().optional(),
    JWT_PRIVATE_KEY_BASE64: z.string().optional(),
    JWT_PUBLIC_KEY_BASE64: z.string().optional(),
    JWT_ACCESS_TTL: z.string().default('900s'),
    JWT_REFRESH_TTL: z.string().default('30d'),
    JWT_ISSUER: z.string().default('https://api.copytrade.app'),
    JWT_AUDIENCE: z.string().default('copytrade-clients'),
    MAX_ACTIVE_SESSIONS_PER_USER: intFromString(10),

    // Password / hashing
    PASSWORD_MIN_LENGTH: intFromString(12),
    ARGON2_MEMORY_COST: intFromString(19456),
    ARGON2_TIME_COST: intFromString(2),
    ARGON2_PARALLELISM: intFromString(1),
    LOGIN_MAX_FAILED_ATTEMPTS: intFromString(5),
    LOGIN_FAILED_WINDOW_SECONDS: intFromString(900),
    ACCOUNT_LOCKOUT_SECONDS: intFromString(900),

    // Encryption
    ENCRYPTION_MASTER_KEY_BASE64: z.string().min(1, 'ENCRYPTION_MASTER_KEY_BASE64 is required'),
    ENCRYPTION_KEY_ID: z.string().default('local-dev-v1'),
    ENCRYPTION_PREVIOUS_KEYS_JSON: jsonRecord,
    ENCRYPTION_PROVIDER: z.enum(['local', 'kms']).default('local'),
    KMS_PROVIDER: z.string().optional(),
    KMS_KEY_ARN: z.string().optional(),
    BLIND_INDEX_KEY_BASE64: z.string().min(1, 'BLIND_INDEX_KEY_BASE64 is required'),

    // Two factor
    TWO_FACTOR_ISSUER: z.string().default('CopyTrade'),
    TWO_FACTOR_WINDOW: intFromString(1),
    TWO_FACTOR_DIGITS: intFromString(6),
    TWO_FACTOR_PERIOD: intFromString(30),
    TWO_FACTOR_RECOVERY_CODES: intFromString(10),
    TWO_FACTOR_CHALLENGE_TTL: z.string().default('300s'),
    // How many codes may be tried against ONE challenge token before it is
    // burned. Without a bound the challenge would either be single-use (a
    // mistyped digit forces the user to re-enter their password) or unlimited
    // (a captured challenge could be brute-forced for its whole TTL).
    TWO_FACTOR_MAX_CHALLENGE_ATTEMPTS: intFromString(5),

    // CORS
    CORS_ENABLED: booleanFromString.default(true),
    CORS_ORIGINS: csv('http://localhost:3000'),
    CORS_CREDENTIALS: booleanFromString.default(true),
    CORS_ALLOWED_HEADERS: csv(
      'Content-Type,Authorization,X-Tenant-Slug,X-Request-Id,X-Api-Version,Accept-Language,X-2FA-Token',
    ),
    CORS_EXPOSED_HEADERS: csv('X-Request-Id,X-RateLimit-Limit,X-RateLimit-Remaining'),

    // Rate limiting
    RATE_LIMIT_ENABLED: booleanFromString.default(true),
    RATE_LIMIT_TTL_SECONDS: intFromString(60),
    RATE_LIMIT_MAX: intFromString(120),
    RATE_LIMIT_AUTH_TTL_SECONDS: intFromString(300),
    RATE_LIMIT_AUTH_MAX: intFromString(10),
    RATE_LIMIT_TRUSTED_IPS: csv('127.0.0.1,::1'),

    // Swagger
    SWAGGER_ENABLED: booleanFromString.default(true),
    SWAGGER_PATH: z.string().default('docs'),
    SWAGGER_TITLE: z.string().default('White-Label Copy Trading API'),
    SWAGGER_DESCRIPTION: z.string().default('Multi-tenant crypto copy-trading platform API'),
    SWAGGER_VERSION: z.string().default('1.0.0'),
    SWAGGER_USER: z.string().optional(),
    SWAGGER_PASSWORD: z.string().optional(),

    // Logging
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    LOG_FORMAT: z.enum(['json', 'pretty']).default('json'),
    LOG_REQUEST_BODY: booleanFromString.default(false),
    LOG_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1),
    SENTRY_DSN: z.string().optional(),

    // WebSocket
    WS_ENABLED: booleanFromString.default(true),
    WS_PATH: z.string().default('/realtime'),
    WS_NAMESPACE: z.string().default('/v1'),
    WS_PING_INTERVAL_MS: intFromString(25000),
    WS_PING_TIMEOUT_MS: intFromString(20000),
    WS_MAX_CONNECTIONS_PER_USER: intFromString(5),
    WS_REDIS_ADAPTER: booleanFromString.default(true),

    // Queues
    QUEUE_PREFIX: z.string().default('wlct-queue'),
    QUEUE_DEFAULT_ATTEMPTS: intFromString(5),
    QUEUE_BACKOFF_MS: intFromString(5000),
    QUEUE_REMOVE_ON_COMPLETE: intFromString(1000),
    QUEUE_REMOVE_ON_FAIL: intFromString(5000),
    QUEUE_CONCURRENCY: intFromString(10),
    QUEUE_RUN_INLINE_WORKERS: booleanFromString.default(true),
    BULL_BOARD_ENABLED: booleanFromString.default(false),
    BULL_BOARD_PATH: z.string().default('admin/queues'),

    // Exchanges / internal services
    EXCHANGES_ENABLED: csv('binance,bybit,okx,kraken'),
    EXCHANGE_SANDBOX_MODE: booleanFromString.default(true),
    EXCHANGE_REQUEST_TIMEOUT_MS: intFromString(10000),
    EXCHANGE_MAX_RETRIES: intFromString(3),
    EXECUTION_ENABLED: booleanFromString.default(false),

    // --- Part 5: authenticated execution -------------------------------
    // Every one of these defaults to the safe value. Omission is never
    // consent: an operator who forgets a variable gets paper trading with
    // transmission disabled, not live money.

    /// Venue credentials for the platform-level dev/testnet account. Tenant
    /// accounts keep their own credentials in the database or a secret
    /// manager; these exist so a developer can run the smoke harness without
    /// provisioning a tenant. Never logged, never returned by an endpoint.
    BINANCE_API_KEY: z.string().optional(),
    BINANCE_API_SECRET: z.string().optional(),

    /// The master arming switch. False means no signed order request is ever
    /// transmitted, whatever any per-account flag says.
    LIVE_TRADING_ENABLED: booleanFromString.default(false),
    /// Build and sign the request, validate it, then stop. Nothing leaves the
    /// process and nothing is ever reported as submitted.
    DRY_RUN: booleanFromString.default(true),
    /// Route orders to the simulated venue. Simulated fills are labelled.
    PAPER_TRADING: booleanFromString.default(true),

    /// How long to wait for a submit response before the outcome is treated
    /// as unknown. A timeout is not a rejection.
    ORDER_REQUEST_TIMEOUT_MS: intFromString(10000),
    /// Interval between scheduled reconciliation sweeps.
    ORDER_RECONCILIATION_INTERVAL_MS: intFromString(30000),
    /// Whether the private user-data stream reconnects itself.
    PRIVATE_STREAM_RECONNECT_ENABLED: booleanFromString.default(true),
    /// How often to re-measure the offset between local and venue clocks.
    EXCHANGE_TIME_SYNC_INTERVAL_MS: intFromString(300000),
    /// Lifetime of an idempotency key. Must comfortably exceed the longest
    /// plausible retry window, or a duplicate slips through.
    EXECUTION_IDEMPOTENCY_TTL_SECONDS: intFromString(86400),
    /// Grace period before querying the venue about an unknown order. The
    /// venue may simply not have finished processing it yet.
    ORDER_UNKNOWN_RECONCILIATION_DELAY_MS: intFromString(2000),
    // --- Part 6: strategy engine, paper trading, backtesting -----------
    // The strategy layer produces signals. It cannot submit an order, and
    // none of these variables can enable live trading: that still requires
    // LIVE_TRADING_ENABLED, EXECUTION_ENABLED, DRY_RUN=false, PAPER_TRADING=
    // false and EXCHANGE_SANDBOX_MODE=false to agree, all validated above.

    /// Master switch for the strategy engine. Off by default: a deployment
    /// that has not been asked to run strategies should not run them.
    STRATEGY_ENGINE_ENABLED: booleanFromString.default(false),
    /// Whether paper sessions may be started. Paper sessions route to the
    /// simulated adapter only.
    PAPER_TRADING_ENABLED: booleanFromString.default(true),
    /// Whether backtests may be submitted. A backtest touches no venue.
    BACKTEST_ENABLED: booleanFromString.default(true),

    /// Bound on the in-process market-data queue feeding the strategies. A
    /// bounded queue is what turns a slow strategy into shed load rather than
    /// unbounded memory growth.
    STRATEGY_EVENT_QUEUE_SIZE: intFromString(10000),
    /// Hard cap on concurrently registered strategy instances per process.
    STRATEGY_MAX_INSTANCES: intFromString(50),
    /// Observation budget for one dispatch. Exceeding it increments a counter
    /// and marks the dispatch slow. It is not a latency guarantee and this
    /// platform does not offer one.
    STRATEGY_MAX_PROCESSING_LATENCY_MS: intFromString(50),

    /// A signal older than this is refused by the validator rather than acted
    /// on. Stale intent is how a backlog becomes a bad fill.
    SIGNAL_MAX_AGE_MS: intFromString(2000),
    /// How long a signal identity is remembered for deduplication. This is a
    /// bounded in-memory guard against a strategy repeating itself, not the
    /// order idempotency system, which lives in the execution layer.
    SIGNAL_DEDUP_TTL_SECONDS: intFromString(5),

    /// Defaults applied to a backtest that does not specify its own. They are
    /// assumptions, they are recorded in the configuration hash of every run,
    /// and they do not describe any real account.
    BACKTEST_DEFAULT_INITIAL_CAPITAL: decimalFromString('10000', {
      min: 0.00000001,
      max: 1000000000,
    }),
    /// Fee rates, not basis points: 0.001 is ten basis points.
    BACKTEST_DEFAULT_MAKER_FEE: decimalFromString('0.001', { min: 0, max: 0.1 }),
    BACKTEST_DEFAULT_TAKER_FEE: decimalFromString('0.001', { min: 0, max: 0.1 }),
    /// Slippage in basis points applied against every simulated taker fill.
    BACKTEST_DEFAULT_SLIPPAGE_BPS: decimalFromString('1', { min: 0, max: 1000 }),

    TRADING_ENGINE_URL: z.string().url().default('http://localhost:8001'),
    TRADING_ENGINE_HEALTH_PATH: z.string().default('/health'),
    MARKET_DATA_URL: z.string().url().default('http://localhost:8002'),
    MARKET_DATA_HEALTH_PATH: z.string().default('/health'),
    NOTIFICATION_SERVICE_URL: z.string().url().default('http://localhost:8003'),
    NOTIFICATION_SERVICE_HEALTH_PATH: z.string().default('/health'),
    INTERNAL_SERVICE_TOKEN: z.string().min(16, 'INTERNAL_SERVICE_TOKEN must be at least 16 chars'),
    EXCHANGE_WEBHOOK_SIGNING_SECRET: z.string().min(16),

    // Email
    MAIL_DRIVER: z.enum(['smtp', 'ses', 'postmark', 'console']).default('console'),
    MAIL_FROM_NAME: z.string().default('CopyTrade'),
    MAIL_FROM_ADDRESS: z.string().email().default('no-reply@copytrade.app'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: intFromString(587),
    SMTP_SECURE: booleanFromString.default(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),

    // Notifications
    NOTIFICATIONS_ENABLED: booleanFromString.default(true),
    FIREBASE_PROJECT_ID: z.string().optional(),
    FIREBASE_CLIENT_EMAIL: z.string().optional(),
    FIREBASE_PRIVATE_KEY_BASE64: z.string().optional(),
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_FROM_NUMBER: z.string().optional(),

    // Localisation / currency
    DEFAULT_LOCALE: z.string().default('en'),
    SUPPORTED_LOCALES: csv('en,es,ar,bn,tr'),
    DEFAULT_CURRENCY: z.string().default('USD'),
    SUPPORTED_CURRENCIES: csv('USD,EUR,GBP,AED,BDT,TRY'),
    FX_RATES_PROVIDER: z.string().default('none'),
    FX_RATES_API_KEY: z.string().optional(),

    // KYC
    KYC_PROVIDER: z.enum(['none', 'sumsub', 'onfido', 'shufti']).default('none'),
    KYC_API_URL: z.string().optional(),
    KYC_APP_TOKEN: z.string().optional(),
    KYC_SECRET_KEY: z.string().optional(),
    KYC_WEBHOOK_SECRET: z.string().optional(),

    // Billing
    BILLING_PROVIDER: z.enum(['none', 'stripe', 'nowpayments']).default('none'),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    NOWPAYMENTS_API_KEY: z.string().optional(),
    NOWPAYMENTS_IPN_SECRET: z.string().optional(),

    // Seed
    SEED_SUPER_ADMIN_EMAIL: z.string().email().default('superadmin@copytrade.app'),
    SEED_SUPER_ADMIN_PASSWORD: z.string().optional(),
    SEED_TENANT_ADMIN_EMAIL: z.string().email().default('admin@acme-capital.test'),
    SEED_TENANT_ADMIN_PASSWORD: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const symmetric = env.JWT_ALGORITHM.startsWith('HS');
    if (symmetric) {
      if (!env.JWT_ACCESS_SECRET || env.JWT_ACCESS_SECRET.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_ACCESS_SECRET'],
          message: 'JWT_ACCESS_SECRET must be at least 32 characters when using an HS algorithm',
        });
      }
      if (!env.JWT_REFRESH_SECRET || env.JWT_REFRESH_SECRET.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_REFRESH_SECRET'],
          message: 'JWT_REFRESH_SECRET must be at least 32 characters when using an HS algorithm',
        });
      }
      if (
        env.JWT_ACCESS_SECRET &&
        env.JWT_REFRESH_SECRET &&
        env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_REFRESH_SECRET'],
          message: 'JWT_REFRESH_SECRET must differ from JWT_ACCESS_SECRET',
        });
      }
    } else {
      if (!env.JWT_PRIVATE_KEY_BASE64) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_PRIVATE_KEY_BASE64'],
          message: 'JWT_PRIVATE_KEY_BASE64 is required for RS algorithms',
        });
      }
      if (!env.JWT_PUBLIC_KEY_BASE64) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_PUBLIC_KEY_BASE64'],
          message: 'JWT_PUBLIC_KEY_BASE64 is required for RS algorithms',
        });
      }
    }

    const masterKey = Buffer.from(env.ENCRYPTION_MASTER_KEY_BASE64, 'base64');
    if (masterKey.length !== 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ENCRYPTION_MASTER_KEY_BASE64'],
        message: 'ENCRYPTION_MASTER_KEY_BASE64 must decode to exactly 32 bytes (AES-256)',
      });
    }

    const blindIndexKey = Buffer.from(env.BLIND_INDEX_KEY_BASE64, 'base64');
    if (blindIndexKey.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BLIND_INDEX_KEY_BASE64'],
        message: 'BLIND_INDEX_KEY_BASE64 must decode to at least 32 bytes',
      });
    }

    if (env.NODE_ENV === 'production') {
      if (env.SWAGGER_ENABLED && !env.SWAGGER_PASSWORD) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SWAGGER_PASSWORD'],
          message: 'Swagger must be protected with basic auth in production',
        });
      }
    }

    // -----------------------------------------------------------------------
    // Part 5: execution mode coherence
    // -----------------------------------------------------------------------
    // These combinations are contradictory. The platform refuses to boot
    // rather than pick one, because every possible automatic resolution is
    // either surprising or dangerous, and "surprising" on a money path is
    // just "dangerous" with a delay.

    if (env.LIVE_TRADING_ENABLED && env.DRY_RUN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DRY_RUN'],
        message:
          'LIVE_TRADING_ENABLED=true conflicts with DRY_RUN=true. ' +
          'Dry run never transmits, so live trading could not work; and silently ' +
          'preferring either one would mean guessing whether you wanted real ' +
          'orders. Set exactly one of them.',
      });
    }

    if (env.LIVE_TRADING_ENABLED && env.PAPER_TRADING) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PAPER_TRADING'],
        message:
          'LIVE_TRADING_ENABLED=true conflicts with PAPER_TRADING=true. ' +
          'Set PAPER_TRADING=false to trade live, or LIVE_TRADING_ENABLED=false ' +
          'to keep simulating.',
      });
    }

    if (env.LIVE_TRADING_ENABLED && !env.EXECUTION_ENABLED) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EXECUTION_ENABLED'],
        message:
          'LIVE_TRADING_ENABLED=true requires EXECUTION_ENABLED=true. ' +
          'The execution pipeline is the thing that enforces the risk engine ' +
          'and the kill switches; arming live trading without it is not a ' +
          'configuration this platform will run.',
      });
    }

    if (env.LIVE_TRADING_ENABLED && env.EXCHANGE_SANDBOX_MODE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EXCHANGE_SANDBOX_MODE'],
        message:
          'LIVE_TRADING_ENABLED=true conflicts with EXCHANGE_SANDBOX_MODE=true. ' +
          'Sandbox mode points the adapters at testnet endpoints.',
      });
    }

    // A credential pair is all-or-nothing. A key without its secret produces a
    // signature failure on the first live request, which is a confusing way to
    // discover a typo in a .env file.
    if (Boolean(env.BINANCE_API_KEY) !== Boolean(env.BINANCE_API_SECRET)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [env.BINANCE_API_KEY ? 'BINANCE_API_SECRET' : 'BINANCE_API_KEY'],
        message:
          'BINANCE_API_KEY and BINANCE_API_SECRET must be provided together, or ' +
          'both omitted.',
      });
    }

    if (env.LIVE_TRADING_ENABLED && env.ORDER_REQUEST_TIMEOUT_MS < 1000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ORDER_REQUEST_TIMEOUT_MS'],
        message:
          'ORDER_REQUEST_TIMEOUT_MS below 1000ms will manufacture unknown order ' +
          'results under normal network jitter. Each one blocks the order until ' +
          'reconciliation resolves it.',
      });
    }

    // The idempotency key must outlive the reconciliation of the order it
    // guards. If it expires first, a retry of the same intent is no longer
    // recognised as a duplicate and becomes a second real position.
    const idempotencyTtlMs = env.EXECUTION_IDEMPOTENCY_TTL_SECONDS * 1000;
    if (idempotencyTtlMs <= env.ORDER_RECONCILIATION_INTERVAL_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EXECUTION_IDEMPOTENCY_TTL_SECONDS'],
        message:
          'EXECUTION_IDEMPOTENCY_TTL_SECONDS must exceed ' +
          'ORDER_RECONCILIATION_INTERVAL_MS. An idempotency key that expires ' +
          'before its order is reconciled stops preventing duplicates.',
      });
    }

    // --- Part 6 -------------------------------------------------------

    // A strategy engine with nowhere to send a signal is a misconfiguration,
    // not a safe default: it burns CPU on every market-data event and silently
    // discards every decision.
    if (
      env.STRATEGY_ENGINE_ENABLED &&
      !env.PAPER_TRADING_ENABLED &&
      !env.BACKTEST_ENABLED &&
      !env.EXECUTION_ENABLED
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STRATEGY_ENGINE_ENABLED'],
        message:
          'STRATEGY_ENGINE_ENABLED=true requires at least one consumer: ' +
          'PAPER_TRADING_ENABLED, BACKTEST_ENABLED or EXECUTION_ENABLED. ' +
          'Enabling the engine alone processes every event and discards every ' +
          'signal.',
      });
    }

    // The dedup window must outlive the signals it deduplicates. If it expires
    // first, a strategy repeating itself produces a second order while the
    // first is still considered current.
    if (env.SIGNAL_DEDUP_TTL_SECONDS * 1000 < env.SIGNAL_MAX_AGE_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SIGNAL_DEDUP_TTL_SECONDS'],
        message:
          'SIGNAL_DEDUP_TTL_SECONDS must cover at least SIGNAL_MAX_AGE_MS. A ' +
          'dedup entry that expires while the signal it guards is still valid ' +
          'stops preventing duplicate signals.',
      });
    }

    // A processing budget larger than the signal validity window would make
    // every signal stale by construction.
    if (env.STRATEGY_MAX_PROCESSING_LATENCY_MS >= env.SIGNAL_MAX_AGE_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STRATEGY_MAX_PROCESSING_LATENCY_MS'],
        message:
          'STRATEGY_MAX_PROCESSING_LATENCY_MS must be well below ' +
          'SIGNAL_MAX_AGE_MS, otherwise a dispatch that merely hits its budget ' +
          'produces a signal the validator will refuse as stale.',
      });
    }

    if (env.STRATEGY_EVENT_QUEUE_SIZE < 100 || env.STRATEGY_EVENT_QUEUE_SIZE > 1000000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STRATEGY_EVENT_QUEUE_SIZE'],
        message:
          'STRATEGY_EVENT_QUEUE_SIZE must be between 100 and 1000000. Too small ' +
          'sheds load on every burst; too large defers backpressure until the ' +
          'process runs out of memory.',
      });
    }

    if (env.STRATEGY_MAX_INSTANCES < 1 || env.STRATEGY_MAX_INSTANCES > 1000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STRATEGY_MAX_INSTANCES'],
        message: 'STRATEGY_MAX_INSTANCES must be between 1 and 1000.',
      });
    }

    if (Number.parseFloat(env.BACKTEST_DEFAULT_INITIAL_CAPITAL) <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BACKTEST_DEFAULT_INITIAL_CAPITAL'],
        message: 'BACKTEST_DEFAULT_INITIAL_CAPITAL must be greater than zero.',
      });
    }

    // Zero fees and zero slippage are permitted, because an operator may want
    // to isolate the effect of costs. They are also the single most flattering
    // pair of assumptions available, so the combination is called out.
    if (
      env.BACKTEST_ENABLED &&
      Number.parseFloat(env.BACKTEST_DEFAULT_TAKER_FEE) === 0 &&
      Number.parseFloat(env.BACKTEST_DEFAULT_SLIPPAGE_BPS) === 0 &&
      env.NODE_ENV === 'production'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BACKTEST_DEFAULT_TAKER_FEE'],
        message:
          'Refusing zero taker fee together with zero slippage in production. ' +
          'That combination produces backtest results no real account could ' +
          'achieve. Set realistic venue costs, or run this configuration ' +
          'outside production.',
      });
    }

    if (env.ORDER_UNKNOWN_RECONCILIATION_DELAY_MS >= env.ORDER_RECONCILIATION_INTERVAL_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ORDER_UNKNOWN_RECONCILIATION_DELAY_MS'],
        message:
          'ORDER_UNKNOWN_RECONCILIATION_DELAY_MS must be shorter than ' +
          'ORDER_RECONCILIATION_INTERVAL_MS, otherwise an unknown order waits a ' +
          'full extra sweep before anyone asks the venue about it.',
      });
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

export interface EnvValidationFailure {
  path: string;
  message: string;
}

export class EnvValidationError extends Error {
  public readonly failures: EnvValidationFailure[];

  constructor(failures: EnvValidationFailure[]) {
    super(
      `Invalid environment configuration:\n${failures
        .map((failure) => `  - ${failure.path}: ${failure.message}`)
        .join('\n')}`,
    );
    this.name = 'EnvValidationError';
    this.failures = failures;
  }
}

/**
 * Parses and validates `process.env`. Throws {@link EnvValidationError} listing
 * every problem at once so operators can fix configuration in a single pass.
 */
export function validateEnv(source: Record<string, unknown> = process.env): AppEnv {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const failures = result.error.issues.map((issue) => ({
      path: issue.path.join('.') || '(root)',
      message: issue.message,
    }));
    throw new EnvValidationError(failures);
  }
  return result.data;
}
```

---

## FILE: apps/api/src/config/app-config.service.ts

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv, NodeEnvironment } from '@wlct/config';
import { parseDurationToMs, parseDurationToSeconds } from '@wlct/utils';

export interface RedisConnectionOptions {
  host: string;
  port: number;
  password?: string;
  db: number;
  tls?: Record<string, never>;
  keyPrefix: string;
  maxRetriesPerRequest: number | null;
  enableReadyCheck: boolean;
}

/**
 * Typed, memoised accessor over the validated environment.
 *
 * Every consumer depends on this class instead of `ConfigService.get(...)`,
 * which removes stringly-typed lookups and gives a single place to derive
 * computed values (durations in ms, Redis connection objects, CORS validators).
 */
@Injectable()
export class AppConfigService {
  private readonly env: AppEnv;

  constructor(private readonly configService: ConfigService) {
    // `validate()` in AppConfigModule has already coerced and checked every
    // variable, so reads go through ConfigService to pick up the parsed values
    // (numbers, booleans, arrays) rather than the raw strings in process.env.
    this.env = new Proxy({} as AppEnv, {
      get: (_target, property: string | symbol) =>
        typeof property === 'string' ? this.configService.get(property) : undefined,
    }) as AppEnv;
  }

  // ---------------------------------------------------------------------------
  // Application
  // ---------------------------------------------------------------------------

  get nodeEnv(): NodeEnvironment {
    return this.env.NODE_ENV;
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get isDevelopment(): boolean {
    return this.env.NODE_ENV === 'development';
  }

  get isTest(): boolean {
    return this.env.NODE_ENV === 'test';
  }

  get appName(): string {
    return this.env.APP_NAME;
  }

  get port(): number {
    return this.env.API_PORT;
  }

  get host(): string {
    return this.env.API_HOST;
  }

  get globalPrefix(): string {
    return this.env.API_GLOBAL_PREFIX;
  }

  get defaultApiVersion(): string {
    return this.env.API_DEFAULT_VERSION;
  }

  get publicUrl(): string {
    return this.env.API_PUBLIC_URL;
  }

  get adminWebUrl(): string {
    return this.env.ADMIN_WEB_URL;
  }

  get trustProxyHops(): number {
    return this.env.TRUST_PROXY_HOPS;
  }

  get platformRootDomain(): string {
    return this.env.PLATFORM_ROOT_DOMAIN;
  }

  get defaultTenantSlug(): string {
    return this.env.DEFAULT_TENANT_SLUG;
  }

  // ---------------------------------------------------------------------------
  // Database
  // ---------------------------------------------------------------------------

  get databaseUrl(): string {
    return this.env.DATABASE_URL;
  }

  get databaseLogQueries(): boolean {
    return this.env.DATABASE_LOG_QUERIES;
  }

  // ---------------------------------------------------------------------------
  // Redis
  // ---------------------------------------------------------------------------

  get redisOptions(): RedisConnectionOptions {
    return {
      host: this.env.REDIS_HOST,
      port: this.env.REDIS_PORT,
      password: this.env.REDIS_PASSWORD || undefined,
      db: this.env.REDIS_DB,
      tls: this.env.REDIS_TLS ? {} : undefined,
      keyPrefix: this.env.REDIS_KEY_PREFIX,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    };
  }

  /**
   * BullMQ requires `maxRetriesPerRequest: null` and no key prefix collisions.
   *
   * The prefix is stripped by rebuilding the object rather than by destructuring
   * it away: an unused binding is dead weight the linter is right to flag, and
   * naming the retained fields makes it obvious that dropping `keyPrefix` is the
   * whole point of the method.
   */
  get queueRedisOptions(): Omit<RedisConnectionOptions, 'keyPrefix'> {
    const options = this.redisOptions;
    return {
      host: options.host,
      port: options.port,
      password: options.password,
      db: options.db,
      tls: options.tls,
      maxRetriesPerRequest: options.maxRetriesPerRequest,
      enableReadyCheck: options.enableReadyCheck,
    };
  }

  get redisKeyPrefix(): string {
    return this.env.REDIS_KEY_PREFIX;
  }

  // ---------------------------------------------------------------------------
  // JWT
  // ---------------------------------------------------------------------------

  get jwtAlgorithm(): AppEnv['JWT_ALGORITHM'] {
    return this.env.JWT_ALGORITHM;
  }

  get jwtUsesAsymmetricKeys(): boolean {
    return this.env.JWT_ALGORITHM.startsWith('RS');
  }

  get jwtAccessSigningKey(): string {
    if (this.jwtUsesAsymmetricKeys) {
      return Buffer.from(this.env.JWT_PRIVATE_KEY_BASE64 ?? '', 'base64').toString('utf8');
    }
    return this.env.JWT_ACCESS_SECRET ?? '';
  }

  get jwtAccessVerificationKey(): string {
    if (this.jwtUsesAsymmetricKeys) {
      return Buffer.from(this.env.JWT_PUBLIC_KEY_BASE64 ?? '', 'base64').toString('utf8');
    }
    return this.env.JWT_ACCESS_SECRET ?? '';
  }

  get jwtRefreshSigningKey(): string {
    if (this.jwtUsesAsymmetricKeys) {
      return Buffer.from(this.env.JWT_PRIVATE_KEY_BASE64 ?? '', 'base64').toString('utf8');
    }
    return this.env.JWT_REFRESH_SECRET ?? '';
  }

  get jwtRefreshVerificationKey(): string {
    if (this.jwtUsesAsymmetricKeys) {
      return Buffer.from(this.env.JWT_PUBLIC_KEY_BASE64 ?? '', 'base64').toString('utf8');
    }
    return this.env.JWT_REFRESH_SECRET ?? '';
  }

  get accessTokenTtl(): string {
    return this.env.JWT_ACCESS_TTL;
  }

  get accessTokenTtlSeconds(): number {
    return parseDurationToSeconds(this.env.JWT_ACCESS_TTL);
  }

  get refreshTokenTtl(): string {
    return this.env.JWT_REFRESH_TTL;
  }

  get refreshTokenTtlSeconds(): number {
    return parseDurationToSeconds(this.env.JWT_REFRESH_TTL);
  }

  get refreshTokenTtlMs(): number {
    return parseDurationToMs(this.env.JWT_REFRESH_TTL);
  }

  get jwtIssuer(): string {
    return this.env.JWT_ISSUER;
  }

  get jwtAudience(): string {
    return this.env.JWT_AUDIENCE;
  }

  get maxActiveSessionsPerUser(): number {
    return this.env.MAX_ACTIVE_SESSIONS_PER_USER;
  }

  // ---------------------------------------------------------------------------
  // Password & account protection
  // ---------------------------------------------------------------------------

  get passwordMinLength(): number {
    return this.env.PASSWORD_MIN_LENGTH;
  }

  get argon2Options(): { memoryCost: number; timeCost: number; parallelism: number } {
    return {
      memoryCost: this.env.ARGON2_MEMORY_COST,
      timeCost: this.env.ARGON2_TIME_COST,
      parallelism: this.env.ARGON2_PARALLELISM,
    };
  }

  get loginMaxFailedAttempts(): number {
    return this.env.LOGIN_MAX_FAILED_ATTEMPTS;
  }

  get loginFailedWindowSeconds(): number {
    return this.env.LOGIN_FAILED_WINDOW_SECONDS;
  }

  get accountLockoutSeconds(): number {
    return this.env.ACCOUNT_LOCKOUT_SECONDS;
  }

  // ---------------------------------------------------------------------------
  // Encryption
  // ---------------------------------------------------------------------------

  get encryptionMasterKeyBase64(): string {
    return this.env.ENCRYPTION_MASTER_KEY_BASE64;
  }

  get encryptionKeyId(): string {
    return this.env.ENCRYPTION_KEY_ID;
  }

  get encryptionPreviousKeys(): Record<string, string> {
    return this.env.ENCRYPTION_PREVIOUS_KEYS_JSON ?? {};
  }

  get encryptionProvider(): 'local' | 'kms' {
    return this.env.ENCRYPTION_PROVIDER;
  }

  get blindIndexKeyBase64(): string {
    return this.env.BLIND_INDEX_KEY_BASE64;
  }

  // ---------------------------------------------------------------------------
  // Two factor
  // ---------------------------------------------------------------------------

  get twoFactorIssuer(): string {
    return this.env.TWO_FACTOR_ISSUER;
  }

  get twoFactorWindow(): number {
    return this.env.TWO_FACTOR_WINDOW;
  }

  get twoFactorDigits(): number {
    return this.env.TWO_FACTOR_DIGITS;
  }

  get twoFactorPeriod(): number {
    return this.env.TWO_FACTOR_PERIOD;
  }

  get twoFactorRecoveryCodeCount(): number {
    return this.env.TWO_FACTOR_RECOVERY_CODES;
  }

  get twoFactorChallengeTtl(): string {
    return this.env.TWO_FACTOR_CHALLENGE_TTL;
  }

  get twoFactorChallengeTtlSeconds(): number {
    return parseDurationToSeconds(this.env.TWO_FACTOR_CHALLENGE_TTL);
  }

  get twoFactorMaxChallengeAttempts(): number {
    return this.env.TWO_FACTOR_MAX_CHALLENGE_ATTEMPTS;
  }

  // ---------------------------------------------------------------------------
  // CORS
  // ---------------------------------------------------------------------------

  get corsEnabled(): boolean {
    return this.env.CORS_ENABLED;
  }

  get corsOrigins(): string[] {
    return this.env.CORS_ORIGINS;
  }

  get corsCredentials(): boolean {
    return this.env.CORS_CREDENTIALS;
  }

  get corsAllowedHeaders(): string[] {
    return this.env.CORS_ALLOWED_HEADERS;
  }

  get corsExposedHeaders(): string[] {
    return this.env.CORS_EXPOSED_HEADERS;
  }

  /**
   * Allows configured origins plus any tenant custom domain that resolves under
   * the platform root domain. Unknown origins are rejected rather than echoed.
   */
  get corsOriginValidator(): (
    origin: string | undefined,
    callback: (error: Error | null, allow?: boolean) => void,
  ) => void {
    const allowList = new Set(this.corsOrigins);
    const rootDomain = this.platformRootDomain;
    const allowAnyInDev = !this.isProduction;

    return (origin, callback) => {
      if (!origin) {
        // Same-origin, curl, and mobile apps send no Origin header.
        callback(null, true);
        return;
      }
      if (allowList.has(origin)) {
        callback(null, true);
        return;
      }
      try {
        const { hostname, protocol } = new URL(origin);
        if (protocol === 'https:' && (hostname === rootDomain || hostname.endsWith(`.${rootDomain}`))) {
          callback(null, true);
          return;
        }
        if (allowAnyInDev && (hostname === 'localhost' || hostname === '127.0.0.1')) {
          callback(null, true);
          return;
        }
      } catch {
        callback(null, false);
        return;
      }
      callback(null, false);
    };
  }

  // ---------------------------------------------------------------------------
  // Rate limiting
  // ---------------------------------------------------------------------------

  get rateLimitEnabled(): boolean {
    return this.env.RATE_LIMIT_ENABLED;
  }

  get rateLimitTtlSeconds(): number {
    return this.env.RATE_LIMIT_TTL_SECONDS;
  }

  get rateLimitMax(): number {
    return this.env.RATE_LIMIT_MAX;
  }

  get rateLimitAuthTtlSeconds(): number {
    return this.env.RATE_LIMIT_AUTH_TTL_SECONDS;
  }

  get rateLimitAuthMax(): number {
    return this.env.RATE_LIMIT_AUTH_MAX;
  }

  get rateLimitTrustedIps(): string[] {
    return this.env.RATE_LIMIT_TRUSTED_IPS;
  }

  // ---------------------------------------------------------------------------
  // Swagger
  // ---------------------------------------------------------------------------

  get swaggerEnabled(): boolean {
    return this.env.SWAGGER_ENABLED;
  }

  get swaggerPath(): string {
    return this.env.SWAGGER_PATH;
  }

  get swaggerTitle(): string {
    return this.env.SWAGGER_TITLE;
  }

  get swaggerDescription(): string {
    return this.env.SWAGGER_DESCRIPTION;
  }

  get swaggerVersion(): string {
    return this.env.SWAGGER_VERSION;
  }

  get swaggerCredentials(): { user?: string; password?: string } {
    return { user: this.env.SWAGGER_USER, password: this.env.SWAGGER_PASSWORD };
  }

  // ---------------------------------------------------------------------------
  // Logging
  // ---------------------------------------------------------------------------

  get logLevel(): AppEnv['LOG_LEVEL'] {
    return this.env.LOG_LEVEL;
  }

  get logFormat(): 'json' | 'pretty' {
    return this.env.LOG_FORMAT;
  }

  get logRequestBody(): boolean {
    return this.env.LOG_REQUEST_BODY;
  }

  // ---------------------------------------------------------------------------
  // WebSocket
  // ---------------------------------------------------------------------------

  get wsEnabled(): boolean {
    return this.env.WS_ENABLED;
  }

  get wsPath(): string {
    return this.env.WS_PATH;
  }

  get wsNamespace(): string {
    return this.env.WS_NAMESPACE;
  }

  get wsPingIntervalMs(): number {
    return this.env.WS_PING_INTERVAL_MS;
  }

  get wsPingTimeoutMs(): number {
    return this.env.WS_PING_TIMEOUT_MS;
  }

  get wsMaxConnectionsPerUser(): number {
    return this.env.WS_MAX_CONNECTIONS_PER_USER;
  }

  get wsRedisAdapterEnabled(): boolean {
    return this.env.WS_REDIS_ADAPTER;
  }

  // ---------------------------------------------------------------------------
  // Queues
  // ---------------------------------------------------------------------------

  get queuePrefix(): string {
    return this.env.QUEUE_PREFIX;
  }

  get queueDefaultAttempts(): number {
    return this.env.QUEUE_DEFAULT_ATTEMPTS;
  }

  get queueBackoffMs(): number {
    return this.env.QUEUE_BACKOFF_MS;
  }

  get queueRemoveOnComplete(): number {
    return this.env.QUEUE_REMOVE_ON_COMPLETE;
  }

  get queueRemoveOnFail(): number {
    return this.env.QUEUE_REMOVE_ON_FAIL;
  }

  get queueConcurrency(): number {
    return this.env.QUEUE_CONCURRENCY;
  }

  get queueRunInlineWorkers(): boolean {
    return this.env.QUEUE_RUN_INLINE_WORKERS;
  }

  // ---------------------------------------------------------------------------
  // Exchanges and internal services
  // ---------------------------------------------------------------------------

  get enabledExchanges(): string[] {
    return this.env.EXCHANGES_ENABLED;
  }

  get exchangeSandboxMode(): boolean {
    return this.env.EXCHANGE_SANDBOX_MODE;
  }

  get executionEnabled(): boolean {
    return this.env.EXECUTION_ENABLED;
  }

  // ---------------------------------------------------------------------------
  // Authenticated execution (Part 5)
  // ---------------------------------------------------------------------------
  // Note what is absent: there is no getter returning BINANCE_API_SECRET, or
  // any other raw credential. The API process never needs one. Credentials are
  // resolved inside the trading service's credential provider, and the only
  // thing this class exposes about them is whether a platform-level pair was
  // configured at all.

  get liveTradingEnabled(): boolean {
    return this.env.LIVE_TRADING_ENABLED;
  }

  get dryRun(): boolean {
    return this.env.DRY_RUN;
  }

  get paperTrading(): boolean {
    return this.env.PAPER_TRADING;
  }

  /**
   * The effective trading mode after all switches are combined.
   *
   * Resolution is deliberately pessimistic and the order of the checks is the
   * whole point: DRY_RUN wins over everything, then PAPER, and LIVE is only
   * reached when every switch explicitly permits it. There is no path through
   * this function where an unset variable produces LIVE.
   */
  get tradingMode(): 'DISABLED' | 'DRY_RUN' | 'PAPER' | 'LIVE' {
    if (!this.env.EXECUTION_ENABLED) {
      return 'DISABLED';
    }
    if (this.env.DRY_RUN) {
      return 'DRY_RUN';
    }
    if (this.env.PAPER_TRADING) {
      return 'PAPER';
    }
    if (this.env.LIVE_TRADING_ENABLED) {
      return 'LIVE';
    }
    return 'DISABLED';
  }

  /** True when a platform-level venue credential pair is configured. */
  get hasPlatformExchangeCredentials(): boolean {
    return Boolean(this.env.BINANCE_API_KEY) && Boolean(this.env.BINANCE_API_SECRET);
  }

  get orderRequestTimeoutMs(): number {
    return this.env.ORDER_REQUEST_TIMEOUT_MS;
  }

  get orderReconciliationIntervalMs(): number {
    return this.env.ORDER_RECONCILIATION_INTERVAL_MS;
  }

  get privateStreamReconnectEnabled(): boolean {
    return this.env.PRIVATE_STREAM_RECONNECT_ENABLED;
  }

  get exchangeTimeSyncIntervalMs(): number {
    return this.env.EXCHANGE_TIME_SYNC_INTERVAL_MS;
  }

  get executionIdempotencyTtlSeconds(): number {
    return this.env.EXECUTION_IDEMPOTENCY_TTL_SECONDS;
  }

  get orderUnknownReconciliationDelayMs(): number {
    return this.env.ORDER_UNKNOWN_RECONCILIATION_DELAY_MS;
  }

  /**
   * Everything the admin UI is allowed to know about execution configuration.
   * Booleans and durations only - assembled explicitly rather than by spreading
   * the env object, so a credential can never be added to the response by
   * accident later.
   */
  get executionSafetySummary(): {
    executionEnabled: boolean;
    tradingMode: 'DISABLED' | 'DRY_RUN' | 'PAPER' | 'LIVE';
    liveTradingEnabled: boolean;
    dryRun: boolean;
    paperTrading: boolean;
    sandboxMode: boolean;
    platformCredentialsConfigured: boolean;
    orderRequestTimeoutMs: number;
    orderReconciliationIntervalMs: number;
    orderUnknownReconciliationDelayMs: number;
    exchangeTimeSyncIntervalMs: number;
    executionIdempotencyTtlSeconds: number;
    privateStreamReconnectEnabled: boolean;
  } {
    return {
      executionEnabled: this.executionEnabled,
      tradingMode: this.tradingMode,
      liveTradingEnabled: this.liveTradingEnabled,
      dryRun: this.dryRun,
      paperTrading: this.paperTrading,
      sandboxMode: this.exchangeSandboxMode,
      platformCredentialsConfigured: this.hasPlatformExchangeCredentials,
      orderRequestTimeoutMs: this.orderRequestTimeoutMs,
      orderReconciliationIntervalMs: this.orderReconciliationIntervalMs,
      orderUnknownReconciliationDelayMs: this.orderUnknownReconciliationDelayMs,
      exchangeTimeSyncIntervalMs: this.exchangeTimeSyncIntervalMs,
      executionIdempotencyTtlSeconds: this.executionIdempotencyTtlSeconds,
      privateStreamReconnectEnabled: this.privateStreamReconnectEnabled,
    };
  }

  // ---------------------------------------------------------------------------
  // Strategy engine, paper trading and backtesting (Part 6)
  // ---------------------------------------------------------------------------
  // None of these getters can enable live trading. `strategyEngineEnabled`
  // says whether strategies run; where their signals may go is still decided
  // by `tradingMode` above, which is unchanged by anything in this section.

  get strategyEngineEnabled(): boolean {
    return this.env.STRATEGY_ENGINE_ENABLED;
  }

  get paperTradingEnabled(): boolean {
    return this.env.PAPER_TRADING_ENABLED;
  }

  get backtestEnabled(): boolean {
    return this.env.BACKTEST_ENABLED;
  }

  get strategyEventQueueSize(): number {
    return this.env.STRATEGY_EVENT_QUEUE_SIZE;
  }

  get strategyMaxInstances(): number {
    return this.env.STRATEGY_MAX_INSTANCES;
  }

  /**
   * Observation budget for one strategy dispatch, in milliseconds.
   *
   * Exceeding it increments a counter and marks the dispatch slow. It is not
   * a guarantee, and this platform makes no latency guarantee of any kind.
   */
  get strategyMaxProcessingLatencyMs(): number {
    return this.env.STRATEGY_MAX_PROCESSING_LATENCY_MS;
  }

  get signalMaxAgeMs(): number {
    return this.env.SIGNAL_MAX_AGE_MS;
  }

  get signalDedupTtlSeconds(): number {
    return this.env.SIGNAL_DEDUP_TTL_SECONDS;
  }

  /**
   * Default backtest execution assumptions.
   *
   * Returned as strings, not numbers: they are exact decimals that end up in
   * Decimal arithmetic and in the configuration hash of every run, and a
   * binary float would corrupt both.
   */
  get backtestDefaults(): {
    initialCapital: string;
    makerFee: string;
    takerFee: string;
    slippageBps: string;
  } {
    return {
      initialCapital: this.env.BACKTEST_DEFAULT_INITIAL_CAPITAL,
      makerFee: this.env.BACKTEST_DEFAULT_MAKER_FEE,
      takerFee: this.env.BACKTEST_DEFAULT_TAKER_FEE,
      slippageBps: this.env.BACKTEST_DEFAULT_SLIPPAGE_BPS,
    };
  }

  /**
   * Everything the admin UI may know about the strategy layer.
   *
   * Assembled field by field for the same reason as
   * {@link executionSafetySummary}: nothing is spread in, so a credential can
   * never arrive here by accident. `liveExecutionReachable` is stated
   * explicitly so an operator can see at a glance that enabling strategies did
   * not enable live orders.
   */
  get strategySafetySummary(): {
    strategyEngineEnabled: boolean;
    paperTradingEnabled: boolean;
    backtestEnabled: boolean;
    liveExecutionReachable: boolean;
    tradingMode: 'DISABLED' | 'DRY_RUN' | 'PAPER' | 'LIVE';
    maxInstances: number;
    eventQueueSize: number;
    maxProcessingLatencyMs: number;
    signalMaxAgeMs: number;
    signalDedupTtlSeconds: number;
    backtestDefaults: {
      initialCapital: string;
      makerFee: string;
      takerFee: string;
      slippageBps: string;
    };
    disclaimer: string;
  } {
    return {
      strategyEngineEnabled: this.strategyEngineEnabled,
      paperTradingEnabled: this.paperTradingEnabled,
      backtestEnabled: this.backtestEnabled,
      liveExecutionReachable: this.tradingMode === 'LIVE',
      tradingMode: this.tradingMode,
      maxInstances: this.strategyMaxInstances,
      eventQueueSize: this.strategyEventQueueSize,
      maxProcessingLatencyMs: this.strategyMaxProcessingLatencyMs,
      signalMaxAgeMs: this.signalMaxAgeMs,
      signalDedupTtlSeconds: this.signalDedupTtlSeconds,
      backtestDefaults: this.backtestDefaults,
      disclaimer:
        'Backtest and paper results are simulated. Backtest performance is ' +
        'not indicative of future performance; paper performance is not ' +
        'indicative of live performance.',
    };
  }

  get tradingEngineUrl(): string {
    return this.env.TRADING_ENGINE_URL;
  }

  get tradingEngineHealthUrl(): string {
    return `${this.env.TRADING_ENGINE_URL}${this.env.TRADING_ENGINE_HEALTH_PATH}`;
  }

  get marketDataUrl(): string {
    return this.env.MARKET_DATA_URL;
  }

  get marketDataHealthUrl(): string {
    return `${this.env.MARKET_DATA_URL}${this.env.MARKET_DATA_HEALTH_PATH}`;
  }

  get notificationServiceUrl(): string {
    return this.env.NOTIFICATION_SERVICE_URL;
  }

  get notificationServiceHealthUrl(): string {
    return `${this.env.NOTIFICATION_SERVICE_URL}${this.env.NOTIFICATION_SERVICE_HEALTH_PATH}`;
  }

  get internalServiceToken(): string {
    return this.env.INTERNAL_SERVICE_TOKEN;
  }

  // ---------------------------------------------------------------------------
  // Mail / notifications
  // ---------------------------------------------------------------------------

  get mailDriver(): AppEnv['MAIL_DRIVER'] {
    return this.env.MAIL_DRIVER;
  }

  get mailFrom(): { name: string; address: string } {
    return { name: this.env.MAIL_FROM_NAME, address: this.env.MAIL_FROM_ADDRESS };
  }

  get notificationsEnabled(): boolean {
    return this.env.NOTIFICATIONS_ENABLED;
  }

  // ---------------------------------------------------------------------------
  // Localisation
  // ---------------------------------------------------------------------------

  get defaultLocale(): string {
    return this.env.DEFAULT_LOCALE;
  }

  get supportedLocales(): string[] {
    return this.env.SUPPORTED_LOCALES;
  }

  get defaultCurrency(): string {
    return this.env.DEFAULT_CURRENCY;
  }

  get supportedCurrencies(): string[] {
    return this.env.SUPPORTED_CURRENCIES;
  }

  // ---------------------------------------------------------------------------
  // Compliance / billing providers
  // ---------------------------------------------------------------------------

  get kycProvider(): AppEnv['KYC_PROVIDER'] {
    return this.env.KYC_PROVIDER;
  }

  get billingProvider(): AppEnv['BILLING_PROVIDER'] {
    return this.env.BILLING_PROVIDER;
  }

  // ---------------------------------------------------------------------------
  // Seed
  // ---------------------------------------------------------------------------

  get seedSuperAdminEmail(): string {
    return this.env.SEED_SUPER_ADMIN_EMAIL;
  }
}
```

---

## FILE: .env.example

```example
# =============================================================================
# WHITE-LABEL CRYPTO COPY-TRADING PLATFORM - ENVIRONMENT CONFIGURATION
# =============================================================================
# Copy to .env and fill in real values. NEVER commit .env.
# Generate cryptographic material with: npm run keys:generate
# =============================================================================

# -----------------------------------------------------------------------------
# APPLICATION
# -----------------------------------------------------------------------------
NODE_ENV=development
APP_NAME=WhiteLabelCopyTrade
API_PORT=4000
API_HOST=0.0.0.0
API_GLOBAL_PREFIX=api
API_DEFAULT_VERSION=1
# Public base URL of the API (used in emails, webhooks, OpenAPI servers)
API_PUBLIC_URL=http://localhost:4000
# Public base URL of the admin web application
ADMIN_WEB_URL=http://localhost:3000
# Host port the admin console is published on by Docker Compose.
ADMIN_WEB_PORT=3000
# Trust N reverse proxy hops (nginx/ALB). 0 disables proxy trust.
TRUST_PROXY_HOPS=1
# Root domain used to resolve tenants from sub-domains: acme.copytrade.app
PLATFORM_ROOT_DOMAIN=copytrade.app
# Fallback tenant slug used when a request carries no resolvable tenant context
DEFAULT_TENANT_SLUG=platform

# -----------------------------------------------------------------------------
# DATABASE (PostgreSQL)
# -----------------------------------------------------------------------------
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=copytrade
POSTGRES_PASSWORD=change_me_postgres_password
POSTGRES_DB=copytrade
POSTGRES_SCHEMA=public
# Password for the least-privilege runtime role created by
# infrastructure/database/init/02-roles.sql. Leave blank to skip role creation.
POSTGRES_APP_PASSWORD=
# Prisma connection string. Inside docker-compose use host "postgres".
DATABASE_URL=postgresql://copytrade:change_me_postgres_password@localhost:5432/copytrade?schema=public&connection_limit=20&pool_timeout=20
# REQUIRED, not optional. schema.prisma declares `directUrl`, and Prisma refuses
# to run ANY migrate/generate command when the variable is missing (error P1012)
# even though the application itself never reads it. Point it at the database
# directly, bypassing any connection pooler (PgBouncer, RDS Proxy) and without
# the pooling query parameters, so DDL runs on a real session. With no pooler in
# front of PostgreSQL it is simply DATABASE_URL minus connection_limit/pool_timeout.
DIRECT_DATABASE_URL=postgresql://copytrade:change_me_postgres_password@localhost:5432/copytrade?schema=public
DATABASE_LOG_QUERIES=false
DATABASE_SSL=false

# -----------------------------------------------------------------------------
# REDIS (cache, rate limiting, queues, websocket adapter)
# -----------------------------------------------------------------------------
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_TLS=false
REDIS_KEY_PREFIX=wlct:
REDIS_URL=redis://localhost:6379/0

# -----------------------------------------------------------------------------
# JWT / AUTHENTICATION
# -----------------------------------------------------------------------------
# Asymmetric signing is recommended in production (RS256). For HS256 provide secrets.
JWT_ALGORITHM=HS256
JWT_ACCESS_SECRET=change_me_access_secret_min_32_chars_long
JWT_REFRESH_SECRET=change_me_refresh_secret_min_32_chars_long
# Base64-encoded PEM keys, required when JWT_ALGORITHM=RS256
JWT_PRIVATE_KEY_BASE64=
JWT_PUBLIC_KEY_BASE64=
JWT_ACCESS_TTL=900s
JWT_REFRESH_TTL=30d
JWT_ISSUER=https://api.copytrade.app
JWT_AUDIENCE=copytrade-clients
# Maximum concurrent active sessions (devices) per user
MAX_ACTIVE_SESSIONS_PER_USER=10

# Password policy / hashing (argon2id)
PASSWORD_MIN_LENGTH=12
ARGON2_MEMORY_COST=19456
ARGON2_TIME_COST=2
ARGON2_PARALLELISM=1

# Account protection
LOGIN_MAX_FAILED_ATTEMPTS=5
LOGIN_FAILED_WINDOW_SECONDS=900
ACCOUNT_LOCKOUT_SECONDS=900

# -----------------------------------------------------------------------------
# ENCRYPTION (exchange API credential envelope encryption)
# -----------------------------------------------------------------------------
# 32-byte key, base64 encoded. Key Encryption Key used to wrap per-record DEKs.
ENCRYPTION_MASTER_KEY_BASE64=
# Identifier of the active master key; enables zero-downtime key rotation.
ENCRYPTION_KEY_ID=local-dev-v1
# Previous keys kept for decrypt-only, JSON map: {"local-dev-v0":"<base64key>"}
ENCRYPTION_PREVIOUS_KEYS_JSON={}
# kms | local  -> "kms" delegates KEK operations to a managed KMS provider
ENCRYPTION_PROVIDER=local
KMS_PROVIDER=
KMS_KEY_ARN=
# Deterministic HMAC key used to build blind indexes (lookup on encrypted values)
BLIND_INDEX_KEY_BASE64=

# -----------------------------------------------------------------------------
# TWO-FACTOR AUTHENTICATION (TOTP)
# -----------------------------------------------------------------------------
TWO_FACTOR_ISSUER=CopyTrade
TWO_FACTOR_WINDOW=1
TWO_FACTOR_DIGITS=6
TWO_FACTOR_PERIOD=30
TWO_FACTOR_RECOVERY_CODES=10
# Short-lived token issued between password step and 2FA step
TWO_FACTOR_CHALLENGE_TTL=300s
# Wrong codes tolerated per challenge token before it is discarded.
TWO_FACTOR_MAX_CHALLENGE_ATTEMPTS=5

# -----------------------------------------------------------------------------
# CORS
# -----------------------------------------------------------------------------
CORS_ENABLED=true
CORS_ORIGINS=http://localhost:3000,http://localhost:4000
CORS_CREDENTIALS=true
CORS_ALLOWED_HEADERS=Content-Type,Authorization,X-Tenant-Slug,X-Request-Id,X-Api-Version,Accept-Language,X-2FA-Token
CORS_EXPOSED_HEADERS=X-Request-Id,X-RateLimit-Limit,X-RateLimit-Remaining,X-RateLimit-Reset

# -----------------------------------------------------------------------------
# RATE LIMITING
# -----------------------------------------------------------------------------
RATE_LIMIT_ENABLED=true
RATE_LIMIT_TTL_SECONDS=60
RATE_LIMIT_MAX=120
RATE_LIMIT_AUTH_TTL_SECONDS=300
RATE_LIMIT_AUTH_MAX=10
RATE_LIMIT_TRUSTED_IPS=127.0.0.1,::1

# -----------------------------------------------------------------------------
# SWAGGER / OPENAPI
# -----------------------------------------------------------------------------
SWAGGER_ENABLED=true
SWAGGER_PATH=docs
SWAGGER_TITLE="White-Label Copy Trading API"
SWAGGER_DESCRIPTION="Multi-tenant non-custodial crypto copy-trading platform API"
SWAGGER_VERSION=1.0.0
# Optional basic-auth protection for the docs route in non-local environments
SWAGGER_USER=
SWAGGER_PASSWORD=

# -----------------------------------------------------------------------------
# LOGGING
# -----------------------------------------------------------------------------
LOG_LEVEL=debug
# json | pretty
LOG_FORMAT=pretty
LOG_REQUEST_BODY=false
LOG_SAMPLE_RATE=1
SENTRY_DSN=

# -----------------------------------------------------------------------------
# WEBSOCKET
# -----------------------------------------------------------------------------
WS_ENABLED=true
WS_PATH=/realtime
WS_NAMESPACE=/v1
WS_PING_INTERVAL_MS=25000
WS_PING_TIMEOUT_MS=20000
WS_MAX_CONNECTIONS_PER_USER=5
# Redis adapter lets many API replicas share socket rooms
WS_REDIS_ADAPTER=true

# -----------------------------------------------------------------------------
# BULLMQ / BACKGROUND JOBS
# -----------------------------------------------------------------------------
QUEUE_PREFIX=wlct-queue
QUEUE_DEFAULT_ATTEMPTS=5
QUEUE_BACKOFF_MS=5000
QUEUE_REMOVE_ON_COMPLETE=1000
QUEUE_REMOVE_ON_FAIL=5000
QUEUE_CONCURRENCY=10
# Enable the in-process worker (single-container dev). Disable when running the dedicated worker.
QUEUE_RUN_INLINE_WORKERS=true
BULL_BOARD_ENABLED=false
BULL_BOARD_PATH=admin/queues

# -----------------------------------------------------------------------------
# EXCHANGE INTEGRATIONS (non-custodial: user-supplied trade-only API keys)
# -----------------------------------------------------------------------------
# Comma separated list of exchanges enabled platform-wide
EXCHANGES_ENABLED=binance,bybit,okx,kraken
EXCHANGE_SANDBOX_MODE=true
EXCHANGE_REQUEST_TIMEOUT_MS=10000
EXCHANGE_MAX_RETRIES=3
# Hard safety switch. Order execution remains disabled: the connectivity layer
# delivers market data only, and no order-placement adapter is registered.
EXECUTION_ENABLED=false
# Internal service endpoints
TRADING_ENGINE_URL=http://localhost:8001
TRADING_ENGINE_HEALTH_PATH=/health
MARKET_DATA_URL=http://localhost:8002
MARKET_DATA_HEALTH_PATH=/health
NOTIFICATION_SERVICE_URL=http://localhost:8003
NOTIFICATION_SERVICE_HEALTH_PATH=/health
# Shared secret for service-to-service authentication (mTLS recommended in prod)
INTERNAL_SERVICE_TOKEN=change_me_internal_service_token
# Signing secret used to verify inbound exchange webhooks
EXCHANGE_WEBHOOK_SIGNING_SECRET=change_me_webhook_secret

# -----------------------------------------------------------------------------
# EXCHANGE CONNECTIVITY (libs/trading-core: wlct_trading.transport / .exchanges)
# -----------------------------------------------------------------------------
# These tune the realtime market-data connectivity layer. They contain no
# credentials: public market data needs none, and user exchange API keys are
# stored encrypted per trading account in PostgreSQL, never in the environment.
#
# Only venues with an implemented adapter can be selected. Naming a venue here
# that has no adapter fails fast at startup rather than at the first order.
EXCHANGE_MARKET_DATA_VENUES=binance
# Use the venue testnet endpoints. Keep true outside production.
EXCHANGE_USE_TESTNET=true

# --- Order-book synchronisation ---
# Depth requested for the REST snapshot. Rounded up to a depth the venue
# accepts. Deeper snapshots cost significantly more rate-limit weight
# (Binance spot: 100 levels = 5 weight, 1000 = 50, 5000 = 250).
ORDERBOOK_SNAPSHOT_DEPTH=1000
# Diffs buffered while a snapshot is in flight. Bounds memory: at 100 msg/s
# this is roughly 50 seconds of runway.
ORDERBOOK_MAX_BUFFERED_DELTAS=5000
# Resync attempts before a book is marked FAILED and refuses to serve quotes.
# It never silently serves a book it could not verify.
ORDERBOOK_MAX_RESYNC_ATTEMPTS=10
# A book quiet for longer than this is treated as stale and is not tradeable.
ORDERBOOK_STALENESS_THRESHOLD_MS=5000

# --- Websocket connection management ---
# These are read by the live transport (wlct_trading.net); the Part 3 library
# itself reads no environment at all.
WEBSOCKET_CONNECT_TIMEOUT_MS=10000
WS_HEARTBEAT_INTERVAL_MS=20000
# Silence after which the socket is considered dead and rebuilt. MUST be
# greater than WS_HEARTBEAT_INTERVAL_MS or healthy connections get killed.
WEBSOCKET_HEARTBEAT_TIMEOUT_MS=90000
# Reconnect backoff: capped exponential with full jitter. Jitter is not
# optional in production - without it every connection retries in lockstep
# after a venue blip and the reconnect storm is self-inflicted.
WS_RECONNECT_BASE_DELAY_MS=500
WS_RECONNECT_MAX_DELAY_MS=30000
WS_RECONNECT_MAX_ATTEMPTS=20
# Binance drops stream connections at 24h; cycling early makes it planned.
WS_CONNECTION_MAX_LIFETIME_SECONDS=82800

# --- Staleness thresholds (per channel, milliseconds) ---
# Trades are legitimately sporadic on thin symbols; an order book going quiet
# is not. Thresholds differ so neither alert is useless.
STALENESS_ORDER_BOOK_MS=5000
STALENESS_BOOK_TICKER_MS=5000
STALENESS_TICKER_MS=10000
STALENESS_TRADES_MS=60000
STALENESS_CANDLES_MS=120000
STALENESS_CONNECTION_MS=30000

# --- Rate limiting (venue-published values; lower them, never raise them) ---
# Binance spot: 6000 request weight per minute per IP.
BINANCE_REQUEST_WEIGHT_PER_MINUTE=6000
# 5 inbound messages per second per socket, counting PING/PONG and every
# subscribe frame. Exceeding it disconnects; repeat offenders get IP-banned.
BINANCE_WS_MESSAGES_PER_SECOND=5
BINANCE_MAX_STREAMS_PER_CONNECTION=1024
# Metrics scrape interval for the connectivity layer.
CONNECTIVITY_METRICS_INTERVAL_SECONDS=15

# -----------------------------------------------------------------------------
# LIVE MARKET DATA TRANSPORT (libs/trading-core: wlct_trading.net)
# -----------------------------------------------------------------------------
# The concrete websocket and HTTP clients behind the Part 3 abstractions.
#
# PUBLIC MARKET DATA ONLY. Nothing in this section is a credential and nothing
# on this code path can accept one: the market-data adapter has no API-key
# parameter, no request is signed, and no order is ever submitted. Live order
# execution is NOT implemented.
#
# Endpoints. Both must be TLS - the service refuses to start on ws:// or
# http://, because market data an attacker can rewrite is a way to induce bad
# trades. When EXCHANGE_USE_TESTNET=true and these are left unset, the venue's
# testnet endpoints are used automatically.
BINANCE_WS_URL=wss://stream.binance.com:9443
BINANCE_REST_URL=https://api.binance.com

# Symbols to stream. Accepts BTC/USDT, BTC-USDT or BTCUSDT; all three are
# normalised to the canonical BASE-QUOTE form and then validated against the
# venue's own instrument list, so a typo or a delisted market fails at startup
# rather than producing a socket that is silent forever.
MARKET_DATA_SYMBOLS=BTC/USDT,ETH/USDT,SOL/USDT

# Channels. Each enabled channel adds one stream per symbol to the single
# shared connection (Binance allows 1024 streams per socket).
# "ticker" is the bookTicker stream: best bid/ask on every book change, which
# is what the risk engine's price checks need. The 1-second rolling ticker is a
# statistics feed, not a quote feed.
MARKET_DATA_TICKER_ENABLED=true
MARKET_DATA_TRADES_ENABLED=true
MARKET_DATA_ORDERBOOK_ENABLED=true

# Websocket timeouts. WEBSOCKET_RECEIVE_TIMEOUT_MS is a backstop below the
# heartbeat, not the primary liveness check: a thin symbol's trade stream can
# legitimately be silent for minutes, and the venue's protocol pings are
# answered by the client library without ever surfacing as a message. Set it
# too low and a healthy but quiet connection is torn down in a loop.
WEBSOCKET_RECEIVE_TIMEOUT_MS=300000
# Client-initiated ping cadence and its response deadline. Binance pings every
# 3 minutes and disconnects after 10 without a pong; this is the reverse
# direction, used to notice a peer that has gone away silently.
WEBSOCKET_PING_INTERVAL_MS=180000
WEBSOCKET_PING_TIMEOUT_MS=60000
WEBSOCKET_CLOSE_TIMEOUT_MS=5000
# Frame size ceiling. An unbounded reader is a memory-exhaustion vector.
WEBSOCKET_MAX_FRAME_BYTES=8388608

# HTTP timeouts for REST snapshots. Every request is bounded by all three;
# there is no code path that produces an unbounded wait.
HTTP_CONNECT_TIMEOUT_MS=5000
HTTP_READ_TIMEOUT_MS=10000
HTTP_TOTAL_TIMEOUT_MS=15000
# Retries are bounded and only fire for categories the retry policy calls
# retryable. A 400 is never retried; a 429 honours the venue's Retry-After.
HTTP_MAX_RETRIES=3
HTTP_MAX_CONNECTIONS=20

# Duration of the separately invoked live smoke test
# (scripts/live_market_data_smoke_test.py). That script is the only thing in
# the repository that touches a real exchange; the normal test suite needs no
# internet, credentials, database or Redis.
LIVE_MARKET_DATA_SMOKE_TEST_DURATION_SECONDS=30

# -----------------------------------------------------------------------------
# EMAIL
# -----------------------------------------------------------------------------
# console | smtp (implemented). ses and postmark are planned; selecting an
# unimplemented driver fails fast instead of dropping mail silently.
MAIL_DRIVER=console
MAIL_FROM_NAME=CopyTrade
MAIL_FROM_ADDRESS=no-reply@copytrade.app
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=

# -----------------------------------------------------------------------------
# NOTIFICATIONS (push / sms / webhooks)
# -----------------------------------------------------------------------------
NOTIFICATIONS_ENABLED=true
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY_BASE64=
TELEGRAM_BOT_TOKEN=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=

# -----------------------------------------------------------------------------
# LOCALIZATION / CURRENCY
# -----------------------------------------------------------------------------
DEFAULT_LOCALE=en
SUPPORTED_LOCALES=en,es,ar,bn,tr
DEFAULT_CURRENCY=USD
SUPPORTED_CURRENCIES=USD,EUR,GBP,AED,BDT,TRY
FX_RATES_PROVIDER=none
FX_RATES_API_KEY=

# -----------------------------------------------------------------------------
# KYC (architecture only in Part 1)
# -----------------------------------------------------------------------------
# none | sumsub | onfido | shufti
KYC_PROVIDER=none
KYC_API_URL=
KYC_APP_TOKEN=
KYC_SECRET_KEY=
KYC_WEBHOOK_SECRET=

# -----------------------------------------------------------------------------
# PAYMENTS / BILLING (architecture only in Part 1)
# -----------------------------------------------------------------------------
# none | stripe | nowpayments
BILLING_PROVIDER=none
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NOWPAYMENTS_API_KEY=
NOWPAYMENTS_IPN_SECRET=

# -----------------------------------------------------------------------------
# BOOTSTRAP / SEED (development only)
# -----------------------------------------------------------------------------
# QUOTING: always wrap a value in double quotes if it contains '#', a space, or
# any shell metacharacter. The '#' case is the one that bites: dotenv-cli treats
# an unquoted '#' as the start of a comment and silently truncates the value,
# while sourcing the same file from bash (`set -a; . .env`) keeps it intact.
# The two then disagree, so the password the seed hashes is not the password
# your scripts send, and you get an inexplicable 401 followed by a lockout.
#   WRONG: SEED_SUPER_ADMIN_PASSWORD=My_P4ss#2026   -> becomes "My_P4ss"
#   RIGHT: SEED_SUPER_ADMIN_PASSWORD="My_P4ss#2026"
SEED_SUPER_ADMIN_EMAIL=superadmin@copytrade.app
SEED_SUPER_ADMIN_PASSWORD="ChangeMe_Str0ng!Pass"
SEED_TENANT_ADMIN_EMAIL=admin@acme-capital.test
SEED_TENANT_ADMIN_PASSWORD=ChangeMe_Str0ng!Pass

# -----------------------------------------------------------------------------
# ADMIN WEB (Next.js) - consumed by apps/admin-web
# -----------------------------------------------------------------------------
# Server-side base URL used by Next route handlers and server components to
# reach the API. Inside Docker Compose this becomes http://api:4000/api.
API_BASE_URL=http://localhost:4000/api
# Organisation the console administers when no custom domain is in play.
ADMIN_TENANT_SLUG=platform
# Salt for the console's session cookies. Generate: openssl rand -base64 32
SESSION_COOKIE_SECRET=change_me_admin_session_secret_min_16_chars

# Browser-visible values only. Never place a secret behind NEXT_PUBLIC_.
NEXT_PUBLIC_APP_NAME="CopyTrade Admin"
NEXT_PUBLIC_API_VERSION=v1
NEXT_PUBLIC_WS_URL=http://localhost:4000
NEXT_PUBLIC_WS_PATH=/socket.io
NEXT_PUBLIC_DEFAULT_LOCALE=en

# -----------------------------------------------------------------------------
# TRADING ENGINE (services/trading-engine, Python/FastAPI, port 8001)
# -----------------------------------------------------------------------------
TRADING_ENGINE_HOST=0.0.0.0
TRADING_ENGINE_PORT=8001

# Pre-trade risk ceilings. These are hard caps enforced by the engine on every
# order intent; they are not user-configurable from the client.
MAX_ORDER_NOTIONAL_USD=1000
MAX_OPEN_POSITIONS_PER_ACCOUNT=20
MAX_LEVERAGE=5

# -----------------------------------------------------------------------------
# MARKET DATA (services/market-data, Python/FastAPI, port 8002)
# -----------------------------------------------------------------------------
MARKET_DATA_HOST=0.0.0.0
MARKET_DATA_PORT=8002
# Public reference-price sources, tried in order. No credentials are used.
MARKET_DATA_SOURCES=binance,bybit
MARKET_DATA_SYMBOLS=BTC/USDT,ETH/USDT,SOL/USDT
MARKET_DATA_POLL_INTERVAL_SECONDS=5
# A cached quote older than this is served with stale=true.
MARKET_DATA_CACHE_TTL_SECONDS=15
# Enables the realtime websocket connectivity layer (wlct_trading.transport).
# Off by default: with it disabled the service serves cached REST quotes only
# and opens no exchange sockets.
MARKET_DATA_STREAMING_ENABLED=false

# -----------------------------------------------------------------------------
# NOTIFICATION SERVICE (services/notification-service, Node/BullMQ, port 8003)
# -----------------------------------------------------------------------------
NOTIFICATION_SERVICE_HOST=0.0.0.0
NOTIFICATION_SERVICE_PORT=8003
# The standalone worker reads MAIL_DRIVER, MAIL_FROM_* and SMTP_* from the
# EMAIL section above. Only "console" and "smtp" are implemented; any other
# value throws on startup rather than silently discarding mail.
# none | fcm | apns. "none" reports delivered:false instead of faking delivery.
PUSH_PROVIDER=none
# none | twilio
SMS_PROVIDER=none

# -----------------------------------------------------------------------------
# SHARED LOGGING (all Node and Python services)
# -----------------------------------------------------------------------------
# json in every deployed environment; pretty is for local terminals only.
LOG_FORMAT=json
# Additional pino redaction paths, comma separated. The built-in list already
# covers authorization headers, cookies, passwords, tokens and API secrets.
PINO_REDACT_PATHS=

# -----------------------------------------------------------------------------
# MOBILE APP (apps/mobile, Flutter)
# -----------------------------------------------------------------------------
# The Flutter app deliberately does NOT read this file. A .env shipped inside an
# APK/IPA is trivially extractable, so every mobile value is compiled in with
# --dart-define and the app holds no secrets at all: it authenticates with the
# user's own credentials and stores the resulting tokens in the platform
# keystore (flutter_secure_storage), never in shared preferences or a bundled
# asset. The variables below are listed here only so that all configuration for
# the platform lives in one discoverable place.
#
#   APP_ENV       development | staging | production
#   API_BASE_URL  Base URL INCLUDING the global prefix, e.g. https://api.example.com/api
#                 Android emulator reaches the host through 10.0.2.2, not localhost.
#                 Production builds refuse to start unless this is https://.
#   API_VERSION   URI version segment appended after the prefix (v1)
#   TENANT_SLUG   Sent as X-Tenant-Slug; identifies the white-label brand
#   WS_URL        Socket.IO origin, without the /realtime namespace
#
# Local development against this compose stack:
#
#   flutter run \
#     --dart-define=APP_ENV=development \
#     --dart-define=API_BASE_URL=http://10.0.2.2:4000/api \
#     --dart-define=API_VERSION=v1 \
#     --dart-define=TENANT_SLUG=platform \
#     --dart-define=WS_URL=http://10.0.2.2:4000
#
# Release build:
#
#   flutter build apk --release \
#     --dart-define=APP_ENV=production \
#     --dart-define=API_BASE_URL=https://api.example.com/api \
#     --dart-define=API_VERSION=v1 \
#     --dart-define=TENANT_SLUG=acme \
#     --dart-define=WS_URL=https://api.example.com
#
# Prefer --dart-define-from-file=config/production.json in CI so the values are
# versioned per environment instead of being retyped on the command line.

# =============================================================================
# PART 5 - AUTHENTICATED EXECUTION (libs/trading-core: wlct_trading.execution)
# =============================================================================
# Everything in this block governs whether real orders can reach a real
# exchange with real money. Read the whole section before changing anything.
#
# THE DEFAULTS BELOW CANNOT TRADE. That is deliberate and it is enforced in
# code, not just by convention: an unset variable is never treated as
# permission, and a contradictory combination fails at startup rather than
# resolving itself to the dangerous option.

# -----------------------------------------------------------------------------
# Exchange credentials
# -----------------------------------------------------------------------------
# NEVER commit real values. NEVER paste a key into a ticket, a chat message or
# a log. These are read once at startup by the credential provider and are
# never written to the database, never returned by an API, never included in a
# WebSocket payload and never logged - the credential object redacts itself in
# every rendering path, including repr() and f-strings.
#
# Create the key on Binance with ONLY:
#   [x] Enable Reading
#   [x] Enable Spot & Margin Trading
#   [ ] Enable Withdrawals   <-- MUST stay off
# A withdrawal-capable key is rejected by verify_credentials() and by the
# CREDENTIALS_VALID safety gate. The platform is non-custodial and refuses to
# hold a key that can move funds off the exchange.
#
# Also add an IP allowlist on the key. It is the single most effective control
# available, and it is free.
#
# These two variables are for a single-tenant development setup only. In
# production, per-tenant credentials come from the secret manager through
# SecretManagerCredentialProvider (Vault / AWS Secrets Manager / GCP Secret
# Manager / KMS), keyed by tenant and account. Environment variables do not
# scale to multi-tenant and cannot be rotated per customer.
BINANCE_API_KEY=
BINANCE_API_SECRET=
# Optional: restricts what the platform believes the key can do, independently
# of what the venue says. Comma separated. WITHDRAW here is always refused.
BINANCE_API_PERMISSIONS=SPOT
# Where credentials come from: env | secret-manager | none
CREDENTIAL_PROVIDER=env
# Cache TTL for a resolved credential, in seconds. Short, so a revoked key
# stops working quickly; non-zero, so every order does not hit the secret
# manager. 300 is a reasonable compromise.
CREDENTIAL_CACHE_TTL_SECONDS=300

# -----------------------------------------------------------------------------
# The four switches that gate real money
# -----------------------------------------------------------------------------
# All of the following must agree before a single byte reaches a real venue:
#
#   LIVE_TRADING_ENABLED=true
#   DRY_RUN=false
#   PAPER_TRADING=false
#   TRADING_MODE=LIVE
#   TRADING_ENABLED=true
#   LIVE_TRADING_CONFIRMED=true
#
# Any disagreement is a startup failure with an explicit message. In
# particular:
#   * LIVE_TRADING_ENABLED=true with DRY_RUN=true   -> REJECTED (contradiction)
#   * LIVE_TRADING_ENABLED=true with PAPER_TRADING=true -> REJECTED
#   * LIVE_TRADING_ENABLED=true without TRADING_MODE=LIVE -> REJECTED
# The platform never silently picks the dangerous interpretation, and never
# silently downgrades a misconfigured LIVE to PAPER either - a silent downgrade
# hides a production misconfiguration until the day it matters.

# Master switch for real-money execution.
LIVE_TRADING_ENABLED=false

# Build, validate, risk-check and sign the request, then stop. Nothing is
# transmitted and the order is NEVER reported as submitted. This is the correct
# setting for verifying a configuration end to end without risk.
DRY_RUN=true

# Route orders to the simulated venue. Paper fills are computed from real
# observed prices and are labelled is_simulated=true everywhere they appear -
# in the database, in the API and in every PnL figure.
PAPER_TRADING=true

# -----------------------------------------------------------------------------
# Execution timing
# -----------------------------------------------------------------------------
# How long to wait for a venue response before treating the outcome as UNKNOWN.
# A timeout is ambiguous, not a failure: the order may have been accepted. It
# is reconciled by clientOrderId and never resubmitted.
ORDER_REQUEST_TIMEOUT_MS=10000

# How often the background sweep compares local state against the venue.
ORDER_RECONCILIATION_INTERVAL_MS=60000

# How long to wait before reconciling an order whose result was unknown. Long
# enough for the venue to have finished processing; short enough that a
# position is not a mystery for minutes.
ORDER_UNKNOWN_RECONCILIATION_DELAY_MS=2000

# How often the exchange clock offset is re-measured. A signed request whose
# timestamp is outside the venue's window is rejected, so this is not optional.
EXCHANGE_TIME_SYNC_INTERVAL_MS=300000

# Maximum tolerated difference between this host's clock and the venue's.
# Above this, signing is REFUSED rather than attempted - Binance rejects a
# timestamp more than 1000ms ahead of server time regardless of recvWindow, so
# a larger local error cannot be compensated for by widening the window. If you
# hit this, fix NTP; do not raise the limit.
EXCHANGE_MAX_CLOCK_SKEW_MS=1000

# recvWindow sent with every signed request. Binance caps this at 60000.
# Smaller is safer: it bounds how long a captured request stays replayable.
EXCHANGE_RECV_WINDOW_MS=5000

# How long a clientOrderId reservation is remembered in Redis. The durable
# guard is the unique index on (tenant_id, client_order_id); this is the cheap
# fast path in front of it. 86400 = 24h.
EXECUTION_IDEMPOTENCY_TTL_SECONDS=86400

# Refuse to submit when the risk snapshot is older than this. Stale risk state
# is treated as unavailable, and unavailable means the order is refused.
MAX_RISK_STATE_AGE_MS=5000

# Submission attempts for genuinely retryable failures. Never applied to an
# ambiguous result - that path reconciles instead of retrying, always.
MAX_SUBMIT_ATTEMPTS=1

# -----------------------------------------------------------------------------
# Private user-data stream
# -----------------------------------------------------------------------------
# The authenticated WebSocket that delivers fills, order updates and balance
# changes. Backend only: its payloads are the full order flow of a real
# account and must never reach a mobile client or the admin web app.
PRIVATE_STREAM_RECONNECT_ENABLED=true

# Listen-key keepalive interval. Binance expires a listen key after 60 minutes;
# 30 minutes means one renewal can fail entirely and the stream still survives.
PRIVATE_STREAM_LISTEN_KEY_REFRESH_MS=1800000

# After every reconnect the platform reconciles, because Binance does not
# replay events missed while disconnected. Leave this on.
PRIVATE_STREAM_RECONCILE_ON_RECONNECT=true

# -----------------------------------------------------------------------------
# Live-trading harness (NOT part of the default startup path)
# -----------------------------------------------------------------------------
# Guards the separately-invoked script that places a real order on testnet.
# It refuses to run unless this is explicitly true AND the credentials point at
# a testnet endpoint.
LIVE_EXECUTION_HARNESS_ENABLED=false
BINANCE_USE_TESTNET_FOR_HARNESS=true

# =============================================================================
# PART 6 - STRATEGY ENGINE, PAPER TRADING, BACKTESTING
# =============================================================================
# The strategy layer decides what it would like to do. It cannot submit an
# order, it never sees a credential, and NOTHING IN THIS SECTION CAN ENABLE
# LIVE TRADING. That still requires the Part 5 combination above
# (LIVE_TRADING_ENABLED=true, EXECUTION_ENABLED=true, DRY_RUN=false,
# PAPER_TRADING=false, EXCHANGE_SANDBOX_MODE=false), and every one of those is
# validated at startup.
#
# THREE THINGS THIS SECTION CANNOT PROMISE:
#   BACKTEST PERFORMANCE IS NOT INDICATIVE OF FUTURE PERFORMANCE.
#   PAPER PERFORMANCE IS NOT INDICATIVE OF LIVE PERFORMANCE.
#   SIMULATION DOES NOT GUARANTEE REAL EXECUTION QUALITY.

# -----------------------------------------------------------------------------
# Feature switches
# -----------------------------------------------------------------------------
# Master switch for the strategy engine. Off by default: a deployment that has
# not been asked to run strategies should not spend CPU on every book update.
STRATEGY_ENGINE_ENABLED=false

# Whether paper sessions may be started. A paper session routes to the
# simulated adapter and refuses any adapter that is not marked simulated, so
# this is safe to leave on.
PAPER_TRADING_ENABLED=true

# Whether backtests may be submitted. A backtest opens no socket and touches
# no venue; it reads a stored dataset and replays it.
BACKTEST_ENABLED=true

# -----------------------------------------------------------------------------
# Engine bounds
# -----------------------------------------------------------------------------
# Bound on the in-process market-data queue feeding the strategies. A bounded
# queue turns a slow strategy into shed load rather than unbounded memory
# growth. Valid range 100 - 1000000.
STRATEGY_EVENT_QUEUE_SIZE=10000

# Hard cap on concurrently registered strategy instances per process.
# Valid range 1 - 1000.
STRATEGY_MAX_INSTANCES=50

# Observation budget for one dispatch, in milliseconds. Exceeding it increments
# a counter and marks the dispatch slow so an operator can see degradation.
# It is NOT a guarantee: this platform makes no latency guarantee, and any
# claim of "sub-millisecond" processing would be false. Must stay well below
# SIGNAL_MAX_AGE_MS.
STRATEGY_MAX_PROCESSING_LATENCY_MS=50

# -----------------------------------------------------------------------------
# Signal handling
# -----------------------------------------------------------------------------
# A signal older than this is refused by the validator rather than acted on.
# Stale intent is how a processing backlog turns into a bad fill.
SIGNAL_MAX_AGE_MS=2000

# How long a signal identity is remembered so an identical repeat is dropped.
# This is a bounded in-memory guard against a chattering strategy - it is NOT
# the order idempotency system, which lives in the execution layer and is
# backed by a unique index. Must cover at least SIGNAL_MAX_AGE_MS.
SIGNAL_DEDUP_TTL_SECONDS=5

# -----------------------------------------------------------------------------
# Backtest defaults
# -----------------------------------------------------------------------------
# Applied when a backtest request does not state its own assumptions. They are
# recorded in the configuration hash of every run, so changing one here changes
# the identity of subsequent runs - which is the point: two results computed
# under different cost assumptions are not comparable.
#
# None of these describe a real account or a real fee schedule. Set them from
# your venue's published rates.
BACKTEST_DEFAULT_INITIAL_CAPITAL=10000

# Fee RATES, not basis points: 0.001 is ten basis points. Maker and taker are
# separate because they are separate on every venue that matters.
BACKTEST_DEFAULT_MAKER_FEE=0.001
BACKTEST_DEFAULT_TAKER_FEE=0.001

# Slippage in basis points applied against every simulated taker fill, on both
# sides. Zero fees together with zero slippage is refused in production: that
# combination produces results no real account could achieve.
BACKTEST_DEFAULT_SLIPPAGE_BPS=1
```

---
