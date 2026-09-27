"""Part 6: feature engine tests.

Determinism, bounded memory, explicit insufficient-history handling and safe
arithmetic. Every value in these tests is a ``Decimal`` written as a string -
no binary float ever enters a price or a quantity, and a test that used one
would be asserting the wrong contract.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from wlct_trading.enums import OrderSide
from wlct_trading.market_data import BookTop, Candle, PublicTrade, Ticker
from wlct_trading.strategies.features import (
    FeatureConfig,
    FeatureEngine,
    RollingReturns,
    RollingWindow,
    depth_imbalance,
    max_drawdown,
    order_book_imbalance,
    profit_factor,
    safe_ratio,
    sharpe_ratio,
    sortino_ratio,
    spread_basis_points,
    weighted_mid_price,
)
from wlct_trading.strategies.features.statistics import MIN_RISK_METRIC_OBSERVATIONS

from tests.conftest import BASE_TS, EXCHANGE, SYMBOL

D = Decimal


def top(
    *,
    bid: str | None = "29995.00",
    bid_qty: str | None = "2.0",
    ask: str | None = "30005.00",
    ask_qty: str | None = "1.0",
    timestamp: int = BASE_TS,
) -> BookTop:
    return BookTop(
        exchange=EXCHANGE,
        symbol=SYMBOL,
        best_bid=D(bid) if bid is not None else None,
        best_bid_quantity=D(bid_qty) if bid_qty is not None else None,
        best_ask=D(ask) if ask is not None else None,
        best_ask_quantity=D(ask_qty) if ask_qty is not None else None,
        sequence=1,
        exchange_timestamp=timestamp,
        received_timestamp=timestamp + 100,
    )


class TestOrderBookImbalance:
    """Case 6/7: the imbalance definition and its zero denominator."""

    def test_definition_matches_the_specification(self) -> None:
        # (9 - 1) / (9 + 1) = 0.8
        assert order_book_imbalance(D("9"), D("1")) == D("0.8")

    def test_equal_sizes_are_exactly_zero(self) -> None:
        assert order_book_imbalance(D("5"), D("5")) == D("0")

    def test_all_volume_on_one_side_saturates_at_one(self) -> None:
        assert order_book_imbalance(D("3"), D("0")) == D("1")
        assert order_book_imbalance(D("0"), D("3")) == D("-1")

    def test_empty_book_is_none_not_zero(self) -> None:
        """A zero denominator must not be reported as a balanced book."""
        assert order_book_imbalance(D("0"), D("0")) is None

    def test_missing_side_is_none(self) -> None:
        assert order_book_imbalance(None, D("1")) is None
        assert order_book_imbalance(D("1"), None) is None

    def test_negative_quantity_is_rejected(self) -> None:
        assert order_book_imbalance(D("-1"), D("1")) is None

    def test_result_is_always_finite_and_bounded(self) -> None:
        for bid, ask in (("1", "1"), ("0", "7"), ("7", "0"), ("0.00001", "9999")):
            value = order_book_imbalance(D(bid), D(ask))
            assert value is not None
            assert value.is_finite()
            assert D("-1") <= value <= D("1")

    def test_safe_ratio_never_divides_by_zero(self) -> None:
        assert safe_ratio(D("1"), D("0")) is None
        assert safe_ratio(D("0"), D("0")) is None
        assert safe_ratio(D("1"), D("4")) == D("0.25")


class TestMicrostructureHelpers:
    def test_weighted_mid_leans_towards_the_lighter_side(self) -> None:
        # Heavy bid (2.0) versus light ask (1.0) pushes the estimate up.
        value = weighted_mid_price(top(bid_qty="2.0", ask_qty="1.0"))
        assert value is not None
        assert value > D("30000.00")

    def test_weighted_mid_is_none_without_sizes(self) -> None:
        """No silent fallback to the arithmetic mid."""
        assert weighted_mid_price(top(bid_qty=None, ask_qty=None)) is None

    def test_spread_basis_points(self) -> None:
        value = spread_basis_points(top())
        assert value is not None
        # 10.00 wide on a 30 000 mid is 3.33 bps.
        assert value.quantize(D("0.01")) == D("3.33")

    def test_depth_imbalance_uses_the_requested_depth(self, snapshot) -> None:
        shallow = depth_imbalance(snapshot, depth=1)
        deep = depth_imbalance(snapshot, depth=5)
        assert shallow is not None and deep is not None
        assert shallow != deep


class TestRollingWindow:
    """Cases 8 and 9: bounded windows and explicit insufficient history."""

    def test_capacity_is_never_exceeded(self) -> None:
        window = RollingWindow(capacity=3)
        for value in ("1", "2", "3", "4", "5"):
            window.push(D(value))
        assert len(window) == 3
        assert window.values() == (D("3"), D("4"), D("5"))

    def test_statistics_are_none_until_the_window_is_full(self) -> None:
        window = RollingWindow(capacity=4)
        window.extend([D("1"), D("2")])
        assert window.is_ready is False
        assert window.mean is None
        assert window.standard_deviation is None
        window.extend([D("3"), D("4")])
        assert window.is_ready is True
        assert window.mean == D("2.5")

    def test_variance_uses_the_sample_convention(self) -> None:
        window = RollingWindow(capacity=4, min_samples=2)
        window.extend([D("2"), D("4"), D("4"), D("6")])
        # Sample variance (ddof=1) of 2,4,4,6 is 8/3.
        variance = window.variance
        assert variance is not None
        assert variance.quantize(D("0.0001")) == D("2.6667")

    def test_single_observation_has_no_variance(self) -> None:
        window = RollingWindow(capacity=4, min_samples=1)
        window.push(D("7"))
        assert window.mean == D("7")
        assert window.variance is None

    def test_reset_clears_everything(self) -> None:
        window = RollingWindow(capacity=2)
        window.extend([D("1"), D("2")])
        window.reset()
        assert len(window) == 0
        assert window.mean is None

    def test_rejects_a_non_decimal(self) -> None:
        window = RollingWindow(capacity=2)
        with pytest.raises(TypeError):
            window.push(1.5)  # type: ignore[arg-type]

    def test_identical_inputs_produce_identical_output(self) -> None:
        """Case 1 of determinism: the same values give the same statistics."""
        values = [D("1.5"), D("2.5"), D("3.5"), D("4.5")]
        first = RollingWindow(capacity=4)
        second = RollingWindow(capacity=4)
        first.extend(values)
        second.extend(values)
        assert first.to_dict() == second.to_dict()


class TestRollingReturns:
    def test_first_price_yields_no_return(self) -> None:
        returns = RollingReturns(capacity=3)
        assert returns.push_price(D("100")) is None
        assert returns.push_price(D("110")) == D("0.1")

    def test_zero_price_does_not_raise(self) -> None:
        returns = RollingReturns(capacity=3)
        returns.push_price(D("0"))
        assert returns.push_price(D("100")) is None

    def test_volatility_requires_a_full_window(self) -> None:
        returns = RollingReturns(capacity=3)
        for price in ("100", "101", "102"):
            returns.push_price(D(price))
        assert returns.volatility is None
        returns.push_price(D("103"))
        assert returns.volatility is not None


class TestRiskStatistics:
    """Case 25: a metric must not be presented on insufficient observations."""

    def test_sharpe_is_withheld_below_the_observation_floor(self) -> None:
        few = [D("0.01")] * (MIN_RISK_METRIC_OBSERVATIONS - 1)
        assert sharpe_ratio(few) is None

    def test_sharpe_is_computed_once_there_are_enough_varied_observations(self) -> None:
        values = [D("0.01") if index % 2 else D("-0.005") for index in range(40)]
        assert sharpe_ratio(values) is not None

    def test_sharpe_of_a_constant_series_is_none(self) -> None:
        """Zero dispersion is not an infinite Sharpe ratio."""
        assert sharpe_ratio([D("0.01")] * 40) is None

    def test_sortino_ignores_upside_dispersion(self) -> None:
        upside_only = [D("0.01")] * 40
        assert sortino_ratio(upside_only) is None

    def test_max_drawdown_measures_the_worst_peak_to_trough(self) -> None:
        absolute, fraction = max_drawdown(
            [D("100"), D("120"), D("90"), D("110"), D("80")]
        )
        assert absolute == D("40")
        assert fraction is not None
        assert fraction.quantize(D("0.0001")) == D("0.3333")

    def test_max_drawdown_of_a_rising_curve_is_zero(self) -> None:
        absolute, fraction = max_drawdown([D("100"), D("110"), D("120")])
        assert absolute == D("0")
        assert fraction == D("0") or fraction is None

    def test_profit_factor_is_none_without_losses(self) -> None:
        assert profit_factor(D("100"), D("0")) is None
        assert profit_factor(D("100"), D("-50")) == D("2")


class TestFeatureEngine:
    """Cases 6-9 at the engine level, plus determinism and reset."""

    def make(self) -> FeatureEngine:
        return FeatureEngine(
            exchange=EXCHANGE,
            symbol=SYMBOL,
            config=FeatureConfig(
                return_window=3, volatility_window=3, volume_window=3,
                spread_window=3, trade_window=3,
            ),
        )

    def test_snapshot_before_any_data_is_all_none(self) -> None:
        snapshot = self.make().snapshot(as_of_micros=BASE_TS)
        assert snapshot.mid_price is None
        assert snapshot.order_book_imbalance is None
        assert snapshot.rolling_volatility is None
        assert snapshot.book_update_count == 0

    def test_book_top_populates_touch_features(self) -> None:
        engine = self.make()
        engine.observe_book_top(top(bid_qty="9", ask_qty="1"))
        snapshot = engine.snapshot(as_of_micros=BASE_TS)
        assert snapshot.mid_price == D("30000.00")
        assert snapshot.order_book_imbalance == D("0.8")
        assert snapshot.spread == D("10.00")
        assert snapshot.book_update_count == 1

    def test_crossed_book_is_ignored_and_counted(self) -> None:
        engine = self.make()
        engine.observe_book_top(top(bid="30010.00", ask="30005.00"))
        assert engine.error_count == 1
        assert engine.snapshot(as_of_micros=BASE_TS).mid_price is None

    def test_rolling_features_need_history(self) -> None:
        engine = self.make()
        for index in range(3):
            engine.observe_book_top(
                top(
                    bid=str(29995 + index),
                    ask=str(30005 + index),
                    timestamp=BASE_TS + index * 1_000,
                )
            )
        snapshot = engine.snapshot(as_of_micros=BASE_TS)
        assert snapshot.rolling_volatility is None
        engine.observe_book_top(top(bid="30000", ask="30010"))
        assert engine.snapshot(as_of_micros=BASE_TS).rolling_volatility is not None

    def test_trades_accumulate_into_tape_features(self) -> None:
        engine = self.make()
        for index in range(2):
            engine.observe_trade(
                PublicTrade(
                    exchange=EXCHANGE,
                    symbol=SYMBOL,
                    trade_id=f"t{index}",
                    price=D("30000"),
                    quantity=D("0.5"),
                    aggressor_side=OrderSide.BUY,
                    exchange_timestamp=BASE_TS + index,
                    received_timestamp=BASE_TS + index,
                )
            )
        snapshot = engine.snapshot(as_of_micros=BASE_TS)
        assert snapshot.trade_count == 2
        assert snapshot.buy_volume == D("1.0")
        assert snapshot.sell_volume == D("0")

    def test_ticker_and_candle_are_observed(self) -> None:
        engine = self.make()
        engine.observe_ticker(
            Ticker(
                exchange=EXCHANGE,
                symbol=SYMBOL,
                bid_price=D("29995"),
                ask_price=D("30005"),
                last_price=D("30000"),
                exchange_timestamp=BASE_TS,
                received_timestamp=BASE_TS,
            )
        )
        engine.observe_trade(
            PublicTrade(
                exchange=EXCHANGE,
                symbol=SYMBOL,
                trade_id="t-last",
                price=D("30005"),
                quantity=D("0.25"),
                aggressor_side=OrderSide.SELL,
                exchange_timestamp=BASE_TS,
                received_timestamp=BASE_TS,
            )
        )
        engine.observe_candle(
            Candle(
                exchange=EXCHANGE,
                symbol=SYMBOL,
                interval="1m",
                open=D("30000"),
                high=D("30010"),
                low=D("29990"),
                close=D("30005"),
                volume=D("12"),
                open_time=BASE_TS,
                close_time=BASE_TS + 60_000_000,
                trade_count=10,
                is_closed=True,
                received_timestamp=BASE_TS,
            )
        )
        snapshot = engine.snapshot(as_of_micros=BASE_TS)
        assert snapshot.last_trade_price == D("30005")

    def test_reset_returns_the_engine_to_its_initial_state(self) -> None:
        engine = self.make()
        engine.observe_book_top(top())
        engine.reset()
        snapshot = engine.snapshot(as_of_micros=BASE_TS)
        assert snapshot.mid_price is None
        assert snapshot.book_update_count == 0
        assert engine.book_top is None

    def test_two_engines_fed_identically_agree_exactly(self) -> None:
        first, second = self.make(), self.make()
        for index in range(6):
            book = top(
                bid=str(29990 + index),
                ask=str(30010 - index),
                timestamp=BASE_TS + index,
            )
            first.observe_book_top(book)
            second.observe_book_top(book)
        assert first.snapshot(as_of_micros=BASE_TS).to_dict() == second.snapshot(
            as_of_micros=BASE_TS
        ).to_dict()

    def test_snapshot_carries_the_event_instant_not_the_wall_clock(self) -> None:
        engine = self.make()
        engine.observe_book_top(top())
        assert engine.snapshot(as_of_micros=BASE_TS).as_of_micros == BASE_TS

    def test_no_feature_is_a_binary_float(self) -> None:
        engine = self.make()
        engine.observe_book_top(top())
        for value in engine.snapshot(as_of_micros=BASE_TS).as_mapping().values():
            assert value is None or isinstance(value, Decimal)
