"""Signal validation and the signal-to-intent translation."""

from __future__ import annotations

from decimal import Decimal

import pytest

from wlct_trading.enums import OrderSide, OrderType, SignalAction
from wlct_trading.signals import (
    BaseStrategy,
    Signal,
    SignalValidationError,
    StrategyDescriptor,
    StrategyRiskProfile,
    signal_to_intent,
)

from tests.conftest import EXCHANGE, SYMBOL


def make_signal(**overrides) -> Signal:
    params = {
        "signal_id": "signal-1",
        "tenant_id": "tenant-1",
        "strategy_id": "strategy-1",
        "exchange": EXCHANGE,
        "symbol": SYMBOL,
        "action": SignalAction.BUY,
        "confidence": Decimal("0.8"),
        "reference_price": Decimal("30000"),
        "target_quantity": Decimal("1"),
        "order_type": OrderType.LIMIT,
        "limit_price": Decimal("30000"),
    }
    params.update(overrides)
    return Signal(**params)


class TestSignalValidation:
    def test_a_well_formed_signal_is_valid(self) -> None:
        assert make_signal().is_valid is True
        assert make_signal().validation_errors() == []

    def test_missing_tenant_is_invalid(self) -> None:
        errors = make_signal(tenant_id="").validation_errors()
        assert any("tenant_id" in e for e in errors)

    def test_missing_strategy_is_invalid(self) -> None:
        errors = make_signal(strategy_id="").validation_errors()
        assert any("strategy_id" in e for e in errors)

    def test_confidence_above_one_is_invalid(self) -> None:
        errors = make_signal(confidence=Decimal("1.5")).validation_errors()
        assert any("confidence" in e for e in errors)

    def test_negative_confidence_is_invalid(self) -> None:
        errors = make_signal(confidence=Decimal("-0.1")).validation_errors()
        assert any("confidence" in e for e in errors)

    def test_boundary_confidences_are_valid(self) -> None:
        assert make_signal(confidence=Decimal("0")).is_valid is True
        assert make_signal(confidence=Decimal("1")).is_valid is True

    def test_buy_without_quantity_is_invalid(self) -> None:
        errors = make_signal(target_quantity=None).validation_errors()
        assert any("target_quantity" in e for e in errors)

    def test_zero_quantity_is_invalid(self) -> None:
        errors = make_signal(target_quantity=Decimal("0")).validation_errors()
        assert any("target_quantity" in e for e in errors)

    def test_limit_signal_without_price_is_invalid(self) -> None:
        errors = make_signal(limit_price=None).validation_errors()
        assert any("limit_price" in e for e in errors)

    def test_market_signal_with_a_limit_price_is_invalid(self) -> None:
        errors = make_signal(
            order_type=OrderType.MARKET, limit_price=Decimal("30000")
        ).validation_errors()
        assert any("must not carry" in e for e in errors)

    def test_stop_limit_requires_both_prices(self) -> None:
        errors = make_signal(
            order_type=OrderType.STOP_LIMIT, stop_price=None
        ).validation_errors()
        assert any("stop_price" in e for e in errors)

    def test_hold_needs_no_execution_parameters(self) -> None:
        signal = make_signal(
            action=SignalAction.HOLD,
            target_quantity=None,
            limit_price=None,
            order_type=OrderType.MARKET,
        )
        assert signal.is_valid is True

    def test_raise_if_invalid_reports_every_problem(self) -> None:
        signal = make_signal(tenant_id="", target_quantity=Decimal("-1"))

        with pytest.raises(SignalValidationError) as excinfo:
            signal.raise_if_invalid()

        assert "tenant_id" in str(excinfo.value)
        assert "target_quantity" in str(excinfo.value)

    def test_multiple_errors_are_all_collected(self) -> None:
        errors = make_signal(
            tenant_id="", strategy_id="", confidence=Decimal("9")
        ).validation_errors()
        assert len(errors) >= 3


class TestSignalToIntent:
    def test_buy_signal_becomes_a_buy_intent(self) -> None:
        intent = signal_to_intent(
            make_signal(), account_id="account-1", current_position_quantity=Decimal(0)
        )

        assert intent is not None
        assert intent.side is OrderSide.BUY
        assert intent.quantity == Decimal("1")
        assert intent.signal_id == "signal-1"
        assert intent.reduce_only is False

    def test_sell_signal_becomes_a_sell_intent(self) -> None:
        intent = signal_to_intent(
            make_signal(action=SignalAction.SELL),
            account_id="account-1",
            current_position_quantity=Decimal(0),
        )

        assert intent.side is OrderSide.SELL

    def test_hold_produces_no_intent(self) -> None:
        intent = signal_to_intent(
            make_signal(
                action=SignalAction.HOLD, target_quantity=None, limit_price=None,
                order_type=OrderType.MARKET,
            ),
            account_id="account-1",
            current_position_quantity=Decimal("5"),
        )

        assert intent is None

    def test_close_on_a_flat_position_produces_no_intent(self) -> None:
        intent = signal_to_intent(
            make_signal(action=SignalAction.CLOSE, target_quantity=None),
            account_id="account-1",
            current_position_quantity=Decimal(0),
        )

        assert intent is None

    def test_close_of_a_long_sells_the_actual_quantity(self) -> None:
        """The closing size comes from the real position, not the strategy."""
        intent = signal_to_intent(
            make_signal(action=SignalAction.CLOSE, target_quantity=Decimal("999")),
            account_id="account-1",
            current_position_quantity=Decimal("3.5"),
        )

        assert intent.side is OrderSide.SELL
        assert intent.quantity == Decimal("3.5")
        assert intent.reduce_only is True

    def test_close_of_a_short_buys_the_actual_quantity(self) -> None:
        intent = signal_to_intent(
            make_signal(action=SignalAction.CLOSE, target_quantity=None),
            account_id="account-1",
            current_position_quantity=Decimal("-2"),
        )

        assert intent.side is OrderSide.BUY
        assert intent.quantity == Decimal("2")
        assert intent.reduce_only is True

    def test_invalid_signal_is_refused_before_translation(self) -> None:
        with pytest.raises(SignalValidationError):
            signal_to_intent(
                make_signal(confidence=Decimal("5")),
                account_id="account-1",
                current_position_quantity=Decimal(0),
            )

    def test_generated_intent_is_structurally_valid(self) -> None:
        intent = signal_to_intent(
            make_signal(), account_id="account-1", current_position_quantity=Decimal(0)
        )
        assert intent.is_valid is True


class _CountingStrategy(BaseStrategy):
    """Minimal concrete strategy used to exercise the lifecycle."""

    def __init__(self, descriptor: StrategyDescriptor) -> None:
        super().__init__(descriptor)
        self.ticks = 0

    def on_market_data(self, ticker) -> None:
        self.ticks += 1

    def generate_signal(self, symbol: str):
        return None


def make_descriptor(enabled: bool = True) -> StrategyDescriptor:
    return StrategyDescriptor(
        strategy_id="strategy-1",
        tenant_id="tenant-1",
        name="counting",
        version="1.0.0",
        enabled=enabled,
        exchange=EXCHANGE,
        symbols=(SYMBOL,),
        risk_profile=StrategyRiskProfile(
            max_order_quantity=Decimal("1"),
            max_position_quantity=Decimal("5"),
            max_order_notional=Decimal("50000"),
            max_daily_loss=Decimal("500"),
            max_open_orders=5,
            max_orders_per_minute=30,
        ),
    )


class TestStrategyLifecycle:
    def test_strategy_starts_stopped(self) -> None:
        strategy = _CountingStrategy(make_descriptor())
        assert strategy.is_running is False

    def test_start_initialises_automatically(self) -> None:
        strategy = _CountingStrategy(make_descriptor())
        strategy.start()

        assert strategy.is_initialised is True
        assert strategy.is_running is True

    def test_disabled_strategy_refuses_to_start(self) -> None:
        strategy = _CountingStrategy(make_descriptor(enabled=False))

        with pytest.raises(RuntimeError):
            strategy.start()

        assert strategy.is_running is False

    def test_stop_is_idempotent(self) -> None:
        strategy = _CountingStrategy(make_descriptor())
        strategy.start()
        strategy.stop()
        strategy.stop()

        assert strategy.is_running is False

    def test_default_handlers_are_safe_no_ops(self) -> None:
        strategy = _CountingStrategy(make_descriptor())
        strategy.on_order_book_update(None)
        strategy.on_trade(None)
        strategy.on_candle(None)

        assert strategy.ticks == 0

    def test_descriptor_identity_is_exposed(self) -> None:
        strategy = _CountingStrategy(make_descriptor())

        assert strategy.strategy_id == "strategy-1"
        assert strategy.name == "counting"
        assert strategy.version == "1.0.0"
        assert strategy.symbols == (SYMBOL,)
