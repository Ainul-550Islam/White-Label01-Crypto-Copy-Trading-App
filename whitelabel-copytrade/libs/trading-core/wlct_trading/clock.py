"""Monotonic clocks and latency instrumentation for the hot path.

Two different notions of time are needed and confusing them is a classic source
of nonsense metrics:

* **Wall clock** (``epoch_micros``) - comparable across machines and with
  exchange timestamps, but subject to NTP steps and therefore useless for
  measuring a duration.
* **Monotonic clock** (``monotonic_nanos``) - never steps backwards, so it is
  the only safe basis for a latency measurement, but it is meaningless as an
  absolute point in time.

Latency is always measured with the monotonic clock; timestamps that are stored
or published always use the wall clock.

No claim is made anywhere in this module about achievable latency. It measures
what actually happens; it does not promise a bound.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from types import TracebackType

__all__ = [
    "epoch_micros",
    "epoch_millis",
    "monotonic_nanos",
    "LatencySpan",
    "LatencyRecorder",
    "StageTimer",
]


def epoch_micros() -> int:
    """Wall-clock microseconds since the Unix epoch."""
    return time.time_ns() // 1_000


def epoch_millis() -> int:
    """Wall-clock milliseconds since the Unix epoch."""
    return time.time_ns() // 1_000_000


def monotonic_nanos() -> int:
    """Monotonic nanoseconds. Only ever meaningful as a difference."""
    return time.perf_counter_ns()


@dataclass(slots=True, frozen=True)
class LatencySpan:
    """A completed measurement of one pipeline stage."""

    stage: str
    duration_nanos: int

    @property
    def duration_micros(self) -> float:
        return self.duration_nanos / 1_000.0

    @property
    def duration_millis(self) -> float:
        return self.duration_nanos / 1_000_000.0


class StageTimer:
    """Context manager timing a single named stage.

    Usage::

        with recorder.stage("order_book.apply"):
            book.apply_delta(delta)
    """

    __slots__ = ("_recorder", "_stage", "_started")

    def __init__(self, recorder: "LatencyRecorder", stage: str) -> None:
        self._recorder = recorder
        self._stage = stage
        self._started = 0

    def __enter__(self) -> "StageTimer":
        self._started = monotonic_nanos()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        # The span is recorded even when the body raised: a stage that failed
        # slowly is exactly the thing worth seeing in the metrics.
        self._recorder.record(self._stage, monotonic_nanos() - self._started)


@dataclass(slots=True)
class LatencyRecorder:
    """Collects per-stage latency for one trip through the pipeline.

    Deliberately allocation-light: a plain list of spans, summarised only when
    somebody asks. Nothing here performs I/O, so it is safe to use inside the
    market-data loop.
    """

    spans: list[LatencySpan] = field(default_factory=list)

    def record(self, stage: str, duration_nanos: int) -> None:
        self.spans.append(LatencySpan(stage=stage, duration_nanos=duration_nanos))

    def stage(self, name: str) -> StageTimer:
        return StageTimer(self, name)

    @property
    def total_nanos(self) -> int:
        return sum(span.duration_nanos for span in self.spans)

    def as_micros_dict(self) -> dict[str, float]:
        """Flatten to ``{stage: microseconds}`` for structured logging.

        Repeated stages are summed rather than overwritten so that a stage
        executed in a loop reports its cumulative cost.
        """
        out: dict[str, float] = {}
        for span in self.spans:
            out[span.stage] = out.get(span.stage, 0.0) + span.duration_micros
        return out

    def reset(self) -> None:
        self.spans.clear()
