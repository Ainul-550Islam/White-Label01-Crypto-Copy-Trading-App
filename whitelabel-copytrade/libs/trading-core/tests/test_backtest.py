"""Part 6: replay, simulated execution, portfolio accounting and results.

The determinism and no-look-ahead tests here are the load-bearing ones. A
backtest that is not reproducible is not evidence of anything, and a backtest
that can see the future is worse than no backtest at all because it produces
confident nonsense.

Nothing in this file touches the network, a credential, a database or a real
order. The dataset is constructed in memory from fixed Decimals.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from wlct_trading.backtest import (
    BacktestConfig,
    BacktestEngine,
    DatasetError,
    ExecutionAssumptions,
    HistoricalDataset,
    LookAheadError,
    MarketEvent,
    ReplayEngine,
    SimulatedClock,
    SimulatedIdFactory,
    SimulatedMatchingEngine,
    SimulatedPortfolio,
    compute_configuration_hash,
    compute_dataset_checksum,
    rolling_windows,
    split_dataset,
)
from wlct_trading.backtest.clock import ClockError
from wlct_trading.enums import (
    BacktestPhase,
    MarketEventKind,
    OrderSide,
    OrderStatus,
    OrderType,
)
from wlct_trading.market_data import BookTop, OrderBookSnapshot, PriceLevel, PublicTrade
from wlct_trading.orders import Fill, OrderIntent
from wlct_trading.risk import RiskLimits
from wlct_trading.signals import StrategyDescriptor, StrategyRiskProfile
from wlct_trading.strategies import build_default_strategy_registry

from tests.conftest import BASE_TS, EXCHANGE, SYMBOL

D = Decimal


# ---------------------------------------------------------------------------
# Builders
# ---------------------------------------------------------------------------
def snapshot_event(
    index: int,
    *,
    bid_qty: str,
    ask_qty: str,
    bid: str = "29995",
    ask: str = "30005",
    step_micros: int = 1_000_000,
) -> MarketEvent:
    timestamp = BASE_TS + index * step_micros
    return MarketEvent(
        kind=MarketEventKind.BOOK_SNAPSHOT,
        timestamp_micros=timestamp,
        sequence=index,
        payload=OrderBookSnapshot(
            exchange=EXCHANGE,
            symbol=SYMBOL,
            bids=(
                PriceLevel(price=D(bid), quantity=D(bid_qty)),
                PriceLevel(price=D(bid) - D("5"), quantity=D("2")),
            ),
            asks=(
                PriceLevel(price=D(ask), quantity=D(ask_qty)),
                PriceLevel(price=D(ask) + D("5"), quantity=D("2")),
            ),
            last_update_id=1_000 + index,
            exchange_timestamp=timestamp,
            received_timestamp=timestamp + 500,
        ),
    )


def trade_event(index: int, *, price: str) -> MarketEvent:
    timestamp = BASE_TS + index * 1_000_000
    return MarketEvent(
        kind=MarketEventKind.TRADE,
        timestamp_micros=timestamp,
        sequence=index,
        payload=PublicTrade(
            exchange=EXCHANGE,
            symbol=SYMBOL,
            trade_id=f"trade-{index}",
            price=D(price),
            quantity=D("0.5"),
            aggressor_side=OrderSide.BUY,
            exchange_timestamp=timestamp,
            received_timestamp=timestamp,
        ),
    )


def oscillating_dataset(count: int = 40) -> HistoricalDataset:
    """Bid-heavy, balanced and ask-heavy books in a fixed repeating cycle."""
    events: list[MarketEvent] = []
    for index in range(count):
        phase = index % 10
        if phase < 4:
            events.append(snapshot_event(index, bid_qty="9", ask_qty="1"))
        elif phase < 7:
            events.append(snapshot_event(index, bid_qty="1", ask_qty="1"))
        else:
            events.append(snapshot_event(index, bid_qty="1", ask_qty="9"))
    return HistoricalDataset.from_events(
        events,
        dataset_id="oscillating-1",
        source="unit-test-fixture",
        granularity="book_snapshot",
    )


def descriptor() -> StrategyDescriptor:
    return StrategyDescriptor(
        strategy_id="strategy-1",
        tenant_id="tenant-1",
        name="deterministic example",
        version="1.0.0",
        enabled=True,
        exchange=EXCHANGE,
        symbols=(SYMBOL,),
        risk_profile=StrategyRiskProfile(
            max_order_quantity=D("1"),
            max_position_quantity=D("1"),
            max_order_notional=D("100000"),
            max_daily_loss=D("1000"),
            max_open_orders=5,
            max_orders_per_minute=600,
        ),
    )


def permissive() -> RiskLimits:
    return RiskLimits(
        max_order_quantity=D("1"),
        max_order_notional=D("1000000"),
        max_position_quantity=D("1"),
        max_symbol_exposure_notional=D("1000000"),
        max_account_exposure_notional=D("1000000"),
        max_open_orders=50,
        max_orders_per_minute=600,
        max_daily_loss=D("100000"),
        max_strategy_loss=D("100000"),
        max_price_deviation_percent=D("100"),
        max_market_data_age_micros=60_000_000,
    )


def build_backtest(
    dataset: HistoricalDataset,
    *,
    assumptions: ExecutionAssumptions | None = None,
    initial_capital: str = "10000",
    limits: RiskLimits | None = None,
    parameters: dict[str, object] | None = None,
) -> BacktestEngine:
    registry = build_default_strategy_registry()
    strategy = registry.create(
        "DETERMINISTIC_IMBALANCE_V1",
        "1.0.0",
        descriptor=descriptor(),
        symbol=SYMBOL,
        parameters=parameters
        or {"use_limit_orders": False, "signal_cooldown_micros": 0},
    )
    return BacktestEngine(
        strategy=strategy,
        dataset=dataset,
        config=BacktestConfig(
            tenant_id="tenant-1",
            account_id="account-1",
            initial_capital=D(initial_capital),
            assumptions=assumptions or ExecutionAssumptions(),
            risk_limits=limits if limits is not None else permissive(),
        ),
    )


def book(
    *, bid_qty: str = "5", ask_qty: str = "5", bid: str = "29995", ask: str = "30005"
) -> BookTop:
    return BookTop(
        exchange=EXCHANGE,
        symbol=SYMBOL,
        best_bid=D(bid),
        best_bid_quantity=D(bid_qty),
        best_ask=D(ask),
        best_ask_quantity=D(ask_qty),
        sequence=1,
        exchange_timestamp=BASE_TS,
        received_timestamp=BASE_TS,
    )


def intent(
    *,
    side: OrderSide = OrderSide.BUY,
    order_type: OrderType = OrderType.MARKET,
    quantity: str = "1",
    price: str | None = None,
) -> OrderIntent:
    return OrderIntent(
        tenant_id="tenant-1",
        account_id="account-1",
        strategy_id="strategy-1",
        exchange=EXCHANGE,
        symbol=SYMBOL,
        side=side,
        order_type=order_type,
        quantity=D(quantity),
        price=D(price) if price is not None else None,
        created_at=BASE_TS,
    )


# ---------------------------------------------------------------------------
# Clock, dataset, replay
# ---------------------------------------------------------------------------
class TestSimulatedClock:
    def test_clock_starts_where_told(self) -> None:
        assert SimulatedClock(start_micros=BASE_TS).now_micros() == BASE_TS

    def test_clock_refuses_to_move_backwards(self) -> None:
        clock = SimulatedClock(start_micros=BASE_TS)
        clock.advance_to(BASE_TS + 10)
        with pytest.raises(ClockError):
            clock.advance_to(BASE_TS + 9)

    def test_repeating_an_instant_is_allowed(self) -> None:
        clock = SimulatedClock(start_micros=BASE_TS)
        clock.advance_to(BASE_TS)
        clock.advance_to(BASE_TS)
        assert clock.advance_count == 2

    def test_reset_returns_to_the_start(self) -> None:
        clock = SimulatedClock(start_micros=BASE_TS)
        clock.advance_to(BASE_TS + 1_000)
        clock.reset()
        assert clock.now_micros() == BASE_TS


class TestDatasetIdentification:
    """Case 27: a run must be able to say exactly what data it used."""

    def test_descriptor_records_the_window_and_count(self) -> None:
        dataset = oscillating_dataset(10)
        assert dataset.descriptor.event_count == 10
        assert dataset.descriptor.start_micros == BASE_TS
        assert dataset.descriptor.symbol == SYMBOL
        assert dataset.descriptor.exchange is EXCHANGE
        assert dataset.descriptor.granularity == "book_snapshot"

    def test_checksum_is_stable_across_input_order(self) -> None:
        events = [snapshot_event(index, bid_qty="5", ask_qty="5") for index in range(6)]
        forward = compute_dataset_checksum(events)
        backward = compute_dataset_checksum(list(reversed(events)))
        assert forward == backward

    def test_checksum_changes_when_a_price_changes(self) -> None:
        base = [snapshot_event(index, bid_qty="5", ask_qty="5") for index in range(4)]
        altered = base[:-1] + [snapshot_event(3, bid_qty="5", ask_qty="6")]
        assert compute_dataset_checksum(base) != compute_dataset_checksum(altered)

    def test_a_dataset_without_a_checksum_is_not_reproducible(self) -> None:
        dataset = oscillating_dataset(4)
        descriptor_without = type(dataset.descriptor)(
            dataset_id="x",
            source="y",
            exchange=EXCHANGE,
            symbol=SYMBOL,
            market_type=dataset.descriptor.market_type,
            start_micros=BASE_TS,
            end_micros=BASE_TS + 1,
            granularity="event",
            event_count=4,
            checksum=None,
        )
        assert descriptor_without.is_reproducible is False

    def test_mixed_symbols_are_refused(self) -> None:
        other = snapshot_event(0, bid_qty="1", ask_qty="1")
        mismatched = MarketEvent(
            kind=MarketEventKind.TRADE,
            timestamp_micros=BASE_TS,
            payload=PublicTrade(
                exchange=EXCHANGE,
                symbol="ETH-USDT",
                trade_id="t",
                price=D("2000"),
                quantity=D("1"),
                aggressor_side=OrderSide.BUY,
                exchange_timestamp=BASE_TS,
                received_timestamp=BASE_TS,
            ),
        )
        with pytest.raises(DatasetError):
            HistoricalDataset.from_events(
                [other, mismatched], dataset_id="bad", source="test"
            )

    def test_an_empty_dataset_is_refused(self) -> None:
        with pytest.raises(DatasetError):
            HistoricalDataset.from_events([], dataset_id="empty", source="test")


class TestReplayOrdering:
    """Case 16 and 17: deterministic ordering and no look-ahead."""

    def test_events_arrive_in_timestamp_order(self) -> None:
        dataset = oscillating_dataset(12)
        replay = ReplayEngine(dataset)
        seen = [event.timestamp_micros for event in replay.events()]
        assert seen == sorted(seen)

    def test_ties_are_broken_by_kind_then_sequence(self) -> None:
        """A book update must be applied before a trade at the same instant."""
        book_event = snapshot_event(0, bid_qty="1", ask_qty="1")
        trade = trade_event(0, price="30000")
        dataset = HistoricalDataset.from_events(
            [trade, book_event], dataset_id="tie", source="test"
        )
        kinds = [event.kind for event in dataset]
        assert kinds == [MarketEventKind.BOOK_SNAPSHOT, MarketEventKind.TRADE]

    def test_clock_matches_the_event_being_delivered(self) -> None:
        dataset = oscillating_dataset(5)
        replay = ReplayEngine(dataset)
        for event in replay.events():
            assert replay.clock.now_micros() == event.timestamp_micros

    def test_cursor_cannot_see_the_future(self) -> None:
        dataset = oscillating_dataset(5)
        replay = ReplayEngine(dataset)
        iterator = replay.events()
        first = next(iterator)
        history = replay.cursor.history()
        assert len(history) == 1
        assert history[0] is first
        with pytest.raises(LookAheadError):
            replay.cursor.assert_not_future(first.timestamp_micros + 1)

    def test_history_never_exceeds_its_limit(self) -> None:
        dataset = oscillating_dataset(30)
        replay = ReplayEngine(dataset, history_limit=5)
        for _ in replay.events():
            pass
        assert len(replay.cursor.history()) <= 5

    def test_timer_ticks_fire_between_events(self) -> None:
        dataset = oscillating_dataset(6)
        replay = ReplayEngine(dataset, timer_interval_micros=2_000_000)
        ticks: list[int] = []
        stats = replay.run(on_event=lambda event, cursor: None, on_timer=ticks.append)
        assert stats.timer_ticks == len(ticks) > 0
        assert ticks == sorted(ticks)

    def test_reset_replays_the_identical_sequence(self) -> None:
        dataset = oscillating_dataset(8)
        replay = ReplayEngine(dataset)
        first = [event.checksum_source() for event in replay.events()]
        replay.reset()
        second = [event.checksum_source() for event in replay.events()]
        assert first == second


# ---------------------------------------------------------------------------
# Simulated execution
# ---------------------------------------------------------------------------
class TestSimulatedExecution:
    """Cases 18-21: market and limit execution, fees, slippage."""

    def engine(self, **kwargs: object) -> SimulatedMatchingEngine:
        return SimulatedMatchingEngine(
            ExecutionAssumptions(**kwargs),  # type: ignore[arg-type]
            id_factory=SimulatedIdFactory(prefix="test"),
        )

    def test_market_buy_lifts_the_observed_ask(self) -> None:
        match = self.engine().submit(
            intent(quantity="1"),
            client_order_id="c1",
            order_id="o1",
            book=book(),
            now_micros=BASE_TS,
        )
        assert match.status is OrderStatus.FILLED
        assert match.fills[0].price == D("30005")
        assert match.fills[0].is_simulated is True

    def test_market_sell_hits_the_observed_bid(self) -> None:
        match = self.engine().submit(
            intent(side=OrderSide.SELL),
            client_order_id="c1",
            order_id="o1",
            book=book(),
            now_micros=BASE_TS,
        )
        assert match.fills[0].price == D("29995")

    def test_no_book_means_no_invented_fill(self) -> None:
        match = self.engine().submit(
            intent(), client_order_id="c1", order_id="o1", book=None, now_micros=BASE_TS
        )
        assert match.fills == ()
        assert match.rests is True

    def test_non_marketable_limit_rests(self) -> None:
        match = self.engine().submit(
            intent(order_type=OrderType.LIMIT, price="29000"),
            client_order_id="c1",
            order_id="o1",
            book=book(),
            now_micros=BASE_TS,
        )
        assert match.fills == ()
        assert match.rests is True
        assert match.status is OrderStatus.ACKNOWLEDGED

    def test_marketable_limit_gets_price_improvement(self) -> None:
        match = self.engine().submit(
            intent(order_type=OrderType.LIMIT, price="30100"),
            client_order_id="c1",
            order_id="o1",
            book=book(),
            now_micros=BASE_TS,
        )
        assert match.fills[0].price == D("30005")

    def test_a_resting_bid_fills_when_the_ask_comes_down(self) -> None:
        engine = self.engine()
        engine.submit(
            intent(order_type=OrderType.LIMIT, price="29000"),
            client_order_id="c1",
            order_id="o1",
            book=book(),
            now_micros=BASE_TS,
        )
        assert engine.resting_count == 1
        events = engine.on_book_update(
            book(bid="28900", ask="28950"), now_micros=BASE_TS + 1_000
        )
        assert len(events) == 1
        assert events[0].fill.is_maker is True
        assert engine.resting_count == 0

    def test_a_crossed_book_produces_no_resting_fill(self) -> None:
        engine = self.engine()
        engine.submit(
            intent(order_type=OrderType.LIMIT, price="29000"),
            client_order_id="c1",
            order_id="o1",
            book=book(),
            now_micros=BASE_TS,
        )
        crossed = BookTop(
            exchange=EXCHANGE,
            symbol=SYMBOL,
            best_bid=D("30010"),
            best_bid_quantity=D("1"),
            best_ask=D("28000"),
            best_ask_quantity=D("1"),
            sequence=2,
            exchange_timestamp=BASE_TS,
            received_timestamp=BASE_TS,
        )
        assert engine.on_book_update(crossed, now_micros=BASE_TS + 10) == ()

    def test_fill_is_capped_by_displayed_size(self) -> None:
        match = self.engine().submit(
            intent(quantity="10"),
            client_order_id="c1",
            order_id="o1",
            book=book(ask_qty="1.5"),
            now_micros=BASE_TS,
        )
        assert match.fills[0].quantity == D("1.5")
        assert match.status is OrderStatus.PARTIALLY_FILLED

    def test_partial_fills_can_be_disabled(self) -> None:
        match = self.engine(allow_partial_fills=False).submit(
            intent(quantity="10"),
            client_order_id="c1",
            order_id="o1",
            book=book(ask_qty="1.5"),
            now_micros=BASE_TS,
        )
        assert match.fills == ()

    def test_min_fill_quantity_suppresses_dust(self) -> None:
        match = self.engine(min_fill_quantity=D("2")).submit(
            intent(quantity="1"),
            client_order_id="c1",
            order_id="o1",
            book=book(ask_qty="1"),
            now_micros=BASE_TS,
        )
        assert match.fills == ()

    def test_taker_and_maker_fees_are_separate(self) -> None:
        engine = self.engine(
            maker_fee_rate=D("0.0001"), taker_fee_rate=D("0.001")
        )
        taker = engine.submit(
            intent(quantity="1"),
            client_order_id="c1",
            order_id="o1",
            book=book(),
            now_micros=BASE_TS,
        )
        assert taker.fills[0].is_maker is False
        assert taker.fills[0].fee == D("30005") * D("1") * D("0.001")

        engine.submit(
            intent(order_type=OrderType.LIMIT, price="29000"),
            client_order_id="c2",
            order_id="o2",
            book=book(),
            now_micros=BASE_TS,
        )
        maker_events = engine.on_book_update(
            book(bid="28900", ask="28950"), now_micros=BASE_TS + 10
        )
        maker_fill = maker_events[0].fill
        assert maker_fill.is_maker is True
        assert maker_fill.fee == maker_fill.price * maker_fill.quantity * D("0.0001")

    def test_slippage_worsens_the_taker_price_on_both_sides(self) -> None:
        engine = self.engine(slippage_bps=D("10"))
        buy = engine.submit(
            intent(),
            client_order_id="c1",
            order_id="o1",
            book=book(),
            now_micros=BASE_TS,
        )
        sell = engine.submit(
            intent(side=OrderSide.SELL),
            client_order_id="c2",
            order_id="o2",
            book=book(),
            now_micros=BASE_TS,
        )
        assert buy.fills[0].price > D("30005")
        assert sell.fills[0].price < D("29995")
        assert buy.slippage_cost > D("0")

    def test_zero_slippage_leaves_the_touch_untouched(self) -> None:
        match = self.engine(slippage_bps=D("0")).submit(
            intent(),
            client_order_id="c1",
            order_id="o1",
            book=book(),
            now_micros=BASE_TS,
        )
        assert match.fills[0].price == D("30005")
        assert match.slippage_cost == D("0")

    def test_latency_prevents_filling_against_the_submission_book(self) -> None:
        engine = self.engine(latency_micros=500_000)
        match = engine.submit(
            intent(),
            client_order_id="c1",
            order_id="o1",
            book=book(),
            now_micros=BASE_TS,
        )
        assert match.fills == ()
        assert engine.on_book_update(book(), now_micros=BASE_TS + 100) == ()
        events = engine.on_book_update(book(), now_micros=BASE_TS + 500_000)
        assert len(events) == 1

    def test_every_fill_is_flagged_simulated(self) -> None:
        engine = self.engine()
        match = engine.submit(
            intent(),
            client_order_id="c1",
            order_id="o1",
            book=book(),
            now_micros=BASE_TS,
        )
        assert all(fill.is_simulated for fill in match.fills)
        assert match.is_simulated is True

    def test_ids_are_deterministic(self) -> None:
        first = self.engine().submit(
            intent(),
            client_order_id="c1",
            order_id="o1",
            book=book(),
            now_micros=BASE_TS,
        )
        second = self.engine().submit(
            intent(),
            client_order_id="c1",
            order_id="o1",
            book=book(),
            now_micros=BASE_TS,
        )
        assert first.fills[0].fill_id == second.fills[0].fill_id

    def test_a_structurally_invalid_intent_is_rejected(self) -> None:
        broken = intent(quantity="1")
        broken.quantity = D("-1")
        match = self.engine().submit(
            broken,
            client_order_id="c1",
            order_id="o1",
            book=book(),
            now_micros=BASE_TS,
        )
        assert match.accepted is False
        assert match.status is OrderStatus.REJECTED

    def test_assumptions_reject_a_percentage_style_fee(self) -> None:
        with pytest.raises(ValueError):
            ExecutionAssumptions(taker_fee_rate=D("10"))

    def test_assumptions_reject_negative_slippage(self) -> None:
        with pytest.raises(ValueError):
            ExecutionAssumptions(slippage_bps=D("-1"))


# ---------------------------------------------------------------------------
# Portfolio
# ---------------------------------------------------------------------------
class TestSimulatedPortfolio:
    """Cases 22-24: portfolio accounting, PnL and drawdown."""

    def make(self, cash: str = "10000") -> SimulatedPortfolio:
        return SimulatedPortfolio(
            initial_cash=D(cash),
            tenant_id="tenant-1",
            account_id="account-1",
            exchange=EXCHANGE,
            symbol=SYMBOL,
        )

    def fill(
        self,
        *,
        side: OrderSide,
        price: str,
        quantity: str,
        fee: str = "0",
        index: int = 0,
    ) -> Fill:
        return Fill(
            fill_id=f"sim-fill-{index}",
            order_id=f"sim-order-{index}",
            trade_id=f"sim-trade-{index}",
            price=D(price),
            quantity=D(quantity),
            fee=D(fee),
            fee_currency="USDT",
            is_maker=False,
            is_simulated=True,
            exchange_timestamp=BASE_TS + index,
            received_timestamp=BASE_TS + index,
            symbol=SYMBOL,
            side=side,
            exchange=EXCHANGE,
        )

    def test_a_buy_spends_cash_and_adds_exposure(self) -> None:
        portfolio = self.make()
        portfolio.apply_fill(
            self.fill(side=OrderSide.BUY, price="30000", quantity="0.1", fee="3")
        )
        assert portfolio.cash == D("10000") - D("3000") - D("3")
        assert portfolio.base_quantity == D("0.1")
        assert portfolio.fees_paid == D("3")

    def test_a_round_trip_realises_pnl_net_of_fees(self) -> None:
        portfolio = self.make()
        portfolio.apply_fill(
            self.fill(side=OrderSide.BUY, price="30000", quantity="0.1", fee="3", index=0)
        )
        portfolio.apply_fill(
            self.fill(side=OrderSide.SELL, price="31000", quantity="0.1", fee="3", index=1)
        )
        assert portfolio.realised_pnl == D("100")
        assert portfolio.net_pnl == D("94")
        assert portfolio.base_quantity == D("0")
        assert len(portfolio.closed_trades) == 1
        assert portfolio.closed_trades[0].is_win is True

    def test_a_losing_round_trip_is_recorded_as_a_loss(self) -> None:
        portfolio = self.make()
        portfolio.apply_fill(
            self.fill(side=OrderSide.BUY, price="30000", quantity="0.1", index=0)
        )
        portfolio.apply_fill(
            self.fill(side=OrderSide.SELL, price="29000", quantity="0.1", index=1)
        )
        assert portfolio.realised_pnl == D("-100")
        assert portfolio.closed_trades[0].is_win is False

    def test_a_fee_only_trade_counts_as_a_loss(self) -> None:
        """Break-even before costs is a loss after them."""
        portfolio = self.make()
        portfolio.apply_fill(
            self.fill(side=OrderSide.BUY, price="30000", quantity="0.1", index=0)
        )
        portfolio.apply_fill(
            self.fill(side=OrderSide.SELL, price="30000", quantity="0.1", fee="1", index=1)
        )
        assert portfolio.closed_trades[0].is_win is False

    def test_unrealised_pnl_is_none_when_flat(self) -> None:
        assert self.make().unrealised_pnl is None

    def test_unrealised_pnl_follows_the_mark(self) -> None:
        portfolio = self.make()
        portfolio.apply_fill(
            self.fill(side=OrderSide.BUY, price="30000", quantity="0.1")
        )
        portfolio.mark_to_market(timestamp_micros=BASE_TS, mark_price=D("31000"))
        assert portfolio.unrealised_pnl == D("100")

    def test_equity_combines_cash_and_marked_exposure(self) -> None:
        portfolio = self.make()
        portfolio.apply_fill(
            self.fill(side=OrderSide.BUY, price="30000", quantity="0.1")
        )
        assert portfolio.equity(D("30000")) == D("10000")

    def test_drawdown_tracks_the_worst_decline(self) -> None:
        portfolio = self.make()
        portfolio.mark_to_market(timestamp_micros=BASE_TS, mark_price=None)
        portfolio.apply_fill(
            self.fill(side=OrderSide.BUY, price="30000", quantity="0.1")
        )
        portfolio.mark_to_market(timestamp_micros=BASE_TS + 1, mark_price=D("31000"))
        portfolio.mark_to_market(timestamp_micros=BASE_TS + 2, mark_price=D("29000"))
        assert portfolio.peak_equity == D("10100")
        assert portfolio.max_drawdown == D("200")

    def test_a_real_fill_is_refused(self) -> None:
        """A simulated portfolio must never absorb a real fill."""
        portfolio = self.make()
        real = Fill(
            fill_id="real-1",
            order_id="o",
            trade_id="t",
            price=D("30000"),
            quantity=D("0.1"),
            fee=D("0"),
            fee_currency="USDT",
            is_maker=False,
            is_simulated=False,
            exchange_timestamp=BASE_TS,
            received_timestamp=BASE_TS,
            symbol=SYMBOL,
            side=OrderSide.BUY,
            exchange=EXCHANGE,
        )
        with pytest.raises(Exception):
            portfolio.apply_fill(real)

    def test_exposure_fraction_is_none_before_any_observation(self) -> None:
        assert self.make().exposure_fraction is None

    def test_reserved_cash_reduces_availability(self) -> None:
        portfolio = self.make()
        portfolio.reserve(D("1000"))
        assert portfolio.available_cash == D("9000")
        portfolio.release(D("5000"))
        assert portfolio.reserved == D("0")


# ---------------------------------------------------------------------------
# Full backtest
# ---------------------------------------------------------------------------
class TestBacktestRun:
    """Cases 16, 25, 26, 28: determinism, metrics, hashing, reproducibility."""

    def test_a_run_produces_a_complete_result(self) -> None:
        result = build_backtest(oscillating_dataset()).run()
        assert result.is_simulated is True
        assert result.strategy_key == "DETERMINISTIC_IMBALANCE_V1"
        assert result.strategy_version == "1.0.0"
        assert result.symbol == SYMBOL
        assert result.exchange is EXCHANGE
        assert result.phase is BacktestPhase.TEST
        assert result.events_replayed == 40
        assert result.dataset.checksum
        assert result.configuration_hash
        assert result.is_reproducible is True

    def test_the_same_inputs_produce_an_identical_result(self) -> None:
        """The mandatory backtest-reproducibility test."""
        dataset = oscillating_dataset()
        first = build_backtest(dataset).run()
        second = build_backtest(dataset).run()

        assert first.matches(second)
        assert first.run_id == second.run_id
        assert first.configuration_hash == second.configuration_hash
        assert first.to_dict(include_curve=True) == second.to_dict(include_curve=True)

    def test_changing_a_fee_changes_the_configuration_hash(self) -> None:
        dataset = oscillating_dataset(20)
        cheap = build_backtest(
            dataset, assumptions=ExecutionAssumptions(taker_fee_rate=D("0.0001"))
        ).run()
        dear = build_backtest(
            dataset, assumptions=ExecutionAssumptions(taker_fee_rate=D("0.002"))
        ).run()
        assert cheap.configuration_hash != dear.configuration_hash
        assert cheap.metrics.fees != dear.metrics.fees

    def test_changing_the_dataset_changes_the_hash(self) -> None:
        first = build_backtest(oscillating_dataset(20)).run()
        second = build_backtest(oscillating_dataset(30)).run()
        assert first.configuration_hash != second.configuration_hash

    def test_the_configuration_hash_contains_no_secret_material(self) -> None:
        result = build_backtest(oscillating_dataset(10)).run()
        rendered = str(result.to_dict()).lower()
        for word in ("secret", "api_key", "apikey", "private_key", "password", "token"):
            assert word not in rendered

    def test_higher_fees_reduce_the_result(self) -> None:
        dataset = oscillating_dataset()
        cheap = build_backtest(
            dataset, assumptions=ExecutionAssumptions(taker_fee_rate=D("0.0001"))
        ).run()
        dear = build_backtest(
            dataset, assumptions=ExecutionAssumptions(taker_fee_rate=D("0.005"))
        ).run()
        assert dear.metrics.final_equity < cheap.metrics.final_equity

    def test_slippage_costs_money(self) -> None:
        dataset = oscillating_dataset()
        none = build_backtest(
            dataset, assumptions=ExecutionAssumptions(slippage_bps=D("0"))
        ).run()
        some = build_backtest(
            dataset, assumptions=ExecutionAssumptions(slippage_bps=D("25"))
        ).run()
        assert some.metrics.slippage_cost > D("0")
        assert some.metrics.final_equity < none.metrics.final_equity

    def test_every_fill_in_the_run_is_simulated(self) -> None:
        engine = build_backtest(oscillating_dataset())
        engine.run()
        position = engine.portfolio.position
        assert position is None or position.contains_simulated_fills is True

    def test_a_run_cannot_be_repeated_on_the_same_engine(self) -> None:
        engine = build_backtest(oscillating_dataset(10))
        engine.run()
        with pytest.raises(RuntimeError):
            engine.run()

    def test_risk_rejections_are_counted_not_hidden(self) -> None:
        """Case 30: the strategy cannot bypass the risk engine."""
        tiny = RiskLimits(
            max_order_quantity=D("0.0000001"),
            max_order_notional=D("1000000"),
            max_market_data_age_micros=60_000_000,
        )
        result = build_backtest(oscillating_dataset(), limits=tiny).run()
        assert result.signals_accepted > 0
        assert result.risk_rejections == result.signals_accepted
        assert result.simulated_orders == 0
        assert result.metrics.trade_count == 0

    def test_absent_risk_limits_reject_everything(self) -> None:
        """Fail closed: no limits configured means no orders."""
        result = build_backtest(oscillating_dataset(), limits=RiskLimits()).run()
        assert result.simulated_orders == 0
        assert result.risk_rejections > 0

    def test_metrics_withhold_ratios_on_a_flat_curve(self) -> None:
        result = build_backtest(oscillating_dataset(6)).run()
        assert result.metrics.sharpe_ratio is None or result.metrics.has_sufficient_observations

    def test_no_trades_means_no_win_rate(self) -> None:
        result = build_backtest(oscillating_dataset(), limits=RiskLimits()).run()
        assert result.metrics.trade_count == 0
        assert result.metrics.win_rate is None
        assert result.metrics.average_trade is None

    def test_the_summary_always_carries_the_disclaimer(self) -> None:
        result = build_backtest(oscillating_dataset(10)).run()
        text = "\n".join(result.summary_lines()).lower()
        assert "not indicative of future performance" in text
        assert "simulated" in text

    def test_the_engine_holds_no_execution_adapter(self) -> None:
        """Case 29: a backtest cannot reach a venue."""
        engine = build_backtest(oscillating_dataset(5))
        for forbidden in ("adapter", "client", "session", "api_key", "secret"):
            assert not hasattr(engine, forbidden)

    def test_no_backtest_module_imports_an_adapter(self) -> None:
        import pathlib

        root = pathlib.Path(__file__).resolve().parents[1] / "wlct_trading" / "backtest"
        for path in root.rglob("*.py"):
            imports = [
                line
                for line in path.read_text(encoding="utf-8").splitlines()
                if line.startswith(("import ", "from "))
            ]
            for line in imports:
                assert "wlct_trading.adapters" not in line, f"{path}: {line}"
                assert "wlct_trading.net" not in line, f"{path}: {line}"
                assert "wlct_trading.execution" not in line, f"{path}: {line}"

    def test_the_result_carries_the_dataset_identity(self) -> None:
        result = build_backtest(oscillating_dataset(10)).run()
        payload = result.to_dict()["dataset"]
        assert isinstance(payload, dict)
        assert payload["datasetId"] == "oscillating-1"
        assert payload["source"] == "unit-test-fixture"
        assert payload["checksum"]


class TestConfigurationHash:
    def test_hash_is_stable_for_the_same_inputs(self) -> None:
        dataset = oscillating_dataset(5)
        arguments = dict(
            strategy_key="K",
            strategy_version="1.0.0",
            implementation_id="module.Class",
            parameters=(("a", "1"), ("b", "2")),
            assumptions=ExecutionAssumptions(),
            dataset=dataset.descriptor,
            initial_capital=D("10000"),
        )
        assert compute_configuration_hash(**arguments) == compute_configuration_hash(
            **arguments
        )

    def test_hash_changes_with_a_parameter(self) -> None:
        dataset = oscillating_dataset(5)
        base = dict(
            strategy_key="K",
            strategy_version="1.0.0",
            implementation_id="module.Class",
            assumptions=ExecutionAssumptions(),
            dataset=dataset.descriptor,
            initial_capital=D("10000"),
        )
        first = compute_configuration_hash(parameters=(("a", "1"),), **base)
        second = compute_configuration_hash(parameters=(("a", "2"),), **base)
        assert first != second


class TestWalkForward:
    """Case 31 foundation: labelled, non-overlapping windows."""

    def test_split_produces_three_ordered_windows(self) -> None:
        split = split_dataset(oscillating_dataset(60))
        phases = [window.phase for window in split.windows()]
        assert phases == [
            BacktestPhase.TRAINING,
            BacktestPhase.VALIDATION,
            BacktestPhase.TEST,
        ]
        assert split.is_non_overlapping is True

    def test_each_window_is_checksummed_separately(self) -> None:
        split = split_dataset(oscillating_dataset(60))
        checksums = {window.dataset.descriptor.checksum for window in split.windows()}
        assert len(checksums) == 3

    def test_fractions_must_leave_a_test_window(self) -> None:
        with pytest.raises(ValueError):
            split_dataset(
                oscillating_dataset(20),
                training_fraction=D("0.8"),
                validation_fraction=D("0.3"),
            )

    def test_rolling_windows_advance_and_stay_bounded(self) -> None:
        dataset = oscillating_dataset(30)
        windows = list(
            rolling_windows(
                dataset, window_micros=5_000_000, step_micros=5_000_000
            )
        )
        assert windows
        assert all(window.event_count > 0 for window in windows)
        starts = [window.start_micros for window in windows]
        assert starts == sorted(starts)

    def test_a_training_result_is_labelled_as_such(self) -> None:
        dataset = oscillating_dataset(60)
        split = split_dataset(dataset)
        registry = build_default_strategy_registry()
        strategy = registry.create(
            "DETERMINISTIC_IMBALANCE_V1",
            "1.0.0",
            descriptor=descriptor(),
            symbol=SYMBOL,
            parameters={"use_limit_orders": False, "signal_cooldown_micros": 0},
        )
        engine = BacktestEngine(
            strategy=strategy,
            dataset=split.training.dataset,
            config=BacktestConfig(
                tenant_id="tenant-1",
                account_id="account-1",
                initial_capital=D("10000"),
                risk_limits=permissive(),
                phase=BacktestPhase.TRAINING,
            ),
        )
        result = engine.run()
        assert result.phase is BacktestPhase.TRAINING
        assert result.dataset.dataset_id.startswith("oscillating-1#")
