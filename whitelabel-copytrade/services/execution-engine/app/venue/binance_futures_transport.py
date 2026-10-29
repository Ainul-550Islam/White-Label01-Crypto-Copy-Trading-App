"""The signed HTTP transport from this service to Binance USD-M FUTURES.

Batch 03 (item B). Responsibility: same egress law as
:mod:`app.venue.binance_transport` - host allowlist, venue budget accounting,
bounded GET retry, clock recovery, no secrets in logs - applied to the futures
hosts (``fapi.binance.com`` / ``testnet.binancefuture.com``).

Why a parallel module and not a share of the spot one:

- the batches' spot-parity contract forbids touching the spot transport, and
  sharing module state would cross-contaminate the two IP/UID budgets the
  venues meter separately;
- the futures error table differs in exactly the places a timeout handler
  cares about (``-2027`` leverage rejection, ``-2019`` margin rejection), and
  the path prefix differs (``/fapi`` vs ``/api``), so a "shared" class with
  two flag parameters would be the spot module in disguise anyway.

The class relationship is: same behavioural law, different data. Tests compare
``ALLOWED_FUTURES_BASE_URLS`` against the trading-core capability declaration
rather than against a hand-typed host list, so a venue re-map upstream is a
test failure here, not a silent fork.

Signing stays out of this module (the futures adapter signs with
``binance.signing`` + the synchronised clock before any of this runs).
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import time
from collections.abc import Awaitable, Callable, Mapping
from urllib.parse import urlsplit

from wlct_trading.exchanges.binance.signing import SignedRequest
from wlct_trading.exchanges.binance.trading import HttpResponse, SignedRequestSender
from wlct_trading.exchanges.binance_futures.capabilities import (
    BINANCE_FUTURES_REST_BASE,
    BINANCE_FUTURES_TESTNET_REST_BASE,
)

logger = logging.getLogger(__name__)

__all__ = [
    "ALLOWED_FUTURES_BASE_URLS",
    "BINANCE_FUTURES_ERROR_KINDS",
    "BinanceFuturesHttpTransport",
    "VenueFuturesHostNotAllowed",
    "VenueFuturesRateLimitBudget",
    "VenueFuturesTransportError",
    "binance_futures_error_code",
]

#: The only two hosts a signed futures request may ever reach.
ALLOWED_FUTURES_BASE_URLS = frozenset(
    {BINANCE_FUTURES_REST_BASE, BINANCE_FUTURES_TESTNET_REST_BASE}
)

#: USD-M error codes this service maps onto its own vocabulary for logging
#: and recovery decisions. The authoritative classification lives in
#: ``wlct_trading.exchanges.binance_futures.parsers.classify_futures_error``;
#: this table exists so the transport's operator-facing lines read the same
#: words without re-importing the taxonomy.
BINANCE_FUTURES_ERROR_KINDS: Mapping[int, str] = {
    -1003: "rate_limit",
    -1013: "filter_mismatch",
    -1021: "timestamp_outside_recv_window",
    -1022: "signature_invalid",
    -1111: "precision_exceeded",
    -2010: "order_rejected",
    -2011: "cancel_rejected",
    -2013: "order_not_found",
    -2019: "margin_not_sufficient",
    -2027: "exceeds_max_leverage",
    -2028: "leverage_below_minimum",
    -4088: "futures_permission_denied",
}

_RATE_LIMIT_STATUSES = (429, 418)
_MAX_SYNTHETIC_WAIT_SECONDS = 3_600.0


class VenueFuturesTransportError(RuntimeError):
    """The futures transport could not carry a request to the venue."""


class VenueFuturesHostNotAllowed(VenueFuturesTransportError, ValueError):
    """A request or configured base URL names a host outside the futures allowlist."""


def binance_futures_error_code(body: str) -> int | None:
    """Extract the numeric ``code`` from an error body, tolerantly."""
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
    return None


def _header(headers: Mapping[str, str], name: str) -> str | None:
    lowered = name.lower()
    for key, value in headers.items():
        if key.lower() == lowered:
            return value
    return None


def _header_int(headers: Mapping[str, str], name: str) -> int | None:
    raw = _header(headers, name)
    if raw is None:
        return None
    try:
        return int(float(raw))
    except (TypeError, ValueError):
        return None


def _retry_after_seconds(headers: Mapping[str, str]) -> float | None:
    raw = _header(headers, "Retry-After")
    if raw is None:
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


class VenueFuturesRateLimitBudget:
    """One shared view of the venue's weight meters for this futures runtime.

    The venue tracks weight and order counts across every connection from the
    deployment's IP (and per UID on signed endpoints). The transport observes
    the headers after every answer; the adapters pre-check against the local
    registry, and when the venue's own counter says we are over budget the
    transport refuses locally rather than extending a ban.
    """

    def __init__(self) -> None:
        self.used_weight_1m: int | None = None
        self.order_count_10s: int | None = None
        self.order_count_1d: int | None = None
        self._retry_after_until: float = 0.0

    def observe(self, response: HttpResponse, *, now: float) -> None:
        w = _header_int(response.headers, "X-MBX-USED-WEIGHT-1M") or _header_int(
            response.headers, "X-MBX-USED-WEIGHT"
        )
        if w is not None:
            self.used_weight_1m = w
        oc10 = _header_int(response.headers, "X-MBX-ORDER-COUNT-10S")
        if oc10 is not None:
            self.order_count_10s = oc10
        oc1d = _header_int(response.headers, "X-MBX-ORDER-COUNT-1D")
        if oc1d is not None:
            self.order_count_1d = oc1d
        if response.status in _RATE_LIMIT_STATUSES:
            retry_after = _retry_after_seconds(response.headers)
            if retry_after is not None:
                self._retry_after_until = max(
                    self._retry_after_until, now + min(retry_after, _MAX_SYNTHETIC_WAIT_SECONDS)
                )

    def seconds_until_available(self, *, now: float) -> float:
        return max(0.0, self._retry_after_until - now)


class BinanceFuturesHttpTransport:
    """Futures venue-mode ``SignedRequestSender``: allowlist, budget, bounded GET retry."""

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
        budget: VenueFuturesRateLimitBudget | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        cleaned = base_url.rstrip("/")
        if cleaned not in ALLOWED_FUTURES_BASE_URLS:
            raise VenueFuturesHostNotAllowed(
                f"Binance futures base URL {base_url!r} is not on the allowlist "
                f"({sorted(ALLOWED_FUTURES_BASE_URLS)}); a signed request must "
                "never reach any other host"
            )
        if not 0 < recv_window_ms <= 60_000:
            raise ValueError("recv_window_ms must be within Binance's 1..60000 range")
        self._base_url = cleaned
        self._sender = sender
        self._recv_window_ms = recv_window_ms
        self._max_get_retries = max(0, max_get_retries)
        self._budget = budget if budget is not None else VenueFuturesRateLimitBudget()
        self._sleep = sleep
        self._monotonic = monotonic
        self._resync_clock: Callable[[], Awaitable[object]] | None = None

    @property
    def base_url(self) -> str:
        return self._base_url

    @property
    def budget(self) -> VenueFuturesRateLimitBudget:
        return self._budget

    def bind_clock_resync(self, resync: Callable[[], Awaitable[object]]) -> None:
        self._resync_clock = resync

    def _check_host(self, request: SignedRequest) -> str:
        parts = urlsplit(request.url)
        origin = f"{parts.scheme}://{parts.netloc}" if parts.netloc else ""
        if parts.scheme != "https" or origin != self._base_url:
            raise VenueFuturesHostNotAllowed(
                "refusing to transmit a signed futures request to "
                f"{origin or request.url!r}: only {self._base_url} is wired "
                "for this runtime"
            )
        return parts.path or "/"

    def _silence_response(self, wait_seconds: float, *, path: str) -> HttpResponse:
        seconds = min(wait_seconds, _MAX_SYNTHETIC_WAIT_SECONDS)
        logger.warning(
            "binance futures transport: inside venue retry-after window, refusing "
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
            code = (
                binance_futures_error_code(response.body) if response.status >= 400 else None
            )
            logger.info(
                "binance futures transport: method=%s path=%s status=%s code=%s kind=%s "
                "used_weight_1m=%s attempt=%s",
                request.method,
                path,
                response.status,
                code if code is not None else "-",
                (
                    BINANCE_FUTURES_ERROR_KINDS.get(code, "-")
                    if code is not None
                    else "-"
                ),
                (
                    self._budget.used_weight_1m
                    if self._budget.used_weight_1m is not None
                    else "-"
                ),
                attempt,
            )
            if code == -1021 and self._resync_clock is not None and not resynced:
                resynced = True
                try:
                    await self._resync_clock()
                except Exception:  # noqa: BLE001 - best effort
                    logger.warning(
                        "binance futures transport: clock resync after -1021 failed",
                        exc_info=True,
                    )
            if not self._may_retry(request, response, attempt):
                return response
            delay = self._retry_delay(response, attempt)
            elapsed_ms = (self._monotonic() - started) * 1_000
            if request.timestamp_millis > 0 and (
                elapsed_ms + delay * 1_000 + 250 >= self._recv_window_ms
            ):
                return response
            await self._sleep(delay)

    def _may_retry(self, request: SignedRequest, response: HttpResponse, attempt: int) -> bool:
        """Only idempotent GETs, only rate limits, only bounded. Post never retries."""
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
        """Futures ``GET /fapi/v1/time`` - the venue clock's measurement source."""
        request = SignedRequest(
            method="GET",
            url=f"{self._base_url}/fapi/v1/time",
            query="",
            headers={},
        )
        response = await self(request, timeout_ms)
        if not 200 <= response.status < 300:
            raise VenueFuturesTransportError(
                f"venue returned HTTP {response.status} for server time; the "
                "clock cannot be synchronised and signing will be refused"
            )
        try:
            payload = json.loads(response.body)
            return int(payload["serverTime"])
        except (ValueError, KeyError, TypeError) as exc:
            raise VenueFuturesTransportError(
                "venue server-time response was not parseable; the clock "
                "cannot be synchronised and signing will be refused"
            ) from exc

    async def aclose(self) -> None:
        close = getattr(self._sender, "aclose", None)
        if callable(close):
            await close()

    def describe(self) -> dict[str, object]:
        return {
            "baseUrl": self._base_url,
            "allowedBaseUrls": sorted(ALLOWED_FUTURES_BASE_URLS),
            "recvWindowMs": self._recv_window_ms,
            "usedWeight1M": self._budget.used_weight_1m,
            "orderCount10S": self._budget.order_count_10s,
            "orderCount1D": self._budget.order_count_1d,
            "secondsUntilAvailable": round(
                self._budget.seconds_until_available(now=self._monotonic()), 3
            ),
        }
