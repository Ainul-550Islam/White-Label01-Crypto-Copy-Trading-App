"""Order-book engine: snapshots, deltas, sequencing, tops and spreads."""

from __future__ import annotations

from decimal import Decimal

from wlct_trading.enums import OrderBookHealth, OrderSide
from wlct_trading.market_data import OrderBookSnapshot
from wlct_trading.order_book import OrderBook

from tests.conftest import BASE_TS, EXCHANGE, SYMBOL, level, make_delta


# ---------------------------------------------------------------------------
# Snapshot initialisation
# ---------------------------------------------------------------------------
class TestOrderBookSnapshot:
    def test_snapshot_initialises_book(self, book: OrderBook, snapshot) -> None:
        assert book.health is OrderBookHealth.UNINITIALISED
        assert not book.is_usable

        result = book.apply_snapshot(snapshot)

        assert result.applied is True
        assert result.health is OrderBookHealth.OK
        assert book.is_usable
        assert book.sequence == 1000
        assert book.statistics["bid_levels"] == 5
        assert book.statistics["ask_levels"] == 5

    def test_snapshot_sets_correct_tops(self, book: OrderBook, snapshot) -> None:
        book.apply_snapshot(snapshot)

        assert book.best_bid == Decimal("29995.00")
        assert book.best_ask == Decimal("30005.00")
        assert book.best_bid_level().quantity == Decimal("1.0")
        assert book.best_ask_level().quantity == Decimal("1.5")

    def test_snapshot_replaces_prior_state_entirely(
        self, book: OrderBook, snapshot
    ) -> None:
        book.apply_snapshot(snapshot)

        replacement = OrderBookSnapshot(
            exchange=EXCHANGE,
            symbol=SYMBOL,
            bids=(level("100.00", "1.0"),),
            asks=(level("101.00", "1.0"),),
            last_update_id=2000,
            exchange_timestamp=BASE_TS + 10,
            received_timestamp=BASE_TS + 20,
        )
        book.apply_snapshot(replacement)

        # No level from the first image may survive.
        assert book.best_bid == Decimal("100.00")
        assert book.best_ask == Decimal("101.00")
        assert book.statistics["bid_levels"] == 1
        assert book.quantity_at(OrderSide.BUY, Decimal("29995.00")) == Decimal(0)

    def test_snapshot_drops_zero_quantity_levels(self, book: OrderBook) -> None:
        book.apply_snapshot(
            OrderBookSnapshot(
                exchange=EXCHANGE,
                symbol=SYMBOL,
                bids=(level("100.00", "1.0"), level("99.00", "0")),
                asks=(level("101.00", "1.0"),),
                last_update_id=1,
                exchange_timestamp=BASE_TS,
                received_timestamp=BASE_TS,
            )
        )
        assert book.statistics["bid_levels"] == 1

    def test_snapshot_for_wrong_symbol_is_refused(self, book: OrderBook) -> None:
        wrong = OrderBookSnapshot(
            exchange=EXCHANGE,
            symbol="ETH-USDT",
            bids=(level("100.00", "1.0"),),
            asks=(level("101.00", "1.0"),),
            last_update_id=1,
            exchange_timestamp=BASE_TS,
            received_timestamp=BASE_TS,
        )
        result = book.apply_snapshot(wrong)

        assert result.applied is False
        assert book.health is OrderBookHealth.UNINITIALISED


# ---------------------------------------------------------------------------
# Incremental updates
# ---------------------------------------------------------------------------
class TestOrderBookUpdate:
    def test_delta_updates_existing_level(self, book: OrderBook, snapshot) -> None:
        book.apply_snapshot(snapshot)

        result = book.apply_delta(
            make_delta(bids=(level("29990.00", "9.0"),), first=1001, final=1001)
        )

        assert result.applied is True
        assert book.quantity_at(OrderSide.BUY, Decimal("29990.00")) == Decimal("9.0")
        assert book.sequence == 1001

    def test_delta_inserts_new_best_level(self, book: OrderBook, snapshot) -> None:
        book.apply_snapshot(snapshot)

        book.apply_delta(
            make_delta(bids=(level("29999.00", "0.5"),), first=1001, final=1001)
        )

        assert book.best_bid == Decimal("29999.00")
        assert book.best_bid_level().quantity == Decimal("0.5")

    def test_zero_quantity_deletes_level(self, book: OrderBook, snapshot) -> None:
        book.apply_snapshot(snapshot)

        book.apply_delta(
            make_delta(bids=(level("29990.00", "0"),), first=1001, final=1001)
        )

        assert book.quantity_at(OrderSide.BUY, Decimal("29990.00")) == Decimal(0)
        assert book.statistics["bid_levels"] == 4

    def test_deleting_best_bid_promotes_next_level(
        self, book: OrderBook, snapshot
    ) -> None:
        book.apply_snapshot(snapshot)
        assert book.best_bid == Decimal("29995.00")

        book.apply_delta(
            make_delta(bids=(level("29995.00", "0"),), first=1001, final=1001)
        )

        # The cached top must be recomputed, not left stale.
        assert book.best_bid == Decimal("29990.00")

    def test_deleting_best_ask_promotes_next_level(
        self, book: OrderBook, snapshot
    ) -> None:
        book.apply_snapshot(snapshot)

        book.apply_delta(
            make_delta(asks=(level("30005.00", "0"),), first=1001, final=1001)
        )

        assert book.best_ask == Decimal("30010.00")

    def test_emptying_one_side_yields_none(self, book: OrderBook, snapshot) -> None:
        book.apply_snapshot(snapshot)

        book.apply_delta(
            make_delta(
                bids=(
                    level("29995.00", "0"),
                    level("29990.00", "0"),
                    level("29985.00", "0"),
                    level("29980.00", "0"),
                    level("29975.00", "0"),
                ),
                first=1001,
                final=1001,
            )
        )

        assert book.best_bid is None
        assert book.mid_price is None
        assert book.spread is None

    def test_delta_before_snapshot_is_refused(self, book: OrderBook) -> None:
        result = book.apply_delta(
            make_delta(bids=(level("100.00", "1.0"),), first=1, final=1)
        )

        assert result.applied is False
        assert result.resync_required is True
        assert book.health is OrderBookHealth.UNINITIALISED


# ---------------------------------------------------------------------------
# Sequence validation - the anti-corruption guarantee
# ---------------------------------------------------------------------------
class TestSequenceValidation:
    def test_contiguous_range_delta_is_accepted(
        self, book: OrderBook, snapshot
    ) -> None:
        book.apply_snapshot(snapshot)

        result = book.apply_delta(
            make_delta(bids=(level("29990.00", "9"),), first=1001, final=1005)
        )

        assert result.applied is True
        assert book.sequence == 1005

    def test_range_spanning_current_sequence_is_accepted(
        self, book: OrderBook, snapshot
    ) -> None:
        """A range starting at or below the next needed id still covers it."""
        book.apply_snapshot(snapshot)

        result = book.apply_delta(
            make_delta(bids=(level("29990.00", "9"),), first=998, final=1003)
        )

        assert result.applied is True
        assert book.sequence == 1003

    def test_gap_in_range_triggers_resync_and_clears_book(
        self, book: OrderBook, snapshot
    ) -> None:
        book.apply_snapshot(snapshot)

        result = book.apply_delta(
            make_delta(bids=(level("29990.00", "9"),), first=1005, final=1010)
        )

        assert result.applied is False
        assert result.resync_required is True
        assert book.health is OrderBookHealth.RESYNC_REQUIRED
        # Corrupt state must be discarded, not served.
        assert book.best_bid is None
        assert book.best_ask is None
        assert book.is_usable is False
        assert book.statistics["gaps"] == 1

    def test_gap_with_explicit_predecessor_triggers_resync(
        self, book: OrderBook, snapshot
    ) -> None:
        book.apply_snapshot(snapshot)

        result = book.apply_delta(
            make_delta(
                bids=(level("29990.00", "9"),),
                first=1005,
                final=1006,
                previous=1004,
            )
        )

        assert result.applied is False
        assert result.resync_required is True
        assert book.health is OrderBookHealth.RESYNC_REQUIRED

    def test_matching_predecessor_is_accepted(
        self, book: OrderBook, snapshot
    ) -> None:
        book.apply_snapshot(snapshot)

        result = book.apply_delta(
            make_delta(
                bids=(level("29990.00", "9"),),
                first=1001,
                final=1002,
                previous=1000,
            )
        )

        assert result.applied is True
        assert book.sequence == 1002

    def test_replayed_delta_is_ignored_without_error(
        self, book: OrderBook, snapshot
    ) -> None:
        book.apply_snapshot(snapshot)
        book.apply_delta(
            make_delta(bids=(level("29990.00", "9"),), first=1001, final=1001)
        )

        # A reconnect replays an update we have already applied.
        result = book.apply_delta(
            make_delta(bids=(level("29990.00", "1"),), first=999, final=1000)
        )

        assert result.applied is False
        assert result.ignored_duplicate is True
        assert result.resync_required is False
        assert book.health is OrderBookHealth.OK
        # The replay must not have overwritten the newer value.
        assert book.quantity_at(OrderSide.BUY, Decimal("29990.00")) == Decimal("9")

    def test_deltas_are_refused_until_resync_completes(
        self, book: OrderBook, snapshot
    ) -> None:
        book.apply_snapshot(snapshot)
        book.apply_delta(make_delta(bids=(level("1.0", "1"),), first=9999, final=9999))
        assert book.health is OrderBookHealth.RESYNC_REQUIRED

        # Even a perfectly contiguous delta must be refused while awaiting a
        # snapshot, because the book's contents are known to be incomplete.
        result = book.apply_delta(
            make_delta(bids=(level("29990.00", "9"),), first=10000, final=10000)
        )

        assert result.applied is False
        assert result.resync_required is True

    def test_fresh_snapshot_recovers_from_resync(
        self, book: OrderBook, snapshot
    ) -> None:
        book.apply_snapshot(snapshot)
        book.apply_delta(make_delta(bids=(level("1.0", "1"),), first=9999, final=9999))
        assert book.health is OrderBookHealth.RESYNC_REQUIRED

        recovery = OrderBookSnapshot(
            exchange=EXCHANGE,
            symbol=SYMBOL,
            bids=(level("29996.00", "2.0"),),
            asks=(level("30004.00", "2.0"),),
            last_update_id=10050,
            exchange_timestamp=BASE_TS + 100,
            received_timestamp=BASE_TS + 200,
        )
        result = book.apply_snapshot(recovery)

        assert result.applied is True
        assert book.health is OrderBookHealth.OK
        assert book.is_usable
        assert book.sequence == 10050

    def test_crossed_book_is_marked_unusable(self, book: OrderBook, snapshot) -> None:
        book.apply_snapshot(snapshot)

        # A bid above the best ask cannot exist on a real venue.
        book.apply_delta(
            make_delta(bids=(level("30006.00", "1.0"),), first=1001, final=1001)
        )

        assert book.health is OrderBookHealth.CROSSED
        assert book.is_usable is False


# ---------------------------------------------------------------------------
# Derived values
# ---------------------------------------------------------------------------
class TestBestBidAsk:
    def test_best_prices_track_the_extremes(self, book: OrderBook, snapshot) -> None:
        book.apply_snapshot(snapshot)

        assert book.best_bid == max(
            Decimal(p) for p in ("29995.00", "29990.00", "29985.00", "29980.00", "29975.00")
        )
        assert book.best_ask == min(
            Decimal(p) for p in ("30005.00", "30010.00", "30015.00", "30020.00", "30025.00")
        )

    def test_top_snapshot_is_consistent_with_book(
        self, book: OrderBook, snapshot
    ) -> None:
        book.apply_snapshot(snapshot)
        top = book.top()

        assert top.best_bid == book.best_bid
        assert top.best_ask == book.best_ask
        assert top.best_bid_quantity == Decimal("1.0")
        assert top.best_ask_quantity == Decimal("1.5")
        assert top.sequence == 1000
        assert top.is_crossed is False

    def test_empty_book_has_no_tops(self, book: OrderBook) -> None:
        assert book.best_bid is None
        assert book.best_ask is None
        assert book.mid_price is None


class TestSpreadCalculation:
    def test_spread_is_ask_minus_bid(self, book: OrderBook, snapshot) -> None:
        book.apply_snapshot(snapshot)

        assert book.spread == Decimal("10.00")

    def test_mid_is_the_arithmetic_mean(self, book: OrderBook, snapshot) -> None:
        book.apply_snapshot(snapshot)

        assert book.mid_price == Decimal("30000.00")

    def test_spread_percent_is_relative_to_mid(
        self, book: OrderBook, snapshot
    ) -> None:
        book.apply_snapshot(snapshot)

        # 10 / 30000 * 100 = 0.0333...%
        expected = (Decimal("10.00") / Decimal("30000.00")) * Decimal(100)
        assert book.spread_percent == expected
        assert book.spread_percent.quantize(Decimal("0.0001")) == Decimal("0.0333")

    def test_spread_widens_when_touch_is_removed(
        self, book: OrderBook, snapshot
    ) -> None:
        book.apply_snapshot(snapshot)

        book.apply_delta(
            make_delta(asks=(level("30005.00", "0"),), first=1001, final=1001)
        )

        assert book.spread == Decimal("15.00")
        assert book.mid_price == Decimal("30002.50")

    def test_derived_values_are_none_on_one_sided_book(self, book: OrderBook) -> None:
        book.apply_snapshot(
            OrderBookSnapshot(
                exchange=EXCHANGE,
                symbol=SYMBOL,
                bids=(level("100.00", "1.0"),),
                asks=(),
                last_update_id=1,
                exchange_timestamp=BASE_TS,
                received_timestamp=BASE_TS,
            )
        )

        assert book.best_ask is None
        assert book.spread is None
        assert book.spread_percent is None


class TestDepthLookup:
    def test_depth_returns_levels_best_first(self, book: OrderBook, snapshot) -> None:
        book.apply_snapshot(snapshot)
        depth = book.depth(3)

        assert [lvl.price for lvl in depth.bids] == [
            Decimal("29995.00"),
            Decimal("29990.00"),
            Decimal("29985.00"),
        ]
        assert [lvl.price for lvl in depth.asks] == [
            Decimal("30005.00"),
            Decimal("30010.00"),
            Decimal("30015.00"),
        ]

    def test_depth_caps_at_available_levels(self, book: OrderBook, snapshot) -> None:
        book.apply_snapshot(snapshot)

        assert len(book.depth(50).bids) == 5

    def test_zero_depth_returns_empty(self, book: OrderBook, snapshot) -> None:
        book.apply_snapshot(snapshot)

        assert book.depth(0).bids == ()

    def test_notional_within_walks_the_correct_side(
        self, book: OrderBook, snapshot
    ) -> None:
        book.apply_snapshot(snapshot)

        # A buy lifting up to 30010 takes the 30005 and 30010 levels.
        expected = Decimal("30005.00") * Decimal("1.5") + Decimal("30010.00") * Decimal("2.5")
        assert book.notional_within(OrderSide.BUY, Decimal("30010.00")) == expected


class TestStaleness:
    def test_book_is_stale_past_the_age_limit(self, book: OrderBook, snapshot) -> None:
        book.apply_snapshot(snapshot)
        received = snapshot.received_timestamp

        assert book.is_stale(1_000, now_micros=received + 5_000) is True
        assert book.is_stale(10_000, now_micros=received + 5_000) is False

    def test_uninitialised_book_is_always_stale(self, book: OrderBook) -> None:
        assert book.is_stale(10**9, now_micros=BASE_TS) is True

    def test_mark_stale_makes_book_unusable(self, book: OrderBook, snapshot) -> None:
        book.apply_snapshot(snapshot)
        book.mark_stale()

        assert book.health is OrderBookHealth.STALE
        assert book.is_usable is False
