"""The futures signed transport's hardening law (batch 03).

Pin the same rules the spot transport lives by, evaluated against the futures
allowlist: exactly ``fapi.binance.com`` / ``testnet.binancefuture.com``, no
blind order-POST retries, venue retry-after windows enforced locally, and the
futures error taxonomy surfaced on the operator-facing line.
"""

from __future__ import annotations

import asyncio
import json

import pytest
from wlct_trading.exchanges.binance.signing import SignedRequest
from wlct_trading.exchanges.binance.trading import HttpResponse

from app.venue.binance_futures_transport import (
    ALLOWED_FUTURES_BASE_URLS,
    BinanceFuturesHttpTransport,
    VenueFuturesHostNotAllowed,
    VenueFuturesRateLimitBudget,
    binance_futures_error_code,
)

TESTNET = "https://testnet.binancefuture.com"
LIVE = "https://fapi.binance.com"


def _req(url: str, method: str = "GET") -> SignedRequest:
    return SignedRequest(method=method, url=url, query="", headers={})


def _ok(body: object) -> HttpResponse:
    return HttpResponse(status=200, headers={}, body=json.dumps(body))


def _err(status: int, code: int, headers: dict[str, str] | None = None) -> HttpResponse:
    return HttpResponse(
        status=status,
        headers=headers or {},
        body=json.dumps({"code": code, "msg": "venue said no"}),
    )


class FakeSender:
    """Records SignedRequests and serves queued responses/errors."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.requests: list[SignedRequest] = []
        self.closed = False

    async def __call__(self, request: SignedRequest, timeout_ms: int) -> HttpResponse:
        self.requests.append(request)
        outcome = self.responses.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    async def aclose(self) -> None:
        self.closed = True


class TestHostAllowlist:
    def test_allowlist_is_exactly_the_two_futures_hosts(self):
        assert ALLOWED_FUTURES_BASE_URLS == {TESTNET, LIVE}

    def test_non_allowlisted_base_url_refused_at_construction(self):
        with pytest.raises(VenueFuturesHostNotAllowed):
            BinanceFuturesHttpTransport(
                base_url="https://fapi.binance.example.evil",
                sender=FakeSender([]),
            )

    def test_spot_host_is_not_an_ok_futures_host(self):
        with pytest.raises(VenueFuturesHostNotAllowed):
            BinanceFuturesHttpTransport(
                base_url="https://api.binance.com",
                sender=FakeSender([]),
            )

    def test_request_to_other_host_never_transmits(self):
        sender = FakeSender([_ok({"ok": True})])
        transport = BinanceFuturesHttpTransport(base_url=TESTNET, sender=sender)
        with pytest.raises(VenueFuturesHostNotAllowed):
            asyncio.new_event_loop().run_until_complete(
                transport(_req("https://fapi.binance.com.attacker.example/fapi/v1/order"), 5_000)
            )
        assert sender.requests == []

    def test_http_scheme_refused_even_on_right_host(self):
        sender = FakeSender([])
        transport = BinanceFuturesHttpTransport(base_url=TESTNET, sender=sender)
        with pytest.raises(VenueFuturesHostNotAllowed):
            asyncio.new_event_loop().run_until_complete(
                transport(_req("http://testnet.binancefuture.com/fapi/v1/time"), 5_000)
            )
        assert sender.requests == []


class TestOrderSafetyAndRetry:
    def test_post_is_never_retried_on_429(self):
        # A timed-out venue answer on POST /fapi/v1/order is ambiguous; the
        # transport must not gamble a second position on it. Query-then-decide
        # lives in the outcome resolver, not here.
        sender = FakeSender([
            _err(429, -1003, {"Retry-After": "0"}),
            _ok({"shouldNever": "be reached"}),
        ])
        transport = BinanceFuturesHttpTransport(base_url=TESTNET, sender=sender)
        response = asyncio.new_event_loop().run_until_complete(
            transport(_req(f"{TESTNET}/fapi/v1/order", method="POST"), 5_000)
        )
        assert response.status == 429
        assert len(sender.requests) == 1

    def test_get_retries_once_on_429_within_bounds(self):
        async def never_sleep(_seconds: float) -> None:
            return None

        sender = FakeSender([_err(429, -1003, {}), _ok({"price": "1.0"})])
        transport = BinanceFuturesHttpTransport(
            base_url=TESTNET, sender=sender, sleep=never_sleep
        )
        response = asyncio.new_event_loop().run_until_complete(
            transport(_req(f"{TESTNET}/fapi/v1/ticker/price"), 5_000)
        )
        assert response.status == 200
        assert len(sender.requests) == 2

    def test_retry_bound_stops_blind_looping(self):
        async def never_sleep(_seconds: float) -> None:
            return None

        sender = FakeSender([_err(429, -1003, {}) for _ in range(6)])
        transport = BinanceFuturesHttpTransport(
            base_url=TESTNET, sender=sender, sleep=never_sleep, max_get_retries=2
        )
        response = asyncio.new_event_loop().run_until_complete(
            transport(_req(f"{TESTNET}/fapi/v1/time"), 5_000)
        )
        assert response.status == 429
        # initial + 2 retries, bounded
        assert len(sender.requests) == 3

    def test_retry_after_silences_further_calls_locally(self):
        # Fake clock: frozen at t=1000, so the venue's 5s window stays open.
        now = 1_000.0

        async def never_sleep(_seconds: float) -> None:
            return None

        sender = FakeSender([_err(429, -1003, {"Retry-After": "5"}), _ok({})])
        transport = BinanceFuturesHttpTransport(
            base_url=TESTNET, sender=sender, monotonic=lambda: now, sleep=never_sleep
        )
        loop = asyncio.new_event_loop()
        # First call: one venue 429, one bounded GET retry, then the 200 the
        # venue meant to return. Two transmissions on the wire, one window
        # recorded locally (retry-after is sticky: a 200 does NOT clear it).
        first = loop.run_until_complete(
            transport(_req(f"{TESTNET}/fapi/v1/time"), 5_000)
        )
        assert first.status == 200
        assert len(sender.requests) == 2
        # Window open: the next call must be refused locally, nothing sent.
        response = loop.run_until_complete(
            transport(_req(f"{TESTNET}/fapi/v1/time"), 5_000)
        )
        assert response.status == 429
        assert "not transmitted" in response.body
        assert len(sender.requests) == 2  # no third transmission


class TestClockRecoveryAndTime:
    def test_minus_1021_get_triggers_clock_resync_once(self):
        async def never_sleep(_seconds: float) -> None:
            return None

        resyncs = 0

        async def resync() -> None:
            nonlocal resyncs
            resyncs += 1

        sender = FakeSender(
            [_err(400, -1021, {}), _err(400, -1021, {}), _ok({"serverTime": 123})]
        )
        transport = BinanceFuturesHttpTransport(
            base_url=TESTNET, sender=sender, sleep=never_sleep
        )
        transport.bind_clock_resync(resync)
        loop = asyncio.new_event_loop()
        response = loop.run_until_complete(
            transport(_req(f"{TESTNET}/fapi/v1/time"), 5_000)
        )
        # -1021 is a 400: never retried (not a rate limit), venue answer
        # surfaced as-is, and the clock resync fired exactly once because the
        # answer PROVES local clock skew - signing further requests on the
        # same skew would burn weight on guaranteed rejections.
        assert response.status == 400
        assert resyncs == 1

    def test_server_time_parses_venue_answer(self):
        sender = FakeSender([_ok({"serverTime": 1_700_000_000_000})])
        transport = BinanceFuturesHttpTransport(base_url=TESTNET, sender=sender)
        millis = asyncio.new_event_loop().run_until_complete(transport.server_time())
        assert millis == 1_700_000_000_000

    def test_server_time_non_json_refuses(self):
        from app.venue.binance_futures_transport import VenueFuturesTransportError

        sender = FakeSender([HttpResponse(status=200, headers={}, body="<html>")])
        transport = BinanceFuturesHttpTransport(base_url=TESTNET, sender=sender)
        with pytest.raises(VenueFuturesTransportError):
            asyncio.new_event_loop().run_until_complete(transport.server_time())


class TestErrorTaxonomy:
    def test_error_code_extracted_tolerantly(self):
        assert binance_futures_error_code('{"code":-2019,"msg":"Margin is insufficient."}') == -2019
        assert binance_futures_error_code('{"code":-2027}') == -2027
        assert binance_futures_error_code("not json") is None
        assert binance_futures_error_code('{"msg":"no code"}') is None
        assert binance_futures_error_code("[1,2]") is None

    def test_futures_specific_codes_have_names(self):
        from app.venue.binance_futures_transport import BINANCE_FUTURES_ERROR_KINDS

        assert BINANCE_FUTURES_ERROR_KINDS[-2019] == "margin_not_sufficient"
        assert BINANCE_FUTURES_ERROR_KINDS[-2027] == "exceeds_max_leverage"
        assert BINANCE_FUTURES_ERROR_KINDS[-1021] == "timestamp_outside_recv_window"

    def test_describe_reports_budget_without_secrets(self):
        transport = BinanceFuturesHttpTransport(base_url=TESTNET, sender=FakeSender([]))
        view = transport.describe()
        assert view["baseUrl"] == TESTNET
        assert "allowedBaseUrls" in view
        assert "recvWindowMs" in view
        # No secret-shaped keys
        assert not any("key" in k.lower() or "secret" in k.lower() for k in view)


class TestBudgetAccounting:
    def test_headers_update_budget(self):
        budget = VenueFuturesRateLimitBudget()
        budget.observe(
            HttpResponse(
                status=200,
                headers={
                    "X-MBX-USED-WEIGHT-1M": "42",
                    "X-MBX-ORDER-COUNT-10S": "3",
                    "X-MBX-ORDER-COUNT-1D": "1200",
                },
                body="{}",
            ),
            now=100.0,
        )
        assert budget.used_weight_1m == 42
        assert budget.order_count_10s == 3
        assert budget.order_count_1d == 1200

    def test_retry_after_window(self):
        budget = VenueFuturesRateLimitBudget()
        budget.observe(_err(429, -1003, {"Retry-After": "10"}), now=100.0)
        assert budget.seconds_until_available(now=100.0) == 10.0
        assert budget.seconds_until_available(now=104.0) == 6.0
        assert budget.seconds_until_available(now=120.0) == 0.0
