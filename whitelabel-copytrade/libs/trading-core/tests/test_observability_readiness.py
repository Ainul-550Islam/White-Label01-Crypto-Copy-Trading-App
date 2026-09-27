"""Trading readiness: fail-closed truth table and the spec's distinctions.

The one line all of these tests protect: ``trading_ready`` is *derived from
the trading plane's evidence*, never assumed, never inherited from "the API
answered", and never a bypass for (or against) the risk gate.
"""

from __future__ import annotations

import pytest

from wlct_trading.observability.readiness import (
    TRADING_GATES,
    GateEvidence,
    evaluate_trading_readiness,
)

NOW = 1_700_000_000_000_000


def all_ok() -> dict[str, GateEvidence]:
    return {gate.name: GateEvidence(value=True) for gate in TRADING_GATES}


def test_all_satisfied_means_ready() -> None:
    verdict = evaluate_trading_readiness(all_ok(), now_micros=NOW)
    assert verdict.ready is True
    assert verdict.blocking_gates == ()
    assert len(verdict.gates) == len(TRADING_GATES)


@pytest.mark.parametrize(
    "gate",
    [g.name for g in TRADING_GATES],
)
def test_each_critical_gate_alone_blocks(gate: str) -> None:
    evidence = all_ok()
    evidence[gate] = GateEvidence(value=False, detail=f"{gate} is down")
    verdict = evaluate_trading_readiness(evidence, now_micros=NOW)
    assert verdict.ready is False
    assert gate in verdict.blocking_gates
    assert verdict.reasons()[gate] == f"{gate} is down"


def test_missing_evidence_is_not_satisfied() -> None:
    evidence = all_ok()
    del evidence["risk_state_fresh"]
    verdict = evaluate_trading_readiness(evidence, now_micros=NOW)
    assert verdict.ready is False
    assert "no evidence" in verdict.reasons()["risk_state_fresh"]


def test_none_value_is_unknown_not_maybe() -> None:
    evidence = all_ok()
    evidence["exchange_connectivity"] = GateEvidence(value=None)
    verdict = evaluate_trading_readiness(evidence, now_micros=NOW)
    assert not verdict.ready
    assert "unknown" in verdict.reasons()["exchange_connectivity"]


def test_stale_evidence_flips_a_previously_true_gate() -> None:
    evidence = all_ok()
    evidence["market_data"] = GateEvidence(
        value=True, age_micros=5_000_000, freshness_budget_micros=2_000_000
    )
    verdict = evaluate_trading_readiness(evidence, now_micros=NOW)
    assert not verdict.ready
    assert "stale" in verdict.reasons()["market_data"]


def test_age_at_budget_boundary_is_still_fresh() -> None:
    evidence = all_ok()
    evidence["risk_state_fresh"] = GateEvidence(
        value=True, age_micros=2_000_000, freshness_budget_micros=2_000_000
    )
    verdict = evaluate_trading_readiness(evidence, now_micros=NOW)
    assert "risk_state_fresh" not in verdict.reasons()


def test_kill_switch_engaged_blocks_trading() -> None:
    evidence = all_ok()
    evidence["kill_switches"] = GateEvidence(value=False, detail="GLOBAL kill switch TRIGGERED")
    verdict = evaluate_trading_readiness(evidence, now_micros=NOW)
    assert not verdict.ready


def test_undeclared_gate_is_an_error_not_typo_tolerated() -> None:
    evidence = all_ok()
    evidence["vibes"] = GateEvidence(value=True)
    with pytest.raises(KeyError, match="undeclared gate"):
        evaluate_trading_readiness(evidence, now_micros=NOW)


def test_gate_set_matches_the_specification() -> None:
    assert {g.name for g in TRADING_GATES} == {
        "market_data",
        "risk_engine",
        "risk_state_fresh",
        "exchange_connectivity",
        "execution_adapter",
        "reconciliation",
        "queues",
        "kill_switches",
        "configuration",
    }
    assert all(g.critical for g in TRADING_GATES), (
        "Part 9 declares every trading gate as blocking; a non-critical gate "
        "would need its own justification in the spec before it can exist"
    )


def test_verdict_dict_carries_the_non_authorisation_note() -> None:
    verdict = evaluate_trading_readiness(all_ok(), now_micros=NOW)
    payload = verdict.to_dict()
    assert payload["tradingReady"] is True
    assert "risk gate" in payload["note"]
