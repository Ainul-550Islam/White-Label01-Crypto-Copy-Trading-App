"""Failure injection for reliability testing - deliberately tiny and blunt.

The rule this whole module is built around, up front: **a fault injector must
not become a feature flag for the trading path.** There is therefore nothing
here that can suppress a risk check, flip a kill switch, approve an order or
force a transmission - not under another name, not by convention. The point
names below are a CLOSED, named universe of *observability-side* failures
plus the environmental conditions (outages, delays) the platform's health
and readiness layers already report. A test drives one of those, asserts the
operational system noticed correctly, and stops. Anything broader is chaos
engineering, which this repository's roadmap explicitly still lists as open
work; calling this file "chaos" would be marketing.

Construction-time enablement is part of the design: ``FailureInjector`` has
no method that turns it on. The boolean arrives from validated
configuration (production boot refuses `enabled=True` while
`FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY` is at its default), so the
runtime surface is read-only. If a test needs to "inject", it constructs a
new injector - the awkwardness is the point; production code should not find
this ergonomically mutable.

Determinism: consumption of one-shot faults is a pure counter sequence. Same
construction, same sequence of calls, same outcomes - which is what lets
failure-injection tests live next to the fixture-pinned parity tests rather
than being timing races.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Mapping

__all__ = [
    "FAULT_POINTS",
    "FaultSpec",
    "FailureInjector",
    "disabled_injector",
]

#: The complete universe of injectable failure points. Each name says who
#: observes it; the "simulated" suffix marks the ones that only skew
#: *observed* values (health inputs, ages) and never touch the systems being
#: observed at all. Adding a point means adding a line here, a test, and a
#: reason the trading path cannot key off it - in that order.
FAULT_POINTS: frozenset[str] = frozenset(
    {
        # Telemetry shipping can fail; trading must not notice.
        "metrics_export_unavailable",
        "trace_export_unavailable",
        # Environmental outages, reported through the health model.
        "redis_health_probe_unavailable",
        "postgres_health_probe_unavailable",
        # Queue behaviour, observed (delay/failure of the SAMPLED job flow in
        # test harnesses; never a lever on a real queue).
        "queue_observed_delay",
        "queue_observed_failure",
        # Freshness conditions the health/readiness layers already surface.
        "market_data_stale_simulated",
        "risk_snapshot_stale_simulated",
        "reconciliation_delay_simulated",
        # The alert store itself failing to persist must be visible as
        # exactly that, not mistaken for "no alerts".
        "alert_persistence_failure",
    }
)


@dataclass(frozen=True, slots=True)
class FaultSpec:
    """One point's activation plan.

    ``times``: how many consumptions fire before auto-clearing (1 = one-shot;
    -1 = every call while enabled). ``delay_ms``: an OBSERVED-latency value a
    test harness adds to its own measurements - this module does not sleep,
    does not thread, and does not import time for that purpose, because a
    sleeping injector in a shared library is how CI becomes a candle.
    """

    enabled: bool = True
    times: int = -1
    delay_ms: int = 0

    def __post_init__(self) -> None:
        if self.times not in (-1, 0) and self.times < 1:
            raise ValueError("times must be >=1, or -1 for persistent")
        if self.delay_ms < 0 or self.delay_ms > 600_000:
            raise ValueError("delay_ms is bounded to [0, 600000]")


@dataclass(slots=True)
class FailureInjector:
    """Read-only view of configured faults plus deterministic counters."""

    _enabled: bool
    _specs: Mapping[str, FaultSpec] = field(default_factory=lambda: MappingProxyType({}))
    _fired: dict[str, int] = field(default_factory=dict, repr=False)

    def __post_init__(self) -> None:
        unknown = set(self._specs) - FAULT_POINTS
        if unknown:
            raise ValueError(
                f"unknown fault points {sorted(unknown)}; the universe is closed by design"
            )
        # Freeze the mapping so no holder can mutate an injected plan later.
        self._specs = MappingProxyType(dict(self._specs))

    @classmethod
    def from_settings(
        cls,
        *,
        enabled: bool,
        specs: Mapping[str, FaultSpec] | None = None,
    ) -> "FailureInjector":
        return cls(_enabled=enabled, _specs=dict(specs or {}))

    @property
    def enabled(self) -> bool:
        return self._enabled

    def active_points(self) -> tuple[str, ...]:
        if not self._enabled:
            return ()
        return tuple(sorted(name for name, spec in self._specs.items() if spec.enabled))

    def describe(self) -> dict[str, object]:
        """For health-document details: what is armed, never how to arm it."""
        return {
            "enabled": self._enabled,
            "active_points": list(self.active_points()),
            "fired_totals": dict(sorted(self._fired.items())),
        }

    def is_armed(self, point: str) -> bool:
        """Stateless check: armed right now (does not consume)."""
        if not self._enabled:
            return False
        spec = self._specs.get(point)
        if spec is None or not spec.enabled:
            return False
        if spec.times == -1:
            return True
        return self._fired.get(point, 0) < spec.times

    def consume(self, point: str) -> bool:
        """One-shot consumption: returns True while the plan has shots left.

        Unknown names return False rather than raising - call sites are
        exporters and probes, and a typo in a fault name must not become a
        crash path in production code that (correctly) constructed a disabled
        injector. Construction validated the closed set; runtime stays blunt.
        """
        if not self._enabled:
            return False
        spec = self._specs.get(point)
        if spec is None or not spec.enabled:
            return False
        fired = self._fired.get(point, 0)
        if spec.times != -1 and fired >= spec.times:
            return False
        self._fired[point] = fired + 1
        return True

    def observed_delay_ms(self, point: str) -> int:
        """The delay a harness should ADD to its own observed numbers while
        the point is armed. Returns 0 when disabled - callers do not need to
        branch, which is the whole reason they can use this at all."""
        if not self.is_armed(point):
            return 0
        spec = self._specs.get(point)
        return spec.delay_ms if spec is not None else 0


def disabled_injector() -> FailureInjector:
    """The constant all production-wired components should hold when the
    feature is off: enabled=False, no specs, every method a cheap no."""
    return FailureInjector(_enabled=False)
