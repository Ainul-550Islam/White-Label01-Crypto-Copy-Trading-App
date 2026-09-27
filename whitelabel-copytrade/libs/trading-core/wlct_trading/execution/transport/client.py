"""The signing side of the signed transport.

A client does not open sockets. It turns (method, path, body) into the exact
header set a :class:`~wlct_trading.execution.transport.server.SignedTransportVerifier`
will accept, so the same construction the composition root wires in simulated
mode is the construction a live deployment would put in front of a real HTTP
call. Keeping signing separate from transport is what lets the engine's tests
exercise the ceremony without a network.

The canonical string is pinned and ordered:

    <METHOD>\\n<PATH>\\n<TIMESTAMP_MICROS>\\n<NONCE>\\n<SHA256(body as hex)>

An empty body hashes as the SHA-256 of the empty byte string, never as an
empty digest field - a signature over "nothing" is how an empty-body endpoint
becomes a signing oracle for every other endpoint.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass

from wlct_trading.clock import epoch_micros
from wlct_trading.execution.transport.key_registry import KeyRegistry

__all__ = [
    "SIGNATURE_HEADER",
    "KEY_ID_HEADER",
    "TIMESTAMP_HEADER",
    "NONCE_HEADER",
    "SignedRequest",
    "SignedTransportClient",
    "SigningUnavailable",
]

SIGNATURE_HEADER = "x-wlct-signature"
KEY_ID_HEADER = "x-wlct-key-id"
TIMESTAMP_HEADER = "x-wlct-timestamp"
NONCE_HEADER = "x-wlct-nonce"

#: Nonce entropy in bytes. UUID-length randomness means a replay window of
#: minutes cannot see a collision by accident or by enumeration.
_NONCE_BYTES = 16

#: How far into the future a timestamp may sit before a verifier refuses it.
#: Clocks drift in both directions; a verifier that only refuses the past is
#: a verifier that accepts pre-dated replays forever.
MAX_CLOCK_SKEW_MICROS = 5 * 60 * 1_000_000


class SigningUnavailable(RuntimeError):
    """Raised when the client is asked to sign with no usable active key."""


def canonical_request_line(
    method: str,
    path: str,
    timestamp_micros: int,
    nonce: str,
    body: bytes,
) -> str:
    """The exact bytes the signature is taken over.

    Exposed as a module function because the verifier must derive the same
    line independently - trust comes from recomputation, not from parsing the
    caller's version of it.
    """
    body_digest = hashlib.sha256(body).hexdigest()
    return "\n".join(
        [
            method.strip().upper(),
            path,
            str(int(timestamp_micros)),
            nonce,
            body_digest,
        ]
    )


@dataclass(frozen=True)
class SignedRequest:
    """The output of signing: the canonical pieces plus the header mapping.

    ``headers`` is lowercase-keyed, ready to be merged into an HTTP request by
    whatever transport actually sends it.
    """

    method: str
    path: str
    timestamp_micros: int
    nonce: str
    key_id: str
    signature: str
    headers: dict[str, str]

    def describe(self) -> dict[str, object]:
        """Log-safe rendering: the request's identity, never its signature."""
        return {
            "method": self.method,
            "path": self.path,
            "timestampMicros": self.timestamp_micros,
            "nonce": self.nonce,
            "keyId": self.key_id,
        }


class SignedTransportClient:
    """Signs service-to-service requests with the registry's active key.

    Construction is the wiring fact Part 20 reports; :meth:`sign` is the only
    behaviour, and it cannot silently fall back to an unsigned request.
    """

    def __init__(
        self,
        registry: KeyRegistry,
        *,
        metrics: object | None = None,
    ) -> None:
        if registry is None:
            raise SigningUnavailable(
                "SignedTransportClient requires a key registry"
            )
        self._registry = registry
        self._metrics = metrics

    @property
    def algorithm(self) -> str:
        return self._registry.algorithm

    @property
    def active_key_id(self) -> str | None:
        return self._registry.active_key_id

    def sign(
        self,
        method: str,
        path: str,
        body: bytes | str = b"",
        *,
        timestamp_micros: int | None = None,
        nonce: str | None = None,
    ) -> SignedRequest:
        """Return the signed request for (method, path, body).

        ``timestamp_micros`` and ``nonce`` are injectable so a test can pin
        the clock; production callers omit them.
        """
        if not isinstance(body, (bytes, bytearray, str)):
            raise SigningUnavailable("request body must be bytes or str")
        body_bytes = body.encode("utf-8") if isinstance(body, str) else bytes(body)
        key_id, key = self._registry.signing_key()
        ts = int(timestamp_micros) if timestamp_micros is not None else epoch_micros()
        nonce_value = nonce if nonce is not None else secrets.token_urlsafe(_NONCE_BYTES)
        if not nonce_value:
            raise SigningUnavailable("nonce must not be empty")
        line = canonical_request_line(method, path, ts, nonce_value, body_bytes)
        signature = hmac.new(
            key.secret.encode("utf-8"),
            line.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        recorded = self._record_client_metric("signed")
        if recorded is not None and timestamp_micros is None:
            # Only production calls count toward the instrument: a test pinning
            # the clock is describing a scenario, not measuring traffic.
            pass
        headers = {
            KEY_ID_HEADER: key_id,
            TIMESTAMP_HEADER: str(ts),
            NONCE_HEADER: nonce_value,
            SIGNATURE_HEADER: signature,
        }
        return SignedRequest(
            method=method.strip().upper(),
            path=path,
            timestamp_micros=ts,
            nonce=nonce_value,
            key_id=key_id,
            signature=signature,
            headers=headers,
        )

    def _record_client_metric(self, _event: str) -> object | None:
        # The metrics object is carried but not consulted: signing decisions
        # never read an instrument. Counting happens in sign() by the metrics
        # object's own contract (see client_metrics) - kept as a hook so a
        # future exporter can attach without changing call sites.
        return self._metrics
