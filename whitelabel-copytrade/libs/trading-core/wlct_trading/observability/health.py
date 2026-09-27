"""Component health for the trading platform - three questions, three answers.

The distinction this module enforces
-----------------------------------
* **Liveness** - "the process is running". Never touches a dependency,
  because a process whose Redis went away is still a process, and a probe
  that says otherwise gets the node killed for someone else's outage.
* **Readiness** - "this process can safely perform *its* assigned role".
  Role-specific: an API node needs Postgres and Redis; a trading worker also
  needs risk state, feeds and an execution adapter. Readiness is *not*
  liveness with a different name, and :class:`HealthRegistry` keeps the two
  probe sets separate by construction.
* **Health** - "operational dependencies and subsystems are within expected
  state". The operator view; it may include components whose failure does not
  block either probe (a degraded backtest queue is a fact, not a reboot).

Statuses are the five documented ones. ``UNKNOWN`` is a real status, not a
euphemism for healthy: a provider that raises, times out, or has gone quiet
beyond its freshness budget reports ``UNKNOWN`` and every aggregation
treats it as the worst case it stands for.

Freshness honesty
-----------------
Every probe result carries its captured instant from the *source's* clock
domain (wall-clock micros for cross-machine comparability) and an age
computed against the caller's notion of now. A result whose captured instant
is missing is stale by definition - untimable is not fresh. No component
ever claims freshness it cannot evidence.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from wlct_trading.clock import epoch_micros

from .redaction import redact_value

__all__ = [
    "ComponentStatus",
    "ComponentHealth",
    "HealthProvider",
    "HealthRegistry",
    "worst_status",
]


class ComponentStatus(str, Enum):
    HEALTHY = "HEALTHY"
    DEGRADED = "DEGRADED"
    UNHEALTHY = "UNHEALTHY"
    STOPPED = "STOPPED"
    UNKNOWN = "UNKNOWN"


#: Aggregation order: later entry dominates earlier. ``STOPPED`` is worse
#: than ``UNKNOWN`` because a component someone turned off is expected,
#: while one nobody can speak for is the failure mode that needs eyes.
_STATUS_RANK: tuple[ComponentStatus, ...] = (
    ComponentStatus.HEALTHY,
    ComponentStatus.DEGRADED,
    ComponentStatus.UNHEALTHY,
    ComponentStatus.UNKNOWN,
    ComponentStatus.STOPPED,
)


def worst_status(statuses: tuple[ComponentStatus, ...] | list[ComponentStatus]) -> ComponentStatus:
    """The most severe status in ``statuses``; ``HEALTHY`` for the empty set.

    "Nothing reported" must not aggregate into a failure - a service that
    has no components registered yet is not an unhealthy service; it is an
    empty one, and the dashboard says so.
    """
    worst = ComponentStatus.HEALTHY
    for status in statuses:
        if _STATUS_RANK.index(status) > _STATUS_RANK.index(worst):
            worst = status
    return worst


@dataclass(frozen=True, slots=True)
class ComponentHealth:
    """One component's probe outcome, normalized.

    ``details`` is operator-facing text; it passes through the platform
    redactor here, at the boundary every health view shares, so no provider
    can leak a DSN by forgetting to. The redaction is shallow-on-purpose for
    keys that metric-style callers already sanitise; values are rebuilt.
    """

    component: str
    status: ComponentStatus
    reason: str | None = None
    latency_micros: int | None = None
    last_success_at_micros: int | None = None
    captured_at_micros: int | None = None
    details: Mapping[str, Any] = field(default_factory=dict, compare=False)

    def age_micros(self, *, now_micros: int | None = None) -> int | None:
        """Age of this observation; ``None`` when it cannot be computed.

        ``None`` means *unknown age*, which freshness checks treat as
        stale. Returning a fake 0 would be the one answer worse than honest
        silence.
        """
        if self.captured_at_micros is None:
            return None
        now = epoch_micros() if now_micros is None else now_micros
        return max(0, now - self.captured_at_micros)

    def is_fresh(self, budget_micros: int, *, now_micros: int | None = None) -> bool:
        """Whether the observation is within ``budget_micros``. Fail-closed."""
        if budget_micros <= 0:
            raise ValueError("budget must be positive")
        age = self.age_micros(now_micros=now_micros)
        return age is not None and age <= budget_micros

    def to_dict(self, *, now_micros: int | None = None) -> dict[str, Any]:
        age = self.age_micros(now_micros=now_micros)
        return {
            "component": self.component,
            "status": self.status.value,
            "reason": self.reason,
            "latencyMicros": self.latency_micros,
            "lastSuccessAtMicros": self.last_success_at_micros,
            "capturedAtMicros": self.captured_at_micros,
            "ageMicros": age,
            "details": dict(redact_value(dict(self.details)) or {}),
        }


#: A provider is a zero-argument callable returning either a fresh
#: :class:`ComponentHealth` or the pieces of one. Returning the dataclass is
#: the full-control path; the tuple form is the common one.
HealthProvider = Callable[[], "ComponentHealth | tuple[ComponentStatus, str | None]"]


@dataclass(slots=True)
class _Registered:
    name: str
    provider: HealthProvider
    freshness_budget_micros: int
    critical: bool
    readiness: bool
    last_good: ComponentHealth | None = None


class HealthRegistry:
    """Providers + evaluation, shared by liveness, readiness and /health.

    A provider that raises never propagates: the component reports
    ``UNKNOWN`` with the exception *type* only as the reason. Exception
    messages can embed connection strings; type names cannot, and an
    operator searching logs by ``ConnectionRefusedError`` still finds the
    full context in the log line the provider itself emitted.
    """

    def __init__(self) -> None:
        self._providers: dict[str, _Registered] = {}

    def register(
        self,
        name: str,
        provider: HealthProvider,
        *,
        freshness_budget_micros: int,
        critical: bool = False,
        readiness: bool = False,
    ) -> None:
        """Register one component.

        ``critical`` components gate *trading readiness* through the
        readiness module; ``readiness`` marks the process-role gates (Postgres
        for an API node, etc). They are different sets and deliberately kept
        so: a queue worker and a web node on the same platform must not
        inherit each other's readiness by accident.
        """
        if not name:
            raise ValueError("component name required")
        if name in self._providers:
            raise ValueError(f"component {name} registered twice")
        if freshness_budget_micros <= 0:
            raise ValueError("freshness budget must be positive micros")
        self._providers[name] = _Registered(
            name=name,
            provider=provider,
            freshness_budget_micros=freshness_budget_micros,
            critical=critical,
            readiness=readiness,
        )

    @property
    def components(self) -> tuple[str, ...]:
        return tuple(sorted(self._providers))

    def check_all(self, *, subset: tuple[str, ...] | None = None) -> list[ComponentHealth]:
        """Probe every (or a named subset of) registered component once.

        Sequential by design: providers are local-memory cheap (they read
        last-known state mirrors); anything slower than that should own its
        own cached prober and expose *that*, which keeps this loop free of
        awaits, threads and surprise latency during a scrape.
        """
        names = list(self._providers) if subset is None else [n for n in subset if n in self._providers]
        if subset is not None and (missing := [n for n in subset if n not in self._providers]):
            raise KeyError(f"unknown health components: {missing}")
        now = epoch_micros()
        results: list[ComponentHealth] = []
        for name in names:
            results.append(self._check_one(self._providers[name], now=now))
        return results

    def check_readiness(self) -> list[ComponentHealth]:
        """Only components registered with ``readiness=True``."""
        names = tuple(n for n, r in self._providers.items() if r.readiness)
        return self.check_all(subset=names if names else None)

    def aggregate(
        self, results: list[ComponentHealth], *, include_unknown: bool = True
    ) -> ComponentStatus:
        """Worst-status aggregation used for the overall view.

        ``include_unknown=False`` is for readiness-style decisions that only
        care about *positive* failure: even that mode treats an untimeable
        component as failure, because "can't tell" gates trading exactly like
        "broken" does.
        """
        statuses = [r.status for r in results if include_unknown or r.status is not ComponentStatus.UNKNOWN]
        worst = worst_status(tuple(statuses))
        if not statuses:
            return worst
        # A single DEGRADED among HEALTHY is DEGRADED (the operator asked),
        # and staleness beyond budget is a *downgrade*, never an upgrade.
        if worst is ComponentStatus.HEALTHY and any(
            not r.is_fresh(self._providers[r.component].freshness_budget_micros) for r in results
        ):
            return ComponentStatus.DEGRADED
        return worst

    def snapshot_dict(self, results: list[ComponentHealth]) -> dict[str, Any]:
        now = epoch_micros()
        return {
            "status": self.aggregate(results).value,
            "checkedAtMicros": now,
            "components": [r.to_dict(now_micros=now) for r in results],
        }

    def _check_one(self, entry: _Registered, *, now: int) -> ComponentHealth:
        started = time.perf_counter_ns()
        try:
            produced = entry.provider()
        except Exception as error:  # isolation is the point; see class docstring
            if entry.last_good is not None:
                # Same demote-don't-erase rule as the UNKNOWN-result path:
                # an exception is "this probe cannot speak right now", and
                # the last thing it *did* say stays on the panel, marked as
                # such. last_good is not cleared: recovery continues from the
                # last truthful observation, not from the outage's noise.
                stale = entry.last_good
                return ComponentHealth(
                    component=entry.name,
                    status=ComponentStatus.DEGRADED,
                    reason=(
                        f"provider_error:{type(error).__name__}; "
                        f"last known {stale.status.value}"
                    ),
                    latency_micros=stale.latency_micros,
                    last_success_at_micros=stale.last_success_at_micros,
                    captured_at_micros=stale.captured_at_micros,
                    details=stale.details,
                )
            return ComponentHealth(
                component=entry.name,
                status=ComponentStatus.UNKNOWN,
                reason=f"provider_error:{type(error).__name__}",
                latency_micros=(time.perf_counter_ns() - started) // 1_000,
                captured_at_micros=now,
            )

        if isinstance(produced, ComponentHealth):
            result = produced
        else:
            status, reason = produced
            result = ComponentHealth(
                component=entry.name,
                status=status,
                reason=reason,
                latency_micros=(time.perf_counter_ns() - started) // 1_000,
                captured_at_micros=now,
            )
        if result.component != entry.name:
            # A provider reporting for the wrong component is a wiring bug -
            # but a health endpoint must never fall over to a wiring bug of
            # one component: report the *registry* as UNKNOWN instead.
            return ComponentHealth(
                component=entry.name,
                status=ComponentStatus.UNKNOWN,
                reason=f"provider_mismatch:reported:{result.component}",
                latency_micros=(time.perf_counter_ns() - started) // 1_000,
                captured_at_micros=now,
            )
        if result.status is ComponentStatus.HEALTHY:
            entry.last_good = result
        elif result.status is ComponentStatus.UNKNOWN and entry.last_good is not None:
            # The provider went unable-to-say; report what we last *knew*,
            # demoted and timestamped, so the panel shows the shape of the
            # failure instead of a blank.
            stale = entry.last_good
            return ComponentHealth(
                component=entry.name,
                status=ComponentStatus.DEGRADED,
                reason=f"provider_unavailable; last known {stale.status.value}",
                latency_micros=stale.latency_micros,
                last_success_at_micros=stale.last_success_at_micros,
                captured_at_micros=stale.captured_at_micros,
                details=stale.details,
            )
        return result
