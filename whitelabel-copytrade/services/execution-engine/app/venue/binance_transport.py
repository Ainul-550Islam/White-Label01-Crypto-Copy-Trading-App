"""The signed HTTP transport from this service to Binance SPOT.

Responsibility: carry one already-signed :class:`SignedRequest` to Binance
and bring back the raw :class:`HttpResponse`, under the rules a money-moving
egress path has to follow. This module is the venue-mode implementation of
the core's ``SignedRequestSender`` seam
(``wlct_trading.exchanges.binance.trading``); it wraps the core's
:class:`HttpxSignedSender`, which transmits the request byte-for-byte and
never retries, and adds the service-level law on top:

- **Host allowlist.** Only ``https://api.binance.com`` (live) and
  ``https://testnet.binance.vision`` (testnet) may ever receive a signed
  request from this process. The check runs before the request is
  transmitted, so a misconfigured base URL can never leak an API key to a
  host Binance does not operate.
- **Weight budgeting.** ``X-MBX-USED-WEIGHT-*`` and ``X-MBX-ORDER-COUNT-*``
  headers are folded into one shared budget the whole runtime reads. A
  429/418 with ``Retry-After`` records a venue-imposed silence window;
  while that window is open, further requests are refused locally with a
  synthesized 429 instead of being sent (sending during a 418 ban extends
  the ban). GETs may be retried within the signed request's recvWindow;
  order placement (POST) is never retried here - an ambiguous outcome is
  resolved by :mod:`app.venue.order_outcome`, not by resubmission.
- **Clock recovery.** Binance ``-1021`` (timestamp outside recvWindow)
  triggers exactly one clock re-synchronisation so the *next* request the
  adapter signs uses a fresh offset; the failed request itself is returned
  to the adapter, which classifies it as a definitive rejection.
- **No secrets in logs.** Log lines carry method, path (never the query
  string, which holds the signature), status, Binance error code, weight
  and attempt number. Headers (the API key rides there) and bodies are
  never logged.

Signing itself is *not* here: the adapter signs with
``wlct_trading.exchanges.binance.signing`` (HMAC-SHA256) using the
synchronised venue clock and attaches ``X-MBX-APIKEY``, ``timestamp`` and
``recvWindow`` before this module sees the request. Re-signing or even
re-encoding here would invalidate the signature, so the sender underneath
transmits the query string verbatim. Response bodies are returned raw; the
adapter parses them with ``parse_float=str`` so money and quantity stay
:class:`~decimal.Decimal`-exact end to end.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import time
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from urllib.parse import urlsplit

from wlct_trading.exchanges.binance.capabilities import (
    BINANCE_SPOT_REST_BASE,
    BINANCE_TESTNET_REST_BASE,
)
from wlct_trading.exchanges.binance.signing import SignedRequest
from wlct_trading.exchanges.binance.trading import HttpResponse, SignedRequestSender

logger = logging.getLogger(__name__)

__all__ = [
    "ALLOWED_BASE_URLS",
    "BINANCE_ERROR_KINDS",
    "BinanceHttpTransport",
    "VenueHostNotAllowed",
    "VenueRateLimitBudget",
    "VenueTransportError",
    "binance_error_code",
]

#: The only two hosts a signed request from this process may ever reach.
ALLOWED_BASE_URLS = frozenset({BINANCE_SPOT_REST_BASE, BINANCE_TESTNET_REST_BASE})

#: Binance error codes this service maps onto its own vocabulary. The adapter
#: performs the authoritative classification into the repository's error
#: taxonomy (definitive rejection vs ambiguous outcome vs rate limit); this
#: table gives the transport's logs and recovery decisions the same words.
BINANCE_ERROR_KINDS: Mapping[int, str] = {
    -1003: "rate_limit",
    -1013: "filter_rejection",
    -1021: "timestamp_outside_recv_window",
    -1022: "signature_invalid",
    -1111: "precision_exceeded",
    -2010: "order_rejected",
    -2011: "cancel_rejected",
    -2013: "order_not_found",
}

_RATE_LIMIT_STATUSES = (429, 418)
_MAX_SYNTHETIC_WAIT_SECONDS = 3_600.0


class VenueTransportError(RuntimeError):
    """The transport could not carry a request to the venue."""


class VenueHostNotAllowed(VenueTransportError, ValueError):
    """A request (or a configured base URL) names a host outside the allowlist.

    Raised *before* anything is transmitted. It is also a :class:`ValueError`
    so configuration-style handling (refuse the runtime) catches it alongside
    the other construction-time refusals.
    """


def binance_error_code(body: str) -> int | None:
    """Extract Binance's numeric ``code`` from an error body, tolerantly."""
    try:
        payload = json.loads(body)
    except (ValueError, TypeError):
        return None
    if not isinstance(payload, Mapping):
        return None
    raw = payload.get("code")
    if isinstance(raw, bool):  # pragma: no cover - defensive
        return None
    if isinstance(raw, int):
        return raw
    if isinstance(raw, str):
        try:
            return int(raw)
        except ValueError:
            return None
    return None


def _header(headers: Mapping[str, str], name: str) -> str | None:
    lowered = name.lower()
    for key, value in headers.items():
        if key.lower() == lowered:
            return value
    return None


def _header_int(headers: Mapping[str, str], name: str) -> int | None:
    value = _header(headers, name)
    if value is None:
        return None
    try:
        return int(value.strip())
    except ValueError:
        return None


def _retry_after_seconds(headers: Mapping[str, str]) -> float | None:
    """Parse a delta-seconds ``Retry-After``; HTTP-date forms read as unknown."""
    value = _header(headers, "Retry-After")
    if value is None:
        return None
    try:
        seconds = float(value.strip())
    except ValueError:
        return None
    if seconds < 0 or math.isnan(seconds) or math.isinf(seconds):
        return None
    return seconds


@dataclass(slots=True)
class VenueRateLimitBudget:
    """What Binance last told this process about its shared weight budget.

    One instance is shared by the trading adapter, the account adapter and
    the placement attestor (they all ride this transport), which is the only
    honest accounting: Binance meters the API key and the IP, not our
    internal components. The budget never *grants* capacity - the adapter's
    ``RateLimitRegistry`` reserves weight before sending - it records what
    the venue reported and when the venue told us to be silent.
    """

    used_weight_1m: int | None = None
    order_count_10s: int | None = None
    order_count_1d: int | None = None
    last_retry_after_seconds: float | None = None
    _silence_until_monotonic: float | None = None

    def observe(self, response: HttpResponse, *, now: float) -> None:
        headers = response.headers
        weight = _header_int(headers, "X-MBX-USED-WEIGHT-1M")
        if weight is not None:
            self.used_weight_1m = weight
        count_10s = _header_int(headers, "X-MBX-ORDER-COUNT-10S")
        if count_10s is not None:
            self.order_count_10s = count_10s
        count_1d = _header_int(headers, "X-MBX-ORDER-COUNT-1D")
        if count_1d is not None:
            self.order_count_1d = count_1d
        if response.status in _RATE_LIMIT_STATUSES:
            retry_after = _retry_after_seconds(headers)
            if retry_after is not None:
                self.last_retry_after_seconds = retry_after
                self._silence_until_monotonic = now + retry_after

    def seconds_until_available(self, *, now: float) -> float:
        """Remaining venue-imposed silence; ``0.0`` when requests may be sent."""
        if self._silence_until_monotonic is None:
            return 0.0
        return max(0.0, self._silence_until_monotonic - now)


class BinanceHttpTransport:
    """Venue-mode ``SignedRequestSender``: allowlist, budget, bounded GET retry."""

    __slots__ = (
        "_base_url",
        "_budget",
        "_max_get_retries",
        "_monotonic",
        "_recv_window_ms",
        "_resync_clock",
        "_sender",
        "_sleep",
    )

    def __init__(
        self,
        *,
        base_url: str,
        sender: SignedRequestSender,
        recv_window_ms: int = 5_000,
        max_get_retries: int = 2,
        budget: VenueRateLimitBudget | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        cleaned = base_url.rstrip("/")
        if cleaned not in ALLOWED_BASE_URLS:
            raise VenueHostNotAllowed(
                f"Binance base URL {base_url!r} is not on the allowlist "
                f"({sorted(ALLOWED_BASE_URLS)}); a signed request must never "
                "reach any other host"
            )
        if not 0 < recv_window_ms <= 60_000:
            raise ValueError("recv_window_ms must be within Binance's 1..60000 range")
        self._base_url = cleaned
        self._sender = sender
        self._recv_window_ms = recv_window_ms
        self._max_get_retries = max(0, max_get_retries)
        self._budget = budget if budget is not None else VenueRateLimitBudget()
        self._sleep = sleep
        self._monotonic = monotonic
        self._resync_clock: Callable[[], Awaitable[object]] | None = None

    @property
    def base_url(self) -> str:
        return self._base_url

    @property
    def budget(self) -> VenueRateLimitBudget:
        return self._budget

    def bind_clock_resync(self, resync: Callable[[], Awaitable[object]]) -> None:
        """Attach the venue clock's re-synchronisation (wired after the clock exists).

        The clock's server-time fetcher *is* this transport, so the callback
        cannot be a constructor argument; composition binds it immediately
        after building the clock.
        """
        self._resync_clock = resync

    def _check_host(self, request: SignedRequest) -> str:
        """Refuse any URL outside the allowlisted base; return the path for logs."""
        parts = urlsplit(request.url)
        origin = f"{parts.scheme}://{parts.netloc}" if parts.netloc else ""
        if parts.scheme != "https" or origin != self._base_url:
            raise VenueHostNotAllowed(
                "refusing to transmit a signed request to "
                f"{origin or request.url!r}: only {self._base_url} is wired "
                "for this runtime"
            )
        return parts.path or "/"

    def _silence_response(self, wait_seconds: float, *, path: str) -> HttpResponse:
        """A locally synthesized 429 standing in for a venue-imposed ban.

        Truthful by construction: the venue itself told us (via a previous
        429/418 ``Retry-After``) that requests in this window are refused, and
        sending one anyway can extend a 418 IP ban. The adapter classifies
        this exactly like a venue 429 - a definitive rate-limit refusal, never
        an ambiguous outcome.
        """
        seconds = min(wait_seconds, _MAX_SYNTHETIC_WAIT_SECONDS)
        logger.warning(
            "binance transport: inside venue retry-after window, refusing "
            "locally path=%s wait_seconds=%.1f",
            path,
            seconds,
        )
        return HttpResponse(
            status=429,
            headers={"Retry-After": str(max(1, math.ceil(seconds)))},
            body=json.dumps(
                {
                    "code": -1003,
                    "msg": "venue retry-after window still open; not transmitted",
                }
            ),
        )

    async def __call__(self, request: SignedRequest, timeout_ms: int) -> HttpResponse:
        path = self._check_host(request)
        silence = self._budget.seconds_until_available(now=self._monotonic())
        if silence > 0:
            return self._silence_response(silence, path=path)

        started = self._monotonic()
        attempt = 0
        resynced = False
        while True:
            attempt += 1
            response = await self._sender(request, timeout_ms)
            now = self._monotonic()
            self._budget.observe(response, now=now)
            code = binance_error_code(response.body) if response.status >= 400 else None
            logger.info(
                "binance transport: method=%s path=%s status=%s code=%s kind=%s "
                "used_weight_1m=%s attempt=%s",
                request.method,
                path,
                response.status,
                code if code is not None else "-",
                BINANCE_ERROR_KINDS.get(code, "-") if code is not None else "-",
                self._budget.used_weight_1m
                if self._budget.used_weight_1m is not None
                else "-",
                attempt,
            )
            if code == -1021 and self._resync_clock is not None and not resynced:
                # The signature timestamp fell outside recvWindow: refresh the
                # offset so the NEXT signed request is right. This request is
                # not resent - it is already signed with the stale timestamp,
                # and the adapter classifies -1021 as a definitive rejection.
                resynced = True
                try:
                    await self._resync_clock()
                except Exception:  # noqa: BLE001 - recovery is best-effort
                    logger.warning(
                        "binance transport: clock resync after -1021 failed; "
                        "signing stays refused until the periodic sync succeeds",
                        exc_info=True,
                    )
            if not self._may_retry(request, response, attempt, started):
                return response
            delay = self._retry_delay(response, attempt)
            elapsed_ms = (self._monotonic() - started) * 1_000
            if request.timestamp_millis > 0 and (
                elapsed_ms + delay * 1_000 + 250 >= self._recv_window_ms
            ):
                # The signed bytes would land outside recvWindow; resending
                # them buys a guaranteed -1021. Return the venue's answer.
                return response
            await self._sleep(delay)

    def _may_retry(
        self,
        request: SignedRequest,
        response: HttpResponse,
        attempt: int,
        started: float,
    ) -> bool:
        """Only idempotent reads, only on venue rate limiting, only bounded.

        POST/DELETE (order placement and cancellation) are never retried by
        the transport: a placement whose fate is unclear is resolved by
        querying the venue (``order_outcome``), and a rate-limited placement
        was definitively not accepted, so the caller decides - loudly -
        whether to place again.
        """
        del started  # freshness is judged by the caller-side window check
        if request.method.upper() != "GET":
            return False
        if response.status not in _RATE_LIMIT_STATUSES:
            return False
        return attempt <= self._max_get_retries

    def _retry_delay(self, response: HttpResponse, attempt: int) -> float:
        retry_after = _retry_after_seconds(response.headers)
        if retry_after is not None:
            return min(retry_after, 10.0)
        silence = self._budget.seconds_until_available(now=self._monotonic())
        if silence > 0:
            return min(silence, 10.0)
        return min(0.5 * (2.0 ** (attempt - 1)), 10.0)

    async def server_time(self, timeout_ms: int = 5_000) -> int:
        """Binance ``GET /api/v3/time`` - the venue clock's measurement source."""
        request = SignedRequest(
            method="GET",
            url=f"{self._base_url}/api/v3/time",
            query="",
            headers={},
        )
        response = await self(request, timeout_ms)
        if not 200 <= response.status < 300:
            raise VenueTransportError(
                f"venue returned HTTP {response.status} for server time; the "
                "clock cannot be synchronised and signing will be refused"
            )
        try:
            payload = json.loads(response.body)
            return int(payload["serverTime"])
        except (ValueError, KeyError, TypeError) as exc:
            raise VenueTransportError(
                "venue server-time response was not parseable; the clock "
                "cannot be synchronised and signing will be refused"
            ) from exc

    async def aclose(self) -> None:
        """Close the underlying HTTP client, when the sender owns one."""
        close = getattr(self._sender, "aclose", None)
        if callable(close):
            await close()

    def describe(self) -> dict[str, object]:
        """Non-secret transport facts for the status surface."""
        return {
            "baseUrl": self._base_url,
            "allowedBaseUrls": sorted(ALLOWED_BASE_URLS),
            "recvWindowMs": self._recv_window_ms,
            # Key spellings are the wire aliases VenueTransportView emits
            # (Binance's own header names: USED-WEIGHT-1M, ORDER-COUNT-10S/1D).
            # They must match exactly: the status route validates this dict
            # through the view with extra="forbid".
            "usedWeight1M": self._budget.used_weight_1m,
            "orderCount10S": self._budget.order_count_10s,
            "orderCount1D": self._budget.order_count_1d,
            "secondsUntilAvailable": round(
                self._budget.seconds_until_available(now=self._monotonic()), 3
            ),
        }
