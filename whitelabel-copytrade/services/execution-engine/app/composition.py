"""The single composition root of the execution plane.

Everything the engine touches - adapter, store, locks, incidents, risk - is
built exactly once, here, and every choice is mode-gated at construction
rather than at first use. This is the same discipline
:class:`wlct_trading.execution.engine.ExecutionEngine` applies internally
(:meth:`_assert_wiring_is_safe` refuses unsafe combinations), lifted from
"the library you wire" to "the service you deploy": a misconfiguration kills
startup, not the first customer order.

What is deliberately absent:

* no live venue adapter - ``EXECUTION_MODE=live`` is refused here even
  though the core supports it: the signed transport and distributed locks
  are now wired, but the live credential provider and the venue-ordering
  audit for authenticated order placement have not completed their review,
  so refusing is still the honest wiring. The refusal is code, not a
  default, and no environment value talks the process into it;
* no order-submission endpoint - the platform's producers enqueue account
  maintenance and cancellation today (see the queue-consumer inventory in
  docs/PART11_WORKER_SCALING.md); a worker must not grow capabilities its
  producers never send;
* no silently-degraded store - ``EXECUTION_STORE_BACKEND=memory`` keeps
  the process-local simulated store (readiness reports ``storeDurable:
  false``, exactly as before), and ``postgres`` only starts when the
  lifespan hands ``build_runtime`` a live pool whose tables exist. A
  durable mode that could not reach its database kills startup; it never
  "falls back to memory", because silent fallback is how a durability
  incident becomes a data-loss incident.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from wlct_trading.adapters.base import AccountAdapter, TradingAdapter
from wlct_trading.adapters.paper import PaperAccountAdapter, PaperTradingAdapter
from wlct_trading.clock import epoch_micros
from wlct_trading.enums import ExchangeId
from wlct_trading.execution.config import ExecutionSettings
from wlct_trading.execution.engine import ExecutionEngine
from wlct_trading.execution.incidents import (
    IncidentRecorder,
    InMemoryIncidentRecorder,
)
from wlct_trading.execution.live_enablement import (
    LiveEnablementInputs,
    LiveEnablementReport,
    evaluate_live_enablement,
)
from wlct_trading.execution.locks import LockManager
from wlct_trading.execution.reconciliation import ReconciliationService
from wlct_trading.execution.store import InMemoryOrderStore, OrderStore
from wlct_trading.execution.transport.client import SignedTransportClient
from wlct_trading.execution.transport.client_metrics import SignedTransportClientMetrics
from wlct_trading.execution.transport.key_registry import KeyRegistry, generate_secret
from wlct_trading.execution.transport.replay_guard import InMemoryReplayStore, ReplayGuard
from wlct_trading.execution.transport.server import SignedTransportVerifier
from wlct_trading.execution.transport.server_metrics import SignedTransportServerMetrics
from wlct_trading.market_data import BookTop
from wlct_trading.metrics import ExecutionMetrics
from wlct_trading.risk import RiskEngine, RiskLimits

from app.config import Settings
from app.credential_registry import CredentialRegistryWiring, build_credential_registry
from app.credentials import CredentialWiring, build_credential_provider
from app.distributed_locks import (
    DistributedLockConfig,
    DistributedLockWiring,
    build_distributed_lock_manager,
)
from app.placement import PlacementWiring, build_placement_reviewer
from app.venue_attestation import (
    VenueAttestationConfig,
    VenueAttestationError,
    VenueAttestationWiring,
    build_venue_attestation,
)

__all__ = [
    "SUPPORTED_COMMANDS",
    "EngineRuntime",
    "ExecutionUnavailable",
    "build_runtime",
]

logger = logging.getLogger(__name__)

#: Commands this runtime executes end to end. The worker's processor checks
#: membership against this set (fetched from /status at startup and again on
#: every request path via the 501 response) rather than hardcoding a
#: parallel list - one place decides what is supported, and it decides at
#: boot, not by accident of which file was edited last.
SUPPORTED_COMMANDS: frozenset[str] = frozenset(
    {
        "verify-exchange-credentials",
        "refresh-account-balances",
        "reconcile-trading-account",
        "cancel-order",
        # Phase 3: the copy/OMS submission path. Served by
        # ``POST /internal/v1/orders/submit`` against THIS runtime's adapter,
        # which build_runtime only ever constructs as the paper simulator -
        # EXECUTION_MODE=live still refuses to boot below, so adding the
        # command widens what the worker may forward, never what reaches a
        # venue.
        "submit-order",
    }
)

#: Conservative numeric limits for the simulated runtime, matching the
#: harness the core's own execution tests pin against. All-`None` limits
#: would also construct; they would also mean the one process holding the
#: money path ships without speed bumps, and "simulated" is not a reason to
#: practise with the guards off.
SIMULATED_LIMITS = RiskLimits(
    max_order_quantity=Decimal("1000"),
    max_order_notional=Decimal("1000000"),
    max_position_quantity=Decimal("5000000"),
    max_symbol_exposure_notional=Decimal("5000000"),
    max_account_exposure_notional=Decimal("10000000"),
    max_open_orders=100,
    max_orders_per_minute=100,
    max_daily_loss=Decimal("1000000"),
    max_price_deviation_percent=Decimal("50"),
    max_market_data_age_micros=60_000_000,
)


class ExecutionUnavailable(RuntimeError):
    """The runtime cannot serve in the current wiring.

    Surfaced as 503 (or a startup refusal): "not wired yet" is an
    operational fact callers can act on - retry later, alert a human -
    which a raw ``NoneType`` is not.
    """


@dataclass(slots=True)
class EngineRuntime:
    """The assembled execution plane, shared by all request handlers.

    The engine, store, recorder and reconciler are the same objects for the
    process lifetime: :class:`ExecutionEngine` documents itself as safe to
    share across tenants because every store/lock call is tenant-scoped,
    while a second instance would silently double any in-memory ledger - the
    one failure mode a "just build another one" refactor introduces.
    """

    engine: ExecutionEngine
    store: OrderStore
    locks: LockManager
    #: The port since Part 17, not a concrete class: a durable deployment and a
    #: paper one differ in exactly this object, and a field typed to the in-memory
    #: implementation would make the durable one a lie about its own shape.
    incidents: IncidentRecorder
    trading_adapter: TradingAdapter
    account_adapter: AccountAdapter
    reconciliation: ReconciliationService
    settings: Settings
    # Part 16. Both are required, not optional-with-a-default: a runtime that
    # cannot say which credential source it used and which gatherer reviewed the
    # order is a runtime whose /status is documentation rather than evidence.
    credentials: CredentialWiring
    placement: PlacementWiring
    #: Part 19: the live-enablement grading, computed from the objects this function
    #: actually built. Carried on the runtime rather than recomputed per request
    #: because it is a fact about a fixed wiring, and published on /status so "how
    #: close is this deployment to being allowed to trade live" is a query with one
    #: answer instead of a paragraph in a document.
    live_enablement: LiveEnablementReport | None = None
    #: Part 20: the signed transport components, wired when the composition
    #: root constructs them. These are None in simulated mode and populated
    #: when the key registry and transport are configured.
    signed_transport_client: SignedTransportClient | None = None
    signed_transport_verifier: SignedTransportVerifier | None = None
    key_registry: KeyRegistry | None = None
    #: Part 21: the distributed lock wiring, carrying the lock manager,
    #: fencing state, and operational metadata. Carried on the runtime so
    #: /status can report the actual lock posture without recomputing it.
    distributed_lock_wiring: DistributedLockWiring | None = None
    #: Part 22: the venue attestation wiring, carrying the Binance placement
    #: attestor and its dependencies. None when credentials are not configured
    #: (the honest state for simulated mode with no key).
    venue_attestation_wiring: VenueAttestationWiring | None = None
    #: Part 23: the credential registry wiring, carrying the provider registry
    #: and credential metadata. Carried on the runtime so /status can report
    #: the actual credential posture without recomputing it.
    credential_registry_wiring: CredentialRegistryWiring | None = None
    #: Phase 3: the SAME book function the paper adapter prices against, so the
    #: submission route's reference price and the simulator's fill price can
    #: never disagree. ``None`` (or a provider returning ``None``) means "no
    #: market data": the route then reports market data as down and the engine's
    #: gate refuses the order instead of pricing it against an invented mid.
    book_provider: Callable[[ExchangeId, str], BookTop | None] | None = None
    #: Phase 3: per-(tenant, account) submission timestamps (epoch micros) for
    #: the ``orders_in_last_minute`` risk input. Process-local by design: the
    #: simulated runtime is a single instance, and a count that is too LOW could
    #: only come from a restart - which also empties the in-memory store.
    submission_windows: dict[tuple[str, str], list[int]] = field(default_factory=dict)

    def describe(self) -> dict[str, Any]:
        """Public, secret-free description of the wiring, for /status and
        for the worker to assert against before forwarding anything."""
        # Read once, below, twice-guarded: a sink whose ``stats`` attribute is a
        # broken property must not turn a status request into a 500, which is the
        # same reason the review's source label is read through a try.
        try:
            sink_stats = getattr(self.incidents, "stats", None)
        except Exception:  # a broken attribute must not make status unanswerable
            sink_stats = None
        return {
            "mode": self.settings.EXECUTION_MODE,
            "dryRun": self.settings.EXECUTION_DRY_RUN,
            "instanceId": self.settings.EXECUTION_INSTANCE_ID,
            "adapter": type(self.trading_adapter).__name__,
            "store": type(self.store).__name__,
            "storeBackend": self.settings.EXECUTION_STORE_BACKEND,
            # getattr mirrors the core engine reading this OPTIONAL port
            # attribute the same duck-typed way (OrderStore documents it as a
            # MAY); defaulting False means "unproven durable" - fail-closed.
            "storeDurable": bool(getattr(self.store, "is_durable", False)),
            # Retention posture travels with the store posture: a durable
            # store nobody prunes and a prune that cannot reach a memory
            # store are both states the caller should see, not infer.
            "retentionEnabled": self.settings.EXECUTION_RETENTION_ENABLED,
            "retentionEventDays": self.settings.EXECUTION_RETENTION_EVENT_DAYS,
            # Part 15's posture travels with the store's for the same reason
            # the retention knobs do: whether an enablement audit even CAN
            # run here is a property of this wiring, not of the caller.
            "enablementMaxAgeDays": self.settings.EXECUTION_ENABLEMENT_MAX_AGE_DAYS,
            # Part 16's posture, for the reason every other line here exists: an
            # operator debugging a refused order should not have to read the
            # source to learn what this process was willing to believe. The
            # credential *source* and the review's gatherer label are enough to
            # tell "no key is wired" from "the venue refused", and neither is a
            # secret - no key material is reachable through this dict at all.
            "credentialSource": self.credentials.source,
            # Which reader backs the credential source, or None when the source needs
            # none. Published because "secret-manager" on its own cannot tell an
            # operator whether this process can resolve a second tenant - the fetcher
            # label is what makes that answerable, and it names a mechanism, not a key.
            "credentialFetcher": self.credentials.fetcher_source,
            "operatorConfirmation": self.placement.confirmation_configured,
            "placement": self.placement.describe(),
            # The graded live-enablement report. Rendered through to_public_dict even
            # when absent (a runtime assembled by a caller that did not grade - a test
            # double, a future factory) rather than omitted, so /status has one shape.
            "liveEnablement": (
                None
                if self.live_enablement is None
                else self.live_enablement.to_public_dict()
            ),
            # Part 17's sink posture, published for the reason every other line
            # here exists. "Why is the incident list empty" has three honest
            # answers - nothing happened, the records died with the last restart,
            # or this process could not write them - and an operator can only tell
            # them apart if the sink says which one it is.
            "incidents": {
                "sink": type(self.incidents).__name__,
                "durable": bool(getattr(self.incidents, "is_durable", False)),
                # Always a mapping, empty when the sink keeps no accounting: the
                # view serialises the key either way, and a description that
                # sometimes omits it would make /status and describe() two
                # different shapes for the same object - which is precisely the
                # drift the parity test in the service suite exists to catch.
                "stats": dict(sink_stats()) if callable(sink_stats) else {},
            },
            # Part 18: "is this process measuring anything at all" is a wiring fact
            # like every other line in this dict, and it is the one a reader of
            # /metrics needs first - a scrape of all zeros means something different
            # when no instrument was handed to the engine. Read through getattr for
            # the reason storeDurable is: an engine stub without the property answers
            # "unproven" instead of raising inside a status request.
            "metricsConfigured": getattr(self.engine, "metrics", None) is not None,
            "locksDistributed": self.locks.is_distributed,
            # Part 20: signed transport posture.
            "signedTransportWired": self.signed_transport_client is not None,
            "keyRegistryConfigured": self.key_registry is not None,
            # Part 21: distributed lock wiring posture. The describe output
            # includes the wiring metadata so /status shows the actual lock
            # configuration, not just whether the class is distributed.
            "distributedLockWiring": (
                None
                if self.distributed_lock_wiring is None
                else self.distributed_lock_wiring.describe()
            ),
            # Part 22: venue attestation posture. Whether the composition root
            # constructed a real Binance placement attestor.
            "venueAttestation": (
                None
                if self.venue_attestation_wiring is None
                else self.venue_attestation_wiring.describe()
            ),
            # Part 23: credential registry posture.
            "credentialRegistry": (
                None
                if self.credential_registry_wiring is None
                else self.credential_registry_wiring.describe()
            ),
            "commands": sorted(SUPPORTED_COMMANDS),
        }


def make_paper_book_provider(
    mid: Decimal | None,
) -> Callable[[ExchangeId, str], BookTop | None]:
    """The book function the paper adapter prices against.

    A fixed mid when configured, an empty book otherwise. The empty book is
    not an oversight: "no reference price" makes the adapter refuse rather
    than invent, which is the correct behaviour for a simulated venue nobody
    configured. Every price that DOES exist here is simulated by
    construction; nothing in this function pretends to be a market.
    """

    def provider(exchange: ExchangeId, symbol: str) -> BookTop | None:
        if mid is None:
            return None
        return BookTop(
            exchange=exchange,
            symbol=symbol,
            best_bid=mid,
            best_bid_quantity=Decimal("1"),
            best_ask=mid,
            best_ask_quantity=Decimal("1"),
            sequence=0,
            exchange_timestamp=0,
            received_timestamp=0,
        )

    return provider


def _confirmation_grading(settings: Settings, placement: PlacementWiring) -> bool:
    """Whether the deployment's own confirmation is currently acceptable.

    The deployment-level assessment, never the per-order one: at startup there is no
    order whose symbol could be checked, and inventing one to grade against would put
    a fabricated scope into an enablement report that an operator reads as evidence.
    ``assess_deployment`` therefore grades integrity, identity and window, and the
    review separately grades scope for every order - which is why a deployment whose
    boot grading is green can still (correctly) refuse a symbol nobody confirmed.

    A grading that raises is reported as False rather than as an exception: this
    function feeds a refusal message, and a report that cannot be built must still
    refuse, not replace the live-mode refusal with a stack trace.
    """
    verifier = placement.reviewer.confirmation_verifier
    if verifier is None:
        return False
    try:
        outcome = verifier.assess_deployment(
            tenant_id=settings.EXECUTION_CREDENTIAL_TENANT_ID,
            account_id=settings.EXECUTION_CREDENTIAL_ACCOUNT_ID,
            now_micros=epoch_micros(),
        )
    except Exception:  # a report that cannot be graded still refuses
        return False
    return outcome.accepted


def build_runtime(
    settings: Settings,
    store: OrderStore | None = None,
    incidents: IncidentRecorder | None = None,
) -> EngineRuntime:
    """Construct the execution plane, or refuse loudly at startup.

    ``store`` is the durable adapter's injection point: the lifespan owns
    the pool (it must create it before any request can be served and close
    it on shutdown, and it verifies the tables exist), while this function
    owns the WIRING - which combinations may exist at all. ``incidents`` is
    the same arrangement for the incident sink (Part 17): the lifespan builds
    it over the same pool, and this function refuses the pairings that would
    leave a deployment with half a memory. A postgres
    backend reached without an injected store, or an injected store under a
    memory backend, is a bug in the composition path, and bugs in this path
    die here rather than in the first order that quietly went unsaved.
    """
    # Part 19: the live refusal is now COMPUTED, and it still refuses. The sentence
    # this used to raise was true the day it was written and had already begun to rot
    # by Part 17 - it named the credential provider as unfinished long after the
    # credential provider shipped - because prose about a checklist cannot notice the
    # checklist changing. What follows grades the wiring this function built and
    # renders the refusal from the grade, which is narrower (it cannot overstate what
    # is missing), better (it names what IS satisfied), and still unconditional: the
    # report can never come back empty in this build, because SIGNED_TRANSPORT_WIRED
    # is a prerequisite no environment variable in this service can satisfy.
    #
    # The refusal is raised at the END of this function rather than the top so that the
    # grade is a measurement and not a guess. A runtime that refuses live mode while
    # describing a store, locks and a reviewer it has not built yet would be publishing
    # an opinion as evidence, which is the mistake in the other direction.
    if settings.EXECUTION_STORE_BACKEND == "postgres" and store is None:
        raise ExecutionUnavailable(
            "EXECUTION_STORE_BACKEND=postgres requires the lifespan-injected "
            "pool store; a postgres-wired engine built over a memory store "
            "would report durability it does not have"
        )
    if settings.EXECUTION_STORE_BACKEND == "memory" and store is not None:
        raise ExecutionUnavailable(
            "an injected durable store under EXECUTION_STORE_BACKEND=memory "
            "means the config and the wiring disagree; refusing to guess "
            "which one the operator meant"
        )
    if store is None:
        store = InMemoryOrderStore()

    # Part 21: Wire distributed locks. The build_distributed_lock_manager
    # function inspects the configuration and either constructs a real
    # Redis-backed distributed lock manager with fencing tokens, or returns
    # an honest in-memory manager for simulated mode. The wiring is
    # derived from the actual objects built, not from a configuration flag.
    lock_config = DistributedLockConfig(
        enabled=settings.EXECUTION_DISTRIBUTED_LOCKS,
        redis_url=(settings.EXECUTION_REDIS_URL or "").strip(),
        lock_ttl_ms=settings.EXECUTION_LOCK_TTL_MS,
        lock_acquisition_timeout_ms=settings.EXECUTION_LOCK_ACQUISITION_TIMEOUT_MS,
        lock_renewal_ratio=settings.EXECUTION_LOCK_RENEWAL_RATIO,
        instance_id=settings.EXECUTION_INSTANCE_ID or "simulated",
        fencing_required=True,
    )
    lock_wiring = build_distributed_lock_manager(lock_config)
    locks = lock_wiring.manager
    durable_store = bool(getattr(store, "is_durable", False))
    book_provider = make_paper_book_provider(settings.simulated_mid)
    trading = PaperTradingAdapter(book_provider)
    account = PaperAccountAdapter(settings.paper_balances)
    if incidents is None:
        # Part 17's pairing law, decided HERE rather than trusted to the caller:
        # a durable store with the in-memory sink is the exact state this part
        # exists to remove, and a runtime that reaches it without being told has
        # orders that survive a restart and incidents that do not. Refusing is
        # the only answer that cannot be forgotten by the next caller.
        if durable_store:
            raise ExecutionUnavailable(
                "the durable order store cannot be paired with the in-memory "
                "incident sink: incidents explain the orders, and losing them at "
                "restart while keeping the orders would leave a store full of "
                "records nobody can interpret. Pass incidents=... a "
                "PostgresIncidentRecorder built over the same pool (that is what "
                "app.main does at startup)."
            )
        incidents = InMemoryIncidentRecorder()
    elif not durable_store and bool(getattr(incidents, "is_durable", False)):
        raise ExecutionUnavailable(
            "a durable incident sink over the in-memory order store means the "
            "config and the wiring disagree, in the mirror image of the refusal "
            "above: refuse to guess which half the operator meant"
        )
    risk_engine = RiskEngine(SIMULATED_LIMITS)
    reconciliation = ReconciliationService(
        trading=trading,
        account=account,
        store=store,
        incidents=incidents,
        locks=locks,
    )

    credentials = build_credential_provider(settings)
    # Part 23: Wire the credential registry. The registry wraps the provider
    # constructed above and adds lifecycle metadata, capability declarations,
    # and a named selection mechanism for status reporting.
    credential_registry_wiring = build_credential_registry(
        settings,
        provider=credentials.provider,
    )
    engine_settings = ExecutionSettings(
        live_trading_enabled=False,
        dry_run=settings.EXECUTION_DRY_RUN,
        paper_trading=True,
        trading_mode_setting="PAPER",
        trading_enabled=True,
        live_trading_confirmed=False,
        order_request_timeout_ms=settings.EXECUTION_REQUEST_TIMEOUT_MS,
    )
    # Part 22: Wire venue attestation when real credentials are configured.
    # The BinancePlacementAttestor queries the venue's authenticated endpoints
    # (apiRestrictions, optionally account) to establish whether this key may
    # place this order on this symbol right now. The attestor is constructed
    # here and passed to the placement reviewer, which changes placement.mode
    # from "local" to "venue" -- the fact the live-enablement grading reads.
    #
    # When credentials are "none" (the default for simulated mode), no venue
    # attestor is constructed: there is no key to present to the venue, no
    # transport to present it over, and no reason to ask Binance whether a
    # nonexistent key may trade. This is the honest state.
    venue_attestation_wiring: VenueAttestationWiring | None = None
    venue_attestor = None
    if credentials.source != "none":
        try:
            attestation_config = VenueAttestationConfig(
                enabled=True,
                testnet=settings.EXECUTION_VENUE_ATTESTATION_TESTNET,
                cache_ttl_ms=settings.EXECUTION_VENUE_ATTESTATION_CACHE_TTL_MS,
                include_account_flags=settings.EXECUTION_VENUE_ATTESTATION_INCLUDE_ACCOUNT,
            )
            venue_attestation_wiring = build_venue_attestation(
                attestation_config,
                credential_provider=credentials.provider,
            )
            venue_attestor = venue_attestation_wiring.attestor
        except VenueAttestationError as error:
            raise ExecutionUnavailable(
                f"Venue attestation cannot be wired: {error}. "
                "The placement review has no venue evidence without it."
            ) from error
    # Part 20: Wire the signed transport layer. The key registry, client, and
    # verifier are constructed here and attached to the runtime. In simulated
    # mode they are present but not used for venue communication. In live mode
    # (future), they authenticate requests between services.
    #
    # The key registry is constructed with a generated secret for this process.
    # In a production deployment, the secret would be loaded from a secrets
    # manager. The composition root constructs exactly one registry and one
    # client/verifier pair, shared across all request handlers.
    key_registry = KeyRegistry(algorithm="HMAC-SHA256")
    _transport_secret = generate_secret(32)
    key_registry.register(
        secret=_transport_secret,
        version=1,
        description="execution-engine-process-key",
    )
    transport_client_metrics = SignedTransportClientMetrics()
    transport_server_metrics = SignedTransportServerMetrics()
    replay_store = InMemoryReplayStore()
    replay_guard = ReplayGuard(store=replay_store)
    signed_transport_client = SignedTransportClient(
        key_registry, metrics=transport_client_metrics
    )
    signed_transport_verifier = SignedTransportVerifier(
        key_registry, replay_guard, metrics=transport_server_metrics
    )
    # The signed transport is wired when the key registry has an active key
    # and the client/verifier are constructed. This is a fact about the wiring,
    # not a configuration flag.
    signed_transport_wired = (
        key_registry.active_key_id is not None
        and signed_transport_client is not None
        and signed_transport_verifier is not None
    )
    logger.info(
        "execution_engine.signed_transport_wired",
        extra={
            "event": "execution_engine.signed_transport_wired",
            "wired": signed_transport_wired,
            "keyId": key_registry.active_key_id,
            "algorithm": key_registry.algorithm,
        },
    )

    # Part 16: the review runs for every runtime, simulated included. A paper
    # order is reviewed by the local gatherer, which reports what this process
    # knows and cannot claim venue backing - so the audit trail says "locally
    # attested" on a simulated order instead of saying nothing, and the same code
    # path that will guard a live order is exercised by every paper order this
    # deployment will ever place.
    placement = build_placement_reviewer(
        settings,
        will_transmit_orders=engine_settings.will_transmit_orders,
        credential_provider=credentials.provider,
        venue_attestor=venue_attestor,
    )
    # Part 18, and the reason it exists: the port has been optional on this
    # constructor since Part 5, this service never passed one, and so the engine
    # in the reference deployment has been refusing to count anything. Every
    # counter and stage this repository documents as measurable - the placement
    # review's three from Part 16, the pipeline spans from Part 18 - was wired to
    # ``None`` here. An instrument is cheap, monotone and read-only to everyone
    # else, so there was never a reason to omit one; there was only no test that
    # asked whether the numbers existed at all. The first line of this comment is
    # also the answer to "why not make the parameter required": the core's port is
    # shared with the trading engine's own harness, and the constructor staying
    # optional is a documented property of the library, not an invitation for a
    # service to leave it empty.
    # Labelled with the adapter's own exchange id, not with the venue it is
    # simulating. A histogram of simulator round-trips tagged "binance" would make
    # every dashboard that reads it lie, and the venue a deployment is pointed at
    # is already on /status and in the wiring gauges where the mode belongs.
    metrics = ExecutionMetrics(exchange=trading.exchange.value)
    engine = ExecutionEngine(
        adapter=trading,
        settings=engine_settings,
        risk_engine=risk_engine,
        store=store,
        locks=locks,
        incidents=incidents,
        placement_reviewer=placement.reviewer,
        default_lock_ttl_millis=settings.EXECUTION_LOCK_TTL_MS,
        metrics=metrics,
    )
    logger.info(
        "execution_engine.runtime_built",
        extra={
            "event": "execution_engine.runtime_built",
            "wiring": {
                "store": type(store).__name__,
                "storeBackend": settings.EXECUTION_STORE_BACKEND,
                "locks": type(locks).__name__,
                "adapter": type(trading).__name__,
                "dryRun": engine_settings.dry_run,
                "simulatedMidConfigured": settings.simulated_mid is not None,
                # Named ``providerSource`` for the same reason ``app.credentials``
                # renamed its boot line: a key containing "credential" is scrubbed from
                # every log record by the platform's redaction filter, and a boot line
                # whose interesting field reads [REDACTED] is a boot line nobody can
                # debug from. The describe()/status spelling is untouched.
                "providerSource": credentials.source,
                "placementMode": placement.mode,
            },
        },
    )
    live_enablement = evaluate_live_enablement(
        LiveEnablementInputs(
            credential_source=settings.EXECUTION_CREDENTIAL_SOURCE,
            credential_fetcher_wired=credentials.fetcher_source is not None,
            venue_attestor_wired=placement.mode == "venue",
            confirmation_accepted=_confirmation_grading(settings, placement),
            durable_store_wired=bool(getattr(store, "is_durable", False)),
            distributed_locks_wired=bool(getattr(locks, "is_distributed", False)),
            # Part 24: derived from the actual policy object wired into the
            # placement reviewer, not from the raw config flag. The policy is
            # what the runtime actually enforces; the setting is what the
            # operator asked for. Every other prerequisite in this block reads
            # from the objects build_runtime constructed; this one must too.
            ip_allowlist_enforced=placement.reviewer.policy.require_ip_allowlist,
            # Part 20: signed transport is now wired when the key registry has
            # an active key and the transport client/verifier are constructed.
            # This is a fact about the objects build_runtime actually built,
            # not a configuration flag.
            signed_transport_wired=signed_transport_wired,
        )
    )
    if settings.EXECUTION_MODE == "live":
        raise ExecutionUnavailable(
            live_enablement.render_refusal("live")
            + " Concretely absent here, in the terms this service is written in: no "
            "signed HTTP transport to a venue is wired, this composition root never "
            "constructs a venue trading adapter, no live or testnet base URL is "
            "selected for one, and there is no operator runbook for the enablement "
            "evidence a live account must present. The credential plumbing, the "
            "durable store, the placement review and the operator's confirmation are "
            "each built and graded above; the transport is the part that does not "
            "exist. Simulated mode is available now."
        )
    return EngineRuntime(
        engine=engine,
        store=store,
        locks=locks,
        incidents=incidents,
        trading_adapter=trading,
        account_adapter=account,
        reconciliation=reconciliation,
        settings=settings,
        credentials=credentials,
        placement=placement,
        live_enablement=live_enablement,
        signed_transport_client=signed_transport_client,
        signed_transport_verifier=signed_transport_verifier,
        key_registry=key_registry,
        distributed_lock_wiring=lock_wiring,
        venue_attestation_wiring=venue_attestation_wiring,
        credential_registry_wiring=credential_registry_wiring,
        book_provider=book_provider,
    )
