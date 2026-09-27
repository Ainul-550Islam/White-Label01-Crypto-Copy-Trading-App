"""The SLO evaluator: bounded inputs in, one explicit evaluation out.

Everything this function family promises, in the order operators care:

1. **Reproducibility.** Pure function of (definition, observations,
   evaluated_at_micros). No clocks read internally, no I/O, no environment.
   The committed fixture is generated here and replayed by the TypeScript
   twin, so what the API panel shows is what this code computes.
2. **Insufficient data is a state, never a zero.** ``data_complete=False``,
   or a total-events window with no samples, yields ``SloState.UNKNOWN``
   with a reason that says which. A freshness indicator whose collector
   never ran is NOT "0 ms stale".
3. **UNKNOWN does not silence alerts, and does not fire them either.** It
   is neither HEALTHY (no recovery implied) nor a burn breach (no evidence
   of one). Callers keep the last evidenced alert state; this module just
   refuses to fabricate either side.
4. **Freshness indicators are reduced upstream.** Collectors convert ages
   into good/bad sample counts against ``max_age_micros`` (the shape all
   indicators share); the evaluator never sees timestamps it would have to
   subtract, because a subtraction here would be a second, drift-prone copy
   of age logic that already lives in the health model.

State resolution order for an evidenced window (first match wins):

    EXHAUSTED  budget_total > 0 and budget_remaining == 0 and bad > 0
    CRITICAL   burn_ppm >= critical_burn_ppm
    WARNING    burn_ppm >= warning_burn_ppm
    HEALTHY    otherwise (evidenced: total > 0)
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .budget import ErrorBudget, compute_budget, validate_counts
from .burn import BurnAlertState, evaluate_burn
from .model import SloDefinition, SloState, slo_checksum

__all__ = ["SloWindowSample", "SloEvaluation", "evaluate_slo"]


@dataclass(frozen=True, slots=True)
class SloWindowSample:
    """One window's worth of counted evidence.

    ``data_complete`` is the collector's assertion that it saw EVERY relevant
    source for the whole window (probe alive, counter deltas sane, publisher
    mirrors present). It defaults to False on purpose: completeness is a
    claim the input must make, not a courtesy the evaluator assumes.
    """

    good: int = 0
    bad: int = 0
    data_complete: bool = False
    note: str | None = None

    def counts(self) -> tuple[int, int, int]:
        return validate_counts(good=self.good, bad=self.bad)


@dataclass(frozen=True, slots=True)
class SloEvaluation:
    """The complete, persistable result of one evaluation tick.

    Defaults encode the unevaluated truth: UNKNOWN, nothing evidenced.
    Callers override fields; they cannot forget to clear a default into a
    lie, because every default is the conservative value.
    """

    slo_id: str
    version: int
    checksum: str
    indicator: str
    service: str
    evaluated_at_micros: int
    window_minutes: int
    short_window_minutes: int
    target_ppm: int
    state: SloState = SloState.UNKNOWN
    actual_ppm: int | None = None
    budget_total_events: int = 0
    budget_consumed_events: int = 0
    budget_remaining_events: int = 0
    remaining_ratio_ppm: int | None = None
    long_burn_ppm: int | None = None
    short_burn_ppm: int | None = None
    alert_kind: str = "none"
    samples_good: int = 0
    samples_bad: int = 0
    data_complete: bool = False
    reason: str | None = None

    @property
    def evidences_health(self) -> bool:
        return self.data_complete and self.state is not SloState.UNKNOWN

    def to_dict(self) -> dict[str, Any]:
        return {
            "sloId": self.slo_id,
            "version": self.version,
            "checksum": self.checksum,
            "indicator": self.indicator,
            "service": self.service,
            "state": self.state.value,
            "evaluatedAtMicros": str(self.evaluated_at_micros),
            "windowMinutes": self.window_minutes,
            "shortWindowMinutes": self.short_window_minutes,
            "targetPpm": self.target_ppm,
            "actualPpm": self.actual_ppm,
            "budgetTotalEvents": self.budget_total_events,
            "budgetConsumedEvents": self.budget_consumed_events,
            "budgetRemainingEvents": self.budget_remaining_events,
            "remainingRatioPpm": self.remaining_ratio_ppm,
            "longBurnPpm": self.long_burn_ppm,
            "shortBurnPpm": self.short_burn_ppm,
            "alertKind": self.alert_kind,
            "samplesGood": self.samples_good,
            "samplesBad": self.samples_bad,
            "dataComplete": self.data_complete,
            "reason": self.reason,
        }


def evaluate_slo(
    definition: SloDefinition,
    *,
    long_window: SloWindowSample,
    short_window: SloWindowSample,
    evaluated_at_micros: int,
    fast_multiplier_ppm: int = 14_400_000,
    slow_multiplier_ppm: int = 6_000_000,
) -> SloEvaluation:
    """One deterministic evaluation. See module docstring for the rules."""
    target_ppm = compute_budget(objective=definition.objective, good=0, bad=0).objective_ppm
    checksum = slo_checksum(definition)

    long_budget: ErrorBudget = compute_budget(
        objective=definition.objective, good=long_window.good, bad=long_window.bad
    )
    short_budget: ErrorBudget = compute_budget(
        objective=definition.objective, good=short_window.good, bad=short_window.bad
    )

    complete = long_window.data_complete and short_window.data_complete
    if not complete:
        reasons: list[str] = []
        if not long_window.data_complete:
            reasons.append("long-window collector incomplete")
        if not short_window.data_complete:
            reasons.append("short-window collector incomplete")
        if long_window.note is not None:
            reasons.append(f"long: {long_window.note}")
        return SloEvaluation(
            slo_id=definition.slo_id,
            version=definition.version,
            checksum=checksum,
            indicator=definition.indicator.value,
            service=definition.service,
            evaluated_at_micros=evaluated_at_micros,
            window_minutes=definition.window_minutes,
            short_window_minutes=definition.short_window_minutes,
            target_ppm=target_ppm,
            samples_good=long_window.good,
            samples_bad=long_window.bad,
            reason="; ".join(reasons),
        )

    if long_budget.total_events == 0:
        return SloEvaluation(
            slo_id=definition.slo_id,
            version=definition.version,
            checksum=checksum,
            indicator=definition.indicator.value,
            service=definition.service,
            evaluated_at_micros=evaluated_at_micros,
            window_minutes=definition.window_minutes,
            short_window_minutes=definition.short_window_minutes,
            target_ppm=target_ppm,
            data_complete=True,
            reason="no samples in the evaluation window; absence of failures is not evidence of success",
        )

    alert: BurnAlertState = evaluate_burn(
        short_burn_ppm=short_budget.burn_ppm,
        long_burn_ppm=long_budget.burn_ppm,
        fast_multiplier_ppm=fast_multiplier_ppm,
        slow_multiplier_ppm=slow_multiplier_ppm,
    )

    state = _resolve_state(definition=definition, budget=long_budget)
    return SloEvaluation(
        slo_id=definition.slo_id,
        version=definition.version,
        checksum=checksum,
        indicator=definition.indicator.value,
        service=definition.service,
        evaluated_at_micros=evaluated_at_micros,
        window_minutes=definition.window_minutes,
        short_window_minutes=definition.short_window_minutes,
        target_ppm=target_ppm,
        state=state,
        actual_ppm=long_budget.compliance_ppm,
        budget_total_events=long_budget.budget_total_events,
        budget_consumed_events=long_budget.budget_consumed_events,
        budget_remaining_events=long_budget.budget_remaining_events,
        remaining_ratio_ppm=long_budget.remaining_ratio_ppm,
        long_burn_ppm=long_budget.burn_ppm,
        short_burn_ppm=short_budget.burn_ppm,
        alert_kind=alert.kind,
        samples_good=long_budget.good_events,
        samples_bad=long_budget.bad_events,
        data_complete=True,
        reason=_state_reason(state, long_budget, short_budget, alert),
    )


def _resolve_state(*, definition: SloDefinition, budget: ErrorBudget) -> SloState:
    if budget.budget_total_events > 0 and budget.budget_remaining_events == 0 and budget.bad_events > 0:
        return SloState.EXHAUSTED
    if budget.burn_ppm is not None and budget.burn_ppm >= definition.critical_burn_ppm:
        return SloState.CRITICAL
    if budget.burn_ppm is not None and budget.burn_ppm >= definition.warning_burn_ppm:
        return SloState.WARNING
    if budget.has_samples:
        return SloState.HEALTHY
    return SloState.UNKNOWN


def _state_reason(
    state: SloState, long_budget: ErrorBudget, short_budget: ErrorBudget, alert: BurnAlertState
) -> str:
    if alert.alerting:
        return (
            f"burn-rate alert ({alert.kind}): short {short_budget.burn_ppm}ppm / "
            f"long {long_budget.burn_ppm}ppm against fast {alert.fast_threshold_ppm}ppm"
        )
    if state is SloState.EXHAUSTED:
        return f"error budget exhausted at {long_budget.failure_ppm}ppm failure"
    if state is SloState.CRITICAL:
        return f"burn {long_budget.burn_ppm}ppm at or beyond the critical threshold"
    if state is SloState.WARNING:
        return f"burn {long_budget.burn_ppm}ppm at or beyond the warning threshold"
    return f"compliance {long_budget.compliance_ppm}ppm against target {long_budget.objective_ppm}ppm"
