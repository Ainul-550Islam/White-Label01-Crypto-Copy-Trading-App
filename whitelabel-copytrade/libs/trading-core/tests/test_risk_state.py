"""Part 8 state model: snapshot integrity, freshness, exposure and reservation.

Acceptance lines covered: risk snapshots are versioned and freshness-aware
(spec criterion 3), exposure includes open-order reservations (4), projected
exposure before approval (5), invalid account/position states (11, 12), plus
the deterministic edge behaviour of the projection arithmetic itself: sign
handling, buy/sell symmetry, reduce-only clipping at flat, and exact-Decimal
aggregation (the "property/edge" brief, executed as fixed corpora rather than
random draws so every failure reproduces byte-identically).
"""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
from decimal import Decimal

import pytest

from wlct_trading.enums import (
    ExchangeId,
    MarketType,
    OrderBookHealth,
    OrderSide,
    OrderStatus,
    OrderType,
    TimeInForce,
)
from wlct_trading.orders import OrderIntent
from wlct_trading.risk.exposure import (
    ExposureDimension,
    OpenOrderView,
    ProjectingContext,
    PositionView,
    ReferenceView,
    build_breakdown,
    clip_toward_zero,
    project_position,
)
from wlct_trading.risk.freshness import (
    FreshnessBudget,
    is_fresh,
    trading_day_bounds_utc,
    trading_day_utc,
)
from wlct_trading.risk.snapshot import (
    RiskAccountState,
    RiskMarketDataState,
    RiskOpenOrderState,
    RiskPositionState,
    RiskStateSnapshot,
    RiskStrategyState,
    SnapshotError,
)

ZERO = Decimal(0)
NOW = 1_700_000_000_000_000


def make_account(
    *,
    tenant_id: str = "tenant-1",
    account_id: str = "acct-1",
    equity: Decimal | None = Decimal("10000"),
    available: Decimal | None = Decimal("9000"),
    reserved: Decimal | None = Decimal("1000"),
    source_timestamp_micros: int | None = NOW,
) -> RiskAccountState:
    return RiskAccountState(
        tenant_id=tenant_id,
        account_id=account_id,
        exchange=ExchangeId.BINANCE,
        equity=equity,
        available=available,
        reserved=reserved,
        source_timestamp_micros=source_timestamp_micros,
    )


def make_market(
    *,
    symbol: str = "BTC-USDT",
    bid: str = "99.5",
    ask: str = "100.5",
    health: OrderBookHealth = OrderBookHealth.OK,
    quote_ts: int | None = NOW - 50_000,
) -> RiskMarketDataState:
    return RiskMarketDataState(
        exchange=ExchangeId.BINANCE,
        symbol=symbol,
        best_bid=Decimal(bid),
        best_ask=Decimal(ask),
        best_bid_quantity=Decimal("5"),
        best_ask_quantity=Decimal("5"),
        last_trade_price=Decimal("100"),
        last_trade_timestamp_micros=NOW - 100_000,
        quote_timestamp_micros=quote_ts,
        book_health=health,
        book_sequence=1000,
        feed_connected=True,
        simulated=True,
    )


def make_position(
    quantity: str,
    *,
    mark: str | None = "100",
    symbol: str = "BTC-USDT",
    strategy: str | None = "strat-1",
    source_timestamp_micros: int | None = NOW,
) -> RiskPositionState:
    return RiskPositionState(
        exchange=ExchangeId.BINANCE,
        symbol=symbol,
        quantity=Decimal(quantity),
        average_entry_price=Decimal("100"),
        mark_price=None if mark is None else Decimal(mark),
        source_timestamp_micros=source_timestamp_micros,
        strategy_id=strategy,
    )


def make_order(
    client_id: str,
    *,
    side: OrderSide = OrderSide.BUY,
    quantity: str = "1",
    filled: str = "0",
    reduce_only: bool = False,
    status: OrderStatus = OrderStatus.SUBMITTED,
    strategy: str | None = "strat-1",
    symbol: str = "BTC-USDT",
) -> RiskOpenOrderState:
    return RiskOpenOrderState(
        client_order_id=client_id,
        exchange=ExchangeId.BINANCE,
        symbol=symbol,
        side=side,
        order_type=OrderType.LIMIT,
        status=status,
        quantity=Decimal(quantity),
        filled_quantity=Decimal(filled),
        is_reduce_only=reduce_only,
        time_in_force=TimeInForce.GTC,
        strategy_id=strategy,
        limit_price=Decimal("99"),
        source_timestamp_micros=NOW,
    )


def make_strategy_state(
    strategy_id: str = "strat-1",
    *,
    realised: Decimal | None = ZERO,
) -> RiskStrategyState:
    return RiskStrategyState(
        strategy_id=strategy_id,
        realised_pnl_today=realised,
        unrealised_pnl=ZERO,
        open_order_count=0,
        consecutive_losses=0,
        is_enabled=True,
        source_timestamp_micros=NOW,
    )


def make_state(
    *,
    version: int = 7,
    account: RiskAccountState | None = None,
    positions: tuple[RiskPositionState, ...] = (),
    open_orders: tuple[RiskOpenOrderState, ...] = (),
    market: tuple[RiskMarketDataState, ...] | None = None,
    strategies: tuple[RiskStrategyState, ...] | None = None,
    config_digest: str | None = None,
    created_at_micros: int = NOW,
    tenant_id: str = "tenant-1",
    account_id: str = "acct-1",
    peak_equity: Decimal | None = Decimal("10000"),
    realised: Decimal | None = ZERO,
) -> RiskStateSnapshot:
    return RiskStateSnapshot(
        snapshot_id="snap-1",
        version=version,
        tenant_id=tenant_id,
        account_id=account_id,
        created_at_micros=created_at_micros,
        trading_day=trading_day_utc(created_at_micros),
        config_digest=config_digest,
        config_version=None,
        account=account if account is not None else make_account(),
        positions=positions,
        open_orders=open_orders,
        market=(
            (make_market(),)
            if market is None
            else market
        ),
        strategies=(
            (make_strategy_state(),) if strategies is None else strategies
        ),
        realised_pnl_today=realised,
        unrealised_pnl_today=ZERO,
        fees_today=ZERO,
        traded_notional_today=ZERO,
        consecutive_losses=0,
        peak_equity=peak_equity,
        market_type=MarketType.SPOT,
        rate=None,
        missing_sources=frozenset(),
        advisories=frozenset(),
        produced_by="test",
        is_simulated=True,
    )


def make_intent(
    *,
    side: OrderSide = OrderSide.BUY,
    quantity: str = "1",
    price: str | None = "100",
    reduce_only: bool = False,
    symbol: str = "BTC-USDT",
    client_order_id: str | None = None,
) -> OrderIntent:
    return OrderIntent(
        tenant_id="tenant-1",
        account_id="acct-1",
        strategy_id="strat-1",
        exchange=ExchangeId.BINANCE,
        symbol=symbol,
        side=side,
        order_type=OrderType.LIMIT if price is not None else OrderType.MARKET,
        quantity=Decimal(quantity),
        price=None if price is None else Decimal(price),
        reduce_only=reduce_only,
        client_order_id=client_order_id,
    )


class TestSnapshotIntegrity:
    def test_roundtrip_payload(self) -> None:
        state = make_state(positions=(make_position("2"),))
        payload = state.to_payload()
        rebuilt = RiskStateSnapshot.from_payload(payload)
        assert rebuilt.digest() == state.digest()
        assert rebuilt.version == 7

    def test_float_money_in_payload_is_refused(self) -> None:
        payload = make_state().to_payload()
        payload["account"]["equity"] = 10000.5
        with pytest.raises(SnapshotError, match="float"):
            RiskStateSnapshot.from_payload(payload)

    def test_unknown_extra_keys_are_refused(self) -> None:
        payload = make_state().to_payload()
        payload["surprise"] = 1
        with pytest.raises(SnapshotError, match="exactly"):
            RiskStateSnapshot.from_payload(payload)

    def test_wrong_identity_pairing_is_refused(self) -> None:
        state = make_state(account=make_account(tenant_id="someone-else"))
        assert any("identity" in e for e in state.is_consistent())

    def test_duplicate_open_order_ids_are_refused(self) -> None:
        state = make_state(open_orders=(make_order("dup"), make_order("dup")))
        # the snapshot consistency check and the projection integrity check
        # both catch it, in their own words; either refusal is sufficient.
        assert any("duplicate open order" in e for e in state.is_consistent())
        assert any(
            "duplicate client_order_id" in e
            for e in state.projecting_context().integrity_errors()
        )

    def test_version_zero_is_refused(self) -> None:
        state = make_state(version=0)
        assert any("version" in e for e in state.is_consistent())

    def test_negative_balance_is_reported_as_account_inconsistency(self) -> None:
        bad = make_account(equity=Decimal("-1"))
        assert any("negative" in e for e in bad.consistency_errors())

    def test_available_above_equity_plus_reserved_is_contradiction(self) -> None:
        bad = make_account(equity=Decimal("100"), available=Decimal("500"), reserved=ZERO)
        assert any("disagrees with itself" in e for e in bad.consistency_errors())

    def test_digest_changes_when_any_part_changes(self) -> None:
        a = make_state()
        b = make_state(account=make_account(equity=Decimal("10001")))
        assert a.digest() != b.digest()

    def test_missing_account_still_serialises_as_null(self) -> None:
        state = replace(make_state(), account=None)
        payload = state.to_payload()
        assert payload["account"] is None
        rebuilt = RiskStateSnapshot.from_payload(payload)
        assert rebuilt.account is None
        # but the gate treats it as fail-closed - asserted in the gate tests.


class TestCoreBridge:
    def test_bridge_produces_complete_core_view_from_full_state(self) -> None:
        state = make_state(
            positions=(make_position("2", mark="100"),),
            open_orders=(make_order("o-1"),),
        )
        core, shortfalls = state.to_core_snapshot(make_intent(), now_micros=NOW)
        assert shortfalls == ()
        assert core.position_quantity == Decimal("2")
        assert core.book_usable is True
        assert core.is_complete is True
        assert core.open_order_count == 1
        assert core.symbol_exposure_notional == Decimal("200")
        assert "o-1" in core.known_client_order_ids

    def test_bridge_reports_missing_market_as_shortfall(self) -> None:
        state = make_state()  # market only has BTC-USDT
        _core, shortfalls = state.to_core_snapshot(
            make_intent(symbol="SOL-USDT", price="20"), now_micros=NOW
        )
        assert any("no market data" in s for s in shortfalls)

    def test_bridge_refuses_unvalued_position(self) -> None:
        state = make_state(
            positions=(make_position("2", mark=None),),
            market=(
                replace(make_market(), best_bid=None, best_ask=None, last_trade_price=None),
            ),
        )
        _core, shortfalls = state.to_core_snapshot(
            make_intent(price=None), now_micros=NOW
        )
        assert any("cannot value" in s for s in shortfalls)
        assert state.projecting_context().integrity_errors() != ()

    def test_strategy_entry_required_when_order_carries_strategy(self) -> None:
        state = make_state(strategies=())
        _core, shortfalls = state.to_core_snapshot(make_intent(), now_micros=NOW)
        assert any("no realised PnL reported for strategy" in s for s in shortfalls)


class TestFreshness:
    def test_missing_timestamp_is_stale_not_fresh(self) -> None:
        fresh, age, reason = is_fresh(None, now_micros=NOW, budget_micros=1_000_000)
        assert fresh is False
        assert age is None
        assert "unknown" in reason

    def test_beyond_budget_is_stale_with_reported_age(self) -> None:
        fresh, age, reason = is_fresh(
            NOW - 2_000_000, now_micros=NOW, budget_micros=1_000_000
        )
        assert fresh is False and age == 2_000_000 and "exceeds" in reason

    def test_future_timestamp_within_skew_passes_as_zero_age(self) -> None:
        fresh, age, _ = is_fresh(NOW + 100_000, now_micros=NOW, budget_micros=1_000_000)
        assert fresh is True and age == 0

    def test_future_timestamp_beyond_skew_is_stale(self) -> None:
        fresh, _, reason = is_fresh(NOW + 60_000_000, now_micros=NOW, budget_micros=1_000_000)
        assert fresh is False and "future" in reason

    def test_per_source_budget_cannot_be_looser_than_the_snapshot(self) -> None:
        with pytest.raises(ValueError, match="no larger"):
            FreshnessBudget(
                max_snapshot_age_micros=1_000_000, account_age_micros=60_000_000
            )

    def test_unknown_source_budget_raises(self) -> None:
        budget = FreshnessBudget(max_snapshot_age_micros=1_000_000)
        with pytest.raises(KeyError):
            budget.budget_for("vibes")


class TestTradingDay:
    def test_utc_rollover_is_exact(self) -> None:
        boundary = int(
            datetime(2023, 11, 15, 0, 0, 0, tzinfo=timezone.utc).timestamp()
        ) * 1_000_000
        assert trading_day_utc(boundary - 1) == "2023-11-14"
        assert trading_day_utc(boundary) == "2023-11-15"

    def test_day_bounds_match_the_label(self) -> None:
        start, end = trading_day_bounds_utc("2023-11-14")
        assert trading_day_utc(start) == "2023-11-14"
        assert trading_day_utc(end) == "2023-11-14"
        assert trading_day_utc(end + 1) == "2023-11-15"


class TestProjection:
    def test_reduce_only_clips_at_flat_not_through(self) -> None:
        assert clip_toward_zero(Decimal("5"), Decimal("-7")) == Decimal("-5")
        assert (
            project_position(
                Decimal("5"),
                (
                    OpenOrderView(
                        client_order_id="r1",
                        exchange="binance",
                        symbol="BTC-USDT",
                        side=OrderSide.SELL,
                        order_type=OrderType.LIMIT,
                        status=OrderStatus.SUBMITTED,
                        quantity=Decimal("7"),
                        filled_quantity=ZERO,
                        is_reduce_only=True,
                    ),
                ),
            )
            == ZERO
        )

    def test_reduce_only_from_flat_contributes_nothing(self) -> None:
        assert clip_toward_zero(ZERO, Decimal("-7")) == ZERO

    def test_non_reduce_orders_may_flip(self) -> None:
        assert (
            project_position(
                Decimal("5"),
                (
                    OpenOrderView(
                        client_order_id="x1",
                        exchange="binance",
                        symbol="BTC-USDT",
                        side=OrderSide.SELL,
                        order_type=OrderType.LIMIT,
                        status=OrderStatus.SUBMITTED,
                        quantity=Decimal("7"),
                        filled_quantity=ZERO,
                        is_reduce_only=False,
                    ),
                ),
            )
            == Decimal("-2")
        )

    def test_deterministic_application_order(self) -> None:
        first = OpenOrderView(
            client_order_id="a",
            exchange="binance",
            symbol="BTC-USDT",
            side=OrderSide.SELL,
            order_type=OrderType.LIMIT,
            status=OrderStatus.SUBMITTED,
            quantity=Decimal("6"),
            filled_quantity=ZERO,
            is_reduce_only=True,
        )
        second = OpenOrderView(
            client_order_id="b",
            exchange="binance",
            symbol="BTC-USDT",
            side=OrderSide.BUY,
            order_type=OrderType.LIMIT,
            status=OrderStatus.SUBMITTED,
            quantity=Decimal("2"),
            filled_quantity=ZERO,
            is_reduce_only=True,
        )
        by_id = project_position(Decimal("5"), (first, second))
        reversed_input = project_position(Decimal("5"), (second, first))
        # project_position sorts internally, so input order cannot change the
        # answer - and the answer reflects reduce-only semantics: 'a' (the
        # sell) clips at flat, leaving nothing for 'b' to be measured against
        # as a reduction, so 'b' contributes 0 too.
        assert by_id == reversed_input == Decimal("5") - Decimal("5")

    @pytest.mark.parametrize(
        "qty",
        ["1", "0.001", "123.456", "1E-9"],
    )
    def test_buy_sell_symmetry_on_flat(self, qty: str) -> None:
        reference = Decimal("100")
        results: list[Decimal] = []
        for side in (OrderSide.BUY, OrderSide.SELL):
            order = OpenOrderView(
                client_order_id=f"sym-{side.value}",
                exchange="binance",
                symbol="BTC-USDT",
                side=side,
                order_type=OrderType.LIMIT,
                status=OrderStatus.SUBMITTED,
                quantity=Decimal(qty),
                filled_quantity=ZERO,
                is_reduce_only=False,
            )
            projected = project_position(ZERO, (order,))
            results.append(projected)
            assert abs(projected) == abs(Decimal(qty))
            assert abs(projected) * reference == abs(Decimal(qty)) * reference
        assert results[0] == -results[1]

    def test_decimal_exactness_aggregation_corpus(self) -> None:
        parts = [Decimal("0.1")] * 3 + [Decimal("0.2")] * 2
        total = sum(parts, ZERO)
        assert total == Decimal("0.7")
        orders = tuple(
            OpenOrderView(
                client_order_id=f"p{i}",
                exchange="binance",
                symbol="BTC-USDT",
                side=OrderSide.BUY,
                order_type=OrderType.LIMIT,
                status=OrderStatus.SUBMITTED,
                quantity=part,
                filled_quantity=ZERO,
                is_reduce_only=False,
            )
            for i, part in enumerate(parts)
        )
        projected = project_position(ZERO, orders)
        assert projected * Decimal("30000") == Decimal("21000.0")


class TestBreakdownAndIntegrity:
    @staticmethod
    def _context(
        *,
        positions: tuple[PositionView, ...] = (),
        orders: tuple[OpenOrderView, ...] = (),
        references: tuple[ReferenceView, ...] | None = None,
    ) -> ProjectingContext:
        if references is None:
            references = (
                ReferenceView(
                    exchange="binance", symbol="BTC-USDT", price=Decimal("100")
                ),
                ReferenceView(
                    exchange="binance", symbol="ETH-USDT", price=Decimal("50")
                ),
            )
        return ProjectingContext(
            positions=positions, open_orders=orders, references=references
        )

    def test_gross_and_net_both_tracked(self) -> None:
        context = self._context(
            positions=(
                PositionView(
                    exchange="binance", symbol="BTC-USDT", quantity=Decimal("2")
                ),
                PositionView(
                    exchange="binance", symbol="ETH-USDT", quantity=Decimal("-4")
                ),
            )
        )
        breakdown = build_breakdown(context)
        btc = breakdown.bucket(ExposureDimension.SYMBOL, "BTC-USDT")
        eth = breakdown.bucket(ExposureDimension.SYMBOL, "ETH-USDT")
        assert btc is not None and btc.gross_notional == Decimal("200")
        assert eth is not None and eth.gross_notional == Decimal("200")
        assert eth.net_signed_notional == Decimal("-200")
        assert breakdown.account_gross_notional == Decimal("400")

    def test_reduce_only_reservations_do_not_add_gross_exposure(self) -> None:
        order = OpenOrderView(
            client_order_id="ro",
            exchange="binance",
            symbol="BTC-USDT",
            side=OrderSide.BUY,
            order_type=OrderType.LIMIT,
            status=OrderStatus.SUBMITTED,
            quantity=Decimal("3"),
            filled_quantity=ZERO,
            is_reduce_only=True,
        )
        breakdown = build_breakdown(self._context(orders=(order,)))
        btc = breakdown.bucket(ExposureDimension.SYMBOL, "BTC-USDT")
        assert btc is None

    def test_open_reservations_add_to_buckets(self) -> None:
        order = OpenOrderView(
            client_order_id="o",
            exchange="binance",
            symbol="BTC-USDT",
            side=OrderSide.BUY,
            order_type=OrderType.LIMIT,
            status=OrderStatus.SUBMITTED,
            quantity=Decimal("3"),
            filled_quantity=Decimal("1"),
            is_reduce_only=False,
            strategy_id="strat-9",
        )
        breakdown = build_breakdown(self._context(orders=(order,)))
        btc = breakdown.bucket(ExposureDimension.SYMBOL, "BTC-USDT")
        strat = breakdown.bucket(ExposureDimension.STRATEGY, "strat-9")
        assert btc is not None and btc.gross_notional == Decimal("200")
        assert strat is not None and strat.gross_notional == Decimal("200")

    def test_terminal_status_order_is_an_integrity_error(self) -> None:
        order = OpenOrderView(
            client_order_id="ghost",
            exchange="binance",
            symbol="BTC-USDT",
            side=OrderSide.BUY,
            order_type=OrderType.LIMIT,
            status=OrderStatus.FILLED,
            quantity=Decimal("3"),
            filled_quantity=Decimal("3"),
            is_reduce_only=False,
        )
        errors = self._context(orders=(order,)).integrity_errors()
        assert any("terminal status" in e for e in errors)

    def test_overfilled_order_is_an_integrity_error(self) -> None:
        order = OpenOrderView(
            client_order_id="weird",
            exchange="binance",
            symbol="BTC-USDT",
            side=OrderSide.BUY,
            order_type=OrderType.LIMIT,
            status=OrderStatus.PARTIALLY_FILLED,
            quantity=Decimal("3"),
            filled_quantity=Decimal("4"),
            is_reduce_only=False,
        )
        errors = self._context(orders=(order,)).integrity_errors()
        assert any("more filled" in e for e in errors)

    def test_missing_reference_for_exposure_is_an_integrity_error(self) -> None:
        context = ProjectingContext(
            positions=(
                PositionView(
                    exchange="binance", symbol="DOGE-USDT", quantity=Decimal("5")
                ),
            ),
            open_orders=(),
            references=(
                ReferenceView(
                    exchange="binance", symbol="BTC-USDT", price=Decimal("100")
                ),
            ),
        )
        errors = context.integrity_errors()
        assert any("no reference price" in e for e in errors)

    def test_flat_position_without_reference_is_not_an_error(self) -> None:
        context = ProjectingContext(
            positions=(
                PositionView(exchange="binance", symbol="DOGE-USDT", quantity=ZERO),
            ),
            open_orders=(),
            references=(),
        )
        assert context.integrity_errors() == ()


class TestOpenOrderStateMapping:
    def test_terminal_status_in_snapshot_is_flagged_by_projection(self) -> None:
        state = make_state(open_orders=(make_order("done", status=OrderStatus.CANCELLED),))
        errors = state.projecting_context().integrity_errors()
        assert any("terminal status" in e for e in errors)

    def test_snapshot_is_immutable(self) -> None:
        state = make_state()
        newer = replace(state, version=state.version + 1)
        assert newer.version == 8
        with pytest.raises(Exception):
            object.__setattr__  # no-op reference; the assignment below must raise
            state.version = 9
