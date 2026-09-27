"""Production ``SignedRequestSender`` backed by ``httpx``.

The authenticated Binance adapters take an injected sender:

.. code-block:: python

    SignedRequestSender = Callable[[SignedRequest, int], Awaitable[HttpResponse]]

This module provides the real one, and it is the only file in the library that
performs an authenticated network call. Keeping it separate from
:mod:`wlct_trading.net.http_client` is deliberate: that client is for public
market data and is wired into the market-data service, which must never hold a
credential. A service that wants to sign orders has to import this module by
name, which makes the money path greppable.

What this adds over the public getter
-------------------------------------
**The signed query string is transmitted verbatim.** The signature covers the
exact bytes, so the URL is assembled here as ``url?query`` and handed to
``httpx`` as a pre-built string. It is never passed through a ``params=`` dict,
because any re-ordering or re-encoding invalidates the signature and produces a
``-1022`` that looks like a credential problem and is not.

**Non-2xx responses are returned, not raised.** The adapter needs the status
code, the body and the rate-limit headers to decide whether a failure was
definitive or ambiguous — a distinction that decides whether an order gets
resubmitted or reconciled. Raising here would throw that information away and
force the adapter to guess.

**Nothing is retried.** Not at this layer. A retry of a signed order is a
potential duplicate position, and the decision about whether a given failure is
safe to repeat belongs to the execution engine, which knows what the request
was for. This sender transmits once and reports what happened.

**Nothing is logged.** Every request carries the API key in a header and the
signature in the query. There is no logger in this module, and the counters it
exposes hold numbers only.
"""

from __future__ import annotations

from types import TracebackType
from typing import Any, Mapping

from wlct_trading.clock import monotonic_nanos
from wlct_trading.exchanges.binance.signing import SignedRequest
from wlct_trading.exchanges.binance.trading import HttpResponse
from wlct_trading.net.config import TransportSettings

__all__ = ["HttpxSignedSender", "InsecureSignedEndpoint"]

#: Cap on how much of an error body is carried back for diagnostics. A venue
#: error body is small; anything larger is a proxy's HTML error page, and
#: keeping megabytes of it in an exception helps nobody.
_MAX_BODY_BYTES = 4_096


class InsecureSignedEndpoint(ValueError):
    """Raised when a signed request targets a non-TLS URL.

    There is deliberately no setting that permits it. A signed request over
    plaintext exposes both the API key header and the signature to anyone on
    the path, which is the whole ballgame.
    """


class HttpxSignedSender:
    """Transmits prepared :class:`SignedRequest` objects.

    Callable, so it satisfies ``SignedRequestSender`` directly:

    .. code-block:: python

        async with HttpxSignedSender(settings) as send:
            trading = BinanceTradingAdapter(
                send=send, credentials=provider, clock=clock
            )

    One instance per process. The connection pool is what makes a signed
    request cheap — a fresh TLS handshake per order would add well over a
    hundred milliseconds to every submission.
    """

    __slots__ = (
        "_settings",
        "_client",
        "_owns_client",
        "requests",
        "failures",
        "bytes_received",
        "last_latency_micros",
        "last_used_weight",
    )

    def __init__(
        self,
        settings: TransportSettings,
        *,
        client: Any | None = None,
    ) -> None:
        self._settings = settings
        self._client = client
        # An injected client belongs to the caller; closing it here would pull
        # the pool out from under them.
        self._owns_client = client is None
        self.requests = 0
        self.failures = 0
        self.bytes_received = 0
        self.last_latency_micros: int | None = None
        #: The venue's own view of consumed rate-limit weight, from the last
        #: response. Worth surfacing: it counts across every process sharing the
        #: IP, which the local limiter cannot see.
        self.last_used_weight: int | None = None

    # ------------------------------------------------------------------
    # Session lifecycle
    # ------------------------------------------------------------------
    def _ensure_client(self) -> Any:
        """Create the session on first use.

        Lazily, so importing this module — which happens during configuration
        validation — does not require the optional dependency or a running
        event loop.
        """
        if self._client is not None:
            return self._client

        try:
            import httpx
        except ImportError as exc:  # pragma: no cover - depends on install
            raise ImportError(
                "The 'httpx' package is required for authenticated exchange "
                "requests. Install it with: pip install 'wlct-trading-core[live]'"
            ) from exc

        settings = self._settings
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(
                settings.http_total_timeout_ms / 1000,
                connect=settings.http_connect_timeout_ms / 1000,
                read=settings.http_read_timeout_ms / 1000,
                write=settings.http_read_timeout_ms / 1000,
                pool=settings.http_connect_timeout_ms / 1000,
            ),
            limits=httpx.Limits(
                max_connections=settings.http_max_connections,
                max_keepalive_connections=max(1, settings.http_max_connections // 2),
                # Binance closes idle connections; 30s keeps the pool warm
                # without holding sockets the venue has already discarded.
                keepalive_expiry=30.0,
            ),
            # TLS verification is on and there is no setting to disable it.
            verify=True,
            follow_redirects=False,
        )
        return self._client

    async def aclose(self) -> None:
        """Close the session, if this object owns it."""
        if self._client is not None and self._owns_client:
            await self._client.aclose()
            self._client = None

    async def __aenter__(self) -> "HttpxSignedSender":
        self._ensure_client()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        await self.aclose()

    # ------------------------------------------------------------------
    # Transmission
    # ------------------------------------------------------------------
    async def __call__(
        self, request: SignedRequest, timeout_ms: int
    ) -> HttpResponse:
        """Send one prepared request and return the raw response.

        Raises only for transport failures — connection refused, TLS failure,
        timeout. Those are the genuinely ambiguous cases, and the adapter maps
        them onto :class:`AdapterConnectionError` so the engine treats the
        order's fate as unknown.

        Every HTTP status, including 4xx and 5xx, comes back as an
        :class:`HttpResponse`. The adapter decides what each one means.
        """
        if not request.url.startswith("https://"):
            raise InsecureSignedEndpoint(
                f"Refusing to transmit a signed request to {request.url!r}. "
                f"Authenticated traffic must use TLS: the API key travels in a "
                f"header and the signature in the query string."
            )

        client = self._ensure_client()
        started_nanos = monotonic_nanos()
        self.requests += 1

        try:
            import httpx

            response = await client.request(
                request.method,
                # Pre-assembled. Passing params= here would let httpx re-encode
                # and re-order, which silently breaks the signature.
                request.full_url,
                headers=dict(request.headers),
                timeout=httpx.Timeout(
                    timeout_ms / 1000,
                    connect=min(
                        timeout_ms / 1000,
                        self._settings.http_connect_timeout_ms / 1000,
                    ),
                    read=timeout_ms / 1000,
                    write=timeout_ms / 1000,
                    pool=self._settings.http_connect_timeout_ms / 1000,
                ),
            )
        except Exception:
            self.failures += 1
            # Re-raised unchanged. The adapter classifies it; adding a message
            # here risks quoting a URL that contains a signature.
            raise
        finally:
            self.last_latency_micros = (monotonic_nanos() - started_nanos) // 1_000

        body = response.text
        if len(body) > _MAX_BODY_BYTES and not 200 <= response.status_code < 300:
            body = body[:_MAX_BODY_BYTES]
        self.bytes_received += len(body)

        headers = {key: value for key, value in response.headers.items()}
        result = HttpResponse(
            status=response.status_code,
            headers=headers,
            body=body,
        )
        self.last_used_weight = result.used_weight_1m
        if not 200 <= response.status_code < 300:
            self.failures += 1
        return result

    # ------------------------------------------------------------------
    # Diagnostics
    # ------------------------------------------------------------------
    def stats(self) -> dict[str, object]:
        """Counters only. Contains no URL, no header and no body."""
        return {
            "requests": self.requests,
            "failures": self.failures,
            "bytesReceived": self.bytes_received,
            "lastLatencyMicros": self.last_latency_micros,
            "lastVenueUsedWeight1m": self.last_used_weight,
        }


async def fetch_server_time(
    sender: HttpxSignedSender, *, rest_base: str, timeout_ms: int = 5_000
) -> int:
    """Read a venue's ``serverTime`` without credentials.

    Lives here rather than on the adapter so the clock can be synchronised
    before any account exists — at process start, and by a health check that
    should not need a tenant to answer "is our clock right?".
    """
    import json as _json

    if not rest_base.startswith("https://"):
        raise InsecureSignedEndpoint(
            f"rest_base must be HTTPS; got {rest_base!r}."
        )
    request = SignedRequest(
        method="GET",
        url=f"{rest_base.rstrip('/')}/api/v3/time",
        query="",
        headers={},
    )
    response = await sender(request, timeout_ms)
    if not 200 <= response.status < 300:
        raise RuntimeError(
            f"Venue returned HTTP {response.status} for server time; the clock "
            f"cannot be synchronised and signing will be refused."
        )
    payload = _json.loads(response.body, parse_float=str, parse_int=str)
    if not isinstance(payload, Mapping) or "serverTime" not in payload:
        raise RuntimeError("Venue returned an unexpected server-time payload.")
    return int(payload["serverTime"])
