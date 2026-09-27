"""Part 8 risk gate wired into the real execution engine, paper and backtest.

Acceptance lines: every order-intent path passes through risk (1), a
strategy cannot bypass risk (37), paper execution remains safe (38), the
live execution boundary is intact (39), reservations return exactly when
they must, and Part 8 changes nothing for hosts that do not wire the gate.

These tests exercise the production composition - ``ExecutionEngine`` with
``risk_gate=`` - not a stand-in. The stubs that differ from production are
only the adapter and the stores, exactly as in ``test_execution.py``; from
validation through the safety gates through the risk pipeline, this is the
real wiring.
"""

from __future__ import annotations

import asyncio
from dataclasses import replace
from decimal import Decimal

import pytest

from wlct_trading.enums import (
    KillSwitchScope,
    RiskDecisionCode,
    RiskLimitScope,
    RiskRuleId,
    RiskSwitchStatus,
)
from wlct_trading.adapters.base import AdapterConnectionError
from wlct_trading.execution.engine import (
    EngineConfigurationError,
    ExecutionEngine,
    ExecutionOutcome,
)
from wlct_trading.execution.config import ExecutionSettings
from wlct_trading.execution.store import InMemoryOrderStore
from wlct_trading.execution.incidents import InMemoryIncidentRecorder
from wlct_trading.execution.validation import OrderValidator
from wlct_trading.execution.locks import InMemoryLockManager
from wlct_trading.clock import epoch_micros
from wlct_trading.risk import RiskGate
from wlct_trading.risk import KillSwitchState
from wlct_trading.risk.configuration import RiskConfiguration, RiskLimitEntry
from wlct_trading.risk.events import InMemoryRiskEventSink
from wlct_trading.risk.freshness import FreshnessBudget
from wlct_trading.risk.ledger import LocalReservationLedger
from wlct_trading.risk.protections import KillSwitchLedger, KillSwitchRecord

from tests import test_execution as tx
from tests import test_risk_gate as tg


def backtest_strategy():
    """The registry-built strategy used by every backtest fixture."""
    from wlct_trading.strategies import build_default_strategy_registry
    from tests import test_backtest as tb

    registry = build_default_strategy_registry()
    return registry.create(
        "DETERMINISTIC_IMBALANCE_V1",
        "1.0.0",
        descriptor=tb.descriptor(),
        symbol=tg.SYMBOL,
        parameters={"use_limit_orders": False, "signal_cooldown_micros": 0},
    )

# The engine path stamps decisions with the real clock; the fixtures must
# age with it or freshness fails on every run. Tests that WANT staleness
# pass an explicit created_at.
NOW = epoch_micros()
BRIDGE_SYMBOL = "BTC/USDT"


def bridge_config(*overrides: RiskLimitEntry) -> RiskConfiguration:
    merged: dict[tuple[RiskRuleId, RiskLimitScope, str | None], RiskLimitEntry] = {}
    for entry in tg.BASELINE:
        merged[(entry.rule_id, entry.scope, entry.target)] = entry
    for entry in overrides:
        merged[(entry.rule_id, entry.scope, entry.target)] = entry
    return RiskConfiguration(entries=list(merged.values()))


def bridge_state(
    config: RiskConfiguration | None = None,
    *,
    created_at: int = NOW,
    position: str = "0",
    available: str = "10000000",
):
    market = tg.market(
        bid="49995", ask="50005", quote_ts=created_at - 50_000, symbol=BRIDGE_SYMBOL
    )
    from wlct_trading.risk.snapshot import RiskStrategyState

    strategies = (
        RiskStrategyState(
            strategy_id="strategy-1",  # matches tests.test_execution.intent()
            realised_pnl_today=Decimal(0),
            unrealised_pnl=Decimal(0),
            open_order_count=0,
            consecutive_losses=0,
            is_enabled=True,
            source_timestamp_micros=created_at,
        ),
    )
    base = tg.state_from(
        config,
        symbol=BRIDGE_SYMBOL,
        created_at=created_at,
        market_states=(market,),
        position=position,
        strategies=strategies,
        available=available,
        equity="10000000",
    )
    # Align identity with tests.test_execution.intent()'s account, or the
    # gate's cross-account check (correctly) refuses the fixture itself.
    aligned_account = base.account
    if aligned_account is not None:
        aligned_account = replace(aligned_account, account_id="account-1")
    return replace(base, account_id="account-1", account=aligned_account)


def bridge_gate(
    config: RiskConfiguration | None = None,
    *,
    events: InMemoryRiskEventSink | None = None,
    reservations: LocalReservationLedger | None = None,
    kill: KillSwitchLedger | None = None,
    freshness: FreshnessBudget | None = None,
) -> RiskGate:
    cfg = config if config is not None else bridge_config()
    return RiskGate(
        configuration=cfg,
        simulated=True,
        events=events or InMemoryRiskEventSink(),
        reservations=reservations,
        kill_switches=kill or KillSwitchLedger(),
        # The fixture timestamps are pinned at module import (shared with
        # the rest of the suite); the engine tests below run against the
        # wall clock, so the DEFAULT budget here is effectively unbounded and
        # staleness is tested explicitly, by shrinking the budget.
        freshness=(
            freshness
            if freshness is not None
            else FreshnessBudget(max_snapshot_age_micros=1_000_000_000_000_000)
        ),
    )


class TestEngineGateIntegration:
    @staticmethod
    def _engine(gate: RiskGate | None, adapter: tx.StubTradingAdapter) -> ExecutionEngine:
        return ExecutionEngine(
            adapter=adapter,
            settings=tx.paper_settings(),
            risk_engine=tx.risk_engine(),
            risk_gate=gate,
            store=InMemoryOrderStore(),
            locks=InMemoryLockManager(),
            incidents=InMemoryIncidentRecorder(),
            validator=OrderValidator(),
        )

    def test_engine_refuses_to_start_when_env_requires_the_gate(self) -> None:
        settings = ExecutionSettings(
            live_trading_enabled=False,
            dry_run=False,
            paper_trading=True,
            trading_mode_setting="PAPER",
            trading_enabled=True,
            live_trading_confirmed=False,
            risk_gate_required=True,
        )
        with pytest.raises(EngineConfigurationError, match="RISK_ENGINE_ENABLED"):
            ExecutionEngine(
                adapter=tx.StubTradingAdapter(simulated=True),
                settings=settings,
                risk_engine=tx.risk_engine(),
                store=InMemoryOrderStore(),
                locks=InMemoryLockManager(),
                incidents=InMemoryIncidentRecorder(),
            )

    def test_live_engine_refuses_the_simulated_gate(self) -> None:
        # A fully live-authorised configuration paired with the SIMULATED
        # gate must die at construction: the pairing rule protects the one
        # direction (simulated gate authorising live orders) that no runtime
        # check can repair afterwards.
        gate = bridge_gate()
        with pytest.raises(EngineConfigurationError, match="SIMULATED risk"):
            ExecutionEngine(
                adapter=tx.StubTradingAdapter(simulated=False, result=tx.accepted_result()),
                settings=ExecutionSettings(
                    live_trading_enabled=True,
                    dry_run=False,
                    paper_trading=False,
                    trading_mode_setting="LIVE",
                    trading_enabled=True,
                    live_trading_confirmed=True,
                    risk_gate_required=True,
                ),
                risk_engine=tx.risk_engine(),
                risk_gate=gate,
                store=InMemoryOrderStore(),
                locks=InMemoryLockManager(),
                incidents=InMemoryIncidentRecorder(),
                validator=OrderValidator(),
            )

    def test_stale_risk_state_blocks_before_any_venue_call(self) -> None:
        config = bridge_config()
        gate = bridge_gate(
            config,
            freshness=FreshnessBudget(max_snapshot_age_micros=5_000_000),
        )
        adapter = tx.StubTradingAdapter(simulated=True, result=tx.accepted_result())
        engine = self._engine(gate, adapter)
        stale = bridge_state(config, created_at=epoch_micros() - 60_000_000)
        outcome = asyncio.run(
            engine.submit(
                tx.intent(),
                tx.healthy_context(risk_state=stale),
            )
        )
        assert outcome.outcome is ExecutionOutcome.REJECTED_LOCALLY
        assert outcome.risk is not None
        assert outcome.risk.code is RiskDecisionCode.STALE_RISK_STATE
        assert adapter.submit_calls == []  # nothing ever left the process

    def test_missing_state_on_a_wired_gate_is_a_refusal_not_a_skip(self) -> None:
        gate = bridge_gate()
        adapter = tx.StubTradingAdapter(simulated=True, result=tx.accepted_result())
        engine = self._engine(gate, adapter)
        outcome = asyncio.run(engine.submit(tx.intent(), tx.healthy_context()))
        assert outcome.outcome is ExecutionOutcome.REJECTED_LOCALLY
        assert adapter.submit_calls == []

    def test_gate_violation_attaches_enriched_decision(self) -> None:
        config = bridge_config(
            tg.limit(RiskRuleId.MAX_ORDER_QUANTITY, "0.0000001")
        )
        gate = bridge_gate(config)
        adapter = tx.StubTradingAdapter(simulated=True, result=tx.accepted_result())
        engine = self._engine(gate, adapter)
        outcome = asyncio.run(
            engine.submit(
                tx.intent(quantity=Decimal("5")),
                tx.healthy_context(risk_state=bridge_state(config)),
            )
        )
        assert outcome.outcome is ExecutionOutcome.REJECTED_LOCALLY
        assert outcome.risk is not None
        assert outcome.risk.code is RiskDecisionCode.MAX_ORDER_SIZE_EXCEEDED
        assert outcome.risk.snapshot_version is not None
        assert outcome.risk.request_id  # client order id threaded through
        assert adapter.submit_calls == []

    def test_approved_order_carries_gate_decision_into_result(self) -> None:
        config = bridge_config()
        gate = bridge_gate(config)
        adapter = tx.StubTradingAdapter(
            simulated=True,
            result=tx.accepted_result(is_simulated=True),
        )
        engine = self._engine(gate, adapter)
        outcome = asyncio.run(
            engine.submit(
                tx.intent(),
                tx.healthy_context(risk_state=bridge_state(config)),
            )
        )
        assert outcome.outcome is ExecutionOutcome.ACCEPTED
        assert outcome.risk is not None
        assert outcome.risk.approved is True
        assert len(adapter.submit_calls) == 1

    def test_reservation_released_when_the_venue_path_never_happens(self) -> None:
        config = bridge_config()
        ledger = LocalReservationLedger()
        gate = bridge_gate(config, reservations=ledger)
        adapter = tx.StubTradingAdapter(
            simulated=True,
            result=tx.accepted_result(accepted=False, rejection_reason="no"),
        )
        engine = self._engine(gate, adapter)
        outcome = asyncio.run(
            engine.submit(
                tx.intent(),
                tx.healthy_context(risk_state=bridge_state(config)),
            )
        )
        # REJECTED_BY_EXCHANGE means the venue positively refused: no order
        # exists, so the reservation must not linger.
        assert outcome.outcome is ExecutionOutcome.REJECTED_BY_EXCHANGE
        assert ledger.snapshot_totals("tenant-1", "account-1") == {}

    def test_ambiguous_submission_keeps_the_reservation(self) -> None:
        config = bridge_config()
        ledger = LocalReservationLedger()
        gate = bridge_gate(config, reservations=ledger)
        adapter = tx.StubTradingAdapter(
            simulated=True, error=AdapterConnectionError("ambiguous")
        )
        engine = self._engine(gate, adapter)
        outcome = asyncio.run(
            engine.submit(
                tx.intent(),
                tx.healthy_context(risk_state=bridge_state(config)),
            )
        )
        assert outcome.outcome is ExecutionOutcome.UNKNOWN
        # the order might exist at the venue: the budget stays reserved until
        # reconciliation (and the TTL) own the truth.
        assert ledger.snapshot_totals("tenant-1", "account-1") != {}

    def test_global_kill_switch_in_legacy_state_still_short_circuits(self) -> None:
        config = bridge_config()
        gate = bridge_gate(config)
        engaged = KillSwitchState(global_engaged=True, reason="ops")
        adapter = tx.StubTradingAdapter(simulated=True, result=tx.accepted_result())
        engine = self._engine(gate, adapter)
        outcome = asyncio.run(
            engine.submit(
                tx.intent(),
                tx.healthy_context(
                    kill_switches=engaged, risk_state=bridge_state(config)
                ),
            )
        )
        assert outcome.outcome is ExecutionOutcome.REJECTED_LOCALLY
        assert adapter.submit_calls == []

    def test_ledger_engaged_account_switch_blocks_through_engine(self) -> None:
        kill = KillSwitchLedger(
            (
                KillSwitchRecord(
                    scope=KillSwitchScope.ACCOUNT,
                    target="account-1",
                    status=RiskSwitchStatus.ACTIVE,
                    reason="manual account halt",
                ),
            )
        )
        config = bridge_config()
        gate = bridge_gate(config, kill=kill)
        adapter = tx.StubTradingAdapter(simulated=True, result=tx.accepted_result())
        engine = self._engine(gate, adapter)
        outcome = asyncio.run(
            engine.submit(
                tx.intent(),
                tx.healthy_context(risk_state=bridge_state(config)),
            )
        )
        assert outcome.outcome is ExecutionOutcome.REJECTED_LOCALLY
        assert outcome.risk is not None
        assert outcome.risk.code is RiskDecisionCode.KILL_SWITCH_ENGAGED
        assert outcome.risk.kill_switch_scope is KillSwitchScope.ACCOUNT
        assert adapter.submit_calls == []

    def test_engine_without_gate_behaves_exactly_as_parts_2_to_7(self) -> None:
        # No gate wired: core-only evaluation, unchanged semantics. This is
        # the compatibility guarantee for every construction predating
        # Part 8 (all of test_execution.py stays green on it).
        adapter = tx.StubTradingAdapter(simulated=True, result=tx.accepted_result())
        engine = self._engine(None, adapter)
        outcome = asyncio.run(engine.submit(tx.intent(), tx.healthy_context()))
        assert outcome.outcome is ExecutionOutcome.ACCEPTED


class TestPaperAndBacktestSimulatedRisk:
    def test_paper_session_enforces_the_gate_on_simulated_state(self) -> None:
        from tests import test_paper_trading as tp
        from wlct_trading.paper.session import (
            PaperTradingSession,
        )
        from wlct_trading.adapters.paper import PaperTradingAdapter

        config = tp.config()
        strategy = tp.make_strategy()
        gate = bridge_gate(
            bridge_config(tg.limit(RiskRuleId.MAX_ORDER_QUANTITY, "0.0000001"))
        )
        session = PaperTradingSession(
            config=config,
            strategy=strategy,
            adapter=PaperTradingAdapter(tp.Feed().provider),
            risk_gate=gate,
        )
        session.start()
        feed_book = tp.top(bid_qty="9", ask_qty="1")
        asyncio.run(session.on_book_top(feed_book))
        summary = session.stop()
        # The core engine (permissive limits) would approve the same signal -
        # paper test_paper_trading proves it produces a fill unimpeded - so
        # the denial here is attributable to the wired gate and nothing else.
        assert summary.simulated_orders == 0
        assert summary.risk_rejections >= 1
        assert summary.is_simulated is True

    def test_paper_without_gate_still_produces_its_fill(self) -> None:
        from tests import test_paper_trading as tp
        from wlct_trading.paper.session import PaperTradingSession
        from wlct_trading.adapters.paper import PaperTradingAdapter

        session = PaperTradingSession(
            config=tp.config(),
            strategy=tp.make_strategy(),
            adapter=PaperTradingAdapter(tp.Feed().provider),
        )
        session.start()
        asyncio.run(session.on_book_top(tp.top(bid_qty="9", ask_qty="1")))
        summary = session.stop()
        assert summary.simulated_orders >= 1
        assert summary.risk_rejections == 0

    def test_live_gate_in_a_paper_session_is_refused_at_construction(self) -> None:
        from tests import test_paper_trading as tp
        from wlct_trading.paper.session import (
            PaperTradingSession,
            PaperTradingSafetyError,
        )
        from wlct_trading.adapters.paper import PaperTradingAdapter

        live_gate = RiskGate(configuration=bridge_config(), simulated=False)
        with pytest.raises(PaperTradingSafetyError):
            PaperTradingSession(
                config=tp.config(),
                strategy=tp.make_strategy(),
                adapter=PaperTradingAdapter(tp.Feed().provider),
                risk_gate=live_gate,
            )

    def test_paper_session_config_still_exposes_no_credential_field(self) -> None:
        # unchanged from Part 6 - the gate addition must not widen the door.
        from wlct_trading.paper.session import PaperSessionConfig

        fields = set(PaperSessionConfig.__dataclass_fields__)
        assert "risk_gate" not in fields
        for banned in ("api_key", "secret", "api_secret", "passphrase", "token"):
            assert banned not in fields

    def test_backtest_runs_with_gate_over_simulated_state(self) -> None:
        from tests import test_backtest as tb
        from wlct_trading.backtest.engine import BacktestConfig, BacktestEngine

        gate = bridge_gate(
            bridge_config(tg.limit(RiskRuleId.MAX_ORDER_QUANTITY, "0.0000001"))
        )
        run = BacktestEngine(
            strategy=backtest_strategy(),
            dataset=tb.oscillating_dataset(),
            config=BacktestConfig(
                tenant_id="tenant-1",
                account_id="account-1",
                initial_capital=Decimal("10000"),
                risk_limits=tb.permissive(),
            ),
            risk_gate=gate,
        ).run()
        assert run.simulated_orders == 0
        assert any(key.startswith("GATE_") for key, _ in run.rejection_counts)

    def test_backtest_without_gate_matches_the_part_6_baseline(self) -> None:
        from tests import test_backtest as tb
        from wlct_trading.backtest.engine import BacktestConfig, BacktestEngine

        def build() -> object:
            return BacktestEngine(
                strategy=backtest_strategy(),
                dataset=tb.oscillating_dataset(),
                config=BacktestConfig(
                    tenant_id="tenant-1",
                    account_id="account-1",
                    initial_capital=Decimal("10000"),
                    risk_limits=tb.permissive(),
                ),
            ).run()

        first = build()
        second = build()
        assert first.configuration_hash == second.configuration_hash
        assert first.simulated_orders == second.simulated_orders
        # and the gated run changed the outcome, so "identical" above is not
        # an artefact of nothing ever happening:
        gate = bridge_gate(
            bridge_config(tg.limit(RiskRuleId.MAX_ORDER_QUANTITY, "0.0000001"))
        )
        gated = BacktestEngine(
            strategy=backtest_strategy(),
            dataset=tb.oscillating_dataset(),
            config=BacktestConfig(
                tenant_id="tenant-1",
                account_id="account-1",
                initial_capital=Decimal("10000"),
                risk_limits=tb.permissive(),
            ),
            risk_gate=gate,
        ).run()
        assert build().simulated_orders > 0
        assert gated.simulated_orders == 0
