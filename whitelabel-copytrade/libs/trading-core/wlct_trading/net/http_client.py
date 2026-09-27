"""Production ``HttpGetter`` backed by ``httpx``.

The Binance adapter takes an injected
``HttpGetter = Callable[[str, Mapping[str, Any]], Awaitable[Any]]``. This module
provides the real one. It is the only place in the library that imports an HTTP
client.

Why ``httpx`` and not ``aiohttp``
---------------------------------
``services/market-data`` already depends on ``httpx`` and already uses it in
``app/services/providers.py``. Adding ``aiohttp`` would put two async HTTP
stacks, two connection-pool configurations and two sets of timeout semantics
inside one process, for no capability that is missing. The preference for
``aiohttp`` is honoured in spirit — an async client with explicit timeouts and a
managed session — while keeping the service on one stack.

Guarantees
----------
* Every request has a connect, read and total timeout. There is no path to an
  unbounded wait.
* Retries are bounded, use the existing :class:`ExponentialBackoff`, and only
  fire for categories the existing retry policy calls retryable. A 400 is never
  retried.
* Non-2xx responses raise a normalised error before any body parsing happens.
* JSON is parsed with numbers left as strings, because the Binance parsers
  reject floats — binary floating point cannot represent a price exactly, and
  the whole book is built on :class:`~decimal.Decimal`.
* One session for the process lifetime, closed explicitly on shutdown.
"""

from __future__ import annotations

import asyncio
import json
from types import TracebackType
from typing import Any, Mapping

from wlct_trading.clock import epoch_micros
from wlct_trading.net.config import TransportSettings
from wlct_trading.net.normalise import (
    normalise_http_status,
    normalise_network_exception,
)
from wlct_trading.transport.backoff import BackoffConfig, ExponentialBackoff
from wlct_trading.transport.errors import (
    ExchangeErrorCategory,
    NormalisedExchangeError,
)

__all__ = ["HttpxGetter", "InsecureHttpUrl"]

#: Cap on how much of an error body is kept for diagnostics.
_MAX_BODY_EXCERPT = 512


class InsecureHttpUrl(ValueError):
    """Raised when a plaintext ``http://`` URL is supplied."""


class HttpxGetter:
    """Async GET with bounded timeouts, bounded retries and normalised errors.

    Callable, so it satisfies the adapter's ``HttpGetter`` type directly:

    .. code-block:: python

        async with HttpxGetter(settings) as get:
            adapter = BinanceMarketDataAdapter(get)
    """

    __slots__ = (
        "_settings",
        "_client",
        "_owns_client",
        "_sleep",
        "requests",
        "failures",
        "retries",
        "bytes_received",
        "last_latency_micros",
    )

    def __init__(
        self,
        settings: TransportSettings,
        *,
        client: Any | None = None,
        sleep: Any | None = None,
    ) -> None:
        self._settings = settings
        self._client = client
        # An injected client belongs to the caller; closing it here would pull
        # the pool out from under them.
        self._owns_client = client is None
        self._sleep = sleep if sleep is not None else asyncio.sleep
        self.requests = 0
        self.failures = 0
        self.retries = 0
        self.bytes_received = 0
        self.last_latency_micros: int | None = None

    # ------------------------------------------------------------------
    # Session lifecycle
    # ------------------------------------------------------------------
    def _ensure_client(self) -> Any:
        """Create the session on first use.

        Lazily, so that constructing the getter — which happens during config
        validation and in tests — does not require the optional dependency or an
        event loop.
        """
        if self._client is not None:
            return self._client

        try:
            import httpx
        except ImportError as exc:  # pragma: no cover - depends on install
            raise ImportError(
                "The 'httpx' package is required for the live HTTP transport. "
                "Install it with: pip install 'wlct-trading-core[live]'"
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
                max_keepalive_connections=max(
                    1, settings.http_max_connections // 2
                ),
                keepalive_expiry=30.0,
            ),
            # TLS verification stays on. There is deliberately no setting that
            # can turn it off: a market-data feed an attacker can rewrite is a
            # way to induce bad trades.
            verify=True,
            follow_redirects=False,
            headers={
                "User-Agent": "wlct-trading-core",
                "Accept": "application/json",
            },
        )
        self._owns_client = True
        return self._client

    async def aclose(self) -> None:
        """Close the session. Idempotent."""
        client = self._client
        if client is None or not self._owns_client:
            self._client = None if self._owns_client else client
            return
        self._client = None
        try:
            await client.aclose()
        except asyncio.CancelledError:
            raise
        except BaseException:  # noqa: BLE001 - shutdown must not fail
            return

    async def __aenter__(self) -> "HttpxGetter":
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
    # HttpGetter protocol
    # ------------------------------------------------------------------
    async def __call__(self, url: str, params: Mapping[str, Any]) -> Any:
        """GET ``url`` and return the decoded JSON body.

        Raises :class:`NormalisedExchangeError` on any failure. The Binance
        adapter wraps that into an ``AdapterConnectionError``, so callers above
        it never see a transport-level type either.
        """
        if not url.startswith("https://"):
            raise InsecureHttpUrl(
                f"Refusing to issue a plaintext request to {url!r}. "
                f"Exchange REST traffic must use https://."
            )

        backoff = ExponentialBackoff(
            BackoffConfig(
                base_delay_millis=200,
                max_delay_millis=5_000,
                multiplier=2.0,
                # +1 because the first call is an attempt, not a retry.
                max_attempts=self._settings.http_max_retries + 1,
                jitter=True,
            )
        )

        last_error: NormalisedExchangeError | None = None
        attempt = 0

        while backoff.can_retry():
            attempt += 1
            if attempt > 1:
                self.retries += 1
            self.requests += 1
            started = epoch_micros()

            try:
                payload = await self._attempt(url, params)
            except asyncio.CancelledError:
                raise
            except BaseException as exc:  # noqa: BLE001 - normalised below
                self.failures += 1
                error = (
                    exc
                    if isinstance(exc, NormalisedExchangeError)
                    else normalise_network_exception(
                        exc, context=f"GET {url.split('?', 1)[0]}"
                    )
                )
                last_error = error

                if not error.is_retryable:
                    # A 400 or a malformed request will fail identically next
                    # time; retrying only delays the real error reaching the
                    # operator.
                    raise error from exc

                if not backoff.can_retry():
                    break

                delay_millis = backoff.next_delay_millis()
                if error.retry_after_millis is not None:
                    # The venue's own hint wins. Ignoring a Retry-After on a 429
                    # is how a rate limit becomes an IP ban.
                    delay_millis = max(delay_millis, error.retry_after_millis)
                await self._sleep(delay_millis / 1000)
                continue

            self.last_latency_micros = epoch_micros() - started
            return payload

        if last_error is not None:
            raise last_error
        raise NormalisedExchangeError(
            category=ExchangeErrorCategory.UNKNOWN_ERROR,
            message=f"GET {url.split('?', 1)[0]} exhausted its retry budget.",
            exchange="binance",
            metadata={"attempts": attempt},
        )

    async def _attempt(self, url: str, params: Mapping[str, Any]) -> Any:
        """One request: send, validate status, decode JSON."""
        client = self._ensure_client()
        response = await client.get(url, params=dict(params))

        status = int(response.status_code)
        if status < 200 or status >= 300:
            body = ""
            try:
                body = response.text[:_MAX_BODY_EXCERPT]
            except BaseException:  # noqa: BLE001 - body is diagnostic only
                body = ""
            raise normalise_http_status(
                status,
                url=url,
                body_excerpt=body,
                headers=getattr(response, "headers", None),
            )

        content = response.content
        if isinstance(content, (bytes, bytearray)):
            self.bytes_received += len(content)
            text = bytes(content).decode("utf-8", errors="strict")
        else:
            text = response.text
            self.bytes_received += len(text)

        try:
            # parse_float/parse_int keep every number as the exact string the
            # venue sent. The parsers convert to Decimal from there; going
            # through a float first would silently round a price.
            return json.loads(text, parse_float=str, parse_int=str)
        except (json.JSONDecodeError, UnicodeDecodeError, ValueError) as exc:
            raise NormalisedExchangeError(
                category=ExchangeErrorCategory.EXCHANGE_ERROR,
                message=(
                    f"Response from {url.split('?', 1)[0]} is not valid JSON: {exc}"
                ),
                exchange="binance",
                metadata={
                    "url": url.split("?", 1)[0],
                    "bodyExcerpt": text[:_MAX_BODY_EXCERPT],
                },
            ) from exc

    def stats(self) -> dict[str, int | None]:
        """Counters for the metrics layer."""
        return {
            "requests": self.requests,
            "failures": self.failures,
            "retries": self.retries,
            "bytesReceived": self.bytes_received,
            "lastLatencyMicros": self.last_latency_micros,
        }
