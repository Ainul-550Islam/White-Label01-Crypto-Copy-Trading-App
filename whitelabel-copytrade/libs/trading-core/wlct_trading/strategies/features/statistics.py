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
