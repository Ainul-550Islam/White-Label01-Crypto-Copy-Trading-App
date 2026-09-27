"""Alert engine: dedupe against storms, explicit transitions, honest counts.

The storm test is the headline: ten thousand identical failures must produce
one record with occurrences=10_000, never ten thousand records - and the
count, first-seen and last-seen must all remain observable on that one
record, because "one alert" that hides its magnitude is how alert fatigue
gets designed in from the other direction.
"""

from __future__ import annotations

import pytest

from wlct_trading.observability.alerts import (
    ALERT_RULES,
    AlertEngine,
    AlertObservation,
    AlertRecord,
    AlertSeverity,
    AlertState,
    rule_for,
)

T0 = 1_700_000_000_000_000


def obs(
    rule_id: str = "MARKET_DATA_STALE",
    *,
    component: str = "market-data",
    scope: str | None = "binance/BTCUSDT",
    at_micros: int | None = T0,
    message: str | None = "no messages for 4.1s",
    observed_value: str | None = "4_100_000",
    threshold_value: str | None = "2_000_000",
    links: dict[str, str] | None = None,
) -> AlertObservation:
    return AlertObservation(
        rule_id=rule_id,
        component=component,
        scope=scope,
        at_micros=at_micros,
        message=message,
        observed_value=observed_value,
        threshold_value=threshold_value,
        links=links or {},
    )


def test_rule_catalog_is_consistent() -> None:
    ids = [rule.rule_id for rule in ALERT_RULES]
    assert len(ids) == len(set(ids)), "duplicate rule ids would silently share dedupe keys"
    for rule in ALERT_RULES:
        assert rule_for(rule.rule_id) is rule
        assert rule.requires_recovery is True, (
            "Part 9: no alert may auto-resolve without an observed recovery"
        )
    # Severity distribution sanity (emergency is reserved, not sprinkled).
    emergency = {r.rule_id for r in ALERT_RULES if r.severity is AlertSeverity.EMERGENCY}
    assert emergency == {
        "RISK_ENGINE_UNAVAILABLE",
        "RECONCILIATION_DISCREPANCY",
        "AMBIGUOUS_EXECUTION",
        "REDIS_UNAVAILABLE",
        "KILL_SWITCH_ENGAGED",
    }


def test_unknown_rule_id_is_refused() -> None:
    with pytest.raises(KeyError, match="unknown alert rule"):
        rule_for("NOT_A_RULE")


def test_first_observation_opens_and_second_folds() -> None:
    engine = AlertEngine()
    first = engine.observe(obs())
    assert first.state is AlertState.OPEN
    assert first.occurrences == 1
    assert first.first_seen_at_micros == T0
    assert first.severity is AlertSeverity.CRITICAL

    second = engine.observe(obs(at_micros=T0 + 1_000_000, message="still stale"))
    assert second.alert_id == first.alert_id
    assert second.occurrences == 2
    assert second.first_seen_at_micros == T0
    assert second.last_seen_at_micros == T0 + 1_000_000


def test_storm_produces_one_record_with_visible_magnitude() -> None:
    engine = AlertEngine()
    engine.observe(obs())
    for tick in range(1, 10_000):
        engine.observe(obs(at_micros=T0 + tick * 1_000, observed_value=str(4_100_000 + tick)))
    active = engine.active()
    assert len(active) == 1
    assert active[0].occurrences == 10_000
    assert active[0].last_seen_at_micros == T0 + 9_999 * 1_000
    # The latest observation is visible without losing the first.
    assert active[0].observed_value == str(4_100_000 + 9_999)


def test_distinct_scopes_never_merge() -> None:
    engine = AlertEngine()
    a = engine.observe(obs(scope="binance/BTCUSDT"))
    b = engine.observe(obs(scope="binance/ETHUSDT"))
    c = engine.observe(obs(component="trading-engine", scope="binance/BTCUSDT"))
    assert len({a.alert_id, b.alert_id, c.alert_id}) == 3
    assert len(engine.active()) == 3


def test_acknowledge_requires_open_and_never_resolves() -> None:
    engine = AlertEngine()
    opened = engine.observe(obs())
    acked = engine.acknowledge(
        rule_id="MARKET_DATA_STALE", component="market-data", scope="binance/BTCUSDT", actor="ops@example", at_micros=T0 + 5
    )
    assert acked.state is AlertState.ACKNOWLEDGED
    assert acked.acknowledged_by == "ops@example"
    with pytest.raises(ValueError, match="only OPEN alerts"):
        engine.acknowledge(
            rule_id="MARKET_DATA_STALE",
            component="market-data",
            scope="binance/BTCUSDT",
            actor="ops@example",
            at_micros=T0 + 6,
        )
    # Further occurrences fold into the ACK record without reopening.
    folded = engine.observe(obs(at_micros=T0 + 7))
    assert folded.state is AlertState.ACKNOWLEDGED
    assert folded.occurrences == opened.occurrences + 1


def test_acknowledge_unknown_key_raises() -> None:
    engine = AlertEngine()
    with pytest.raises(LookupError, match="no active alert"):
        engine.acknowledge(rule_id="QUEUE_BACKLOG", component="api", scope=None, actor="ops")


def test_actor_validation_rejects_free_text() -> None:
    engine = AlertEngine()
    engine.observe(obs())
    with pytest.raises(ValueError, match="bounded wire token"):
        engine.acknowledge(
            rule_id="MARKET_DATA_STALE",
            component="market-data",
            scope="binance/BTCUSDT",
            actor="admin; rm -rf /",
        )


def test_recovery_is_the_only_resolution() -> None:
    engine = AlertEngine()
    engine.observe(obs())
    resolved = engine.recover(
        rule_id="MARKET_DATA_STALE", component="market-data", scope="binance/BTCUSDT", at_micros=T0 + 9_000_000
    )
    assert resolved is not None
    assert resolved.state is AlertState.RESOLVED
    assert resolved.resolution == "recovered"
    assert resolved.resolved_at_micros == T0 + 9_000_000
    assert engine.active() == ()
    # Recovery of nothing active is a no-op, not an error.
    assert engine.recover(rule_id="MARKET_DATA_STALE", component="market-data", scope="binance/BTCUSDT") is None


def test_reraise_after_recovery_opens_a_fresh_record() -> None:
    engine = AlertEngine()
    original = engine.observe(obs())
    engine.recover(rule_id="MARKET_DATA_STALE", component="market-data", scope="binance/BTCUSDT", at_micros=T0 + 5)
    again = engine.observe(obs(at_micros=T0 + 10))
    assert again.alert_id != original.alert_id
    assert again.occurrences == 1
    assert again.first_seen_at_micros == T0 + 10


def test_acknowledged_then_recovered_resolves_with_note() -> None:
    engine = AlertEngine()
    engine.observe(obs())
    engine.acknowledge(rule_id="MARKET_DATA_STALE", component="market-data", scope="binance/BTCUSDT", actor="ops")
    resolved = engine.recover(
        rule_id="MARKET_DATA_STALE",
        component="market-data",
        scope="binance/BTCUSDT",
        at_micros=T0 + 50_000,
        note="feed resync completed",
    )
    assert resolved is not None
    assert resolved.state is AlertState.RESOLVED
    assert resolved.resolution == "recovered (feed resync completed)"
    assert resolved.acknowledged_by == "ops"


def test_links_accumulate_across_observations() -> None:
    engine = AlertEngine()
    engine.observe(obs(links={"correlation_id": "corr-1", "risk_event": "re-9"}))
    record = engine.observe(obs(at_micros=T0 + 3, links={"correlation_id": "corr-2"}))
    assert record.links["risk_event"] == "re-9"
    assert record.links["correlation_id"] == "corr-2"  # latest wins, no lie about which tick


def test_payload_roundtrip_and_sorted_mirror() -> None:
    engine = AlertEngine()
    engine.observe(obs())
    engine.observe(obs(rule_id="QUEUE_BACKLOG", component="api", scope="tenants", at_micros=T0 + 1))
    engine.observe(
        obs(rule_id="REDIS_UNAVAILABLE", component="redis", scope=None, at_micros=T0 + 2)
    )
    payload = engine.mirror_payload()
    # Ordering contract: severity desc, then first-seen asc.
    states = [rec["ruleId"] for rec in payload["active"]]
    assert states[0] == "REDIS_UNAVAILABLE"  # EMERGENCY first
    assert states[1] == "MARKET_DATA_STALE"  # CRITICAL, oldest of the two
    assert states[2] == "QUEUE_BACKLOG"  # WARNING
    assert payload["counts"] == {"INFO": 0, "WARNING": 1, "CRITICAL": 1, "EMERGENCY": 1}

    restored = [AlertRecord.from_payload(rec) for rec in payload["active"]]
    assert restored[0].scope is None
    assert restored[0].state is AlertState.OPEN
    assert tuple(restored) == engine.active()


def test_payload_missing_field_is_a_clear_error() -> None:
    with pytest.raises(ValueError, match="missing"):
        AlertRecord.from_payload({"ruleId": "X"})


def test_engine_exposes_no_io_verbs() -> None:
    # The engine is pure state: it never reaches out. (The companion
    # import-level guard lives in test_observability_boundaries.py.)
    engine = AlertEngine()
    record = engine.observe(AlertObservation(rule_id="WORKER_FAILURE", component="w", at_micros=T0))
    assert record.state is AlertState.OPEN
    assert not any(
        hasattr(engine, name) for name in ("send", "write", "save", "flush", "push", "connect")
    )


def test_scope_none_folds_under_platform_bucket() -> None:
    engine = AlertEngine()
    a = engine.observe(obs(scope=None))
    b = engine.observe(obs(scope=None, at_micros=T0 + 4))
    assert a.alert_id == b.alert_id
    assert b.occurrences == 2
