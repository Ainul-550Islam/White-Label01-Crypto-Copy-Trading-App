"""The verifying side of the signed transport.

Fail-closed in the order the evidence is cheapest to check and most fatal to
skip: key id known, timestamp inside the skew window, nonce not a replay,
signature byte-equal under constant time. Every failure is a refusal with a
reason the caller can log, and nothing about a failure is echoed back in a
form that would help an attacker tune a forgery.

The verifier never signs. Holding the same registry gives it the key material,
but the classes are separate so a code path that should verify cannot drift
into signing (and vice versa) by accident.
"""

from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass, field

from wlct_trading.clock import epoch_micros
from wlct_trading.execution.transport.client import (
    KEY_ID_HEADER,
    MAX_CLOCK_SKEW_MICROS,
    NONCE_HEADER,
    SIGNATURE_HEADER,
    TIMESTAMP_HEADER,
    canonical_request_line,
)
from wlct_trading.execution.transport.key_registry import RegisteredKey
from wlct_trading.execution.transport.key_registry import KeyRegistry
from wlct_trading.execution.transport.replay_guard import ReplayGuard

__all__ = [
    "VerificationDecision",
    "VerificationOutcome",
    "SignedTransportVerifier",
]


@dataclass(frozen=True)
class VerificationDecision:
    """What the transport refused and why, as data.

    ``reason`` is a stable machine code (``bad_key_id``, ``stale_timestamp``,
    ``replayed_nonce``, ``bad_signature``, ``bad_timestamp``,
    ``missing_headers``, ``empty_nonce``), not free text: an operator greps
    codes, and a reason that changes wording is an alert that stops firing.
    """

    accepted: bool
    reason: str | None = None
    key_id: str | None = None
    checked_at_micros: int = 0

    def to_dict(self) -> dict[str, object]:
        return {
            "accepted": self.accepted,
            "reason": self.reason,
            "keyId": self.key_id,
            "checkedAtMicros": self.checked_at_micros,
        }


@dataclass
class VerificationOutcome:
    """The decision plus the registry entry it resolved to (or None)."""

    decision: VerificationDecision
    key: RegisteredKey | None = field(default=None, repr=False)


class SignedTransportVerifier:
    """Accepts only what the client, over this registry, could have signed.

    ``verify`` takes the four transport headers and the raw body bytes. The
    timestamp is honoured when the caller pins it (tests); otherwise the
    verifier reads its own clock - a verifier that trusts a caller-supplied
    now is a verifier an attacker controls.
    """

    def __init__(
        self,
        registry: KeyRegistry,
        replay_guard: ReplayGuard | None = None,
        *,
        metrics: object | None = None,
    ) -> None:
        if registry is None:
            raise ValueError("SignedTransportVerifier requires a key registry")
        self._registry = registry
        self._replay = replay_guard if replay_guard is not None else ReplayGuard()
        self._metrics = metrics

    @property
    def algorithm(self) -> str:
        return self._registry.algorithm

    def verify(
        self,
        method: str,
        path: str,
        body: bytes | str,
        headers: dict[str, str],
        *,
        now_micros: int | None = None,
    ) -> VerificationOutcome:
        body_bytes = body.encode("utf-8") if isinstance(body, str) else bytes(body)
        checked_at = int(now_micros) if now_micros is not None else epoch_micros()

        def refused(reason: str, key_id: str | None = None) -> VerificationOutcome:
            return VerificationOutcome(
                decision=VerificationDecision(
                    accepted=False,
                    reason=reason,
                    key_id=key_id,
                    checked_at_micros=checked_at,
                ),
            )

        key_id = (headers.get(KEY_ID_HEADER) or "").strip()
        timestamp_raw = (headers.get(TIMESTAMP_HEADER) or "").strip()
        nonce = (headers.get(NONCE_HEADER) or "").strip()
        signature = (headers.get(SIGNATURE_HEADER) or "").strip().lower()

        if not key_id or not timestamp_raw or not nonce or not signature:
            return refused("missing_headers", key_id or None)

        key = self._registry.key_for(key_id)
        if key is None:
            return refused("bad_key_id", key_id)

        try:
            timestamp_micros = int(timestamp_raw)
        except ValueError:
            return refused("bad_timestamp", key_id)

        skew = abs(checked_at - timestamp_micros)
        if skew > MAX_CLOCK_SKEW_MICROS:
            return refused("stale_timestamp", key_id)

        if not self._replay.check_and_record(nonce, checked_at):
            return refused("replayed_nonce", key_id)

        line = canonical_request_line(method, path, timestamp_micros, nonce, body_bytes)
        expected = hmac.new(
            key.secret.encode("utf-8"),
            line.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(expected, signature):
            # compare_digest, not ==: a timing side channel on a signature
            # check is exactly the kind of shortcut this layer exists to close.
            return refused("bad_signature", key_id)

        return VerificationOutcome(
            decision=VerificationDecision(
                accepted=True,
                reason=None,
                key_id=key_id,
                checked_at_micros=checked_at,
            ),
            key=key,
        )

    def describe(self) -> dict[str, object]:
        return {
            "algorithm": self._registry.algorithm,
            "replayWindowNonces": len(getattr(self._replay, "store", ()) or ()),
        }
