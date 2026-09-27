"""Decision metadata: latency accounting and the no-reuse rule.

Two promises live in this module.

**Latency is measured, never asserted.** :class:`LatencyBreakdown` is filled
from monotonic marks taken inside the gate evaluation itself. A segment that
was not measured is ``None``; the gate never publishes an estimate for a
stage it did not time. These figures describe the decision path of this
process only - they are not a performance guarantee of any kind, and they
exclude venue round-trip time because the risk gate, by design, never makes
one.

**An approval is not reusable state.** A decision is bound to the request it
answered and the snapshot version it read. ``decision_is_current`` exists so
that any future component tempted to cache verdicts runs into an explicit,
tested wall: a decision whose snapshot version is missing, or differs from
the live one, is not reusable - full stop. There is deliberately no TTL-based
"fresh enough" heuristic; the version, not a clock, is what proves the world
has not changed under the verdict.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from wlct_trading.clock import monotonic_nanos

__all__ = ["LatencyBreakdown", "LatencyStopwatch", "decision_is_current"]

#: Upper bound accepted for a latency segment. 60 seconds for a risk decision
#: is already pathological; a mark beyond it is recorded as an outage marker
#: by the caller, not as a normal sample.
MAX_MEASURED_SEGMENT_MICROS: Final[int] = 60_000_000


@dataclass(slots=True, frozen=True)
class LatencyBreakdown:
    """Microseconds spent in each stage of one gate evaluation.

    Every field is ``None`` until that stage actually ran and was measured.
    A rejected-before-exposure decision therefore has ``exposure_micros is
    None`` - an honest absence, not a zero that would drag averages down and
    make the fast rejections look like the slow approvals.
    """

    snapshot_retrieval_micros: int | None = None
    core_evaluation_micros: int | None = None
    snapshot_validation_micros: int | None = None
    freshness_micros: int | None = None
    kill_switch_micros: int | None = None
    exposure_micros: int | None = None
    rules_micros: int | None = None
    total_micros: int | None = None

    def to_dict(self) -> dict[str, int]:
        """Wire form. Unmeasured segments are absent, not zero."""
        out: dict[str, int] = {}
        for name in (
            "snapshotRetrievalMicros",
            "coreEvaluationMicros",
            "snapshotValidationMicros",
            "freshnessMicros",
            "killSwitchMicros",
            "exposureMicros",
            "rulesMicros",
            "totalMicros",
        ):
            field_name = _WIRE_TO_FIELD[name]
            value = getattr(self, field_name)
            if value is not None:
                out[name] = value
        return out


_WIRE_TO_FIELD: dict[str, str] = {
    "snapshotRetrievalMicros": "snapshot_retrieval_micros",
    "coreEvaluationMicros": "core_evaluation_micros",
    "snapshotValidationMicros": "snapshot_validation_micros",
    "freshnessMicros": "freshness_micros",
    "killSwitchMicros": "kill_switch_micros",
    "exposureMicros": "exposure_micros",
    "rulesMicros": "rules_micros",
    "totalMicros": "total_micros",
}


class LatencyStopwatch:
    """Monotonic marks collected during one evaluation.

    Deliberately not thread-safe and not shared: one stopwatch per
    evaluation, created by the gate and consumed once. Reusing it across
    evaluations would attribute one run's segment to another's.
    """

    __slots__ = ("_start_nanos", "_marks_nanos")

    def __init__(self) -> None:
        self._start_nanos = monotonic_nanos()
        self._marks_nanos: dict[str, int] = {}

    def mark(self, name: str) -> None:
        """Record the instant ``name`` completed."""
        self._marks_nanos[name] = monotonic_nanos()

    def segment_micros(self, name: str) -> int | None:
        """Microseconds between the previous mark (or start) and ``name``."""
        end = self._marks_nanos.get(name)
        if end is None:
            return None
        keys = list(self._marks_nanos)
        index = keys.index(name)
        start = self._start_nanos if index == 0 else self._marks_nanos[keys[index - 1]]
        return (end - start) // 1_000

    def elapsed_micros(self) -> int:
        """Microseconds since the stopwatch began."""
        return (monotonic_nanos() - self._start_nanos) // 1_000

    def breakdown(self) -> LatencyBreakdown:
        """Freeze the marks taken so far into the decision's latency record."""

        def segment(name: str) -> int | None:
        # A mark that was taken beyond the sanity bound is a bug in the
        # stage being measured, not a latency sample; clamp and let the
        # caller's counters surface it via the anomaly, never via a NaN.
            value = self.segment_micros(name)
            if value is None:
                return None
            return min(max(value, 0), MAX_MEASURED_SEGMENT_MICROS)

        return LatencyBreakdown(
            snapshot_retrieval_micros=segment("snapshot"),
            core_evaluation_micros=segment("core"),
            snapshot_validation_micros=segment("validation"),
            freshness_micros=segment("freshness"),
            kill_switch_micros=segment("kill_switch"),
            exposure_micros=segment("exposure"),
            rules_micros=segment("rules"),
            total_micros=min(self.elapsed_micros(), MAX_MEASURED_SEGMENT_MICROS),
        )


def decision_is_current(
    decision_snapshot_version: int | None, current_snapshot_version: int | None
) -> bool:
    """Whether a prior decision may inform a new one at all.

    Returns ``True`` only when both versions are known and equal. That is the
    whole reuse test the platform permits: the gate itself never consults
    it (it re-evaluates every request), but the API and the admin surface use
    it when presenting a "latest decision", so a displayed approval is
    provably about the state the operator's next order would be evaluated
    against - or is visibly not.
    """
    if decision_snapshot_version is None or current_snapshot_version is None:
        return False
    return decision_snapshot_version == current_snapshot_version
