"""Position management: quantities, averages and PnL derived from real fills."""

from __future__ import annotations

from decimal import Decimal

import pytest

from wlct_trading.enums import OrderSide, PositionSide
from wlct_trading.positions import PositionManager

from tests.conftest import EXCHANGE, SYMBOL, make_fill

TENANT = "tenant-1"
ACCOUNT = "account-1"


@pytest.fixture()
def manager() -> PositionManager:
    return PositionManager()


def apply(manager, side, price, quantity, *, fill_id="f", fee="0", simulated=False):
    return manager.apply_fill(
        TENANT,
        ACCOUNT,
        EXCHANGE,
        SYMBOL,
        side,
        make_fill(
            fill_id=fill_id,
            price=price,
            quantity=quantity,
            fee=fee,
            simulated=simulated,
        ),
    )


class TestPositionFromFills:
    def test_no_position_exists_before_any_fill(self, manager) -> None:
        assert manager.get(ACCOUNT, EXCHANGE, SYMBOL) is None
        assert manager.open_positions() == []

    def test_first_buy_opens_a_long(self, manager) -> None:
        update = apply(manager, OrderSide.BUY, "30000", "2", fill_id="f1")
        position = update.position

        assert position.side is PositionSide.LONG
        assert position.quantity == Decimal("2")
        assert position.average_entry_price == Decimal("30000")
        assert position.realised_pnl == Decimal(0)
        assert position.fill_count == 1

    def test_first_sell_opens_a_short(self, manager) -> None:
        position = apply(manager, OrderSide.SELL, "30000", "2", fill_id="f1").position

        assert position.side is PositionSide.SHORT
        assert position.quantity == Decimal("-2")
        assert position.average_entry_price == Decimal("30000")

    def test_adding_to_a_long_moves_the_weighted_average(self, manager) -> None:
        apply(manager, OrderSide.BUY, "30000", "2", fill_id="f1")
        position = apply(manager, OrderSide.BUY, "31000", "2", fill_id="f2").position

        assert position.quantity == Decimal("4")
        assert position.average_entry_price == Decimal("30500")

    def test_partial_close_realises_pnl_and_keeps_average(self, manager) -> None:
        apply(manager, OrderSide.BUY, "30000", "4", fill_id="f1")

        update = apply(manager, OrderSide.SELL, "31000", "1", fill_id="f2")

        assert update.realised_delta == Decimal("1000")
        assert update.position.quantity == Decimal("3")
        assert update.position.realised_pnl == Decimal("1000")
        # Closing part of a position must not disturb the entry basis.
        assert update.position.average_entry_price == Decimal("30000")

    def test_full_close_flattens_and_clears_the_average(self, manager) -> None:
        apply(manager, OrderSide.BUY, "30000", "2", fill_id="f1")

        update = apply(manager, OrderSide.SELL, "30500", "2", fill_id="f2")

        assert update.closed is True
        assert update.position.is_flat is True
        assert update.position.side is PositionSide.FLAT
        assert update.position.average_entry_price is None
        assert update.position.realised_pnl == Decimal("1000")

    def test_loss_is_realised_as_a_negative_number(self, manager) -> None:
        apply(manager, OrderSide.BUY, "30000", "2", fill_id="f1")

        update = apply(manager, OrderSide.SELL, "29000", "2", fill_id="f2")

        assert update.position.realised_pnl == Decimal("-2000")

    def test_short_profits_when_price_falls(self, manager) -> None:
        apply(manager, OrderSide.SELL, "30000", "2", fill_id="f1")

        update = apply(manager, OrderSide.BUY, "29000", "2", fill_id="f2")

        assert update.position.realised_pnl == Decimal("2000")
        assert update.position.is_flat is True

    def test_flip_closes_then_reopens_at_the_fill_price(self, manager) -> None:
        """Long 2 at 30 000, sell 5 at 31 000 -> +2 000 realised, short 3."""
        apply(manager, OrderSide.BUY, "30000", "2", fill_id="f1")

        update = apply(manager, OrderSide.SELL, "31000", "5", fill_id="f2")

        assert update.flipped is True
        assert update.position.quantity == Decimal("-3")
        assert update.position.side is PositionSide.SHORT
        assert update.position.realised_pnl == Decimal("2000")
        assert update.position.average_entry_price == Decimal("31000")

    def test_zero_quantity_fill_is_rejected(self, manager) -> None:
        with pytest.raises(ValueError):
            apply(manager, OrderSide.BUY, "30000", "0", fill_id="f1")

    def test_fees_accumulate_separately_from_pnl(self, manager) -> None:
        apply(manager, OrderSide.BUY, "30000", "2", fill_id="f1", fee="30")
        update = apply(manager, OrderSide.SELL, "31000", "2", fill_id="f2", fee="31")

        position = update.position
        assert position.realised_pnl == Decimal("2000")
        assert position.cumulative_fee == Decimal("61")
        assert position.net_pnl == Decimal("1939")


class TestUnrealisedPnl:
    def test_unrealised_is_none_without_a_mark(self, manager) -> None:
        position = apply(manager, OrderSide.BUY, "30000", "2", fill_id="f1").position
        position.mark_price = None

        assert position.unrealised_pnl is None

    def test_long_unrealised_tracks_the_mark(self, manager) -> None:
        apply(manager, OrderSide.BUY, "30000", "2", fill_id="f1")
        manager.set_mark_price(ACCOUNT, EXCHANGE, SYMBOL, Decimal("31000"))

        position = manager.get(ACCOUNT, EXCHANGE, SYMBOL)
        assert position.unrealised_pnl == Decimal("2000")

    def test_short_unrealised_is_inverted(self, manager) -> None:
        apply(manager, OrderSide.SELL, "30000", "2", fill_id="f1")
        manager.set_mark_price(ACCOUNT, EXCHANGE, SYMBOL, Decimal("29000"))

        position = manager.get(ACCOUNT, EXCHANGE, SYMBOL)
        assert position.unrealised_pnl == Decimal("2000")

    def test_flat_position_has_no_unrealised(self, manager) -> None:
        apply(manager, OrderSide.BUY, "30000", "2", fill_id="f1")
        apply(manager, OrderSide.SELL, "30000", "2", fill_id="f2")

        position = manager.get(ACCOUNT, EXCHANGE, SYMBOL)
        assert position.unrealised_pnl is None
        assert position.total_pnl == Decimal(0)


class TestSimulationLabelling:
    def test_simulated_fill_marks_the_position(self, manager) -> None:
        position = apply(
            manager, OrderSide.BUY, "30000", "1", fill_id="f1", simulated=True
        ).position

        assert position.contains_simulated_fills is True

    def test_real_fill_leaves_the_flag_clear(self, manager) -> None:
        position = apply(manager, OrderSide.BUY, "30000", "1", fill_id="f1").position

        assert position.contains_simulated_fills is False

    def test_flag_is_sticky_once_set(self, manager) -> None:
        apply(manager, OrderSide.BUY, "30000", "1", fill_id="f1", simulated=True)
        position = apply(manager, OrderSide.BUY, "30000", "1", fill_id="f2").position

        assert position.contains_simulated_fills is True


class TestExposure:
    def test_account_exposure_sums_absolute_notional(self, manager) -> None:
        apply(manager, OrderSide.BUY, "30000", "2", fill_id="f1")
        manager.apply_fill(
            TENANT,
            ACCOUNT,
            EXCHANGE,
            "ETH-USDT",
            OrderSide.SELL,
            make_fill(fill_id="f2", price="2000", quantity="10"),
        )

        # 2*30000 + 10*2000 = 80 000, shorts counted as positive exposure.
        assert manager.account_exposure(ACCOUNT) == Decimal("80000")

    def test_symbol_exposure_isolates_one_instrument(self, manager) -> None:
        apply(manager, OrderSide.BUY, "30000", "2", fill_id="f1")

        assert manager.symbol_exposure(ACCOUNT, SYMBOL) == Decimal("60000")

    def test_flat_positions_contribute_nothing(self, manager) -> None:
        apply(manager, OrderSide.BUY, "30000", "2", fill_id="f1")
        apply(manager, OrderSide.SELL, "30000", "2", fill_id="f2")

        assert manager.account_exposure(ACCOUNT) == Decimal(0)

    def test_positions_are_isolated_per_account(self, manager) -> None:
        apply(manager, OrderSide.BUY, "30000", "2", fill_id="f1")
        manager.apply_fill(
            TENANT,
            "account-2",
            EXCHANGE,
            SYMBOL,
            OrderSide.BUY,
            make_fill(fill_id="f2", price="30000", quantity="5"),
        )

        assert manager.get(ACCOUNT, EXCHANGE, SYMBOL).quantity == Decimal("2")
        assert manager.get("account-2", EXCHANGE, SYMBOL).quantity == Decimal("5")
        assert len(manager.all_for_account(ACCOUNT)) == 1
