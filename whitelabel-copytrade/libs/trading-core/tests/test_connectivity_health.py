"""Subscriptions, staleness detection and connectivity metrics.

Together these answer the operational question "is this feed actually working?"
— which is distinct from "is the socket open?". Most of the assertions here
exist to stop the platform reporting health it does not have.
"""

from __future__ import annotations

import pytest

from wlct_trading.metrics import ConnectivityMetrics, LatencyHistogram
from wlct_trading.transport.staleness import StalenessMonitor, StalenessThresholds
from wlct_trading.transport.subscriptions import (
    DuplicateSubscription,
    MarketDataChannel,
    SubscriptionLimitExceeded,
    SubscriptionManager,
    SubscriptionStatus,
)

BASE_TS = 1_700_000_000_000_000
MILLIS = 1_000


# ----------------------------------------------------------------------
# Subscriptions
# ----------------------------------------------------------------------
def test_duplicate_subscription_is_refused() -> None:
    """Subscribing twice doubles the inbound rate and confuses accounting."""
    manager = SubscriptionManager(exchange="binance")
    manager.add(MarketDataChannel.TRADES, "BTC-USDT", "btcusdt@trade")
    with pytest.raises(DuplicateSubscription):
        manager.add(MarketDataChannel.TRADES, "BTC-USDT", "btcusdt@trade")


def test_same_symbol_on_different_channels_is_allowed() -> None:
    manager = SubscriptionManager(exchange="binance")
    manager.add(MarketDataChannel.TRADES, "BTC-USDT", "btcusdt@trade")
    manager.add(MarketDataChannel.ORDER_BOOK, "BTC-USDT", "btcusdt@depth@100ms")
    assert manager.count == 2


def test_add_if_absent_is_idempotent_and_reports_creation() -> None:
    """Returns ``(subscription, created)`` so the caller knows whether to send
    a subscribe frame — re-sending one for an existing stream wastes the
    venue's inbound-message budget."""
    manager = SubscriptionManager(exchange="binance")
    first, created_first = manager.add_if_absent(
        MarketDataChannel.TRADES, "BTC-USDT", "btcusdt@trade"
    )
    second, created_second = manager.add_if_absent(
        MarketDataChannel.TRADES, "BTC-USDT", "btcusdt@trade"
    )
    assert created_first is True
    assert created_second is False
    assert first is second
    assert manager.count == 1


def test_subscription_cap_is_enforced() -> None:
    """Exceeding the venue's per-connection cap gets the socket dropped."""
    manager = SubscriptionManager(exchange="binance", max_subscriptions=2)
    manager.add(MarketDataChannel.TRADES, "BTC-USDT", "btcusdt@trade")
    manager.add(MarketDataChannel.TRADES, "ETH-USDT", "ethusdt@trade")
    with pytest.raises(SubscriptionLimitExceeded):
        manager.add(MarketDataChannel.TRADES, "SOL-USDT", "solusdt@trade")


def test_cancelled_subscription_frees_its_slot() -> None:
    manager = SubscriptionManager(exchange="binance", max_subscriptions=1)
    first = manager.add(MarketDataChannel.TRADES, "BTC-USDT", "btcusdt@trade")
    first.mark_cancelled()
    manager.add(MarketDataChannel.TRADES, "ETH-USDT", "ethusdt@trade")
    assert manager.count >= 1


def test_mark_all_pending_demotes_active_subscriptions() -> None:
    manager = SubscriptionManager(exchange="binance")
    subscription = manager.add(
        MarketDataChannel.ORDER_BOOK, "BTC-USDT", "btcusdt@depth@100ms"
    )
    subscription.mark_active()
    manager.mark_all_pending()
    assert subscription.status is SubscriptionStatus.PENDING


def test_restorable_excludes_cancelled_subscriptions() -> None:
    manager = SubscriptionManager(exchange="binance")
    keep = manager.add(MarketDataChannel.TRADES, "BTC-USDT", "btcusdt@trade")
    drop = manager.add(MarketDataChannel.TRADES, "ETH-USDT", "ethusdt@trade")
    drop.mark_cancelled()
    restorable = manager.restorable()
    assert keep in restorable
    assert drop not in restorable


def test_failed_subscription_records_its_reason() -> None:
    manager = SubscriptionManager(exchange="binance")
    subscription = manager.add(MarketDataChannel.TRADES, "BTC-USDT", "btcusdt@trade")
    subscription.mark_failed("venue rejected the stream name")
    assert subscription.status is SubscriptionStatus.FAILED
    assert subscription.failure_reason == "venue rejected the stream name"


def test_subscription_log_fields_carry_no_credentials() -> None:
    manager = SubscriptionManager(exchange="binance")
    subscription = manager.add(MarketDataChannel.TRADES, "BTC-USDT", "btcusdt@trade")
    rendered = str(subscription.to_log_fields()).lower()
    for fragment in ("secret", "apikey", "token", "password"):
        assert fragment not in rendered


# ----------------------------------------------------------------------
# Staleness
# ----------------------------------------------------------------------
def test_a_stream_that_never_started_is_not_reported_stale() -> None:
    """"Not started" and "stopped" are different.

    Conflating them fires an alert on every startup, and an alert that always
    fires is an alert nobody reads.
    """
    monitor = StalenessMonitor()
    monitor.track(MarketDataChannel.ORDER_BOOK, "BTC-USDT")
    verdict = monitor.evaluate(now_micros=BASE_TS + 60_000 * MILLIS)
    assert verdict.newly_stale == ()
    assert verdict.any_stale is False


def test_silence_beyond_the_threshold_is_reported_once() -> None:
    monitor = StalenessMonitor(StalenessThresholds(order_book_millis=1_000))
    monitor.record_message(
        MarketDataChannel.ORDER_BOOK, "BTC-USDT", at_micros=BASE_TS
    )

    first = monitor.evaluate(now_micros=BASE_TS + 2_000 * MILLIS)
    assert len(first.newly_stale) == 1

    second = monitor.evaluate(now_micros=BASE_TS + 3_000 * MILLIS)
    assert second.newly_stale == ()
    assert len(second.still_stale) == 1


def test_recovery_is_reported_when_data_resumes() -> None:
    monitor = StalenessMonitor(StalenessThresholds(order_book_millis=1_000))
    monitor.record_message(
        MarketDataChannel.ORDER_BOOK, "BTC-USDT", at_micros=BASE_TS
    )
    monitor.evaluate(now_micros=BASE_TS + 2_000 * MILLIS)

    monitor.record_message(
        MarketDataChannel.ORDER_BOOK, "BTC-USDT", at_micros=BASE_TS + 2_500 * MILLIS
    )
    verdict = monitor.evaluate(now_micros=BASE_TS + 2_600 * MILLIS)
    assert len(verdict.recovered) == 1
    assert verdict.any_stale is False


def test_thresholds_differ_by_channel() -> None:
    """Trades are legitimately sporadic; a book going quiet is alarming."""
    thresholds = StalenessThresholds()
    assert thresholds.for_channel(MarketDataChannel.ORDER_BOOK) < thresholds.for_channel(
        MarketDataChannel.TRADES
    )


def test_book_ticker_is_held_to_the_book_standard() -> None:
    thresholds = StalenessThresholds()
    assert thresholds.for_channel(
        MarketDataChannel.BOOK_TICKER
    ) == thresholds.for_channel(MarketDataChannel.ORDER_BOOK)


def test_stale_episodes_are_counted_for_flapping_detection() -> None:
    monitor = StalenessMonitor(StalenessThresholds(trades_millis=1_000))
    for cycle in range(3):
        offset = BASE_TS + cycle * 10_000 * MILLIS
        monitor.record_message(MarketDataChannel.TRADES, "BTC-USDT", at_micros=offset)
        # Evaluate while still fresh so the stream is observed to recover; an
        # episode is only counted on a fresh -> stale edge, which is what makes
        # the counter a flapping signal rather than a poll counter.
        monitor.evaluate(now_micros=offset + 100 * MILLIS)
        monitor.evaluate(now_micros=offset + 2_000 * MILLIS)

    freshness = monitor.track(MarketDataChannel.TRADES, "BTC-USDT")
    assert freshness.stale_episodes == 3


def test_whole_connection_silence_is_detected_separately() -> None:
    """Catches every stream stopping at once, which per-stream checks may miss."""
    monitor = StalenessMonitor(
        StalenessThresholds(trades_millis=600_000, connection_millis=1_000)
    )
    monitor.record_message(MarketDataChannel.TRADES, "BTC-USDT", at_micros=BASE_TS)
    verdict = monitor.evaluate(now_micros=BASE_TS + 5_000 * MILLIS)
    assert verdict.connection_stale is True


# ----------------------------------------------------------------------
# Metrics
# ----------------------------------------------------------------------
def test_histogram_reports_none_before_any_observation() -> None:
    """A zero here would read as an impossibly fast measurement."""
    histogram = LatencyHistogram()
    assert histogram.percentile(0.5) is None
    assert histogram.mean_micros is None


def test_histogram_percentiles_use_nearest_rank() -> None:
    histogram = LatencyHistogram()
    for value in range(1, 101):
        histogram.observe(value)
    assert histogram.percentile(0.5) == 50
    assert histogram.percentile(0.99) == 99
    assert histogram.percentile(1.0) == 100


def test_histogram_window_is_bounded() -> None:
    """Memory must not grow with message volume."""
    histogram = LatencyHistogram(window=100)
    for value in range(10_000):
        histogram.observe(value)
    assert histogram.count == 10_000
    assert histogram.to_dict()["windowSize"] == 100


def test_histogram_keeps_negative_feed_lag_rather_than_clamping() -> None:
    """Clocks are not synchronised, so negative feed lag is real information.

    Clamping it to zero hides skew and makes the number look trustworthy when
    it is not.
    """
    histogram = LatencyHistogram()
    histogram.observe(-5_000)
    histogram.observe(5_000)
    assert histogram.min_micros == -5_000
    assert histogram.mean_micros == 0


def test_metrics_separate_feed_lag_from_processing_latency() -> None:
    """Conflating them makes both numbers meaningless."""
    metrics = ConnectivityMetrics()
    metrics.record_message(
        "binance",
        "orderbook",
        "BTC-USDT",
        exchange_timestamp=1_000,
        received_timestamp=3_000,
        processed_timestamp=3_500,
    )
    stream = metrics.stream("binance", "orderbook", "BTC-USDT")
    assert stream.feed_lag.max_micros == 2_000
    assert stream.processing.max_micros == 500
    assert stream.end_to_end.max_micros == 2_500


def test_processing_latency_is_omitted_when_not_measured() -> None:
    metrics = ConnectivityMetrics()
    metrics.record_message(
        "binance",
        "trades",
        "BTC-USDT",
        exchange_timestamp=1_000,
        received_timestamp=2_000,
    )
    stream = metrics.stream("binance", "trades", "BTC-USDT")
    assert stream.processing.count == 0
    assert stream.feed_lag.count == 1


def test_counters_aggregate_across_streams() -> None:
    metrics = ConnectivityMetrics()
    metrics.record_gap("binance", "orderbook", "BTC-USDT")
    metrics.record_gap("binance", "orderbook", "ETH-USDT")
    metrics.record_resync("binance", "orderbook", "BTC-USDT")
    metrics.record_parse_error("binance", "trades", "BTC-USDT")

    totals = metrics.totals()
    assert totals["gaps"] == 2
    assert totals["resyncs"] == 1
    assert totals["parseErrors"] == 1
    assert metrics.stream_count == 3


def test_snapshot_labels_measurements_as_observed_not_guaranteed() -> None:
    """No latency guarantees are expressed anywhere in the platform."""
    metrics = ConnectivityMetrics()
    metrics.record_message(
        "binance",
        "orderbook",
        "BTC-USDT",
        exchange_timestamp=1_000,
        received_timestamp=2_000,
    )
    snapshot = metrics.to_dict()
    assert "observed" in snapshot
    rendered = str(snapshot).lower()
    for forbidden in ("guarantee", "sub-millisecond", "guaranteed"):
        assert forbidden not in rendered


def test_messages_per_second_needs_two_samples() -> None:
    metrics = ConnectivityMetrics()
    stream = metrics.stream("binance", "trades", "BTC-USDT")
    assert stream.messages_per_second(now_micros=BASE_TS) is None

    stream.record_message(exchange_timestamp=None, received_timestamp=BASE_TS)
    assert stream.messages_per_second(now_micros=BASE_TS + 1_000_000) is None

    stream.record_message(
        exchange_timestamp=None, received_timestamp=BASE_TS + 500_000
    )
    rate = stream.messages_per_second(now_micros=BASE_TS + 1_000_000)
    assert rate is not None
    assert rate == pytest.approx(2.0)
