"""Shared fixtures.

Everything here is deterministic: fixed prices, fixed sequence numbers, fixed
timestamps. No test depends on wall-clock time, random values or network
access, so a failure always means a real regression.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from wlct_trading.enums import ExchangeId, OrderSide, OrderType
from wlct_trading.market_data import (
    OrderBookDelta,
    OrderBookSnapshot,
    PriceLevel,
)
from wlct_trading.order_book import OrderBook
from wlct_trading.orders import Fill, OrderIntent
from wlct_trading.risk import KillSwitchState, RiskEngine, RiskLimits, RiskSnapshot

EXCHANGE = ExchangeId.BINANCE
SYMBOL = "BTC-USDT"
BASE_TS = 1_700_000_000_000_000


def level(price: str, quantity: str) -> PriceLevel:
    return PriceLevel(price=Decimal(price), quantity=Decimal(quantity))


@pytest.fixture()
def book() -> OrderBook:
    return OrderBook(exchange=EXCHANGE, symbol=SYMBOL)


@pytest.fixture()
def snapshot() -> OrderBookSnapshot:
    """A five-deep book with a clean 10.00 spread around a 30 000 mid."""
    return OrderBookSnapshot(
        exchange=EXCHANGE,
        symbol=SYMBOL,
        bids=(
            level("29995.00", "1.0"),
            level("29990.00", "2.0"),
            level("29985.00", "3.0"),
            level("29980.00", "4.0"),
            level("29975.00", "5.0"),
        ),
        asks=(
            level("30005.00", "1.5"),
            level("30010.00", "2.5"),
            level("30015.00", "3.5"),
            level("30020.00", "4.5"),
            level("30025.00", "5.5"),
        ),
        last_update_id=1000,
        exchange_timestamp=BASE_TS,
        received_timestamp=BASE_TS + 500,
    )


def make_delta(
    *,
    bids: tuple[PriceLevel, ...] = (),
    asks: tuple[PriceLevel, ...] = (),
    first: int,
    final: int,
    previous: int | None = None,
    timestamp: int = BASE_TS + 1_000,
) -> OrderBookDelta:
    return OrderBookDelta(
        exchange=EXCHANGE,
        symbol=SYMBOL,
        bids=bids,
        asks=asks,
        first_update_id=first,
        final_update_id=final,
        previous_final_update_id=previous,
        exchange_timestamp=timestamp,
        received_timestamp=timestamp + 500,
    )


@pytest.fixture()
def make_intent():
    def _make(
        *,
        side: OrderSide = OrderSide.BUY,
        quantity: str = "1.0",
        price: str | None = "30000.00",
        order_type: OrderType = OrderType.LIMIT,
        reduce_only: bool = False,
        client_order_id: str | None = None,
        strategy_id: str | None = "strategy-1",
    ) -> OrderIntent:
        return OrderIntent(
            tenant_id="tenant-1",
            account_id="account-1",
            strategy_id=strategy_id,
            exchange=EXCHANGE,
            symbol=SYMBOL,
            side=side,
            order_type=order_type,
            quantity=Decimal(quantity),
            price=Decimal(price) if price is not None else None,
            reduce_only=reduce_only,
            client_order_id=client_order_id,
        )

    return _make


@pytest.fixture()
def permissive_limits() -> RiskLimits:
    """Wide limits so a test only trips the one rule it is exercising."""
    return RiskLimits(
        max_order_quantity=Decimal("1000"),
        max_order_notional=Decimal("100000000"),
        max_position_quantity=Decimal("1000"),
        max_symbol_exposure_notional=Decimal("100000000"),
        max_account_exposure_notional=Decimal("100000000"),
        max_open_orders=100,
        max_orders_per_minute=1000,
        max_daily_loss=Decimal("1000000"),
        max_strategy_loss=Decimal("1000000"),
        max_price_deviation_percent=Decimal("100"),
        max_market_data_age_micros=60_000_000,
    )


@pytest.fixture()
def clean_snapshot() -> RiskSnapshot:
    """Flat book state with no exposure and no losses."""
    return RiskSnapshot(
        position_quantity=Decimal(0),
        symbol_exposure_notional=Decimal(0),
        account_exposure_notional=Decimal(0),
        open_order_count=0,
        orders_in_last_minute=0,
        realised_pnl_today=Decimal(0),
        strategy_realised_pnl_today=Decimal(0),
        reference_price=Decimal("30000.00"),
        market_data_age_micros=1_000,
        book_usable=True,
        is_complete=True,
    )


@pytest.fixture()
def no_kill_switches() -> KillSwitchState:
    return KillSwitchState()


@pytest.fixture()
def engine(permissive_limits: RiskLimits) -> RiskEngine:
    return RiskEngine(platform_limits=permissive_limits)


def make_fill(
    *,
    order_id: str = "order-1",
    fill_id: str = "fill-1",
    price: str,
    quantity: str,
    fee: str = "0",
    simulated: bool = False,
    timestamp: int = BASE_TS,
) -> Fill:
    return Fill(
        fill_id=fill_id,
        order_id=order_id,
        trade_id=f"trade-{fill_id}",
        price=Decimal(price),
        quantity=Decimal(quantity),
        fee=Decimal(fee),
        fee_currency="USDT",
        is_maker=False,
        is_simulated=simulated,
        exchange_timestamp=timestamp,
        received_timestamp=timestamp + 100,
    )
