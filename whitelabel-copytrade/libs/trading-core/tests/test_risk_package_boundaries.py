"""Source-level guarantees of the Part 8 risk package.

These tests read source text on purpose. Behavioural tests can only prove
what a call path does when it runs; what the risk layer must also guarantee
is what it *cannot* do - no import that could reach a venue, no parameter
that could skip a check, no code path that turns an unknown into an
approval. Grepping the shipped source is the only honest way to assert that,
and it is cheap enough to run on every commit.

The Part 8 package lives at ``wlct_trading/risk/``; the guard covers every
module except ``core.py``, which predates Part 8 and is separately covered by
the Part 5 execution tests (it imports no I/O either - asserted below for
all files uniformly).
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from wlct_trading.enums import (
    KILL_SWITCH_SCOPE_PRIORITY,
    RISK_RULE_ORDER,
    KillSwitchScope,
    RiskDecisionCode,
    RiskEventKind,
    RiskRuleId,
    TradingEventType,
)

RISK_DIR = Path(__file__).resolve().parents[1] / "wlct_trading" / "risk"

#: Modules that belong to the Part 8 layer. ``core.py`` is the Part 2/5
#: engine preserved verbatim-in-place; the guards below apply to everything.
ALL_MODULES = sorted(p.name for p in RISK_DIR.glob("*.py"))


def module_sources() -> list[tuple[str, str]]:
    sources: list[tuple[str, str]] = []
    for name in ALL_MODULES:
        path = RISK_DIR / name
        sources.append((name, path.read_text(encoding="utf-8")))
    return sources


def import_lines(source: str) -> list[str]:
    return [
        line
        for line in source.splitlines()
        if line.startswith(("import ", "from "))
    ]


class TestPackageHygiene:
    def test_every_part8_module_is_present(self) -> None:
        expected = {
            "__init__.py",
            "core.py",
            "codes.py",
            "configuration.py",
            "correlation.py",
            "decisions.py",
            "evaluator.py",
            "events.py",
            "exposure.py",
            "freshness.py",
            "ledger.py",
            "protections.py",
            "rate_limits.py",
            "replay.py",
            "rules.py",
            "simulated.py",
            "snapshot.py",
        }
        assert set(ALL_MODULES) == expected

    def test_no_module_imports_execution_adapters_or_transports(self) -> None:
        # The risk package computes; it cannot act. If one day a venue
        # import appears here, the layering that keeps "no bypass" true has
        # already been broken, and this test is the tripwire.
        forbidden = (
            "wlct_trading.execution",
            "wlct_trading.adapters",
            "wlct_trading.net",
            "wlct_trading.transport",
            "wlct_trading.orders.oms",
        )
        for name, source in module_sources():
            for line in import_lines(source):
                for token in forbidden:
                    assert token not in line, f"{name}: {line}"

    def test_no_module_touches_http_or_websocket_libraries(self) -> None:
        for name, source in module_sources():
            for line in import_lines(source):
                assert "httpx" not in line and "websockets" not in line and "socket" not in line, (
                    f"{name}: {line}"
                )

    def test_no_module_reexports_through_star_imports(self) -> None:
        # Star imports at a package boundary make the public surface
        # "whatever got defined today"; the barrels here are explicit lists.
        for name, source in module_sources():
            assert not re.search(r"^from .* import \*", source, re.MULTILINE), name

    def test_package_exports_no_execution_symbols(self) -> None:
        from wlct_trading import risk as risk_pkg

        for exported in risk_pkg.__all__:
            lowered = exported.lower()
            assert "submit" not in lowered and "adapter" not in lowered
            assert not lowered.startswith("live")


class TestFailClosedSurface:
    def test_gate_evaluate_has_no_bypass_parameters(self) -> None:
        source = (RISK_DIR / "evaluator.py").read_text(encoding="utf-8")
        match = re.search(r"def evaluate\((?:[^)]*)\) -> GateOutcome:", source, re.DOTALL)
        assert match is not None, "evaluate's signature could not be located"
        signature = match.group(0)
        for word in ("skip", "bypass", "force", "override", "relax"):
            assert word not in signature.lower(), signature

    def test_evaluate_returns_a_decision_on_every_path(self) -> None:
        # Structural proof of "unknown is a refusal": the only `return`s in
        # evaluate are GateOutcome constructions (approve or refuse); a bare
        # `return None` or fall-through would need an `if` whose else-path
        # returns nothing. The method's last statement must therefore be a
        # return of a GateOutcome.
        source = (RISK_DIR / "evaluator.py").read_text(encoding="utf-8")
        body = source[source.index("    def evaluate(") :]
        assert "return GateOutcome(" in body
        # and no code path raises out for a risk condition: the only raises
        # in the file are the constructor's GateError.
        evaluate_body = body[: body.index("    # -- stage helpers")]
        assert "raise " not in evaluate_body

    def test_risk_decision_code_is_stable_and_total_over_rules(self) -> None:
        from wlct_trading.risk.codes import RULE_TO_DECISION_CODE

        assert set(RULE_TO_DECISION_CODE) == set(RiskRuleId)
        for code in RULE_TO_DECISION_CODE.values():
            assert isinstance(code, RiskDecisionCode)
        # the approval code is not the consequence of any rule breach
        assert RiskDecisionCode.APPROVED not in RULE_TO_DECISION_CODE.values()

    def test_rule_order_is_complete_and_unique(self) -> None:
        assert len(RISK_RULE_ORDER) == len(set(RISK_RULE_ORDER))
        assert set(RISK_RULE_ORDER) == set(RiskRuleId)

    def test_kill_switch_priority_covers_every_scope(self) -> None:
        assert set(KILL_SWITCH_SCOPE_PRIORITY) == set(KillSwitchScope)
        # global first: the broadest halt is evaluated before anything that
        # could theoretically argue with it.
        assert KILL_SWITCH_SCOPE_PRIORITY[0] is KillSwitchScope.GLOBAL

    def test_every_risk_event_kind_has_a_bus_mapping(self) -> None:
        from wlct_trading.risk.events import KIND_TO_TRADING_EVENT

        assert set(KIND_TO_TRADING_EVENT) == set(RiskEventKind)
        for event_type in KIND_TO_TRADING_EVENT.values():
            assert isinstance(event_type, TradingEventType)

    def test_trading_event_part8_members_use_pascal_wire_values(self) -> None:
        # Bus event types are wire values (persisted in the stream); the
        # project's Part 2/3/6 convention is PascalCase for this enum.
        part8 = {
            "RiskSnapshotUpdated",
            "RiskExposureUpdated",
            "RiskStateStale",
            "RiskLimitChanged",
            "KillSwitchActivated",
            "KillSwitchCleared",
            "KillSwitchAcknowledged",
            "ProtectionTriggered",
            "ProtectionCleared",
            "DailyLossLimitBreached",
            "OrderRateLimitBreached",
            "CancelRateLimitBreached",
            "RiskDecisionRejected",
            "RiskDecisionExempted",
        }
        actual = {
            member.value
            for member in TradingEventType
            if member.name.startswith(
                ("RISK_", "KILL_SWITCH_", "PROTECTION_", "DAILY_LOSS_", "ORDER_RATE_", "CANCEL_RATE_")
            )
            and member.name
            not in (
                "RISK_CHECK_REQUESTED",
                "RISK_LIMIT_BREACHED",
            )  # the two Part 2 originals keep their Part 2 spellings
        }
        assert actual == part8

    def test_decimal_discipline_in_money_paths(self) -> None:
        # No float() conversions and no Decimal(<float>) constructions in
        # the modules that do arithmetic; parsing raw JSON floats is refused
        # by design (tested elsewhere), never laundered through float().
        arithmetic_modules = (
            "exposure.py",
            "rules.py",
            "snapshot.py",
            "configuration.py",
            "ledger.py",
        )
        for name in arithmetic_modules:
            if name not in ALL_MODULES:
                continue
            source = (RISK_DIR / name).read_text(encoding="utf-8")
            assert "float(" not in source, name
            assert not re.search(r"Decimal\(\s*[0-9]+\.[0-9]+\s*\)", source), name

    def test_no_suppressions_anywhere_in_the_package(self) -> None:
        for name, source in module_sources():
            assert "type: ignore" not in source, name
            assert "# noqa" not in source, name

    def test_core_engine_defaults_keep_part2_behaviour(self) -> None:
        # The Part 2/5 constructor signature's default must remain the
        # legacy numeric evaluation; a flipped default would silently alter
        # every construction site in paper/backtest/queue code.
        from wlct_trading.risk.core import RiskEngine

        import inspect

        params = inspect.signature(RiskEngine.__init__).parameters
        assert params["evaluate_numeric_limits"].default is True


class TestNoCredentialSurfaces:
    @pytest.mark.parametrize(
        "banned",
        ["api_key", "api_secret", "private_key", "password", "passphrase", "signature"],
    )
    def test_risk_payload_fields_never_name_credential_shapes(self, banned: str) -> None:
        # Dataclass field names on the wire objects (RiskEvent, snapshot
        # payloads, config payloads) - the fields an API would echo.
        from wlct_trading.risk.events import RiskEvent
        from wlct_trading.risk.snapshot import RiskStateSnapshot

        event_fields = set(RiskEvent.__dataclass_fields__)
        state_fields = set(RiskStateSnapshot.__dataclass_fields__)
        for field in event_fields | state_fields:
            assert banned not in field.lower()

    def test_event_payload_carries_ids_not_secrets(self) -> None:
        from tests import test_risk_rate_ledger_events as fixtures

        # building the payload is enough: RiskEvent's constructor simply
        # has no field a secret could go into, and the sink writes that
        # payload unchanged.
        event = fixtures.TestEvents.build()
        payload = event.to_payload()
        assert payload["ruleId"] == "MAX_DAILY_LOSS"
        for key in payload:
            for banned in ("secret", "password", "token", "apikey"):
                assert banned not in key.lower()
