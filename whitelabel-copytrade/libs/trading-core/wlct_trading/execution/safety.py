"""Pre-submit safety gates.

Every gate in this module runs **before** an order is built, signed or
transmitted, and every one of them is required. There is no bypass, no
"force" parameter and no admin override that skips the evaluation — an
override may change a gate's *input* (an operator can disengage a kill switch)
but never skip the check itself.

The design rule is fail-closed. Each gate answers "is it definitely safe to
proceed?", so anything unknown, stale, unreachable or unparseable is a block.
That is deliberately the opposite of the usual availability instinct: when the
risk engine is down the safe behaviour is to stop trading, not to trade
unchecked.

Gates evaluated, in order:

===  ================================  ============================================
#    Gate                              Blocks when
===  ================================  ============================================
1    Global kill switch                Engaged
2    Exchange kill switch              Engaged for this exchange
3    Strategy kill switch              Engaged for this strategy
4    Symbol kill switch                Engaged for this symbol
5    Trading mode                      Resolver says DISABLED
6    Live trading authorisation        Live path without every flag explicitly set
7    Risk engine health                Unhealthy, unreachable or stale state
8    Market data health                Required but stale/absent/unusable
9    Credential validity               Missing, expired, or withdrawal-capable
10   Exchange health                   Disconnected, degraded or rate-limit locked
11   Placement attestation             The reviewer ran and its verdict says no
===  ================================  ============================================

All gates are evaluated even after the first block, so an operator sees every
reason at once rather than fixing them one deployment at a time.

Gate 11 differs from the other ten in one respect: it can be *not applicable*,
which is the state a runtime that has no reviewer is in. That is not a bypass -
:``ExecutionEngine`` refuses to construct a runtime that can transmit without
one, so the only runtimes that see ``applicable=False`` are simulated and
dry-run ones, where a venue would have answered something no venue was asked.
See :mod:`wlct_trading.execution.placement_review` for the law itself.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

from wlct_trading.clock import epoch_micros
from wlct_trading.enums import KillSwitchScope, TradingMode
from wlct_trading.execution.config import ExecutionSettings
from wlct_trading.execution.credentials import ExchangeCredentials
from wlct_trading.execution.placement_review import PlacementVerdict
from wlct_trading.risk import KillSwitchState

__all__ = [
    "SafetyGate",
    "GateResult",
    "SafetyDecision",
    "ComponentHealth",
    "ExecutionPreconditions",
    "evaluate_safety_gates",
]


class SafetyGate(str, Enum):
    """Identifier for each pre-submit gate.

    String-valued so it can be emitted in an event payload, a metric label or
    an audit record without a conversion step.
    """

    GLOBAL_KILL_SWITCH = "GLOBAL_KILL_SWITCH"
    EXCHANGE_KILL_SWITCH = "EXCHANGE_KILL_SWITCH"
    STRATEGY_KILL_SWITCH = "STRATEGY_KILL_SWITCH"
    SYMBOL_KILL_SWITCH = "SYMBOL_KILL_SWITCH"
    TRADING_MODE = "TRADING_MODE"
    LIVE_TRADING_AUTHORISED = "LIVE_TRADING_AUTHORISED"
    RISK_ENGINE_HEALTHY = "RISK_ENGINE_HEALTHY"
    MARKET_DATA_HEALTHY = "MARKET_DATA_HEALTHY"
    CREDENTIALS_VALID = "CREDENTIALS_VALID"
    EXCHANGE_HEALTHY = "EXCHANGE_HEALTHY"
    #: Part 16: the venue-side answer to "may this key place this order on this
    #: symbol right now". Kept a gate rather than a new rejection path so that
    #: one code path handles every local refusal.
    PLACEMENT_ATTESTED = "PLACEMENT_ATTESTED"


@dataclass(frozen=True, slots=True)
class GateResult:
    """Outcome of a single gate."""

    gate: SafetyGate
    passed: bool
    #: Operator-facing explanation. Present on failure, and on a pass where the
    #: reason is interesting (for example a gate skipped as not applicable).
    detail: str = ""
    #: A gate that does not apply in this context counts as passed but is
    #: flagged so health output can distinguish "checked and fine" from
    #: "not relevant here".
    applicable: bool = True

    def to_dict(self) -> dict[str, object]:
        return {
            "gate": self.gate.value,
            "passed": self.passed,
            "applicable": self.applicable,
            "detail": self.detail,
        }


@dataclass(frozen=True, slots=True)
class SafetyDecision:
    """Aggregate verdict across every gate."""

    allowed: bool
    results: tuple[GateResult, ...]
    evaluated_at_micros: int
    trading_mode: TradingMode
    will_transmit: bool

    @property
    def failures(self) -> tuple[GateResult, ...]:
        return tuple(result for result in self.results if not result.passed)

    @property
    def blocking_gate(self) -> SafetyGate | None:
        """The first gate that blocked, for the primary rejection reason."""
        failures = self.failures
        return failures[0].gate if failures else None

    @property
    def reason(self) -> str:
        failures = self.failures
        if not failures:
            return "All pre-submit safety gates passed."
        return "; ".join(f"{item.gate.value}: {item.detail}" for item in failures)

    def to_dict(self) -> dict[str, object]:
        return {
            "allowed": self.allowed,
            "tradingMode": self.trading_mode.value,
            "willTransmit": self.will_transmit,
            "evaluatedAtMicros": self.evaluated_at_micros,
            "blockingGate": (
                self.blocking_gate.value if self.blocking_gate is not None else None
            ),
            "reason": self.reason,
            "gates": [result.to_dict() for result in self.results],
        }


@dataclass(frozen=True, slots=True)
class ComponentHealth:
    """Health of one dependency, as reported by its owner.

    ``healthy`` defaults to ``False``. Constructing this object without saying
    anything means "unknown", and unknown blocks — a caller that forgets to
    populate a field cannot accidentally open a gate.
    """

    healthy: bool = False
    detail: str = "No health report supplied."
    #: Age of the most recent successful update, if the component is one whose
    #: freshness matters (risk state, market data).
    age_micros: int | None = None

    @classmethod
    def ok(cls, detail: str = "Healthy.", age_micros: int | None = None) -> "ComponentHealth":
        return cls(healthy=True, detail=detail, age_micros=age_micros)

    @classmethod
    def down(cls, detail: str) -> "ComponentHealth":
        return cls(healthy=False, detail=detail)


@dataclass(frozen=True, slots=True)
class ExecutionPreconditions:
    """Inputs to the gate evaluation.

    Gathered by the execution engine immediately before submission so that no
    gate reads a value that was true a minute ago.
    """

    exchange: str
    symbol: str
    strategy_id: str | None
    kill_switches: KillSwitchState
    settings: ExecutionSettings
    risk_health: ComponentHealth = field(default_factory=ComponentHealth)
    market_data_health: ComponentHealth = field(default_factory=ComponentHealth)
    exchange_health: ComponentHealth = field(default_factory=ComponentHealth)
    credentials: ExchangeCredentials | None = None
    #: Set false for order types that do not consult a reference price (a plain
    #: market order on a venue where no price band is enforced). The engine
    #: passes ``True`` whenever the risk evaluation used a price.
    market_data_required: bool = True
    #: Simulated venues need no credentials and no exchange connectivity.
    is_simulated: bool = False
    #: The Part 16 placement verdict, when a reviewer ran. ``None`` means "no
    #: reviewer is wired", which this gate reports as not-applicable rather than
    #: as a pass or a failure: the answer is "nobody checked", and the engine
    #: refuses to *start* a transmitting runtime without a reviewer, so the
    #: fail-closed moment is boot, not the first order.
    placement: PlacementVerdict | None = None


def _kill_switch_gate(
    gate: SafetyGate,
    engaged: bool,
    scope: KillSwitchScope,
    target: str | None,
    reason: str | None,
) -> GateResult:
    if not engaged:
        return GateResult(gate=gate, passed=True, detail="Not engaged.")
    label = f" for {target!r}" if target else ""
    suffix = f" Reason: {reason}" if reason else ""
    return GateResult(
        gate=gate,
        passed=False,
        detail=(
            f"The {scope.value} kill switch is engaged{label}; order submission "
            f"is blocked until it is disengaged.{suffix}"
        ),
    )


def evaluate_safety_gates(
    preconditions: ExecutionPreconditions,
    *,
    now_micros: int | None = None,
) -> SafetyDecision:
    """Run every gate and return the aggregate verdict.

    Pure and synchronous: it reads only the supplied snapshot, so it is fully
    deterministic and testable without a venue, a database or a clock.
    """
    now = epoch_micros() if now_micros is None else now_micros
    pre = preconditions
    settings = pre.settings
    switches = pre.kill_switches
    results: list[GateResult] = []

    # --- Gates 1-4: kill switches -------------------------------------
    results.append(
        _kill_switch_gate(
            SafetyGate.GLOBAL_KILL_SWITCH,
            switches.global_engaged,
            KillSwitchScope.GLOBAL,
            None,
            switches.reason,
        )
    )
    results.append(
        _kill_switch_gate(
            SafetyGate.EXCHANGE_KILL_SWITCH,
            pre.exchange in switches.engaged_exchanges,
            KillSwitchScope.EXCHANGE,
            pre.exchange,
            switches.reason,
        )
    )
    results.append(
        _kill_switch_gate(
            SafetyGate.STRATEGY_KILL_SWITCH,
            pre.strategy_id is not None
            and pre.strategy_id in switches.engaged_strategies,
            KillSwitchScope.STRATEGY,
            pre.strategy_id,
            switches.reason,
        )
    )
    results.append(
        _kill_switch_gate(
            SafetyGate.SYMBOL_KILL_SWITCH,
            pre.symbol in switches.engaged_symbols,
            KillSwitchScope.SYMBOL,
            pre.symbol,
            switches.reason,
        )
    )

    # --- Gate 5: trading mode -----------------------------------------
    mode = settings.trading_mode
    if mode is TradingMode.DISABLED:
        results.append(
            GateResult(
                gate=SafetyGate.TRADING_MODE,
                passed=False,
                detail=(
                    "Trading is disabled. TRADING_MODE, TRADING_ENABLED and "
                    "LIVE_TRADING_CONFIRMED must agree before any order is "
                    "produced."
                ),
            )
        )
    else:
        results.append(
            GateResult(
                gate=SafetyGate.TRADING_MODE,
                passed=True,
                detail=f"Trading mode is {mode.value}.",
            )
        )

    # --- Gate 6: live-trading authorisation ---------------------------
    # Only a live, transmitting path needs this. Paper and dry-run are
    # explicitly permitted without it, which is what keeps the default
    # configuration usable while remaining incapable of moving real money.
    if pre.is_simulated or settings.dry_run or mode is not TradingMode.LIVE:
        results.append(
            GateResult(
                gate=SafetyGate.LIVE_TRADING_AUTHORISED,
                passed=True,
                applicable=False,
                detail=(
                    "Not a live transmitting path; no live-trading "
                    "authorisation required."
                ),
            )
        )
    elif settings.will_transmit_orders:
        results.append(
            GateResult(
                gate=SafetyGate.LIVE_TRADING_AUTHORISED,
                passed=True,
                detail="Live trading is explicitly authorised by configuration.",
            )
        )
    else:
        results.append(
            GateResult(
                gate=SafetyGate.LIVE_TRADING_AUTHORISED,
                passed=False,
                detail=(
                    "Live transmission was requested but LIVE_TRADING_ENABLED is "
                    "not explicitly true with DRY_RUN and PAPER_TRADING false. "
                    "An unset flag is never treated as permission."
                ),
            )
        )

    # --- Gate 7: risk engine ------------------------------------------
    risk = pre.risk_health
    if not risk.healthy:
        results.append(
            GateResult(
                gate=SafetyGate.RISK_ENGINE_HEALTHY,
                passed=False,
                detail=(
                    f"The risk engine is not healthy, so the order cannot be "
                    f"evaluated and is refused (fail-closed). {risk.detail}"
                ),
            )
        )
    elif (
        risk.age_micros is not None
        and risk.age_micros > settings.max_risk_state_age_ms * 1_000
    ):
        results.append(
            GateResult(
                gate=SafetyGate.RISK_ENGINE_HEALTHY,
                passed=False,
                detail=(
                    f"Risk state is {risk.age_micros // 1000}ms old, beyond the "
                    f"{settings.max_risk_state_age_ms}ms limit. Stale risk state "
                    f"is treated as unavailable."
                ),
            )
        )
    else:
        results.append(
            GateResult(
                gate=SafetyGate.RISK_ENGINE_HEALTHY,
                passed=True,
                detail=risk.detail,
            )
        )

    # --- Gate 8: market data ------------------------------------------
    if not pre.market_data_required:
        results.append(
            GateResult(
                gate=SafetyGate.MARKET_DATA_HEALTHY,
                passed=True,
                applicable=False,
                detail="This order does not require a reference price.",
            )
        )
    elif not pre.market_data_health.healthy:
        results.append(
            GateResult(
                gate=SafetyGate.MARKET_DATA_HEALTHY,
                passed=False,
                detail=(
                    f"Market data for {pre.symbol} is not healthy, so the order "
                    f"cannot be priced or risk-checked. "
                    f"{pre.market_data_health.detail}"
                ),
            )
        )
    else:
        results.append(
            GateResult(
                gate=SafetyGate.MARKET_DATA_HEALTHY,
                passed=True,
                detail=pre.market_data_health.detail,
            )
        )

    # --- Gate 9: credentials ------------------------------------------
    if pre.is_simulated:
        results.append(
            GateResult(
                gate=SafetyGate.CREDENTIALS_VALID,
                passed=True,
                applicable=False,
                detail="Simulated venue; no exchange credentials are used.",
            )
        )
    elif pre.credentials is None:
        results.append(
            GateResult(
                gate=SafetyGate.CREDENTIALS_VALID,
                passed=False,
                detail=(
                    "No credentials resolved for this account. The order cannot "
                    "be signed."
                ),
            )
        )
    else:
        try:
            pre.credentials.assert_safe(now_micros=now)
        except Exception as exc:  # noqa: BLE001 - message is already redacted
            results.append(
                GateResult(
                    gate=SafetyGate.CREDENTIALS_VALID,
                    passed=False,
                    detail=str(exc),
                )
            )
        else:
            results.append(
                GateResult(
                    gate=SafetyGate.CREDENTIALS_VALID,
                    passed=True,
                    detail=(
                        f"Credentials valid "
                        f"(key ****{pre.credentials.api_key_last_four})."
                    ),
                )
            )

    # --- Gate 10: exchange health -------------------------------------
    if pre.is_simulated:
        results.append(
            GateResult(
                gate=SafetyGate.EXCHANGE_HEALTHY,
                passed=True,
                applicable=False,
                detail="Simulated venue; no exchange connectivity required.",
            )
        )
    elif settings.dry_run:
        results.append(
            GateResult(
                gate=SafetyGate.EXCHANGE_HEALTHY,
                passed=True,
                applicable=False,
                detail="Dry run; the request is built but never transmitted.",
            )
        )
    elif not pre.exchange_health.healthy:
        results.append(
            GateResult(
                gate=SafetyGate.EXCHANGE_HEALTHY,
                passed=False,
                detail=(
                    f"Exchange {pre.exchange} is not healthy. "
                    f"{pre.exchange_health.detail}"
                ),
            )
        )
    else:
        results.append(
            GateResult(
                gate=SafetyGate.EXCHANGE_HEALTHY,
                passed=True,
                detail=pre.exchange_health.detail,
            )
        )

    # --- Gate 11: placement attestation (Part 16) ---------------------
    if pre.placement is None:
        results.append(
            GateResult(
                gate=SafetyGate.PLACEMENT_ATTESTED,
                passed=True,
                applicable=False,
                detail=(
                    "No placement reviewer wired; nothing was attested about "
                    "key entitlements, symbol phase or clock skew. A runtime "
                    "that transmits orders refuses to start in this state."
                ),
            )
        )
    elif pre.placement.allowed:
        results.append(
            GateResult(
                gate=SafetyGate.PLACEMENT_ATTESTED,
                passed=True,
                detail=(
                    f"{pre.placement.summary} (verdict "
                    f"{pre.placement.verdict_id})"
                ),
            )
        )
    else:
        # The guidance differs by whether the venue failed to answer or refused,
        # and it is computed outside the f-string: a conditional expression
        # nested in an f-string is 3.12 syntax, and this library supports 3.11.
        verdict = pre.placement
        advice = (
            "Re-run the review before retrying: the venue or the attestor did "
            "not answer, which is not the same as an answer of no."
            if verdict.retryable
            else "This needs an operator action at the venue; retrying returns "
            "the same answer."
        )
        results.append(
            GateResult(
                gate=SafetyGate.PLACEMENT_ATTESTED,
                passed=False,
                detail=(
                    f"{verdict.summary} Refused codes: "
                    f"{', '.join(verdict.blocking_codes) or 'none'}. {advice}"
                ),
            )
        )

    allowed = all(result.passed for result in results)
    return SafetyDecision(
        allowed=allowed,
        results=tuple(results),
        evaluated_at_micros=now,
        trading_mode=mode,
        will_transmit=settings.will_transmit_orders and not pre.is_simulated,
    )
