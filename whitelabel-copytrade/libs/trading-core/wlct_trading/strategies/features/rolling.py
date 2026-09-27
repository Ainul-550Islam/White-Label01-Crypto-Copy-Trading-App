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
