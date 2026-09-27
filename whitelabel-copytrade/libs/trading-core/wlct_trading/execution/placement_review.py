"""The placement review: may THIS account place THIS order right now?

Part 16 exists because of four words in the execution plane's own composition
root: ``services/execution-engine/app/composition.py`` refuses
``EXECUTION_MODE=live`` with the reason "the live credential provider and the
authenticated order-placement review are unfinished". The safety gates already
answered "is the kill switch off, is risk healthy, does the key resolve and is
it safe to use". None of them answered the question a venue answers when it
returns ``-2015 invalid API key, IP, or permissions``: whether this key is
*entitled* to place this order, on this symbol, under this IP policy, with a
clock the signature window can survive, and with an attestation fresh enough to
be worth anything.

That is a different question from validation and a different question from risk,
and it is kept separate for the same reason the other two are:

* :mod:`wlct_trading.execution.validation` asks whether the order is *well
  formed* (symbol known, quantity legal, price on the tick grid).
* :mod:`wlct_trading.risk` asks whether the order is *prudent* (exposure,
  notional, rate, loss limits).
* This module asks whether we are *allowed and able* to place it: key
  entitlements, venue-reported account trading ability, IP allow-list state,
  key age, trading-authority expiry, symbol trading phase, per-symbol order
  type and time-in-force support, clock skew against the signature window,
  the age of the attestation itself, and - since Part 19 - whether a named
  operator authorised this scope within a window the deployment can verify
  (:mod:`wlct_trading.execution.live_confirmation`).

THE LAWS THIS MODULE ENFORCES
-----------------------------

1. **Absence outranks everything.** An unattested field never passes
   silently: "we did not look" and "we looked and it is fine" are different
   states, and only the second one is allowed to authorise money movement.
2. **The review can only tighten.** It never overrides a gate that already
   blocked, never waives a risk decision, and has no knob that permits a
   withdrawal-capable key - the non-custodial law lives in
   :class:`~wlct_trading.execution.credentials.ExchangeCredentials` and this
   module re-derives it rather than restating it as a setting.
3. **Staleness is a finding, not a shrug.** An attestation older than the
   policy's window blocks; an attestation stamped in the future blocks too,
   because a clock that runs backwards is not a clock, it is an incident.
4. **Live mode demands venue-backed attestation.** Facts gathered from local
   configuration describe what we *believe*; ``GET /sapi/v1/account/
   apiRestrictions`` and ``GET /api/v3/account`` describe what the venue will
   act on. In simulated mode a local attestation is enough and is labelled as
   such; in a transmitting runtime it blocks. There is no policy value that
   changes that, and the refusal to accept one is the point of the field.
5. **An unattested field is only a finding when a source that could answer it
   was consulted.** A paper runtime has no venue clock and no IP-allow-list to
   report; refusing every simulated order because ``ip_allowlist_enabled`` is
   unknown would train operators to switch the review off, which is worse than
   no review. Positive statements from any source always count; absence counts
   only against an attestation that claims to have asked - and for a
   transmitting runtime, law 4 has already refused it.
6. **Findings are structured, never scattered strings.** Every finding carries
   a code from a closed vocabulary, a severity, and the field it concerns.
   Codes are stable strings because they land in audit records, metric labels
   and this repository's handover documents.

DETERMINISM
-----------

This module is pure: no I/O, no driver, no network, and no default clock. Every
function that needs "now" takes it as a required argument, so a review can be
replayed for a timestamp and a verdict can be asserted in a test without
freezing anything. Its test file
(`tests/test_part16_placement_review.py`) pins that structurally: it scans this
module's syntax tree and fails if a time-carrying import appears, if a
``now_micros`` parameter grows a default, or if any statement could open a
socket.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from enum import Enum
from typing import Final

from wlct_trading.execution.live_confirmation import ConfirmationState

__all__ = [
    "ATTESTATION_WIRE_FIELDS",
    "MAX_ATTESTATION_AGE_MS",
    "MAX_CONFIRMATION_DETAIL_LENGTH",
    "MAX_CLOCK_SKEW_MS",
    "MAX_KEY_AGE_DAYS",
    "MIN_ATTESTATION_AGE_MS",
    "NO_KNOWN_WITHDRAWAL_PATH",
    "REVIEW_AREA_BY_CODE",
    "REVIEW_CODE_SEVERITY",
    "REVIEW_REQUIRED_AT",
    "RETRYABLE_REVIEW_CODES",
    "PlacementFacts",
    "PlacementAttestation",
    "PlacementReviewError",
    "PlacementReviewPolicy",
    "PlacementVerdict",
    "ReviewArea",
    "ReviewCode",
    "ReviewFinding",
    "ReviewSeverity",
    "attestation_from_payload",
    "attestation_to_payload",
    "evaluate_placement_attestation",
    "review_area_of",
    "severity_of",
    "VENUE_TRADING_FIELD",
    "VERDICT_CLAIM_WIRE_NAMES",
]

#: Longest accepted attestation age. One hour is already generous for a fact the
#: venue can change with a click in its console; a day would turn "we checked"
#: into "we once checked".
MAX_ATTESTATION_AGE_MS: Final[int] = 3_600_000
MIN_ATTESTATION_AGE_MS: Final[int] = 1_000

#: Bounds on the clock-skew allowance. The signature window is the hard limit
#: (Binance rejects outside ``recvWindow`` and caps it at 60 000 ms), so a skew
#: budget above the window is not a safety margin, it is a fiction.
MAX_CLOCK_SKEW_MS: Final[int] = 5_000

#: A key older than this must be rotated before it may trade. Binance's own
#: guidance for trading keys is "rotate regularly"; 365 days is the outer bound
#: at which "regularly" has plainly not happened, and deployments are expected to
#: run far tighter (the shipped default is 90).
MAX_KEY_AGE_DAYS: Final[int] = 365

#: The only age bound below is 1 day: a policy that blocks every key because it
#: demands rotation more than once a day is a policy that will be switched off,
#: and a switched-off review is worse than a modest one.
MIN_KEY_AGE_DAYS: Final[int] = 1


class ReviewCode(str, Enum):
    """Every reason the review can raise, and nothing else.

    A closed vocabulary is the whole point: ``"IP restriction looks off"`` and
    ``"ip allowlist not enabled"`` are the same finding to a human and two
    uncountable series to an operator. Codes that cannot be enumerated cannot be
    alerted on, so anything new has to be added here, in the open, with a
    severity in :data:`REVIEW_CODE_SEVERITY`.
    """

    # --- provenance of the attestation itself ---------------------------
    NO_ATTESTATION = "NO_ATTESTATION"
    STALE_ATTESTATION = "STALE_ATTESTATION"
    FUTURE_ATTESTATION = "FUTURE_ATTESTATION"
    VENUE_ATTESTATION_REQUIRED = "VENUE_ATTESTATION_REQUIRED"
    ATTESTATION_UNREACHABLE = "ATTESTATION_UNREACHABLE"
    ATTESTATION_RATE_LIMITED = "ATTESTATION_RATE_LIMITED"
    MALFORMED_VENUE_RESPONSE = "MALFORMED_VENUE_RESPONSE"
    #: The venue answered the *review's* own request with a rejection (an HTTP
    #: 401/403 on an authenticated metadata endpoint): the key exists but will
    #: not be talked to. Distinct from ``NO_SPOT_TRADE_PERMISSION``, which is an
    #: answer of "no" about trading - this one is a refusal to answer at all, and
    #: it is not retryable, because the fix is at the venue's key console.
    ATTESTATION_REFUSED_BY_VENUE = "ATTESTATION_REFUSED_BY_VENUE"

    # --- the key ---------------------------------------------------------
    CREDENTIAL_UNREADABLE = "CREDENTIAL_UNREADABLE"
    WITHDRAW_ENABLED = "WITHDRAW_ENABLED"
    NO_SPOT_TRADE_PERMISSION = "NO_SPOT_TRADE_PERMISSION"
    NO_READ_PERMISSION = "NO_READ_PERMISSION"
    KEY_TOO_OLD = "KEY_TOO_OLD"
    KEY_EXPIRED = "KEY_EXPIRED"
    TRADING_AUTHORITY_EXPIRED = "TRADING_AUTHORITY_EXPIRED"
    IP_ALLOWLIST_REQUIRED = "IP_ALLOWLIST_REQUIRED"

    # --- the account -----------------------------------------------------
    ACCOUNT_TRADING_DISABLED = "ACCOUNT_TRADING_DISABLED"
    ACCOUNT_TYPE_UNEXPECTED = "ACCOUNT_TYPE_UNEXPECTED"

    # --- the symbol ------------------------------------------------------
    SYMBOL_UNATTACHED = "SYMBOL_UNATTACHED"
    SYMBOL_NOT_TRADING = "SYMBOL_NOT_TRADING"
    ORDER_TYPE_UNSUPPORTED = "ORDER_TYPE_UNSUPPORTED"
    TIF_UNSUPPORTED = "TIF_UNSUPPORTED"

    # --- the clock -------------------------------------------------------
    CLOCK_UNSYNCHRONISED = "CLOCK_UNSYNCHRONISED"
    CLOCK_SKEW_EXCEEDED = "CLOCK_SKEW_EXCEEDED"
    RECV_WINDOW_INSUFFICIENT = "RECV_WINDOW_INSUFFICIENT"

    # --- the operator's confirmation -------------------------------------
    # Part 19. These describe the deployment's own statement that live placement
    # was authorised for this scope, which is a different fact from anything the
    # venue can answer: a venue will happily tell you a key may trade while the
    # human who owns that key has been on leave since the confirmation lapsed.
    OPERATOR_CONFIRMATION_ABSENT = "OPERATOR_CONFIRMATION_ABSENT"
    OPERATOR_CONFIRMATION_UNVERIFIED = "OPERATOR_CONFIRMATION_UNVERIFIED"
    OPERATOR_CONFIRMATION_EXPIRED = "OPERATOR_CONFIRMATION_EXPIRED"
    OPERATOR_CONFIRMATION_NOT_YET_VALID = "OPERATOR_CONFIRMATION_NOT_YET_VALID"
    OPERATOR_CONFIRMATION_SCOPE_MISMATCH = "OPERATOR_CONFIRMATION_SCOPE_MISMATCH"
    #: Emitted only when a confirmation was required and the assessment passed: a
    #: non-blocking record that the gate consulted the operator's statement for
    #: THIS order, so an audit line can distinguish "no finding" from "this
    #: particular assurance was actually evaluated".
    OPERATOR_CONFIRMATION_ACCEPTED = "OPERATOR_CONFIRMATION_ACCEPTED"


class ReviewSeverity(str, Enum):
    """How much a finding matters. Only BLOCKING stops a submission."""

    #: Recorded so an operator can see the review looked; never blocks.
    INFO = "INFO"
    #: Blocks nothing today, but is the thing that will block tomorrow.
    WARNING = "WARNING"
    #: The order does not go out.
    BLOCKING = "BLOCKING"


#: Severity by code. Codes absent from this table are treated as BLOCKING by
#: :func:`severity_of`, because forgetting to classify a new code must fail
#: closed: an unclassified finding that quietly becomes "informational" is how a
#: review becomes decoration.
_SEVERITY_OVERRIDES: Final[dict[ReviewCode, ReviewSeverity]] = {
    # Anything not listed here is BLOCKING. So the entries are exactly the
    # codes that are deliberately *not* fatal, and adding a code without adding
    # it here means it blocks - the failure mode a security review wants.
    ReviewCode.ATTESTATION_RATE_LIMITED: ReviewSeverity.WARNING,
    ReviewCode.NO_READ_PERMISSION: ReviewSeverity.WARNING,
    ReviewCode.ACCOUNT_TYPE_UNEXPECTED: ReviewSeverity.WARNING,
    # The only informational code in the confirmation group, and the informational
    # codes in this table share one property: they describe something an operator may
    # want to see and no order may depend on. A confirmation that PASSED is evidence
    # of consultation, not evidence of safety, and promoting it to blocking-adjacent
    # severity would make the audit line ambiguous.
    ReviewCode.OPERATOR_CONFIRMATION_ACCEPTED: ReviewSeverity.INFO,
}

REVIEW_CODE_SEVERITY: Final[dict[ReviewCode, ReviewSeverity]] = {
    code: _SEVERITY_OVERRIDES.get(code, ReviewSeverity.BLOCKING)
    for code in ReviewCode
}

#: Findings that mean "the answer is not no, the answer is not yet". A caller
#: may re-run the review; none of these says the order is unauthorised.
RETRYABLE_REVIEW_CODES: Final[frozenset[ReviewCode]] = frozenset(
    {
        ReviewCode.ATTESTATION_UNREACHABLE,
        ReviewCode.ATTESTATION_RATE_LIMITED,
        ReviewCode.STALE_ATTESTATION,
        ReviewCode.CLOCK_UNSYNCHRONISED,
        ReviewCode.MALFORMED_VENUE_RESPONSE,
    }
)

#: Deliberately absent from the set above, and worth naming because the omission is
#: an argument: a lapsed confirmation resolves when a human re-runs the ceremony, not
#: when the worker loops. Marking ``OPERATOR_CONFIRMATION_EXPIRED`` retryable would
#: convert a control into a cache with a time-to-live, and the retry path is exactly
#: where that mistake becomes invisible - the order stops erroring, the alert stops
#: firing, and the deployment trades on a confirmation nobody re-issued because
#: nothing was ever waiting for one. ``NOT_YET_VALID`` is excluded for the same
#: reason with the remedy moved upstream: the answer is "fix the clock", which is a
#: page, not a retry.



class ReviewArea(str, Enum):
    """Which question of the review a finding answers.

    The codes answer "what specifically is wrong"; this enum answers "which part of
    the enablement picture is unhealthy", and the difference matters because they are
    read by different people. An operator paged at 3am needs ``WITHDRAW_ENABLED``;
    the person deciding what to build next needs to know that ninety per cent of
    refusals are provenance, which no count of individual codes tells them.

    This is also the axis the live-enablement report
    (:mod:`wlct_trading.execution.live_enablement`) is organised by, which is the
    reason it lives next to the codes instead of being a view bolted onto the
    service: one vocabulary for "which part", derived from the same enum, so a new
    code cannot be counted in one place and not the other.
    """

    #: Did we gather evidence, and is it still current?
    PROVENANCE = "PROVENANCE"
    #: Is the key itself entitled, unexpired, unrestricted, and readable?
    CREDENTIAL = "CREDENTIAL"
    #: Is the account allowed to trade at all?
    ACCOUNT = "ACCOUNT"
    #: Is this symbol and this order shape tradable on it?
    SYMBOL = "SYMBOL"
    #: Can a signature made by this host survive the venue's window?
    CLOCK = "CLOCK"
    #: Did a human authorise this scope, in window, under this deployment's key?
    CONFIRMATION = "CONFIRMATION"
    #: A finding nobody classified. It exists so that an unclassified code shows up
    #: as itself in metrics instead of silently joining a neighbour's series.
    UNCLASSIFIED = "UNCLASSIFIED"


#: Area by code. Every member of :class:`ReviewCode` appears here; the test file
#: asserts that coverage, because the fallback for a missing entry is
#: :attr:`ReviewArea.UNCLASSIFIED` and an area axis with holes is an area axis that
#: quietly under-reports the newest checks - the newest checks being exactly the ones
#: somebody is watching.
REVIEW_AREA_BY_CODE: Final[dict[ReviewCode, ReviewArea]] = {
    ReviewCode.NO_ATTESTATION: ReviewArea.PROVENANCE,
    ReviewCode.STALE_ATTESTATION: ReviewArea.PROVENANCE,
    ReviewCode.FUTURE_ATTESTATION: ReviewArea.PROVENANCE,
    ReviewCode.VENUE_ATTESTATION_REQUIRED: ReviewArea.PROVENANCE,
    ReviewCode.ATTESTATION_UNREACHABLE: ReviewArea.PROVENANCE,
    ReviewCode.ATTESTATION_RATE_LIMITED: ReviewArea.PROVENANCE,
    ReviewCode.MALFORMED_VENUE_RESPONSE: ReviewArea.PROVENANCE,
    ReviewCode.ATTESTATION_REFUSED_BY_VENUE: ReviewArea.PROVENANCE,
    ReviewCode.CREDENTIAL_UNREADABLE: ReviewArea.CREDENTIAL,
    ReviewCode.WITHDRAW_ENABLED: ReviewArea.CREDENTIAL,
    ReviewCode.NO_SPOT_TRADE_PERMISSION: ReviewArea.CREDENTIAL,
    ReviewCode.NO_READ_PERMISSION: ReviewArea.CREDENTIAL,
    ReviewCode.KEY_TOO_OLD: ReviewArea.CREDENTIAL,
    ReviewCode.KEY_EXPIRED: ReviewArea.CREDENTIAL,
    ReviewCode.TRADING_AUTHORITY_EXPIRED: ReviewArea.CREDENTIAL,
    ReviewCode.IP_ALLOWLIST_REQUIRED: ReviewArea.CREDENTIAL,
    ReviewCode.ACCOUNT_TRADING_DISABLED: ReviewArea.ACCOUNT,
    ReviewCode.ACCOUNT_TYPE_UNEXPECTED: ReviewArea.ACCOUNT,
    ReviewCode.SYMBOL_UNATTACHED: ReviewArea.SYMBOL,
    ReviewCode.SYMBOL_NOT_TRADING: ReviewArea.SYMBOL,
    ReviewCode.ORDER_TYPE_UNSUPPORTED: ReviewArea.SYMBOL,
    ReviewCode.TIF_UNSUPPORTED: ReviewArea.SYMBOL,
    ReviewCode.CLOCK_UNSYNCHRONISED: ReviewArea.CLOCK,
    ReviewCode.CLOCK_SKEW_EXCEEDED: ReviewArea.CLOCK,
    ReviewCode.RECV_WINDOW_INSUFFICIENT: ReviewArea.CLOCK,
    ReviewCode.OPERATOR_CONFIRMATION_ABSENT: ReviewArea.CONFIRMATION,
    ReviewCode.OPERATOR_CONFIRMATION_UNVERIFIED: ReviewArea.CONFIRMATION,
    ReviewCode.OPERATOR_CONFIRMATION_EXPIRED: ReviewArea.CONFIRMATION,
    ReviewCode.OPERATOR_CONFIRMATION_NOT_YET_VALID: ReviewArea.CONFIRMATION,
    ReviewCode.OPERATOR_CONFIRMATION_SCOPE_MISMATCH: ReviewArea.CONFIRMATION,
    ReviewCode.OPERATOR_CONFIRMATION_ACCEPTED: ReviewArea.CONFIRMATION,
}


def review_area_of(code: ReviewCode | str) -> ReviewArea:
    """The area a finding belongs to, tolerating a plain string.

    Tolerating it is not leniency: ``ReviewFinding`` accepts a code as a string for
    the reason spelled out on :meth:`PlacementAttestation.__post_init__` - gatherers
    hand back what the venue handed them - and an area lookup that crashed on the
    same input would fail in the reporting path of a refusal, which is the worst
    place in this module to raise.
    """
    if isinstance(code, ReviewCode):
        return REVIEW_AREA_BY_CODE.get(code, ReviewArea.UNCLASSIFIED)
    try:
        return REVIEW_AREA_BY_CODE[ReviewCode(code)]
    except (ValueError, KeyError):
        return ReviewArea.UNCLASSIFIED



class PlacementReviewError(Exception):
    """A policy or fact object that cannot mean anything was constructed.

    Raised at construction, never during a review: a nonsensical configuration
    must fail the boot that created it, not the order that discovered it.
    """


# Names that live ONLY on a venue attestation. ``PlacementFacts`` keeps them as
# keyword-only fields whose defaults are computed here rather than spelled out
# twelve times, and :meth:`PlacementVerdict.to_event_payload` writes the payload
# using the same constants: the field name on an attestation and the key name on
# a durable audit event are the same string on purpose, and one module owns them.
# A payload field that cannot be parsed is a review that cannot be replayed, so
# the round-trip test that refuses unknown payload fields covers both.
REVIEW_REQUIRED_AT: Final[str] = "review_required_at_micros"
VENUE_TRADING_FIELD: Final[str] = "venue_trading_permitted"
NO_KNOWN_WITHDRAWAL_PATH: Final[str] = "no_known_withdrawal_path"

#: The audit-event spelling of the same three claims, keyed by the
#: ``PlacementFacts`` attribute they come from. Both spellings live in this one
#: dict because they must stay in step, and a test pins the keys against
#: ``PlacementVerdict``'s own fields so the mapping cannot name an attribute that
#: no longer exists.
VERDICT_CLAIM_WIRE_NAMES: Final[dict[str, str]] = {
    VENUE_TRADING_FIELD: "venueTradingPermitted",
    NO_KNOWN_WITHDRAWAL_PATH: "noKnownWithdrawalPath",
    REVIEW_REQUIRED_AT: "reviewRequiredAtMicros",
}


def severity_of(code: ReviewCode) -> ReviewSeverity:
    """The severity a code carries, defaulting to the safest answer."""
    return REVIEW_CODE_SEVERITY.get(code, ReviewSeverity.BLOCKING)


@dataclass(frozen=True, slots=True)
class ReviewFinding:
    """One reason, with a code and a severity."""

    code: ReviewCode
    message: str
    severity: ReviewSeverity
    field_name: str | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "code": self.code.value,
            "severity": self.severity.value,
            "message": self.message,
            "field": self.field_name,
        }


def _finding(
    code: ReviewCode,
    message: str,
    *,
    field_name: str | None = None,
) -> ReviewFinding:
    return ReviewFinding(
        code=code,
        message=message,
        severity=severity_of(code),
        field_name=field_name,
    )


@dataclass(frozen=True, slots=True)
class PlacementFacts:
    """What an attestation established, with ``None`` meaning "unknown".

    Every field is optional for one reason: a real venue response is partial.
    ``apiRestrictions`` does not report symbol trading phases, ``exchangeInfo``
    does not report key permissions, and a paper runtime reports neither. The
    review therefore reasons over what each source actually attests, and the
    absence of a fact is a finding rather than an assumption - law 1.

    Booleans are ``bool | None`` rather than defaulted to ``True``: a field that
    "defaults to allowed" would make an entire class of gatherer bugs
    unobservable, and the difference between "the venue says no" and "nobody
    asked" is the difference this module exists to keep.
    """

    # --- provenance ------------------------------------------------------
    #: True only when the facts came from the venue's own authenticated
    #: endpoints. Local configuration is not venue-backed, however tidy.
    venue_backed: bool = False
    #: Non-secret description of where the facts came from ("paper:in-process",
    #  "binance:apiRestrictions+account+exchangeInfo"). Surfaces in audit.
    source: str = "unspecified"

    # --- the key ---------------------------------------------------------
    #: Minutes the venue reports the key was created, epoch-based. ``None``
    #: when the venue does not say and nothing else attests it.
    key_created_at_millis: int | None = None
    key_expires_at_millis: int | None = None
    trading_authority_expires_at_millis: int | None = None
    key_permission_granted: bool | None = None
    withdrawal_permitted: bool | None = None
    read_permitted: bool | None = None
    ip_allowlist_enabled: bool | None = None

    # --- the account -----------------------------------------------------
    account_can_trade: bool | None = None
    account_type: str | None = None

    # --- the symbol ------------------------------------------------------
    symbol_attached: bool | None = None
    symbol_trading: bool | None = None
    #: Venue vocabulary, upper-cased: "LIMIT", "MARKET", ...
    order_type_supported: bool | None = None
    time_in_force_supported: bool | None = None

    # --- the clock -------------------------------------------------------
    #: Signed |local - venue| in milliseconds, or ``None`` when the clock was
    #: never synchronised. A signed value is stored as an absolute because the
    #: remedy (widen the window, or resynchronise) is the same in either
    #: direction; the sign belongs to the gatherer's log line, not the law.
    clock_skew_millis: int | None = None
    recv_window_millis: int | None = None

    # --- the operator's confirmation -------------------------------------
    # Not a venue fact: nothing Binance returns says a human authorised this
    # scope, so these two fields describe this deployment's own record. They are
    # carried on the facts object rather than passed as an argument because the
    # law is one pure function over the evidence, and because the same reason the
    # symbol fields live here applies: the reviewer knows the order being placed,
    # and the confirmation is assessed against THAT order, per order.
    #: The assessment. ``NOT_REQUIRED`` is the default so that a runtime that never
    #: asked for a confirmation reviews exactly as it did before Part 19 - the
    #: field's presence must not be a behavior change by itself.
    confirmation: ConfirmationState = ConfirmationState.NOT_REQUIRED
    #: The verifier's own sentence, for the finding's message. Truncated by whoever
    #: sets it, and never carrying secret material: a confirmation detail is a
    #: description of an identity mismatch, not a credential.
    confirmation_detail: str = ""

    # --- what this attestation established -------------------------------
    # The fields above are evidence; these three are what a gatherer is entitled
    # to *claim* it established from that evidence, and they are the payload a
    # durable audit line carries. They live here rather than being re-derived
    # from the evidence at read time for one reason: the claim must be made by
    # whoever held the venue's response, at the moment it was held. A reviewer
    # that recomputed "was trading permitted" later could reach a different answer
    # than the one the order was released on - and an audit trail that recomputes
    # its own conclusions is not an audit trail.
    #: The venue said this key may place orders on this symbol, in this
    #: account, right now. Nothing weaker sets this; an unattested review leaves
    #: it False even when the local policy looks permissive.
    venue_trading_permitted: bool = False
    #: Reading the other way round: the key cannot reach the assets it would
    #: move. Only ``key_permission_granted=False`` plus a venue-backed
    #: ``withdrawal_permitted=False`` earns it, so a missing field keeps it False.
    no_known_withdrawal_path: bool = False
    #: What "now" was when the review ran, so a reader can tell how stale the
    #: three claims above are without access to the attestor's cache.
    review_required_at_micros: int = 0


@dataclass(frozen=True, slots=True)
class PlacementReviewPolicy:
    """The thresholds a review is measured against. Nonsense is refused.

    Values are ``int`` milliseconds and days, deliberately unsigned-looking
    rather than ``float``: every bound here ends up in a comparison against a
    venue-provided integer, and a float that arrives from JSON is how a
    ``0.9999`` becomes a flapping gate.

    ``int``-not-``bool`` is enforced the same way the retention and enablement
    laws enforce theirs: ``True`` is an ``int`` in Python, so a caller that
    passes a flag where a window belongs gets a named refusal instead of a
    policy with a hidden meaning.
    """

    #: How old an attestation may be and still count. Bounded by
    #: ``MIN_ATTESTATION_AGE_MS``..``MAX_ATTESTATION_AGE_MS``.
    max_attestation_age_ms: int = 300_000
    #: Rotated-or-blocked. ``None`` disables the check, which is the one
    #: documented way to disable part of this review, and is only reachable for
    #: deployments that manage key rotation elsewhere (see the note on
    #: :data:`MAX_KEY_AGE_DAYS`).
    max_key_age_days: int | None = 90
    #: Signed skew tolerated between this process and the venue.
    max_clock_skew_ms: int = 1_000
    #: The signature window the gatherer will use. Kept here (not read from the
    #: adapter) so the law can check the window against the skew it tolerates.
    recv_window_ms: int = 5_000
    #: Require the venue to report an IP allow-list on the key. Default true:
    #: an unrestricted trading key is a stolen trading key.
    require_ip_allowlist: bool = True
    #: Require a verified operator confirmation for every order (Part 19).
    #:
    #: Default FALSE, and that default is a decision rather than an oversight. The
    #: review can only tighten, so a new check that defaults to on would change the
    #: verdict of every deployment that never asked for one - a silent behavior
    #: change in the one gate this repository treats as load-bearing. A deployment
    #: that wants the check turns it on and its composition root must then supply a
    #: verifier, which is why :func:`_confirmation_findings` refuses a
    #: ``NOT_REQUIRED`` answer when this flag is set: the flag and the wiring are
    #: allowed to disagree only in the direction that blocks.
    #:
    #: What this is NOT: a permission to trade live. The startup gate in
    #: ``ExecutionSettings._assert_wiring_is_safe`` and the composition root's
    #: refusal of ``EXECUTION_MODE=live`` are unaffected by it, in both directions.
    require_operator_confirmation: bool = False
    #: Extra headroom the window must leave over the tolerated skew, in
    #: milliseconds. A window equal to the measured skew passes today and fails
    #: on the next packet loss; two seconds of headroom is the convention this
    #: repo ships with.
    recv_window_headroom_ms: int = 2_000

    def __post_init__(self) -> None:
        for name in (
            "max_attestation_age_ms",
            "max_clock_skew_ms",
            "recv_window_ms",
            "recv_window_headroom_ms",
        ):
            value = getattr(self, name)
            if isinstance(value, bool) or not isinstance(value, int):
                raise PlacementReviewError(
                    f"{name} must be an int number of milliseconds, got "
                    f"{type(value).__name__}."
                )
        if isinstance(self.max_key_age_days, bool) or not isinstance(
            self.max_key_age_days, int | None
        ):
            raise PlacementReviewError(
                "max_key_age_days must be an int number of days or None, got "
                f"{type(self.max_key_age_days)!r}."
            )
        if not MIN_ATTESTATION_AGE_MS <= self.max_attestation_age_ms <= MAX_ATTESTATION_AGE_MS:
            raise PlacementReviewError(
                f"max_attestation_age_ms must be within "
                f"{MIN_ATTESTATION_AGE_MS}..{MAX_ATTESTATION_AGE_MS}; got "
                f"{self.max_attestation_age_ms}. Below one second every review "
                "is a coin flip; above an hour the venue's console has had "
                "time to change the answer."
            )
        if self.max_key_age_days is not None and not (
            MIN_KEY_AGE_DAYS <= self.max_key_age_days <= MAX_KEY_AGE_DAYS
        ):
            raise PlacementReviewError(
                f"max_key_age_days must be within {MIN_KEY_AGE_DAYS}.."
                f"{MAX_KEY_AGE_DAYS} or None; got {self.max_key_age_days}."
            )
        if self.max_clock_skew_ms < 0 or self.max_clock_skew_ms > MAX_CLOCK_SKEW_MS:
            raise PlacementReviewError(
                f"max_clock_skew_ms must be within 0..{MAX_CLOCK_SKEW_MS}; got "
                f"{self.max_clock_skew_ms}. Above that bound the venue's own "
                "signature window, not this policy, is what rejects the request."
            )
        if not 0 < self.recv_window_ms <= 60_000:
            raise PlacementReviewError(
                f"recv_window_ms must be within (0, 60000]; got "
                f"{self.recv_window_ms}. Binance's signed endpoints cap the "
                "window at 60000 ms and reject anything larger."
            )
        if self.recv_window_headroom_ms < 0:
            raise PlacementReviewError("recv_window_headroom_ms must not be negative.")
        # The two requirements are checked for TYPE as well as for value, which the
        # int bounds above already do for theirs: a policy assembled from JSON can
        # arrive holding the string "false", and a truthy string where a bool belongs
        # would turn "require an IP allowlist" into "require nothing" in the one
        # direction that fails open. Both names are checked together, so a third
        # requirement added later is covered by the loop rather than by memory.
        for name in ("require_ip_allowlist", "require_operator_confirmation"):
            if not isinstance(getattr(self, name), bool):
                raise PlacementReviewError(
                    f"{name} must be a bool, got "
                    f"{type(getattr(self, name)).__name__}; the review reads these as "
                    "requirements, and a non-bool has no honest reading."
                )

    def to_public_dict(self) -> dict[str, object]:
        """Config as an operator needs to SEE it, for ``/status`` and logs."""
        return {
            "maxAttestationAgeMillis": self.max_attestation_age_ms,
            "maxKeyAgeDays": self.max_key_age_days,
            "maxClockSkewMillis": self.max_clock_skew_ms,
            "recvWindowMillis": self.recv_window_ms,
            "requireIpAllowlist": self.require_ip_allowlist,
            "requireOperatorConfirmation": self.require_operator_confirmation,
            "recvWindowHeadroomMillis": self.recv_window_headroom_ms,
        }


@dataclass(frozen=True, slots=True)
class PlacementAttestation:
    """Facts plus the moment they were established.

    ``facts`` is never ``None`` and never empty-by-accident: an attestation that
    gathered nothing is expressed as all-``None`` facts with a finding code in
    ``collection_code``, which keeps "we tried and the venue was down"
    distinguishable from "we tried and the venue said no" distinguishable from
    "we did not try".
    """

    facts: PlacementFacts
    attested_at_micros: int
    #: Set when gathering itself failed; the facts are then empty and the code
    #: says why. This is the only field that carries a :class:`ReviewCode`
    #: directly, because the failure is a fact about the attestation rather than
    #: a verdict about the order.
    collection_code: ReviewCode | None = None
    #: Operator-facing detail for ``collection_code`` (exception type, HTTP
    #: status). Never contains a key, a signature or a body.
    collection_detail: str = ""

    def __post_init__(self) -> None:
        # The closed vocabulary is enforced here, where a gatherer's answer
        # enters the law, rather than deep inside ordering. ``collection_code``
        # arrives from adapters as a plain string about as often as it arrives
        # as the enum, and a bare string that survives to ``_ordered`` fails
        # there as an ``AttributeError`` on ``.value`` - a crash in the middle of
        # a refusal, on the path that runs precisely when the venue is already
        # misbehaving. A name outside the vocabulary is a defect in the
        # gatherer, and is raised as one rather than reported as a finding.
        # Typed as ``object`` on purpose: the annotated field is already
        # ``ReviewCode | None``, so mypy would (correctly) call the runtime
        # guards below unreachable, while at runtime they are the point.
        code: object = self.collection_code
        if code is None or isinstance(code, ReviewCode):
            return
        if isinstance(code, str):
            try:
                object.__setattr__(self, "collection_code", ReviewCode(code))
            except ValueError as error:
                known = ", ".join(sorted(member.value for member in ReviewCode))
                raise PlacementReviewError(
                    f"collection_code must be a ReviewCode or one of its "
                    f"values; {code!r} is neither. Known codes: {known}."
                ) from error
            return
        raise PlacementReviewError(
            f"collection_code must be a ReviewCode or None; got "
            f"{type(code).__name__}."
        )

    def age_micros(self, *, now_micros: int) -> int:
        return now_micros - self.attested_at_micros

    @staticmethod
    def unavailable(
        *,
        code: ReviewCode,
        detail: str,
        now_micros: int,
        source: str,
    ) -> "PlacementAttestation":
        """An attestation that says nothing, for a gatherer that failed.

        Constructed here rather than by callers so the "no facts" shape cannot be
        improvised differently in three places: the empty :class:`PlacementFacts`
        is what every law reads as "unknown", and ``venue_backed`` is False
        because a failed network call attests nothing.
        """
        return PlacementAttestation(
            facts=PlacementFacts(venue_backed=False, source=source),
            attested_at_micros=now_micros,
            collection_code=code,
            collection_detail=detail,
        )


@dataclass(frozen=True, slots=True)
class PlacementVerdict:
    """The review's answer. Immutable, JSON-ready, hashable.

    ``verdict_id`` is a digest of the canonical (findings, policy, facts)
    triple, so two identical reviews produce the same id and an audit trail can
    say "this order was refused by the same verdict that refused the previous
    nine" without comparing prose.
    """

    allowed: bool
    findings: tuple[ReviewFinding, ...] = field(default_factory=tuple)
    attested_at_micros: int = 0
    venue_backed: bool = False
    verdict_id: str = ""
    # The three things the review exists to establish, carried on the verdict so
    # an audit record can be read on its own terms: a reviewer that answers "you
    # may place" is exactly as important as one that answers "you may not", and
    # the payload below is what the durable order-event ledger stores. The names
    # come from this module's constants, which are the same strings
    # ``PlacementFacts`` uses for its fields, so there is no way for the
    # attestation and the audit line to drift apart.
    venue_trading_permitted: bool = False
    no_known_withdrawal_path: bool = False
    review_required_at_micros: int = 0

    @property
    def blocking_findings(self) -> tuple[ReviewFinding, ...]:
        return tuple(f for f in self.findings if f.severity is ReviewSeverity.BLOCKING)

    @property
    def codes(self) -> tuple[str, ...]:
        """Every code raised, in the deterministic order the law produced."""
        return tuple(f.code.value for f in self.findings)

    @property
    def blocking_codes(self) -> tuple[str, ...]:
        return tuple(f.code.value for f in self.blocking_findings)

    @property
    def retryable(self) -> bool:
        """Whether re-running the review is a sane next step.

        True only when every blocking finding is in
        :data:`RETRYABLE_REVIEW_CODES` - "the venue rate-limited us" invites a
        retry, "the key can withdraw" invites a human. A verdict with no blocking
        finding is not retryable, it is allowed, and letting ``retryable`` mean
        "allowed" here would let a caller retry a refusal forever.
        """
        blocking = self.blocking_findings
        if not blocking:
            return False
        return all(f.code in RETRYABLE_REVIEW_CODES for f in blocking)

    @property
    def summary(self) -> str:
        if self.allowed:
            basis = "venue-attested" if self.venue_backed else "locally attested"
            return f"Placement authorised ({basis})."
        first = self.blocking_findings[0]
        return f"Placement refused: {first.code.value} - {first.message}"

    @property
    def blocking_areas(self) -> tuple[ReviewArea, ...]:
        """Which parts of the review refused this order, deduplicated.

        Ordered by the enum's declaration rather than by severity or code, so the
        tuple is a stable key for a log line, a metric increment and a test
        assertion at the same time. ``UNCLASSIFIED`` is a legitimate value and is
        reported as such: an area count that hid it would hide exactly the finding
        that has not been classified yet.
        """
        seen: dict[ReviewArea, None] = {}
        for finding in self.blocking_findings:
            seen.setdefault(review_area_of(finding.code), None)
        return tuple(sorted(seen, key=lambda area: list(ReviewArea).index(area)))

    @property
    def area_counts(self) -> dict[str, int]:
        """Blocking findings per area, as ``{AREA: n}``.

        Counts, not booleans: "the confirmation area fired once" and "the credential
        area fired four times" are different operational pictures that a
        has-this-area-fired signal cannot tell apart.
        """
        counts: dict[str, int] = {}
        for finding in self.blocking_findings:
            key = review_area_of(finding.code).value
            counts[key] = counts.get(key, 0) + 1
        return counts

    @property
    def blocking_code_counts(self) -> dict[str, int]:
        """Blocking findings per code. The per-code view of the same evidence.

        A dict rather than a list because the consumer is a counter registry that has
        to look a code up, and a list there means a linear scan per finding per order -
        which is the kind of thing that only shows up as a problem when a refusal
        storm is also the busiest moment the process has.
        """
        counts: dict[str, int] = {}
        for finding in self.blocking_findings:
            key = finding.code.value
            counts[key] = counts.get(key, 0) + 1
        return counts

    def to_dict(self) -> dict[str, object]:
        return {
            "allowed": self.allowed,
            "blockingAreas": [area.value for area in self.blocking_areas],
            "verdictId": self.verdict_id,
            "attestedAtMicros": self.attested_at_micros,
            "venueBacked": self.venue_backed,
            "retryable": self.retryable,
            "summary": self.summary,
            "findings": [f.to_dict() for f in self.findings],
        }

    def to_event_payload(self) -> dict[str, str]:
        """The shape that goes into an ``OrderEvent.payload``.

        String-valued because the durable event ledger stores ``dict[str, str]``
        (the Part 13 store's own contract), and because a payload that can hold a
        number is a payload that will one day hold a quantity. Codes, a digest
        and booleans as words: nothing else.
        """
        payload: dict[str, str] = {
            "verdictId": self.verdict_id,
            "allowed": "true" if self.allowed else "false",
            "venueBacked": "true" if self.venue_backed else "false",
            "codes": ",".join(self.codes),
            "blockingCodes": ",".join(self.blocking_codes),
            "retryable": "true" if self.retryable else "false",
            "attestedAtMicros": str(self.attested_at_micros),
        }
        for field_name, wire_name in VERDICT_CLAIM_WIRE_NAMES.items():
            value = getattr(self, field_name)
            # Booleans become the words "true"/"false" and the timestamp becomes
            # digits - never ``str(True)``, which is "True". ``bool`` is a subclass
            # of ``int``, so the boolean test has to come first or the two cases
            # collapse; and a payload whose "yes" is spelled differently than its
            # sibling keys' is one an operator console will read as a "no".
            if isinstance(value, bool):
                payload[wire_name] = "true" if value else "false"
            else:
                payload[wire_name] = str(int(value))
        return payload


# ---------------------------------------------------------------------------
# The law
# ---------------------------------------------------------------------------


_SEVERITY_RANK: Final[dict[ReviewSeverity, int]] = {
    ReviewSeverity.BLOCKING: 0,
    ReviewSeverity.WARNING: 1,
    ReviewSeverity.INFO: 2,
}


def _ordered(findings: list[ReviewFinding]) -> tuple[ReviewFinding, ...]:
    """Sort by severity, then code, then field. Never by arrival order.

    A verdict whose findings shuffle between runs cannot be diffed, cannot be
    asserted in a test without set-compared noise, and makes the digest useless.
    """
    return tuple(
        sorted(
            findings,
            key=lambda f: (_SEVERITY_RANK[f.severity], f.code.value, f.field_name or ""),
        )
    )


def _canonical(
    *,
    findings: tuple[ReviewFinding, ...],
    policy: PlacementReviewPolicy,
    attestation: PlacementAttestation,
    requires_venue_attestation: bool,
) -> str:
    """The exact bytes a verdict id is digested from.

    Key-sorted and ASCII-stable so that two processes on two platforms produce
    the same digest for the same review. The attestation timestamp is included:
    a verdict id that ignored it would let a stale and a fresh approval share an
    id, which is precisely the confusion this field exists to prevent.
    """
    payload = {
        "findings": [f.to_dict() for f in findings],
        "policy": policy.to_public_dict(),
        "attestedAtMicros": attestation.attested_at_micros,
        "venueBacked": attestation.facts.venue_backed,
        "source": attestation.facts.source,
        "requiresVenueAttestation": requires_venue_attestation,
        "collectionCode": (
            None if attestation.collection_code is None else attestation.collection_code.value
        ),
    }
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _digest(canonical: str) -> str:
    """A short, copy-pasteable digest of the canonical form."""
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def _provenance_findings(
    attestation: PlacementAttestation,
    policy: PlacementReviewPolicy,
    *,
    requires_venue_attestation: bool,
    now_micros: int,
) -> list[ReviewFinding]:
    """How the attestation was obtained, and how long ago.

    Split out because this is the only group of findings that is about the
    *evidence* rather than about the account: a stale or improvised attestation
    says nothing about entitlements, and mixing the two makes "we could not
    tell" look like "the key is not allowed".
    """
    facts = attestation.facts
    findings: list[ReviewFinding] = []
    age_ms = (now_micros - attestation.attested_at_micros) // 1_000
    if age_ms < 0:
        findings.append(
            _finding(
                ReviewCode.FUTURE_ATTESTATION,
                f"The attestation is stamped {-age_ms} ms in the future. Either "
                "the gathering clock and this one disagree (which invalidates "
                "every age judgement made here) or the record was written by "
                "something other than the attestor.",
                field_name="attestedAtMicros",
            )
        )
    elif age_ms > policy.max_attestation_age_ms:
        findings.append(
            _finding(
                ReviewCode.STALE_ATTESTATION,
                f"The attestation is {age_ms // 1_000}s old, beyond the "
                f"policy's {policy.max_attestation_age_ms // 1_000}s window. A "
                "venue's console can revoke a key in one click; a review hours "
                "old is a history lesson.",
                field_name="attestedAtMicros",
            )
        )

    if not facts.venue_backed:
        # One code, two severities, decided by the runtime's mode rather than by
        # a config value: in a transmitting runtime "we believe" is not
        # evidence, and in a simulated runtime it is all the evidence there is -
        # and it is still written down, because an audit that silently omits
        # "this was simulated" is how paper results get read as real ones.
        if requires_venue_attestation:
            findings.append(
                ReviewFinding(
                    code=ReviewCode.VENUE_ATTESTATION_REQUIRED,
                    message=(
                        f"This runtime transmits orders, so facts from "
                        f"{facts.source!r} cannot authorise a submission: only "
                        "the venue's own authenticated answers can. Wire the "
                        "venue attestor, or run in simulated mode."
                    ),
                    severity=severity_of(ReviewCode.VENUE_ATTESTATION_REQUIRED),
                    field_name="venueBacked",
                )
            )
        else:
            findings.append(
                ReviewFinding(
                    code=ReviewCode.VENUE_ATTESTATION_REQUIRED,
                    message=(
                        f"Not venue-attested ({facts.source}); recorded, not "
                        "enforced, because this runtime does not transmit."
                    ),
                    severity=ReviewSeverity.INFO,
                    field_name="venueBacked",
                )
            )
    return findings


def _key_findings(
    facts: PlacementFacts,
    policy: PlacementReviewPolicy,
    now_micros: int,
) -> list[ReviewFinding]:
    """What the venue says about the key, and what the policy demands of it."""
    findings: list[ReviewFinding] = []

    if facts.key_permission_granted is False:
        findings.append(
            _finding(
                ReviewCode.NO_SPOT_TRADE_PERMISSION,
                "The venue reports that this key may not place spot orders. "
                "Enable trading on the key (or issue one that has it); the "
                "platform will not attempt the order to find out again.",
                field_name="keyPermissionGranted",
            )
        )
    elif facts.key_permission_granted is None and facts.venue_backed:
        # Only a venue-backed attestation can be asked this question, so only
        # its silence is evidence of anything (law 5).
        findings.append(
            _finding(
                ReviewCode.NO_SPOT_TRADE_PERMISSION,
                "The venue was consulted and did not answer whether this key "
                "may trade. That is a refusal: 'the venue says no' and 'nobody "
                "asked' must not collapse into the same audit line.",
                field_name="keyPermissionGranted",
            )
        )

    if facts.withdrawal_permitted is True or (
        facts.withdrawal_permitted is None and facts.venue_backed
    ):
        # The one place where silence counts even though a source exists: the
        # non-custodial rule is absolute, and "the venue was asked and did not
        # say the key cannot withdraw" is not a state to trade inside.
        # ExchangeCredentials.assert_safe raises on the positive case; this
        # closes the unknown case that module cannot see.
        findings.append(
            _finding(
                ReviewCode.WITHDRAW_ENABLED,
                (
                    "The venue reports this key may withdraw."
                    if facts.withdrawal_permitted
                    else "A venue-backed attestation does not say this key "
                    "cannot withdraw."
                )
                + " This platform is non-custodial and places no order on a key "
                "that could move funds off the exchange.",
                field_name="withdrawalPermitted",
            )
        )

    if facts.read_permitted is False:
        findings.append(
            _finding(
                ReviewCode.NO_READ_PERMISSION,
                "The key cannot read the account, so balances, open orders and "
                "fills cannot be reconciled from it. The venue still permits "
                "submission; a deployment that accepts one-sided "
                "reconciliation is allowed to trade, but it is recorded.",
                field_name="readPermitted",
            )
        )

    if policy.require_ip_allowlist and facts.ip_allowlist_enabled is False:
        findings.append(
            _finding(
                ReviewCode.IP_ALLOWLIST_REQUIRED,
                "The key is not IP-restricted. Any stolen copy of it trades "
                "from anywhere; bind it to this deployment's egress addresses.",
                field_name="ipAllowlistEnabled",
            )
        )
    elif (
        policy.require_ip_allowlist
        and facts.ip_allowlist_enabled is None
        and facts.venue_backed
    ):
        findings.append(
            _finding(
                ReviewCode.IP_ALLOWLIST_REQUIRED,
                "IP-restriction state is not attested, and the policy requires "
                "it. Gather the venue's key restrictions, or turn the "
                "requirement off with a documented reason.",
                field_name="ipAllowlistEnabled",
            )
        )

    if facts.key_expires_at_millis is not None and (
        facts.key_expires_at_millis * 1_000 <= now_micros
    ):
        findings.append(
            _finding(
                ReviewCode.KEY_EXPIRED,
                "The key's own expiry has passed. Rotate it at the venue and "
                "update the stored secret.",
                field_name="keyExpiresAtMillis",
            )
        )

    if facts.trading_authority_expires_at_millis is not None and (
        facts.trading_authority_expires_at_millis * 1_000 <= now_micros
    ):
        findings.append(
            _finding(
                ReviewCode.TRADING_AUTHORITY_EXPIRED,
                "The venue's trading authority for this key has expired, so "
                "orders are refused even while the key still signs correctly - "
                "the one failure that looks exactly like a network problem.",
                field_name="tradingAuthorityExpiresAtMillis",
            )
        )

    if policy.max_key_age_days is not None:
        created = facts.key_created_at_millis
        if created is None:
            if facts.venue_backed:
                # WARNING, not BLOCKING: a deployment that rotates on its own
                # schedule must not be locked out by a venue that reports no
                # creation time. The gap is recorded; the order goes out.
                findings.append(
                    ReviewFinding(
                        code=ReviewCode.KEY_TOO_OLD,
                        message=(
                            "Key creation time is not attested, so the "
                            f"{policy.max_key_age_days}-day rotation bound "
                            "cannot be checked. Recorded, not enforced."
                        ),
                        severity=ReviewSeverity.WARNING,
                        field_name="keyCreatedAtMillis",
                    )
                )
        else:
            age_days = (now_micros // 1_000 - created) // 86_400_000
            if age_days > policy.max_key_age_days:
                findings.append(
                    _finding(
                        ReviewCode.KEY_TOO_OLD,
                        f"The key is {age_days} days old, past the "
                        f"{policy.max_key_age_days}-day rotation bound. "
                        "Trading keys are the credential an operator forgets.",
                        field_name="keyCreatedAtMillis",
                    )
                )
    return findings


def _account_findings(facts: PlacementFacts) -> list[ReviewFinding]:
    """The account behind the key: a key can be valid and the account shut."""
    findings: list[ReviewFinding] = []
    if facts.account_can_trade is False:
        findings.append(
            _finding(
                ReviewCode.ACCOUNT_TRADING_DISABLED,
                "The account itself may not trade (the venue's canTrade). A "
                "key-level fix will not help; the account setting will.",
                field_name="accountCanTrade",
            )
        )
    if facts.account_type is not None and facts.account_type != "SPOT":
        findings.append(
            _finding(
                ReviewCode.ACCOUNT_TYPE_UNEXPECTED,
                f"The account type is {facts.account_type!r}; this platform "
                "trades spot only, and a non-spot account receiving spot "
                "orders is a wiring mistake worth seeing in an audit line "
                "rather than in a fill.",
                field_name="accountType",
            )
        )
    return findings


def _symbol_findings(facts: PlacementFacts) -> list[ReviewFinding]:
    """The venue's answer about the instrument, per order shape.

    This does NOT re-check lot size, tick size or min notional: those are
    :mod:`wlct_trading.execution.validation`'s job, run before the gates, and
    duplicating the arithmetic here would give the same order two opinions that
    can disagree. What belongs here is what validation cannot know without an
    authenticated venue call: the trading phase and the per-symbol capability
    lists.
    """
    findings: list[ReviewFinding] = []
    if facts.symbol_attached is False:
        findings.append(
            _finding(
                ReviewCode.SYMBOL_UNATTACHED,
                "The symbol is not listed on this venue, so nothing can be "
                "attested about it. Nothing was transmitted.",
                field_name="symbolAttached",
            )
        )
    if facts.symbol_trading is False:
        findings.append(
            _finding(
                ReviewCode.SYMBOL_NOT_TRADING,
                "The symbol exists but is not in the TRADING phase (HALT or "
                "BREAK), so an order now is refused or parked depending on the "
                "venue's schedule. The review refuses instead of finding out.",
                field_name="symbolTrading",
            )
        )
    if facts.order_type_supported is False:
        findings.append(
            _finding(
                ReviewCode.ORDER_TYPE_UNSUPPORTED,
                "This symbol does not accept the requested order type.",
                field_name="orderTypeSupported",
            )
        )
    if facts.time_in_force_supported is False:
        findings.append(
            _finding(
                ReviewCode.TIF_UNSUPPORTED,
                "This symbol does not accept the requested time-in-force.",
                field_name="timeInForceSupported",
            )
        )
    return findings


def _clock_findings(
    facts: PlacementFacts,
    policy: PlacementReviewPolicy,
) -> list[ReviewFinding]:
    """Skew against the signature window, which is the only clock fact that
    decides whether the venue will accept the request at all."""
    findings: list[ReviewFinding] = []
    skew = facts.clock_skew_millis
    if skew is None:
        if facts.venue_backed:
            findings.append(
                _finding(
                    ReviewCode.CLOCK_UNSYNCHRONISED,
                    "The venue clock was never synchronised, so the signature "
                    "window is being guessed at. Synchronise before trading: a "
                    "skewed host clock arrives as an unsigned -1021 at 3am with "
                    "no other symptom.",
                    field_name="clockSkewMillis",
                )
            )
    elif skew > policy.max_clock_skew_ms:
        findings.append(
            _finding(
                ReviewCode.CLOCK_SKEW_EXCEEDED,
                f"Measured skew is {skew} ms against a tolerance of "
                f"{policy.max_clock_skew_ms} ms. Correct the host clock rather "
                "than widening the window.",
                field_name="clockSkewMillis",
            )
        )
    if skew is not None:
        window = (
            policy.recv_window_ms
            if facts.recv_window_millis is None
            else facts.recv_window_millis
        )
        source = (
            "the policy's window"
            if facts.recv_window_millis is None
            else "the adapter's window"
        )
        if skew + policy.recv_window_headroom_ms > window:
            findings.append(
                _finding(
                    ReviewCode.RECV_WINDOW_INSUFFICIENT,
                    f"Skew of {skew} ms plus the required "
                    f"{policy.recv_window_headroom_ms} ms of headroom does not "
                    f"fit inside {source} ({window} ms). The venue's window "
                    "rejects this request before its signature is examined.",
                    field_name="recvWindowMillis",
                )
            )
    return findings


#: Confirmation state -> the code it earns. ``None`` means "no finding from this
#: state". Every member of :class:`~wlct_trading.execution.live_confirmation.ConfirmationState`
#: appears, and the test file asserts that it does, because a state that maps to
#: nothing is a silent pass - the single failure mode this whole layer exists to make
#: impossible.
_CONFIRMATION_CODES: Final[dict[ConfirmationState, ReviewCode | None]] = {
    ConfirmationState.NOT_REQUIRED: None,
    ConfirmationState.VALID: ReviewCode.OPERATOR_CONFIRMATION_ACCEPTED,
    ConfirmationState.ABSENT: ReviewCode.OPERATOR_CONFIRMATION_ABSENT,
    ConfirmationState.EXPIRED: ReviewCode.OPERATOR_CONFIRMATION_EXPIRED,
    ConfirmationState.NOT_YET_VALID: ReviewCode.OPERATOR_CONFIRMATION_NOT_YET_VALID,
    ConfirmationState.SCOPE_MISMATCH: ReviewCode.OPERATOR_CONFIRMATION_SCOPE_MISMATCH,
    ConfirmationState.UNVERIFIED: ReviewCode.OPERATOR_CONFIRMATION_UNVERIFIED,
}

#: Longest confirmation detail quoted into a finding. The detail is the verifier's
#: own sentence and is already secret-free; the cap is about log lines staying one
#: line, not about redaction.
MAX_CONFIRMATION_DETAIL_LENGTH: Final[int] = 240


def _confirmation_findings(
    facts: PlacementFacts,
    policy: PlacementReviewPolicy,
) -> list[ReviewFinding]:
    """The operator-confirmation sub-law.

    Two directions are deliberately asymmetric here:

    * **A policy that does not require a confirmation cannot rescue a refused one.**
      When ``require_operator_confirmation`` is False, an absent or unrequired
      confirmation raises nothing - but a record that came back EXPIRED,
      SCOPE_MISMATCH or UNVERIFIED still blocks. The flag decides whether the
      deployment must have a confirmation; it does not decide whether a broken one is
      acceptable, and treating those as one knob is how "we turned the check off for
      the test" becomes "we turned the check off" in the next quarter.
    * **A policy that requires one outranks a verifier that does not.** If the flag is
      set and the assessment still says NOT_REQUIRED, the wiring disagrees with the
      configuration, and the disagreement is reported as an absence rather than as a
      pass: an operator who set the flag and forgot the verifier has, in every
      practical sense, no confirmation.
    """
    state = facts.confirmation
    code = _CONFIRMATION_CODES[state]
    detail = facts.confirmation_detail[:MAX_CONFIRMATION_DETAIL_LENGTH]
    suffix = f" {detail}" if detail else ""

    if not policy.require_operator_confirmation:
        if state in (
            ConfirmationState.NOT_REQUIRED,
            ConfirmationState.ABSENT,
            ConfirmationState.VALID,
        ):
            return []
        # ``code`` is never None for a state that reaches here, and the fallback is
        # written anyway rather than being an assertion: this branch is the one that
        # runs for a refused record, and "the table forgot a state" must arrive as a
        # refusal, never as an exception inside a verdict.
        return [
            _finding(
                code if code is not None else ReviewCode.OPERATOR_CONFIRMATION_UNVERIFIED,
                "This deployment's policy does not require an operator confirmation, "
                "and the record it does have was refused anyway: a confirmation that "
                "fails verification is not made acceptable by nobody having asked for "
                f"one.{suffix}",
                field_name="confirmation",
            )
        ]

    if state is ConfirmationState.VALID:
        return [
            ReviewFinding(
                code=ReviewCode.OPERATOR_CONFIRMATION_ACCEPTED,
                message=(
                    "Operator confirmation verified for this deployment, account, "
                    f"symbol and order type, inside its window.{suffix}"
                ),
                severity=severity_of(ReviewCode.OPERATOR_CONFIRMATION_ACCEPTED),
                field_name="confirmation",
            )
        ]

    if code is None or state is ConfirmationState.NOT_REQUIRED:
        return [
            _finding(
                ReviewCode.OPERATOR_CONFIRMATION_ABSENT,
                "The policy requires an operator confirmation and the review received "
                "an assessment of NOT_REQUIRED, which means the verifier was built "
                "without the requirement it is supposed to enforce. That is a wiring "
                "fault, and it is refused here rather than at boot because a reviewer "
                "can be assembled by a caller this repository does not control.",
                field_name="confirmation",
            )
        ]

    return [
        _finding(
            code,
            f"The operator confirmation was refused ({state.value}).{suffix} Nothing "
            "was transmitted; the remedy is the ceremony, not a configuration change.",
            field_name="confirmation",
        )
    ]


def evaluate_placement_attestation(
    attestation: PlacementAttestation | None,
    policy: PlacementReviewPolicy,
    *,
    requires_venue_attestation: bool,
    now_micros: int,
) -> PlacementVerdict:
    """The whole law, in one pure function over six grouped sub-laws.

    ``requires_venue_attestation`` comes from the caller's mode
    (``ExecutionSettings.will_transmit_orders``), not from the policy, and that
    placement is deliberate: a policy tunes thresholds, while "did a venue
    attest this, or did we?" is a property of the runtime. A policy field for it
    would be a config knob that can switch the live guard off, which is the
    pattern every other guard in this repository refuses.

    Split into ``_*_findings`` helpers because a reviewer that must be auditable
    in one sitting cannot be a 300-line branch forest: each group answers one
    question, returns only findings, and is tested on its own.
    """
    if attestation is None:
        # The confirmation is assessed even here. An order refused for lack of
        # evidence must not also silently drop the operator's record, because the
        # two refusals have different remedies and an operator who is told only
        # about the first will fix it, retry, and be refused again by a check they
        # were never told about.
        return _verdict(
            findings=[
                _finding(
                    ReviewCode.NO_ATTESTATION,
                    "No placement attestation was gathered for this account and "
                    "symbol, and the review does not treat 'unknown' as "
                    "'allowed'. Run the attestor, or wire one into the runtime.",
                ),
                *_confirmation_findings(PlacementFacts(), policy),
            ],
            policy=policy,
            attestation=None,
            requires_venue_attestation=requires_venue_attestation,
            now_micros=now_micros,
        )

    if attestation.collection_code is not None:
        # A failed collection has no facts to reason over, and inventing a
        # finding per field for it would report "the key may not trade" when the
        # truth is "the venue was unreachable". One code, honestly labelled.
        #
        # The severity, however, is decided here rather than copied from the
        # table. Some collection failures are coded as warnings because the
        # *cause* is not an operator's fault - a 429 is a moment, not a
        # misconfiguration - and "warning" in this table means "does not refuse".
        # That reading is only safe for a runtime that does not need venue
        # evidence: for one that does, an ungathered attestation IS the refusal,
        # whatever its cause was, and letting a rate limit authorise a live order
        # would make the review's strongest law the one an outage switches off.
        # The code stays the true cause, so ``retryable`` keeps telling the
        # worker to try again instead of paging a human.
        code = attestation.collection_code
        severity = severity_of(code)
        # ``requires_venue_attestation`` decides, not the table: a runtime that
        # may transmit has no basis for an order until a venue answers, so every
        # evidence-absence code blocks it - including the ones the table marks as
        # warnings, because "the venue is rate-limiting us" is not a licence. A
        # runtime that cannot transmit records the same gap as INFO rather than
        # refusing: there is nothing at stake to protect, and the audit line is
        # what stops a simulated result being read as a real one. Entitlement
        # findings (a key that can withdraw, a symbol that is halted) keep
        # blocking in both, because those are not about evidence.
        if requires_venue_attestation:
            severity = ReviewSeverity.BLOCKING
        elif severity is ReviewSeverity.BLOCKING:
            severity = ReviewSeverity.INFO
        # A code the table already ranks as a warning keeps its rank in a
        # simulated runtime: "the venue is rate-limiting us" is information an
        # operator should still see as a warning, and quietly flattening every
        # collection outcome to INFO would erase the difference between "we never
        # asked" and "we asked and were told to back off".
        return _verdict(
            findings=[
                ReviewFinding(
                    code=code,
                    message=(
                        attestation.collection_detail
                        or "The attestation could not be gathered; nothing about "
                        "this account's entitlements is known."
                    )
                    + (
                        " This runtime transmits orders, so an unanswered review "
                        "is a refusal rather than a delay."
                        if requires_venue_attestation
                        else " Recorded, not enforced: this runtime cannot "
                        "transmit, so there is nothing for the gap to endanger."
                    ),
                    severity=severity,
                    field_name="collectionCode",
                ),
                # Same reason as the no-attestation path: an unreachable venue is not
                # a licence to stop reporting what the deployment itself got wrong.
                *_confirmation_findings(attestation.facts, policy),
            ],
            policy=policy,
            attestation=attestation,
            requires_venue_attestation=requires_venue_attestation,
            now_micros=now_micros,
        )

    findings: list[ReviewFinding] = []
    findings += _provenance_findings(
        attestation,
        policy,
        requires_venue_attestation=requires_venue_attestation,
        now_micros=now_micros,
    )
    findings += _key_findings(attestation.facts, policy, now_micros)
    findings += _account_findings(attestation.facts)
    findings += _symbol_findings(attestation.facts)
    findings += _clock_findings(attestation.facts, policy)
    # Last, and not because it matters less: the confirmation is the only sub-law
    # that reads nothing the venue said, so ordering it after the evidence keeps the
    # finding list reading as an investigation - what the venue reported, then what
    # we ourselves promised. ``_ordered`` re-sorts by code anyway, so this line
    # documents the sequence rather than depending on it.
    findings += _confirmation_findings(attestation.facts, policy)
    return _verdict(
        findings=findings,
        policy=policy,
        attestation=attestation,
        requires_venue_attestation=requires_venue_attestation,
        now_micros=now_micros,
    )


def _verdict(
    *,
    findings: list[ReviewFinding],
    policy: PlacementReviewPolicy,
    attestation: PlacementAttestation | None,
    requires_venue_attestation: bool,
    now_micros: int,
) -> PlacementVerdict:
    ordered = _ordered(findings)
    canonical = _canonical(
        findings=ordered,
        policy=policy,
        attestation=(
            attestation
            if attestation is not None
            else PlacementAttestation(
                facts=PlacementFacts(), attested_at_micros=now_micros
            )
        ),
        requires_venue_attestation=requires_venue_attestation,
    )
    return PlacementVerdict(
        allowed=not any(f.severity is ReviewSeverity.BLOCKING for f in ordered),
        findings=ordered,
        attested_at_micros=(0 if attestation is None else attestation.attested_at_micros),
        venue_backed=(False if attestation is None else attestation.facts.venue_backed),
        venue_trading_permitted=(
            False if attestation is None else attestation.facts.venue_trading_permitted
        ),
        no_known_withdrawal_path=(
            False if attestation is None else attestation.facts.no_known_withdrawal_path
        ),
        review_required_at_micros=(
            0 if attestation is None else attestation.facts.review_required_at_micros
        ),
        verdict_id=_digest(canonical),
    )


#: The fields a serialised attestation carries. Named once, here, so the wire
#: form and the law cannot drift apart: ``attestation_from_payload`` refuses any
#: key outside it, and the round-trip test asserts the two agree.
ATTESTATION_WIRE_FIELDS: Final[tuple[str, ...]] = (
    "venueBacked",
    "source",
    "keyCreatedAtMillis",
    "keyExpiresAtMillis",
    "tradingAuthorityExpiresAtMillis",
    "keyPermissionGranted",
    "withdrawalPermitted",
    "readPermitted",
    "ipAllowlistEnabled",
    "accountCanTrade",
    "accountType",
    "symbolAttached",
    "symbolTrading",
    "orderTypeSupported",
    "timeInForceSupported",
    "clockSkewMillis",
    "recvWindowMillis",
)


def attestation_to_payload(attestation: PlacementAttestation) -> dict[str, object]:
    """JSON-safe view of an attestation, for caching and for the audit payload.

    ``None`` stays ``None`` rather than becoming a default: this is the one
    place the "unknown" state is written down, and flattening it here would put
    the bug back where the law just removed it.
    """
    facts = attestation.facts
    return {
        "venueBacked": facts.venue_backed,
        "source": facts.source,
        "keyCreatedAtMillis": facts.key_created_at_millis,
        "keyExpiresAtMillis": facts.key_expires_at_millis,
        "tradingAuthorityExpiresAtMillis": facts.trading_authority_expires_at_millis,
        "keyPermissionGranted": facts.key_permission_granted,
        "withdrawalPermitted": facts.withdrawal_permitted,
        "readPermitted": facts.read_permitted,
        "ipAllowlistEnabled": facts.ip_allowlist_enabled,
        "accountCanTrade": facts.account_can_trade,
        "accountType": facts.account_type,
        "symbolAttached": facts.symbol_attached,
        "symbolTrading": facts.symbol_trading,
        "orderTypeSupported": facts.order_type_supported,
        "timeInForceSupported": facts.time_in_force_supported,
        "clockSkewMillis": facts.clock_skew_millis,
        "recvWindowMillis": facts.recv_window_millis,
        "attestedAtMicros": attestation.attested_at_micros,
        "collectionCode": (
            None if attestation.collection_code is None else attestation.collection_code.value
        ),
        "collectionDetail": attestation.collection_detail,
    }


def attestation_from_payload(payload: dict[str, object]) -> PlacementAttestation:
    """Rebuild an attestation from :func:`attestation_to_payload`'s output.

    Validated rather than trusted: an unknown key is refused, a value with the
    wrong type is refused, and an integer field that arrives as ``True`` is
    refused. The only caller that needs this is a cache or a replay, and a
    replayed attestation that quietly changed shape would be a review with a
    memory of facts it never had.
    """
    if not isinstance(payload, dict):
        raise PlacementReviewError(
            f"attestation payload must be a mapping, got {type(payload).__name__}."
        )
    known = {*ATTESTATION_WIRE_FIELDS, "attestedAtMicros", "collectionCode", "collectionDetail"}
    unexpected = sorted(set(payload) - known)
    if unexpected:
        raise PlacementReviewError(
            f"attestation payload carries unknown fields {unexpected}; refusing "
            "rather than ignoring evidence nobody declared."
        )

    def _opt_bool(name: str) -> bool | None:
        value = payload.get(name)
        if value is None:
            return None
        if not isinstance(value, bool):
            raise PlacementReviewError(f"{name} must be a bool or null.")
        return value

    def _opt_int(name: str) -> int | None:
        value = payload.get(name)
        if value is None:
            return None
        if isinstance(value, bool) or not isinstance(value, int):
            raise PlacementReviewError(f"{name} must be an int or null.")
        return value

    def _opt_str(name: str) -> str | None:
        value = payload.get(name)
        if value is None:
            return None
        if not isinstance(value, str):
            raise PlacementReviewError(f"{name} must be a string or null.")
        return value

    attested_at = _opt_int("attestedAtMicros")
    if attested_at is None:
        raise PlacementReviewError("attestedAtMicros is required.")
    collection = _opt_str("collectionCode")
    detail = payload.get("collectionDetail")
    if not isinstance(detail, str):
        raise PlacementReviewError("collectionDetail must be a string.")
    try:
        code = None if collection is None else ReviewCode(collection)
    except ValueError as error:
        raise PlacementReviewError(
            f"collectionCode {collection!r} is not a member of ReviewCode."
        ) from error

    return PlacementAttestation(
        facts=PlacementFacts(
            venue_backed=bool(payload.get("venueBacked", False)),
            source=_opt_str("source") or "unspecified",
            key_created_at_millis=_opt_int("keyCreatedAtMillis"),
            key_expires_at_millis=_opt_int("keyExpiresAtMillis"),
            trading_authority_expires_at_millis=_opt_int("tradingAuthorityExpiresAtMillis"),
            key_permission_granted=_opt_bool("keyPermissionGranted"),
            withdrawal_permitted=_opt_bool("withdrawalPermitted"),
            read_permitted=_opt_bool("readPermitted"),
            ip_allowlist_enabled=_opt_bool("ipAllowlistEnabled"),
            account_can_trade=_opt_bool("accountCanTrade"),
            account_type=_opt_str("accountType"),
            symbol_attached=_opt_bool("symbolAttached"),
            symbol_trading=_opt_bool("symbolTrading"),
            order_type_supported=_opt_bool("orderTypeSupported"),
            time_in_force_supported=_opt_bool("timeInForceSupported"),
            clock_skew_millis=_opt_int("clockSkewMillis"),
            recv_window_millis=_opt_int("recvWindowMillis"),
        ),
        attested_at_micros=attested_at,
        collection_code=code,
        collection_detail=detail,
    )
