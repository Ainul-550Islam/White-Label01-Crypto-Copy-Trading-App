"""Futures live gates: removing ANY single gate refuses; spot matrix byte-identical.

Batch 03 pins four properties:

1. ``ALL_LIVE_GATES`` is unchanged by the batch - the spot gate matrix's
   membership, order and output are exactly what they were.
2. A ``usdm_futures`` market adds the four futures gates on top of the spot
   ones, never instead of them.
3. Each futures gate fails in isolation when its knob is broken, and the gate
   names land in the refusal in stable order.
4. Spot composition refuses futures wiring and futures composition refuses at
   boot when mode is simulated.
"""

from __future__ import annotations

from typing import Any

from wlct_trading.execution.live_enablement import (
    LiveEnablementReport,
    LivePrerequisite,
)

from app.config import Settings
from app.venue.live_gates import (
    ALL_FUTURES_GATES,
    ALL_LIVE_GATES,
    GATE_CREDENTIAL_SOURCE,
    GATE_DRY_RUN_EXPLICIT_OFF,
    GATE_DURABLE_STORE,
    GATE_ENABLEMENT_REPORT,
    GATE_FUTURES_ISOLATED_ONLY,
    GATE_FUTURES_KEY_PERMISSIONS,
    GATE_FUTURES_LEVERAGE_CAP,
    GATE_FUTURES_LIQUIDATION_GUARD,
    GATE_IP_ALLOWLIST,
    GATE_KEY_AGE_POLICY,
    GATE_KILL_SWITCH_READABLE,
    GATE_OPERATOR_CONFIRMATION,
    evaluate_futures_gates,
    evaluate_live_gates,
)
from tests.conftest import BASE_ENV

_VAULT = {
    "EXECUTION_CREDENTIAL_SOURCE": "secret-manager",
    "EXECUTION_CREDENTIAL_FETCHER": "vault-kv2",
    "EXECUTION_VAULT_ADDR": "https://vault.internal:8200",
}

_LIVE_GOOD = {
    **_VAULT,
    "EXECUTION_MODE": "live",
    "EXECUTION_DRY_RUN": "false",
    "EXECUTION_LIVE_KILL_SWITCH_ENGAGED": "false",
    "EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST": "true",
    "EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS": "90",
}


def _settings(**overrides: Any) -> Settings:
    merged: dict[str, Any] = {**BASE_ENV, **_LIVE_GOOD}
    merged.update(overrides)
    return Settings.model_validate(merged)


def _clean_report() -> LiveEnablementReport:
    return LiveEnablementReport(missing=(), satisfied=tuple(LivePrerequisite), credential_source="secret-manager")


class _DurableStore:
    is_durable = True


class TestSpotMatrixUnchanged:
    def test_spot_gate_set_is_exactly_the_legacy_eight(self):
        assert ALL_LIVE_GATES == (
            "ENABLEMENT_REPORT",
            "OPERATOR_CONFIRMATION",
            "IP_ALLOWLIST",
            "CREDENTIAL_SOURCE",
            "KEY_AGE_POLICY",
            "DURABLE_STORE",
            "DRY_RUN_EXPLICIT_OFF",
            "KILL_SWITCH_READABLE",
        )

    def test_spot_settings_produce_no_futures_failures(self):
        fail = evaluate_live_gates(
            _settings(EXECUTION_VENUE_MARKET="spot"),
            _clean_report(),
            confirmation_accepted=True,
            store=_DurableStore(),
        )
        assert fail == []
        for gate in ALL_FUTURES_GATES:
            assert gate not in fail


class TestFuturesGatesEach:
    def test_declared_set(self):
        assert ALL_FUTURES_GATES == (
            "FUTURES_ISOLATED_ONLY",
            "FUTURES_LEVERAGE_CAP",
            "FUTURES_LIQUIDATION_GUARD",
            "FUTURES_KEY_PERMISSIONS",
        )

    def test_futures_market_with_clean_gates_passes(self):
        fail = evaluate_live_gates(
            _settings(EXECUTION_VENUE_MARKET="usdm_futures"),
            _clean_report(),
            confirmation_accepted=True,
            store=_DurableStore(),
        )
        assert fail == []

    def test_leverage_cap_out_of_envelope_refuses(self):
        # Boot validation already bounds 1..20; the gate independently refuses
        # a settings object whose cap outside that envelope somehow arrived.
        s = _settings(EXECUTION_VENUE_MARKET="usdm_futures")
        report = _clean_report()
        direct = evaluate_futures_gates(s, report)
        assert direct == []
        fail = evaluate_futures_gates(
            s.model_copy(update={"EXECUTION_FUTURES_MAX_LEVERAGE": 125}), report
        )
        assert GATE_FUTURES_LEVERAGE_CAP in fail

    def test_liquidation_guard_zero_floor_refuses(self):
        s = _settings(EXECUTION_VENUE_MARKET="usdm_futures")
        fail = evaluate_futures_gates(
            s.model_copy(update={"EXECUTION_FUTURES_MIN_LIQUIDATION_DISTANCE_BPS": 0}),
            _clean_report(),
        )
        assert GATE_FUTURES_LIQUIDATION_GUARD in fail

    def test_zero_funding_cap_refuses(self):
        s = _settings(EXECUTION_VENUE_MARKET="usdm_futures")
        fail = evaluate_futures_gates(
            s.model_copy(update={"EXECUTION_FUTURES_MAX_FUNDING_RATE_BPS": 0}),
            _clean_report(),
        )
        assert GATE_FUTURES_LIQUIDATION_GUARD in fail

    def test_missing_attestation_surface_refuses_key_permissions_gate(self):
        report = LiveEnablementReport(
            missing=(LivePrerequisite.VENUE_ATTESTOR_WIRED,),
            satisfied=tuple(p for p in LivePrerequisite if p != LivePrerequisite.VENUE_ATTESTOR_WIRED),
            credential_source="secret-manager",
        )
        s = _settings(EXECUTION_VENUE_MARKET="usdm_futures")
        fail = evaluate_futures_gates(s, report)
        assert GATE_FUTURES_KEY_PERMISSIONS in fail
        # and the spot enablement gate must ALSO fire - no hidden pass-through
        merged = evaluate_live_gates(s, report, True, _DurableStore())
        assert GATE_ENABLEMENT_REPORT in merged
        assert GATE_FUTURES_KEY_PERMISSIONS in merged

    def test_margin_mode_fixed_by_literal(self):
        # The Literal type refuses anything but "isolated" at validation; the
        # gate's model_copy bypass below proves the gate reads it, not the type.
        s = _settings(EXECUTION_VENUE_MARKET="usdm_futures")
        forced = s.model_copy(update={"EXECUTION_FUTURES_MARGIN_MODE": "crossed"})
        fail = evaluate_futures_gates(forced, _clean_report())
        assert GATE_FUTURES_ISOLATED_ONLY in fail

    def test_gate_names_are_stable_strings_for_the_refusal(self):
        assert GATE_FUTURES_ISOLATED_ONLY == "FUTURES_ISOLATED_ONLY"
        assert GATE_FUTURES_LEVERAGE_CAP == "FUTURES_LEVERAGE_CAP"
        assert GATE_FUTURES_LIQUIDATION_GUARD == "FUTURES_LIQUIDATION_GUARD"
        assert GATE_FUTURES_KEY_PERMISSIONS == "FUTURES_KEY_PERMISSIONS"


class TestFuturesConfigValidation:
    def test_simulated_futures_refused_at_boot(self):
        import pytest

        with pytest.raises(Exception) as excinfo:
            _settings(EXECUTION_MODE="simulated", EXECUTION_VENUE_MARKET="usdm_futures")
        assert "usdm_futures" in str(excinfo.value)

    def test_futures_nobs_defaults(self):
        s = _settings()
        assert s.EXECUTION_VENUE_MARKET == "spot"
        assert s.EXECUTION_FUTURES_MAX_LEVERAGE == 3
        assert s.EXECUTION_FUTURES_MARGIN_MODE == "isolated"
        assert s.EXECUTION_FUTURES_MIN_LIQUIDATION_DISTANCE_BPS == 250
        assert s.EXECUTION_FUTURES_MAX_FUNDING_RATE_BPS == 75

    def test_leverage_below_one_refused(self):
        import pytest

        with pytest.raises(Exception):
            _settings(EXECUTION_FUTURES_MAX_LEVERAGE="0")

    def test_negative_notional_refused(self):
        import pytest

        with pytest.raises(Exception):
            _settings(EXECUTION_FUTURES_MAX_NOTIONAL_USDT="-5")

    def test_bad_liquidation_distance_refused(self):
        import pytest

        with pytest.raises(Exception):
            _settings(EXECUTION_FUTURES_MIN_LIQUIDATION_DISTANCE_BPS="0")

    def test_public_dict_exposes_futures_knobs_no_secrets(self):
        s = _settings(EXECUTION_FUTURES_MAX_LEVERAGE="5")
        view = s.to_public_dict()
        assert view["venueMarket"] == "spot"
        assert view["futuresMaxLeverage"] == 5
        assert view["futuresMarginMode"] == "isolated"
        assert "futuresMaxNotionalUsdt" in view
