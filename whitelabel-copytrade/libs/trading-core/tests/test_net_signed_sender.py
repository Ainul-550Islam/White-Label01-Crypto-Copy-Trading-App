"""Deterministic tests for the one module that puts a credential on a socket.

``wlct_trading/net/signed_client.py`` is the money path's transport: the only file
in the library that transmits an API key header and a signed query string. Its
unsigned sibling ``net/http_client.py`` has refused a plaintext endpoint under test
since Part 9 (``InsecureHttpUrl`` appears in ``test_net_transport.py``), while this
module's identical law - ``InsecureSignedEndpoint`` - was named by no test at all:
the only test file importing ``signed_client`` was the dataset-replay integration
test, which exercises it as plumbing. That asymmetry is the gap this file closes,
and it is a documentation-shaped gap in a security sense: the sender's docstring
promises "there is deliberately no setting that permits it", and a promise about an
absence is exactly the kind of sentence that goes unkept when nothing checks it.

No network, no venue and no optional dependency is needed: the sender accepts an
injected client, so the fake below records what it was handed and answers.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Mapping

import pytest

from wlct_trading.exchanges.binance.signing import SignedRequest
from wlct_trading.exchanges.binance.trading import HttpResponse
from wlct_trading.net.config import TransportSettings
from wlct_trading.net.signed_client import (
    _MAX_BODY_BYTES,
    HttpxSignedSender,
    InsecureSignedEndpoint,
    fetch_server_time,
)

API_KEY = "test-key-never-logged"
SIGNED_QUERY = "symbol=BTCUSDT&timestamp=1700000000123&signature=deadbeef"


def run(coroutine: Any) -> Any:
    """Run a coroutine to completion (``pytest-asyncio`` is not a core dependency)."""
    return asyncio.run(coroutine)


def settings(**overrides: Any) -> TransportSettings:
    base: dict[str, Any] = {
        "symbols": ("BTC/USDT",),
        "http_max_retries": 2,
        "ws_receive_timeout_ms": 1_000,
    }
    base.update(overrides)
    return TransportSettings(**base)


def request(
    *,
    url: str = "https://api.binance.test/api/v3/order",
    query: str = SIGNED_QUERY,
) -> SignedRequest:
    return SignedRequest(
        method="POST",
        url=url,
        query=query,
        headers={"X-MBX-APIKEY": API_KEY},
        signed_payload="symbol=BTCUSDT&timestamp=1700000000123",
        timestamp_millis=1_700_000_000_123,
    )


class FakeResponse:
    """The three attributes of an ``httpx`` response the sender reads."""

    def __init__(self, *, status: int = 200, body: str = "{}", headers: Mapping[str, str] | None = None):
        self.status_code = status
        self.text = body
        self.headers = dict(headers or {})


class FakeClient:
    """Scriptable stand-in for ``httpx.AsyncClient``."""

    def __init__(self, *, response: FakeResponse | None = None, error: BaseException | None = None) -> None:
        self.response = response or FakeResponse()
        self.error = error
        self.calls: list[dict[str, Any]] = []
        self.close_calls = 0

    async def request(self, method: str, url: str, **kwargs: Any) -> FakeResponse:
        self.calls.append({"method": method, "url": url, **kwargs})
        if self.error is not None:
            raise self.error
        return self.response

    async def aclose(self) -> None:
        self.close_calls += 1


def sender_with(client: FakeClient) -> HttpxSignedSender:
    return HttpxSignedSender(settings(), client=client)


class TestPlaintextIsRefusedBeforeAnythingElse:
    def test_an_http_endpoint_raises_and_nothing_is_transmitted(self) -> None:
        client = FakeClient()
        sender = sender_with(client)
        with pytest.raises(InsecureSignedEndpoint) as excinfo:
            run(sender(request(url="http://api.binance.test/api/v3/order"), 5_000))
        assert "Refusing to transmit a signed request" in str(excinfo.value)
        assert client.calls == []

    def test_a_refused_request_is_not_counted_as_one_made(self) -> None:
        # The counter is incremented after the TLS check, so "requests" means "left
        # the process", not "was attempted by the caller". A deployment reading this
        # counter to reconcile against venue-side counts would be wrong otherwise.
        sender = sender_with(FakeClient())
        with pytest.raises(InsecureSignedEndpoint):
            run(sender(request(url="http://api.binance.test/api/v3/order"), 5_000))
        assert sender.requests == 0
        assert sender.failures == 0

    def test_the_refusal_is_a_valueerror_and_carries_no_setting_to_disable_it(self) -> None:
        assert issubclass(InsecureSignedEndpoint, ValueError)
        # `verify=False`-style escape hatches are the thing this class exists to omit.
        assert not any(name.startswith("allow_insecure") for name in dir(HttpxSignedSender))

    def test_fetch_server_time_refuses_a_plaintext_base_the_same_way(self) -> None:
        client = FakeClient()
        sender = sender_with(client)
        with pytest.raises(InsecureSignedEndpoint, match="rest_base must be HTTPS"):
            run(fetch_server_time(sender, rest_base="http://api.binance.test"))
        assert client.calls == []


class TestTransmissionIsVerbatim:
    def test_the_signed_query_travels_in_the_url_and_never_as_params(self) -> None:
        req = request()
        client = FakeClient()
        run(sender_with(client)(req, 5_000))
        assert client.calls[0]["url"] == req.full_url
        assert client.calls[0]["url"].endswith(SIGNED_QUERY)
        # A `params=` dict is what re-orders and re-encodes a signed string.
        assert "params" not in client.calls[0]

    def test_headers_are_copied_not_aliased(self) -> None:
        req = request()
        client = FakeClient()
        run(sender_with(client)(req, 5_000))
        sent = client.calls[0]["headers"]
        assert sent == {"X-MBX-APIKEY": API_KEY}
        assert sent is not req.headers

    def test_the_per_call_timeout_reaches_the_client(self) -> None:
        client = FakeClient()
        run(sender_with(client)(request(), 1_234))
        timeout = client.calls[0]["timeout"]
        # httpx is not required for this assertion: the sender builds whatever the
        # injected client is given, and the number the caller asked for is the one.
        assert getattr(timeout, "read", None) == pytest.approx(1.234)


class TestResponsesComeBackRatherThanRaise:
    def test_a_4xx_is_returned_as_data_and_counted_as_a_failure(self) -> None:
        client = FakeClient(response=FakeResponse(status=418, body='{"code":-1022}'))
        sender = sender_with(client)
        result = run(sender(request(), 5_000))
        assert isinstance(result, HttpResponse)
        assert result.status == 418
        assert result.json() == {"code": "-1022"}
        assert (sender.requests, sender.failures) == (1, 1)

    def test_a_transport_error_propagates_unchanged_and_counts(self) -> None:
        # The adapter classifies connection failures; rewriting the exception here
        # would either lose the type or quote a signed URL into its message.
        client = FakeClient(error=ConnectionError("socket closed"))
        sender = sender_with(client)
        with pytest.raises(ConnectionError, match="socket closed"):
            run(sender(request(), 5_000))
        assert (sender.requests, sender.failures) == (1, 1)
        assert sender.last_latency_micros is not None

    def test_the_capped_body_applies_to_errors_and_not_to_answers(self) -> None:
        huge = "x" * (_MAX_BODY_BYTES + 1)
        error = run(sender_with(FakeClient(response=FakeResponse(status=500, body=huge)))(request(), 5_000))
        ok = run(sender_with(FakeClient(response=FakeResponse(status=200, body=huge)))(request(), 5_000))
        assert len(error.body) == _MAX_BODY_BYTES
        assert len(ok.body) == len(huge)
        # A venue's own error page is worth keeping; a proxy's megabyte of HTML is
        # not, and a 200 must never be silently truncated however large it is.
        assert error.body == huge[:_MAX_BODY_BYTES]
        assert ok.body == huge


class TestCountersCarryNoSecrets:
    def test_the_weight_header_the_venue_reports_is_surfaced(self) -> None:
        client = FakeClient(response=FakeResponse(status=200, headers={"x-mbx-used-weight-1m": "45"}))
        sender = sender_with(client)
        run(sender(request(), 5_000))
        assert sender.stats()["lastVenueUsedWeight1m"] == 45

    def test_stats_have_the_five_documented_keys_and_nothing_else(self) -> None:
        assert set(sender_with(FakeClient()).stats()) == {
            "requests",
            "failures",
            "bytesReceived",
            "lastLatencyMicros",
            "lastVenueUsedWeight1m",
        }

    def test_no_url_header_or_signature_appears_in_the_stats_dump(self) -> None:
        client = FakeClient(response=FakeResponse(status=500, body="sorry " + SIGNED_QUERY))
        sender = sender_with(client)
        run(sender(request(), 5_000))
        dumped = json.dumps(sender.stats())
        assert API_KEY not in dumped
        assert "api.binance.test" not in dumped
        assert "signature=" not in dumped

    def test_bytes_received_counts_what_was_kept_not_what_arrived(self) -> None:
        sender = sender_with(FakeClient(response=FakeResponse(status=500, body="y" * 9_000)))
        run(sender(request(), 5_000))
        assert sender.bytes_received == _MAX_BODY_BYTES


class TestOwnershipOfTheClient:
    def test_an_injected_client_is_never_closed_by_the_sender(self) -> None:
        client = FakeClient()
        sender = sender_with(client)
        run(sender.aclose())
        assert client.close_calls == 0

    def test_constructing_a_sender_opens_nothing(self) -> None:
        # The observable half of the laziness law: a sender that was built and
        # discarded without a request never touched a pool, so there is nothing to
        # close and aclose() is inert rather than an AttributeError on a missing client.
        sender = HttpxSignedSender(settings())
        run(sender.aclose())
        assert sender.stats()["requests"] == 0


class TestServerTimeFetch:
    def test_the_time_request_carries_no_credentials(self) -> None:
        client = FakeClient(response=FakeResponse(status=200, body='{"serverTime":"1700000000123"}'))
        sender = sender_with(client)
        assert run(fetch_server_time(sender, rest_base="https://api.binance.test/")) == 1_700_000_000_123
        assert client.calls[0]["headers"] == {}
        assert client.calls[0]["url"] == "https://api.binance.test/api/v3/time"

    def test_a_non_2xx_answer_is_refused_rather_than_assumed(self) -> None:
        client = FakeClient(response=FakeResponse(status=503, body="unavailable"))
        with pytest.raises(RuntimeError, match="cannot be synchronised"):
            run(fetch_server_time(sender_with(client), rest_base="https://api.binance.test"))

    def test_a_body_without_server_time_is_refused_rather_than_defaulted(self) -> None:
        client = FakeClient(response=FakeResponse(status=200, body='{"server":"other"}'))
        with pytest.raises(RuntimeError, match="unexpected server-time payload"):
            run(fetch_server_time(sender_with(client), rest_base="https://api.binance.test"))

    def test_the_parsed_value_stays_a_string_before_it_becomes_an_int(self) -> None:
        # ``parse_int=str`` is what stops a JSON float from rounding a microsecond
        # figure; the sender must return an int and not a float or a Decimal.
        client = FakeClient(response=FakeResponse(status=200, body='{"serverTime":1700000000123}'))
        value = run(fetch_server_time(sender_with(client), rest_base="https://api.binance.test"))
        assert isinstance(value, int)
        assert value == 1_700_000_000_123
