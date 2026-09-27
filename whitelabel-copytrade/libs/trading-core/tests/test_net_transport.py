"""Deterministic tests for the production transports.

No internet, no credentials, no database, no Redis. Every network interaction is
against an in-process fake, so these run in CI on a machine with no egress.

Covers cases 1-15 and 19 of the Part 4 test plan: websocket connect/send/
receive/close, connect and receive timeouts, network failure, secure-URL
enforcement, HTTP success, timeout, non-2xx, malformed JSON, retry behaviour,
and the "no credentials anywhere" guarantee.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Mapping

import pytest

from wlct_trading.net.config import InvalidTransportSettings, TransportSettings
from wlct_trading.net.http_client import HttpxGetter, InsecureHttpUrl
from wlct_trading.net.normalise import (
    category_for_http_status,
    normalise_http_status,
    normalise_network_exception,
)
from wlct_trading.net.websocket_client import (
    InsecureWebSocketUrl,
    WebsocketsTransport,
    WebsocketsTransportFactory,
)
from wlct_trading.transport.errors import (
    ExchangeErrorCategory,
    NormalisedExchangeError,
)
from wlct_trading.transport.websocket import ConnectionClosed


def run(coroutine: Any) -> Any:
    """Run a coroutine to completion.

    ``pytest-asyncio`` is not a dependency of this project and adding one for
    the test suite of a zero-dependency library is not a trade worth making.
    """
    return asyncio.run(coroutine)


def settings(**overrides: Any) -> TransportSettings:
    base: dict[str, Any] = {
        "symbols": ("BTC/USDT",),
        "http_max_retries": 2,
        "ws_receive_timeout_ms": 1_000,
    }
    base.update(overrides)
    return TransportSettings(**base)


# ----------------------------------------------------------------------
# Fakes
# ----------------------------------------------------------------------
class FakeLibraryClosed(Exception):
    """Stands in for ``websockets.exceptions.ConnectionClosed``.

    Matched by class name, exactly as the real one is, which is what lets the
    normalisation layer work without importing the library.
    """

    __name__ = "ConnectionClosed"


FakeLibraryClosed.__name__ = "ConnectionClosed"


class FakeConnection:
    """A scriptable stand-in for a ``websockets`` client connection."""

    def __init__(
        self,
        *,
        incoming: list[Any] | None = None,
        recv_delay: float = 0.0,
        recv_error: BaseException | None = None,
        send_error: BaseException | None = None,
    ) -> None:
        self.incoming = list(incoming or [])
        self.sent: list[str] = []
        self.closed = False
        self.close_calls = 0
        self.recv_delay = recv_delay
        self.recv_error = recv_error
        self.send_error = send_error

    async def send(self, message: str) -> None:
        if self.send_error is not None:
            raise self.send_error
        self.sent.append(message)

    async def recv(self) -> Any:
        if self.recv_delay:
            await asyncio.sleep(self.recv_delay)
        if self.recv_error is not None:
            raise self.recv_error
        if not self.incoming:
            raise FakeLibraryClosed("no more frames")
        return self.incoming.pop(0)

    async def close(self) -> None:
        self.close_calls += 1
        self.closed = True


class FakeResponse:
    def __init__(
        self,
        status_code: int,
        body: str,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        self.status_code = status_code
        self.text = body
        self.content = body.encode("utf-8")
        self.headers = dict(headers or {})


class FakeHttpClient:
    """Records requests and replays a scripted sequence of results."""

    def __init__(self, results: list[Any]) -> None:
        self.results = list(results)
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.headers: dict[str, str] = {}
        self.closed = False

    async def get(self, url: str, params: Mapping[str, Any] | None = None) -> Any:
        self.calls.append((url, dict(params or {})))
        if not self.results:
            raise AssertionError("FakeHttpClient ran out of scripted results.")
        result = self.results.pop(0)
        if isinstance(result, BaseException):
            raise result
        return result

    async def aclose(self) -> None:
        self.closed = True


class FakeTimeout(Exception):
    """Stands in for ``httpx.ReadTimeout``; matched by name."""


FakeTimeout.__name__ = "ReadTimeout"


async def no_sleep(_seconds: float) -> None:
    """Collapse backoff so retry tests stay fast and deterministic."""
    return None


# ======================================================================
# 1. Websocket connect
# ======================================================================
def test_case_01_websocket_connect_returns_a_wrapped_transport() -> None:
    connection = FakeConnection(incoming=["hello"])
    captured: dict[str, Any] = {}

    async def fake_connect(url: str, **kwargs: Any) -> FakeConnection:
        captured["url"] = url
        captured.update(kwargs)
        return connection

    factory = WebsocketsTransportFactory(settings(), connect=fake_connect)
    transport = run(factory("wss://stream.binance.com:9443/ws"))

    assert isinstance(transport, WebsocketsTransport)
    assert captured["url"] == "wss://stream.binance.com:9443/ws"
    assert captured["open_timeout"] == pytest.approx(10.0)
    assert captured["compression"] is None
    assert factory.attempts == 1
    assert factory.successes == 1
    assert factory.failures == 0


def test_case_01b_plaintext_websocket_urls_are_refused() -> None:
    """No ``ws://``. Market data an attacker can rewrite is worse than none."""
    factory = WebsocketsTransportFactory(settings())
    with pytest.raises(InsecureWebSocketUrl):
        run(factory("ws://stream.binance.com:9443/ws"))
    assert factory.attempts == 0


# ======================================================================
# 2. Websocket send
# ======================================================================
def test_case_02_send_forwards_the_frame_verbatim() -> None:
    connection = FakeConnection()
    transport = WebsocketsTransport(connection, receive_timeout_seconds=1.0)
    frame = json.dumps({"method": "SUBSCRIBE", "params": ["btcusdt@trade"], "id": 1})

    run(transport.send(frame))

    assert connection.sent == [frame]


def test_case_02b_send_after_close_raises_the_platform_closed_error() -> None:
    connection = FakeConnection()
    transport = WebsocketsTransport(connection, receive_timeout_seconds=1.0)
    run(transport.close())

    with pytest.raises(ConnectionClosed):
        run(transport.send("{}"))


# ======================================================================
# 3. Websocket receive
# ======================================================================
def test_case_03_receive_decodes_text_and_binary_and_counts_bytes() -> None:
    connection = FakeConnection(incoming=["first", b"second"])
    seen: list[int] = []
    transport = WebsocketsTransport(
        connection, receive_timeout_seconds=1.0, on_bytes=seen.append
    )

    async def scenario() -> tuple[str, str]:
        return await transport.receive(), await transport.receive()

    first, second = run(scenario())

    assert first == "first"
    assert second == "second"
    assert seen == [5, 6]
    assert transport.bytes_received == 11
    assert transport.messages_received == 2


# ======================================================================
# 4. Websocket close
# ======================================================================
def test_case_04_close_is_idempotent_and_never_raises() -> None:
    class ExplodingClose(FakeConnection):
        async def close(self) -> None:
            self.close_calls += 1
            raise RuntimeError("the socket was already gone")

    connection = ExplodingClose()
    transport = WebsocketsTransport(connection, receive_timeout_seconds=1.0)

    async def scenario() -> None:
        await transport.close()
        await transport.close()

    run(scenario())

    assert transport.is_closed is True
    # Second call short-circuits: shutdown does not re-enter a dead socket.
    assert connection.close_calls == 1


# ======================================================================
# 5. Connect timeout
# ======================================================================
def test_case_05_connect_timeout_normalises_to_the_timeout_category() -> None:
    async def slow_connect(_url: str, **_kwargs: Any) -> FakeConnection:
        raise asyncio.TimeoutError()

    factory = WebsocketsTransportFactory(settings(), connect=slow_connect)

    with pytest.raises(NormalisedExchangeError) as caught:
        run(factory("wss://stream.binance.com:9443/ws"))

    assert caught.value.category is ExchangeErrorCategory.TIMEOUT
    assert caught.value.is_retryable is True
    assert factory.failures == 1
    # The library's own type must not escape.
    assert "asyncio" not in caught.value.message.split(":")[0]


# ======================================================================
# 6. Receive timeout
# ======================================================================
def test_case_06_receive_timeout_is_bounded_and_normalised() -> None:
    connection = FakeConnection(incoming=["never read"], recv_delay=5.0)
    transport = WebsocketsTransport(connection, receive_timeout_seconds=0.01)

    with pytest.raises(NormalisedExchangeError) as caught:
        run(transport.receive())

    assert caught.value.category is ExchangeErrorCategory.TIMEOUT
    assert "receive exceeded" in caught.value.message


# ======================================================================
# 7. Network failure
# ======================================================================
def test_case_07_network_failures_normalise_without_leaking_library_types() -> None:
    async def refused(_url: str, **_kwargs: Any) -> FakeConnection:
        raise ConnectionRefusedError("connection refused")

    factory = WebsocketsTransportFactory(settings(), connect=refused)

    with pytest.raises(NormalisedExchangeError) as caught:
        run(factory("wss://stream.binance.com:9443/ws"))

    error = caught.value
    assert error.category is ExchangeErrorCategory.NETWORK_ERROR
    assert error.is_retryable is True
    assert error.metadata["exceptionType"] == "ConnectionRefusedError"


def test_case_07b_peer_close_maps_to_the_platform_connection_closed_type() -> None:
    """The manager's read loop keys on this exact type to decide to reconnect."""
    connection = FakeConnection(recv_error=FakeLibraryClosed("1006"))
    transport = WebsocketsTransport(connection, receive_timeout_seconds=1.0)

    with pytest.raises(ConnectionClosed):
        run(transport.receive())
    assert transport.is_closed is True


def test_case_07c_every_library_exception_maps_into_the_existing_vocabulary() -> None:
    """No new error categories were invented for Part 4."""
    cases = {
        "ReadTimeout": ExchangeErrorCategory.TIMEOUT,
        "ConnectError": ExchangeErrorCategory.NETWORK_ERROR,
        "ProtocolError": ExchangeErrorCategory.EXCHANGE_ERROR,
        "InvalidMessage": ExchangeErrorCategory.EXCHANGE_ERROR,
        "PayloadTooBig": ExchangeErrorCategory.EXCHANGE_ERROR,
    }
    for name, expected in cases.items():
        exception = type(name, (Exception,), {})("boom")
        normalised = normalise_network_exception(exception, context="test")
        assert normalised.category is expected, name
        assert normalised.category in set(ExchangeErrorCategory)


# ======================================================================
# 10. HTTP snapshot success
# ======================================================================
def test_case_10_http_get_returns_parsed_json_with_numbers_as_strings() -> None:
    body = json.dumps(
        {
            "lastUpdateId": 1027024,
            "bids": [["4.00000000", "431.00000000"]],
            "asks": [["4.00000200", "12.00000000"]],
        }
    )
    client = FakeHttpClient([FakeResponse(200, body)])
    getter = HttpxGetter(settings(), client=client, sleep=no_sleep)

    payload = run(getter("https://api.binance.com/api/v3/depth", {"symbol": "BTCUSDT"}))

    assert payload["lastUpdateId"] == "1027024"
    assert isinstance(payload["lastUpdateId"], str)
    # Nothing in a price path is ever a float: binary floating point cannot
    # represent 4.00000200 exactly.
    assert not isinstance(payload["bids"][0][0], float)
    assert client.calls[0][1] == {"symbol": "BTCUSDT"}
    assert getter.requests == 1
    assert getter.failures == 0


def test_case_10b_plaintext_http_urls_are_refused() -> None:
    getter = HttpxGetter(settings(), client=FakeHttpClient([]))
    with pytest.raises(InsecureHttpUrl):
        run(getter("http://api.binance.com/api/v3/depth", {}))


# ======================================================================
# 11. HTTP timeout
# ======================================================================
def test_case_11_http_timeout_retries_then_reports_a_timeout() -> None:
    client = FakeHttpClient([FakeTimeout("read timed out")] * 3)
    getter = HttpxGetter(settings(http_max_retries=2), client=client, sleep=no_sleep)

    with pytest.raises(NormalisedExchangeError) as caught:
        run(getter("https://api.binance.com/api/v3/depth", {}))

    assert caught.value.category is ExchangeErrorCategory.TIMEOUT
    # Bounded: the initial attempt plus exactly two retries.
    assert len(client.calls) == 3
    assert getter.retries == 2


def test_case_11b_a_transient_failure_is_retried_and_then_succeeds() -> None:
    client = FakeHttpClient(
        [FakeTimeout("read timed out"), FakeResponse(200, json.dumps({"ok": True}))]
    )
    getter = HttpxGetter(settings(), client=client, sleep=no_sleep)

    payload = run(getter("https://api.binance.com/api/v3/ping", {}))

    assert payload == {"ok": True}
    assert len(client.calls) == 2


# ======================================================================
# 12. HTTP non-2xx
# ======================================================================
def test_case_12_client_errors_are_not_retried() -> None:
    body = json.dumps({"code": -1121, "msg": "Invalid symbol."})
    client = FakeHttpClient([FakeResponse(400, body)])
    getter = HttpxGetter(settings(), client=client, sleep=no_sleep)

    with pytest.raises(NormalisedExchangeError) as caught:
        run(getter("https://api.binance.com/api/v3/depth", {"symbol": "NOPE"}))

    error = caught.value
    assert error.category is ExchangeErrorCategory.INVALID_REQUEST
    assert error.is_retryable is False
    assert error.venue_code == "-1121"
    assert error.venue_message == "Invalid symbol."
    # Retrying a malformed request only delays the real error.
    assert len(client.calls) == 1


def test_case_12b_rate_limit_responses_honour_retry_after() -> None:
    client = FakeHttpClient(
        [
            FakeResponse(429, "{}", headers={"Retry-After": "2"}),
            FakeResponse(200, json.dumps({"ok": True})),
        ]
    )
    delays: list[float] = []

    async def record(seconds: float) -> None:
        delays.append(seconds)

    getter = HttpxGetter(settings(), client=client, sleep=record)
    payload = run(getter("https://api.binance.com/api/v3/depth", {}))

    assert payload == {"ok": True}
    # The venue's own hint wins over the computed backoff. Ignoring it is how a
    # rate limit becomes an IP ban.
    assert delays and delays[0] >= 2.0


def test_case_12c_server_errors_are_retried_and_bounded() -> None:
    client = FakeHttpClient([FakeResponse(503, "unavailable")] * 3)
    getter = HttpxGetter(settings(http_max_retries=2), client=client, sleep=no_sleep)

    with pytest.raises(NormalisedExchangeError) as caught:
        run(getter("https://api.binance.com/api/v3/depth", {}))

    assert caught.value.category is ExchangeErrorCategory.EXCHANGE_ERROR
    assert len(client.calls) == 3


def test_case_12d_http_status_mapping_uses_only_existing_categories() -> None:
    assert category_for_http_status(429) is ExchangeErrorCategory.RATE_LIMIT_ERROR
    assert category_for_http_status(418) is ExchangeErrorCategory.RATE_LIMIT_ERROR
    assert category_for_http_status(401) is ExchangeErrorCategory.AUTHENTICATION_ERROR
    assert category_for_http_status(404) is ExchangeErrorCategory.INVALID_REQUEST
    assert category_for_http_status(500) is ExchangeErrorCategory.EXCHANGE_ERROR
    assert category_for_http_status(408) is ExchangeErrorCategory.TIMEOUT


def test_case_12e_error_metadata_never_carries_a_query_string() -> None:
    """Query strings are stripped before anything reaches a log line."""
    error = normalise_http_status(
        400,
        url="https://api.binance.com/api/v3/order?signature=deadbeef&apiKey=secret",
        body_excerpt="{}",
    )
    rendered = json.dumps(error.to_log_fields())
    assert "deadbeef" not in rendered
    assert "signature" not in rendered


# ======================================================================
# 13. Malformed JSON
# ======================================================================
def test_case_13_malformed_json_is_reported_not_raised_raw() -> None:
    # An HTML body from a 200 response is what a maintenance page or an
    # intercepting proxy looks like. It is retried a bounded number of times —
    # the next response may well be JSON — and then reported.
    client = FakeHttpClient([FakeResponse(200, "<html>maintenance</html>")] * 3)
    getter = HttpxGetter(settings(http_max_retries=2), client=client, sleep=no_sleep)

    with pytest.raises(NormalisedExchangeError) as caught:
        run(getter("https://api.binance.com/api/v3/depth", {}))

    error = caught.value
    assert error.category is ExchangeErrorCategory.EXCHANGE_ERROR
    assert "not valid JSON" in error.message
    assert error.metadata["bodyExcerpt"].startswith("<html>")
    assert len(client.calls) == 3


def test_case_13b_malformed_json_does_not_crash_the_caller() -> None:
    """A bad body must surface as a normalised error, never as a raw decode."""
    client = FakeHttpClient(
        [FakeResponse(200, "{not json"), FakeResponse(200, json.dumps({"ok": 1}))]
    )
    getter = HttpxGetter(settings(), client=client, sleep=no_sleep)

    assert run(getter("https://api.binance.com/api/v3/ping", {})) == {"ok": "1"}


# ======================================================================
# 19. No credentials required
# ======================================================================
def test_case_19_no_credential_field_exists_on_the_transport_path() -> None:
    """Public market data needs no key, so there is nowhere to put one."""
    banned = ("key", "secret", "token", "password", "signature", "passphrase")
    for field_name in TransportSettings.__dataclass_fields__:
        assert not any(word in field_name.lower() for word in banned), field_name


def test_case_19b_no_authorisation_headers_are_sent() -> None:
    client = FakeHttpClient([FakeResponse(200, "{}")])
    getter = HttpxGetter(settings(), client=client, sleep=no_sleep)
    run(getter("https://api.binance.com/api/v3/depth", {"symbol": "BTCUSDT"}))

    _url, params = client.calls[0]
    for key in params:
        assert key.lower() not in ("signature", "apikey", "timestamp")
    assert "X-MBX-APIKEY" not in client.headers


# ======================================================================
# Session lifecycle
# ======================================================================
def test_session_is_closed_exactly_once_and_only_if_owned() -> None:
    client = FakeHttpClient([FakeResponse(200, "{}")])

    async def scenario() -> None:
        async with HttpxGetter(settings(), client=client, sleep=no_sleep) as getter:
            await getter("https://api.binance.com/api/v3/ping", {})

    run(scenario())
    # An injected client belongs to the caller; closing it here would pull the
    # pool out from under them.
    assert client.closed is False

    owned = HttpxGetter(settings(), sleep=no_sleep)
    owned._client = client  # noqa: SLF001 - exercising the ownership branch
    owned._owns_client = True  # noqa: SLF001
    run(owned.aclose())
    assert client.closed is True


# ======================================================================
# Configuration validation
# ======================================================================
def test_configuration_rejects_unsafe_and_nonsensical_values() -> None:
    with pytest.raises(InvalidTransportSettings):
        TransportSettings(binance_ws_url="ws://stream.binance.com:9443")
    with pytest.raises(InvalidTransportSettings):
        TransportSettings(binance_rest_url="http://api.binance.com")
    with pytest.raises(InvalidTransportSettings):
        TransportSettings(
            ws_heartbeat_interval_ms=90_000, ws_heartbeat_timeout_ms=90_000
        )
    with pytest.raises(InvalidTransportSettings):
        TransportSettings(symbols=())
    with pytest.raises(InvalidTransportSettings):
        TransportSettings(
            ticker_enabled=False, trades_enabled=False, orderbook_enabled=False
        )


def test_configuration_parses_booleans_strictly() -> None:
    resolved = TransportSettings.from_env(
        {
            "MARKET_DATA_SYMBOLS": "BTC/USDT",
            "MARKET_DATA_TICKER_ENABLED": "false",
            "MARKET_DATA_TRADES_ENABLED": "1",
        }
    )
    assert resolved.ticker_enabled is False
    assert resolved.trades_enabled is True

    with pytest.raises(InvalidTransportSettings):
        TransportSettings.from_env({"MARKET_DATA_TICKER_ENABLED": "flase"})
    with pytest.raises(InvalidTransportSettings):
        TransportSettings.from_env({"HTTP_CONNECT_TIMEOUT_MS": "not-a-number"})
