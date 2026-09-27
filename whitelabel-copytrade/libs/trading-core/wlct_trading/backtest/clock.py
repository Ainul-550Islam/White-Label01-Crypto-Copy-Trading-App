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
