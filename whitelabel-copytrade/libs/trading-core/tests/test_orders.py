"""OMS: state machine, fill accounting and duplicate protection."""

from __future__ import annotations

from decimal import Decimal

import pytest

from wlct_trading.enums import OrderSide, OrderStatus, OrderType, TimeInForce
from wlct_trading.idempotency import DuplicateOrderGuard, build_client_order_id
from wlct_trading.orders import (
    ORDER_STATE_TRANSITIONS,
    InvalidOrderTransition,
    Order,
    is_legal_transition,
)

from tests.conftest import EXCHANGE, SYMBOL, make_fill


def make_order(quantity: str = "10.0", side: OrderSide = OrderSide.BUY) -> Order:
    return Order(
        order_id="order-1",
        client_order_id="wlct-testclientorderid00000001",
        tenant_id="tenant-1",
        account_id="account-1",
        strategy_id="strategy-1",
        exchange=EXCHANGE,
        symbol=SYMBOL,
        side=side,
        order_type=OrderType.LIMIT,
        quantity=Decimal(quantity),
        price=Decimal("30000.00"),
        time_in_force=TimeInForce.GTC,
    )


class TestOrderStateTransitions:
    def test_new_order_starts_pending(self) -> None:
        assert make_order().status is OrderStatus.PENDING

    def test_happy_path_lifecycle(self) -> None:
        order = make_order()

        order.transition_to(OrderStatus.SUBMITTED)
        assert order.submitted_at is not None
        order.transition_to(OrderStatus.ACKNOWLEDGED, exchange_order_id="X-1")
        assert order.exchange_order_id == "X-1"
        order.transition_to(OrderStatus.PARTIALLY_FILLED)
        order.transition_to(OrderStatus.FILLED)

        assert order.status is OrderStatus.FILLED
        assert order.is_terminal is True
        assert order.terminal_at is not None
        assert [e.status for e in order.events] == [
            OrderStatus.SUBMITTED,
            OrderStatus.ACKNOWLEDGED,
            OrderStatus.PARTIALLY_FILLED,
            OrderStatus.FILLED,
        ]

    def test_cancel_path(self) -> None:
        order = make_order()
        order.transition_to(OrderStatus.SUBMITTED)
        order.transition_to(OrderStatus.ACKNOWLEDGED)
        order.transition_to(OrderStatus.CANCEL_REQUESTED)
        order.transition_to(OrderStatus.CANCELLED)

        assert order.status is OrderStatus.CANCELLED
        assert order.is_terminal is True

    def test_cancel_can_lose_race_to_a_fill(self) -> None:
        """The order completed before the cancel reached the venue."""
        order = make_order()
        order.transition_to(OrderStatus.SUBMITTED)
        order.transition_to(OrderStatus.ACKNOWLEDGED)
        order.transition_to(OrderStatus.CANCEL_REQUESTED)

        order.transition_to(OrderStatus.FILLED)

        assert order.status is OrderStatus.FILLED

    def test_terminal_states_are_final(self) -> None:
        for terminal in (
            OrderStatus.FILLED,
            OrderStatus.CANCELLED,
            OrderStatus.REJECTED,
            OrderStatus.EXPIRED,
            OrderStatus.FAILED,
        ):
            assert ORDER_STATE_TRANSITIONS[terminal] == frozenset()

    def test_illegal_transition_raises(self) -> None:
        order = make_order()
        order.transition_to(OrderStatus.SUBMITTED)
        order.transition_to(OrderStatus.FILLED)

        with pytest.raises(InvalidOrderTransition) as excinfo:
            order.transition_to(OrderStatus.ACKNOWLEDGED)

        assert excinfo.value.current is OrderStatus.FILLED
        assert excinfo.value.target is OrderStatus.ACKNOWLEDGED

    def test_illegal_transition_does_not_mutate_state(self) -> None:
        order = make_order()
        order.transition_to(OrderStatus.SUBMITTED)
        order.transition_to(OrderStatus.FILLED)
        event_count = len(order.events)

        with pytest.raises(InvalidOrderTransition):
            order.transition_to(OrderStatus.PENDING)

        assert order.status is OrderStatus.FILLED
        assert len(order.events) == event_count

    def test_try_transition_returns_none_instead_of_raising(self) -> None:
        """Redelivered venue messages are dropped, not escalated."""
        order = make_order()
        order.transition_to(OrderStatus.SUBMITTED)
        order.transition_to(OrderStatus.FILLED)

        assert order.try_transition_to(OrderStatus.ACKNOWLEDGED) is None
        assert order.status is OrderStatus.FILLED

    def test_cannot_skip_backwards_to_pending(self) -> None:
        order = make_order()
        order.transition_to(OrderStatus.SUBMITTED)

        assert is_legal_transition(OrderStatus.SUBMITTED, OrderStatus.PENDING) is False

    def test_rejection_records_reason(self) -> None:
        order = make_order()
        order.transition_to(OrderStatus.SUBMITTED)
        order.transition_to(OrderStatus.REJECTED, reason="MIN_NOTIONAL not met")

        assert order.rejection_reason == "MIN_NOTIONAL not met"
        assert order.is_terminal is True

    def test_partially_filled_may_repeat(self) -> None:
        """Successive partial fills stay in the same state legally."""
        assert (
            is_legal_transition(
                OrderStatus.PARTIALLY_FILLED, OrderStatus.PARTIALLY_FILLED
            )
            is True
        )

    def test_open_and_terminal_are_disjoint(self) -> None:
        order = make_order()
        assert order.is_open is True
        assert order.is_terminal is False


class TestFillAccounting:
    def test_single_full_fill(self) -> None:
        order = make_order("10.0")
        order.transition_to(OrderStatus.SUBMITTED)

        applied = order.apply_fill(
            make_fill(price="30000.00", quantity="10.0", fee="3.0")
        )

        assert applied is True
        assert order.filled_quantity == Decimal("10.0")
        assert order.average_fill_price == Decimal("30000.00")
        assert order.remaining_quantity == Decimal(0)
        assert order.status is OrderStatus.FILLED
        assert order.cumulative_fee == Decimal("3.0")

    def test_partial_fill_leaves_order_open(self) -> None:
        order = make_order("10.0")
        order.transition_to(OrderStatus.SUBMITTED)

        order.apply_fill(make_fill(price="30000.00", quantity="4.0"))

        assert order.status is OrderStatus.PARTIALLY_FILLED
        assert order.filled_quantity == Decimal("4.0")
        assert order.remaining_quantity == Decimal("6.0")
        assert order.is_open is True

    def test_average_price_is_quantity_weighted(self) -> None:
        order = make_order("10.0")
        order.transition_to(OrderStatus.SUBMITTED)

        order.apply_fill(make_fill(fill_id="f1", price="30000.00", quantity="2.0"))
        order.apply_fill(make_fill(fill_id="f2", price="31000.00", quantity="8.0"))

        # (30000*2 + 31000*8) / 10 = 30800
        assert order.average_fill_price == Decimal("30800")
        assert order.status is OrderStatus.FILLED

    def test_duplicate_fill_is_rejected(self) -> None:
        """A replayed user-data message must not double-count."""
        order = make_order("10.0")
        order.transition_to(OrderStatus.SUBMITTED)

        first = order.apply_fill(make_fill(fill_id="f1", price="30000.00", quantity="4.0"))
        second = order.apply_fill(make_fill(fill_id="f1", price="30000.00", quantity="4.0"))

        assert first is True
        assert second is False
        assert order.filled_quantity == Decimal("4.0")
        assert len(order.fills) == 1

    def test_fill_for_another_order_raises(self) -> None:
        order = make_order()
        with pytest.raises(ValueError):
            order.apply_fill(
                make_fill(order_id="other-order", price="30000.00", quantity="1.0")
            )

    def test_zero_quantity_fill_raises(self) -> None:
        order = make_order()
        with pytest.raises(ValueError):
            order.apply_fill(make_fill(price="30000.00", quantity="0"))

    def test_simulated_fill_marks_the_order(self) -> None:
        order = make_order("1.0")
        order.transition_to(OrderStatus.SUBMITTED)

        order.apply_fill(make_fill(price="30000.00", quantity="1.0", simulated=True))

        assert order.is_simulated is True

    def test_unfilled_order_reports_no_average_price(self) -> None:
        order = make_order()
        assert order.average_fill_price is None
        assert order.filled_notional == Decimal(0)


class TestDuplicateOrderProtection:
    def test_identical_intents_share_a_client_order_id(self, make_intent) -> None:
        assert build_client_order_id(make_intent()) == build_client_order_id(make_intent())

    def test_differing_quantity_changes_the_id(self, make_intent) -> None:
        a = build_client_order_id(make_intent(quantity="1.0"))
        b = build_client_order_id(make_intent(quantity="2.0"))
        assert a != b

    def test_differing_side_changes_the_id(self, make_intent) -> None:
        a = build_client_order_id(make_intent(side=OrderSide.BUY))
        b = build_client_order_id(make_intent(side=OrderSide.SELL))
        assert a != b

    def test_client_order_id_is_venue_safe(self, make_intent) -> None:
        coid = build_client_order_id(make_intent())
        assert len(coid) <= 36
        assert coid.replace("-", "").replace("_", "").isalnum()

    def test_guard_blocks_the_second_registration(self, make_intent) -> None:
        guard = DuplicateOrderGuard()
        coid = build_client_order_id(make_intent())

        assert guard.register(coid) is True
        assert guard.register(coid) is False
        assert guard.has_seen(coid) is True

    def test_released_id_can_be_registered_again(self, make_intent) -> None:
        guard = DuplicateOrderGuard()
        coid = build_client_order_id(make_intent())
        guard.register(coid)

        guard.release(coid)

        assert guard.register(coid) is True
