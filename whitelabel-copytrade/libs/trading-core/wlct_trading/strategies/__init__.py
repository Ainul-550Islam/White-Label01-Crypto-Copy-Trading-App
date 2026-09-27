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
