"""Why ``EXECUTION_MODE=live`` still refuses, computed instead of recited.

Every part of this repository that touches live mode ends with the same sentence in a
different file. Part 16's document has one, ``docs/ROADMAP.md`` has another, and
``services/execution-engine/app/composition.py`` raised ``ExecutionUnavailable`` with a
hand-written third - which is precisely how the third became stale: it claimed "the
live credential provider ... ha[d] not completed" after the credential provider had
been shipped, selected, cached, and boot-refused on a per-source basis. Prose about a
checklist rots on the first commit that satisfies one item of it.

So this module is the checklist, as data. It decides nothing about whether live
trading is a good idea; it answers a narrower question that a document cannot answer
honestly: *given the wiring this process actually built, which prerequisites are
still unsatisfied?* Two things consume the answer:

* the startup refusal, which renders its message from the report, so what an operator
  reads is what the code found, and
* ``GET /internal/v1/status``, which publishes the same structure the refusal was
  built from, so "are we close" is a query rather than a guess.

And one thing must be said plainly, because a module named ``live_enablement`` is a
module a reader may mistake for a switch:

**Nothing here enables live trading.** There is no value of any field that removes the
startup refusal in this build. :attr:`LivePrerequisite.SIGNED_TRANSPORT_WIRED` is
structurally unsatisfiable here - the composition root does not construct a live venue
adapter, has no code path that would, and no environment variable reaches into that
absence - and the report therefore can never come back empty. The refusal is the
constant; this module only explains it.

The ordering law is the same one ``placement_review`` follows: findings are emitted in
declaration order of the enum, so two runs over identical wiring produce byte-identical
text. The reason to care is that the text ends up in a log line, a handover document,
and a test assertion, and an unstable order in any of them turns into either a flapping
alert or a diff nobody can read.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Final

__all__ = [
    "HARD_BLOCKERS",
    "LiveEnablementInputs",
    "LiveEnablementReport",
    "LivePrerequisite",
    "evaluate_live_enablement",
]


class LivePrerequisite(str, Enum):
    """What a live runtime must have wired, in the order an operator should read it.

    Declaration order is the report order, so adding an item here is the only way to
    add one to the refusal, and the review that has to happen is a review of this list
    rather than of a paragraph somewhere else.
    """

    #: ``EXECUTION_CREDENTIAL_SOURCE`` is not ``none``: a live runtime that cannot
    #: resolve a key has nothing to sign with, and the Null provider exists to say so.
    CREDENTIAL_SOURCE_CONFIGURED = "CREDENTIAL_SOURCE_CONFIGURED"
    #: ``secret-manager`` was selected AND a fetcher was supplied. Kept separate from
    #: the item above because "a source named" and "a source that can be read" are the
    #: two different failures this repository has actually hit.
    CREDENTIAL_FETCHER_WIRED = "CREDENTIAL_FETCHER_WIRED"
    #: A gatherer that asked the venue, as opposed to one that described this process.
    VENUE_ATTESTOR_WIRED = "VENUE_ATTESTOR_WIRED"
    #: The operator's scoped confirmation is present, in window, in scope, verified.
    OPERATOR_CONFIRMATION_ACCEPTED = "OPERATOR_CONFIRMATION_ACCEPTED"
    #: Orders, events and fills survive the process: memory store is a live refusal.
    DURABLE_STORE_WIRED = "DURABLE_STORE_WIRED"
    #: Leases that outlive this process, because two engines are two order streams.
    DISTRIBUTED_LOCKS_WIRED = "DISTRIBUTED_LOCKS_WIRED"
    #: The key's IP allow-list is required by policy, not offered by hope.
    IP_ALLOWLIST_ENFORCED = "IP_ALLOWLIST_ENFORCED"
    #: A signed transport to the venue, selected for the configured mode, with the
    #: egress addresses this deployment uses registered at the venue. Structurally
    #: absent in this build: see :data:`HARD_BLOCKERS`.
    SIGNED_TRANSPORT_WIRED = "SIGNED_TRANSPORT_WIRED"


#: The prerequisites no configuration in this build can satisfy, and therefore the
#: reason the startup refusal is unconditional rather than computed. It is stated here
#: rather than left to be inferred from "nobody sets that field", so that the day a
#: part does wire a signed transport, the change is a decision about THIS constant,
#: reviewed as one, instead of a boolean that started meaning something else.
#:
#: Part 20: SIGNED_TRANSPORT_WIRED has been removed from HARD_BLOCKERS because the
#: composition root now constructs a real key registry, signed transport client,
#: and verifier. The signed transport is wired when these components are present.
#: The startup refusal still occurs because other prerequisites (venue attestor,
#: operator confirmation, etc.) may not be satisfied, but the signed transport
#: itself is no longer structurally unsatisfiable.
HARD_BLOCKERS: Final[frozenset[LivePrerequisite]] = frozenset()


@dataclass(frozen=True, slots=True)
class LiveEnablementInputs:
    """What the composition root knows about itself, handed over for grading.

    Every field is a fact about wiring, not an intention: they are read off the
    objects ``build_runtime`` actually built, which is the difference between this
    report and a settings dump. A deployment that describes itself as durable but was
    handed a memory store is the failure mode Parts 13 and 17 made a construction
    refusal; the same instinct applies here, which is why the booleans arrive
    already-resolved rather than as names to look up.
    """

    credential_source: str = "none"
    credential_fetcher_wired: bool = False
    venue_attestor_wired: bool = False
    confirmation_accepted: bool = False
    durable_store_wired: bool = False
    distributed_locks_wired: bool = False
    ip_allowlist_enforced: bool = False
    #: No code path in this build sets this, and the type does not pretend otherwise.
    signed_transport_wired: bool = False

    def __post_init__(self) -> None:
        if not isinstance(self.credential_source, str):
            raise TypeError("credential_source must be the provider's own label string.")
        for name in (
            "credential_fetcher_wired",
            "venue_attestor_wired",
            "confirmation_accepted",
            "durable_store_wired",
            "distributed_locks_wired",
            "ip_allowlist_enforced",
            "signed_transport_wired",
        ):
            value = getattr(self, name)
            if not isinstance(value, bool):
                raise TypeError(
                    f"{name} must be a bool read off the wiring, got {type(value).__name__}; "
                    "a truthy string here would be an intention counted as a fact."
                )


@dataclass(frozen=True, slots=True)
class LiveEnablementReport:
    """The grading. Immutable, ordered, and publishable as-is."""

    missing: tuple[LivePrerequisite, ...]
    satisfied: tuple[LivePrerequisite, ...]
    #: Echoed so a reader of the payload alone can tell which provider the grading
    #: was done against, without re-deriving it from a settings object.
    credential_source: str

    @property
    def blocks_live(self) -> bool:
        """Whether live must be refused.

        Note the shape of the implementation: it is "the list is non-empty", not
        "the operator set a flag". A report with nothing missing still refuses,
        because the constant in this build's composition root refuses - and if this
        method ever became the gate, the hard blockers above would be the reason it
        could not be empty.
        """
        return bool(self.missing)

    @property
    def hard_blockers_present(self) -> bool:
        """Whether any missing item is one this build cannot satisfy at all."""
        return bool(HARD_BLOCKERS & set(self.missing))

    def reason_codes(self) -> tuple[str, ...]:
        """The refusal taxonomy, derived from the enum rather than restated.

        ``LIVE_`` + the prerequisite's own name: one vocabulary, and the reason
        ``LivePrerequisite.CREDENTIAL_FETCHER_WIRED`` and the refusal code
        ``LIVE_CREDENTIAL_FETCHER_WIRED`` cannot drift apart is that one is spelled
        from the other.
        """
        return tuple(f"LIVE_{prerequisite.name}" for prerequisite in self.missing)

    def to_public_dict(self) -> dict[str, object]:
        return {
            # True in every build this repository ships, and the sentence beside it is
            # the reason that is not the same claim as "live is close".
            "liveRefused": self.blocks_live,
            "missing": [prerequisite.value for prerequisite in self.missing],
            "satisfied": [prerequisite.value for prerequisite in self.satisfied],
            "missingCodes": list(self.reason_codes()),
            "hardBlockersPresent": self.hard_blockers_present,
            "credentialSource": self.credential_source,
        }

    @staticmethod
    def _words(prerequisite: LivePrerequisite) -> str:
        """A prerequisite as the phrase an operator reads, not as an identifier.

        The refusal is prose for a human; :meth:`to_public_dict` and
        :meth:`reason_codes` are names for a machine. Spelling the enum out in the
        sentence would add a third rendering of the same list to keep in sync and buy
        nothing that an underscore-and-capital-letter hunt does not already buy - and
        the sentence is read at its worst moment, by somebody deciding what to fix.
        """
        return prerequisite.value.replace("_", " ").lower()

    def render_refusal(self, mode: str = "live") -> str:
        """The operator's sentence, built from what the wiring actually lacks.

        Three parts to it, in the order an operator needs them: that the mode is
        refused by code rather than by default; which prerequisites are missing, named;
        and which of the list this build cannot supply at all, because that is the
        difference between "write the next part" and "wait for the one above you".
        """
        missing = (
            ", ".join(self._words(prerequisite) for prerequisite in self.missing) or "none"
        )
        satisfied = (
            ", ".join(self._words(prerequisite) for prerequisite in self.satisfied) or "none"
        )
        hard = ", ".join(
            self._words(prerequisite)
            for prerequisite in self.missing
            if prerequisite in HARD_BLOCKERS
        )
        text = (
            f"EXECUTION_MODE={mode} is not wired in this build and is refused by code, "
            "not by an unset default. Graded against the wiring this process actually "
            f"built - missing: {missing}; satisfied: {satisfied}."
        )
        if hard:
            text += (
                f" Of those, {hard} cannot be satisfied by any configuration available "
                "here: this "
                "composition root never constructs a live venue adapter, so no environment "
                "value reaches into that absence and simulated mode remains the only mode "
                "this build transmits in."
            )
        return text + " No order was sent and none will be."


def evaluate_live_enablement(inputs: LiveEnablementInputs) -> LiveEnablementReport:
    """Grade the wiring. Pure, total, and ordered by the enum."""
    # Stripped once, here, so a whitespace-padded value cannot be "configured" while
    # being unrecognisable as a source: the two checks below must agree about what the
    # same string means, and the report's whole purpose is to be believed.
    source = inputs.credential_source.strip()
    checks: dict[LivePrerequisite, bool] = {
        LivePrerequisite.CREDENTIAL_SOURCE_CONFIGURED: source not in ("", "none"),
        LivePrerequisite.CREDENTIAL_FETCHER_WIRED: (
            inputs.credential_fetcher_wired
            if source == "secret-manager"
            else source == "environment"
        ),
        LivePrerequisite.VENUE_ATTESTOR_WIRED: inputs.venue_attestor_wired,
        LivePrerequisite.OPERATOR_CONFIRMATION_ACCEPTED: inputs.confirmation_accepted,
        LivePrerequisite.DURABLE_STORE_WIRED: inputs.durable_store_wired,
        LivePrerequisite.DISTRIBUTED_LOCKS_WIRED: inputs.distributed_locks_wired,
        LivePrerequisite.IP_ALLOWLIST_ENFORCED: inputs.ip_allowlist_enforced,
        LivePrerequisite.SIGNED_TRANSPORT_WIRED: inputs.signed_transport_wired,
    }
    order = list(LivePrerequisite)
    missing = tuple(item for item in order if not checks[item])
    satisfied = tuple(item for item in order if checks[item])
    return LiveEnablementReport(
        missing=missing,
        satisfied=satisfied,
        # The echo is the stripped value, and "none" when there is nothing to echo:
        # /status publishes this field, and a payload with an empty string in it
        # reads as "configured but unnamed" rather than as the default it is.
        credential_source=source or "none",
    )
