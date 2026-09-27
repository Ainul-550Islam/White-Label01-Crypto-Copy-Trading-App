"""Risk engine: limits, kill switches, layering and fail-closed behaviour."""

from __future__ import annotations

from dataclasses import replace
from decimal import Decimal

from wlct_trading.enums import (
    KillSwitchScope,
    OrderSide,
    OrderType,
    RiskDecisionCode,
    TradingMode,
)
from wlct_trading.risk import (
    KillSwitchState,
    RiskEngine,
    RiskLimits,
    TradingModeResolver,
)

from tests.conftest import EXCHANGE, SYMBOL


def evaluate(engine, intent, snapshot, kill_switches, **kwargs):
    return engine.evaluate(
        intent,
        snapshot=snapshot,
        kill_switches=kill_switches,
        trading_mode=kwargs.pop("trading_mode", TradingMode.PAPER),
        **kwargs,
    )


class TestApproval:
    def test_a_clean_intent_is_approved(
        self, engine, make_intent, clean_snapshot, no_kill_switches
    ) -> None:
        decision = evaluate(engine, make_intent(), clean_snapshot, no_kill_switches)

        assert decision.approved is True
        assert decision.code is RiskDecisionCode.APPROVED
        assert decision.violations == ()
        assert decision.would_route is True

    def test_approved_but_disabled_mode_does_not_route(
        self, engine, make_intent, clean_snapshot, no_kill_switches
    ) -> None:
        decision = evaluate(
            engine,
            make_intent(),
            clean_snapshot,
            no_kill_switches,
            trading_mode=TradingMode.DISABLED,
        )

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.TRADING_DISABLED
        assert decision.would_route is False


class TestKillSwitch:
    def test_global_kill_switch_blocks_everything(
        self, engine, make_intent, clean_snapshot
    ) -> None:
        decision = evaluate(
            engine,
            make_intent(),
            clean_snapshot,
            KillSwitchState(global_engaged=True, reason="incident 42"),
        )

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.KILL_SWITCH_ENGAGED
        assert decision.kill_switch_scope is KillSwitchScope.GLOBAL
        assert "incident 42" in decision.rejection_summary

    def test_exchange_kill_switch_blocks_that_venue(
        self, engine, make_intent, clean_snapshot
    ) -> None:
        decision = evaluate(
            engine,
            make_intent(),
            clean_snapshot,
            KillSwitchState(engaged_exchanges=frozenset({EXCHANGE.value})),
        )

        assert decision.approved is False
        assert decision.kill_switch_scope is KillSwitchScope.EXCHANGE

    def test_strategy_kill_switch_blocks_that_strategy(
        self, engine, make_intent, clean_snapshot
    ) -> None:
        decision = evaluate(
            engine,
            make_intent(),
            clean_snapshot,
            KillSwitchState(engaged_strategies=frozenset({"strategy-1"})),
        )

        assert decision.approved is False
        assert decision.kill_switch_scope is KillSwitchScope.STRATEGY

    def test_symbol_kill_switch_blocks_that_symbol(
        self, engine, make_intent, clean_snapshot
    ) -> None:
        decision = evaluate(
            engine,
            make_intent(),
            clean_snapshot,
            KillSwitchState(engaged_symbols=frozenset({SYMBOL})),
        )

        assert decision.approved is False
        assert decision.kill_switch_scope is KillSwitchScope.SYMBOL

    def test_unrelated_switch_does_not_block(
        self, engine, make_intent, clean_snapshot
    ) -> None:
        decision = evaluate(
            engine,
            make_intent(),
            clean_snapshot,
            KillSwitchState(
                engaged_symbols=frozenset({"ETH-USDT"}),
                engaged_strategies=frozenset({"strategy-9"}),
                engaged_exchanges=frozenset({"kraken"}),
            ),
        )

        assert decision.approved is True

    def test_kill_switch_precedes_every_other_check(
        self, engine, make_intent, clean_snapshot
    ) -> None:
        """An engaged switch short-circuits even a structurally invalid intent."""
        broken = make_intent(quantity="-5")
        decision = evaluate(
            engine, broken, clean_snapshot, KillSwitchState(global_engaged=True)
        )

        assert decision.code is RiskDecisionCode.KILL_SWITCH_ENGAGED


class TestFailClosed:
    def test_incomplete_risk_state_rejects(
        self, engine, make_intent, clean_snapshot, no_kill_switches
    ) -> None:
        decision = evaluate(
            engine,
            make_intent(),
            replace(clean_snapshot, is_complete=False),
            no_kill_switches,
        )

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.RISK_STATE_UNAVAILABLE

    def test_missing_limit_rejects_rather_than_allowing(
        self, make_intent, clean_snapshot, no_kill_switches
    ) -> None:
        """An unconfigured limit is never treated as 'unlimited'."""
        engine = RiskEngine(platform_limits=RiskLimits())

        decision = evaluate(engine, make_intent(), clean_snapshot, no_kill_switches)

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.RISK_STATE_UNAVAILABLE

    def test_market_order_without_reference_price_rejects(
        self, engine, make_intent, clean_snapshot, no_kill_switches
    ) -> None:
        decision = evaluate(
            engine,
            make_intent(order_type=OrderType.MARKET, price=None),
            replace(clean_snapshot, reference_price=None),
            no_kill_switches,
        )

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.STALE_MARKET_DATA

    def test_stale_market_data_rejects_market_order(
        self, engine, make_intent, clean_snapshot, no_kill_switches
    ) -> None:
        decision = evaluate(
            engine,
            make_intent(order_type=OrderType.MARKET, price=None),
            replace(clean_snapshot, market_data_age_micros=120_000_000),
            no_kill_switches,
        )

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.STALE_MARKET_DATA


class TestMaxOrderSize:
    def test_order_at_the_limit_is_allowed(
        self, make_intent, clean_snapshot, no_kill_switches, permissive_limits
    ) -> None:
        engine = RiskEngine(replace(permissive_limits, max_order_quantity=Decimal("5")))

        decision = evaluate(
            engine, make_intent(quantity="5"), clean_snapshot, no_kill_switches
        )

        assert decision.approved is True

    def test_order_above_the_limit_is_rejected(
        self, make_intent, clean_snapshot, no_kill_switches, permissive_limits
    ) -> None:
        engine = RiskEngine(replace(permissive_limits, max_order_quantity=Decimal("5")))

        decision = evaluate(
            engine, make_intent(quantity="5.0001"), clean_snapshot, no_kill_switches
        )

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.MAX_ORDER_SIZE_EXCEEDED
        assert decision.violations[0].limit == "5"

    def test_notional_limit_is_enforced_independently(
        self, make_intent, clean_snapshot, no_kill_switches, permissive_limits
    ) -> None:
        engine = RiskEngine(
            replace(permissive_limits, max_order_notional=Decimal("10000"))
        )

        # 1 unit at 30 000 is well inside the quantity limit but not the notional.
        decision = evaluate(
            engine, make_intent(quantity="1"), clean_snapshot, no_kill_switches
        )

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.MAX_ORDER_NOTIONAL_EXCEEDED


class TestMaxPositionSize:
    def test_resulting_position_within_limit_is_allowed(
        self, make_intent, clean_snapshot, no_kill_switches, permissive_limits
    ) -> None:
        engine = RiskEngine(
            replace(permissive_limits, max_position_quantity=Decimal("10"))
        )

        decision = evaluate(
            engine,
            make_intent(quantity="3"),
            replace(clean_snapshot, position_quantity=Decimal("7")),
            no_kill_switches,
        )

        assert decision.approved is True

    def test_resulting_position_above_limit_is_rejected(
        self, make_intent, clean_snapshot, no_kill_switches, permissive_limits
    ) -> None:
        engine = RiskEngine(
            replace(permissive_limits, max_position_quantity=Decimal("10"))
        )

        decision = evaluate(
            engine,
            make_intent(quantity="4"),
            replace(clean_snapshot, position_quantity=Decimal("7")),
            no_kill_switches,
        )

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.MAX_POSITION_SIZE_EXCEEDED

    def test_short_side_uses_absolute_magnitude(
        self, make_intent, clean_snapshot, no_kill_switches, permissive_limits
    ) -> None:
        engine = RiskEngine(
            replace(permissive_limits, max_position_quantity=Decimal("10"))
        )

        decision = evaluate(
            engine,
            make_intent(side=OrderSide.SELL, quantity="4"),
            replace(clean_snapshot, position_quantity=Decimal("-7")),
            no_kill_switches,
        )

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.MAX_POSITION_SIZE_EXCEEDED

    def test_reduce_only_bypasses_the_position_ceiling(
        self, make_intent, clean_snapshot, no_kill_switches, permissive_limits
    ) -> None:
        """An order that can only shrink exposure cannot breach a cap."""
        engine = RiskEngine(
            replace(permissive_limits, max_position_quantity=Decimal("1"))
        )

        decision = evaluate(
            engine,
            make_intent(side=OrderSide.SELL, quantity="7", reduce_only=True),
            replace(clean_snapshot, position_quantity=Decimal("7")),
            no_kill_switches,
        )

        assert decision.approved is True

    def test_opposite_side_order_reduces_projected_position(
        self, make_intent, clean_snapshot, no_kill_switches, permissive_limits
    ) -> None:
        engine = RiskEngine(
            replace(permissive_limits, max_position_quantity=Decimal("10"))
        )

        decision = evaluate(
            engine,
            make_intent(side=OrderSide.SELL, quantity="4"),
            replace(clean_snapshot, position_quantity=Decimal("9")),
            no_kill_switches,
        )

        assert decision.approved is True


class TestExposureAndBudgets:
    def test_symbol_exposure_limit(
        self, make_intent, clean_snapshot, no_kill_switches, permissive_limits
    ) -> None:
        engine = RiskEngine(
            replace(permissive_limits, max_symbol_exposure_notional=Decimal("40000"))
        )

        decision = evaluate(
            engine,
            make_intent(quantity="1"),
            replace(clean_snapshot, symbol_exposure_notional=Decimal("20000")),
            no_kill_switches,
        )

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.MAX_SYMBOL_EXPOSURE_EXCEEDED

    def test_account_exposure_limit(
        self, make_intent, clean_snapshot, no_kill_switches, permissive_limits
    ) -> None:
        engine = RiskEngine(
            replace(permissive_limits, max_account_exposure_notional=Decimal("35000"))
        )

        decision = evaluate(
            engine,
            make_intent(quantity="1"),
            replace(clean_snapshot, account_exposure_notional=Decimal("10000")),
            no_kill_switches,
        )

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.MAX_ACCOUNT_EXPOSURE_EXCEEDED

    def test_open_order_cap(
        self, make_intent, clean_snapshot, no_kill_switches, permissive_limits
    ) -> None:
        engine = RiskEngine(replace(permissive_limits, max_open_orders=3))

        decision = evaluate(
            engine,
            make_intent(),
            replace(clean_snapshot, open_order_count=3),
            no_kill_switches,
        )

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.MAX_OPEN_ORDERS_EXCEEDED

    def test_order_rate_cap(
        self, make_intent, clean_snapshot, no_kill_switches, permissive_limits
    ) -> None:
        engine = RiskEngine(replace(permissive_limits, max_orders_per_minute=60))

        decision = evaluate(
            engine,
            make_intent(),
            replace(clean_snapshot, orders_in_last_minute=60),
            no_kill_switches,
        )

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.ORDER_RATE_EXCEEDED


class TestLossLimits:
    def test_daily_loss_limit_halts_trading(
        self, make_intent, clean_snapshot, no_kill_switches, permissive_limits
    ) -> None:
        engine = RiskEngine(replace(permissive_limits, max_daily_loss=Decimal("500")))

        decision = evaluate(
            engine,
            make_intent(),
            replace(clean_snapshot, realised_pnl_today=Decimal("-500")),
            no_kill_switches,
        )

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.DAILY_LOSS_LIMIT_BREACHED

    def test_profit_never_trips_a_loss_limit(
        self, make_intent, clean_snapshot, no_kill_switches, permissive_limits
    ) -> None:
        engine = RiskEngine(replace(permissive_limits, max_daily_loss=Decimal("500")))

        decision = evaluate(
            engine,
            make_intent(),
            replace(clean_snapshot, realised_pnl_today=Decimal("5000")),
            no_kill_switches,
        )

        assert decision.approved is True

    def test_strategy_loss_limit_is_separate(
        self, make_intent, clean_snapshot, no_kill_switches, permissive_limits
    ) -> None:
        engine = RiskEngine(
            replace(permissive_limits, max_strategy_loss=Decimal("100"))
        )

        decision = evaluate(
            engine,
            make_intent(),
            replace(clean_snapshot, strategy_realised_pnl_today=Decimal("-150")),
            no_kill_switches,
        )

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.STRATEGY_LOSS_LIMIT_BREACHED


class TestLimitLayering:
    def test_strategy_limit_tightens_the_platform_limit(
        self, engine, make_intent, clean_snapshot, no_kill_switches
    ) -> None:
        decision = evaluate(
            engine,
            make_intent(quantity="10"),
            clean_snapshot,
            no_kill_switches,
            strategy_limits=RiskLimits(max_order_quantity=Decimal("5")),
        )

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.MAX_ORDER_SIZE_EXCEEDED

    def test_strategy_limit_cannot_widen_the_platform_limit(
        self, make_intent, clean_snapshot, no_kill_switches, permissive_limits
    ) -> None:
        engine = RiskEngine(replace(permissive_limits, max_order_quantity=Decimal("2")))

        decision = evaluate(
            engine,
            make_intent(quantity="10"),
            clean_snapshot,
            no_kill_switches,
            strategy_limits=RiskLimits(max_order_quantity=Decimal("1000")),
        )

        assert decision.approved is False
        assert decision.violations[0].limit == "2"

    def test_tightest_of_three_layers_wins(self) -> None:
        platform = RiskLimits(max_order_quantity=Decimal("100"))
        account = RiskLimits(max_order_quantity=Decimal("50"))
        strategy = RiskLimits(max_order_quantity=Decimal("7"))

        combined = platform.tightest_with(account).tightest_with(strategy)

        assert combined.max_order_quantity == Decimal("7")

    def test_none_defers_to_the_other_layer(self) -> None:
        combined = RiskLimits().tightest_with(
            RiskLimits(max_order_quantity=Decimal("9"))
        )
        assert combined.max_order_quantity == Decimal("9")


class TestGating:
    def test_disabled_strategy_is_rejected(
        self, engine, make_intent, clean_snapshot, no_kill_switches
    ) -> None:
        decision = evaluate(
            engine,
            make_intent(),
            clean_snapshot,
            no_kill_switches,
            strategy_enabled=False,
        )

        assert decision.code is RiskDecisionCode.STRATEGY_DISABLED

    def test_untradeable_symbol_is_rejected(
        self, engine, make_intent, clean_snapshot, no_kill_switches
    ) -> None:
        decision = evaluate(
            engine,
            make_intent(),
            clean_snapshot,
            no_kill_switches,
            symbol_tradeable=False,
        )

        assert decision.code is RiskDecisionCode.SYMBOL_NOT_TRADEABLE

    def test_invalid_intent_is_rejected(
        self, engine, make_intent, clean_snapshot, no_kill_switches
    ) -> None:
        decision = evaluate(
            engine, make_intent(quantity="0"), clean_snapshot, no_kill_switches
        )

        assert decision.code is RiskDecisionCode.INVALID_INTENT

    def test_duplicate_client_order_id_is_rejected(
        self, engine, make_intent, clean_snapshot, no_kill_switches
    ) -> None:
        decision = evaluate(
            engine,
            make_intent(client_order_id="wlct-abc"),
            replace(clean_snapshot, known_client_order_ids=frozenset({"wlct-abc"})),
            no_kill_switches,
        )

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.DUPLICATE_ORDER


class TestPriceDeviation:
    def test_price_far_from_reference_is_rejected(
        self, make_intent, clean_snapshot, no_kill_switches, permissive_limits
    ) -> None:
        engine = RiskEngine(
            replace(permissive_limits, max_price_deviation_percent=Decimal("2"))
        )

        # Reference is 30 000; a 45 000 limit is 50% away.
        decision = evaluate(
            engine, make_intent(price="45000"), clean_snapshot, no_kill_switches
        )

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.PRICE_DEVIATION_EXCEEDED

    def test_price_near_reference_is_accepted(
        self, make_intent, clean_snapshot, no_kill_switches, permissive_limits
    ) -> None:
        engine = RiskEngine(
            replace(permissive_limits, max_price_deviation_percent=Decimal("2"))
        )

        decision = evaluate(
            engine, make_intent(price="30100"), clean_snapshot, no_kill_switches
        )

        assert decision.approved is True


class TestTradingModeResolver:
    def test_default_configuration_disables_trading(self) -> None:
        resolved = TradingModeResolver(
            mode=None, trading_enabled=False, live_confirmed=False
        ).resolve()
        assert resolved is TradingMode.DISABLED

    def test_omitted_mode_never_yields_live(self) -> None:
        resolved = TradingModeResolver(
            mode=None, trading_enabled=True, live_confirmed=True
        ).resolve()
        assert resolved is TradingMode.DISABLED

    def test_paper_requires_only_mode_and_enable(self) -> None:
        resolved = TradingModeResolver(
            mode="PAPER", trading_enabled=True, live_confirmed=False
        ).resolve()
        assert resolved is TradingMode.PAPER

    def test_live_requires_all_three_settings(self) -> None:
        resolved = TradingModeResolver(
            mode="LIVE", trading_enabled=True, live_confirmed=True
        ).resolve()
        assert resolved is TradingMode.LIVE

    def test_unconfirmed_live_disables_rather_than_downgrades(self) -> None:
        """Silently falling back to paper would hide a production misconfig."""
        resolver = TradingModeResolver(
            mode="LIVE", trading_enabled=True, live_confirmed=False
        )

        assert resolver.resolve() is TradingMode.DISABLED
        assert "LIVE_TRADING_CONFIRMED" in resolver.describe()

    def test_live_with_trading_disabled_is_disabled(self) -> None:
        resolved = TradingModeResolver(
            mode="LIVE", trading_enabled=False, live_confirmed=True
        ).resolve()
        assert resolved is TradingMode.DISABLED

    def test_unknown_mode_string_is_disabled(self) -> None:
        resolved = TradingModeResolver(
            mode="live-ish", trading_enabled=True, live_confirmed=True
        ).resolve()
        assert resolved is TradingMode.DISABLED
