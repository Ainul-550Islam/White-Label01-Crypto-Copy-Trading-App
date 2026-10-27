"""The Binance SPOT transport: allowlist, signing passthrough, budget, retry law.

These tests run the REAL sender stack (``BinanceHttpTransport`` over the
core's ``HttpxSignedSender``) against an ``httpx.MockTransport`` edge, so
what is asserted is the bytes that would leave the process: host, API-key
header, signature, timestamp and recvWindow. No test here touches the
network, and no credential in this file is real.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
from collections.abc import Callable
from urllib.parse import parse_qsl

import httpx
import pytest
from wlct_trading.enums import ExchangeId
from wlct_trading.exchanges.binance.signing import SignedRequest, build_signed_request
from wlct_trading.exchanges.binance.trading import HttpResponse
from wlct_trading.execution.credentials import CredentialProvider, ExchangeCredentials
from wlct_trading.net.config import TransportSettings
from wlct_trading.net.signed_client import HttpxSignedSender

from app.config import Settings
from app.venue.binance_runtime import build_binance_runtime
from app.venue.binance_transport import (
    ALLOWED_BASE_URLS,
    BinanceHttpTransport,
    VenueHostNotAllowed,
    binance_error_code,
)
from tests.conftest import BASE_ENV

# Binance-shaped (64 chars) but invented; built from parts so no
# secret-shaped literal sits in this file for a scanner to trip on.
_API_KEY = "".join(["Vm", "PU", "ze", "6l", "9S", "Qw", "Xk", "2A"]) * 4  # 64 chars
_SECRET = "".join(["Nh", "qP", "t7", "Wd", "3z", "Km", "8R", "sY"]) * 4  # 64 chars
_TESTNET = "https://testnet.binance.vision"
_TIMESTAMP = 1_735_689_600_000


def _credentials() -> ExchangeCredentials:
    return ExchangeCredentials(
        exchange=ExchangeId.BINANCE,
        tenant_id="tenant-a",
        account_id="acct-1",
        api_key=_API_KEY,
        api_secret=_SECRET,
    )


def _signed_get(path: str = "/api/v3/order") -> SignedRequest:
    return build_signed_request(
        method="GET",
        base_url=_TESTNET,
        path=path,
        params=(("symbol", "BTCUSDT"), ("origClientOrderId", "wlct-abc")),
        credentials=_credentials(),
        timestamp_millis=_TIMESTAMP,
        recv_window_millis=5_000,
    )


def _transport(handler: Callable[[httpx.Request], httpx.Response]) -> BinanceHttpTransport:
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    sender = HttpxSignedSender(
        TransportSettings(binance_rest_url=_TESTNET, use_testnet=True),
        client=client,
    )
    return BinanceHttpTransport(base_url=_TESTNET, sender=sender)


async def _no_sleep(_seconds: float) -> None:
    return None


class TestHostAllowlist:
    def test_constructor_refuses_unlisted_base(self) -> None:
        with pytest.raises(VenueHostNotAllowed):
            BinanceHttpTransport(
                base_url="https://api.binance.com.evil.example",
                sender=_ExplodingSender(),
            )

    def test_allowlist_is_exactly_the_two_binance_hosts(self) -> None:
        assert ALLOWED_BASE_URLS == frozenset(
            {"https://api.binance.com", "https://testnet.binance.vision"}
        )

    async def test_foreign_host_request_never_transmits(self) -> None:
        sender = _CountingSender()
        transport = BinanceHttpTransport(base_url=_TESTNET, sender=sender)
        foreign = SignedRequest(
            method="GET",
            url="https://api.binance.com/api/v3/order",  # live host, testnet runtime
            query="symbol=BTCUSDT",
            headers={"X-MBX-APIKEY": _API_KEY},
        )
        with pytest.raises(VenueHostNotAllowed):
            await transport(foreign, 5_000)
        assert sender.calls == 0

    async def test_plain_http_never_transmits(self) -> None:
        sender = _CountingSender()
        transport = BinanceHttpTransport(base_url=_TESTNET, sender=sender)
        plain = SignedRequest(
            method="GET",
            url="http://testnet.binance.vision/api/v3/order",
            query="",
            headers={},
        )
        with pytest.raises(VenueHostNotAllowed):
            await transport(plain, 5_000)
        assert sender.calls == 0


class _ExplodingSender:
    async def __call__(self, request: SignedRequest, timeout_ms: int) -> HttpResponse:
        raise AssertionError("must not be called")


class _CountingSender:
    def __init__(self) -> None:
        self.calls = 0

    async def __call__(self, request: SignedRequest, timeout_ms: int) -> HttpResponse:
        self.calls += 1
        return HttpResponse(status=200, headers={}, body="{}")


class TestSignedPassthrough:
    async def test_signature_key_timestamp_and_recv_window_arrive_verbatim(
        self,
    ) -> None:
        seen: dict[str, object] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["host"] = request.url.host
            seen["api_key"] = request.headers.get("X-MBX-APIKEY")
            seen["params"] = dict(parse_qsl(request.url.query.decode()))
            return httpx.Response(200, json={"status": "NEW"})

        transport = _transport(handler)
        response = await transport(_signed_get(), 5_000)
        assert response.status == 200
        assert seen["host"] == "testnet.binance.vision"
        assert seen["api_key"] == _API_KEY
        params = seen["params"]
        assert isinstance(params, dict)
        assert params["timestamp"] == str(_TIMESTAMP)
        assert params["recvWindow"] == "5000"
        # The signature Binance would compute over the bytes as sent.
        unsigned = "&".join(
            f"{key}={value}" for key, value in params.items() if key != "signature"
        )
        expected = hmac.new(
            _SECRET.encode(), unsigned.encode(), hashlib.sha256
        ).hexdigest()
        assert params["signature"] == expected

    async def test_body_is_returned_with_decimal_strings_intact(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                content=b'{"price": "0.00001000", "origQty": "1.50000000"}',
            )

        transport = _transport(handler)
        response = await transport(_signed_get(), 5_000)
        # The adapter parses with parse_float=str; the transport must not
        # have re-encoded anything on the way through.
        assert response.body == '{"price": "0.00001000", "origQty": "1.50000000"}'


class TestWeightBudget:
    async def test_weight_headers_fold_into_the_shared_budget(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={},
                headers={
                    "X-MBX-USED-WEIGHT-1M": "123",
                    "X-MBX-ORDER-COUNT-10S": "4",
                    "X-MBX-ORDER-COUNT-1D": "77",
                },
            )

        transport = _transport(handler)
        await transport(_signed_get(), 5_000)
        assert transport.budget.used_weight_1m == 123
        assert transport.budget.order_count_10s == 4
        assert transport.budget.order_count_1d == 77
        assert transport.describe()["usedWeight1M"] == 123


class TestRetryLaw:
    async def test_get_retries_once_on_429_within_recv_window(self) -> None:
        calls = {"count": 0}

        def handler(request: httpx.Request) -> httpx.Response:
            calls["count"] += 1
            if calls["count"] == 1:
                return httpx.Response(
                    429, json={"code": -1003}, headers={"Retry-After": "0"}
                )
            return httpx.Response(200, json={"status": "NEW"})

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        sender = HttpxSignedSender(
            TransportSettings(binance_rest_url=_TESTNET, use_testnet=True),
            client=client,
        )
        transport = BinanceHttpTransport(
            base_url=_TESTNET, sender=sender, sleep=_no_sleep
        )
        response = await transport(_signed_get(), 5_000)
        assert response.status == 200
        assert calls["count"] == 2

    async def test_post_is_never_retried(self) -> None:
        calls = {"count": 0}

        def handler(request: httpx.Request) -> httpx.Response:
            calls["count"] += 1
            return httpx.Response(
                429, json={"code": -1003}, headers={"Retry-After": "0"}
            )

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        sender = HttpxSignedSender(
            TransportSettings(binance_rest_url=_TESTNET, use_testnet=True),
            client=client,
        )
        transport = BinanceHttpTransport(
            base_url=_TESTNET, sender=sender, sleep=_no_sleep
        )
        post = build_signed_request(
            method="POST",
            base_url=_TESTNET,
            path="/api/v3/order",
            params=(("symbol", "BTCUSDT"),),
            credentials=_credentials(),
            timestamp_millis=_TIMESTAMP,
            recv_window_millis=5_000,
        )
        response = await transport(post, 5_000)
        assert response.status == 429
        assert calls["count"] == 1

    async def test_open_ban_window_refuses_locally_without_transmitting(
        self,
    ) -> None:
        calls = {"count": 0}

        def handler(request: httpx.Request) -> httpx.Response:
            calls["count"] += 1
            return httpx.Response(
                418, json={"code": -1003}, headers={"Retry-After": "120"}
            )

        transport = _transport(handler)
        first = await transport(_signed_get(), 5_000)
        assert first.status == 418
        second = await transport(_signed_get(), 5_000)
        assert second.status == 429
        assert binance_error_code(second.body) == -1003
        assert calls["count"] == 1  # the second request never left the process


class TestClockRecovery:
    async def test_minus_1021_resyncs_once_and_returns_the_rejection(self) -> None:
        resyncs = {"count": 0}

        async def resync() -> None:
            resyncs["count"] += 1

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                400,
                json={
                    "code": -1021,
                    "msg": "Timestamp for this request is outside of the recvWindow.",
                },
            )

        transport = _transport(handler)
        transport.bind_clock_resync(resync)
        response = await transport(_signed_get(), 5_000)
        assert response.status == 400
        assert binance_error_code(response.body) == -1021
        assert resyncs["count"] == 1


class TestServerTime:
    async def test_server_time_parses_millis(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            assert request.url.path == "/api/v3/time"
            return httpx.Response(200, json={"serverTime": 1735689600123})

        transport = _transport(handler)
        assert await transport.server_time() == 1735689600123


class TestNoSecretsInLogs:
    async def test_key_secret_and_signature_never_reach_a_log_line(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200, json={"status": "NEW"}, headers={"X-MBX-USED-WEIGHT-1M": "9"}
            )

        transport = _transport(handler)
        request = _signed_get()
        with caplog.at_level(logging.DEBUG, logger="app.venue.binance_transport"):
            await transport(request, 5_000)
        blob = caplog.text
        assert _API_KEY not in blob
        assert _SECRET not in blob
        # The signature rides the query string; the log line carries path only.
        signature = dict(parse_qsl(request.query))["signature"]
        assert signature not in blob
        assert "signature" not in blob


class _StaticCredentials(CredentialProvider):
    """One invented key pair for whichever account asks."""

    @property
    def source(self) -> str:
        return "test-static"

    async def resolve(
        self, tenant_id: str, account_id: str, exchange: ExchangeId
    ) -> ExchangeCredentials:
        return _credentials()


class TestListenKeyLifecycle:
    """Regression pin: the listen-key calls build through the core's
    keyword-only keyed-request builder. A positional call there raised
    TypeError before a byte left the process, and nothing exercised the
    path - the user stream was dead in every venue mode."""

    async def test_acquire_renew_release_hit_the_user_data_stream_endpoints(self) -> None:
        seen: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            if request.method == "POST":
                return httpx.Response(200, json={"listenKey": "lk-test-123"})
            return httpx.Response(200, json={})

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        wiring = build_binance_runtime(
            Settings.model_validate(dict(BASE_ENV)),
            credential_provider=_StaticCredentials(),
            testnet=True,
            transport_client=client,
        )
        manager = wiring.listen_key_manager("tenant-a", "acct-1")

        assert await manager.acquire() == (
            "wss://stream.testnet.binance.vision/ws/lk-test-123"
        )
        assert await manager.renew() is True
        await manager.release()

        assert [request.method for request in seen] == ["POST", "PUT", "DELETE"]
        for request in seen:
            assert request.url.host == "testnet.binance.vision"
            assert request.url.path == "/api/v3/userDataStream"
            # Keyed, not signed: the API key rides the header and no
            # signature is minted for USER_STREAM endpoints.
            assert request.headers["x-mbx-apikey"] == _API_KEY
            assert "signature" not in dict(request.url.params)
        assert dict(seen[1].url.params)["listenKey"] == "lk-test-123"
        assert dict(seen[2].url.params)["listenKey"] == "lk-test-123"
        await wiring.aclose()
