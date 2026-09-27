"""Transport layer: backoff, error taxonomy, connection state, rate limits.

Every test here is deterministic. Backoff jitter is either disabled or driven by
a seeded RNG, and every clock reading is injected, so nothing depends on wall
time.
"""

from __future__ import annotations

import random

import pytest

from wlct_trading.transport.backoff import BackoffConfig, ExponentialBackoff
from wlct_trading.transport.errors import (
    RETRY_POLICIES,
    ExchangeErrorCategory,
    NormalisedExchangeError,
    scrub_metadata,
)
from wlct_trading.transport.errors import _REDACTED
from wlct_trading.transport.ratelimit import (
    RateLimitRegistry,
    RateLimitRule,
    WeightedRateLimiter,
)
from wlct_trading.transport.state import (
    ConnectionHealth,
    ConnectionState,
    InvalidConnectionTransition,
    LatencyStats,
    is_legal_connection_transition,
)

BASE_TS = 1_700_000_000_000_000
MICROS_PER_SECOND = 1_000_000


# ----------------------------------------------------------------------
# Backoff
# ----------------------------------------------------------------------
def test_backoff_grows_exponentially_without_jitter() -> None:
    backoff = ExponentialBackoff(
        BackoffConfig(base_delay_millis=100, max_delay_millis=10_000, jitter=False)
    )
    delays = [backoff.next_delay_millis() for _ in range(5)]
    assert delays == [100, 200, 400, 800, 1_600]


def test_backoff_is_capped_at_the_maximum() -> None:
    backoff = ExponentialBackoff(
        BackoffConfig(base_delay_millis=1_000, max_delay_millis=5_000, jitter=False)
    )
    delays = [backoff.next_delay_millis() for _ in range(6)]
    assert delays == [1_000, 2_000, 4_000, 5_000, 5_000, 5_000]
    assert max(delays) <= 5_000


def test_backoff_full_jitter_never_exceeds_the_ceiling() -> None:
    """Jitter must spread retries without ever exceeding the capped ceiling.

    A seeded RNG makes this exact rather than probabilistic.
    """
    backoff = ExponentialBackoff(
        BackoffConfig(base_delay_millis=100, max_delay_millis=3_200, jitter=True),
        _rng=random.Random(1234),
    )
    for attempt in range(8):
        ceiling = min(100 * (2**attempt), 3_200)
        delay = backoff.next_delay_millis()
        assert 0 <= delay <= ceiling


def test_backoff_jitter_actually_varies() -> None:
    """Guards against a jitter implementation that silently returns the cap."""
    first = ExponentialBackoff(
        BackoffConfig(base_delay_millis=1_000, max_delay_millis=60_000, jitter=True),
        _rng=random.Random(7),
    )
    samples = {first.next_delay_millis() for _ in range(20)}
    assert len(samples) > 1


def test_backoff_reset_returns_to_the_first_delay() -> None:
    backoff = ExponentialBackoff(
        BackoffConfig(base_delay_millis=250, max_delay_millis=8_000, jitter=False)
    )
    backoff.next_delay_millis()
    backoff.next_delay_millis()
    assert backoff.attempt == 2
    backoff.reset()
    assert backoff.attempt == 0
    assert backoff.next_delay_millis() == 250


def test_backoff_honours_the_attempt_cap() -> None:
    """Retrying forever is how an IP gets banned; the cap must be enforced."""
    backoff = ExponentialBackoff(
        BackoffConfig(base_delay_millis=10, max_attempts=3, jitter=False)
    )
    assert backoff.can_retry() is True
    for _ in range(3):
        backoff.next_delay_millis()
    assert backoff.can_retry() is False


def test_backoff_multiplier_extends_the_delay_for_severe_errors() -> None:
    backoff = ExponentialBackoff(
        BackoffConfig(base_delay_millis=100, max_delay_millis=100_000, jitter=False)
    )
    assert backoff.peek_delay_millis(multiplier=1.0) == 100
    assert backoff.peek_delay_millis(multiplier=6.0) == 600


def test_peek_does_not_advance_the_attempt_counter() -> None:
    backoff = ExponentialBackoff(BackoffConfig(base_delay_millis=100, jitter=False))
    assert backoff.peek_delay_millis() == backoff.peek_delay_millis()
    assert backoff.attempt == 0


# ----------------------------------------------------------------------
# Error taxonomy
# ----------------------------------------------------------------------
def test_every_error_category_has_a_retry_policy() -> None:
    """An unmapped category would fall through to undefined retry behaviour."""
    for category in ExchangeErrorCategory:
        assert category in RETRY_POLICIES, f"{category.value} has no retry policy"


def test_authentication_errors_are_not_retryable() -> None:
    """Bad credentials do not become good by trying again.

    Retrying an auth failure just locks the key out faster.
    """
    error = NormalisedExchangeError(
        category=ExchangeErrorCategory.AUTHENTICATION_ERROR,
        message="Invalid API key.",
        exchange="binance",
    )
    assert error.is_retryable is False


def test_invalid_request_errors_are_not_retryable() -> None:
    error = NormalisedExchangeError(
        category=ExchangeErrorCategory.INVALID_REQUEST,
        message="Bad symbol.",
        exchange="binance",
    )
    assert error.is_retryable is False


def test_network_and_rate_limit_errors_are_retryable() -> None:
    for category in (
        ExchangeErrorCategory.NETWORK_ERROR,
        ExchangeErrorCategory.RATE_LIMIT_ERROR,
        ExchangeErrorCategory.TIMEOUT,
    ):
        error = NormalisedExchangeError(
            category=category, message="transient", exchange="binance"
        )
        assert error.is_retryable is True, category.value


def test_rate_limit_backoff_is_more_patient_than_network_backoff() -> None:
    """A 429 needs a longer pause than a dropped socket."""
    network = RETRY_POLICIES[ExchangeErrorCategory.NETWORK_ERROR]
    rate_limited = RETRY_POLICIES[ExchangeErrorCategory.RATE_LIMIT_ERROR]
    assert rate_limited.backoff_multiplier > network.backoff_multiplier


def test_sequence_errors_require_resync() -> None:
    error = NormalisedExchangeError(
        category=ExchangeErrorCategory.SEQUENCE_ERROR,
        message="gap detected",
        exchange="binance",
    )
    assert error.requires_resync is True


@pytest.mark.parametrize(
    "key",
    [
        "apiKey",
        "api_secret",
        "signature",
        "Authorization",
        "password",
        "token",
        "privateKey",
    ],
)
def test_metadata_scrubbing_removes_credential_fields(key: str) -> None:
    """Error metadata reaches the logs, so it must never carry secrets."""
    scrubbed = scrub_metadata({key: "super-secret-value", "symbol": "BTCUSDT"})
    assert scrubbed[key] == _REDACTED
    assert "super-secret-value" not in str(scrubbed)
    assert scrubbed["symbol"] == "BTCUSDT"


def test_scrubbing_is_applied_automatically_on_construction() -> None:
    error = NormalisedExchangeError(
        category=ExchangeErrorCategory.AUTHENTICATION_ERROR,
        message="rejected",
        exchange="binance",
        metadata={"apiKey": "AKIAmnotreal", "httpStatus": 401},
    )
    assert error.metadata["apiKey"] == _REDACTED
    assert "AKIAmnotreal" not in str(error.to_log_fields())


def test_scrubbing_recurses_into_nested_metadata() -> None:
    scrubbed = scrub_metadata(
        {"request": {"headers": {"X-MBX-APIKEY": "leak-me"}}, "ok": 1}
    )
    assert "leak-me" not in str(scrubbed)


# ----------------------------------------------------------------------
# Connection state machine
# ----------------------------------------------------------------------
def test_legal_connection_transitions() -> None:
    assert is_legal_connection_transition(
        ConnectionState.DISCONNECTED, ConnectionState.CONNECTING
    )
    assert is_legal_connection_transition(
        ConnectionState.CONNECTING, ConnectionState.CONNECTED
    )
    assert is_legal_connection_transition(
        ConnectionState.CONNECTED, ConnectionState.DISCONNECTED
    )
    assert is_legal_connection_transition(
        ConnectionState.RECONNECTING, ConnectionState.CONNECTED
    )


def test_illegal_connection_transitions_are_rejected() -> None:
    """Skipping CONNECTING would let a socket appear connected without one."""
    assert not is_legal_connection_transition(
        ConnectionState.DISCONNECTED, ConnectionState.CONNECTED
    )


def test_stopped_is_terminal() -> None:
    """Once stopped, a manager must never silently come back to life."""
    for target in ConnectionState:
        if target is ConnectionState.STOPPED:
            continue
        assert not is_legal_connection_transition(ConnectionState.STOPPED, target)


def test_invalid_transition_exception_names_both_states() -> None:
    exc = InvalidConnectionTransition(
        "market-data", ConnectionState.DISCONNECTED, ConnectionState.CONNECTED
    )
    assert "DISCONNECTED" in str(exc)
    assert "CONNECTED" in str(exc)
    assert exc.connection_name == "market-data"


# ----------------------------------------------------------------------
# Health
# ----------------------------------------------------------------------
def test_health_is_unhealthy_when_stale_even_if_connected() -> None:
    """An open socket delivering nothing is not healthy.

    This is the failure that quietly breaks trading systems: the connection
    looks fine and the data is an hour old.
    """
    health = ConnectionHealth(
        exchange="binance",
        connection_name="depth",
        state=ConnectionState.CONNECTED,
        connected_at=BASE_TS,
        last_message_at=BASE_TS,
        is_stale=True,
    )
    assert health.is_connected is True
    assert health.is_healthy is False


def test_health_is_healthy_when_connected_and_fresh() -> None:
    health = ConnectionHealth(
        exchange="binance",
        connection_name="depth",
        state=ConnectionState.CONNECTED,
        connected_at=BASE_TS,
        last_message_at=BASE_TS,
        is_stale=False,
    )
    assert health.is_healthy is True


def test_health_log_fields_carry_no_credentials() -> None:
    health = ConnectionHealth(
        exchange="binance",
        connection_name="depth",
        state=ConnectionState.CONNECTED,
        last_error_message="Invalid API key supplied.",
    )
    rendered = str(health.to_log_fields()).lower()
    for fragment in ("secret", "apikey=", "password", "token="):
        assert fragment not in rendered


def test_latency_stats_track_a_running_maximum() -> None:
    stats = LatencyStats().with_ping(1_000).with_ping(5_000).with_ping(2_000)
    assert stats.max_ping_rtt_micros == 5_000
    assert stats.last_ping_rtt_micros == 2_000


# ----------------------------------------------------------------------
# Rate limiting
# ----------------------------------------------------------------------
def test_weighted_limiter_admits_within_budget() -> None:
    limiter = WeightedRateLimiter(RateLimitRule("REQUEST_WEIGHT", 100, 60))
    decision = limiter.try_acquire(40, now_micros=BASE_TS)
    assert decision.allowed is True
    assert decision.remaining == 60


def test_weighted_limiter_counts_weight_not_requests() -> None:
    """Ten heavy calls can exceed a budget that a hundred light ones would not.

    Counting requests instead of weight is the classic way to get IP-banned
    while the request counter still looks healthy.
    """
    limiter = WeightedRateLimiter(RateLimitRule("REQUEST_WEIGHT", 100, 60))
    for _ in range(4):
        assert limiter.try_acquire(25, now_micros=BASE_TS).allowed is True
    assert limiter.try_acquire(1, now_micros=BASE_TS).allowed is False


def test_refused_acquisition_consumes_nothing() -> None:
    """A rejected attempt must not leak budget, or refusals become permanent."""
    limiter = WeightedRateLimiter(RateLimitRule("REQUEST_WEIGHT", 10, 60))
    limiter.try_acquire(8, now_micros=BASE_TS)
    before = limiter.consumed(now_micros=BASE_TS)
    assert limiter.try_acquire(5, now_micros=BASE_TS).allowed is False
    assert limiter.consumed(now_micros=BASE_TS) == before


def test_sliding_window_frees_budget_as_entries_age_out() -> None:
    limiter = WeightedRateLimiter(RateLimitRule("REQUEST_WEIGHT", 10, 60))
    assert limiter.try_acquire(10, now_micros=BASE_TS).allowed is True
    assert limiter.try_acquire(1, now_micros=BASE_TS + 30 * MICROS_PER_SECOND).allowed is False
    later = BASE_TS + 61 * MICROS_PER_SECOND
    assert limiter.try_acquire(10, now_micros=later).allowed is True


def test_refusal_reports_a_usable_retry_hint() -> None:
    limiter = WeightedRateLimiter(RateLimitRule("REQUEST_WEIGHT", 10, 60))
    limiter.try_acquire(10, now_micros=BASE_TS)
    decision = limiter.try_acquire(5, now_micros=BASE_TS + 10 * MICROS_PER_SECOND)
    assert decision.allowed is False
    # The window entry expires 60s after it was made, i.e. 50s from now.
    assert 49_000 <= decision.retry_after_millis <= 50_000


def test_registry_all_or_nothing_does_not_partially_consume() -> None:
    """If any budget refuses, none may be deducted."""
    registry = RateLimitRegistry.from_rules(
        (RateLimitRule("REQUEST_WEIGHT", 100, 60), RateLimitRule("RAW_REQUESTS", 2, 60))
    )
    assert registry.try_acquire_all(
        {"REQUEST_WEIGHT": 10, "RAW_REQUESTS": 1}, now_micros=BASE_TS
    )[0] is True
    assert registry.try_acquire_all(
        {"REQUEST_WEIGHT": 10, "RAW_REQUESTS": 1}, now_micros=BASE_TS
    )[0] is True

    weight_before = registry.get("REQUEST_WEIGHT").consumed(now_micros=BASE_TS)
    allowed, _ = registry.try_acquire_all(
        {"REQUEST_WEIGHT": 10, "RAW_REQUESTS": 1}, now_micros=BASE_TS
    )
    assert allowed is False
    assert registry.get("REQUEST_WEIGHT").consumed(now_micros=BASE_TS) == weight_before


def test_registry_raises_on_an_unknown_rule() -> None:
    registry = RateLimitRegistry.from_rules((RateLimitRule("REQUEST_WEIGHT", 10, 60),))
    with pytest.raises(KeyError):
        registry.try_acquire("NOPE", 1, now_micros=BASE_TS)


def test_request_larger_than_capacity_is_refused_not_hung() -> None:
    limiter = WeightedRateLimiter(RateLimitRule("REQUEST_WEIGHT", 10, 60))
    decision = limiter.try_acquire(50, now_micros=BASE_TS)
    assert decision.allowed is False
    assert decision.retry_after_millis > 0


def test_registry_snapshot_reports_utilisation() -> None:
    registry = RateLimitRegistry.from_rules((RateLimitRule("REQUEST_WEIGHT", 100, 60),))
    registry.try_acquire("REQUEST_WEIGHT", 25, now_micros=BASE_TS)
    snapshot = registry.snapshot(now_micros=BASE_TS)
    assert snapshot["REQUEST_WEIGHT"]["consumed"] == 25
    assert snapshot["REQUEST_WEIGHT"]["remaining"] == 75
