"""Binance signed-request construction.

Isolated here so that exactly one file in the repository knows how a Binance
signature is produced. The execution engine, the risk engine and every strategy
are written against ``TradingAdapter`` and have no idea this file exists.

The protocol, per Binance's published SIGNED (TRADE and USER_DATA) endpoint
specification:

* The signature is ``HMAC-SHA256(secret, payload)`` rendered as lowercase hex.
* The payload is the **exact query string / request body that is transmitted**,
  concatenated as ``queryString + requestBody`` when both are present.
* ``timestamp`` is required, in **milliseconds**.
* ``recvWindow`` is optional and caps how long the request stays valid; Binance
  rejects when ``timestamp < serverTime + 1000`` fails or when
  ``serverTime - timestamp > recvWindow``.
* ``signature`` is appended last and is itself never signed.
* The API key travels in the ``X-MBX-APIKEY`` header, never in the payload.

Two details cause most real-world signature failures and are handled explicitly:

1. **Parameter order must match between signing and sending.** Binance signs the
   literal string, not a canonicalised set, so if the HTTP client re-orders or
   re-encodes parameters the signature breaks. This module therefore produces
   the final encoded string itself and the caller must transmit it verbatim.
2. **Encoding must match too.** ``quote`` with ``safe=""`` is used so that every
   reserved character is percent-encoded identically in the signed string and
   the transmitted one.

Nothing here logs, and nothing here returns the secret. The signature is a
one-way function of it, and :class:`SignedRequest` redacts itself.
"""

from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Mapping, Sequence
from urllib.parse import quote

from wlct_trading.execution.credentials import REDACTED, ExchangeCredentials

__all__ = [
    "BINANCE_API_KEY_HEADER",
    "SignedRequest",
    "encode_params",
    "format_decimal",
    "binance_signature",
    "build_signed_request",
    "SignatureError",
]

BINANCE_API_KEY_HEADER = "X-MBX-APIKEY"


class SignatureError(Exception):
    """Raised when a request cannot be signed safely."""


def format_decimal(value: Decimal) -> str:
    """Render a Decimal the way an exchange expects.

    Plain notation always: ``1E-8`` is a valid Python repr and an invalid
    Binance quantity. Trailing zeros are stripped because they change the signed
    string without changing the value, and a mismatch between what the caller
    thinks it sent and what was signed is the single most common cause of a
    ``-1022 Signature for this request is not valid`` error.
    """
    if not isinstance(value, Decimal):  # pragma: no cover - defensive
        raise SignatureError(f"Expected Decimal, got {type(value).__name__}.")
    if value != value:  # NaN
        raise SignatureError("Cannot send a NaN quantity or price to an exchange.")
    if value.is_infinite():
        raise SignatureError("Cannot send an infinite quantity or price.")

    normalised = value.normalize()
    sign, digits, exponent = normalised.as_tuple()
    if isinstance(exponent, int) and exponent > 0:
        # normalize() renders 100 as 1E+2; expand it back.
        normalised = normalised.quantize(Decimal(1))
    text = format(normalised, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def _render(value: Any) -> str:
    """Convert one parameter value to its transmitted string form."""
    if isinstance(value, bool):
        # Binance expects the JSON-style lowercase spelling, not Python's True.
        return "true" if value else "false"
    if isinstance(value, Decimal):
        return format_decimal(value)
    if isinstance(value, float):
        raise SignatureError(
            "Refusing to send a float to an exchange: binary floating point "
            "cannot represent a price or quantity exactly. Use Decimal."
        )
    return str(value)


def encode_params(params: Sequence[tuple[str, Any]]) -> str:
    """Percent-encode an ordered parameter list into a query string.

    Order is preserved exactly as given, because the signature covers the
    literal string. ``safe=""`` forces every reserved character — including
    ``/``, ``:`` and ``+`` — to be encoded, matching what the HTTP client will
    transmit when handed the pre-encoded string.

    ``None`` values are dropped, which is what lets a caller pass an optional
    parameter unconditionally without perturbing the signature.
    """
    parts: list[str] = []
    for key, value in params:
        if value is None:
            continue
        parts.append(f"{quote(str(key), safe='')}={quote(_render(value), safe='')}")
    return "&".join(parts)


def binance_signature(secret: str, payload: str) -> str:
    """HMAC-SHA256 of ``payload`` under ``secret``, lowercase hex.

    A thin, deliberately boring wrapper. It exists as a named function so the
    signature algorithm has exactly one definition and one test.
    """
    return hmac.new(
        secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256
    ).hexdigest()


@dataclass(frozen=True)
class SignedRequest:
    """A fully prepared authenticated request.

    ``query`` already contains the signature and is the exact string that must
    be transmitted. The caller must **not** re-encode it or pass it through a
    parameter dict, or the signature will no longer match the payload.
    """

    method: str
    url: str
    query: str
    headers: Mapping[str, str]
    #: The signed payload, retained for diagnostics. Contains no secret: the
    #: secret is the HMAC key, never part of the message.
    signed_payload: str = ""
    #: Milliseconds. Kept so the caller can measure and report skew.
    timestamp_millis: int = 0

    @property
    def full_url(self) -> str:
        return f"{self.url}?{self.query}" if self.query else self.url

    def __repr__(self) -> str:
        # The API key lives in the headers, so headers are never rendered.
        return (
            f"SignedRequest(method={self.method!r}, url={self.url!r}, "
            f"headers={{{BINANCE_API_KEY_HEADER}: {REDACTED}}}, "
            f"query={REDACTED!r})"
        )

    __str__ = __repr__

    def to_log_fields(self) -> dict[str, object]:
        """Log-safe description.

        The query string is omitted in full: it carries the signature, and a
        logged signature plus a logged payload is a gift to anyone attempting an
        offline attack on the secret.
        """
        return {
            "method": self.method,
            "url": self.url,
            "timestampMillis": self.timestamp_millis,
            "signed": True,
            "query": REDACTED,
        }


def build_signed_request(
    *,
    method: str,
    base_url: str,
    path: str,
    params: Sequence[tuple[str, Any]],
    credentials: ExchangeCredentials,
    timestamp_millis: int,
    recv_window_millis: int | None = 5_000,
) -> SignedRequest:
    """Build a signed Binance REST request.

    ``params`` is an ordered sequence rather than a mapping so the caller
    controls the exact signed string. ``timestamp`` and ``recvWindow`` are
    appended here — in that order, immediately before ``signature`` — so every
    signed request in the codebase has an identical tail and a signature
    mismatch can never be caused by two call sites disagreeing about ordering.

    Raises :class:`SignatureError` rather than producing an unusable request.
    """
    upper_method = method.upper()
    if upper_method not in ("GET", "POST", "PUT", "DELETE"):
        raise SignatureError(f"Unsupported HTTP method {method!r}.")
    if not base_url.startswith("https://"):
        raise SignatureError(
            f"Refusing to sign a request to a non-TLS endpoint: {base_url!r}. "
            f"A signed request over plaintext exposes the signature and the key."
        )
    if timestamp_millis <= 0:
        raise SignatureError(
            "A signed request needs a positive millisecond timestamp. Synchronise "
            "with the exchange clock before signing."
        )
    if recv_window_millis is not None and not 0 < recv_window_millis <= 60_000:
        # Binance caps recvWindow at 60 000 ms and rejects anything larger.
        raise SignatureError(
            f"recvWindow must be between 1 and 60000 ms; got {recv_window_millis}."
        )

    ordered: list[tuple[str, Any]] = [
        (key, value) for key, value in params if value is not None
    ]
    for reserved in ("signature", "timestamp", "recvWindow"):
        if any(key == reserved for key, _value in ordered):
            raise SignatureError(
                f"{reserved!r} is added by the signer and must not be supplied by "
                f"the caller."
            )

    if recv_window_millis is not None:
        ordered.append(("recvWindow", recv_window_millis))
    ordered.append(("timestamp", timestamp_millis))

    payload = encode_params(ordered)
    signature = binance_signature(credentials.api_secret, payload)
    query = f"{payload}&signature={signature}" if payload else f"signature={signature}"

    return SignedRequest(
        method=upper_method,
        url=f"{base_url.rstrip('/')}{path}",
        query=query,
        headers={BINANCE_API_KEY_HEADER: credentials.api_key},
        signed_payload=payload,
        timestamp_millis=timestamp_millis,
    )


def build_keyed_request(
    *,
    method: str,
    base_url: str,
    path: str,
    params: Sequence[tuple[str, Any]] = (),
    credentials: ExchangeCredentials,
) -> SignedRequest:
    """Build a key-authenticated but *unsigned* request.

    Binance's USER_STREAM endpoints (listen key create/keepalive/close) take the
    API key header but no signature. Giving them their own builder keeps the
    signed path from growing an "optional signature" branch — the kind of branch
    that eventually gets taken by accident on an endpoint that needed signing.
    """
    upper_method = method.upper()
    if not base_url.startswith("https://"):
        raise SignatureError(
            f"Refusing to send an authenticated request to a non-TLS endpoint: "
            f"{base_url!r}."
        )
    query = encode_params(list(params))
    return SignedRequest(
        method=upper_method,
        url=f"{base_url.rstrip('/')}{path}",
        query=query,
        headers={BINANCE_API_KEY_HEADER: credentials.api_key},
        signed_payload="",
        timestamp_millis=0,
    )
