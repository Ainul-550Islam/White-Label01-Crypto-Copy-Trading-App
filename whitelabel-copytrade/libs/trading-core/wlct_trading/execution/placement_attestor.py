"""Gathering the facts a placement review needs, and never raising about it.

:mod:`wlct_trading.execution.placement_review` is the law. This module is the
hand that fills in the law's inputs: it asks a provider for credential metadata,
asks an attestor for venue facts, evaluates the law, and hands the engine a
verdict. The separation is what lets the review be mandatory without letting an
outage become a trading outage:

* **A gatherer that throws is a gatherer that blocks trading.** Every exception
  from an attestor or a credential lookup is folded into an attestation whose
  :attr:`~wlct_trading.execution.placement_review.PlacementAttestation.collection_code`
  names what happened (unreachable, rate-limited, malformed). The verdict is
  then a refusal with a retryable finding - which is the truth - rather than a
  500 with no explanation, and rather than a pass, which would be fatal.
* **A cached miss is not a cached answer.** Attestations are reused for a bounded
  window so a burst of orders for one account is not a burst of venue requests:
  the review shares the venue's weight budget with the orders it protects. A
  gathered failure is cached too, for a shorter window, because hammering an
  endpoint that just returned 429 is how a 429 becomes a 418 that affects every
  tenant behind the same egress address.
* **The reviewer is the port the engine holds.** ``PlacementReviewer`` is what
  :class:`~wlct_trading.execution.engine.ExecutionEngine` and the safety gate
  consume, so a deployment can substitute its own gatherer (a custody provider,
  a compliance service) without touching the law.

Nothing here imports a driver, an HTTP client or a queue. The implementation
that needs the venue lives in
:mod:`wlct_trading.exchanges.binance.attestation`, which is the only module
where Binance endpoint names may appear.
"""

from __future__ import annotations

import dataclasses
import inspect
import logging
from abc import ABC, abstractmethod
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import ClassVar, Final

from wlct_trading.execution.credentials import (
    PERMISSION_READ,
    PERMISSION_SPOT_TRADE,
    PERMISSION_WITHDRAW,
)
from wlct_trading.adapters.base import (
    AdapterConnectionError,
    AdapterRateLimitedError,
)
from wlct_trading.clock import epoch_micros
from wlct_trading.adapters.base import AdapterRejectedError
from wlct_trading.execution.live_confirmation import (
    ConfirmationOutcome,
    ConfirmationState,
    ConfirmationVerifier,
    LiveConfirmationError,
)
from wlct_trading.execution.placement_review import (
    MAX_CONFIRMATION_DETAIL_LENGTH,
    PlacementAttestation,
    PlacementFacts,
    PlacementReviewError,
    PlacementReviewPolicy,
    PlacementVerdict,
    ReviewCode,
    evaluate_placement_attestation,
)

__all__ = [
    "DEFAULT_FAILURE_CACHE_SHARE",
    "MAX_ATTESTER_TTL_MS",
    "MIN_ATTESTER_TTL_MS",
    "AttestationFailure",
    "CachingPlacementAttestor",
    "LocalPlacementAttestor",
    "ConfirmationOutcome",
    "ConfirmationVerifier",
    "PlacementAttestation",
    "PlacementAttestor",
    "PlacementFacts",
    "PlacementReviewRequest",
    "PlacementReviewer",
    "SymbolEvidence",
    "SymbolFacts",
    "symbol_evidence",
    "UnattestedPlacementAttestor",
]

logger = logging.getLogger(__name__)

#: Bounds on how long a gathered attestation may be reused. The floor exists
#: because a TTL of zero means "one venue call per order", which the weight
#: budget will not survive; the ceiling is the review's own maximum attestation
#: window, so the cache can never be the reason a stale answer passes.
MIN_ATTESTER_TTL_MS: Final[int] = 1_000
MAX_ATTESTER_TTL_MS: Final[int] = 3_600_000

#: A failed gather is retried sooner than a success is refreshed: this fraction
#: of the success TTL, floored at the minimum. One fifth of five minutes is one
#: minute of patience with a venue having a bad minute.
DEFAULT_FAILURE_CACHE_SHARE: Final[float] = 0.2


class AttestationFailure(Exception):
    """A gatherer's own classification of why it has no answer.

    Carries the :class:`ReviewCode` rather than a message for the law to guess
    at: an attestor that knows it was rate-limited should say so, and the
    alternative - pattern matching on exception class names in this module -
    would be a contract that no type checker enforces.
    """

    def __init__(self, code: ReviewCode, detail: str = "") -> None:
        if not isinstance(code, ReviewCode):
            raise TypeError(
                f"AttestationFailure needs a ReviewCode, got {type(code).__name__}."
            )
        super().__init__(detail or code.value)
        self.code = code
        self.detail = detail or code.value


@dataclass(frozen=True, slots=True)
class PlacementReviewRequest:
    """What is being placed, for the parts of the review that are per-order.

    ``order_type`` and ``time_in_force`` are plain strings, not enums: the
    per-symbol capability lists are the venue's vocabulary, and a venue that
    renames ``STOP_LOSS_LIMIT`` must not be able to make a comparison fail to
    compile. Enum-to-venue-vocabulary mapping belongs to validation and the
    adapter, both of which run before this.
    """

    tenant_id: str
    account_id: str
    symbol: str
    order_type: str
    time_in_force: str

    #: Fields whose spelling the venue's own capability lists are compared
    #: against. Normalised once, here, so a request for ``limit`` and a request
    #: for ``LIMIT`` cannot produce two cache entries, two verdict digests and
    #: two audit lines for one question - and so a blank cannot reach a gatherer
    #: and come back as "symbol not found".
    _NORMALISED: ClassVar[tuple[str, ...]] = ("symbol", "order_type", "time_in_force")
    _LIMITS: ClassVar[dict[str, int]] = {
        "tenant_id": 255,
        "account_id": 255,
        "symbol": 64,
        "order_type": 32,
        "time_in_force": 32,
    }

    def __post_init__(self) -> None:
        for name in self._NORMALISED:
            object.__setattr__(self, name, str(getattr(self, name)).strip().upper())
        for name, limit in self._LIMITS.items():
            value = str(getattr(self, name))
            # ``strip`` here, not ``value``: the normalised fields have already
            # been stripped, but an identity field is deliberately left as the
            # caller wrote it - and "   " as a tenant id is exactly as blank as
            # "" is. Without the strip every misconfigured caller would share one
            # cache key and one audit line reading "tenant: " instead of failing
            # at the boundary where the mistake was made.
            if not value.strip():
                raise ValueError(f"{name} must not be blank")
            if len(value) > limit:
                raise ValueError(f"{name} must be at most {limit} characters")
            if any(ord(character) < 32 for character in value):
                # Control characters in an identifier mean a caller built this
                # from an unvalidated string, and the value is about to be
                # embedded in a log line, a cache key and an audit digest.
                raise ValueError(f"{name} must not contain control characters")

    def cache_key(self) -> tuple[str, ...]:
        """Per (tenant, account, symbol, order type, time-in-force).

        The two shape fields are in the key, and the first draft of this cache
        left them out on the theory that one gather per shape is one gather per
        order. That theory was wrong in a way worth stating: an attestation
        carries the symbol's capability lists *reduced to booleans for the shape
        that was asked about*, so a LIMIT/GTC gather reused for a STOP_LIMIT/IOC
        order would assert support the venue never granted for that shape - a
        coarse key here is not a performance choice, it is a fail-open. Sharding
        by shape still collapses what this cache exists to collapse, which is a
        burst of orders for one account: a copytrade fan-out is tens of orders
        across one or two shapes, not one shape per order.
        """
        return (
            self.tenant_id,
            self.account_id,
            self.symbol,
            self.order_type,
            self.time_in_force,
        )


class PlacementAttestor(ABC):
    """Turns a request into an attestation. Implementations do the I/O, if any."""

    @property
    @abstractmethod
    def source(self) -> str:
        """Non-secret provenance label, surfaced in verdicts and audit lines."""

    @abstractmethod
    async def attest(self, request: PlacementReviewRequest) -> PlacementAttestation:
        """Gather, or raise.

        Raising is allowed and expected - this is the seam where a venue call
        lives - because :class:`CachingPlacementAttestor` and
        :class:`PlacementReviewer` are what convert a raise into a finding. An
        implementation that would rather decide for itself returns
        :meth:`PlacementAttestation.unavailable` instead.
        """


class UnattestedPlacementAttestor(PlacementAttestor):
    """An attestor that attests nothing, on purpose.

    This is the shape of a runtime that has not wired a gatherer yet, and it is
    a class rather than ``None`` for a specific reason: "reviewer present, no
    evidence" and "no reviewer" must stay distinguishable in the audit and in
    ``/status``, and forgetting to configure an attestor must never look like
    configuring a permissive one.
    """

    __slots__ = ("_reason",)

    def __init__(self, reason: str = "no attestor configured") -> None:
        self._reason = reason

    @property
    def source(self) -> str:
        return "unattested"

    async def attest(self, request: PlacementReviewRequest) -> PlacementAttestation:
        return PlacementAttestation.unavailable(
            code=ReviewCode.NO_ATTESTATION,
            detail=f"Placement attestation was not gathered: {self._reason}.",
            now_micros=epoch_micros(),
            source=self.source,
        )


#: What a symbol table can say about one instrument: (listed, trading,
#: order types, time-in-forces). A tuple rather than a venue type so the paper
#: adapter, a real registry and a test stub can all supply it.
SymbolFacts = tuple[bool, bool, Sequence[str], Sequence[str]]


@dataclass(frozen=True, slots=True)
class SymbolEvidence:
    """What a symbol table establishes about one instrument, as review fields."""

    symbol_attached: bool
    symbol_trading: bool
    order_type_supported: bool | None
    time_in_force_supported: bool | None


def symbol_evidence(
    facts: SymbolFacts, *, order_type: str, time_in_force: str
) -> SymbolEvidence:
    """The four symbol fields of :class:`PlacementFacts`, from a symbol lookup.

    Shared with the venue gatherers deliberately: the local runtime and the
    Binance gatherer must not be able to disagree about what an empty capability
    list means, because the disagreement would show up as orders refused on one
    deployment and not the other.

    The rule worth reading twice: an *empty* list means "this source does not
    say", not "this symbol supports nothing". A venue payload that omits
    ``orderTypes``, and a stub that passes ``()``, therefore leave the fact
    unknown (``None``) rather than refusing every order - which is law 5 in the
    review module, applied at the place where the evidence is read. A non-empty
    list is an assertion, and membership decides it.
    """
    attached, trading, order_types, time_in_forces = facts
    types = {str(item).upper() for item in order_types}
    forces = {str(item).upper() for item in time_in_forces}
    return SymbolEvidence(
        symbol_attached=bool(attached),
        symbol_trading=bool(trading),
        order_type_supported=None if not types else order_type.upper() in types,
        time_in_force_supported=None if not forces else time_in_force.upper() in forces,
    )


class LocalPlacementAttestor(PlacementAttestor):
    """Facts from what this process already knows.

    ``venue_backed`` is False by construction, with no argument to change it:
    everything here comes from configuration this deployment wrote, which is
    exactly what a simulated runtime needs (no credentials, no network, no
    weight) and exactly what a transmitting runtime must not accept - law 4 in
    the review module enforces that half, and this class's refusal to claim
    otherwise is what makes the enforcement possible.

    ``resolve_credentials`` is injected as a callable rather than as a
    :class:`~wlct_trading.execution.credentials.CredentialProvider` so a
    deployment can hand the attestor a read-only view of key metadata without
    handing it the secret material; it may return ``None`` (no credential
    configured, which is normal for paper trading) or any object with the
    documented attributes.

    ``clock`` is injectable for the same reason the reviewer and the cache take
    one: every timestamp in this pipeline must come from the same place, so a
    test can freeze the whole chain instead of discovering that the gatherer
    stamped "now" from a real clock while the review compared it against a fixed
    one - which reads as an attestation that is 50 years stale and refuses
    deterministic orders forever.
    """

    __slots__ = (
        "_resolve_credentials",
        "_symbol_facts",
        "_skew_millis",
        "_source",
        "_clock",
    )

    def __init__(
        self,
        *,
        resolve_credentials: Callable[[str, str], object | None] | None = None,
        symbol_facts: Callable[[str], SymbolFacts | None] | None = None,
        skew_millis: Callable[[], int | None] | None = None,
        source: str = "local:in-process",
        clock: Callable[[], int] = epoch_micros,
    ) -> None:
        self._resolve_credentials = resolve_credentials
        self._symbol_facts = symbol_facts
        self._skew_millis = skew_millis
        self._source = source
        self._clock = clock

    @property
    def source(self) -> str:
        return self._source

    async def attest(self, request: PlacementReviewRequest) -> PlacementAttestation:
        now = self._clock()
        facts = PlacementFacts(venue_backed=False, source=self._source)
        if self._resolve_credentials is not None:
            facts = await self._facts_from_credentials(request, facts)
        if self._symbol_facts is not None:
            facts = self._facts_from_symbol(request, facts)
        if self._skew_millis is not None:
            skew = self._skew_millis()
            facts = dataclasses.replace(
                facts,
                clock_skew_millis=None if skew is None else abs(int(skew)),
            )
        # The three claims are set here rather than inside a sub-helper, because
        # they describe what THIS review established as a whole: a credential
        # lookup that failed still ran at a moment in time, and "when was the
        # review required" is the field that lets a reader judge every other
        # timestamp in the record. ``venue_trading_permitted`` stays False by
        # definition - this gatherer is not the venue, and law 4 already records
        # that as an INFO note or a refusal according to the runtime's mode.
        facts = dataclasses.replace(
            facts,
            review_required_at_micros=now,
            no_known_withdrawal_path=facts.withdrawal_permitted is False,
        )
        return PlacementAttestation(facts=facts, attested_at_micros=now)

    async def _facts_from_credentials(
        self, request: PlacementReviewRequest, base: PlacementFacts
    ) -> PlacementFacts:
        """Read only what the credential object itself declares.

        Attribute access is guarded because the injected callable may return any
        credential-shaped object - the paper runtime's, a deployment's wrapper, a
        test's stub. The attestor's contract is the facts it produces, not the
        class of its input. A lookup that raises is recorded as a warning and
        leaves the facts untouched: this module's whole job is to keep a failing
        helper out of the order path.

        The callable may be synchronous or return an awaitable, and both are
        awaited-if-needed rather than normalised by a wrapper the caller has to
        remember to build. That is because the platform's real
        :class:`~wlct_trading.execution.credentials.CredentialProvider` is async
        (a secret manager call is a network call), while a paper runtime's view of
        its own keys is a dict lookup; forcing one of them through an adapter
        would either make the test double pretend to be async or make production
        pretend its vault is local.
        """
        resolve = self._resolve_credentials
        if resolve is None:  # pragma: no cover - guarded by the caller
            return base
        try:
            credentials = resolve(request.tenant_id, request.account_id)
            if inspect.isawaitable(credentials):
                credentials = await credentials
        except Exception as error:  # folded into a log line
            logger.warning(
                "placement.attestation.credential_lookup_failed",
                extra={
                    "event": "placement.attestation.credential_lookup_failed",
                    "accountId": request.account_id,
                    "errorType": type(error).__name__,
                },
            )
            return base
        if credentials is None:
            return base
        declared = {str(permission).upper() for permission in _permissions_of(credentials)}
        expires = getattr(credentials, "expires_at_micros", None)
        # An empty permission set is "this provider does not report
        # permissions", which is not the same answer as "it reports none of
        # them": every field is therefore ``None`` rather than ``False`` when
        # nothing was declared. The asymmetry would otherwise be invisible in a
        # paper runtime and fatal in a live one - a venue-backed ``None`` on the
        # withdrawal question is a refusal by law 5, so an improvised ``False``
        # here would be a licence nobody issued.
        if not declared:
            return dataclasses.replace(
                base,
                key_expires_at_millis=(
                    None if expires is None else int(expires) // 1_000
                ),
            )
        return dataclasses.replace(
            base,
            key_permission_granted=PERMISSION_SPOT_TRADE in declared,
            read_permitted=PERMISSION_READ in declared,
            withdrawal_permitted=PERMISSION_WITHDRAW in declared,
            key_expires_at_millis=None if expires is None else int(expires) // 1_000,
        )

    def _facts_from_symbol(
        self, request: PlacementReviewRequest, base: PlacementFacts
    ) -> PlacementFacts:
        lookup = self._symbol_facts
        if lookup is None:  # pragma: no cover - guarded by the caller
            return base
        try:
            found = lookup(request.symbol)
            if found is None:
                return base
            attached, trading, order_types, time_in_forces = found
        except Exception:  # an unlisted symbol table is not fatal
            return base
        evidence = symbol_evidence(
            (attached, trading, order_types, time_in_forces),
            order_type=request.order_type,
            time_in_force=request.time_in_force,
        )
        return dataclasses.replace(
            base,
            symbol_attached=evidence.symbol_attached,
            symbol_trading=evidence.symbol_trading,
            order_type_supported=evidence.order_type_supported,
            time_in_force_supported=evidence.time_in_force_supported,
        )


def _permissions_of(credentials: object) -> tuple[str, ...]:
    raw = getattr(credentials, "permissions", ()) or ()
    if isinstance(raw, str):
        return (raw,)
    return tuple(str(item) for item in raw)


class CachingPlacementAttestor(PlacementAttestor):
    """Wraps any attestor with a bounded per-(tenant, account, symbol) TTL cache.

    Deliberately not a rate limiter: the wrapped attestor's own budget
    accounting is what keeps the deployment under the venue's weight, and a
    second limiter here would be a second opinion nobody reconciles. This only
    avoids asking the same question twice inside a window.

    The cache is bounded by entry count as well as by time, and an over-budget
    insert drops entries by their recorded expiry. An unbounded dict keyed by
    (tenant, account, symbol) is a leak whose growth rate is exactly the customer
    count, which is the worst coupling a long-lived process can have.
    """

    __slots__ = (
        "_inner",
        "_ttl_ms",
        "_failure_ttl_ms",
        "_max_entries",
        "_clock",
        "_entries",
        "hits",
        "misses",
        "failures_cached",
    )

    def __init__(
        self,
        inner: PlacementAttestor,
        *,
        ttl_ms: int = 300_000,
        max_entries: int = 4_096,
        clock: Callable[[], int] = epoch_micros,
    ) -> None:
        if isinstance(ttl_ms, bool) or not isinstance(ttl_ms, int):
            raise ValueError("ttl_ms must be an int number of milliseconds.")
        if not MIN_ATTESTER_TTL_MS <= ttl_ms <= MAX_ATTESTER_TTL_MS:
            raise ValueError(
                f"ttl_ms must be within {MIN_ATTESTER_TTL_MS}.."
                f"{MAX_ATTESTER_TTL_MS}; got {ttl_ms}. Below one second this is "
                "a no-op that costs a dict; above an hour it is the reason a "
                "stale attestation passes."
            )
        if (
            isinstance(max_entries, bool)
            or not isinstance(max_entries, int)
            or max_entries < 16
        ):
            raise ValueError("max_entries must be an int of at least 16.")
        self._inner = inner
        self._ttl_ms = ttl_ms
        self._failure_ttl_ms = max(
            MIN_ATTESTER_TTL_MS, int(ttl_ms * DEFAULT_FAILURE_CACHE_SHARE)
        )
        self._max_entries = max_entries
        self._clock = clock
        self._entries: dict[tuple[str, ...], tuple[int, PlacementAttestation]] = {}
        self.hits = 0
        self.misses = 0
        self.failures_cached = 0

    @property
    def source(self) -> str:
        return self._inner.source

    @property
    def inner(self) -> PlacementAttestor:
        """The wrapped attestor, for a deployment that needs to prime or reset it."""
        return self._inner

    async def attest(self, request: PlacementReviewRequest) -> PlacementAttestation:
        key = request.cache_key()
        now = self._clock()
        cached = self._entries.get(key)
        if cached is not None and cached[0] > now:
            self.hits += 1
            return cached[1]
        self.misses += 1
        try:
            attestation = await self._inner.attest(request)
        except Exception as error:  # the whole point of the wrap
            attestation = PlacementAttestation.unavailable(
                code=_collection_code_for(error),
                detail=f"{type(error).__name__}: {error}",
                now_micros=now,
                source=self.source,
            )
            self.failures_cached += 1
        ttl_ms = (
            self._failure_ttl_ms
            if attestation.collection_code is not None
            else self._ttl_ms
        )
        self._entries[key] = (now + ttl_ms * 1_000, attestation)
        self._trim(now)
        return attestation

    def _trim(self, now: int) -> None:
        if len(self._entries) <= self._max_entries:
            return
        for key, expiry in [
            (key, expiry) for key, (expiry, _) in self._entries.items() if expiry <= now
        ]:
            del self._entries[key]
        overflow = len(self._entries) - self._max_entries
        if overflow > 0:
            oldest = sorted(self._entries.items(), key=lambda item: item[1][0])
            for key, _ in oldest[:overflow]:
                del self._entries[key]

    def clear(self) -> None:
        """Drop every cached attestation (a key rotation, a test, a failover)."""
        self._entries.clear()

    def stats(self) -> dict[str, int]:
        """Cache behaviour, for ``/status``.

        Hits and misses are the difference between "the review costs nothing per
        order" and "the review is why we are out of weight", and
        ``failuresCached`` is the number of orders refused because a venue call
        failed - the one figure that tells an operator whether to look at the
        network or at the keys.
        """
        return {
            "entries": len(self._entries),
            "hits": self.hits,
            "misses": self.misses,
            "failuresCached": self.failures_cached,
            "ttlMillis": self._ttl_ms,
            "failureTtlMillis": self._failure_ttl_ms,
            "maxEntries": self._max_entries,
        }


class PlacementReviewer:
    """The engine's collaborator: attest, evaluate, never raise.

    ``requires_venue_attestation`` arrives at construction from the runtime's
    mode and is frozen: a reviewer built by a transmitting runtime cannot be
    talked into accepting local facts, and one built by a simulated runtime still
    writes the distinction into every verdict.
    """

    __slots__ = ("_attestor", "_policy", "_requires_venue_attestation", "_clock", "_confirmation")

    def __init__(
        self,
        attestor: PlacementAttestor,
        policy: PlacementReviewPolicy,
        *,
        requires_venue_attestation: bool,
        clock: Callable[[], int] = epoch_micros,
        confirmation: ConfirmationVerifier | None = None,
    ) -> None:
        # Refused at construction rather than at the first order: a policy that
        # demands a confirmation and a runtime that cannot produce one is a
        # deployment that will never place anything, and the sooner that is a boot
        # failure rather than a per-order verdict the fewer orders are spent
        # discovering it. (The law in ``placement_review`` refuses the same shape
        # per order, because a reviewer can be built by a caller this package does
        # not control - belt and braces, both in the blocking direction.)
        if policy.require_operator_confirmation and confirmation is None:
            raise PlacementReviewError(
                "policy.require_operator_confirmation is set but no ConfirmationVerifier "
                "was supplied; wire the verifier or turn the requirement off. A "
                "reviewer that would refuse every order is honest, but it is also a "
                "deployment that starts, passes its tests, and then does nothing."
            )
        self._attestor = attestor
        self._policy = policy
        self._requires_venue_attestation = bool(requires_venue_attestation)
        self._clock = clock
        self._confirmation = confirmation

    @property
    def attestor(self) -> PlacementAttestor:
        return self._attestor

    @property
    def policy(self) -> PlacementReviewPolicy:
        return self._policy

    @property
    def requires_venue_attestation(self) -> bool:
        return self._requires_venue_attestation

    @property
    def confirmation_verifier(self) -> ConfirmationVerifier | None:
        """The verifier, or None. Read-only: the reviewer owns its per-order use."""
        return self._confirmation

    def _assess_confirmation(self, request: PlacementReviewRequest) -> ConfirmationOutcome:
        """One assessment, and it cannot raise.

        The verifier is operator-supplied configuration, so a malformed record that
        survived construction, a key that turned out to be empty, or a verifier
        subclass that throws on a Sunday all arrive here. Every one of them becomes
        ``UNVERIFIED``: an exception in this path would be an order whose fate was
        decided by the absence of a decision, and the reviewer's contract is that it
        always returns a verdict.
        """
        verifier = self._confirmation
        if verifier is None:
            return ConfirmationOutcome(ConfirmationState.NOT_REQUIRED)
        try:
            return verifier.assess(
                tenant_id=request.tenant_id,
                account_id=request.account_id,
                symbol=request.symbol,
                order_type=request.order_type,
                now_micros=self._clock(),
            )
        except (LiveConfirmationError, ValueError, TypeError) as error:
            return ConfirmationOutcome(
                ConfirmationState.UNVERIFIED,
                f"the verifier could not assess the confirmation: {type(error).__name__}",
            )
        except Exception as error:  # reporting must never be the failure
            return ConfirmationOutcome(
                ConfirmationState.UNVERIFIED,
                f"the verifier raised {type(error).__name__}",
            )

    def _stamp_confirmation(
        self, attestation: PlacementAttestation, request: PlacementReviewRequest
    ) -> PlacementAttestation:
        """Attach the per-order assessment to the evidence the law reads.

        Done here rather than inside the attestor, because the attestor caches by
        (tenant, account, symbol, shape) and a confirmation is scoped to more than
        that: two orders sharing one cached attestation can and should reach
        different confirmation verdicts - the one that names a symbol the record does
        not cover must be refused while the covered one proceeds. Stamping after the
        cache is what keeps that property true.
        """
        if self._confirmation is None and not self._policy.require_operator_confirmation:
            return attestation
        outcome = self._assess_confirmation(request)
        if outcome.state is attestation.facts.confirmation:
            return attestation
        return dataclasses.replace(
            attestation,
            facts=dataclasses.replace(
                attestation.facts,
                confirmation=outcome.state,
                confirmation_detail=outcome.detail[:MAX_CONFIRMATION_DETAIL_LENGTH],
            ),
        )

    def _source_label(self) -> str:
        """The attestor's provenance label, or a fixed one if it cannot answer.

        Read from the exception path of :meth:`attestation` and from
        :meth:`describe`, both of which exist precisely to report on a broken
        attestor - so a ``source`` property that itself raises must not turn a
        refusal into a crash or a ``/status`` request into a 500. Nothing here
        assumes the collaborator is well-formed, which is the same reason the
        gatherer call below is wrapped.
        """
        try:
            return str(self._attestor.source)
        except Exception:  # reporting must never be the failure
            return "unavailable"

    def describe(self) -> dict[str, object]:
        """Public, secret-free view of the wiring, for ``/status``.

        ``requiresVenueAttestation`` is published because an operator comparing
        two deployments must be able to see which one would have refused; a
        summary that hides it invites precisely the mistake this module exists to
        make impossible.
        """
        view: dict[str, object] = {
            "attestorSource": self._source_label(),
            "requiresVenueAttestation": self._requires_venue_attestation,
            "policy": self._policy.to_public_dict(),
            # Published even when nothing is wired, and published as the verifier's
            # own description: presence, requirement, and the scoped identities. Not
            # the key, not the digest, not the nonce - all three of which a reader of
            # /status does not need in order to answer "would this deployment have
            # refused?", which is the only question this block is here to answer.
            # The same five keys, whether or not a verifier exists: a surface that
            # changes shape with the wiring is a surface every reader has to
            # null-check, and the interesting case ("nothing is wired") is the one
            # that would be missing its own keys.
            "operatorConfirmation": (
                {
                    "required": False,
                    "keyConfigured": False,
                    "recordPresent": False,
                    "expiresAtMicros": 0,
                    "fingerprint": "",
                }
                if self._confirmation is None
                # ``public_summary``, not ``describe``: this block is copied whole
                # into /health/ready, which is unauthenticated by design, and the
                # record's tenant/account/symbol scope is an identity list that
                # surface has no business publishing.
                else self._confirmation.public_summary()
            ),
        }
        stats = getattr(self._attestor, "stats", None)
        if callable(stats):
            view["cache"] = stats()
        return view

    async def attestation(self, request: PlacementReviewRequest) -> PlacementAttestation:
        try:
            return await self._attestor.attest(request)
        except Exception as error:  # an attestor must not decide
            return PlacementAttestation.unavailable(
                code=_collection_code_for(error),
                detail=f"{type(error).__name__}: {error}",
                now_micros=self._clock(),
                source=self._source_label(),
            )

    async def review(
        self, request: PlacementReviewRequest
    ) -> tuple[PlacementAttestation, PlacementVerdict]:
        """One review, end to end.

        The attestation is returned alongside the verdict so a caller can persist
        the evidence without re-gathering it, and so a test can prove which facts
        produced which answer instead of asserting the answer alone.

        Everything the venue or an injected clock can do to this method ends as a
        blocking verdict rather than as an exception, because the call site is
        between "validated" and "sent" and an exception there is an order whose
        fate nobody recorded. A raise from the law itself - not from a gatherer,
        not from a clock - is a defect in this package and is deliberately allowed
        to propagate: turning a programming error into a plausible refusal is how
        a bug becomes a policy.
        """
        try:
            attestation = self._stamp_confirmation(
                await self.attestation(request), request
            )
            verdict = evaluate_placement_attestation(
                attestation,
                self._policy,
                requires_venue_attestation=self._requires_venue_attestation,
                now_micros=self._clock(),
            )
        except Exception as error:  # the refusal is the fallback
            logger.error(
                "placement.review_failed",
                extra={
                    "event": "placement.review_failed",
                    "tenantId": request.tenant_id,
                    "accountId": request.account_id,
                    "symbol": request.symbol,
                    "error": f"{type(error).__name__}: {error}",
                },
                exc_info=True,
            )
            # ``requires_venue_attestation=True`` here regardless of this
            # reviewer's own setting: a review that could not be completed has not
            # established that a venue said yes, which is the one thing a
            # transmitting runtime is required to know. A simulated runtime gets
            # the same refusal - it is not a licence to trade on an error.
            attestation = PlacementAttestation.unavailable(
                code=_collection_code_for(error),
                detail=(
                    "the review could not be completed: "
                    f"{type(error).__name__}: {error}"
                ),
                now_micros=0,
                source=self._source_label(),
            )
            verdict = evaluate_placement_attestation(
                attestation,
                self._policy,
                requires_venue_attestation=True,
                now_micros=0,
            )
        logger.info(
            "placement.review",
            extra={
                "event": "placement.review",
                "tenantId": request.tenant_id,
                "accountId": request.account_id,
                "symbol": request.symbol,
                "allowed": verdict.allowed,
                "verdictId": verdict.verdict_id,
                "codes": list(verdict.codes),
                "venueBacked": verdict.venue_backed,
            },
        )
        return attestation, verdict


def _collection_code_for(error: BaseException) -> ReviewCode:
    """Classify a gatherer failure into the closed vocabulary.

    An :class:`AttestationFailure` carries its own code and wins. Otherwise the
    two exceptions that mean something operationally distinct are recognised by
    type - rate-limited and unreachable - because a caller that is being
    rate-limited must back off and a caller that is unreachable may retry now.
    Everything else is unreachable: "we do not know what went wrong" and "the
    venue is down" produce the same permitted action, which is to refuse the
    order and try again later.
    """
    if isinstance(error, AttestationFailure):
        return error.code
    if isinstance(error, AdapterRateLimitedError):
        return ReviewCode.ATTESTATION_RATE_LIMITED
    if isinstance(error, AdapterConnectionError):
        return ReviewCode.ATTESTATION_UNREACHABLE
    if isinstance(error, AdapterRejectedError):
        # A rejection here is about the *review request*, not the order: an
        # endpoint that answers 401/403 has refused to describe the key, and the
        # review therefore has no evidence. The severity table makes this
        # blocking and non-retryable, which is the whole point - an operator has
        # to act, and a worker that retries gets the same answer.
        return ReviewCode.ATTESTATION_REFUSED_BY_VENUE
    return ReviewCode.ATTESTATION_UNREACHABLE
