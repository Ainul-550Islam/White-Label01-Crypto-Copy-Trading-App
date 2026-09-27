"""Translate network-library exceptions into the platform's error vocabulary.

This module is the containment boundary. Above it, nothing knows that
``websockets`` or ``httpx`` exist: the rest of the system sees only
:class:`~wlct_trading.transport.errors.NormalisedExchangeError` and the nine
categories of :class:`~wlct_trading.transport.errors.ExchangeErrorCategory`.

On vocabulary
-------------
Part 3 defined nine categories and an exhaustive retry policy for each. Names
like ``CONNECTION_ERROR``, ``PROTOCOL_ERROR`` and ``INVALID_MESSAGE`` are
therefore mapped onto that existing set rather than added to it — a second,
overlapping taxonomy would mean two places to look up whether something is
retryable, and they would eventually disagree:

===========================  ==========================================
Conceptual failure           Existing category
===========================  ==========================================
connection refused/reset     ``NETWORK_ERROR``
DNS / TLS handshake          ``NETWORK_ERROR``
connect / read timeout       ``TIMEOUT``
websocket protocol violation ``EXCHANGE_ERROR``
malformed JSON or fields     ``EXCHANGE_ERROR``
HTTP 429 / 418               ``RATE_LIMIT_ERROR``
HTTP 4xx                     ``INVALID_REQUEST``  (not retryable)
HTTP 5xx                     ``EXCHANGE_ERROR``   (retryable)
HTTP 401 / 403               ``AUTHENTICATION_ERROR`` (not retryable)
anything unrecognised        ``UNKNOWN_ERROR``
===========================  ==========================================

``EXCHANGE_ERROR`` covers both protocol violations and malformed payloads
because the platform's response to each is identical: the message is unusable,
the connection may still be fine, and a retry is reasonable but bounded.
"""

from __future__ import annotations

import asyncio
import json
import ssl
from typing import Any

from wlct_trading.enums import ExchangeId
from wlct_trading.transport.errors import (
    ExchangeErrorCategory,
    NormalisedExchangeError,
)

__all__ = [
    "normalise_network_exception",
    "normalise_http_status",
    "category_for_http_status",
    "RETRYABLE_HTTP_STATUSES",
]

#: Statuses worth another attempt. 408 request timeout, 425 too early, 429 rate
#: limited, and the 5xx family. Everything else is a client mistake that will
#: fail identically on retry.
RETRYABLE_HTTP_STATUSES: frozenset[int] = frozenset(
    {408, 425, 429, 500, 502, 503, 504}
)


def category_for_http_status(status: int) -> ExchangeErrorCategory:
    """Map an HTTP status onto the platform's error taxonomy.

    418 is Binance's "you ignored 429 and are now IP-banned" status, so it is
    treated as a rate-limit failure and inherits that policy's long backoff.
    """
    if status in (418, 429):
        return ExchangeErrorCategory.RATE_LIMIT_ERROR
    if status in (401, 403):
        return ExchangeErrorCategory.AUTHENTICATION_ERROR
    if status == 408:
        return ExchangeErrorCategory.TIMEOUT
    if 500 <= status < 600:
        return ExchangeErrorCategory.EXCHANGE_ERROR
    if 400 <= status < 500:
        return ExchangeErrorCategory.INVALID_REQUEST
    return ExchangeErrorCategory.UNKNOWN_ERROR


def _retry_after_millis(headers: Any) -> int | None:
    """Read a ``Retry-After`` header, in milliseconds.

    The venue's own hint beats a computed backoff, so it is honoured when
    present and well-formed.
    """
    if headers is None:
        return None
    try:
        raw = headers.get("Retry-After") or headers.get("retry-after")
    except AttributeError:
        return None
    if raw is None:
        return None
    try:
        return max(0, int(float(str(raw).strip()) * 1_000))
    except (TypeError, ValueError):
        return None


def normalise_http_status(
    status: int,
    *,
    url: str,
    body_excerpt: str = "",
    headers: Any = None,
    exchange: str = ExchangeId.BINANCE.value,
) -> NormalisedExchangeError:
    """Build a normalised error from a non-2xx HTTP response.

    ``body_excerpt`` is truncated by the caller. Venue error bodies are short
    and diagnostically valuable, but an unbounded body in a log line is not.
    """
    category = category_for_http_status(status)
    venue_code: str | None = None
    venue_message: str | None = None

    # Binance error bodies look like {"code": -1121, "msg": "Invalid symbol."}.
    # Reading them turns an opaque 400 into an actionable message.
    if body_excerpt:
        try:
            decoded = json.loads(body_excerpt)
        except (json.JSONDecodeError, TypeError):
            decoded = None
        if isinstance(decoded, dict):
            if decoded.get("code") is not None:
                venue_code = str(decoded.get("code"))
            if decoded.get("msg") is not None:
                venue_message = str(decoded.get("msg"))

    return NormalisedExchangeError(
        category=category,
        message=(
            f"HTTP {status} from {_safe_url(url)}"
            + (f": {venue_message}" if venue_message else "")
        ),
        exchange=exchange,
        venue_code=venue_code,
        venue_message=venue_message,
        retry_after_millis=_retry_after_millis(headers),
        metadata={
            "httpStatus": status,
            "url": _safe_url(url),
            "bodyExcerpt": body_excerpt[:512],
        },
    )


def _safe_url(url: str) -> str:
    """Strip any query string before a URL reaches a log line.

    Public market-data requests carry no secrets, but this path is also the one
    a future signed endpoint would travel, and a logged ``signature=`` query
    parameter is not a mistake worth leaving available.
    """
    return url.split("?", 1)[0]


def normalise_network_exception(
    exc: BaseException,
    *,
    context: str,
    exchange: str = ExchangeId.BINANCE.value,
) -> NormalisedExchangeError:
    """Convert any transport exception into the platform vocabulary.

    Deliberately duck-typed on class names rather than importing ``httpx`` and
    ``websockets``. This module is imported by code paths that may only have one
    of the two installed, and an import error here would turn a recoverable
    network fault into a crash.
    """
    if isinstance(exc, NormalisedExchangeError):
        return exc

    name = type(exc).__name__
    module = type(exc).__module__.split(".")[0]
    message = str(exc) or name

    category = ExchangeErrorCategory.UNKNOWN_ERROR
    retry_after: int | None = None

    if isinstance(exc, asyncio.TimeoutError) or "Timeout" in name:
        category = ExchangeErrorCategory.TIMEOUT
    elif isinstance(exc, ssl.SSLError) or "SSL" in name or "Certificate" in name:
        # A TLS failure is a network-layer problem, but it is also the shape a
        # man-in-the-middle would produce. It is retryable, never bypassed.
        category = ExchangeErrorCategory.NETWORK_ERROR
    elif isinstance(exc, (ConnectionError, OSError)):
        category = ExchangeErrorCategory.NETWORK_ERROR
    elif name in (
        "ConnectionClosed",
        "ConnectionClosedOK",
        "ConnectionClosedError",
        "ConnectError",
        "ReadError",
        "WriteError",
        "PoolTimeout",
        "NetworkError",
        "TransportError",
        "RemoteProtocolError",
    ):
        category = ExchangeErrorCategory.NETWORK_ERROR
    elif name in (
        "ProtocolError",
        "WebSocketProtocolError",
        "InvalidMessage",
        "InvalidHandshake",
        "InvalidHeader",
        "InvalidUpgrade",
        "PayloadTooBig",
        "DecodingError",
        "JSONDecodeError",
    ):
        category = ExchangeErrorCategory.EXCHANGE_ERROR
    elif name in ("InvalidURI", "InvalidStatus", "InvalidStatusCode"):
        # A handshake rejected by status: read the code if the library exposes
        # one, since 429 here means the venue is shedding connections.
        status = _status_from_exception(exc)
        if status is not None:
            category = category_for_http_status(status)
        else:
            category = ExchangeErrorCategory.EXCHANGE_ERROR
    elif name == "SecurityError":
        category = ExchangeErrorCategory.EXCHANGE_ERROR

    return NormalisedExchangeError(
        category=category,
        message=f"{context}: {name}: {message}",
        exchange=exchange,
        retry_after_millis=retry_after,
        metadata={
            "exceptionType": name,
            "exceptionModule": module,
            "context": context,
        },
    )


def _status_from_exception(exc: BaseException) -> int | None:
    """Best-effort HTTP status extraction from a handshake exception."""
    for attribute in ("status_code", "status"):
        value = getattr(exc, attribute, None)
        if isinstance(value, int):
            return value
    response = getattr(exc, "response", None)
    if response is not None:
        value = getattr(response, "status_code", None)
        if isinstance(value, int):
            return value
    return None
