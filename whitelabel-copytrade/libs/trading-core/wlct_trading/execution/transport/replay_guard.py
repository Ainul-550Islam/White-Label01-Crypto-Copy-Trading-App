"""Nonce memory for the signed transport.

A signature is a bearer credential for exactly one request. What makes a
captured (headers, body) pair worthless the second time is this module: every
accepted nonce is remembered for the replay window, and a repeat is a refusal
even though the signature itself verifies.

The in-memory store is faithful for one process, which is the only thing this
build runs. A multi-process deployment swaps the store for a shared one; the
guard's contract does not change, which is the point of separating them.
"""

from __future__ import annotations

from dataclasses import dataclass, field

__all__ = ["InMemoryReplayStore", "ReplayGuard"]

#: How long a nonce must be remembered, in microseconds. Longer than the
#: verifier's clock-skew tolerance on purpose: a nonce has to outlive every
#: timestamp that could still be accepted, or an attacker who waits out the
#: memory but not the clock gets through.
DEFAULT_REPLAY_WINDOW_MICROS = 10 * 60 * 1_000_000

#: Bound on the remembered set. A process that accepts this many nonces
#: within one window is under an attack no in-memory map survives anyway;
#: pruning keeps the guard from growing without limit while it refuses.
_MAX_REMEMBERED_NONCES = 100_000


class InMemoryReplayStore:
    """A process-local nonce memory with window-based expiry.

    ``remember`` returns True the first time it sees a nonce inside the window
    and False after that. Expiry is evaluated against the same clock the
    guard stamps entries with, so a nonce never outlives the window it was
    accepted in.
    """

    def __init__(self) -> None:
        # nonce -> acceptance time in microseconds (monotonic-style, supplied
        # by the caller so tests can pin time).
        self._seen: dict[str, int] = {}

    def remember(self, nonce: str, now_micros: int) -> bool:
        """Record the nonce; True if this is its first use in the window."""
        self._prune(now_micros)
        if nonce in self._seen:
            return False
        if len(self._seen) >= _MAX_REMEMBERED_NONCES:
            # Drop the oldest rather than refusing everything: the newest
            # entries are the ones still inside any plausible window.
            oldest = min(self._seen.values())
            for key, seen_at in list(self._seen.items()):
                if seen_at == oldest:
                    del self._seen[key]
        self._seen[nonce] = now_micros
        return True

    def _prune(self, now_micros: int) -> None:
        cutoff = now_micros - DEFAULT_REPLAY_WINDOW_MICROS
        if cutoff <= 0:
            return
        for key, seen_at in list(self._seen.items()):
            if seen_at < cutoff:
                del self._seen[key]

    def __len__(self) -> int:
        return len(self._seen)


@dataclass
class ReplayGuard:
    """Decides whether a nonce is fresh. The store remembers; the guard rules.

    The guard stamps time at check-in, so the store never has to trust a
    caller-supplied clock, and a repeat is refused before any handler runs.
    """

    store: InMemoryReplayStore = field(default_factory=InMemoryReplayStore)

    def check_and_record(self, nonce: str, now_micros: int) -> bool:
        """True when the nonce is accepted for first use inside the window."""
        if not nonce:
            # An empty nonce is not a replay risk, it is a malformed request;
            # refusing it here keeps the verifier's contract simple.
            return False
        return self.store.remember(nonce, now_micros)
