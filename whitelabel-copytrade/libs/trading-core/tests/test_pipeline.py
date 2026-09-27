"""End-to-end pipeline: market data -> signal -> risk -> execution -> position.

These tests wire the real components together with no mocks between them. They
are the ones that would catch an integration regression that every unit test
still passes through.
"""

from __future__ import annotations

import asyncio
from dataclasses import replace
from decimal import Decimal

import pytest

from wlct_trading.adapters.paper import PaperTradingAdapter
from wlct_trading.enums import (
    OrderSide,
    OrderStatus,
    OrderType,
    SignalAction,
    TradingEventType,
    TradingMode,
)
from wlct_trading.events import InMemoryEventBus, TradingEvent
from wlct_trading.idempotency import build_client_order_id
from wlct_trading.order_book import OrderBook
from wlct_trading.orders import Order
from wlct_trading.positions import PositionManager
from wlct_trading.risk import KillSwitchState, RiskEngine, RiskLimits
from wlct_trading.signals import Signal, signal_to_intent

from tests.conftest import EXCHANGE, SYMBOL, make_delta, level


@pytest.fixture()
def live_book(snapshot) -> OrderBook:
    book = OrderBook(exchange=EXCHANGE, symbol=SYMBOL)
    book.apply_snapshot(snapshot)
    return book


def run(coro):
    return asyncio.run(coro)


class TestPaperExecutionPipeline:
    def test_marketable_buy_fills_at_the_real_ask(self, live_book) -> None:
        adapter = PaperTradingAdapter(lambda ex, sym: live_book.top())
        signal = Signal(
            signal_id="signal-1",
            tenant_id="tenant-1",
            strategy_id="strategy-1",
            exchange=EXCHANGE,
            symbol=SYMBOL,
            action=SignalAction.BUY,
            confidence=Decimal("0.9"),
            reference_price=live_book.mid_price,
            target_quantity=Decimal("1.0"),
            order_type=OrderType.MARKET,
            limit_price=None,
        )
        intent = signal_to_intent(
            signal, account_id="account-1", current_position_quantity=Decimal(0)
        )

        result = run(adapter.submit_order(intent, build_client_order_id(intent)))

        assert result.accepted is True
        assert result.is_simulated is True
        assert len(result.fills) == 1
        # The simulator must use the observed ask, not an invented price.
        assert result.fills[0].price == live_book.best_ask == Decimal("30005.00")
        assert result.fills[0].is_simulated is True

    def test_non_marketable_limit_rests_without_filling(self, live_book) -> None:
        adapter = PaperTradingAdapter(lambda ex, sym: live_book.top())
        intent = _limit_intent(price="29000", side=OrderSide.BUY)

        result = run(adapter.submit_order(intent, build_client_order_id(intent)))

        assert result.accepted is True
        assert result.status is OrderStatus.ACKNOWLEDGED
        assert result.fills == ()

    def test_no_book_means_no_invented_fill(self) -> None:
        """Without market data the simulator rests the order, never guesses."""
        adapter = PaperTradingAdapter(lambda ex, sym: None)
        intent = _limit_intent(price="30000", side=OrderSide.BUY)

        result = run(adapter.submit_order(intent, build_client_order_id(intent)))

        assert result.accepted is True
        assert result.fills == ()

    def test_fill_is_capped_by_real_resting_quantity(self, live_book) -> None:
        adapter = PaperTradingAdapter(lambda ex, sym: live_book.top())
        # Only 1.5 rests at the best ask; ask for 10.
        intent = _limit_intent(price="30005.00", side=OrderSide.BUY, quantity="10")

        result = run(adapter.submit_order(intent, build_client_order_id(intent)))

        assert result.fills[0].quantity == Decimal("1.5")
        assert result.status is OrderStatus.PARTIALLY_FILLED

    def test_unusable_book_stops_the_pipeline_before_execution(
        self, live_book
    ) -> None:
        """A sequence gap must prevent a market order from being priced."""
        live_book.apply_delta(
            make_delta(bids=(level("29990.00", "1"),), first=9999, final=9999)
        )
        assert live_book.is_usable is False

        engine = RiskEngine(
            RiskLimits(
                max_order_quantity=Decimal("100"),
                max_order_notional=Decimal("10000000"),
            )
        )
        intent = _limit_intent(price=None, side=OrderSide.BUY, order_type=OrderType.MARKET)
        snapshot = _snapshot(book_usable=False, reference_price=None)

        decision = engine.evaluate(
            intent,
            snapshot=snapshot,
            kill_switches=KillSwitchState(),
            trading_mode=TradingMode.PAPER,
            book_top=live_book.top(),
        )

        assert decision.approved is False
        assert decision.would_route is False


class TestFullRoundTrip:
    def test_signal_to_position_updates_state_consistently(self, live_book) -> None:
        adapter = PaperTradingAdapter(lambda ex, sym: live_book.top())
        positions = PositionManager()
        bus = InMemoryEventBus()
        engine = RiskEngine(
            RiskLimits(
                max_order_quantity=Decimal("100"),
                max_order_notional=Decimal("10000000"),
                max_position_quantity=Decimal("100"),
            )
        )

        intent = _limit_intent(price="30005.00", side=OrderSide.BUY, quantity="1.0")
        decision = engine.evaluate(
            intent,
            snapshot=_snapshot(),
            kill_switches=KillSwitchState(),
            trading_mode=TradingMode.PAPER,
            book_top=live_book.top(),
        )
        assert decision.approved is True

        client_order_id = build_client_order_id(intent)
        order = Order.from_intent(
            intent, client_order_id=client_order_id, is_simulated=True
        )
        order.transition_to(OrderStatus.SUBMITTED)
        bus.publish(
            TradingEvent.create(
                TradingEventType.ORDER_SUBMITTED,
                source="test",
                payload={"orderId": order.order_id},
                tenant_id=intent.tenant_id,
            )
        )

        result = run(adapter.submit_order(intent, client_order_id))
        order.try_transition_to(
            OrderStatus.ACKNOWLEDGED, exchange_order_id=result.exchange_order_id
        )

        for raw in result.fills:
            fill = replace(raw, order_id=order.order_id)
            assert order.apply_fill(fill) is True
            positions.apply_fill(
                intent.tenant_id,
                intent.account_id,
                intent.exchange,
                intent.symbol,
                intent.side,
                fill,
            )

        assert order.status is OrderStatus.FILLED
        assert order.filled_quantity == Decimal("1.0")
        assert order.average_fill_price == Decimal("30005.00")
        assert order.is_simulated is True

        position = positions.get("account-1", EXCHANGE, SYMBOL)
        assert position.quantity == Decimal("1.0")
        assert position.average_entry_price == Decimal("30005.00")
        # The simulated origin must survive all the way to the position.
        assert position.contains_simulated_fills is True

    def test_kill_switch_stops_the_pipeline_at_risk(self, live_book) -> None:
        engine = RiskEngine(
            RiskLimits(
                max_order_quantity=Decimal("100"),
                max_order_notional=Decimal("10000000"),
            )
        )
        intent = _limit_intent(price="30005.00", side=OrderSide.BUY)

        decision = engine.evaluate(
            intent,
            snapshot=_snapshot(),
            kill_switches=KillSwitchState(global_engaged=True, reason="drill"),
            trading_mode=TradingMode.PAPER,
            book_top=live_book.top(),
        )

        assert decision.approved is False
        assert decision.would_route is False


class TestEventBus:
    def test_events_reach_their_subscriber(self) -> None:
        bus = InMemoryEventBus()
        seen: list[TradingEvent] = []
        bus.subscribe(TradingEventType.ORDER_FILLED, seen.append)

        bus.publish(
            TradingEvent.create(
                TradingEventType.ORDER_FILLED, source="test", payload={"a": "1"}
            )
        )

        assert len(seen) == 1

    def test_other_event_types_are_not_delivered(self) -> None:
        bus = InMemoryEventBus()
        seen: list[TradingEvent] = []
        bus.subscribe(TradingEventType.ORDER_FILLED, seen.append)

        bus.publish(
            TradingEvent.create(
                TradingEventType.ORDER_REJECTED, source="test", payload={}
            )
        )

        assert seen == []

    def test_a_failing_handler_does_not_block_the_others(self) -> None:
        bus = InMemoryEventBus()
        delivered: list[str] = []

        def broken(event: TradingEvent) -> None:
            raise RuntimeError("consumer bug")

        bus.subscribe(TradingEventType.ORDER_FILLED, broken)
        bus.subscribe(TradingEventType.ORDER_FILLED, lambda e: delivered.append(e.event_id))

        bus.publish(
            TradingEvent.create(TradingEventType.ORDER_FILLED, source="test", payload={})
        )

        assert len(delivered) == 1
        assert len(bus.handler_errors) == 1

    def test_derived_events_preserve_the_causal_chain(self) -> None:
        root = TradingEvent.create(
            TradingEventType.MARKET_DATA_RECEIVED,
            source="market-data",
            payload={},
            tenant_id="tenant-1",
        )

        signal = root.derive(
            TradingEventType.SIGNAL_GENERATED, source="trading-engine", payload={}
        )
        order = signal.derive(
            TradingEventType.ORDER_REQUESTED, source="execution-engine", payload={}
        )

        assert root.correlation_id == root.event_id
        assert signal.correlation_id == root.correlation_id
        assert order.correlation_id == root.correlation_id
        assert order.causation_id == signal.event_id
        assert order.tenant_id == "tenant-1"


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def _limit_intent(
    *,
    price: str | None,
    side: OrderSide,
    quantity: str = "1.0",
    order_type: OrderType = OrderType.LIMIT,
):
    from wlct_trading.orders import OrderIntent

    return OrderIntent(
        tenant_id="tenant-1",
        account_id="account-1",
        strategy_id="strategy-1",
        exchange=EXCHANGE,
        symbol=SYMBOL,
        side=side,
        order_type=order_type,
        quantity=Decimal(quantity),
        price=Decimal(price) if price is not None else None,
    )


def _snapshot(*, book_usable: bool = True, reference_price: str | None = "30000"):
    from wlct_trading.risk import RiskSnapshot

    return RiskSnapshot(
        position_quantity=Decimal(0),
        symbol_exposure_notional=Decimal(0),
        account_exposure_notional=Decimal(0),
        open_order_count=0,
        orders_in_last_minute=0,
        realised_pnl_today=Decimal(0),
        strategy_realised_pnl_today=Decimal(0),
        reference_price=Decimal(reference_price) if reference_price else None,
        market_data_age_micros=1_000,
        book_usable=book_usable,
        is_complete=True,
    )
