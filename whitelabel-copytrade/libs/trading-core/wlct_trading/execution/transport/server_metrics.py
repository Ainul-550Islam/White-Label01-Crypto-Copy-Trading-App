"""The server-side instrument for the signed transport.

Same law as the client instrument: cumulative, monotone, never consulted for
a decision. The refusal counter is split by reason because "the transport is
refusing" is an alertable fact and "which refusal" is the first question any
on-call will ask; the buckets are the stable decision codes, so an exporter
never has to parse free text.
"""

from __future__ import annotations

from dataclasses import dataclass, field

__all__ = ["SignedTransportServerMetrics"]

#: The stable refusal codes the verifier emits. Kept here (not imported from
#: the server module) so the metric's label set is a contract of its own: a
#: new code appearing in decisions shows up in describe() only after it is
#: added to this set deliberately.
REFUSAL_REASONS: tuple[str, ...] = (
    "missing_headers",
    "bad_key_id",
    "bad_timestamp",
    "stale_timestamp",
    "replayed_nonce",
    "bad_signature",
)


@dataclass
class SignedTransportServerMetrics:
    """Cumulative counters for the verifying side."""

    accepted: int = 0
    refused: int = 0
    by_reason: dict[str, int] = field(default_factory=dict)

    def inc_accepted(self, amount: int = 1) -> None:
        if amount < 0:
            raise ValueError("accepted counter refuses a negative amount")
        self.accepted += amount

    def inc_refused(self, reason: str, amount: int = 1) -> None:
        if amount < 0:
            raise ValueError("refused counter refuses a negative amount")
        if reason not in REFUSAL_REASONS:
            raise ValueError(f"unknown refusal reason: {reason!r}")
        self.refused += amount
        self.by_reason[reason] = self.by_reason.get(reason, 0) + amount

    def reset(self) -> None:
        self.accepted = 0
        self.refused = 0
        self.by_reason.clear()

    def describe(self) -> dict[str, object]:
        return {
            "accepted": self.accepted,
            "refused": self.refused,
            "byReason": {
                reason: self.by_reason.get(reason, 0)
                for reason in REFUSAL_REASONS
            },
        }
