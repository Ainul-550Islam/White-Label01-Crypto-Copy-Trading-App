"""The real-time risk engine: the authoritative gate between intent and execution.

Part 2 shipped a single-module pre-trade gate; Part 8 turned it into a
package without moving its public names: ``from wlct_trading.risk import
RiskEngine`` resolves exactly as before, because ``core`` re-exports it and
this barrel re-exports ``core``. The Part 2/5 engine remains what
``ExecutionEngine``, the paper sessions and the backtest engine call directly
and unchanged.

What is new, and how it composes:

``configuration``
    Versioned, digest-checked, hierarchically resolved limits
    (GLOBAL -> EXCHANGE -> ACCOUNT -> STRATEGY -> SYMBOL, most restrictive
    wins at every level).
``snapshot``
    ``RiskStateSnapshot``: the complete immutable in-memory state one
    decision reads - account, positions, open-order reservations, market
    health, day-scoped PnL, rate windows - with per-source provenance
    timestamps, a monotonic version, and a binding to the configuration
    digest it was assembled against.
``exposure`` / ``correlation``
    The reservation model (open orders + projected position) and the
    manually-defined correlation groups.
``rules``
    The 22-rule catalog with declared applicability; every rule answers
    PASS / BREACH / NOT_APPLICABLE / UNVERIFIABLE, and the gate treats the
    last as a refusal.
``freshness``
    The single definition of "stale" and of the UTC trading day.
``protections``
    Kill-switch lifecycle (INACTIVE/ACTIVE/TRIGGERED/ACKNOWLEDGED/CLEARED)
    across six scopes, and automatic-protection policy that *proposes*, never
    acts.
``rate_limits`` / ``ledger``
    Distributed order/cancel windows and the check-and-reserve budget
    ledger; the consistency model is documented there, honestly and partly
    in Lua.
``events``
    Normalised, content-deduplicated risk events that ride the one bus.
``evaluator``
    ``RiskGate``: composes the core engine with everything above into one
    fail-closed decision.
``replay``
    Audit-only deterministic replay. No execution imports anywhere in this
    package's Part 8 modules (there are none in ``core`` either), and the
    test suite enforces that.

Layering rules the package itself obeys:
* no module here imports the execution engine, adapters, transports or any
  I/O client; the gate computes, the hosts persist and transmit;
* ``core`` imports no Part 8 module except ``decisions`` (the latency type),
  keeping the Part 2/5 path loadable on its own;
* every money-shaped value is a ``Decimal`` parsed from strings or ints -
  floats are refused at every boundary in this package.
"""

from __future__ import annotations

from wlct_trading.risk.codes import (
    DECISION_CODE_ALIASES,
    RULE_TO_DECISION_CODE,
    decision_code_for_rule,
    is_failure_code,
)
from wlct_trading.risk.configuration import (
    RATE_WINDOW_ONE_MINUTE_MICROS,
    RATE_WINDOW_ONE_SECOND_MICROS,
    ResolvedLimit,
    RiskConfiguration,
    RiskConfigurationError,
    RiskLimitEntry,
    ScopeContext,
    UnknownRiskRuleError,
)
from wlct_trading.risk.correlation import (
    CorrelationGroup,
    CorrelationGroupError,
    CorrelationGroupRegistry,
)
from wlct_trading.risk.core import (
    KillSwitchState,
    RiskDecision,
    RiskEngine,
    RiskLimits,
    RiskSnapshot,
    RiskViolation,
    TradingModeError,
    TradingModeResolver,
    price_deviation_percent,
)
from wlct_trading.risk.decisions import (
    LatencyBreakdown,
    LatencyStopwatch,
    decision_is_current,
)
from wlct_trading.risk.events import (
    KIND_TO_TRADING_EVENT,
    InMemoryRiskEventSink,
    RiskEvent,
    RiskEventSink,
    events_for_replay_digest,
    severity_for_breach,
)
from wlct_trading.risk.exposure import (
    ExposureBreakdown,
    ExposureBucket,
    ExposureDimension,
    OpenOrderView,
    PositionView,
    ProjectingContext,
    ReferenceView,
    build_breakdown,
    clip_toward_zero,
    orders_for,
    project_position,
    reservation_delta,
)
from wlct_trading.risk.freshness import (
    DEFAULT_MAX_FUTURE_SKEW_MICROS,
    FreshnessBudget,
    FreshnessReport,
    SourceFreshness,
    is_fresh,
    trading_day_bounds_utc,
    trading_day_utc,
)
from wlct_trading.risk.ledger import (
    RESERVATION_ACQUIRE_SCRIPT,
    RESERVATION_RELEASE_SCRIPT,
    LocalReservationLedger,
    RedisReservationLedger,
    ReservationRequest,
    ReservationResult,
    ReservationTicket,
    RiskReservationLedger,
)
from wlct_trading.risk.protections import (
    AutomaticProtectionPolicy,
    BlockingSwitch,
    KillSwitchLedger,
    KillSwitchRecord,
    ProtectionOccurrence,
    ProtectionTransitionError,
    SwitchTransition,
    classify_risk_direction,
)
from wlct_trading.risk.rate_limits import (
    RATE_BUCKET_ONE_MINUTE_MICROS,
    RATE_BUCKET_ONE_SECOND_MICROS,
    RATE_COUNTER_SCRIPT,
    RATE_ROLLBACK_SCRIPT,
    LocalRateCoordinator,
    RateCoordinator,
    RateReservation,
    RateWindowCounters,
    RiskRateKind,
    RiskRateState,
    rate_bucket_keys,
)
from wlct_trading.risk.replay import (
    ReplayDecision,
    ReplayStep,
    ReplayStepKind,
    RiskReplay,
    RiskReplayResult,
)
from wlct_trading.risk.evaluator import GateError, GateOutcome, RiskGate
from wlct_trading.risk.rules import (
    INTEGRITY_RULES,
    NEW_RISK_RULES,
    ProjectionResult,
    RuleInputs,
    RuleOutcome,
    RuleStatus,
    assert_catalog_coherence,
    evaluate_rules,
    rule_evaluator,
)
from wlct_trading.risk.simulated import (
    SimulatedRiskInputs,
    build_simulated_state,
)
from wlct_trading.risk.snapshot import (
    RiskAccountState,
    RiskMarketDataState,
    RiskOpenOrderState,
    RiskPositionState,
    RiskStateSnapshot,
    RiskStrategyState,
    SnapshotError,
)
from wlct_trading.enums import RiskDecisionCode

__all__ = [
    # -- Part 2/5 core (names unchanged; imports of the old module keep working) --
    "RiskLimits",
    "RiskSnapshot",
    "KillSwitchState",
    "RiskViolation",
    "RiskDecision",
    "RiskEngine",
    "TradingModeResolver",
    "TradingModeError",
    "price_deviation_percent",
    "RiskDecisionCode",
    # -- codes --
    "RULE_TO_DECISION_CODE",
    "DECISION_CODE_ALIASES",
    "decision_code_for_rule",
    "is_failure_code",
    # -- decisions --
    "LatencyBreakdown",
    "LatencyStopwatch",
    "decision_is_current",
    # -- configuration --
    "RiskLimitEntry",
    "RiskConfiguration",
    "ResolvedLimit",
    "ScopeContext",
    "RiskConfigurationError",
    "UnknownRiskRuleError",
    "RATE_WINDOW_ONE_SECOND_MICROS",
    "RATE_WINDOW_ONE_MINUTE_MICROS",
    # -- correlation --
    "CorrelationGroup",
    "CorrelationGroupRegistry",
    "CorrelationGroupError",
    # -- snapshot --
    "RiskAccountState",
    "RiskPositionState",
    "RiskOpenOrderState",
    "RiskMarketDataState",
    "RiskStrategyState",
    "RiskStateSnapshot",
    "SnapshotError",
    # -- simulated state builder --
    "SimulatedRiskInputs",
    "build_simulated_state",
    # -- exposure --
    "ExposureDimension",
    "ExposureBucket",
    "ExposureBreakdown",
    "OpenOrderView",
    "PositionView",
    "ReferenceView",
    "ProjectingContext",
    "reservation_delta",
    "clip_toward_zero",
    "orders_for",
    "project_position",
    "build_breakdown",
    # -- rules --
    "RuleStatus",
    "RuleOutcome",
    "RuleInputs",
    "ProjectionResult",
    "evaluate_rules",
    "rule_evaluator",
    "assert_catalog_coherence",
    "NEW_RISK_RULES",
    "INTEGRITY_RULES",
    # -- freshness --
    "FreshnessBudget",
    "SourceFreshness",
    "FreshnessReport",
    "trading_day_utc",
    "trading_day_bounds_utc",
    "is_fresh",
    "DEFAULT_MAX_FUTURE_SKEW_MICROS",
    # -- protections --
    "KillSwitchRecord",
    "KillSwitchLedger",
    "AutomaticProtectionPolicy",
    "ProtectionOccurrence",
    "ProtectionTransitionError",
    "SwitchTransition",
    "BlockingSwitch",
    "classify_risk_direction",
    # -- rate limits --
    "RiskRateKind",
    "RiskRateState",
    "RateWindowCounters",
    "RateCoordinator",
    "RateReservation",
    "LocalRateCoordinator",
    "rate_bucket_keys",
    "RATE_BUCKET_ONE_SECOND_MICROS",
    "RATE_BUCKET_ONE_MINUTE_MICROS",
    "RATE_COUNTER_SCRIPT",
    "RATE_ROLLBACK_SCRIPT",
    # -- ledger --
    "ReservationRequest",
    "ReservationTicket",
    "ReservationResult",
    "RiskReservationLedger",
    "LocalReservationLedger",
    "RedisReservationLedger",
    "RESERVATION_ACQUIRE_SCRIPT",
    "RESERVATION_RELEASE_SCRIPT",
    # -- events --
    "RiskEvent",
    "RiskEventSink",
    "InMemoryRiskEventSink",
    "severity_for_breach",
    "KIND_TO_TRADING_EVENT",
    "events_for_replay_digest",
    # -- evaluator --
    "RiskGate",
    "GateOutcome",
    "GateError",
    # -- replay --
    "ReplayStepKind",
    "ReplayStep",
    "ReplayDecision",
    "RiskReplayResult",
    "RiskReplay",
]
