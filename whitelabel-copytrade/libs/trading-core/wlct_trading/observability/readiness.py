"""Trading readiness: a verdict distinct from "the web server answers".

The rule this module encodes
---------------------------
*API readiness never implies trading readiness.* A web node that can serve
the admin console tells you nothing about whether market data is flowing,
whether risk state is current, or whether a kill switch is holding the
account. This module consumes *the trading plane's own evidence* - the
health of the components an order actually depends on - and derives one
boolean with a reason for every gate.

Fail-closed, three ways:

1. A gate whose evidence is missing or unparseable is **not satisfied**.
   ``None`` is not "probably fine"; it is "nobody can say", and nobody can
   say is enough to withhold trading.
2. A gate that was satisfied but whose evidence is *stale* (beyond the
   supplied budget) flips to not-satisfied by ``freshness`` arithmetic, not
   by anyone having noticed.
3. Adding a gate is an edit to :data:`TRADING_GATES`; the evaluator iterates
   the declared list, so "forgot to check the new thing" is structurally
   impossible - the only way a gate is skipped is by deleting its entry.

And one non-rule, stated so nobody misreads the code: this verdict is
*observability*. Enforcement lives and stays in the risk gate (Part 8); a
stale dashboard saying "ready" does not let an order through, exactly as a
blank saying "not ready" does not stop one. Turning health into a trading
authorisation would put a second, weaker gate in front of a stronger one.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from wlct_trading.clock import epoch_micros

__all__ = [
    "GateEvidence",
    "GateVerdict",
    "TRADING_GATES",
    "TradingReadinessVerdict",
    "evaluate_trading_readiness",
]


@dataclass(frozen=True, slots=True)
class GateEvidence:
    """What a probe reports about one gate, at one instant.

    ``value`` is tri-state: ``True``/``False`` are observed facts, ``None``
    is "no evidence" - a provider that could not answer, a feed that has
    gone silent, a counter nobody refreshed. The verdict treats ``None``
    and ``False`` identically; it does *not* treat their reasons identically,
    because an operator reading "market_data: unknown (no observation)" takes
    different action from one reading "market_data: false (stale 41s)".
    """

    value: bool | None
    age_micros: int | None = None
    freshness_budget_micros: int | None = None
    detail: str | None = None

    @property
    def is_stale(self) -> bool:
        """Stale iff an age is known, a budget is known, and age > budget.

        A missing age is *unknown*, not fresh and not stale: the tri-state
        of ``value`` carries the absence, so ``is_stale`` refuses to invent a
        second way to say it.
        """
        if self.age_micros is None or self.freshness_budget_micros is None:
            return False
        return self.age_micros > self.freshness_budget_micros


@dataclass(frozen=True, slots=True)
class TradingGate:
    """One declared readiness gate."""

    name: str
    description: str
    #: A gate that can block trading on its own, versus one whose failure is
    #: surfaced loudly (reason, alert candidate) but is policy-optional -
    #: e.g. reconciliation freshness beyond its own budget degrades trading
    #: readiness only while it is declared critical.
    critical: bool = True


#: The declared gate set, in display order. Names are wire-visible (admin
#: panel, metrics, fixtures) - treat as API surface. The set mirrors the
#: Part 9 specification exactly; each name maps to an evidence key in the
#: input mapping of :func:`evaluate_trading_readiness`.
TRADING_GATES: tuple[TradingGate, ...] = (
    TradingGate("market_data", "Live market-data feeds are connected and within the staleness budget."),
    TradingGate("risk_engine", "The risk engine is enabled and answering (fail-closed gate alive)."),
    TradingGate(
        "risk_state_fresh",
        "Every account's hot risk snapshot is within MAX_RISK_STATE_AGE_MS of now.",
    ),
    TradingGate("exchange_connectivity", "Venue connectivity for enabled exchanges is established."),
    TradingGate("execution_adapter", "The execution adapter is initialised and healthy."),
    TradingGate(
        "reconciliation",
        "Reconciliation is running and its last pass reported no open discrepancy.",
    ),
    TradingGate(
        "queues",
        "Required queues are reachable and below their backlog/oldest-age thresholds.",
    ),
    TradingGate(
        "kill_switches",
        "No engaged kill switch or protection blocks the trading path.",
    ),
    TradingGate(
        "configuration",
        "The running configuration parsed, matches the required schema, and is consistent.",
    ),
)


@dataclass(frozen=True, slots=True)
class GateVerdict:
    name: str
    satisfied: bool
    critical: bool
    reason: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "gate": self.name,
            "satisfied": self.satisfied,
            "critical": self.critical,
            "reason": self.reason,
        }


@dataclass(frozen=True, slots=True)
class TradingReadinessVerdict:
    """The result of one evaluation; immutable snapshot of one instant."""

    ready: bool
    gates: tuple[GateVerdict, ...]
    evaluated_at_micros: int

    @property
    def blocking_gates(self) -> tuple[str, ...]:
        return tuple(g.name for g in self.gates if not g.satisfied)

    def reasons(self) -> dict[str, str]:
        return {g.name: g.reason for g in self.gates if not g.satisfied}

    def to_dict(self) -> dict[str, Any]:
        return {
            "tradingReady": self.ready,
            "evaluatedAtMicros": self.evaluated_at_micros,
            "blockingGates": list(self.blocking_gates),
            "gates": [g.to_dict() for g in self.gates],
            "note": (
                "This verdict is an operational signal. Enforcement of "
                "trading safety is the risk gate's job and lives elsewhere."
            ),
        }


def evaluate_trading_readiness(
    evidence: Mapping[str, GateEvidence],
    *,
    now_micros: int | None = None,
) -> TradingReadinessVerdict:
    """Derive the verdict from caller-supplied evidence.

    Keys of ``evidence`` not naming a declared gate are a programming error
    (typo = silent no-op is unacceptable here) and raise. A declared gate
    with no evidence is *not* an error - that is precisely the "no evidence"
    state - and resolves to unsatisfied with reason ``"unknown"``.
    """
    declared = {gate.name for gate in TRADING_GATES}
    unknown_keys = sorted(set(evidence) - declared)
    if unknown_keys:
        raise KeyError(
            f"evidence for undeclared gate(s): {unknown_keys}; "
            "add the gate to TRADING_GATES first, in code, with a description"
        )

    now = epoch_micros() if now_micros is None else now_micros
    verdicts: list[GateVerdict] = []
    ready = True
    for gate in TRADING_GATES:
        entry = evidence.get(gate.name)
        if entry is None:
            satisfied, reason = False, "unknown (no evidence supplied)"
        elif entry.value is None:
            satisfied, reason = (
                False,
                entry.detail or "unknown (provider could not answer)",
            )
        elif entry.is_stale:
            age_s = (entry.age_micros or 0) // 1_000_000
            satisfied, reason = False, f"stale (last observation {age_s}s ago)"
        elif entry.value:
            satisfied, reason = True, entry.detail or "ok"
        else:
            satisfied, reason = False, entry.detail or "reported false"
        verdicts.append(
            GateVerdict(name=gate.name, satisfied=satisfied, critical=gate.critical, reason=reason)
        )
        if not satisfied and gate.critical:
            ready = False
    return TradingReadinessVerdict(ready=ready, gates=tuple(verdicts), evaluated_at_micros=now)
