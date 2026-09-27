"""The client-side instrument for the signed transport.

Follows the Part 18 instrument law the rest of the repo states for its
counters: cheap, monotone, read-only to everyone who did not produce it, and
inc() refuses a negative amount. Nothing here makes a decision - the client
carries the object so the composition root wires one instrument per process
and an exporter can read it without reaching into signing internals.
"""

from __future__ import annotations

from dataclasses import dataclass, field

__all__ = ["SignedTransportClientMetrics"]


@dataclass
class SignedTransportClientMetrics:
    """Cumulative counters for the signing side.

    ``signed`` counts successful signatures. ``refused`` counts the signings
    the client would not perform (no active key, bad body type, empty nonce).
    Both only ever move up; the reset hook exists for exporters that present
    deltas per scrape, not for decisions.
    """

    signed: int = 0
    refused: int = 0
    _extra: dict[str, int] = field(default_factory=dict)

    def inc_signed(self, amount: int = 1) -> None:
        if amount < 0:
            raise ValueError("signed counter refuses a negative amount")
        self.signed += amount

    def inc_refused(self, amount: int = 1) -> None:
        if amount < 0:
            raise ValueError("refused counter refuses a negative amount")
        self.refused += amount

    def reset(self) -> None:
        """Zero the counters (exporter-side delta support, not history loss:
        the exporter is expected to have scraped the previous value)."""
        self.signed = 0
        self.refused = 0
        self._extra.clear()

    def describe(self) -> dict[str, int]:
        return {
            "signed": self.signed,
            "refused": self.refused,
            **dict(sorted(self._extra.items())),
        }
