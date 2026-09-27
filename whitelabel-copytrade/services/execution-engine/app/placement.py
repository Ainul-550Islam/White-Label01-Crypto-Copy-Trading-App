"""The placement-review seam (Part 16): which venue the review asks, and what a
simulated runtime is allowed to assert.

The engine accepts a reviewer or none, and refuses to construct a transmitting
runtime with none. This module is where the service decides *which* reviewer that
is, and it is the only file in this service that knows the name of an exchange.
Four rules, all of them about not letting a wiring detail become a policy
decision:

1. ``requires_venue_attestation`` arrives from ``will_transmit_orders`` - the
   setting the engine itself uses - rather than from a flag in this file. Two
   sources for "does this runtime need proof from the venue" is how a review
   ends up enforcing something other than what the transport does.
2. A simulated runtime gets :class:`LocalPlacementAttestor`. It reports what this
   process knows (its credential's declared permissions, its symbol registry, its
   measured clock skew) and it cannot claim venue backing - that is not a
   limitation to work around, it is the fact that makes the audit line truthful.
3. A runtime that transmits gets :class:`BinancePlacementAttestor` built over the
   SAME adapter object the orders go through, so the review shares its credential
   provider, its clock synchronisation and its rate-limit budget. A second signed
   client would spend weight nobody accounted for.
4. The TTL cache wraps every gatherer, including the local one. A burst of
   orders for one account must not become a burst of metadata calls: the venue
   does not distinguish "review" traffic from "order" traffic when it counts
   weight, and an outage that starts because this platform was diligent about
   permissions is still an outage.

The cache is not a rate limiter and does not try to be: the adapter's own budget
accounting is the ceiling, and this only avoids asking the same question twice
inside one window. A cached *failure* is evicted sooner than a cached success is
refreshed, which is why an unreachable venue slows the review rather than
locking it out for the full TTL.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Final

from wlct_trading.enums import ExchangeId
from wlct_trading.execution.credentials import CredentialProvider
from wlct_trading.execution.live_confirmation import (
    ConfirmationVerifier,
    LiveConfirmationError,
)
from wlct_trading.execution.placement_attestor import (
    CachingPlacementAttestor,
    LocalPlacementAttestor,
    PlacementAttestor,
    PlacementReviewer,
    PlacementReviewRequest,
    SymbolFacts,
    UnattestedPlacementAttestor,
)
from wlct_trading.execution.placement_review import (
    PlacementAttestation,
    PlacementVerdict,
)

from app.config import Settings

__all__ = [
    "REVIEW_ENDPOINT_LABEL",
    "PlacementWiring",
    "build_confirmation_verifier",
    "build_placement_reviewer",
    "review_placement",
]

logger = logging.getLogger(__name__)

#: What a reviewer built here is described as in ``/status``. A constant rather
#: than an inline string because the retention and enablement surfaces have
#: taught this service that an operator greps for these labels, and a label that
#: changes spelling is a silent dashboard break.
REVIEW_ENDPOINT_LABEL: Final[str] = "placement-review"


@dataclass(frozen=True, slots=True)
class PlacementWiring:
    """The reviewer plus the facts a status surface needs to explain it.

    The reviewer alone would be enough to run the engine and not enough to debug
    a refusal: when an order is blocked the first question is "what was this
    runtime willing to believe", and the answer is ``requiresVenueAttestation``
    next to the gatherer's ``source`` and the policy's thresholds.
    """

    reviewer: PlacementReviewer
    mode: str
    requires_venue_attestation: bool
    cache_ttl_ms: int
    #: Whether an operator-confirmation verifier is installed. A bool on the wiring
    #: rather than something a reader digs out of ``reviewer.describe()`` because the
    #: Part 18 wiring gauge publishes exactly this fact, and a gauge that had to
    #: re-derive it would be a second interpretation of one description.
    confirmation_configured: bool = False

    def describe(self) -> dict[str, object]:
        """The non-secret view of the wiring, for ``/status`` and the console."""
        return {
            "label": REVIEW_ENDPOINT_LABEL,
            "mode": self.mode,
            "requiresVenueAttestation": self.requires_venue_attestation,
            "cacheTtlMillis": self.cache_ttl_ms,
            "confirmationConfigured": self.confirmation_configured,
            **self.reviewer.describe(),
        }

    async def review(
        self, request: PlacementReviewRequest
    ) -> tuple[PlacementAttestation, PlacementVerdict]:
        """One review, exposed for the internal endpoint.

        Returns the pair rather than the verdict because the endpoint's job is to
        show an operator the evidence alongside the answer: "the venue was
        unreachable" and "the venue said no" produce the same refusal shape and
        need different remedies.
        """
        return await self.reviewer.review(request)


def build_confirmation_verifier(
    settings: Settings,
    *,
    exchange: ExchangeId = ExchangeId.BINANCE,
    environ: Mapping[str, str] | None = None,
) -> ConfirmationVerifier | None:
    """Assemble the verifier this deployment configured, or nothing.

    Returns ``None`` when the deployment neither requires a confirmation nor
    supplies one, and the reviewer then behaves exactly as it did before Part 19.
    Every other case is decided here, at boot, because the alternative is an order
    path that discovers the HMAC key is missing:

    * required but the key variable is absent or blank -> refusal;
    * a record supplied with no key to verify it -> refusal (the key is what makes
      the record more than a copy-pasted assertion);
    * a record that fails to parse -> refusal, from the core's own validator, with
      the variable named.

    The key is read out of ``environ`` (default: the process environment) and is
    never a field on ``Settings``, for the reason every secret in this service has:
    a value that lives on a pydantic model can be published by a model_dump, and one
    that only ever appears in a lookup cannot.
    """
    required = bool(settings.EXECUTION_REQUIRE_OPERATOR_CONFIRMATION)
    record = settings.operator_confirmation
    if not required and record is None:
        return None
    source = dict(os.environ) if environ is None else dict(environ)
    key_name = settings.EXECUTION_CONFIRMATION_KEY_ENV.strip()
    key = (source.get(key_name) or "").strip()
    if not key:
        raise ValueError(
            f"{key_name} is not set or is blank, and this deployment "
            + (
                "requires an operator confirmation"
                if required
                else "supplies an operator confirmation record"
            )
            + ". Without the key the record is a claim with no signature: a required "
            "confirmation could only be refused for every order, and a supplied one "
            "would be indistinguishable from a forged one. Name the variable, or drop "
            "both settings."
        )
    if len(key) < 32:
        raise ValueError(
            f"{key_name} must be at least 32 characters; a short HMAC key is an "
            "offline-guessable one, and the thing being protected here is the "
            "distinction between an operator's decision and somebody else's."
        )
    try:
        return ConfirmationVerifier(
            record=record,
            key=key,
            instance_id=settings.EXECUTION_INSTANCE_ID or "",
            exchange=exchange.value,
            required=required,
        )
    except LiveConfirmationError as error:
        raise ValueError(
            f"the operator confirmation could not be verified against this "
            f"deployment: {error} (check {key_name} and "
            "EXECUTION_OPERATOR_CONFIRMATION_JSON/_FILE)"
        ) from error


def build_placement_reviewer(
    settings: Settings,
    *,
    will_transmit_orders: bool,
    exchange: ExchangeId = ExchangeId.BINANCE,
    credential_provider: CredentialProvider | None = None,
    symbol_facts: Callable[[str], SymbolFacts | None] | None = None,
    venue_attestor: PlacementAttestor | None = None,
    confirmation_verifier: ConfirmationVerifier | None = None,
    environ: Mapping[str, str] | None = None,
) -> PlacementWiring:
    """Assemble the reviewer this deployment's mode entitles it to.

    ``venue_attestor`` is the injection point for the exchange-specific gatherer
    (see ``wlct_trading.exchanges.binance.attestation``). It is injected rather
    than constructed here because the gatherer needs the live trading adapter -
    the object this function has no business creating, and which a simulated
    runtime must not have at all.

    ``credential_provider`` is the one built by :mod:`app.credentials`: reading
    key *metadata* is the review's job, and the provider is the only sanctioned
    path to it. It is passed to the local gatherer as a partial of ``resolve``,
    which is the seam's way of keeping the exchange choice in one place instead
    of scattering ``ExchangeId.BINANCE`` through three call sites.
    """
    ttl_ms = settings.EXECUTION_PLACEMENT_ATTESTATION_TTL_MS
    policy = settings.placement_policy
    if confirmation_verifier is None:
        # Built from configuration unless a caller already assembled one, which is
        # the same shape as ``venue_attestor`` above: this function decides what the
        # runtime is wired WITH, never what the ceremony that authorised it looked
        # like. An injected verifier is used verbatim, including its absence.
        confirmation_verifier = build_confirmation_verifier(
            settings, exchange=exchange, environ=environ
        )

    if will_transmit_orders and venue_attestor is None:
        raise ValueError(
            "this runtime transmits orders but no venue attestor was provided. "
            "The local gatherer can describe this process's configuration and "
            "nothing else, and configuration is not permission: wire "
            "BinancePlacementAttestor over the same adapter the orders use, or "
            "run simulated."
        )

    if venue_attestor is not None:
        inner: PlacementAttestor = venue_attestor
        mode = "venue"
    elif credential_provider is not None or symbol_facts is not None:
        resolve = None
        if credential_provider is not None:
            # ``partial`` rather than a lambda so the signature the gatherer sees
            # is the provider's own, minus the exchange this service is bound to.
            resolve = _credential_reader(credential_provider, exchange)
        inner = LocalPlacementAttestor(
            resolve_credentials=resolve,
            symbol_facts=symbol_facts,
        )
        mode = "local"
    else:
        # No gatherer at all. Not the same as a permissive one, and not the same
        # as "review disabled": the review still runs, still writes a verdict,
        # and still refuses - which is the point of wiring a reviewer that
        # attests nothing into a runtime that can transmit.
        inner = UnattestedPlacementAttestor(
            "no credential provider and no symbol registry are wired into this "
            "runtime"
        )
        mode = "unattested"

    cached = CachingPlacementAttestor(inner, ttl_ms=ttl_ms)
    reviewer = PlacementReviewer(
        cached,
        policy,
        requires_venue_attestation=will_transmit_orders,
        confirmation=confirmation_verifier,
    )
    wiring = PlacementWiring(
        reviewer=reviewer,
        mode=mode,
        requires_venue_attestation=will_transmit_orders,
        cache_ttl_ms=ttl_ms,
        confirmation_configured=confirmation_verifier is not None,
    )
    logger.info(
        "execution_engine.placement_review_wired",
        extra={
            "event": "execution_engine.placement_review_wired",
            "placementMode": mode,
            "requiresVenueAttestation": will_transmit_orders,
            "attestationTtlMillis": ttl_ms,
            "maxKeyAgeDays": policy.max_key_age_days,
            "requireIpAllowlist": policy.require_ip_allowlist,
            # Presence, not content: whether a verifier exists and whether the policy
            # demands one are deployment facts, and the record's own scope is already
            # carried in the reviewer's description two lines below.
            "requireOperatorConfirmation": policy.require_operator_confirmation,
            "operatorConfirmationConfigured": confirmation_verifier is not None,
            # Read from the reviewer's own description, which guards the label:
            # a gatherer whose ``source`` property explodes must not be able to
            # fail the boot that is trying to report on it.
            "attestorSource": reviewer.describe()["attestorSource"],
        },
    )
    return wiring


def _credential_reader(
    provider: CredentialProvider, exchange: ExchangeId
) -> Callable[[str, str], object]:
    """A ``(tenant, account) -> credentials`` view of an async provider.

    Deliberately narrow: the gatherer asks for the credential object and reads
    the permissions it declares. It never receives the signing context, and it
    cannot render what it is handed - the core's credential value objects refuse
    to survive ``repr``, so a gatherer that logs its input cannot leak.
    """

    async def read(tenant_id: str, account_id: str) -> object:
        return await provider.resolve(tenant_id, account_id, exchange)

    return read


async def review_placement(
    wiring: PlacementWiring,
    *,
    tenant_id: str,
    account_id: str,
    symbol: str,
    order_type: str = "LIMIT",
    time_in_force: str = "GTC",
) -> tuple[PlacementAttestation, PlacementVerdict]:
    """Run the review for one would-be order, and place nothing.

    This is the entry point behind ``POST /internal/v1/placement/attest``. The
    defaults are the shape a spot limit order with GTC has, which is what an
    operator typing a curl is asking about; a different order shape is passed
    explicitly rather than inferred, because "supported for LIMIT" and "supported
    for STOP_LIMIT" are different venue answers and guessing one would make the
    endpoint's report worth less than the refusal it describes.
    """
    request = PlacementReviewRequest(
        tenant_id=tenant_id,
        account_id=account_id,
        symbol=symbol,
        order_type=order_type,
        time_in_force=time_in_force,
    )
    return await wiring.review(request)
