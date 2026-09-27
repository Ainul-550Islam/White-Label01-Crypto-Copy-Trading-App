"""The operator's confirmation that THIS deployment may place live orders.

Part 19 exists because a question in the live-enablement path had no typed answer.
The execution plane already asks a venue whether a key is entitled to place an order
(:mod:`wlct_trading.execution.placement_review`), and it already refuses
``EXECUTION_MODE=live`` at startup. What sat between those two facts was the
operator's own decision, and it was represented by one boolean:
``ExecutionSettings.live_trading_confirmed``.

A boolean is the wrong shape for a decision of this kind for four reasons, and this
module is built so that each of them is a refusal rather than a footnote:

* **A boolean has no subject.** ``True`` does not say which tenant, which account,
  which exchange, or which symbols the operator meant. A deployment that was
  confirmed for one account could not tell that it was being used for another.
* **A boolean has no expiry.** "Confirmed" read six months after a key rotation, a
  staff change, or an incident means whatever the reader needs it to mean.
* **A boolean has no integrity.** An environment variable can be flipped by the same
  person who flips ``EXECUTION_ENABLED``, and nothing downstream could tell a
  deliberate confirmation from a typo in a deployment template.
* **A boolean is not per-order.** The review runs for every order precisely so that
  one approved order cannot authorise an unrelated one; a confirmation that is not
  scoped to the order's identity would put that property back at zero.

So this module models a *record*: what was confirmed, for whom, until when, and with
what integrity. It is deliberately not a workflow, a ticket reference, or an approval
system - those are deployment concerns - and it is deliberately not a setting that
permits anything. The most a valid record can do here is decline to refuse. The
startup gate for live mode is unaffected: see :func:`wlct_trading.execution.live_enablement`
and the refusal in ``app/composition.py``, both of which still refuse.

THE LAWS THIS MODULE ENFORCES
-----------------------------

1. **Integrity before interpretation.** The digest is verified before a single field
   of the record is trusted, so a forged record cannot declare itself valid forever;
   a mismatch is one refusal with no detail beyond the field it could not verify.
2. **Absence is its own answer.** ``None`` is not "unconfirmed but proceed": the
   state ``ABSENT`` exists so that "nobody confirmed" is distinguishable from
   "confirmed and expired", which is distinguishable from "confirmed for somebody
   else". Those three have three different remedies, and a single False erases them.
3. **The record can only tighten.** It cannot widen the symbol set, extend its own
   expiry, or authorise an account that was not named in it. There is no field whose
   value relaxes another check.
4. **Nothing secret is in it, and nothing secret comes out.** The record names
   identities and windows; the HMAC key is supplied separately, read from the
   environment by the service, never stored on the record, never returned by
   ``describe()``, and never part of a refusal's detail string.
5. **Pure and replayable.** No clock, no I/O, no defaults for "now": every assessment
   takes ``now_micros``, the same discipline ``placement_review`` follows and the same
   reason - a confirmation that cannot be replayed for a timestamp cannot be audited.

WHAT A VALID RECORD DOES *NOT* MEAN
-----------------------------------

It is not permission to trade. A venue attestation, the eleven-gate safety set, the
kill switch, risk, and this build's refusal to wire a live transport all still stand
between a confirmation and an order. ``EXECUTION_MODE=live`` refuses at startup with
or without one, and the report that says so names this check as one of several
unsatisfied prerequisites rather than treating it as the last one.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from dataclasses import dataclass, field, replace
from enum import Enum
from typing import Final

__all__ = [
    "ConfirmationOutcome",
    "ConfirmationState",
    "ConfirmationVerifier",
    "FINGERPRINT_LENGTH",
    "LiveConfirmationError",
    "LiveOperatorConfirmation",
    "MAX_CONFIRMATION_WINDOW_MS",
    "MIN_NONCE_LENGTH",
    "SCOPE_UNBOUNDED",
    "canonical_confirmation_json",
]

#: The longest window a confirmation may stay valid on its own terms. A record that
#: outlives this is a standing order, not a confirmation, and standing orders are what
#: the expiry exists to prevent.
MAX_CONFIRMATION_WINDOW_MS: Final[int] = 90 * 24 * 60 * 60 * 1_000

#: A short nonce turns the digest into something an attacker cannot enumerate: the
#: HMAC is over the record's own content, and content with no entropy in it makes the
#: key guessable by trial. Sixteen hex characters is a floor, not a recommendation.
MIN_NONCE_LENGTH: Final[int] = 16

#: How much of the digest is published as a correlation handle. Enough to join an
#: audit line to a deployment, not enough to be useful offline.
FINGERPRINT_LENGTH: Final[int] = 12

#: The marker an empty ``symbols`` / ``order_types`` set carries in a description.
#: Kept as a constant because "unbounded" and "nothing" are one character apart in
#: JSON and a reader should never have to guess which one a deployment meant.
SCOPE_UNBOUNDED: Final[str] = "all-configured"

#: A SHA-256 digest in hex. Pinned as a constant because a record whose digest is the
#: wrong length is a truncated line, not a signature, and the check must not depend on
#: what the hash module happens to print.
SHA256_DIGEST_HEX_LENGTH: Final[int] = 64


class LiveConfirmationError(ValueError):
    """A confirmation that cannot be believed. Refused at construction."""


class ConfirmationState(str, Enum):
    """Every answer the assessment can give, and the only answers it can give.

    The names are the taxonomy an operator sees: a refusal that says
    ``OPERATOR_CONFIRMATION_EXPIRED`` tells them to re-run the ceremony, and one that
    says ``OPERATOR_CONFIRMATION_SCOPE_MISMATCH`` tells them to look at which account
    they pointed. A single ``False`` tells them nothing, which is why this enum exists
    before any bool does.
    """

    #: The deployment did not ask for a confirmation (no venue-backed runtime).
    NOT_REQUIRED = "NOT_REQUIRED"
    #: A confirmation was required and none was supplied.
    ABSENT = "ABSENT"
    #: Supplied, authenticated, and past ``expires_at_micros``.
    EXPIRED = "EXPIRED"
    #: Supplied, authenticated, and stamped to begin in the future. Either the clock
    #: or the ceremony is wrong, and neither is a licence to proceed.
    NOT_YET_VALID = "NOT_YET_VALID"
    #: Authenticated and in its window, but for a different deployment, account,
    #: tenant, exchange, symbol, or order type than the order being reviewed.
    SCOPE_MISMATCH = "SCOPE_MISMATCH"
    #: The digest does not match the content under the configured key: tampered,
    #: truncated, or signed with a key this deployment does not hold.
    UNVERIFIED = "UNVERIFIED"
    #: In window, in scope, and authenticated. The only state that adds no finding.
    VALID = "VALID"


def canonical_confirmation_json(record: "LiveOperatorConfirmation") -> str:
    """The exact bytes the digest is taken over.

    Sorted keys and fixed separators, for the reason ``placement_review`` gives for
    its own canonical form: the digest has to be reproducible from a stored audit line
    as well as from a live object, and ``json.dumps`` over a dict-of-``set`` is neither
    stable nor legal, so sets are sorted into lists first.
    """
    payload = {
        "instanceId": record.instance_id,
        "tenantId": record.tenant_id,
        "accountId": record.account_id,
        "exchange": record.exchange,
        "symbols": sorted(record.symbols),
        "orderTypes": sorted(record.order_types),
        "issuedAtMicros": record.issued_at_micros,
        "expiresAtMicros": record.expires_at_micros,
        "nonce": record.nonce,
    }
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


@dataclass(frozen=True, slots=True)
class LiveOperatorConfirmation:
    """An operator's scoped, time-boxed, authenticated statement.

    Identity fields are compared exactly as supplied (after trimming and, where the
    venue's own vocabulary applies, upper-casing), so a record cannot be matched by
    spelling it differently - the same normalisation law
    :class:`~wlct_trading.execution.placement_attestor.PlacementReviewRequest` follows.
    """

    #: The deployment this was minted for. Cross-deployment reuse - staging's
    #: confirmation driving production - is refused as a scope mismatch rather than
    #: as a configuration error, because it IS a configuration event with money
    #: attached and it deserves the louder label.
    instance_id: str
    tenant_id: str
    account_id: str
    exchange: str
    #: Empty means "every symbol this deployment's policy allows", never "no
    #: symbol"; see :data:`SCOPE_UNBOUNDED`.
    symbols: frozenset[str] = field(default_factory=frozenset)
    order_types: frozenset[str] = field(default_factory=frozenset)
    issued_at_micros: int = 0
    expires_at_micros: int = 0
    nonce: str = ""
    #: Hex HMAC-SHA256 over :func:`canonical_confirmation_json`. Empty until signed.
    digest: str = ""

    def __post_init__(self) -> None:
        for name in ("instance_id", "tenant_id", "account_id", "exchange"):
            value = getattr(self, name)
            if not isinstance(value, str) or not value.strip():
                raise LiveConfirmationError(f"{name} must be a non-blank string.")
            if len(value) > 255:
                raise LiveConfirmationError(f"{name} must be at most 255 characters.")
        for name, limit in (("symbols", 512), ("order_types", 64)):
            value = getattr(self, name)
            if not isinstance(value, frozenset):
                raise LiveConfirmationError(
                    f"{name} must be a frozenset of venue-vocabulary strings."
                )
            for item in value:
                if not isinstance(item, str) or not item.strip() or len(item) > limit:
                    raise LiveConfirmationError(
                        f"{name} entries must be non-blank strings of at most {limit} characters."
                    )
        for name in ("issued_at_micros", "expires_at_micros"):
            value = getattr(self, name)
            if isinstance(value, bool) or not isinstance(value, int):
                raise LiveConfirmationError(
                    f"{name} must be an int number of microseconds since the epoch, "
                    f"got {type(value).__name__}."
                )
            if value <= 0:
                raise LiveConfirmationError(f"{name} must be a positive epoch timestamp.")
        if self.expires_at_micros <= self.issued_at_micros:
            raise LiveConfirmationError(
                "expires_at_micros must be after issued_at_micros; a confirmation that "
                "ends before it begins is a typo with authority."
            )
        window_ms = (self.expires_at_micros - self.issued_at_micros) // 1_000
        if window_ms > MAX_CONFIRMATION_WINDOW_MS:
            raise LiveConfirmationError(
                f"the confirmation window is {window_ms} ms, above the "
                f"{MAX_CONFIRMATION_WINDOW_MS} ms ceiling; re-run the ceremony rather "
                "than minting a standing order."
            )
        if len(self.nonce) < MIN_NONCE_LENGTH:
            raise LiveConfirmationError(
                f"nonce must be at least {MIN_NONCE_LENGTH} characters; see the note on "
                "why the digest has to be infeasible to enumerate."
            )
        if self.digest and len(self.digest) != SHA256_DIGEST_HEX_LENGTH:
            raise LiveConfirmationError("digest must be a full SHA-256 hex digest or empty.")

    # -- integrity -------------------------------------------------------
    def canonical(self) -> str:
        return canonical_confirmation_json(self)

    def with_digest(self, key: str | bytes) -> "LiveOperatorConfirmation":
        """Return the record carrying the HMAC of its own content."""
        return replace(self, digest=compute_digest(self, key))

    def verifies(self, key: str | bytes) -> bool:
        """Constant-time comparison, so a refusal is not a timing oracle."""
        if not self.digest:
            return False
        return hmac.compare_digest(self.digest, compute_digest(self, key))

    @property
    def fingerprint(self) -> str:
        """A public correlation handle for an audit line: a prefix, never the MAC."""
        if not self.digest:
            return ""
        return self.digest[:FINGERPRINT_LENGTH]

    # -- wire ------------------------------------------------------------
    def to_payload(self) -> dict[str, object]:
        return {
            "instanceId": self.instance_id,
            "tenantId": self.tenant_id,
            "accountId": self.account_id,
            "exchange": self.exchange,
            "symbols": sorted(self.symbols),
            "orderTypes": sorted(self.order_types),
            "issuedAtMicros": self.issued_at_micros,
            "expiresAtMicros": self.expires_at_micros,
            "nonce": self.nonce,
            "digest": self.digest,
        }

    @classmethod
    def from_payload(cls, payload: dict[str, object]) -> "LiveOperatorConfirmation":
        """Parse a confirmation from configuration. Strict, and loudly so.

        Unknown keys are refused rather than dropped: a payload with a misspelled
        ``expriesAtMicros`` would otherwise arrive as "no expiry supplied", which is a
        permanent confirmation, which is the one outcome this type cannot be allowed to
        produce by accident.
        """
        expected = {
            "instanceId",
            "tenantId",
            "accountId",
            "exchange",
            "symbols",
            "orderTypes",
            "issuedAtMicros",
            "expiresAtMicros",
            "nonce",
            "digest",
        }
        unknown = sorted(set(payload) - expected)
        if unknown:
            raise LiveConfirmationError(
                f"unknown confirmation field(s): {', '.join(unknown)}. Refusing rather "
                "than ignoring them, because an ignored expiry field is an expiry that "
                "never expires."
            )
        try:
            missing = expected - set(payload)
            if missing:
                raise LiveConfirmationError(
                    f"missing confirmation field(s): {', '.join(sorted(missing))}"
                )
            return cls(
                instance_id=str(payload["instanceId"]),
                tenant_id=str(payload["tenantId"]),
                account_id=str(payload["accountId"]),
                exchange=str(payload["exchange"]).strip().upper(),
                symbols=frozenset(str(s).strip().upper() for s in _as_list(payload["symbols"])),
                order_types=frozenset(
                    str(o).strip().upper() for o in _as_list(payload["orderTypes"])
                ),
                issued_at_micros=_as_int(payload["issuedAtMicros"], "issuedAtMicros"),
                expires_at_micros=_as_int(payload["expiresAtMicros"], "expiresAtMicros"),
                nonce=str(payload["nonce"]),
                digest=str(payload["digest"]).strip().lower(),
            )
        except (TypeError, ValueError) as error:
            if isinstance(error, LiveConfirmationError):
                raise
            raise LiveConfirmationError(f"malformed confirmation payload: {error}") from None

    def describe(self) -> dict[str, object]:
        """What an operator may see about the confirmation. Never the key, never the MAC."""
        return {
            "present": True,
            "instanceId": self.instance_id,
            "tenantId": self.tenant_id,
            "accountId": self.account_id,
            "exchange": self.exchange,
            "symbols": sorted(self.symbols) or [SCOPE_UNBOUNDED],
            "orderTypes": sorted(self.order_types) or [SCOPE_UNBOUNDED],
            "issuedAtMicros": self.issued_at_micros,
            "expiresAtMicros": self.expires_at_micros,
            "fingerprint": self.fingerprint,
        }


def compute_digest(record: LiveOperatorConfirmation, key: str | bytes) -> str:
    secret = key.encode("utf-8") if isinstance(key, str) else key
    if not secret:
        raise LiveConfirmationError(
            "an empty HMAC key cannot sign a confirmation; configure the deployment's "
            "confirmation key or require no confirmation at all."
        )
    return hmac.new(secret, record.canonical().encode("utf-8"), hashlib.sha256).hexdigest()


def _as_list(value: object) -> list[object]:
    if value is None:
        return []
    if isinstance(value, (list, tuple, set, frozenset)):
        return list(value)
    raise LiveConfirmationError(f"expected a list, got {type(value).__name__}")


def _as_int(value: object, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise LiveConfirmationError(f"{name} must be an integer number of microseconds.")
    if isinstance(value, str):
        if not value.strip().lstrip("-").isdigit():
            raise LiveConfirmationError(f"{name} must be an integer, got {value!r}.")
        return int(value)
    return int(value)


@dataclass(frozen=True, slots=True)
class ConfirmationOutcome:
    """The assessment, typed. Carries the reason, and never the record's material."""

    state: ConfirmationState
    detail: str = ""
    #: The record that was assessed, when there was one. Kept so a caller can log a
    #: fingerprint without re-reading configuration; refused records are not attached,
    #: so a tampered payload cannot ride an audit line forward as if it were data.
    record: LiveOperatorConfirmation | None = None

    @property
    def accepted(self) -> bool:
        return self.state is ConfirmationState.VALID or self.state is ConfirmationState.NOT_REQUIRED

    @property
    def fingerprint(self) -> str:
        return self.record.fingerprint if self.record is not None else ""

    def to_dict(self) -> dict[str, object]:
        return {"state": self.state.value, "detail": self.detail, "accepted": self.accepted}


@dataclass(frozen=True, slots=True)
class ConfirmationVerifier:
    """The deployment's side of the check: what key, what identity, whether to require.

    Held by the placement reviewer and consulted once per order, because the whole
    point of scoping a confirmation to a symbol and an account is that the answer
    depends on the order being placed. The record itself may be absent: that is a
    state (``ABSENT``), not a construction error - the alternative would mean the
    simulated runtime this build ships could not assemble a reviewer at all.
    """

    record: LiveOperatorConfirmation | None = None
    #: The HMAC key. Read from the environment by the service; never logged, never
    #: serialised, and not part of ``describe()``.
    key: str = ""
    instance_id: str = ""
    exchange: str = ""
    required: bool = False

    def __post_init__(self) -> None:
        # Normalised here rather than at every comparison, and only these two: they
        # come from different subsystems (a deployment identifier and a venue enum)
        # whose spellings are not the record ceremony's to match, while tenant and
        # account identifiers are compared exactly as supplied because a tenant id is
        # an opaque string and "close enough" is not a thing for one.
        object.__setattr__(self, "instance_id", str(self.instance_id).strip())
        object.__setattr__(self, "exchange", str(self.exchange).strip().upper())
        if self.required and not self.key:
            raise LiveConfirmationError(
                "a required operator confirmation needs a verification key; refusing to "
                "build a verifier that would mark every record UNVERIFIED would be "
                "honest, but refusing here is what tells the operator which knob is "
                "missing before the first order is refused for it."
            )

    def assess(
        self,
        *,
        tenant_id: str,
        account_id: str,
        symbol: str,
        order_type: str,
        now_micros: int,
    ) -> ConfirmationOutcome:
        """The per-order assessment. The only entry point the review may use."""
        return self._assess(
            tenant_id=tenant_id,
            account_id=account_id,
            symbol=symbol,
            order_type=order_type,
            now_micros=now_micros,
        )

    def assess_deployment(
        self, *, tenant_id: str, account_id: str, now_micros: int
    ) -> ConfirmationOutcome:
        """The deployment-level half: integrity, identity and window, no order shape.

        This exists for one consumer, and the boundary is the point of naming it: the
        live-enablement report has to say something about the confirmation at startup,
        when there is no order whose symbol could be checked, and the alternative was a
        boot-time assessment that invented a symbol or ignored the scope. Both of those
        make "the deployment is confirmed" mean "some order would be", which is exactly
        the transferability this type refuses. So: same checks, minus the two that need
        an order, and this method is NEVER consulted by the review - a caller that uses
        it to release an order has bypassed the scope, not shortened it.
        """
        return self._assess(
            tenant_id=tenant_id,
            account_id=account_id,
            symbol=None,
            order_type=None,
            now_micros=now_micros,
        )

    def _assess(
        self,
        *,
        tenant_id: str,
        account_id: str,
        symbol: str | None,
        order_type: str | None,
        now_micros: int,
    ) -> ConfirmationOutcome:
        record = self.record
        if record is None:
            if not self.required:
                return ConfirmationOutcome(ConfirmationState.NOT_REQUIRED)
            return ConfirmationOutcome(
                ConfirmationState.ABSENT,
                "this deployment requires an operator confirmation for live placement "
                "and none was supplied; the remedy is the ceremony, not a setting",
            )
        if not record.verifies(self.key):
            return ConfirmationOutcome(
                ConfirmationState.UNVERIFIED,
                "the confirmation's digest does not match its content under this "
                "deployment's key: it was tampered with, truncated, or signed for "
                "another deployment",
            )
        if now_micros >= record.expires_at_micros:
            return ConfirmationOutcome(
                ConfirmationState.EXPIRED,
                f"the confirmation lapsed at {record.expires_at_micros} micros "
                f"(fingerprint {record.fingerprint or 'unset'})",
            )
        if now_micros < record.issued_at_micros:
            return ConfirmationOutcome(
                ConfirmationState.NOT_YET_VALID,
                "the confirmation is stamped to begin in the future; check this host's "
                "clock before assuming the ceremony was early",
            )
        for name, expected, actual in (
            ("instance", self.instance_id, record.instance_id),
            ("exchange", self.exchange, record.exchange),
            ("tenant", tenant_id, record.tenant_id),
            ("account", account_id, record.account_id),
        ):
            if expected and not hmac.compare_digest(str(expected), str(actual)):
                return ConfirmationOutcome(
                    ConfirmationState.SCOPE_MISMATCH,
                    f"the confirmation names {actual!r} for {name} and this runtime is "
                    f"{expected!r}; a confirmation is not transferable between identities",
                )
        if symbol is not None and record.symbols and symbol.strip().upper() not in record.symbols:
            return ConfirmationOutcome(
                ConfirmationState.SCOPE_MISMATCH,
                f"the confirmation covers {len(record.symbols)} symbol(s) and "
                f"{symbol!r} is not one of them",
            )
        if (
            order_type is not None
            and record.order_types
            and order_type.strip().upper() not in record.order_types
        ):
            return ConfirmationOutcome(
                ConfirmationState.SCOPE_MISMATCH,
                f"the confirmation covers {len(record.order_types)} order type(s) and "
                f"{order_type!r} is not one of them",
            )
        return ConfirmationOutcome(
            ConfirmationState.VALID,
            "scoped to {}/{} on {}{}".format(
                record.tenant_id,
                record.account_id,
                record.exchange,
                "" if symbol is None else " for this order shape",
            ),
            record,
        )

    def describe(self) -> dict[str, object]:
        """Presence and posture, plus the record's full scope.

        This is the view for a surface that may carry identities - a boot log, an
        authenticated operator command - because "which symbols were confirmed" is the
        question a scope-mismatch refusal exists to answer. For the surfaces that
        cannot know who is reading, use :meth:`public_summary`.
        """
        return {
            "required": self.required,
            "keyConfigured": bool(self.key),
            "record": None if self.record is None else self.record.describe(),
        }

    def public_summary(self) -> dict[str, object]:
        """The unauthenticated-safe view: posture and shape, no identities.

        ``/health/ready`` answers without a token - that is Part 13's deliberate
        design for an orchestrator that cannot hold credentials - and this service
        copies the placement block into it verbatim. A confirmation's scope names the
        tenants and accounts a deployment serves, which is nothing an anonymous probe
        needs and exactly what a reader with a legitimate question can get from the
        authenticated review endpoint. So: whether the check is on, whether it can
        verify anything, whether a record exists, when it lapses, and the
        fingerprint to correlate a refusal with the ceremony that produced it.
        """
        record = self.record
        return {
            "required": self.required,
            "keyConfigured": bool(self.key),
            "recordPresent": record is not None,
            "expiresAtMicros": 0 if record is None else record.expires_at_micros,
            "fingerprint": "" if record is None else record.fingerprint,
        }
