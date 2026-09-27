"""RiskReplay: deterministic reconstruction, digests, and the no-trading proof.

Acceptance lines: risk replay utility (spec "RISK REPLAY" section, audit
only), risk-event persistence shape through the replayed events, and the
guarantee that a replay of identical history reproduces identical verdicts -
while a replay of *tampered* history produces different verdicts instead of
silently absorbing the change.
"""

from __future__ import annotations

from dataclasses import replace
from decimal import Decimal

from wlct_trading.enums import (
    ExchangeId,
    OrderSide,
    OrderType,
    RiskDecisionCode,
    RiskEventKind,
    TimeInForce,
)
from wlct_trading.orders import Fill, OrderIntent
from wlct_trading.risk.replay import (
    ReplayDecision,
    ReplayStep,
    ReplayStepKind,
    RiskReplay,
)
from tests import test_risk_gate as tg

BASE_TS = 1_700_000_000_000_000
D = Decimal


def fill(
    fill_id: str,
    *,
    order_id: str,
    side: OrderSide,
    price: str,
    quantity: str = "1",
    fee: str = "0",
    ts: int,
) -> Fill:
    return Fill(
        fill_id=fill_id,
        order_id=order_id,
        trade_id=f"trade-{fill_id}",
        price=D(price),
        quantity=D(quantity),
        fee=D(fee),
        fee_currency="USDT",
        is_maker=False,
        is_simulated=True,
        exchange_timestamp=ts,
        received_timestamp=ts,
        symbol=tg.SYMBOL,
        side=side,
        exchange=ExchangeId.BINANCE,
    )


def order(
    side: OrderSide,
    *,
    client_id: str,
    price: str,
    quantity: str = "1",
    reduce_only: bool = False,
) -> OrderIntent:
    return OrderIntent(
        tenant_id="tenant-1",
        account_id="acct-1",
        strategy_id="strat-1",
        exchange=ExchangeId.BINANCE,
        symbol=tg.SYMBOL,
        side=side,
        order_type=OrderType.LIMIT,
        quantity=D(quantity),
        price=D(price),
        reduce_only=reduce_only,
        time_in_force=TimeInForce.GTC,
        client_order_id=client_id,
    )


def steps_history():
    """Buy 1@100, sell 1@85 (realised -5 -> breach), attempt to re-enter."""
    from wlct_trading.enums import RiskRuleId

    config = tg.config_with(
        *tg.BASELINE,
        tg.limit(RiskRuleId.MAX_DAILY_LOSS, "5"),
    )
    steps = [
        ReplayStep(
            kind=ReplayStepKind.MARKET_UPDATE,
            timestamp_micros=BASE_TS,
            sequence=0,
            identity="m0",
            symbol=tg.SYMBOL,
            best_bid=D("89"),
            best_ask=D("91"),
            last_trade_price=D("90"),
        ),
        ReplayStep(
            kind=ReplayStepKind.ORDER_SUBMIT,
            timestamp_micros=BASE_TS + 1,
            sequence=1,
            identity="s1",
            intent=order(OrderSide.BUY, client_id="c-1", price="90"),
        ),
        ReplayStep(
            kind=ReplayStepKind.FILL,
            timestamp_micros=BASE_TS + 2,
            sequence=2,
            identity="f-1",
            fill=fill(
                "f-1", order_id="c-1", side=OrderSide.BUY, price="90", fee="0.09", ts=BASE_TS + 2
            ),
        ),
        ReplayStep(
            kind=ReplayStepKind.MARKET_UPDATE,
            timestamp_micros=BASE_TS + 3,
            sequence=3,
            identity="m1",
            symbol=tg.SYMBOL,
            best_bid=D("84"),
            best_ask=D("86"),
            last_trade_price=D("85"),
        ),
        ReplayStep(
            kind=ReplayStepKind.ORDER_SUBMIT,
            timestamp_micros=BASE_TS + 4,
            sequence=4,
            identity="s2",
            intent=order(OrderSide.SELL, client_id="c-2", price="85"),
        ),
        ReplayStep(
            kind=ReplayStepKind.FILL,
            timestamp_micros=BASE_TS + 5,
            sequence=5,
            identity="f-2",
            fill=fill(
                "f-2", order_id="c-2", side=OrderSide.SELL, price="85", fee="0.09", ts=BASE_TS + 5
            ),
        ),
        # re-entry attempt: realised -5, fees 0.18 -> net loss 5.18 >= 5
        ReplayStep(
            kind=ReplayStepKind.ORDER_SUBMIT,
            timestamp_micros=BASE_TS + 6,
            sequence=6,
            identity="s3",
            intent=order(OrderSide.BUY, client_id="c-3", price="85"),
        ),
    ]
    return config, steps


class TestReplayReproduction:
    def test_history_replays_the_expected_decision_sequence(self) -> None:
        config, steps = steps_history()
        replay = RiskReplay(
            tenant_id="tenant-1",
            account_id="acct-1",
            initial_configuration=config,
        )
        result = replay.run(steps, starting_equity=D("10000"), starting_available=D("10000"))
        codes = [decision.code for decision in result.decisions]
        assert codes == [
            RiskDecisionCode.APPROVED,
            RiskDecisionCode.APPROVED,
            RiskDecisionCode.DAILY_LOSS_LIMIT_BREACHED,
        ]
        assert [d.approved for d in result.decisions] == [True, True, False]

    def test_final_positions_are_derived_from_fills_only(self) -> None:
        config, steps = steps_history()
        result = RiskReplay(
            tenant_id="tenant-1",
            account_id="acct-1",
            initial_configuration=config,
        ).run(steps, starting_equity=D("10000"), starting_available=D("10000"))
        assert result.final_positions == ()  # round trip: flat

    def test_same_history_same_digests(self) -> None:
        config, steps = steps_history()
        runner = RiskReplay(
            tenant_id="tenant-1",
            account_id="acct-1",
            initial_configuration=config,
        )
        a = runner.run(steps, starting_equity=D("10000"), starting_available=D("10000"))
        b = runner.run(steps, starting_equity=D("10000"), starting_available=D("10000"))
        assert a.decision_digest == b.decision_digest
        assert a.state_digest == b.state_digest
        assert a.event_digest == b.event_digest

    def test_input_order_does_not_matter(self) -> None:
        config, steps = steps_history()
        runner = RiskReplay(
            tenant_id="tenant-1",
            account_id="acct-1",
            initial_configuration=config,
        )
        forward = runner.run(steps, starting_equity=D("10000"), starting_available=D("10000"))
        backward = runner.run(
            list(reversed(steps)),
            starting_equity=D("10000"),
            starting_available=D("10000"),
        )
        assert forward.decision_digest == backward.decision_digest

    def test_tampered_fill_price_changes_the_verdict(self) -> None:
        # A profitable exit (sell at 96) never breaches the loss limit; the
        # replay must reproduce THAT, not launder history into the verdict
        # the original archive recorded.
        _config, steps = steps_history()
        tampered = [
            replace(
                step,
                fill=replace(step.fill, price=D("96")),
            )
            if step.kind is ReplayStepKind.FILL and step.identity == "f-2"
            else step
            for step in steps
        ]
        config = tg.config_with(
            *tg.BASELINE,
            tg.limit(tg.RiskRuleId.MAX_DAILY_LOSS, "5"),
        )
        result = RiskReplay(
            tenant_id="tenant-1",
            account_id="acct-1",
            initial_configuration=config,
        ).run(tampered, starting_equity=D("10000"), starting_available=D("10000"))
        assert all(d.approved for d in result.decisions)
        # and the digests moved with the content
        clean = RiskReplay(
            tenant_id="tenant-1",
            account_id="acct-1",
            initial_configuration=config,
        ).run(steps, starting_equity=D("10000"), starting_available=D("10000"))
        assert result.decision_digest != clean.decision_digest

    def test_replayed_events_reproduce_the_protection_trail(self) -> None:
        config, steps = steps_history()
        result = RiskReplay(
            tenant_id="tenant-1",
            account_id="acct-1",
            initial_configuration=config,
        ).run(steps, starting_equity=D("10000"), starting_available=D("10000"))
        breaches = [
            event
            for event in result.events
            if event.kind is RiskEventKind.LIMIT_BREACHED
        ]
        assert breaches, "the daily-loss breach must appear in the trail"
        assert all(event.is_simulated for event in result.events)

    def test_duplicate_fills_apply_once(self) -> None:
        config, steps = steps_history()
        dupe = [step for step in steps if step.identity == "f-1"][0]
        doubled = list(steps) + [
            replace(dupe, sequence=99)  # same fill id, different position
        ]
        runner = RiskReplay(
            tenant_id="tenant-1",
            account_id="acct-1",
            initial_configuration=config,
        )
        with_dupes = runner.run(doubled, starting_equity=D("10000"), starting_available=D("10000"))
        single = runner.run(steps, starting_equity=D("10000"), starting_available=D("10000"))
        assert with_dupes.state_digest == single.state_digest

    def test_configuration_change_flows_through_the_replay(self) -> None:
        from wlct_trading.enums import RiskRuleId

        before = tg.config_with(*tg.BASELINE, tg.limit(RiskRuleId.MAX_ORDER_QUANTITY, "0.5"))
        after = tg.config_with(*tg.BASELINE, tg.limit(RiskRuleId.MAX_ORDER_QUANTITY, "5"))
        tight_order = order(OrderSide.BUY, client_id="cfg-1", price="90", quantity="2")
        steps = [
            ReplayStep(
                kind=ReplayStepKind.MARKET_UPDATE,
                timestamp_micros=BASE_TS,
                sequence=0,
                identity="m",
                symbol=tg.SYMBOL,
                best_bid=D("89"),
                best_ask=D("91"),
                last_trade_price=D("90"),
            ),
            ReplayStep(
                kind=ReplayStepKind.ORDER_SUBMIT,
                timestamp_micros=BASE_TS + 1,
                sequence=1,
                identity="s-before",
                intent=tight_order,
            ),
            ReplayStep(
                kind=ReplayStepKind.CONFIG_CHANGE,
                timestamp_micros=BASE_TS + 2,
                sequence=2,
                identity="cfg",
                configuration=after,
            ),
            ReplayStep(
                kind=ReplayStepKind.ORDER_SUBMIT,
                timestamp_micros=BASE_TS + 3,
                sequence=3,
                identity="s-after",
                intent=order(OrderSide.BUY, client_id="cfg-2", price="90", quantity="2"),
            ),
        ]
        result = RiskReplay(
            tenant_id="tenant-1",
            account_id="acct-1",
            initial_configuration=before,
        ).run(steps, starting_equity=D("10000"), starting_available=D("10000"))
        assert [d.approved for d in result.decisions] == [False, True]
        assert result.decisions[0].code is RiskDecisionCode.MAX_ORDER_SIZE_EXCEEDED

    def test_result_payload_is_wire_shaped_and_self_describing(self) -> None:
        config, steps = steps_history()
        result = RiskReplay(
            tenant_id="tenant-1",
            account_id="acct-1",
            initial_configuration=config,
        ).run(steps, starting_equity=D("10000"), starting_available=D("10000"))
        payload = result.to_payload()
        assert payload["isSimulated"] is True
        assert payload["stepsReplayed"] == 7
        assert isinstance(payload["decisions"], list)
        first = payload["decisions"][0]
        assert set(first) == {
            "stepSequence",
            "timestampMicros",
            "decisionId",
            "code",
            "approved",
            "snapshotVersion",
            "ruleOutcomes",
        }
        _ = ReplayDecision, OrderSide, OrderType  # re-export sanity for readers

    def test_run_requires_attributed_fills(self) -> None:
        config, _steps = steps_history()
        naked = fill(
            "f-x", order_id="c-x", side=OrderSide.BUY, price="90", ts=BASE_TS
        )
        naked = replace(naked, symbol=None)
        import pytest

        with pytest.raises(ValueError, match="attribution"):
            RiskReplay(
                tenant_id="tenant-1",
                account_id="acct-1",
                initial_configuration=config,
            ).run(
                [
                    ReplayStep(
                        kind=ReplayStepKind.FILL,
                        timestamp_micros=BASE_TS,
                        sequence=0,
                        identity="f-x",
                        fill=naked,
                    )
                ],
                starting_equity=D("10000"),
            )
