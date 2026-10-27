"""Live mode is refused unless EVERY gate passes - and the refusal names them all.

Two layers are pinned here: the pure gate evaluation (each gate failing in
isolation, all passing together) and the composition behaviour (default
live refused with the failed gates listed; testnet wiring real adapters
behind dry-run; simulated untouched by any of it).
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from types import SimpleNamespace
from typing import Any, cast

import pytest
from wlct_trading.adapters.paper import PaperTradingAdapter
from wlct_trading.exchanges.binance.trading import BinanceTradingAdapter
from wlct_trading.execution.live_enablement import (
    LiveEnablementReport,
    LivePrerequisite,
)

from app.composition import ExecutionUnavailable, build_runtime
from app.config import Settings
from app.routers.internal import engine_status
from app.venue.live_gates import (
    ALL_LIVE_GATES,
    GATE_CREDENTIAL_SOURCE,
    GATE_DRY_RUN_EXPLICIT_OFF,
    GATE_DURABLE_STORE,
    GATE_ENABLEMENT_REPORT,
    GATE_IP_ALLOWLIST,
    GATE_KEY_AGE_POLICY,
    GATE_KILL_SWITCH_READABLE,
    GATE_OPERATOR_CONFIRMATION,
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
}


def _settings(**overrides: Any) -> Settings:
    merged: dict[str, Any] = {**BASE_ENV, **_LIVE_GOOD}
    merged.update(overrides)
    return Settings.model_validate(merged)


def _clean_report() -> LiveEnablementReport:
    return LiveEnablementReport(
        missing=(),
        satisfied=tuple(LivePrerequisite),
        credential_source="secret-manager",
    )


def _dirty_report() -> LiveEnablementReport:
    return LiveEnablementReport(
        missing=(LivePrerequisite.DURABLE_STORE_WIRED,),
        satisfied=(),
        credential_source="secret-manager",
    )


_DURABLE = SimpleNamespace(is_durable=True)
_MEMORY = SimpleNamespace(is_durable=False)


class TestGateEvaluation:
    def test_every_gate_passing_is_an_empty_failure_list(self) -> None:
        assert evaluate_live_gates(_settings(), _clean_report(), True, _DURABLE) == []

    def test_each_gate_fails_independently_and_is_named(self) -> None:
        cases: list[tuple[str, Callable[[], list[str]]]] = [
            (
                GATE_ENABLEMENT_REPORT,
                lambda: evaluate_live_gates(
                    _settings(), _dirty_report(), True, _DURABLE
                ),
            ),
            (
                GATE_OPERATOR_CONFIRMATION,
                lambda: evaluate_live_gates(
                    _settings(), _clean_report(), False, _DURABLE
                ),
            ),
            (
                GATE_IP_ALLOWLIST,
                lambda: evaluate_live_gates(
                    # Settings itself refuses this pairing in live mode, so
                    # the pure gate is exercised under testnet settings.
                    _settings(
                        EXECUTION_MODE="testnet",
                        EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST="false",
                    ),
                    _clean_report(),
                    True,
                    _DURABLE,
                ),
            ),
            (
                GATE_CREDENTIAL_SOURCE,
                lambda: evaluate_live_gates(
                    _settings(
                        EXECUTION_CREDENTIAL_SOURCE="environment",
                        EXECUTION_CREDENTIAL_FETCHER="none",
                    ),
                    _clean_report(),
                    True,
                    _DURABLE,
                ),
            ),
            (
                GATE_KEY_AGE_POLICY,
                lambda: evaluate_live_gates(
                    # Settings clamps this to 1..365 at parse time; the
                    # gate still guards it (the pure function must not
                    # trust that its input arrived via the parser).
                    _settings().model_copy(
                        update={"EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS": 0}
                    ),
                    _clean_report(),
                    True,
                    _DURABLE,
                ),
            ),
            (
                GATE_DURABLE_STORE,
                lambda: evaluate_live_gates(
                    _settings(), _clean_report(), True, _MEMORY
                ),
            ),
            (
                GATE_DRY_RUN_EXPLICIT_OFF,
                lambda: evaluate_live_gates(
                    _settings(EXECUTION_DRY_RUN="true"),
                    _clean_report(),
                    True,
                    _DURABLE,
                ),
            ),
            (
                GATE_KILL_SWITCH_READABLE,
                lambda: evaluate_live_gates(
                    _settings(EXECUTION_LIVE_KILL_SWITCH_ENGAGED="true"),
                    _clean_report(),
                    True,
                    _DURABLE,
                ),
            ),
        ]
        for gate, run in cases:
            assert run() == [gate], gate

    def test_unset_dry_run_is_not_an_explicit_opt_out(self) -> None:
        merged = {**BASE_ENV, **_LIVE_GOOD}
        del merged["EXECUTION_DRY_RUN"]
        settings = Settings.model_validate(merged)
        assert settings.EXECUTION_DRY_RUN is True  # the default
        assert GATE_DRY_RUN_EXPLICIT_OFF in evaluate_live_gates(
            settings, _clean_report(), True, _DURABLE
        )

    def test_unreadable_kill_switch_refuses(self) -> None:
        merged = {**BASE_ENV, **_LIVE_GOOD}
        del merged["EXECUTION_LIVE_KILL_SWITCH_ENGAGED"]
        settings = Settings.model_validate(merged)
        assert settings.EXECUTION_LIVE_KILL_SWITCH_ENGAGED is None
        assert evaluate_live_gates(
            settings, _clean_report(), True, _DURABLE
        ) == [GATE_KILL_SWITCH_READABLE]

    def test_blank_kill_switch_reads_as_unreadable_not_false(self) -> None:
        settings = _settings(EXECUTION_LIVE_KILL_SWITCH_ENGAGED="")
        assert settings.EXECUTION_LIVE_KILL_SWITCH_ENGAGED is None
        assert evaluate_live_gates(
            settings, _clean_report(), True, _DURABLE
        ) == [GATE_KILL_SWITCH_READABLE]

    def test_all_failures_are_listed_not_just_the_first(self) -> None:
        failed = evaluate_live_gates(
            Settings.model_validate({**BASE_ENV, "EXECUTION_MODE": "live"}),
            _dirty_report(),
            False,
            _MEMORY,
        )
        # Default settings: dry-run defaulted on, kill switch unread, no
        # credential source - everything fails except the key-age policy
        # (finite by default) and the IP allowlist (required by default).
        assert set(failed) == set(ALL_LIVE_GATES) - {
            GATE_KEY_AGE_POLICY,
            GATE_IP_ALLOWLIST,
        }
        assert failed == [g for g in ALL_LIVE_GATES if g in set(failed)]


@pytest.fixture
def _vault_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(
        "EXECUTION_VAULT_TOKEN", "".join(("vault-", "token-", "tests-", "0123456789"))
    )


class TestComposition:
    def test_default_live_refuses_and_names_the_failed_gates(self) -> None:
        settings = Settings.model_validate({**BASE_ENV, "EXECUTION_MODE": "live"})
        with pytest.raises(ExecutionUnavailable) as caught:
            build_runtime(settings)
        message = str(caught.value)
        assert "Failed live gates:" in message
        for gate in (
            GATE_ENABLEMENT_REPORT,
            GATE_OPERATOR_CONFIRMATION,
            GATE_CREDENTIAL_SOURCE,
            GATE_DRY_RUN_EXPLICIT_OFF,
            GATE_KILL_SWITCH_READABLE,
        ):
            assert gate in message
        # The transport exists now; the refusal must not claim otherwise.
        assert "no signed HTTP transport" not in message
        assert "Simulated mode is available now." in message

    @pytest.mark.usefixtures("_vault_token")
    def test_testnet_wires_the_real_stack_behind_dry_run(self) -> None:
        settings = Settings.model_validate(
            {**BASE_ENV, **_VAULT, "EXECUTION_MODE": "testnet"}
        )
        runtime = build_runtime(settings)
        assert isinstance(runtime.trading_adapter, BinanceTradingAdapter)
        assert runtime.venue_wiring is not None
        assert runtime.venue_wiring.testnet is True
        assert runtime.venue_wiring.base_url == "https://testnet.binance.vision"
        # One adapter, shared: the attestor reviews over the engine's adapter.
        assert runtime.venue_wiring.attestor._adapter is runtime.trading_adapter
        assert runtime.placement.mode == "venue"
        # Dry-run defaults on: wired for reads, nothing transmits.
        assert runtime.engine.settings.will_transmit_orders is False
        assert runtime.describe()["venue"]["testnet"] is True

    @pytest.mark.usefixtures("_vault_token")
    def test_the_status_route_publishes_the_venue_block(self) -> None:
        """The seam this guards broke once already: describe() published the
        block and the schema declared it, but the route never passed it, so
        /status answered null in every mode. Call the route itself."""
        settings = Settings.model_validate(
            {**BASE_ENV, **_VAULT, "EXECUTION_MODE": "testnet"}
        )
        runtime = build_runtime(settings)
        response = asyncio.run(
            engine_status(
                caller=cast("Any", None),
                runtime=runtime,
                request=cast("Any", None),
            )
        )
        wire = response.model_dump(by_alias=True)
        venue = wire["venue"]
        assert venue is not None
        assert venue["exchange"] == "binance"
        assert venue["market"] == "spot"
        assert venue["testnet"] is True
        transport = venue["transport"]
        assert transport["baseUrl"] == "https://testnet.binance.vision"
        assert transport["allowedBaseUrls"] == [
            "https://api.binance.com",
            "https://testnet.binance.vision",
        ]
        # The Binance spellings survive the round trip exactly.
        assert "usedWeight1M" in transport
        assert "orderCount10S" in transport
        assert "orderCount1D" in transport

    def test_the_status_route_keeps_venue_null_when_simulated(self) -> None:
        runtime = build_runtime(Settings.model_validate(dict(BASE_ENV)))
        response = asyncio.run(
            engine_status(
                caller=cast("Any", None),
                runtime=runtime,
                request=cast("Any", None),
            )
        )
        assert response.model_dump(by_alias=True)["venue"] is None

    def test_testnet_without_a_credential_source_refuses(self) -> None:
        settings = Settings.model_validate({**BASE_ENV, "EXECUTION_MODE": "testnet"})
        with pytest.raises(ExecutionUnavailable, match="testnet.*no key"):
            build_runtime(settings)

    def test_simulated_is_byte_identical_in_shape(self) -> None:
        runtime = build_runtime(Settings.model_validate(dict(BASE_ENV)))
        assert isinstance(runtime.trading_adapter, PaperTradingAdapter)
        assert runtime.venue_wiring is None
        assert runtime.describe()["venue"] is None
        assert runtime.describe()["mode"] == "simulated"
        assert runtime.engine.settings.will_transmit_orders is False
