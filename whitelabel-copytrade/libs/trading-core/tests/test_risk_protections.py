"""Kill-switch lifecycle, protection policy and direction classification.

Acceptance lines: kill switches cannot be bypassed (spec criterion 7),
triggered protections require explicit clearing (kill-switch state
section), protection actions are capability-removals only (automatic
protection section), and the direction classifier that the "no close-only
loophole" guarantee rests on.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from wlct_trading.enums import (
    KillSwitchScope,
    ProtectionAction,
    RiskEventSeverity,
    RiskRuleId,
    RiskSwitchStatus,
)
from wlct_trading.risk.protections import (
    AutomaticProtectionPolicy,
    KillSwitchLedger,
    KillSwitchRecord,
    ProtectionOccurrence,
    ProtectionTransitionError,
    SwitchTransition,
    classify_risk_direction,
)

NOW = 1_700_000_000_000_000


def record(
    scope: KillSwitchScope,
    target: str | None = None,
    status: RiskSwitchStatus = RiskSwitchStatus.INACTIVE,
    rule: RiskRuleId | None = None,
) -> KillSwitchRecord:
    return KillSwitchRecord(
        scope=scope,
        target=target,
        status=status,
        triggered_by_rule=rule,
    )


class TestRecordSanity:
    def test_global_must_not_carry_target(self) -> None:
        with pytest.raises(ProtectionTransitionError, match="must not carry a target"):
            KillSwitchRecord(
                scope=KillSwitchScope.GLOBAL, target="oops", status=RiskSwitchStatus.ACTIVE
            )

    def test_narrow_scopes_require_target(self) -> None:
        for scope in (
            KillSwitchScope.EXCHANGE,
            KillSwitchScope.ACCOUNT,
            KillSwitchScope.STRATEGY,
            KillSwitchScope.SYMBOL,
            KillSwitchScope.RISK,
        ):
            with pytest.raises(ProtectionTransitionError):
                KillSwitchRecord(scope=scope, target=None, status=RiskSwitchStatus.ACTIVE)

    def test_triggered_record_must_name_its_rule(self) -> None:
        with pytest.raises(ProtectionTransitionError, match="must name the rule"):
            KillSwitchRecord(
                scope=KillSwitchScope.SYMBOL,
                target="BTC-USDT",
                status=RiskSwitchStatus.TRIGGERED,
            )


class TestLifecycle:
    def test_engage_and_release_round_trip(self) -> None:
        ledger = KillSwitchLedger()
        engaged = ledger.with_transition(
            SwitchTransition(KillSwitchScope.GLOBAL, None, "ENGAGE"),
            now_micros=NOW,
            reason="suspected runaway",
        )
        blocked = engaged.blocking_for(
            exchange="binance", account_id="a", strategy_id="s", symbol="BTC-USDT"
        )
        assert blocked is not None
        assert blocked.record.reason == "suspected runaway"
        released = engaged.with_transition(
            SwitchTransition(KillSwitchScope.GLOBAL, None, "RELEASE"),
            now_micros=NOW + 1,
            reason="incident closed after review",
        )
        assert (
            released.blocking_for(
                exchange="binance", account_id="a", strategy_id="s", symbol="BTC-USDT"
            )
            is None
        )

    def test_no_op_transition_is_refused(self) -> None:
        ledger = KillSwitchLedger((record(KillSwitchScope.GLOBAL, status=RiskSwitchStatus.ACTIVE),))
        with pytest.raises(ProtectionTransitionError, match="already ACTIVE"):
            ledger.with_transition(
                SwitchTransition(KillSwitchScope.GLOBAL, None, "ENGAGE"), now_micros=NOW
            )

    def test_illegal_transitions_are_refused(self) -> None:
        triggered = KillSwitchLedger(
            (
                record(
                    KillSwitchScope.ACCOUNT,
                    "acct-1",
                    RiskSwitchStatus.TRIGGERED,
                    rule=RiskRuleId.MAX_DAILY_LOSS,
                ),
            )
        )
        # TRIGGERED -> ACTIVE is not in the table (a human re-arm is an ENGAGE
        # on a released record, not a promotion of an automatic trigger).
        with pytest.raises(ProtectionTransitionError):
            triggered.with_transition(
                SwitchTransition(KillSwitchScope.ACCOUNT, "acct-1", "ENGAGE"),
                now_micros=NOW,
            )
        # TRIGGERED -> INACTIVE directly is refused while explicit-clear is
        # required: acknowledge first, then clear.
        with pytest.raises(ProtectionTransitionError, match="acknowledgement"):
            triggered.with_transition(
                SwitchTransition(KillSwitchScope.ACCOUNT, "acct-1", "RELEASE"),
                now_micros=NOW,
            )

    def test_acknowledge_then_clear_sequence(self) -> None:
        ledger = KillSwitchLedger(
            (
                record(
                    KillSwitchScope.ACCOUNT,
                    "acct-1",
                    RiskSwitchStatus.TRIGGERED,
                    rule=RiskRuleId.MAX_DRAWDOWN,
                ),
            )
        )
        acked = ledger.with_transition(
            SwitchTransition(KillSwitchScope.ACCOUNT, "acct-1", "ACKNOWLEDGE"),
            now_micros=NOW + 5,
            reason="reviewed drawdown breach with risk owner",
        )
        # acknowledging changes the paper trail, not the halt:
        assert acked.blocking_for(
            exchange="binance", account_id="acct-1", strategy_id=None, symbol="BTC-USDT"
        ) is not None
        cleared = acked.with_transition(
            SwitchTransition(KillSwitchScope.ACCOUNT, "acct-1", "CLEAR"),
            now_micros=NOW + 9,
            reason="controls re-verified, remediation logged",
        )
        assert (
            cleared.blocking_for(
                exchange="binance",
                account_id="acct-1",
                strategy_id=None,
                symbol="BTC-USDT",
            )
            is None
        )
        winner = cleared.get(KillSwitchScope.ACCOUNT, "acct-1")
        assert winner is not None
        assert winner.status is RiskSwitchStatus.CLEARED
        assert winner.was_triggered

    def test_history_records_every_status(self) -> None:
        ledger = KillSwitchLedger(
            (
                record(
                    KillSwitchScope.SYMBOL,
                    "BTC-USDT",
                    RiskSwitchStatus.TRIGGERED,
                    rule=RiskRuleId.MAX_ORDER_RATE,
                ),
            )
        )
        acked = ledger.with_transition(
            SwitchTransition(KillSwitchScope.SYMBOL, "BTC-USDT", "ACKNOWLEDGE"),
            now_micros=NOW + 1,
        )
        current = acked.get(KillSwitchScope.SYMBOL, "BTC-USDT")
        assert current is not None
        statuses = [status for status, _ in current.history]
        assert statuses == [
            RiskSwitchStatus.TRIGGERED,
            RiskSwitchStatus.ACKNOWLEDGED,
        ]

    def test_trigger_requires_a_rule(self) -> None:
        with pytest.raises(ProtectionTransitionError, match="must name its rule"):
            KillSwitchLedger().with_transition(
                SwitchTransition(KillSwitchScope.ACCOUNT, "acct-1", "TRIGGER"),
                now_micros=NOW,
            )

    def test_priority_order_is_broadest_first(self) -> None:
        ledger = KillSwitchLedger(
            (
                record(
                    KillSwitchScope.SYMBOL,
                    "BTC-USDT",
                    RiskSwitchStatus.TRIGGERED,
                    rule=RiskRuleId.MAX_DAILY_LOSS,
                ),
                record(KillSwitchScope.GLOBAL, None, RiskSwitchStatus.ACTIVE),
                record(
                    KillSwitchScope.ACCOUNT,
                    "acct-1",
                    RiskSwitchStatus.TRIGGERED,
                    rule=RiskRuleId.MAX_DRAWDOWN,
                ),
            )
        )
        blocked = ledger.blocking_for(
            exchange="binance", account_id="acct-1", strategy_id="s", symbol="BTC-USDT"
        )
        assert blocked is not None
        assert blocked.scope is KillSwitchScope.GLOBAL

    def test_risk_scope_target_shape(self) -> None:
        ledger = KillSwitchLedger(
            (
                record(
                    KillSwitchScope.RISK,
                    "account:acct-1",
                    RiskSwitchStatus.TRIGGERED,
                    rule=RiskRuleId.MAX_DAILY_LOSS,
                ),
            )
        )
        assert (
            ledger.blocking_for(
                exchange="binance",
                account_id="acct-1",
                strategy_id="s",
                symbol="X",
            )
            is not None
        )
        assert (
            ledger.blocking_for(
                exchange="binance",
                account_id="acct-2",
                strategy_id="s",
                symbol="X",
            )
            is None
        )


class TestClassification:
    def test_reduce_only_is_never_increasing(self) -> None:
        assert (
            classify_risk_direction(
                reduce_only=True,
                current_signed=Decimal("2"),
                projected_signed=Decimal("7"),
            )
            is False
        )

    def test_increase_from_any_side(self) -> None:
        assert (
            classify_risk_direction(
                reduce_only=False,
                current_signed=Decimal("2"),
                projected_signed=Decimal("3"),
            )
            is True
        )
        assert (
            classify_risk_direction(
                reduce_only=False,
                current_signed=Decimal("-2"),
                projected_signed=Decimal("-3"),
            )
            is True
        )

    def test_close_and_scratch_are_not_increasing(self) -> None:
        assert (
            classify_risk_direction(
                reduce_only=False,
                current_signed=Decimal("2"),
                projected_signed=Decimal("1"),
            )
            is False
        )
        assert (
            classify_risk_direction(
                reduce_only=False,
                current_signed=Decimal("2"),
                projected_signed=Decimal("2"),
            )
            is False
        )

    def test_flip_through_zero_to_bigger_absolute_is_increasing(self) -> None:
        # The loophole-killer: "closing" +2 with a 5-lot sell lands at -3,
        # which is MORE absolute exposure than +2. An unflagged order doing
        # this increases risk, whatever the strategy calls it.
        assert (
            classify_risk_direction(
                reduce_only=False,
                current_signed=Decimal("2"),
                projected_signed=Decimal("-3"),
            )
            is True
        )


class TestPolicyAndOccurrences:
    def test_policy_defaults_are_all_capability_removals(self) -> None:
        policy = AutomaticProtectionPolicy()
        for action in (
            policy.daily_loss_action,
            policy.strategy_daily_loss_action,
            policy.drawdown_action,
            policy.consecutive_losses_action,
            policy.order_rate_action,
            policy.cancel_rate_action,
            policy.stale_risk_state_action,
        ):
            assert action in set(ProtectionAction)
            assert action is not None

    def test_payload_roundtrip(self) -> None:
        policy = AutomaticProtectionPolicy(
            daily_loss_action=ProtectionAction.BLOCK_ACCOUNT,
            allow_risk_reducing_orders=False,
        )
        payload = policy.to_payload()
        rebuilt = AutomaticProtectionPolicy.from_payload(payload)
        assert rebuilt.daily_loss_action is ProtectionAction.BLOCK_ACCOUNT
        assert rebuilt.allow_risk_reducing_orders is False

    def test_unknown_action_in_payload_is_refused(self) -> None:
        with pytest.raises(ProtectionTransitionError, match="Unknown protection action"):
            AutomaticProtectionPolicy.from_payload(
                {
                    "dailyLossAction": "LIQUIDATE_EVERYTHING",
                    "strategyDailyLossAction": "BLOCK_STRATEGY",
                    "drawdownAction": "BLOCK_ACCOUNT",
                    "consecutiveLossesAction": "BLOCK_STRATEGY",
                    "orderRateAction": "BLOCK_STRATEGY",
                    "cancelRateAction": "BLOCK_STRATEGY",
                    "staleRiskStateAction": "BLOCK_NEW_RISK",
                    "allowRiskReducingOrders": True,
                }
            )

    def test_occurrence_switch_mapping(self) -> None:
        occurrence = ProtectionOccurrence(
            rule_id=RiskRuleId.MAX_DAILY_LOSS,
            action=ProtectionAction.BLOCK_NEW_RISK,
            account_id="acct-1",
            strategy_id="strat-1",
            symbol="BTC-USDT",
            exchange="binance",
            reason="net daily loss 600 >= 500",
            severity=RiskEventSeverity.CRITICAL,
            occurred_at_micros=NOW,
        )
        assert occurrence.switch_scope is KillSwitchScope.RISK
        assert occurrence.switch_target == "account:acct-1"

        exchange_stop = ProtectionOccurrence(
            rule_id=RiskRuleId.MAX_ORDER_RATE,
            action=ProtectionAction.BLOCK_EXCHANGE,
            account_id="acct-1",
            strategy_id="strat-1",
            symbol="BTC-USDT",
            exchange="binance",
            reason="rate abuse",
            severity=RiskEventSeverity.CRITICAL,
            occurred_at_micros=NOW,
        )
        assert exchange_stop.switch_scope is KillSwitchScope.EXCHANGE
        assert exchange_stop.switch_target == "binance"

    def test_strategy_action_without_strategy_escalates_to_account_risk(self) -> None:
        occurrence = ProtectionOccurrence(
            rule_id=RiskRuleId.MAX_CONSECUTIVE_LOSSES,
            action=ProtectionAction.BLOCK_STRATEGY,
            account_id="acct-1",
            strategy_id=None,
            symbol="BTC-USDT",
            exchange="binance",
            reason="manual strategy streak without attribution",
            severity=RiskEventSeverity.CRITICAL,
            occurred_at_micros=NOW,
        )
        # No invented targets: a strategy-scoped halt with no strategy is
        # recorded at account-risk scope, and the event trail can show it.
        assert occurrence.switch_target == "account:acct-1"
