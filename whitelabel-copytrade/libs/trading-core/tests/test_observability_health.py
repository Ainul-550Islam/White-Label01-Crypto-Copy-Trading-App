"""Health model: statuses, freshness, provider isolation, readiness sets.

The failure modes probed here are the ones that make operators trust the
wrong thing: an UNKNOWN that aggregates as healthy, a missing timestamp that
counts as fresh, a raising provider that takes the whole health endpoint
down with it.
"""

from __future__ import annotations

import pytest

from wlct_trading.clock import epoch_micros
from wlct_trading.observability.health import (
    ComponentHealth,
    ComponentStatus,
    HealthRegistry,
    worst_status,
)

NOW = 1_700_000_000_000_000  # fixed micros for deterministic ages


def make(
    status: ComponentStatus,
    *,
    name: str = "comp",
    reason: str | None = None,
    captured: int | None = NOW,
) -> ComponentHealth:
    return ComponentHealth(
        component=name, status=status, reason=reason, captured_at_micros=captured
    )


def test_worst_status_ordering() -> None:
    assert worst_status(()) is ComponentStatus.HEALTHY
    assert worst_status([ComponentStatus.HEALTHY, ComponentStatus.DEGRADED]) is ComponentStatus.DEGRADED
    assert worst_status([ComponentStatus.UNKNOWN, ComponentStatus.UNHEALTHY]) is ComponentStatus.UNKNOWN
    assert worst_status([ComponentStatus.STOPPED, ComponentStatus.UNKNOWN]) is ComponentStatus.STOPPED
    assert (
        worst_status([ComponentStatus.HEALTHY, ComponentStatus.UNHEALTHY, ComponentStatus.DEGRADED])
        is ComponentStatus.UNHEALTHY
    )


def test_freshness_fail_closed_on_missing_timestamp() -> None:
    untimeable = make(ComponentStatus.HEALTHY, captured=None)
    assert untimeable.age_micros(now_micros=NOW) is None
    assert not untimeable.is_fresh(60_000_000, now_micros=NOW)


def test_freshness_boundary_inclusive() -> None:
    edge = make(ComponentStatus.HEALTHY, captured=NOW - 60_000_000)
    assert edge.is_fresh(60_000_000, now_micros=NOW)
    assert not edge.is_fresh(59_999_999, now_micros=NOW)
    with pytest.raises(ValueError, match="budget must be positive"):
        edge.is_fresh(0, now_micros=NOW)


def test_to_dict_details_are_redacted_at_the_boundary() -> None:
    health = ComponentHealth(
        component="postgres",
        status=ComponentStatus.DEGRADED,
        details={"dsn": "postgresql://u:p@h:5432/db", "pool": {"inUse": 3}},
    )
    payload = health.to_dict(now_micros=NOW)
    assert payload["details"]["dsn"] == "[REDACTED]"
    assert "postgresql" not in str(payload)
    assert payload["details"]["pool"] == {"inUse": 3}


def test_provider_error_becomes_unknown_not_outage_of_the_endpoint() -> None:
    registry = HealthRegistry()

    def explode() -> ComponentHealth:
        msg = "connection refused for postgresql://secret-user:hunter2@db:5432/app"
        raise RuntimeError(msg)

    registry.register("db", explode, freshness_budget_micros=1_000)
    (result,) = registry.check_all()
    assert result.status is ComponentStatus.UNKNOWN
    # Only the exception TYPE is surfaced - the message with credentials in
    # it must not reach the health view.
    assert result.reason == "provider_error:RuntimeError"
    assert "hunter2" not in repr(result.to_dict())


def test_last_known_state_is_demed_not_erased() -> None:
    registry = HealthRegistry()
    state = {"raise": False}

    def provider() -> tuple[ComponentStatus, str | None]:
        if state["raise"]:
            raise TimeoutError("probe timed out")
        return ComponentStatus.HEALTHY, "ping ok"

    registry.register("feed", provider, freshness_budget_micros=10_000_000_000)
    (good,) = registry.check_all()
    assert good.status is ComponentStatus.HEALTHY

    state["raise"] = True
    (degraded,) = registry.check_all()
    assert degraded.status is ComponentStatus.DEGRADED
    assert "last known HEALTHY" in (degraded.reason or "")
    assert "provider_error:TimeoutError" in (degraded.reason or "")


def test_provider_component_name_mismatch_is_fatal_to_the_registration() -> None:
    registry = HealthRegistry()
    registry.register(
        "registered_name",
        lambda: ComponentHealth(component="other_name", status=ComponentStatus.HEALTHY),
        freshness_budget_micros=1_000,
    )
    # A mislabelled provider cannot impersonate another component; the
    # mismatch surfaces as the registry-level error it is, without the
    # endpoint falling over.
    (result,) = registry.check_all()
    assert result.status is ComponentStatus.UNKNOWN
    assert result.reason == "provider_mismatch:reported:other_name"


def test_tuple_provider_shape_and_reason_passthrough() -> None:
    registry = HealthRegistry()
    registry.register("redis", lambda: (ComponentStatus.DEGRADED, "high latency"), freshness_budget_micros=5_000)
    (result,) = registry.check_all()
    assert result.status is ComponentStatus.DEGRADED
    assert result.reason == "high latency"
    assert result.captured_at_micros is not None


def test_duplicate_and_unknown_registration_errors() -> None:
    registry = HealthRegistry()
    registry.register("x", lambda: (ComponentStatus.HEALTHY, None), freshness_budget_micros=1_000)
    with pytest.raises(ValueError, match="registered twice"):
        registry.register("x", lambda: (ComponentStatus.HEALTHY, None), freshness_budget_micros=1_000)
    with pytest.raises(ValueError, match="freshness budget"):
        registry.register("y", lambda: (ComponentStatus.HEALTHY, None), freshness_budget_micros=0)
    with pytest.raises(KeyError, match="unknown health components"):
        registry.check_all(subset=("nope",))


def test_readiness_subset_only_returns_ready_gated_components() -> None:
    registry = HealthRegistry()
    registry.register("pg", lambda: (ComponentStatus.HEALTHY, None), freshness_budget_micros=1_000, readiness=True)
    registry.register("deep", lambda: (ComponentStatus.UNHEALTHY, None), freshness_budget_micros=1_000)
    results = registry.check_readiness()
    assert [r.component for r in results] == ["pg"]


def test_aggregate_downgrades_on_staleness_without_inventing_failure() -> None:
    registry = HealthRegistry()
    registry.register(
        "cache",
        lambda: ComponentHealth(
            component="cache",
            status=ComponentStatus.HEALTHY,
            captured_at_micros=epoch_micros() - 10_000_000_000,
        ),
        freshness_budget_micros=1_000_000,
    )
    results = registry.check_all()
    assert registry.aggregate(results) is ComponentStatus.DEGRADED
