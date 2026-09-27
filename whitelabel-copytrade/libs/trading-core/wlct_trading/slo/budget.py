"""Error-budget arithmetic: integers only, honesty enforced at the edges.

The formulas, stated so a reviewer can check them against a spreadsheet:

    allowed_ppm        = 1_000_000 - objective_ppm            (e.g. 5000 for 99.5)
    failure_ppm        = floor(bad * 1_000_000 / total)       (total > 0)
    compliance_ppm     = 1_000_000 - failure_ppm               (reported actual)
    budget_total       = floor(total * allowed_ppm / 1_000_000)   (events you may fail)
    budget_consumed    = bad
    budget_remaining   = max(0, budget_total - budget_consumed)
    burn_ppm           = floor(failure_ppm * 1_000_000 / allowed_ppm)
                         (allowed_ppm > 0; for allowed_ppm == 0 - unreachable
                          with objectives < 100 - burn is defined as +inf via
                          None + `budget_zero` flag; the evaluator treats any
                          bad event as CRITICAL when the allowance is zero)
    remaining_ratio_ppm= floor(budget_remaining * 1_000_000 / budget_total)
                         (budget_total > 0, else 0)

All divisions are FLOOR integer divisions. Python and TypeScript agree on the
floor of positive rationals, which is everything here (inputs are validated
non-negative); no rounding mode, no float, no drift. The committed fixture's
tables are generated from this module and replayed by the TS twin - that is
the contract, not a suggestion.
"""

from __future__ import annotations

from dataclasses import dataclass

from .model import objective_to_ppm

__all__ = ["ErrorBudget", "compute_budget", "validate_counts"]

_MILLION = 1_000_000


def validate_counts(*, good: int, bad: int) -> tuple[int, int, int]:
    """Shared input gate: non-negative integers, total is their sum.

    Raises on negatives because a source that emits ``bad=-1`` is a broken
    collector, and silently clamping it would be the evaluator lying about
    its input instead of reporting it.
    """
    if not isinstance(good, int) or not isinstance(bad, int):
        raise TypeError("good/bad must be integers")
    if good < 0 or bad < 0:
        raise ValueError("good/bad counts must be non-negative")
    return good, bad, good + bad


@dataclass(frozen=True, slots=True)
class ErrorBudget:
    """One window's budget view. Every ppm field is an integer; None means
    the quantity is undefined for this window (no samples), never zero."""

    objective_ppm: int
    allowed_ppm: int
    total_events: int
    good_events: int
    bad_events: int
    failure_ppm: int | None
    compliance_ppm: int | None
    budget_total_events: int
    budget_consumed_events: int
    budget_remaining_events: int
    remaining_ratio_ppm: int | None
    burn_ppm: int | None
    budget_zero: bool

    @property
    def has_samples(self) -> bool:
        return self.total_events > 0

    def to_dict(self) -> dict[str, object]:
        return {
            "objectivePpm": self.objective_ppm,
            "allowedPpm": self.allowed_ppm,
            "totalEvents": self.total_events,
            "goodEvents": self.good_events,
            "badEvents": self.bad_events,
            "failurePpm": self.failure_ppm,
            "compliancePpm": self.compliance_ppm,
            "budgetTotalEvents": self.budget_total_events,
            "budgetConsumedEvents": self.budget_consumed_events,
            "budgetRemainingEvents": self.budget_remaining_events,
            "remainingRatioPpm": self.remaining_ratio_ppm,
            "burnPpm": self.burn_ppm,
            "budgetZero": self.budget_zero,
        }


def compute_budget(
    *,
    objective: str,
    good: int,
    bad: int,
) -> ErrorBudget:
    """Pure window-budget computation from integer event counts.

    ``total == 0`` yields an all-None budget: NOT healthy, NOT exhausted,
    just unevidenced. The caller decides what UNKNOWN means for state; this
    function never invents a number to soften it.
    """
    objective_ppm = objective_to_ppm(objective)
    allowed_ppm = _MILLION - objective_ppm
    good, bad, total = validate_counts(good=good, bad=bad)

    if total == 0:
        return ErrorBudget(
            objective_ppm=objective_ppm,
            allowed_ppm=allowed_ppm,
            total_events=0,
            good_events=0,
            bad_events=0,
            failure_ppm=None,
            compliance_ppm=None,
            budget_total_events=0,
            budget_consumed_events=0,
            budget_remaining_events=0,
            remaining_ratio_ppm=None,
            burn_ppm=None,
            # No events, therefore no exhaustion claim: "zero budget
            # consumed to zero effect" is not a state of failure.
            budget_zero=False,
        )

    failure_ppm = (bad * _MILLION) // total
    compliance_ppm = _MILLION - failure_ppm
    budget_total = (total * allowed_ppm) // _MILLION
    consumed = min(bad, budget_total)
    remaining = max(0, budget_total - bad)
    remaining_ratio = (remaining * _MILLION) // budget_total if budget_total > 0 else 0
    if allowed_ppm > 0:
        burn_ppm = (failure_ppm * _MILLION) // allowed_ppm
        # "Budget zero" is the EXHAUSTED witness for consumers that only
        # read the budget row (the alert engine's SLO_BUDGET_EXHAUSTED
        # observation): remaining hit zero while bad events proved the burn.
        # An objective of exactly 100 can never legally reach here, which is
        # why the else-branch below is dead-but-defined rather than absent.
        budget_zero = budget_total > 0 and remaining == 0 and bad > 0
    else:
        # Unreachable while objective < 100 is enforced upstream; kept
        # defined rather than absent so a future model change fails loudly
        # here instead of dividing by zero in a call site.
        burn_ppm = None
        budget_zero = True
    return ErrorBudget(
        objective_ppm=objective_ppm,
        allowed_ppm=allowed_ppm,
        total_events=total,
        good_events=good,
        bad_events=bad,
        failure_ppm=failure_ppm,
        compliance_ppm=compliance_ppm,
        budget_total_events=budget_total,
        budget_consumed_events=consumed,
        budget_remaining_events=remaining,
        remaining_ratio_ppm=remaining_ratio,
        burn_ppm=burn_ppm,
        budget_zero=budget_zero,
    )
