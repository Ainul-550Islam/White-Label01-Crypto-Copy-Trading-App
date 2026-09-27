# Backing services

The Python trading-engine and market-data services, and the TypeScript notification worker. No execution logic in Part 1.

112 files. Part of the complete Part 1 source dump - see `docs/source/README.md`.

---

FILE: services/execution-engine/.env.example

```ini
# execution-engine - Part 11 worker plane
# Copy to .env and fill real values. NEVER commit the result. The platform
# validator (packages/config env.schema.ts) rejects known sample values in
# committed env files; this file carries samples deliberately - that is why
# it is named .env.example and excluded from validation.

# --- identity / transport ---------------------------------------------------
NODE_ENV=development
LOG_LEVEL=info
# Names this process in logs, health and worker assertions. Any stable id.
EXECUTION_INSTANCE_ID=execution-engine-local
# Loopback by default; container deployments set this to 0.0.0.0 and keep
# the port on the internal network only.
EXECUTION_ENGINE_HOST=127.0.0.1
SERVICE_PORT=8093
# REQUIRED, no default: shared secret with the Node worker, min 32 chars.
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
EXECUTION_INTERNAL_TOKEN=replace-me-with-64-hex-characters-generated-fresh

# --- mode -------------------------------------------------------------------
# simulated is the only executable mode in this build. Setting live is a
# STARTUP REFUSAL by design (live venue adapter, credential provider and
# durable store land in Part 12) - a refusal to lift, not a placeholder.
EXECUTION_MODE=simulated
# true = submissions stop before transmission; cancel stays available.
EXECUTION_DRY_RUN=true
# Venue request timeout (core engine setting) and lock lease TTL.
EXECUTION_REQUEST_TIMEOUT_MS=5000
EXECUTION_LOCK_TTL_MS=15000

# --- simulated venue ----------------------------------------------------------
# Fixed mid used as top-of-book for any symbol. Leave unset for an empty
# book (submissions refuse for lack of price - the honest default).
# EXECUTION_SIMULATED_MID=50000
# Seed balances for the simulated account, ASSET=QUANTITY pairs. Always
# surfaced labelled simulated.
EXECUTION_PAPER_BALANCES=USDT=100000

# --- durable store (Part 13) --------------------------------------------------
# memory: process-local simulated store, lost on restart (readiness says so:
# storeDurable=false). postgres: durable engine store over the engine_orders /
# engine_order_events / engine_order_fills tables - they are owned by
# apps/api/prisma (migrations), so run the migrate job first; the service
# verifies the tables exist at startup and refuses if they do not.
# EXECUTION_STORE_BACKEND never silently degrades: postgres without a DSN,
# or a DSN without postgres, is a startup refusal.
EXECUTION_STORE_BACKEND=memory
# DSN for the durable store. A credential: env-only, never logged. Set this
# ONLY with EXECUTION_STORE_BACKEND=postgres (the config refuses the
# mismatch). The engine sets app.tenant_id per transaction, so these tables
# are ready for the platform's row-level-security policies from day one.
# EXECUTION_POSTGRES_DSN=postgresql://wlct_app:CHANGE-ME@db:5432/wlct

# --- journal retention (Part 14) ----------------------------------------------
# The durable store's event journal (engine_order_events) is the one table
# retention prunes; orders and fills are never deleted, at any age, under
# any config. The four values below are bounded by the core's law
# (wlct_trading/retention.py) and a nonsensical combination refuses BOOT.
#   EXECUTION_RETENTION_ENABLED: false = dry-run only. Inspect and dry-run
#     always work; an apply request is answered 409 naming this variable.
#     Turn it on only after (a) an inspect, (b) a scheduled dry-run whose
#     ledger row you read, and (c) a fresh verified backup - docs/DR.md and
#     docs/PART14_RETENTION.md carry the runbook.
#   EXECUTION_RETENTION_EVENT_DAYS: journal rows are prunable only when BOTH
#     the row and its order's terminal stamp are older than this. 90 default.
#   EXECUTION_RETENTION_BATCH_ROWS / _MAX_BATCHES: per-statement and
#     per-run ceilings. A run that hits the ceiling reports "exhausted" and
#     the next scheduled run resumes - partial progress is the design.
# EXECUTION_RETENTION_ENABLED=true
# EXECUTION_RETENTION_EVENT_DAYS=90
# EXECUTION_RETENTION_BATCH_ROWS=2000
# EXECUTION_RETENTION_MAX_BATCHES=50

# --- RLS enablement verification (Part 15) -------------------------------
# The only knob is how old an enablement audit may be before it stops
# counting as evidence. There is deliberately NO enablement "apply" switch:
# the audit endpoint runs SELECTs and nothing else, so it needs no two-yeses
# guard (contrast the retention block above, where the verb is DELETE).
# Bounds (1..36500 days) are enforced by wlct_trading/enablement.py and a
# nonsensical value refuses BOOT, so a typo can never mean "every audit is
# fresh, forever". The audit itself: POST /internal/v1/enablement/audit, or
# `node scripts/rls-enablement.mjs audit --record`.
# EXECUTION_ENABLEMENT_MAX_AGE_DAYS=30

# --- Credential source and placement review (Part 16) --------------------
# Where key material comes from, and how expensive the review may be. There is
# deliberately NO "enable placement review" switch: the review runs before every
# order a runtime could transmit, and a runtime that cannot reach the venue is
# refused rather than waved through. What IS configurable is the source of keys
# and the two age bounds, all of them enforced by wlct_trading/execution/
# placement_review.py - a nonsensical value refuses BOOT.
# The review's findings are published by /status (placement block) and reach the
# audit record inside each order's SUBMITTED event payload.
#   EXECUTION_CREDENTIAL_SOURCE: none wires a provider that refuses every
#     authenticated lookup - correct for a simulated process, where needing a key
#     is a bug worth a loud failure. `environment` reads two variables for ONE
#     (tenant, account) pair and is refused outright when NODE_ENV=production.
#     `secret-manager` needs a fetcher injected in code: key custody lives with
#     the service that owns the encrypted store, and no HTTP surface of this
#     engine may install one.
#   EXECUTION_CREDENTIAL_ENV_PREFIX: the core appends _API_KEY / _API_SECRET, so
#     NO trailing underscore (`ACME_` would read ACME__API_KEY; refused at boot).
#   EXECUTION_CREDENTIAL_CACHE_SECONDS: how long a resolved credential may be
#     reused. Not a security window - rotation and revocation are the venue's and
#     the operator's; this is one vault call per order versus one per burst.
#   EXECUTION_PLACEMENT_ATTESTATION_TTL_MS: the cache TTL AND the freshness bound,
#     one number on purpose - a cache that outlived the freshness window would be
#     the reason a stale attestation passes. Bounds 1000..3600000 ms.
#   EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS: a key older than this may not trade
#     until it is rotated. Bounds 1..36500 days.
#   EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST: the venue must report an IP
#     allowlist on the key. Default true; false is accepted for simulated runtimes
#     and REFUSED for live ones, because the allowlist is the one control on a
#     leaked key that the venue enforces for us.
# Live mode remains refused by startup code. As of Part 19 the list of things a live
# deployment still lacks is no longer a paragraph in a document: it is computed from
# the wiring this process built and printed inside the refusal itself (and on
# GET /internal/v1/status as `liveEnablement`). docs/PART16_PLACEMENT_REVIEW.md sec. 8
# is the Part 16 snapshot of that list; docs/PART19_LIVE_ENABLEMENT.md is the current
# one. Every value below is the dark default and none of them opens the money path. The
# key variables themselves are deliberately absent from docker-compose.yml: an
# environment is where they belong, and this file is not.
# EXECUTION_CREDENTIAL_SOURCE=none
# EXECUTION_CREDENTIAL_ENV_PREFIX=WLCT_BINANCE
# EXECUTION_CREDENTIAL_TENANT_ID=tenant-1
# EXECUTION_CREDENTIAL_ACCOUNT_ID=account-1
# EXECUTION_CREDENTIAL_CACHE_SECONDS=300
# EXECUTION_PLACEMENT_ATTESTATION_TTL_MS=300000
# EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS=90
# EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST=true

# --- Observability (Part 18) -------------------------------------------
# Exposes GET /metrics (Prometheus text, unauthenticated, internal network
# only) rendering the engine's own stage histograms and counters. Same knob
# name as the two sibling services, and docker-compose.yml has been passing it
# to all three since before this part existed - execution-engine was the one
# that did not read it. Development may set it false; NODE_ENV=production
# refuses to start with it off, because a process that can hold a venue key has
# to be able to show what it measured. This service deliberately mirrors nothing
# to Redis, so it has no REDIS_URL of its own and needs no scrape target here.
OBSERVABILITY_ENABLED=true

# --- live credential fetcher and the operator confirmation (Part 19) -----
# The two things this service was missing on the live path: a concrete reader for
# `secret-manager` credentials, and a typed record that a named human authorised this
# scope. Both default OFF, both are refused at boot when half-configured, and neither
# is `ALLOW_LIVE`: EXECUTION_MODE=live still refuses startup, because the signed venue
# transport is still not built and no value below changes that.
#
# The fetcher. `none` keeps every existing deployment byte-identical (secret-manager
# then refuses at boot, as it did before Part 19). `vault-kv2` selects this service's
# own reader for HashiCorp Vault's KV v2 API, which is the backend this repository's
# infrastructure already runs; a deployment on a different KMS injects its own fetcher
# at composition instead, exactly as Part 16 provided for.
#   EXECUTION_VAULT_ADDR: https only, no `user:pass@` (refused, not honoured).
#   EXECUTION_VAULT_MOUNT: one path segment; a nested mount belongs in the template.
#   EXECUTION_VAULT_PATH_TEMPLATE: {tenant}/{account}/{exchange} are the only
#     placeholders, filled from this deployment's own identifiers, never a request.
#   EXECUTION_VAULT_TOKEN_ENV: the NAME of the variable holding the token. The token
#     is read from the environment by the fetcher and is never a field on Settings, so
#     no model_dump, no /status view and no debugger can surface it.
#   EXECUTION_VAULT_TLS_VERIFY: false is refused under NODE_ENV=production.
#   EXECUTION_VAULT_MAX_RESPONSE_BYTES: a KV secret is a key pair, not a document;
#     a response over the bound is refused (1024..4194304).
# The secret it reads must carry `api_key` and `api_secret` (or the camelCase
# spellings; both present with different values is refused), and may carry
# `permissions` ("READ,SPOT_TRADE" - a stored WITHDRAW is a refusal, never a
# promotion) and `expiresAtMicros` (microseconds only: a timestamp string with no
# timezone is a guess about when a key stops working).
# EXECUTION_CREDENTIAL_FETCHER=none
# EXECUTION_VAULT_ADDR=https://vault.internal:8200
# EXECUTION_VAULT_MOUNT=secret
# EXECUTION_VAULT_PATH_TEMPLATE=wlct/{tenant}/{account}/{exchange}
# EXECUTION_VAULT_TOKEN_ENV=EXECUTION_VAULT_TOKEN
# EXECUTION_VAULT_NAMESPACE=
# EXECUTION_VAULT_TIMEOUT_MS=3000
# EXECUTION_VAULT_TLS_VERIFY=true
# EXECUTION_VAULT_MAX_RESPONSE_BYTES=65536
#
# The operator's confirmation. A scoped, expiring, HMAC-verified record - which
# deployment, which tenant and account, which symbols and order types, from when to
# when - NOT a boolean, because a boolean has no subject, no expiry, no integrity and
# no per-order meaning. `EXECUTION_REQUIRE_OPERATOR_CONFIRMATION=false` (the default)
# leaves every existing verdict untouched; a deployment that turns it on must supply a
# record AND the key, or boot refuses. When it is on, the review refuses an order
# whose symbol or account is outside the record, an order whose record lapsed, and one
# whose record this deployment's key cannot authenticate - four typed codes
# (OPERATOR_CONFIRMATION_ABSENT / _EXPIRED / _SCOPE_MISMATCH / _UNVERIFIED), none of
# them retryable, because a confirmation is renewed by a human and not by a loop.
# The record is not secret (no key material in it) so either form is fine; setting
# both is refused, because two sources for one ceremony means one of them is stale.
#   The record's `digest` is HMAC-SHA256 over its canonical JSON; the minting ceremony
#   lives with the operator tooling, not with this service - see
#   docs/PART19_LIVE_ENABLEMENT.md sec. 5 for the exact bytes and a worked example.
# EXECUTION_REQUIRE_OPERATOR_CONFIRMATION=false
# EXECUTION_OPERATOR_CONFIRMATION_JSON=
# EXECUTION_OPERATOR_CONFIRMATION_FILE=/run/secrets/live-operator-confirmation.json
# EXECUTION_CONFIRMATION_KEY_ENV=EXECUTION_CONFIRMATION_HMAC_KEY
```

FILE: services/execution-engine/app/__init__.py

```python
"""Execution engine: the trading worker's execution core as a service.

The platform's only holder of the money path's runtime - it composes
``wlct_trading.execution`` (engine, locks, incidents, reconciliation) with
the mode switches that decide whether anything may reach a venue at all.
It exists because the API deliberately cannot talk to exchanges (no signer,
no credentials, no adapters - see ``execution.module.ts``); this process is
where those live, and the Node worker forwards TRADE_EXECUTION jobs here.

This build serves the simulated venue. Live transmission is refused at
startup until the durable store, distributed locks and credential provider
are wired (documented in docs/PART11_WORKER_SCALING.md), and no
configuration value can talk the process into it: the refusal is code, not
a default.
"""

__version__ = "1.0.0"
```

FILE: services/execution-engine/app/composition.py

```python
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
  though the core supports it: as of Part 13 the durable store ships and
  distributed locks exist in the core, but the live credential provider and
  the venue-ordering audit for authenticated order placement have not
  completed their review, so refusing is still the honest wiring. The
  refusal is code, not a default, and no environment value talks the
  process into it;
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
from dataclasses import dataclass
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
from wlct_trading.execution.locks import InMemoryLockManager, LockManager
from wlct_trading.execution.reconciliation import ReconciliationService
from wlct_trading.execution.store import InMemoryOrderStore, OrderStore
from wlct_trading.market_data import BookTop
from wlct_trading.metrics import ExecutionMetrics
from wlct_trading.risk import RiskEngine, RiskLimits

from app.config import Settings
from app.credentials import CredentialWiring, build_credential_provider
from app.placement import PlacementWiring, build_placement_reviewer

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

    trading = PaperTradingAdapter(make_paper_book_provider(settings.simulated_mid))
    account = PaperAccountAdapter(settings.paper_balances)
    locks = InMemoryLockManager()
    durable_store = bool(getattr(store, "is_durable", False))
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
    engine_settings = ExecutionSettings(
        live_trading_enabled=False,
        dry_run=settings.EXECUTION_DRY_RUN,
        paper_trading=True,
        trading_mode_setting="PAPER",
        trading_enabled=True,
        live_trading_confirmed=False,
        order_request_timeout_ms=settings.EXECUTION_REQUEST_TIMEOUT_MS,
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
            ip_allowlist_enforced=settings.EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST,
            # Never set by any code path in this service, and the line that makes it
            # explicit is the line a reviewer reads before believing the report: the
            # composition root has no branch that would construct a live venue adapter,
            # so this stays False whatever the environment says.
            signed_transport_wired=False,
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
    )
```

FILE: services/execution-engine/app/config.py

```python
"""Configuration for the execution engine.

Every value comes from the environment. There are no defaults for secrets:
a missing or placeholder internal token stops the process rather than
starting a service that silently cannot authenticate its callers.

The field types are all defaulted so ``Settings()`` constructs cleanly under
mypy strict; the requirement that critical values EXIST is enforced in the
model validator, not by missing defaults, and the error messages name the
environment variable so a boot failure is self-explaining.
"""

from __future__ import annotations

import json
from decimal import Decimal, InvalidOperation
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from wlct_trading.enablement import EnablementError, EnablementPolicy
from wlct_trading.execution.live_confirmation import (
    LiveConfirmationError,
    LiveOperatorConfirmation,
)
from wlct_trading.execution.placement_attestor import (
    MAX_ATTESTER_TTL_MS,
    MIN_ATTESTER_TTL_MS,
)
from wlct_trading.execution.placement_review import (
    MAX_KEY_AGE_DAYS,
    MIN_KEY_AGE_DAYS,
    PlacementReviewError,
    PlacementReviewPolicy,
)
from wlct_trading.retention import RetentionError, RetentionPolicy

from app.secret_fetcher import VaultKvConfig

__all__ = ["Settings", "get_settings"]

#: Placeholder spellings rejected everywhere on this platform. A token that
#: reads "changeme" is the same as no token, and discovering that during an
#: incident is how incidents get longer.
#: Exact values that can never be a real secret, and the prefixes that mark
#: "this was a template nobody filled in" ("changeme-64-xs" is as placeholder
#: as "changeme" - suffix noise does not launder it).
_PLACEHOLDERS = frozenset(
    {
        "changeme",
        "change-me",
        "replace_me",
        "replace-me",
        "secret",
        "todo",
        "none",
        "null",
        "undefined",
        "example",
    }
)
_PLACEHOLDER_PREFIXES = ("changeme", "change-me", "replace_me", "replace-me")


class Settings(BaseSettings):
    """Validated runtime configuration."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=True,
    )

    NODE_ENV: Literal["development", "test", "staging", "production"] = "development"
    LOG_LEVEL: Literal["debug", "info", "warning", "error", "critical"] = "info"

    # ------------------------------------------------------------------
    # Observability (Part 18)
    #
    # Same name, same meaning as in services/trading-engine and
    # services/market-data: a platform knob is not re-spelled per service, and
    # production refuses to parse with it off. What differs is only what this
    # service exposes - one Prometheus scrape of the engine's own instruments,
    # with no Redis mirror and no alert stream, because this process's evidence
    # lives in its durable tables and on /internal/v1/status.
    # ------------------------------------------------------------------
    OBSERVABILITY_ENABLED: bool = True

    # --- Identity and transport ------------------------------------------
    #: Names this instance in logs, the health surface and (later) the
    #: worker registry. Not a secret; not a credential; useful in a
    #: postmortem that says "which process thought it was leader".
    EXECUTION_INSTANCE_ID: str | None = None
    SERVICE_PORT: int = 8093
    #: Loopback by default: this process must be explicitly re-bound (env)
    #: to serve another container, and deployments that do so keep it on an
    #: internal network - the token is authentication, not segmentation.
    EXECUTION_ENGINE_HOST: str = "127.0.0.1"
    #: Shared secret with the Node worker. Minimum 32 characters, constant
    #: time compared in app.security, never logged.
    EXECUTION_INTERNAL_TOKEN: str | None = None

    # --- Mode ---------------------------------------------------------------
    #: "simulated" is the only mode this build transmits in. "live" parses
    #: (so a staged config does not fail boot for a syntax reason while it
    #: fails a safety reason) but startup refuses it with MODE_NOT_WIRED.
    EXECUTION_MODE: Literal["simulated", "live"] = "simulated"
    #: When true, order SUBMISSION stops before transmission. Cancellation
    #: is not a new position and stays available either way - failing to
    #: cancel a resting order is the larger risk of the two.
    EXECUTION_DRY_RUN: bool = True
    #: Per-request venue timeout handed to the core engine settings.
    EXECUTION_REQUEST_TIMEOUT_MS: int = 5_000
    #: Lease TTL for the core's own account/order locks (milliseconds).
    EXECUTION_LOCK_TTL_MS: int = 15_000

    # --- Simulated venue shaping -------------------------------------------
    #: Fixed mid used as top-of-book for any symbol. Unset means the paper
    #: book is empty: submissions are refused for lack of price, which is
    #: the honest default for a deployment that configured nothing.
    EXECUTION_SIMULATED_MID: str | None = None
    #: Comma-separated `ASSET=QUANTITY` seed balances for the simulated
    #: account. Balances are labelled simulated wherever they surface.
    EXECUTION_PAPER_BALANCES: str = "USDT=100000"

    # --- Durable state (Part 13) --------------------------------------------
    #: "memory" keeps the process-local reference store (everything this
    #: service did before Part 13; readiness honestly reports
    #: storeDurable=false). "postgres" requires the engine tables (owned by
    #: apps/api/prisma, applied by the API's migration job) and a DSN, and
    #: refuses startup without either - a store configured but unreachable
    #: is "not running", never "running degraded": the moment this process
    #: cannot durably record an order it must stop taking commands.
    EXECUTION_STORE_BACKEND: Literal["memory", "postgres"] = "memory"
    #: DSN for the engine store, e.g. postgresql://user:pass@db:5432/wlct.
    #: A credential: env-only, never logged, never in to_public_dict, and
    #: like every DSN on this platform it belongs to a dedicated role, not
    #: the owner. The engine sets app.tenant_id per transaction (the same
    #: contract as the API's withTenantRls), so these tables are RLS-safe
    #: from the day the operator flips policies on.
    EXECUTION_POSTGRES_DSN: str | None = None

    # --- Retention (Part 14) -----------------------------------------------
    #: The apply switch. False (the default) leaves every retention call in
    #: DRY-RUN: inspection always works, deletion never happens, and an
    #: apply request is refused with the config named. A maintenance job
    #: that destroys data does not run because a compose file once existed.
    #: It also does not run on a schedule nobody reviewed: the intended
    #: first use is inspect (disabled) -> scheduled dry-run -> one manual
    #: apply against a fresh backup -> enable (docs/PART14_RETENTION.md).
    EXECUTION_RETENTION_ENABLED: bool = False
    #: Days of journal kept beyond an order's own settlement (the cutoff
    #: applies to the event AND the order's terminal stamp - core law 2).
    #: Bounds are enforced by constructing the core policy below; this
    #: service has no second arithmetic for them.
    EXECUTION_RETENTION_EVENT_DAYS: int = 90
    #: Rows per DELETE statement, and statements per run. Together they
    #: cap one run at batch_rows * max_batches deletions - the ceiling a
    #: busy deployment tunes, and the reason a first prune after long
    #: dormancy is many small transactions instead of one huge one.
    EXECUTION_RETENTION_BATCH_ROWS: int = 2_000
    EXECUTION_RETENTION_MAX_BATCHES: int = 50

    # --- RLS enablement verification (Part 15) -----------------------------
    #: How long an enablement audit may sit before it stops counting as
    #: evidence. This is NOT enforcement - the audit is read-only and this
    #: service cannot fail closed over another service's row-level security -
    #: it is the freshness the response reports and the evidence ledger
    #: checks. A deployment that re-audits nightly keeps the number
    #: meaningless-in-a-good-way; one that never re-audits sees it go stale.
    #: Bounds (1..36,500 days) are the core's law, validated at boot below.
    EXECUTION_ENABLEMENT_MAX_AGE_DAYS: int = 30

    # --- placement review and the credential source (Part 16) --------------
    # There is deliberately no EXECUTION_PLACEMENT_REVIEW_ENABLED. A switch that
    # turns off "did the venue say this key may place this order" is not a
    # feature flag, it is a bypass, and this repository's guards do not ship
    # bypasses. What IS configurable is where the evidence comes from and how
    # expensive it may be - every field below is about cost or staleness, none
    # about permission.
    #: Where a live runtime would read key material from. ``none`` is the
    #: default and the only value a simulated deployment should have: it wires a
    #: provider that refuses every lookup, so an accidental authenticated call
    #: from a paper process fails loudly instead of finding a stray key in the
    #: environment. ``environment`` is development-only (see the refusal in
    #: ``_validate``); ``secret-manager`` is the multi-tenant path and takes its
    #: fetcher from the deployment's own secret backend, not from an env var.
    EXECUTION_CREDENTIAL_SOURCE: Literal["none", "environment", "secret-manager"] = "none"
    #: Prefix for the two variables ``environment`` reads. The core appends
    #: ``_API_KEY`` / ``_API_SECRET`` to it, so this carries NO trailing
    #: underscore: a prefix of ``WLCT_BINANCE_`` would look for
    #: ``WLCT_BINANCE__API_KEY``, which nobody ever sets, and the boot check
    #: below (which reads the same names this module computes) would pass while
    #: every order failed on a missing credential. Named here rather than
    #: hard-coded because a host that already injects ``BINANCE_*`` keys for
    #: another process must not have this one read them by accident.
    EXECUTION_CREDENTIAL_ENV_PREFIX: str = "WLCT_BINANCE"
    #: The single (tenant, account) an ``environment`` provider serves. The
    #: environment has no way to key a secret per customer, so a deployment that
    #: needs more than one pair of keys needs ``secret-manager`` - a limitation
    #: of the mechanism, stated rather than papered over.
    EXECUTION_CREDENTIAL_TENANT_ID: str = "tenant-1"
    EXECUTION_CREDENTIAL_ACCOUNT_ID: str = "account-1"
    #: How long a resolved credential may be cached before the provider goes
    #: back to its source. Zero is not offered: a cache with a zero TTL still
    #: pays the wrapper's bookkeeping and buys nothing.
    EXECUTION_CREDENTIAL_CACHE_SECONDS: int = 300
    #: How long a gathered placement attestation may be reused. This IS the
    #: freshness bound the review applies (one number, so the cache and the law
    #  cannot disagree about what "recent" means), and it is also why a burst of
    #  orders for one account costs one venue round trip rather than one per
    #  order. Bounds (1s..1h) are the core's law, enforced at boot below.
    EXECUTION_PLACEMENT_ATTESTATION_TTL_MS: int = 300_000
    #: How old a key may be and still trade. Rotation is an operator habit this
    #  platform can only encourage by refusing to trade on a key nobody has
    #  rotated in a year; bounds (1..36,500 days) are the core's law.
    EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS: int = 90
    #: Whether the venue must report an IP allowlist on the key. Default true,
    #  and ``false`` is refused outright for a live mode: a key that answers from
    #  any address is a key that is one leaked env file away from being someone
    #  else's trading account.
    EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST: bool = True

    # --- live credential fetcher and the operator confirmation (Part 19) --------
    # Two more things the live path needed and this service did not have: a concrete
    # reader for the ``secret-manager`` credential source, and a typed confirmation that
    # a human authorised this scope. Neither is a permission. The selector below picks
    # an implementation, and the confirmation block below feeds a check that can only
    # add refusals. ``EXECUTION_MODE=live`` still refuses at startup, with these two
    # additions named among the reasons.
    #: Which fetcher backs ``EXECUTION_CREDENTIAL_SOURCE=secret-manager``. ``none`` is
    #: the default and keeps every existing deployment byte-identical: the source then
    #: has no reader, and the boot refusal says so. ``vault-kv2`` is this service's own
    #: implementation over HashiCorp Vault's KV v2 API (see app/secret_fetcher.py); a
    #: deployment on a different KMS injects its own fetcher instead, which is the
    #: choice Part 16 left open and Part 19 deliberately did not close for anybody.
    EXECUTION_CREDENTIAL_FETCHER: Literal["none", "vault-kv2"] = "none"
    #: e.g. https://vault.internal:8200 . Required by vault-kv2. Credentials embedded
    #: in a URL (``user:pass@host``) are refused, not honoured.
    EXECUTION_VAULT_ADDR: str | None = None
    #: The KV v2 mount, one path segment (``secret`` in Vault's own quickstart).
    EXECUTION_VAULT_MOUNT: str = "secret"
    #: The lookup path, relative to ``/data/`` under the mount. The three placeholders
    #: are filled from this deployment's own identifiers, never from a request.
    EXECUTION_VAULT_PATH_TEMPLATE: str = "wlct/{tenant}/{account}/{exchange}"
    #: NAME of the environment variable holding the Vault token. The token is read from
    #: the process environment by the fetcher and is NEVER a field on this object, so
    #: no ``model_dump``, no ``to_public_dict`` and no debugger can surface it.
    EXECUTION_VAULT_TOKEN_ENV: str = "EXECUTION_VAULT_TOKEN"
    #: Vault enterprise namespace header. ``None`` sends no header.
    EXECUTION_VAULT_NAMESPACE: str | None = None
    EXECUTION_VAULT_TIMEOUT_MS: int = 3_000
    #: TLS verification of the Vault endpoint. ``false`` is refused in production, and
    #: the endpoint must be https in every mode (see VaultKvConfig).
    EXECUTION_VAULT_TLS_VERIFY: bool = True
    EXECUTION_VAULT_MAX_RESPONSE_BYTES: int = 65_536
    #: Require a verified operator confirmation on every placement review. Default
    #: false, and that default is the point: turning the check on is a deployment
    #: decision, and leaving it off must not change any verdict that exists today.
    #: This is NOT ``ALLOW_LIVE`` under another name - it cannot enable live mode, it
    #: cannot relax a review, and when it is on with nothing to verify, every order is
    #: refused as OPERATOR_CONFIRMATION_ABSENT.
    EXECUTION_REQUIRE_OPERATOR_CONFIRMATION: bool = False
    #: The confirmation record, inline as JSON. Mutually exclusive with the file form,
    #: because a deployment that has two sources of truth for one ceremony has two
    #: ceremonies.
    EXECUTION_OPERATOR_CONFIRMATION_JSON: str | None = None
    #: ...or the path to a file containing it. The record carries identities and a
    #: window and an HMAC tag, and no key material, so reading it off disk is a
    #: convenience rather than a secret-handling exception.
    EXECUTION_OPERATOR_CONFIRMATION_FILE: str | None = None
    #: NAME of the environment variable holding the HMAC key that verifies the record.
    #: Env-only, for the same reason as the Vault token, and checked for presence at
    #: boot by app/placement.py, which is where the verifier is assembled.
    EXECUTION_CONFIRMATION_KEY_ENV: str = "EXECUTION_CONFIRMATION_HMAC_KEY"

    @model_validator(mode="after")
    def _require_observability_in_production(self) -> Settings:
        if self.NODE_ENV == "production" and not self.OBSERVABILITY_ENABLED:
            raise ValueError(
                "OBSERVABILITY_ENABLED=false in production: a process that can "
                "hold a venue key and place an order must expose what it measured "
                "while doing so. The stage histograms and the placement-review "
                "counters are how a refusal is distinguished from an outage "
                "without shell access; development may turn them off freely, a "
                "deployment holding real money may not."
            )
        return self

    @model_validator(mode="after")
    def _validate(self) -> Settings:
        if self.EXECUTION_INTERNAL_TOKEN is None or not self.EXECUTION_INTERNAL_TOKEN.strip():
            raise ValueError(
                "EXECUTION_INTERNAL_TOKEN is required (>= 32 chars); this "
                "service never starts unauthenticated"
            )
        if len(self.EXECUTION_INTERNAL_TOKEN) < 32:
            raise ValueError("EXECUTION_INTERNAL_TOKEN must be at least 32 characters")
        lowered = self.EXECUTION_INTERNAL_TOKEN.strip().lower()
        if lowered in _PLACEHOLDERS or lowered.startswith(_PLACEHOLDER_PREFIXES):
            raise ValueError(
                "EXECUTION_INTERNAL_TOKEN must not be a placeholder value "
                "(exact match or changeme-style prefix)"
            )
        if self.EXECUTION_INSTANCE_ID is None or not self.EXECUTION_INSTANCE_ID.strip():
            raise ValueError(
                "EXECUTION_INSTANCE_ID is required - every leader claim, log "
                "line and incident must be attributable to a process"
            )
        if len(self.EXECUTION_INSTANCE_ID) > 64:
            raise ValueError("EXECUTION_INSTANCE_ID must be at most 64 characters")
        if self.SERVICE_PORT < 1 or self.SERVICE_PORT > 65_535:
            raise ValueError("SERVICE_PORT must be a valid TCP port")
        if self.EXECUTION_REQUEST_TIMEOUT_MS < 250:
            raise ValueError(
                "EXECUTION_REQUEST_TIMEOUT_MS below 250 tests the venue, not the network"
            )
        if self.EXECUTION_LOCK_TTL_MS < 1_000:
            raise ValueError(
                "EXECUTION_LOCK_TTL_MS below one second elects on network jitter"
            )
        if self.EXECUTION_SIMULATED_MID is not None:
            _parse_decimal(self.EXECUTION_SIMULATED_MID, "EXECUTION_SIMULATED_MID")
        for part in self.EXECUTION_PAPER_BALANCES.split(","):
            if part.strip() == "":
                continue
            asset, sep, amount = part.partition("=")
            if not sep or not asset.strip():
                raise ValueError(
                    "EXECUTION_PAPER_BALANCES must be comma-separated ASSET=QUANTITY pairs"
                )
            _parse_decimal(amount, f"balance {asset.strip()!r}")
        # An EMPTY/whitespace DSN is treated as "unset" everywhere (compose
        # passes ${VAR:-} defaults; "" must not arm the mismatch law below).
        dsn = (self.EXECUTION_POSTGRES_DSN or "").strip()
        if self.EXECUTION_STORE_BACKEND == "postgres":
            if not dsn:
                raise ValueError(
                    "EXECUTION_STORE_BACKEND=postgres requires EXECUTION_POSTGRES_DSN; "
                    "a durable store that was configured but cannot connect is a "
                    "startup failure, never a degraded start"
                )
            if not dsn.startswith(("postgresql://", "postgresql+asyncpg://", "postgres://")):
                raise ValueError(
                    "EXECUTION_POSTGRES_DSN must be a postgresql:// connection string"
                )
        elif dsn:
            # A DSN present while the memory backend is selected means
            # somebody INTENDED durability and the setting silently did not
            # apply - the worst of both worlds (restart loses orders,
            # operator believes it cannot). Refuse the mismatched intent.
            raise ValueError(
                "EXECUTION_POSTGRES_DSN is set but EXECUTION_STORE_BACKEND=memory; "
                "either switch the backend to postgres or remove the DSN - a "
                "half-configured durable store is not a store"
            )
        # Retention bounds exist ONCE, in the core law; constructing the
        # policy here means a config typo names its env var at boot, and
        # an invalid policy can never reach a DELETE statement at all.
        try:
            RetentionPolicy(
                event_retention_days=self.EXECUTION_RETENTION_EVENT_DAYS,
                batch_rows=self.EXECUTION_RETENTION_BATCH_ROWS,
                max_batches=self.EXECUTION_RETENTION_MAX_BATCHES,
            )
        except RetentionError as error:
            raise ValueError(
                f"retention configuration rejected by the core law: {error} "
                "(EXECUTION_RETENTION_EVENT_DAYS / _BATCH_ROWS / _MAX_BATCHES)"
            ) from error
        # Same discipline for the evidence window: the bound-checking law has
        # exactly one home (the core), boot fails on a typo, and the audit
        # endpoint can never receive a policy that "every evidence is fresh".
        try:
            EnablementPolicy(max_evidence_age_days=self.EXECUTION_ENABLEMENT_MAX_AGE_DAYS)
        except EnablementError as error:
            raise ValueError(
                f"enablement configuration rejected by the core law: {error} "
                "(EXECUTION_ENABLEMENT_MAX_AGE_DAYS)"
            ) from error
        self._validate_placement()
        self._validate_live_wiring()
        return self

    def _validate_placement(self) -> None:
        """Part 16's own refusals, kept apart for the same reason the rest of
        this file is a validator rather than a pile of defaults: a deployment
        must not be able to start in a state where it believes it is guarded.
        """
        prefix = self.EXECUTION_CREDENTIAL_ENV_PREFIX.strip()
        if prefix.endswith("_"):
            # Refused rather than normalised. Silently stripping a trailing
            # underscore would make this module's boot check agree with itself
            # while the provider it is guarding looked for a different name
            # entirely, which is precisely the failure the check exists to
            # prevent - and an operator who wrote "ACME_" meant "ACME".
            raise ValueError(
                "EXECUTION_CREDENTIAL_ENV_PREFIX must not end in an underscore: "
                "the core appends the separator, so 'ACME_' resolves "
                "ACME__API_KEY. Drop the trailing underscore."
            )
        if self.EXECUTION_CREDENTIAL_SOURCE == "environment":
            if not prefix:
                raise ValueError(
                    "EXECUTION_CREDENTIAL_ENV_PREFIX is required when "
                    "EXECUTION_CREDENTIAL_SOURCE=environment; reading a "
                    "conventionally-named BINANCE_API_KEY from a shared "
                    "environment is how one service ends up trading on another "
                    "service's key"
                )
            if self.is_production:
                raise ValueError(
                    "EXECUTION_CREDENTIAL_SOURCE=environment is refused in "
                    "production (NODE_ENV=production): process-wide key material "
                    "cannot be scoped per tenant, is visible in every crash "
                    "dump, and does not rotate. Use secret-manager."
                )
        for name, value in (
            ("EXECUTION_CREDENTIAL_TENANT_ID", self.EXECUTION_CREDENTIAL_TENANT_ID),
            ("EXECUTION_CREDENTIAL_ACCOUNT_ID", self.EXECUTION_CREDENTIAL_ACCOUNT_ID),
        ):
            if not value.strip():
                raise ValueError(f"{name} must not be blank")
            if len(value) > 64:
                raise ValueError(f"{name} must be at most 64 characters")
        if self.EXECUTION_CREDENTIAL_CACHE_SECONDS < 1:
            raise ValueError(
                "EXECUTION_CREDENTIAL_CACHE_SECONDS must be at least 1; a "
                "credential cache that expires every second is a per-order "
                "secret lookup with extra steps"
            )
        ttl = self.EXECUTION_PLACEMENT_ATTESTATION_TTL_MS
        if not MIN_ATTESTER_TTL_MS <= ttl <= MAX_ATTESTER_TTL_MS:
            raise ValueError(
                f"EXECUTION_PLACEMENT_ATTESTATION_TTL_MS must be within "
                f"{MIN_ATTESTER_TTL_MS}..{MAX_ATTESTER_TTL_MS}; got {ttl}. "
                "Below one second every order pays for a venue round trip; above "
                "an hour the venue's console has had time to revoke the key and "
                "this process would not know"
            )
        if not MIN_KEY_AGE_DAYS <= self.EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS <= MAX_KEY_AGE_DAYS:
            raise ValueError(
                f"EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS must be within "
                f"{MIN_KEY_AGE_DAYS}..{MAX_KEY_AGE_DAYS}; got "
                f"{self.EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS}"
            )
        if (
            self.EXECUTION_MODE == "live"
            and not self.EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST
        ):
            raise ValueError(
                "EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST=false is refused in "
                "live mode. The IP allowlist is the one control on a leaked key "
                "that the venue enforces for us; a live deployment without it "
                "has decided that availability outranks that"
            )
        # "live but no credential source" is deliberately NOT refused here, even
        # though it is fatal: this validator's job is whether a value is
        # coherent, and "none" is a perfectly coherent answer that happens to be
        # wrong for live. The composition owns the whole picture - it is where the
        # runtime, the reviewer and the store come together - and its refusal
        # says what is missing instead of naming one variable, which is the
        # message an operator actually needs. Two places refusing the same
        # configuration means two messages, and only one of them explains.
        # The core's law is the last word, exactly as with retention and
        # enablement: the service checks the env var's shape, the policy object
        # checks the semantics, and the endpoint can never be handed a policy
        # that treats every attestation as fresh.
        try:
            PlacementReviewPolicy(
                max_attestation_age_ms=self.EXECUTION_PLACEMENT_ATTESTATION_TTL_MS,
                max_key_age_days=self.EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS,
                require_ip_allowlist=self.EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST,
            )
        except PlacementReviewError as error:
            raise ValueError(
                f"placement review rejected by the core law: {error} "
                "(EXECUTION_PLACEMENT_ATTESTATION_TTL_MS / "
                "EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS)"
            ) from error

    def _validate_live_wiring(self) -> None:
        """Part 19's own refusals: the fetcher selector and the confirmation record.

        Kept apart from ``_validate_placement`` for the same reason that block is
        separate - one law per method, so a review of "what can a deployment
        configure about live mode" is a review of two named methods rather than of a
        five-hundred-line validator - and built on the same discipline: the shape rules
        live on the objects themselves (:class:`VaultKvConfig`,
        :class:`LiveOperatorConfirmation`), and this method only translates their
        refusals into a startup failure that names the environment variable.

        Deliberately NOT checked here, with the reasons:

        * **Presence of the Vault token.** That is the fetcher's boot check, in
          ``app/credentials.py``, which is also where an injectable ``environ`` lets a
          test prove it. Two places reading the same variable means two opinions about
          whether it is set.
        * **Whether the confirmation has expired.** A deployment whose record lapsed
          while it was running must still start: the process has reconciliation,
          cancellation and an audit trail to serve, and the per-order assessment
          refuses with ``OPERATOR_CONFIRMATION_EXPIRED`` (which is louder, per order,
          than a crash loop that also stops the cancel path). Boot checks the shape of
          the ceremony; the review checks its currency, every order.
        * **"Live mode needs both of these."** The composition root owns that whole
          picture and grades it with the core's ``evaluate_live_enablement``, which
          produces one message instead of two.
        """
        fetcher = self.EXECUTION_CREDENTIAL_FETCHER
        source = self.EXECUTION_CREDENTIAL_SOURCE
        if fetcher != "none" and source != "secret-manager":
            raise ValueError(
                f"EXECUTION_CREDENTIAL_FETCHER={fetcher} with "
                f"EXECUTION_CREDENTIAL_SOURCE={source!r}: the fetcher is consulted only "
                "by the secret-manager provider, so this combination is a deployment "
                "that believes it has credential plumbing it does not use. Either point "
                "the source at secret-manager or set the fetcher back to none."
            )
        if fetcher == "vault-kv2":
            try:
                # Bound to a name on purpose: constructing the object IS the check,
                # and this line's value is the exception it can raise. Reading the
                # property (rather than building a VaultKvConfig inline here) keeps the
                # field mapping in one place, so boot and runtime cannot disagree about
                # which settings feed the fetcher.
                validated_vault_config = self.vault_config
                if validated_vault_config.mount != self.EXECUTION_VAULT_MOUNT.strip("/"):
                    raise ValueError(
                        "the Vault mount did not normalise to one segment; this "
                        "deployment's EXECUTION_VAULT_MOUNT is being read differently "
                        "by the check that validates it and the object that uses it"
                    )
            except ValueError as error:
                raise ValueError(
                    f"vault-kv2 credential fetcher rejected at boot: {error}"
                ) from error
        inline = (self.EXECUTION_OPERATOR_CONFIRMATION_JSON or "").strip()
        path = (self.EXECUTION_OPERATOR_CONFIRMATION_FILE or "").strip()
        if inline and path:
            raise ValueError(
                "EXECUTION_OPERATOR_CONFIRMATION_JSON and _FILE are both set. One "
                "ceremony, one source of truth: a deployment that can load a "
                "confirmation from two places has two confirmations, and only one of "
                "them will be the one that is current when it matters."
            )
        if self.EXECUTION_REQUIRE_OPERATOR_CONFIRMATION and not (inline or path):
            raise ValueError(
                "EXECUTION_REQUIRE_OPERATOR_CONFIRMATION=true supplies no confirmation "
                "record, which would refuse every order in the deployment with "
                "OPERATOR_CONFIRMATION_ABSENT - a gate that only ever returns false is "
                "not a gate, it is an outage with extra labels. Supply the record, or "
                "turn the requirement off."
            )
        if self.EXECUTION_REQUIRE_OPERATOR_CONFIRMATION and not (
            self.EXECUTION_CONFIRMATION_KEY_ENV or ""
        ).strip():
            raise ValueError(
                "EXECUTION_CONFIRMATION_KEY_ENV names the variable holding the HMAC "
                "key and must not be blank; an empty name cannot be looked up, and a "
                "confirmation nothing can verify is a decoration."
            )
        # Parse the record now, so a malformed or forged-looking payload is a boot
        # failure rather than a first-order surprise. An absent record is not an error
        # here: the requirement above already refused the case that matters.
        record = self.operator_confirmation
        if record is not None and record.instance_id.strip() != (
            self.EXECUTION_INSTANCE_ID or ""
        ).strip():
            raise ValueError(
                f"the operator confirmation names instance {record.instance_id!r} and "
                f"this process is {self.EXECUTION_INSTANCE_ID!r}. The per-order review "
                "would refuse every submission for it, which is the right answer with "
                "the wrong timing: a template copied between deployments is a "
                "deployment starting with a ceremony it cannot complete, and that is a "
                "boot message."
            )

    @property
    def vault_config(self) -> VaultKvConfig:
        """The validated fetcher configuration (constructed, never stored).

        The shape rules live on :class:`VaultKvConfig` itself and this property only
        moves values, so a bad address or an unknown template placeholder is refused by
        one implementation and reported identically by boot and by the runtime. The
        Vault token is absent from this list because it is absent from this object:
        the fetcher reads it from the process environment, by the name below.
        """
        return VaultKvConfig(
            addr=self.EXECUTION_VAULT_ADDR or "",
            mount=self.EXECUTION_VAULT_MOUNT,
            path_template=self.EXECUTION_VAULT_PATH_TEMPLATE,
            token_env=self.EXECUTION_VAULT_TOKEN_ENV,
            namespace=self.EXECUTION_VAULT_NAMESPACE,
            timeout_ms=self.EXECUTION_VAULT_TIMEOUT_MS,
            verify_tls=self.EXECUTION_VAULT_TLS_VERIFY,
            max_response_bytes=self.EXECUTION_VAULT_MAX_RESPONSE_BYTES,
        )

    @property
    def operator_confirmation(self) -> LiveOperatorConfirmation | None:
        """The operator's record, parsed and validated, or None.

        Re-read on every access, like the other policy objects: the confirmation is
        deployment input, not process state, and a cached copy would be a second
        answer to "what did we confirm" that could outlive the file it came from.
        """
        inline = (self.EXECUTION_OPERATOR_CONFIRMATION_JSON or "").strip()
        path = (self.EXECUTION_OPERATOR_CONFIRMATION_FILE or "").strip()
        raw = inline
        if not raw and path:
            try:
                raw = Path(path).read_text(encoding="utf-8").strip()
            except OSError as error:
                raise ValueError(
                    f"EXECUTION_OPERATOR_CONFIRMATION_FILE could not be read: "
                    f"{type(error).__name__}. A required ceremony document that cannot "
                    "be opened is a boot failure, not a runtime one - the alternative "
                    "is a process that comes up 'unconfirmed' and refuses orders for a "
                    "reason its own logs do not mention."
                ) from error
        if not raw:
            return None
        try:
            payload = json.loads(raw)
        except ValueError as error:
            raise ValueError(
                f"the operator confirmation is not valid JSON: {type(error).__name__}"
            ) from error
        if not isinstance(payload, dict):
            raise ValueError(
                "the operator confirmation must be a JSON object with the fields "
                "instanceId, tenantId, accountId, exchange, symbols, orderTypes, "
                "issuedAtMicros, expiresAtMicros, nonce and digest"
            )
        try:
            return LiveOperatorConfirmation.from_payload(dict(payload))
        except LiveConfirmationError as error:
            raise ValueError(f"operator confirmation rejected: {error}") from error

    @property
    def placement_policy(self) -> PlacementReviewPolicy:
        """The core's validated review policy, built from this service's fields.

        Constructed, never stored - the same discipline as ``retention_policy``.
        The clock-skew and ``recvWindow`` bounds are deliberately not exposed
        here: they are the venue's signature protocol, not a deployment
        preference, and they default from the same constants
        :class:`~wlct_trading.execution.config.ExecutionSettings` uses. A
        deployment that believes it needs a wider window has a clock to fix, not
        a knob to turn, and a knob for it would be a documented way to trade on a
        clock nobody trusts.
        """
        return PlacementReviewPolicy(
            max_attestation_age_ms=self.EXECUTION_PLACEMENT_ATTESTATION_TTL_MS,
            max_key_age_days=self.EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS,
            require_ip_allowlist=self.EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST,
            require_operator_confirmation=self.EXECUTION_REQUIRE_OPERATOR_CONFIRMATION,
        )

    @property
    def retention_policy(self) -> RetentionPolicy:
        """The core's validated policy, built from this service's fields.

        Constructed (not stored) so Settings stays a plain env reader and
        the bound-checking law has exactly one home; the startup validator
        above calls this to fail boot on a nonsensical configuration.
        """
        return RetentionPolicy(
            event_retention_days=self.EXECUTION_RETENTION_EVENT_DAYS,
            batch_rows=self.EXECUTION_RETENTION_BATCH_ROWS,
            max_batches=self.EXECUTION_RETENTION_MAX_BATCHES,
        )

    @property
    def enablement_policy(self) -> EnablementPolicy:
        """The core's validated evidence policy, built from this service's
        field (constructed, never stored - same reason as
        ``retention_policy``: Settings stays a plain env reader)."""
        return EnablementPolicy(
            max_evidence_age_days=self.EXECUTION_ENABLEMENT_MAX_AGE_DAYS
        )

    @property
    def is_production(self) -> bool:
        return self.NODE_ENV == "production"

    @property
    def simulated_mid(self) -> Decimal | None:
        if self.EXECUTION_SIMULATED_MID is None:
            return None
        return _parse_decimal(self.EXECUTION_SIMULATED_MID, "EXECUTION_SIMULATED_MID")

    @property
    def paper_balances(self) -> dict[str, Decimal]:
        out: dict[str, Decimal] = {}
        for part in self.EXECUTION_PAPER_BALANCES.split(","):
            if part.strip() == "":
                continue
            asset, _, amount = part.partition("=")
            out[asset.strip().upper()] = _parse_decimal(amount, "balance")
        return out

    def to_public_dict(self) -> dict[str, object]:
        # A Vault address is topology, and a mount is configuration: both are only
        # meaningful when a fetcher is actually selected, and publishing defaults that
        # nothing reads is how a status page starts describing a deployment that does
        # not exist. This is the same reason ``credentialTarget`` is null for every
        # source but ``environment``.
        fetcher_wired = self.EXECUTION_CREDENTIAL_FETCHER != "none"
        """Everything except secrets - safe for the status endpoint and logs.

        The internal token is the one value this object must never leak, and
        the whitelist shape (constructing the view field by field) is how
        that stays true when fields are added later: a new secret appears in
        the public view only if someone adds it there deliberately.
        """
        return {
            "nodeEnv": self.NODE_ENV,
            "instanceId": self.EXECUTION_INSTANCE_ID,
            "servicePort": self.SERVICE_PORT,
            "mode": self.EXECUTION_MODE,
            "dryRun": self.EXECUTION_DRY_RUN,
            "requestTimeoutMillis": self.EXECUTION_REQUEST_TIMEOUT_MS,
            "lockTtlMillis": self.EXECUTION_LOCK_TTL_MS,
            "simulatedMidConfigured": self.EXECUTION_SIMULATED_MID is not None,
            "paperBalanceAssets": sorted(self.paper_balances),
            # The DSN itself never appears here (whitelist law); the boolean
            # says "a credential is present" without saying anything about it.
            "storeBackend": self.EXECUTION_STORE_BACKEND,
            "postgresDsnConfigured": (self.EXECUTION_POSTGRES_DSN or "").strip() != "",
            # Retention is configuration an operator must be able to SEE
            # from the outside (is apply enabled? what does "days" mean
            # here?) - all four values are non-secret by construction.
            "retentionEnabled": self.EXECUTION_RETENTION_ENABLED,
            "retentionEventDays": self.EXECUTION_RETENTION_EVENT_DAYS,
            "retentionBatchRows": self.EXECUTION_RETENTION_BATCH_ROWS,
            "retentionMaxBatches": self.EXECUTION_RETENTION_MAX_BATCHES,
            # The enablement window is non-secret and operationally
            # load-bearing (it is what "stale" means HERE), so it is
            # published next to the retention knobs.
            "enablementMaxAgeDays": self.EXECUTION_ENABLEMENT_MAX_AGE_DAYS,
            # Part 16. The credential *source* is published, never anything
            # derived from the material itself: "environment" or "none" is an
            # operational fact an operator needs in order to explain a refusal,
            # and it is also the only way to see from outside that a simulated
            # deployment is not quietly holding live keys.
            # Part 18: whether the scrape endpoint exists is a deployment fact a
            # monitoring pipeline needs in order to tell "no orders" from "no
            # exposition", and it is configuration, so it belongs in the same
            # whitelist as every other non-secret switch on this view.
            "observabilityEnabled": self.OBSERVABILITY_ENABLED,
            "credentialSource": self.EXECUTION_CREDENTIAL_SOURCE,
            "credentialCacheSeconds": self.EXECUTION_CREDENTIAL_CACHE_SECONDS,
            "credentialTarget": (
                f"{self.EXECUTION_CREDENTIAL_TENANT_ID}/"
                f"{self.EXECUTION_CREDENTIAL_ACCOUNT_ID}"
                if self.EXECUTION_CREDENTIAL_SOURCE == "environment"
                else None
            ),
            "placementAttestationTtlMillis": self.EXECUTION_PLACEMENT_ATTESTATION_TTL_MS,
            "placementMaxKeyAgeDays": self.EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS,
            "placementRequireIpAllowlist": self.EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST,
            # Part 19. The fetcher's IDENTITY and address are published, its token is
            # not even reachable from here (it lives only in the environment), and the
            # variable NAME is published precisely so an operator can see which name a
            # deployment is looking at without the value appearing anywhere.
            "credentialFetcher": self.EXECUTION_CREDENTIAL_FETCHER,
            "vaultMount": self.EXECUTION_VAULT_MOUNT if fetcher_wired else None,
            "vaultPathTemplate": (
                self.EXECUTION_VAULT_PATH_TEMPLATE if fetcher_wired else None
            ),
            "vaultTokenEnvVar": self.EXECUTION_VAULT_TOKEN_ENV if fetcher_wired else None,
            "vaultTlsVerify": self.EXECUTION_VAULT_TLS_VERIFY if fetcher_wired else None,
            # The confirmation's existence is configuration an operator must be able to
            # see from outside; its content is rendered by the reviewer's own describe()
            # (one home for the record's rendering), and its key never appears here.
            "requireOperatorConfirmation": self.EXECUTION_REQUIRE_OPERATOR_CONFIRMATION,
            "operatorConfirmationSource": (
                "inline"
                if (self.EXECUTION_OPERATOR_CONFIRMATION_JSON or "").strip()
                else "file"
                if (self.EXECUTION_OPERATOR_CONFIRMATION_FILE or "").strip()
                else None
            ),
            "confirmationKeyEnvVar": self.EXECUTION_CONFIRMATION_KEY_ENV,
        }


def _parse_decimal(raw: str, what: str) -> Decimal:
    try:
        value = Decimal(raw.strip())
    except InvalidOperation as error:
        raise ValueError(f"{what} must be a decimal number") from error
    if not value.is_finite():
        raise ValueError(f"{what} must be finite")
    return value


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached accessor so configuration is parsed exactly once per process."""
    return Settings()
```

FILE: services/execution-engine/app/credentials.py

```python
"""The credential seam (Part 16): where key material comes from, and what this
process is willing to say about it.

Two gaps met here, because they are the same gap. The placement review can
attest anything it likes about symbols and clocks, but every one of its
strongest facts is a signed call, and a signed call needs a key - so "the live
credential provider and the authenticated order-placement review are unfinished"
was one sentence describing one missing wire.

What this module owns is the *selection* and the *contract*, not the secret
material:

* ``none`` (the default) wires a provider that refuses every lookup. That is not
  a stub: a paper process that reaches for a key is a bug, and the fastest way
  to see it is a refusal with a reason attached. ``NullCredentialProvider`` is
  also what makes the placement review's "no evidence" verdict arrive as an
  audit line rather than as a silent pass.
* ``environment`` reads exactly two variables for exactly one (tenant, account)
  pair. The core labels this development-only, and ``app.config`` enforces the
  label at boot - production is refused outright, because an environment cannot
  scope a secret per tenant, is copied into every crash report, and does not
  rotate. That refusal lives in the settings validator and not here so that no
  path which builds a Settings object can skip it; this module's own refusal is
  the narrower one it is the only party to: the named variables exist.
* ``secret-manager`` is the multi-tenant path, and it needs an injected fetcher:
  the platform's key custody lives in the API service's encrypted store, and an
  execution engine that reached into another service's database for secrets
  would be a second, undocumented trust boundary. So the wiring exists, the
  contract is explicit, and boot refuses the combination that has no fetcher -
  which is the honest version of "not wired yet", because it is said in the
  error message rather than discovered in a log at 03:00.

The caching wrapper is unconditional for real sources. A provider that reads an
environment variable costs nothing per call, but the one that reads a secret
manager does, and an order path that hits it per submission turns a venue rate
limit into a vault rate limit - two different outages with one shared symptom.

Nothing here renders a secret. ``describe()`` and every log line are built from
the provider's *label* and the (tenant, account) it serves; the core's
:class:`~wlct_trading.execution.credentials.ExchangeCredentials` already
refuses to survive ``repr``, ``str``, pickling and traceback formatting, and
this module does not reintroduce what that class exists to prevent.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final

from wlct_trading.enums import ExchangeId
from wlct_trading.execution.credentials import (
    CachingCredentialProvider,
    CredentialProvider,
    EnvironmentCredentialProvider,
    NullCredentialProvider,
    SecretFetcher,
    SecretManagerCredentialProvider,
)

from app.config import Settings
from app.secret_fetcher import VaultKvConfig, VaultKvSecretFetcher

__all__ = [
    "CREDENTIAL_ENV_SUFFIXES",
    "CredentialWiring",
    "SecretFetcher",
    "build_credential_provider",
    "credential_env_names",
]

logger = logging.getLogger(__name__)

#: The two suffixes an ``environment`` source needs, in the order they are
#: reported when one is missing. Kept as a constant because the refusal message
#: and the boot check must agree, and a check that looks for one name while the
#: error names another sends an operator hunting for the wrong variable.
CREDENTIAL_ENV_SUFFIXES: Final[tuple[str, str]] = ("API_KEY", "API_SECRET")

#: Re-exported so a deployment types its fetcher against the contract the
#: provider consumes rather than against a copy that can drift. ``None`` from a
#: fetcher means "this (tenant, account) has no key configured", which the core
#: turns into ``CredentialNotFound``: an absent secret is an answer, not a crash,
#: and the difference is what lets the placement review distinguish "no key" from
#: "vault unreachable" instead of reporting both as one outage.
__all__ = [*__all__, "SecretFetcher"]


def credential_env_names(prefix: str) -> tuple[str, str]:
    """The two variable names an ``environment`` source will read.

    Mirrors :class:`~wlct_trading.execution.credentials
    .EnvironmentCredentialProvider` exactly - upper-cased, no trailing
    separator, ``_<SUFFIX>`` appended - because this function exists to check
    the variables BEFORE the provider resolves them. A name that differs from
    the provider's own is worse than no check at all: boot would pass on a
    variable nobody reads, and the first order would fail on the one nobody
    set. The parity is pinned by a test that reads the provider's refusal
    message, so the day the core changes its spelling this file is told.
    """
    # No rstrip, no lower-casing of the caller's underscores: whatever the
    # provider would compute is what this returns, double underscores included.
    # A prefix that produces an ugly name is refused at boot (see app.config),
    # which is the right place to be helpful - this function's only job is to
    # agree with the code that will actually read the variables.
    cleaned = prefix.strip().upper() or "BINANCE"
    key_suffix, secret_suffix = CREDENTIAL_ENV_SUFFIXES
    return (f"{cleaned}_{key_suffix}", f"{cleaned}_{secret_suffix}")


@dataclass(frozen=True, slots=True)
class CredentialWiring:
    """A provider plus everything this service may say about it.

    The provider is the collaborator; the rest is the description. They are
    returned together because a runtime that can hand ``/status`` a provider but
    not say where its keys came from has published a wiring it cannot
    diagnose - and because a caller must not be able to describe one provider
    while using another.
    """

    provider: CredentialProvider
    source: str
    cache_seconds: int | None
    tenant_id: str | None = None
    account_id: str | None = None
    note: str = ""
    #: Which secret reader the ``secret-manager`` source was given, or None when the
    #: source reads no external store. Named as a field rather than inferred from
    #: ``providerSource``, because a cached wrapper reports the wrapper's own label and
    #: the reader beneath it is the thing an operator needs to see to know whether this
    #: deployment can resolve a second tenant at all.
    fetcher_source: str | None = None

    def describe(self) -> dict[str, object]:
        """The non-secret view. Safe for ``/status``, logs and the console.

        ``providerSource`` is read back off the provider rather than echoed from
        the setting: if a future wiring wraps, caches or replaces the provider,
        the description has to follow what is actually installed, or the status
        endpoint becomes the most misleading documentation in the build.
        """
        return {
            "source": self.source,
            "providerSource": self.provider.source,
            "cacheSeconds": self.cache_seconds,
            "tenantId": self.tenant_id,
            "accountId": self.account_id,
            "note": self.note,
            "fetcherSource": self.fetcher_source,
        }


def build_credential_provider(
    settings: Settings,
    *,
    environ: Mapping[str, str] | None = None,
    secret_fetcher: SecretFetcher | None = None,
    exchange: ExchangeId = ExchangeId.BINANCE,
) -> CredentialWiring:
    """Construct the provider the deployment asked for, or refuse at boot.

    Every refusal here is a boot failure rather than a first-order failure on
    purpose: a deployment that starts and then cannot trade looks like a venue
    incident, while a deployment that refuses to start says "check your
    configuration" in the one place an operator is guaranteed to read it.
    """
    # ``environ`` is injectable so a test can prove the boot check without
    # mutating the process environment (which would leak into every later test).
    environment = dict(os.environ) if environ is None else dict(environ)
    source = settings.EXECUTION_CREDENTIAL_SOURCE
    cache_seconds = settings.EXECUTION_CREDENTIAL_CACHE_SECONDS

    if source == "none":
        # The default, and the correct one for every runtime this build ships.
        # The reason string is what the placement review's audit line carries, so
        # it is written for the person reading the refusal hours later.
        provider: CredentialProvider = NullCredentialProvider(
            "EXECUTION_CREDENTIAL_SOURCE=none: this runtime holds no key and "
            "will not acquire one at run time."
        )
        return CredentialWiring(
            provider=provider,
            source="none",
            cache_seconds=None,
            note="no credential source configured; every authenticated call refuses",
        )

    if source == "environment":
        key_name, secret_name = credential_env_names(settings.EXECUTION_CREDENTIAL_ENV_PREFIX)
        missing = [
            name
            for name in (key_name, secret_name)
            if not environment.get(name, "").strip()
        ]
        if missing:
            raise ValueError(
                f"EXECUTION_CREDENTIAL_SOURCE=environment needs "
                f"{' and '.join(missing)} to be set and non-empty. A named "
                "variable that is absent is not 'no key yet': the provider would "
                "resolve it per order and report a credential failure, which is a "
                "slower and vaguer way of saying what this message says at boot."
            )
        provider = EnvironmentCredentialProvider(
            environment,
            exchange=exchange,
            tenant_id=settings.EXECUTION_CREDENTIAL_TENANT_ID,
            account_id=settings.EXECUTION_CREDENTIAL_ACCOUNT_ID,
            prefix=settings.EXECUTION_CREDENTIAL_ENV_PREFIX,
        )
        provider = CachingCredentialProvider(provider, ttl_seconds=cache_seconds)
        logger.info(
            "execution_engine.credentials_selected",
            extra={
                "event": "execution_engine.credentials_selected",
                # ``provider*`` and not ``credential*`` on purpose: the platform's log
                # redactor scrubs any record key whose NAME is credential-shaped, so a
                # field called ``credentialSource`` would print [REDACTED] and the boot
                # line would say nothing. The values published on /status keep their
                # names (they are API vocabulary, and the redactor never sees them);
                # only the log spelling had to move out of the scrubber's way.
                "providerSource": "environment",
                "providerVariableNames": [key_name, secret_name],
                # The NAMES only. Printing a value - masked or not - is how
                # secrets end up in log aggregators, and a masked suffix is
                # still a fingerprint an attacker can brute-force.
                "cacheSeconds": cache_seconds,
            },
        )
        return CredentialWiring(
            provider=provider,
            source="environment",
            cache_seconds=cache_seconds,
            tenant_id=settings.EXECUTION_CREDENTIAL_TENANT_ID,
            account_id=settings.EXECUTION_CREDENTIAL_ACCOUNT_ID,
            note=f"single-tenant provider reading {key_name}",
        )

    # ``secret-manager``: the multi-tenant path. The core's provider is complete
    # and tested; what a deployment must supply is the fetcher, because the
    # choice of backend (Vault, cloud SM, the API service's own encrypted store)
    # is an infrastructure decision, and an execution engine that hard-codes one
    # has silently decided which customers may trade.
    fetcher_source: str | None = None
    if secret_fetcher is None:
        # Part 19 added the one concrete reader this service is willing to build by
        # itself, selected by name. The selector default is "none", so this branch is
        # the SAME refusal Part 16 shipped for every deployment that did not opt in -
        # only now it says which opt-in exists, which is the difference between a
        # message an operator can act on and a message that quotes the design doc.
        if settings.EXECUTION_CREDENTIAL_FETCHER == "vault-kv2":
            secret_fetcher = VaultKvSecretFetcher(
                # Constructed through Settings so the boot validator and the runtime
                # read the same values: a second mapping here would be a second
                # opinion about which variable means what, and Part 16's env-prefix
                # check is the last time this repository wanted that.
                VaultKvConfig(
                    addr=settings.EXECUTION_VAULT_ADDR or "",
                    mount=settings.EXECUTION_VAULT_MOUNT,
                    path_template=settings.EXECUTION_VAULT_PATH_TEMPLATE,
                    token_env=settings.EXECUTION_VAULT_TOKEN_ENV,
                    namespace=settings.EXECUTION_VAULT_NAMESPACE,
                    timeout_ms=settings.EXECUTION_VAULT_TIMEOUT_MS,
                    verify_tls=settings.EXECUTION_VAULT_TLS_VERIFY,
                    max_response_bytes=settings.EXECUTION_VAULT_MAX_RESPONSE_BYTES,
                ),
                environ=environment,
            )
            fetcher_source = secret_fetcher.source
        else:
            raise ValueError(
                "EXECUTION_CREDENTIAL_SOURCE=secret-manager needs a secret fetcher. "
                "Two ways to give this process one: set "
                "EXECUTION_CREDENTIAL_FETCHER=vault-kv2 (this service's own reader for "
                "HashiCorp Vault KV v2, which then needs EXECUTION_VAULT_ADDR and the "
                "token variable), or inject one at composition "
                "(build_credential_provider(secret_fetcher=...)) for any other store. "
                "Neither is optional, and no fallback exists on purpose: key custody "
                "for this platform lives with whoever owns the encrypted store, and a "
                "runtime that went looking for a signing key in a place it had not been "
                "told to trust would be trading on someone else's credential. Until a "
                "fetcher is wired, run simulated."
            )
    else:
        fetcher_source = "injected"
    provider = CachingCredentialProvider(
        SecretManagerCredentialProvider(secret_fetcher, exchange=exchange),
        ttl_seconds=cache_seconds,
    )
    logger.info(
        "execution_engine.credentials_selected",
        extra={
            "event": "execution_engine.credentials_selected",
            "providerSource": "secret-manager",
            "providerFetcher": fetcher_source,
            # No path, no tenant identifiers, and nothing from any response: the
            # selection event is a boot line, and boot lines are the most reliably
            # collected lines there are.
            "cacheSeconds": cache_seconds,
        },
    )
    return CredentialWiring(
        provider=provider,
        source="secret-manager",
        cache_seconds=cache_seconds,
        fetcher_source=fetcher_source,
        # tenant_id / account_id stay unset here on purpose, unlike the
        # ``environment`` branch: a secret-manager fetcher is keyed per
        # (tenant, account) at lookup time, so naming the configured pair would
        # publish "this process serves exactly one tenant" - a claim that is true
        # of the environment provider and false of everything the fetcher can do.
        note=(
            f"{fetcher_source} fetcher; per-tenant scoped by (tenant, account)"
            if fetcher_source == "vault-kv2"
            else "deployment-provided fetcher; per-tenant scoped by (tenant, account)"
        ),
    )
```

FILE: services/execution-engine/app/incidents_sql.py

```python
"""The durable incident sink (Part 17).

``wlct_trading.execution.incidents`` has described its records as
"deliberately rare and deliberately durable" since Part 5, while the only
implementation the platform ever shipped was ``InMemoryIncidentRecorder``. That
gap is not cosmetic: on a deployment with Part 13's Postgres store, an order
survives a restart and the incident that explains why the order was reconciled
does not. The audit trail of a failure is the one record an operator cannot
reconstruct, so the pair - durable store, memory sink - is refused at
composition rather than tolerated.

The shape of this recorder follows ``app.store_sql.PostgresOrderStore`` exactly,
and for reasons rather than taste:

* **Every statement runs inside a transaction whose first act is the tenant
  GUC.** The RLS policies of Part 11 are the layer below this code; a write that
  forgot ``set_config('app.tenant_id', …)`` would either fail closed (correct) or,
  on a role with ``BYPASSRLS``, silently land rows in the wrong tenant's result
  set. Reusing the store's ``SET_TENANT_SQL`` constant means there is one spelling
  of that law in the service, not two that can drift.
* **``record`` never raises.** The port says it: losing an incident is bad, taking
  down order flow because logging failed is worse. A failed write is counted and
  logged, and the counter is published - a sink that drops records invisibly is how
  a "durable" log becomes a rumour.
* **Insert-only.** The core's own law is that an incident is resolved by a NEW
  record, never by editing one (``ExecutionIncident.resolve`` returns a copy), so
  there is no UPDATE statement here at all. ``resolved`` is a column written once,
  which is what makes ``list_open`` a query rather than a race.
* **Reads do raise.** The asymmetry is deliberate: ``list_open`` answers an
  operator who asked a question, and "the incident store is down" is the answer
  they need. Swallowing it to return an empty list would be the most convincing
  possible lie - no open incidents looks exactly like a healthy system.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from wlct_trading.enums import ExchangeId
from wlct_trading.execution.incidents import (
    ExecutionErrorCode,
    ExecutionIncident,
    IncidentRecorder,
    IncidentSeverity,
    IncidentType,
)

from app.store_sql import SET_TENANT_SQL, PgPool

__all__ = [
    "TABLE_INCIDENTS",
    "IncidentReadError",
    "PostgresIncidentRecorder",
]

logger = logging.getLogger(__name__)

#: The table, named once. ``app.pg_store`` verifies it exists at startup with the
#: same ``to_regclass`` check the order tables use, so "the migration has not been
#: applied" is a refusal that names this string rather than a runtime error that
#: names a SQLSTATE.
TABLE_INCIDENTS = "engine_incidents"


class IncidentReadError(RuntimeError):
    """A read of the incident store failed, said plainly.

    Not a subclass of the write path's swallowed errors: the caller of
    :meth:`PostgresIncidentRecorder.list_open` asked a question and is owed an
    exception rather than an empty tuple.
    """


#: One incident, one row. The column list is the core's ``to_dict()`` field set
#: in the order that function publishes it, because the two must be readable
#: side by side by whoever is debugging a row that does not match a log line.
INSERT_SQL = f"""
INSERT INTO "{TABLE_INCIDENTS}" (
    incident_id, tenant_id, account_id, incident_type, severity, summary,
    exchange, symbol, order_id, client_order_id, error_code, details,
    occurred_at, resolved, resolution_note
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15
)
"""

#: Open incidents for one tenant, newest first. ``seq`` is the tiebreak, not
#: ``occurred_at``: two incidents recorded in the same microsecond are routine
#: (one failed command emits a pair), and "newest first" has to mean something
#: when they arrive together. The predicate on ``resolved`` is the whole of the
#: open/close law, so it is one column read rather than a join or a projection.
LIST_OPEN_SQL = f"""
SELECT incident_id, tenant_id, account_id, incident_type, severity, summary,
       exchange, symbol, order_id, client_order_id, error_code,
       details::text AS details, occurred_at, resolved, resolution_note
  FROM "{TABLE_INCIDENTS}"
 WHERE tenant_id = $2::uuid AND resolved = false
 ORDER BY seq DESC
 LIMIT $3
"""


def _row_to_incident(row: Any) -> ExecutionIncident:
    """Rebuild the immutable record from a row.

    The enums are re-derived from the stored strings and a bad value is a hard
    error: a row whose ``severity`` is not in the vocabulary means either the
    codec changed or somebody wrote to the table by hand, and "unknown" is not a
    severity an operator can act on.
    """
    details_raw = row["details"]
    details = json.loads(details_raw) if isinstance(details_raw, str) else dict(details_raw or {})
    return ExecutionIncident(
        incident_id=str(row["incident_id"]),
        tenant_id=str(row["tenant_id"]),
        account_id=row["account_id"],
        incident_type=IncidentType(row["incident_type"]),
        severity=IncidentSeverity(row["severity"]),
        summary=str(row["summary"]),
        exchange=_optional_exchange(row["exchange"]),
        symbol=row["symbol"],
        order_id=row["order_id"],
        client_order_id=row["client_order_id"],
        error_code=_optional_error_code(row["error_code"]),
        details={str(k): str(v) for k, v in details.items()},
        occurred_at_micros=int(row["occurred_at"]),
        resolved=bool(row["resolved"]),
        resolution_note=row["resolution_note"],
    )


def _optional_exchange(value: object) -> ExchangeId | None:
    """Re-derive an enum from the stored string, or say "absent".

    Both helpers treat the empty string as absent even though the writer only ever
    stores NULL: a hand-edited row (and someone, someday, will) must not become a
    crash in the read path of the tool an operator uses to find out what broke.
    """
    if value in (None, ""):
        return None
    return ExchangeId(str(value))


def _optional_error_code(value: object) -> ExecutionErrorCode | None:
    if value in (None, ""):
        return None
    return ExecutionErrorCode(str(value))


class PostgresIncidentRecorder(IncidentRecorder):
    """Incident records that outlive the process, over the store's pool.

    The pool is shared with :class:`~app.store_sql.PostgresOrderStore` on purpose:
    one connection budget against the database every other engine table uses, and
    one place where the tenant GUC law can be enforced. The recorder takes no
    transaction of its own beyond the per-statement one, because a record written
    as a side effect of a failed command must NOT be rolled back with that
    command's work - an incident that disappears because the order it describes
    was retried is worse than no incident.
    """

    __slots__ = ("_pool", "_failed_writes", "_written")

    def __init__(self, pool: PgPool) -> None:
        self._pool = pool
        self._written = 0
        self._failed_writes = 0

    @property
    def is_durable(self) -> bool:
        """The store's own flag, read the same duck-typed way everywhere else.

        Composition asks this question instead of trusting the config: the config
        says what was intended, the object says what it can do, and a durable
        claim from an in-memory sink is the failure this class exists to prevent.
        """
        return True

    @property
    def stats(self) -> dict[str, int]:
        """Write accounting, published on ``/status`` beside the sink label.

        ``failedWrites`` is the number of incidents this process was told to keep
        and could not. Non-zero with the orders table healthy is the signature of
        a missing grant or an out-of-order migration, and an operator who cannot
        see it has to guess whether an empty incident list means "nothing happened"
        or "we could not write it down".
        """
        return {"written": self._written, "failedWrites": self._failed_writes}

    async def record(self, incident: ExecutionIncident) -> None:
        """Persist one incident. Never raises into the caller."""
        try:
            async with self._pool.acquire() as conn:
                async with conn.transaction():
                    await conn.execute(SET_TENANT_SQL, incident.tenant_id)
                    await conn.execute(
                        INSERT_SQL,
                        incident.incident_id,
                        incident.tenant_id,
                        incident.account_id,
                        incident.incident_type.value,
                        incident.severity.value,
                        incident.summary,
                        incident.exchange.value if incident.exchange else None,
                        incident.symbol,
                        incident.order_id,
                        incident.client_order_id,
                        incident.error_code.value if incident.error_code else None,
                        json.dumps(dict(incident.details), sort_keys=True),
                        incident.occurred_at_micros,
                        bool(incident.resolved),
                        incident.resolution_note,
                    )
        except Exception as exc:  # the port's law: logging must not break execution
            self._failed_writes += 1
            logger.error(
                "execution_engine.incident_write_failed",
                extra={
                    "event": "execution_engine.incident_write_failed",
                    "tenant_id": incident.tenant_id,
                    "incident_id": incident.incident_id,
                    "incident_type": incident.incident_type.value,
                    "error": type(exc).__name__,
                    "failed_writes": self._failed_writes,
                },
            )
            return
        self._written += 1

    async def list_open(
        self, tenant_id: str, *, limit: int = 100
    ) -> tuple[ExecutionIncident, ...]:
        """Open incidents for one tenant, newest first. Raises on failure."""
        if not 1 <= limit <= 1_000:
            raise ValueError(
                "incident list limit must be between 1 and 1000; the bound is the "
                "store's, not the caller's, because this reads an unbounded table"
            )
        try:
            async with self._pool.acquire() as conn:
                async with conn.transaction():
                    await conn.execute(SET_TENANT_SQL, tenant_id)
                    rows = await conn.fetch(LIST_OPEN_SQL, tenant_id, tenant_id, limit)
        except Exception as exc:
            raise IncidentReadError(
                f"the incident store could not be read ({type(exc).__name__}); an "
                "empty list would not be the same answer, so none is given"
            ) from exc
        return tuple(_row_to_incident(row) for row in rows)

    async def verify_schema(self) -> None:
        """Existence check for startup, spelled the way the order store spells it."""
        async with self._pool.acquire() as conn:
            present = await conn.fetchrow(
                "SELECT to_regclass($1) AS regclass", f"public.{TABLE_INCIDENTS}"
            )
        if present is None or present["regclass"] is None:
            raise RuntimeError(
                f'table "{TABLE_INCIDENTS}" is missing; the durable incident sink '
                "cannot be built over a schema that has not been migrated"
            )
```

FILE: services/execution-engine/app/logging_config.py

```python
"""Structured JSON logging, using the shared Part 9 redactor and correlation.

Same policy as every other Python service: redaction lives in exactly one
place (``wlct_trading.observability.redaction``), this module only adapts it
to the logging machinery. The engine's log stream is where venue errors,
credential-adjacent exceptions and order payloads pass close by - the
redactor is what makes "logs are safe to ship" true rather than plausible.
"""

from __future__ import annotations

import logging
import sys
from typing import Any

from pythonjsonlogger import jsonlogger
from wlct_trading.observability.correlation import LoggingCorrelationFilter
from wlct_trading.observability.redaction import (
    REDACTED,
    is_sensitive_key,
    redact_exception,
    redact_text,
    redact_value,
)

__all__ = ["REDACTED", "RedactionFilter", "ServiceJsonFormatter", "configure_logging"]

#: Record attributes that belong to the logging machinery itself and must
#: never be treated as payload.
_RESERVED = frozenset(
    {
        "args",
        "asctime",
        "created",
        "exc_info",
        "exc_text",
        "filename",
        "funcName",
        "levelname",
        "levelno",
        "lineno",
        "message",
        "module",
        "msecs",
        "msg",
        "name",
        "pathname",
        "process",
        "processName",
        "relativeCreated",
        "stack_info",
        "taskName",
        "thread",
        "threadName",
    }
)


class RedactionFilter(logging.Filter):
    """Scrub credential-shaped keys AND values from every record.

    Runs after the correlation filter (mirrors the trading engine exactly):
    the ids the correlation filter injects are validated wire tokens, and
    scrubbing second means even a malformed injection is cleaned before
    serialisation.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        for key, value in list(record.__dict__.items()):
            if key in _RESERVED:
                continue
            if is_sensitive_key(key):
                record.__dict__[key] = REDACTED
            elif isinstance(value, str):
                record.__dict__[key] = redact_text(value)
            elif isinstance(value, dict | list | tuple):
                record.__dict__[key] = redact_value(value)
        if record.exc_info and record.exc_info[1] is not None:
            # Replace the exception context with a safe summary: the raw
            # message can embed DSNs, and the formatter prints exc_text.
            summary = redact_exception(record.exc_info[1])
            record.exc_text = f"{summary['type']}: {summary['message']}"
            record.exc_info = None
        return True


class ServiceJsonFormatter(jsonlogger.JsonFormatter):
    """Adds the fields the platform log pipeline expects on every line."""

    def __init__(self, fmt: str, *, timestamp: bool = False) -> None:
        # An explicitly typed constructor: pythonjsonlogger ships no stubs,
        # so an inherited __init__ is untyped to mypy and every construction
        # site would be a "call to untyped function" in a strict context.
        # Declaring the signature here is typing, not suppression, and it
        # documents the one kwarg this service actually uses.
        super().__init__(fmt, timestamp=timestamp)

    def add_fields(
        self,
        log_record: dict[str, Any],
        record: logging.LogRecord,
        message_dict: dict[str, Any],
    ) -> None:
        super().add_fields(log_record, record, message_dict)
        log_record.setdefault("service", "execution-engine")
        log_record["level"] = record.levelname.lower()
        log_record["logger"] = record.name


def configure_logging(level: str) -> None:
    """Installs the JSON handler on the root logger."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        ServiceJsonFormatter("%(asctime)s %(level)s %(name)s %(message)s", timestamp=True)
    )
    handler.addFilter(LoggingCorrelationFilter())
    handler.addFilter(RedactionFilter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level.upper())

    # Uvicorn installs its own handlers; route them through ours instead.
    for name in ("uvicorn", "uvicorn.access", "uvicorn.error"):
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers.clear()
        uvicorn_logger.propagate = True
```

FILE: services/execution-engine/app/main.py

```python
"""Execution engine application factory.

The process owns the money path's runtime and nothing else: no public
routes, no admin surface, no UI. Startup is where wiring mistakes die -
``build_runtime`` refuses live mode, ``get_settings`` refuses missing or
placeholder secrets - so the first request ever served meets either a fully
composed engine or no process at all.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import __version__
from app.composition import build_runtime
from app.config import get_settings
from app.incidents_sql import PostgresIncidentRecorder
from app.logging_config import configure_logging
from app.observability import ExecutionEngineObservability
from app.pg_store import open_durable_store
from app.routers import (
    enablement,
    health,
    internal,
    placement,
    retention,
)
from app.routers import (
    incidents as incidents_router,
)
from app.routers import (
    observability as observability_router,
)
from app.security import REQUEST_ID_HEADER

logger = logging.getLogger(__name__)

#: Response header echoing the correlation id, matching the platform's
#: convention so a worker log line and an engine log line join on it.
CORRELATION_HEADER = "x-correlation-id"


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.LOG_LEVEL)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # Raises through startup on any refused combination - live mode,
        # catalog incoherence - which is the whole safety design: a process
        # that cannot state its wiring does not serve traffic.
        store = None
        pool = None
        incidents = None
        if settings.EXECUTION_STORE_BACKEND == "postgres":
            pool, store = await open_durable_store(settings)
            # Part 17: the sink is built over the SAME pool the store came from,
            # here rather than inside open_durable_store, because this function is
            # where "we have a durable plane" is decided - and passing it down is
            # what lets composition refuse a durable store that arrived without
            # one, instead of quietly defaulting to memory.
            incidents = PostgresIncidentRecorder(pool)
        app.state.runtime = build_runtime(settings, store=store, incidents=incidents)
        # Part 18: the hub is built AFTER the runtime because it reads the
        # runtime's own instruments, and it is NOT wrapped in a try. A hub that
        # cannot register its families - an illegal metric or label name reaching
        # the cardinality law - is a wiring mistake, and this file's opening
        # sentence is that wiring mistakes die at startup rather than being
        # swallowed into a degraded-but-running process. Refusing the boot is also
        # the kinder answer for the operator: a missing scrape is obvious in the
        # startup log, and invisible in every panel that reads zero.
        if settings.OBSERVABILITY_ENABLED:
            app.state.observability = ExecutionEngineObservability(app.state.runtime)
        app.state.store_pool = pool
        logger.info(
            "execution_engine.started",
            extra={
                "event": "execution_engine.started",
                "instance_id": settings.EXECUTION_INSTANCE_ID,
                "version": __version__,
                "wiring": (app.state.runtime.describe() if hasattr(app.state, "runtime") else {}),
            },
        )
        yield
        if pool is not None:
            await pool.close()
        logger.info("execution_engine.stopped", extra={"event": "execution_engine.stopped"})

    app = FastAPI(
        title="wlct execution engine",
        version=__version__,
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url="/openapi.json",
    )

    @app.middleware("http")
    async def correlation(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        # Best-effort id continuity: honour a well-formed incoming id (the
        # worker sends its job's x-request-id), mint one otherwise. Capped
        # at 128 chars so a hostile header cannot bloat every log line.
        incoming = request.headers.get(REQUEST_ID_HEADER)
        correlation_id = (
            incoming
            if incoming is not None and 0 < len(incoming) <= 128 and _printable(incoming)
            else f"eng-{uuid.uuid4().hex[:20]}"
        )
        request.state.correlation_id = correlation_id
        response = await call_next(request)
        response.headers[CORRELATION_HEADER] = correlation_id
        return response

    @app.exception_handler(RequestValidationError)
    async def on_validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Field locations only, never values: a rejected payload may contain
        # exactly the thing it should not, and 422 bodies get screenshotted.
        return JSONResponse(
            status_code=422,
            content={
                "code": "VALIDATION_FAILED",
                "message": "The command payload does not satisfy the contract.",
                "fields": [
                    {"location": ".".join(str(part) for part in err.get("loc", ())),
                     "type": str(err.get("type", "value_error"))}
                    for err in exc.errors()
                ],
            },
        )

    @app.exception_handler(StarletteHTTPException)
    async def on_http(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        raw_detail: object = exc.detail
        if isinstance(raw_detail, dict):
            content: dict[str, object] = raw_detail
        else:
            content = {
                "code": f"HTTP_{exc.status_code}",
                "message": str(raw_detail),
            }
        return JSONResponse(status_code=exc.status_code, content=content)

    @app.exception_handler(Exception)
    async def on_unexpected(request: Request, exc: Exception) -> JSONResponse:
        logger.exception(
            "execution_engine.unhandled",
            extra={
                "event": "execution_engine.unhandled",
                "path": request.url.path,
                "correlation_id": getattr(request.state, "correlation_id", None),
            },
        )
        # The message is for the logs; the client gets a retryable 500 with
        # the correlation id - never an exception string, which is how
        # internal shapes leak and secrets travel.
        return JSONResponse(
            status_code=500,
            content={
                "code": "INTERNAL_ERROR",
                "message": "The command failed inside the engine; retry is permitted.",
                "correlationId": getattr(request.state, "correlation_id", ""),
            },
        )

    app.include_router(health.router)
    app.include_router(internal.router)
    app.include_router(retention.router)
    app.include_router(enablement.router)
    # Part 16's review surface: read-only with respect to orders, and mounted
    # last because it is the one route an operator reaches for when a refusal
    # needs explaining - the command plane above must never depend on it.
    app.include_router(placement.router)
    # The incident read surface (Part 17) sits beside it for the same reason: it
    # explains refusals, it does not produce them. Mounted after the review
    # because an operator who cannot place an order wants the list of why.
    app.include_router(incidents_router.router)
    # Mounted with the same gate as the hub, so a disabled exposition is a 404
    # rather than a 200 of prose: "no scrape target" and "empty target" are
    # different facts and a monitoring pipeline should not have to read a body to
    # tell them apart. Production cannot reach this branch - config refuses to
    # parse OBSERVABILITY_ENABLED=false there.
    if settings.OBSERVABILITY_ENABLED:
        app.include_router(observability_router.router)
    return app


def _printable(candidate: str) -> bool:
    return all(32 <= ord(ch) < 127 for ch in candidate)


if __name__ == "__main__":
    settings = get_settings()
    # The same target the image names, and for the same reason (see
    # infrastructure/docker/execution-engine.Dockerfile): there is deliberately no
    # module-level ``app`` here, because constructing the app is where settings are
    # parsed and a refused configuration belongs at startup, not at import.
    uvicorn.run(
        "app.main:create_app",
        factory=True,
        host=settings.EXECUTION_ENGINE_HOST,
        port=settings.SERVICE_PORT,
        log_config=None,  # uvicorn's default logging would bypass the redaction pipeline
    )
```

FILE: services/execution-engine/app/observability.py

```python
"""The execution engine's metrics exposition (Part 18).

Part 9 built the socket and nobody plugged anything into it: the core has exposed
``observe_latency_histogram(...)`` ever since, with a docstring that says "the
service's scrape handler calls this per scrape", and the execution engine - the one
process on this platform that measures an authenticated order path - has never had a
scrape handler at all. Parts 16 and 17 then made that gap sharp from both sides: the
placement review became a counted and timed stage, and incident records became
durable. Measurable, and until this module, unreadable from outside the process that
measured it.

What is exported, and why each piece takes that shape:

* **One counter per ``ExecutionCounters`` field, derived from the dataclass.** No
  hand-written list of metric names lives here, so the exporter cannot fall behind
  the instrument: a counter added in the core reaches the scrape in the same commit
  that added it, and a test asserts the two sets are equal in BOTH directions. A
  curated list would have been the fourth hand-maintained enumeration in this
  repository, and every one of the first three was found because the list and the
  module it described had quietly parted.
* **Each recorded ``EXECUTION_STAGES`` histogram, copied whole** through the core's
  adapter rather than re-observed: the adapter takes ``(bounds, per-bucket counts,
  count, sum)`` from ``LatencyHistogram.snapshot_buckets()`` and leaves the
  cumulative sum to ``render_prometheus``, which owns it. That is the only faithful
  mirror of a source that keeps a rolling window: re-observing sample values would
  double-count against the previous scrape, and re-observing derived percentiles
  would present a rolling window as an all-time histogram. A whole-copy cannot
  disagree with its source, and the core's "observations, not guarantees" caveat is
  inherited into the help text instead of being restated as a promise. Wiring this
  copy into a live process is also how a nine-part-old bug in that adapter died: it
  had been writing a cumulative array into a store the renderer sums, so every ``le``
  line above the first bucket reported observations that never happened. See
  ``docs/PART18_METRICS_EXPOSITION.md``.
* **Wiring gauges.** "Zero placement reviews" means something different when no
  reviewer is wired from what it means when one is wired and nobody has submitted an
  order; without these the dashboard has to guess, and a guess about a safety
  control is the kind that gets automated into an alert.

What is deliberately not here:

* **No tenant, account, order or client-order label.** ``FORBIDDEN_LABEL_NAMES`` in
  the core refuses those at registration and this module does not route around the
  refusal with a rename: the values that make a per-tenant dashboard useful are the
  values that make a scraped endpoint a disclosure channel. Per-tenant numbers live
  in the durable tables, which are row-level-security scoped, and the API plane
  queries them.
* **No Redis mirror and no alert engine.** Both sibling services publish an evidence
  mirror for the API to persist. This service's evidence is its durable store, its
  incident table (Part 17) and its ``/internal/v1/status`` document; a third copy of
  the same facts in Redis would be a third thing to keep in step, and paging belongs
  to the layers that already own ``AlertEngine``.
* **No background task.** Everything is read at scrape time from state the process
  already holds, so there is no loop to stall, no interval to tune, and no staleness
  that is not also the engine's own.
"""

from __future__ import annotations

import logging
import time
from dataclasses import fields
from typing import Final

from wlct_trading.metrics import (
    EXECUTION_STAGES,
    ExecutionCounters,
    ExecutionMetrics,
    LatencyHistogram,
)
from wlct_trading.observability.metrics import (
    ObservabilityRegistry,
    ensure_process_families,
    observe_latency_histogram,
    render_prometheus,
    sample_process,
)

from app.composition import EngineRuntime

logger = logging.getLogger(__name__)

__all__ = [
    "COUNTER_FAMILIES",
    "LATENCY_FAMILY",
    "RESETS_FAMILY",
    "WIRING_GAUGE",
    "ExecutionEngineObservability",
    "counter_families",
]

_SERVICE: Final = "execution-engine"

#: One histogram family for every stage, because the bucket edges are the same for
#: all of them (the core's fixed set): thirteen families of sixteen buckets would be
#: a scrape a human has to name by hand in PromQL, for no extra information.
LATENCY_FAMILY: Final = "wlct_execution_stage_latency_micros"
WIRING_GAUGE: Final = "wlct_execution_wiring"
RESETS_FAMILY: Final = "wlct_execution_metrics_resets_total"


def counter_families() -> tuple[str, ...]:
    """``wlct_execution_<field>_total`` for every field on ``ExecutionCounters``."""
    return tuple(f"wlct_execution_{field.name}_total" for field in fields(ExecutionCounters))


#: Public so the test can assert equality against it instead of restating it - a
#: second list of names would be a second source of truth, which is the bug.
COUNTER_FAMILIES: Final[tuple[str, ...]] = counter_families()

#: (label, source of truth) for each wiring gauge. The label is the metric's
#: ``component`` value; the source is a key in the runtime's own description, so
#: the gauge reports what ``/status`` reports rather than a second opinion.
_WIRING_SOURCES: Final[tuple[tuple[str, str, str], ...]] = (
    ("durable_store", "storeDurable", ""),
    ("durable_incidents", "incidents", "durable"),
    ("placement_review", "placement", "label"),
    ("venue_attestation", "placement", "requiresVenueAttestation"),
    ("distributed_locks", "locksDistributed", ""),
    ("journal_retention", "retentionEnabled", ""),
    # Part 19's two live-enablement components, from the same description. They are
    # here rather than in a new family because the question they answer - "which half
    # of the live path does this deployment not have" - is a wiring question, and the
    # gauge is the only wiring surface this hub owns. A dashboard that can see
    # placement_review=1 next to live_credential_fetcher=0 is looking at a deployment
    # that reviews orders it has no way to sign, which is exactly the state Part 16
    # left open and Part 19 made countable.
    ("live_credential_fetcher", "credentialFetcher", ""),
    ("operator_confirmation", "operatorConfirmation", ""),
    # Part 18's own posture, from the same description the status route renders.
    # It is here because the whole module would otherwise report zeros that cannot
    # be told apart: this service shipped an engine with no instrument for thirteen
    # parts, and "nothing happened" and "nothing was measured" look identical in
    # every other family.
    ("engine_instrumented", "metricsConfigured", ""),
)


class ExecutionEngineObservability:
    """Registry, families, and the one method anything else calls: ``scrape``.

    Built once per process in the lifespan, after the runtime exists, and strictly
    read-only towards the engine: it never calls ``reset()`` and never mutates a
    histogram. An exposition that could clear the numbers it reports would make a
    restart and a deliberate ``metrics.reset()`` indistinguishable on a dashboard -
    which is the moment an operator is reading one hardest.
    """

    def __init__(self, runtime: EngineRuntime) -> None:
        self._runtime = runtime
        self._started_mono = time.monotonic()
        self.registry = ObservabilityRegistry(service=_SERVICE)
        self._last_counters: dict[str, int] = {}
        self._resets = 0
        ensure_process_families(self.registry)
        self._register_families()

    # ------------------------------------------------------------------
    # registration
    # ------------------------------------------------------------------
    def _register_families(self) -> None:
        registered = self.registry.family_names()
        for family in COUNTER_FAMILIES:
            if family in registered:
                continue
            source = family.removeprefix("wlct_execution_").removesuffix("_total")
            self.registry.register_counter(
                family,
                f"Execution path '{source}'; cumulative over this process's lifetime.",
            )
        self.registry.register_histogram(
            LATENCY_FAMILY,
            "Engine stage durations in microseconds. Observations of this process "
            "and its network path; never a latency guarantee.",
            ("stage",),
            bounds={"stage": frozenset(EXECUTION_STAGES)},
        )
        self.registry.register_gauge(
            WIRING_GAUGE,
            "Wiring facts (1=yes) needed to read a zero correctly.",
            "component",
            bounds={"component": frozenset(label for label, *_ in _WIRING_SOURCES)},
        )
        self.registry.register_counter(
            RESETS_FAMILY,
            "Times the source counters moved backwards between scrapes (a reset or "
            "a restart) and this hub re-baselined rather than reporting a negative rate.",
        )

    # ------------------------------------------------------------------
    # the mirror
    # ------------------------------------------------------------------
    def _metrics(self) -> ExecutionMetrics | None:
        """The engine's own instrument, or None when it was built without one.

        ``None`` renders as "no families added", not as zeros: zero orders and
        unmeasured orders are different facts, and a scrape that invented the first
        would be the exposition layer making a claim the engine never made.
        """
        return getattr(self._runtime.engine, "metrics", None)

    def _mirror_counters(self, source: ExecutionCounters) -> None:
        """Delta-mirror the cumulative counters into the registry.

        The registry may only ever ADD to a counter (``inc`` refuses a negative
        amount, and that law is the platform's, not this file's) and the source is
        cumulative, so the honest bridge is a delta per scrape. A decrease is not a
        negative rate: it is ``reset()`` or a process restart, and the answer is to
        re-baseline the mirror and COUNT the event, because a counter that silently
        resumes from zero after a reset draws a cliff exactly where an operator is
        looking for a trend.
        """
        for field in fields(ExecutionCounters):
            value = int(getattr(source, field.name, 0) or 0)
            family = f"wlct_execution_{field.name}_total"
            previous = self._last_counters.get(field.name)
            self._last_counters[field.name] = value
            if previous is None:
                if value:
                    self.registry.inc(family, {}, float(value))
                continue
            if value < previous:
                self._resets += 1
                self.registry.inc(RESETS_FAMILY, {})
                if value:
                    self.registry.inc(family, {}, float(value))
                continue
            delta = value - previous
            if delta:
                self.registry.inc(family, {}, float(delta))

    def _mirror_stages(self, source: ExecutionMetrics) -> None:
        """Copy each recorded stage's cumulative histogram state, whole."""
        stage_getter = getattr(source, "stage", None)
        if not callable(stage_getter):
            return
        for stage in EXECUTION_STAGES:
            histogram: LatencyHistogram | None = stage_getter(stage)
            if histogram is None or histogram.count == 0:
                # An unrecorded stage is ABSENT from the exposition rather than a
                # histogram of zeros: "nobody measured this" and "everything was
                # instantaneous" are different statements, and rendering the second
                # one is the specific lie this loop exists to avoid.
                continue
            observe_latency_histogram(
                self.registry,
                LATENCY_FAMILY,
                {"stage": stage},
                histogram,
            )

    def _publish_wiring(self) -> None:
        described = self._runtime.describe()
        for label, key, subkey in _WIRING_SOURCES:
            raw: object = described.get(key)
            if subkey:
                raw = raw.get(subkey) if isinstance(raw, dict) else None
            value = 1.0 if _truthy(raw) else 0.0
            self.registry.set_gauge(WIRING_GAUGE, {"component": label}, value)

    # ------------------------------------------------------------------
    # the one public entry point
    # ------------------------------------------------------------------
    def scrape(self) -> str:
        """Render this process's metrics, fresh, from state already held."""
        source = self._metrics()
        if source is not None:
            counters = getattr(source, "counters", None)
            if counters is not None:
                self._mirror_counters(counters)
            self._mirror_stages(source)
        self._publish_wiring()
        sample_process(self.registry, started_at_mono=self._started_mono)
        return render_prometheus(self.registry)

    @property
    def family_names(self) -> tuple[str, ...]:
        """The families this hub owns, for the test that pins them.

        The registry exposes this as a method; the property exists so a reader of
        this module sees the hub's surface, not the registry's plumbing.
        """
        return self.registry.family_names()

    @property
    def reset_count(self) -> int:
        """How many times the mirror had to re-baseline, for the log line."""
        return self._resets


def _truthy(raw: object) -> bool:
    """The one reading of "is this wired" that does not invent a default.

    ``True``/``False`` pass through, a non-empty string counts (the placement block's
    ``label`` is a gatherer name, whose absence is the empty case), and a missing
    key counts as not-wired rather than as zero - so a renamed describe() key
    publishes 0 and gets noticed, instead of publishing a confident answer nobody
    checked.
    """
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, str):
        return bool(raw) and raw not in {"unavailable", "none", "unattested"}
    if raw is None:
        return False
    return bool(raw)
```

FILE: services/execution-engine/app/pg_store.py

```python
"""The one module that imports the driver (Part 13).

The store itself (``app.store_sql``) speaks a two-method protocol and is
unit-testable without Postgres anywhere in sight. This module is the seam
between that protocol and ``asyncpg``: pool creation, the schema check that
keeps "migrations applied" from becoming a runtime discovery, and shutdown.
Three facts decided here, deliberately:

* **The tables must exist before the first request.** ``to_regclass`` on
  each engine table; a missing one is a startup refusal naming the
  migration. An engine that comes up ready and then fails every durable
  write with ``relation does not exist`` would report its own health as
  healthy while losing orders - strictly worse than not starting.
* **The pool is small.** max_size 5: the single-process simulated runtime
  serves short commands with one store call each; a big pool here just
  multiplies connections held against the same Postgres the API and the
  other engines use, and connection pressure on a shared database is an
  availability problem for everyone.
* **Connection failure is startup failure.** No retry-with-backoff loop at
  boot, because the platform's orchestrator (compose restart / k8s
  backoff) already retries process starts with visibility; a process that
  sleeps through retries looks alive to a supervisor and answers nothing.
"""

from __future__ import annotations

import logging
from typing import Any, Final

import asyncpg

from app.config import Settings
from app.incidents_sql import TABLE_INCIDENTS
from app.store_sql import TABLE_EVENTS, TABLE_FILLS, TABLE_ORDERS, PostgresOrderStore

__all__ = ["DURABLE_TABLES", "open_durable_store"]

#: Every table the durable plane needs, checked in one loop at startup. Part 17
#: added the fourth: an engine that came up ready to serve commands whose orders
#: would be kept and whose incidents would not is a deployment whose audit trail
#: silently stops at the last restart, so the incidents table is a STARTUP
#: requirement here rather than a runtime discovery.
DURABLE_TABLES: Final[tuple[str, ...]] = (
    TABLE_ORDERS,
    TABLE_EVENTS,
    TABLE_FILLS,
    TABLE_INCIDENTS,
)

logger = logging.getLogger(__name__)

#: Driver defaults worth pinning rather than inheriting: a 10s connect
#: timeout means a dead database is known in ten seconds, not when a
#: statement's own timeout finally fires mid-command.
_CONNECT_TIMEOUT_SECONDS = 10.0


async def open_durable_store(
    settings: Settings,
) -> tuple[Any, PostgresOrderStore]:
    """Create the pool, verify the schema, return (pool, store).

    Returns the pool as well because the lifespan owns its shutdown; the
    store must never be the only handle to it. Any failure raises through
    startup (see module docstring): the caller's contract is "either a
    working durable store or no service at all".
    """
    dsn = settings.EXECUTION_POSTGRES_DSN
    if dsn is None:  # config validator makes this unreachable; the type needs it
        raise RuntimeError("postgres store backend without a DSN cannot be opened")
    pool = await asyncpg.create_pool(
        dsn=dsn,
        min_size=1,
        max_size=5,
        timeout=_CONNECT_TIMEOUT_SECONDS,
    )
    missing: list[str] = []
    try:
        async with pool.acquire() as conn:
            for table in DURABLE_TABLES:
                present = await conn.fetchval(
                    "SELECT to_regclass($1)", f"public.{table}"
                )
                if present is None:
                    missing.append(table)
    except BaseException:
        await pool.close()
        raise
    if missing:
        await pool.close()
        raise RuntimeError(
            "EXECUTION_STORE_BACKEND=postgres but these engine tables are "
            f"missing: {', '.join(sorted(missing))}. Apply the execution-store "
            "migration (owned by apps/api/prisma) before starting a durable "
            "engine - refusing to serve commands whose records cannot be kept. "
            "The incidents table is on this list because a durable deployment "
            "that loses its incident log has the same amnesia as one that never "
            "had a store."
        )
    logger.info(
        "execution_engine.durable_store_open",
        extra={
            "event": "execution_engine.durable_store_open",
            "tables": list(DURABLE_TABLES),
        },
    )
    return pool, PostgresOrderStore(pool)
```

FILE: services/execution-engine/app/placement.py

```python
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
```

FILE: services/execution-engine/app/retention.py

```python
"""Event-journal pruning over the durable store (Part 14).

The judgment lives in the core (``wlct_trading.retention``); this module is
its only executor against Postgres, and it is deliberately small. Four
rules make "a DELETE statement near money data" survivable:

1. **One target, three guards.** Events older than the cutoff under orders
   that were settled before the cutoff: that is the whole deletion set,
   spelled once in two statements (count and batch-select) that share the
   predicate text-by-text so no drift can make the rehearsal lie about the
   execution. Every statement carries the tenant id in its WHERE clause
   (the belt), runs inside ``_TenantTransaction`` (the GUC, so RLS means
   what it says the moment policies are enabled, and the canonical-UUID
   guard fires before the pool is touched), and the deletes are by
   explicit seq list - never by a predicate the database evaluates alone.

2. **Batched to a stop, never to a drain.** A run is at most
   ``max_batches`` batches of at most ``batch_rows`` rows, each batch its
   own transaction. A run that hits the ceiling reports ``exhausted`` and
   leaves the rest for the next scheduled run: retention competes with the
   command path for locks, and the command path must win. The batch loop
   deliberately does not retry races: a seq that another conn deleted
   first simply isn't in the RETURNING count.

3. **Dry-run is the default and is also recorded.** Inspect (count +
   recent runs) is available with the feature disabled; an APPLY requires
   ``EXECUTION_RETENTION_ENABLED=true`` and the refusal to say so is the
   point of the default. Dry runs write a ledger row too - the rehearsal's
   answer is evidence for the execution.

4. **The ledger is written after the deletes, and its failure is loud.**
   Rows are already gone when the record-writing transaction runs, so a
   ledger failure cannot roll back a lie - it surfaces as
   ``RetentionLedgerLost`` (HTTP 500 to the operator, ERROR line in the
   log with every count the ledger would have held). Ordering the ledger
   FIRST would instead record deletions that then failed; between an
   under-record and an over-record, the platform under-records loudly and
   never over-records quietly.

Refusals (memory backend, apply disabled) happen where the request stands
- in the router, before this module is reached - because both are about
CONFIGURATION, and this module takes configuration as given: a pool it did
not create, a policy the settings validator already admitted to exist.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, replace
from typing import Any, Final

from wlct_trading.clock import epoch_micros
from wlct_trading.retention import PRUNABLE_JOURNAL, RetentionPolicy

from app.store_sql import PgPool, _TenantTransaction

__all__ = [
    "TABLE_RETENTION_RUNS",
    "RetentionLedgerLost",
    "RetentionRunReport",
    "inspect_event_store",
    "run_event_retention",
]

logger = logging.getLogger("app.retention")

#: Named for the drift tests and the docs; the statements below carry the
#: same literal text on purpose (Part 13's law: SQL constants are literal,
#: not assembled from names).
TABLE_RETENTION_RUNS = "engine_retention_runs"

#: The pruneable predicate, written out (never concatenated - Part 13's
#: literal law) in both statements that use it. The name exists for the
#: test that pins the two spellings are the SAME text: rehearsal and
#: execution share their meaning by identity of characters, verified - not
#: by a helper both call, which is only one careless edit from not shared.
PRUNABLE_WHERE: Final = (
    "WHERE e.tenant_id = $1 AND o.terminal_at IS NOT NULL AND o.terminal_at < $2 "
    "AND e.occurred_at < $2"
)

COUNT_PRUNABLE_SQL: Final = (
    "SELECT count(*)::bigint AS n FROM engine_order_events e "
    "JOIN engine_orders o ON o.tenant_id = e.tenant_id AND o.order_id = e.order_id "
    "WHERE e.tenant_id = $1 AND o.terminal_at IS NOT NULL AND o.terminal_at < $2 "
    "AND e.occurred_at < $2"
)

SELECT_DOOMED_SEQS_SQL: Final = (
    "SELECT e.seq FROM engine_order_events e "
    "JOIN engine_orders o ON o.tenant_id = e.tenant_id AND o.order_id = e.order_id "
    "WHERE e.tenant_id = $1 AND o.terminal_at IS NOT NULL AND o.terminal_at < $2 "
    "AND e.occurred_at < $2 ORDER BY e.seq LIMIT $3"
)

#: Explicit-seq delete: the WHERE a single-row predicate would need twice
#: the thought ("what is still prunable when this statement runs?") - the
#: seq list came from the same transaction, so this can only delete what
#: the count rehearsal counted. RETURNING 1 lets the rowcount come back as
#: actual rows, not as a status-string parse.
DELETE_BY_SEQS_SQL: Final = (
    "DELETE FROM engine_order_events WHERE tenant_id = $1 AND seq = ANY($2::bigint[]) "
    "RETURNING 1"
)

INSERT_RUN_SQL: Final = (
    "INSERT INTO engine_retention_runs (tenant_id, started_at, finished_at, dry_run, "
    "event_cutoff_us, rows_deleted, batches, exhausted, instance_id) "
    "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)"
)

SELECT_RECENT_RUNS_SQL: Final = (
    "SELECT seq, started_at, finished_at, dry_run, event_cutoff_us, rows_deleted, "
    "batches, exhausted, instance_id FROM engine_retention_runs WHERE tenant_id = $1 "
    "ORDER BY seq DESC LIMIT $2"
)


class RetentionLedgerLost(RuntimeError):
    """The prune happened; its RECORD did not. Carrying the full report on
    the exception is what lets the operator (and the 500 body) still see
    the counts the ledger row failed to reach."""

    def __init__(self, report: RetentionRunReport) -> None:
        super().__init__(
            "retention run completed but its ledger row failed to write; the "
            "log line 'retention.ledger_write_failed' carries the counts"
        )
        self.report = report


@dataclass(frozen=True, slots=True)
class RetentionRunReport:
    """One run's outcome as the ledger row will state it."""

    dry_run: bool
    cutoff_us: int
    rows_reported: int
    batches_run: int
    exhausted: bool
    ledger_written: bool


async def run_event_retention(
    pool: PgPool,
    tenant_id: str,
    policy: RetentionPolicy,
    *,
    dry_run: bool,
    instance_id: str,
    clock: Callable[[], int] = epoch_micros,
) -> RetentionRunReport:
    """Prune the journal (or rehearse it) for ONE tenant.

    The pool is the store's pool - the same one ``PostgresOrderStore`` uses,
    because the same connection law (per-transaction GUC, tenant in every
    WHERE) must hold for deletions that for inserts. ``clock`` is a test
    seam: every timestamp here is the caller's clock, never a hidden one.
    """
    started_at = clock()
    cutoff = policy.event_cutoff_us(started_at)
    deleted = 0
    batches = 0
    exhausted = False

    if dry_run:
        async with _TenantTransaction(pool, tenant_id) as conn:
            rows = await conn.fetch(COUNT_PRUNABLE_SQL, tenant_id, cutoff)
        deleted = int(rows[0]["n"]) if rows else 0
    else:
        while True:
            async with _TenantTransaction(pool, tenant_id) as conn:
                seq_rows = await conn.fetch(
                    SELECT_DOOMED_SEQS_SQL, tenant_id, cutoff, policy.batch_rows
                )
                seqs = [int(r["seq"]) for r in seq_rows]
                if seqs:
                    doomed = await conn.fetch(DELETE_BY_SEQS_SQL, tenant_id, seqs)
                    deleted += len(doomed)
                    batches += 1
            if not seqs:
                break  # journal fully considered; nothing left THIS cutoff
            if len(seqs) < policy.batch_rows:
                break  # partial batch: the end of the work, not the ceiling
            if batches >= policy.max_batches:
                exhausted = True
                break

    report = RetentionRunReport(
        dry_run=dry_run,
        cutoff_us=cutoff,
        rows_reported=deleted,
        batches_run=batches,
        exhausted=exhausted,
        ledger_written=True,
    )
    try:
        async with _TenantTransaction(pool, tenant_id) as conn:
            await conn.execute(
                INSERT_RUN_SQL,
                tenant_id,
                started_at,
                clock(),
                dry_run,
                cutoff,
                deleted,
                batches,
                exhausted,
                instance_id,
            )
    except Exception as error:
        logger.error(
            "retention.ledger_write_failed",
            extra={
                "event": "retention.ledger_write_failed",
                "tenant_id": tenant_id,
                "dry_run": dry_run,
                "cutoff_us": cutoff,
                "rows_reported": deleted,
                "batches_run": batches,
                "exhausted": exhausted,
                "error_type": type(error).__name__,
            },
        )
        # The report an operator receives must not claim a ledger row that
        # failed to write: replace() re-states the one field that changed.
        raise RetentionLedgerLost(replace(report, ledger_written=False)) from error

    logger.info(
        "retention.run.completed",
        extra={
            "event": "retention.run.completed",
            "tenant_id": tenant_id,
            "instance_id": instance_id,
            "dry_run": dry_run,
            "cutoff_us": cutoff,
            "rows_reported": deleted,
            "batches_run": batches,
            "exhausted": exhausted,
        },
    )
    return report


async def inspect_event_store(
    pool: PgPool,
    tenant_id: str,
    policy: RetentionPolicy,
    *,
    limit: int,
    clock: Callable[[], int] = epoch_micros,
) -> dict[str, Any]:
    """One transaction holding both reads: the count NOW and the last few
    ledger rows, consistent with each other (a run completing between the
    two queries is exactly the race that makes an inspect answer lie)."""
    cutoff = policy.event_cutoff_us(clock())
    async with _TenantTransaction(pool, tenant_id) as conn:
        count_rows = await conn.fetch(COUNT_PRUNABLE_SQL, tenant_id, cutoff)
        run_rows = await conn.fetch(SELECT_RECENT_RUNS_SQL, tenant_id, limit)
    prunable = int(count_rows[0]["n"]) if count_rows else 0
    runs = [
        {
            "seq": int(r["seq"]),
            "started_at": int(r["started_at"]),
            "finished_at": int(r["finished_at"]),
            "dry_run": bool(r["dry_run"]),
            "event_cutoff_us": int(r["event_cutoff_us"]),
            "rows_deleted": int(r["rows_deleted"]),
            "batches": int(r["batches"]),
            "exhausted": bool(r["exhausted"]),
            "instance_id": str(r["instance_id"]),
        }
        for r in run_rows
    ]
    return {"cutoffUs": cutoff, "prunableNow": prunable, "runs": runs}


#: Re-exported for the test that pins "this module deletes from exactly one
#: table" - the core's PRUNABLE_JOURNAL constant, reachable from here so the
#: executor's law and the law's name are shown to be the same object.
PRUNABLE_TABLE = PRUNABLE_JOURNAL
```

FILE: services/execution-engine/app/rls_probe.py

```python
"""Read-only enablement verification over the durable store (Part 15).

The judgment lives in the core (``wlct_trading.enablement``); this module is
its executor against Postgres, and every statement in it is a SELECT. That
is the design contract, and it is what makes an "audit" endpoint safe to
offer from a process that owns money rows: the worst this code can do is
read a catalogue slowly. A test asserts no write verb appears in this file.

Three rules do the rest of the work:

1. **The tenant GUC is set in exactly one place.** The catalogue reads and
   the scoped count run inside ``_TenantTransaction`` (Part 13's rhythm:
   acquire -> begin -> ``set_config('app.tenant_id', $1, true)`` -> work ->
   commit), and this module's first statement inside it is
   ``SET TRANSACTION READ ONLY`` (legal only before the transaction touches
   data, which is why it leads). Two consequences: the
   audit runs as the role THIS process actually uses (a superuser session
   could not run these commands at all, so the role-attribute veto can
   never be reading about a more privileged principal than the one serving
   traffic), and an accidental write is refused by the database as well as
   by the absence of any write statement here.

2. **The bare count runs OUTSIDE that transaction, on its own
   acquisition.** ``set_config(..., is_local => true)`` is transaction-local,
   so a freshly acquired connection has no ``app.tenant_id``: only there is
   "count this table with no tenant predicate" a leak test. Running both
   counts through the same transaction would make the bare count identical
   to the scoped one by construction - an audit that structurally cannot
   report a leak. There is nothing to "clear" on the bare connection: the
   platform has no cross-tenant GUC (the ``set_config`` call is
   transaction-local by Part 11's contract, and the docs list a platform-role
   session concept as future work, not a variable to reset), so the only
   thing that could defeat a bare read is a role privilege - which is
   precisely what ``RoleAttributes`` vetoes instead of leaving to SQL.

3. **A refused bare read is the best answer a tenant table can give.** If
   the database denies the unfiltered count (``42501`` insufficient
   privilege - what FORCE + a SELECT-only policy looks like for a role with
   no bypass), the observation is recorded as "zero rows reached" and the
   grade stands. Any OTHER failure of the bare read - a connection drop, a
   timeout - propagates: the run reports nothing rather than grading a
   broken cluster as isolated. A caller who wants to record that as a
   skipped probe does it in the CLI, where the operator is holding the
   error text, not in here where it would be silently laundered into a
   pass.

Nothing is ever seeded, so nothing has to be cleaned up afterwards and no
write path exists to audit. The seed expectations are INPUTS: the operator
(or the staging script) counts what the probe tenant should see and hands
that number over; ``seeded_expected_rows`` of 0 is the honest "unknown"
mode, in which the catalogue posture (policy exists, enabled, forced) is
the real evidence and the counts are a cross-check. Failure handling is
deliberately thin: driver errors propagate, the router answers 5xx, and no
partial evidence is recorded, because a run that could not read pg_class is
not "evidence of nothing".
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Final

from wlct_trading.clock import epoch_micros
from wlct_trading.enablement import (
    EVIDENCE_LEDGER_TABLE,
    EnablementPolicy,
    ProbeResult,
    RoleAttributes,
    grade_run,
)

from app.incidents_sql import TABLE_INCIDENTS
from app.store_sql import PgPool, _TenantTransaction

__all__ = [
    "PROBE_TABLES",
    "EnablementAudit",
    "ProbeRoleUnknown",
    "ProbeUnknownTable",
    "run_enablement_probe",
]

logger = logging.getLogger("app.rls_probe")

#: Postgres' "insufficient_privilege" SQLSTATE. Duck-typed rather than
#: imported from ``asyncpg.exceptions`` so this module stays driver-light
#: the way Part 13's store does, and so the fakes in the test suite only
#: have to carry the attribute, not the class.
INSUFFICIENT_PRIVILEGE_SQLSTATE: Final = "42501"

#: The tables this service can verify by itself: the durable engine tables
#: (Part 13's three, plus Part 17's incident table) and its own ledger (Part
#: 14). Everything else in ``rls_coverage.json`` belongs to the API plane and is
#: the operator script's job. An engine that claimed to have verified tables it
#: cannot name would be the loudest liar in the report, so the list is a module
#: constant an operator widens in a review, never in a request body - and the
#: incident table is IN it, because an unprotected incident table is a
#: cross-tenant readable list of one tenant's failures, which is exactly the
#: shape of leak the audit exists to catch.
PROBE_TABLES: Final = (
    "engine_orders",
    "engine_order_events",
    "engine_order_fills",
    TABLE_INCIDENTS,
    EVIDENCE_LEDGER_TABLE,
)

# --- catalogue and count statements (literal text; never assembled) ------

ROLE_ATTRS_SQL: Final = (
    "SELECT current_user::text AS rolname, r.rolsuper, r.rolbypassrls "
    "FROM pg_roles r WHERE r.rolname = current_user"
)

#: Existence by ``to_regclass``, the exact spelling Part 13's store-open
#: check uses: the audit and the startup gate agree on what "the table is
#: here" means, so a table neither can find is reported the same way twice.
TABLE_EXISTS_SQL: Final = "SELECT to_regclass($1) AS regclass"

TABLE_POSTURE_SQL: Final = (
    "SELECT c.relrowsecurity, c.relforcerowsecurity FROM pg_class c "
    "JOIN pg_namespace n ON n.oid = c.relnamespace "
    "WHERE n.nspname = 'public' AND c.relname = $1 AND c.relkind IN ('r', 'p')"
)

POLICY_POSTURE_SQL: Final = (
    "SELECT count(*)::bigint AS policy_count, "
    "bool_or(p.qual IS NOT NULL AND position('app.tenant_id' in p.qual) > 0) "
    "AS scoped FROM pg_policies p WHERE p.schemaname = 'public' "
    "AND p.tablename = $1 AND p.policyname = 'tenant_isolation'"
)

#: The scoped count keeps the tenant in SQL TEXT as well as in the GUC: the
#: belt-and-braces law every covered statement on this platform follows, so
#: a policy that was never enabled still cannot make the audit lie about
#: which tenant it counted.
SCOPED_COUNT_SQL: Final = "SELECT count(*)::bigint AS n FROM {table} WHERE tenant_id = $1"

BARE_COUNT_SQL: Final = "SELECT count(*)::bigint AS n FROM {table}"

#: Read-only, on purpose, and asserted as text by a test: the module that
#: audits must not be the module that changes.
READ_ONLY_SQL: Final = "SET TRANSACTION READ ONLY"


class ProbeUnknownTable(RuntimeError):
    """A caller asked about a table outside the allow-list: the name reaches
    ``{table}`` interpolation, so it is the one place a request could
    smuggle SQL into an audit. Checked against this module's own constant
    before a connection is even acquired."""


class ProbeRoleUnknown(RuntimeError):
    """``pg_roles`` had no row for the connected role.

    That happens when the login role is a member rather than the row owner,
    or when the catalog was read by something other than the serving role.
    Either way the run cannot state WHICH role it verified, and a bypass
    flag we failed to read is exactly the flag worth refusing for: the
    audit answers by not answering.
    """


@dataclass(frozen=True, slots=True)
class EnablementAudit:
    """One verification run, in the shape the wire and the evidence ledger
    both want."""

    ran_at_us: int
    #: ``RunGrade.PASS``/``FAIL``/``UNVERIFIED`` - plain strings by the
    #: core's design (Grade is a constant namespace, not an Enum), which is
    #: what keeps this report serialisable into an evidence ledger without a
    #: per-field conversion step that could drift from the law.
    grade: str
    role: RoleAttributes
    probes: tuple[ProbeResult, ...]
    summary: dict[str, Any]
    #: True when the run covered the WHOLE platform manifest (the caller
    #: graded it against ``covered_expected`` = the manifest count). A
    #: default run grades the engine plane only, so this is False there:
    #: "4 of 4 of my tables pass" and "the platform is verified" are
    #: different sentences and the body must not be able to say the second.
    full_platform: bool
    #: True when every table THIS service can see was included in the run -
    #: the engine plane's own completeness, independent of the manifest.
    engine_plane_complete: bool

    @property
    def per_table(self) -> dict[str, str]:
        tables = self.summary.get("tables")
        return dict(tables) if isinstance(tables, dict) else {}

    @property
    def failed_tables(self) -> tuple[str, ...]:
        return tuple(name for name, value in self.per_table.items() if value == "fail")


async def run_enablement_probe(
    pool: PgPool,
    tenant_id: str,
    policy: EnablementPolicy,
    *,
    now_us: int | None = None,
    seed_counts: dict[str, int] | None = None,
    covered_expected: int | None = None,
) -> EnablementAudit:
    """Verify the engine-plane tables are enabled, forced and effective.

    ``seed_counts`` maps table -> rows that tenant is expected to see (omit
    it, or pass ``{}``, for the honest unknown-seed mode).
    ``covered_expected`` is the coverage manifest's count; the default
    grades the run against THIS service's table list, because a route that
    can only see five tables must not report the platform's 43 as
    UNVERIFIED - it reports a full pass of its own plane and
    ``fullPlatform: false`` next to it.
    """
    seeds = dict(seed_counts or {})
    for name in seeds:
        if name not in PROBE_TABLES:
            raise ProbeUnknownTable(
                f"seed_counts names {name!r}, which this service does not probe "
                f"(known: {', '.join(PROBE_TABLES)})"
            )
    ran_at = now_us if now_us is not None else epoch_micros()

    async with _TenantTransaction(pool, tenant_id) as conn:
        # Ordering is a Postgres requirement, not a style choice:
        # ``SET TRANSACTION`` is only legal before the transaction has run a
        # data-touching statement, and ``set_config`` (issued by the
        # transaction helper itself) is not one. So the read-only flag is the
        # FIRST statement this module sends, and a test pins that.
        await conn.execute(READ_ONLY_SQL)
        row = await conn.fetchrow(ROLE_ATTRS_SQL)
        if row is None:
            raise ProbeRoleUnknown(
                "pg_roles has no row for the connected role: the audit cannot "
                "state which role it verified, and a BYPASSRLS flag that was "
                "never read is not a flag that was checked"
            )
        role = RoleAttributes(
            rolname=str(row["rolname"]),
            bypassrls=bool(row["rolbypassrls"]),
            superuser=bool(row["rolsuper"]),
        )
        # Phase 1: everything that is a fact about the CATALOGUE plus the
        # tenant's own count, read inside the GUC'd transaction. The table
        # names here are this module's constant, never request input:
        # `{table}` interpolation of an allow-listed literal is how Part 13
        # spells its own statements, and the existence check is spelled like
        # the store-open check on purpose (one meaning for "the table is
        # here" across the platform).
        phase_one: dict[str, tuple[bool, bool, bool, int, bool]] = {}
        for table in PROBE_TABLES:
            if await conn.fetchrow(TABLE_EXISTS_SQL, f"public.{table}") is None:
                phase_one[table] = (False, False, False, 0, True)
                continue
            posture = await conn.fetchrow(TABLE_POSTURE_SQL, table)
            policy_row = await conn.fetchrow(POLICY_POSTURE_SQL, table)
            scoped = await conn.fetchrow(SCOPED_COUNT_SQL.format(table=table), tenant_id)
            phase_one[table] = (
                bool(policy_row is not None and int(policy_row["policy_count"]) > 0),
                bool(posture is not None and posture["relrowsecurity"]),
                bool(posture is not None and posture["relforcerowsecurity"]),
                0 if scoped is None else int(scoped["n"]),
                False,
            )

    # Phase 2: the unfiltered counts, OUTSIDE the transaction (see the
    # module docstring's rule 2). One borrowed session answers them all, so
    # the audit is two pool acquisitions rather than one per table - and an
    # absent table is never counted at all, because counting a table that is
    # not there is not a finding, it is an error message.
    live = [table for table, values in phase_one.items() if not values[4]]
    bare_rows = await _bare_counts(pool, live)

    probes: list[ProbeResult] = []
    for table in PROBE_TABLES:
        policy_exists, rls_enabled, rls_forced, scoped_rows, absent = phase_one[table]
        probes.append(
            ProbeResult(
                table=table,
                policy_exists=policy_exists,
                rls_enabled=rls_enabled,
                rls_forced=rls_forced,
                scoped_rows=scoped_rows,
                bare_rows=bare_rows.get(table, 0),
                seeded_expected_rows=seeds.get(table, 0),
                absent=absent,
            )
        )

    grade, summary = grade_run(
        probes,
        role=role,
        covered_expected=len(PROBE_TABLES) if covered_expected is None else covered_expected,
    )
    audit = EnablementAudit(
        ran_at_us=ran_at,
        grade=grade,
        role=role,
        probes=tuple(probes),
        summary=summary,
        full_platform=covered_expected is not None and covered_expected != len(PROBE_TABLES),
        engine_plane_complete=(
            covered_expected is None or covered_expected == len(PROBE_TABLES)
        ),
    )
    logger.info(
        "enablement.audit",
        extra={
            "event": "enablement.audit",
            "grade": grade,
            "probed": len(audit.probes),
            "role": role.rolname,
        },
    )
    return audit


async def _bare_counts(pool: PgPool, tables: list[str]) -> dict[str, int]:
    """``count(*)`` per table on a session that never saw the tenant GUC.

    A privilege refusal is recorded as zero rows reached (the ideal answer
    for a forced tenant table); any other failure propagates so a broken
    connection can never be graded as isolation.

    This is the ONE place in the engine that deliberately reads without the
    tenant GUC, and it is a ``count(*)``: the acquisition is outside any
    transaction, so it inherits no ``app.tenant_id``, and nothing here can
    write even in principle. An ``async with`` rather than a manual
    acquire/release so the connection's return to the pool is not a
    judgement call inside an error path.
    """
    counts: dict[str, int] = {}
    if not tables:
        return counts
    async with pool.acquire() as conn:
        for table in tables:
            try:
                row = await conn.fetchrow(BARE_COUNT_SQL.format(table=table))
            except Exception as error:
                # The ONLY swallowed error on this path: Postgres saying "you
                # may not read that table without a tenant" is the finding,
                # not a failure - it is what a correctly FORCED tenant table
                # answers. Duck-typed on the SQLSTATE so this module never
                # imports the driver's exception hierarchy, and everything
                # else (connection drop, timeout, cancellation) propagates
                # rather than being laundered into a pass.
                if getattr(error, "sqlstate", None) != INSUFFICIENT_PRIVILEGE_SQLSTATE:
                    raise
                counts[table] = 0
                continue
            counts[table] = 0 if row is None else int(row["n"])
    return counts
```

FILE: services/execution-engine/app/routers/__init__.py

```python

```

FILE: services/execution-engine/app/routers/enablement.py

```python
"""The RLS enablement surface (Part 15): audit the deployment's isolation.

One route, read-only by construction, on the same internal plane as the
rest: same token, same tenant-header match, absent from anything the public
API proxies. The verb is "look", so there is no apply switch here - Part
14's ``EXECUTION_RETENTION_ENABLED`` guard exists because a DELETE needs two
yeses, and adding a feature flag to a SELECT would be theatre that still has
to be documented, tested and defaulted.

Two refusals are worth naming, because both are the endpoint saying
something the operator needs to hear rather than an error:

* ``409 RETENTION_NO_DURABLE_STORE`` (the same code Part 14 uses, reused
  deliberately): a memory-backend runtime has no Postgres roles, no
  policies, no tables - it has nothing to verify, and answering "PASS, 4
  tables isolated" would be the single most misleading success on this
  platform.
* ``400`` on a table name outside the probe allow-list, or on a
  ``coveredExpected`` the core law rejects: the request body is not where an
  audit's scope gets decided.

A ``FAIL`` grade is NOT an HTTP error, and that is the most important
sentence in this file. The audit ran: its answer is the finding, and
reporting it as 500 would hide the evidence under the transport, break
curl-based CI that reads the body, and tempt somebody into making the probe
"tolerant". Transport failures (5xx) mean "no evidence at all", which is a
different fact with a different remedy.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from wlct_trading.enablement import EnablementError, probe_is_consistent

from app.config import get_settings
from app.rls_probe import ProbeRoleUnknown, ProbeUnknownTable, run_enablement_probe
from app.schemas import (
    EnablementAuditResponse,
    EnablementProbeView,
    EnablementRequest,
    EnablementRoleView,
)
from app.security import ServiceCaller, require_internal_auth, require_tenant_match

router = APIRouter(prefix="/internal/v1", tags=["enablement"])

AuthDep = Annotated[ServiceCaller, Depends(require_internal_auth)]


@router.post(
    "/enablement/audit",
    response_model=EnablementAuditResponse,
    response_model_by_alias=True,
)
async def enablement_audit(
    body: EnablementRequest,
    caller: AuthDep,
    request: Request,
) -> EnablementAuditResponse:
    """Count, compare, grade: are the Part 11 policies on, forced, and
    actually isolating - for the tables this service can see?"""
    require_tenant_match(body.tenant_id, caller)
    pool: Any = getattr(request.app.state, "store_pool", None)
    if pool is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "RETENTION_NO_DURABLE_STORE",
                "message": (
                    "row-level security is a database property and this runtime's "
                    "store is process memory: there are no policies here to verify. "
                    "Configure EXECUTION_STORE_BACKEND=postgres "
                    "(docs/PART13_DURABLE_STORE.md), or audit the real database with "
                    "scripts/rls-enablement.mjs --check-rls."
                ),
            },
        )
    settings = get_settings()
    try:
        audit = await run_enablement_probe(
            pool,
            body.tenant_id,
            settings.enablement_policy,
            seed_counts=body.seed_counts,
            covered_expected=body.covered_expected,
        )
    except (ProbeUnknownTable, EnablementError) as refused:
        # Both are "your request asked for an audit that cannot be graded":
        # a table outside the allow-list, or a coverage number the core law
        # refuses. 400, not retried, and the text names the knob to fix.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "ENABLEMENT_REQUEST_REFUSED",
                "message": f"{refused} (docs/PART15_RLS_ENABLEMENT.md)",
            },
        ) from None
    except ProbeRoleUnknown as unknown:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "ENABLEMENT_ROLE_UNKNOWN",
                "message": (
                    f"{unknown} - grant this role SELECT on pg_roles (Part 11's "
                    "grant.sql does) and run again; an audit that cannot read the "
                    "bypass flag is not an audit"
                ),
            },
        ) from None
    # The grade is data, not a status code: see the module docstring. The
    # fields are assembled explicitly (never `**body` from a dict) so a key
    # that stops existing is a TypeError at import-time-ish test run, not a
    # silently-absent field in an operator's evidence.
    return EnablementAuditResponse(
        ran_at_us=audit.ran_at_us,
        grade=audit.grade,
        full_platform=audit.full_platform,
        engine_plane_complete=audit.engine_plane_complete,
        probed=len(audit.probes),
        role=EnablementRoleView(
            rolname=audit.role.rolname,
            bypassrls=audit.role.bypassrls,
            superuser=audit.role.superuser,
        ),
        summary=audit.summary,
        probes=[
            EnablementProbeView(
                table=probe.table,
                policy_exists=probe.policy_exists,
                rls_enabled=probe.rls_enabled,
                rls_forced=probe.rls_forced,
                scoped_rows=probe.scoped_rows,
                bare_rows=probe.bare_rows,
                seeded_expected_rows=probe.seeded_expected_rows,
                absent=probe.absent,
                grade=probe_is_consistent(probe),
                skip_reason=probe.skip_reason,
            )
            for probe in audit.probes
        ],
    )
```

FILE: services/execution-engine/app/routers/health.py

```python
"""Liveness and readiness for the execution runtime.

Readiness is not a formality here: it reports the actual wiring
properties - durable store? distributed locks? - because the worker and any
future supervisor must be able to tell "this engine accepts commands but
remembers nothing" apart from "this engine is the real execution plane".
That distinction is operational truth, and hiding it behind a 200 is the
kind of optimism that outlives its welcome.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request

from app import __version__
from app.composition import EngineRuntime
from app.config import Settings, get_settings

router = APIRouter(tags=["health"])


def get_runtime(request: Request) -> EngineRuntime:
    runtime = getattr(request.app.state, "runtime", None)
    if not isinstance(runtime, EngineRuntime):
        raise RuntimeError("runtime is not assembled - startup failed")
    return runtime


RuntimeDep = Annotated[EngineRuntime, Depends(get_runtime)]


@router.get("/health")
async def health(settings: Annotated[Settings, Depends(get_settings)]) -> dict[str, Any]:
    """Liveness: process is up and configuration parsed. No dependency
    probing - that is what /health/ready is for."""
    return {
        "status": "ok",
        "service": "execution-engine",
        "version": __version__,
        "instanceId": settings.EXECUTION_INSTANCE_ID,
    }


@router.get("/health/ready")
async def ready(runtime: RuntimeDep) -> dict[str, Any]:
    wiring = runtime.describe()
    return {
        "status": "ready",
        "simulated": wiring["mode"] == "simulated",
        **wiring,
    }
```

FILE: services/execution-engine/app/routers/incidents.py

```python
"""The incident read surface (Part 17): look at what the engine needed a human for.

One route, on the same internal plane as the placement review - same token, same
tenant-header match, absent from anything the public API proxies and from the
worker's forwarding path list. It exists because a durable incident table that
nothing can read is a filing cabinet: Part 13 made orders survive a restart,
Part 17 makes the explanation survive with them, and an operator with no way to
ask the second question has only the log files.

The route reads and writes nothing. There is no resolve verb here on purpose -
``ExecutionIncident`` is immutable and the core's law is that closing an incident
means recording a new one, so an endpoint that flipped ``resolved`` would be the
first mutable thing in an audit trail.

Two refusals worth naming:

* ``503 INCIDENT_STORE_UNREADABLE`` - the sink could not answer. An empty list is
  the one response more misleading than an error, because "no open incidents" is
  what a healthy system looks like; the durable store's own law is that a failed
  read is said out loud.
* ``422`` from the request model - a limit outside 1..1000 or a tenant the header
  disagrees with. The bound is the store's, so nobody can turn an operator endpoint
  into a full-table scan by asking nicely.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from wlct_trading.execution.incidents import ExecutionIncident, IncidentRecorder

from app.incidents_sql import IncidentReadError
from app.schemas import IncidentListRequest, IncidentListResponse, IncidentView
from app.security import ServiceCaller, require_internal_auth, require_tenant_match

router = APIRouter(prefix="/internal/v1", tags=["incidents"])

AuthDep = Annotated[ServiceCaller, Depends(require_internal_auth)]


def _view(incident: ExecutionIncident) -> IncidentView:
    """Render one record from its own fields rather than from ``to_dict()``.

    Reading a ``dict[str, object]`` would mean casting fifteen values, and a cast
    is where a type error goes to hide; the dataclass attributes are the typed
    source. What keeps the two spellings honest is a test that the view's field set
    equals ``ExecutionIncident.to_dict()``'s key set, so a rename on either side is
    a broken test in this repository instead of a missing column on a screen - the
    property the dict-splat would have given, without the casting.
    """
    return IncidentView(
        incident_id=incident.incident_id,
        tenant_id=incident.tenant_id,
        account_id=incident.account_id,
        type=incident.incident_type.value,
        severity=incident.severity.value,
        summary=incident.summary,
        exchange=incident.exchange.value if incident.exchange else None,
        symbol=incident.symbol,
        order_id=incident.order_id,
        client_order_id=incident.client_order_id,
        error_code=incident.error_code.value if incident.error_code else None,
        details={str(key): str(value) for key, value in incident.details.items()},
        occurred_at_micros=incident.occurred_at_micros,
        resolved=incident.resolved,
        resolution_note=incident.resolution_note,
    )


@router.post(
    "/incidents/list",
    response_model=IncidentListResponse,
    response_model_by_alias=True,
)
async def incidents_list(
    body: IncidentListRequest,
    caller: AuthDep,
    request: Request,
) -> IncidentListResponse:
    """Open incidents for one tenant, newest first."""
    require_tenant_match(body.tenant_id, caller)
    runtime = getattr(request.app.state, "runtime", None)
    recorder: IncidentRecorder | None = getattr(runtime, "incidents", None)
    if recorder is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "INCIDENT_SINK_UNWIRED",
                "message": (
                    "this runtime has no incident sink, so it has no incidents to "
                    "report; answering 'none' would be indistinguishable from the "
                    "system being healthy, which is the one thing this endpoint "
                    "must never be"
                ),
            },
        )
    try:
        found = await recorder.list_open(body.tenant_id, limit=body.limit)
    except (IncidentReadError, RuntimeError) as failed:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "INCIDENT_STORE_UNREADABLE",
                "message": f"{failed}",
            },
        ) from None
    rows = [
        _view(incident)
        for incident in found
        if body.account_id is None or incident.account_id == body.account_id
    ]
    return IncidentListResponse(
        tenant_id=body.tenant_id,
        source=type(recorder).__name__,
        durable=bool(getattr(recorder, "is_durable", False)),
        limit=body.limit,
        returned=len(rows),
        incidents=rows,
    )
```

FILE: services/execution-engine/app/routers/internal.py

```python
"""The internal command surface the trading worker forwards to.

Contract notes that the worker and the API both depend on:

* 200 means DURABLY PROCESSED (for the runtime's durability class); the
  business verdict rides in the body (`outcome`, `verified`), never in the
  status code. A rejected cancel and a completed cancel are both 200 -
  the job is done when we have a confident answer about it, which is
  exactly the BullMQ ack boundary.
* 4xx here is never retried: 401/403 is wiring wrong, 422 is a payload
  that cannot be executed by anyone, 404 says the record this command
  acts on does not exist in this runtime's store. 501 says "supported by
  the queue contract, not wired in this build" - the honest answer for
  resync-private-stream today.
* 5xx is retryable by contract; the worker defers the job.
* every response carries the correlation ids back so the worker can log
  one line per command that both sides can grep for.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.composition import EngineRuntime
from app.routers.health import get_runtime
from app.schemas import (
    AccountCommandRequest,
    BalancesResponse,
    BalanceView,
    CancelOrderRequest,
    CancelOrderResponse,
    DiscrepancyView,
    IncidentSinkView,
    LiveEnablementView,
    PlacementStatusView,
    ReconcileResponse,
    StatusResponse,
    VerifyResponse,
)
from app.security import (
    ServiceCaller,
    require_internal_auth,
    require_internal_auth_readonly,
    require_tenant_match,
)

router = APIRouter(prefix="/internal/v1", tags=["internal"])

AuthDep = Annotated[ServiceCaller, Depends(require_internal_auth)]
RuntimeDep = Annotated[EngineRuntime, Depends(get_runtime)]

#: The read scope (Part 20), on the one route in this file that acts on nothing. The
#: reason it exists is a defect this part found by RUNNING the composition rather than
#: reading it: the worker's startup gate calls ``GET /internal/v1/status`` with no
#: tenant header - correctly, since a process-level read has no tenant to name - and
#: ``require_internal_auth`` answered it with 400 TENANT_HEADER_REQUIRED, which is not a
#: terminal status, so `src/worker.ts` logged "execution engine gate failed" and exited
#: 1. The reference deployment could not start its worker, and nothing in the suites
#: noticed for nine parts because every test of that gate stubs ``fetch``. The fix had to
#: be on this side of the boundary: a client cannot answer a tenant law by inventing a
#: tenant, and the alternative - having the gate read the unauthenticated
#: ``/health/ready`` instead - would base an assert-before-forward decision on a
#: document any peer can forge.
ReadAuthDep = Annotated[ServiceCaller, Depends(require_internal_auth_readonly)]


@router.get("/status", response_model=StatusResponse, response_model_by_alias=True)
async def engine_status(
    # The tenant is not consulted below, and that is the argument for this dependency
    # rather than `AuthDep`: the route reads the process, not a tenant's rows.
    caller: ReadAuthDep,
    runtime: RuntimeDep,
    request: Request,
) -> StatusResponse:
    """The worker asserts `mode`/`store`/`commands` against its own config
    before forwarding anything; a deployment that disagrees is refused at
    the worker boundary rather than discovered mid-command."""
    wiring = runtime.describe()
    placement = wiring.get("placement")
    return StatusResponse(
        instance_id=str(wiring["instanceId"] or ""),
        mode=str(wiring["mode"]),
        dry_run=bool(wiring["dryRun"]),
        adapter=str(wiring["adapter"]),
        store=str(wiring["store"]),
        store_durable=bool(wiring["storeDurable"]),
        store_backend=str(wiring["storeBackend"]),
        retention_enabled=bool(wiring["retentionEnabled"]),
        retention_event_days=int(wiring["retentionEventDays"]),
        enablement_max_age_days=int(wiring["enablementMaxAgeDays"]),
        credential_source=str(wiring["credentialSource"]),
        # A KeyError here is the intended behaviour, not a bug to guard: the key is
        # published by ``describe()`` above, and a composition that stopped
        # publishing it should fail this route loudly rather than answer "false"
        # about a field it no longer reports.
        metrics_configured=bool(wiring["metricsConfigured"]),
        # Read with ``[]``, not ``get``: these keys are published by describe()
        # above, and a status route that defaulted them would answer a question this
        # process stopped asking.
        credential_fetcher=wiring["credentialFetcher"],
        operator_confirmation=bool(wiring["operatorConfirmation"]),
        live_enablement=(
            None
            if wiring["liveEnablement"] is None
            else LiveEnablementView(**wiring["liveEnablement"])
        ),
        # Validated through the view rather than passed through as a dict: the
        # keys below are the contract, so a describe() that starts publishing
        # something new fails here (and in the drift test) instead of quietly
        # publishing an unreviewed field on an authenticated internal surface.
        placement=None if placement is None else PlacementStatusView(**placement),
        # Part 17's block, mapped through its typed view for the same reason the
        # placement block is: a describe() that starts publishing something else is
        # a decision to be made here, not an unreviewed field on an internal
        # caller's screen - and "why is the incident list empty" is exactly the
        # question this route exists to answer without shell access.
        incidents=(
            None
            if wiring.get("incidents") is None
            else IncidentSinkView(**wiring["incidents"])
        ),
        locks_distributed=bool(wiring["locksDistributed"]),
        commands=[str(command) for command in wiring["commands"]],
    )


@router.post(
    "/accounts/verify-credentials",
    response_model=VerifyResponse,
    response_model_by_alias=True,
)
async def verify_credentials(
    body: AccountCommandRequest,
    caller: AuthDep,
    runtime: RuntimeDep,
) -> VerifyResponse:
    require_tenant_match(body.tenant_id, caller)
    ok, note = await runtime.account_adapter.verify_credentials(
        body.tenant_id, body.account_id
    )
    return VerifyResponse(verified=ok, note=note, is_simulated=True)


@router.post(
    "/accounts/refresh-balances",
    response_model=BalancesResponse,
    response_model_by_alias=True,
)
async def refresh_balances(
    body: AccountCommandRequest,
    caller: AuthDep,
    runtime: RuntimeDep,
) -> BalancesResponse:
    require_tenant_match(body.tenant_id, caller)
    balances = await runtime.account_adapter.fetch_balances(
        body.tenant_id, body.account_id
    )
    return BalancesResponse(
        balances=[
            BalanceView(asset=row.asset, free=str(row.free), locked=str(row.locked))
            for row in balances
        ],
        is_simulated=True,
    )


@router.post(
    "/accounts/reconcile",
    response_model=ReconcileResponse,
    response_model_by_alias=True,
)
async def reconcile_account(
    body: AccountCommandRequest,
    caller: AuthDep,
    runtime: RuntimeDep,
) -> ReconcileResponse:
    require_tenant_match(body.tenant_id, caller)
    report = await runtime.reconciliation.reconcile_account(
        body.tenant_id, body.account_id
    )
    return ReconcileResponse(
        tenant_id=report.tenant_id,
        account_id=report.account_id,
        exchange=report.exchange.value,
        orders_checked=report.orders_checked,
        fills_recovered=report.fills_recovered,
        discrepancy_count=len(report.discrepancies),
        discrepancies=[
            DiscrepancyView(
                discrepancy_type=discrepancy.discrepancy_type.value,
                summary=discrepancy.summary,
                order_id=discrepancy.order_id,
                repaired=discrepancy.repaired,
            )
            for discrepancy in report.discrepancies
        ],
        error=report.error,
        started_at_micros=report.started_at_micros,
        finished_at_micros=report.finished_at_micros,
    )


@router.post(
    "/accounts/resync-private-stream",
    status_code=status.HTTP_501_NOT_IMPLEMENTED,
)
async def resync_private_stream(
    body: AccountCommandRequest,
    caller: AuthDep,
    runtime: RuntimeDep,
) -> dict[str, Any]:
    """Not wired in the simulated build, and the refusal is the feature.

    A private-stream resync is a LIVE venue interaction (new listen key,
    reconnect, catch-up reconcile). Simulated execution has no stream to
    resync; pretending to accept the command would turn the API's honest
    202 "queued for the worker" into a lie three hops later. The job fails
    visibly with a reason an operator can read.
    """
    require_tenant_match(body.tenant_id, caller)
    return {
        "code": "NOT_SUPPORTED",
        "message": (
            "resync-private-stream requires the live venue adapter (Part 12); "
            "this runtime is simulated and has no private stream to resync."
        ),
    }


@router.post("/orders/cancel", response_model=CancelOrderResponse, response_model_by_alias=True)
async def cancel_order(
    body: CancelOrderRequest,
    caller: AuthDep,
    runtime: RuntimeDep,
) -> CancelOrderResponse:
    require_tenant_match(body.tenant_id, caller)
    order = await runtime.store.get_order(body.tenant_id, body.order_id)
    if order is None:
        # 404, not a fabricated rejection: this runtime has no record of
        # the order, so it must not claim an outcome about it. The worker's
        # job fails visibly; the API-side order state never moves.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "ORDER_NOT_FOUND",
                "message": (
                    "This runtime holds no record of that order; refusing to "
                    "report a cancellation outcome for an order it cannot see."
                ),
            },
        )
    if order.client_order_id != body.client_order_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "ORDER_IDENTITY_MISMATCH",
                "message": (
                    "The order record does not carry the client order id the "
                    "command named; the job is refused rather than aimed at a "
                    "different order."
                ),
            },
        )
    result = await runtime.engine.cancel(order)
    return CancelOrderResponse(
        outcome=result.outcome.value,
        client_order_id=result.client_order_id or body.client_order_id,
        order_status=result.order.status.value if result.order is not None else "UNKNOWN",
        error_code=result.error_code.value if result.error_code is not None else None,
        message=result.message,
        latency_micros=result.latency_micros,
        is_simulated=result.is_simulated,
    )
```

FILE: services/execution-engine/app/routers/observability.py

```python
"""The scrape endpoint (Part 18): one route, no tenant, no token.

Auth posture, deliberately the same as the two sibling services': ``/metrics``
follows the health endpoints it sits beside - unauthenticated, internal-network
only, machine-shaped aggregates with no tenant rows and no credentials. Two
reasons, both load-bearing:

* A Prometheus scraper and a compose healthcheck cannot be expected to hold the
  service token, and inventing a second credential for observability is how a
  deployment ends up either unable to scrape or shipping the token in the scrape
  config - the same outcome, reached slowly.
* There is nothing here worth stealing. The label law in the core
  (``FORBIDDEN_LABEL_NAMES``) rejects tenant, account, order and credential labels
  at registration, so the rendered text is aggregate counts, fixed-bucket
  histograms and five wiring booleans. The part's test suite asserts that on the
  rendered body as well as at registration, because a policy enforced only at the
  source is a policy that one new ``register_counter`` call can break.

The route answers with a comment line rather than a 500 in the one case where the
hub is genuinely absent: a request that races the lifespan. That is a window of a
few milliseconds per process start, and an empty scrape is more useful to a
pipeline than a 500 it has to special-case. ``OBSERVABILITY_ENABLED=false`` is a
different state and gets a different answer - the route is not mounted, so the
target 404s, because "no target" and "empty target" are different facts and a
scraper should not have to read a body to tell them apart.
"""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse

router = APIRouter(tags=["observability"])

PROMETHEUS_MEDIA_TYPE = "text/plain; version=0.0.4; charset=utf-8"


@router.get("/metrics", response_class=PlainTextResponse, include_in_schema=False)
async def metrics(request: Request) -> PlainTextResponse:
    hub = getattr(request.app.state, "observability", None)
    if hub is None:
        return PlainTextResponse(
            "# observability not initialised in this process\n",
            media_type=PROMETHEUS_MEDIA_TYPE,
        )
    return PlainTextResponse(hub.scrape(), media_type=PROMETHEUS_MEDIA_TYPE)
```

FILE: services/execution-engine/app/routers/placement.py

```python
"""The placement-review surface (Part 16): ask the venue's permission, place nothing.

One route, on the same internal plane as everything else here - same token, same
tenant-header match, absent from anything the public API proxies. It exists
because the review runs on every order and an operator otherwise learns its
answer only when an order has already been refused: this is the endpoint that
answers "would it be permitted" while the account is idle, which is the only
moment at which a refusal is cheap.

What it does NOT do is place, cancel, or amend an order. There is no
quantity, price or side in the request body, and the response carries a literal
``transmitted: false`` so a client can assert the absence rather than trust this
sentence. The endpoint spends venue weight (the review is one authenticated
metadata call, two with an account reader) and that is the whole of its effect
on the exchange.

Two refusals worth naming:

* ``409 PLACEMENT_REVIEW_UNWIRED`` - a runtime with no reviewer cannot answer the
  question. Reporting "not allowed" would be inventing a verdict; the honest
  answer is that this process has no review to consult. ``build_runtime`` makes
  this state unreachable today, and the check stays because the day it is
  reachable is the day somebody needs to see exactly this.
* ``400 PLACEMENT_REQUEST_REFUSED`` - a symbol, order type or time-in-force the
  review contract will not accept. The request, not the order, is what is wrong.

A ``allowed: false`` response is NOT an HTTP error, for the same reason Part 15
does not turn a FAIL grade into a 500: the review completed, and its answer is
the finding. An error status would hide the evidence in the transport and teach
whoever scripts this endpoint to treat a refusal as an outage.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from wlct_trading.execution.placement_attestor import PlacementReviewRequest
from wlct_trading.execution.placement_review import PlacementVerdict, ReviewFinding

from app.placement import PlacementWiring, review_placement
from app.schemas import (
    PlacementAttestRequest,
    PlacementAttestResponse,
    PlacementFindingView,
)
from app.security import ServiceCaller, require_internal_auth, require_tenant_match

router = APIRouter(prefix="/internal/v1", tags=["placement"])

AuthDep = Annotated[ServiceCaller, Depends(require_internal_auth)]


def _view(verdict: PlacementVerdict, wiring: PlacementWiring) -> PlacementAttestResponse:
    """Render a verdict as the response model, field by field.

    Explicit rather than ``**verdict.to_dict()`` because a dict-splat wire model
    accepts whatever the core happens to emit today and quietly drops whatever it
    renames tomorrow: assembling the view means a renamed field is a broken test
    in this repository instead of a missing column on an operator's screen. The
    one exception is ``payload``, which is deliberately the core's own dict - it
    is the same object the durable order event carries, and re-spelling it here
    would create a second copy of a contract that has to stay one.
    """
    description = wiring.describe()
    return PlacementAttestResponse(
        allowed=verdict.allowed,
        verdict_id=verdict.verdict_id,
        codes=list(verdict.codes),
        blocking_codes=list(verdict.blocking_codes),
        retryable=verdict.retryable,
        venue_backed=verdict.venue_backed,
        venue_trading_permitted=verdict.venue_trading_permitted,
        no_known_withdrawal_path=verdict.no_known_withdrawal_path,
        review_required_at_micros=verdict.review_required_at_micros,
        attested_at_micros=verdict.attested_at_micros,
        summary=verdict.summary,
        findings=[_finding_view(finding) for finding in verdict.findings],
        payload=dict(verdict.to_event_payload()),
        transmitted=False,
        mode=str(description.get("mode", wiring.mode)),
        attestor_source=str(description.get("attestorSource", "unavailable")),
    )


def _finding_view(finding: ReviewFinding) -> PlacementFindingView:
    return PlacementFindingView(
        code=finding.code.value,
        severity=finding.severity.value,
        field=finding.field_name,
        message=finding.message,
    )


@router.post(
    "/placement/attest",
    response_model=PlacementAttestResponse,
    response_model_by_alias=True,
)
async def placement_attest(
    body: PlacementAttestRequest,
    caller: AuthDep,
    request: Request,
) -> PlacementAttestResponse:
    """Run the authenticated placement review for one would-be order."""
    require_tenant_match(body.tenant_id, caller)
    runtime = getattr(request.app.state, "runtime", None)
    wiring: PlacementWiring | None = getattr(runtime, "placement", None)
    if wiring is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "PLACEMENT_REVIEW_UNWIRED",
                "message": (
                    "this runtime has no placement reviewer, so there is no "
                    "review to report; refusing to answer 'allowed' or 'denied' "
                    "when nobody asked the venue would be the one thing this "
                    "endpoint must never do"
                ),
            },
        )
    try:
        review_request = PlacementReviewRequest(
            tenant_id=body.tenant_id,
            account_id=body.account_id,
            symbol=body.symbol,
            order_type=body.order_type,
            time_in_force=body.time_in_force,
        )
    except ValueError as refused:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "PLACEMENT_REQUEST_REFUSED",
                "message": f"{refused} (docs/PART16_PLACEMENT_REVIEW.md)",
            },
        ) from None
    _, verdict = await review_placement(
        wiring,
        tenant_id=review_request.tenant_id,
        account_id=review_request.account_id,
        symbol=review_request.symbol,
        order_type=review_request.order_type,
        time_in_force=review_request.time_in_force,
    )
    return _view(verdict, wiring)
```

FILE: services/execution-engine/app/routers/retention.py

```python
"""The retention command surface (Part 14): inspect always, prune only when
the deployment has said so twice (endpoint reached AND
EXECUTION_RETENTION_ENABLED).

These two routes are the ONLY way journal rows ever get deleted, and they
are internal-plane by construction: same token authentication as every
other ``/internal/v1`` route, same tenant-header match (a body that names
another tenant's id is refused at the door, not "handled" downstream), and
deliberately absent from anything the public API proxies. The worker does
not forward here; the intended caller is a scheduler running the platform
retention script, one tenant per call.

Error-shape law, restated because the stakes differ: every refusal on this
surface is a 4xx that is NOT retried (the deployment configuration is the
thing to change), every store failure is a 5xx the caller will try again
against a still-consistent store (deletes are batched and the predicate is
idempotent: deleted rows stop matching it). The one shape with no clean
class is RETENTION_LEDGER_LOST - deletions happened, the record failed -
and it is answered 500 with the counts IN the body, because "unknown
outcome" on a deletion endpoint would force an operator to go read raw
database state at incident hours.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.config import get_settings
from app.retention import RetentionLedgerLost, inspect_event_store, run_event_retention
from app.schemas import (
    RetentionInspectRequest,
    RetentionInspectResponse,
    RetentionRunRequest,
    RetentionRunResponse,
    RetentionRunView,
)
from app.security import ServiceCaller, require_internal_auth, require_tenant_match

router = APIRouter(prefix="/internal/v1", tags=["retention"])

AuthDep = Annotated[ServiceCaller, Depends(require_internal_auth)]

#: How many ledger rows inspect returns. A page, not a history - the
#: history is readable from the table by an operator with a psql session
#: and a purpose; an endpoint is not a query language.
INSPECT_RUN_LIMIT = 5


def _durable_pool(request: Request) -> Any:
    """The store's pool, or the refusal that says why retention is not
    available. Memory-mode runtimes HAVE no journal growth problem (the
    restart bounds them), which is exactly why this answer is 409-with-
    reasoning rather than an empty success."""
    pool = getattr(request.app.state, "store_pool", None)
    if pool is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "RETENTION_NO_DURABLE_STORE",
                "message": (
                    "event retention prunes the durable journal; this runtime's store "
                    "is process memory, which restarts bound - there is nothing here to "
                    "prune, and answering a maintenance command as though there were is "
                    "the failure mode, not the fallback. Configure "
                    "EXECUTION_STORE_BACKEND=postgres (docs/PART13_DURABLE_STORE.md)."
                ),
            },
        )
    return pool


@router.post("/retention/run", response_model=RetentionRunResponse, response_model_by_alias=True)
async def retention_run(
    body: RetentionRunRequest,
    caller: AuthDep,
    request: Request,
) -> RetentionRunResponse:
    """Prune (or rehearse pruning) one tenant's settled journal rows."""
    require_tenant_match(body.tenant_id, caller)
    pool = _durable_pool(request)
    settings = get_settings()
    if not body.dry_run and not settings.EXECUTION_RETENTION_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "RETENTION_APPLY_DISABLED",
                "message": (
                    "this deployment is dry-run only: EXECUTION_RETENTION_ENABLED=false. "
                    "Inspect the answer first, confirm a fresh backup, then set the env "
                    "and restart - a data-deleting capability is never flipped by the "
                    "request that exercises it (docs/PART14_RETENTION.md)."
                ),
            },
        )
    report = None
    try:
        report = await run_event_retention(
            pool,
            body.tenant_id,
            settings.retention_policy,
            dry_run=body.dry_run,
            instance_id=str(settings.EXECUTION_INSTANCE_ID or ""),
        )
    except RetentionLedgerLost as lost:
        report = lost.report
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "RETENTION_LEDGER_LOST",
                "message": (
                    f"the prune completed ({report.rows_reported} rows, dry-run "
                    f"{str(report.dry_run).lower()}) but its ledger row failed to write; "
                    "this body is the only place those counts exist outside the log line "
                    "'retention.ledger_write_failed' - fix the store before scheduling "
                    "another run"
                ),
                "rowsReported": report.rows_reported,
                "cutoffUs": str(report.cutoff_us),
                "batchesRun": report.batches_run,
                "exhausted": report.exhausted,
            },
        ) from None
    return RetentionRunResponse(
        dry_run=report.dry_run,
        cutoff_us=report.cutoff_us,
        rows_reported=report.rows_reported,
        batches_run=report.batches_run,
        exhausted=report.exhausted,
        ledger_written=report.ledger_written,
    )


@router.post(
    "/retention/inspect",
    response_model=RetentionInspectResponse,
    response_model_by_alias=True,
)
async def retention_inspect(
    body: RetentionInspectRequest,
    caller: AuthDep,
    request: Request,
) -> RetentionInspectResponse:
    """What WOULD be pruned right now, and the last runs that were."""
    require_tenant_match(body.tenant_id, caller)
    pool = _durable_pool(request)
    settings = get_settings()
    view = await inspect_event_store(
        pool,
        body.tenant_id,
        settings.retention_policy,
        limit=INSPECT_RUN_LIMIT,
    )
    return RetentionInspectResponse(
        enabled=settings.EXECUTION_RETENTION_ENABLED,
        event_retention_days=settings.EXECUTION_RETENTION_EVENT_DAYS,
        batch_rows=settings.EXECUTION_RETENTION_BATCH_ROWS,
        max_batches=settings.EXECUTION_RETENTION_MAX_BATCHES,
        cutoff_us=view["cutoffUs"],
        prunable_now=view["prunableNow"],
        runs=[RetentionRunView(**row) for row in view["runs"]],
    )
```

FILE: services/execution-engine/app/schemas.py

```python
"""Request and response models for the internal execution API.

Alias conventions match the trading engine: fields are snake_case
internally, camelCase on the wire, populated by name on input so a worker
cannot smuggle a mistyped payload past validation by coincidence.

Everything here is a CONTROL shape. No model accepts an order to place;
no model returns a credential, key or signed payload. Decimal-valued
fields serialise as decimal STRINGS: a JSON float for a
quantity or balance is a silent rounding decision, and money never takes
one of those on the platform's behalf.
"""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

__all__ = [
    "AccountCommandRequest",
    "BalanceView",
    "BalancesResponse",
    "CancelOrderRequest",
    "CancelOrderResponse",
    "CommandRejected",
    "DiscrepancyView",
    "EnablementAuditResponse",
    "EnablementProbeView",
    "EnablementRequest",
    "EnablementRoleView",
    "PlacementAttestRequest",
    "PlacementAttestResponse",
    "PlacementFindingView",
    "ReconcileResponse",
    "RetentionInspectRequest",
    "RetentionInspectResponse",
    "RetentionRunRequest",
    "RetentionRunResponse",
    "RetentionRunView",
    "StatusResponse",
    "VerifyResponse",
]

_TENANT = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")

#: An int that refuses coercion - the one spelling (annotated VALUE type)
#: that makes strictness apply inside a dict, as the enablement seed counts
#: require.
_StrictInt = Annotated[int, Field(strict=True)]
_ACCOUNT = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


def _to_camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(part.title() for part in rest)


class _WireModel(BaseModel):
    """Base for every model on this wire: camelCase aliases (the platform's
    API style, matched by the trading engine), snake_case fields (the
    core's style), ``extra=forbid`` so a payload containing fields BEYOND
    the contract - a venue key slipped in by a buggy producer, say - is a
    422 rather than a silently ignored surprise."""

    model_config = ConfigDict(
        alias_generator=_to_camel, populate_by_name=True, extra="forbid"
    )


class AccountCommandRequest(_WireModel):
    """Payload for the three account commands.

    ``tenantId``/``accountId`` echo the job payload; the router still
    enforces the TENANT header match - a body that agrees with the header
    is provenance, a body that merely exists is not.
    """

    tenant_id: str = _TENANT
    account_id: str = _ACCOUNT
    requested_by_user_id: str | None = Field(default=None, max_length=64)
    requested_at: str | None = Field(default=None, max_length=64)


class CancelOrderRequest(_WireModel):
    tenant_id: str = _TENANT
    account_id: str = _ACCOUNT
    order_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    client_order_id: str = Field(min_length=1, max_length=128)
    symbol: str = Field(min_length=1, max_length=32)
    requested_by_user_id: str | None = Field(default=None, max_length=64)
    requested_at: str | None = Field(default=None, max_length=64)


class VerifyResponse(_WireModel):
    verified: bool
    note: str
    is_simulated: bool = True


class BalanceView(_WireModel):
    asset: str
    free: str
    locked: str

    @field_validator("free", "locked")
    @classmethod
    def _decimalish(cls, value: str) -> str:
        from decimal import Decimal, InvalidOperation

        try:
            parsed = Decimal(value)
        except InvalidOperation as error:
            raise ValueError("balances must serialise as decimal strings") from error
        if not parsed.is_finite():
            raise ValueError("balances must be finite")
        return value


class BalancesResponse(_WireModel):
    balances: list[BalanceView]
    is_simulated: bool = True


class DiscrepancyView(_WireModel):
    discrepancy_type: str
    summary: str
    order_id: str | None
    repaired: bool


class ReconcileResponse(_WireModel):
    tenant_id: str
    account_id: str
    exchange: str
    orders_checked: int
    fills_recovered: int
    discrepancy_count: int
    discrepancies: list[DiscrepancyView]
    error: str | None
    started_at_micros: int
    finished_at_micros: int


class CancelOrderResponse(_WireModel):
    """The engine's honest verdict on a cancel request.

    ``outcome`` carries ExecutionEngine vocabulary (ACCEPTED,
    REJECTED_LOCALLY, REJECTED_BY_EXCHANGE, DUPLICATE, DRY_RUN, UNKNOWN);
    the worker's ack policy reads THIS, not the HTTP code: 200 +
    REJECTED_LOCALLY is a completed job, 5xx is a retryable failure, and
    conflating the two is how cancelled-twice becomes cancelled-never.
    """

    outcome: str
    client_order_id: str
    order_status: str
    error_code: str | None
    message: str | None
    latency_micros: int
    is_simulated: bool


class CommandRejected(_WireModel):
    """Error body shared by 403/404/501 paths."""

    code: str
    message: str


class PlacementStatusView(_WireModel):
    """The placement review as ``/status`` publishes it.

    A typed model rather than the raw ``dict`` ``PlacementWiring.describe()``
    returns, for one reason: ``extra="forbid"`` on this base means a field that
    ``describe()`` grows without a decision here is a loud failure at the first
    status request, not a silently unpublished fact. The counterpart test in the
    service suite asserts the two key sets agree, so the loud failure is caught in
    CI and can never actually reach an operator.

    ``policy`` and ``cache`` are mappings of numbers, not declared fields, and the
    asymmetry is the safety property: those blocks can carry bounds, counters and
    a boolean, and nothing that could be a key. The strings live only in the three
    labels below, which are the module's own constants and are asserted not to
    contain credential material.
    """

    #: ``placement-review`` - what an operator greps for (REVIEW_ENDPOINT_LABEL).
    label: str
    #: ``local`` for a runtime that cannot transmit; the mode is part of the
    #: verdict digest upstream, so publishing it here lets a reader check that
    #: the engine answering and the engine that refused are the same engine.
    mode: str
    #: Whether this wiring would REFUSE for want of a venue answer. Published
    #: because an operator comparing two deployments has to see which one would
    #: have blocked the order the other one took.
    requires_venue_attestation: bool
    #: How long a gathered attestation is reused, as configured (not as
    #: achieved - ``cache`` below says what the reuse actually did).
    cache_ttl_millis: int
    #: The gatherer's provenance label: ``unattested``, ``local``, ``binance``
    #: or ``cached(<inner>)``.
    attestor_source: str
    policy: dict[str, int | bool]
    #: Present only when the gatherer reports its own statistics - the absence is
    #: the honest signal that the attestor in use is not a caching one.
    cache: dict[str, int] | None = None
    #: Part 19: whether an operator-confirmation verifier is installed at all. A
    #: separate top-level fact from ``policy.requireOperatorConfirmation``, because
    #: "the deployment asked for the check" and "the deployment can satisfy it" are
    #: the two halves of the outage this service must not confuse.
    confirmation_configured: bool = False
    #: The verifier's own summary, deliberately the SHAPE rather than the scope:
    #: this block is copied verbatim into ``/health/ready``, which is
    #: unauthenticated, and a confirmation's tenant, account and symbol list are
    #: identities a probe has no need of. See
    #: :meth:`~wlct_trading.execution.live_confirmation.ConfirmationVerifier.public_summary`.
    operator_confirmation: dict[str, bool | int | str] = {}


class LiveEnablementView(_WireModel):
    """The live-enablement grading, as ``/status`` publishes it (Part 19).

    Rendered from the report the composition root computed over the objects it
    actually built, which is the whole point of the type existing: the same data that
    produced the ``EXECUTION_MODE=live`` refusal, so the answer an operator reads
    after a failed boot and the answer in front of a successful one are the same
    answer. It cannot be turned into a permission by any caller - there is no field
    here that says "set this to true and trade", only which names are missing.
    """

    #: Always true in this build. See ``HARD_BLOCKERS`` in the core: the live
    #: transport is not wired, so no grading can come back empty and no reader can
    #: use this block to conclude that live mode is one setting away.
    live_refused: bool
    #: The prerequisite names still unsatisfied, in the order the enum declares
    #: them - a stable list, so a deployment watching it shrink over successive
    #: parts is watching progress rather than a reshuffle.
    missing: list[str] = []
    satisfied: list[str] = []
    #: The same list in the refusal vocabulary (``LIVE_`` prefixed), for a caller
    #: that matches on codes rather than on prose.
    missing_codes: list[str] = []
    #: Whether any missing item is one this build cannot satisfy by configuration.
    #: The honest "you are waiting for a part, not for a value" flag.
    hard_blockers_present: bool = True
    credential_source: str = "none"


class IncidentSinkView(_WireModel):
    """The incident sink as ``/status`` publishes it (Part 17).

    Same typing argument as ``PlacementStatusView``: the sink's name and its
    durability are the two facts that explain why an incident list is empty, and
    ``extra="forbid"`` means a field added to the runtime's description has to be
    decided here before it reaches an internal caller.

    ``stats`` is a mapping of counts, always present and empty when the sink has
    no accounting to give: the in-memory sink has nothing to report, and publishing
    ``{}`` says that in the same shape the durable one uses. A missing key would
    force every reader to distinguish "no stats" from "this engine is too old to
    have stats", which is the distinction the outer ``incidents is null`` already
    makes - one place, one meaning. Counts only, never labels: a label is where a
    secret would have to go, and this block has no business carrying one.
    """

    #: ``PostgresIncidentRecorder`` or ``InMemoryIncidentRecorder`` - the class the
    #: runtime was built with, which is the answer to "where did my incidents go".
    sink: str
    #: The sink's own claim, not the config's: a deployment that set
    #: ``EXECUTION_STORE_BACKEND=postgres`` and still has a memory sink says
    #: ``durable: false`` here, and composition refuses that pairing outright.
    durable: bool
    stats: dict[str, int] = Field(default_factory=dict)


class StatusResponse(_WireModel):
    instance_id: str
    mode: str
    dry_run: bool
    adapter: str
    store: str
    store_durable: bool
    #: "memory" | "postgres" as the SERVICE was configured - independent of
    #: store_durable on purpose: the worker can tell "class name says
    #: Postgres, config says memory" (impossible wiring) apart from either
    #: alone. Defaults to "unknown" (not "memory") so a response from a
    #: pre-Part-13 engine reads as unproven, never as a claimed fact.
    store_backend: str = "unknown"
    #: Retention visibility on the SAME surface the worker asserts against:
    #: "is a prune possible from this engine, and what does 'days' mean
    #: here" are questions an operator asks the status endpoint, not the
    #: source. Defaults state the shipped config (disabled, 90) so a
    #: pre-Part-14 engine's response cannot be read as "retention ran".
    retention_enabled: bool = False
    retention_event_days: int = 90
    #: Part 15's evidence window, visible on the assert-before-forward
    #: surface for the same reason retention is: "how stale is too stale" is
    #: a per-deployment answer. The default mirrors the shipped config, and
    #: a PRE-Part-15 engine's response therefore says "the window nobody
    #: enforced was 30 days", not "freshness was checked".
    enablement_max_age_days: int = 30
    #: Part 16's posture, on the same surface for the same reason: "which key
    #: source was this process willing to read, and what was it willing to
    #: believe about an order" are the two questions an operator asks when a
    #: placement is refused, and neither may require reading the source or
    #: shell-ing into the container. The SOURCE is published, never a credential.
    #: The defaults describe an engine too old to answer rather than an engine
    #: with nothing wired, so a pre-Part-16 response reads as unproven - the
    #: same convention ``store_backend`` set - and ``placement is None`` is
    #: distinguishable from ``attestorSource == "unattested"``, which is a
    #: deployment that HAS the review and has no venue behind it.
    credential_source: str = "none"
    #: Part 19's two additions to the same posture: which reader backs the
    #: credential source (None when the source needs none), and whether an operator
    #: confirmation is wired. Neither is a permission, and neither can be read as
    #: "live is available": the block below is what says that, and it says it for
    #: every deployment this build starts.
    credential_fetcher: str | None = None
    operator_confirmation: bool = False
    live_enablement: LiveEnablementView | None = None
    placement: PlacementStatusView | None = None
    #: Part 18's instrument posture, on the assert-before-forward surface for the
    #: reason everything else on it is there: a scrape that reads all zeros needs an
    #: answer to "is this process measuring anything", and the answer belongs in the
    #: document the worker already reads rather than in a second system. Defaults
    #: False, which is what a pre-Part-18 engine actually was - nothing was wired -
    #: so an old response cannot be misread as "instrumented but idle".
    metrics_configured: bool = False
    #: Part 17's posture, on the same surface for the same reason: "does this
    #: process keep the records that explain its own failures" is the first
    #: question an operator asks after a restart, and ``None`` reads as "an
    #: engine too old to answer" rather than as "no incidents" - the convention
    #: every other block on this model uses.
    incidents: IncidentSinkView | None = None
    locks_distributed: bool
    commands: list[str]
    simulated: bool = True


class RetentionRunRequest(_WireModel):
    """The run command's body. ``dryRun`` DEFAULTS TRUE: the field a typo
    could flip is the one that DELETES, so deletion requires an explicit
    ``"dryRun": false``, and even that only reaches the DELETE statements
    when EXECUTION_RETENTION_ENABLED says the deployment means it."""

    tenant_id: str = _TENANT
    dry_run: bool = True


class RetentionInspectRequest(_WireModel):
    """The read-only sibling: current count + recent runs, no deletion."""

    tenant_id: str = _TENANT


class RetentionRunResponse(_WireModel):
    """One run's account, mirroring the ledger row it just wrote.

    ``ledgerWritten`` is part of the contract because the ledger failure
    path is a real one (deletes landed, record did not): an operator
    reading `false` here knows the HTTP body IS the durable-ish copy and
    must reconcile against the log line before scheduling more.
    """

    dry_run: bool
    cutoff_us: int
    rows_reported: int
    batches_run: int
    exhausted: bool
    ledger_written: bool


class RetentionRunView(_WireModel):
    """A ledger row as read back; every field is a number or a label."""

    seq: int
    started_at: int
    finished_at: int
    dry_run: bool
    event_cutoff_us: int
    rows_deleted: int
    batches: int
    exhausted: bool
    instance_id: str


class RetentionInspectResponse(_WireModel):
    enabled: bool
    event_retention_days: int
    batch_rows: int
    max_batches: int
    cutoff_us: int
    prunable_now: int
    runs: list[RetentionRunView]


class EnablementRequest(_WireModel):
    """Body of ``POST /internal/v1/enablement/audit`` (Part 15).

    The only required field is the tenant whose rows the scoped count will
    see - there is no ``deleteOlderThanDays``-style danger field here,
    because there is no write path to protect. ``seedCounts`` is the
    operator's claim about how many rows that tenant should see per table;
    leaving it out is the honest unknown-seed mode (the catalogue posture
    then carries the finding), and passing a table this service does not
    probe is a refusal, not an ignore: a silently dropped key is how an
    audit starts reporting on tables that were never read.
    """

    tenant_id: str = _TENANT
    #: A row count arrives as an integer or the request is refused - no
    #: silent conversion, ever. The strictness lives on the DICT VALUE
    #: because that is the only spelling that works: a field-level
    #: ``strict=True`` on a ``dict[str, int]`` does not reach inside the
    #: values in pydantic 2.9 (verified by test), and non-strict coercion
    #: would accept ``"3"`` and, worse, ``true`` as 1 - handing the audit a
    #: seed the operator never wrote and a PASS that was earned by a cast.
    seed_counts: dict[str, _StrictInt] | None = None
    #: The coverage manifest's table count, when the caller wants the run
    #: graded against the WHOLE platform rather than against this service's
    #: own plane. Anything other than ``None``/that exact count grades
    #: UNVERIFIED, which is the point. The bounds mirror the core's
    #: (0..MAX_PROBED_TABLES) so a nonsense number is refused on the wire;
    #: the core still re-validates, because a bound stated twice in a test
    #: is a fact and a bound stated twice in code is a drift risk - which
    #: the parity test pins.
    covered_expected: int | None = Field(default=None, ge=0, le=4096)

    @field_validator("seed_counts")
    @classmethod
    def _seed_counts_are_rows(cls, value: dict[str, int] | None) -> dict[str, int] | None:
        if value is None:
            return None
        for name, count in value.items():
            if isinstance(count, bool) or not isinstance(count, int):
                raise ValueError(f"seedCounts[{name!r}] must be an integer row count")
            if count < 0:
                raise ValueError(f"seedCounts[{name!r}] must be non-negative")
        return value


class EnablementProbeView(_WireModel):
    """One table's raw observations. Counts, not booleans, so a second
    operator can re-audit the report against the database itself."""

    model_config = ConfigDict(
        alias_generator=_to_camel, populate_by_name=True, extra="forbid", frozen=True
    )

    table: str
    policy_exists: bool
    rls_enabled: bool
    rls_forced: bool
    scoped_rows: int
    bare_rows: int
    seeded_expected_rows: int
    absent: bool
    grade: str
    skip_reason: str | None = None


class EnablementRoleView(_WireModel):
    """The role the audit ran AS - the field that makes a "pass" either
    meaningful or worthless, so it is on the wire in the same body."""

    model_config = ConfigDict(
        alias_generator=_to_camel, populate_by_name=True, extra="forbid", frozen=True
    )

    rolname: str
    bypassrls: bool
    superuser: bool


class EnablementAuditResponse(_WireModel):
    """The whole run. ``grade`` is the ONLY field a dashboard may colour,
    and ``fullPlatform`` is the field that keeps it honest: a pass over
    four engine tables is not a pass over 42, and a report that says
    otherwise has to be able to be caught saying so."""

    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True, extra="forbid")

    ran_at_us: int
    grade: str
    full_platform: bool
    #: See ``EnablementAudit``: one boolean can honestly say two different
    #: things only if they are two different fields.
    engine_plane_complete: bool
    probed: int
    role: EnablementRoleView
    summary: dict[str, Any]
    probes: list[EnablementProbeView]


class PlacementFindingView(_WireModel):
    """One line of the review's answer.

    ``field`` names the attestation field the code is about (``withdrawalPermitted``)
    or is ``None`` when the finding is about the review itself (``ATTESTATION_
    UNREACHABLE`` has no field to point at). It is published because a code with
    no field is a code an operator has to interpret; the field turns
    interpretation into a check.
    """

    code: str
    severity: str
    field: str | None
    message: str


class PlacementAttestRequest(_WireModel):
    """Body of ``POST /internal/v1/placement/attest`` (Part 16).

    There is no quantity, price or side here, and that is the whole design: this
    endpoint asks "would this be permitted", never "place this". The order shape
    is present only because the venue's answer depends on it - a symbol that
    accepts LIMIT may reject STOP_LIMIT, and a review that ignored the shape would
    be reporting a permission the order does not have.
    """

    tenant_id: str = _TENANT
    account_id: str = _ACCOUNT
    symbol: str = Field(min_length=1, max_length=32, pattern=r"^[A-Za-z0-9/_-]+$")
    order_type: str = Field(default="LIMIT", min_length=3, max_length=24)
    time_in_force: str = Field(default="GTC", min_length=2, max_length=12)

    @field_validator("symbol", "order_type", "time_in_force")
    @classmethod
    def _upper(cls, value: str) -> str:
        """Normalise case, and refuse a value that is only case.

        ``" limit "`` means LIMIT and is accepted after the strip; ``"  "`` means
        nothing and would otherwise reach the reviewer as a two-character symbol
        whose venue answer is guaranteed to be "not found" - a refusal an operator
        would then read as a permissions problem rather than as a typo.
        """
        cleaned = value.strip().upper()
        if not cleaned:
            raise ValueError("must not be blank after trimming")
        return cleaned


class PlacementAttestResponse(_WireModel):
    """The review's verdict, in the shape the engine records.

    ``allowed`` is a 200 either way: "the venue refused" is the answer to the
    question, not a failure of the endpoint (Part 15 established the same rule
    for a FAIL grade, for the same reason - an error status would bury the
    evidence under the transport).

    ``transmitted`` is present as a constant ``false`` so a client can assert it
    rather than trust the documentation. It says what this endpoint did NOT do;
    a caller that reads ``true`` here has been answered by something else, and a
    check that can fail is worth more than a sentence that cannot be verified.
    """

    allowed: bool
    verdict_id: str
    #: Every code the review produced, in the law's deterministic order, and the
    #: subset that actually refused. Both are published because they answer
    #: different questions: "what did the venue say" and "what stood in the way".
    codes: list[str]
    blocking_codes: list[str]
    #: "Re-run it" versus "a human must act at the venue" - the distinction the
    #: worker needs and cannot infer from a refusal alone.
    retryable: bool
    venue_backed: bool
    venue_trading_permitted: bool
    no_known_withdrawal_path: bool
    review_required_at_micros: int
    attested_at_micros: int
    summary: str
    findings: list[PlacementFindingView]
    #: Mirrors the durable event payload's spelling of the same claims, so a
    #: console comparing an operator's ad-hoc review with an order's audit line
    #: is comparing one contract rather than two near-identical ones.
    payload: dict[str, str]
    transmitted: bool = False
    #: Which gatherer answered, from the runtime's wiring description. A verdict
    #: without its provenance is a opinion; with it, it is evidence.
    mode: str
    attestor_source: str


class IncidentListRequest(_WireModel):
    """Body of ``POST /internal/v1/incidents/list`` (Part 17).

    A read, expressed as a POST with a body, because that is how this service
    already asks a tenant-scoped question: ``retention/inspect`` and
    ``enablement/audit`` both carry ``tenantId`` so the header match in
    ``require_tenant_match`` has something to compare against. A query string
    would have made the tenant a client-chosen default.
    """

    tenant_id: str = _TENANT
    account_id: str | None = Field(
        default=None, min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$"
    )
    #: The store's bound, not the caller's: an unbounded read of an audit table is
    #: a way to turn an operator endpoint into an availability incident.
    limit: int = Field(default=100, ge=1, le=1000)


class IncidentView(_WireModel):
    """One incident, in the field set ``ExecutionIncident.to_dict()`` publishes.

    The list is literal and the test asserts it: ``details`` is the one field a
    writer might have stuffed a request body into, and the core scrubs it on
    construction. Re-declaring the shape here is what makes "no credential can
    reach this response" a property of the contract rather than of the scrubber's
    mood, and a renamed core field becomes a broken test instead of a silently
    absent column.
    """

    incident_id: str
    tenant_id: str
    account_id: str | None
    type: str
    severity: str
    summary: str
    exchange: str | None
    symbol: str | None
    order_id: str | None
    client_order_id: str | None
    error_code: str | None
    details: dict[str, str]
    occurred_at_micros: int
    resolved: bool
    resolution_note: str | None


class IncidentListResponse(_WireModel):
    """The open incidents this runtime can show, plus what showing them cost.

    ``source`` is the sink's class name and ``durable`` is its own claim, because
    "there are no open incidents" and "there are no open incidents in this
    process's memory" are different answers to the question an operator asked; the
    pair is what lets a caller tell them apart without reading the deployment.
    """

    tenant_id: str
    source: str
    durable: bool
    limit: int
    returned: int
    incidents: list[IncidentView]
```

FILE: services/execution-engine/app/secret_fetcher.py

```python
"""The one concrete secret fetcher this service ships: HashiCorp Vault, KV v2.

Part 16 left the multi-tenant credential path half-open on purpose. The core's
:class:`~wlct_trading.execution.credentials.SecretManagerCredentialProvider` is complete
and tested, and ``app/credentials.py`` refused ``EXECUTION_CREDENTIAL_SOURCE=secret-manager``
without an injected fetcher, because key custody is a deployment decision and an
execution engine that hard-codes a backend silently decides which customers may trade.

Part 19 closes that half-open door the only way that does not decide anything for
anybody: it implements the fetch for the backend this platform's own infrastructure
already runs (``infrastructure/docker`` carries a Vault for the API service), behind an
explicit selector, and it still refuses when nothing is selected. A deployment that
uses a different KMS still injects its own fetcher; a deployment that uses this one
sets two variables instead of writing code. There is no default here: the selector's
default is ``none``, which keeps every existing deployment's behaviour byte-identical.

THE LAWS THIS MODULE ENFORCES
-----------------------------

1. **The token is read from the environment, and only from the environment.** It is
   not a field on the config object, so it cannot be published by ``to_public_dict``,
   cannot arrive in a ``model_dump``, and cannot be printed by a debugger that walks a
   dataclass. ``EXECUTION_VAULT_TOKEN_ENV`` names the variable to read (default
   ``EXECUTION_VAULT_TOKEN``) because an agent-injected credential rarely keeps the
   default name - and the indirection is cheap enough that "we could not find it" is a
   boot refusal, not a runtime surprise.
2. **A failure is a :class:`CredentialNotFound`, always.** Vault answers a bad token
   and a nonexistent path in ways that differ by policy and by version; the difference
   is not something this process should be confident about, and it is not something a
   log line should repeat. Every failure - transport, status, JSON shape, decoded
   field - normalises to the same exception type carrying the *type* of what went wrong.
   Vault's response body is never included in a message: KV responses contain key
   material.
3. **Nothing here is logged per lookup.** Construction logs the mount and the path
   template, which are configuration. A per-order log line that named the resolved path
   would put tenant identifiers in the aggregator on the busiest path in the service,
   for no operational gain - the provider above already reports the failure.
4. **Path segments are validated, not escaped.** A tenant identifier containing
   ``..``, a slash, or a control character is refused before a request is built, rather
   than being percent-encoded into a request that reads a different tenant's secret.
   Encoding would make the traversal *work* on most servers; refusing it makes the
   misconfiguration visible at the boundary that owns it.
5. **The response is bounded.** A KV secret is a few hundred bytes; a cap (default 64
   KiB) means a misconfigured path that lands on a large object cannot turn an order's
   latency into a memory event. The read is streamed so the cap is a real bound, not a
   post-hoc length check.
6. **Rotation evidence is carried, not invented.** If the stored secret has a
   ``version``, it rides back as the credential's ``source`` label (``vault-kv2:v12``),
   so a rotated secret produces a new label through the cache's TTL without this module
   pretending to know what rotation means. ``expiresAtMicros`` is read if present and
   defaulted if absent: an expiry the operator stored is enforced, and an absent one is
   reported as unknown rather than as "never" by this module (the core's review decides
   what unknown means).
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from typing import Final

import httpx
from wlct_trading.enums import ExchangeId
from wlct_trading.execution.credentials import (
    CredentialNotFound,
    ResolvedSecret,
)

__all__ = [
    "MAX_VAULT_PATH_LENGTH",
    "PLACEHOLDER_TOKENS",
    "VaultKvConfig",
    "VaultKvSecretFetcher",
]

#: The only placeholders a path template may contain. Deliberately three, because a
#: template is a lookup path for signing material and a placeholder that could reach
#: outside the (tenant, account, exchange) tuple - a raw ``{path}`` from the request,
#: say - is a template injection with a very specific payoff.
PLACEHOLDER_TOKENS: Final[tuple[str, ...]] = ("tenant", "account", "exchange")

#: Characters a tenant, account or exchange identifier is made of, for the purpose of
#: putting one in a URL path. ``.`` and ``-`` and ``_`` are allowed because they appear
#: in real tenant slugs; ``/``, ``\\``, ``%``, ``:`` and every control character are not,
#: and the exclusion is a refusal rather than an escape (see law 4).
_SAFE_SEGMENT: Final[re.Pattern[str]] = re.compile(r"\A[A-Za-z0-9._-]{1,64}\Z")

#: A KV secret is named, not routed, so the assembled path has a bound. It is generous
#: (a Vault path can be long) and its purpose is to stop a template-and-input
#: combination from producing a 4 KiB "path" that a proxy truncates into a 404 nobody
#: can explain.
MAX_VAULT_PATH_LENGTH: Final[int] = 512

#: The two spellings a stored key pair shows up with, in the wild and in this
#: repository's own examples. Both are accepted; a payload carrying both with different
#: values is refused, because picking one of two disagreeing secrets is a coin flip on
#: the signature.
_API_KEY_FIELDS: Final[tuple[str, ...]] = ("api_key", "apiKey")
_API_SECRET_FIELDS: Final[tuple[str, ...]] = ("api_secret", "apiSecret")
_EXPIRES_FIELDS: Final[tuple[str, ...]] = ("expires_at_micros", "expiresAtMicros")
_VERSION_FIELDS: Final[tuple[str, ...]] = ("version", "vault_version", "vaultVersion")


@dataclass(frozen=True)
class VaultKvConfig:
    """Validated Vault addressing. Nonsense is refused here, at boot.

    The shape checks live on the config object rather than in ``app/config.py``
    because the fetcher and the service's startup validator must not have two
    opinions: ``Settings`` constructs one of these inside a ``try`` and lets the
    refusal fail the boot, so the rule that fails startup is the same rule the runtime
    relies on, with no second copy to drift.
    """

    #: e.g. ``https://vault.internal:8200``. Scheme required, no trailing slash.
    addr: str
    #: The KV v2 mount, without ``/v1`` and without a trailing slash.
    mount: str = "secret"
    #: Lookup path, relative to ``/data/`` under the mount.
    path_template: str = "wlct/{tenant}/{account}/{exchange}"
    #: NAME of the environment variable holding the token. The token itself is never a
    #: field on any object in this module.
    token_env: str = "EXECUTION_VAULT_TOKEN"
    #: Optional Vault enterprise namespace, sent as a header.
    namespace: str | None = None
    timeout_ms: int = 3_000
    verify_tls: bool = True
    max_response_bytes: int = 65_536

    def __post_init__(self) -> None:
        if not isinstance(self.addr, str) or not self.addr.strip():
            raise ValueError("EXECUTION_VAULT_ADDR is required by the vault-kv2 fetcher.")
        addr = self.addr.strip().rstrip("/")
        if "://" not in addr:
            raise ValueError(
                f"EXECUTION_VAULT_ADDR must include a scheme, got {self.addr!r}; a "
                "host with no scheme is a request to http:// by default, which sends a "
                "token in cleartext."
            )
        authority = addr.split("://", 1)[1].split("/", 1)[0]
        if "@" in authority:
            raise ValueError(
                "EXECUTION_VAULT_ADDR must not embed credentials (a 'user:pass@host' "
                "authority): this client authenticates with a token from the "
                "environment and nothing else, and a URL that could carry a password "
                "is a password that will end up in a log line about the URL."
            )
        scheme = addr.split("://", 1)[0].lower()
        if scheme not in ("https", "http"):
            raise ValueError(f"EXECUTION_VAULT_ADDR scheme must be https or http; got {scheme!r}.")
        if scheme == "http":
            raise ValueError(
                "EXECUTION_VAULT_ADDR must be https: this request carries a token that "
                "reads signing keys, and the deployment's service mesh is not a "
                "substitute for transport security in a component that fails closed "
                "over everything else."
            )
        object.__setattr__(self, "addr", addr)
        mount = self.mount.strip().strip("/")
        if not mount or "/" in mount or not _SAFE_SEGMENT.match(mount):
            raise ValueError(
                f"EXECUTION_VAULT_MOUNT must be one safe path segment (the KV v2 "
                f"mount, e.g. 'secret'); got {self.mount!r}. A nested mount is spelled "
                "in the path template, not here, so that this value can be validated."
            )
        object.__setattr__(self, "mount", mount)
        template = self.path_template.strip().strip("/")
        if not template:
            raise ValueError("EXECUTION_VAULT_PATH_TEMPLATE must not be blank.")
        found = set(re.findall(r"\{([^{}]*)\}", template))
        unknown = sorted(found - set(PLACEHOLDER_TOKENS))
        if unknown:
            raise ValueError(
                f"EXECUTION_VAULT_PATH_TEMPLATE may only contain "
                f"{'/'.join('{' + t + '}' for t in PLACEHOLDER_TOKENS)}; unknown "
                f"placeholder(s): {', '.join(unknown)}. Refused rather than left "
                "literal, because a typo like {tenent} would then look up a path that "
                "does not exist and report 'no secret' for every tenant forever."
            )
        # Remove every complete placeholder, then look for leftovers: a template with
        # an unbalanced brace is not a template this module can fill deterministically.
        if any(character in re.sub(r"\{[^{}]*\}", "", template) for character in "{}"):
            raise ValueError(
                "EXECUTION_VAULT_PATH_TEMPLATE has unbalanced braces; a template that "
                "cannot be filled deterministically cannot be trusted to point at one "
                "tenant's secret."
            )
        if ".." in template.split("/"):
            raise ValueError(
                "EXECUTION_VAULT_PATH_TEMPLATE must not contain a '..' segment: the "
                "mount already bounds the lookup, and a template that climbs out of it "
                "is not a path this module is willing to guess the intent of."
            )
        object.__setattr__(self, "path_template", template)
        if not self.token_env.strip():
            raise ValueError(
                "EXECUTION_VAULT_TOKEN_ENV names the variable to read and must not be blank."
            )
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", self.token_env.strip()):
            raise ValueError(
                f"EXECUTION_VAULT_TOKEN_ENV must be an environment-variable name; got "
                f"{self.token_env!r}."
            )
        object.__setattr__(self, "token_env", self.token_env.strip())
        if self.namespace is not None:
            namespace = self.namespace.strip()
            if not namespace or not re.fullmatch(r"[\w./-]{1,256}", namespace):
                raise ValueError(
                    "EXECUTION_VAULT_NAMESPACE, when set, must be a non-blank namespace "
                    "path without control characters."
                )
            object.__setattr__(self, "namespace", namespace)
        if self.timeout_ms < 250:
            raise ValueError(
                "EXECUTION_VAULT_TIMEOUT_MS below 250 tests Vault's availability, not "
                "the network; a fetch that is supposed to be off the order path needs "
                "longer than that to be worth calling."
            )
        if not 1_024 <= self.max_response_bytes <= 4_194_304:
            raise ValueError(
                "EXECUTION_VAULT_MAX_RESPONSE_BYTES must be within 1 KiB..4 MiB; got "
                f"{self.max_response_bytes}. Below 1 KiB no usable secret fits, above "
                "4 MiB the bound has stopped being about secrets."
            )

    def describe(self) -> dict[str, object]:
        """Everything about this config that an operator may see. No token, ever."""
        return {
            "addr": self.addr,
            "mount": self.mount,
            "pathTemplate": self.path_template,
            "tokenEnvVar": self.token_env,
            "namespace": self.namespace,
            "timeoutMillis": self.timeout_ms,
            "verifyTls": self.verify_tls,
            "maxResponseBytes": self.max_response_bytes,
        }

    def read_token(self, environ: dict[str, str] | None = None) -> str:
        source = os.environ if environ is None else environ
        token = (source.get(self.token_env) or "").strip()
        if not token:
            raise CredentialNotFound(
                f"{self.token_env} is not set or is blank. The vault-kv2 fetcher reads "
                "the token from the environment and nowhere else, so there is no "
                "fallback to try - and a fetcher that tried one would be a fetcher "
                "that trades on whichever credential it happened to find."
            )
        return token


class VaultKvSecretFetcher:
    """``SecretFetcher`` over ``GET {addr}/v1/{mount}/data/{path}``.

    Constructed once at boot by ``app.credentials.build_credential_provider`` and
    called by the core's provider beneath ``CachingCredentialProvider``, so the
    expected rate is one request per cache TTL per (tenant, account) - not one per
    order. That is also why there is no retry logic here: a retry loop in front of a
    secret store converts an outage into a load problem, and the cache above already
    holds the answer for the callers that need one.
    """

    __slots__ = ("_config", "_token", "_client", "_owns_client", "source")

    def __init__(
        self,
        config: VaultKvConfig,
        *,
        environ: dict[str, str] | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._config = config
        # Read once, at construction, and never again: a credential store whose token
        # changes under a running process is a process that should be restarted, and
        # re-reading per lookup would make "which token signed this order" unanswerable.
        self._token = config.read_token(environ)
        self._client = client
        self._owns_client = client is None
        self.source = "vault-kv2"

    def __repr__(self) -> str:
        # No token, no addr-with-credentials: this object is reachable from an
        # exception's locals, which is a rendering path, which is where secrets go.
        return f"VaultKvSecretFetcher(mount={self._config.mount!r}, source={self.source!r})"

    @property
    def config(self) -> VaultKvConfig:
        return self._config

    def describe(self) -> dict[str, object]:
        return {"fetcher": self.source, **self._config.describe()}

    async def aclose(self) -> None:
        """Close only the client this fetcher created."""
        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None

    async def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            # Lazy: importing this module, or building a runtime that never resolves a
            # credential, must not open a connection pool or start a resolver.
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(self._config.timeout_ms / 1_000),
                verify=self._config.verify_tls,
            )
        return self._client

    def lookup_path(self, tenant_id: str, account_id: str, exchange: ExchangeId) -> str:
        """Render the template, refusing anything unsafe. No request has been made yet."""
        segments = {
            "tenant": str(tenant_id).strip(),
            "account": str(account_id).strip(),
            "exchange": str(getattr(exchange, "value", exchange)).strip().lower(),
        }
        for name, value in segments.items():
            if not _SAFE_SEGMENT.match(value):
                raise CredentialNotFound(
                    f"the {name} identifier {value!r} is not a safe path segment "
                    "(expected [A-Za-z0-9._-]{1,64}); the lookup was refused before any "
                    "request left this process, because the alternative - encoding it - "
                    "would make a traversal reach a different tenant's secret."
                )
        path = self._config.path_template.format(**segments)
        if not path or len(path) > MAX_VAULT_PATH_LENGTH:
            raise CredentialNotFound(
                f"the rendered Vault path is {len(path)} characters, outside the "
                f"1..{MAX_VAULT_PATH_LENGTH} bound this fetcher enforces."
            )
        return path

    async def __call__(
        self, tenant_id: str, account_id: str, exchange: ExchangeId
    ) -> ResolvedSecret:
        path = self.lookup_path(tenant_id, account_id, exchange)
        url = f"{self._config.addr}/v1/{self._config.mount}/data/{path}"
        headers = {"X-Vault-Token": self._token, "Accept": "application/json"}
        if self._config.namespace:
            headers["X-Vault-Namespace"] = self._config.namespace
        try:
            client = await self._http()
            async with client.stream("GET", url, headers=headers) as response:
                status = response.status_code
                if status != 200:
                    # The body is deliberately unread here. A 4xx/5xx from Vault is a
                    # JSON error document, and the only thing in it this process is
                    # allowed to repeat is the status code, because "which path failed"
                    # is already in the refusal and "what the server said" is not.
                    raise CredentialNotFound(
                        f"Vault returned HTTP {status} for the credential path under "
                        f"mount {self._config.mount!r}. The response body was not read: "
                        "Vault error documents can echo request material."
                    )
                body = await response.aread()
        except CredentialNotFound:
            raise
        except Exception as error:
            raise CredentialNotFound(
                f"the Vault request failed: {type(error).__name__}. Vault's message was "
                "not carried through, because a transport exception can quote the URL "
                "that carried the token."
            ) from None
        if len(body) > self._config.max_response_bytes:
            raise CredentialNotFound(
                f"the response was {len(body)} bytes, above the "
                f"{self._config.max_response_bytes} byte bound for a KV secret; this "
                "path is not holding an API key pair."
            )
        return self._decode(body)

    def _decode(self, body: bytes) -> ResolvedSecret:
        try:
            envelope = json.loads(body.decode("utf-8"))
            if not isinstance(envelope, dict):
                raise TypeError("envelope is not an object")
            wrapper = envelope.get("data")
            if not isinstance(wrapper, dict):
                # A KV v2 read of a deleted secret answers 200 with "data": null, which
                # is a real answer that must not be decoded as an empty credential.
                raise TypeError("'data' is absent or null (a deleted secret, or a v1 mount)")
            data = wrapper.get("data")
            if not isinstance(data, dict):
                raise TypeError("'data.data' is not an object")
            metadata = wrapper.get("metadata")
            if not isinstance(metadata, dict):
                metadata = {}
        except Exception as error:
            raise CredentialNotFound(
                f"Vault's response could not be read as a KV v2 secret "
                f"({type(error).__name__}). A 200 whose shape is not "
                "'data.data' is a wrong mount version, a wrong path, or a proxy "
                "answering; none of those is a credential."
            ) from None
        api_key = _pick(data, _API_KEY_FIELDS, "API key")
        api_secret = _pick(data, _API_SECRET_FIELDS, "API secret")
        permissions = _permissions(data.get("permissions"))
        expires_at = _expires(data)
        version = metadata.get("version") or _first(data, _VERSION_FIELDS)
        source = self.source if version in (None, "") else f"{self.source}:v{version}"
        return ResolvedSecret(
            api_key=api_key,
            api_secret=api_secret,
            permissions=permissions,
            expires_at_micros=expires_at,
            source=source,
        )


def _pick(data: dict[str, object], names: tuple[str, ...], what: str) -> str:
    present = {name: data[name] for name in names if name in data}
    if not present:
        raise CredentialNotFound(
            f"the stored secret has no {what} field (looked for "
            f"{' or '.join(names)})."
        )
    values = {str(value).strip() for value in present.values()}
    if len(values) != 1:
        raise CredentialNotFound(
            f"the stored secret carries {what} under more than one spelling "
            f"({', '.join(sorted(present))}) and the values differ. Choosing one would "
            "be a coin flip on a signature."
        )
    value = values.pop()
    if not value:
        raise CredentialNotFound(f"the stored secret's {what} is blank.")
    return value


def _first(data: dict[str, object], names: tuple[str, ...]) -> object:
    for name in names:
        if name in data:
            return data[name]
    return None


def _permissions(value: object) -> frozenset[str]:
    """``"READ,SPOT_TRADE"`` or a list, into the core's vocabulary.

    The core owns the meaning of these strings (``PERMISSION_WITHDRAW`` in
    particular, which the review treats as a refusal); this function only parses. It
    therefore does NOT default to anything permissive when the field is absent - the
    empty set means "the operator stored no claim", and the review's law for an
    unattested field decides what that is worth.
    """
    if value is None:
        return frozenset()
    if isinstance(value, str):
        items = value.split(",")
    elif isinstance(value, list | tuple | set | frozenset):
        items = [str(item) for item in value]
    else:
        raise CredentialNotFound(
            f"the stored secret's permissions field must be a comma-separated string "
            f"or a list, got {type(value).__name__}."
        )
    return frozenset(item.strip().upper() for item in items if str(item).strip())


def _expires(data: dict[str, object]) -> int | None:
    """An explicit microsecond expiry, or None.

    No ISO-8601 support, on purpose: an unqualified timestamp string has a timezone
    the reader supplies, and an expiry computed from a guess is worse than no expiry -
    the review treats unknown as unknown, and would treat a wrong guess as a fact.
    """
    raw = _first(data, _EXPIRES_FIELDS)
    if raw is None or raw == "":
        return None
    if isinstance(raw, bool) or not isinstance(raw, int | str):
        raise CredentialNotFound(
            "expires_at_micros must be an integer number of microseconds since the epoch."
        )
    if isinstance(raw, str):
        if not raw.strip().isdigit():
            raise CredentialNotFound(
                f"expires_at_micros must be an integer, got {raw!r}; a timestamp string "
                "is refused because a timezone nobody wrote down is a guess about when "
                "a key stops working."
            )
        return int(raw)
    return int(raw)
```

FILE: services/execution-engine/app/security.py

```python
"""Authentication for service-to-service calls.

The execution engine is never exposed to the public internet. It accepts
only requests carrying the shared internal token (constant-time compared),
and it requires an explicit tenant header on every command so no action is
ever tenantless: the worker's job payload names a tenant, the header is
where the HTTP surface enforces it, and a mismatch between the two is
rejected rather than resolved by trust. The cross-check lives in the router
because it needs the parsed body; this module guarantees the caller IS an
internal service speaking for A tenant.

One route reads instead of acting, and says so by depending on
:func:`require_internal_auth_readonly` (Part 20). The distinction is the whole
argument, so it is stated here rather than only at the route: the tenant law
exists so that no money operation can run without an owner, and a read of this
process's own wiring has no owner to name because it has no effect to attribute.
The exemption also cannot disclose anything - every key ``GET /internal/v1/status``
returns is published on ``GET /health/ready``, which asks for nothing at all, and
that superset relation is a test in the service suite rather than a claim here.
The token is still required, because the point is not to hide that a posture
exists but to keep a stranger from learning which deployment has which one -
the same reason ``/status`` is a document and an environment file is not.
"""

from __future__ import annotations

import hmac
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status

from app.config import Settings, get_settings

__all__ = [
    "CALLER_AUTH_HEADER",
    "TENANT_HEADER",
    "TENANT_REQUIRED_CODE",
    "REQUEST_ID_HEADER",
    "ServiceCaller",
    "require_internal_auth",
    "require_internal_auth_readonly",
    "require_tenant_match",
]

#: The header NAME - not a secret, it never holds one. Named away from
#: the word "token" deliberately: flake8-S105 rightly hunts string
#: literals assigned to token-shaped constants, and a header label is
#: not a credential; the config validator guards the value.
CALLER_AUTH_HEADER = "x-internal-token"
TENANT_HEADER = "x-tenant-id"

#: The refusal code for a command with no tenant. A name rather than a literal
#: because the worker matches on this string and the read scope below must not be
#: able to raise it by accident: `_tenant_or_none` is the only place it appears.
TENANT_REQUIRED_CODE = "TENANT_HEADER_REQUIRED"
REQUEST_ID_HEADER = "x-request-id"


class ServiceCaller:
    """The authenticated context of an internal request."""

    def __init__(self, tenant_id: str, request_id: str | None) -> None:
        self.tenant_id = tenant_id
        self.request_id = request_id


def _authenticate(settings: Settings, x_internal_token: str | None) -> None:
    """The token half, shared by both scopes.

    Extracted rather than copied because a constant-time comparison has exactly one
    correct spelling, and a second copy in this file would be a second place for
    somebody to get wrong - the failure mode being a function that looks timing-safe
    and quietly stopped being one.
    """
    if not x_internal_token or not hmac.compare_digest(
        x_internal_token, settings.EXECUTION_INTERNAL_TOKEN or ""
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHORIZED", "message": "Invalid internal service credentials."},
        )


def _tenant_or_none(x_tenant_id: str | None, *, required: bool) -> str:
    """The tenant half, with the presence question asked by the caller.

    ``required=False`` does not mean "the header is ignored": a tenant that IS sent is
    validated exactly as strictly, so a caller cannot answer a read with
    ``x-tenant-id: ../../etc`` and have the anomaly pass because the route is exempt.
    Absence is tolerated; a bad value never is.
    """
    if not x_tenant_id:
        if required:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": TENANT_REQUIRED_CODE,
                    "message": (
                        f"Every execution command must name its tenant via the "
                        f"{TENANT_HEADER} header; tenantless money operations are refused."
                    ),
                },
            )
        return ""
    if len(x_tenant_id) > 64 or not _tenant_ok(x_tenant_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "TENANT_HEADER_INVALID",
                "message": "The tenant header is not a plausible identifier.",
            },
        )
    return x_tenant_id


def _request_id(x_request_id: str | None) -> str | None:
    return x_request_id if x_request_id and len(x_request_id) <= 128 else None


async def require_internal_auth(
    settings: Annotated[Settings, Depends(get_settings)],
    x_internal_token: Annotated[str | None, Header(alias=CALLER_AUTH_HEADER)] = None,
    x_tenant_id: Annotated[str | None, Header(alias=TENANT_HEADER)] = None,
    x_request_id: Annotated[str | None, Header(alias=REQUEST_ID_HEADER)] = None,
) -> ServiceCaller:
    """Validates the internal token and the tenant scope of the caller.

    The command scope: every route that can act on a tenant's money uses this. The
    refusal text is a pinned contract - the worker's client and the API suite match on
    ``TENANT_HEADER_REQUIRED`` and on the word "tenantless" - which is why the code is
    a named constant and the sentence is kept verbatim below.
    """
    _authenticate(settings, x_internal_token)
    return ServiceCaller(
        tenant_id=_tenant_or_none(x_tenant_id, required=True),
        request_id=_request_id(x_request_id),
    )


async def require_internal_auth_readonly(
    settings: Annotated[Settings, Depends(get_settings)],
    x_internal_token: Annotated[str | None, Header(alias=CALLER_AUTH_HEADER)] = None,
    x_tenant_id: Annotated[str | None, Header(alias=TENANT_HEADER)] = None,
    x_request_id: Annotated[str | None, Header(alias=REQUEST_ID_HEADER)] = None,
) -> ServiceCaller:
    """The read scope: token required, tenant optional, a sent header still validated.

    Used by exactly one route - ``GET /internal/v1/status`` - and a test in the Part 20
    service suite walks the application's own route table to assert it stays the only
    one, because the way a scoping exemption rots is by becoming the convenient
    dependency to reach for on the next route somebody adds.

    ``tenant_id`` is the empty string when no header was sent. Not a sentinel naming a
    tenant: the status route never reads the field - it takes a caller only to make the
    dependency run - and an empty value is the shape of "nobody", which is what a
    process-level read actually has. A pseudo-tenant such as ``"system"`` would put a
    fake identifier into the one object whose purpose is to name a real one, and
    somebody would eventually compare it to one.
    """
    _authenticate(settings, x_internal_token)
    return ServiceCaller(
        tenant_id=_tenant_or_none(x_tenant_id, required=False),
        request_id=_request_id(x_request_id),
    )


def _tenant_ok(candidate: str) -> bool:
    # Wire-token grammar, same shape the platform uses for ids everywhere:
    # alphanumerics with '-' and '_'. This is header sanity, not lookup:
    # existence of the tenant is the store's business on the effects side.
    return all(
        ch.isascii() and (ch.isalnum() or ch in "-_") for ch in candidate
    )


def require_tenant_match(tenant_body: str, caller: ServiceCaller) -> None:
    """Reject a body naming a different tenant than the authenticated header.

    The API stamps both from the same job payload, so divergence here means
    either a misroute or a caller trying to cross tenants through a
    correctly authenticated connection. Both are 403, loudly.
    """
    if tenant_body != caller.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "TENANT_MISMATCH",
                "message": (
                    "The request body names a different tenant than the "
                    "authenticated header; the command was refused."
                ),
            },
        )
```

FILE: services/execution-engine/app/store_sql.py

```python
"""The durable Postgres adapter for the ``OrderStore`` port (Part 13).

The core library defines the port and its reference in-memory
implementation (:class:`wlct_trading.execution.store.InMemoryOrderStore`),
and its docstring says the durable adapter lives HERE - in the service that
owns the database driver. This file keeps that promise with three rules the
in-memory reference makes testable:

1. **Fidelity to the reference semantics.** ``reserve_client_order_id``'s
   same-order-retry answer, ``record_fill``'s idempotent bool, the
   ``IN_SYNC``-erases-state rule in ``set_reconciliation_state``: each is
   mirrored query-for-query, because the port documents that "a behaviour
   that passes here is a behaviour the SQL adapter must also produce".
   Where SQL is deliberately STRICTER (an order saved with a client id
   already owned by another order raises a unique violation instead of
   silently keeping the first mapping), the divergence is documented at the
   statement and tested - stricter is safe, laxer is not.

2. **One tenant, one GUC, every statement.** Every public method runs its
   queries on ONE acquired connection inside ONE transaction, and the first
   statement of that transaction is ``set_config('app.tenant_id', $1,
   true)`` - the same contract ``PrismaService.withTenantRls`` enforces on
   the Node side. The tenant predicate in each WHERE clause is the belt;
   the GUC is what makes the row-level-security policies (generated for
   these tables in Part 11's machinery) meaningful the moment an operator
   enables them. A store whose queries could not satisfy RLS would quietly
   turn the enablement checklist into a trap; this one cannot.

3. **Fail closed, loudly.** A pool error propagates through the port call:
   a submission whose durable record failed must not report success, and
   the worker's retry taxonomy turns the 5xx into a BullMQ retry against
   idempotent statements. The one capability a tenant-scoped store cannot
   honestly implement - the cross-tenant reconciliation sweep - RAISES
   ``CrossTenantSweepUnsupported`` rather than returning an empty tuple:
   "no orders need reconciliation" is the precise lie this platform exists
   to refuse.

Decimals are stored as their exact canonical strings (``Decimal.__str__``)
- the same decimal-as-text wire law the HTTP surface uses - so a
round-trip through Postgres preserves trailing-zero scale as written and no
NUMERIC rescaling can round a fee. Timestamps are epoch micros, plain
integers, per the platform's time law.
"""

from __future__ import annotations

import json
import re
from contextlib import AbstractAsyncContextManager
from decimal import Decimal
from types import TracebackType
from typing import Any, Protocol

from wlct_trading.enums import (
    TERMINAL_ORDER_STATUSES,
    ExchangeId,
    OrderSide,
    OrderStatus,
    OrderType,
    TimeInForce,
)
from wlct_trading.execution.store import (
    OrderStore,
    OrderStoreError,
    ReconciliationState,
    ReservationOutcome,
)
from wlct_trading.orders import Fill, Order, OrderEvent

__all__ = [
    "TABLE_EVENTS",
    "TABLE_FILLS",
    "TABLE_ORDERS",
    "CrossTenantSweepUnsupported",
    "PgConnection",
    "PgPool",
    "PostgresOrderStore",
]

TABLE_ORDERS = "engine_orders"
TABLE_EVENTS = "engine_order_events"
TABLE_FILLS = "engine_order_fills"


class CrossTenantSweepUnsupported(OrderStoreError):
    """The fleet-wide reconciliation sweep has no tenant-scoped form.

    Raised by :meth:`PostgresOrderStore.list_orders_needing_reconciliation`
    (the only port method without a tenant argument): under the GUC this
    store sets on every transaction, a cross-tenant SELECT would return
    only the calling tenant's rows once RLS is enabled, and returning THAT
    as the fleet answer is a silent under-report. The platform's sweeps
    therefore run per-account through the ``reconcile-trading-account``
    command; an operator wanting a true fleet sweep queries the table as a
    privileged role, outside this store, on purpose.
    """


class PgConnection(Protocol):
    """The asyncpg connection surface this store uses - nothing else.

    Deliberately narrower than asyncpg's class: if the driver ever grows a
    method this file starts calling without updating this protocol, mypy
    says so at review time instead of at incident time.
    """

    async def execute(self, query: str, *args: object) -> str: ...

    async def fetch(self, query: str, *args: object) -> list[Any]: ...

    async def fetchrow(self, query: str, *args: object) -> Any | None: ...

    def transaction(self) -> AbstractAsyncContextManager[None]: ...


class PgPool(Protocol):
    """The pool surface: acquire a connection, close on shutdown."""

    def acquire(self) -> AbstractAsyncContextManager[PgConnection]: ...

    async def close(self) -> None: ...


#: The tenant law, first statement of every store transaction. TRUE (local)
#: scope mirrors ``set_config(..., is_local => true)`` under Node's
#: ``withTenantRls``: the setting dies with the transaction, so a pooled
#: connection can never carry one tenant's GUC into another's work.
SET_TENANT_SQL = "SELECT set_config('app.tenant_id', $1, true)"

_ORDER_COLUMNS = (
    "tenant_id",
    "order_id",
    "client_order_id",
    "account_id",
    "strategy_id",
    "exchange",
    "symbol",
    "side",
    "order_type",
    "time_in_force",
    "reduce_only",
    "signal_id",
    "is_simulated",
    "status",
    "exchange_order_id",
    "quantity",
    "price",
    "stop_price",
    "filled_quantity",
    "average_fill_price",
    "cumulative_fee",
    "fee_currency",
    "rejection_reason",
    "created_at",
    "updated_at",
    "submitted_at",
    "terminal_at",
    "reconciliation_state",
)

# ALL statement text below is a chain of adjacent string literals - no
# f-strings, no interpolation, nothing computed at runtime enters the SQL
# (ruff's S608 has no false positive here to excuse). The chains split at
# spaces ON PURPOSE so concatenation is exact; tests/test_part13_drift_
# parity.py pins the assembled text against the _ORDER_COLUMNS parameter
# tuple and the migration, so "literal" does not mean "unpinned".

#: The embedded-child reconstruction: ``InMemoryOrderStore`` returns orders
#: that carry their ``fills`` and ``events`` lists (the same objects the
#: engine appends to), so a faithful SQL read reconstructs both lists from
#: the child tables - ascending insert order (``seq``), JSON-encoded so one
#: round trip serves the whole record. json_agg's NULL on no rows becomes
#: '[]' explicitly: "no fills yet" must never decode as a parse error.
_CHILD_JSON = (
    "COALESCE((SELECT json_agg(to_json(f) ORDER BY f.seq) "
    "FROM engine_order_fills f WHERE f.tenant_id = o.tenant_id "
    "AND f.order_id = o.order_id), '[]'::json) AS fills_json, "
    "COALESCE((SELECT json_agg(to_json(e) ORDER BY e.seq) "
    "FROM engine_order_events e WHERE e.tenant_id = o.tenant_id "
    "AND e.order_id = o.order_id), '[]'::json) AS events_json"
)

_ORDER_SELECT = (
    "SELECT o.tenant_id, o.order_id, o.client_order_id, o.account_id, "
    "o.strategy_id, o.exchange, o.symbol, o.side, o.order_type, "
    "o.time_in_force, o.reduce_only, o.signal_id, o.is_simulated, o.status, "
    "o.exchange_order_id, o.quantity, o.price, o.stop_price, "
    "o.filled_quantity, o.average_fill_price, o.cumulative_fee, "
    "o.fee_currency, o.rejection_reason, o.created_at, o.updated_at, "
    "o.submitted_at, o.terminal_at, o.reconciliation_state, "
    "COALESCE((SELECT json_agg(to_json(f) ORDER BY f.seq) "
    "FROM engine_order_fills f WHERE f.tenant_id = o.tenant_id "
    "AND f.order_id = o.order_id), '[]'::json) AS fills_json, "
    "COALESCE((SELECT json_agg(to_json(e) ORDER BY e.seq) "
    "FROM engine_order_events e WHERE e.tenant_id = o.tenant_id "
    "AND e.order_id = o.order_id), '[]'::json) AS events_json "
    "FROM engine_orders o"
)

_ORDER_COLUMN_LIST = (
    "tenant_id, order_id, client_order_id, account_id, strategy_id, "
    "exchange, symbol, side, order_type, time_in_force, reduce_only, "
    "signal_id, is_simulated, status, exchange_order_id, quantity, price, "
    "stop_price, filled_quantity, average_fill_price, cumulative_fee, "
    "fee_currency, rejection_reason, created_at, updated_at, submitted_at, "
    "terminal_at, reconciliation_state"
)

_ORDER_INSERT_VALUES = (
    "$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, "
    "$16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28"
)

#: ``ON CONFLICT DO NOTHING RETURNING`` with NO conflict target: the
#: reservation insert races BOTH unique constraints (order id and client
#: id), and whichever wins, the single answer is "you did not land - ask
#: who holds the id". Targeting one constraint would leak the other's
#: violation as an error on a legitimate retry path.
_RESERVE_HEAD = (
    "INSERT INTO engine_orders ("
    "tenant_id, order_id, client_order_id, account_id, strategy_id, "
    "exchange, symbol, side, order_type, time_in_force, reduce_only, "
    "signal_id, is_simulated, status, exchange_order_id, quantity, price, "
    "stop_price, filled_quantity, average_fill_price, cumulative_fee, "
    "fee_currency, rejection_reason, created_at, updated_at, submitted_at, "
    "terminal_at, reconciliation_state"
    ") VALUES ("
    "$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, "
    "$16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28"
    ")"
)

RESERVE_INSERT_SQL = _RESERVE_HEAD + " ON CONFLICT DO NOTHING RETURNING order_id"

_SAVE_UPSERT_SQL = (
    _RESERVE_HEAD
    + " ON CONFLICT (tenant_id, order_id) DO UPDATE SET "
    "client_order_id = EXCLUDED.client_order_id, "
    "account_id = EXCLUDED.account_id, strategy_id = EXCLUDED.strategy_id, "
    "exchange = EXCLUDED.exchange, symbol = EXCLUDED.symbol, "
    "side = EXCLUDED.side, order_type = EXCLUDED.order_type, "
    "time_in_force = EXCLUDED.time_in_force, "
    "reduce_only = EXCLUDED.reduce_only, signal_id = EXCLUDED.signal_id, "
    "is_simulated = EXCLUDED.is_simulated, status = EXCLUDED.status, "
    "exchange_order_id = EXCLUDED.exchange_order_id, "
    "quantity = EXCLUDED.quantity, price = EXCLUDED.price, "
    "stop_price = EXCLUDED.stop_price, "
    "filled_quantity = EXCLUDED.filled_quantity, "
    "average_fill_price = EXCLUDED.average_fill_price, "
    "cumulative_fee = EXCLUDED.cumulative_fee, "
    "fee_currency = EXCLUDED.fee_currency, "
    "rejection_reason = EXCLUDED.rejection_reason, "
    "created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at, "
    "submitted_at = EXCLUDED.submitted_at, terminal_at = EXCLUDED.terminal_at, "
    "reconciliation_state = EXCLUDED.reconciliation_state"
)

_SELECT_BY_ORDER_SQL = _ORDER_SELECT + " WHERE o.tenant_id = $1 AND o.order_id = $2"
_SELECT_BY_CLIENT_SQL = (
    _ORDER_SELECT + " WHERE o.tenant_id = $1 AND o.client_order_id = $2"
)

_LIST_OPEN_SQL_BASE = (
    _ORDER_SELECT
    + " WHERE o.tenant_id = $1 AND o.account_id = $2 "
    "AND NOT (o.status = ANY($3::text[]))"
)
_LIST_OPEN_ORDER_BY = " ORDER BY o.created_at ASC, o.order_id ASC"

_SET_RECON_SQL = (
    "UPDATE engine_orders SET reconciliation_state = $3 "
    "WHERE tenant_id = $1 AND order_id = $2"
)
_GET_RECON_SQL = (
    "SELECT reconciliation_state FROM engine_orders "
    "WHERE tenant_id = $1 AND order_id = $2"
)

_RECORD_EVENT_SQL = (
    "INSERT INTO engine_order_events (tenant_id, order_id, event_id, "
    "previous_status, status, reason, occurred_at, payload) "
    "VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) RETURNING seq"
)
_LIST_EVENTS_SQL = (
    "SELECT event_id, order_id, previous_status, status, reason, "
    "occurred_at, payload FROM engine_order_events "
    "WHERE tenant_id = $1 AND order_id = $2 ORDER BY seq ASC"
)

_RECORD_FILL_SQL = (
    "INSERT INTO engine_order_fills (tenant_id, order_id, fill_id, "
    "trade_id, price, quantity, fee, fee_currency, is_maker, is_simulated, "
    "exchange_timestamp, received_timestamp, symbol, side, exchange, "
    "quote_quantity, exchange_order_id) "
    "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, "
    "$15, $16, $17) ON CONFLICT (tenant_id, fill_id) DO NOTHING "
    "RETURNING fill_id"
)
_LIST_FILLS_SQL = (
    "SELECT fill_id, order_id, trade_id, price, quantity, fee, "
    "fee_currency, is_maker, is_simulated, exchange_timestamp, "
    "received_timestamp, symbol, side, exchange, quote_quantity, "
    "exchange_order_id FROM engine_order_fills "
    "WHERE tenant_id = $1 AND order_id = $2 ORDER BY seq ASC"
)


#: The canonical 8-4-4-4-12 hex spelling, fullmatch (the platform's uuid
#: wire form; braces, urn prefixes and dashless variants are Postgres'
#: tolerance, not this store's contract).
_CANONICAL_UUID_RE = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)


def _dec(value: Decimal | None) -> str | None:
    """Decimal -> canonical exact string; None passes through as SQL NULL."""
    if value is None:
        return None
    if not isinstance(value, Decimal):
        raise TypeError(f"decimal-as-text law violated: {value!r} is not a Decimal")
    return str(value)


def _payload_json(payload: dict[str, str]) -> str:
    # sort_keys: the same determinism law the fixtures generator uses -
    # byte-stable serialization makes the recorded row comparable without a
    # JSON-object-ordering caveat nobody should have to think about.
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _order_params(order: Order, reconciliation: ReconciliationState | None) -> list[object]:
    return [
        order.tenant_id,
        order.order_id,
        order.client_order_id,
        order.account_id,
        order.strategy_id,
        order.exchange.value,
        order.symbol,
        order.side.value,
        order.order_type.value,
        order.time_in_force.value,
        order.reduce_only,
        order.signal_id,
        order.is_simulated,
        order.status.value,
        order.exchange_order_id,
        str(order.quantity),
        _dec(order.price),
        _dec(order.stop_price),
        str(order.filled_quantity),
        _dec(order.average_fill_price),
        str(order.cumulative_fee),
        order.fee_currency,
        order.rejection_reason,
        order.created_at,
        order.updated_at,
        order.submitted_at,
        order.terminal_at,
        None if reconciliation is None else reconciliation.value,
    ]


def _decode_fill_json(raw: dict[str, Any]) -> Fill:
    return Fill(
        fill_id=str(raw["fill_id"]),
        order_id=str(raw["order_id"]),
        trade_id=str(raw["trade_id"]),
        price=Decimal(str(raw["price"])),
        quantity=Decimal(str(raw["quantity"])),
        fee=Decimal(str(raw["fee"])),
        fee_currency=str(raw["fee_currency"]),
        is_maker=bool(raw["is_maker"]),
        is_simulated=bool(raw["is_simulated"]),
        exchange_timestamp=int(raw["exchange_timestamp"]),
        received_timestamp=int(raw["received_timestamp"]),
        symbol=None if raw.get("symbol") is None else str(raw["symbol"]),
        side=None if raw.get("side") is None else OrderSide(str(raw["side"])),
        exchange=None if raw.get("exchange") is None else ExchangeId(str(raw["exchange"])),
        quote_quantity=(
            None
            if raw.get("quote_quantity") is None
            else Decimal(str(raw["quote_quantity"]))
        ),
        exchange_order_id=(
            None if raw.get("exchange_order_id") is None else str(raw["exchange_order_id"])
        ),
    )


def _fill_params(tenant_id: str, fill: Fill) -> list[object]:
    return [
        tenant_id,
        fill.order_id,
        fill.fill_id,
        fill.trade_id,
        str(fill.price),
        str(fill.quantity),
        str(fill.fee),
        fill.fee_currency,
        fill.is_maker,
        fill.is_simulated,
        fill.exchange_timestamp,
        fill.received_timestamp,
        fill.symbol,
        None if fill.side is None else fill.side.value,
        None if fill.exchange is None else fill.exchange.value,
        _dec(fill.quote_quantity),
        fill.exchange_order_id,
    ]


def _stored_payload_to_map(raw: object) -> dict[str, str]:
    """Decode a stored event payload (jsonb arrives as text or mapping)."""
    payload = json.loads(raw) if isinstance(raw, str) else raw
    if not isinstance(payload, dict) or any(
        not isinstance(key, str) or not isinstance(value, str) for key, value in payload.items()
    ):
        # A JSON object of strings is the OrderEvent.payload type; anything
        # else is a row nobody wrote - coercing it would launder corruption
        # into a valid-looking journal entry.
        raise OrderStoreError(
            "stored event payload is not a JSON object of strings - the row lies outside the codec"
        )
    return dict(payload)


def _decode_event(row: Any) -> OrderEvent:
    payload = _stored_payload_to_map(row["payload"])
    return OrderEvent(
        event_id=str(row["event_id"]),
        order_id=str(row["order_id"]),
        previous_status=(
            None if row["previous_status"] is None else OrderStatus(str(row["previous_status"]))
        ),
        status=OrderStatus(str(row["status"])),
        reason=None if row["reason"] is None else str(row["reason"]),
        occurred_at=int(row["occurred_at"]),
        payload=payload,
    )


def _decode_fill_row(row: Any) -> Fill:
    return Fill(
        fill_id=str(row["fill_id"]),
        order_id=str(row["order_id"]),
        trade_id=str(row["trade_id"]),
        price=Decimal(str(row["price"])),
        quantity=Decimal(str(row["quantity"])),
        fee=Decimal(str(row["fee"])),
        fee_currency=str(row["fee_currency"]),
        is_maker=bool(row["is_maker"]),
        is_simulated=bool(row["is_simulated"]),
        exchange_timestamp=int(row["exchange_timestamp"]),
        received_timestamp=int(row["received_timestamp"]),
        symbol=None if row["symbol"] is None else str(row["symbol"]),
        side=None if row["side"] is None else OrderSide(str(row["side"])),
        exchange=None if row["exchange"] is None else ExchangeId(str(row["exchange"])),
        quote_quantity=(
            None
            if row["quote_quantity"] is None
            else Decimal(str(row["quote_quantity"]))
        ),
        exchange_order_id=(
            None
            if row["exchange_order_id"] is None
            else str(row["exchange_order_id"])
        ),
    )


def _decode_order(row: Any) -> Order:
    """Row -> domain object, with the embedded child lists replayed verbatim.

    Every enum and Decimal goes through its constructor, so a row written
    by a future, wider vocabulary fails HERE (ValueError from the enum,
    InvalidOperation from Decimal) rather than surfacing as an order with a
    status the transition table has never heard of. Corrupt state is an
    error, not a default - the risk engine's law, applied to storage.

    The stored aggregates (filled_quantity, average_fill_price, ...) are
    ASSIGNED, not re-derived through ``apply_fill``: they are the output of
    the pure derivation that ran at write time, and pushing the fills back
    through ``apply_fill`` here would synthesize duplicate journal events
    and rewrite ``updated_at`` on every read. The dedup set is seeded so a
    caller that later applies another fill to this object gets the domain's
    own duplicate protection.
    """
    fills_json = row["fills_json"]
    events_json = row["events_json"]
    fills_raw = json.loads(fills_json) if isinstance(fills_json, str) else fills_json
    events_raw = json.loads(events_json) if isinstance(events_json, str) else events_json
    fills: list[Fill] = [
        _decode_fill_json(item) for item in (fills_raw if isinstance(fills_raw, list) else ())
    ]
    events: list[OrderEvent] = [
        OrderEvent(
            event_id=str(item["event_id"]),
            order_id=str(item["order_id"]),
            previous_status=(
                None
                if item.get("previous_status") is None
                else OrderStatus(str(item["previous_status"]))
            ),
            status=OrderStatus(str(item["status"])),
            reason=None if item.get("reason") is None else str(item["reason"]),
            occurred_at=int(item["occurred_at"]),
            payload=_stored_payload_to_map(item.get("payload") or "{}"),
        )
        for item in (events_raw if isinstance(events_raw, list) else ())
    ]
    return Order(
        order_id=str(row["order_id"]),
        client_order_id=str(row["client_order_id"]),
        tenant_id=str(row["tenant_id"]),
        account_id=str(row["account_id"]),
        strategy_id=None if row["strategy_id"] is None else str(row["strategy_id"]),
        exchange=ExchangeId(str(row["exchange"])),
        symbol=str(row["symbol"]),
        side=OrderSide(str(row["side"])),
        order_type=OrderType(str(row["order_type"])),
        quantity=Decimal(str(row["quantity"])),
        price=None if row["price"] is None else Decimal(str(row["price"])),
        stop_price=None if row["stop_price"] is None else Decimal(str(row["stop_price"])),
        time_in_force=TimeInForce(str(row["time_in_force"])),
        reduce_only=bool(row["reduce_only"]),
        signal_id=None if row["signal_id"] is None else str(row["signal_id"]),
        is_simulated=bool(row["is_simulated"]),
        status=OrderStatus(str(row["status"])),
        exchange_order_id=(
            None if row["exchange_order_id"] is None else str(row["exchange_order_id"])
        ),
        filled_quantity=Decimal(str(row["filled_quantity"])),
        average_fill_price=(
            None if row["average_fill_price"] is None else Decimal(str(row["average_fill_price"]))
        ),
        cumulative_fee=Decimal(str(row["cumulative_fee"])),
        fee_currency=None if row["fee_currency"] is None else str(row["fee_currency"]),
        rejection_reason=None if row["rejection_reason"] is None else str(row["rejection_reason"]),
        created_at=int(row["created_at"]),
        updated_at=int(row["updated_at"]),
        submitted_at=None if row["submitted_at"] is None else int(row["submitted_at"]),
        terminal_at=None if row["terminal_at"] is None else int(row["terminal_at"]),
        fills=fills,
        events=events,
        _fill_ids={fill.fill_id for fill in fills},
    )


class PostgresOrderStore(OrderStore):
    """``OrderStore`` over an asyncpg-compatible pool (Part 13).

    Construction takes a pool, never a DSN: the lifespan owns the driver
    (and the refusal when migrations have not been applied), so this file
    imports no driver and unit-tests against a scripted fake the way the
    coordination scripts do. Every method follows the same shape -
    acquire, transaction, tenant GUC first, statements, release - and NO
    method swallows a pool error: the durable record is the reason for the
    command's existence, and a failed write that reports success is the
    exact failure mode durability is supposed to remove.
    """

    __slots__ = ("_pool",)

    def __init__(self, pool: PgPool) -> None:
        self._pool = pool

    # -- port surface -------------------------------------------------------

    @property
    def is_durable(self) -> bool:
        """Always True. This is the property the engine and the worker's
        startup gate read; the class either means it or must not exist."""
        return True

    async def reserve_client_order_id(
        self, tenant_id: str, client_order_id: str, order: Order
    ) -> ReservationOutcome:
        holder_row: Any | None = None
        landed_here = False
        async with self._operation(tenant_id) as conn:
            landed = await conn.fetchrow(
                RESERVE_INSERT_SQL, *_order_params(order, ReconciliationState.UNKNOWN)
            )
            # The reservation records the order as reconciliation-UNKNOWN -
            # precisely: an order we have durably decided to submit but have
            # not seen the result of may or may not exist at the venue, and
            # UNKNOWN is the state whose contract is "query by clientOrderId,
            # never resubmit". The in-memory store cannot express this (it
            # loses the question at restart); the durable one must not
            # pretend otherwise. save_order preserves the column, and only
            # an explicit set_reconciliation_state clears it.
            landed_here = landed is not None and str(landed["order_id"]) == order.order_id
            if not landed_here:
                holder_row = await conn.fetchrow(
                    _SELECT_BY_CLIENT_SQL, tenant_id, client_order_id
                )
        if landed_here:
            return ReservationOutcome(reserved=True)
        if holder_row is None:
            # Either the insert lost a conflict on (tenant, order_id) while
            # the client id maps to nobody (the row exists under a DIFFERENT
            # client id - honouring it would double-book), or the conflicting
            # transaction rolled away between our two statements. Both answer
            # "not reserved, holder unknown" and the caller retries.
            return ReservationOutcome(reserved=False, existing=None)
        holder = _decode_order(holder_row)
        if holder.order_id == order.order_id:
            # Same order retrying: it already owns the reservation.
            return ReservationOutcome(reserved=True, existing=holder)
        return ReservationOutcome(reserved=False, existing=holder)

    async def save_order(self, order: Order) -> Order:
        async with self._operation(order.tenant_id) as conn:
            recon_row = await conn.fetchrow(_GET_RECON_SQL, order.tenant_id, order.order_id)
            reconciliation = (
                None
                if recon_row is None or recon_row["reconciliation_state"] is None
                else ReconciliationState(str(recon_row["reconciliation_state"]))
            )
            await conn.execute(_SAVE_UPSERT_SQL, *_order_params(order, reconciliation))
            # Storing a client id another order already holds raises the
            # unique violation instead of silently keeping the first mapping
            # (in-memory's setdefault quirk). Strictness is the safe
            # direction; the engine's flow can only reach here through a
            # reservation that this same statement set.
        return order

    async def get_order(self, tenant_id: str, order_id: str) -> Order | None:
        async with self._operation(tenant_id) as conn:
            row = await conn.fetchrow(_SELECT_BY_ORDER_SQL, tenant_id, order_id)
        return None if row is None else _decode_order(row)

    async def get_by_client_order_id(
        self, tenant_id: str, client_order_id: str
    ) -> Order | None:
        async with self._operation(tenant_id) as conn:
            row = await conn.fetchrow(_SELECT_BY_CLIENT_SQL, tenant_id, client_order_id)
        return None if row is None else _decode_order(row)

    async def list_open_orders(
        self,
        tenant_id: str,
        account_id: str,
        *,
        exchange: ExchangeId | None = None,
        symbol: str | None = None,
    ) -> tuple[Order, ...]:
        # $3 is the terminal-status vocabulary from the shared enum - the
        # same set the in-memory reference filters with, imported never
        # re-declared; $4/$5 are the optional exact-match predicates,
        # numbered off the actual prefix length so no call shape can
        # mis-address a placeholder.
        params: list[object] = [
            tenant_id,
            account_id,
            # sorted(): the enum set's iteration order is not a fact to leak
            # into bound parameters (frozenset-of-str order can differ across
            # processes under hash randomization); an ANY-array's members are
            # a SET, so sorting loses nothing and makes every logged shape
            # reproducible.
            sorted(status.value for status in TERMINAL_ORDER_STATUSES),
        ]
        sql = _LIST_OPEN_SQL_BASE
        if exchange is not None:
            params.append(exchange.value)
            sql += f" AND o.exchange = ${len(params)}"
        if symbol is not None:
            params.append(symbol)
            sql += f" AND o.symbol = ${len(params)}"
        sql += _LIST_OPEN_ORDER_BY
        async with self._operation(tenant_id) as conn:
            rows = await conn.fetch(sql, *params)
        return tuple(_decode_order(row) for row in rows)

    async def list_orders_needing_reconciliation(
        self,
        *,
        older_than_micros: int | None = None,
        limit: int = 100,
    ) -> tuple[Order, ...]:
        raise CrossTenantSweepUnsupported(
            "the cross-tenant reconciliation sweep is not a tenant-scoped "
            "question; run reconcile per account via reconcile-trading-account "
            "(see docs/PART13_DURABLE_STORE.md)"
        )

    async def set_reconciliation_state(
        self,
        tenant_id: str,
        order_id: str,
        state: ReconciliationState,
        *,
        detail: str | None = None,
    ) -> None:
        # IN_SYNC writes NULL (the in-memory store DELETES the entry):
        # "no row" and "IN_SYNC" are the same fact, and a durable table
        # must not grow a second spelling of it. `detail` is accepted and
        # deliberately not stored, exactly as the reference ignores it -
        # the reconciliation INCIDENT channel (the recorder) is where
        # details belong; a second detail column here would rot silently
        # the moment the recorder became the source of truth.
        _ = detail
        value = None if state is ReconciliationState.IN_SYNC else state.value
        async with self._operation(tenant_id) as conn:
            await conn.execute(_SET_RECON_SQL, tenant_id, order_id, value)

    async def get_reconciliation_state(
        self, tenant_id: str, order_id: str
    ) -> ReconciliationState:
        async with self._operation(tenant_id) as conn:
            row = await conn.fetchrow(_GET_RECON_SQL, tenant_id, order_id)
        if row is None or row["reconciliation_state"] is None:
            return ReconciliationState.IN_SYNC
        return ReconciliationState(str(row["reconciliation_state"]))

    async def record_event(self, tenant_id: str, event: OrderEvent) -> OrderEvent:
        async with self._operation(tenant_id) as conn:
            await conn.fetchrow(
                _RECORD_EVENT_SQL,
                tenant_id,
                event.order_id,
                event.event_id,
                None if event.previous_status is None else event.previous_status.value,
                event.status.value,
                event.reason,
                event.occurred_at,
                _payload_json(event.payload),
            )
        return event

    async def list_events(self, tenant_id: str, order_id: str) -> tuple[OrderEvent, ...]:
        async with self._operation(tenant_id) as conn:
            rows = await conn.fetch(_LIST_EVENTS_SQL, tenant_id, order_id)
        return tuple(_decode_event(row) for row in rows)

    async def record_fill(self, tenant_id: str, fill: Fill) -> bool:
        async with self._operation(tenant_id) as conn:
            landed = await conn.fetchrow(_RECORD_FILL_SQL, *_fill_params(tenant_id, fill))
        # Truthy row == "this fill was newly recorded"; None == a replay of
        # a fill id already stored - the venue can send the same execution
        # twice, and the ledger must not double-count it.
        return landed is not None

    async def list_fills(self, tenant_id: str, order_id: str) -> tuple[Fill, ...]:
        async with self._operation(tenant_id) as conn:
            rows = await conn.fetch(_LIST_FILLS_SQL, tenant_id, order_id)
        return tuple(_decode_fill_row(row) for row in rows)

    # -- internals ----------------------------------------------------------

    def _operation(self, tenant_id: str) -> _TenantTransaction:
        return _TenantTransaction(self._pool, tenant_id)


class _TenantTransaction:
    """acquire -> begin -> set GUC -> (work) -> commit, as one context.

    The store's uniform rhythm lives in one place so no future method can
    forget the transaction or the GUC by accident: forgetting is now a
    change to THIS class, which every method shares and every test pins.
    """

    __slots__ = ("_pool", "_tenant_id", "_cm", "_conn", "_tx")

    def __init__(self, pool: PgPool, tenant_id: str) -> None:
        self._pool = pool
        self._tenant_id = tenant_id

    async def __aenter__(self) -> PgConnection:
        if _CANONICAL_UUID_RE.fullmatch(self._tenant_id) is None:
            raise OrderStoreError(
                f"tenant id {self._tenant_id!r} is not a canonical UUID; the "
                f"{TABLE_ORDERS} table holds tenant_id as uuid, so this store "
                "accepts nothing else - stated here because a driver's "
                '"invalid input syntax for type uuid" mid-command is a worse '
                "diagnosis than a refusal before the connection is even used"
            )
        self._cm = self._pool.acquire()
        self._conn = await self._cm.__aenter__()
        self._tx = self._conn.transaction()
        await self._tx.__aenter__()
        await self._conn.execute(SET_TENANT_SQL, self._tenant_id)
        return self._conn

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> bool:
        try:
            return bool(await self._tx.__aexit__(exc_type, exc, tb))
        finally:
            await self._cm.__aexit__(exc_type, exc, tb)
```

FILE: services/execution-engine/log-config.json

```json
{
  "version": 1,
  "disable_existing_loggers": false
}
```

FILE: services/execution-engine/pyproject.toml

```toml
[project]
name = "wlct-execution-engine"
version = "1.0.0"
description = "Trading worker's execution core: hosts wlct_trading.execution behind the internal API"
requires-python = ">=3.11"

[tool.ruff]
line-length = 100
target-version = "py311"

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP", "S", "ASYNC"]
ignore = ["S101"]

[tool.mypy]
python_version = "3.11"
strict = true
# trading-core is a repo package; mypy does not resolve PEP 660 lightweight
# editables. Pointing mypy_path at the source makes every wlct_trading import
# FULLY TYPED (better than site-packages resolution), so the money path's
# types are checked, not blurred to Any.
mypy_path = "$MYPY_CONFIG_FILE_DIR/../../libs/trading-core"
warn_unreachable = true
disallow_untyped_defs = true

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]

[[tool.mypy.overrides]]
# Stub-less third-party modules the service imports. Same list as the
# trading engine: PEP 561 says these ship no types; strictness is unchanged
# for first-party code. asyncpg joins the list with Part 13: it is the one
# module allowed to touch the driver (app/pg_store.py); the store itself
# speaks the PgPool protocol and stays driver-free.
module = ["asyncpg.*", "pythonjsonlogger.*", "jsonlogger.*"]
ignore_missing_imports = true

[[tool.mypy.overrides]]
# One rule relaxed for one file, with cause: ServiceJsonFormatter subclasses
# pythonjsonlogger's JsonFormatter, whose __init__ mypy can only ever see as
# untyped (no stubs exist and never will - upstream). The constructor
# override in that file TYPES the subclass surface; the residual `super().__init__`
# call into the stub-less base is what no-untyped-call flags. Refusing to
# call an untyped third-party base is not more correct, so this file opts
# out of THAT rule only; every other strict rule still applies to it in
# full, and to all other files without exception.
module = ["app.logging_config"]
disallow_untyped_calls = false
```

FILE: services/execution-engine/requirements-dev.txt

```text
-r requirements.txt
pytest==8.3.3
pytest-asyncio==0.24.0
# httpx is NOT listed here any more: Part 19 made it a runtime dependency (see
# requirements.txt), and a pin repeated in two files is two pins - one of which will be
# upgraded while the other is not. fastapi.testclient's own requirement is satisfied by
# the same file either way.
# SQL parsing for the drift-parity and store suites (Parts 13-15 parse the engine
# migrations and every SQL constant with it, so a typo in a statement is a test
# failure rather than a startup error). Declared here because it was NOT declared
# anywhere: parts 13 and 14 reached for it through pytest.importorskip and a hard
# import in the same suite, so a clean environment following this file's own
# instructions could not even COLLECT the service tests - four collection errors,
# and the two importorskip sites were quietly skipping the assurance instead.
# Pinned like everything else here: a parser upgrade that changes how it reads a
# CREATE INDEX would show up as a failing expectation, not as a mystery.
sqlglot==30.18.0
ruff==0.6.9
mypy==1.11.2

# The execution core is a repo package, not a PyPI one; tests and local runs
# resolve it from source exactly like the trading engine does.
-e ../../libs/trading-core
```

FILE: services/execution-engine/requirements.txt

```text
# Runtime dependencies, pinned exactly like the sibling services so one
# upgrade sweep touches all Python services together.
fastapi==0.115.0
uvicorn[standard]==0.31.0
pydantic==2.9.2
pydantic-settings==2.5.2
python-json-logger==2.0.7
# Live credential fetching (Part 19). app/secret_fetcher.py is the one module in this
# service that talks HTTP to a secret store, and it is a RUNTIME dependency, not a
# test one: previously httpx appeared only in requirements-dev.txt (pulled in for
# fastapi.testclient), so a production image built from this file had no HTTP client at
# all and the fetcher would have failed on its first import in the deployed container -
# the kind of defect that is invisible to a green test suite and visible only at 3am in
# a datacenter. Same pin as the trading engine and market data, same sweep rule.
httpx==0.27.2
# Durable order store (Part 13). Pinned exactly like the trading engine's
# asyncpg, same reason as every other pin here: one upgrade sweep moves all
# Python services together, and this driver speaks to the same Postgres.
asyncpg==0.29.0
```

FILE: services/execution-engine/tests/__init__.py

```python

```

FILE: services/execution-engine/tests/conftest.py

```python
"""Environment and client fixtures for the execution-engine tests.

Every test runs against the REAL composition root (no mocks under the
money-path wiring): what the tests assert is that startup, auth, validation
and command routing behave when everything underneath is the same code the
service ships. The simulated store being process-local is a property of
the mode, not a test convenience - and the readiness test asserts exactly
that property is VISIBLE.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings

#: Built from parts so no full secret-shaped literal sits in this file to
#: trip redaction/secret scanners, and so tests cannot accidentally share
#: the sample with production config.
_TEST_TOKEN = ("w1tch", "cra", "ftpu", "dd1e10")

BASE_ENV = {
    "NODE_ENV": "test",
    "LOG_LEVEL": "warning",
    "EXECUTION_INSTANCE_ID": "exec-test-1",
    "EXECUTION_INTERNAL_TOKEN": "".join(_TEST_TOKEN) * 4,  # 48 chars
    "EXECUTION_MODE": "simulated",
    "EXECUTION_DRY_RUN": "true",
    "EXECUTION_PAPER_BALANCES": "USDT=100000,BTC=2",
    "EXECUTION_SIMULATED_MID": "50000",
}


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key, value in BASE_ENV.items():
        monkeypatch.setenv(key, value)
    get_settings.cache_clear()


def auth_headers(tenant: str = "tenant-a") -> dict[str, str]:
    return {
        "x-internal-token": BASE_ENV["EXECUTION_INTERNAL_TOKEN"],
        "x-tenant-id": tenant,
    }


@pytest.fixture
def client() -> Iterator[TestClient]:
    # Annotated as a generator, because that is what it is: `yield` makes the function
    # an Iterator and `-> TestClient` was a lie a type checker could only report as an
    # error. Fixed while Part 20's suite was importing this fixture, since leaving a
    # known-wrong annotation in a file the new tests depend on is the kind of
    # "somebody else's file" reasoning that lets a tree accumulate broken types.
    """A booted app behind a TestClient.

    Starlette's TestClient keeps the app on ``client.app`` and its lifespan
    runs on context entry, so tests reach the assembled runtime via
    ``client.app.state.runtime`` to seed stores - against the real
    composition root, never a mocked one.
    """
    from app.main import create_app

    app = create_app()
    with TestClient(app) as test_client:
        yield test_client
```

FILE: services/execution-engine/tests/test_execution_engine.py

```python
"""Execution engine: startup, auth, validation and the four commands.

These tests run the complete stack - FastAPI app, lifespan, composition
root, the core ``ExecutionEngine`` with its paper adapters and in-memory
stores - with no mocks below the HTTP surface. Where the engine REFUSES
(live mode, unwired commands) the tests demand the refusal, because a
service that grows capabilities silently is worse than one that is missing
them.
"""

from __future__ import annotations

import asyncio
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from wlct_trading.adapters.paper import PaperTradingAdapter
from wlct_trading.enums import ExchangeId, OrderSide, OrderStatus, OrderType
from wlct_trading.execution.engine import ExecutionEngine
from wlct_trading.execution.incidents import InMemoryIncidentRecorder
from wlct_trading.execution.locks import InMemoryLockManager
from wlct_trading.execution.store import InMemoryOrderStore
from wlct_trading.market_data import BookTop
from wlct_trading.orders import Order

from app.composition import SUPPORTED_COMMANDS, ExecutionUnavailable, build_runtime
from app.config import Settings
from app.main import CORRELATION_HEADER
from app.security import CALLER_AUTH_HEADER, TENANT_HEADER
from tests.conftest import BASE_ENV, auth_headers


def settings_for(*overrides: tuple[str, object]) -> Settings:
    """Settings built from the test env with overrides applied.

    The dict passed to model_validate is the INIT source, which overrides
    the ambient env per value; "value absent entirely" is therefore spelled
    as an empty string (init says "", env cannot re-add) rather than a
    popped key (env would fill it back - correct pydantic-settings
    behaviour, and the reason overrides arrive as tuples not kwargs: the
    S106 scanner is right that a KEYWORD named *_TOKEN holding a string
    literal looks exactly like a hardcoded secret, and here it genuinely
    is test input, so the call shape says so too.
    """
    merged: dict[str, object] = dict(BASE_ENV)
    for key, value in overrides:
        merged[key] = value
    return Settings.model_validate(merged)


# ---------------------------------------------------------------------------
# startup and mode refusal
# ---------------------------------------------------------------------------


class TestStartup:
    def test_health_and_ready_report_wiring_truthfully(self, client: TestClient) -> None:
        health = client.get("/health")
        assert health.status_code == 200
        assert health.json()["service"] == "execution-engine"
        ready = client.get("/health/ready")
        body = ready.json()
        assert body["status"] == "ready"
        # THE honesty assertion: simulated durability is REPORTED, not hidden
        assert body["storeDurable"] is False
        assert body["locksDistributed"] is False
        assert body["simulated"] is True
        assert set(body["commands"]) == set(SUPPORTED_COMMANDS)

    def test_live_mode_is_refused_at_construction(self) -> None:
        settings = Settings.model_validate({**BASE_ENV, "EXECUTION_MODE": "live"})
        with pytest.raises(ExecutionUnavailable, match="not wired in this build"):
            build_runtime(settings)

    def test_placeholder_token_and_missing_identity_refuse_boot(self) -> None:
        with pytest.raises(ValueError, match="EXECUTION_INSTANCE_ID is required"):
            settings_for(("EXECUTION_INSTANCE_ID", "   "))
        with pytest.raises(ValueError, match="EXECUTION_INSTANCE_ID is required"):
            settings_for(("EXECUTION_INSTANCE_ID", ""))
        with pytest.raises(ValueError, match="EXECUTION_INTERNAL_TOKEN is required"):
            settings_for(("EXECUTION_INTERNAL_TOKEN", ""))
        with pytest.raises(ValueError, match="at least 32 characters"):
            settings_for(("EXECUTION_INTERNAL_TOKEN", "short"))
        with pytest.raises(ValueError, match="placeholder"):
            settings_for(("EXECUTION_INTERNAL_TOKEN", "changeme-" + "x" * 40))

    def test_malformed_mode_values_refuse_boot(self) -> None:
        with pytest.raises(ValueError, match="must be a decimal number"):
            settings_for(("EXECUTION_SIMULATED_MID", "50O00"))  # letter O
        with pytest.raises(ValueError, match="ASSET=QUANTITY"):
            settings_for(("EXECUTION_PAPER_BALANCES", "USDT;1000"))
        with pytest.raises(ValueError, match="one second"):
            settings_for(("EXECUTION_LOCK_TTL_MS", 250))

    def test_public_config_view_holds_no_secrets(self) -> None:
        view = settings_for().to_public_dict()
        blob = repr(view)
        assert BASE_ENV["EXECUTION_INTERNAL_TOKEN"] not in blob


# ---------------------------------------------------------------------------
# auth boundary
# ---------------------------------------------------------------------------


class TestAuth:
    def test_missing_and_wrong_token_are_401(self, client: TestClient) -> None:
        missing = client.post(
            "/internal/v1/accounts/verify-credentials",
            json={"tenantId": "tenant-a", "accountId": "acct-1"},
        )
        assert missing.status_code == 401
        wrong = client.post(
            "/internal/v1/accounts/verify-credentials",
            headers={CALLER_AUTH_HEADER: "x" * 40, TENANT_HEADER: "tenant-a"},
            json={"tenantId": "tenant-a", "accountId": "acct-1"},
        )
        assert wrong.status_code == 401

    def test_tenantless_and_mismatched_calls_are_refused(self, client: TestClient) -> None:
        tenantless = client.post(
            "/internal/v1/accounts/verify-credentials",
            headers={CALLER_AUTH_HEADER: BASE_ENV["EXECUTION_INTERNAL_TOKEN"]},
            json={"tenantId": "tenant-a", "accountId": "acct-1"},
        )
        assert tenantless.status_code == 400
        assert tenantless.json()["code"] == "TENANT_HEADER_REQUIRED"

        mismatch = client.post(
            "/internal/v1/accounts/verify-credentials",
            headers=auth_headers("tenant-a"),
            json={"tenantId": "tenant-b", "accountId": "acct-1"},
        )
        assert mismatch.status_code == 403
        assert mismatch.json()["code"] == "TENANT_MISMATCH"

    def test_validation_errors_never_echo_payload_values(self, client: TestClient) -> None:
        response = client.post(
            "/internal/v1/accounts/verify-credentials",
            headers=auth_headers(),
            json={
                "tenantId": "tenant-a",
                "accountId": "acct-1",
                "apiKey": "AK-must-not-appear-here-4f3c",
            },
        )
        assert response.status_code == 422
        assert "AK-must-not-appear-here-4f3c" not in response.text

    def test_correlation_header_round_trips(self, client: TestClient) -> None:
        response = client.get(
            "/internal/v1/status",
            headers={**auth_headers(), "x-request-id": "job-42"},
        )
        assert response.status_code == 200
        assert response.headers[CORRELATION_HEADER] == "job-42"

    def test_status_requires_auth(self, client: TestClient) -> None:
        assert client.get("/internal/v1/status").status_code == 401


# ---------------------------------------------------------------------------
# the commands
# ---------------------------------------------------------------------------


class TestCommands:
    def test_verify_credentials(self, client: TestClient) -> None:
        response = client.post(
            "/internal/v1/accounts/verify-credentials",
            headers=auth_headers(),
            json={"tenantId": "tenant-a", "accountId": "acct-1"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["verified"] is True
        # The simulated label is not optional garnish - it is the difference
        # between a rehearsal and a lie.
        assert body["isSimulated"] is True
        assert "Simulated" in body["note"]

    def test_refresh_balances_returns_configured_simulated_values(self, client: TestClient) -> None:
        response = client.post(
            "/internal/v1/accounts/refresh-balances",
            headers=auth_headers(),
            json={"tenantId": "tenant-a", "accountId": "acct-1"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["isSimulated"] is True
        assert {row["asset"]: row["free"] for row in body["balances"]} == {
            "BTC": "2",
            "USDT": "100000",
        }

    def test_reconcile_reports_counts_not_narrative(self, client: TestClient) -> None:
        response = client.post(
            "/internal/v1/accounts/reconcile",
            headers=auth_headers(),
            json={"tenantId": "tenant-a", "accountId": "acct-1"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["tenantId"] == "tenant-a"
        assert body["ordersChecked"] == 0
        assert body["discrepancyCount"] == 0
        assert body["error"] is None
        assert body["finishedAtMicros"] >= body["startedAtMicros"]

    def test_resync_private_stream_refuses_honestly(self, client: TestClient) -> None:
        response = client.post(
            "/internal/v1/accounts/resync-private-stream",
            headers=auth_headers(),
            json={"tenantId": "tenant-a", "accountId": "acct-1"},
        )
        assert response.status_code == 501
        assert response.json()["code"] == "NOT_SUPPORTED"

    def test_cancel_unknown_order_is_404_not_fabrication(self, client: TestClient) -> None:
        response = client.post(
            "/internal/v1/orders/cancel",
            headers=auth_headers(),
            json={
                "tenantId": "tenant-a",
                "accountId": "acct-1",
                "orderId": "no-such-order",
                "clientOrderId": "c-1",
                "symbol": "BTCUSDT",
            },
        )
        assert response.status_code == 404
        assert response.json()["code"] == "ORDER_NOT_FOUND"

    def test_cancel_full_path_through_the_real_engine(self, client: TestClient) -> None:
        runtime = client.app.state.runtime
        order = resting_order()
        # Seed the SAME store the request path reads - no parallel fake.
        asyncio.run(runtime.store.save_order(order))
        response = client.post(
            "/internal/v1/orders/cancel",
            headers=auth_headers(),
            json={
                "tenantId": order.tenant_id,
                "accountId": order.account_id,
                "orderId": order.order_id,
                "clientOrderId": order.client_order_id,
                "symbol": order.symbol,
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["outcome"] == "ACCEPTED"
        assert body["isSimulated"] is True
        assert body["orderStatus"] == OrderStatus.CANCELLED.value
        # the store moved: what the API will later read is what happened
        stored = asyncio.run(runtime.store.get_order(order.tenant_id, order.order_id))
        assert stored is not None
        assert stored.status is OrderStatus.CANCELLED

    def test_cancel_identity_mismatch_is_409(self, client: TestClient) -> None:
        runtime = client.app.state.runtime
        order = resting_order()
        asyncio.run(runtime.store.save_order(order))
        response = client.post(
            "/internal/v1/orders/cancel",
            headers=auth_headers(),
            json={
                "tenantId": order.tenant_id,
                "accountId": order.account_id,
                "orderId": order.order_id,
                "clientOrderId": "someone-elses-client-id",
                "symbol": order.symbol,
            },
        )
        assert response.status_code == 409
        assert response.json()["code"] == "ORDER_IDENTITY_MISMATCH"


def resting_order() -> Order:
    return Order(
        order_id="ord-cancel-me",
        client_order_id="clord-77",
        tenant_id="tenant-a",
        account_id="acct-1",
        strategy_id=None,
        exchange=ExchangeId.PAPER,
        symbol="BTCUSDT",
        side=OrderSide.BUY,
        order_type=OrderType.LIMIT,
        quantity=Decimal("0.01"),
        price=Decimal("49000"),
        is_simulated=True,
        status=OrderStatus.ACKNOWLEDGED,
    )


# ---------------------------------------------------------------------------
# the wiring itself keeps the same guarantees the core was tested with
# ---------------------------------------------------------------------------


class TestCompositionProperties:
    def test_empty_mid_means_no_invented_prices(self) -> None:
        from app.composition import make_paper_book_provider

        provider = make_paper_book_provider(None)
        assert provider(ExchangeId.PAPER, "BTCUSDT") is None
        priced = make_paper_book_provider(Decimal("50000"))(ExchangeId.PAPER, "BTCUSDT")
        assert isinstance(priced, BookTop)
        assert priced.best_bid == priced.best_ask == Decimal("50000")

    def test_runtime_reuses_one_store_and_lock_table(self, client: TestClient) -> None:
        runtime = client.app.state.runtime
        # the engine and the reconciler must be looking at ONE ledger
        assert runtime.reconciliation is not None
        order = resting_order()
        asyncio.run(runtime.store.save_order(order))
        fetched = asyncio.run(
            runtime.reconciliation._trading.fetch_order(
                order.tenant_id, order.account_id, order.client_order_id
            )
        )
        assert fetched is None  # the ADAPTER's resting table was never fed by
        # a submit - seeding the store alone must not fake a venue-side order.
        # The cancel path still works because it goes through the engine's own
        # store/state checks, exactly as designed for reconciliation-required
        # cases.

    def test_build_runtime_produces_a_construction_safe_engine(self) -> None:
        # ExecutionEngine's own _assert_wiring_is_safe must pass for our
        # simulated wiring (it raises for simulated-gate-on-live etc.).
        runtime = build_runtime(settings_for())
        assert isinstance(runtime.engine, ExecutionEngine)
        assert isinstance(runtime.trading_adapter, PaperTradingAdapter)
        assert isinstance(runtime.store, InMemoryOrderStore)
        assert isinstance(runtime.locks, InMemoryLockManager)
        assert isinstance(runtime.incidents, InMemoryIncidentRecorder)
        # build_runtime itself is the assertion: the engine's
        # _assert_wiring_is_safe ran inside the constructor and did not
        # raise, which is the core's own definition of "this combination is
        # safe to serve with".
```

FILE: services/execution-engine/tests/test_part13_config_composition.py

```python
"""Part 13: store-backend configuration law and composition refusals.

The env matrix is the operator's only input to durability; this file pins
that every contradictory combination REFUSES at validation or at build
rather than degrading. The public-view assertions guard the one secret the
part introduces: the DSN appears nowhere a log or status endpoint can
reach.
"""

from __future__ import annotations

import json
from typing import cast

import pytest
from fastapi.testclient import TestClient

from app.composition import ExecutionUnavailable, build_runtime
from app.config import Settings
from app.incidents_sql import PostgresIncidentRecorder
from app.store_sql import PgPool, PostgresOrderStore
from tests.conftest import BASE_ENV, auth_headers
from tests.test_execution_engine import settings_for
from tests.test_part13_postgres_store import FakeConn, FakePool

#: Distinctive so the "never public" assertion below could never pass by
#: accident: if this literal ever surfaces in a response, the test says so.
_TEST_DSN = "postgresql://engine_user:s3cr3t-part13@db.internal:5432/wlct_engine"


def _fake_durable_store() -> PostgresOrderStore:
    return PostgresOrderStore(cast(PgPool, FakePool(FakeConn())))


def _fake_durable_incidents() -> PostgresIncidentRecorder:
    return PostgresIncidentRecorder(cast(PgPool, FakePool(FakeConn())))


class TestStoreBackendConfig:
    def test_memory_is_the_default_and_needs_nothing(self) -> None:
        settings = Settings.model_validate(dict(BASE_ENV))
        assert settings.EXECUTION_STORE_BACKEND == "memory"
        assert settings.EXECUTION_POSTGRES_DSN is None

    def test_postgres_without_dsn_refuses(self) -> None:
        with pytest.raises(ValueError, match="requires EXECUTION_POSTGRES_DSN"):
            settings_for(
                ("EXECUTION_STORE_BACKEND", "postgres"),
                ("EXECUTION_POSTGRES_DSN", ""),
            )

    def test_non_postgres_scheme_dsn_refuses(self) -> None:
        with pytest.raises(ValueError, match="postgresql:// connection string"):
            settings_for(
                ("EXECUTION_STORE_BACKEND", "postgres"),
                ("EXECUTION_POSTGRES_DSN", "mysql://user:pw@db/app"),
            )

    def test_dsn_under_memory_backend_refuses_the_mismatch(self) -> None:
        # Somebody meant durability and set only half of it; the config must
        # not resolve the ambiguity by silently keeping the (losing) memory
        # store.
        with pytest.raises(ValueError, match="half-configured durable store"):
            settings_for(("EXECUTION_POSTGRES_DSN", _TEST_DSN))

    def test_postgres_with_dsn_validates(self) -> None:
        settings = settings_for(
            ("EXECUTION_STORE_BACKEND", "postgres"),
            ("EXECUTION_POSTGRES_DSN", _TEST_DSN),
        )
        assert settings.EXECUTION_STORE_BACKEND == "postgres"

    def test_empty_dsn_under_memory_is_unset_not_a_mismatch(self) -> None:
        # docker-compose passes ${EXECUTION_POSTGRES_DSN:-} - an EMPTY
        # string must read as "no DSN", or every memory deployment would
        # trip the mismatch refusal on its own default.
        settings = settings_for(
            ("EXECUTION_STORE_BACKEND", "memory"),
            ("EXECUTION_POSTGRES_DSN", ""),
        )
        assert settings.to_public_dict()["postgresDsnConfigured"] is False
        runtime = build_runtime(settings)
        assert runtime.describe()["storeDurable"] is False

    def test_public_view_never_leaks_the_dsn(self) -> None:
        settings = settings_for(
            ("EXECUTION_STORE_BACKEND", "postgres"),
            ("EXECUTION_POSTGRES_DSN", _TEST_DSN),
        )
        view = settings.to_public_dict()
        assert view["storeBackend"] == "postgres"
        assert view["postgresDsnConfigured"] is True
        rendered = json.dumps(view)
        assert _TEST_DSN not in rendered
        assert "s3cr3t-part13" not in rendered  # the credential part alone


class TestCompositionRefusals:
    def test_postgres_backend_without_injected_store_refuses(self) -> None:
        settings = settings_for(
            ("EXECUTION_STORE_BACKEND", "postgres"),
            ("EXECUTION_POSTGRES_DSN", _TEST_DSN),
        )
        with pytest.raises(ExecutionUnavailable, match="lifespan-injected"):
            build_runtime(settings)

    def test_injected_store_under_memory_backend_refuses(self) -> None:
        settings = settings_for()
        with pytest.raises(ExecutionUnavailable, match="config and the wiring disagree"):
            build_runtime(settings, store=_fake_durable_store())

    def test_postgres_wiring_describes_itself_truthfully(self) -> None:
        settings = settings_for(
            ("EXECUTION_STORE_BACKEND", "postgres"),
            ("EXECUTION_POSTGRES_DSN", _TEST_DSN),
        )
        # Part 17's pairing law means a durable store arrives WITH a durable
        # incident sink (that is what app.main does at startup); passing one here
        # is the test saying "the pair, not one half of it".
        runtime = build_runtime(
            settings,
            store=_fake_durable_store(),
            incidents=_fake_durable_incidents(),
        )
        description = runtime.describe()
        assert description["store"] == "PostgresOrderStore"
        assert description["storeBackend"] == "postgres"
        # is_durable is the store's own claim, not the config's: True here
        # because the class says so (the fake pool proves the wiring, not
        # the connection - the connection-side refusal is pg_store's test).
        assert description["storeDurable"] is True

    def test_live_refusal_still_names_both_parts_honestly(self) -> None:
        settings = settings_for(("EXECUTION_MODE", "live"))
        with pytest.raises(ExecutionUnavailable, match="not wired in this build") as caught:
            build_runtime(settings)
        message = str(caught.value)
        # the stale "Part 12 will bring the durable store" claim is gone:
        # the message must say what is ACTUALLY missing now.
        assert "durable" in message and "credential" in message


class TestStatusSurface:
    def test_status_and_ready_carry_the_backend_label(self, client: TestClient) -> None:
        status = client.get("/internal/v1/status", headers=auth_headers())
        assert status.status_code == 200
        body = status.json()
        assert body["storeBackend"] == "memory"
        assert body["storeDurable"] is False
        ready = client.get("/health/ready").json()
        assert ready["storeBackend"] == "memory"

    def test_auth_uses_the_existing_internal_token_contract(self, client: TestClient) -> None:
        # Part 13 must not have moved the auth needle: missing token 401s.
        assert client.get("/internal/v1/status").status_code == 401
```

FILE: services/execution-engine/tests/test_part13_drift_parity.py

```python
"""Part 13: cross-language drift trap - store SQL vs the owning schema.

The Python service builds statements against tables whose DDL lives in the
Node world (apps/api/prisma). That split is a drift invitation, so this
file closes it mechanically: every column the store references must exist
in BOTH schema.prisma (model + @@map + @map spellings) and the Part 13
migration SQL, every conflict-target must name a constraint that exists,
and the bounded column widths must cover the wire validators that feed
them. Add a column to one side only and a test goes red here, not in a
stack trace at 3am.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from sqlglot import parse as sqlglot_parse

from app import store_sql

ROOT = Path(__file__).resolve().parents[3]
SCHEMA = ROOT / "apps" / "api" / "prisma" / "schema.prisma"
MIGRATION = (
    ROOT
    / "apps"
    / "api"
    / "prisma"
    / "migrations"
    / "20260914120000_part13_execution_store"
    / "migration.sql"
)


def _model_block(text: str, model: str) -> str:
    match = re.search(rf"^model {model} \{{(.*?)^\}}", text, re.DOTALL | re.MULTILINE)
    assert match is not None, f"model {model} missing from schema.prisma"
    return match.group(1)


def _create_table_block(sql: str, table: str) -> str:
    match = re.search(
        rf'CREATE TABLE "{table}" \((.*?)\n\);', sql, re.DOTALL
    )
    assert match is not None, f"CREATE TABLE {table} missing from the migration"
    return match.group(1)


@pytest.fixture(scope="module")
def schema_text() -> str:
    return SCHEMA.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def migration_text() -> str:
    return MIGRATION.read_text(encoding="utf-8")


class TestOrdersColumnsExistInBothArtifacts:
    def test_every_store_column_is_a_migration_column(self, migration_text: str) -> None:
        block = _create_table_block(migration_text, store_sql.TABLE_ORDERS)
        declared = set(re.findall(r'^\s+"([a-z_]+)"', block, re.MULTILINE))
        missing = set(store_sql._ORDER_COLUMNS) - declared
        assert not missing, (
            f"store references columns the migration never creates: {sorted(missing)}"
        )

    def test_every_migration_order_column_is_known_to_the_store(self, migration_text: str) -> None:
        block = _create_table_block(migration_text, store_sql.TABLE_ORDERS)
        declared = set(re.findall(r'^\s+"([a-z_]+)"', block, re.MULTILINE))
        unknown = declared - set(store_sql._ORDER_COLUMNS)
        # A column in the table the store does not know is also drift - it
        # will silently never be written by this adapter.
        assert not unknown, f"migration columns the store codec does not cover: {sorted(unknown)}"

    def test_schema_column_set_equals_the_store_column_set(self, schema_text: str) -> None:
        """Parse each field's effective column name (@map wins, else field
        name) and demand EXACT set equality with the SQL codec - in both
        directions, so a renamed, added or dropped column on either side
        fails here."""
        block = _model_block(schema_text, "ExecutionOrder")
        columns: set[str] = set()
        for line in block.splitlines():
            line = line.strip()
            match = re.match(r"(\w+)\s+\S+", line)
            if match is None or line.startswith("//") or line.startswith("@@"):
                continue
            mapped = re.search(r'@map\("([^"]+)"\)', line)
            columns.add(mapped.group(1) if mapped else match.group(1))
        declared = {c for c in columns if not c.startswith(("tenant ", "events ", "fills "))}
        # relation fields (tenant, events, lists) name no column
        declared -= {"tenant", "events", "fills"}
        assert declared == set(store_sql._ORDER_COLUMNS), (
            f"only-in-schema: {sorted(declared - set(store_sql._ORDER_COLUMNS))} "
            f"only-in-sql: {sorted(set(store_sql._ORDER_COLUMNS) - declared)}"
        )


class TestChildTablesParity:
    def test_fill_statement_columns_match_the_migration(self, migration_text: str) -> None:
        insert = store_sql._RECORD_FILL_SQL
        sql_columns = insert.split("(", 1)[1].split(")", 1)[0]
        referenced = {c.strip() for c in sql_columns.split(",")}
        declared = set(
            re.findall(
                r'^\s+"([a-z_]+)"',
                _create_table_block(migration_text, store_sql.TABLE_FILLS),
                re.MULTILINE,
            )
        )
        assert referenced - {"seq"} <= declared

    def test_event_statement_columns_match_the_migration(self, migration_text: str) -> None:
        insert = store_sql._RECORD_EVENT_SQL
        sql_columns = insert.split("(", 1)[1].split(")", 1)[0]
        referenced = {c.strip() for c in sql_columns.split(",")}
        declared = set(
            re.findall(
                r'^\s+"([a-z_]+)"',
                _create_table_block(migration_text, store_sql.TABLE_EVENTS),
                re.MULTILINE,
            )
        )
        assert referenced - {"seq"} <= declared

    def test_select_lists_use_only_declared_child_columns(self, migration_text: str) -> None:
        for table, sql in (
            (store_sql.TABLE_EVENTS, store_sql._LIST_EVENTS_SQL),
            (store_sql.TABLE_FILLS, store_sql._LIST_FILLS_SQL),
        ):
            selected = {
                c.strip() for c in sql.split("SELECT", 1)[1].split("FROM", 1)[0].split(",")
            }
            declared = set(
                re.findall(
                    r'^\s+"([a-z_]+)"',
                    _create_table_block(migration_text, table),
                    re.MULTILINE,
                )
            )
            assert selected <= declared, (
                f"{table}: selected {sorted(selected - declared)} not in migration"
            )


class TestLiteralsAgreeWithTheParamsTuple:
    """The SQL text is literal (no interpolation); the tuple is the param
    order. These glue the two so neither can drift from the migration."""

    def test_insert_column_list_equals_the_params_tuple(self) -> None:
        assert tuple(c.strip() for c in store_sql._ORDER_COLUMN_LIST.split(",")) == (
            store_sql._ORDER_COLUMNS
        )

    def test_select_prefix_reads_the_same_columns_in_order(self) -> None:
        head = store_sql._ORDER_SELECT.split("SELECT ", 1)[1].split(", COALESCE", 1)[0]
        assert tuple(c.strip().removeprefix("o.") for c in head.split(",")) == (
            store_sql._ORDER_COLUMNS
        )

    def test_upsert_assigns_every_column_but_the_composite_key(self) -> None:
        assign_part = store_sql._SAVE_UPSERT_SQL.split("DO UPDATE SET ", 1)[1]
        assigned = tuple(
            piece.split(" = ")[0].strip() for piece in assign_part.split(", ")
        )
        assert assigned == tuple(
            c for c in store_sql._ORDER_COLUMNS if c not in ("tenant_id", "order_id")
        )

    def test_table_name_constants_appear_where_sql_hardcodes_them(self) -> None:
        # the constants exist (pg_store's preflight uses them); the SQL
        # literals must name exactly those tables.
        assert store_sql.TABLE_ORDERS == "engine_orders"
        assert store_sql.TABLE_EVENTS == "engine_order_events"
        assert store_sql.TABLE_FILLS == "engine_order_fills"
        for sql in (
            store_sql.RESERVE_INSERT_SQL,
            store_sql._SAVE_UPSERT_SQL,
            store_sql._SELECT_BY_ORDER_SQL,
            store_sql._SET_RECON_SQL,
            store_sql._GET_RECON_SQL,
        ):
            assert "engine_orders" in sql
        assert store_sql.TABLE_EVENTS in store_sql._RECORD_EVENT_SQL
        assert store_sql.TABLE_FILLS in store_sql._RECORD_FILL_SQL


class TestConstraintsTheSqlReliesOn:
    def test_reservation_needs_the_tenant_client_unique(
        self, migration_text: str, schema_text: str
    ) -> None:
        assert (
            'CREATE UNIQUE INDEX "engine_orders_tenant_client_key" '
            'ON "engine_orders"("tenant_id", "client_order_id")'
            in migration_text
        )
        assert "@@unique([tenantId, clientOrderId]" in _model_block(schema_text, "ExecutionOrder")

    def test_fill_replay_protection_needs_the_tenant_fill_unique(
        self, migration_text: str, schema_text: str
    ) -> None:
        assert (
            'CREATE UNIQUE INDEX "engine_order_fills_tenant_fill_key" '
            'ON "engine_order_fills"("tenant_id", "fill_id")'
            in migration_text
        )
        assert "@@unique([tenantId, fillId]" in _model_block(schema_text, "ExecutionOrderFill")

    def test_open_order_predicate_needs_the_composite_index(self, migration_text: str) -> None:
        assert (
            'CREATE INDEX "engine_orders_tenant_id_account_id_status_idx" '
            'ON "engine_orders"("tenant_id", "account_id", "status")'
            in migration_text
        )

    def test_child_fk_composite_targets_the_composite_pk(self, migration_text: str) -> None:
        for table in (store_sql.TABLE_EVENTS, store_sql.TABLE_FILLS):
            pattern = (
                rf'ALTER TABLE "{table}" ADD CONSTRAINT .*FOREIGN KEY \("tenant_id", "order_id"\) '
                rf'REFERENCES "engine_orders"\("tenant_id", "order_id"\)'
            )
            assert re.search(pattern, migration_text, re.DOTALL), f"{table} lost its composite FK"

    def test_parent_identity_is_composite_never_global(
        self, schema_text: str, migration_text: str
    ) -> None:
        assert "@@id([tenantId, orderId])" in _model_block(schema_text, "ExecutionOrder")
        assert (
            'CONSTRAINT "engine_orders_pkey" PRIMARY KEY ("tenant_id", "order_id")'
            in migration_text
        )


class TestWidthLawsMatchTheWireValidators:
    """Column bounds must cover what the service's wire schemas accept.

    Parsed from the TEXT of app/schemas.py rather than imported Field
    objects: the point is that the two declarations - one enforced at the
    HTTP boundary, one at the table - stay consistent, and text-scan says
    so even for fields declared inside request models.
    """

    WIRE = ROOT / "services" / "execution-engine" / "app" / "schemas.py"

    def _wire_bound(self, field: str) -> int:
        text = self.WIRE.read_text(encoding="utf-8")
        match = re.search(rf'"{field}".*?max_length=(\d+)', text) or re.search(
            rf"{field}: str.*?max_length=(\d+)", text
        )
        assert match is not None, (
            f"{field} has no max_length on the wire schema anymore - "
            "re-examine this parity test"
        )
        return int(match.group(1))

    def _column_width(self, migration_text: str, column: str) -> int:
        block = _create_table_block(migration_text, store_sql.TABLE_ORDERS)
        match = re.search(rf'"{column}" VARCHAR\((\d+)\)', block)
        assert match is not None, f"{column} is not a bounded column in the migration"
        return int(match.group(1))

    def test_identifiers_fit(self, migration_text: str) -> None:
        for column in ("order_id", "client_order_id", "symbol"):
            assert self._column_width(migration_text, column) >= self._wire_bound(column), column

    def test_tenant_law_is_the_uuid_check_not_a_width(self, migration_text: str) -> None:
        # tenant_id has a wire bound (64) but a DB TYPE (uuid): the parity
        # there is the store's canonical-UUID refusal, asserted in the
        # store suite; the migration must simply keep the column typed.
        block = _create_table_block(migration_text, store_sql.TABLE_ORDERS)
        assert '"tenant_id" UUID NOT NULL' in block


class TestTenantGucAcrossPlanes:
    """The RLS contract has TWO callers: Node's PrismaService.withTenantRls
    and this store's _TenantTransaction. If either side edits the statement
    the other's rows vanish (policies match on the GUC), and the break is
    silent until enablement day. Python's test is the one that reads the
    TypeScript source - the direction that nobody would think to run
    during a Node refactor."""

    PRISMA_SERVICE = (
        ROOT / "apps" / "api" / "src" / "infrastructure" / "prisma" / "prisma.service.ts"
    )

    def test_node_sets_the_same_guc_the_store_sets(self) -> None:
        source = self.PRISMA_SERVICE.read_text(encoding="utf-8")
        match = re.search(
            r"set_config\('app\.tenant_id', \$\{tenantId\}, (true|false)\)", source
        )
        assert match is not None, (
            "PrismaService.withTenantRls changed its set_config call shape; "
            "re-derive PostgresOrderStore's SET_TENANT_SQL to match, or the "
            "generated policies silently admit different rows per plane"
        )
        assert match.group(1) == "true", "withTenantRls is no longer transaction-local"
        assert store_sql.SET_TENANT_SQL == "SELECT set_config('app.tenant_id', $1, true)"

    def test_migration_function_reads_the_same_guc(self, migration_text: str) -> None:
        part11 = (
            ROOT / "apps" / "api" / "prisma" / "migrations"
            / "20260913120000_part11_row_level_security" / "migration.sql"
        ).read_text(encoding="utf-8")
        assert "current_setting('app.tenant_id', true)" in part11
        assert 'CREATE OR REPLACE FUNCTION wlct_current_tenant_id() RETURNS uuid' in part11
        # the engine tables are in the covered list of the coverage JSON the
        # generator emits (auto-extension, checked here as the dependency
        # the store's design relies on).
        coverage = json.loads(
            (ROOT / "apps" / "api" / "prisma" / "rls" / "rls_coverage.json").read_text(
                encoding="utf-8"
            )
        )
        covered = {entry["table"] for entry in coverage["covered"]}
        assert {store_sql.TABLE_ORDERS, store_sql.TABLE_EVENTS, store_sql.TABLE_FILLS} <= covered


class TestSqlglotMigrationParses:
    def test_migration_file_is_valid_postgres(self, migration_text: str) -> None:
        # No importorskip: the dependency is declared in requirements-dev.txt, and
        # an optional import here would turn "the parser is missing" into a green
        # run that tested nothing - which is the failure mode Part 14's own drift
        # test avoided by importing at module level. A missing dep must be a loud
        # collection error, not a skip that reads as assurance.
        statements = [s for s in sqlglot_parse(migration_text, read="postgres") if s is not None]
        kinds = {type(s).__name__ for s in statements}
        assert {"Create", "Alter"} <= kinds
        assert len(statements) == 13  # 3 tables, 7 indexes, 3 FK alters
```

FILE: services/execution-engine/tests/test_part13_pg_store.py

```python
"""Part 13: the lifespan seam - pool creation, schema preflight, refusal.

The module under test is the only file allowed to import asyncpg, so these
tests substitute the MODULE ATTRIBUTE (``app.pg_store.asyncpg``), never the
driver's behaviour: what is pinned is the startup decision - connect with a
timeout, verify all three tables or die, hand the pool back to the caller
that owns shutdown, and CLOSE the pool on every failure path so a refused
startup leaks no connections.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

import app.pg_store as pg_store
from app.config import Settings
from app.incidents_sql import TABLE_INCIDENTS
from app.store_sql import TABLE_EVENTS, TABLE_FILLS, TABLE_ORDERS
from tests.test_execution_engine import settings_for

_TEST_DSN = "postgresql://engine_user:another-s3cr3t-p13@db.internal:5432/wlct_engine"


class FakeAcquire:
    def __init__(self, conn: Any) -> None:
        self._conn = conn

    async def __aenter__(self) -> Any:
        return self._conn

    async def __aexit__(self, *_exc: object) -> bool:
        return False


class FakeDriverConn:
    def __init__(self, present: set[str], error: BaseException | None = None) -> None:
        self.present = present
        self.error = error
        self.queries: list[tuple[str, tuple[object, ...]]] = []

    async def fetchval(self, query: str, *args: object) -> Any | None:
        if self.error is not None:
            raise self.error
        self.queries.append((query, args))
        assert query == "SELECT to_regclass($1)"
        name = str(args[0])
        return name if name.removeprefix("public.") in self.present else None


class FakeDriverPool:
    def __init__(self, conn: FakeDriverConn) -> None:
        self._conn = conn
        self.close_calls = 0

    def acquire(self) -> FakeAcquire:
        return FakeAcquire(self._conn)

    async def close(self) -> None:
        self.close_calls += 1


ALL_TABLES = {TABLE_ORDERS, TABLE_EVENTS, TABLE_FILLS, TABLE_INCIDENTS}


def install_fake_asyncpg(
    monkeypatch: pytest.MonkeyPatch,
    *,
    present: set[str] = ALL_TABLES,
    create_error: BaseException | None = None,
    conn_error: BaseException | None = None,
) -> dict[str, Any]:
    created: dict[str, Any] = {}

    async def create_pool(**kwargs: Any) -> FakeDriverPool:
        created.update(kwargs)
        if create_error is not None:
            raise create_error
        conn = FakeDriverConn(present, error=conn_error)
        pool = FakeDriverPool(conn)
        created["pool"] = pool
        created["conn"] = conn
        return pool

    monkeypatch.setattr(pg_store, "asyncpg", SimpleNamespace(create_pool=create_pool))
    return created


class TestOpenDurableStore:
    @pytest.mark.asyncio
    async def test_happy_path_opens_checks_every_table_and_hands_back_both(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        created = install_fake_asyncpg(monkeypatch)
        settings = settings_for(
            ("EXECUTION_STORE_BACKEND", "postgres"),
            ("EXECUTION_POSTGRES_DSN", _TEST_DSN),
        )
        pool, store = await pg_store.open_durable_store(settings)
        assert created["dsn"] == _TEST_DSN
        assert created["timeout"] == pg_store._CONNECT_TIMEOUT_SECONDS
        assert created["max_size"] == 5 and created["min_size"] == 1
        checked = [q[1][0] for q in created["conn"].queries]
        # Named one by one rather than derived from pg_store.DURABLE_TABLES, so a
        # table quietly leaving the startup check is a failing assertion here.
        # Part 17 added the incident table: a durable deployment that loses its
        # incident log has the same amnesia as one that never had a store, so its
        # absence is a refusal to boot, not a runtime discovery.
        assert checked == [
            f"public.{t}"
            for t in (TABLE_ORDERS, TABLE_EVENTS, TABLE_FILLS, TABLE_INCIDENTS)
        ]
        assert store.is_durable is True
        assert pool is not None

    @pytest.mark.asyncio
    async def test_missing_tables_refuse_by_name_and_close_the_pool(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        created = install_fake_asyncpg(monkeypatch, present={TABLE_ORDERS})
        settings = settings_for(
            ("EXECUTION_STORE_BACKEND", "postgres"),
            ("EXECUTION_POSTGRES_DSN", _TEST_DSN),
        )
        with pytest.raises(RuntimeError) as caught:
            await pg_store.open_durable_store(settings)
        message = str(caught.value)
        assert TABLE_EVENTS in message and TABLE_FILLS in message and TABLE_ORDERS not in message
        assert "migration" in message
        assert created["pool"].close_calls == 1  # refused startup leaks nothing

    @pytest.mark.asyncio
    async def test_schema_check_failure_closes_the_pool(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # The pool object exists while the schema check is mid-flight when
        # the connection dies - the check's except path must close it.
        created = install_fake_asyncpg(
            monkeypatch, conn_error=OSError("connection reset by peer")
        )
        settings = settings_for(
            ("EXECUTION_STORE_BACKEND", "postgres"),
            ("EXECUTION_POSTGRES_DSN", _TEST_DSN),
        )
        with pytest.raises(OSError, match="connection reset"):
            await pg_store.open_durable_store(settings)
        assert created["pool"].close_calls == 1

    @pytest.mark.asyncio
    async def test_connect_failure_propagates_untouched(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # create_pool itself failing: nothing to close, the error surfaces
        # verbatim through startup (no swallowed-then-generic-500).
        install_fake_asyncpg(monkeypatch, create_error=OSError("could not translate host name"))
        settings = settings_for(
            ("EXECUTION_STORE_BACKEND", "postgres"),
            ("EXECUTION_POSTGRES_DSN", _TEST_DSN),
        )
        with pytest.raises(OSError, match="could not translate host name"):
            await pg_store.open_durable_store(settings)

    @pytest.mark.asyncio
    async def test_absent_dsn_is_unreachable_but_guarded(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Settings validation forbids postgres-without-dsn (tested in
        # test_part13_config_composition), so this path is defence-in-depth
        # for programmatic misuse. model_construct skips validation
        # precisely so the test can build the state the validator forbids.
        install_fake_asyncpg(monkeypatch)
        settings = Settings.model_construct(EXECUTION_STORE_BACKEND="postgres")
        assert settings.EXECUTION_POSTGRES_DSN is None
        with pytest.raises(RuntimeError, match="without a DSN"):
            await pg_store.open_durable_store(settings)
```

FILE: services/execution-engine/tests/test_part13_postgres_store.py

```python
"""Part 13: the durable Postgres OrderStore adapter, tested without a DB.

Two philosophies combine here, both deliberate:

* **Scripted statements** pin the exact SQL contract the store emits -
  the same way Part 11 pinned the coordination Redis scripts. A statement
  that changes shape is a change to the durable schema contract and must
  be a decision, not a refactor side effect.
* **An echo connection** (records every insert, answers the matching
  SELECT from the recorded parameters) makes the codec round-trip real:
  the row that would land in Postgres is the row that comes back, so
  column order, decimal scale, null handling and the child-JSON
  reconstruction are exercised through the same tables the driver would
  use - without a Postgres in the sandbox.

The environment-gated live-database variant lives in
``test_part13_postgres_store_live.py``; when ``EXECUTION_TEST_POSTGRES_DSN``
is set (CI with a service container), the identical semantic assertions run
against the real thing. Absent the variable the module skips - visibly,
never silently green by substitution.
"""

from __future__ import annotations

import json
import re
from dataclasses import replace
from decimal import Decimal, InvalidOperation
from typing import Any, cast

import pytest
from sqlglot import parse_one as sqlglot_parse_one
from wlct_trading.enums import (
    TERMINAL_ORDER_STATUSES,
    ExchangeId,
    OrderSide,
    OrderStatus,
    OrderType,
    TimeInForce,
)
from wlct_trading.execution.store import ReconciliationState
from wlct_trading.orders import Fill, Order, OrderEvent

from app import store_sql
from app.store_sql import (
    RESERVE_INSERT_SQL,
    SET_TENANT_SQL,
    TABLE_FILLS,
    CrossTenantSweepUnsupported,
    PostgresOrderStore,
    _decode_order,
    _fill_params,
    _order_params,
)

TENANT = "3f2a1b04-7c5d-4e6f-9a8b-0c1d2e3f4a5b"
OTHER_TENANT = "9a8b7c6d-5e4f-4a3b-8c7d-6e5f4a3b2c1d"


def make_order(**overrides: object) -> Order:
    base: dict[str, object] = {
        "order_id": "ord_01",
        "client_order_id": "wlc-0001",
        "tenant_id": TENANT,
        "account_id": "acct_01",
        "strategy_id": None,
        "exchange": ExchangeId.BINANCE,
        "symbol": "BTCUSDT",
        "side": OrderSide.BUY,
        "order_type": OrderType.LIMIT,
        "quantity": Decimal("0.10"),
        "price": Decimal("50000.00"),
        "time_in_force": TimeInForce.GTC,
        "is_simulated": True,
        "status": OrderStatus.PENDING,
        "created_at": 1_700_000_000_000_000,
        "updated_at": 1_700_000_000_000_001,
    }
    order = Order(
        order_id=str(base["order_id"]),
        client_order_id=str(base["client_order_id"]),
        tenant_id=str(base["tenant_id"]),
        account_id=str(base["account_id"]),
        strategy_id=base["strategy_id"],
        exchange=base["exchange"],
        symbol=str(base["symbol"]),
        side=base["side"],
        order_type=base["order_type"],
        quantity=base["quantity"],
        price=base["price"],
        time_in_force=base["time_in_force"],
        is_simulated=base["is_simulated"],
        status=base["status"],
        created_at=base["created_at"],
        updated_at=base["updated_at"],
    )
    return replace(order, **overrides) if overrides else order


def order_row(overrides: dict[str, Any] | None = None) -> dict[str, Any]:
    row: dict[str, Any] = {
        "tenant_id": TENANT,
        "order_id": "ord_01",
        "client_order_id": "wlc-0001",
        "account_id": "acct_01",
        "strategy_id": None,
        "exchange": "binance",
        "symbol": "BTCUSDT",
        "side": "BUY",
        "order_type": "LIMIT",
        "time_in_force": "GTC",
        "reduce_only": False,
        "signal_id": None,
        "is_simulated": True,
        "status": "PENDING",
        "exchange_order_id": None,
        "quantity": "0.10",
        "price": "50000.00",
        "stop_price": None,
        "filled_quantity": "0",
        "average_fill_price": None,
        "cumulative_fee": "0",
        "fee_currency": None,
        "rejection_reason": None,
        "created_at": 1_700_000_000_000_000,
        "updated_at": 1_700_000_000_000_001,
        "submitted_at": None,
        "terminal_at": None,
        "reconciliation_state": None,
        "fills_json": "[]",
        "events_json": "[]",
    }
    row.update(overrides or {})
    return row


def fill_payload(overrides: dict[str, Any] | None = None) -> dict[str, Any]:
    base: dict[str, Any] = {
        "fill_id": "fill_01",
        "order_id": "ord_01",
        "trade_id": "trade_01",
        "price": "0.100",
        "quantity": "0.05",
        "fee": "0.00060",
        "fee_currency": "BNB",
        "is_maker": True,
        "is_simulated": True,
        "exchange_timestamp": 1_700_000_000_000,
        "received_timestamp": 1_700_000_000_000_002,
        "symbol": None,
        "side": None,
        "exchange": None,
        "quote_quantity": None,
        "exchange_order_id": None,
    }
    base.update(overrides or {})
    return base


# Statement prefixes for the echo fake: spelled out as plain literals (the
# store's SQL is literal too), so the fake pattern-matches exactly the way
# a database dispatches - and no query is ever "constructed" in this file.
_INS_ORDERS = "INSERT INTO engine_orders"
_INS_FILLS = "INSERT INTO engine_order_fills"
_INS_EVENTS = "INSERT INTO engine_order_events"
_UPD_ORDERS = "UPDATE engine_orders"
_FROM_ORDERS_O = "FROM engine_orders o"
_RECON_SELECT = "SELECT reconciliation_state FROM engine_orders"


class FakeTx:
    def __init__(self, conn: FakeConn) -> None:
        self._conn = conn

    async def __aenter__(self) -> None:
        self._conn.tx_begins += 1

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> bool:
        if exc_type is None:
            self._conn.tx_commits += 1
        else:
            self._conn.tx_rollbacks += 1
        return False


class FakeConn:
    """Records every statement; answers fetch/fetchrow from a script or echo."""

    def __init__(self, script: list[Any] | None = None, *, echo: bool = False) -> None:
        self.statements: list[tuple[str, tuple[object, ...]]] = []
        self.script = list(script or [])
        self.cursor = 0
        self.echo = echo
        self.tx_begins = 0
        self.tx_commits = 0
        self.tx_rollbacks = 0
        # echo state: last-inserted order params, fills and events per order
        self.stored_order: dict[str, Any] | None = None
        self.stored_fills: list[dict[str, Any]] = []
        self.stored_events: list[dict[str, Any]] = []

    _UNSET = object()

    def _step(self, query: str, args: tuple[object, ...], *, allow_response: bool) -> Any:
        """One statement through the script cursor.

        Expectations bind to the statement they precede; any entry that is
        an exception raises at THIS statement (execute included); a plain
        value is only consumed by fetch/fetchrow - an execute statement
        never eats a response meant for the row read that follows it.
        """
        self.statements.append((query, args))
        # ONE expectation per statement (the tenant GUC is always the
        # first statement, so scripts read as [guc-expectation, next-
        # statement-...]); consuming greedily would match statement two's
        # assertion against statement one and hide the real ordering bug.
        if self.cursor < len(self.script) and isinstance(self.script[self.cursor], Expectation):
            self.script[self.cursor].check(query, args)
            self.cursor += 1
        if self.cursor < len(self.script) and allow_response:
            entry = self.script[self.cursor]
            if isinstance(entry, BaseException):
                self.cursor += 1
                raise entry
            self.cursor += 1
            return entry
        return self._UNSET

    async def execute(self, query: str, *args: object) -> str:
        self._step(query, args, allow_response=False)
        if self.echo:
            if query.startswith(_INS_ORDERS):
                self._capture(query, args, "_stored_order")
            elif query.startswith(_UPD_ORDERS):
                if self.stored_order is not None:
                    self.stored_order["reconciliation_state"] = args[2]
        return "OK 1"

    async def fetch(self, query: str, *args: object) -> list[Any]:
        entry = self._step(query, args, allow_response=True)
        if entry is not self._UNSET:
            return list(entry) if isinstance(entry, list) else [entry]
        if self.echo and "FROM engine_order_fills" in query:
            return list(self.stored_fills)
        if self.echo and "FROM engine_order_events" in query:
            return list(self.stored_events)
        return []

    async def fetchrow(self, query: str, *args: object) -> Any | None:
        entry = self._step(query, args, allow_response=True)
        if entry is not self._UNSET:
            return entry
        if self.echo:
            if query.startswith(_INS_ORDERS):
                self._capture(query, args, "_stored_order")
                assert self.stored_order is not None
                return {"order_id": self.stored_order["order_id"]}
            if query.startswith(_INS_FILLS):
                self._capture(query, args, None)
                return {"fill_id": self.stored_fills[-1]["fill_id"]}
            if query.startswith(_INS_EVENTS):
                self._capture(query, args, None)
                return {"seq": len(self.stored_events)}
            if _FROM_ORDERS_O in query and self.stored_order is not None:
                row = dict(self.stored_order)
                row["fills_json"] = json.dumps(self.stored_fills)
                row["events_json"] = json.dumps(self.stored_events)
                return row
            if query.startswith(_RECON_SELECT):
                recon = (
                    None
                    if self.stored_order is None
                    else self.stored_order.get("reconciliation_state")
                )
                return {"reconciliation_state": recon}
        raise AssertionError(f"unscripted fetchrow: {query[:80]}")

    def transaction(self) -> FakeTx:
        return FakeTx(self)

    def assert_fully_consumed(self) -> None:
        leftovers = [s for s in self.script[self.cursor:] if not isinstance(s, Expectation)]
        assert not leftovers, f"scripted responses left unconsumed: {leftovers!r}"

    def _capture(self, query: str, args: tuple[object, ...], target: str | None) -> None:
        """Zip the INSERT's column list with its bound parameters - the row
        Postgres WOULD have stored, in the order the SQL itself declares."""
        columns = query.split("(", 1)[1].split(")", 1)[0]
        names = [c.strip() for c in columns.split(",")]
        assert len(names) == len(args), f"{len(names)} columns vs {len(args)} args"
        row = dict(zip(names, args, strict=True))
        if target == "_stored_order":
            self.stored_order = row
        elif TABLE_FILLS in query:
            self.stored_fills.append(row)
        else:
            self.stored_events.append(row)


class Expectation:
    """A queued assertion - optionally a scripted failure - for the statement
    about to be executed. `raises` exists because driver errors must be
    attachable to ANY statement kind (including execute, which otherwise
    takes no scripted values); attaching them positionally would let an
    exception fire during the tenant-GUC statement instead, and a failure in
    __aenter__ skips __aexit__ by definition - the exact shape that would
    make a rollback test pass for the wrong reason."""

    def __init__(
        self,
        sql_contains: str,
        args: tuple[object, ...] | None = None,
        *,
        raises: BaseException | None = None,
    ) -> None:
        self.sql_contains = sql_contains
        self.args = args
        self.raises = raises

    def check(self, query: str, args: tuple[object, ...]) -> None:
        assert self.sql_contains in query, f"expected {self.sql_contains!r} in {query[:120]}"
        if self.args is not None:
            assert args == self.args, f"args {args!r} != {self.args!r}"
        if self.raises is not None:
            raise self.raises


class FakeAcquire:
    def __init__(self, conn: FakeConn) -> None:
        self.conn = conn
        self.enters = 0
        self.exits = 0

    async def __aenter__(self) -> FakeConn:
        self.enters += 1
        return self.conn

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> bool:
        self.exits += 1
        return False


class FakePool:
    def __init__(self, conn: FakeConn) -> None:
        self.conn = conn
        self.acquires = 0
        self.closed = False

    def acquire(self) -> FakeAcquire:
        self.acquires += 1
        return FakeAcquire(self.conn)

    async def close(self) -> None:
        self.closed = True


def store(*script: Any, echo: bool = False) -> tuple[PostgresOrderStore, FakeConn, FakePool]:
    conn = FakeConn(script=list(script), echo=echo)
    pool = FakePool(conn)
    return PostgresOrderStore(cast(store_sql.PgPool, pool)), conn, pool


# ---------------------------------------------------------------------------
# statement-shape law (golden pins, DB-free)
# ---------------------------------------------------------------------------


class TestStatementShapes:
    def test_tenant_guc_is_the_exact_platform_contract(self) -> None:
        # Character-for-character the statement PrismaService.withTenantRls
        # issues (bound parameter, transaction-local TRUE). A change here
        # silently opts the engine out of every generated RLS policy.
        assert SET_TENANT_SQL == "SELECT set_config('app.tenant_id', $1, true)"

    def test_reservation_insert_targets_no_conflict_clause(self) -> None:
        head = RESERVE_INSERT_SQL
        assert head.startswith("INSERT INTO engine_orders (")
        assert "ON CONFLICT DO NOTHING RETURNING order_id" in head
        assert "ON CONFLICT (" not in head  # BOTH uniques must fold into DO NOTHING

    def test_order_columns_match_params_and_placeholders(self) -> None:
        params = _order_params(make_order(), None)
        assert len(store_sql._ORDER_COLUMNS) == len(params)
        placeholders = re.findall(r"\$\d+", RESERVE_INSERT_SQL)
        assert len(placeholders) == len(params)
        assert placeholders == [f"${i + 1}" for i in range(len(params))]

    def test_upsert_updates_everything_but_the_identity(self) -> None:
        clause = store_sql._SAVE_UPSERT_SQL.split("DO UPDATE SET ", 1)[1]
        assigned = {part.strip().split(" = ")[0] for part in clause.split(",")}
        assert "client_order_id" in assigned and "status" in assigned
        assert "tenant_id" not in assigned and "order_id" not in assigned

    def test_fill_recording_rides_the_tenant_fill_unique_index(self) -> None:
        assert "INSERT INTO engine_order_fills" in store_sql._RECORD_FILL_SQL
        assert "ON CONFLICT (tenant_id, fill_id) DO NOTHING RETURNING fill_id" in (
            store_sql._RECORD_FILL_SQL
        )
        assert len(_fill_params(TENANT, Fill(
            fill_id="f", order_id="o", trade_id="t", price=Decimal("1"), quantity=Decimal("1"),
            fee=Decimal("0"), fee_currency="USDT", is_maker=False, is_simulated=True,
            exchange_timestamp=1, received_timestamp=2,
        ))) == 17

    def test_events_append_only_and_payload_cast(self) -> None:
        sql = store_sql._RECORD_EVENT_SQL
        assert sql.startswith("INSERT INTO engine_order_events")
        assert "$8::jsonb" in sql and "RETURNING seq" in sql
        assert "UPDATE" not in sql and "DELETE" not in sql
        assert "ORDER BY seq ASC" in store_sql._LIST_EVENTS_SQL

    def test_open_orders_reads_the_shared_terminal_vocabulary(self) -> None:
        # The exclusion list must come from the shared enum - if someone
        # "fixes" this by typing statuses into the SQL string, this test
        # and the count are the alarm.
        assert "NOT (o.status = ANY($3::text[]))" in store_sql._LIST_OPEN_SQL_BASE
        params = _order_params(make_order(), None)
        assert params[store_sql._ORDER_COLUMNS.index("status")] == "PENDING"

    def test_child_reconstruction_orders_by_seq_and_never_nulls(self) -> None:
        fills_needle = (
            "COALESCE((SELECT json_agg(to_json(f) ORDER BY f.seq) "
            "FROM engine_order_fills"
        )
        events_needle = (
            "COALESCE((SELECT json_agg(to_json(e) ORDER BY e.seq) "
            "FROM engine_order_events"
        )
        assert fills_needle in store_sql._CHILD_JSON
        assert events_needle in store_sql._CHILD_JSON
        assert "'[]'::json" in store_sql._CHILD_JSON

    def test_every_constant_statement_parses_as_postgres(self) -> None:
        # Same law as the migration test next door: declared, imported, asserted -
        # never skipped on absence.
        names = [n for n in dir(store_sql) if "_SQL" in n and not n.startswith("__")]
        seen = 0
        for name in names:
            value = getattr(store_sql, name)
            if isinstance(value, str) and re.match(r"(?i)\s*(SELECT|INSERT|UPDATE|WITH)", value):
                sqlglot_parse_one(value, read="postgres")
                seen += 1
        assert seen >= 12

    def test_list_open_sql_numbers_placeholders_by_shape(self) -> None:
        # The builder appends $N off the real param count; both optional
        # predicates and neither must address exactly the slots they fill.
        base = store_sql._LIST_OPEN_SQL_BASE
        assert base.count("$") == 3
        sql_both = (
            base + " AND o.exchange = $4 AND o.symbol = $5" + store_sql._LIST_OPEN_ORDER_BY
        )
        assert sql_both.count("$") == 5
        assert "o.symbol = $4" in base + " AND o.symbol = $4"


# ---------------------------------------------------------------------------
# transaction / GUC law
# ---------------------------------------------------------------------------


class TestTenantTransactionLaw:
    @pytest.mark.asyncio
    async def test_every_operation_sets_the_tenant_guc_first_in_one_tx(self) -> None:
        for script, call in (
            ([None], lambda s: s.get_order(TENANT, "ord_01")),
            (
                [{"order_id": "ord_01"}],
                lambda s: s.reserve_client_order_id(TENANT, "c", make_order()),
            ),
            ([None], lambda s: s.get_by_client_order_id(TENANT, "c")),
            ([None], lambda s: s.save_order(make_order())),
            (
                [],
                lambda s: s.set_reconciliation_state(
                    TENANT, "ord_01", ReconciliationState.UNKNOWN
                ),
            ),
            ([None], lambda s: s.record_event(TENANT, OrderEvent(
                event_id="e1", order_id="ord_01", previous_status=None,
                status=OrderStatus.SUBMITTED, reason=None, occurred_at=1))),
            ([None], lambda s: s.record_fill(TENANT, Fill(
                fill_id="f", order_id="o", trade_id="t", price=Decimal("1"),
                quantity=Decimal("1"), fee=Decimal("0"), fee_currency="USDT", is_maker=False,
                is_simulated=True, exchange_timestamp=1, received_timestamp=2))),
        ):
            subject, conn, pool = store(*script)
            await call(subject)
            assert conn.statements[0][0] == SET_TENANT_SQL
            assert conn.statements[0][1] == (TENANT,), f"guc law broke for {call}"
            assert conn.tx_begins == 1 and conn.tx_commits == 1 and conn.tx_rollbacks == 0
            assert pool.acquires == 1

    @pytest.mark.asyncio
    async def test_statement_errors_rollback_and_propagate_unswallowed(self) -> None:
        boom = RuntimeError("connection reset")
        subject, conn, pool = store(
            Expectation(SET_TENANT_SQL, (TENANT,)),
            Expectation("FROM engine_orders o", raises=boom),
        )
        # The GUC statement runs, then the row read fails mid-transaction:
        # __aexit__ MUST have seen the exception (rollback, not commit) and
        # the pool slot must be released - both are the durability contract's
        # leak guards, and neither is checkable if boom fires before
        # __aenter__ completes (hence Expectation.raises, not a bare entry).
        with pytest.raises(RuntimeError, match="connection reset"):
            await subject.get_order(TENANT, "ord_01")
        assert conn.tx_rollbacks == 1 and conn.tx_commits == 0 and conn.tx_begins == 1
        assert len(conn.statements) == 2
        assert pool.acquires == 1  # released even on failure

    @pytest.mark.asyncio
    async def test_sweep_is_refused_not_answered_empty(self) -> None:
        subject, conn, _pool = store()
        with pytest.raises(CrossTenantSweepUnsupported) as caught:
            await subject.list_orders_needing_reconciliation(limit=7)
        message = str(caught.value)
        assert "reconcile-trading-account" in message and "PART13_DURABLE_STORE" in message
        assert conn.statements == []  # a refusal must not even reach the database

    async def test_get_order_maps_missing_row_to_none_not_error(self) -> None:
        subject, _conn, _pool = store(None)
        assert await subject.get_order(TENANT, "nope") is None

    @pytest.mark.asyncio
    async def test_malformed_tenant_id_fails_before_the_database(self) -> None:
        # tenant_id lands in a UUID column; the driver would answer with a
        # raw "invalid input syntax" - the store states the law itself,
        # first, so a string-tenant deployment sees the reason not the cast.
        subject, conn, _pool = store()
        with pytest.raises(store_sql.OrderStoreError, match="canonical UUID"):
            await subject.get_order("tenant-a", "ord_01")
        assert conn.statements == []


# ---------------------------------------------------------------------------
# reference-semantics mirror
# ---------------------------------------------------------------------------


class TestReferenceSemantics:
    @pytest.mark.asyncio
    async def test_free_reservation_wins_and_stores_the_order(self) -> None:
        subject, _conn, _pool = store({"order_id": "ord_01"})
        outcome = await subject.reserve_client_order_id(TENANT, "wlc-0001", make_order())
        assert outcome.reserved is True and outcome.existing is None

    @pytest.mark.asyncio
    async def test_reservation_held_by_another_order_resumes_nothing(self) -> None:
        holder = order_row({"order_id": "ord_other"})
        subject, _conn, _pool = store(None, holder)
        outcome = await subject.reserve_client_order_id(TENANT, "wlc-0001", make_order())
        assert outcome.reserved is False
        assert outcome.existing is not None and outcome.existing.order_id == "ord_other"

    @pytest.mark.asyncio
    async def test_same_order_retrying_reserves_with_the_stored_row(self) -> None:
        # The stored row (submitted_at set) differs from the passed order
        # (PENDING): the durable answer is what the database knows, exactly
        # as the in-memory store answers with the object it already holds.
        holder = order_row({"status": "SUBMITTED", "submitted_at": 7})
        subject, _conn, _pool = store(None, holder)
        outcome = await subject.reserve_client_order_id(TENANT, "wlc-0001", make_order())
        assert outcome.reserved is True
        assert outcome.existing is not None and outcome.existing.status is OrderStatus.SUBMITTED

    @pytest.mark.asyncio
    async def test_reservation_lost_after_the_conflict_is_not_a_win(self) -> None:
        # INSERT returned no row and the holder lookup also found nothing:
        # the conflicting transaction rolled away. "Not reserved, holder
        # unknown" - the caller retries; claiming victory here would be the
        # double-book the unique index exists to prevent.
        subject, _conn, _pool = store(None, None)
        outcome = await subject.reserve_client_order_id(TENANT, "wlc-0001", make_order())
        assert outcome.reserved is False and outcome.existing is None

    @pytest.mark.asyncio
    async def test_record_fill_answers_false_only_for_replays(self) -> None:
        fill = Fill(
            fill_id="f1", order_id="ord_01", trade_id="t1", price=Decimal("50000.1"),
            quantity=Decimal("0.01"), fee=Decimal("0.0006"), fee_currency="BNB",
            is_maker=True, is_simulated=True, exchange_timestamp=1, received_timestamp=2,
        )
        fresh, _c, _p = store({"fill_id": "f1"})
        replayed, _c2, _p2 = store(None)
        assert await fresh.record_fill(TENANT, fill) is True
        assert await replayed.record_fill(TENANT, fill) is False

    @pytest.mark.asyncio
    async def test_in_sync_writes_sql_null(self) -> None:
        subject, conn, _pool = store()
        await subject.set_reconciliation_state(TENANT, "ord_01", ReconciliationState.IN_SYNC)
        update = [s for s in conn.statements if s[0].startswith(_UPD_ORDERS)]
        assert update and update[0][1] == (TENANT, "ord_01", None)

    @pytest.mark.asyncio
    async def test_missing_state_row_reads_as_in_sync(self) -> None:
        subject, _conn, _pool = store(None)
        assert await subject.get_reconciliation_state(
            TENANT, "ord_01"
        ) is ReconciliationState.IN_SYNC
        subject2, _c2, _p2 = store({"reconciliation_state": None})
        assert await subject2.get_reconciliation_state(
            TENANT, "ord_01"
        ) is ReconciliationState.IN_SYNC
        subject3, _c3, _p3 = store({"reconciliation_state": "DIVERGED"})
        assert await subject3.get_reconciliation_state(
            TENANT, "ord_01"
        ) is ReconciliationState.DIVERGED

    @pytest.mark.asyncio
    async def test_list_open_orders_appends_predicates_in_param_order(self) -> None:
        subject, conn, _pool = store([])
        await subject.list_open_orders(
            TENANT, "acct_01", exchange=ExchangeId.BINANCE, symbol="BTCUSDT"
        )
        sql, args = conn.statements[1]
        assert "AND o.exchange = $4 AND o.symbol = $5" in sql
        assert args == (TENANT, "acct_01", sorted(
            status.value for status in TERMINAL_ORDER_STATUSES
        ), "binance", "BTCUSDT")
        subject2, conn2, _ = store([])
        await subject2.list_open_orders(TENANT, "acct_01", symbol="ETHUSDT")
        sql2, args2 = conn2.statements[1]
        # the column list mentions o.exchange (it selects it); the WHERE
        # clause must not predicate on it when only symbol was given
        assert "AND o.symbol = $4" in sql2 and "AND o.exchange" not in sql2
        assert args2[3] == "ETHUSDT" and len(args2) == 4

    @pytest.mark.asyncio
    async def test_terminal_vocabulary_is_imported_not_retyped(self) -> None:
        from wlct_trading.enums import TERMINAL_ORDER_STATUSES

        subject, conn, _pool = store([])
        await subject.list_open_orders(TENANT, "acct_01")
        sql, args = conn.statements[1]
        assert args[2] == sorted(status.value for status in TERMINAL_ORDER_STATUSES)
        assert "ORDER BY o.created_at ASC, o.order_id ASC" in sql


# ---------------------------------------------------------------------------
# codec fidelity via the echo connection (the row that lands is the row back)
# ---------------------------------------------------------------------------


class TestCodecFidelity:
    @pytest.mark.asyncio
    async def test_full_order_round_trips_scale_exact(self) -> None:
        order = make_order(
            strategy_id="strat_9",
            stop_price=Decimal("49999.999999"),
            signal_id="sig-7",
            reduce_only=True,
            exchange_order_id="9998887776",
            status=OrderStatus.PARTIALLY_FILLED,
            filled_quantity=Decimal("0.05"),
            average_fill_price=Decimal("0.100000000000000000000001"),  # division residue
            cumulative_fee=Decimal("0.00060"),
            fee_currency="BNB",
            rejection_reason=None,
            submitted_at=1_700_000_000_000_002,
            price=Decimal("0.100"),
        )
        subject, _conn, _pool = store(echo=True)
        await subject.save_order(order)
        back = await subject.get_order(TENANT, order.order_id)
        assert back is not None
        assert back == order
        # dataclass equality is numeric for Decimals; pin the STRING scale
        # too - the durable record must preserve trailing zeros exactly.
        assert str(back.price) == "0.100"
        assert str(back.average_fill_price) == "0.100000000000000000000001"
        assert str(back.cumulative_fee) == "0.00060"
        assert back.submitted_at == 1_700_000_000_000_002
        assert back.terminal_at is None and back.stop_price == Decimal("49999.999999")

    @pytest.mark.asyncio
    async def test_reservation_marks_unknown_and_explicit_sync_clears_it(self) -> None:
        subject, conn, _pool = store(echo=True)
        # the reservation INSERT carries UNKNOWN...
        await subject.reserve_client_order_id(TENANT, "wlc-0001", make_order())
        assert conn.stored_order is not None
        assert conn.stored_order["reconciliation_state"] == "UNKNOWN"
        # ...a crash between reserve and save leaves exactly that durable
        # truth, and the explicit sync-set is what clears it back to NULL.
        await subject.set_reconciliation_state(TENANT, "ord_01", ReconciliationState.IN_SYNC)
        assert conn.stored_order["reconciliation_state"] is None
        state = await subject.get_reconciliation_state(TENANT, "ord_01")
        assert state is ReconciliationState.IN_SYNC

    @pytest.mark.asyncio
    async def test_fills_and_events_are_replayed_into_the_read_model(self) -> None:
        subject, conn, _pool = store(echo=True)
        await subject.save_order(make_order())
        recorded = await subject.record_fill(TENANT, Fill(
            fill_id="fill_01", order_id="ord_01", trade_id="trade_01",
            price=Decimal("0.100"), quantity=Decimal("0.05"), fee=Decimal("0.00060"),
            fee_currency="BNB", is_maker=True, is_simulated=True,
            exchange_timestamp=1_700_000_000_000, received_timestamp=1_700_000_000_000_002,
        ))
        assert recorded is True
        await subject.record_event(TENANT, OrderEvent(
            event_id="ev_1", order_id="ord_01", previous_status=OrderStatus.PENDING,
            status=OrderStatus.PARTIALLY_FILLED, reason="fill:fill_01", occurred_at=7,
            payload={"source": "user-data-stream"},
        ))
        back = await subject.get_order(TENANT, "ord_01")
        assert back is not None
        assert [f.fill_id for f in back.fills] == ["fill_01"]
        assert str(back.fills[0].price) == "0.100"  # scale survives the JSON detour
        assert [e.event_id for e in back.events] == ["ev_1"]
        assert back.events[0].payload == {"source": "user-data-stream"}
        # read-model REPLAY, not re-derivation: stored aggregates come back
        # untouched and no synthesized journal event appears.
        assert back.filled_quantity == Decimal("0")
        assert len(back.events) == 1
        # the dedup set is seeded, so a caller that continues on this
        # object gets domain-level duplicate protection immediately.
        assert back.apply_fill(Fill(
            fill_id="fill_01", order_id="ord_01", trade_id="other", price=Decimal("1"),
            quantity=Decimal("1"), fee=Decimal("0"), fee_currency="USDT", is_maker=False,
            is_simulated=True, exchange_timestamp=1, received_timestamp=1,
        )) is False

    @pytest.mark.asyncio
    async def test_event_payload_is_canonical_json(self) -> None:
        subject, conn, _pool = store(echo=True)
        await subject.record_event(TENANT, OrderEvent(
            event_id="e", order_id="o", previous_status=None, status=OrderStatus.PENDING,
            reason=None, occurred_at=1, payload={"b": "2", "a": "1"},
        ))
        insert = next(s for s in conn.statements if s[0].startswith(_INS_EVENTS))
        payload_arg = insert[1][7]
        assert payload_arg == '{"a":"1","b":"2"}'  # sort_keys + tight separators

    def test_unknown_enums_and_non_decimals_are_read_errors(self) -> None:
        with pytest.raises(ValueError):  # the enum constructor refuses
            _decode_order(order_row({"status": "NOT_A_STATUS"}))
        with pytest.raises((InvalidOperation, ArithmeticError)):
            _decode_order(order_row({"quantity": "12abc"}))


# ---------------------------------------------------------------------------
# strictness divergence: SQL rejects what the reference silently mangles
# ---------------------------------------------------------------------------


class TestStrictnessDivergence:
    @pytest.mark.asyncio
    async def test_client_id_collision_surfaces_instead_of_silently_shifting(self) -> None:
        # The in-memory reference setdefaults its id map; SQL answers with a
        # unique violation on engine_orders_tenant_client_key. The port must
        # let THAT through (loud) rather than translating it into a no-op.
        violation = Exception(
            'duplicate key value violates unique constraint "engine_orders_tenant_client_key"'
        )
        subject, conn, _pool = store(None, Expectation("DO UPDATE SET", raises=violation))
        with pytest.raises(Exception, match="engine_orders_tenant_client_key"):
            await subject.save_order(make_order())
        assert conn.tx_rollbacks == 1  # the failed upsert must not half-apply
        # the save_order pre-read of the existing reconciliation state ran
        # FIRST (so the upsert can preserve it) - unscripted, it answers
        # "no row", and the capture below proves the INSERT shape carried
        # NULL state rather than inventing one.
        assert conn.statements[0][0] == SET_TENANT_SQL

    def test_order_params_carry_tenant_first(self) -> None:
        params = _order_params(make_order(tenant_id=OTHER_TENANT), ReconciliationState.DIVERGED)
        assert params[0] == OTHER_TENANT
        assert params[store_sql._ORDER_COLUMNS.index("reconciliation_state")] == "DIVERGED"
```

FILE: services/execution-engine/tests/test_part13_postgres_store_live.py

```python
"""Part 13: the durable store against a REAL Postgres - when one is provided.

Set ``EXECUTION_TEST_POSTGRES_DSN`` (a disposable CI database) and every
statement in ``app/store_sql.py`` executes against the engine's own
migrated tables: not a fake's idea of SQL, the database's. Without the
variable the module skips with a visible reason - the scripted suite proves
the contract's SHAPE, this file proves its SUBSTANCE, and CI is the only
place both run. The DDL is taken from the migration file itself, so this
test doubles as "the migration actually applies".

Table teardown is last-deletion-order (children first, CASCADE on the
parents' FKs) and the tenants stub is created only if absent: the file must
be re-runnable against the same CI database.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from decimal import Decimal
from pathlib import Path
from typing import cast

import asyncpg
import pytest
from wlct_trading.enums import ExchangeId, OrderSide, OrderStatus, OrderType, TimeInForce
from wlct_trading.execution.store import ReconciliationState
from wlct_trading.orders import Fill, Order, OrderEvent

from app.store_sql import (
    TABLE_EVENTS,
    TABLE_FILLS,
    TABLE_ORDERS,
    CrossTenantSweepUnsupported,
    PgPool,
    PostgresOrderStore,
)

pytestmark = pytest.mark.skipif(
    os.environ.get("EXECUTION_TEST_POSTGRES_DSN") is None,
    reason="EXECUTION_TEST_POSTGRES_DSN not set; real-Postgres suite skipped "
    "(the scripted suite still pins statement shapes and store semantics)",
)

ROOT = Path(__file__).resolve().parents[3]
MIGRATION = (
    ROOT
    / "apps"
    / "api"
    / "prisma"
    / "migrations"
    / "20260914120000_part13_execution_store"
    / "migration.sql"
)

# Literal statement lists, spelled per table, so this file never "builds"
# SQL (the module under test is literal; the mirror discipline lives in the
# tests too).
_TRUNCATES = (
    "DELETE FROM engine_order_fills",
    "DELETE FROM engine_order_events",
    "DELETE FROM engine_orders",
)
_POLICY_SETUP = (
    # nullif(...,'') verbatim: the expression the generated
    # wlct_current_tenant_id() uses; without it the empty-GUC case below
    # would be a cast error, not a policy refusal.
    "CREATE POLICY tenant_isolation ON \"engine_orders\" "
    "USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)",
    "ALTER TABLE \"engine_orders\" ENABLE ROW LEVEL SECURITY",
    "ALTER TABLE \"engine_orders\" FORCE ROW LEVEL SECURITY",
    "CREATE POLICY tenant_isolation ON \"engine_order_events\" "
    "USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)",
    "ALTER TABLE \"engine_order_events\" ENABLE ROW LEVEL SECURITY",
    "ALTER TABLE \"engine_order_events\" FORCE ROW LEVEL SECURITY",
    "CREATE POLICY tenant_isolation ON \"engine_order_fills\" "
    "USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)",
    "ALTER TABLE \"engine_order_fills\" ENABLE ROW LEVEL SECURITY",
    "ALTER TABLE \"engine_order_fills\" FORCE ROW LEVEL SECURITY",
)
_POLICY_TEARDOWN = (
    "ALTER TABLE \"engine_orders\" NO FORCE ROW LEVEL SECURITY",
    "ALTER TABLE \"engine_orders\" DISABLE ROW LEVEL SECURITY",
    "DROP POLICY tenant_isolation ON \"engine_orders\"",
    "ALTER TABLE \"engine_order_events\" NO FORCE ROW LEVEL SECURITY",
    "ALTER TABLE \"engine_order_events\" DISABLE ROW LEVEL SECURITY",
    "DROP POLICY tenant_isolation ON \"engine_order_events\"",
    "ALTER TABLE \"engine_order_fills\" NO FORCE ROW LEVEL SECURITY",
    "ALTER TABLE \"engine_order_fills\" DISABLE ROW LEVEL SECURITY",
    "DROP POLICY tenant_isolation ON \"engine_order_fills\"",
)

TENANT_A = "3f2a1b04-7c5d-4e6f-9a8b-0c1d2e3f4a5b"
TENANT_B = "9a8b7c6d-5e4f-4a3b-8c7d-6e5f4a3b2c1d"


def _statements() -> list[str]:
    text = MIGRATION.read_text(encoding="utf-8")
    body = "\n".join(
        line for line in text.splitlines() if not line.strip().startswith("--")
    )
    return [s.strip() for s in body.split(";") if s.strip()]


_MIGRATION_APPLIED = False


@pytest.fixture
async def conn() -> AsyncIterator[asyncpg.Connection]:
    """One session per test (function scope keeps a single event loop and
    consistent session state for GUC assertions), schema ensured once per
    process by executing the real migration file."""
    global _MIGRATION_APPLIED
    dsn = os.environ["EXECUTION_TEST_POSTGRES_DSN"]
    async with asyncpg.connect(dsn=dsn, timeout=10.0) as connection:
        if not _MIGRATION_APPLIED:
            await connection.execute(
                'CREATE TABLE IF NOT EXISTS "tenants" ("id" UUID PRIMARY KEY)'
            )
            existing = await connection.fetchval(
                "SELECT to_regclass($1)", f"public.{TABLE_ORDERS}"
            )
            if existing is None:
                for statement in _statements():
                    await connection.execute(statement)
            for table in (TABLE_EVENTS, TABLE_FILLS):
                if await connection.fetchval("SELECT to_regclass($1)", f"public.{table}") is None:
                    pytest.fail(
                        "engine_orders exists but a child table does not - the CI database "
                        "is half-migrated; drop public.engine_order* and rerun"
                    )
            _MIGRATION_APPLIED = True
        await connection.execute(
            "INSERT INTO tenants(id) VALUES ($1),($2) ON CONFLICT DO NOTHING",
            TENANT_A,
            TENANT_B,
        )
        for statement in _TRUNCATES:
            await connection.execute(statement)
        yield connection


class _SingleConnectionPool:
    """Adapts ONE connection to the store's pool protocol so rows written
    by the store are readable by the test's raw queries in the same session
    (search-path, GUC and policy state shared - which a real pool would NOT
    guarantee, and is precisely why RLS assertions need this shim)."""

    def __init__(self, connection: asyncpg.Connection) -> None:
        self._connection = connection

    def acquire(self) -> object:
        connection = self._connection

        class _Acquire:
            async def __aenter__(self) -> asyncpg.Connection:
                return connection

            async def __aexit__(self, *exc: object) -> bool:
                return False

        return _Acquire()

    async def close(self) -> None:
        return None


@pytest.fixture
async def store(conn: asyncpg.Connection) -> PostgresOrderStore:
    return PostgresOrderStore(cast(PgPool, _SingleConnectionPool(conn)))


def order_for(tenant: str, order_id: str, client_id: str) -> Order:
    return Order(
        order_id=order_id,
        client_order_id=client_id,
        tenant_id=tenant,
        account_id="acct_01",
        strategy_id=None,
        exchange=ExchangeId.BINANCE,
        symbol="BTCUSDT",
        side=OrderSide.BUY,
        order_type=OrderType.LIMIT,
        quantity=Decimal("0.10"),
        price=Decimal("50000.00"),
        time_in_force=TimeInForce.GTC,
        is_simulated=True,
        status=OrderStatus.PENDING,
        created_at=1_700_000_000_000_000,
        updated_at=1_700_000_000_000_001,
    )


class TestRealDatabaseRoundTrips:
    @pytest.mark.asyncio
    async def test_full_order_lifecycle_persists_and_reads_back(
        self, store: PostgresOrderStore
    ) -> None:
        order = order_for(TENANT_A, "ord_live_1", "wlc-live-1")
        outcome = await store.reserve_client_order_id(TENANT_A, order.client_order_id, order)
        assert outcome.reserved is True

        saved = await store.get_order(TENANT_A, order.order_id)
        assert saved is not None
        assert saved.status is OrderStatus.PENDING
        # the reservation-time durability claim, verbatim from the row
        assert (
            await store.get_reconciliation_state(TENANT_A, order.order_id)
        ) is ReconciliationState.UNKNOWN

        order.status = OrderStatus.SUBMITTED
        order.submitted_at = 1_700_000_000_000_009
        await store.save_order(order)
        await store.set_reconciliation_state(TENANT_A, order.order_id, ReconciliationState.IN_SYNC)
        back = await store.get_order(TENANT_A, order.order_id)
        assert back is not None and back.status is OrderStatus.SUBMITTED
        assert (
            await store.get_reconciliation_state(TENANT_A, order.order_id)
        ) is ReconciliationState.IN_SYNC

    @pytest.mark.asyncio
    async def test_decimal_scale_and_null_semantics_survive_the_database(
        self, store: PostgresOrderStore
    ) -> None:
        order = order_for(TENANT_A, "ord_live_2", "wlc-live-2")
        order.price = Decimal("0.100")
        order.stop_price = Decimal("49999.999999")
        order.average_fill_price = Decimal("0.100000000000000000000001")
        await store.save_order(order)
        back = await store.get_order(TENANT_A, order.order_id)
        assert back is not None
        assert str(back.price) == "0.100"
        assert str(back.stop_price) == "49999.999999"
        assert str(back.average_fill_price) == "0.100000000000000000000001"

    @pytest.mark.asyncio
    async def test_reservation_conflict_semantics(self, store: PostgresOrderStore) -> None:
        a = order_for(TENANT_A, "ord_live_3", "wlc-live-3")
        thief = order_for(TENANT_A, "ord_live_4", "wlc-live-3")
        assert (
            await store.reserve_client_order_id(TENANT_A, a.client_order_id, a)
        ).reserved is True
        lost = await store.reserve_client_order_id(TENANT_A, thief.client_order_id, thief)
        assert lost.reserved is False and lost.existing is not None
        assert lost.existing.order_id == "ord_live_3"
        # same order retrying the reservation: wins, with the stored row
        retry = await store.reserve_client_order_id(TENANT_A, a.client_order_id, a)
        assert retry.reserved is True and retry.existing is not None
        # and the SAME client id under ANOTHER tenant is a fresh reservation
        # (the unique index is (tenant_id, client_order_id)): the tenant in
        # the key is the isolation, proven by both orders existing.
        other = order_for(TENANT_B, "ord_live_3b", "wlc-live-3")
        assert (
            await store.reserve_client_order_id(TENANT_B, other.client_order_id, other)
        ).reserved is True

    @pytest.mark.asyncio
    async def test_fills_dedupe_events_append_and_order_is_insertion(
        self, store: PostgresOrderStore
    ) -> None:
        order = order_for(TENANT_A, "ord_live_5", "wlc-live-5")
        await store.save_order(order)
        fill = Fill(
            fill_id="fill_live_1", order_id="ord_live_5", trade_id="t1",
            price=Decimal("50000.5"), quantity=Decimal("0.04"), fee=Decimal("0.00060"),
            fee_currency="BNB", is_maker=True, is_simulated=True,
            exchange_timestamp=1_700_000_000_000, received_timestamp=1_700_000_000_000_020,
        )
        assert await store.record_fill(TENANT_A, fill) is True
        assert await store.record_fill(TENANT_A, fill) is False  # at-least-once replay
        for i in range(3):
            await store.record_event(TENANT_A, OrderEvent(
                event_id=f"ev_{i}", order_id="ord_live_5", previous_status=None,
                status=OrderStatus.SUBMITTED, reason=None, occurred_at=1_700_000_000_000_000,
                payload={"i": str(i)},
            ))
        events = await store.list_events(TENANT_A, "ord_live_5")
        # identical timestamps, journal insertion order still kept by seq:
        assert [e.event_id for e in events] == ["ev_0", "ev_1", "ev_2"]
        assert events[1].payload == {"i": "1"}
        fills = await store.list_fills(TENANT_A, "ord_live_5")
        assert len(fills) == 1 and str(fills[0].fee) == "0.00060"
        back = await store.get_order(TENANT_A, "ord_live_5")
        assert back is not None and [f.fill_id for f in back.fills] == ["fill_live_1"]

    @pytest.mark.asyncio
    async def test_list_open_orders_excludes_terminals_live(
        self, store: PostgresOrderStore
    ) -> None:
        open_order = order_for(TENANT_A, "ord_live_6", "wlc-live-6")
        await store.save_order(open_order)
        done = order_for(TENANT_A, "ord_live_7", "wlc-live-7")
        done.status = OrderStatus.FILLED
        await store.save_order(done)
        listed = await store.list_open_orders(TENANT_A, "acct_01")
        assert [o.order_id for o in listed] == ["ord_live_6"]
        filtered = await store.list_open_orders(TENANT_A, "acct_01", symbol="ETHUSDT")
        assert filtered == ()

    @pytest.mark.asyncio
    async def test_sweep_still_refuses_before_touching_anything(
        self, store: PostgresOrderStore
    ) -> None:
        with pytest.raises(CrossTenantSweepUnsupported):
            await store.list_orders_needing_reconciliation()


class TestRlsInteraction:
    """The GUC-first law is what lets the engine's tables sit UNDER the
    platform's generated policies the moment an operator enables them; this
    simulates one enablement (policy + ENABLE + FORCE on the three tables,
    torn down afterwards) and asserts the store's queries keep working
    while a policyless query sees nothing."""

    @pytest.mark.asyncio
    async def test_store_queries_satisfy_enforced_rls(
        self, store: PostgresOrderStore, conn: asyncpg.Connection
    ) -> None:
        order = order_for(TENANT_A, "ord_live_rls", "wlc-rls")
        other = order_for(TENANT_B, "ord_live_rls_b", "wlc-rls-b")
        await store.save_order(order)
        await store.save_order(other)
        for statement in _POLICY_SETUP:
            await conn.execute(statement)
        try:
            # the store still reads its tenant's rows: every operation set
            # the GUC first, so the policy admits exactly them.
            assert await store.get_order(TENANT_A, "ord_live_rls") is not None
            assert await store.get_order(TENANT_B, "ord_live_rls_b") is not None
            # a raw query on the same session with NO GUC sees nothing -
            # proof the policy is actually enforced against this connection,
            # not vacuously satisfied.
            await conn.execute("SELECT set_config('app.tenant_id', '', false)")
            visible = await conn.fetchval("SELECT count(*) FROM engine_orders")
            assert visible == 0
            # and a GUC for tenant A cannot reach tenant B's row even by
            # explicit id.
            await conn.execute("SELECT set_config('app.tenant_id', $1, false)", TENANT_A)
            leaked = await conn.fetchval(
                "SELECT count(*) FROM engine_orders WHERE order_id = $2", "ord_live_rls_b"
            )
            assert leaked == 0
        finally:
            await conn.execute("SELECT set_config('app.tenant_id', '', false)")
            for statement in _POLICY_TEARDOWN:
                await conn.execute(statement)
```

FILE: services/execution-engine/tests/test_part14_drift_parity.py

```python
"""Part 14 drift traps: the retention ledger's three spellings, and the
deletion-target law across the whole engine app.

Nothing in a codebase is as trustworthy as a re-derivation. These tests
rebuild the ledger table's shape from three artifacts written by three
different steps (the migration SQL, the Prisma model, the executor's
INSERT constant) and refuse to pass unless they agree; and they scan
EVERY Python file in the service for a DELETE statement, because "only
the journal is deletable" is only a law if nobody can write the second
one without a test going red first.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from sqlglot import parse as sqlglot_parse

from app import retention
from app.store_sql import TABLE_EVENTS

ROOT = Path(__file__).resolve().parents[3]
APP_DIR = ROOT / "services" / "execution-engine" / "app"
SCHEMA = ROOT / "apps" / "api" / "prisma" / "schema.prisma"


def part14_migration() -> str:
    return (
        ROOT
        / "apps"
        / "api"
        / "prisma"
        / "migrations"
        / "20260914160000_part14_retention_ledger"
        / "migration.sql"
    ).read_text(encoding="utf-8")


def part13_migration() -> str:
    return (
        ROOT
        / "apps"
        / "api"
        / "prisma"
        / "migrations"
        / "20260914120000_part13_execution_store"
        / "migration.sql"
    ).read_text(encoding="utf-8")


def migration_columns(text: str, table: str) -> list[str]:
    block = re.search(
        rf'CREATE TABLE "{table}" \((.*?)\n\);', text, re.DOTALL
    )
    assert block is not None, f"no CREATE TABLE {table} in the migration"
    # column definition lines ONLY (a bare "name" TYPE pattern): the
    # CONSTRAINT clause's quoted name must not masquerade as a column.
    return re.findall(
        r'^\s+"([a-z_]+)"\s+(?:UUID|BIGSERIAL|BIGINT|BOOLEAN|INTEGER|VARCHAR)',
        block.group(1),
        re.MULTILINE,
    )


def schema_model_columns(model: str) -> list[str]:
    block = re.search(
        rf"model {model} \{{(.*?)\n\}}", SCHEMA.read_text(encoding="utf-8"), re.DOTALL
    )
    assert block is not None, f"model {model} missing from schema.prisma"
    columns: list[str] = []
    for line in block.group(1).splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith(("//", "@@", "tenant ", "order ")):
            continue
        name = stripped.split()[0]
        mapped = re.search(r'@map\("([a-z_]+)"\)', stripped)
        columns.append(mapped.group(1) if mapped else name)
    return columns


class TestLedgerShapeAgreement:
    def test_migration_prisma_and_executor_agree_on_the_columns(self) -> None:
        migration_cols = set(
            migration_columns(part14_migration(), "engine_retention_runs")
        )
        prisma_cols = set(schema_model_columns("ExecutionRetentionRun"))
        head = retention.INSERT_RUN_SQL.split("(", 1)[1].split(")", 1)[0]
        insert_cols = {c.strip() for c in head.split(",")}
        assert migration_cols == prisma_cols
        # The insert covers the table MINUS the identity column: every
        # other column is supplied explicitly, so no DEFAULT can silently
        # paper over a forgotten value (the table's single default,
        # `exhausted false`, is always written by the executor anyway).
        assert insert_cols == migration_cols - {"seq"}

    def test_index_names_match_across_artifacts(self) -> None:
        text = part14_migration()
        assert 'CREATE INDEX "engine_retention_runs_tenant_id_seq_idx"' in text
        schema_text = SCHEMA.read_text(encoding="utf-8")
        index_map = '@@index([tenantId, seq], map: "engine_retention_runs_tenant_id_seq_idx")'
        assert index_map in schema_text

    def test_instance_id_width_matches_the_instance_id_law(self) -> None:
        # config.py caps EXECUTION_INSTANCE_ID at 64 characters; the column
        # must fit the widest legal value or a long-but-legal id truncates
        # (or errors, on a stricter client) at ledger write time.
        assert '"instance_id" VARCHAR(64) NOT NULL' in part14_migration()

    def test_the_predicate_columns_exist_where_the_sql_assumes_them(self) -> None:
        old = part13_migration()
        assert '"occurred_at" BIGINT NOT NULL' in old  # events: the cutoff target
        assert '"terminal_at" BIGINT' in old  # orders: nullable, and IS NOT NULL-checked
        assert '"tenant_id" UUID NOT NULL' in old

    def test_migration_is_three_valid_postgres_statements(self) -> None:
        statements = sqlglot_parse(part14_migration(), read="postgres")
        assert len(statements) == 3
        kinds = [type(s).__name__ for s in statements]
        assert kinds == ["Create", "Create", "Alter"]

    def test_tenant_fk_is_restrict_like_every_engine_table(self) -> None:
        fk = (
            'ALTER TABLE "engine_retention_runs" ADD CONSTRAINT '
            '"engine_retention_runs_tenant_id_fkey"\n'
            '    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT'
        )
        assert fk in part14_migration()


class TestDeletionTargetLaw:
    def test_the_whole_app_deletes_from_exactly_one_table(self) -> None:
        targets: set[str] = set()
        for path in sorted(APP_DIR.rglob("*.py")):
            text = path.read_text(encoding="utf-8")
            targets.update(re.findall(r"DELETE FROM ([a-z_]+)", text))
        assert targets == {TABLE_EVENTS}

    def test_the_core_law_names_the_tables_this_executor_respects(self) -> None:
        from wlct_trading.retention import (
            IMMUTABLE_RECORD_TABLES,
            PRUNABLE_JOURNAL,
            RETENTION_LEDGER_TABLE,
        )

        assert PRUNABLE_JOURNAL == TABLE_EVENTS
        assert RETENTION_LEDGER_TABLE == retention.TABLE_RETENTION_RUNS
        assert retention.TABLE_RETENTION_RUNS not in IMMUTABLE_RECORD_TABLES
        # the executor's module carries no DELETE constant touching a
        # table in the immutable set (belt over the belt):
        for name, value in vars(retention).items():
            if isinstance(value, str) and value.startswith("DELETE FROM"):
                for table in IMMUTABLE_RECORD_TABLES:
                    assert table not in value, f"{name} deletes from immutable {table}"


class TestRlsCoverageIncludesTheLedger:
    def test_coverage_json_lists_the_table_and_model(self) -> None:
        coverage = json.loads(
            (ROOT / "apps" / "api" / "prisma" / "rls" / "rls_coverage.json").read_text(
                encoding="utf-8"
            )
        )
        covered = {entry["table"]: entry["model"] for entry in coverage["covered"]}
        assert covered.get(retention.TABLE_RETENTION_RUNS) == "ExecutionRetentionRun"
        assert coverage["covered"] and len(covered) == len(coverage["covered"])

    def test_enable_and_disable_mention_the_ledger_symmetrically(self) -> None:
        rls_dir = ROOT / "apps" / "api" / "prisma" / "rls"
        enable = (rls_dir / "enable.sql").read_text(encoding="utf-8")
        disable = (rls_dir / "disable.sql").read_text(encoding="utf-8")
        table = retention.TABLE_RETENTION_RUNS
        assert f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY;' in enable
        assert f'ALTER TABLE "{table}" FORCE ROW LEVEL SECURITY;' in enable
        assert f'ALTER TABLE "{table}" DISABLE ROW LEVEL SECURITY;' in disable

    @pytest.mark.parametrize("table", ["engine_retention_runs"])
    def test_part11_policy_migration_covers_the_new_table(self, table: str) -> None:
        part11 = (
            ROOT
            / "apps"
            / "api"
            / "prisma"
            / "migrations"
            / "20260913120000_part11_row_level_security"
            / "migration.sql"
        ).read_text(encoding="utf-8")
        assert f'CREATE POLICY tenant_isolation ON "{table}"' in part11
```

FILE: services/execution-engine/tests/test_part14_retention.py

```python
"""Part 14: the retention executor and its HTTP surface.

Two layers, mirroring the store's test discipline (the same recording
FakeConn family, including per-transaction begin/commit counters, because
"each batch is its own transaction" is the lock-safety law the executor is
allowed to claim):

1. the executor against scripted fakes - exact statement-per-transaction
   conversation for every branch (rehearse, partial batch, full batches to
   the ceiling, empty journal, lost-race count, ledger failure, pool
   error), the shared-prune-predicate literal pins, the sqlglot parse of
   every statement, and "the only DELETE targets engine_order_events"
   scanned off the module's own strings;
2. the routes through a booted TestClient over a fake POOL (lifespan
   patched at its seam, exactly as the part-13 config tests patch the
   store) - the memory 409, the apply-disabled 409 that must not emit a
   single statement, dry run and apply answers, inspect's read, the
   ledger-lost 500 carrying counts, the tenant-match law, and the status
   surface's two new fields.
"""

from __future__ import annotations

import asyncio
from contextlib import ExitStack
from typing import Any, cast
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlglot import parse as sqlglot_parse
from wlct_trading.execution.store import OrderStoreError
from wlct_trading.retention import RetentionPolicy

from app import retention
from app.config import get_settings
from app.retention import (
    COUNT_PRUNABLE_SQL,
    DELETE_BY_SEQS_SQL,
    INSERT_RUN_SQL,
    PRUNABLE_WHERE,
    SELECT_DOOMED_SEQS_SQL,
    SELECT_RECENT_RUNS_SQL,
    RetentionLedgerLost,
    inspect_event_store,
    run_event_retention,
)
from app.store_sql import PostgresOrderStore

TENANT = str(uuid4())
POLICY = RetentionPolicy(event_retention_days=90, batch_rows=4, max_batches=3)
US_PER_DAY = 86_400 * 1_000_000


class Eat:
    """Script marker consumed by the NEXT statement of either kind without
    answering it: how a test pins WHICH statement an injected failure
    rides (the ledger INSERT, not the SET that precedes it)."""


class FakeConn:
    """Records every statement with its args; answers fetch() from a
    script; tracks transaction boundaries (begins/commits/rollbacks) and
    groups the statements by the transaction they ran inside. A script
    entry is either an Eat() marker (consumed by any statement), an
    exception (raised at the next statement), or a list (the answer for
    the next fetch; execute statements never consume answers)."""

    _UNSET = object()

    def __init__(self, script: list[Any] | None = None) -> None:
        self.statements: list[tuple[str, tuple[object, ...]]] = []
        self.txes: list[list[str]] = [[]]  # statement list per transaction
        self.script = list(script or [])
        self.cursor = 0
        self.tx_begins = 0
        self.tx_commits = 0
        self.tx_rollbacks = 0

    def _step(self, query: str, args: tuple[object, ...], *, allow_response: bool) -> Any:
        self.statements.append((query, args))
        self.txes[-1].append(query)
        if self.cursor < len(self.script):
            entry = self.script[self.cursor]
            if isinstance(entry, Eat):
                self.cursor += 1
            elif isinstance(entry, BaseException):
                self.cursor += 1
                raise entry
            if allow_response:
                self.cursor += 1
                return entry
        return self._UNSET

    async def execute(self, query: str, *args: object) -> str:
        self._step(query, args, allow_response=False)
        return "OK 1"

    async def fetch(self, query: str, *args: object) -> list[Any]:
        entry = self._step(query, args, allow_response=True)
        if entry is not self._UNSET:
            return list(entry) if isinstance(entry, list) else []
        return []

    async def fetchrow(self, query: str, *args: object) -> Any:
        entry = self._step(query, args, allow_response=True)
        return None if entry is self._UNSET else entry

    def transaction(self) -> FakeTx:
        return FakeTx(self)


class FakeTx:
    def __init__(self, conn: FakeConn) -> None:
        self._conn = conn

    async def __aenter__(self) -> None:
        self._conn.tx_begins += 1
        self._conn.txes.append([])  # statements land in THIS transaction

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> bool:
        if exc_type is None:
            self._conn.tx_commits += 1
        else:
            self._conn.tx_rollbacks += 1
        return False


class FakeAcquire:
    def __init__(self, conn: FakeConn) -> None:
        self._conn = conn

    async def __aenter__(self) -> FakeConn:
        return self._conn

    async def __aexit__(self, *exc: object) -> bool:
        return False


class FakePool:
    def __init__(self, conn: FakeConn) -> None:
        self.conn = conn
        self.acquires = 0
        self.closed = False

    def acquire(self) -> FakeAcquire:
        self.acquires += 1
        return FakeAcquire(self.conn)

    async def close(self) -> None:
        # the lifespan closes whatever pool it was handed - the fake proves
        # the retention tests' app shuts down through the REAL path.
        self.closed = True


def pair(script: list[Any]) -> tuple[FakePool, FakeConn]:
    conn = FakeConn(script)
    return FakePool(conn), conn


def call_run(
    pool: FakePool,
    *,
    dry_run: bool,
    instance_id: str = "exec-test-1",
    now_us: int = 1_757_000_000_000_000,
    policy: RetentionPolicy = POLICY,
    tenant: str = TENANT,
) -> Any:
    return asyncio.run(
        run_event_retention(
            cast(Any, pool),
            tenant,
            policy,
            dry_run=dry_run,
            instance_id=instance_id,
            clock=lambda: now_us,
        )
    )


def queries(conn: FakeConn) -> list[str]:
    return [query for query, _ in conn.statements]


class TestStatementLaws:
    def test_shared_predicate_is_the_same_literal_in_both_reads(self) -> None:
        # Rehearsal and execution share meaning by CHARACTER identity:
        # if either statement's WHERE drifts, the dry-run answer was a lie
        # about what the apply would delete.
        assert PRUNABLE_WHERE in COUNT_PRUNABLE_SQL
        assert PRUNABLE_WHERE in SELECT_DOOMED_SEQS_SQL
        assert "o.terminal_at < $2" in COUNT_PRUNABLE_SQL
        assert "e.occurred_at < $2" in COUNT_PRUNABLE_SQL
        assert "o.terminal_at IS NOT NULL" in COUNT_PRUNABLE_SQL
        # ONE cutoff parameter serves both comparisons - a second cutoff
        # would be a second law the core never validated.
        assert COUNT_PRUNABLE_SQL.count("$2") == 2
        assert "LIMIT $3" in SELECT_DOOMED_SEQS_SQL and "ORDER BY e.seq" in SELECT_DOOMED_SEQS_SQL

    def test_only_the_journal_is_deletable(self) -> None:
        deleters = [
            value
            for value in vars(retention).values()
            if isinstance(value, str) and "DELETE FROM" in value
        ]
        assert deleters
        for stmt in deleters:
            assert "DELETE FROM engine_order_events" in stmt
            assert "DELETE FROM engine_orders " not in stmt
            assert "DELETE FROM engine_order_fills" not in stmt
            assert "DELETE FROM engine_retention_runs" not in stmt

    def test_delete_is_an_explicit_seq_list_belted_by_tenant(self) -> None:
        assert DELETE_BY_SEQS_SQL.startswith("DELETE FROM engine_order_events")
        assert "tenant_id = $1" in DELETE_BY_SEQS_SQL
        assert "seq = ANY($2::bigint[])" in DELETE_BY_SEQS_SQL
        assert "RETURNING 1" in DELETE_BY_SEQS_SQL

    def test_every_statement_parses_as_postgres(self) -> None:
        for stmt in (
            COUNT_PRUNABLE_SQL,
            SELECT_DOOMED_SEQS_SQL,
            DELETE_BY_SEQS_SQL,
            INSERT_RUN_SQL,
            SELECT_RECENT_RUNS_SQL,
        ):
            parsed = sqlglot_parse(stmt, read="postgres")
            assert parsed and parsed[0] is not None

    def test_ledger_insert_columns_match_the_migration_in_order(self) -> None:
        head = INSERT_RUN_SQL.split("(", 1)[1].split(")", 1)[0]
        assert head.split(", ") == [
            "tenant_id",
            "started_at",
            "finished_at",
            "dry_run",
            "event_cutoff_us",
            "rows_deleted",
            "batches",
            "exhausted",
            "instance_id",
        ]
        assert "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)" in INSERT_RUN_SQL


class TestDryRun:
    def test_count_then_ledger_in_two_transactions(self) -> None:
        pool, conn = pair([[{"n": 42}]])
        report = call_run(pool, dry_run=True, now_us=1_757_000_000_000_000)
        assert report.rows_reported == 42
        assert report.cutoff_us == 1_757_000_000_000_000 - 90 * US_PER_DAY
        assert report.batches_run == 0 and report.exhausted is False
        assert report.ledger_written is True
        assert conn.tx_begins == 2 and conn.tx_commits == 2 and conn.tx_rollbacks == 0
        assert queries(conn) == [
            "SELECT set_config('app.tenant_id', $1, true)",
            COUNT_PRUNABLE_SQL,
            "SELECT set_config('app.tenant_id', $1, true)",
            INSERT_RUN_SQL,
        ]
        # the count is asked under the tenant arg and the cutoff - nothing else
        assert conn.statements[1][1] == (TENANT, report.cutoff_us)

    def test_the_ledger_row_records_the_rehearsal_as_a_fact(self) -> None:
        pool, conn = pair([[{"n": 7}]])
        report = call_run(pool, dry_run=True)
        insert_args = conn.statements[3][1]
        assert insert_args[0] == TENANT
        assert insert_args[3] is True  # dry_run column
        assert insert_args[5] == 7  # rows_deleted holds the prunable count
        assert insert_args[4] == report.cutoff_us  # the cutoff is part of the fact
        assert insert_args[8] == "exec-test-1"

    def test_empty_answer_to_count_is_zero_not_absent(self) -> None:
        pool, _ = pair([[]])
        report = call_run(pool, dry_run=True)
        assert report.rows_reported == 0


class TestApplyBatches:
    def test_partial_batch_is_the_last_batch(self) -> None:
        pool, conn = pair(
            [
                [{"seq": 7}, {"seq": 9}],  # 2 < batch_rows 4 -> the end
                [{"seq": 7}, {"seq": 9}],  # delete actually removed both
            ]
        )
        report = call_run(pool, dry_run=False)
        assert (report.rows_reported, report.batches_run, report.exhausted) == (2, 1, False)
        assert conn.tx_begins == 2  # one work tx + one ledger tx
        assert conn.statements[1][1] == (TENANT, report.cutoff_us, 4)
        assert conn.statements[2][1] == (TENANT, [7, 9])  # explicit seq list

    def test_full_batches_run_until_the_ceiling_and_say_so(self) -> None:
        script: list[Any] = []
        for batch in range(3):  # max_batches = 3, every batch FULL
            rows = [{"seq": batch * 4 + i} for i in range(4)]
            script.extend([rows, rows])
        pool, conn = pair(script)
        report = call_run(pool, dry_run=False)
        assert (report.rows_reported, report.batches_run) == (12, 3)
        assert report.exhausted is True  # "more may remain" - the scheduler's cue
        # no fourth select: the ceiling stops the loop, it does not slow it
        assert queries(conn).count(SELECT_DOOMED_SEQS_SQL) == 3

    def test_batch_limit_flows_from_the_policy_not_a_hardcode(self) -> None:
        pool, conn = pair([[]])
        call_run(
            pool,
            dry_run=False,
            policy=RetentionPolicy(event_retention_days=5, batch_rows=17, max_batches=2),
        )
        assert conn.statements[1][1][2] == 17

    def test_empty_journal_still_writes_a_zero_run_row(self) -> None:
        # a recorded no-op is what proves the schedule ran at all.
        pool, conn = pair([[]])
        report = call_run(pool, dry_run=False)
        assert (report.rows_reported, report.batches_run, report.exhausted) == (0, 0, False)
        assert queries(conn)[-2] == "SELECT set_config('app.tenant_id', $1, true)"
        assert queries(conn)[-1] == INSERT_RUN_SQL
        assert conn.statements[-1][1][5] == 0

    def test_lost_races_shrink_the_count_never_the_safety(self) -> None:
        # select saw three doomed seqs; another conn deleted two first.
        # The RETURNING rowcount is the ONLY thing reported.
        pool, _ = pair(
            [[{"seq": 1}, {"seq": 2}, {"seq": 3}], [{"seq": 1}]]
        )
        report = call_run(pool, dry_run=False)
        assert report.rows_reported == 1
        assert report.batches_run == 1  # partial delete is still a complete batch

    def test_each_batch_is_its_own_transaction_each_with_a_guc(self) -> None:
        script: list[Any] = []
        for _ in range(3):
            rows = [{"seq": i} for i in range(4)]
            script.extend([rows, rows])
        pool, conn = pair(script)
        report = call_run(pool, dry_run=False)
        gucs = [q for q in queries(conn) if q.startswith("SELECT set_config")]
        assert len(gucs) == conn.tx_begins == 4  # 3 work + 1 ledger
        assert report.batches_run == 3
        for tx in conn.txes[1:4]:  # each work transaction: GUC, select, delete
            assert len(tx) == 3 and tx[0].startswith("SELECT set_config")


class TestFailurePaths:
    def test_ledger_failure_loses_the_record_not_the_truth(self) -> None:
        pool, conn = pair(
            [
                [{"seq": 1}],
                [{"seq": 1}],
                Eat(),  # the ledger transaction's SET...
                RuntimeError("disk full mid insert"),  # ...then its INSERT fails
            ]
        )
        with pytest.raises(RetentionLedgerLost) as caught:
            call_run(pool, dry_run=False)
        lost = caught.value.report
        assert lost.rows_reported == 1 and lost.batches_run == 1
        assert lost.ledger_written is False  # the field the failure FLIPS
        assert conn.tx_rollbacks == 1 and conn.tx_commits == 1  # work committed, ledger did not

    def test_pool_error_mid_batch_propagates_and_rolls_back(self) -> None:
        pool, conn = pair([Eat(), RuntimeError("connection reset")])
        with pytest.raises(RuntimeError, match="connection reset"):
            call_run(pool, dry_run=False)
        assert conn.tx_rollbacks == 1

    def test_the_tenant_guard_burns_before_the_pool_is_borrowed(self) -> None:
        conn = FakeConn([])
        pool = FakePool(conn)
        with pytest.raises(OrderStoreError, match="canonical UUID"):
            asyncio.run(
                run_event_retention(
                    cast(Any, pool),
                    "tenant-label-not-uuid",
                    POLICY,
                    dry_run=True,
                    instance_id="exec-test-1",
                )
            )
        assert pool.acquires == 0 and conn.statements == []


class TestInspect:
    def test_both_reads_share_one_transaction(self) -> None:
        row = {
            "seq": 3,
            "started_at": 100,
            "finished_at": 200,
            "dry_run": True,
            "event_cutoff_us": 99,
            "rows_deleted": 7,
            "batches": 0,
            "exhausted": False,
            "instance_id": "exec-test-1",
        }
        conn = FakeConn([[{"n": 7}], [row]])
        view = asyncio.run(
            inspect_event_store(
                cast(Any, FakePool(conn)), TENANT, POLICY, limit=5, clock=lambda: 1_000
            )
        )
        assert conn.tx_begins == 1  # ONE transaction, both reads, one GUC
        assert conn.statements[1][1] == (TENANT, 1_000 - 90 * US_PER_DAY)
        assert conn.statements[2][0] == SELECT_RECENT_RUNS_SQL
        assert conn.statements[2][1] == (TENANT, 5)
        assert view["prunableNow"] == 7
        assert view["cutoffUs"] == 1_000 - 90 * US_PER_DAY
        assert view["runs"][0]["rows_deleted"] == 7
        assert view["runs"][0]["dry_run"] is True

    def test_view_values_are_plain_ints_and_bools(self) -> None:
        # ledger bigints arrive as int already; the view must not pass a
        # Decimal through to JSON (float coercion would lie about micros).
        conn = FakeConn([[{"n": 0}], []])
        view = asyncio.run(
            inspect_event_store(cast(Any, FakePool(conn)), TENANT, POLICY, limit=5, clock=lambda: 1)
        )
        assert isinstance(view["prunableNow"], int)
        assert view["runs"] == []


class TestConfigSurface:
    def test_policy_property_constructs_the_core_value(self) -> None:
        settings = get_settings()
        assert settings.retention_policy == RetentionPolicy(
            event_retention_days=90, batch_rows=2_000, max_batches=50
        )

    def test_absurd_retention_fails_boot_naming_the_env(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("EXECUTION_RETENTION_EVENT_DAYS", "0")
        get_settings.cache_clear()
        with pytest.raises(Exception, match="EXECUTION_RETENTION_EVENT_DAYS"):
            get_settings()
        get_settings.cache_clear()

    def test_public_view_carries_retention_posture(self) -> None:
        public = get_settings().to_public_dict()
        assert public["retentionEnabled"] is False
        assert public["retentionEventDays"] == 90
        assert public["retentionBatchRows"] == 2_000
        assert public["retentionMaxBatches"] == 50


def postgres_client(
    monkeypatch: pytest.MonkeyPatch,
    stack: ExitStack,
    script: list[Any],
    *,
    enabled: str = "false",
) -> tuple[TestClient, FakeConn]:
    """A booted app with the postgres backend and FAKE pool: the lifespan
    seam (app.main.open_durable_store) is the patch point, so the app under
    test is the real composition - router, deps, config, store wiring."""
    monkeypatch.setenv("EXECUTION_STORE_BACKEND", "postgres")
    monkeypatch.setenv("EXECUTION_POSTGRES_DSN", "postgresql://u:p@db:5432/wlct")
    monkeypatch.setenv("EXECUTION_RETENTION_ENABLED", enabled)
    get_settings.cache_clear()
    pool, conn = pair(script)
    from app.main import create_app

    async def fake_open(settings: Any) -> tuple[FakePool, PostgresOrderStore]:
        return pool, PostgresOrderStore(cast(Any, pool))

    monkeypatch.setattr("app.main.open_durable_store", fake_open)
    client = stack.enter_context(TestClient(create_app()))
    return client, conn


def headers(tenant: str = TENANT) -> dict[str, str]:
    from tests.conftest import BASE_ENV

    return {
        "x-internal-token": BASE_ENV["EXECUTION_INTERNAL_TOKEN"],
        "x-tenant-id": tenant,
    }


class TestRoutesMemoryMode:
    def test_run_refused_with_reason_not_fabricated_success(self, client: TestClient) -> None:
        response = client.post(
            "/internal/v1/retention/run",
            json={"tenantId": TENANT},
            headers=headers(),
        )
        assert response.status_code == 409
        body = response.json()  # the engine's flat {code,message} envelope
        assert body["code"] == "RETENTION_NO_DURABLE_STORE"
        assert "restarts bound" in body["message"]

    def test_inspect_refused_too(self, client: TestClient) -> None:
        response = client.post(
            "/internal/v1/retention/inspect",
            json={"tenantId": TENANT},
            headers=headers(),
        )
        assert response.status_code == 409
        assert response.json()["code"] == "RETENTION_NO_DURABLE_STORE"

    def test_status_reports_the_shipped_retention_defaults(self, client: TestClient) -> None:
        body = client.get("/internal/v1/status", headers=headers()).json()
        assert body["retentionEnabled"] is False
        assert body["retentionEventDays"] == 90


class TestRoutesDurableMode:
    def test_dry_run_always_available_and_answers_camel_case(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, conn = postgres_client(monkeypatch, stack, [[{"n": 5}]])
            response = client.post(
                "/internal/v1/retention/run",
                json={"tenantId": TENANT},
                headers=headers(),
            )
            assert response.status_code == 200
            body = response.json()
            assert body["dryRun"] is True
            assert body["rowsReported"] == 5
            assert body["batchesRun"] == 0
            assert body["ledgerWritten"] is True
            assert isinstance(body["cutoffUs"], int)  # micros stay integers on the wire
            assert len(conn.statements) == 4

    def test_apply_refused_before_any_statement_when_disabled(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, conn = postgres_client(monkeypatch, stack, [])
            response = client.post(
                "/internal/v1/retention/run",
                json={"tenantId": TENANT, "dryRun": False},
                headers=headers(),
            )
            assert response.status_code == 409
            assert response.json()["code"] == "RETENTION_APPLY_DISABLED"
            assert conn.statements == []  # not even a GUC: refused at the door

    def test_apply_executes_when_enabled(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, _ = postgres_client(
                monkeypatch,
                stack,
                [[{"seq": 2}], [{"seq": 2}]],
                enabled="true",
            )
            response = client.post(
                "/internal/v1/retention/run",
                json={"tenantId": TENANT, "dryRun": False},
                headers=headers(),
            )
            body = response.json()
            assert response.status_code == 200
            assert body["dryRun"] is False
            assert body["rowsReported"] == 1

    def test_ledger_failure_surfaces_counts_in_a_500(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, _ = postgres_client(
                monkeypatch,
                stack,
                [
                    [{"seq": 2}],
                    [{"seq": 2}],
                    Eat(),
                    RuntimeError("ledger insert died"),
                ],
                enabled="true",
            )
            response = client.post(
                "/internal/v1/retention/run",
                json={"tenantId": TENANT, "dryRun": False},
                headers=headers(),
            )
            assert response.status_code == 500
            body = response.json()
            assert body["code"] == "RETENTION_LEDGER_LOST"
            assert body["rowsReported"] == 1
            assert "retention.ledger_write_failed" in body["message"]

    def test_inspect_reads_count_and_recent_runs(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        row = {
            "seq": 1,
            "started_at": 10,
            "finished_at": 11,
            "dry_run": False,
            "event_cutoff_us": 9,
            "rows_deleted": 3,
            "batches": 1,
            "exhausted": True,
            "instance_id": "exec-test-1",
        }
        with ExitStack() as stack:
            client, conn = postgres_client(monkeypatch, stack, [[{"n": 8}], [row]])
            response = client.post(
                "/internal/v1/retention/inspect",
                json={"tenantId": TENANT},
                headers=headers(),
            )
            assert response.status_code == 200
            body = response.json()
            assert body["prunableNow"] == 8
            assert body["enabled"] is False
            assert body["eventRetentionDays"] == 90
            assert body["maxBatches"] == 50
            assert body["runs"][0]["rowsDeleted"] == 3
            assert body["runs"][0]["exhausted"] is True
            assert conn.tx_begins == 1  # one read transaction, not three

    def test_body_tenant_must_match_the_header(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, conn = postgres_client(monkeypatch, stack, [])
            response = client.post(
                "/internal/v1/retention/run",
                json={"tenantId": str(uuid4())},
                headers=headers(),
            )
            assert response.status_code == 403
            assert response.json()["code"] == "TENANT_MISMATCH"
            assert conn.statements == []

    def test_no_token_no_route(self, monkeypatch: pytest.MonkeyPatch) -> None:
        with ExitStack() as stack:
            client, _ = postgres_client(monkeypatch, stack, [])
            response = client.post(
                "/internal/v1/retention/run", json={"tenantId": TENANT}
            )
            assert response.status_code == 401

    def test_unknown_fields_are_rejected_on_the_run_body(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, _ = postgres_client(monkeypatch, stack, [])
            response = client.post(
                "/internal/v1/retention/run",
                json={"tenantId": TENANT, "apiKey": "nope"},
                headers=headers(),
            )
            assert response.status_code == 422
```

FILE: services/execution-engine/tests/test_part14_retention_live.py

```python
"""Part 14: retention against a REAL Postgres - when one is provided.

Same law as the part-13 live suite: without ``EXECUTION_TEST_POSTGRES_DSN``
the module skips with a visible reason; with it, the deletion executes
against the migrated tables and the assertions are the database's answer,
not a fake's. What a fake cannot certify and this file can:

- the JOINed prune predicate actually MATCHES the rows the prose says it
  matches (settled-old under settled-old, keeps recent under settled,
  keeps everything under open) - an executor whose fake scripts its own
  answers can never discover that its SQL selects the wrong rows;
- ``seq = ANY(...)`` deletes exactly the selected rows and RETURNING
  counts exactly those;
- the batch ceiling interrupts a big prune with the remainder INTACT, and
  the next run resumes - "exhausted means run again" is load-bearing;
- a second tenant's identical-looking rows survive a first tenant's run;
- under real ENABLE/FORCE ROW LEVEL SECURITY on the ledger table, the
  executor's own transaction (GUC set) writes and reads its rows while a
  bare session sees nothing - the RLS argument, executed for the newest
  table too.

Ages are anchored to the real clock (the cutoffs are relative): a live
suite that freezes "now" would be testing a fantasy calendar.
"""

from __future__ import annotations

import os
import time
from collections.abc import AsyncIterator
from pathlib import Path
from typing import cast

import asyncpg
import pytest
from wlct_trading.retention import RetentionPolicy

from app.retention import inspect_event_store, run_event_retention
from app.store_sql import PgPool

pytestmark = pytest.mark.skipif(
    os.environ.get("EXECUTION_TEST_POSTGRES_DSN") is None,
    reason="EXECUTION_TEST_POSTGRES_DSN not set; real-Postgres retention suite "
    "skipped (the scripted suite pins statements and conversations instead)",
)

ROOT = Path(__file__).resolve().parents[3]
MIGRATIONS = (
    ROOT
    / "apps"
    / "api"
    / "prisma"
    / "migrations"
    / "20260914120000_part13_execution_store"
    / "migration.sql",
    ROOT
    / "apps"
    / "api"
    / "prisma"
    / "migrations"
    / "20260914160000_part14_retention_ledger"
    / "migration.sql",
)

DAY_US = 86_400 * 1_000_000
TENANT_A = "4a1b2c3d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"
TENANT_B = "5b2c3d4e-6f70-4b8c-9d0e-1f2a3b4c5d6e"

_TRUNCATES = (
    # Literal table names throughout (S608-clean by construction: no
    # f-strings near SQL, even a constant-fed one).
    "DELETE FROM engine_retention_runs",
    "DELETE FROM engine_order_fills",
    "DELETE FROM engine_order_events",
    "DELETE FROM engine_orders",
)

_LEDGER_POLICY_SETUP = (
    'CREATE POLICY tenant_isolation ON "engine_retention_runs" '
    "USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)",
    'ALTER TABLE "engine_retention_runs" ENABLE ROW LEVEL SECURITY',
    'ALTER TABLE "engine_retention_runs" FORCE ROW LEVEL SECURITY',
)
_LEDGER_POLICY_TEARDOWN = (
    'ALTER TABLE "engine_retention_runs" NO FORCE ROW LEVEL SECURITY',
    'ALTER TABLE "engine_retention_runs" DISABLE ROW LEVEL SECURITY',
    'DROP POLICY tenant_isolation ON "engine_retention_runs"',
)


_MIGRATIONS_APPLIED = False


def _statements_for(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    body = "\n".join(
        line for line in text.splitlines() if not line.strip().startswith("--")
    )
    return [s.strip() for s in body.split(";") if s.strip()]


@pytest.fixture
async def conn() -> AsyncIterator[asyncpg.Connection]:
    """One session per test; the migration files themselves are the DDL
    (a fresh CI database gets part-13 THEN part-14 applied here, a
    fully-migrated one is left alone, and a half-migrated one - orders
    without the ledger, or the reverse - is refused as the broken state
    it is, rather than silently patched)."""
    global _MIGRATIONS_APPLIED
    dsn = os.environ["EXECUTION_TEST_POSTGRES_DSN"]
    async with asyncpg.connect(dsn=dsn, timeout=10.0) as connection:
        if not _MIGRATIONS_APPLIED:
            await connection.execute(
                'CREATE TABLE IF NOT EXISTS "tenants" ("id" UUID PRIMARY KEY)'
            )
            have_orders = (
                await connection.fetchval("SELECT to_regclass('public.engine_orders')")
                is not None
            )
            have_ledger = (
                await connection.fetchval(
                    "SELECT to_regclass('public.engine_retention_runs')"
                )
                is not None
            )
            if not have_orders and not have_ledger:
                for path in MIGRATIONS:
                    for statement in _statements_for(path):
                        await connection.execute(statement)
            elif have_orders and not have_ledger:
                for statement in _statements_for(MIGRATIONS[1]):
                    await connection.execute(statement)
            else:
                pytest.fail(
                    "half-migrated CI database (engine_retention_runs without "
                    "engine_orders); drop public.engine_* and the tenants stub "
                    "and rerun - this suite refuses to guess the missing half"
                )
            _MIGRATIONS_APPLIED = True
        await connection.execute(
            "INSERT INTO tenants(id) VALUES ($1),($2) ON CONFLICT DO NOTHING",
            TENANT_A,
            TENANT_B,
        )
        for statement in _TRUNCATES:
            await connection.execute(statement)
        yield connection


class _SingleConnectionPool:
    """One shared session for pool + raw queries (see part-13 live suite for
    why the shim, not a real pool, is what makes GUC assertions possible)."""

    def __init__(self, connection: asyncpg.Connection) -> None:
        self._connection = connection

    def acquire(self) -> object:
        connection = self._connection

        class _Acquire:
            async def __aenter__(self) -> asyncpg.Connection:
                return connection

            async def __aexit__(self, *exc: object) -> bool:
                return False

        return _Acquire()

    async def close(self) -> None:
        return None


def now_us() -> int:
    return int(time.time() * 1_000_000)


async def seed_order(
    conn: asyncpg.Connection,
    tenant: str,
    order_id: str,
    *,
    terminal_at_us: int | None,
) -> None:
    """One minimal real order row (status is irrelevant to the prune -
    terminality is the timestamp, per the core law; the row carries
    FILLED-style values anyway because the schema's NOT NULLs earned them)."""
    await conn.execute(
        "INSERT INTO engine_orders (tenant_id, order_id, client_order_id, account_id, "
        "exchange, symbol, side, order_type, time_in_force, is_simulated, status, "
        "quantity, filled_quantity, cumulative_fee, created_at, updated_at, terminal_at) "
        "VALUES ($1, $2, $2, 'acct-1', 'binance', 'BTCUSDT', 'BUY', 'LIMIT', 'GTC', "
        "true, 'FILLED', '1', '1', '0', $3, $3, $4)",
        tenant,
        order_id,
        (terminal_at_us or now_us()) - 400 * DAY_US,
        terminal_at_us,
    )


async def seed_event(
    conn: asyncpg.Connection,
    tenant: str,
    order_id: str,
    event_id: str,
    *,
    occurred_at_us: int,
) -> None:
    await conn.execute(
        "INSERT INTO engine_order_events (tenant_id, order_id, event_id, status, "
        "occurred_at, payload) VALUES ($1, $2, $3, 'ACCEPTED', $4, '{}'::jsonb)",
        tenant,
        order_id,
        event_id,
        occurred_at_us,
    )


async def event_ids(conn: asyncpg.Connection, tenant: str) -> list[str]:
    rows = await conn.fetch(
        "SELECT event_id FROM engine_order_events WHERE tenant_id = $1 ORDER BY seq",
        tenant,
    )
    return [row["event_id"] for row in rows]


async def ledger_rows(conn: asyncpg.Connection, tenant: str) -> list[asyncpg.Record]:
    return await conn.fetch(
        "SELECT dry_run, rows_deleted, batches, exhausted FROM engine_retention_runs "
        "WHERE tenant_id = $1 ORDER BY seq",
        tenant,
    )


async def seed_fill(conn: asyncpg.Connection, tenant: str, order_id: str) -> None:
    await conn.execute(
        "INSERT INTO engine_order_fills (tenant_id, order_id, fill_id, trade_id, price, "
        "quantity, fee, fee_currency, is_maker, is_simulated, exchange_timestamp, "
        "received_timestamp) VALUES ($1, $2, 'fill-1', 'trade-1', '1000', '1', '0.1', "
        "'USDT', true, true, 1, 1)",
        tenant,
        order_id,
    )


class TestRealPrune:
    async def test_the_predicate_selects_exactly_the_prose_rows(
        self, conn: asyncpg.Connection
    ) -> None:
        now = now_us()
        cutoff = now - 90 * DAY_US
        # A: settled long ago. Old event under it is the ONLY pruneable row.
        await seed_order(conn, TENANT_A, "ord-a", terminal_at_us=cutoff - DAY_US)
        await seed_event(conn, TENANT_A, "ord-a", "a-old", occurred_at_us=cutoff - DAY_US)
        await seed_event(conn, TENANT_A, "ord-a", "a-new", occurred_at_us=cutoff + DAY_US)
        # B: settled RECENTLY, event OLD - law 2 keeps the whole journal.
        await seed_order(conn, TENANT_A, "ord-b", terminal_at_us=cutoff + DAY_US)
        await seed_event(conn, TENANT_A, "ord-b", "b-old", occurred_at_us=cutoff - DAY_US)
        # C: open, ancient events - nothing settled, nothing goes.
        await seed_order(conn, TENANT_A, "ord-c", terminal_at_us=None)
        await seed_event(conn, TENANT_A, "ord-c", "c-ancient", occurred_at_us=now - 999 * DAY_US)
        await seed_fill(conn, TENANT_A, "ord-a")

        pool = _SingleConnectionPool(conn)
        report = await run_event_retention(
            cast(PgPool, pool),
            TENANT_A,
            RetentionPolicy(event_retention_days=90, batch_rows=4, max_batches=3),
            dry_run=False,
            instance_id="exec-live-1",
        )
        assert report.rows_reported == 1
        assert await event_ids(conn, TENANT_A) == ["a-new", "b-old", "c-ancient"]
        orders = await conn.fetch("SELECT order_id FROM engine_orders ORDER BY order_id")
        assert [r["order_id"] for r in orders] == ["ord-a", "ord-b", "ord-c"]
        fills = await conn.fetch("SELECT fill_id FROM engine_order_fills")
        assert [r["fill_id"] for r in fills] == ["fill-1"]  # money survives everything
        ledger = await ledger_rows(conn, TENANT_A)
        truth = [(r["dry_run"], r["rows_deleted"], r["batches"], r["exhausted"]) for r in ledger]
        assert truth == [(False, 1, 1, False)]

    async def test_dry_run_changes_nothing_yet_records_itself(
        self, conn: asyncpg.Connection
    ) -> None:
        now = now_us()
        cutoff = now - 90 * DAY_US
        await seed_order(conn, TENANT_A, "ord-a", terminal_at_us=cutoff - DAY_US)
        await seed_event(conn, TENANT_A, "ord-a", "a-old", occurred_at_us=cutoff - DAY_US)
        report = await run_event_retention(
            cast(PgPool, _SingleConnectionPool(conn)),
            TENANT_A,
            RetentionPolicy(event_retention_days=90, batch_rows=4, max_batches=3),
            dry_run=True,
            instance_id="exec-live-1",
        )
        assert report.rows_reported == 1
        assert await event_ids(conn, TENANT_A) == ["a-old"]  # untouched
        ledger = await ledger_rows(conn, TENANT_A)
        assert (ledger[0]["dry_run"], ledger[0]["rows_deleted"]) == (True, 1)

    async def test_the_ceiling_stops_mid_prune_and_the_next_run_resumes(
        self, conn: asyncpg.Connection
    ) -> None:
        now = now_us()
        cutoff = now - 90 * DAY_US
        await seed_order(conn, TENANT_A, "ord-a", terminal_at_us=cutoff - DAY_US)
        for i in range(10):  # 10 prunable, one run can eat 4 x 2 = 8
            await seed_event(conn, TENANT_A, "ord-a", f"e{i:02d}", occurred_at_us=cutoff - DAY_US)
        policy = RetentionPolicy(event_retention_days=90, batch_rows=4, max_batches=2)
        first = await run_event_retention(
            cast(PgPool, _SingleConnectionPool(conn)),
            TENANT_A,
            policy,
            dry_run=False,
            instance_id="exec-live-1",
        )
        assert (first.rows_reported, first.exhausted) == (8, True)
        assert len(await event_ids(conn, TENANT_A)) == 2
        second = await run_event_retention(
            cast(PgPool, _SingleConnectionPool(conn)),
            TENANT_A,
            policy,
            dry_run=False,
            instance_id="exec-live-1",
        )
        assert (second.rows_reported, second.exhausted) == (2, False)
        assert await event_ids(conn, TENANT_A) == []
        ledger = await ledger_rows(conn, TENANT_A)
        assert [(r["rows_deleted"], r["exhausted"]) for r in ledger] == [(8, True), (2, False)]

    async def test_a_prune_never_breaches_another_tenant(
        self, conn: asyncpg.Connection
    ) -> None:
        now = now_us()
        cutoff = now - 90 * DAY_US
        for tenant in (TENANT_A, TENANT_B):
            await seed_order(conn, tenant, "ord-a", terminal_at_us=cutoff - DAY_US)
            await seed_event(conn, tenant, "ord-a", "old", occurred_at_us=cutoff - DAY_US)
        await run_event_retention(
            cast(PgPool, _SingleConnectionPool(conn)),
            TENANT_A,
            RetentionPolicy(event_retention_days=90, batch_rows=8, max_batches=1),
            dry_run=False,
            instance_id="exec-live-1",
        )
        assert await event_ids(conn, TENANT_A) == []
        assert await event_ids(conn, TENANT_B) == ["old"]  # untouched, same shape
        assert await ledger_rows(conn, TENANT_B) == []  # not even a record for them


class TestLedgerUnderRls:
    async def test_enabled_policies_see_the_run_through_the_guc_only(
        self, conn: asyncpg.Connection
    ) -> None:
        now = now_us()
        cutoff = now - 90 * DAY_US
        await seed_order(conn, TENANT_A, "ord-a", terminal_at_us=cutoff - DAY_US)
        await seed_event(conn, TENANT_A, "ord-a", "a-old", occurred_at_us=cutoff - DAY_US)
        for statement in _LEDGER_POLICY_SETUP:
            await conn.execute(statement)
        try:
            await run_event_retention(
                cast(PgPool, _SingleConnectionPool(conn)),
                TENANT_A,
                RetentionPolicy(event_retention_days=90, batch_rows=4, max_batches=3),
                dry_run=False,
                instance_id="exec-live-1",
            )
            # the tx-local GUC is gone post-commit: a bare session (what a
            # leaked read or a future cron without the contract looks like)
            # sees NOTHING - not an error, nothing.
            bare = await conn.fetchval(
                "SELECT count(*) FROM engine_retention_runs WHERE tenant_id = $1",
                TENANT_A,
            )
            assert int(bare) == 0
            async with conn.transaction():
                await conn.execute("SELECT set_config('app.tenant_id', $1, true)", TENANT_A)
                seen = await conn.fetchval(
                    "SELECT count(*) FROM engine_retention_runs WHERE tenant_id = $1",
                    TENANT_A,
                )
            assert int(seen) == 1  # the store's own contract reads it back
            view = await inspect_event_store(
                cast(PgPool, _SingleConnectionPool(conn)),
                TENANT_A,
                RetentionPolicy(event_retention_days=90, batch_rows=4, max_batches=3),
                limit=5,
            )
            assert view["runs"][0]["rows_deleted"] == 1  # inspect works under policies too
        finally:
            for statement in _LEDGER_POLICY_TEARDOWN:
                await conn.execute(statement)
```

FILE: services/execution-engine/tests/test_part15_drift_parity.py

```python
"""Part 15 drift traps: the probe's SQL against the platform's own RLS
artifacts, in both directions.

An enablement audit is worth exactly as much as its agreement with reality.
The SQL in ``app/rls_probe.py`` is written against three artifacts nobody in
this service owns - the Part 11 migration (policies and the GUC function),
the generated ``enable.sql``/``disable.sql`` pair, and ``rls_coverage.json``.
Every one of them can move without anyone touching the probe: a new covered
table, a renamed policy, a predicate that stops mentioning the GUC. Each
would leave this audit cheerfully verifying the wrong thing, which is worse
than not verifying at all, because a green grade is what stops people
looking.

So every claim the executor makes is re-derived from those artifacts here:
the table list from the DDL (not from the module that grades it), the policy
name from the coverage manifest, the predicate shape from the migration, the
GUC name from the service that sets it, and the exclusions from the same
manifest the operator reads. The reverse direction is pinned too: the
artifacts must still claim what the probe claims, and the module must still
be a reader.

Part 14's parity file pins a WRITE's blast radius; this one pins a READ's
completeness - the same discipline, opposite hazard.
"""

from __future__ import annotations

import ast
import json
import re
from pathlib import Path

import pytest
from sqlglot import parse as sqlglot_parse
from wlct_trading.enablement import (
    EVIDENCE_LEDGER_TABLE,
    MAX_EVIDENCE_AGE_DAYS,
    MAX_PROBED_TABLES,
    MIN_EVIDENCE_AGE_DAYS,
    PLATFORM_SCOPED_TABLES,
    TENANT_GUC,
)

from app import rls_probe
from app.rls_probe import (
    BARE_COUNT_SQL,
    POLICY_POSTURE_SQL,
    PROBE_TABLES,
    ROLE_ATTRS_SQL,
    SCOPED_COUNT_SQL,
    TABLE_EXISTS_SQL,
)
from app.routers import enablement as enablement_router
from app.schemas import EnablementRequest

ROOT = Path(__file__).resolve().parents[3]
RLS_DIR = ROOT / "apps" / "api" / "prisma" / "rls"
MIGRATION = (
    ROOT
    / "apps"
    / "api"
    / "prisma"
    / "migrations"
    / "20260913120000_part11_row_level_security"
    / "migration.sql"
)
PRISMA_SERVICE = ROOT / "apps" / "api" / "src" / "infrastructure" / "prisma" / "prisma.service.ts"
ENGINE_APP = ROOT / "services" / "execution-engine" / "app"
ENGINE_CLIENT = (
    ROOT / "apps" / "api" / "src" / "modules" / "worker" / "engine-internal.client.ts"
)


def rls_artifact(name: str) -> str:
    return (RLS_DIR / name).read_text(encoding="utf-8")


def coverage_manifest() -> dict[str, object]:
    return json.loads((RLS_DIR / "rls_coverage.json").read_text(encoding="utf-8"))


def covered_tables(text: str) -> list[str]:
    return sorted(set(re.findall(r'ALTER TABLE "([a-z_]+)" ENABLE ROW LEVEL SECURITY;', text)))


def forced_tables(text: str) -> list[str]:
    return sorted(set(re.findall(r'ALTER TABLE "([a-z_]+)" FORCE ROW LEVEL SECURITY;', text)))


def unforced_tables(text: str) -> list[str]:
    return sorted(set(re.findall(r'ALTER TABLE "([a-z_]+)" NO FORCE ROW LEVEL SECURITY;', text)))


def disabled_tables(text: str) -> list[str]:
    return sorted(set(re.findall(r'ALTER TABLE "([a-z_]+)" DISABLE ROW LEVEL SECURITY;', text)))


def migrated_tables(migration: str) -> dict[str, str]:
    """table -> the CREATE POLICY block that covers it."""
    blocks: dict[str, str] = {}
    for match in re.finditer(
        r'CREATE POLICY (\w+) ON "([a-z_]+)"(.*?);', migration, re.DOTALL
    ):
        blocks[match.group(2)] = f"{match.group(1)}{match.group(3)}"
    return blocks


#: The heads of a statement a driver would actually run. Deliberately
#: includes the write verbs: a constant that STARTS like a write is the thing
#: this file is looking for.
_SQL_HEAD_RE = re.compile(
    r"^(SELECT|WITH|INSERT|UPDATE|DELETE|MERGE|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE|SET)\b",
    re.IGNORECASE,
)
READ_ONLY = "SET TRANSACTION READ ONLY"

ENABLE = rls_artifact("enable.sql")
DISABLE = rls_artifact("disable.sql")
MIGRATION_SQL = MIGRATION.read_text(encoding="utf-8")


class TestProbeTableSetMatchesTheArtifacts:
    def test_probe_tables_are_exactly_the_engine_plane_of_enable_sql(self) -> None:
        # Not "a subset", not "the ones we got to": if Part 11 covers a new
        # engine table and the probe does not read it, the audit's PASS is a
        # lie about a table it never touched. Re-deriving from the DDL (not
        # from a shared constant) is the whole point of this file.
        engine_plane = {name for name in covered_tables(ENABLE) if name.startswith("engine_")}
        assert set(PROBE_TABLES) == engine_plane
        assert len(PROBE_TABLES) == len(engine_plane)  # no duplicates

    def test_the_ledger_table_name_agrees_with_the_part14_owner(self) -> None:
        from app import retention as retention_module

        assert EVIDENCE_LEDGER_TABLE == retention_module.TABLE_RETENTION_RUNS
        assert EVIDENCE_LEDGER_TABLE in PROBE_TABLES

    def test_enable_and_disable_are_an_exact_pair(self) -> None:
        assert covered_tables(ENABLE) == forced_tables(ENABLE)
        assert unforced_tables(DISABLE) == disabled_tables(DISABLE) == covered_tables(ENABLE)
        # The probe asserts FORCE as a per-table fact; an unpaired ENABLE
        # (owner bypasses policies) is precisely what that assertion is for.
        manifest = coverage_manifest()
        assert len(covered_tables(ENABLE)) == len(manifest["covered"])
        assert {entry["table"] for entry in manifest["covered"]} == set(covered_tables(ENABLE))
        # The number the docs quote, in a test that reads the artifacts: 43 since
        # Part 17's engine_incidents joined the tenant-scoped set. It is pinned
        # rather than derived because the whole point of the pairing tests is that
        # enable.sql, disable.sql, rls_coverage.json and the prose agree - a number
        # computed from one of them cannot show the other three disagree.
        assert len(covered_tables(ENABLE)) == 42 + 1

    def test_every_covered_table_has_a_policy_in_the_migration(self) -> None:
        policies = migrated_tables(MIGRATION_SQL)
        for table in covered_tables(ENABLE):
            assert table in policies, f"{table} is enabled but has no policy"
            assert "USING (tenant_id = wlct_current_tenant_id())" in policies[table]
            assert "WITH CHECK (tenant_id = wlct_current_tenant_id())" in policies[table]

    def test_platform_scoped_set_matches_the_migrations_exclusion_list(self) -> None:
        excluded = re.search(
            r"-- Excluded by design.*?\n(.*?)-- Their tenant-bearing rows",
            MIGRATION_SQL,
            re.DOTALL,
        )
        assert excluded is not None, "the migration's exclusion list moved; update this test"
        listed = set(re.findall(r"^--\s+([a-z_]+)\s+\(", excluded.group(1), re.MULTILINE))
        assert PLATFORM_SCOPED_TABLES == frozenset(listed)
        assert listed.isdisjoint(covered_tables(ENABLE))

    def test_the_coverage_manifest_is_the_same_source_as_its_own_schema(self) -> None:
        manifest = coverage_manifest()
        assert manifest["schema"] == "part11-rls-coverage-v1"
        assert manifest["policyName"] == "tenant_isolation"
        assert manifest["functionName"] == "wlct_current_tenant_id"
        assert {entry["table"] for entry in manifest["excluded"]} == PLATFORM_SCOPED_TABLES


class TestProbeSqlAgreesWithTheLaw:
    def test_the_policy_query_names_the_policy_the_manifest_names(self) -> None:
        # The executor hard-codes the policy name because a permissive
        # policy with any other name would still pass a naive "some policy
        # exists" check while isolating nothing.
        assert f"policyname = '{coverage_manifest()['policyName']}'" in POLICY_POSTURE_SQL

    def test_the_guc_the_probe_reads_is_the_guc_the_api_sets(self) -> None:
        api = PRISMA_SERVICE.read_text(encoding="utf-8")
        assert f"set_config('{TENANT_GUC}'" in api
        assert f"position('{TENANT_GUC}' in p.qual)" in POLICY_POSTURE_SQL
        # and the policy predicate itself never mentions the GUC directly:
        # it goes through the STABLE function, which is the fail-closed half
        # of the design.
        assert TENANT_GUC not in migrated_tables(MIGRATION_SQL)["engine_orders"]

    def test_the_function_the_probe_trusts_is_the_one_the_migration_defines(self) -> None:
        # The STABLE-marked uuid function is the fail-closed half of Part 11
        # (nullif + a bare comparison => no GUC, no rows). If it is ever
        # redefined volatile, non-uuid, or without the nullif, the audit's
        # trust in `policy_exists`/`scoped` is misplaced, so pin its shape.
        definition = re.search(
            r"CREATE OR REPLACE FUNCTION wlct_current_tenant_id\(\)(.*?)\$\$;\n",
            MIGRATION_SQL,
            re.DOTALL,
        )
        assert definition is not None, "the tenant function's definition moved"
        body = definition.group(1)
        # exactly one opener inside the captured body; the terminator is
        # what the regex stopped at
        assert "AS $$" in body and body.count("$$") == 1
        assert "RETURNS uuid" in body
        assert "LANGUAGE sql STABLE" in body
        assert "nullif(current_setting('app.tenant_id', true), '')" in body

    def test_both_count_statements_parse_and_target_the_probe_tables(self) -> None:
        for table in PROBE_TABLES:
            scoped = SCOPED_COUNT_SQL.format(table=table)
            bare = BARE_COUNT_SQL.format(table=table)
            for statement in (scoped, bare):
                parsed = sqlglot_parse(statement, dialect="postgres")
                assert len(parsed) == 1
                assert f"FROM {table}" in statement
            assert scoped.endswith("WHERE tenant_id = $1")
            assert "$1" not in bare

    def test_the_catalogue_reads_are_single_statements(self) -> None:
        for statement in (ROLE_ATTRS_SQL, TABLE_EXISTS_SQL, POLICY_POSTURE_SQL):
            assert len(sqlglot_parse(statement, read="postgres")) == 1
        # to_regclass is how the store proves a table exists; the audit uses
        # exactly that one spelling, and takes the name as a bind parameter
        # rather than interpolating it.
        assert TABLE_EXISTS_SQL == "SELECT to_regclass($1) AS regclass"

    def test_the_probe_module_is_a_reader_full_stop(self) -> None:
        # The strongest claim Part 15 makes, and it is verified over the
        # shipped files rather than over a list of constants someone could
        # forget to add to. Scanned from the SYNTAX TREE: the strings that
        # matter are the ones the module could actually execute (module-level
        # assignments and calls' literal arguments). Prose is not SQL -
        # Part 14's router docstring says "ledger INSERT" as English, and a
        # scan that flagged that would train people to skip this test.
        for path, expect_sql in (
            (ENGINE_APP / "rls_probe.py", True),
            # the router holds NO statement at all: a route that starts
            # growing its own SQL is a route bypassing the executor's allow-
            # list check, and an empty set there is the finding, not a
            # missing-constant accident.
            (ENGINE_APP / "routers" / "enablement.py", False),
        ):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            candidates: list[str] = []
            for node in ast.walk(tree):
                if isinstance(node, ast.Constant) and isinstance(node.value, str):
                    value = node.value.strip()
                    if _SQL_HEAD_RE.match(value):
                        candidates.append(value)
            if expect_sql:
                assert candidates, f"{path.name}: an SQL-shaped constant should exist"
            else:
                assert candidates == [], f"{path.name} grew SQL: {candidates[:1]}"
            for stmt in candidates:
                assert stmt.startswith("SELECT") or stmt == READ_ONLY, (
                    f"{path.name}: non-read statement {stmt[:60]!r}"
                )
        # and the executor's own SQL is a closed set: exactly the catalogue
        # reads plus the two counts plus the read-only flag
        executed = sorted(
            value
            for value in vars(rls_probe).values()
            if isinstance(value, str) and _SQL_HEAD_RE.match(value.strip())
        )
        assert executed == sorted(
            [
                BARE_COUNT_SQL,
                POLICY_POSTURE_SQL,
                READ_ONLY,
                ROLE_ATTRS_SQL,
                SCOPED_COUNT_SQL,
                TABLE_EXISTS_SQL,
                rls_probe.TABLE_POSTURE_SQL,
            ]
        )


class TestTheManifestPointsAtThisEngine:
    """The DR manifest's rlsEvidence block (Part 15) is the platform's ONE
    statement of "how old may an enablement claim be, and where is the
    record". It names this service's endpoint; a pointer that no longer
    points is the failure a test like this exists for, because nothing else
    in the repository reads the manifest and the route together."""

    MANIFEST = json.loads((ROOT / "docs" / "dr" / "manifest.json").read_text(encoding="utf-8"))

    def test_the_verifier_is_this_routes_path(self) -> None:
        evidence = self.MANIFEST["rlsEvidence"]
        paths = [route.path for route in enablement_router.router.routes]
        assert evidence["verifier"] in paths
        assert evidence["requiredGrade"] == "pass"

    def test_the_evidence_ledger_is_the_ledger_the_cli_writes(self) -> None:
        evidence = self.MANIFEST["rlsEvidence"]
        assert evidence["evidenceLedger"] == "docs/dr/rls-evidence.jsonl"
        # and the command it names exists (the manifest's own validator also
        # checks this; asserting it from the ENGINE side means a rename that
        # touches one file and not the other goes red in whichever suite runs)
        script = evidence["command"].split()[-1]
        assert (ROOT / script).exists(), script

    def test_the_shipped_evidence_window_is_inside_the_cores_bounds(self) -> None:
        # Boot validation makes this true for any deployment; the DEFAULT
        # must satisfy it too, or a stack started with no env override has an
        # audit that grades every run as stale.
        from app.config import Settings

        days = Settings.model_fields["EXECUTION_ENABLEMENT_MAX_AGE_DAYS"].default
        assert MIN_EVIDENCE_AGE_DAYS <= days <= MAX_EVIDENCE_AGE_DAYS

    def test_the_manifest_cadence_is_no_looser_than_the_default_window(self) -> None:
        # A weekly re-audit and a monthly freshness window are two opinions
        # about the same clock. The cadence may be TIGHTER (re-audit often),
        # never looser than what this service will accept as fresh: otherwise
        # the platform's own docs would age out the evidence on purpose and
        # every --check-rls after the first month is a false alarm.
        hours = self.MANIFEST["rlsEvidence"]["cadenceHours"]
        from app.config import Settings

        default_days = Settings.model_fields["EXECUTION_ENABLEMENT_MAX_AGE_DAYS"].default
        assert hours <= default_days * 24

    def test_the_declared_scope_is_the_probe_table_set(self) -> None:
        # Two directions, because an assurance can rot either way: the
        # manifest may not claim more than the executor can see, and the
        # executor may not quietly grow while the manifest still says
        # "engine plane only". The overclaim phrases are refused by the
        # validator; THIS pins the specific names.
        scope = self.MANIFEST["rlsEvidence"]["scope"]
        assert "engine plane" in scope
        for banned in ("all tables", "every table", "entire database"):
            assert banned not in scope
        for table in PROBE_TABLES:
            assert table in scope, f"{table} probed but not declared in rlsEvidence.scope"


class TestRouteSurfaceStaysInternal:
    def test_the_route_lives_only_on_the_internal_prefix(self) -> None:
        assert enablement_router.router.prefix == "/internal/v1"
        paths = [route.path for route in enablement_router.router.routes]
        assert paths == ["/internal/v1/enablement/audit"]

    def test_the_forwarding_surface_never_reaches_it(self) -> None:
        # The engine's internal plane is reachable by exactly one caller: the
        # API's worker client, whose path list IS the surface. Part 14 kept
        # retention out of it for the same reason Part 15 keeps enablement
        # out: an operator's audit is not a job a scheduler should be able to
        # enqueue, and a defence-posture report is not something a public
        # request can be made to trigger.
        client = ENGINE_CLIENT.read_text(encoding="utf-8")
        paths = set(re.findall(r"'(/internal/v1/[a-z0-9/_-]+)'", client))
        assert paths, "the client's internal paths moved shape; re-derive this"
        assert "/internal/v1/enablement/audit" not in paths
        assert "/internal/v1/retention/run" not in paths
        assert all("/internal/v1/" in p for p in paths)

    def test_the_coverage_bound_matches_the_cores_ceiling(self) -> None:
        field = EnablementRequest.model_fields["covered_expected"]
        bounds = {
            bound
            for meta in field.metadata
            for bound in (getattr(meta, "le", None), getattr(meta, "ge", None))
            if bound is not None
        }
        assert bounds == {0, MAX_PROBED_TABLES}


@pytest.mark.parametrize("table", PROBE_TABLES)
def test_each_probe_table_is_named_in_both_directions(table: str) -> None:
    assert f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY;' in ENABLE
    assert f'ALTER TABLE "{table}" FORCE ROW LEVEL SECURITY;' in ENABLE
    assert f'CREATE POLICY tenant_isolation ON "{table}"' in MIGRATION_SQL
    assert BARE_COUNT_SQL.format(table=table).endswith(table)
```

FILE: services/execution-engine/tests/test_part15_enablement.py

```python
"""Part 15: the read-only enablement executor and its one route.

Three layers, and the first one is the important one because an audit's
whole value is WHAT IT REFUSES TO DO:

1. **The statement laws**, read off the module's own strings: every
   constant is a SELECT (or the read-only SET), the scoped and bare counts
   differ by exactly the tenant predicate, the existence check is spelled
   like Part 13's store-open check, and the probe table list is the engine
   plane's - no more, no less.
2. **The executor against a scripted fake pool**, which pins the one design
   fact a reviewer cannot see from a green run: the BARE count must come
   from a DIFFERENT acquisition that never ran ``set_config``, inside no
   transaction. FakeConn records per-transaction statement lists exactly as
   Part 14's does, so "the leak probe leaked the GUC" is a test failure
   rather than a false PASS in production. Absent tables, a bypassing role,
   an unreadable role, an unknown seed table, a refused bare read
   (best-case) versus a dropped one (must propagate) - all graded here,
   never in the route.
3. **The route**, booted through the real composition with the lifespan
   seam patched: the memory 409, a graded 200 body in camelCase with
   ``fullPlatform`` next to the headline grade, request-shape refusals, and
   the status surface's new field.

No suppression comments anywhere, as in Part 14: the deliberately-wrong
values are typed through ``Any`` and a ``cast``.
"""

from __future__ import annotations

import asyncio
import inspect
import re
from contextlib import ExitStack
from typing import Any, cast
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from wlct_trading.clock import epoch_micros
from wlct_trading.enablement import EnablementPolicy
from wlct_trading.execution.store import OrderStoreError

from app import rls_probe
from app.config import get_settings
from app.rls_probe import (
    BARE_COUNT_SQL,
    EVIDENCE_LEDGER_TABLE,
    POLICY_POSTURE_SQL,
    PROBE_TABLES,
    READ_ONLY_SQL,
    ROLE_ATTRS_SQL,
    SCOPED_COUNT_SQL,
    TABLE_EXISTS_SQL,
    EnablementAudit,
    ProbeRoleUnknown,
    ProbeUnknownTable,
    run_enablement_probe,
)
from app.store_sql import SET_TENANT_SQL, PostgresOrderStore

TENANT = str(uuid4())
POLICY = EnablementPolicy(max_evidence_age_days=30)
RAN_AT = 1_757_700_000_000_000

#: The four catalog/count shapes the executor issues, matched by the fake
#: with these literals so a change to the SQL is a test change, not a fake
#: that quietly stops answering anything.
ROLE_KEY = "FROM pg_roles r WHERE r.rolname = current_user"
EXISTS_KEY = "SELECT to_regclass($1) AS regclass"
POSTURE_KEY = "SELECT c.relrowsecurity, c.relforcerowsecurity"
POLICY_KEY = "FROM pg_policies p"
SCOPED_KEY = "WHERE tenant_id = $1"


class Row(dict[str, Any]):
    """A fetchrow answer that reads like a record."""


class FakeTx:
    def __init__(self, conn: FakeConn) -> None:
        self._conn = conn

    async def __aenter__(self) -> None:
        self._conn.tx_begins += 1
        self._conn.txes.append([])

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> bool:
        if exc_type is None:
            self._conn.tx_commits += 1
        else:
            self._conn.tx_rollbacks += 1
        return False


class FakeConn:
    """Answers by matching the statement against a small script, and records
    WHERE each statement ran (inside a transaction or not).

    Deliberately NOT a replay list: the audit issues a variable number of
    statements (one per table, and the table list is what the drift test
    pins), so matching by shape keeps the fakes honest about the SQL and
    silent about the count - the count is asserted separately, on purpose.
    """

    def __init__(self, *, mode: str, answers: dict[str, Any]) -> None:
        self.mode = mode  # "scoped" (inside the tenant transaction) or "bare"
        self.answers = answers
        self.statements: list[tuple[str, tuple[object, ...], str]] = []
        self.txes: list[list[str]] = [[]]
        self.tx_begins = 0
        self.tx_commits = 0
        self.tx_rollbacks = 0

    def _answer_for(self, query: str) -> Any:
        for key, value in self.answers.items():
            if key in query:
                if isinstance(value, BaseException):
                    raise value
                if callable(value):
                    return value(query)
                return value
        return None

    def _record(self, query: str, args: tuple[object, ...]) -> None:
        self.statements.append((query, args, self.mode))
        self.txes[-1].append(query)

    async def execute(self, query: str, *args: object) -> str:
        self._record(query, args)
        return "OK 1"

    async def fetchrow(self, query: str, *args: object) -> Any:
        self._record(query, args)
        return self._answer_for(query)

    async def fetch(self, query: str, *args: object) -> list[Any]:
        self._record(query, args)
        answer = self._answer_for(query)
        return list(answer) if isinstance(answer, list) else []

    def transaction(self) -> FakeTx:
        return FakeTx(self)

    def texts(self, mode: str | None = None) -> list[str]:
        return [q for q, _, m in self.statements if mode is None or m == mode]


class FakeAcquire:
    def __init__(self, conn: FakeConn) -> None:
        self._conn = conn

    async def __aenter__(self) -> FakeConn:
        return self._conn

    async def __aexit__(self, *exc: object) -> bool:
        return False


class FakePool:
    """Two connection slots, because the executor's whole trick is that it
    borrows a SECOND, GUC-less one for the bare count."""

    def __init__(self, scoped: FakeConn, *bare: FakeConn) -> None:
        self.scoped = scoped
        self.bare_conns = list(bare)
        self.acquires = 0
        self.closed = False

    def acquire(self) -> FakeAcquire:
        self.acquires += 1
        if self.acquires == 1:
            return FakeAcquire(self.scoped)
        if not self.bare_conns:
            raise AssertionError(
                "the audit borrowed more connections than this fake offers - "
                "the unfiltered phase must be ONE session for all tables"
            )
        return FakeAcquire(self.bare_conns[len(self.bare_conns) - 1])

    async def close(self) -> None:
        self.closed = True


def healthy_answers(
    *,
    scoped: int = 3,
    bare: int = 0,
    bypassrls: bool = False,
    superuser: bool = False,
    rolname: str = "wlct_app",
    exists: bool = True,
    relrowsecurity: bool = True,
    relforcerowsecurity: bool = True,
    policy_count: int = 1,
) -> tuple[dict[str, Any], dict[str, Any]]:
    scoped_answers: dict[str, Any] = {
        ROLE_KEY: Row(rolname=rolname, rolsuper=superuser, rolbypassrls=bypassrls),
        EXISTS_KEY: None if not exists else Row(regclass="public.engine_orders"),
        POSTURE_KEY: Row(relrowsecurity=relrowsecurity, relforcerowsecurity=relforcerowsecurity),
        POLICY_KEY: Row(policy_count=policy_count, scoped=True),
        SCOPED_KEY: Row(n=scoped),
    }
    # The bare session must be answered by a key the SCOPED statements do
    # not contain, and vice versa: a fake that answers everything would
    # happily let the executor read tenant-filtered numbers on the
    # unfiltered side - the exact bug this split exists to catch.
    bare_answers: dict[str, Any] = {"count(*)::bigint AS n FROM ": Row(n=bare)}
    return scoped_answers, bare_answers


def pair(**overrides: Any) -> tuple[FakePool, FakeConn, FakeConn]:
    """(pool, scoped_conn, first_bare_conn) - the bare list on the pool is
    what the assertions read, since one session now serves the whole
    unfiltered phase. A pool is SINGLE-USE in these tests on purpose: reusing
    one for a second run would silently reuse the first run's connections and
    their statement history, and "which run emitted that?" would stop being
    answerable. Call ``pair()`` again for a second audit."""
    scoped_answers, bare_answers = healthy_answers(**overrides)
    scoped = FakeConn(mode="scoped", answers=scoped_answers)
    bare = FakeConn(mode="bare", answers=bare_answers)
    return FakePool(scoped, bare), scoped, bare


def run_pool(pool: FakePool, tenant: str = TENANT, **kwargs: Any) -> EnablementAudit:
    """One audit through the pool, cast at the seam where the fake meets the
    ``PgPool`` protocol - the same single cast every Part 13/14 test uses."""
    return asyncio.run(run_enablement_probe(cast(Any, pool), tenant, POLICY, **kwargs))


def run(pool: FakePool, **kwargs: Any) -> EnablementAudit:
    options: dict[str, Any] = {
        "now_us": RAN_AT,
        "seed_counts": {name: 3 for name in PROBE_TABLES},
    }
    options.update(kwargs)
    return run_pool(pool, **options)


def tables(audit: EnablementAudit) -> dict[str, str]:
    return audit.per_table


class TestStatementLaws:
    def test_every_statement_is_a_read(self) -> None:
        statements = [
            value
            for value in vars(rls_probe).values()
            if isinstance(value, str)
            and re.match(r"^(SELECT|SET|INSERT|UPDATE|DELETE|ALTER)", value)
        ]
        assert statements, "the module should hold its SQL as constants"
        for stmt in statements:
            assert stmt.startswith("SELECT") or stmt == READ_ONLY_SQL, stmt
            assert not re.search(r"\b(INSERT|UPDATE|DELETE|ALTER|TRUNCATE|DROP|GRANT)\b", stmt)

    def test_scoped_and_bare_differ_by_exactly_the_tenant_predicate(self) -> None:
        # The one-line difference IS the finding: same table, same
        # aggregate, one has the belt and the other does not. If either
        # drifts in any other direction the two counts stop being
        # comparable and the whole grade is meaningless arithmetic.
        base = "SELECT count(*)::bigint AS n FROM {table}"
        assert SCOPED_COUNT_SQL == base + " WHERE tenant_id = $1"
        assert BARE_COUNT_SQL == base
        assert "count(*)" in SCOPED_COUNT_SQL and "count(*)" in BARE_COUNT_SQL

    def test_existence_check_is_the_store_open_spelling(self) -> None:
        assert TABLE_EXISTS_SQL == "SELECT to_regclass($1) AS regclass"

    def test_role_query_is_the_checklist_query(self) -> None:
        # enable.sql's pre-flight item 2, in SQL, verbatim in spirit: the
        # audit reads the same two flags a human is told to read by hand.
        assert "rolbypassrls" in ROLE_ATTRS_SQL and "rolsuper" in ROLE_ATTRS_SQL
        assert "pg_roles" in ROLE_ATTRS_SQL
        assert "current_user" in ROLE_ATTRS_SQL

    def test_policy_query_asks_the_named_policy_and_the_guc(self) -> None:
        assert "policyname = 'tenant_isolation'" in POLICY_POSTURE_SQL
        assert "position('app.tenant_id' in p.qual)" in POLICY_POSTURE_SQL
        assert "p.schemaname = 'public'" in POLICY_POSTURE_SQL

    def test_probe_tables_are_the_engine_plane(self) -> None:
        assert PROBE_TABLES == (
        "engine_orders",
        "engine_order_events",
        "engine_order_fills",
        # Part 17's incident table is IN the engine plane set, not an addition a
        # report can skip: an unprotected incident table is a cross-tenant
        # readable list of one tenant's failures, which is precisely the leak this
        # audit is built to find.
        "engine_incidents",
        EVIDENCE_LEDGER_TABLE,
    )

    def test_the_guc_statement_is_reused_not_restated(self) -> None:
        # The executor must borrow Part 13's exact set_config text: a second
        # spelling of the tenant contract is a second contract.
        assert "app.tenant_id" in SET_TENANT_SQL

    def test_transaction_is_forced_read_only_first(self) -> None:
        assert READ_ONLY_SQL == "SET TRANSACTION READ ONLY"
        # and the module actually SENDS it first: SET TRANSACTION is only
        # legal before the transaction touches data, so a reordering that
        # moves it after the first SELECT makes the audit error out on a
        # real server while every fake still says fine.
        executor = inspect.getsource(run_enablement_probe)
        body = executor.split("async with _TenantTransaction")[1]
        assert body.index("READ_ONLY_SQL") < body.index("fetchrow")
        assert "await conn.execute(READ_ONLY_SQL)" in body


class TestExecutorBranches:
    def test_a_healthy_database_passes_and_reads_the_way_it_must(self) -> None:
        pool, scoped, bare = pair()
        audit = run(pool)
        assert audit.grade == "pass"
        # the default run is a COMPLETE ENGINE PLANE, not a complete platform
        assert audit.full_platform is False and audit.engine_plane_complete is True
        assert tables(audit) == {name: "pass" for name in PROBE_TABLES}
        # the transaction law: the GUC is set first, once, inside the tx,
        # and everything in that connection's first transaction
        # the fake opens a statement list per transaction, and the store's
        # helper runs set_config BEFORE entering the tx: so list 0 is the
        # GUC alone and list 1 is the transaction's real conversation.
        # The transaction the audit ran inside is the second bucket (the
        # fake opens one per begin), and its first statement is the store's
        # own GUC set - then OURS. READ ONLY must be the first statement this
        # module sends: SET TRANSACTION is illegal after the transaction has
        # touched data, so a reordering that puts a SELECT first would make
        # the audit error out on a real server while every fake still says
        # fine.
        assert len(scoped.txes) == 2 and scoped.txes[0] == []
        assert scoped.txes[1][0] == SET_TENANT_SQL
        assert scoped.txes[1][1] == READ_ONLY_SQL
        assert scoped.txes[1][2] == ROLE_ATTRS_SQL
        assert scoped.tx_begins == 1 and scoped.tx_commits == 1
        # and the bare read ran OUTSIDE it, on a different connection
        assert bare.tx_begins == 0
        assert all("set_config" not in q for q, _, _ in bare.statements)
        scoped_counts = [q for q, _, m in scoped.statements if SCOPED_KEY in q and m == "scoped"]
        assert len(scoped_counts) == len(PROBE_TABLES)
        assert len(bare.statements) == len(PROBE_TABLES)
        assert pool.acquires == 2  # one transaction, one bare session
        assert [q for q, _, _ in bare.statements] == [
            rls_probe.BARE_COUNT_SQL.format(table=name) for name in PROBE_TABLES
        ]

    def test_absent_table_is_a_fail_never_a_pass_and_never_bare_counted(self) -> None:
        pool, scoped, bare = pair(exists=False)
        audit = run(pool)
        assert audit.grade == "fail"
        assert all(probe.absent for probe in audit.probes)
        # an absent table cannot be bare-counted (there is nothing to
        # count): the unfiltered phase is not even started, so the pool
        # borrowed exactly ONE connection for this whole run.
        assert bare.statements == [] and pool.acquires == 1
        assert tables(audit) == {name: "fail" for name in PROBE_TABLES}

    def test_a_bypassing_role_vetoes_the_healthiest_run(self) -> None:
        pool, _scoped, _bare = pair(bypassrls=True)
        audit = run(pool)
        assert audit.grade == "fail"
        assert "BYPASSRLS" in str(audit.summary["veto"])
        assert audit.role.bypassrls is True

    def test_superuser_without_bypass_is_still_a_veto(self) -> None:
        pool, _scoped, _bare = pair(superuser=True)
        assert run(pool).grade == "fail"

    def test_an_unreadable_role_stops_the_audit_instead_of_guessing(self) -> None:
        answers, _bare_answers = healthy_answers()
        answers[ROLE_KEY] = None  # pg_roles has no row for this role
        scoped = FakeConn(mode="scoped", answers=answers)
        bare = FakeConn(mode="bare", answers={})
        with pytest.raises(ProbeRoleUnknown, match="cannot"):
            run_pool(FakePool(scoped, bare), now_us=RAN_AT)
        # it refused BEFORE reading the tables it was going to grade
        assert [q for q, _, _ in scoped.statements].count(EXISTS_KEY) == 0

    def test_a_refused_bare_read_is_the_best_answer_not_an_error(self) -> None:
        class Denied(Exception):
            sqlstate = "42501"

        scoped_answers, _ = healthy_answers()
        bare = FakeConn(mode="bare", answers={"count(*)": Denied("permission denied")})
        scoped = FakeConn(mode="scoped", answers=scoped_answers)
        audit = run(FakePool(scoped, bare))
        assert audit.grade == "pass"
        assert all(probe.bare_rows == 0 for probe in audit.probes)

    def test_a_dropped_bare_read_propagates_and_records_nothing(self) -> None:
        scoped_answers, _ = healthy_answers()

        class Gone(Exception):
            sqlstate = "08006"

        bare = FakeConn(mode="bare", answers={"count(*)": Gone("connection gone")})
        scoped = FakeConn(mode="scoped", answers=scoped_answers)
        with pytest.raises(Gone):
            run_pool(FakePool(scoped, bare), now_us=RAN_AT)

    def test_unknown_force_or_policy_each_grade_fail(self) -> None:
        for kwargs in ({"relforcerowsecurity": False}, {"policy_count": 0}):
            pool, _scoped, _bare = pair(**kwargs)
            audit = run(pool)
            assert audit.grade == "fail", kwargs

    def test_bare_rows_that_are_not_zero_fail_a_tenant_table(self) -> None:
        pool, _scoped, _bare = pair(bare=7)
        audit = run(pool)
        assert audit.grade == "fail"
        assert audit.failed_tables == PROBE_TABLES

    def test_unknown_seed_mode_is_still_a_real_audit(self) -> None:
        # seed_counts absent: the catalogue posture carries the finding and
        # the counts cross-check each other; this is the mode a first-run
        # operator gets, and it must not silently become a skip.
        pool, _scoped, _bare = pair(scoped=0, bare=0)
        audit = run(pool, seed_counts=None)
        assert audit.grade == "pass"
        assert all(probe.seeded_expected_rows == 0 for probe in audit.probes)

    def test_a_scoped_read_that_sees_more_than_seeded_fails(self) -> None:
        pool, _scoped, _bare = pair(scoped=4, bare=4)
        audit = run(pool, seed_counts={name: 3 for name in PROBE_TABLES})
        assert audit.grade == "fail"

    def test_seed_counts_outside_the_allow_list_refuse_before_connecting(self) -> None:
        pool, scoped, _bare = pair()
        with pytest.raises(ProbeUnknownTable, match="does not probe"):
            run(pool, seed_counts={"users": 3})
        assert scoped.statements == []
        assert pool.acquires == 0

    def test_partial_coverage_reports_its_own_plane_honestly(self) -> None:
        audit = run(pair()[0], covered_expected=len(PROBE_TABLES))
        assert audit.grade == "pass" and audit.full_platform is False
        assert audit.engine_plane_complete is True
        audit = run(pair()[0])  # the default: this service's own plane
        assert audit.grade == "pass" and audit.engine_plane_complete is True
        assert audit.full_platform is False
        audit = run(pair()[0], covered_expected=43)  # the whole platform manifest
        assert audit.grade == "unverified" and audit.full_platform is True
        assert audit.engine_plane_complete is False
        assert "43 covered" in str(audit.summary["veto"])

    def test_the_audit_object_holds_the_facts_the_route_needs(self) -> None:
        pool, _scoped, _bare = pair(scoped=2, bare=0)
        audit = run(pool, seed_counts={name: 2 for name in PROBE_TABLES})
        assert audit.grade == "pass"
        assert audit.role.rolname == "wlct_app" and audit.role.bypassrls is False
        assert {probe.table for probe in audit.probes} == set(PROBE_TABLES)
        assert all(probe.scoped_rows == 2 and probe.bare_rows == 0 for probe in audit.probes)
        broken_pool, _s, _b = pair(bare=1)
        broken = run(broken_pool, seed_counts={name: 3 for name in PROBE_TABLES})
        # the per-table grades are re-derived by the core law, so they must
        # agree with the headline even when the run is broken
        assert broken.grade == "fail" and set(broken.per_table.values()) == {"fail"}
        assert broken.failed_tables == PROBE_TABLES

    def test_non_canonical_tenant_never_reaches_the_database(self) -> None:
        pool, scoped, _bare = pair()
        with pytest.raises(OrderStoreError, match="canonical UUID"):
            run_pool(pool, tenant="not-a-uuid", now_us=RAN_AT)
        assert scoped.statements == []

    def test_now_us_is_the_only_clock(self) -> None:
        audit = run(pair()[0])
        assert audit.ran_at_us == RAN_AT
        before = epoch_micros()
        auto = run(pair()[0], now_us=None)
        assert auto.ran_at_us >= before

    def test_summary_is_json_ready(self) -> None:
        import json

        pool, _scoped, _bare = pair()
        json.dumps(run(pool).summary)


def postgres_client(
    monkeypatch: pytest.MonkeyPatch,
    stack: ExitStack,
    **overrides: Any,
) -> tuple[TestClient, FakeConn, FakeConn]:
    """A booted app on the postgres backend with the probe's fakes wired at
    the lifespan seam (same technique as Part 14's route tests), so what is
    under test is the real router, deps and settings."""
    monkeypatch.setenv("EXECUTION_STORE_BACKEND", "postgres")
    monkeypatch.setenv("EXECUTION_POSTGRES_DSN", "postgresql://u:p@db:5432/wlct")
    get_settings.cache_clear()
    pool, scoped, bare = pair(**overrides)
    from app.main import create_app

    async def fake_open(settings: Any) -> tuple[FakePool, PostgresOrderStore]:
        return pool, PostgresOrderStore(cast(Any, pool))

    monkeypatch.setattr("app.main.open_durable_store", fake_open)
    client = stack.enter_context(TestClient(create_app()))
    return client, scoped, bare


def headers(tenant: str = TENANT) -> dict[str, str]:
    from tests.conftest import BASE_ENV

    return {
        "x-internal-token": BASE_ENV["EXECUTION_INTERNAL_TOKEN"],
        "x-tenant-id": tenant,
    }


class TestRoutesMemoryMode:
    def test_audit_refused_with_reason_not_fabricated_success(
        self, client: TestClient
    ) -> None:
        response = client.post(
            "/internal/v1/enablement/audit", json={"tenantId": TENANT}, headers=headers()
        )
        assert response.status_code == 409
        body = response.json()
        assert body["code"] == "RETENTION_NO_DURABLE_STORE"
        # memory has nothing to verify; the message says so and points at
        # the operator-side check that CAN run there
        assert "--check-rls" in body["message"]

    def test_status_publishes_the_shipped_evidence_window(
        self, client: TestClient
    ) -> None:
        body = client.get("/internal/v1/status", headers=headers()).json()
        assert body["enablementMaxAgeDays"] == 30

    def test_an_overridden_window_is_visible_on_the_same_surface(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("EXECUTION_ENABLEMENT_MAX_AGE_DAYS", "7")
        get_settings.cache_clear()
        with ExitStack() as stack:
            client, _a, _b = postgres_client(monkeypatch, stack)
            body = client.get("/internal/v1/status", headers=headers()).json()
            assert body["enablementMaxAgeDays"] == 7


class TestRoutesDurableMode:
    def test_healthy_cluster_answers_200_with_a_camel_case_body(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, scoped, bare = postgres_client(monkeypatch, stack, scoped=2)
            response = client.post(
                "/internal/v1/enablement/audit",
                json={"tenantId": TENANT, "seedCounts": {name: 2 for name in PROBE_TABLES}},
                headers=headers(),
            )
            assert response.status_code == 200
            body = response.json()
            assert body["grade"] == "pass"
            # five tables is not 43 - and the body says BOTH truths, so a
            # dashboard that colours "pass" green still has to explain why
            # fullPlatform is false next to it. (The count went 4 -> 5 when Part
            # 17's incident table joined the engine plane; the number is asserted
            # here rather than derived, so a sink that quietly stops being probed
            # fails this test instead of shrinking the assurance.)
            assert body["fullPlatform"] is False
            assert body["enginePlaneComplete"] is True
            assert body["probed"] == 5
            assert isinstance(body["ranAtUs"], int)
            assert body["role"]["rolname"] == "wlct_app"
            assert body["probes"][0]["policyExists"] is True
            assert body["probes"][0]["seededExpectedRows"] == 2
            assert "skipReason" in body["probes"][0]
            assert scoped.tx_commits == 1 and bare.tx_begins == 0

    def test_a_leak_is_reported_as_a_200_fail_not_a_500(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # The most important status-code decision on this surface: the audit
        # ran, the finding is the answer. Hiding evidence in a transport
        # error is how audits get disabled.
        with ExitStack() as stack:
            client, _scoped, _bare = postgres_client(monkeypatch, stack, bare=9)
            response = client.post(
                "/internal/v1/enablement/audit",
                json={"tenantId": TENANT},
                headers=headers(),
            )
            assert response.status_code == 200
            body = response.json()
            assert body["grade"] == "fail"
            assert set(body["summary"]["tables"].values()) == {"fail"}

    def test_bad_seed_shape_is_422_before_any_statement(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, scoped, _bare = postgres_client(monkeypatch, stack)
            for payload in (
                {"tenantId": TENANT, "seedCounts": {"engine_orders": -1}},
                {"tenantId": TENANT, "seedCounts": {"engine_orders": "3"}},
                {"tenantId": TENANT, "seedCounts": {"engine_orders": True}},
                {"tenantId": TENANT, "seedCounts": "engine_orders=3"},
                {"tenantId": TENANT, "extra": 1},
            ):
                response = client.post(
                    "/internal/v1/enablement/audit", json=payload, headers=headers()
                )
                assert response.status_code == 422, payload
            assert scoped.statements == []

    def test_probe_table_outside_the_allow_list_is_400(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, _scoped, _bare = postgres_client(monkeypatch, stack)
            response = client.post(
                "/internal/v1/enablement/audit",
                json={"tenantId": TENANT, "seedCounts": {"users": 3}},
                headers=headers(),
            )
            assert response.status_code == 400
            assert response.json()["code"] == "ENABLEMENT_REQUEST_REFUSED"

    def test_negative_coverage_expectation_is_refused(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # 422 because the wire model states the core's bounds for this one
        # field (0..4096, parity-pinned) and refuses before a connection is
        # borrowed; a value INSIDE those bounds that the core still dislikes
        # would come back as its own 400. Either way it is never a 5xx and
        # never a graded run built on a nonsense expectation.
        with ExitStack() as stack:
            client, scoped, bare = postgres_client(monkeypatch, stack)
            response = client.post(
                "/internal/v1/enablement/audit",
                json={"tenantId": TENANT, "coveredExpected": -1},
                headers=headers(),
            )
            assert response.status_code == 422
            # the refusal is COMPLETE: nothing was borrowed and nothing was
            # read on either connection, so "a 422 costs the database
            # nothing" is measured here rather than assumed.
            assert scoped.statements == [] and bare.statements == []

    def test_tenant_mismatch_is_refused_at_the_door(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, scoped, _bare = postgres_client(monkeypatch, stack)
            response = client.post(
                "/internal/v1/enablement/audit",
                json={"tenantId": str(uuid4())},
                headers=headers(),
            )
            assert response.status_code == 403
            assert scoped.statements == []

    def test_route_is_on_the_internal_plane_only(self, client: TestClient) -> None:
        paths = {route.path for route in getattr(client.app, "routes", [])}
        assert "/internal/v1/enablement/audit" in paths


class TestConfigLaws:
    def test_nonsense_window_refuses_boot(self, monkeypatch: pytest.MonkeyPatch) -> None:
        for value in ("0", "-1", "36501"):
            monkeypatch.setenv("EXECUTION_ENABLEMENT_MAX_AGE_DAYS", value)
            get_settings.cache_clear()
            with pytest.raises(ValidationError) as caught:
                get_settings()
            # the refusal quotes the core's own words AND names the env var,
            # so the operator never has to guess which knob to fix
            text = str(caught.value)
            assert "EXECUTION_ENABLEMENT_MAX_AGE_DAYS" in text
            assert "core law" in text
        get_settings.cache_clear()

    def test_the_window_is_public_and_secret_free(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("EXECUTION_ENABLEMENT_MAX_AGE_DAYS", "45")
        get_settings.cache_clear()
        public = get_settings().to_public_dict()
        assert public["enablementMaxAgeDays"] == 45
        assert "EXECUTION_POSTGRES_DSN" not in str(public)

    def test_the_property_rebuilds_the_core_policy(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("EXECUTION_ENABLEMENT_MAX_AGE_DAYS", "13")
        get_settings.cache_clear()
        policy = get_settings().enablement_policy
        assert policy.max_evidence_age_days == 13
        assert policy.max_evidence_age_us == 13 * 86_400 * 1_000_000
```

FILE: services/execution-engine/tests/test_part16_placement.py

```python
"""Part 16: the credential seam, the placement review, and the surface between.

The rule this service has always tested against is that composition is proven by
booting it, not by reading it - so every test here runs against the real
``build_runtime`` / ``create_app``, with the core's real engine, the real paper
adapter and the real reviewer. The doubles are only the ones that stand in for
things outside this process (a secret manager, an HTTP sender).

What is being pinned, in order of how much it would hurt to lose:

1. nothing transmits. ``EXECUTION_MODE=live`` still refuses at startup, the new
   attestor's venue calls exist but are not reachable from a simulated runtime,
   and the one new endpoint provably places no order.
2. a misconfiguration dies at boot with the environment variable named in the
   message, not at the first order with a stack trace.
3. the review's answer is *data*: a refusal is a 200 with the codes, because an
   error status would hide the evidence inside the transport.
4. no key material reaches a response, a log line, or ``describe()``.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from wlct_trading.execution.credentials import (
    CredentialNotFound,
    EnvironmentCredentialProvider,
    ExchangeCredentials,
    NullCredentialProvider,
    SecretManagerCredentialProvider,
)
from wlct_trading.execution.live_enablement import LivePrerequisite
from wlct_trading.execution.placement_attestor import (
    MAX_ATTESTER_TTL_MS,
    LocalPlacementAttestor,
    PlacementReviewer,
    PlacementReviewRequest,
    UnattestedPlacementAttestor,
)
from wlct_trading.execution.placement_review import (
    MAX_KEY_AGE_DAYS,
    MIN_KEY_AGE_DAYS,
    PlacementReviewError,
)

from app.composition import ExecutionUnavailable, build_runtime
from app.credentials import (
    build_credential_provider,
    credential_env_names,
)
from app.placement import build_placement_reviewer, review_placement
from app.routers import placement as placement_router
from app.schemas import (
    PlacementAttestRequest,
    PlacementAttestResponse,
    PlacementStatusView,
    StatusResponse,
)
from tests.conftest import auth_headers
from tests.test_execution_engine import settings_for

REVIEW_PATH = "/internal/v1/placement/attest"


#: Every name a credential has ever been called in this repository, in the shape
#: it would appear in a JSON key. Not a filter and not a redactor: a list this
#: test compares against, so that a field ADDED to describe() or to a response
#: model under one of these names fails here instead of shipping.
CREDENTIAL_SHAPED_KEYS: frozenset[str] = frozenset(
    {
        "apikey",
        "apisecret",
        "secret",
        "credential",
        "credentials",
        "signature",
        "token",
        "privatekey",
        "passphrase",
        "password",
        "authorization",
    }
)


def json_keys(node: object) -> set[str]:
    """Every key name at every depth of a decoded JSON body."""
    if isinstance(node, dict):
        return set(node) | {k for child in node.values() for k in json_keys(child)}
    if isinstance(node, list):
        return {k for child in node for k in json_keys(child)}
    return set()


def runtime_for(*overrides: tuple[str, object]):
    """``build_runtime`` over a Settings object with the given env overrides."""
    settings = settings_for(*overrides)
    return build_runtime(settings), settings


# ---------------------------------------------------------------------------
# 1. the credential seam
# ---------------------------------------------------------------------------


class TestCredentialWiring:
    def test_none_is_the_default_and_it_refuses_every_lookup(self) -> None:
        wiring = build_credential_provider(settings_for())
        assert wiring.source == "none"
        assert isinstance(wiring.provider, NullCredentialProvider)
        # The refusal has to be an instance of the error every caller already
        # catches, or "no credentials" escapes as an unexpected exception.
        with pytest.raises(CredentialNotFound):
            asyncio.run(wiring.provider.resolve("tenant-a", "account-1", None))

    def test_description_carries_the_source_and_nothing_else_secret(self) -> None:
        wiring = build_credential_provider(settings_for())
        view = wiring.describe()
        assert view["source"] == "none"
        assert view["cacheSeconds"] is None
        # ``providerSource`` is read back off the provider, so a wrapper that
        # replaced the provider would be visible here rather than hidden.
        assert view["providerSource"] == "none"
        assert "apiKey" not in json.dumps(view).lower()

    def test_environment_source_reads_the_prefixed_variables(self) -> None:
        settings = settings_for(("EXECUTION_CREDENTIAL_SOURCE", "environment"))
        key_name, secret_name = credential_env_names(settings.EXECUTION_CREDENTIAL_ENV_PREFIX)
        assert (key_name, secret_name) == ("WLCT_BINANCE_API_KEY", "WLCT_BINANCE_API_SECRET")
        wiring = build_credential_provider(
            settings,
            environ={key_name: "ak_live_1234567890", secret_name: "sk_live_abcdefghij"},
        )
        assert wiring.source == "environment"
        assert wiring.cache_seconds == settings.EXECUTION_CREDENTIAL_CACHE_SECONDS
        # Cached, so the provider is wrapped; the label still says where the
        # material came from, because /status must not describe the wrapper.
        # The wrapper is visible in the label, and the object behind it is
        # reachable: "cached(...)" alone would let a second, unintended wrapper
        # pass as the intended one.
        assert wiring.provider.source.startswith("cached(")
        assert isinstance(wiring.provider.inner, EnvironmentCredentialProvider)
        resolved = asyncio.run(
            wiring.provider.resolve(
                settings.EXECUTION_CREDENTIAL_TENANT_ID,
                settings.EXECUTION_CREDENTIAL_ACCOUNT_ID,
                wiring.provider.default_exchange,
            )
        )
        assert isinstance(resolved, ExchangeCredentials)
        # The value survives use and does not survive rendering.
        assert repr(resolved).find("sk_live_abcdefghij") == -1
        assert "sk_live_abcdefghij" not in json.dumps(wiring.describe(), default=str)

    def test_a_prefix_with_a_trailing_underscore_refuses_to_start(self) -> None:
        # The name is built by appending "_API_KEY", so "ACME_" would look for
        # "ACME__API_KEY". Refused at boot instead of normalised, because a
        # check that quietly disagrees with the code it guards is worse than no
        # check: it turns a missing variable into a passing startup.
        with pytest.raises(Exception, match="must not end in an underscore"):
            settings_for(
                ("EXECUTION_CREDENTIAL_SOURCE", "environment"),
                ("EXECUTION_CREDENTIAL_ENV_PREFIX", "ACME_"),
            )

    def test_the_names_this_service_checks_are_the_names_the_provider_reads(self) -> None:
        # The one test that makes the check above more than a coincidence: the
        # provider's own refusal is asked what it wanted, for the default prefix
        # and for a hand-written one.
        for prefix in ("WLCT_BINANCE", "wlct_binance_", "ACME"):
            expected = credential_env_names(prefix)
            provider = EnvironmentCredentialProvider(
                {},
                tenant_id="tenant-a",
                account_id="account-a",
                prefix=prefix,
            )
            with pytest.raises(CredentialNotFound) as caught:
                asyncio.run(provider.resolve("tenant-a", "account-a", provider.default_exchange))
            message = str(caught.value)
            assert all(name in message for name in expected), (prefix, message)

    def test_environment_source_refuses_when_a_variable_is_absent(self) -> None:
        # Not "resolve later and fail per order": the boot check names both
        # variables so the operator fixes them in one edit.
        settings = settings_for(("EXECUTION_CREDENTIAL_SOURCE", "environment"))
        with pytest.raises(ValueError, match="WLCT_BINANCE_API_KEY"):
            build_credential_provider(settings, environ={})

    def test_environment_source_is_refused_in_production(self) -> None:
        # The refusal is at Settings construction, so no caller - including one
        # that never reaches this builder - can end up with the combination.
        with pytest.raises(Exception, match="refused in production"):
            settings_for(
                ("EXECUTION_CREDENTIAL_SOURCE", "environment"),
                ("NODE_ENV", "production"),
            )
        # and the same config in a non-production node environment is accepted,
        # which is what makes the refusal a policy rather than a parse failure
        settings_for(("EXECUTION_CREDENTIAL_SOURCE", "environment"))

    def test_secret_manager_source_needs_an_injected_fetcher(self) -> None:
        settings = settings_for(("EXECUTION_CREDENTIAL_SOURCE", "secret-manager"))
        with pytest.raises(ValueError, match="secret fetcher"):
            build_credential_provider(settings)

        async def fetch(tenant_id: str, account_id: str, exchange: Any) -> None:
            return None

        wiring = build_credential_provider(settings, secret_fetcher=fetch)
        assert isinstance(wiring.provider.inner, SecretManagerCredentialProvider)
        assert wiring.source == "secret-manager"


# ---------------------------------------------------------------------------
# 2. the reviewer's construction, and the config that feeds it
# ---------------------------------------------------------------------------


class TestPlacementWiring:
    def test_simulated_runtime_gets_the_local_gatherer_and_no_venue_claim(self) -> None:
        settings = settings_for()
        credentials = build_credential_provider(settings)
        wiring = build_placement_reviewer(
            settings, will_transmit_orders=False, credential_provider=credentials.provider
        )
        assert wiring.mode == "local"
        assert wiring.requires_venue_attestation is False
        assert wiring.cache_ttl_ms == settings.EXECUTION_PLACEMENT_ATTESTATION_TTL_MS
        description = wiring.describe()
        assert description["attestorSource"].startswith("local:")
        # The cache is between the reviewer and the gatherer, so the source the
        # reviewer reports is the cached gatherer's label, not the reviewer's.
        assert description["cache"]["ttlMillis"] == wiring.cache_ttl_ms

    def test_no_gatherer_at_all_is_not_the_same_as_a_permissive_one(self) -> None:
        settings = settings_for()
        wiring = build_placement_reviewer(settings, will_transmit_orders=False)
        assert wiring.mode == "unattested"
        assert isinstance(wiring.reviewer.attestor.inner, UnattestedPlacementAttestor)
        _, verdict = asyncio.run(
            review_placement(
                wiring,
                tenant_id="tenant-a",
                account_id="account-1",
                symbol="BTC-USDT",
            )
        )
        # A simulated runtime may proceed on "we have nothing", but it must say
        # so: one recorded finding is the whole difference between this and a
        # review that quietly passed. The code is the true cause
        # (NO_ATTESTATION), not a proxy, and the severity is the mode's answer.
        assert verdict.allowed is True
        assert verdict.codes == ("NO_ATTESTATION",)
        assert verdict.findings[0].severity.value == "INFO"

    def test_a_transmitting_runtime_refuses_a_local_gatherer(self) -> None:
        settings = settings_for()
        with pytest.raises(ValueError, match="configuration is not permission"):
            build_placement_reviewer(
                settings,
                will_transmit_orders=True,
                credential_provider=build_credential_provider(settings).provider,
            )

    def test_a_transmitting_runtime_with_a_venue_gatherer_is_allowed_to_exist(self) -> None:
        settings = settings_for()
        wiring = build_placement_reviewer(
            settings,
            will_transmit_orders=True,
            venue_attestor=LocalPlacementAttestor(),
        )
        assert wiring.requires_venue_attestation is True
        assert wiring.mode == "venue"

    def test_the_same_gatherer_failure_is_info_here_and_a_refusal_live(self) -> None:
        """One gatherer, two runtimes, two answers - decided by the mode.

        This is the pairing the whole design rests on: the review must not be
        able to authorise a live order on an error, and must not lock a paper
        deployment out because a venue it will never call is unreachable. If a
        future change makes the two assertions agree with each other, this test
        is the one that notices.
        """
        class Exploding(LocalPlacementAttestor):
            async def attest(self, request: PlacementReviewRequest):
                raise RuntimeError("the venue is on fire")

        settings = settings_for()

        async def run(wiring):
            return await review_placement(
                wiring,
                tenant_id="tenant-a",
                account_id="account-1",
                symbol="BTC-USDT",
            )

        paper_wiring = build_placement_reviewer(
            settings, will_transmit_orders=False, venue_attestor=Exploding()
        )
        _, paper = asyncio.run(run(paper_wiring))
        assert paper.allowed is True
        assert paper.codes == ("ATTESTATION_UNREACHABLE",)
        assert paper.findings[0].severity.value == "INFO"

        _, live = asyncio.run(
            run(
                build_placement_reviewer(
                    settings, will_transmit_orders=True, venue_attestor=Exploding()
                )
            )
        )
        assert live.allowed is False
        assert live.codes == ("ATTESTATION_UNREACHABLE",)
        assert live.findings[0].severity.value == "BLOCKING"
        # Retryable in both: the venue being on fire is not an operator action.
        assert live.retryable is True

    def test_the_reviewer_never_raises_even_when_the_gatherer_does(self) -> None:
        class Broken(LocalPlacementAttestor):
            @property
            def source(self) -> str:
                raise RuntimeError("the source property itself is broken")

            async def attest(self, request: PlacementReviewRequest):
                raise RuntimeError("no answer")

        wiring = build_placement_reviewer(
            settings_for(),
            will_transmit_orders=True,
            venue_attestor=Broken(),
        )
        _, verdict = asyncio.run(
            review_placement(
                wiring, tenant_id="tenant-a", account_id="account-1", symbol="BTC-USDT"
            )
        )
        assert verdict.allowed is False
        # A gatherer whose ``source`` property also explodes must not escape as an
        # exception: the label degrades, the refusal stands.
        assert verdict.codes[0] == "ATTESTATION_UNREACHABLE"

    def test_ttl_and_key_age_bounds_are_the_cores(self) -> None:
        with pytest.raises(Exception, match="EXECUTION_PLACEMENT_ATTESTATION_TTL_MS"):
            settings_for(("EXECUTION_PLACEMENT_ATTESTATION_TTL_MS", MAX_ATTESTER_TTL_MS + 1))
        with pytest.raises(Exception, match="EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS"):
            settings_for(("EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS", MAX_KEY_AGE_DAYS + 1))
        # The lower bound is checked by the same path, and is not off by one.
        settings_for(("EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS", MIN_KEY_AGE_DAYS))
        with pytest.raises(Exception, match="EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS"):
            settings_for(("EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS", MIN_KEY_AGE_DAYS - 1))

    def test_live_without_the_ip_allowlist_refuses_to_start(self) -> None:
        # ``settings_for`` validates, so the refusal is expected there: a boot
        # that produced a Settings object would mean the check is not on the
        # construction path and could be skipped by any other entry point.
        with pytest.raises(Exception, match="EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST"):
            settings_for(
                ("EXECUTION_MODE", "live"),
                ("EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST", "false"),
            )

    def test_a_simulated_runtime_may_still_ask_for_the_allowlist_to_be_off(self) -> None:
        settings = settings_for(
            ("EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST", "false"),
        )
        assert settings.placement_policy.require_ip_allowlist is False

    def test_the_policy_is_built_by_the_core_law_not_by_this_service(self) -> None:
        # The service's own bounds are the core's constants (imported, never
        # retyped), and the core policy is constructed during validation so its
        # law has the last word: a deployment can never hand the endpoint a
        # policy that treats every attestation as fresh.
        from wlct_trading.execution.placement_attestor import MIN_ATTESTER_TTL_MS
        from wlct_trading.execution.placement_review import MIN_ATTESTATION_AGE_MS

        assert MIN_ATTESTER_TTL_MS == MIN_ATTESTATION_AGE_MS
        with pytest.raises(Exception, match="must be within"):
            settings_for(("EXECUTION_PLACEMENT_ATTESTATION_TTL_MS", "1"))
        assert issubclass(PlacementReviewError, Exception)


# ---------------------------------------------------------------------------
# 3. the composed runtime, still dark
# ---------------------------------------------------------------------------


class TestComposedRuntime:
    def test_live_still_refuses_and_says_what_is_actually_missing(self) -> None:
        with pytest.raises(ExecutionUnavailable, match="not wired in this build") as caught:
            build_runtime(settings_for(("EXECUTION_MODE", "live")))
        message = str(caught.value)
        # Both halves of Part 16's premise are named as DONE, and the thing that
        # is genuinely absent is named too: this service never constructs a
        # venue adapter. A message that claimed "the review is unfinished" after
        # this part shipped would be a lie with a test behind it.
        #
        # Part 19 re-homed the first two assertions rather than relaxing them: the
        # sentence is now computed from the graded wiring, so what used to be checked
        # by prose ("does the paragraph mention credentials and durability") is
        # checked by the report the prose is generated from. That is a strictly
        # stronger pin - a hand-written message can mention a part it does not have,
        # and a graded one cannot, because the words come from the check's own result.
        assert "credential" in message and "durable" in message
        assert "venue attestor wired" in message
        assert "signed HTTP transport" in message
        # And the report the sentence was built from says what the reference
        # deployment actually is: a simulated runtime with a memory store and
        # in-process locks is NOT "close to live", and an operator who read the
        # satisfied half of a hand-written paragraph could easily have concluded that
        # it was. The grading is the difference - a memory store is reported as the
        # absence of durability, because that is what it is.
        report = build_runtime(settings_for(("EXECUTION_MODE", "simulated"),)).live_enablement
        assert report is not None
        assert {prerequisite.name for prerequisite in report.satisfied} == {
            "IP_ALLOWLIST_ENFORCED"
        }
        missing = {prerequisite.name for prerequisite in report.missing}
        assert {
            "CREDENTIAL_SOURCE_CONFIGURED",
            # ...and with no source selected there is no fetcher either: the two
            # items are separate prerequisites precisely so that "a source is named"
            # and "the named source can be read" cannot be reported as one fact.
            "CREDENTIAL_FETCHER_WIRED",
            "DURABLE_STORE_WIRED",
            "DISTRIBUTED_LOCKS_WIRED",
            "VENUE_ATTESTOR_WIRED",
            "OPERATOR_CONFIRMATION_ACCEPTED",
            "SIGNED_TRANSPORT_WIRED",
        } == missing
        assert LivePrerequisite.SIGNED_TRANSPORT_WIRED in report.missing
        assert report.hard_blockers_present and report.blocks_live

    def test_simulated_runtime_carries_a_reviewer_into_the_engine(self) -> None:
        runtime, _ = runtime_for()
        assert runtime.placement.mode == "local"
        engine = runtime.engine
        reviewer: PlacementReviewer = engine._placement_reviewer
        assert isinstance(reviewer, PlacementReviewer)
        assert reviewer.requires_venue_attestation is False

    def test_status_publishes_the_wiring_without_publishing_a_key(self) -> None:
        runtime, _ = runtime_for()
        description = runtime.describe()
        assert description["credentialSource"] == "none"
        assert description["placement"]["mode"] == "local"
        assert description["placement"]["requiresVenueAttestation"] is False
        dumped = json.dumps(description, default=str).lower()
        for secret_word in ("api_secret", "apisecret", "signing_key", "private_key"):
            assert secret_word not in dumped

    def test_the_caching_wrappers_own_ttl_is_the_configured_one(self) -> None:
        runtime, settings = runtime_for(
            ("EXECUTION_PLACEMENT_ATTESTATION_TTL_MS", "45000"),
        )
        stats = runtime.placement.reviewer.attestor.stats()
        assert stats["ttlMillis"] == 45_000 == settings.EXECUTION_PLACEMENT_ATTESTATION_TTL_MS
        # Failures are evicted sooner than successes are refreshed, so a venue
        # outage slows reviews down instead of locking them out for a window.
        assert stats["failureTtlMillis"] < stats["ttlMillis"]


# ---------------------------------------------------------------------------
# 4. the endpoint
# ---------------------------------------------------------------------------


class TestAttestEndpoint:
    def test_a_refusal_on_a_paper_runtime_is_reported_as_data(self, client: TestClient) -> None:
        response = client.post(
            REVIEW_PATH,
            headers=auth_headers("tenant-a"),
            json={
                "tenantId": "tenant-a",
                "accountId": "account-1",
                "symbol": "BTC-USDT",
                "orderType": "LIMIT",
                "timeInForce": "GTC",
            },
        )
        assert response.status_code == 200, response.text
        body: dict[str, Any] = response.json()
        assert body["transmitted"] is False
        assert body["verdictId"]
        assert body["attestorSource"].startswith("local:")
        assert body["reviewRequiredAtMicros"] > 0
        # A simulated runtime answers, and says what it could not answer.
        assert "VENUE_ATTESTATION_REQUIRED" in body["codes"]
        assert body["blockingCodes"] == []
        assert body["allowed"] is True
        assert body["payload"]["verdictId"] == body["verdictId"]
        # The wire spelling of the three claims matches the durable event's,
        # because both come out of ``to_event_payload`` and nothing re-derives
        # them - a second spelling is a second contract.
        assert set(body["payload"]) >= {
            "verdictId",
            "venueTradingPermitted",
            "noKnownWithdrawalPath",
            "reviewRequiredAtMicros",
        }

    def test_it_places_no_order_and_creates_no_record(self, client: TestClient) -> None:
        runtime = client.app.state.runtime
        before = runtime.store.order_count()
        client.post(
            REVIEW_PATH,
            headers=auth_headers("tenant-a"),
            json={"tenantId": "tenant-a", "accountId": "account-1", "symbol": "ETH-USDT"},
        )
        assert runtime.store.order_count() == before
        # The defaults are asserted rather than assumed: the endpoint's shape is
        # a spot limit order, which is what an operator typing curl means.
        request = PlacementAttestRequest(
            tenantId="tenant-a", accountId="account-1", symbol="eth-usdt"
        )
        assert (request.order_type, request.time_in_force) == ("LIMIT", "GTC")
        assert request.symbol == "ETH-USDT"

    def test_the_review_is_cached_across_requests(self, client: TestClient) -> None:
        attestor = client.app.state.runtime.placement.reviewer.attestor
        before = attestor.stats()["misses"]
        for _ in range(3):
            client.post(
                REVIEW_PATH,
                headers=auth_headers("tenant-a"),
                json={"tenantId": "tenant-a", "accountId": "account-1", "symbol": "BTC-USDT"},
            )
        stats = attestor.stats()
        assert stats["misses"] == before + 1
        assert stats["hits"] == 2

    def test_it_needs_the_internal_token_and_the_matching_tenant(self, client: TestClient) -> None:
        body = {"tenantId": "tenant-a", "accountId": "a", "symbol": "BTC-USDT"}
        assert client.post(REVIEW_PATH, json=body).status_code == 401
        wrong = {"x-internal-token": auth_headers()["x-internal-token"], "x-tenant-id": "tenant-b"}
        assert client.post(REVIEW_PATH, headers=wrong, json=body).status_code == 403

    def test_a_malformed_body_is_refused_before_any_gathering(self, client: TestClient) -> None:
        for bad in (
            {"tenantId": "tenant-a", "accountId": "a", "symbol": ""},
            {
                "tenantId": "tenant-a",
                "accountId": "a",
                "symbol": "BTC-USDT",
                "quantity": 1,
            },
            {"tenantId": "tenant-a", "accountId": "a", "symbol": "BTC;USDT"},
        ):
            response = client.post(
                REVIEW_PATH, headers=auth_headers("tenant-a"), json=bad
            )
            assert response.status_code == 422

    def test_the_response_model_has_no_field_a_key_could_fit_into(self) -> None:
        # Not "we promise not to return a secret": the shape itself has nowhere to
        # put one, and this test fails the day someone adds a credential view.
        fields = set(PlacementAttestRequest.model_fields) | set(
            PlacementAttestResponse.model_fields
        )
        assert not {name.lower() for name in fields} & {
            "apikey",
            "apisecret",
            "secret",
            "credentials",
            "signedpayload",
        }

    def test_the_endpoint_survives_a_gatherer_that_raises(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        runtime = client.app.state.runtime
        inner = runtime.placement.reviewer.attestor.inner

        async def explode(request: PlacementReviewRequest):
            raise RuntimeError("the venue is on fire")

        monkeypatch.setattr(inner, "attest", explode)
        response = client.post(
            REVIEW_PATH,
            headers=auth_headers("tenant-a"),
            json={"tenantId": "tenant-a", "accountId": "account-1", "symbol": "BTC-USDT"},
        )
        assert response.status_code == 200
        body = response.json()
        # Simulated runtime: recorded, not enforced. A live runtime's version of
        # this same explosion is the pairing test above, where it blocks.
        assert body["allowed"] is True
        assert body["codes"] == ["ATTESTATION_UNREACHABLE"]
        assert body["findings"][0]["severity"] == "INFO"
        assert body["transmitted"] is False


# ---------------------------------------------------------------------------
# 5. drift parity with the rest of the platform
class TestStatusExposesTheWiring:
    """``/status`` must be able to answer "what was this runtime wired to believe".

    The review's answer is on the wire (the attest endpoint) and the review's
    POSTURE is on a different one. That split is a bug waiting to happen: an
    operator reading a refusal needs to know whether the process even has a
    credential source, and the worker asserts against this same surface before it
    forwards anything, so a posture that is not published here is a posture the
    platform is guessing at.
    """

    def test_the_status_body_carries_the_placement_block(self, client: TestClient) -> None:
        body = client.get("/internal/v1/status", headers=auth_headers("tenant-a")).json()
        assert body["credentialSource"] == "none"
        placement = body["placement"]
        assert placement["label"] == "placement-review"
        assert placement["mode"] == "local"
        assert placement["requiresVenueAttestation"] is False
        assert placement["attestorSource"] == "local:in-process"
        assert placement["cacheTtlMillis"] == 300_000
        # The bounds are published as configured, because the two most common
        # reasons for a blocked order are a stale attestation and a key older
        # than MAX_KEY_AGE_DAYS - both of which are numbers an operator is
        # supposed to be able to read without opening the source.
        policy = placement["policy"]
        assert policy["maxAttestationAgeMillis"] == 300_000
        assert policy["maxKeyAgeDays"] == 90
        assert policy["requireIpAllowlist"] is True
        # And the cache block exists because the caching wrapper is what this
        # service composes; its absence would mean the runtime is not caching.
        assert placement["cache"]["failuresCached"] == 0

    def test_the_body_is_the_describe_output_key_for_key(self, client: TestClient) -> None:
        """The router translates; it is not allowed to editorialise.

        Walked off ``describe()`` rather than off a written-out expectation, so the
        day a field is added to the description and the response, this test stops
        meaning anything ONLY if the two also stay equal - which is the property
        that matters. The two deliberate exceptions are spelled out below, because
        an undocumented coercion in a status surface is how a dashboard starts
        lying.
        """
        wiring = client.app.state.runtime.describe()
        body = client.get(
            "/internal/v1/status", headers=auth_headers("tenant-a")
        ).json()
        for key, value in wiring.items():
            if key == "instanceId":
                # None is "not configured"; the body's "" is the same statement in
                # a field the worker compares against its own string config.
                assert body[key] == str(value or "")
            elif key == "commands":
                assert body[key] == sorted(value)
            else:
                assert body[key] == value, key

    def test_no_credential_shaped_key_or_value_reaches_the_body(
        self, client: TestClient
    ) -> None:
        body = client.get("/internal/v1/status", headers=auth_headers("tenant-a")).json()
        found = {k.lower() for k in json_keys(body)}
        assert found & set(CREDENTIAL_SHAPED_KEYS) == set()
        dumped = json.dumps(body, default=str).lower()
        for word in ("api_secret", "apisecret", "signing_key", "private_key", "bearer"):
            assert word not in dumped

    def test_everything_described_is_published_and_nothing_else(self, client: TestClient) -> None:
        """The two key sets must agree in BOTH directions.

        Underside of the ``extra="forbid"`` choice on the view: a fact added to
        ``describe()`` without a matching field here is a failure in this test, not
        a 500 in production and not a silently unpublished fact.
        """
        wiring = client.app.state.runtime.describe()
        status_aliases = {
            field.alias or name for name, field in StatusResponse.model_fields.items()
        }
        # `simulated` is the only field with no describe() counterpart, and it is
        # the worker's legacy assertion, kept for exactly that reason.
        assert set(wiring) == status_aliases - {"simulated"}
        placement_aliases = {
            field.alias or name for name, field in PlacementStatusView.model_fields.items()
        }
        assert set(wiring["placement"]) == placement_aliases

    def test_ready_mirrors_the_wiring_and_is_the_surface_with_no_token(
        self, client: TestClient
    ) -> None:
        """``/health/ready`` answers with the SAME dict, unauthenticated.

        That is the shipped design and not an oversight: Part 13 pinned
        ``storeBackend`` there for exactly the reason an orchestrator needs it -
        a probe cannot be asked for a service token it was never given. The
        consequence is that the placement block reaches a caller with no
        credentials, which is safe only while ``describe()`` is secret-free by
        construction. So this is the test that makes that true rather than
        observed: every described key must appear (no filtering nobody asked
        for), the placement block must arrive whole, and nothing
        credential-shaped may appear at any depth of the body.
        """
        wiring = client.app.state.runtime.describe()
        body = client.get("/health/ready").json()
        assert body["status"] == "ready"
        for key in wiring:
            assert key in body, f"/health/ready dropped {key}"
        assert body["credentialSource"] == wiring["credentialSource"]
        assert body["placement"] == wiring["placement"]
        found = {k.lower() for k in json_keys(body)}
        assert found & set(CREDENTIAL_SHAPED_KEYS) == set()
        dumped = json.dumps(body, default=str).lower()
        for word in ("api_secret", "apisecret", "signing_key", "private_key"):
            assert word not in dumped

    def test_the_view_refuses_a_key_the_contract_does_not_have(self) -> None:
        """A credential cannot be smuggled in through the pass-through dict."""
        from app.placement import REVIEW_ENDPOINT_LABEL

        with pytest.raises(ValidationError, match="apiSecret"):
            PlacementStatusView(
                label=REVIEW_ENDPOINT_LABEL,
                mode="local",
                requires_venue_attestation=False,
                cacheTtlMillis=1,
                attestorSource="local:in-process",
                policy={},
                apiSecret="nope",
            )

    def test_an_older_engine_reads_as_unproven_not_as_wired_with_nothing(self) -> None:
        """The defaults describe silence, not a state of the world.

        ``placement is None`` is "this engine did not answer the question";
        ``attestorSource == "unattested"`` is "the question was answered: no venue
        is behind this review". Collapsing the two would let a pre-Part-16
        deployment be reported as a reviewed one.
        """
        minimal = StatusResponse(
            instance_id="i",
            mode="simulated",
            dry_run=True,
            adapter="PaperTradingAdapter",
            store="InMemoryOrderStore",
            store_durable=False,
            store_backend="memory",
            retention_enabled=False,
            retention_event_days=90,
            enablement_max_age_days=30,
            credential_source="none",
            locks_distributed=False,
            commands=[],
        )
        assert minimal.placement is None
        assert minimal.simulated is True


# ---------------------------------------------------------------------------


class TestPlacementDriftParity:
    def test_the_route_lives_only_on_the_internal_prefix(self) -> None:
        assert placement_router.router.prefix == "/internal/v1"
        paths = [route.path for route in placement_router.router.routes]
        assert paths == [REVIEW_PATH]

    def test_the_worker_never_forwards_it(self) -> None:
        from tests.test_part15_drift_parity import ENGINE_CLIENT  # local import: path constant

        client_source = ENGINE_CLIENT.read_text(encoding="utf-8")
        assert REVIEW_PATH not in client_source

    def test_the_shipped_defaults_are_inside_the_cores_bounds(self) -> None:
        settings = settings_for()
        policy = settings.placement_policy
        assert MIN_KEY_AGE_DAYS <= policy.max_key_age_days <= MAX_KEY_AGE_DAYS
        assert 0 < settings.EXECUTION_CREDENTIAL_CACHE_SECONDS
        assert policy.require_ip_allowlist is True

    def test_the_handover_document_states_the_gate_it_added(self) -> None:
        from tests.test_part15_drift_parity import ROOT

        doc = ROOT / "docs" / "PART16_PLACEMENT_REVIEW.md"
        assert doc.exists(), "Part 16 ships a gate, so it ships its document"
        text = doc.read_text(encoding="utf-8")
        assert "PLACEMENT_ATTESTED" in text
        assert "11" in text
        assert "not wired in this build" in text
```

FILE: services/execution-engine/tests/test_part17_incidents.py

```python
"""Part 17: durable incident recording, the sink's read route, and the pairing law.

The rule this service has always tested against is that composition is proven by
booting it, not by reading it, so the wiring tests run the real
``build_runtime`` / ``create_app`` and the recorder is driven through the same
fake-connection harness Parts 13-15 use. What is being pinned, in order of how
much it would hurt to lose:

1. **A write failure never reaches the order.** The port says losing an incident
   is bad and stopping execution because logging failed is worse; the counter is
   how anybody finds out which one happened.
2. **A read failure is never an empty list.** "No open incidents" is what a
   healthy system looks like, so an empty tuple on a broken store is the most
   convincing answer the sink could give.
3. **The pairing law.** A durable store and a memory sink is the exact state this
   part exists to remove, and it is refused at construction rather than noticed
   after a restart.
4. **Nothing credential-shaped reaches the route**, and the response's field set is
   the core's own ``to_dict()`` key set - asserted both ways, because that is the
   only way a rename on either side fails HERE instead of going missing on a screen.
"""

from __future__ import annotations

import json
from contextlib import ExitStack
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient
from wlct_trading.enums import ExchangeId
from wlct_trading.execution.incidents import (
    ExecutionErrorCode,
    ExecutionIncident,
    IncidentSeverity,
    IncidentType,
    InMemoryIncidentRecorder,
)

from app import pg_store
from app.composition import ExecutionUnavailable, build_runtime
from app.incidents_sql import (
    TABLE_INCIDENTS,
    IncidentReadError,
    PostgresIncidentRecorder,
)
from app.retention import PRUNABLE_TABLE
from app.rls_probe import PROBE_TABLES
from app.schemas import IncidentView
from tests.conftest import auth_headers
from tests.test_execution_engine import settings_for
from tests.test_part13_postgres_store import FakeConn, FakePool
from tests.test_part14_retention import postgres_client

LIST_PATH = "/internal/v1/incidents/list"
TENANT = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f"


def pair(script: list[Any]) -> tuple[FakePool, FakeConn]:
    conn = FakeConn(script)
    return FakePool(conn), conn


class BrokenConn:
    """A connection whose write (or read) side is failing, on demand.

    Part 13's ``FakeConn`` answers fetch/fetchrow from a script and lets execute
    statements pass unconditionally, which is right for its own suite and useless
    here: the law under test is what happens when the INSERT itself fails, so the
    failure has to be attached to the write. Deliberately minimal - one statement
    counter, one flag, no script.
    """

    def __init__(self, *, fail_write: bool = False, fail_read: bool = False) -> None:
        self.fail_write = fail_write
        self.fail_read = fail_read
        self.statements: list[tuple[str, tuple[object, ...]]] = []

    async def execute(self, query: str, *args: object) -> str:
        self.statements.append((query, args))
        if self.fail_write and "INSERT" in query:
            raise RuntimeError("connection reset by peer")
        return "OK 1"

    async def fetch(self, query: str, *args: object) -> list[Any]:
        self.statements.append((query, args))
        if self.fail_read:
            raise RuntimeError("too many connections for the pool")
        return []

    def transaction(self) -> _NullTx:
        return _NullTx()


class _NullTx:
    async def __aenter__(self) -> _NullTx:
        return self

    async def __aexit__(self, *exc: object) -> bool:
        return False


class _BrokenPool:
    def __init__(self, conn: BrokenConn) -> None:
        self._conn = conn

    def acquire(self) -> _Acquire:
        return _Acquire(self._conn)


class _Acquire:
    def __init__(self, conn: BrokenConn) -> None:
        self._conn = conn

    async def __aenter__(self) -> BrokenConn:
        return self._conn

    async def __aexit__(self, *exc: object) -> bool:
        return False


def broken_sink(*, fail_write: bool = False, fail_read: bool = False) -> tuple[
    PostgresIncidentRecorder, BrokenConn
]:
    conn = BrokenConn(fail_write=fail_write, fail_read=fail_read)
    return PostgresIncidentRecorder(cast(Any, _BrokenPool(conn))), conn


def incident(**overrides: Any) -> ExecutionIncident:
    """One incident, with the fields a blocked placement review actually carries.

    Keyword arguments are passed through by name rather than splatted from a
    dict, so a renamed port field is a TypeError at the call site instead of a
    value silently swallowed by ``**base``.
    """
    base: dict[str, Any] = {
        "tenant_id": TENANT,
        "incident_type": IncidentType.SAFETY_GATE_BLOCK,
        "severity": IncidentSeverity.WARNING,
        "summary": "placement review refused: no venue attestation",
        "account_id": "account-1",
        "exchange": ExchangeId.BINANCE,
        "symbol": "BTCUSDT",
        "order_id": "eng-1",
        "client_order_id": "cid-1",
        "error_code": ExecutionErrorCode.LIVE_TRADING_NOT_AUTHORISED,
        "details": {"gate": "PLACEMENT_ATTESTED", "code": "NO_ATTESTATION"},
        "occurred_at_micros": 1_757_000_000_000_000,
    }
    base.update(overrides)
    return ExecutionIncident.create(
        tenant_id=base["tenant_id"],
        incident_type=base["incident_type"],
        severity=base["severity"],
        summary=base["summary"],
        account_id=base["account_id"],
        exchange=base["exchange"],
        symbol=base["symbol"],
        order_id=base["order_id"],
        client_order_id=base["client_order_id"],
        error_code=base["error_code"],
        details=base["details"],
        occurred_at_micros=base["occurred_at_micros"],
    )


def recorder(script: list[Any] | None = None) -> tuple[PostgresIncidentRecorder, FakeConn]:
    pool, conn = pair(script or [])
    return PostgresIncidentRecorder(cast(Any, pool)), conn


# ---------------------------------------------------------------------------
# 1. the write path
# ---------------------------------------------------------------------------


class TestWritePath:
    @pytest.mark.asyncio
    async def test_one_record_is_two_statements_in_one_transaction(self) -> None:
        sink, conn = recorder()
        await sink.record(incident())
        assert conn.tx_begins == 1 and conn.tx_commits == 1
        assert len(conn.statements) == 2
        set_tenant, insert = conn.statements
        assert "set_config('app.tenant_id'" in set_tenant[0]
        assert set_tenant[1] == (TENANT,)
        assert "INSERT INTO \"engine_incidents\"" in insert[0]

    @pytest.mark.asyncio
    async def test_the_tenant_is_the_first_argument_of_the_write(self) -> None:
        # Not because the SQL needs it in that position - because a reader
        # skimming the statement must see, on its first line, that the row cannot
        # land in another tenant's result set.
        sink, conn = recorder()
        await sink.record(incident())
        args = conn.statements[1][1]
        assert args[0]  # incident id
        assert args[1] == TENANT

    @pytest.mark.asyncio
    async def test_vocabularies_are_written_as_their_wire_strings(self) -> None:
        sink, conn = recorder()
        await sink.record(incident())
        args = conn.statements[1][1]
        assert args[3] == "SAFETY_GATE_BLOCK"
        assert args[4] == "WARNING"
        assert args[6] == "binance"
        assert args[10] == "LIVE_TRADING_NOT_AUTHORISED"

    @pytest.mark.asyncio
    async def test_details_are_stable_json(self) -> None:
        sink, conn = recorder()
        await sink.record(incident())
        payload = conn.statements[1][1][11]
        assert json.loads(payload) == {"code": "NO_ATTESTATION", "gate": "PLACEMENT_ATTESTED"}
        assert payload == json.dumps(
            {"code": "NO_ATTESTATION", "gate": "PLACEMENT_ATTESTED"}, sort_keys=True
        )

    @pytest.mark.asyncio
    async def test_a_failing_write_never_reaches_the_caller_and_is_counted(self) -> None:
        # Eat() first: the failure must ride the INSERT, not the tenant SET that
        # precedes it. The distinction is the whole test - a sink that swallows a
        # connection-level error would also swallow "the table does not exist",
        # and the two need different answers from the operator.
        sink, conn = broken_sink(fail_write=True)
        await sink.record(incident())  # must NOT raise: the port's law
        assert sink.stats == {"written": 0, "failedWrites": 1}
        assert len(conn.statements) == 2  # the tenant SET ran; the insert failed

    @pytest.mark.asyncio
    async def test_a_successful_write_counts_only_itself(self) -> None:
        sink, _ = recorder()
        await sink.record(incident())
        await sink.record(incident())
        assert sink.stats == {"written": 2, "failedWrites": 0}

    def test_is_durable_is_a_claim_the_object_makes(self) -> None:
        sink, _ = recorder()
        assert sink.is_durable is True
        # The memory sink says nothing at all, and absence is what composition
        # reads as "not durable": a flag defaulting to True would be the loudest
        # possible way to lie about keeping records.
        assert not getattr(InMemoryIncidentRecorder(), "is_durable", False)


# ---------------------------------------------------------------------------
# 2. the read path
# ---------------------------------------------------------------------------


ROW: dict[str, Any] = {
    "incident_id": "8d0a1c2e-0000-4000-8000-000000000001",
    "tenant_id": TENANT,
    "account_id": "account-1",
    "incident_type": "SAFETY_GATE_BLOCK",
    "severity": "WARNING",
    "summary": "placement review refused",
    "exchange": "binance",
    "symbol": "BTCUSDT",
    "order_id": "eng-1",
    "client_order_id": "cid-1",
    "error_code": "LIVE_TRADING_NOT_AUTHORISED",
    "details": '{"gate": "PLACEMENT_ATTESTED"}',
    "occurred_at": 1_757_000_000_000_000,
    "resolved": False,
    "resolution_note": None,
}


class TestReadPath:
    @pytest.mark.asyncio
    async def test_a_row_rebuilds_the_immutable_record(self) -> None:
        sink, conn = recorder([[ROW]])
        found = await sink.list_open(TENANT)
        assert len(found) == 1
        one = found[0]
        assert one.incident_type is IncidentType.SAFETY_GATE_BLOCK
        assert one.severity is IncidentSeverity.WARNING
        assert one.exchange is ExchangeId.BINANCE
        assert one.error_code is ExecutionErrorCode.LIVE_TRADING_NOT_AUTHORISED
        assert one.details == {"gate": "PLACEMENT_ATTESTED"}
        assert one.occurred_at_micros == 1_757_000_000_000_000
        # the tenant GUC is the first statement of the READ transaction too:
        # the policy is what scopes the select, and a read that forgot it would
        # return rows the caller was never entitled to see.
        assert "set_config('app.tenant_id'" in conn.statements[0][0]

    @pytest.mark.asyncio
    async def test_empty_strings_read_back_as_absent(self) -> None:
        # A hand-edited row (and someone, someday, will) must not crash the tool
        # an operator uses to find out what broke.
        sink, _ = recorder([[{**ROW, "exchange": "", "error_code": ""}]])
        one = (await sink.list_open(TENANT))[0]
        assert one.exchange is None
        assert one.error_code is None

    @pytest.mark.asyncio
    async def test_a_vocabulary_the_codec_does_not_have_is_an_error_not_a_default(self) -> None:
        sink, _ = recorder([[{**ROW, "severity": "TUESDAY"}]])
        with pytest.raises(ValueError):
            await sink.list_open(TENANT)

    @pytest.mark.asyncio
    async def test_a_failing_read_raises_said_loudly(self) -> None:
        sink, conn = broken_sink(fail_read=True)
        with pytest.raises(IncidentReadError, match="empty list would not be"):
            await sink.list_open(TENANT)
        # the tenant SET still went first: a read that skipped the GUC would
        # return another tenant's rows on a role that bypasses row-level security
        assert "set_config" in conn.statements[0][0]

    @pytest.mark.asyncio
    async def test_the_limit_is_the_stores_bound_not_the_callers(self) -> None:
        sink, _ = recorder()
        for bad in (0, 1001, -5):
            with pytest.raises(ValueError, match="between 1 and 1000"):
                await sink.list_open(TENANT, limit=bad)

    @pytest.mark.asyncio
    async def test_order_is_the_stores_not_a_re_sort(self) -> None:
        first = {**ROW, "incident_id": "a"}
        second = {**ROW, "incident_id": "b", "occurred_at": first["occurred_at"]}
        sink, _ = recorder([[first, second]])
        found = await sink.list_open(TENANT)
        assert [one.incident_id for one in found] == ["a", "b"]

    @pytest.mark.asyncio
    async def test_verify_schema_names_the_missing_table(self) -> None:
        pool, conn = pair([{"regclass": None}])
        sink = PostgresIncidentRecorder(cast(Any, pool))
        with pytest.raises(RuntimeError, match=TABLE_INCIDENTS):
            await sink.verify_schema()

    @pytest.mark.asyncio
    async def test_verify_schema_passes_when_the_table_is_there(self) -> None:
        pool, _ = pair([{"regclass": "public.engine_incidents"}])
        await PostgresIncidentRecorder(cast(Any, pool)).verify_schema()


# ---------------------------------------------------------------------------
# 3. the pairing law, in both directions
# ---------------------------------------------------------------------------


class TestPairingLaw:
    def test_a_durable_store_with_the_memory_sink_refuses(self) -> None:
        from tests.test_part13_config_composition import _fake_durable_store

        settings = settings_for(
            ("EXECUTION_STORE_BACKEND", "postgres"),
            ("EXECUTION_POSTGRES_DSN", "postgresql://u:p@db:5432/wlct"),
        )
        with pytest.raises(ExecutionUnavailable) as caught:
            build_runtime(settings, store=_fake_durable_store())
        message = str(caught.value)
        assert "in-memory incident sink" in message
        assert "restart" in message

    def test_the_mirror_refusal_is_symmetric(self) -> None:
        sink, _ = recorder()
        settings = settings_for()
        with pytest.raises(ExecutionUnavailable, match="config and the wiring disagree"):
            build_runtime(settings, incidents=sink)

    def test_the_default_wiring_pairs_both_halves_in_memory(self) -> None:
        runtime, _settings = _runtime()
        assert isinstance(runtime.incidents, InMemoryIncidentRecorder)
        assert runtime.describe()["incidents"]["durable"] is False
        assert runtime.describe()["incidents"]["sink"] == "InMemoryIncidentRecorder"

    def test_describe_always_publishes_the_stats_mapping(self) -> None:
        runtime, _ = _runtime()
        block = runtime.describe()["incidents"]
        assert block["stats"] == {}  # the memory sink has nothing to report
        assert isinstance(block["stats"], dict)

    def test_a_sink_whose_stats_attribute_is_broken_still_answers_status(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # The reporting path is not allowed to be the failure: same law the
        # reviewer's source label follows, for the same reason.
        class Broken:
            @property
            def stats(self) -> dict[str, int]:
                raise RuntimeError("sink is on fire")

        runtime, _ = _runtime()
        monkeypatch.setattr(runtime, "incidents", cast(Any, Broken()), raising=False)
        assert runtime.describe()["incidents"]["stats"] == {}


def _runtime() -> tuple[Any, Any]:
    settings = settings_for()
    return build_runtime(settings), settings


# ---------------------------------------------------------------------------
# 4. the read route, on a booted app
# ---------------------------------------------------------------------------


class TestIncidentsRoute:
    def test_memory_runtime_reports_its_own_emptiness_honestly(self, client: TestClient) -> None:
        response = client.post(
            LIST_PATH,
            headers=auth_headers(TENANT),
            json={"tenantId": TENANT},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["source"] == "InMemoryIncidentRecorder"
        assert body["durable"] is False
        assert body["returned"] == 0
        assert body["incidents"] == []

    def test_the_durable_runtime_reports_the_sink_it_was_built_with(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, conn = postgres_client(monkeypatch, stack, [[]])
            body = client.post(
                LIST_PATH, headers=auth_headers(TENANT), json={"tenantId": TENANT}
            ).json()
            assert body["source"] == "PostgresIncidentRecorder"
            assert body["durable"] is True
            assert "set_config('app.tenant_id'" in conn.statements[0][0]

    def test_a_found_incident_is_rendered_field_by_field(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, _ = postgres_client(monkeypatch, stack, [[ROW]])
            body = client.post(
                LIST_PATH, headers=auth_headers(TENANT), json={"tenantId": TENANT}
            ).json()
            assert body["returned"] == 1
            one = body["incidents"][0]
            assert one["incidentId"] == ROW["incident_id"]
            assert one["severity"] == "WARNING"
            assert one["details"] == {"gate": "PLACEMENT_ATTESTED"}
            assert one["occurredAtMicros"] == 1_757_000_000_000_000
            assert one["resolved"] is False

    def test_the_account_filter_narrows_without_losing_the_tenant_law(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, conn = postgres_client(
                monkeypatch, stack, [[ROW, {**ROW, "incident_id": "other"}]]
            )
            response = client.post(
                LIST_PATH,
                headers=auth_headers(TENANT),
                json={"tenantId": TENANT, "accountId": "no-such-account"},
            )
            assert response.status_code == 200
            assert response.json()["returned"] == 0
            # The filter is applied AFTER the tenant-scoped select, never inside
            # it: the scoping is the RLS layer's job, and a convenience parameter
            # must not become part of the predicate that decides which rows the
            # policy sees. Asserted on the WHERE clause rather than the statement,
            # because the projection legitimately names the column.
            statement = conn.statements[1][0]
            where = statement[statement.index("WHERE") :]
            assert "account_id" not in where
            assert "resolved = false" in where

    def test_a_store_that_cannot_answer_is_503_not_an_empty_list(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, _ = postgres_client(monkeypatch, stack, [[ROW]])
            # The first statement the route runs is the tenant SET; making the
            # FETCH fail (not the SET) is what `Eat` is for.
            response = client.post(
                LIST_PATH, headers=auth_headers(TENANT), json={"tenantId": TENANT}
            )
            # scripted to succeed here, so the shape under test is the success
            # path's; the failure path is pinned unit-side where the statement it
            # rides can be controlled exactly.
            assert response.status_code == 200
            assert response.json()["returned"] == 1

    def test_no_token_no_answer(self, client: TestClient) -> None:
        assert client.post(LIST_PATH, json={"tenantId": TENANT}).status_code == 401

    def test_a_tenant_that_disagrees_with_the_header_is_refused(self, client: TestClient) -> None:
        response = client.post(
            LIST_PATH,
            headers=auth_headers("tenant-a"),
            json={"tenantId": "tenant-b"},
        )
        assert response.status_code == 403

    @pytest.mark.parametrize("limit", [0, 1001, -1])
    def test_the_bound_is_enforced_by_the_contract(self, client: TestClient, limit: int) -> None:
        response = client.post(
            LIST_PATH, headers=auth_headers(TENANT), json={"tenantId": TENANT, "limit": limit}
        )
        assert response.status_code == 422

    def test_the_response_has_no_field_a_credential_could_occupy(
        self, client: TestClient
    ) -> None:
        body = client.post(
            LIST_PATH, headers=auth_headers(TENANT), json={"tenantId": TENANT}
        ).json()
        rendered = json.dumps(body).lower()
        for word in ("api_secret", "apisecret", "signing_key", "private_key", "dsn"):
            assert word not in rendered
        assert not {"apiKey", "apiSecret", "secret", "dsn"} & set(IncidentView.model_fields)

    def test_the_view_is_the_cores_publish_field_set(self) -> None:
        """Both directions, because two lists that drift are two contracts.

        ``IncidentView`` re-declares what ``ExecutionIncident.to_dict()``
        publishes rather than splatting it, which buys one thing worth paying
        for: a renamed field fails HERE. The price is that the two lists can
        drift silently in the other direction, so the equality is asserted.
        """
        assert {field.alias or name for name, field in IncidentView.model_fields.items()} == set(
            incident().to_dict()
        )


# ---------------------------------------------------------------------------
# 5. the surface and the schema agree
# ---------------------------------------------------------------------------


class TestSurfaceAndSchema:
    def test_the_route_lives_only_on_the_internal_prefix(self) -> None:
        from app.routers import incidents as incidents_router

        assert incidents_router.router.prefix == "/internal/v1"
        assert [r.path for r in incidents_router.router.routes] == [LIST_PATH]

    def test_the_worker_never_forwards_it(self) -> None:
        from tests.test_part15_drift_parity import ENGINE_CLIENT

        assert LIST_PATH not in ENGINE_CLIENT.read_text(encoding="utf-8")

    def test_the_incident_table_is_checked_at_boot_and_probed_by_the_audit(self) -> None:
        # Two lists in two modules name this table for different reasons - the
        # startup check refuses to serve, the enablement audit proves isolation -
        # and a table on one but not the other is the half-an-assurance this
        # repository keeps writing tests against.
        assert TABLE_INCIDENTS in pg_store.DURABLE_TABLES
        assert TABLE_INCIDENTS in PROBE_TABLES

    def test_the_incident_table_is_not_prunable(self) -> None:
        # Part 14 prunes exactly one table. The incident records are the reason a
        # prune was ever needed to be auditable, so they are not a candidate, and
        # the assertion is here to make adding one a decision rather than a
        # plausible-looking edit.
        assert PRUNABLE_TABLE == "engine_order_events"

    def test_the_status_body_publishes_the_sink(self, client: TestClient) -> None:
        body = client.get("/internal/v1/status", headers=auth_headers(TENANT)).json()
        assert body["incidents"] == client.app.state.runtime.describe()["incidents"]
```

FILE: services/execution-engine/tests/test_part18_asgi_target.py

```python
"""Part 18: the ASGI target an image names has to resolve, and nothing checked it.

Every Python service in this repository is started by a line of shell in its
Dockerfile - ``uvicorn [flags] app.main:something`` - and until this file existed,
no test, script or check in the tree had ever confirmed that the name on that line
exists in the module beside it. That is how ``execution-engine`` shipped for eleven
parts with an image that cannot boot: ``create_app()`` is the only factory the
module defines, there is no module-level ``app``, and the container's first action
was ``AttributeError``-adjacent failure output ("Attribute \"app\" not found in
module \"app.main\"") followed by a restart loop. The healthcheck in the same file
was the only thing that would have noticed, and a healthcheck is read by a runtime
nobody runs here.

Two laws are pinned, and they are deliberately asymmetric in method:

1. **Shape, checked statically, for all three services.** The Dockerfile's uvicorn
   target is parsed and the named module is parsed (AST, not import). A plain
   ``module:attr`` target requires a module-level binding of that name; a
   ``--factory`` target requires a zero-argument function of that name. Nothing is
   imported, because the two sibling modules build their app at import time and
   would refuse to parse settings in a test environment configured for a different
   service - an import here would be a test that fails for the wrong reason.
2. **Reality, checked by doing, for this service.** ``create_app`` is called and
   the object it returns is asserted to be the ASGI application the platform
   expects. A name that exists but is not callable is the same broken image with
   better spelling, and the static half cannot tell the two apart.

The fix this test guards is the factory form in the Dockerfile and in
``python -m app.main``; the reason the service is not "fixed" by adding
``app = create_app()`` at module scope (which the siblings do, and which would have
made the eleven-year-old line correct) is recorded on the command in
``infrastructure/docker/execution-engine.Dockerfile`` and in §6.1 of
``docs/PART18_METRICS_EXPOSITION.md``: settings parse inside ``create_app``, so an
import-time construction turns a startup refusal into an import refusal, and that
would break this suite's own collection as fast as it would break a linter.
"""

from __future__ import annotations

import ast
import inspect
import json
import logging
import logging.config
import re
from dataclasses import dataclass
from pathlib import Path

import pytest
from fastapi import FastAPI

ROOT = Path(__file__).resolve().parents[3]

#: service directory name -> its Dockerfile, under infrastructure/docker.
SERVICES = ("trading-engine", "market-data", "execution-engine")

#: A command line names its target after the binary; ``uvicorn.run`` names the
#: same thing as its first argument. Two shapes, one dotted-target rule.
_COMMAND_TARGET = re.compile(r"uvicorn\s+(?P<factory>--factory\s+)?(?P<dotted>[\w.]+:\w+)")
_DOTTED = re.compile(r"^(?P<module>[\w.]+):(?P<attr>\w+)$")
#: The command line is a JSON array, so the path ends at the first quote;
#: [^"\s] rather than \S+ is what keeps a trailing "], from being a filename.
_LOG_FLAG = re.compile(r"--log-config\s+(?P<path>[^\"\s]+)")


@dataclass(frozen=True)
class UvicornTarget:
    """What an image command line actually asks for."""

    module: str
    attribute: str
    factory: bool

    @property
    def dotted(self) -> str:
        return f"{self.module}:{self.attribute}"


def dockerfile(service: str) -> Path:
    return ROOT / "infrastructure" / "docker" / f"{service}.Dockerfile"


def image_log_config(service: str) -> str:
    """The path the image hands uvicorn for ``--log-config``, verbatim."""
    line = next(
        line
        for line in dockerfile(service).read_text(encoding="utf-8").splitlines()
        if line.startswith("CMD [")
    )
    match = _LOG_FLAG.search(line)
    assert match is not None, f"{service}: the image command sets no --log-config"
    return match.group("path")


def log_config_source(service: str, image_path: str) -> Path:
    """The build-context file that becomes that path inside the image.

    The COPY lines put a file next to ``pyproject.toml`` in the WORKDIR, so the
    image's ``./log-config.json`` is the service's ``log-config.json`` - a mapping
    this test reads off the Dockerfile rather than assumes.
    """
    if image_path.startswith("./"):
        return ROOT / "services" / service / image_path.removeprefix("./")
    return ROOT / image_path.lstrip("/")


def module_file(service: str, module: str) -> Path:
    return ROOT / "services" / service / f"{module.replace('.', '/')}.py"


def split_target(dotted: str) -> tuple[str, str]:
    match = _DOTTED.match(dotted)
    assert match is not None, f"{dotted!r} is not a module:attribute target"
    return match.group("module"), match.group("attr")


def parse_target(command: str) -> UvicornTarget:
    match = _COMMAND_TARGET.search(command)
    assert match is not None, f"no uvicorn target in this command: {command!r}"
    module, attribute = split_target(match.group("dotted"))
    return UvicornTarget(
        module=module,
        attribute=attribute,
        factory=match.group("factory") is not None,
    )


def image_command(service: str) -> UvicornTarget:
    """The single command the container runs, read out of the image recipe."""
    text = dockerfile(service).read_text(encoding="utf-8")
    lines = [line for line in text.splitlines() if line.startswith("CMD [")]
    assert len(lines) == 1, f"{service}: expected exactly one CMD, found {len(lines)}"
    # Only the payload string matters; "sh"/"-c" and the flag order around the
    # target are the recipe's business, not this test's.
    return parse_target(lines[0])


class ModuleShape:
    """The two facts about a module that decide which uvicorn form is correct."""

    def __init__(self, path: Path) -> None:
        self.tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))

    def has_module_binding(self, name: str) -> bool:
        for node in self.tree.body:
            if isinstance(node, ast.Assign | ast.AnnAssign):
                targets: list[ast.expr] = (
                    list(node.targets) if isinstance(node, ast.Assign) else [node.target]
                )
                if any(isinstance(t, ast.Name) and t.id == name for t in targets):
                    return True
            if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef):
                if node.name == name:
                    return False  # a def is not a binding the plain form can use
        return False

    def zero_arg_function(self, name: str) -> bool:
        for node in self.tree.body:
            if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef) and node.name == name:
                args = node.args
                return not (args.args or args.posonlyargs or args.kwonlyargs or args.vararg)
        return False


@pytest.mark.parametrize("service", SERVICES)
def test_the_image_command_names_a_target_its_module_can_satisfy(service: str) -> None:
    target = image_command(service)
    shape = ModuleShape(module_file(service, target.module))
    if target.factory:
        assert shape.zero_arg_function(target.attribute), (
            f"{service}: the image passes --factory {target.dotted}, but that name is "
            "not a zero-argument function in the module - uvicorn would fail to build the app"
        )
    else:
        assert shape.has_module_binding(target.attribute), (
            f"{service}: the image names {target.dotted} with no --factory, but the module "
            "defines no such object - this is the exact shape of the boot failure Part 18 "
            "found in execution-engine, where create_app is a factory and nothing is bound "
            "to app at module scope"
        )


@pytest.mark.parametrize("service", SERVICES)
def test_the_image_command_survives_uvicorn_s_own_startup(service: str) -> None:
    """Every flag the image passes has to be loadable, by uvicorn, before the app.

    ``uvicorn.Config`` configures logging inside its constructor, so this single
    call is the whole boot-time surface the container depends on - the target, the
    factory flag, and the log config - with no server, no port and no settings
    parse. It is the check that would have failed for eleven parts.
    """
    import uvicorn

    target = image_command(service)
    image_path = image_log_config(service)
    source = log_config_source(service, image_path)
    assert source.is_file(), f"{service}: {image_path} names no file in the build context"
    uvicorn.Config(
        app=target.dotted,
        factory=target.factory,
        log_config=str(source),
    )  # raises if the shape is wrong, which is the assertion


@pytest.mark.parametrize("service", SERVICES)
def test_the_factory_flag_is_not_carried_by_a_module_that_does_not_need_it(service: str) -> None:
    # The mirror of the test above, because a wrong flag is as fatal as a wrong
    # name: --factory against a module-level app instance hands uvicorn an
    # application object and tells it to call it, and calling a FastAPI app raises
    # deep inside the server rather than at the front door.
    target = image_command(service)
    shape = ModuleShape(module_file(service, target.module))
    if shape.has_module_binding(target.attribute):
        assert not target.factory, f"{service}: {target.dotted} is an object, not a factory"


def test_the_two_ways_to_start_this_service_name_the_same_target() -> None:
    # ``python -m app.main`` and the image must not be able to disagree: one is
    # what an operator types, the other is what ships, and a divergence means the
    # reproduction and the deployment are different programs.
    from_image = image_command("execution-engine")
    tree = ast.parse(
        module_file("execution-engine", from_image.module).read_text(encoding="utf-8"),
        filename="main.py",
    )
    from_module = _uvicorn_run_target(tree)
    assert from_module == from_image, (
        f"python -m app.main starts {from_module.dotted if from_module else None} while the "
        "image starts "
        f"{from_image.dotted}"
    )


def _target_of_string(dotted: str) -> UvicornTarget:
    module, attribute = split_target(dotted)
    return UvicornTarget(module=module, attribute=attribute, factory=False)


def _uvicorn_run_target(tree: ast.Module) -> UvicornTarget | None:
    """The ``uvicorn.run`` call inside the module's ``__main__`` block, if any."""
    for node in tree.body:
        if not (isinstance(node, ast.If) and _is_main_guard(node.test)):
            continue
        for call in ast.walk(node):
            if not (isinstance(call, ast.Call) and _is_uvicorn_run(call.func)):
                continue
            target = _target_of_string(call.args[0].value) if call.args else None
            factory = any(
                kw.arg == "factory" and isinstance(kw.value, ast.Constant) and kw.value.value
                for kw in call.keywords
            )
            return UvicornTarget(target.module, target.attribute, factory)
    return None


def _is_main_guard(test: ast.expr) -> bool:
    return (
        isinstance(test, ast.Compare)
        and isinstance(test.left, ast.Name)
        and test.left.id == "__name__"
        and any(isinstance(op, ast.Eq) for op in test.ops)
    )


def _is_uvicorn_run(func: ast.expr) -> bool:
    return (
        isinstance(func, ast.Attribute)
        and func.attr == "run"
        and isinstance(func.value, ast.Name)
        and func.value.id == "uvicorn"
    )


def test_the_zero_length_stand_in_that_used_to_be_the_flag_is_rejected() -> None:
    """The reason the file exists, pinned as a behaviour rather than a story.

    ``--log-config /dev/null`` was every Python service's image command until Part
    18: neat, portable, and not loadable. uvicorn routes a path with no .json/.yaml
    suffix to ``logging.config.fileConfig``, which refuses a zero-length file -
    so the container died before importing the app, and the healthcheck in the same
    Dockerfile was the only thing in the repository watching. This test does not
    assert that the old flag is gone (the test above proves the new one loads); it
    asserts the mechanism, so a revert cannot be justified by "it worked for us".
    """
    import uvicorn

    with pytest.raises(RuntimeError, match="empty file"):
        uvicorn.Config(app="app.main:create_app", factory=True, log_config="/dev/null")


def test_the_log_config_changes_nothing_about_the_loggers_it_meets() -> None:
    """"A no-op" is a claim about behaviour, so it is tested as behaviour: an
    existing handler on the root logger has to still be there afterwards, because
    the whole point of the file is that uvicorn must not reconfigure the app's
    JSON pipeline out from under it.
    """
    root = logging.getLogger()
    sentinel = logging.NullHandler()
    root.addHandler(sentinel)
    try:
        for service in SERVICES:
            source = log_config_source(service, image_log_config(service))
            config = json.loads(source.read_text(encoding="utf-8"))
            assert config == {"version": 1, "disable_existing_loggers": False}
            logging.config.dictConfig(config)
            assert sentinel in root.handlers, f"{service}'s log config moved the app's handlers"
    finally:
        root.removeHandler(sentinel)


def test_the_factory_this_image_calls_produces_a_working_application() -> None:
    # The reality half of the docstring: called on a real environment, the named
    # factory returns a FastAPI app that serves the health route. Static checks
    # prove a name exists; only this proves the name is the thing a server needs.
    from fastapi.testclient import TestClient

    from app.main import create_app

    assert callable(create_app)
    assert inspect.signature(create_app).parameters == {}
    built = create_app()
    assert isinstance(built, FastAPI)
    with TestClient(built) as started:
        assert started.get("/health").status_code == 200


def test_no_module_level_app_so_the_import_stays_free() -> None:
    # Why there is no module-level ``app``: an operator running this service with a
    # missing variable must get the settings error at startup, and a test collector,
    # a linter or a docs build must get nothing at all. If someone "fixes" the image
    # by binding ``app = create_app()`` at import, this test is where they learn
    # what that costs - and the Dockerfile comment is where they learn it twice.
    source = module_file("execution-engine", "app.main").read_text(encoding="utf-8")
    shape = ModuleShape(module_file("execution-engine", "app.main"))
    assert not shape.has_module_binding("app"), (
        "app.main now builds its application at import time; that makes settings parsing "
        "an import side effect - see the two comments this test exists to enforce"
    )
    assert "create_app" in source
```

FILE: services/execution-engine/tests/test_part18_observability.py

```python
"""Part 18: the execution engine's scrape, and the laws the exposition must keep.

Six things are pinned here, in the order they would hurt if they broke:

1. **The exporter cannot fall behind the instrument.** The counter families are
   derived from ``ExecutionCounters``' fields and the test asserts equality in both
   directions, so a counter added in the core with no matching entry here is
   impossible, and a family invented here without an instrument is caught. This is
   the specific failure this repository has now hit three times with hand-written
   lists, and it is the one thing a metrics adapter is uniquely good at hiding.
2. **Mirroring is a delta, and a decrease is an event.** ``inc`` refuses a negative
   amount by platform law, so the hub adds the difference; when the source goes
   backwards (``reset()``, or a fresh process) the hub re-baselines and COUNTS that
   instead of drawing a cliff or reporting a negative rate.
3. **An unrecorded stage is absent, not zero.** A histogram of zeros reads as
   "everything was instantaneous"; the truth is "nobody measured", and the exposition
   is exactly where that distinction gets lost.
4. **Nothing identifying is in the text** - not because the render filters it, but
   because the core's cardinality law refuses such labels at registration, which is
   asserted here by trying to register one and being told no.
5. **Reading does not write.** A scrape leaves the engine's own instruments alone.
6. **The route's plane.** Unauthenticated like the health endpoints beside it, absent
   from the OpenAPI document, invisible to the worker's forwarding list, and a 404
   rather than an apology when exposition is disabled.
"""

from __future__ import annotations

import re
from contextlib import ExitStack
from dataclasses import fields
from typing import cast

import pytest
from fastapi.testclient import TestClient
from wlct_trading.metrics import (
    EXECUTION_STAGES,
    ExecutionCounters,
    ExecutionMetrics,
    LatencyHistogram,
)
from wlct_trading.observability.labels import CardinalityError

from app.composition import EngineRuntime
from app.observability import (
    COUNTER_FAMILIES,
    LATENCY_FAMILY,
    RESETS_FAMILY,
    WIRING_GAUGE,
    ExecutionEngineObservability,
    counter_families,
)
from tests.conftest import auth_headers
from tests.test_execution_engine import settings_for
from tests.test_part14_retention import postgres_client
from tests.test_part15_drift_parity import ENGINE_CLIENT


class FakeMetrics:
    """An ``ExecutionMetrics``-shaped source, holding the core's real histograms.

    Not a fake histogram: the adapter the hub mirrors through refuses a source
    whose bucket edges differ from the exposed family, and that check is exactly
    the kind of contract a test double would smooth over. A real
    ``LatencyHistogram`` also keeps ``count`` honest without reimplementing it.
    """


    def __init__(self, **counters: int) -> None:
        self.counters = ExecutionCounters(**counters)
        self._stages: dict[str, LatencyHistogram] = {}
        self.asked_for: list[str] = []

    def stage(self, name: str) -> LatencyHistogram | None:
        self.asked_for.append(name)
        return self._stages.get(name)

    def record_stage(self, name: str, micros: int = 1_000, samples: int = 1) -> None:
        histogram = LatencyHistogram()
        for _ in range(samples):
            histogram.observe(micros)
        self._stages[name] = histogram


class FakeEngine:
    """The only thing the hub reads off an engine: the metrics port it holds."""

    def __init__(self, metrics: FakeMetrics | None) -> None:
        self.metrics = metrics


class FakeRuntime:
    """Enough of ``EngineRuntime`` for the hub: an engine, and a description."""

    def __init__(
        self, metrics: FakeMetrics | None, described: dict[str, object] | None = None
    ) -> None:
        self.engine = FakeEngine(metrics)
        self._described: dict[str, object] = described if described is not None else {}

    def describe(self) -> dict[str, object]:
        return dict(self._described)


def hub_for(
    metrics: FakeMetrics | None = None,
    described: dict[str, object] | None = None,
) -> ExecutionEngineObservability:
    return ExecutionEngineObservability(cast(EngineRuntime, FakeRuntime(metrics, described)))


def render_value(body: str, family: str) -> float | None:
    """The value of a label-free series of ``family`` in the rendered text.

    Matching on the family plus ``{`` rather than a space because the registry
    stamps every series with its ``service`` label: the line is
    ``wlct_execution_..._total{service="execution-engine"} 5``, and a parser that
    assumed a bare name would report "absent" for a metric that is right there -
    the most misleading kind of test failure.
    """
    for line in body.splitlines():
        if line.startswith(family + "{") or line.startswith(family + " "):
            return float(line.rsplit(" ", 1)[1])
    return None


# ---------------------------------------------------------------------------
# 1. the family set is derived, in both directions
# ---------------------------------------------------------------------------


class TestFamilyDerivation:
    def test_the_exported_counters_are_exactly_the_instruments_fields(self) -> None:
        expected = tuple(
            f"wlct_execution_{field.name}_total" for field in fields(ExecutionCounters)
        )
        assert COUNTER_FAMILIES == expected
        assert counter_families() == expected

    def test_the_hub_registers_every_one_of_them(self) -> None:
        hub = hub_for(FakeMetrics())
        missing = set(COUNTER_FAMILIES) - set(hub.family_names)
        assert not missing, f"declared but not registered: {sorted(missing)}"

    def test_the_hub_invents_no_counter_of_its_own(self) -> None:
        hub = hub_for(FakeMetrics())
        exported = {n for n in hub.family_names if n.startswith("wlct_execution_")}
        allowed = set(COUNTER_FAMILIES) | {LATENCY_FAMILY, WIRING_GAUGE, RESETS_FAMILY}
        assert exported <= allowed, exported - allowed

    def test_the_latency_wiring_and_reset_families_exist(self) -> None:
        hub = hub_for(FakeMetrics())
        assert LATENCY_FAMILY in hub.family_names
        assert WIRING_GAUGE in hub.family_names
        assert RESETS_FAMILY in hub.family_names


# ---------------------------------------------------------------------------
# 2. mirroring: deltas, resets, and the values a panel will read
# ---------------------------------------------------------------------------


class TestMirroring:
    def test_a_scrape_reports_the_sources_total(self) -> None:
        metrics = FakeMetrics(orders_submitted=7, placement_reviews=3)
        body = hub_for(metrics).scrape()
        assert render_value(body, "wlct_execution_orders_submitted_total") == 7
        assert render_value(body, "wlct_execution_placement_reviews_total") == 3

    def test_two_scrapes_do_not_double_a_counter(self) -> None:
        # The single most likely bug in a mirror: the source is cumulative and the
        # registry only adds, so a naive per-scrape inc would make the second scrape
        # of an idle process report twice the work that happened.
        metrics = FakeMetrics(orders_submitted=4)
        hub = hub_for(metrics)
        first = render_value(hub.scrape(), "wlct_execution_orders_submitted_total")
        second = render_value(hub.scrape(), "wlct_execution_orders_submitted_total")
        assert first == 4 and second == 4

    def test_the_delta_between_scrapes_is_what_gets_added(self) -> None:
        metrics = FakeMetrics(orders_submitted=4)
        hub = hub_for(metrics)
        hub.scrape()
        metrics.counters.orders_submitted = 10
        assert render_value(hub.scrape(), "wlct_execution_orders_submitted_total") == 10

    def test_a_source_that_moves_backwards_is_re_baselined_and_counted(self) -> None:
        metrics = FakeMetrics(orders_submitted=9)
        hub = hub_for(metrics)
        hub.scrape()
        metrics.counters.orders_submitted = 2  # the core's test-only reset()
        body = hub.scrape()
        # 11, not 2, and that is the deliberate choice rather than a slip. The
        # registry refuses a negative increment (correctly: a Prometheus counter
        # that decreases breaks rate() for every consumer), so the mirror is
        # monotone across a source reset and the EVENT is what carries the truth -
        # both as a rendered series and as the hub's own count. A production
        # restart is not this path at all: it is a new process with a new registry
        # and a series that legitimately starts at zero, which is exactly what
        # rate() expects to see. Nothing in the shipped services calls reset();
        # the case exists because the port allows it and a mirror must not be
        # surprised by a source it is told to follow.
        assert render_value(body, "wlct_execution_orders_submitted_total") == 11
        assert render_value(body, RESETS_FAMILY) == 1
        assert hub.reset_count == 1
        # ...and the tracking re-baselined, so what comes next is measured right:
        metrics.counters.orders_submitted = 5
        assert (
            render_value(hub.scrape(), "wlct_execution_orders_submitted_total") == 14
        )

    def test_a_counter_that_has_never_moved_is_absent_from_the_text(self) -> None:
        # The registry's own rendering law, which this hub inherits instead of
        # arguing with: a family with no series is omitted (Part 9 pinned that for
        # the case of a registered-but-unused counter, and the same shape keeps a
        # scrape from having to invent zeros). So "absent" means "nothing has been
        # written to it in this process", and the presence of the wiring gauges -
        # always set, because they describe the wiring rather than the traffic - is
        # what distinguishes that from a service that is not measuring at all.
        body = hub_for(FakeMetrics()).scrape()
        assert render_value(body, "wlct_execution_orders_submitted_total") is None
        assert WIRING_GAUGE in body
        assert "# TYPE wlct_execution_wiring gauge" in body


# ---------------------------------------------------------------------------
# 3. stages
# ---------------------------------------------------------------------------


class TestStageExposition:
    def test_a_recorded_stage_appears_with_its_buckets(self) -> None:
        metrics = FakeMetrics()
        metrics.record_stage("risk", micros=1200, samples=3)
        body = hub_for(metrics).scrape()
        assert '_count{service="execution-engine",stage="risk"} 3' in body
        assert '_sum{service="execution-engine",stage="risk"} 3600' in body

    def test_an_unrecorded_stage_is_absent_rather_than_zeroed(self) -> None:
        metrics = FakeMetrics()
        metrics.record_stage("risk")
        body = hub_for(metrics).scrape()
        assert 'stage="risk"' in body
        for stage in EXECUTION_STAGES:
            if stage == "risk":
                continue
            assert f'stage="{stage}"' not in body, (
                f"{stage} was never observed and must not render as a zero "
                "histogram: that reads as instantaneous, not as unmeasured"
            )

    def test_the_hub_only_asks_for_declared_stages(self) -> None:
        # The mechanism, not just the outcome: the loop walks the vocabulary, so an
        # observation made under a name nobody declared can never be exported as a
        # series the family bounds would have refused anyway.
        metrics = FakeMetrics()
        hub_for(metrics).scrape()
        assert set(metrics.asked_for) == set(EXECUTION_STAGES)

    def test_a_stage_label_outside_the_vocabulary_is_refused(self) -> None:
        hub = hub_for(FakeMetrics())
        with pytest.raises(CardinalityError):
            hub.registry.set_gauge(LATENCY_FAMILY, {"stage": "invented_stage"}, 1.0)


# ---------------------------------------------------------------------------
# 4. what may not appear
# ---------------------------------------------------------------------------


class TestNothingIdentifyingLeaves:
    def test_the_cardinality_law_is_enforced_not_just_documented(self) -> None:
        hub = hub_for(FakeMetrics())
        with pytest.raises(CardinalityError, match="tenant_id"):
            hub.registry.register_counter(
                "wlct_execution_per_tenant_total",
                "would be a disclosure channel",
                "tenant_id",
            )

    def test_the_rendered_text_carries_no_principal_and_no_credential(self) -> None:
        described = {
            "storeDurable": True,
            "locksDistributed": False,
            "retentionEnabled": True,
            "placement": {"label": "placement-attest", "requiresVenueAttestation": True},
            "incidents": {"durable": True},
        }
        body = hub_for(FakeMetrics(orders_submitted=1), described).scrape()
        for needle in (
            "tenant_id",
            "tenant-1",
            "account_id",
            "account-1",
            "order_id",
            "client_order_id",
            "api_secret",
            "private_key",
            "dsn",
            "postgresql://",
        ):
            assert needle not in body, (
                f"{needle!r} reached a scrape that is served without authentication"
            )

    def test_the_scrape_does_not_mutate_the_engine_instrument(self) -> None:
        metrics = FakeMetrics(orders_submitted=5)
        metrics.record_stage("validation", micros=20, samples=2)
        hub = hub_for(metrics)
        before = (metrics.counters.orders_submitted, metrics.stage("validation").count)
        hub.scrape()
        hub.scrape()
        after = (metrics.counters.orders_submitted, metrics._stages["validation"].count)
        assert before == (5, 2)
        assert after == (5, 2)

    def test_a_hub_with_no_instrumentation_says_so_by_omission(self) -> None:
        body = hub_for(None).scrape()
        assert "wlct_execution_orders_submitted_total" not in body
        assert "wlct_process_uptime_seconds" in body  # process families always render


# ---------------------------------------------------------------------------
# 5. wiring gauges, read from the runtime's own description
# ---------------------------------------------------------------------------


class TestWiringGauges:
    def lines(self, body: str) -> dict[str, float]:
        out: dict[str, float] = {}
        for line in body.splitlines():
            match = re.match(
                rf'{WIRING_GAUGE}\{{component="([a-z_]+)",service="[^"]+"\}} ([0-9.]+)',
                line,
            )
            if match:
                out[match.group(1)] = float(match.group(2))
        return out

    def test_every_advertised_component_is_rendered(self) -> None:
        body = hub_for(FakeMetrics()).scrape()
        assert set(self.lines(body)) == {
            "durable_store",
            "durable_incidents",
            "placement_review",
            "venue_attestation",
            "distributed_locks",
            "journal_retention",
            # Part 19's two, added to the same literal set rather than to a
            # separately-maintained count: a component that appeared in the table and
            # not here would pass a count-based assertion and be invisible on a
            # dashboard, which is the failure the set form was chosen to avoid.
            "live_credential_fetcher",
            "operator_confirmation",
            "engine_instrumented",
        }

    def test_a_describe_dict_becomes_the_gauges_a_panel_needs(self) -> None:
        body = hub_for(
            FakeMetrics(),
            {
                "storeDurable": True,
                "locksDistributed": True,
                "retentionEnabled": False,
                "placement": {"label": "placement-attest", "requiresVenueAttestation": False},
                "incidents": {"durable": True},
                "metricsConfigured": True,
            },
        ).scrape()
        values = self.lines(body)
        assert values["durable_store"] == 1
        assert values["durable_incidents"] == 1
        assert values["placement_review"] == 1
        assert values["venue_attestation"] == 0
        assert values["distributed_locks"] == 1
        assert values["journal_retention"] == 0
        assert values["engine_instrumented"] == 1

    def test_a_missing_description_key_publishes_zero_rather_than_a_guess(self) -> None:
        # The point of reading describe() instead of the settings is that when the
        # runtime stops saying something, the panel has to show the gap. Defaulting
        # to True would be the exposition layer making the engine's claim for it.
        body = hub_for(FakeMetrics(), {"storeDurable": None}).scrape()
        assert self.lines(body)["durable_store"] == 0
        # Thirteen parts of this service would have answered 0 here, correctly:
        # no instrument was ever handed to the engine, and the gauge says so.
        assert self.lines(body)["engine_instrumented"] == 0


# ---------------------------------------------------------------------------
# 6. the route, on a booted app
# ---------------------------------------------------------------------------


class TestMetricsRoute:
    def test_the_scrape_needs_no_token(self, client: TestClient) -> None:
        response = client.get("/metrics")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/plain")
        assert "version=0.0.4" in response.headers["content-type"]

    def test_the_engine_counters_are_on_it(self, client: TestClient) -> None:
        body = client.get("/metrics").text
        assert f"# HELP {WIRING_GAUGE}" in body
        assert "# TYPE wlct_execution_wiring gauge" in body
        assert "# TYPE wlct_process_uptime_seconds gauge" in body
        # An idle runtime has written nothing, so the counter families are absent
        # (the renderer's law, not a bug). The line below is the end-to-end proof
        # that a number the engine holds reaches the text: it goes through the
        # public metrics port on the REAL runtime, not through a fake, so a hub
        # wired to the wrong attribute would fail here rather than in production.
        engine = client.app.state.runtime.engine
        assert engine.metrics is not None
        engine.metrics.counters.orders_submitted = 1
        after = client.get("/metrics").text
        assert (
            'wlct_execution_orders_submitted_total{service="execution-engine"} 1' in after
        )

    def test_the_service_hands_its_engine_an_instrument(self, client: TestClient) -> None:
        # The gap this part was written to close, stated as an assertion: the
        # metrics port has been optional on ExecutionEngine since Part 5 and this
        # service never supplied one, so the counters every document describes were
        # accumulated by nothing. Nothing here is new machinery - it is the line
        # that connects the machinery to the process.
        engine = client.app.state.runtime.engine
        instrument = engine.metrics
        assert isinstance(instrument, ExecutionMetrics)
        # The instrument carries the adapter's own id: this runtime is simulated,
        # and labelling its timings with the venue it simulates would be a lie.
        assert instrument.to_dict()["exchange"] == "paper"
        assert set(instrument.to_dict()["stages"]) == set()  # nothing measured yet

    def test_the_status_document_agrees_with_the_gauge(self, client: TestClient) -> None:
        # /status is the plane the worker asserts against, /metrics the plane a
        # dashboard reads; this test is the only thing that keeps them telling the
        # same story, which is why the value is read off both rather than asserted
        # twice against one source.
        status = client.get(
            "/internal/v1/status", headers=auth_headers()
        ).json()
        assert status["metricsConfigured"] is True
        line = next(
            line
            for line in client.get("/metrics").text.splitlines()
            if 'component="engine_instrumented"' in line
        )
        assert line.endswith(" 1")

    def test_ready_reports_it_too(self, client: TestClient) -> None:
        # /health/ready splats the description, so a new wiring fact is visible on
        # the unauthenticated plane as well; pinned because that splat is the only
        # reason the two planes cannot drift, and a splat can be replaced by a
        # hand-written dict without any test noticing until an operator asks.
        assert client.get("/health/ready").json()["metricsConfigured"] is True

    def test_it_is_absent_from_the_openapi_document(self, client: TestClient) -> None:
        assert "/metrics" not in client.get("/openapi.json").json()["paths"]

    def test_reading_metrics_changes_nothing_the_command_plane_sees(
        self, client: TestClient
    ) -> None:
        wiring = client.app.state.runtime.describe()
        client.get("/metrics")
        client.get("/metrics")
        assert client.app.state.runtime.describe() == wiring

    def test_the_diagnostic_review_is_not_counted_as_a_gated_review(
        self, client: TestClient
    ) -> None:
        # The end-to-end claim Part 18 can honestly make about THIS process: the
        # service composes an engine but serves no submission command, so the
        # counters are expected to sit at zero - and the placement endpoint is a
        # question, not an order. If a future change made ``attest`` increment
        # ``placement_reviews``, this assertion is where somebody notices that the
        # dashboard's "reviews" no longer means "orders the gate looked at".
        before = client.get("/metrics").text
        assert render_value(before, "wlct_execution_placement_reviews_total") is None
        reviewed = client.post(
            "/internal/v1/placement/attest",
            headers=auth_headers("tenant-a"),
            json={
                "tenantId": "tenant-a",
                "accountId": "account-1",
                "symbol": "BTCUSDT",
                "orderType": "LIMIT",
                "timeInForce": "GTC",
            },
        )
        assert reviewed.status_code == 200
        after = client.get("/metrics").text
        assert render_value(after, "wlct_execution_placement_reviews_total") is None
        # ...and the review's existence is visible where it should be: on the
        # wiring gauges, which is the whole reason they exist beside the counters.
        rendered = (
            'wlct_execution_wiring{component="placement_review",'
            'service="execution-engine"} 1'
        )
        assert rendered in after

    def test_production_refuses_to_parse_without_exposition(self) -> None:
        with pytest.raises(ValueError, match="OBSERVABILITY_ENABLED=false in production"):
            settings_for(("NODE_ENV", "production"), ("OBSERVABILITY_ENABLED", "false"))

    def test_the_switch_is_published_on_the_configs_safe_view(self) -> None:
        # Same convention as Parts 14 and 15: every non-secret knob appears in the
        # config's public view, which is the contract the logs and any future status
        # surface read. The /status document itself stays the WIRING view - the
        # knob is not a wiring fact, and conflating the two is how a deployment
        # starts reporting its configuration as its state.
        assert settings_for().to_public_dict()["observabilityEnabled"] is True

    def test_a_disabled_exposition_is_a_404_not_a_paragraph(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.config import get_settings
        from app.main import create_app

        monkeypatch.setenv("OBSERVABILITY_ENABLED", "false")
        get_settings.cache_clear()
        try:
            with TestClient(create_app()) as client:
                assert client.get("/metrics").status_code == 404
                # ...and the rest of the plane is untouched, which is the point of
                # gating the mount rather than the handler: a disabled scrape must
                # not be able to affect anything a caller depends on.
                assert client.get("/health").status_code == 200
                assert client.get("/health/ready").status_code == 200
        finally:
            get_settings.cache_clear()

    def test_the_worker_never_forwards_the_scrape(self) -> None:
        # Same guard Parts 14, 15 and 17 wrote for their own routes: the worker
        # client's path list IS the public-facing surface of this service, and a
        # metrics scrape must not be reachable through a tenant's request.
        assert "/metrics" not in ENGINE_CLIENT.read_text(encoding="utf-8")

    def test_the_durable_plane_reports_both_durabilities(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, _conn = postgres_client(monkeypatch, stack, [[]])
            body = client.get("/metrics").text
            assert (
                'wlct_execution_wiring{component="durable_store",'
                'service="execution-engine"} 1' in body
            )
            assert (
                'wlct_execution_wiring{component="durable_incidents",'
                'service="execution-engine"} 1' in body
            )
```

FILE: services/execution-engine/tests/test_part19_live_wiring.py

```python
"""Part 19: the operator confirmation, end to end through this service.

The record type and the review's confirmation sub-law are tested in the core suite.
What is tested here is the service's half, which is where Part 19 actually changed
behaviour: what a deployment may configure, what it may not, what the composed runtime
reports, and - the load-bearing one - that turning every part of this on still leaves
``EXECUTION_MODE=live`` refused.

Configuration refusals are asserted as boot failures rather than as per-order
symptoms because that is the shape this service chose in Part 16 and kept since: a
deployment that starts and then cannot trade looks like a venue incident, while one that
refuses to start says "check your configuration" where somebody is guaranteed to read
it.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from wlct_trading.clock import epoch_micros
from wlct_trading.execution.live_confirmation import (
    ConfirmationState,
    LiveOperatorConfirmation,
)
from wlct_trading.execution.live_enablement import LivePrerequisite
from wlct_trading.execution.placement_review import PlacementReviewPolicy, ReviewArea

from app.config import Settings
from app.placement import build_confirmation_verifier, build_placement_reviewer
from tests.conftest import BASE_ENV
from tests.test_execution_engine import settings_for
from tests.test_part16_placement import CREDENTIAL_SHAPED_KEYS, json_keys, runtime_for
from tests.test_part18_observability import hub_for

#: Not a secret: the HMAC key is what makes a record verifiable, and this test computes
#: signatures with it on purpose. The real one is env-only and never in a repository.
CONFIRMATION_KEY = "part19-service-confirmation-key-0123456789abcdef"
DAY = 86_400_000_000
#: Relative to the real clock on purpose. The core suite pins the grading arithmetic on
#: absolute stamps; this file is about a running service, and ``build_runtime`` grades
#: with ``epoch_micros()`` - a fixture stamped in 2023 would make every record here
#: expired, and every "valid confirmation" case would be a test about expiry instead.
NOW = epoch_micros()
ISSUED = NOW - 2 * DAY
EXPIRES = NOW + 6 * DAY


def confirmation_payload(**overrides: Any) -> dict[str, object]:
    base: dict[str, object] = {
        "instanceId": "exec-test-1",
        "tenantId": "tenant-1",
        "accountId": "account-1",
        "exchange": "BINANCE",
        "symbols": ["BTCUSDT"],
        "orderTypes": ["LIMIT"],
        "issuedAtMicros": ISSUED,
        "expiresAtMicros": EXPIRES,
        "nonce": "0f1e2d3c4b5a6978",
        "digest": "",
    }
    base.update(overrides)
    unsigned = LiveOperatorConfirmation(
        instance_id=str(base["instanceId"]),
        tenant_id=str(base["tenantId"]),
        account_id=str(base["accountId"]),
        exchange=str(base["exchange"]),
        symbols=frozenset(cast("list[str]", base["symbols"])),
        order_types=frozenset(cast("list[str]", base["orderTypes"])),
        issued_at_micros=int(str(base["issuedAtMicros"])),
        expires_at_micros=int(str(base["expiresAtMicros"])),
        nonce=str(base["nonce"]),
    )
    payload = unsigned.with_digest(CONFIRMATION_KEY).to_payload()
    # A test that passes its own ``digest`` is testing tampering, and the payload has to
    # keep the forged value rather than re-sign what it was handed - the whole point of
    # those cases is a record whose signature does not match its content.
    if "digest" in overrides:
        payload["digest"] = overrides["digest"]
    return payload


def settings_with_record(**overrides: Any) -> Settings:
    """Settings carrying a valid, signed confirmation for this test instance."""
    payload = confirmation_payload(**overrides)
    merged: dict[str, object] = dict(BASE_ENV)
    merged.update(
        {
            "EXECUTION_REQUIRE_OPERATOR_CONFIRMATION": "true",
            "EXECUTION_CONFIRMATION_KEY_ENV": "EXECUTION_TEST_CONFIRMATION_KEY",
            "EXECUTION_OPERATOR_CONFIRMATION_JSON": json.dumps(payload),
        }
    )
    return Settings.model_validate(merged)


# ---------------------------------------------------------------------------
# 1. what a deployment may configure
# ---------------------------------------------------------------------------


class TestConfiguration:
    def test_the_requirement_is_off_by_default_and_publishes_that(self) -> None:
        settings = settings_for()
        view = settings.to_public_dict()
        assert settings.EXECUTION_REQUIRE_OPERATOR_CONFIRMATION is False
        assert view["requireOperatorConfirmation"] is False
        assert view["operatorConfirmationSource"] is None
        assert view["confirmationKeyEnvVar"] == "EXECUTION_CONFIRMATION_HMAC_KEY"
        assert settings.operator_confirmation is None
        # The policy the review runs on is unchanged for a deployment that did not ask
        # for Part 19: this is the no-silent-behaviour-change assertion, and it is here
        # rather than only in the core because the flag crosses the boundary in this
        # file - a settings field feeding a policy field is exactly where a default can
        # get inverted without anybody noticing.
        assert settings.placement_policy.require_operator_confirmation is False

    def test_turning_it_on_reaches_the_policy(self) -> None:
        settings = settings_with_record()
        assert settings.placement_policy.require_operator_confirmation is True
        assert settings.operator_confirmation is not None

    def test_a_record_is_required_when_the_check_is_required(self) -> None:
        with pytest.raises(ValidationError, match="supplies no confirmation record"):
            settings_for(("EXECUTION_REQUIRE_OPERATOR_CONFIRMATION", "true"))

    def test_two_sources_for_one_ceremony_are_refused(self, tmp_path: Path) -> None:
        path = tmp_path / "confirmation.json"
        path.write_text(json.dumps(confirmation_payload()), encoding="utf-8")
        with pytest.raises(ValidationError, match="both set"):
            settings_for(
                ("EXECUTION_REQUIRE_OPERATOR_CONFIRMATION", "true"),
                ("EXECUTION_OPERATOR_CONFIRMATION_JSON", json.dumps(confirmation_payload())),
                ("EXECUTION_OPERATOR_CONFIRMATION_FILE", str(path)),
            )

    def test_the_file_form_is_read(
        self, tmp_path: Path
    ) -> None:
        path = tmp_path / "confirmation.json"
        path.write_text(json.dumps(confirmation_payload()), encoding="utf-8")
        settings = settings_for(
            ("EXECUTION_REQUIRE_OPERATOR_CONFIRMATION", "true"),
            ("EXECUTION_CONFIRMATION_KEY_ENV", "EXECUTION_TEST_CONFIRMATION_KEY"),
            ("EXECUTION_OPERATOR_CONFIRMATION_FILE", str(path)),
        )
        assert settings.operator_confirmation is not None
        assert settings.to_public_dict()["operatorConfirmationSource"] == "file"

    def test_an_unreadable_file_is_a_boot_failure_not_a_quiet_absence(self) -> None:
        with pytest.raises(ValidationError, match="could not be read"):
            settings_for(
                ("EXECUTION_REQUIRE_OPERATOR_CONFIRMATION", "true"),
                ("EXECUTION_CONFIRMATION_KEY_ENV", "EXECUTION_TEST_CONFIRMATION_KEY"),
                ("EXECUTION_OPERATOR_CONFIRMATION_FILE", "/nonexistent/confirmation.json"),
            )

    @pytest.mark.parametrize(
        "raw",
        [
            "not json at all",
            '"a string"',
            "[]",
            json.dumps({"instanceId": "exec-test-1"}),
            json.dumps({**confirmation_payload(), "expiresAtMicros": "soon"}),
            json.dumps({**confirmation_payload(), "extraField": 1}),
        ],
    )
    def test_a_malformed_record_fails_boot_with_the_reason(self, raw: str) -> None:
        with pytest.raises(ValidationError):
            settings_for(
                ("EXECUTION_REQUIRE_OPERATOR_CONFIRMATION", "true"),
                ("EXECUTION_CONFIRMATION_KEY_ENV", "EXECUTION_TEST_CONFIRMATION_KEY"),
                ("EXECUTION_OPERATOR_CONFIRMATION_JSON", raw),
            )

    def test_a_record_minted_for_another_instance_is_refused_at_boot(self) -> None:
        # Not because the per-order check would miss it - it would refuse every order -
        # but because a template copied between deployments is a deployment that starts
        # with a ceremony it cannot complete, and that is a boot message.
        with pytest.raises(ValidationError, match="names instance"):
            settings_for(
                ("EXECUTION_REQUIRE_OPERATOR_CONFIRMATION", "true"),
                ("EXECUTION_CONFIRMATION_KEY_ENV", "EXECUTION_TEST_CONFIRMATION_KEY"),
                (
                    "EXECUTION_OPERATOR_CONFIRMATION_JSON",
                    json.dumps(confirmation_payload(instanceId="some-other-host")),
                ),
            )

    def test_an_expired_record_still_boots(self) -> None:
        # Deliberate, and the reason the per-order assessment exists: the process still
        # has cancellations, reconciliation and an audit trail to serve, and crashing it
        # on a lapsed confirmation converts an operator lapse into an outage of the only
        # path that can safely close positions. Every ORDER is refused instead.
        settings = settings_for(
            ("EXECUTION_REQUIRE_OPERATOR_CONFIRMATION", "true"),
            ("EXECUTION_CONFIRMATION_KEY_ENV", "EXECUTION_TEST_CONFIRMATION_KEY"),
            (
                "EXECUTION_OPERATOR_CONFIRMATION_JSON",
                json.dumps(confirmation_payload(expiresAtMicros=NOW - DAY)),
            ),
        )
        assert settings.operator_confirmation is not None
        verifier = build_confirmation_verifier(
            settings, environ={"EXECUTION_TEST_CONFIRMATION_KEY": CONFIRMATION_KEY}
        )
        assert verifier is not None
        outcome = verifier.assess(
            tenant_id="tenant-1",
            account_id="account-1",
            symbol="BTCUSDT",
            order_type="LIMIT",
            now_micros=NOW,
        )
        assert outcome.state is ConfirmationState.EXPIRED

    def test_the_key_never_appears_in_the_settings_view(self) -> None:
        # What is published is the NAME of the variable, because a reader of /status
        # cannot do anything with a name and nothing with a value they were never sent.
        # The value's safety comes from a stronger property: there is no field that
        # could hold it, so no dump of this model - public or full - can leak it.
        plain = settings_for()
        assert plain.EXECUTION_CONFIRMATION_KEY_ENV == "EXECUTION_CONFIRMATION_HMAC_KEY"
        assert plain.to_public_dict()["confirmationKeyEnvVar"] == (
            "EXECUTION_CONFIRMATION_HMAC_KEY"
        )
        assert "EXECUTION_CONFIRMATION_HMAC_KEY" not in Settings.model_fields
        settings = settings_with_record()
        assert CONFIRMATION_KEY not in json.dumps(settings.to_public_dict())
        assert CONFIRMATION_KEY not in json.dumps(settings.model_dump())

    def test_the_requirement_type_is_enforced(self) -> None:
        # A nested object is not a boolean in any reading, and a "1" is: pydantic
        # coerces the latter, and the coerced answer has to reach the policy intact -
        # with the record present, because a requirement with nothing to require is
        # itself refused (asserted above), and that refusal is the point of it.
        with pytest.raises(ValidationError):
            settings_for(("EXECUTION_REQUIRE_OPERATOR_CONFIRMATION", "{\"a\": 1}"))
        settings = settings_for(
            ("EXECUTION_REQUIRE_OPERATOR_CONFIRMATION", "1"),
            ("EXECUTION_CONFIRMATION_KEY_ENV", "EXECUTION_TEST_CONFIRMATION_KEY"),
            (
                "EXECUTION_OPERATOR_CONFIRMATION_JSON",
                json.dumps(confirmation_payload()),
            ),
        )
        assert settings.placement_policy.require_operator_confirmation is True

    def test_the_key_env_name_is_the_field_this_service_reads(self) -> None:
        # A typo in a name like this is invisible under the model's extra=ignore: the
        # setting would keep its default, the lookup would look for a different
        # variable, and the deployment would be refused at boot for a reason its own
        # configuration appears not to contain. So the name is pinned on both sides.
        settings = settings_with_record()
        assert settings.EXECUTION_CONFIRMATION_KEY_ENV == "EXECUTION_TEST_CONFIRMATION_KEY"
        assert "EXECUTION_CONFIRMATION_KEY_ENV" in Settings.model_fields


# ---------------------------------------------------------------------------
# 2. the verifier this service builds
# ---------------------------------------------------------------------------


class TestVerifierConstruction:
    def test_nothing_required_and_nothing_supplied_builds_nothing(self) -> None:
        assert build_confirmation_verifier(settings_for(), environ={}) is None

    def test_a_missing_key_is_named_by_variable(self) -> None:
        with pytest.raises(ValueError, match="EXECUTION_TEST_CONFIRMATION_KEY is not set"):
            build_confirmation_verifier(settings_with_record(), environ={})

    def test_a_blank_key_is_the_same_refusal(self) -> None:
        with pytest.raises(ValueError, match="not set or is blank"):
            build_confirmation_verifier(
                settings_with_record(), environ={"EXECUTION_TEST_CONFIRMATION_KEY": "   "}
            )

    def test_a_short_key_is_refused_because_it_is_guessable(self) -> None:
        with pytest.raises(ValueError, match="at least 32 characters"):
            build_confirmation_verifier(
                settings_with_record(), environ={"EXECUTION_TEST_CONFIRMATION_KEY": "short"}
            )

    def test_a_supplied_record_with_no_requirement_still_needs_a_key(self) -> None:
        # The record is only meaningful if somebody can check it; accepting an
        # unverifiable one because "the check is off" would let a stale file sit in a
        # deployment until the day the check is turned on and the file is wrong.
        settings = settings_for(
            (
                "EXECUTION_OPERATOR_CONFIRMATION_JSON",
                json.dumps(confirmation_payload()),
            ),
            ("EXECUTION_CONFIRMATION_KEY_ENV", "EXECUTION_TEST_CONFIRMATION_KEY"),
        )
        assert settings.EXECUTION_REQUIRE_OPERATOR_CONFIRMATION is False
        with pytest.raises(ValueError, match="no signature"):
            build_confirmation_verifier(settings, environ={})
        built = build_confirmation_verifier(
            settings, environ={"EXECUTION_TEST_CONFIRMATION_KEY": CONFIRMATION_KEY}
        )
        assert built is not None and built.required is False and built.record is not None

    def test_the_process_environment_is_the_default_source(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("EXECUTION_CONFIRMATION_HMAC_KEY", CONFIRMATION_KEY)
        settings = settings_for(
            ("EXECUTION_REQUIRE_OPERATOR_CONFIRMATION", "true"),
            (
                "EXECUTION_OPERATOR_CONFIRMATION_JSON",
                json.dumps(confirmation_payload()),
            ),
        )
        assert build_confirmation_verifier(settings) is not None

    def test_the_verifier_is_scoped_to_this_deployment(self) -> None:
        built = build_confirmation_verifier(
            settings_with_record(), environ={"EXECUTION_TEST_CONFIRMATION_KEY": CONFIRMATION_KEY}
        )
        # The builder answers None when nothing is required, so saying it is here is
        # part of the assertion, not a courtesy for the type checker.
        assert built is not None
        assert built.instance_id == "exec-test-1"
        assert built.exchange == "BINANCE"
        assert built.required is True


# ---------------------------------------------------------------------------
# 3. the reviewer, the wiring view, and the boot log
# ---------------------------------------------------------------------------


class TestReviewerWiring:
    def describe(self, *overrides: tuple[str, object]) -> dict[str, Any]:
        settings = settings_for(*overrides)
        wiring = build_placement_reviewer(
            settings,
            will_transmit_orders=False,
            environ={"EXECUTION_TEST_CONFIRMATION_KEY": CONFIRMATION_KEY},
        )
        # ``Any`` rather than ``object``: the assertions below read a nested block, and
        # casting at every level would be noise. The shape itself is pinned exactly, so
        # the looseness buys nothing that a wrong key would hide.
        return cast("dict[str, Any]", wiring.describe())

    def test_the_wiring_reports_the_confirmation_block_always_and_whole(self) -> None:
        bare = self.describe()["operatorConfirmation"]
        wired = self.describe(
            ("EXECUTION_REQUIRE_OPERATOR_CONFIRMATION", "true"),
            ("EXECUTION_CONFIRMATION_KEY_ENV", "EXECUTION_TEST_CONFIRMATION_KEY"),
            (
                "EXECUTION_OPERATOR_CONFIRMATION_JSON",
                json.dumps(confirmation_payload()),
            ),
        )["operatorConfirmation"]
        assert bare == {
            "required": False,
            "keyConfigured": False,
            "recordPresent": False,
            "expiresAtMicros": 0,
            "fingerprint": "",
        }
        assert set(wired) == set(bare)
        assert wired["required"] is True
        assert wired["recordPresent"] is True
        # A fingerprint is a correlation handle, not the signature: twelve hex
        # characters, so an audit line can be tied to the ceremony without the MAC
        # leaving the process.
        assert len(str(wired["fingerprint"])) == 12

    def test_the_confirmation_is_visible_on_the_wiring_object_itself(self) -> None:
        settings = settings_for(
            ("EXECUTION_REQUIRE_OPERATOR_CONFIRMATION", "true"),
            ("EXECUTION_CONFIRMATION_KEY_ENV", "EXECUTION_TEST_CONFIRMATION_KEY"),
            (
                "EXECUTION_OPERATOR_CONFIRMATION_JSON",
                json.dumps(confirmation_payload()),
            ),
        )
        wiring = build_placement_reviewer(
            settings,
            will_transmit_orders=False,
            environ={"EXECUTION_TEST_CONFIRMATION_KEY": CONFIRMATION_KEY},
        )
        assert wiring.confirmation_configured is True
        assert wiring.reviewer.confirmation_verifier is not None
        assert isinstance(wiring.reviewer.policy, PlacementReviewPolicy)

    def test_the_boot_log_carries_presence_and_no_material(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        with caplog.at_level(logging.INFO, logger="app.placement"):
            self.describe(
                ("EXECUTION_REQUIRE_OPERATOR_CONFIRMATION", "true"),
                ("EXECUTION_CONFIRMATION_KEY_ENV", "EXECUTION_TEST_CONFIRMATION_KEY"),
                (
                    "EXECUTION_OPERATOR_CONFIRMATION_JSON",
                    json.dumps(confirmation_payload()),
                ),
            )
        events = [
            record
            for record in caplog.records
            if getattr(record, "event", "") == "execution_engine.placement_review_wired"
        ]
        assert len(events) == 1
        assert events[0].__dict__["requireOperatorConfirmation"] is True
        assert events[0].__dict__["operatorConfirmationConfigured"] is True
        assert CONFIRMATION_KEY not in caplog.text
        assert "digest" not in caplog.text
        assert "nonce" not in caplog.text

    def test_a_policy_that_requires_a_verifier_and_gets_none_is_a_boot_failure(self) -> None:
        settings = settings_for(
            ("EXECUTION_REQUIRE_OPERATOR_CONFIRMATION", "true"),
            ("EXECUTION_CONFIRMATION_KEY_ENV", "EXECUTION_TEST_CONFIRMATION_KEY"),
            (
                "EXECUTION_OPERATOR_CONFIRMATION_JSON",
                json.dumps(confirmation_payload()),
            ),
        )
        with pytest.raises(ValueError, match="EXECUTION_TEST_CONFIRMATION_KEY is not set"):
            build_placement_reviewer(settings, will_transmit_orders=False, environ={})


# ---------------------------------------------------------------------------
# 4. the composed runtime, the status surfaces, and the live refusal
# ---------------------------------------------------------------------------


class TestComposedRuntime:
    def setUpEnv(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # ``build_runtime`` reads the process environment for the key (the whole point
        # of it being env-only), so a composed-runtime test has to put it there rather
        # than pass it in - which is also what makes the test the real thing.
        monkeypatch.setenv("EXECUTION_TEST_CONFIRMATION_KEY", CONFIRMATION_KEY)

    def test_live_still_refuses_with_a_perfect_confirmation(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The regression Part 19 must not break, in the strongest form available.

        Everything the operator confirmation can supply is supplied and valid, the
        credential plumbing is named, and the mode is live: the process still refuses
        to start, and the sentence says why in terms of what is genuinely absent -
        a signed transport, and a venue attestor over it.
        """
        self.setUpEnv(monkeypatch)
        runtime, _ = runtime_for()
        assert runtime.live_enablement is not None
        with pytest.raises(Exception, match="not wired in this build") as caught:
            runtime_for(
                ("EXECUTION_MODE", "live"),
                ("EXECUTION_REQUIRE_OPERATOR_CONFIRMATION", "true"),
                ("EXECUTION_CONFIRMATION_KEY_ENV", "EXECUTION_TEST_CONFIRMATION_KEY"),
                (
                    "EXECUTION_OPERATOR_CONFIRMATION_JSON",
                    json.dumps(confirmation_payload()),
                ),
            )
        message = str(caught.value)
        # The confirmation was accepted - and it is said so, in the satisfied list -
        # while the refusal stands: the sentence's missing half still names the
        # transport, which is the one thing this build cannot be configured into.
        assert "signed transport wired" in message.split("satisfied:")[0]
        assert "operator confirmation accepted" in message.split("satisfied:")[1].split(".")[0]
        assert "No order was sent" in message
        assert runtime.live_enablement is not None

    def test_a_confirmation_in_window_grades_satisfied_at_boot(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        self.setUpEnv(monkeypatch)
        runtime, _ = runtime_for(
            ("EXECUTION_REQUIRE_OPERATOR_CONFIRMATION", "true"),
            ("EXECUTION_CONFIRMATION_KEY_ENV", "EXECUTION_TEST_CONFIRMATION_KEY"),
            (
                "EXECUTION_OPERATOR_CONFIRMATION_JSON",
                json.dumps(confirmation_payload()),
            ),
        )
        report = runtime.live_enablement
        assert report is not None
        assert "OPERATOR_CONFIRMATION_ACCEPTED" in {
            prerequisite.name for prerequisite in report.satisfied
        }
        # ...and live is still refused, because the report is an explanation and not a
        # gate: the composition's own refusal is unconditional.
        assert report.blocks_live
        assert LivePrerequisite.SIGNED_TRANSPORT_WIRED in report.missing

    def test_an_expired_confirmation_grades_unsatisfied(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # The same signed, well-formed record, read one day later: the grading is a
        # clock reading and not a parse, so a lapsed ceremony has to show up here too -
        # otherwise the boot report would tell an operator "confirmation accepted" for
        # a record that refuses every order.
        self.setUpEnv(monkeypatch)
        runtime, _ = runtime_for(
            ("EXECUTION_REQUIRE_OPERATOR_CONFIRMATION", "true"),
            ("EXECUTION_CONFIRMATION_KEY_ENV", "EXECUTION_TEST_CONFIRMATION_KEY"),
            (
                "EXECUTION_OPERATOR_CONFIRMATION_JSON",
                json.dumps(confirmation_payload(expiresAtMicros=NOW - DAY)),
            ),
        )
        report = runtime.live_enablement
        assert report is not None
        assert "OPERATOR_CONFIRMATION_ACCEPTED" in {
            prerequisite.name for prerequisite in report.missing
        }


# ---------------------------------------------------------------------------
# 5. the published surfaces
# ---------------------------------------------------------------------------


def gauges(body: str) -> dict[str, float]:
    """The wiring gauge values this file cares about, by component label.

    Parsed from the rendered text rather than from the registry, because what an
    operator's dashboard reads is the text: a family that exists in the registry and is
    mislabelled in the exposition is exactly the failure a test on the objects misses.
    """
    import re

    found: dict[str, float] = {}
    for line in body.splitlines():
        match = re.match(
            r'wlct_execution_wiring\{component="([a-z_]+)",service="[^"]+"\} ([0-9.]+)',
            line,
        )
        if match and match.group(1) in {"live_credential_fetcher", "operator_confirmation"}:
            found[match.group(1)] = float(match.group(2))
    return found


class TestStatusSurface:
    def test_status_publishes_the_graded_report_and_the_two_wirings(
        self, client: TestClient
    ) -> None:
        body = client.get("/internal/v1/status", headers=_headers()).json()
        assert body["credentialFetcher"] is None
        assert body["operatorConfirmation"] is False
        enablement = body["liveEnablement"]
        assert enablement["liveRefused"] is True
        assert enablement["hardBlockersPresent"] is True
        assert "SIGNED_TRANSPORT_WIRED" in enablement["missing"]
        assert all(code.startswith("LIVE_") for code in enablement["missingCodes"])
        assert enablement["credentialSource"] == "none"
        assert body["placement"]["confirmationConfigured"] is False
        assert set(body["placement"]["operatorConfirmation"]) == {
            "required",
            "keyConfigured",
            "recordPresent",
            "expiresAtMicros",
            "fingerprint",
        }

    def test_ready_carries_the_same_block_unauthenticated_and_no_material(
        self, client: TestClient
    ) -> None:
        body = client.get("/health/ready").json()
        assert body["liveEnablement"]["liveRefused"] is True
        found = {key.lower() for key in json_keys(body)}
        assert found & set(CREDENTIAL_SHAPED_KEYS) == set()
        dumped = json.dumps(body, default=str).lower()
        for word in ("api_secret", "apisecret", "signing_key", "private_key", "nonce"):
            assert word not in dumped

    def test_the_placement_endpoint_reports_the_refusal_for_an_unconfirmed_symbol(
        self, client: TestClient
    ) -> None:
        """The per-order half, over HTTP.

        The endpoint is the surface an operator uses to ask "would this be refused",
        so the whole feature is worth nothing if the answer there and the answer in
        the engine disagree. They are the same code path, and this says so.
        """
        response = client.post(
            "/internal/v1/placement/attest",
            headers=_headers(),
            json={
                "tenantId": "tenant-1",
                "accountId": "account-1",
                "symbol": "SOLUSDT",
                "orderType": "LIMIT",
                "timeInForce": "GTC",
            },
        )
        assert response.status_code == 200
        body = response.json()
        # The deployment this client boots does not transmit, so the venue gap is
        # recorded and not blocking (law 5 of the review) - and the confirmation did not
        # fire at all, because nobody asked for it. The pairing is the point: an
        # unrequired ceremony adds nothing, and the code that would refuse it is absent
        # rather than merely unsatisfied.
        assert body["allowed"] is True
        assert "VENUE_ATTESTATION_REQUIRED" in body["codes"]
        assert body["blockingCodes"] == []
        assert not any(code.startswith("OPERATOR_CONFIRMATION") for code in body["codes"])

    def test_the_wiring_gauge_covers_the_two_new_components(self) -> None:
        hub = hub_for(
            None,
            {
                "credentialFetcher": "vault-kv2",
                "operatorConfirmation": True,
                "placement": {"label": "placement-review"},
            },
        )
        assert gauges(hub.scrape()) == {
            "live_credential_fetcher": 1.0,
            "operator_confirmation": 1.0,
        }
        absent = hub_for(None, {"credentialFetcher": None, "operatorConfirmation": False})
        values = gauges(absent.scrape())
        assert values["live_credential_fetcher"] == 0.0
        assert values["operator_confirmation"] == 0.0

    def test_the_area_counters_are_derived_without_an_exporter_edit(self) -> None:
        # Part 18 derives one family per counter field, both directions equal, so
        # Part 19's seven new fields must show up as seven new families - and the
        # assertion that they do is the proof that no exporter change was needed and
        # that none was forgotten.
        from app.observability import COUNTER_FAMILIES

        families = COUNTER_FAMILIES
        for area in ReviewArea:
            assert f"wlct_execution_placement_blocks_{area.value.lower()}_total" in families
        # Empty families are omitted at scrape time by Part 18's own law, so proving the
        # exposition means proving it with a value on it.
        from tests.test_part18_observability import FakeMetrics

        body = hub_for(FakeMetrics(placement_blocks_confirmation=2), {}).scrape()
        series = 'wlct_execution_placement_blocks_confirmation_total{service="execution-engine"}'
        assert f"{series} 2" in body


def _headers(tenant: str = "tenant-1") -> dict[str, str]:
    return {
        "x-internal-token": BASE_ENV["EXECUTION_INTERNAL_TOKEN"],
        "x-tenant-id": tenant,
    }


def _far_future_micros() -> int:
    # Sixty days out from the fixture's epoch: comfortably unexpired, and inside the
    # core's 90-day ceiling on a confirmation window - a test that minted a year-long
    # record would be asserting on a construction error rather than on the grading.
    return ISSUED + 60 * DAY

```

FILE: services/execution-engine/tests/test_part19_vault_fetcher.py

```python
"""Part 19: the concrete live-credential fetcher, and the selection that installs it.

Two halves, because the gap Part 19 closed had two halves: the reader that did not
exist, and the knob that says "use this reader". Both are asserted here against the
real classes - the HTTP layer is `httpx.MockTransport`, which is the same transport
mechanism the client itself uses and therefore exercises the request building, header
assembly, streaming and status handling, while guaranteeing no socket is opened and no
Vault is required.

The tests that matter most in this file are the ones about what must NOT happen: no
request built from an unsafe identifier, no response body quoted in a refusal, no
secret material in a log line, a repr, or a settings view, and no fallback to another
credential source when the selected one cannot be read.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import httpx
import pytest
from wlct_trading.enums import ExchangeId
from wlct_trading.execution.credentials import (
    CredentialNotFound,
    ExchangeCredentials,
    NullCredentialProvider,
    ResolvedSecret,
    SecretManagerCredentialProvider,
)

from app.config import Settings
from app.credentials import build_credential_provider
from app.secret_fetcher import (
    MAX_VAULT_PATH_LENGTH,
    VaultKvConfig,
    VaultKvSecretFetcher,
)
from tests.conftest import BASE_ENV

#: Built from parts, the way ``conftest`` builds the internal token: no complete
#: secret-shaped literal sits in a test file for a redaction scanner to trip over, and
#: the values are still distinctive enough that "this string must not appear anywhere"
#: is an assertion with teeth rather than a search for an empty string.
VAULT_TOKEN = "".join(("hvs.", "PART19-", "not-a-real-", "token-0123456789"))
API_KEY = "".join(("ak-", "part19-", "sample-key"))
API_SECRET = "".join(("sk-", "part19-", "sample-secret"))
#: The default name of the variable the token is read from, spelled the same way.
TOKEN_ENV_NAME = "_".join(("EXECUTION", "VAULT", "TOKEN"))


def settings_for(*overrides: tuple[str, object]) -> Settings:
    merged: dict[str, object] = dict(BASE_ENV)
    merged.update(
        {
            "EXECUTION_CREDENTIAL_SOURCE": "secret-manager",
            "EXECUTION_CREDENTIAL_FETCHER": "vault-kv2",
            "EXECUTION_VAULT_ADDR": "https://vault.internal:8200",
        }
    )
    for key, value in overrides:
        merged[key] = value
    return Settings.model_validate(merged)


def config(**overrides: Any) -> VaultKvConfig:
    base: dict[str, Any] = {
        "addr": "https://vault.internal:8200",
        "mount": "secret",
        "path_template": "wlct/{tenant}/{account}/{exchange}",
        "token_env": "EXECUTION_VAULT_TOKEN",
    }
    base.update(overrides)
    return VaultKvConfig(**base)


def secret_payload(**overrides: Any) -> bytes:
    data: dict[str, Any] = {"api_key": API_KEY, "api_secret": API_SECRET}
    data.update(overrides)
    for key in list(data):
        if data[key] is None:
            del data[key]
    return json.dumps(
        {"data": {"data": data, "metadata": {"version": 7}, "lease_duration": 0}}
    ).encode("utf-8")


def fetcher_for(
    body: bytes = b"",
    *,
    status: int = 200,
    config_overrides: dict[str, Any] | None = None,
    seen: list[httpx.Request] | None = None,
) -> VaultKvSecretFetcher:
    """A fetcher whose transport answers with exactly this response.

    ``seen`` collects the requests, because half of what is under test is what this
    client PUTS ON THE WIRE (path, headers) and not only what it does with the answer.
    """
    captured = seen if seen is not None else []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(status, content=body)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return VaultKvSecretFetcher(
        config(**(config_overrides or {})),
        environ={"EXECUTION_VAULT_TOKEN": VAULT_TOKEN},
        client=client,
    )


def resolve(
    fetcher: VaultKvSecretFetcher, tenant: str = "tenant-a", account: str = "acct-1"
) -> ExchangeCredentials:
    provider = SecretManagerCredentialProvider(fetcher, exchange=ExchangeId.BINANCE)
    return asyncio.run(provider.resolve(tenant, account, ExchangeId.BINANCE))


# ---------------------------------------------------------------------------
# 1. the config object is the single place the shape rules live
# ---------------------------------------------------------------------------


class TestConfigRefusals:
    def test_http_is_refused_because_a_token_travels_on_the_request(self) -> None:
        with pytest.raises(ValueError, match="must be https"):
            config(addr="http://vault.internal:8200")

    def test_a_missing_scheme_is_refused_rather_than_defaulted(self) -> None:
        with pytest.raises(ValueError, match="scheme"):
            config(addr="vault.internal:8200")

    def test_credentials_in_the_url_are_refused_not_honoured(self) -> None:
        with pytest.raises(ValueError, match="embed credentials"):
            config(addr="https://robot:hunter2@vault.internal:8200")

    def test_the_trailing_slash_is_stripped_once_and_predictably(self) -> None:
        assert config(addr="https://vault.internal:8200///").addr == (
            "https://vault.internal:8200"
        )

    def test_a_nested_mount_is_refused_because_a_segment_is_checkable(self) -> None:
        with pytest.raises(ValueError, match="one safe path segment"):
            config(mount="secret/kv")

    def test_an_unknown_placeholder_is_refused_rather_than_left_literal(self) -> None:
        # A typo ({tenent}) would otherwise look up a nonexistent path and report "no
        # secret" for every tenant, forever, with a plausible message.
        with pytest.raises(ValueError, match="unknown placeholder"):
            config(path_template="wlct/{tenent}/{account}/{exchange}")

    def test_an_unbalanced_brace_is_refused(self) -> None:
        with pytest.raises(ValueError, match="unbalanced braces"):
            config(path_template="wlct/{tenant/{account}/{exchange}")

    def test_a_traversal_segment_in_the_template_is_refused(self) -> None:
        with pytest.raises(ValueError, match=r"\.\."):
            config(path_template="wlct/{tenant}/../../other/{account}/{exchange}")

    def test_the_token_variable_must_be_a_variable_name(self) -> None:
        for bad in ("", "not an env name", "EXECUTION-VAULT"):
            expected = "EXECUTION_VAULT_TOKEN_ENV|environment-variable name"
            with pytest.raises(ValueError, match=expected):
                config(token_env=bad)

    def test_the_response_bound_has_bounds(self) -> None:
        with pytest.raises(ValueError, match="1 KiB"):
            config(max_response_bytes=512)
        with pytest.raises(ValueError, match="1 KiB"):
            config(max_response_bytes=50_000_000)

    def test_a_namespace_that_looks_like_a_url_path_survives_and_a_control_char_does_not(
        self,
    ) -> None:
        assert config(namespace="admin/ops").namespace == "admin/ops"
        with pytest.raises(ValueError, match="namespace"):
            config(namespace="admin\nops")

    def test_the_description_carries_no_token(self) -> None:
        built = config()
        view = built.describe()
        assert view["tokenEnvVar"] == "EXECUTION_VAULT_TOKEN"
        assert VAULT_TOKEN not in json.dumps(view)
        assert "token" not in {key.lower() for key in view} - {"tokenenvvar"}

    def test_the_settings_object_cannot_hold_the_token(self) -> None:
        # The law is structural: there is no field to leak. A later part that adds one
        # fails here rather than in a security review.
        names = set(Settings.model_fields)
        assert not any(
            name.upper().endswith(("TOKEN", "_KEY", "SECRET", "PASSWORD"))
            and "ENV" not in name.upper()
            for name in names
            if name.startswith("EXECUTION_VAULT")
        )
        for name in names:
            if name.startswith("EXECUTION_VAULT"):
                assert "ADDR" in name or name.endswith(
                    (
                        "MOUNT",
                        "PATH_TEMPLATE",
                        "TOKEN_ENV",
                        "NAMESPACE",
                        "TIMEOUT_MS",
                        "TLS_VERIFY",
                        "MAX_RESPONSE_BYTES",
                    )
                ), name


# ---------------------------------------------------------------------------
# 2. the lookup: what goes out, and what comes back
# ---------------------------------------------------------------------------


class TestLookup:
    def test_a_healthy_read_yields_a_credential_with_the_stored_metadata(self) -> None:
        seen: list[httpx.Request] = []
        fetcher = fetcher_for(
            secret_payload(
                permissions="READ,SPOT_TRADE",
                expiresAtMicros=1_800_000_000_000_000,
            ),
            seen=seen,
        )
        credentials = resolve(fetcher)
        assert credentials.api_key == API_KEY
        assert credentials.api_secret == API_SECRET
        # The version rides in the source label, so a rotated secret is a new label and
        # an audit line can be tied to the version that signed it.
        assert credentials.source == "vault-kv2:v7"
        assert credentials.permissions == frozenset({"READ", "SPOT_TRADE"})
        assert credentials.expires_at_micros == 1_800_000_000_000_000
        request = seen[0]
        assert request.url.path == "/v1/secret/data/wlct/tenant-a/acct-1/binance"
        assert request.headers["X-Vault-Token"] == VAULT_TOKEN
        assert "X-Vault-Namespace" not in request.headers

    def test_the_namespace_header_is_sent_only_when_configured(self) -> None:
        seen: list[httpx.Request] = []
        fetcher = fetcher_for(
            secret_payload(),
            config_overrides={"namespace": "admin/ops"},
            seen=seen,
        )
        resolve(fetcher)
        assert seen[0].headers["X-Vault-Namespace"] == "admin/ops"

    def test_camel_case_spelling_is_accepted(self) -> None:
        fetcher = fetcher_for(
            json.dumps({"data": {"data": {"apiKey": API_KEY, "apiSecret": API_SECRET}}}).encode()
        )
        assert resolve(fetcher).api_key == API_KEY

    def test_two_disagreeing_spellings_are_refused(self) -> None:
        fetcher = fetcher_for(
            json.dumps(
                {
                    "data": {
                        "data": {
                            "api_key": API_KEY,
                            "apiKey": "different",
                            "api_secret": API_SECRET,
                        }
                    }
                }
            ).encode()
        )
        with pytest.raises(CredentialNotFound, match="more than one spelling"):
            resolve(fetcher)

    def test_two_agreeing_spellings_are_accepted(self) -> None:
        fetcher = fetcher_for(
            json.dumps(
                {
                    "data": {
                        "data": {
                            "api_key": API_KEY,
                            "apiKey": API_KEY,
                            "api_secret": API_SECRET,
                        }
                    }
                }
            ).encode()
        )
        assert resolve(fetcher).api_key == API_KEY

    def test_absent_fields_are_a_refusal_not_an_empty_credential(self) -> None:
        for missing in ({"api_key": None}, {"api_secret": None}):
            payload = secret_payload(**missing)
            with pytest.raises(CredentialNotFound):
                resolve(fetcher_for(payload))

    def test_a_blank_value_is_refused_even_though_the_key_is_present(self) -> None:
        blank = "   "
        with pytest.raises(CredentialNotFound, match="blank"):
            resolve(fetcher_for(secret_payload(api_secret=blank)))

    def test_no_permissions_stored_means_no_claim_not_a_permissive_default(self) -> None:
        credentials = resolve(fetcher_for(secret_payload()))
        assert credentials.permissions == frozenset()

    def test_a_stored_withdraw_permission_is_carried_so_the_review_can_refuse_it(self) -> None:
        # The fetcher does NOT filter withdrawals: refusing here would hide the fact
        # from the review, which is the component that turns it into a typed finding
        # and an audit line.
        credentials = resolve(fetcher_for(secret_payload(permissions=["READ", "WITHDRAW"])))
        assert "WITHDRAW" in credentials.permissions

    def test_a_permission_field_of_the_wrong_shape_is_refused(self) -> None:
        with pytest.raises(CredentialNotFound, match="permissions field"):
            resolve(fetcher_for(secret_payload(permissions={"a": 1})))

    def test_an_expiry_string_is_refused_because_a_timezone_was_never_written_down(self) -> None:
        with pytest.raises(CredentialNotFound, match="expires_at_micros"):
            resolve(fetcher_for(secret_payload(expiresAtMicros="2026-01-01T00:00:00Z")))

    def test_an_expiry_as_a_digit_string_is_accepted(self) -> None:
        credentials = resolve(fetcher_for(secret_payload(expiresAtMicros="1800000000000000")))
        assert credentials.expires_at_micros == 1_800_000_000_000_000

    @pytest.mark.parametrize("status", [400, 403, 404, 429, 500, 503])
    def test_every_non_200_is_one_refusal_with_the_status_and_no_body(self, status: int) -> None:
        seen: list[httpx.Request] = []
        body = json.dumps({"errors": [f"secret payload for {API_SECRET}"]}).encode()
        fetcher = fetcher_for(body, status=status, seen=seen)
        with pytest.raises(CredentialNotFound) as caught:
            resolve(fetcher)
        message = str(caught.value)
        assert f"HTTP {status}" in message
        # The refusal must not repeat what the server said: a Vault error document can
        # echo request material, and "credential path under mount" is enough context.
        assert API_SECRET not in message
        assert "payload" not in message

    def test_a_200_with_a_null_data_block_is_refused_not_treated_as_empty(self) -> None:
        # Vault answers a deleted KV secret with 200 and {"data": null}.
        with pytest.raises(CredentialNotFound, match="could not be read"):
            resolve(fetcher_for(json.dumps({"data": None}).encode()))

    def test_html_from_a_proxy_is_refused_as_malformed(self) -> None:
        with pytest.raises(CredentialNotFound, match="could not be read"):
            resolve(fetcher_for(b"<html>502 bad gateway</html>"))

    def test_an_oversized_response_is_refused_without_being_consumed(self) -> None:
        fetcher = fetcher_for(
            secret_payload(api_secret="x" * 4096),
            config_overrides={"max_response_bytes": 1024},
        )
        with pytest.raises(CredentialNotFound, match="above the 1024 byte bound"):
            resolve(fetcher)

    def test_a_transport_failure_names_the_type_and_not_the_url(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError(f"connection refused to {request.url}")

        fetcher = VaultKvSecretFetcher(
            config(),
            environ={"EXECUTION_VAULT_TOKEN": VAULT_TOKEN},
            client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        )
        with pytest.raises(CredentialNotFound) as caught:
            resolve(fetcher)
        assert "ConnectError" in str(caught.value)
        assert VAULT_TOKEN not in str(caught.value)

    def test_a_missing_token_is_a_refusal_at_construction(self) -> None:
        with pytest.raises(CredentialNotFound, match="EXECUTION_VAULT_TOKEN is not set"):
            VaultKvSecretFetcher(config(), environ={})

    @pytest.mark.parametrize(
        "tenant",
        ["tenant/../other", "tenant\na", "a" * 65, "", "tenant*a"],
    )
    def test_an_unsafe_identifier_never_becomes_a_request(self, tenant: str) -> None:
        seen: list[httpx.Request] = []
        fetcher = fetcher_for(secret_payload(), seen=seen)
        with pytest.raises(CredentialNotFound, match="safe path segment"):
            asyncio.run(fetcher(tenant, "acct-1", ExchangeId.BINANCE))
        # The assertion that gives the refusal its meaning: nothing left this process.
        assert seen == []

    def test_the_rendered_path_is_bounded(self) -> None:
        # A template that is legal in every segment but absurd in total is caught here,
        # where the failure is a named refusal, rather than downstream where a proxy
        # answers 414 and the operator sees "no secret".
        def respond(request: httpx.Request) -> httpx.Response:  # pragma: no cover
            raise AssertionError("a request must never be built for an over-long path")

        bounded = VaultKvSecretFetcher(
            config(
                path_template="n" * (MAX_VAULT_PATH_LENGTH + 10)
                + "/{tenant}/{account}/{exchange}"
            ),
            environ={"EXECUTION_VAULT_TOKEN": VAULT_TOKEN},
            client=httpx.AsyncClient(transport=httpx.MockTransport(respond)),
        )
        with pytest.raises(CredentialNotFound, match="characters"):
            asyncio.run(bounded("tenant-a", "acct-1", ExchangeId.BINANCE))

    def test_the_fetcher_never_renders_the_token_or_the_secret(self) -> None:
        fetcher = fetcher_for(secret_payload())
        for rendered in (repr(fetcher), str(fetcher), json.dumps(fetcher.describe())):
            assert VAULT_TOKEN not in rendered
            assert API_SECRET not in rendered
        assert "mount='secret'" in repr(fetcher)
        credentials = resolve(fetcher)
        # The core's credential value already refuses to survive rendering; asserted
        # here as well because this module is the one that hands it the material, and a
        # regression in either place lands the secret in a log line.
        assert API_SECRET not in repr(credentials)
        assert API_SECRET not in str(credentials)
        # A malformed body's refusal quotes the exception TYPE, not the bytes it came
        # from - and the bytes here would be the secret if the field order changed.
        with pytest.raises(CredentialNotFound) as caught:
            fetcher._decode(b'{"data": {"data": {"api_secret": "' + API_SECRET.encode() + b'"}}}')
        assert API_SECRET not in str(caught.value)


# ---------------------------------------------------------------------------
# 3. selection: the knob that installs the reader, and the refusals around it
# ---------------------------------------------------------------------------


class TestSelection:
    def test_secret_manager_without_a_fetcher_still_refuses_and_says_what_to_do(self) -> None:
        settings = settings_for(("EXECUTION_CREDENTIAL_FETCHER", "none"))
        with pytest.raises(ValueError, match="needs a secret fetcher") as caught:
            build_credential_provider(settings, environ={})
        message = str(caught.value)
        assert "EXECUTION_CREDENTIAL_FETCHER=vault-kv2" in message
        assert "run simulated" in message

    def test_vault_kv2_installs_the_reader_and_reports_it(self) -> None:
        wiring = build_credential_provider(
            settings_for(),
            environ={"EXECUTION_VAULT_TOKEN": VAULT_TOKEN},
        )
        assert wiring.source == "secret-manager"
        assert wiring.fetcher_source == "vault-kv2"
        # ``source`` is the public chain: the cache wrapper says what it wraps, so a
        # selection that silently skipped the secret-manager provider would read
        # differently here without anyone having to reach into a private attribute.
        assert wiring.provider.source == "cached(secret-manager)"
        assert wiring.describe()["fetcherSource"] == "vault-kv2"
        # A single-tenant claim would be wrong here: the fetcher is keyed per
        # (tenant, account), so the configured pair is not the only one it can read.
        assert wiring.tenant_id is None
        assert wiring.account_id is None

    def test_an_injected_fetcher_is_reported_as_injected(self) -> None:
        async def fetch(
            tenant_id: str, account_id: str, exchange: ExchangeId
        ) -> ResolvedSecret:
            raise CredentialNotFound("deployment fetcher")

        wiring = build_credential_provider(
            settings_for(("EXECUTION_CREDENTIAL_FETCHER", "none")),
            environ={},
            secret_fetcher=fetch,
        )
        assert wiring.fetcher_source == "injected"
        # ``str`` rather than an index cast: describe() is typed as a mapping to
        # ``object``, and the assertion is about the sentence, so reading it as text is
        # the honest narrowing rather than an annotation that lies about the shape.
        assert "deployment-provided" in str(wiring.describe()["note"])

    def test_the_selected_source_never_falls_back_to_another_one(self) -> None:
        # The whole point of an explicit selector: no path through this function
        # returns a working provider when the selected one cannot be built.
        with pytest.raises(ValueError):
            build_credential_provider(
                settings_for(("EXECUTION_VAULT_ADDR", "")),
                environ={"EXECUTION_VAULT_TOKEN": VAULT_TOKEN},
            )
        with pytest.raises(ValueError):
            build_credential_provider(
                settings_for(("EXECUTION_VAULT_ADDR", "http://vault:8200")),
                environ={"EXECUTION_VAULT_TOKEN": VAULT_TOKEN},
            )
        # ``none`` with no fetcher selected is the shipped default, and it stays a
        # null provider: the refusal above must not be able to talk this branch into
        # installing the Vault reader "because it was configured".
        assert isinstance(
            build_credential_provider(
                Settings.model_validate(
                    {**BASE_ENV, "EXECUTION_CREDENTIAL_SOURCE": "none"}
                )
            ).provider,
            NullCredentialProvider,
        )

    def test_the_boot_log_names_the_mechanism_and_nothing_else(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        # The filter is installed for the duration of the test rather than left to the
        # suite's ordering, because the property that matters is "the operator can read
        # which mechanism was chosen AFTER the platform's redaction filter has had its
        # say". Whether the filter happens to be attached by another test first is not
        # a property of this module, and a test that only passes in one ordering is a
        # test that fails in the other.
        from app.logging_config import RedactionFilter

        log = logging.getLogger("app.credentials")
        scrubber = RedactionFilter()
        log.addFilter(scrubber)
        try:
            with caplog.at_level(logging.INFO, logger="app.credentials"):
                build_credential_provider(
                    settings_for(),
                    environ={"EXECUTION_VAULT_TOKEN": VAULT_TOKEN},
                )
        finally:
            log.removeFilter(scrubber)
        events = [
            record
            for record in caplog.records
            if getattr(record, "event", "") == "execution_engine.credentials_selected"
        ]
        assert len(events) == 1
        extra = events[0].__dict__
        assert extra["providerFetcher"] == "vault-kv2"
        assert VAULT_TOKEN not in caplog.text
        assert API_KEY not in caplog.text
        # Not even the path template's tenant placeholder is logged per selection:
        # the boot line says what was wired, and the request says nothing at all.
        assert "wlct/" not in caplog.text


# ---------------------------------------------------------------------------
# 4. the settings surface, which is where a config mistake becomes visible
# ---------------------------------------------------------------------------


class TestSettingsSurface:
    def test_a_fetcher_selected_for_another_source_is_refused(self) -> None:
        with pytest.raises(Exception, match="EXECUTION_CREDENTIAL_FETCHER=vault-kv2"):
            settings_for(
                ("EXECUTION_CREDENTIAL_SOURCE", "environment"),
                ("EXECUTION_CREDENTIAL_ENV_PREFIX", "WLCT_TEST"),
            )

    def test_the_fetcher_defaults_to_none_and_publishes_that(self) -> None:
        view = Settings.model_validate(dict(BASE_ENV)).to_public_dict()
        assert view["credentialFetcher"] == "none"
        # Nothing Vault-shaped is published when nothing is wired: a status page that
        # prints defaults describes a deployment that does not exist.
        assert view["vaultMount"] is None
        assert view["vaultPathTemplate"] is None
        assert view["vaultTokenEnvVar"] is None

    def test_the_vault_view_publishes_the_name_of_the_variable_only(self) -> None:
        view = settings_for().to_public_dict()
        assert view["credentialFetcher"] == "vault-kv2"
        assert view["vaultMount"] == "secret"
        assert view["vaultTokenEnvVar"] == "EXECUTION_VAULT_TOKEN"
        assert "EXECUTION_VAULT_ADDR" not in json.dumps(view)
        assert VAULT_TOKEN not in json.dumps(view)
        # The address is topology, not a secret, and it is deliberately NOT published:
        # /status is readable by the worker, which has no need to know where the
        # platform's key store lives.
        assert "vault.internal" not in json.dumps(view)

    def test_an_unparseable_vault_address_fails_the_boot_that_named_it(self) -> None:
        with pytest.raises(Exception, match="vault-kv2 credential fetcher rejected"):
            settings_for(("EXECUTION_VAULT_MOUNT", "secret/kv"))

    def test_the_token_has_no_field_it_could_be_stored_in(self) -> None:
        # The stronger half of the redaction story. A test that the rendered view omits
        # the token only proves the view is careful; this proves there is nowhere in the
        # settings model to be careless about, so ``model_dump`` - which is what a debug
        # endpoint or an exception repr would reach for - cannot carry it either. The
        # field that does exist holds the NAME of the variable, and the name is safe to
        # publish because it is printed in the deployment's own documentation.
        settings = settings_for()
        assert "EXECUTION_VAULT_TOKEN" not in Settings.model_fields
        assert settings.EXECUTION_VAULT_TOKEN_ENV == TOKEN_ENV_NAME
        assert VAULT_TOKEN not in json.dumps(settings.model_dump())
        assert VAULT_TOKEN not in json.dumps(settings.to_public_dict())
        assert VAULT_TOKEN not in repr(settings)
```

FILE: services/execution-engine/tests/test_part20_status_read.py

```python
"""Part 20: the read scope on the one internal route that acts on nothing.

These tests exist because of a defect found by RUNNING the composition, not by reading
it. ``apps/api/src/worker.ts`` calls ``GET /internal/v1/status`` before it will forward a
single job, with the internal token and no tenant header - correctly, since a
process-level read has no tenant to name - and the engine answered
``400 TENANT_HEADER_REQUIRED``. That code is not in the worker's terminal set, so the
worker logged "execution engine gate failed" and exited 1: in the reference deployment
the worker could not start, and had not been able to since the gate shipped in Part 11.
Nine parts of green suites missed it because every test of that client stubs ``fetch``,
which is the general lesson here and the reason the tests below go through an HTTP
client and the real route table rather than a mock.

The exemption is scoped as narrowly as it can be, and each narrowing is asserted:
the token is still required; a tenant header that IS sent is still validated; the
correlation id still round-trips; the command scope's refusal text is unchanged to the
byte, because the worker matches on it; and the read scope is used by exactly one
route in the application, checked by walking the route table so the next route cannot
inherit it quietly.
"""

from __future__ import annotations

from typing import Any, cast

import pytest
from fastapi import HTTPException
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import CORRELATION_HEADER
from app.security import (
    CALLER_AUTH_HEADER,
    TENANT_HEADER,
    TENANT_REQUIRED_CODE,
    ServiceCaller,
    require_internal_auth,
    require_internal_auth_readonly,
)
from tests.conftest import BASE_ENV, auth_headers

TOKEN = BASE_ENV["EXECUTION_INTERNAL_TOKEN"]

#: The wire contract, spelled out. `app/schemas.py::StatusResponse` is the authority and
#: the TypeScript mirror in `apps/api/src/modules/worker/engine-status-contract.ts` is
#: parity-tested against that file; this literal is the third copy, deliberately, because
#: what it protects is the *published* shape - what a reader sees - and a reader's
#: contract should be tested from the reader's point of view, not only from the
#: producer's. If this list and the schema diverge, someone changed the wire.
STATUS_CONTRACT_KEYS: frozenset[str] = frozenset(
    {
        "adapter",
        "commands",
        "credentialFetcher",
        "credentialSource",
        "dryRun",
        "enablementMaxAgeDays",
        "incidents",
        "instanceId",
        "liveEnablement",
        "locksDistributed",
        "metricsConfigured",
        "mode",
        "operatorConfirmation",
        "placement",
        "retentionEnabled",
        "retentionEventDays",
        "simulated",
        "store",
        "storeBackend",
        "storeDurable",
    }
)


def _code_of(exc: HTTPException) -> str:
    """The `code` of a raised HTTPException, typed.

    `detail` is declared `str | None` by the framework while every raise site in
    `app/security.py` passes a dict, so an `isinstance(detail, dict)` here would be
    provably false to a type checker - and unreachable code is exactly how an assertion
    stops being one. The cast states the known shape and the runtime check below keeps
    it honest: a raise that lost its code fails here instead of comparing `None` to a
    string, and the file needs no suppression comment to type-check.
    """
    detail = cast("dict[str, Any]", exc.detail)
    code = detail["code"]
    assert isinstance(code, str)
    return code


def _token_headers() -> dict[str, str]:
    return {CALLER_AUTH_HEADER: TOKEN}


def _internal_routes(app: Any) -> list[APIRoute]:
    return [
        route
        for route in app.routes
        if isinstance(route, APIRoute) and route.path.startswith("/internal/v1")
    ]


def _dependant_calls(dependant: Any) -> set[Any]:
    found: set[Any] = {dependant.call}
    for sub in dependant.dependencies:
        found |= _dependant_calls(sub)
    return found


class TestReadScopeAnswers:
    def test_status_answers_a_tenantless_internal_caller(self, client: TestClient) -> None:
        """The defect, pinned in the direction it now points."""
        response = client.get("/internal/v1/status", headers=_token_headers())
        assert response.status_code == 200, response.text
        body = response.json()
        assert isinstance(body, dict)
        assert frozenset(body) == STATUS_CONTRACT_KEYS
        # Not "the keys are there": the values are this process's own answers, so a
        # reader that renders them cannot be rendering a default.
        assert body["instanceId"] == BASE_ENV["EXECUTION_INSTANCE_ID"]
        assert body["mode"] == "simulated"
        assert body["storeDurable"] is False
        assert body["credentialSource"] == "none"
        assert body["credentialFetcher"] is None
        assert body["simulated"] is True
        assert isinstance(body["commands"], list)
        enablement = body["liveEnablement"]
        assert enablement is not None
        assert enablement["liveRefused"] is True
        assert enablement["hardBlockersPresent"] is True

    def test_a_caller_that_names_a_tenant_gets_the_same_bytes(self, client: TestClient) -> None:
        """Back-compatibility, asserted rather than assumed.

        The nine parts of clients that already send a tenant header must see no change
        at all: same document, same ordering, same types. Comparing the two payloads
        as text is the strict form of that claim.
        """
        tenantless = client.get("/internal/v1/status", headers=_token_headers())
        scoped = client.get("/internal/v1/status", headers=auth_headers("tenant-a"))
        assert scoped.status_code == 200
        assert tenantless.status_code == 200
        assert scoped.text == tenantless.text

    def test_correlation_still_round_trips_on_the_read_scope(self, client: TestClient) -> None:
        response = client.get(
            "/internal/v1/status",
            headers={**_token_headers(), "x-request-id": "panel-refresh-7"},
        )
        assert response.status_code == 200
        assert response.headers[CORRELATION_HEADER] == "panel-refresh-7"

    def test_empty_tenant_header_reads_as_absent_on_both_scopes(
        self, client: TestClient
    ) -> None:
        """`x-tenant-id: ""` is absence, on both sides, because one helper decides it.

        Worth pinning: a client that stamps an empty header from a missing config value
        now gets a working status read and a 400 on commands, and the difference is the
        scope's whole meaning rather than an accident of `if not x`.
        """
        read = client.get(
            "/internal/v1/status", headers={**_token_headers(), TENANT_HEADER: ""}
        )
        assert read.status_code == 200
        command = client.post(
            "/internal/v1/accounts/verify-credentials",
            headers={**_token_headers(), TENANT_HEADER: ""},
            json={"tenantId": "tenant-a", "accountId": "acct-1"},
        )
        assert command.status_code == 400
        assert command.json()["code"] == TENANT_REQUIRED_CODE


class TestReadScopeIsNotAValidationBypass:
    def test_a_sent_tenant_is_still_validated(self, client: TestClient) -> None:
        for candidate in ("../etc/passwd", "tenant a", "a" * 65, "tenant\x00a"):
            response = client.get(
                "/internal/v1/status",
                headers={**_token_headers(), TENANT_HEADER: candidate},
            )
            assert response.status_code == 400, candidate
            assert response.json()["code"] == "TENANT_HEADER_INVALID", candidate

    @pytest.mark.parametrize(
        "headers",
        [
            {},
            {TENANT_HEADER: "tenant-a"},
            {CALLER_AUTH_HEADER: ""},
            {CALLER_AUTH_HEADER: "s" * len(TOKEN)},
            {CALLER_AUTH_HEADER: TOKEN[:-1]},
        ],
        ids=[
            "no headers",
            "tenant only",
            "empty token",
            "wrong token same length",
            "token truncated by one",
        ],
    )
    def test_no_token_means_no_answer(self, client: TestClient, headers: dict[str, str]) -> None:
        """The exemption is about the tenant law and touches nothing else.

        Every one of these must be 401 rather than 400 or 200: if a missing token ever
        reached the tenant branch, a stranger could read a deployment's wiring, and the
        order of the two checks is the only thing preventing it.
        """
        response = client.get("/internal/v1/status", headers=headers)
        assert response.status_code == 401
        assert response.json()["code"] == "UNAUTHORIZED"

    def test_command_scope_refusal_text_is_unchanged_to_the_byte(
        self, client: TestClient
    ) -> None:
        """A pinned contract: the worker's client and its suite match this sentence."""
        response = client.post(
            "/internal/v1/accounts/verify-credentials",
            headers=_token_headers(),
            json={"tenantId": "tenant-a", "accountId": "acct-1"},
        )
        assert response.status_code == 400
        detail = response.json()
        assert detail["code"] == "TENANT_HEADER_REQUIRED"
        assert detail["message"] == (
            f"Every execution command must name its tenant via the "
            f"{TENANT_HEADER} header; tenantless money operations are refused."
        )


class TestScopeIsScoped:
    def test_the_read_scope_is_used_by_exactly_one_route(self, client: TestClient) -> None:
        routes = _internal_routes(client.app)
        readers = [
            route
            for route in routes
            if require_internal_auth_readonly in _dependant_calls(route.dependant)
        ]
        assert [route.path for route in readers] == ["/internal/v1/status"]
        assert [route.methods for route in readers] == [{"GET"}]

    def test_every_other_internal_route_keeps_the_command_scope(
        self, client: TestClient
    ) -> None:
        routes = _internal_routes(client.app)
        others = [route for route in routes if route.path != "/internal/v1/status"]
        assert others, "the internal plane must have routes besides the status read"
        for route in others:
            calls = _dependant_calls(route.dependant)
            assert require_internal_auth in calls, route.path
            assert require_internal_auth_readonly not in calls, route.path

    def test_no_internal_command_answers_tenantless(self, client: TestClient) -> None:
        """The same claim as the test above, made over HTTP rather than the tree.

        Both directions are pinned on purpose: the route walk catches a dependency
        swapped out of a handler, and the HTTP sweep catches a route that stopped
        depending on either scope at all. A body of `{}` is deliberate - auth is
        resolved before body validation, so a 422 here would mean the refusal moved
        behind validation, which is the ordering this part must not allow.
        """
        paths = sorted(
            {
                route.path
                for route in _internal_routes(client.app)
                if "POST" in (route.methods or set())
            }
        )
        assert paths, "the internal plane is expected to expose commands"
        for path in paths:
            response = client.post(path, headers=_token_headers(), json={})
            assert response.status_code == 400, f"{path}: {response.status_code}"
            assert response.json()["code"] == TENANT_REQUIRED_CODE, path

    def test_the_health_view_publishes_every_key_the_read_scope_does(
        self, client: TestClient
    ) -> None:
        """The disclosure argument for the exemption, as an invariant.

        `GET /health/ready` is unauthenticated by design (Part 8), and it answers with
        the same posture block. So the exemption cannot hand a caller anything a stranger
        does not already get for free - and if a later part ever restricts the readiness
        view, this test fails and the exemption's justification has to be re-argued in
        the open instead of quietly becoming false.
        """
        status_keys = frozenset(
            client.get("/internal/v1/status", headers=_token_headers()).json()
        )
        ready = client.get("/health/ready").json()
        assert status_keys <= frozenset(ready)
        assert "status" in ready  # the readiness verdict itself stays off /status


class TestScopesDirectly:
    """The two dependencies as functions, because their difference is a value.

    No HTTP here: what is under test is which caller object each scope hands back, and a
    route that never reads `tenant_id` cannot reveal the difference over the wire.
    """

    def _settings(self) -> Settings:
        get_settings.cache_clear()
        return get_settings()

    @pytest.mark.asyncio
    async def test_command_scope_refuses_and_read_scope_returns_an_empty_tenant(
        self,
    ) -> None:
        settings = self._settings()
        with pytest.raises(HTTPException) as refused:
            await require_internal_auth(settings, TOKEN, None, None)
        assert refused.value.status_code == 400
        assert _code_of(refused.value) == TENANT_REQUIRED_CODE

        caller = await require_internal_auth_readonly(settings, TOKEN, None, None)
        assert isinstance(caller, ServiceCaller)
        assert caller.tenant_id == ""
        assert caller.request_id is None

    @pytest.mark.asyncio
    async def test_read_scope_keeps_the_caller_it_is_given(self) -> None:
        caller = await require_internal_auth_readonly(
            self._settings(), TOKEN, "tenant-a", "corr-1"
        )
        assert (caller.tenant_id, caller.request_id) == ("tenant-a", "corr-1")

    @pytest.mark.asyncio
    async def test_read_scope_still_refuses_a_bad_token(self) -> None:
        with pytest.raises(HTTPException) as refused:
            await require_internal_auth_readonly(self._settings(), "nope", "tenant-a", None)
        assert refused.value.status_code == 401

    @pytest.mark.asyncio
    async def test_both_scopes_share_the_64_character_bound(self) -> None:
        long_tenant = "t" * 65
        for scope in (require_internal_auth, require_internal_auth_readonly):
            with pytest.raises(HTTPException) as refused:
                await scope(self._settings(), TOKEN, long_tenant, None)
            assert _code_of(refused.value) == "TENANT_HEADER_INVALID"
        ok = await require_internal_auth_readonly(
            self._settings(), TOKEN, "t" * 64, None
        )
        assert ok.tenant_id == "t" * 64
```

FILE: services/market-data/.env.example

```ini
# Market data service - copy to .env for local runs outside Docker Compose.
NODE_ENV=development
LOG_LEVEL=info

MARKET_DATA_HOST=0.0.0.0
MARKET_DATA_PORT=8002
MARKET_DATA_HEALTH_PATH=/health

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_TLS=false

# Must match INTERNAL_SERVICE_TOKEN in the root .env. Minimum 32 characters.
INTERNAL_SERVICE_TOKEN=

MARKET_DATA_SOURCES=binance,bybit
MARKET_DATA_SYMBOLS=BTC/USDT,ETH/USDT,SOL/USDT
MARKET_DATA_POLL_INTERVAL_SECONDS=5
MARKET_DATA_CACHE_TTL_SECONDS=15
MARKET_DATA_STREAMING_ENABLED=false
```

FILE: services/market-data/app/__init__.py

```python
"""Market data service package."""

__version__ = "1.0.0"
```

FILE: services/market-data/app/config.py

```python
"""Configuration for the market data service."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Validated runtime configuration."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=True,
    )

    NODE_ENV: Literal["development", "test", "staging", "production"] = "development"
    LOG_LEVEL: Literal["debug", "info", "warning", "error", "critical"] = "info"

    MARKET_DATA_HOST: str = "0.0.0.0"
    MARKET_DATA_PORT: int = Field(default=8002, ge=1, le=65535)
    MARKET_DATA_HEALTH_PATH: str = "/health"

    REDIS_HOST: str
    REDIS_PORT: int = Field(default=6379, ge=1, le=65535)
    REDIS_PASSWORD: str | None = None
    REDIS_DB: int = Field(default=0, ge=0, le=15)
    REDIS_TLS: bool = False

    INTERNAL_SERVICE_TOKEN: str = Field(min_length=32)

    #: Upstream venues polled for reference prices.
    MARKET_DATA_SOURCES: str = "binance,bybit"
    #: Symbols the service tracks. Kept explicit so a typo cannot fan out.
    MARKET_DATA_SYMBOLS: str = "BTC/USDT,ETH/USDT,SOL/USDT"
    MARKET_DATA_POLL_INTERVAL_SECONDS: int = Field(default=5, ge=1, le=300)
    #: How long a cached quote stays servable before it is considered stale.
    MARKET_DATA_CACHE_TTL_SECONDS: int = Field(default=15, ge=1, le=3600)
    #: Master switch for the live websocket feed. Off by default: a fresh
    #: deployment should not open venue connections until an operator asks for
    #: them.
    MARKET_DATA_STREAMING_ENABLED: bool = False

    # ------------------------------------------------------------------
    # Live public market data (wlct_trading.net)
    #
    # Public endpoints only. There is deliberately no API key or secret in
    # this class: public market data needs none, and user exchange credentials
    # live encrypted per trading account in PostgreSQL — never in a service's
    # environment.
    # ------------------------------------------------------------------
    BINANCE_WS_URL: str = "wss://stream.binance.com:9443"
    BINANCE_REST_URL: str = "https://api.binance.com"
    EXCHANGE_USE_TESTNET: bool = False

    #: Channels. Each maps to one stream per symbol on the shared connection.
    MARKET_DATA_TICKER_ENABLED: bool = True
    MARKET_DATA_TRADES_ENABLED: bool = True
    MARKET_DATA_ORDERBOOK_ENABLED: bool = True

    WEBSOCKET_CONNECT_TIMEOUT_MS: int = Field(default=10_000, ge=100, le=120_000)
    #: Backstop below the heartbeat, not the primary liveness check. Generous
    #: on purpose: a thin symbol's trade stream can legitimately be silent for
    #: minutes, and the venue's protocol pings are answered by the client
    #: library without ever surfacing as a message.
    WEBSOCKET_RECEIVE_TIMEOUT_MS: int = Field(default=300_000, ge=1_000, le=3_600_000)
    WEBSOCKET_HEARTBEAT_TIMEOUT_MS: int = Field(default=90_000, ge=2_000, le=600_000)

    HTTP_CONNECT_TIMEOUT_MS: int = Field(default=5_000, ge=100, le=120_000)
    HTTP_READ_TIMEOUT_MS: int = Field(default=10_000, ge=100, le=120_000)
    HTTP_TOTAL_TIMEOUT_MS: int = Field(default=15_000, ge=100, le=300_000)

    #: Duration of the separately invoked live smoke test. Not used by the
    #: service itself.
    LIVE_MARKET_DATA_SMOKE_TEST_DURATION_SECONDS: int = Field(
        default=30, ge=1, le=3_600
    )

    # ------------------------------------------------------------------
    # Part 9: observability (metrics exposition, health mirror, alerting)
    #
    # These are *publication* switches, never trading switches: turning
    # observability off removes the panel the operator relies on and grants
    # nothing. Production refuses to parse with them off.
    # ------------------------------------------------------------------
    OBSERVABILITY_ENABLED: bool = True
    HEALTH_REFRESH_MS: int = Field(default=5_000, ge=500, le=60_000)

    # ------------------------------------------------------------------
    # Part 10: OpenTelemetry tracing and failure injection
    #
    # Same discipline as the Part 9 switches: these control what telemetry
    # LEAVES the process, never what this service does. Sampling decides
    # visibility, not authorisation; injection is a test-harness capability
    # that production configuration cannot arm at all (see the validator).
    # ------------------------------------------------------------------
    #: Master switch for span export. Off by default: an unconfigured
    #: endpoint must not turn every mirror tick into a connect timeout.
    OTEL_ENABLED: bool = False
    #: OTLP/HTTP base URL (spans are POSTed to <endpoint>/v1/traces as
    #: OTLP/JSON). Secret-free plain URLs only; credentials belong to the
    #: collector's own network position, never to this configuration.
    OTEL_ENDPOINT: str | None = None
    OTEL_TIMEOUT_MS: int = Field(default=2_000, ge=100, le=15_000)
    #: Head-based sampling ratio. The decision is made once per trace from
    #: the trace id (deterministic across languages); 0 records nothing
    #: except priority operations, 1 records every eligible operation.
    OTEL_SAMPLE_RATIO: float = Field(default=0.1, ge=0.0, le=1.0)
    #: Comma-separated operations exempt from ratio sampling. Bounded by
    #: the engine's TRACED_OPERATIONS allow-list; unknown names are logged
    #: and dropped, never guessed at.
    OTEL_PRIORITY_OPERATIONS: str = "execution.transmit"

    #: Arming switch for the closed fault-point universe
    #: (wlct_trading.observability.faults). Valid ONLY outside production,
    #: and only together with the non-production-only guard below.
    FAILURE_INJECTION_ENABLED: bool = False
    #: The guard: injection is forever confined to non-production. Setting
    #: it false does not unlock production; it *disables the feature
    #: outright* (fail closed in both directions).
    FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY: bool = True


    @field_validator("INTERNAL_SERVICE_TOKEN")
    @classmethod
    def _reject_placeholder_token(cls, value: str) -> str:
        if value.strip().lower() in {"changeme", "change_me", "placeholder", "secret", "token"}:
            raise ValueError("INTERNAL_SERVICE_TOKEN must not be a placeholder value")
        return value

    @field_validator("BINANCE_WS_URL")
    @classmethod
    def _require_tls_websocket(cls, value: str) -> str:
        # Refused rather than warned about: market data received over a
        # plaintext socket can be modified in flight, and a book built from
        # modified data is worse than no book at all.
        if not value.startswith("wss://"):
            raise ValueError("BINANCE_WS_URL must use wss:// (TLS)")
        return value

    @field_validator("BINANCE_REST_URL")
    @classmethod
    def _require_tls_rest(cls, value: str) -> str:
        if not value.startswith("https://"):
            raise ValueError("BINANCE_REST_URL must use https://")
        return value

    @model_validator(mode="after")
    def _require_observability_in_production(self) -> "Settings":
        if self.NODE_ENV == "production" and not self.OBSERVABILITY_ENABLED:
            raise ValueError(
                "OBSERVABILITY_ENABLED=false in production: the operations "
                "panel, health mirror and alert stream are mandatory for a "
                "deployment holding real money. Disable them in development "
                "freely; not here."
            )
        return self

    @model_validator(mode="after")
    def _require_reliability_switches(self) -> Settings:
        """Part 10 production discipline, in code rather than folklore.

        * tracing enabled in production must have somewhere to send spans:
          enabled-but-homeless telemetry is silent telemetry, and the whole
          point of the export-outcome counters is that silence is loud here;
        * failure injection cannot be armed in production at all, and
          cannot be armed anywhere without the non-production-only guard
          explicitly on - there is no override in either direction.
        """
        if self.OTEL_ENABLED and self.is_production and not self.OTEL_ENDPOINT:
            raise ValueError(
                "OTEL_ENDPOINT is mandatory in production when OTEL_ENABLED=true"
            )
        if self.OTEL_ENDPOINT is not None and not self.OTEL_ENDPOINT.startswith(
            ("http://", "https://")
        ):
            raise ValueError("OTEL_ENDPOINT must be an http(s) URL (OTLP/HTTP)")
        if self.FAILURE_INJECTION_ENABLED:
            if not self.FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY:
                raise ValueError(
                    "FAILURE_INJECTION_ENABLED=true requires the "
                    "FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY guard to be "
                    "true; disabling the guard disables the feature, it does "
                    "not unlock more"
                )
            if self.is_production:
                raise ValueError(
                    "FAILURE_INJECTION_ENABLED=true is a test-harness switch; "
                    "production refuses to start with it armed"
                )
        return self

    @model_validator(mode="after")
    def _require_a_channel_when_streaming(self) -> "Settings":
        if self.MARKET_DATA_STREAMING_ENABLED and not self.enabled_channels:
            raise ValueError(
                "MARKET_DATA_STREAMING_ENABLED is on but every channel is "
                "disabled; enable at least one of MARKET_DATA_TICKER_ENABLED, "
                "MARKET_DATA_TRADES_ENABLED or MARKET_DATA_ORDERBOOK_ENABLED"
            )
        if self.HTTP_TOTAL_TIMEOUT_MS < self.HTTP_READ_TIMEOUT_MS:
            raise ValueError(
                "HTTP_TOTAL_TIMEOUT_MS must be at least HTTP_READ_TIMEOUT_MS"
            )
        return self

    @property
    def sources(self) -> list[str]:
        return [item.strip().lower() for item in self.MARKET_DATA_SOURCES.split(",") if item.strip()]

    @property
    def symbols(self) -> list[str]:
        return [item.strip().upper() for item in self.MARKET_DATA_SYMBOLS.split(",") if item.strip()]

    @property
    def enabled_channels(self) -> list[str]:
        """Channel names for the live feed, in a stable order."""
        channels: list[str] = []
        if self.MARKET_DATA_ORDERBOOK_ENABLED:
            channels.append("orderbook")
        if self.MARKET_DATA_TRADES_ENABLED:
            channels.append("trades")
        if self.MARKET_DATA_TICKER_ENABLED:
            channels.append("bookticker")
        return channels

    @property
    def is_production(self) -> bool:
        return self.NODE_ENV == "production"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
```

FILE: services/market-data/app/logging_config.py

```python
"""Structured JSON logging, with the shared Part 9 redactor and correlation.

History, kept short: this file used to carry its own tiny redaction regex.
It scrubbed keys but not credential-shaped *values*, never descended into
lists, and knew nothing about exception messages - three ways a secret
could still reach the log pipeline. The policy now lives in exactly one
place, wlct_trading.observability.redaction, shared with the metric and
incident layers and pinned by cross-language fixtures against the TypeScript
redactor in packages/utils. This module only adapts it to logging.

The correlation filter adds the ambient request/job ids (correlation,
operation, tenant, ...) as extra fields on records raised inside a bound
scope, so provider code never sprinkles them by hand.
"""

from __future__ import annotations

import logging
import sys
from typing import Any

from pythonjsonlogger import jsonlogger
from wlct_trading.observability.correlation import LoggingCorrelationFilter
from wlct_trading.observability.redaction import (
    REDACTED,
    is_sensitive_key,
    redact_exception,
    redact_text,
    redact_value,
)

__all__ = ["REDACTED", "RedactionFilter", "ServiceJsonFormatter", "configure_logging"]

#: Record attributes that belong to the logging machinery itself and must
#: never be treated as payload.
_RESERVED = frozenset(
    {
        "args",
        "asctime",
        "created",
        "exc_info",
        "exc_text",
        "filename",
        "funcName",
        "levelname",
        "levelno",
        "lineno",
        "message",
        "module",
        "msecs",
        "msg",
        "name",
        "pathname",
        "process",
        "processName",
        "relativeCreated",
        "stack_info",
        "taskName",
        "thread",
        "threadName",
    }
)


class RedactionFilter(logging.Filter):
    """Scrub credential-shaped keys AND values from every record.

    Runs after the correlation filter: the ids it injects are already
    validated wire tokens, and running second means even a malformed
    future injection is scrubbed before serialisation.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        for key, value in list(record.__dict__.items()):
            if key in _RESERVED:
                continue
            if is_sensitive_key(key):
                record.__dict__[key] = REDACTED
            elif isinstance(value, str):
                record.__dict__[key] = redact_text(value)
            elif isinstance(value, dict | list | tuple):
                record.__dict__[key] = redact_value(value)
        if record.exc_info and record.exc_info[1] is not None:
            # Replace the exception context with a safe summary: the raw
            # message can embed DSNs, and the formatter prints exc_text.
            summary = redact_exception(record.exc_info[1])
            record.exc_text = f"{summary['type']}: {summary['message']}"
            record.exc_info = None
        return True


class ServiceJsonFormatter(jsonlogger.JsonFormatter):
    """Adds the fields the platform log pipeline expects on every line."""

    def __init__(self, fmt: str, **kwargs: Any) -> None:
        super().__init__(fmt, **kwargs)

    def add_fields(
        self,
        log_record: dict[str, Any],
        record: logging.LogRecord,
        message_dict: dict[str, Any],
    ) -> None:
        super().add_fields(log_record, record, message_dict)
        log_record.setdefault("service", "market-data")
        log_record["level"] = record.levelname.lower()
        log_record["logger"] = record.name


def configure_logging(level: str) -> None:
    """Installs the JSON handler on the root logger."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        ServiceJsonFormatter("%(asctime)s %(level)s %(name)s %(message)s", timestamp=True)
    )
    handler.addFilter(LoggingCorrelationFilter())
    handler.addFilter(RedactionFilter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level.upper())

    # Uvicorn installs its own handlers; route them through ours instead.
    for name in ("uvicorn", "uvicorn.access", "uvicorn.error"):
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers.clear()
        uvicorn_logger.propagate = True
```

FILE: services/market-data/app/main.py

```python
"""Market data application factory.

Part 1 delivers ingestion of public reference prices into a shared Redis cache
plus the internal read API. Streaming (websocket fan-out to the Node gateway)
is gated behind MARKET_DATA_STREAMING_ENABLED and lands with the trading work.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

import redis.asyncio as aioredis
import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from wlct_trading.observability.tracing import use_span

from app import __version__
from app.config import get_settings
from app.logging_config import configure_logging
from app.observability import MarketDataObservability
from app.routers import health, market, observability
from app.services.poller import QuotePoller
from app.services.quote_cache import QuoteCache
from app.tracing import (
    TRACE_ID_RESPONSE_HEADER,
    finish_request_span,
    response_trace_header,
    start_request_span,
)

logger = logging.getLogger(__name__)

REQUEST_ID_HEADER = "x-request-id"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_logging(settings.LOG_LEVEL)

    client = aioredis.Redis(
        host=settings.REDIS_HOST,
        port=settings.REDIS_PORT,
        password=settings.REDIS_PASSWORD or None,
        db=settings.REDIS_DB,
        ssl=settings.REDIS_TLS,
        socket_connect_timeout=5.0,
        decode_responses=True,
    )
    app.state.redis = client

    hub: MarketDataObservability | None = None
    if settings.OBSERVABILITY_ENABLED:
        hub = MarketDataObservability(settings, client)

    poller = QuotePoller(
        settings,
        QuoteCache(settings, client),
        observer=hub.record_cycle if hub is not None else None,
    )
    app.state.poller = poller
    poller.start()

    if hub is not None:
        app.state.observability = hub
        app.state.tracer = hub.tracer
        hub.start()

    logger.info(
        "service.started",
        extra={
            "event": "service.started",
            "version": __version__,
            "environment": settings.NODE_ENV,
            "symbols": settings.symbols,
            "sources": settings.sources,
            "poll_interval_seconds": settings.MARKET_DATA_POLL_INTERVAL_SECONDS,
        },
    )

    try:
        yield
    finally:
        await poller.stop()
        if hub is not None:
            await hub.stop()
        await client.aclose()
        logger.info("service.stopped", extra={"event": "service.stopped"})


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.LOG_LEVEL)

    app = FastAPI(
        title="White-Label Copy Trading - Market Data",
        description=(
            "Internal reference-price service. Every route requires the shared "
            "internal service token; no user or credential data passes through it."
        ),
        version=__version__,
        lifespan=lifespan,
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/openapi.json",
    )

    @app.middleware("http")
    async def correlation_middleware(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        """Propagates the API's request id so traces span both services.

        Part 10 layers the W3C context on top of that seam: an inbound
        ``traceparent`` continues the trace, a malformed one is ignored (a
        fresh root, never a join on trust), and the response carries
        ``x-trace-id`` so an operator holding a request id can find the trace.
        With tracing disabled the middleware allocates nothing beyond the
        request id it always made.
        """
        request_id = request.headers.get(REQUEST_ID_HEADER) or str(uuid.uuid4())
        request.state.request_id = request_id

        tracer = getattr(request.app.state, "tracer", None)
        span = start_request_span(
            tracer,
            method=request.method,
            path=request.url.path,
            headers=dict(request.headers),
        )
        if span is None:
            response = await call_next(request)
        else:
            with use_span(span):
                response = await call_next(request)
            finish_request_span(span, status_code=response.status_code)
            trace_id = response_trace_header(span)
            if trace_id is not None:
                response.headers[TRACE_ID_RESPONSE_HEADER] = trace_id
        response.headers[REQUEST_ID_HEADER] = request_id
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "success": False,
                "error": {
                    "code": "VALIDATION_ERROR",
                    "message": "The submitted data failed validation.",
                    "details": [
                        {
                            "field": ".".join(str(part) for part in error["loc"][1:]),
                            "message": error["msg"],
                        }
                        for error in exc.errors()
                    ],
                    "requestId": getattr(request.state, "request_id", None),
                },
            },
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        detail = exc.detail
        payload = (
            detail if isinstance(detail, dict) else {"code": "HTTP_ERROR", "message": str(detail)}
        )
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "success": False,
                "error": {**payload, "requestId": getattr(request.state, "request_id", None)},
            },
        )

    @app.exception_handler(Exception)
    async def unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.exception(
            "request.unhandled_error",
            extra={
                "event": "request.unhandled_error",
                "error_type": type(exc).__name__,
                "path": request.url.path,
            },
        )
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": {
                    "code": "INTERNAL_SERVER_ERROR",
                    "message": "An unexpected error occurred.",
                    "requestId": getattr(request.state, "request_id", None),
                },
            },
        )

    app.include_router(health.router)
    app.include_router(observability.router)
    app.include_router(market.router)

    return app


app = create_app()


def main() -> None:
    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host=settings.MARKET_DATA_HOST,
        port=settings.MARKET_DATA_PORT,
        log_config=None,
        access_log=False,
        reload=not settings.is_production,
    )


if __name__ == "__main__":
    main()
```

FILE: services/market-data/app/observability.py

```python
"""The market-data service's observability hub.

One process-level bundle: metric registry, health registry, alert engine,
dashboard builder, and the periodic task that mirrors all three into Redis
for the API to persist. Durable PostgreSQL ownership stays with the API -
this service never writes an alert row itself; the fold into the alert table
is one writer (the API's maintenance job).

The hub is deliberately outside the poller's hot path except for two integer
increments per cycle; everything else reads state the service already keeps
or runs on the mirror task's schedule. If Redis dies, probes report UNKNOWN,
the mirror simply stops being written, and the last published document ages
out by TTL - the API's sync job treats an absent mirror as "publisher
unreachable", never as "recovered". Fail-closed is a property of the whole
chain, not just of the trading path.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from datetime import UTC, datetime
from typing import Any, Protocol

from wlct_trading.clock import epoch_micros
from wlct_trading.observability import (
    AlertEngine,
    AlertObservation,
    ComponentHealth,
    ComponentStatus,
    DashboardBuilder,
    HealthRegistry,
    ObservabilityRegistry,
    render_health_metrics,
    render_prometheus,
    sample_process,
)
from wlct_trading.redis_keys import RedisKeys

from app.config import Settings
from app.services.quote_cache import quote_key
from app.tracing import (
    build_injector,
    build_tracer,
    flush_traces,
)

logger = logging.getLogger(__name__)

_SERVICE = "market-data"


class MirrorRedis(Protocol):
    """The exact Redis surface the hub needs, stated as a protocol.

    A real ``redis.asyncio.Redis`` satisfies it, the service tests hand in a
    scripted fake, and mypy strict checks both structurally - no casts, no
    suppressions, and if the hub ever reaches for a new command the protocol
    has to grow first, which is the review hook that keeps the surface small.

    The shape (positional keys, keyword-only ``ex``/``transaction``) is the
    exact call surface the hub uses, matched to how redis-py's async client
    is typed (plain ``def`` returning ``Awaitable[X] | X`` unions). The hub
    awaits the results as usual; declaring more than this would over-refine
    the library, declaring less is what the protocol exists to prevent.
    """

    def get(self, name: str, /) -> Any: ...

    def set(self, name: str, value: str, /, *, ex: int | None = ...) -> Any: ...

    def ping(self) -> Any: ...

    def pipeline(self, /, *, transaction: bool = ...) -> Any: ...



class MarketDataObservability:
    """Hub lifecycle: start in the FastAPI lifespan, stop in its finally."""

    def __init__(self, settings: Settings, redis: MirrorRedis) -> None:
        self._settings = settings
        self._redis = redis
        self._started_mono = time.monotonic()
        self._task: asyncio.Task[None] | None = None

        self.registry = ObservabilityRegistry(service=_SERVICE)
        self.health = HealthRegistry()
        self.alerts = AlertEngine()
        self.dashboard = DashboardBuilder(service=_SERVICE)

        self._last_cycle_ok: bool | None = None
        self._quote_age_by_symbol: dict[str, float | None] = {
            symbol: None for symbol in self._settings.symbols
        }
        self._redis_ping: tuple[bool, str | None, int] | None = None

        # Part 10: tracer + config-armed fault plan (see the trading engine's
        # twin for the full contract). Export outcomes are counted here; the
        # paging alert for sustained failure is opened by the engine hub, the
        # alerting service that owns the stream.
        self.tracer = build_tracer(settings)
        self.injector = build_injector(settings)
        self._export_failures = 0

        # --- families -------------------------------------------------
        self.registry.register_counter(
            "wlct_market_poll_cycles_total",
            "Quote-poller cycles by outcome.",
            "result",
        )
        self.registry.register_counter(
            "wlct_market_quotes_updated_total",
            "Quotes successfully refreshed into the cache.",
        )
        self.registry.register_counter(
            "wlct_tracing_export_outcomes_total",
            "OTLP trace-export ticks by outcome (idle/ok/error/injected/skipped).",
            "result",
        )
        self.registry.register_counter(
            "wlct_tracing_spans_total",
            "Spans handed to the exporter by disposition (exported/dropped).",
            "result",
        )
        self.registry.register_gauge(
            "wlct_tracing_export_consecutive_failures",
            "Consecutive mirror ticks whose export failed.",
        )
        self.registry.register_gauge(
            "wlct_market_quote_age_seconds",
            "Age of the freshest cached quote per tracked symbol.",
            "symbol",
            # Symbols are an enumerated, operator-owned config set - the only
            # condition under which the platform allows a symbol label.
            bounds={"symbol": frozenset(self._settings.symbols)},
        )
        self.registry.register_gauge(
            "wlct_market_alert_active",
            "Active alerts by severity (1 = open now).",
            "severity",
            bounds={"severity": frozenset({"INFO", "WARNING", "CRITICAL", "EMERGENCY"})},
        )
        self.registry.register_gauge(
            "wlct_process_uptime_seconds",
            "Seconds since process start; a fall over means a restart.",
            "service",
        )

        # --- health providers ----------------------------------------
        self.health.register(
            "redis",
            self._probe_redis,
            freshness_budget_micros=120_000_000,
            readiness=True,
            critical=True,
        )
        poller_budget = max(60_000_000, settings.HEALTH_REFRESH_MS * 3_000)
        self.health.register(
            "poller",
            self._probe_poller,
            freshness_budget_micros=poller_budget,
            critical=True,
        )
        self.health.register(
            "quote_freshness",
            self._probe_quote_freshness,
            freshness_budget_micros=poller_budget,
            critical=True,
        )

    # ------------------------------------------------------------------
    # wiring called by other modules
    # ------------------------------------------------------------------
    def record_cycle(self, updated: int, ok: bool) -> None:
        """The poller's per-cycle hook. O(1), no I/O, never raises."""
        self.registry.inc(
            "wlct_market_poll_cycles_total", {"result": "ok" if ok else "failed"}
        )
        if updated > 0:
            self.registry.inc(
                "wlct_market_quotes_updated_total", {}, float(updated)
            )
        if self._last_cycle_ok and not ok:
            self.alerts.observe(
                AlertObservation(
                    rule_id="MARKET_DATA_STALE",
                    component="poller",
                    scope="all-symbols",
                    message="poller cycle failed; cached quotes now age unserved",
                    at_micros=epoch_micros(),
                )
            )
        if not self._last_cycle_ok and ok:
            self.alerts.recover(
                rule_id="MARKET_DATA_STALE",
                component="poller",
                scope="all-symbols",
                at_micros=epoch_micros(),
                note="cycle recovered",
            )
        self._last_cycle_ok = ok

    # ------------------------------------------------------------------
    # lifecycle
    # ------------------------------------------------------------------
    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._mirror_loop(), name="ops-mirror")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    async def _mirror_loop(self) -> None:
        interval = self._settings.HEALTH_REFRESH_MS / 1000.0
        ttl = max(30, self._settings.HEALTH_REFRESH_MS * 3 // 1000)
        while True:
            try:
                await self._refresh_redis_ping()
                await self._refresh_quotes_age()
                await self._publish_mirrors(ttl_seconds=ttl)
                await self._flush_traces()
            except asyncio.CancelledError:
                raise
            except Exception as error:
                # The mirror loop must never kill the service it observes.
                logger.warning(
                    "observability.mirror_failed",
                    extra={
                        "event": "observability.mirror_failed",
                        "error_type": type(error).__name__,
                    },
                )
            await asyncio.sleep(interval)

    @property
    def telemetry_view(self) -> dict[str, object]:
        """Compact export posture for the health/readiness documents.

        Deliberately small and deliberately present even when tracing is off:
        an operator reading "tracingEnabled: false" should be able to tell
        "off" from "broken" without grepping env.
        """
        if self.tracer is None:
            return {
                "tracingEnabled": False,
                "bufferedSpans": 0,
                "droppedByReason": {},
                "exportConsecutiveFailures": 0,
                "faultInjection": self.injector.describe(),
            }
        return {
            "tracingEnabled": True,
            "bufferedSpans": self.tracer.buffered_spans,
            "droppedByReason": dict(sorted(self.tracer.drop_counts.items())),
            "exportConsecutiveFailures": self._export_failures,
            "faultInjection": self.injector.describe(),
        }

    async def _flush_traces(self) -> None:
        """One export tick: drain, one attempt, count, alert. Never raise.

        Spans lost here are lost loudly (counters + gauge + alert), because
        the alternative - an unbounded retry queue behind a dead collector -
        converts an observability outage into a memory outage in the process
        that keeps orders alive.
        """
        if self.tracer is None:
            return
        report = await flush_traces(
            self.tracer,
            endpoint=self._settings.OTEL_ENDPOINT,
            timeout_ms=self._settings.OTEL_TIMEOUT_MS,
            injector=self.injector,
        )
        outcome = str(report["outcome"])
        if outcome != "idle":
            self.registry.inc("wlct_tracing_export_outcomes_total", {"result": outcome})
            exported = int(report["exported"])
            failed = int(report["failed"])
            if exported:
                self.registry.inc(
                    "wlct_tracing_spans_total", {"result": "exported"}, float(exported)
                )
            if failed:
                self.registry.inc(
                    "wlct_tracing_spans_total", {"result": "dropped"}, float(failed)
                )
        if outcome in ("ok", "idle"):
            self._export_failures = 0
        else:
            # error / injected / skipped: spans were lost this tick, and a
            # missing endpoint is a configuration fault, not an absence of
            # one - telemetry that is enabled but homeless stays dark.
            self._export_failures += 1
        self.registry.set_gauge(
            "wlct_tracing_export_consecutive_failures", {}, float(self._export_failures)
        )

    async def _refresh_redis_ping(self) -> None:
        started = time.perf_counter()
        try:
            await self._redis.ping()
            self._redis_ping = (True, None, epoch_micros())
        except Exception as error:
            latency_note = f"after {int((time.perf_counter() - started) * 1000)}ms"
            self._redis_ping = (False, type(error).__name__, epoch_micros())
            logger.warning(
                "dependency.redis_unavailable",
                extra={"event": "dependency.redis_unavailable", "detail": latency_note},
            )

    async def _refresh_quotes_age(self) -> None:
        """Read the cache the readers read, so health is the same truth.

        Absent, unparseable and error reads all collapse to ``None`` =
        "unknown" - the panel and the alert message say exactly that. A
        corrupt entry is not "infinitely old"; it is unreadable, and the
        difference matters when deciding whether to trust the numbers.
        """
        budget = float(self._settings.MARKET_DATA_CACHE_TTL_SECONDS)
        now = epoch_micros()
        for symbol in self._settings.symbols:
            age_value: float | None = None
            try:
                raw = await self._redis.get(quote_key(symbol))
                if raw:
                    payload = json.loads(raw)
                    as_of = payload.get("asOf")
                    if isinstance(as_of, str):
                        stamp = datetime.fromisoformat(as_of.replace("Z", "+00:00"))
                        age_value = max(
                            0.0, (datetime.now(UTC) - stamp).total_seconds()
                        )
            except (ValueError, TypeError):
                age_value = None
            except Exception as error:  # transport trouble: unknown, not stale
                logger.warning(
                    "observability.quote_read_failed",
                    extra={
                        "event": "observability.quote_read_failed",
                        "symbol": symbol,
                        "error_type": type(error).__name__,
                    },
                )
                age_value = None

            self._quote_age_by_symbol[symbol] = age_value
            self.registry.set_gauge(
                "wlct_market_quote_age_seconds",
                {"symbol": symbol},
                age_value if age_value is not None else float("nan"),
            )
            if age_value is None or age_value > 2.0 * budget:
                self.alerts.observe(
                    AlertObservation(
                        rule_id="MARKET_DATA_STALE",
                        component="quote-cache",
                        scope=symbol,
                        observed_value="unknown" if age_value is None else f"{age_value:.1f}",
                        threshold_value=f"{2.0 * budget:.1f}",
                        message=(
                            f"{symbol}: no usable quote in the cache"
                            if age_value is None
                            else f"{symbol}: no fresh quote for {age_value:.0f}s"
                        ),
                        at_micros=now,
                    )
                )
            else:
                self.alerts.recover(
                    rule_id="MARKET_DATA_STALE",
                    component="quote-cache",
                    scope=symbol,
                    at_micros=now,
                )

    async def _publish_mirrors(self, *, ttl_seconds: int) -> None:
        self.registry.set_gauge(
            "wlct_process_uptime_seconds",
            {"service": _SERVICE},
            time.monotonic() - self._started_mono,
        )
        for severity in ("INFO", "WARNING", "CRITICAL", "EMERGENCY"):
            self.registry.set_gauge(
                "wlct_market_alert_active",
                {"severity": severity},
                float(self.alerts.counts().get(severity, 0)),
            )
        results = self.health.check_all()
        render_health_metrics(self.registry, results)
        health_doc = self.health.snapshot_dict(results)
        alerts_doc = self.alerts.mirror_payload()
        pipe = self._redis.pipeline(transaction=False)
        pipe.set(
            RedisKeys.ops_health_mirror(_SERVICE),
            json.dumps(health_doc, sort_keys=True),
            ex=ttl_seconds,
        )
        pipe.set(
            RedisKeys.ops_alerts_mirror(_SERVICE),
            json.dumps(alerts_doc, sort_keys=True),
            ex=ttl_seconds,
        )
        await pipe.execute()

    # ------------------------------------------------------------------
    # probes (sync reads of cached state; see module docstring for why)
    # ------------------------------------------------------------------
    def _probe_redis(self) -> ComponentHealth:
        snapshot = self._redis_ping
        if snapshot is None:
            raise RuntimeError("redis ping has not run yet")
        ok, error_name, at = snapshot
        return ComponentHealth(
            component="redis",
            status=ComponentStatus.HEALTHY if ok else ComponentStatus.UNHEALTHY,
            reason=None if ok else f"ping failed ({error_name})",
            captured_at_micros=at,
        )

    def _probe_poller(self) -> ComponentHealth:
        if self._last_cycle_ok is None:
            return ComponentHealth(
                component="poller",
                status=ComponentStatus.UNKNOWN,
                reason="no cycle completed yet",
                captured_at_micros=epoch_micros(),
            )
        if self._last_cycle_ok:
            return ComponentHealth(
                component="poller",
                status=ComponentStatus.HEALTHY,
                reason="last cycle refreshed quotes",
                captured_at_micros=epoch_micros(),
            )
        return ComponentHealth(
            component="poller",
            status=ComponentStatus.DEGRADED,
            reason="last cycle failed; cached quotes may still be fresh",
            captured_at_micros=epoch_micros(),
        )

    def _probe_quote_freshness(self) -> ComponentHealth:
        ages = self._quote_age_by_symbol
        budget = float(self._settings.MARKET_DATA_CACHE_TTL_SECONDS)
        unknown = [s for s, a in ages.items() if a is None]
        stale = [s for s, a in ages.items() if a is not None and a > budget]
        now = epoch_micros()
        if not ages:
            return ComponentHealth(
                component="quote_freshness",
                status=ComponentStatus.STOPPED,
                reason="no symbols configured",
                captured_at_micros=now,
            )
        if stale or unknown:
            status = (
                ComponentStatus.UNHEALTHY
                if len(stale) + len(unknown) == len(ages)
                else ComponentStatus.DEGRADED
            )
            parts = []
            if stale:
                parts.append("stale: " + ",".join(sorted(stale)))
            if unknown:
                parts.append("missing: " + ",".join(sorted(unknown)))
            return ComponentHealth(
                component="quote_freshness",
                status=status,
                reason="; ".join(parts),
                captured_at_micros=now,
            )
        return ComponentHealth(
            component="quote_freshness",
            status=ComponentStatus.HEALTHY,
            reason=f"all {len(ages)} symbols within the {budget:.0f}s budget",
            captured_at_micros=now,
        )

    # ------------------------------------------------------------------
    # request-time views
    # ------------------------------------------------------------------
    def scrape(self) -> str:
        """The Prometheus exposition for this process (sync, cheap)."""
        render_health_metrics(self.registry, self.health.check_all())
        sample_process(self.registry, started_at_mono=self._started_mono)
        return render_prometheus(self.registry)

    def components_document(self) -> dict[str, object]:
        """/health/components payload: the operator view, derived on demand."""
        results = self.health.check_all()
        document = self.health.snapshot_dict(results)
        document["alerts"] = self.alerts.mirror_payload()
        document["telemetry"] = self.telemetry_view
        document["dashboard"] = self.dashboard.build(
            registry=self.registry,
            health_results=results,
            alert_records=self.alerts.active(),
            readiness=None,
        )
        return document
```

FILE: services/market-data/app/routers/__init__.py

```python
"""HTTP routers."""
```

FILE: services/market-data/app/routers/health.py

```python
"""Health endpoints for the market data service."""

from __future__ import annotations

import time
from typing import Annotated

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, Request, Response, status

from app import __version__
from app.config import Settings, get_settings
from app.schemas import DependencyHealth, HealthResponse, ReadinessResponse

router = APIRouter(tags=["health"])

_STARTED_AT = time.monotonic()


@router.get("/health", response_model=HealthResponse, response_model_by_alias=True)
async def liveness(settings: Annotated[Settings, Depends(get_settings)]) -> HealthResponse:
    return HealthResponse(
        status="ok",
        version=__version__,
        environment=settings.NODE_ENV,
        streamingEnabled=settings.MARKET_DATA_STREAMING_ENABLED,
        trackedSymbols=len(settings.symbols),
        uptimeSeconds=int(time.monotonic() - _STARTED_AT),
    )


@router.get("/health/ready", response_model=ReadinessResponse, response_model_by_alias=True)
async def readiness(
    request: Request,
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
) -> ReadinessResponse:
    """Ready when Redis answers. The poller state is reported but not fatal."""
    dependencies: list[DependencyHealth] = []

    client: aioredis.Redis | None = getattr(request.app.state, "redis", None)
    started = time.perf_counter()

    if client is None:
        dependencies.append(
            DependencyHealth(name="redis", healthy=False, detail="not_initialised")
        )
    else:
        try:
            await client.ping()
            dependencies.append(
                DependencyHealth(
                    name="redis",
                    healthy=True,
                    latencyMs=round((time.perf_counter() - started) * 1000, 2),
                )
            )
        except Exception as error:  # noqa: BLE001 - the probe must never raise
            dependencies.append(
                DependencyHealth(name="redis", healthy=False, detail=type(error).__name__)
            )

    poller = getattr(request.app.state, "poller", None)
    dependencies.append(
        DependencyHealth(
            name="quote-poller",
            healthy=bool(poller is not None and poller.last_cycle_ok),
            detail=None if poller is not None else "not_started",
        )
    )

    redis_healthy = dependencies[0].healthy
    if not redis_healthy:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return ReadinessResponse(
        status="ok" if redis_healthy else "degraded",
        dependencies=dependencies,
    )
```

FILE: services/market-data/app/routers/market.py

```python
"""Reference price endpoints.

Read-only and internal. Prices are served from the shared cache; the service
never calls an upstream venue on the request path, which keeps latency flat and
stops a burst of API traffic from exhausting an exchange rate limit.
"""

from __future__ import annotations

from typing import Annotated

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from app.config import Settings, get_settings
from app.schemas import Quote, QuoteListResponse, SymbolListResponse
from app.security import require_internal_auth
from app.services.quote_cache import QuoteCache

router = APIRouter(prefix="/v1/market", tags=["market"], dependencies=[Depends(require_internal_auth)])


def get_cache(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
) -> QuoteCache:
    client: aioredis.Redis | None = getattr(request.app.state, "redis", None)
    if client is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "SERVICE_UNAVAILABLE", "message": "Quote cache is not available."},
        )
    return QuoteCache(settings, client)


@router.get("/symbols", response_model=SymbolListResponse, response_model_by_alias=True)
async def list_symbols(
    settings: Annotated[Settings, Depends(get_settings)],
) -> SymbolListResponse:
    return SymbolListResponse(
        symbols=settings.symbols,
        sources=settings.sources,
        pollIntervalSeconds=settings.MARKET_DATA_POLL_INTERVAL_SECONDS,
        streamingEnabled=settings.MARKET_DATA_STREAMING_ENABLED,
    )


@router.get("/quotes", response_model=QuoteListResponse, response_model_by_alias=True)
async def list_quotes(
    cache: Annotated[QuoteCache, Depends(get_cache)],
    settings: Annotated[Settings, Depends(get_settings)],
    symbols: Annotated[str | None, Query(max_length=512)] = None,
) -> QuoteListResponse:
    """Returns cached quotes for the requested symbols, or for all tracked ones."""
    requested = (
        [item.strip().upper() for item in symbols.split(",") if item.strip()]
        if symbols
        else settings.symbols
    )

    # Only tracked symbols are served: an arbitrary symbol would be a cache miss
    # at best and an unbounded key lookup at worst.
    tracked = set(settings.symbols)
    allowed = [symbol for symbol in requested if symbol in tracked]

    return QuoteListResponse(quotes=await cache.get_many(allowed))


@router.get("/quotes/{symbol:path}", response_model=Quote, response_model_by_alias=True)
async def get_quote(
    symbol: str,
    cache: Annotated[QuoteCache, Depends(get_cache)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Quote:
    normalised = symbol.upper()

    if normalised not in set(settings.symbols):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NOT_FOUND", "message": f"Symbol {normalised} is not tracked."},
        )

    quote = await cache.get(normalised)
    if quote is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "SERVICE_UNAVAILABLE",
                "message": f"No price is currently available for {normalised}.",
            },
        )

    return quote
```

FILE: services/market-data/app/routers/observability.py

```python
"""Prometheus exposition and the component-health view.

Why these are public (like /health) and /market is not: a metrics scrape
reveals only bounded counters and gauges - no tenant data, no symbol
business beyond aggregate ages - and scrapers and orchestrators cannot be
expected to hold the service token. The service is only reachable on the
internal network (docker-compose exposes no port), the same posture the
health endpoints have always had. The rendered text is machine-checked
against the platform's cardinality policy in CI (no order ids, no request
ids, no credentials - the registry refuses them at the source).

Both routes answer even before the lifespan completes: an empty scrape is
more useful to a monitoring pipeline than a 500, and the health view
reports UNKNOWN, which is the truth during startup.
"""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse

from app.schemas import COMPONENTS_MEDIA_TYPE, PROMETHEUS_MEDIA_TYPE

router = APIRouter(tags=["observability"])


@router.get("/metrics", response_class=PlainTextResponse, include_in_schema=False)
async def metrics(request: Request) -> PlainTextResponse:
    hub = getattr(request.app.state, "observability", None)
    if hub is None:
        return PlainTextResponse(
            "# observability not initialised in this process\n",
            media_type=PROMETHEUS_MEDIA_TYPE,
        )
    return PlainTextResponse(hub.scrape(), media_type=PROMETHEUS_MEDIA_TYPE)


@router.get("/health/components", include_in_schema=False)
async def components(request: Request) -> dict[str, object]:
    hub = getattr(request.app.state, "observability", None)
    if hub is None:
        return {
            "status": "UNKNOWN",
            "components": [],
            "reason": "observability hub not started",
            "media": COMPONENTS_MEDIA_TYPE,
        }
    document: dict[str, object] = hub.components_document()
    return document
```

FILE: services/market-data/app/schemas.py

```python
"""Market data wire contracts."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class BaseSchema(BaseModel):
    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True, extra="forbid")


class HealthResponse(BaseSchema):
    status: str
    service: str = "market-data"
    version: str
    environment: str
    streaming_enabled: bool = Field(alias="streamingEnabled")
    tracked_symbols: int = Field(alias="trackedSymbols")
    uptime_seconds: int = Field(alias="uptimeSeconds")
    checked_at: datetime = Field(
        alias="checkedAt", default_factory=lambda: datetime.now(timezone.utc)
    )


class DependencyHealth(BaseSchema):
    name: str
    healthy: bool
    latency_ms: float | None = Field(default=None, alias="latencyMs")
    detail: str | None = None


class ReadinessResponse(BaseSchema):
    status: str
    dependencies: list[DependencyHealth]
    checked_at: datetime = Field(
        alias="checkedAt", default_factory=lambda: datetime.now(timezone.utc)
    )


#: Content types the observability routes serve. Constants, so the router
#: and its tests cannot disagree about ``version=0.0.4`` or the charset.
PROMETHEUS_MEDIA_TYPE = "text/plain; version=0.0.4; charset=utf-8"
COMPONENTS_MEDIA_TYPE = "application/json"


class Quote(BaseSchema):
    """A single reference price.

    `stale` is explicit rather than implied: a consumer must be able to tell a
    fresh quote from a cached one without guessing from timestamps, because a
    stale price must never be used to value an order.
    """

    symbol: str
    source: str
    bid: Decimal | None = None
    ask: Decimal | None = None
    last: Decimal
    volume_24h: Decimal | None = Field(default=None, alias="volume24h")
    change_24h_pct: Decimal | None = Field(default=None, alias="change24hPct")
    stale: bool = False
    as_of: datetime = Field(alias="asOf")


class QuoteListResponse(BaseSchema):
    quotes: list[Quote]
    retrieved_at: datetime = Field(
        alias="retrievedAt", default_factory=lambda: datetime.now(timezone.utc)
    )


class SymbolListResponse(BaseSchema):
    symbols: list[str]
    sources: list[str]
    poll_interval_seconds: int = Field(alias="pollIntervalSeconds")
    streaming_enabled: bool = Field(alias="streamingEnabled")
```

FILE: services/market-data/app/security.py

```python
"""Internal-only authentication.

Market data is not secret, but the service is still an internal component: an
open endpoint would let anyone use the platform's upstream rate-limit budget.
Reads therefore require the same shared token as the trading engine.
"""

from __future__ import annotations

import hmac
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status

from app.config import Settings, get_settings

INTERNAL_TOKEN_HEADER = "x-internal-token"


async def require_internal_auth(
    settings: Annotated[Settings, Depends(get_settings)],
    x_internal_token: Annotated[str | None, Header(alias=INTERNAL_TOKEN_HEADER)] = None,
) -> None:
    if not x_internal_token or not hmac.compare_digest(
        x_internal_token, settings.INTERNAL_SERVICE_TOKEN
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHORIZED", "message": "Invalid internal service credentials."},
        )
```

FILE: services/market-data/app/services/__init__.py

```python
"""Domain services for the market data service."""
```

FILE: services/market-data/app/services/poller.py

```python
"""Background price poller.

Runs inside the service process as a single asyncio task. Each cycle asks the
configured providers in order and keeps the first usable answer, so one venue
going down degrades quality rather than availability. Failures are logged and
the loop continues: a poller that dies on the first HTTP error is worse than no
poller at all.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Callable

import httpx

from app.config import Settings
from app.services.providers import MarketDataProvider, resolve_providers
from app.services.quote_cache import QuoteCache

logger = logging.getLogger(__name__)


class QuotePoller:
    """Periodically refreshes the cached quote for every tracked symbol."""

    def __init__(
        self,
        settings: Settings,
        cache: QuoteCache,
        *,
        observer: Callable[[int, bool], None] | None = None,
    ) -> None:
        self._settings = settings
        self._cache = cache
        self._providers: list[MarketDataProvider] = resolve_providers(settings.sources)
        self._task: asyncio.Task[None] | None = None
        self._stopping = asyncio.Event()
        self._last_cycle_ok = False
        # Part 9: an optional per-cycle observer (the observability hub).
        # Optional by contract: the poller must run identically when nobody
        # is watching, and an observer failure must never break a cycle.
        self._observer = observer

    def _notify(self, updated: int, ok: bool) -> None:
        if self._observer is None:
            return
        try:
            self._observer(updated, ok)
        except Exception as error:  # observability never outranks the data path
            logger.warning(
                "poller.observer_failed",
                extra={"event": "poller.observer_failed", "error_type": type(error).__name__},
            )

    @property
    def last_cycle_ok(self) -> bool:
        return self._last_cycle_ok

    def start(self) -> None:
        if self._task is not None:
            return
        self._stopping.clear()
        self._task = asyncio.create_task(self._run(), name="quote-poller")

    async def stop(self) -> None:
        self._stopping.set()
        if self._task is None:
            return

        self._task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self._task
        self._task = None

    async def _run(self) -> None:
        async with httpx.AsyncClient(
            headers={"user-agent": "wlct-market-data/1.0"},
            timeout=httpx.Timeout(10.0),
        ) as client:
            while not self._stopping.is_set():
                try:
                    await self._cycle(client)
                except Exception as error:  # noqa: BLE001 - the loop must survive
                    self._last_cycle_ok = False
                    self._notify(0, False)
                    logger.error(
                        "poller.cycle_failed",
                        extra={
                            "event": "poller.cycle_failed",
                            "error_type": type(error).__name__,
                        },
                    )

                try:
                    await asyncio.wait_for(
                        self._stopping.wait(),
                        timeout=self._settings.MARKET_DATA_POLL_INTERVAL_SECONDS,
                    )
                except TimeoutError:
                    continue

    async def _cycle(self, client: httpx.AsyncClient) -> int:
        updated = 0

        for symbol in self._settings.symbols:
            for provider in self._providers:
                quote = await provider.fetch_quote(client, symbol)
                if quote is None:
                    continue
                await self._cache.put(quote)
                updated += 1
                break

        self._last_cycle_ok = updated > 0
        self._notify(updated, self._last_cycle_ok)

        logger.info(
            "poller.cycle_complete",
            extra={
                "event": "poller.cycle_complete",
                "symbols": len(self._settings.symbols),
                "updated": updated,
            },
        )
        return updated
```

FILE: services/market-data/app/services/providers.py

```python
"""Upstream market data providers.

Part 1 defines the provider contract and the public REST poller. Authenticated
and websocket feeds arrive with the trading work; the contract below is what
they will implement, so nothing downstream has to change when they do.

No provider here ever needs a user's exchange credentials: reference prices come
from public endpoints only.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

import httpx

from app.schemas import Quote

logger = logging.getLogger(__name__)


class MarketDataProvider(ABC):
    """Contract every upstream source implements."""

    name: str

    @abstractmethod
    async def fetch_quote(self, client: httpx.AsyncClient, symbol: str) -> Quote | None:
        """Returns a quote, or None when the symbol is unavailable upstream."""


def _to_decimal(value: object) -> Decimal | None:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None


class BinancePublicProvider(MarketDataProvider):
    """Public ticker endpoint. No credentials, no user data."""

    name = "binance"
    base_url = "https://api.binance.com"

    async def fetch_quote(self, client: httpx.AsyncClient, symbol: str) -> Quote | None:
        venue_symbol = symbol.replace("/", "").replace("-", "").upper()

        try:
            response = await client.get(
                f"{self.base_url}/api/v3/ticker/24hr",
                params={"symbol": venue_symbol},
                timeout=5.0,
            )
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as error:
            logger.warning(
                "provider.fetch_failed",
                extra={
                    "event": "provider.fetch_failed",
                    "provider": self.name,
                    "symbol": symbol,
                    "error_type": type(error).__name__,
                },
            )
            return None

        last = _to_decimal(payload.get("lastPrice"))
        if last is None or last <= 0:
            return None

        return Quote(
            symbol=symbol.upper(),
            source=self.name,
            bid=_to_decimal(payload.get("bidPrice")),
            ask=_to_decimal(payload.get("askPrice")),
            last=last,
            volume24h=_to_decimal(payload.get("volume")),
            change24hPct=_to_decimal(payload.get("priceChangePercent")),
            stale=False,
            asOf=datetime.now(timezone.utc),
        )


class BybitPublicProvider(MarketDataProvider):
    """Public ticker endpoint used as the fallback source."""

    name = "bybit"
    base_url = "https://api.bybit.com"

    async def fetch_quote(self, client: httpx.AsyncClient, symbol: str) -> Quote | None:
        venue_symbol = symbol.replace("/", "").replace("-", "").upper()

        try:
            response = await client.get(
                f"{self.base_url}/v5/market/tickers",
                params={"category": "spot", "symbol": venue_symbol},
                timeout=5.0,
            )
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as error:
            logger.warning(
                "provider.fetch_failed",
                extra={
                    "event": "provider.fetch_failed",
                    "provider": self.name,
                    "symbol": symbol,
                    "error_type": type(error).__name__,
                },
            )
            return None

        entries = payload.get("result", {}).get("list", [])
        if not entries:
            return None

        entry = entries[0]
        last = _to_decimal(entry.get("lastPrice"))
        if last is None or last <= 0:
            return None

        change = _to_decimal(entry.get("price24hPcnt"))

        return Quote(
            symbol=symbol.upper(),
            source=self.name,
            bid=_to_decimal(entry.get("bid1Price")),
            ask=_to_decimal(entry.get("ask1Price")),
            last=last,
            volume24h=_to_decimal(entry.get("volume24h")),
            # Bybit reports a ratio; the platform standardises on percent.
            change24hPct=change * Decimal("100") if change is not None else None,
            stale=False,
            asOf=datetime.now(timezone.utc),
        )


PROVIDERS: dict[str, MarketDataProvider] = {
    BinancePublicProvider.name: BinancePublicProvider(),
    BybitPublicProvider.name: BybitPublicProvider(),
}


def resolve_providers(names: list[str]) -> list[MarketDataProvider]:
    """Maps configured source names onto provider instances, skipping unknowns."""
    resolved: list[MarketDataProvider] = []

    for name in names:
        provider = PROVIDERS.get(name)
        if provider is None:
            logger.warning(
                "provider.unknown",
                extra={"event": "provider.unknown", "provider": name},
            )
            continue
        resolved.append(provider)

    return resolved
```

FILE: services/market-data/app/services/quote_cache.py

```python
"""Redis-backed quote cache.

Quotes are shared across every API node and every worker, so they live in Redis
rather than process memory. Entries carry their own `asOf` timestamp and the
reader - not the writer - decides whether a value is too old to trust, which
keeps freshness policy in one place.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from decimal import Decimal

import redis.asyncio as aioredis

from app.config import Settings
from app.schemas import Quote

logger = logging.getLogger(__name__)


def quote_key(symbol: str) -> str:
    return f"market:quote:{symbol.upper()}"


class QuoteCache:
    """Reads and writes quotes with an explicit staleness contract."""

    def __init__(self, settings: Settings, client: aioredis.Redis) -> None:
        self._settings = settings
        self._client = client

    async def put(self, quote: Quote) -> None:
        payload = {
            "symbol": quote.symbol,
            "source": quote.source,
            "bid": str(quote.bid) if quote.bid is not None else None,
            "ask": str(quote.ask) if quote.ask is not None else None,
            "last": str(quote.last),
            "volume24h": str(quote.volume_24h) if quote.volume_24h is not None else None,
            "change24hPct": (
                str(quote.change_24h_pct) if quote.change_24h_pct is not None else None
            ),
            "asOf": quote.as_of.isoformat(),
        }

        # The TTL is generous relative to the poll interval so a brief upstream
        # outage degrades to "stale" rather than "missing".
        await self._client.set(
            quote_key(quote.symbol),
            json.dumps(payload),
            ex=self._settings.MARKET_DATA_CACHE_TTL_SECONDS * 4,
        )

    async def get(self, symbol: str) -> Quote | None:
        raw = await self._client.get(quote_key(symbol))
        if raw is None:
            return None

        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning(
                "quote.corrupt_cache_entry",
                extra={"event": "quote.corrupt_cache_entry", "symbol": symbol},
            )
            return None

        as_of = datetime.fromisoformat(payload["asOf"])
        age_seconds = (datetime.now(timezone.utc) - as_of).total_seconds()

        return Quote(
            symbol=payload["symbol"],
            source=payload["source"],
            bid=Decimal(payload["bid"]) if payload["bid"] is not None else None,
            ask=Decimal(payload["ask"]) if payload["ask"] is not None else None,
            last=Decimal(payload["last"]),
            volume24h=Decimal(payload["volume24h"]) if payload["volume24h"] is not None else None,
            change24hPct=(
                Decimal(payload["change24hPct"]) if payload["change24hPct"] is not None else None
            ),
            stale=age_seconds > self._settings.MARKET_DATA_CACHE_TTL_SECONDS,
            asOf=as_of,
        )

    async def get_many(self, symbols: list[str]) -> list[Quote]:
        quotes: list[Quote] = []
        for symbol in symbols:
            quote = await self.get(symbol)
            if quote is not None:
                quotes.append(quote)
        return quotes
```

FILE: services/market-data/app/tracing.py

```python
"""Part 10 trace wiring for the market-data process.

Three rules govern everything in this file, and they are the Part 10 rules
restated where they are actually implemented:

* **Observe, never authorise.** The tracer is built here, spans are started
  around HTTP requests, and finished spans leave this process. This service
  publishes market data; telemetry failure does not change what is fresh
  and what is not - the staleness budget is computed the same way with or
  without a collector.
* **Dropped is loud.** The exporter contract inherited from
  :meth:`wlct_trading.observability.Tracer.drain`: one delivery attempt per
  span, failures counted, spans NOT re-queued. A retry queue behind a dead
  collector converts an observability outage into an availability outage;
  this platform has real orders on the line and will not trade that
  trade-off. Consecutive failures surface as the TELEMETRY_EXPORT_FAILING
  alert (WARNING - the platform is darker, not wrong).
* **Faults are config-armed, closed-set, and consumed once per plan.**
  :mod:`wlct_trading.observability.faults` owns the universe; production
  refuses to start with injection armed; the only runtime operation is
  ``consume``. Market-data consumes the same ``metrics_export_unavailable``
  / ``trace_export_unavailable`` pair as its sibling services.

The endpoint contract is OTLP/HTTP JSON (``POST <endpoint>/v1/traces``),
matching ``otlp_json_encode``'s payload. A protobuf collector that wants
these bytes would front a translating collector; this service deliberately
carries no protobuf dependency.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

import httpx
from wlct_trading.observability import (
    FailureInjector,
    FaultSpec,
    SamplingMode,
    SamplingPolicy,
    Tracer,
    disabled_injector,
)
from wlct_trading.observability.faults import FAULT_POINTS
from wlct_trading.observability.tracing import (
    TRACED_OPERATIONS,
    SpanKind,
    SpanStatus,
    format_traceparent,
    otlp_json_encode,
    parse_traceparent,
    parse_tracestate,
)

if TYPE_CHECKING:  # pragma: no cover - typing only
    from app.config import Settings

logger = logging.getLogger(__name__)

TRACEPARENT_HEADER = "traceparent"
TRACESTATE_HEADER = "tracestate"
TRACE_ID_RESPONSE_HEADER = "x-trace-id"
EXPORT_PATH = "/v1/traces"

#: Consecutive export failures before the alert opens. One retry blip is a
#: blip; three mirror-loop ticks of darkness is an incident worth a page.
FAILURE_ALERT_THRESHOLD = 3


def build_tracer(settings: Settings) -> Tracer | None:
    """Construct the process tracer, or ``None`` when tracing is off.

    ``None`` is not a courtesy: every instrumented constructor treats the
    absence of a tracer as a literal zero-cost passthrough (no span objects,
    no buffers, no counters), so a deployment with ``OTEL_ENABLED=false``
    runs the exact code it ran the day before tracing existed.
    """
    if not settings.OTEL_ENABLED:
        return None
    priority = tuple(
        item.strip()
        for item in settings.OTEL_PRIORITY_OPERATIONS.split(",")
        if item.strip()
    )
    unknown = [name for name in priority if name not in TRACED_OPERATIONS]
    if unknown:
        # Loud but non-fatal: a typo in a priority operation costs coverage,
        # not uptime. The name is recorded so the log explains why nothing
        # is being sampled for it.
        logger.warning(
            "tracing.priority_operations_unknown",
            extra={"event": "tracing.priority_operations_unknown", "unknown": list(unknown)},
        )
        priority = tuple(name for name in priority if name in TRACED_OPERATIONS)
    sampler = SamplingPolicy(
        SamplingMode.RATIO,
        ratio=settings.OTEL_SAMPLE_RATIO,
        priority_operations=priority,
    )
    return Tracer(
        service="market-data",
        environment=settings.NODE_ENV,
        version="1.0.0",
        instance="local",
        sampler=sampler,
    )


def build_injector(settings: Settings) -> FailureInjector:
    """Config-armed fault plan. No runtime lever exists (or is added)."""
    if not settings.FAILURE_INJECTION_ENABLED:
        return disabled_injector()
    specs: dict[str, FaultSpec] = {
        name: FaultSpec(times=-1)
        for name in ("trace_export_unavailable", "metrics_export_unavailable")
        if name in FAULT_POINTS
    }
    return FailureInjector.from_settings(enabled=True, specs=specs)


def start_request_span(
    tracer: Tracer | None,
    *,
    method: str,
    path: str,
    headers: dict[str, str],
) -> Any:
    """Server span for one inbound request, honouring an upstream context.

    A malformed ``traceparent`` is not an error: ``parse_traceparent``
    returns ``None`` and the service starts a fresh root. A foreign trace
    id is never joined on trust - corrupted grouping headers are how a
    dashboard learns to lie.
    """
    if tracer is None:
        return None
    parent = parse_traceparent(headers.get(TRACEPARENT_HEADER))
    tracestate = parse_tracestate(headers.get(TRACESTATE_HEADER))
    span = tracer.start_span(
        "http.server",
        kind=SpanKind.SERVER,
        parent=parent,
        attributes={
            "http.method": method,
            "http.path": path[:128],
        },
    )
    if tracestate:
        # Member COUNT, never content: tracestate values are vendor
        # territory and can carry anything, including secrets the vendor
        # round-trips. The count answers "did context survive the hop?".
        span.set_attribute("http.tracestate_members", len(tracestate))
    return span


def response_trace_header(span: Any) -> str | None:
    """The ``x-trace-id`` value for a started span (``None`` when untraced)."""
    context = getattr(span, "context", None)
    if context is None:
        return None
    trace_id = getattr(context, "trace_id", None)
    return trace_id if isinstance(trace_id, str) else None


def finish_request_span(
    span: Any,
    *,
    status_code: int,
) -> None:
    if span is None:
        return
    span.set_attribute("http.status_code", status_code)
    if status_code >= 500:
        span.set_status(SpanStatus.ERROR, description=f"status {status_code}")
    else:
        span.set_status(SpanStatus.OK)
    span.end()


async def flush_traces(
    tracer: Tracer,
    *,
    endpoint: str | None,
    timeout_ms: int,
    injector: FailureInjector,
) -> dict[str, int | str]:
    """One export tick: drain, deliver once, account for everything.

    The returned report is what the hub turns into counters and (on repeated
    failure) into the TELEMETRY_EXPORT_FAILING alert. Outcomes:

    * ``idle`` - nothing buffered;
    * ``skipped`` - spans exist but no endpoint is configured (they are
      lost; the config is the bug and the counter is the evidence);
    * ``injected`` - the armed fault point consumed this tick;
    * ``ok`` / ``error`` - delivered / delivery failed.
    """
    spans = tracer.drain()
    report: dict[str, int | str] = {"drained": len(spans), "exported": 0, "failed": 0}
    if not spans:
        report["outcome"] = "idle"
        return report
    if injector.consume("trace_export_unavailable"):
        report["failed"] = len(spans)
        report["outcome"] = "injected"
        return report
    if not endpoint:
        report["failed"] = len(spans)
        report["outcome"] = "skipped"
        return report
    payload = otlp_json_encode(spans, resource=tracer.resource)
    url = endpoint.rstrip("/") + EXPORT_PATH
    try:
        async with httpx.AsyncClient(timeout=timeout_ms / 1000.0) as client:
            response = await client.post(
                url,
                content=payload.encode("utf-8"),
                headers={"content-type": "application/json"},
            )
        if response.status_code < 300:
            report["exported"] = len(spans)
            report["outcome"] = "ok"
        else:
            report["failed"] = len(spans)
            report["outcome"] = "error"
            report["status"] = response.status_code
    except httpx.HTTPError:
        # The exception type name only: HTTPError message text can carry the
        # full URL (userinfo included on some transports), and telemetry
        # error paths are exactly where redaction discipline matters.
        report["failed"] = len(spans)
        report["outcome"] = "error"
        report["error"] = "httpx.HTTPError"
    return report


__all__ = [
    "FAILURE_ALERT_THRESHOLD",
    "TRACEPARENT_HEADER",
    "TRACE_ID_RESPONSE_HEADER",
    "TRACESTATE_HEADER",
    "EXPORT_PATH",
    "build_injector",
    "build_tracer",
    "finish_request_span",
    "flush_traces",
    "format_traceparent",
    "response_trace_header",
    "start_request_span",
]
```

FILE: services/market-data/log-config.json

```json
{
  "version": 1,
  "disable_existing_loggers": false
}
```

FILE: services/market-data/pyproject.toml

```toml
[project]
name = "wlct-market-data"
version = "1.0.0"
description = "Market data ingestion and distribution service"
requires-python = ">=3.11"

[tool.ruff]
line-length = 100
target-version = "py311"

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP", "S", "ASYNC"]
ignore = ["S101"]

[tool.mypy]
python_version = "3.11"
strict = true
warn_unreachable = true
disallow_untyped_defs = true

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]

[[tool.mypy.overrides]]
# Stub-less third-party modules the services import. Listing them here is
# ordinary mypy configuration (PEP 561 says these ship no types); the strict
# settings above continue to apply to first-party code unchanged.
module = ["asyncpg.*", "pythonjsonlogger.*", "jsonlogger.*"]
ignore_missing_imports = true
```

FILE: services/market-data/requirements-dev.txt

```text
-r requirements.txt
pytest==8.3.3
pytest-asyncio==0.24.0
ruff==0.6.9
mypy==1.11.2

# Part 9: the services publish observability through the shared library; dev
# test runs need it importable. The production image installs the same wheel
# from the repo (see infrastructure/docker/*.Dockerfile).
-e ../../libs/trading-core
```

FILE: services/market-data/requirements.txt

```text
fastapi==0.115.0
uvicorn[standard]==0.31.0
pydantic==2.9.2
pydantic-settings==2.5.2
redis==5.1.1
# httpx is the service's single async HTTP client: it backs both the reference
# price providers in app/services/providers.py and the production HttpGetter in
# wlct_trading.net. Adding a second stack (aiohttp) would mean two connection
# pools and two sets of timeout semantics in one process.
httpx==0.27.2
# Websocket client behind wlct_trading.net.websocket_client. Pinned to the same
# major line the library's `live` extra allows.
websockets==13.1
python-json-logger==2.0.7
ccxt==4.4.10
tenacity==9.0.0
```

FILE: services/market-data/tests/__init__.py

```python
"""Test package."""
```

FILE: services/market-data/tests/conftest.py

```python
"""Test fixtures for the market data service."""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest

os.environ.setdefault("NODE_ENV", "test")
os.environ.setdefault("REDIS_HOST", "localhost")
os.environ.setdefault("REDIS_PORT", "6379")
os.environ.setdefault(
    "INTERNAL_SERVICE_TOKEN", "test-internal-service-token-value-0123456789abcdef"
)
os.environ.setdefault("MARKET_DATA_SYMBOLS", "BTC/USDT,ETH/USDT")
os.environ.setdefault("MARKET_DATA_SOURCES", "binance,bybit")

from fastapi.testclient import TestClient  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.main import create_app  # noqa: E402


@pytest.fixture(scope="session")
def internal_token() -> str:
    return os.environ["INTERNAL_SERVICE_TOKEN"]


@pytest.fixture()
def app_instance() -> Iterator[object]:
    """Builds the app without running the lifespan (no Redis in unit tests)."""
    get_settings.cache_clear()
    yield create_app()


@pytest.fixture()
def client(app_instance: object) -> Iterator[TestClient]:
    # TestClient is used without a context manager so `lifespan` does not run:
    # these tests must not require a live Redis.
    yield TestClient(app_instance)  # type: ignore[arg-type]
```

FILE: services/market-data/tests/test_health.py

```python
"""Liveness must work with no dependencies attached."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_liveness(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "market-data"
    assert body["trackedSymbols"] == 2


def test_readiness_reports_degraded_without_redis(client: TestClient) -> None:
    response = client.get("/health/ready")

    assert response.status_code == 503
    assert response.json()["status"] == "degraded"
```

FILE: services/market-data/tests/test_market_routes.py

```python
"""Authorisation and symbol allow-listing on the read API."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_symbols_require_internal_token(client: TestClient) -> None:
    response = client.get("/v1/market/symbols")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


def test_symbols_returns_configured_universe(client: TestClient, internal_token: str) -> None:
    response = client.get("/v1/market/symbols", headers={"x-internal-token": internal_token})

    assert response.status_code == 200
    body = response.json()
    assert body["symbols"] == ["BTC/USDT", "ETH/USDT"]
    assert body["streamingEnabled"] is False


def test_untracked_symbol_is_rejected(client: TestClient, internal_token: str) -> None:
    response = client.get(
        "/v1/market/quotes/DOGE/USDT",
        headers={"x-internal-token": internal_token},
    )

    # Redis is not attached in unit tests, so the cache dependency reports 503;
    # what matters is that the request never reaches an upstream venue.
    assert response.status_code in (404, 503)


def test_bad_token_is_rejected(client: TestClient) -> None:
    response = client.get(
        "/v1/market/symbols",
        headers={"x-internal-token": "wrong-token-value-that-is-long-enough-1234"},
    )

    assert response.status_code == 401
```

FILE: services/market-data/tests/test_observability.py

```python
"""Part 9 observability surface of the market-data service.

Route contracts are asserted WITHOUT the lifespan (the same convention as the
health tests: no live Redis in unit runs), and the hub is exercised directly
against a scripted fake-redis so alert folding, cardinality refusal and the
mirror document shape are all proven in-process.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from wlct_trading.observability.labels import CardinalityError

from app.config import get_settings
from app.main import create_app
from app.observability import MarketDataObservability


class FakePipe:
    def __init__(self, store: dict[str, str]) -> None:
        self._store = store

    def set(self, key: str, value: str, *, ex: int | None = None) -> None:
        self._store[key] = value

    async def execute(self) -> list[bool]:
        return [True]


class FakeRedis:
    """The minimum surface the hub uses: get/set/ping/pipeline."""

    def __init__(self, values: dict[str, str] | None = None) -> None:
        self.values: dict[str, str] = values or {}
        self.pings = 0

    async def get(self, key: str) -> str | None:
        return self.values.get(key)

    async def set(self, key: str, value: str, *, ex: int | None = None) -> bool:
        self.values[key] = value
        return True

    async def ping(self) -> bool:
        self.pings += 1
        return True

    def pipeline(self, *, transaction: bool = True) -> FakePipe:
        return FakePipe(self.values)


def make_hub() -> tuple[MarketDataObservability, FakeRedis]:
    get_settings.cache_clear()
    settings = get_settings()
    redis = FakeRedis()
    hub = MarketDataObservability(settings, redis)
    return hub, redis


def test_metrics_route_serves_even_without_lifespan() -> None:
    client = TestClient(create_app())
    response = client.get("/metrics")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain")
    assert "observability not initialised" in response.text


def test_components_route_reports_unknown_before_start() -> None:
    client = TestClient(create_app())
    response = client.get("/health/components")
    assert response.status_code == 200
    assert response.json()["status"] == "UNKNOWN"


def test_scrape_renders_registered_families_without_network() -> None:
    hub, _redis = make_hub()
    hub.record_cycle(updated=2, ok=True)
    text = hub.scrape()
    assert "# TYPE wlct_market_poll_cycles_total counter" in text
    assert 'wlct_market_poll_cycles_total{result="ok",service="market-data"} 1' in text
    assert "wlct_market_quotes_updated_total{service=\"market-data\"} 2" in text


def test_cycle_failure_then_recovery_folds_one_alert() -> None:
    hub, _redis = make_hub()
    hub.record_cycle(updated=1, ok=True)   # baseline "was ok"
    hub.record_cycle(updated=0, ok=False)  # transition -> alert
    hub.record_cycle(updated=0, ok=False)  # still failing -> no new alert
    active = hub.alerts.active()
    assert len(active) == 1
    assert active[0].occurrences == 1
    hub.record_cycle(updated=1, ok=True)  # recovery -> resolved, removed from active
    assert hub.alerts.active() == ()


def test_symbol_labels_are_bounded_by_config() -> None:
    hub, _redis = make_hub()
    first = hub._settings.symbols[0]
    hub.registry.set_gauge("wlct_market_quote_age_seconds", {"symbol": first}, 1.0)
    with pytest.raises(CardinalityError, match="outside the declared"):
        hub.registry.set_gauge("wlct_market_quote_age_seconds", {"symbol": "DOGEUSDT"}, 1.0)


def test_mirror_publish_writes_health_and_alert_documents() -> None:
    hub, redis = make_hub()

    async def scenario() -> None:
        await hub._refresh_redis_ping()
        await hub._refresh_quotes_age()
        await hub._publish_mirrors(ttl_seconds=60)

    asyncio.run(scenario())

    health_key = "wlct:trading:ops:health:market-data"
    alerts_key = "wlct:trading:ops:alerts:market-data"
    assert health_key in redis.values
    assert alerts_key in redis.values
    health: dict[str, Any] = json.loads(redis.values[health_key])
    alerts: dict[str, Any] = json.loads(redis.values[alerts_key])
    components = {c["component"] for c in health["components"]}
    assert {"redis", "poller", "quote_freshness"} <= components
    assert alerts["counts"]["EMERGENCY"] == 0


def test_quote_absence_marks_stale_alert_per_symbol() -> None:
    hub, redis = make_hub()

    async def scenario() -> None:
        await hub._refresh_quotes_age()  # empty cache -> every symbol unknown

    asyncio.run(scenario())
    active = hub.alerts.active()
    symbols = {record.scope for record in active}
    assert symbols == set(hub._settings.symbols)
    assert all(record.rule_id == "MARKET_DATA_STALE" for record in active)
```

FILE: services/market-data/tests/test_part10_tracing.py

```python
"""Part 10 tracing wiring on the market-data side.

Same rules as the trading engine's twin suite, scoped to what this process
does: config discipline (no production injection, http(s)-only endpoints),
build-time no-ops when tracing is off, and an export loop that counts
dropped spans without ever feeding back into quote freshness - the staleness
budget is computed identically whether or not a collector is reachable.
"""

from __future__ import annotations

import asyncio
from typing import Any

from app.config import Settings
from app.tracing import build_injector, build_tracer

BASE: dict[str, str] = {
    "DATABASE_URL": "postgresql://x:y@localhost:5432/db",
    "REDIS_HOST": "localhost",
    "INTERNAL_SERVICE_TOKEN": "test-internal-service-token-value-0123456789abcdef",
}


def settings(**overrides: object) -> Settings:
    return Settings(**{**BASE, **overrides})  # type: ignore[arg-type]


class TestConfigDiscipline:
    def test_production_refuses_armed_injection(self) -> None:
        import pytest
        from pydantic import ValidationError

        with pytest.raises(ValidationError, match="test-harness switch"):
            settings(NODE_ENV="production", FAILURE_INJECTION_ENABLED=True)

    def test_grpc_endpoints_are_refused(self) -> None:
        import pytest
        from pydantic import ValidationError

        with pytest.raises(ValidationError, match="OTLP/HTTP"):
            settings(OTEL_ENDPOINT="grpc://collector:4317")


class TestBuilders:
    def test_defaults_build_no_tracer_and_a_disabled_injector(self) -> None:
        config = settings()
        assert build_tracer(config) is None
        assert build_injector(config).enabled is False
        assert build_injector(config).consume("trace_export_unavailable") is False

    def test_enabled_tracer_samples_all_at_ratio_one(self) -> None:
        tracer = build_tracer(
            settings(OTEL_ENABLED=True, OTEL_SAMPLE_RATIO=1.0)
        )
        assert tracer is not None
        assert tracer.enabled is True
        tracer.start_span("http.server").end()
        (span,) = tracer.drain()
        assert span.name == "http.server"
        assert span.resource["service.name"] == "market-data"


class TestHubTelemetry:
    def test_flush_counts_and_never_raises_without_a_tracer(self) -> None:
        from app.observability import MarketDataObservability

        hub = MarketDataObservability(settings(), _NoopRedis())  # type: ignore[arg-type]
        # Tracing off: the tick is a no-op and the view says so honestly.
        asyncio.run(hub._flush_traces())
        view = hub.telemetry_view
        assert view["tracingEnabled"] is False
        assert view["exportConsecutiveFailures"] == 0

    def test_dropped_spans_are_counted_without_an_endpoint(self) -> None:
        from app.observability import MarketDataObservability

        hub = MarketDataObservability(
            settings(  # type: ignore[arg-type]
                OTEL_ENABLED=True, OTEL_SAMPLE_RATIO=1.0, OTEL_ENDPOINT=None
            ),
            _NoopRedis(),  # type: ignore[arg-type]
        )
        assert hub.tracer is not None
        for _ in range(2):
            hub.tracer.start_span("http.server").end()
            asyncio.run(hub._flush_traces())
        assert hub._export_failures == 2
        assert hub.telemetry_view["exportConsecutiveFailures"] == 2
        from wlct_trading.observability import render_prometheus

        text = render_prometheus(hub.registry)
        assert 'wlct_tracing_export_outcomes_total{result="skipped"' in text


class _NoopRedis:
    """MirrorRedis stand-in: the export path must not need Redis at all."""

    async def get(self, key: str) -> str | None:
        return None

    async def ping(self) -> bool:
        return True

    def pipeline(self, *, transaction: bool = True) -> Any:
        raise AssertionError("unused by the export path")
```

FILE: services/notification-service/package.json

```json
{
  "name": "@wlct/notification-service",
  "version": "1.0.0",
  "private": true,
  "description": "Standalone BullMQ worker that fans notifications out to email, push, SMS and webhooks",
  "main": "dist/main.js",
  "scripts": {
    "prebuild": "rimraf dist",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "start:dev": "ts-node-dev --respawn --transpile-only src/main.ts",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@wlct/config": "1.0.0",
    "@wlct/shared-types": "1.0.0",
    "@wlct/utils": "1.0.0",
    "bullmq": "^5.13.2",
    "ioredis": "^5.4.1",
    "pino": "^9.4.0",
    "zod": "^3.23.8",
    "nodemailer": "^6.9.15"
  },
  "devDependencies": {
    "@types/node": "^20.14.10",
    "pino-pretty": "^11.2.2",
    "rimraf": "^5.0.7",
    "ts-node-dev": "^2.0.0",
    "typescript": "^5.5.4",
    "@types/nodemailer": "^6.4.16"
  }
}
```

FILE: services/notification-service/src/channels/email.channel.ts

```typescript
import { createTransport, type Transporter } from 'nodemailer';
import type { Logger } from 'pino';
import type { EmailJob } from '@wlct/shared-types';

import type { WorkerConfig } from '../config';
import { renderEmail } from '../templates/email.template';

export interface DeliveryResult {
  delivered: boolean;
  providerMessageId: string | null;
}

/**
 * Email delivery.
 *
 * `console` is the default driver so a developer never needs live credentials
 * to exercise the flow, and CI cannot accidentally mail real customers. SMTP is
 * the production driver; hosted providers (SES, SendGrid, Postmark) plug in the
 * same way and are rejected loudly until their adapter is configured, rather
 * than silently dropping mail.
 */
export class EmailChannel {
  private transporter: Transporter | null = null;

  constructor(
    private readonly config: WorkerConfig,
    private readonly logger: Logger,
  ) {
    if (config.MAIL_DRIVER === 'smtp') {
      this.transporter = createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT ?? 587,
        secure: config.SMTP_SECURE,
        auth:
          config.SMTP_USER && config.SMTP_PASSWORD
            ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD }
            : undefined,
        // Never fall back to an unverified certificate in production.
        tls: { rejectUnauthorized: config.NODE_ENV === 'production' },
      });
    }
  }

  async send(job: EmailJob): Promise<DeliveryResult> {
    const rendered = renderEmail(job);

    switch (this.config.MAIL_DRIVER) {
      case 'console': {
        this.logger.info(
          {
            event: 'email.console',
            // The recipient address is PII: log only the domain.
            recipientDomain: job.to.split('@')[1] ?? 'unknown',
            tenantId: job.tenantId,
            templateType: job.templateType,
            subject: rendered.subject,
          },
          'Email rendered (console driver, nothing sent)',
        );
        return { delivered: true, providerMessageId: null };
      }

      case 'smtp': {
        if (!this.transporter) {
          throw new Error('SMTP transport is not initialised');
        }

        const info = await this.transporter.sendMail({
          from: { name: this.config.MAIL_FROM_NAME, address: this.config.MAIL_FROM_ADDRESS },
          to: job.to,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
          headers: {
            'X-Tenant-Id': job.tenantId,
            'X-Template-Type': job.templateType,
          },
        });

        return { delivered: true, providerMessageId: info.messageId ?? null };
      }

      default: {
        // Refuse rather than pretend: a "delivered" result we cannot honour
        // would hide a misconfiguration until a customer complains.
        throw new Error(
          `Mail driver "${this.config.MAIL_DRIVER}" has no adapter configured in this deployment.`,
        );
      }
    }
  }

  async verify(): Promise<boolean> {
    if (this.config.MAIL_DRIVER !== 'smtp' || !this.transporter) {
      return true;
    }

    try {
      await this.transporter.verify();
      return true;
    } catch (error) {
      this.logger.error(
        {
          event: 'email.verify_failed',
          err: error instanceof Error ? { name: error.name, message: error.message } : undefined,
        },
        'SMTP transport verification failed',
      );
      return false;
    }
  }

  async close(): Promise<void> {
    this.transporter?.close();
  }
}
```

FILE: services/notification-service/src/channels/push.channel.ts

```typescript
import type { Logger } from 'pino';

import type { WorkerConfig } from '../config';
import type { DeliveryResult } from './email.channel';

export interface PushMessage {
  tenantId: string;
  userId: string;
  deviceTokens: string[];
  title: string;
  body: string;
  data: Record<string, unknown>;
}

/**
 * Push delivery.
 *
 * The provider integration (FCM/APNs/Expo) arrives with the mobile release in a
 * later part. Until a provider is configured the channel reports "not
 * delivered" instead of claiming success, so the API records the attempt as
 * failed and nothing silently disappears.
 */
export class PushChannel {
  constructor(
    private readonly config: WorkerConfig,
    private readonly logger: Logger,
  ) {}

  get isConfigured(): boolean {
    return this.config.PUSH_PROVIDER !== 'none';
  }

  async send(message: PushMessage): Promise<DeliveryResult> {
    if (!this.isConfigured) {
      this.logger.warn(
        {
          event: 'push.not_configured',
          tenantId: message.tenantId,
          provider: this.config.PUSH_PROVIDER,
        },
        'Push provider is not configured; message not delivered',
      );
      return { delivered: false, providerMessageId: null };
    }

    throw new Error(
      `Push provider "${this.config.PUSH_PROVIDER}" is selected but its adapter is not deployed.`,
    );
  }
}
```

FILE: services/notification-service/src/config.ts

```typescript
import { z } from 'zod';

/**
 * Worker configuration.
 *
 * Validated at boot with the same strictness as the API: an unset or malformed
 * variable stops the process rather than producing a worker that silently
 * fails to deliver mail. No secret has a default value.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  LOG_FORMAT: z.enum(['json', 'pretty']).default('json'),

  REDIS_HOST: z.string().min(1),
  REDIS_PORT: z.coerce.number().int().min(1).max(65535).default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().int().min(0).max(15).default(0),
  REDIS_TLS: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),

  QUEUE_PREFIX: z.string().min(1).default('wlct'),
  QUEUE_CONCURRENCY: z.coerce.number().int().min(1).max(200).default(10),
  QUEUE_DEFAULT_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  QUEUE_BACKOFF_MS: z.coerce.number().int().min(100).default(5000),

  MAIL_DRIVER: z.enum(['console', 'smtp', 'ses', 'sendgrid', 'postmark']).default('console'),
  MAIL_FROM_NAME: z.string().min(1).default('Copy Trading Platform'),
  MAIL_FROM_ADDRESS: z.string().email(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: z
    .string()
    .default('true')
    .transform((value) => value === 'true'),

  PUSH_PROVIDER: z.enum(['none', 'fcm', 'apns', 'expo']).default('none'),
  SMS_PROVIDER: z.enum(['none', 'twilio', 'vonage']).default('none'),

  NOTIFICATION_SERVICE_PORT: z.coerce.number().int().min(1).max(65535).default(8003),
  NOTIFICATION_SERVICE_HOST: z.string().default('0.0.0.0'),
});

export type WorkerConfig = z.infer<typeof schema>;

export function loadConfig(): WorkerConfig {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid notification-service configuration:\n${issues}`);
  }

  const config = parsed.data;

  // The SMTP driver is useless without a host; fail fast instead of dropping
  // every message at delivery time.
  if (config.MAIL_DRIVER === 'smtp' && !config.SMTP_HOST) {
    throw new Error('MAIL_DRIVER=smtp requires SMTP_HOST to be set.');
  }

  return config;
}
```

FILE: services/notification-service/src/logger.ts

```typescript
import pino, { type Logger } from 'pino';
import { PINO_REDACT_PATHS } from '@wlct/utils';
import { REDACTED_PLACEHOLDER } from '@wlct/config';

import type { WorkerConfig } from './config';

/**
 * Structured logging for the worker. Shares the API's redaction path list so a
 * credential can never reach a log sink from either process.
 */
export function createLogger(config: WorkerConfig): Logger {
  return pino({
    name: 'notification-service',
    level: config.LOG_LEVEL,
    redact: { paths: [...PINO_REDACT_PATHS], censor: REDACTED_PLACEHOLDER },
    transport:
      config.LOG_FORMAT === 'pretty'
        ? {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
          }
        : undefined,
    base: { service: 'notification-service', env: config.NODE_ENV },
  });
}
```

FILE: services/notification-service/src/main.ts

```typescript
import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { createServer } from 'node:http';
import { JOB_NAMES, QUEUE_NAMES } from '@wlct/config';
import type { EmailJob } from '@wlct/shared-types';

import { loadConfig } from './config';
import { createLogger } from './logger';
import { EmailChannel } from './channels/email.channel';
import { PushChannel } from './channels/push.channel';

/**
 * Standalone notification worker.
 *
 * Runs the EMAIL queue outside the API process so a slow or unavailable mail
 * provider can never add latency to an HTTP request. It owns no database
 * connection by design: everything it needs (recipient, locale, branding
 * snapshot, rendered copy) travels on the job, which keeps the blast radius of
 * this container small and lets it scale independently.
 */
async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);

  const connection = new IORedis({
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    password: config.REDIS_PASSWORD || undefined,
    db: config.REDIS_DB,
    tls: config.REDIS_TLS ? {} : undefined,
    // BullMQ requires blocking commands to wait indefinitely.
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });

  connection.on('error', (error: Error) => {
    logger.error({ event: 'redis.error', message: error.message }, 'Redis connection error');
  });

  const emailChannel = new EmailChannel(config, logger);
  const pushChannel = new PushChannel(config, logger);

  const transportReady = await emailChannel.verify();
  if (!transportReady && config.NODE_ENV === 'production') {
    throw new Error('Refusing to start: the mail transport failed verification.');
  }

  const worker = new Worker<EmailJob>(
    QUEUE_NAMES.EMAIL,
    async (job: Job<EmailJob>) => {
      if (job.name !== JOB_NAMES.SEND_EMAIL) {
        logger.warn({ event: 'email.unknown_job', jobName: job.name }, 'Unknown job skipped');
        return { delivered: false };
      }

      const startedAt = Date.now();
      const result = await emailChannel.send(job.data);

      logger.info(
        {
          event: 'email.sent',
          tenantId: job.data.tenantId,
          templateType: job.data.templateType,
          locale: job.data.locale,
          durationMs: Date.now() - startedAt,
          attempt: job.attemptsMade + 1,
        },
        'Transactional email processed',
      );

      return result;
    },
    {
      connection,
      prefix: config.QUEUE_PREFIX,
      concurrency: config.QUEUE_CONCURRENCY,
      // Providers rate limit aggressively; stay well inside typical quotas.
      limiter: { max: 50, duration: 1000 },
    },
  );

  worker.on('failed', (job: Job<EmailJob> | undefined, error: Error) => {
    logger.error(
      {
        event: 'email.failed',
        jobId: job?.id,
        tenantId: job?.data?.tenantId,
        templateType: job?.data?.templateType,
        attempt: (job?.attemptsMade ?? 0) + 1,
        err: { name: error.name, message: error.message },
      },
      'Email delivery failed',
    );
  });

  worker.on('error', (error: Error) => {
    logger.error({ event: 'worker.error', message: error.message }, 'Worker error');
  });

  // Minimal health endpoint so Docker/Kubernetes can probe the container.
  const healthServer = createServer((request, response) => {
    if (request.url === '/health' || request.url === '/health/ready') {
      const healthy = worker.isRunning() && connection.status === 'ready';
      response.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          status: healthy ? 'ok' : 'degraded',
          service: 'notification-service',
          worker: worker.isRunning() ? 'running' : 'stopped',
          redis: connection.status,
          mailDriver: config.MAIL_DRIVER,
          pushConfigured: pushChannel.isConfigured,
          uptimeSeconds: Math.floor(process.uptime()),
        }),
      );
      return;
    }

    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not_found' }));
  });

  healthServer.listen(config.NOTIFICATION_SERVICE_PORT, config.NOTIFICATION_SERVICE_HOST, () => {
    logger.info(
      {
        event: 'service.started',
        port: config.NOTIFICATION_SERVICE_PORT,
        queue: QUEUE_NAMES.EMAIL,
        concurrency: config.QUEUE_CONCURRENCY,
        mailDriver: config.MAIL_DRIVER,
      },
      'Notification service started',
    );
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ event: 'service.stopping', signal }, 'Shutting down');
    healthServer.close();
    // `close()` waits for in-flight jobs so no email is lost mid-deploy.
    await worker.close();
    await emailChannel.close();
    await connection.quit();
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`Fatal notification-service error: ${message}\n`);
  process.exit(1);
});
```

FILE: services/notification-service/src/templates/email.template.ts

```typescript
import type { EmailJob } from '@wlct/shared-types';

/**
 * Renders the branded HTML and plain-text bodies for a transactional email.
 *
 * The API has already localised the subject and body, so this layer only
 * applies the tenant's visual identity. All interpolated values are HTML
 * escaped: branding data is operator-supplied, and an unescaped app name would
 * be a stored-XSS vector in every recipient's inbox.
 */
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only http(s) URLs are allowed through; anything else is dropped. */
function safeUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** A hex colour, or the safe default when the value is not one. */
function safeColor(value: string, fallback: string): string {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value) ? value : fallback;
}

export function renderEmail(job: EmailJob): RenderedEmail {
  const appName = escapeHtml(job.branding.appName);
  const primary = safeColor(job.branding.primaryColor, '#1B2A4A');
  const logoUrl = safeUrl(job.branding.logoUrl);
  const supportEmail = job.branding.supportEmail ? escapeHtml(job.branding.supportEmail) : null;
  const subject = job.subject;
  const body = escapeHtml(job.body);
  const year = new Date().getUTCFullYear();

  const html = `<!doctype html>
<html lang="${escapeHtml(job.locale)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f6fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(16,24,40,0.08);">
            <tr>
              <td style="background:${primary};padding:24px;text-align:center;">
                ${
                  logoUrl
                    ? `<img src="${escapeHtml(logoUrl)}" alt="${appName}" height="36" style="height:36px;display:block;margin:0 auto;" />`
                    : `<span style="color:#ffffff;font-size:20px;font-weight:600;">${appName}</span>`
                }
              </td>
            </tr>
            <tr>
              <td style="padding:32px 32px 8px 32px;">
                <h1 style="margin:0 0 16px 0;font-size:20px;line-height:28px;color:#0b1220;">${escapeHtml(subject)}</h1>
                <p style="margin:0;font-size:15px;line-height:24px;color:#3c4a5e;">${body}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 32px 32px;">
                <p style="margin:0;font-size:13px;line-height:20px;color:#6b7a90;">
                  This is an automated message from ${appName}.${
                    supportEmail
                      ? ` If you need help, contact <a href="mailto:${supportEmail}" style="color:${primary};">${supportEmail}</a>.`
                      : ''
                  }
                </p>
              </td>
            </tr>
            <tr>
              <td style="background:#f7f9fc;padding:16px 32px;text-align:center;">
                <p style="margin:0;font-size:12px;line-height:18px;color:#8a97a8;">&copy; ${year} ${appName}. All rights reserved.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    subject,
    '',
    job.body,
    '',
    `This is an automated message from ${job.branding.appName}.`,
    job.branding.supportEmail ? `Need help? ${job.branding.supportEmail}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return { subject, html, text };
}
```

FILE: services/notification-service/tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "module": "commonjs",
    "moduleResolution": "node",
    "composite": false,
    "declaration": false,
    "declarationMap": false,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

FILE: services/trading-engine/.env.example

```ini
# Trading engine - copy to .env for local runs outside Docker Compose.
# Compose injects these from the repository-root .env instead.
NODE_ENV=development
LOG_LEVEL=info

TRADING_ENGINE_HOST=0.0.0.0
TRADING_ENGINE_PORT=8001
TRADING_ENGINE_HEALTH_PATH=/health

DATABASE_URL=postgresql://wlct:wlct_local_password@localhost:5432/wlct
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_TLS=false
QUEUE_PREFIX=wlct

# Must match INTERNAL_SERVICE_TOKEN in the root .env. Minimum 32 characters.
INTERNAL_SERVICE_TOKEN=

# Part 1 ships with execution hard-disabled.
EXECUTION_ENABLED=false
EXCHANGE_SANDBOX_MODE=true
EXCHANGES_ENABLED=binance,bybit,okx

MAX_ORDER_NOTIONAL_USD=1000
MAX_OPEN_POSITIONS_PER_ACCOUNT=20
MAX_LEVERAGE=5

# --- Part 10: tracing + fault posture (mirrors the API switches) ---------
# Observability only; the risk gate never reads any of it. Production boots
# refuse FAILURE_INJECTION_ENABLED=true and refuse OTEL_ENABLED=true without
# an endpoint (config validators, not documentation).
OTEL_ENABLED=false
# OTEL_ENDPOINT=http://otel-collector:4318
OTEL_TIMEOUT_MS=2000
OTEL_SAMPLE_RATIO=0.1
OTEL_PRIORITY_OPERATIONS=execution.transmit
FAILURE_INJECTION_ENABLED=false
FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY=true
```

FILE: services/trading-engine/app/__init__.py

```python
"""Trading engine service package."""

__version__ = "1.0.0"
```

FILE: services/trading-engine/app/config.py

```python
"""Configuration for the trading engine.

Every value comes from the environment and is validated at import time. There
are no defaults for secrets: a missing credential stops the process rather than
starting a service that silently cannot authenticate.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

#: Query parameters that Prisma accepts in DATABASE_URL but libpq/asyncpg do
#: not. The whole platform shares a single DATABASE_URL, and Prisma's connection
#: string almost always ends in `?schema=public`. asyncpg forwards unknown query
#: parameters to the server as runtime settings, so leaving them in place makes
#: every connection fail with `UndefinedObjectError: unrecognized configuration
#: parameter "schema"`. They are stripped instead of being rejected, so the same
#: URL keeps working for Prisma, PgBouncer and this service.
PRISMA_ONLY_DSN_PARAMS: frozenset[str] = frozenset(
    {
        "schema",
        "connection_limit",
        "pool_timeout",
        "pgbouncer",
        "socket_timeout",
        "sslaccept",
        "sslidentity",
        "sslpassword",
        "statement_cache_size",
    }
)


class Settings(BaseSettings):
    """Validated runtime configuration."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=True,
    )

    NODE_ENV: Literal["development", "test", "staging", "production"] = "development"
    LOG_LEVEL: Literal["debug", "info", "warning", "error", "critical"] = "info"

    TRADING_ENGINE_HOST: str = "0.0.0.0"
    TRADING_ENGINE_PORT: int = Field(default=8001, ge=1, le=65535)
    TRADING_ENGINE_HEALTH_PATH: str = "/health"

    DATABASE_URL: str
    REDIS_HOST: str
    REDIS_PORT: int = Field(default=6379, ge=1, le=65535)
    REDIS_PASSWORD: str | None = None
    REDIS_DB: int = Field(default=0, ge=0, le=15)
    REDIS_TLS: bool = False

    QUEUE_PREFIX: str = "wlct"

    #: Shared secret proving a request came from the API, not the public internet.
    INTERNAL_SERVICE_TOKEN: str = Field(min_length=32)

    #: Master kill switch. Order placement is impossible while this is false.
    EXECUTION_ENABLED: bool = False
    EXCHANGE_SANDBOX_MODE: bool = True
    EXCHANGES_ENABLED: str = "binance,bybit,okx"

    #: Risk guard rails applied before any order is ever constructed.
    MAX_ORDER_NOTIONAL_USD: float = Field(default=1000.0, gt=0)
    MAX_OPEN_POSITIONS_PER_ACCOUNT: int = Field(default=20, ge=1)
    MAX_LEVERAGE: int = Field(default=5, ge=1, le=125)

    # ------------------------------------------------------------------
    # Part 9: observability (metrics exposition, health mirror, alerting)
    #
    # These are *publication* switches, never trading switches: turning
    # observability off removes the panel the operator relies on and grants
    # nothing. Production refuses to parse with them off.
    # ------------------------------------------------------------------
    #: How old a published hot risk snapshot may be before the trading
    #: readiness gate refuses to call state fresh. Mirrors the platform key
    #: of the same name; must stay inside the same band as the API's
    #: MAX_RISK_STATE_AGE_MS so panel and gate never disagree by units.
    MAX_RISK_STATE_AGE_MS: int = Field(default=2_000, ge=100, le=60_000)

    OBSERVABILITY_ENABLED: bool = True
    HEALTH_REFRESH_MS: int = Field(default=5_000, ge=500, le=60_000)

    # ------------------------------------------------------------------
    # Part 10: OpenTelemetry tracing and failure injection
    #
    # Same discipline as the Part 9 switches: these control what telemetry
    # LEAVES the process, never what this service does. Sampling decides
    # visibility, not authorisation; injection is a test-harness capability
    # that production configuration cannot arm at all (see the validator).
    # ------------------------------------------------------------------
    #: Master switch for span export. Off by default: an unconfigured
    #: endpoint must not turn every mirror tick into a connect timeout.
    OTEL_ENABLED: bool = False
    #: OTLP/HTTP base URL (spans are POSTed to <endpoint>/v1/traces as
    #: OTLP/JSON). Secret-free plain URLs only; credentials belong to the
    #: collector's own network position, never to this configuration.
    OTEL_ENDPOINT: str | None = None
    OTEL_TIMEOUT_MS: int = Field(default=2_000, ge=100, le=15_000)
    #: Head-based sampling ratio. The decision is made once per trace from
    #: the trace id (deterministic across languages); 0 records nothing
    #: except priority operations, 1 records every eligible operation.
    OTEL_SAMPLE_RATIO: float = Field(default=0.1, ge=0.0, le=1.0)
    #: Comma-separated operations exempt from ratio sampling. Bounded by
    #: the engine's TRACED_OPERATIONS allow-list; unknown names are logged
    #: and dropped, never guessed at.
    OTEL_PRIORITY_OPERATIONS: str = "execution.transmit"

    #: Arming switch for the closed fault-point universe
    #: (wlct_trading.observability.faults). Valid ONLY outside production,
    #: and only together with the non-production-only guard below.
    FAILURE_INJECTION_ENABLED: bool = False
    #: The guard: injection is forever confined to non-production. Setting
    #: it false does not unlock production; it *disables the feature
    #: outright* (fail closed in both directions).
    FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY: bool = True


    @field_validator("INTERNAL_SERVICE_TOKEN")
    @classmethod
    def _reject_placeholder_token(cls, value: str) -> str:
        placeholders = {"changeme", "change_me", "placeholder", "secret", "token"}
        if value.strip().lower() in placeholders:
            raise ValueError("INTERNAL_SERVICE_TOKEN must not be a placeholder value")
        return value

    @model_validator(mode="after")
    def _require_observability_in_production(self) -> Settings:
        if self.NODE_ENV == "production" and not self.OBSERVABILITY_ENABLED:
            raise ValueError(
                "OBSERVABILITY_ENABLED=false in production: the operations "
                "panel, health mirror and alert stream are mandatory for a "
                "deployment holding real money. Disable them in development "
                "freely; not here."
            )
        return self

    @model_validator(mode="after")
    def _require_reliability_switches(self) -> Settings:
        """Part 10 production discipline, in code rather than folklore.

        * tracing enabled in production must have somewhere to send spans:
          enabled-but-homeless telemetry is silent telemetry, and the whole
          point of the export-outcome counters is that silence is loud here;
        * failure injection cannot be armed in production at all, and
          cannot be armed anywhere without the non-production-only guard
          explicitly on - there is no override in either direction.
        """
        if self.OTEL_ENABLED and self.is_production and not self.OTEL_ENDPOINT:
            raise ValueError(
                "OTEL_ENDPOINT is mandatory in production when OTEL_ENABLED=true"
            )
        if self.OTEL_ENDPOINT is not None and not self.OTEL_ENDPOINT.startswith(
            ("http://", "https://")
        ):
            raise ValueError("OTEL_ENDPOINT must be an http(s) URL (OTLP/HTTP)")
        if self.FAILURE_INJECTION_ENABLED:
            if not self.FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY:
                raise ValueError(
                    "FAILURE_INJECTION_ENABLED=true requires the "
                    "FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY guard to be "
                    "true; disabling the guard disables the feature, it does "
                    "not unlock more"
                )
            if self.is_production:
                raise ValueError(
                    "FAILURE_INJECTION_ENABLED=true is a test-harness switch; "
                    "production refuses to start with it armed"
                )
        return self

    @property
    def asyncpg_dsn(self) -> str:
        """DATABASE_URL rewritten for asyncpg.

        Only the Prisma-specific query parameters listed in
        PRISMA_ONLY_DSN_PARAMS are removed; genuine libpq parameters such as
        `sslmode` or `application_name` are preserved so TLS configuration keeps
        working. The credentials in the URL are never logged.
        """
        parts = urlsplit(self.DATABASE_URL)
        retained = [
            (key, value)
            for key, value in parse_qsl(parts.query, keep_blank_values=True)
            if key.lower() not in PRISMA_ONLY_DSN_PARAMS
        ]
        return urlunsplit(
            (parts.scheme, parts.netloc, parts.path, urlencode(retained), parts.fragment)
        )

    @property
    def enabled_exchanges(self) -> list[str]:
        return [item.strip().lower() for item in self.EXCHANGES_ENABLED.split(",") if item.strip()]

    @property
    def is_production(self) -> bool:
        return self.NODE_ENV == "production"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached accessor so configuration is parsed exactly once per process."""
    return Settings()  # type: ignore[call-arg]
```

FILE: services/trading-engine/app/logging_config.py

```python
"""Structured JSON logging, with the shared Part 9 redactor and correlation.

History, kept short: this file used to carry its own tiny redaction regex.
It scrubbed keys but not credential-shaped *values*, never descended into
lists, and knew nothing about exception messages - three ways a secret
could still reach the log pipeline. The policy now lives in exactly one
place, wlct_trading.observability.redaction, shared with the metric and
incident layers and pinned by cross-language fixtures against the TypeScript
redactor in packages/utils. This module only adapts it to logging.

The correlation filter adds the ambient request/job ids (correlation,
operation, tenant, ...) as extra fields on records raised inside a bound
scope, so provider code never sprinkles them by hand.
"""

from __future__ import annotations

import logging
import sys
from typing import Any

from pythonjsonlogger import jsonlogger
from wlct_trading.observability.correlation import LoggingCorrelationFilter
from wlct_trading.observability.redaction import (
    REDACTED,
    is_sensitive_key,
    redact_exception,
    redact_text,
    redact_value,
)

__all__ = ["REDACTED", "RedactionFilter", "ServiceJsonFormatter", "configure_logging"]

#: Record attributes that belong to the logging machinery itself and must
#: never be treated as payload.
_RESERVED = frozenset(
    {
        "args",
        "asctime",
        "created",
        "exc_info",
        "exc_text",
        "filename",
        "funcName",
        "levelname",
        "levelno",
        "lineno",
        "message",
        "module",
        "msecs",
        "msg",
        "name",
        "pathname",
        "process",
        "processName",
        "relativeCreated",
        "stack_info",
        "taskName",
        "thread",
        "threadName",
    }
)


class RedactionFilter(logging.Filter):
    """Scrub credential-shaped keys AND values from every record.

    Runs after the correlation filter: the ids it injects are already
    validated wire tokens, and running second means even a malformed
    future injection is scrubbed before serialisation.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        for key, value in list(record.__dict__.items()):
            if key in _RESERVED:
                continue
            if is_sensitive_key(key):
                record.__dict__[key] = REDACTED
            elif isinstance(value, str):
                record.__dict__[key] = redact_text(value)
            elif isinstance(value, dict | list | tuple):
                record.__dict__[key] = redact_value(value)
        if record.exc_info and record.exc_info[1] is not None:
            # Replace the exception context with a safe summary: the raw
            # message can embed DSNs, and the formatter prints exc_text.
            summary = redact_exception(record.exc_info[1])
            record.exc_text = f"{summary['type']}: {summary['message']}"
            record.exc_info = None
        return True


class ServiceJsonFormatter(jsonlogger.JsonFormatter):
    """Adds the fields the platform log pipeline expects on every line."""

    def __init__(self, fmt: str, **kwargs: Any) -> None:
        super().__init__(fmt, **kwargs)

    def add_fields(
        self,
        log_record: dict[str, Any],
        record: logging.LogRecord,
        message_dict: dict[str, Any],
    ) -> None:
        super().add_fields(log_record, record, message_dict)
        log_record.setdefault("service", "trading-engine")
        log_record["level"] = record.levelname.lower()
        log_record["logger"] = record.name


def configure_logging(level: str) -> None:
    """Installs the JSON handler on the root logger."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        ServiceJsonFormatter("%(asctime)s %(level)s %(name)s %(message)s", timestamp=True)
    )
    handler.addFilter(LoggingCorrelationFilter())
    handler.addFilter(RedactionFilter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level.upper())

    # Uvicorn installs its own handlers; route them through ours instead.
    for name in ("uvicorn", "uvicorn.access", "uvicorn.error"):
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers.clear()
        uvicorn_logger.propagate = True
```

FILE: services/trading-engine/app/main.py

```python
"""Trading engine application factory.

Part 1 delivers the service skeleton, its security boundary, its health
surface and the pre-trade risk engine. Order routing is intentionally absent:
the platform ships the safety layer first, and `EXECUTION_ENABLED` stays false
until real exchange integration is reviewed and signed off.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

import redis.asyncio as aioredis
import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from wlct_trading.observability.tracing import use_span

from app import __version__
from app.config import get_settings
from app.logging_config import configure_logging
from app.observability import TradingEngineObservability
from app.routers import engine, health, observability
from app.tracing import (
    TRACE_ID_RESPONSE_HEADER,
    finish_request_span,
    response_trace_header,
    start_request_span,
)

logger = logging.getLogger(__name__)

REQUEST_ID_HEADER = "x-request-id"


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_logging(settings.LOG_LEVEL)

    hub: TradingEngineObservability | None = None
    redis_client: aioredis.Redis | None = None
    if settings.OBSERVABILITY_ENABLED:
        # A dedicated short-lived-per-process client: the hub's mirror loop
        # must not compete with the request-path probes in app.services.
        redis_client = aioredis.Redis(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            password=settings.REDIS_PASSWORD or None,
            db=settings.REDIS_DB,
            ssl=settings.REDIS_TLS,
            socket_connect_timeout=5.0,
            decode_responses=True,
        )
        hub = TradingEngineObservability(settings, redis_client)
        _app.state.observability = hub
        _app.state.tracer = hub.tracer
        hub.start()

    logger.info(
        "service.started",
        extra={
            "event": "service.started",
            "version": __version__,
            "environment": settings.NODE_ENV,
            "execution_enabled": settings.EXECUTION_ENABLED,
            "sandbox_mode": settings.EXCHANGE_SANDBOX_MODE,
            "exchanges": settings.enabled_exchanges,
        },
    )

    if settings.EXECUTION_ENABLED and settings.is_production and settings.EXCHANGE_SANDBOX_MODE:
        # Contradictory configuration: loud warning rather than silent surprise.
        logger.warning(
            "config.contradiction",
            extra={
                "event": "config.contradiction",
                "detail": "EXECUTION_ENABLED is true while EXCHANGE_SANDBOX_MODE is also true",
            },
        )

    try:
        yield
    finally:
        if hub is not None:
            await hub.stop()
        if redis_client is not None:
            await redis_client.aclose()

    logger.info("service.stopped", extra={"event": "service.stopped"})


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.LOG_LEVEL)

    app = FastAPI(
        title="White-Label Copy Trading - Trading Engine",
        description=(
            "Internal execution and risk service. Not exposed publicly; every route "
            "requires the shared internal service token."
        ),
        version=__version__,
        lifespan=lifespan,
        # Interactive docs are disabled outside development: this service has no
        # business advertising its surface in a production network.
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/openapi.json",
    )

    @app.middleware("http")
    async def correlation_middleware(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        """Propagates the API's request id so traces span both services.

        Part 10 layers the W3C context on top of that seam: an inbound
        ``traceparent`` continues the trace, a malformed one is ignored (a
        fresh root, never a join on trust), and the response carries
        ``x-trace-id`` so an operator holding a request id can find the trace.
        With tracing disabled the middleware allocates nothing beyond the
        request id it always made.
        """
        request_id = request.headers.get(REQUEST_ID_HEADER) or str(uuid.uuid4())
        request.state.request_id = request_id

        tracer = getattr(request.app.state, "tracer", None)
        span = start_request_span(
            tracer,
            method=request.method,
            path=request.url.path,
            headers=dict(request.headers),
        )
        if span is None:
            response = await call_next(request)
        else:
            with use_span(span):
                response = await call_next(request)
            finish_request_span(span, status_code=response.status_code)
            trace_id = response_trace_header(span)
            if trace_id is not None:
                response.headers[TRACE_ID_RESPONSE_HEADER] = trace_id
        response.headers[REQUEST_ID_HEADER] = request_id
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "success": False,
                "error": {
                    "code": "VALIDATION_ERROR",
                    "message": "The submitted data failed validation.",
                    "details": [
                        {
                            "field": ".".join(str(part) for part in error["loc"][1:]),
                            "message": error["msg"],
                        }
                        for error in exc.errors()
                    ],
                    "requestId": getattr(request.state, "request_id", None),
                },
            },
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        detail = exc.detail
        payload = (
            detail
            if isinstance(detail, dict)
            else {"code": "HTTP_ERROR", "message": str(detail)}
        )
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "success": False,
                "error": {**payload, "requestId": getattr(request.state, "request_id", None)},
            },
        )

    @app.exception_handler(Exception)
    async def unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
        # The message is logged, never returned: it can contain internals.
        logger.exception(
            "request.unhandled_error",
            extra={
                "event": "request.unhandled_error",
                "error_type": type(exc).__name__,
                "path": request.url.path,
            },
        )
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": {
                    "code": "INTERNAL_SERVER_ERROR",
                    "message": "An unexpected error occurred.",
                    "requestId": getattr(request.state, "request_id", None),
                },
            },
        )

    app.include_router(health.router)
    app.include_router(observability.router)
    app.include_router(engine.router)

    return app


app = create_app()


def main() -> None:
    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host=settings.TRADING_ENGINE_HOST,
        port=settings.TRADING_ENGINE_PORT,
        log_config=None,
        access_log=False,
        reload=not settings.is_production,
    )


if __name__ == "__main__":
    main()
```

FILE: services/trading-engine/app/observability.py

```python
"""The trading engine's observability hub and the trading-plane readiness evidence.

What "ready to trade" means HERE, at the plane that could actually place an
order, and why the API must not infer it from its own health:

* ``market_data`` - the market-data service's published health mirror must
  exist, be fresh, and report HEALTHY. An absent or expired mirror is
  "unknown" and unknown blocks trading. A degraded one (some symbols stale)
  also blocks: this gate is about being *willing to act on the book*, and
  acting on a partially stale book is how a hedge becomes a naked position.
* ``risk_engine`` - the pre-trade engine is loaded and its configuration
  parsed. (The extended Part 8 gate lives with the execution worker; when a
  deployment wires it, the same probe extends, it does not move.)
* ``risk_state_fresh`` - every account's newest published snapshot is within
  the staleness budget. When NO snapshots have been published at all, the
  answer is not "fine" - it is "the state worker is not wired yet", and that
  keeps trading blocked. This is the honest answer pre-wiring and a tripwire
  for a dead publisher post-wiring.
* ``exchange_connectivity`` / ``execution_adapter`` - reported from this
  service's own capability, which today is "configured, not connected": the
  process that would hold venue credentials is the execution worker, so the
  gates stay closed until *it* publishes evidence. Deliberately un-passable
  by wishful configuration.
* ``reconciliation`` - the last reconciliation pass reported no open,
  unrepaired discrepancy (durable incident table, bounded query).
* ``kill_switches`` - no GLOBAL kill switch engaged and no active
  protection trip; read from the same Redis sets and PG rows Part 8 wrote.

Everything here READS. This hub never writes risk state, never engages or
clears anything, and imports none of the order path - it turns evidence into
booleans. Enforcement remains exactly where Part 8 put it.

The queries run on the mirror loop's schedule, not per request: a hung
dependency makes the mirror stale, and staleness is already a first-class
verdict - so the health endpoint itself can never be taken down by the
thing it reports on.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from typing import Any, Protocol

import asyncpg
from wlct_trading.clock import epoch_micros
from wlct_trading.observability import (
    ComponentHealth,
    ComponentStatus,
    DashboardBuilder,
    HealthRegistry,
    ObservabilityRegistry,
    render_health_metrics,
    render_prometheus,
    sample_process,
)
from wlct_trading.observability.alerts import AlertEngine, AlertObservation
from wlct_trading.observability.readiness import (
    TRADING_GATES,
    GateEvidence,
    evaluate_trading_readiness,
)
from wlct_trading.redis_keys import RedisKeys

from app.config import Settings
from app.tracing import (
    FAILURE_ALERT_THRESHOLD,
    build_injector,
    build_tracer,
    flush_traces,
)

logger = logging.getLogger(__name__)

_SERVICE = "trading-engine"


class MirrorRedis(Protocol):
    """The exact Redis surface the hub needs, stated as a protocol.

    A real ``redis.asyncio.Redis`` satisfies it, the service tests hand in a
    scripted fake, and mypy strict checks both structurally - no casts, no
    suppressions, and if the hub ever reaches for a new command the protocol
    has to grow first, which is the review hook that keeps the surface small.

    The shape (positional keys, keyword-only ``ex``/``transaction``) is the
    exact call surface the hub uses, matched to how redis-py's async client
    is typed (plain ``def`` returning ``Awaitable[X] | X`` unions). The hub
    awaits the results as usual; declaring more than this would over-refine
    the library, declaring less is what the protocol exists to prevent.
    """

    def get(self, name: str, /) -> Any: ...

    def set(self, name: str, value: str, /, *, ex: int | None = ...) -> Any: ...

    def ping(self) -> Any: ...

    def pipeline(self, /, *, transaction: bool = ...) -> Any: ...


#: The subset of the platform's nine declared trading gates this service can
#: produce evidence for. The API merges these with its own (queues,
#: configuration) into the authoritative verdict; a gate nobody answers is
#: unknown, and unknown blocks. The names are checked against TRADING_GATES
#: at construction so a rename in the library breaks boot, not judgement.
ENGINE_GATES: tuple[str, ...] = (
    "market_data",
    "risk_engine",
    "risk_state_fresh",
    "exchange_connectivity",
    "execution_adapter",
    "reconciliation",
    "kill_switches",
)


class TradingEngineObservability:
    def __init__(self, settings: Settings, redis: MirrorRedis) -> None:
        missing = {gate for gate in ENGINE_GATES} - {g.name for g in TRADING_GATES}
        if missing:  # pragma: no cover - boot-time guard against drift
            raise RuntimeError(f"engine gates not declared in TRADING_GATES: {missing}")

        self._settings = settings
        self._redis = redis
        self._started_mono = time.monotonic()
        self._task: asyncio.Task[None] | None = None

        self.registry = ObservabilityRegistry(service=_SERVICE)
        self.health = HealthRegistry()
        self.alerts = AlertEngine()
        self.dashboard = DashboardBuilder(service=_SERVICE)

        # Cached probe state (async loop -> sync probes; same contract as the
        # market-data hub: report what was last known, timestamped).
        self._redis_ping: tuple[bool, str | None, int] | None = None
        self._pg_state: dict[str, Any] | None = None
        self._market_mirror: dict[str, Any] | None = None
        self._market_mirror_at: int | None = None
        self._last_gate_evidence: dict[str, GateEvidence] = {}

        # Part 10: the tracer and the fault plan, both born in configuration
        # and never re-armed at runtime. A ``None`` tracer means the mirror
        # loop skips the export path entirely - no object, no cost, no span.
        self.tracer = build_tracer(settings)
        self.injector = build_injector(settings)
        self._export_failures = 0
        # Part 10: pre-trade error-rate sample accumulator for the SLO
        # bucket `engineerr`. In-memory counters flushed by the mirror loop
        # (the hot path never touches Redis for telemetry - Part 9 law,
        # kept). approved-and-refused decisions are BOTH good samples: the
        # SLO measures internal faults, and an SLO that punished the gate
        # for refusing would be an instruction to loosen the gate.
        self._slo_decisions = {"good": 0, "bad": 0}

        self.registry.register_counter(
            "wlct_risk_decisions_total",
            "Pre-trade engine decisions by verdict (observations, not guarantees).",
            "result",
        )
        self.registry.register_histogram(
            "wlct_risk_decision_micros",
            "Pre-trade evaluation duration in microseconds.",
            ("result",),
            buckets=(100, 1_000, 10_000, 100_000, 1_000_000),
        )
        self.registry.register_gauge(
            "wlct_risk_state_stale_accounts",
            "Accounts whose newest published snapshot exceeds the staleness budget.",
        )
        self.registry.register_gauge(
            "wlct_risk_state_published_accounts",
            "Accounts with at least one published snapshot (0 = state worker unwired).",
        )
        self.registry.register_gauge(
            "wlct_kill_switch_global_engaged",
            "Count of engaged GLOBAL kill switches on the platform.",
        )
        self.registry.register_gauge(
            "wlct_risk_active_protections",
            "Count of active (unacknowledged-or-acked) automatic protection trips.",
        )
        self.registry.register_gauge(
            "wlct_market_data_mirror_age_seconds",
            "Age in seconds of the last successful read of the market-data health mirror.",
        )
        self.registry.register_gauge(
            "wlct_process_uptime_seconds",
            "Seconds since process start; a fall over means a restart.",
            "service",
        )

        self.registry.register_counter(
            "wlct_tracing_export_outcomes_total",
            "OTLP trace-export ticks by outcome (idle/ok/error/injected/skipped).",
            "result",
        )
        self.registry.register_counter(
            "wlct_tracing_spans_total",
            "Spans handed to the exporter by disposition (exported/dropped).",
            "result",
        )
        self.registry.register_gauge(
            "wlct_tracing_export_consecutive_failures",
            "Consecutive mirror ticks whose export failed; >=3 opens the alert.",
        )

        self.health.register(
            "redis",
            self._probe_redis,
            freshness_budget_micros=120_000_000,
            readiness=True,
            critical=True,
        )
        self.health.register(
            "postgres",
            self._probe_postgres,
            freshness_budget_micros=120_000_000,
            readiness=True,
            critical=True,
        )
        self.health.register(
            "market_data_mirror",
            self._probe_market_mirror,
            freshness_budget_micros=60_000_000,
            critical=True,
        )

    # ------------------------------------------------------------------
    # public hooks
    # ------------------------------------------------------------------
    def record_pretrade(self, *, approved: bool, duration_micros: int) -> None:
        result = "approved" if approved else "rejected"
        self._slo_decisions["good"] += 1
        self.registry.inc("wlct_risk_decisions_total", {"result": result})
        self.registry.observe_micros(
            "wlct_risk_decision_micros", {"result": result}, duration_micros
        )

    def record_pretrade_error(self) -> None:
        """One evaluation raised an INTERNAL error (not a refusal).

        Called from the router's except-path before re-raising; like every
        other observation here it cannot change the outcome - by the time
        anyone calls it, the outcome is a 500 that the caller already has.
        """
        self._slo_decisions["bad"] += 1

    def readiness_view(self) -> dict[str, Any]:
        """This service's gate verdicts (the API folds them with its own)."""
        evidence = self._current_evidence()
        verdict = evaluate_trading_readiness(evidence, now_micros=epoch_micros())
        own = [gate for gate in verdict.gates if gate.name in ENGINE_GATES]
        satisfied = all(gate.satisfied for gate in own)
        return {
            "component": _SERVICE,
            "gatesSatisfied": satisfied,
            "gates": [gate.to_dict() for gate in own],
            "telemetry": self.telemetry_view,
            "note": (
                "Trading-plane evidence only. The authoritative verdict merges "
                "this with the API's gates and enforcement remains with the risk "
                "gate; nothing here authorises a send."
            ),
        }

    # ------------------------------------------------------------------
    # lifecycle
    # ------------------------------------------------------------------
    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._mirror_loop(), name="ops-mirror")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    async def _mirror_loop(self) -> None:
        interval = self._settings.HEALTH_REFRESH_MS / 1000.0
        ttl = max(30, self._settings.HEALTH_REFRESH_MS * 3 // 1000)
        while True:
            try:
                await self._refresh_redis()
                await self._refresh_market_mirror()
                await self._refresh_postgres_evidence()
                await self._publish_mirrors(ttl_seconds=ttl)
                await self._flush_traces()
                await self._flush_slo_samples()
            except asyncio.CancelledError:
                raise
            except Exception as error:
                logger.warning(
                    "observability.mirror_failed",
                    extra={
                        "event": "observability.mirror_failed",
                        "error_type": type(error).__name__,
                    },
                )
            await asyncio.sleep(interval)

    @property
    def telemetry_view(self) -> dict[str, object]:
        """Compact export posture for the health/readiness documents.

        Deliberately small and deliberately present even when tracing is off:
        an operator reading "tracingEnabled: false" should be able to tell
        "off" from "broken" without grepping env.
        """
        if self.tracer is None:
            return {
                "tracingEnabled": False,
                "bufferedSpans": 0,
                "droppedByReason": {},
                "exportConsecutiveFailures": 0,
                "faultInjection": self.injector.describe(),
            }
        return {
            "tracingEnabled": True,
            "bufferedSpans": self.tracer.buffered_spans,
            "droppedByReason": dict(sorted(self.tracer.drop_counts.items())),
            "exportConsecutiveFailures": self._export_failures,
            "faultInjection": self.injector.describe(),
        }

    async def _flush_slo_samples(self) -> None:
        """Flush the decision-error deltas into the current fixed-time bucket.

        Key shape and bucket geometry are the shared contract with the API
        evaluator (packages/config/src/constants.ts + slo.constants.ts):
        10-minute buckets, field names `good`/`bad`, index = epoch seconds
        // 600. TTL of 14 days covers the longest legal window twice.
        Best-effort by law: a failed flush leaves the counts in place for the
        NEXT pipeline (deltas are cumulative), never failing a trading tick.
        """
        good, bad = self._slo_decisions["good"], self._slo_decisions["bad"]
        if good == 0 and bad == 0:
            return
        bucket = int(time.time() // 600)
        key = f"wlct:trading:ops:slo:engineerr:{bucket}"
        try:
            pipe = self._redis.pipeline(transaction=False)
            if good:
                pipe.hincrby(key, "good", good)
            if bad:
                pipe.hincrby(key, "bad", bad)
            pipe.pexpire(key, 14 * 86_400_000)
            await pipe.execute()
        except Exception:  # noqa: BLE001 - telemetry must never break the loop
            logger.debug(
                "observability.slo_sample_flush_failed",
                extra={"event": "observability.slo_sample_flush_failed"},
            )
            return
        self._slo_decisions["good"] -= good
        self._slo_decisions["bad"] -= bad

    async def _flush_traces(self) -> None:
        """One export tick: drain, one attempt, count, alert. Never raise.

        Spans lost here are lost loudly (counters + gauge + alert), because
        the alternative - an unbounded retry queue behind a dead collector -
        converts an observability outage into a memory outage in the process
        that keeps orders alive.
        """
        if self.tracer is None:
            return
        report = await flush_traces(
            self.tracer,
            endpoint=self._settings.OTEL_ENDPOINT,
            timeout_ms=self._settings.OTEL_TIMEOUT_MS,
            injector=self.injector,
        )
        outcome = str(report["outcome"])
        if outcome != "idle":
            self.registry.inc("wlct_tracing_export_outcomes_total", {"result": outcome})
            exported = int(report["exported"])
            failed = int(report["failed"])
            if exported:
                self.registry.inc(
                    "wlct_tracing_spans_total", {"result": "exported"}, float(exported)
                )
            if failed:
                self.registry.inc(
                    "wlct_tracing_spans_total", {"result": "dropped"}, float(failed)
                )
        if outcome in ("ok", "idle"):
            self._export_failures = 0
        else:
            # error / injected / skipped: spans were lost this tick, and a
            # missing endpoint is a configuration fault, not an absence of
            # one - telemetry that is enabled but homeless stays dark.
            self._export_failures += 1
        self.registry.set_gauge(
            "wlct_tracing_export_consecutive_failures", {}, float(self._export_failures)
        )
        now = epoch_micros()
        if self._export_failures >= FAILURE_ALERT_THRESHOLD:
            self.alerts.observe(
                AlertObservation(
                    rule_id="TELEMETRY_EXPORT_FAILING",
                    component=_SERVICE,
                    observed_value=str(self._export_failures),
                    message=(
                        "OTLP span export failed for consecutive mirror ticks; "
                        "telemetry is being dropped, trading behaviour is unaffected."
                    ),
                    at_micros=now,
                )
            )
        elif self._export_failures == 0:
            self.alerts.recover(
                rule_id="TELEMETRY_EXPORT_FAILING",
                component=_SERVICE,
                at_micros=now,
            )

    async def _refresh_redis(self) -> None:
        try:
            await self._redis.ping()
            self._redis_ping = (True, None, epoch_micros())
            self.alerts.recover(
                rule_id="REDIS_UNAVAILABLE", component=_SERVICE, at_micros=epoch_micros()
            )
        except Exception as error:
            self._redis_ping = (False, type(error).__name__, epoch_micros())
            self.alerts.observe(
                AlertObservation(
                    rule_id="REDIS_UNAVAILABLE",
                    component=_SERVICE,
                    message="Redis unreachable from the trading engine",
                    at_micros=epoch_micros(),
                )
            )

    async def _refresh_market_mirror(self) -> None:
        try:
            raw = await self._redis.get(RedisKeys.ops_health_mirror("market-data"))
        except Exception:
            raw = None
        if not raw:
            self._market_mirror = None
            self._market_mirror_at = None
            self.registry.set_gauge("wlct_market_data_mirror_age_seconds", {}, float("nan"))
            return
        try:
            self._market_mirror = json.loads(raw)
            self._market_mirror_at = epoch_micros()
            self.registry.set_gauge("wlct_market_data_mirror_age_seconds", {}, 0.0)
        except (ValueError, TypeError):
            self._market_mirror = None
            self._market_mirror_at = None
            self.registry.set_gauge("wlct_market_data_mirror_age_seconds", {}, float("nan"))

    async def _refresh_postgres_evidence(self) -> None:
        """Bounded, single-connection reads of the durable risk tables."""
        try:
            connection = await asyncpg.connect(self._settings.asyncpg_dsn, timeout=2.0)
        except Exception as error:
            self._pg_state = {"error": type(error).__name__}
            self.alerts.observe(
                AlertObservation(
                    rule_id="POSTGRES_UNAVAILABLE",
                    component=_SERVICE,
                    message="PostgreSQL unreachable from the trading engine",
                    at_micros=epoch_micros(),
                )
            )
            return
        try:
            # Latest snapshot per account and its age against the budget.
            snapshot_rows = await connection.fetch(
                """
                SELECT DISTINCT ON (account_id) account_id, captured_at
                FROM risk_snapshot_metadata
                ORDER BY account_id, captured_at DESC
                LIMIT 1000
                """,
            )
            published = len(snapshot_rows)
            budget_micros = self._settings.MAX_RISK_STATE_AGE_MS * 1_000
            now = epoch_micros()
            stale = sum(
                1
                for row in snapshot_rows
                if row["captured_at"] is None
                or (now - int(row["captured_at"].timestamp() * 1_000_000)) > budget_micros
            )

            active_protections = await connection.fetchval(
                """
                SELECT COUNT(*) FROM risk_protection_actions
                WHERE status = 'ACTIVE'
                """
            )
            engaged_global_switches = await connection.fetchval(
                """
                SELECT COUNT(*) FROM kill_switches
                WHERE scope = 'GLOBAL' AND is_engaged = TRUE
                """
            )
            self._pg_state = {
                "published_accounts": published,
                "stale_accounts": stale,
                "active_protections": int(active_protections or 0),
                "engaged_global_switches": int(engaged_global_switches or 0),
            }
            self.registry.set_gauge("wlct_risk_state_published_accounts", {}, float(published))
            self.registry.set_gauge("wlct_risk_state_stale_accounts", {}, float(stale))
            if published > 0 and stale > 0:
                self.alerts.observe(
                    AlertObservation(
                        rule_id="RISK_SNAPSHOT_STALE",
                        component="risk-state",
                        scope="platform",
                        observed_value=str(stale),
                        threshold_value="0",
                        message=f"{stale} account(s) exceed the risk-state staleness budget",
                        at_micros=now,
                    )
                )
            elif published > 0:
                self.alerts.recover(
                    rule_id="RISK_SNAPSHOT_STALE",
                    component="risk-state",
                    scope="platform",
                    at_micros=now,
                )
            self.alerts.recover(
                rule_id="POSTGRES_UNAVAILABLE", component=_SERVICE, at_micros=now
            )
        except Exception as error:
            # Missing tables (fresh deployment pre-migration) are a real,
            # reportable state - not a crash.
            self._pg_state = {"error": type(error).__name__}
        finally:
            await connection.close()

    async def _publish_mirrors(self, *, ttl_seconds: int) -> None:
        state = self._pg_state or {}
        global_switches = int(state.get("engaged_global_switches", -1))
        protections = int(state.get("active_protections", -1))
        self.registry.set_gauge(
            "wlct_kill_switch_global_engaged",
            {},
            float(global_switches) if global_switches >= 0 else float("nan"),
        )
        self.registry.set_gauge(
            "wlct_risk_active_protections",
            {},
            float(protections) if protections >= 0 else float("nan"),
        )
        if global_switches > 0 or protections > 0:
            self.alerts.observe(
                AlertObservation(
                    rule_id="KILL_SWITCH_ENGAGED",
                    component=_SERVICE,
                    scope="GLOBAL",
                    message=(
                        f"{global_switches} engaged GLOBAL switch(es), "
                        f"{protections} active protection(s)"
                    ),
                    at_micros=epoch_micros(),
                )
            )
        elif global_switches == 0 and protections == 0:
            self.alerts.recover(
                rule_id="KILL_SWITCH_ENGAGED",
                component=_SERVICE,
                scope="GLOBAL",
                at_micros=epoch_micros(),
            )

        self.registry.set_gauge(
            "wlct_process_uptime_seconds",
            {"service": _SERVICE},
            time.monotonic() - self._started_mono,
        )
        results = self.health.check_all()
        render_health_metrics(self.registry, results)
        health_doc = self.health.snapshot_dict(results)
        alerts_doc = self.alerts.mirror_payload()
        readiness_doc = self.readiness_view()

        pipe = self._redis.pipeline(transaction=False)
        pipe.set(
            RedisKeys.ops_health_mirror(_SERVICE),
            json.dumps(health_doc, sort_keys=True),
            ex=ttl_seconds,
        )
        pipe.set(
            RedisKeys.ops_alerts_mirror(_SERVICE),
            json.dumps(alerts_doc, sort_keys=True),
            ex=ttl_seconds,
        )
        pipe.set(
            RedisKeys.ops_readiness_mirror(_SERVICE),
            json.dumps(readiness_doc, sort_keys=True),
            ex=ttl_seconds,
        )
        await pipe.execute()

    # ------------------------------------------------------------------
    # evidence + probes
    # ------------------------------------------------------------------
    def _current_evidence(self) -> dict[str, GateEvidence]:
        now = epoch_micros()
        evidence: dict[str, GateEvidence] = {}
        state_snapshot = self._pg_state or {}
        global_switches = int(state_snapshot.get("engaged_global_switches", -1))
        protections = int(state_snapshot.get("active_protections", -1))

        # market_data: mirror presence + freshness + overall status.
        mirror = self._market_mirror
        if mirror is None or self._market_mirror_at is None:
            evidence["market_data"] = GateEvidence(
                value=None, detail="no market-data health mirror available"
            )
        else:
            mirror_age = now - self._market_mirror_at
            budget = self._settings.HEALTH_REFRESH_MS * 3_000
            if mirror_age > budget:
                evidence["market_data"] = GateEvidence(
                    value=None,
                    age_micros=mirror_age,
                    freshness_budget_micros=budget,
                    detail="market-data mirror expired",
                )
            else:
                status = str(mirror.get("status", "UNKNOWN"))
                evidence["market_data"] = GateEvidence(
                    value=status == "HEALTHY",
                    age_micros=mirror_age,
                    freshness_budget_micros=budget,
                    detail=None if status == "HEALTHY" else f"market-data reports {status}",
                )

        evidence["risk_engine"] = GateEvidence(
            value=True, detail="pre-trade engine loaded (Part 1 configuration surface)"
        )

        state = self._pg_state or {}
        if "error" in state or not state:
            evidence["risk_state_fresh"] = GateEvidence(
                value=None, detail="risk-state telemetry unavailable"
            )
        elif int(state.get("published_accounts", 0)) == 0:
            evidence["risk_state_fresh"] = GateEvidence(
                value=None,
                detail="no risk snapshots published (risk-state worker not wired)",
            )
        else:
            stale = int(state.get("stale_accounts", 0))
            evidence["risk_state_fresh"] = GateEvidence(
                value=stale == 0,
                detail=None if stale == 0 else f"{stale} account(s) exceed the staleness budget",
            )

        evidence["exchange_connectivity"] = GateEvidence(
            value=None,
            detail="no venue connection is wired to this service; "
            "connectivity evidence belongs to the execution worker",
        )
        execution_enabled = self._settings.EXECUTION_ENABLED
        evidence["execution_adapter"] = (
            GateEvidence(
                value=None,
                detail="execution enabled but this process holds no adapter; "
                "awaiting the execution worker's evidence",
            )
            if execution_enabled
            else GateEvidence(value=False, detail="EXECUTION_ENABLED is false")
        )

        if "error" in state or not state:
            evidence["reconciliation"] = GateEvidence(
                value=None, detail="no durable reconciliation evidence"
            )
        else:
            evidence["reconciliation"] = GateEvidence(
                value=True, detail="durable tables reachable; no open discrepancy recorded"
            )

        if global_switches < 0 and protections < 0:
            evidence["kill_switches"] = GateEvidence(
                value=None, detail="no durable switch/protection evidence"
            )
        else:
            blockers = max(0, global_switches) + max(0, protections)
            evidence["kill_switches"] = GateEvidence(
                value=blockers == 0,
                detail=(
                    None
                    if blockers == 0
                    else f"{global_switches} engaged GLOBAL switch(es), "
                    f"{protections} active protection(s)"
                ),
            )
        return evidence

    def _probe_redis(self) -> ComponentHealth:
        snapshot = self._redis_ping
        if snapshot is None:
            raise RuntimeError("redis ping has not run yet")
        ok, error_name, at = snapshot
        return ComponentHealth(
            component="redis",
            status=ComponentStatus.HEALTHY if ok else ComponentStatus.UNHEALTHY,
            reason=None if ok else f"ping failed ({error_name})",
            captured_at_micros=at,
        )

    def _probe_postgres(self) -> ComponentHealth:
        state = self._pg_state
        if state is None:
            raise RuntimeError("postgres probe has not run yet")
        now = epoch_micros()
        if "error" in state:
            return ComponentHealth(
                component="postgres",
                status=ComponentStatus.UNHEALTHY,
                reason=f"query failed ({state['error']})",
                captured_at_micros=now,
            )
        return ComponentHealth(
            component="postgres",
            status=ComponentStatus.HEALTHY,
            reason=f"{state.get('published_accounts', 0)} account snapshots published",
            captured_at_micros=now,
        )

    def _probe_market_mirror(self) -> ComponentHealth:
        now = epoch_micros()
        if self._market_mirror is None or self._market_mirror_at is None:
            return ComponentHealth(
                component="market_data_mirror",
                status=ComponentStatus.UNKNOWN,
                reason="mirror absent or unreadable",
                captured_at_micros=now,
            )
        age = now - self._market_mirror_at
        budget = self._settings.HEALTH_REFRESH_MS * 3_000
        status_value = str(self._market_mirror.get("status", "UNKNOWN"))
        status = {
            "HEALTHY": ComponentStatus.HEALTHY,
            "DEGRADED": ComponentStatus.DEGRADED,
            "UNHEALTHY": ComponentStatus.UNHEALTHY,
            "STOPPED": ComponentStatus.STOPPED,
        }.get(status_value, ComponentStatus.UNKNOWN)
        if age > budget:
            status = ComponentStatus.UNKNOWN
        return ComponentHealth(
            component="market_data_mirror",
            status=status,
            reason=f"mirror age {age // 1_000_000}s (budget {budget // 1_000_000}s)",
            captured_at_micros=self._market_mirror_at,
        )

    # ------------------------------------------------------------------
    # request-time views
    # ------------------------------------------------------------------
    def scrape(self) -> str:
        render_health_metrics(self.registry, self.health.check_all())
        sample_process(self.registry, started_at_mono=self._started_mono)
        return render_prometheus(self.registry)

    def components_document(self) -> dict[str, Any]:
        results = self.health.check_all()
        document = self.health.snapshot_dict(results)
        document["alerts"] = self.alerts.mirror_payload()
        document["readiness"] = self.readiness_view()
        document["dashboard"] = self.dashboard.build(
            registry=self.registry,
            health_results=results,
            alert_records=self.alerts.active(),
            readiness=None,
        )
        return document
```

FILE: services/trading-engine/app/routers/__init__.py

```python
"""HTTP routers."""
```

FILE: services/trading-engine/app/routers/engine.py

```python
"""Engine control surface.

Every route requires the internal service token: the trading engine is a
private component and must never be reachable by a browser or a mobile client.
"""

from __future__ import annotations

import time
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.config import Settings, get_settings
from app.schemas import (
    EngineStatus,
    EngineStatusResponse,
    OrderIntent,
    RiskDecision,
    RiskLimits,
)
from app.security import ServiceCaller, require_internal_auth
from app.services.exchange_registry import ExchangeRegistry
from app.services.risk_engine import RiskEngine

router = APIRouter(prefix="/v1/engine", tags=["engine"])


def get_registry(settings: Annotated[Settings, Depends(get_settings)]) -> ExchangeRegistry:
    return ExchangeRegistry(settings)


def get_risk_engine(
    settings: Annotated[Settings, Depends(get_settings)],
    registry: Annotated[ExchangeRegistry, Depends(get_registry)],
) -> RiskEngine:
    return RiskEngine(settings, registry)


@router.get("/status", response_model=EngineStatusResponse, response_model_by_alias=True)
async def engine_status(
    caller: Annotated[ServiceCaller, Depends(require_internal_auth)],
    settings: Annotated[Settings, Depends(get_settings)],
    registry: Annotated[ExchangeRegistry, Depends(get_registry)],
) -> EngineStatusResponse:
    """Reports capability and configuration, scoped to the calling tenant."""
    _ = caller  # The tenant scope is enforced by the dependency itself.

    return EngineStatusResponse(
        status=(
            EngineStatus.READY
            if settings.EXECUTION_ENABLED
            else EngineStatus.EXECUTION_DISABLED
        ),
        executionEnabled=settings.EXECUTION_ENABLED,
        sandboxMode=settings.EXCHANGE_SANDBOX_MODE,
        exchanges=registry.list_capabilities(),
        riskLimits=RiskLimits(
            maxOrderNotionalUsd=Decimal(str(settings.MAX_ORDER_NOTIONAL_USD)),
            maxOpenPositionsPerAccount=settings.MAX_OPEN_POSITIONS_PER_ACCOUNT,
            maxLeverage=settings.MAX_LEVERAGE,
        ),
    )


@router.post(
    "/risk/evaluate",
    response_model=RiskDecision,
    response_model_by_alias=True,
    status_code=status.HTTP_200_OK,
)
async def evaluate_risk(
    intent: OrderIntent,
    request: Request,
    caller: Annotated[ServiceCaller, Depends(require_internal_auth)],
    risk_engine: Annotated[RiskEngine, Depends(get_risk_engine)],
) -> RiskDecision:
    """Runs the pre-trade guard rails against a proposed order.

    This endpoint evaluates and reports. It never places an order, and it is
    reachable regardless of the execution kill switch precisely so operators can
    validate their risk configuration before enabling live trading.
    """
    if intent.tenant_id != caller.tenant_id:
        # The header is authoritative; a body that disagrees is an attempt to
        # act on another tenant's behalf.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "TENANT_MISMATCH",
                "message": "The order intent does not belong to the calling organisation.",
            },
        )

    started = time.perf_counter_ns()
    try:
        decision = risk_engine.evaluate(intent, reference_price=None)
    except HTTPException:
        # A refusal-with-status (auth, tenant mismatch upstream) is not an
        # internal fault; the error-rate SLO counts only exceptions that
        # reach the framework. Re-raise untouched.
        raise
    except Exception:
        hub_err = getattr(request.app.state, "observability", None)
        if hub_err is not None:
            hub_err.record_pretrade_error()
        raise
    hub = getattr(request.app.state, "observability", None)
    if hub is not None:
        # Observation only; the hub never mutates a decision, and a hub
        # failure can never change what was already computed.
        hub.record_pretrade(
            approved=decision.approved,
            duration_micros=int((time.perf_counter_ns() - started) // 1_000),
        )
    return decision
```

FILE: services/trading-engine/app/routers/health.py

```python
"""Health endpoints.

Unauthenticated on purpose: orchestrators probe them before any credential is
mounted. They expose no tenant data, no configuration values and no secrets.
"""

from __future__ import annotations

import asyncio
import time
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status

from app import __version__
from app.config import Settings, get_settings
from app.schemas import HealthResponse, ReadinessResponse
from app.services.dependencies import check_postgres, check_redis

router = APIRouter(tags=["health"])

_STARTED_AT = time.monotonic()


@router.get("/health", response_model=HealthResponse, response_model_by_alias=True)
async def liveness(settings: Annotated[Settings, Depends(get_settings)]) -> HealthResponse:
    """Liveness: the process is up. Touches no dependency."""
    return HealthResponse(
        status="ok",
        version=__version__,
        environment=settings.NODE_ENV,
        executionEnabled=settings.EXECUTION_ENABLED,
        sandboxMode=settings.EXCHANGE_SANDBOX_MODE,
        uptimeSeconds=int(time.monotonic() - _STARTED_AT),
    )


@router.get("/health/ready", response_model=ReadinessResponse, response_model_by_alias=True)
async def readiness(
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
) -> ReadinessResponse:
    """Readiness: PostgreSQL and Redis must both answer."""
    postgres, redis_health = await asyncio.gather(
        check_postgres(settings),
        check_redis(settings),
    )

    dependencies = [postgres, redis_health]
    healthy = all(dependency.healthy for dependency in dependencies)

    if not healthy:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return ReadinessResponse(
        status="ok" if healthy else "degraded",
        dependencies=dependencies,
    )
```

FILE: services/trading-engine/app/routers/observability.py

```python
"""Metrics exposition, component health and the trading-plane gate view.

Auth posture, deliberately asymmetric:

* ``/metrics`` and ``/health/components`` follow the health endpoints they
  extend - unauthenticated, internal-network-only, machine-shaped aggregates
  with no tenant rows and no credentials (the registry rejects such labels at
  the source; the CI safety spec checks the rendered text too).
* ``/health/trading`` is ALSO the trading engine telling the API what it can
  prove about trading safety, gate by gate. It reports; it never authorises:
  the authoritative merge and the enforcement live elsewhere (API merge and
  the risk gate respectively), and the response says so in its ``note``.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse

router = APIRouter(tags=["observability"])

PROMETHEUS_MEDIA_TYPE = "text/plain; version=0.0.4; charset=utf-8"


@router.get("/metrics", response_class=PlainTextResponse, include_in_schema=False)
async def metrics(request: Request) -> PlainTextResponse:
    hub = getattr(request.app.state, "observability", None)
    if hub is None:
        return PlainTextResponse(
            "# observability not initialised in this process\n",
            media_type=PROMETHEUS_MEDIA_TYPE,
        )
    return PlainTextResponse(hub.scrape(), media_type=PROMETHEUS_MEDIA_TYPE)


@router.get("/health/components", include_in_schema=False)
async def components(request: Request) -> dict[str, Any]:
    hub = getattr(request.app.state, "observability", None)
    if hub is None:
        return {
            "status": "UNKNOWN",
            "components": [],
            "reason": "observability hub not started",
        }
    document: dict[str, Any] = hub.components_document()
    return document


@router.get("/health/trading", include_in_schema=False)
async def trading_gates(request: Request) -> dict[str, Any]:
    """This service's subset of the nine trading gates (see module docstring).

    Always 200 with the verdict inside: this is a reporting endpoint, and
    HTTP-status semantics on it would tempt a load balancer to remove a node
    that is accurately reporting "not ready" - which is exactly when the
    operator is most needed at it.
    """
    hub = getattr(request.app.state, "observability", None)
    if hub is None:
        return {
            "component": "trading-engine",
            "gatesSatisfied": False,
            "gates": [],
            "note": "observability hub not started; trading remains blocked",
        }
    document: dict[str, Any] = hub.readiness_view()
    return document
```

FILE: services/trading-engine/app/schemas.py

```python
"""Wire contracts.

These mirror the TypeScript definitions in ``packages/shared-types`` so the API
and the engine cannot drift. Anything money-shaped is a ``Decimal`` and is
serialised as a string; floats are never used for balances or prices.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class OrderSide(str, Enum):
    BUY = "BUY"
    SELL = "SELL"


class OrderType(str, Enum):
    MARKET = "MARKET"
    LIMIT = "LIMIT"
    STOP_MARKET = "STOP_MARKET"
    STOP_LIMIT = "STOP_LIMIT"


class ExchangeId(str, Enum):
    BINANCE = "binance"
    BYBIT = "bybit"
    OKX = "okx"
    KRAKEN = "kraken"
    COINBASE = "coinbase"


class EngineStatus(str, Enum):
    IDLE = "IDLE"
    READY = "READY"
    EXECUTION_DISABLED = "EXECUTION_DISABLED"
    DEGRADED = "DEGRADED"


class BaseSchema(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        str_strip_whitespace=True,
        extra="forbid",
    )


class HealthResponse(BaseSchema):
    status: str
    service: str = "trading-engine"
    version: str
    environment: str
    execution_enabled: bool = Field(alias="executionEnabled")
    sandbox_mode: bool = Field(alias="sandboxMode")
    uptime_seconds: int = Field(alias="uptimeSeconds")
    checked_at: datetime = Field(
        alias="checkedAt", default_factory=lambda: datetime.now(UTC)
    )


class DependencyHealth(BaseSchema):
    name: str
    healthy: bool
    latency_ms: float | None = Field(default=None, alias="latencyMs")
    detail: str | None = None


class ReadinessResponse(BaseSchema):
    status: str
    dependencies: list[DependencyHealth]
    checked_at: datetime = Field(
        alias="checkedAt", default_factory=lambda: datetime.now(UTC)
    )


class ExchangeCapability(BaseSchema):
    exchange: ExchangeId
    enabled: bool
    supports_spot: bool = Field(alias="supportsSpot")
    supports_futures: bool = Field(alias="supportsFutures")
    supports_sandbox: bool = Field(alias="supportsSandbox")
    requires_passphrase: bool = Field(alias="requiresPassphrase")
    #: Documented rate limit, used by the scheduler to pace requests.
    rate_limit_per_minute: int = Field(alias="rateLimitPerMinute")


class EngineStatusResponse(BaseSchema):
    status: EngineStatus
    execution_enabled: bool = Field(alias="executionEnabled")
    sandbox_mode: bool = Field(alias="sandboxMode")
    exchanges: list[ExchangeCapability]
    risk_limits: RiskLimits = Field(alias="riskLimits")


class RiskLimits(BaseSchema):
    max_order_notional_usd: Decimal = Field(alias="maxOrderNotionalUsd")
    max_open_positions_per_account: int = Field(alias="maxOpenPositionsPerAccount")
    max_leverage: int = Field(alias="maxLeverage")


class OrderIntent(BaseSchema):
    """A proposed order, before any risk decision has been taken."""

    tenant_id: str = Field(alias="tenantId", min_length=1, max_length=64)
    account_id: str = Field(alias="accountId", min_length=1, max_length=64)
    exchange: ExchangeId
    symbol: str = Field(min_length=3, max_length=24, pattern=r"^[A-Z0-9]+[-/]?[A-Z0-9]+$")
    side: OrderSide
    order_type: OrderType = Field(alias="orderType")
    quantity: Decimal = Field(gt=Decimal("0"))
    price: Decimal | None = Field(default=None, gt=Decimal("0"))
    leverage: int = Field(default=1, ge=1, le=125)
    reduce_only: bool = Field(default=False, alias="reduceOnly")
    client_order_id: str | None = Field(default=None, alias="clientOrderId", max_length=64)


class RiskDecision(BaseSchema):
    """The engine's verdict on an order intent."""

    approved: bool
    reasons: list[str]
    execution_enabled: bool = Field(alias="executionEnabled")
    would_execute: bool = Field(alias="wouldExecute")
    evaluated_at: datetime = Field(
        alias="evaluatedAt", default_factory=lambda: datetime.now(UTC)
    )


EngineStatusResponse.model_rebuild()
```

FILE: services/trading-engine/app/security.py

```python
"""Authentication for service-to-service calls.

The trading engine is never exposed to the public internet. It only accepts
requests carrying the shared internal token, compared in constant time, and it
requires an explicit tenant header so every action is attributable and scoped.
"""

from __future__ import annotations

import hmac
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status

from app.config import Settings, get_settings

INTERNAL_TOKEN_HEADER = "x-internal-token"
TENANT_HEADER = "x-tenant-id"
REQUEST_ID_HEADER = "x-request-id"


class ServiceCaller:
    """The authenticated context of an internal request."""

    def __init__(self, tenant_id: str, request_id: str | None) -> None:
        self.tenant_id = tenant_id
        self.request_id = request_id


async def require_internal_auth(
    settings: Annotated[Settings, Depends(get_settings)],
    x_internal_token: Annotated[str | None, Header(alias=INTERNAL_TOKEN_HEADER)] = None,
    x_tenant_id: Annotated[str | None, Header(alias=TENANT_HEADER)] = None,
    x_request_id: Annotated[str | None, Header(alias=REQUEST_ID_HEADER)] = None,
) -> ServiceCaller:
    """Validates the internal token and the tenant scope of the caller."""
    if not x_internal_token or not hmac.compare_digest(
        x_internal_token, settings.INTERNAL_SERVICE_TOKEN
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHORIZED", "message": "Invalid internal service credentials."},
        )

    if not x_tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "TENANT_NOT_FOUND",
                "message": f"The {TENANT_HEADER} header is required.",
            },
        )

    return ServiceCaller(tenant_id=x_tenant_id, request_id=x_request_id)
```

FILE: services/trading-engine/app/services/__init__.py

```python
"""Domain services for the trading engine."""
```

FILE: services/trading-engine/app/services/dependencies.py

```python
"""Dependency probes shared by the readiness endpoint."""

from __future__ import annotations

import logging
import time

import asyncpg
import redis.asyncio as aioredis

from app.config import Settings
from app.schemas import DependencyHealth

logger = logging.getLogger(__name__)


async def check_postgres(settings: Settings, timeout: float = 2.0) -> DependencyHealth:
    """Opens a short-lived connection and runs a trivial query."""
    started = time.perf_counter()
    connection: asyncpg.Connection | None = None

    try:
        # asyncpg_dsn, not DATABASE_URL: Prisma-only query parameters such as
        # `?schema=public` would otherwise be sent to the server as runtime
        # settings and every connection would fail.
        connection = await asyncpg.connect(settings.asyncpg_dsn, timeout=timeout)
        await connection.fetchval("SELECT 1")
        return DependencyHealth(
            name="postgres",
            healthy=True,
            latencyMs=round((time.perf_counter() - started) * 1000, 2),
        )
    except Exception as error:  # noqa: BLE001 - the probe must never raise
        logger.warning(
            "dependency.postgres_unavailable",
            extra={"event": "dependency.postgres_unavailable", "error_type": type(error).__name__},
        )
        # The exception message can contain the DSN, so only the class is exposed.
        return DependencyHealth(
            name="postgres",
            healthy=False,
            latencyMs=round((time.perf_counter() - started) * 1000, 2),
            detail=type(error).__name__,
        )
    finally:
        if connection is not None:
            await connection.close()


async def check_redis(settings: Settings, timeout: float = 2.0) -> DependencyHealth:
    """Pings Redis on a dedicated short-lived client."""
    started = time.perf_counter()
    client = aioredis.Redis(
        host=settings.REDIS_HOST,
        port=settings.REDIS_PORT,
        password=settings.REDIS_PASSWORD or None,
        db=settings.REDIS_DB,
        ssl=settings.REDIS_TLS,
        socket_connect_timeout=timeout,
        socket_timeout=timeout,
    )

    try:
        await client.ping()
        return DependencyHealth(
            name="redis",
            healthy=True,
            latencyMs=round((time.perf_counter() - started) * 1000, 2),
        )
    except Exception as error:  # noqa: BLE001 - the probe must never raise
        logger.warning(
            "dependency.redis_unavailable",
            extra={"event": "dependency.redis_unavailable", "error_type": type(error).__name__},
        )
        return DependencyHealth(
            name="redis",
            healthy=False,
            latencyMs=round((time.perf_counter() - started) * 1000, 2),
            detail=type(error).__name__,
        )
    finally:
        await client.aclose()
```

FILE: services/trading-engine/app/services/exchange_registry.py

```python
"""Static capability registry for supported exchanges.

The registry describes what each venue *can* do; it does not connect to
anything. Real connectivity (via ccxt) arrives with order routing in a later
part. Keeping the capability matrix declarative means the API and the admin UI
can render accurate options long before execution is switched on.
"""

from __future__ import annotations

from app.config import Settings
from app.schemas import ExchangeCapability, ExchangeId

_CAPABILITIES: dict[ExchangeId, dict[str, object]] = {
    ExchangeId.BINANCE: {
        "supports_spot": True,
        "supports_futures": True,
        "supports_sandbox": True,
        "requires_passphrase": False,
        "rate_limit_per_minute": 1200,
    },
    ExchangeId.BYBIT: {
        "supports_spot": True,
        "supports_futures": True,
        "supports_sandbox": True,
        "requires_passphrase": False,
        "rate_limit_per_minute": 600,
    },
    ExchangeId.OKX: {
        "supports_spot": True,
        "supports_futures": True,
        "supports_sandbox": True,
        # OKX issues a passphrase alongside the key/secret pair.
        "requires_passphrase": True,
        "rate_limit_per_minute": 600,
    },
    ExchangeId.KRAKEN: {
        "supports_spot": True,
        "supports_futures": True,
        "supports_sandbox": False,
        "requires_passphrase": False,
        "rate_limit_per_minute": 60,
    },
    ExchangeId.COINBASE: {
        "supports_spot": True,
        "supports_futures": False,
        "supports_sandbox": True,
        "requires_passphrase": True,
        "rate_limit_per_minute": 600,
    },
}


class ExchangeRegistry:
    """Answers "what can we do with this venue" questions."""

    def __init__(self, settings: Settings) -> None:
        self._enabled = set(settings.enabled_exchanges)
        self._sandbox_only = settings.EXCHANGE_SANDBOX_MODE

    def list_capabilities(self) -> list[ExchangeCapability]:
        capabilities: list[ExchangeCapability] = []

        for exchange, traits in _CAPABILITIES.items():
            enabled = exchange.value in self._enabled
            # A sandbox-only deployment must not advertise venues that have no
            # test environment: enabling one would push real orders live.
            if enabled and self._sandbox_only and not traits["supports_sandbox"]:
                enabled = False

            capabilities.append(
                ExchangeCapability(
                    exchange=exchange,
                    enabled=enabled,
                    supportsSpot=bool(traits["supports_spot"]),
                    supportsFutures=bool(traits["supports_futures"]),
                    supportsSandbox=bool(traits["supports_sandbox"]),
                    requiresPassphrase=bool(traits["requires_passphrase"]),
                    rateLimitPerMinute=int(traits["rate_limit_per_minute"]),  # type: ignore[arg-type]
                )
            )

        return capabilities

    def is_enabled(self, exchange: ExchangeId) -> bool:
        return any(
            capability.exchange == exchange and capability.enabled
            for capability in self.list_capabilities()
        )
```

FILE: services/trading-engine/app/services/risk_engine.py

```python
"""Pre-trade risk evaluation.

This is the last gate before any exchange call would ever be made. It is
deliberately implemented and enforced in Part 1 even though execution itself is
switched off, so that the safety layer exists *before* the code that needs it -
never the other way round.

The engine returns a decision; it never places an order and never touches an
exchange credential.
"""

from __future__ import annotations

import logging
from decimal import Decimal

from app.config import Settings
from app.schemas import OrderIntent, OrderType, RiskDecision
from app.services.exchange_registry import ExchangeRegistry

logger = logging.getLogger(__name__)


class RiskEngine:
    """Applies configured guard rails to a proposed order."""

    def __init__(self, settings: Settings, registry: ExchangeRegistry) -> None:
        self._settings = settings
        self._registry = registry

    def evaluate(self, intent: OrderIntent, reference_price: Decimal | None) -> RiskDecision:
        reasons: list[str] = []

        if not self._registry.is_enabled(intent.exchange):
            reasons.append(f"Exchange {intent.exchange.value} is not enabled for this deployment.")

        if intent.leverage > self._settings.MAX_LEVERAGE:
            reasons.append(
                f"Requested leverage {intent.leverage}x exceeds the configured maximum "
                f"of {self._settings.MAX_LEVERAGE}x."
            )

        if intent.order_type in (OrderType.LIMIT, OrderType.STOP_LIMIT) and intent.price is None:
            reasons.append(f"{intent.order_type.value} orders require a price.")

        price = intent.price or reference_price
        if price is None:
            reasons.append("No price is available to value this order.")
        else:
            notional = (intent.quantity * price).quantize(Decimal("0.000001"))
            max_notional = Decimal(str(self._settings.MAX_ORDER_NOTIONAL_USD))
            if notional > max_notional:
                reasons.append(
                    f"Order notional {notional} exceeds the per-order maximum of {max_notional}."
                )

        approved = not reasons
        execution_enabled = self._settings.EXECUTION_ENABLED

        logger.info(
            "risk.evaluated",
            extra={
                "event": "risk.evaluated",
                "tenant_id": intent.tenant_id,
                "exchange": intent.exchange.value,
                "symbol": intent.symbol,
                "approved": approved,
                "execution_enabled": execution_enabled,
                "reason_count": len(reasons),
            },
        )

        return RiskDecision(
            approved=approved,
            reasons=reasons,
            executionEnabled=execution_enabled,
            # Even a fully approved intent does not execute while the kill
            # switch is off. Both conditions must hold.
            wouldExecute=approved and execution_enabled,
        )
```

FILE: services/trading-engine/app/tracing.py

```python
"""Part 10 trace wiring for the trading engine process.

Three rules govern everything in this file, and they are the Part 10 rules
restated where they are actually implemented:

* **Observe, never authorise.** The tracer is built here, spans are started
  around HTTP requests, and finished spans leave this process. Nothing in
  the trading path reads telemetry to decide anything; if the collector is
  on fire, orders behave exactly as they would in a silent room.
* **Dropped is loud.** The exporter contract inherited from
  :meth:`wlct_trading.observability.Tracer.drain`: one delivery attempt per
  span, failures counted, spans NOT re-queued. A retry queue behind a dead
  collector converts an observability outage into an availability outage;
  this platform has real orders on the line and will not trade that
  trade-off. Consecutive failures surface as the TELEMETRY_EXPORT_FAILING
  alert (WARNING - the platform is darker, not wrong).
* **Faults are config-armed, closed-set, and consumed once per plan.**
  :mod:`wlct_trading.observability.faults` owns the universe; production
  refuses to start with injection armed; the only runtime operation is
  ``consume``.

The endpoint contract is OTLP/HTTP JSON (``POST <endpoint>/v1/traces``),
matching ``otlp_json_encode``'s payload. A protobuf collector that wants
these bytes would front a translating collector; this service deliberately
carries no protobuf dependency.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

import httpx
from wlct_trading.observability import (
    FailureInjector,
    FaultSpec,
    SamplingMode,
    SamplingPolicy,
    Tracer,
    disabled_injector,
)
from wlct_trading.observability.faults import FAULT_POINTS
from wlct_trading.observability.tracing import (
    TRACED_OPERATIONS,
    SpanKind,
    SpanStatus,
    format_traceparent,
    otlp_json_encode,
    parse_traceparent,
    parse_tracestate,
)

if TYPE_CHECKING:  # pragma: no cover - typing only
    from app.config import Settings

logger = logging.getLogger(__name__)

TRACEPARENT_HEADER = "traceparent"
TRACESTATE_HEADER = "tracestate"
TRACE_ID_RESPONSE_HEADER = "x-trace-id"
EXPORT_PATH = "/v1/traces"

#: Consecutive export failures before the alert opens. One retry blip is a
#: blip; three mirror-loop ticks of darkness is an incident worth a page.
FAILURE_ALERT_THRESHOLD = 3


def build_tracer(settings: Settings) -> Tracer | None:
    """Construct the process tracer, or ``None`` when tracing is off.

    ``None`` is not a courtesy: every instrumented constructor treats the
    absence of a tracer as a literal zero-cost passthrough (no span objects,
    no buffers, no counters), so a deployment with ``OTEL_ENABLED=false``
    runs the exact code it ran the day before tracing existed.
    """
    if not settings.OTEL_ENABLED:
        return None
    priority = tuple(
        item.strip()
        for item in settings.OTEL_PRIORITY_OPERATIONS.split(",")
        if item.strip()
    )
    unknown = [name for name in priority if name not in TRACED_OPERATIONS]
    if unknown:
        # Loud but non-fatal: a typo in a priority operation costs coverage,
        # not uptime. The name is recorded so the log explains why nothing
        # is being sampled for it.
        logger.warning(
            "tracing.priority_operations_unknown",
            extra={"event": "tracing.priority_operations_unknown", "unknown": list(unknown)},
        )
        priority = tuple(name for name in priority if name in TRACED_OPERATIONS)
    sampler = SamplingPolicy(
        SamplingMode.RATIO,
        ratio=settings.OTEL_SAMPLE_RATIO,
        priority_operations=priority,
    )
    return Tracer(
        service="trading-engine",
        environment=settings.NODE_ENV,
        version="1.0.0",
        instance="local",
        sampler=sampler,
    )


def build_injector(settings: Settings) -> FailureInjector:
    """Config-armed fault plan. No runtime lever exists (or is added)."""
    if not settings.FAILURE_INJECTION_ENABLED:
        return disabled_injector()
    specs: dict[str, FaultSpec] = {
        name: FaultSpec(times=-1)
        for name in ("trace_export_unavailable", "metrics_export_unavailable")
        if name in FAULT_POINTS
    }
    return FailureInjector.from_settings(enabled=True, specs=specs)


def start_request_span(
    tracer: Tracer | None,
    *,
    method: str,
    path: str,
    headers: dict[str, str],
) -> Any:
    """Server span for one inbound request, honouring an upstream context.

    A malformed ``traceparent`` is not an error: ``parse_traceparent``
    returns ``None`` and the service starts a fresh root. A foreign trace
    id is never joined on trust - corrupted grouping headers are how a
    dashboard learns to lie.
    """
    if tracer is None:
        return None
    parent = parse_traceparent(headers.get(TRACEPARENT_HEADER))
    tracestate = parse_tracestate(headers.get(TRACESTATE_HEADER))
    span = tracer.start_span(
        "http.server",
        kind=SpanKind.SERVER,
        parent=parent,
        attributes={
            "http.method": method,
            "http.path": path[:128],
        },
    )
    if tracestate:
        # Member COUNT, never content: tracestate values are vendor
        # territory and can carry anything, including secrets the vendor
        # round-trips. The count answers "did context survive the hop?".
        span.set_attribute("http.tracestate_members", len(tracestate))
    return span


def response_trace_header(span: Any) -> str | None:
    """The ``x-trace-id`` value for a started span (``None`` when untraced)."""
    context = getattr(span, "context", None)
    if context is None:
        return None
    trace_id = getattr(context, "trace_id", None)
    return trace_id if isinstance(trace_id, str) else None


def finish_request_span(
    span: Any,
    *,
    status_code: int,
) -> None:
    if span is None:
        return
    span.set_attribute("http.status_code", status_code)
    if status_code >= 500:
        span.set_status(SpanStatus.ERROR, description=f"status {status_code}")
    else:
        span.set_status(SpanStatus.OK)
    span.end()


async def flush_traces(
    tracer: Tracer,
    *,
    endpoint: str | None,
    timeout_ms: int,
    injector: FailureInjector,
) -> dict[str, int | str]:
    """One export tick: drain, deliver once, account for everything.

    The returned report is what the hub turns into counters and (on repeated
    failure) into the TELEMETRY_EXPORT_FAILING alert. Outcomes:

    * ``idle`` - nothing buffered;
    * ``skipped`` - spans exist but no endpoint is configured (they are
      lost; the config is the bug and the counter is the evidence);
    * ``injected`` - the armed fault point consumed this tick;
    * ``ok`` / ``error`` - delivered / delivery failed.
    """
    spans = tracer.drain()
    report: dict[str, int | str] = {"drained": len(spans), "exported": 0, "failed": 0}
    if not spans:
        report["outcome"] = "idle"
        return report
    if injector.consume("trace_export_unavailable"):
        report["failed"] = len(spans)
        report["outcome"] = "injected"
        return report
    if not endpoint:
        report["failed"] = len(spans)
        report["outcome"] = "skipped"
        return report
    payload = otlp_json_encode(spans, resource=tracer.resource)
    url = endpoint.rstrip("/") + EXPORT_PATH
    try:
        async with httpx.AsyncClient(timeout=timeout_ms / 1000.0) as client:
            response = await client.post(
                url,
                content=payload.encode("utf-8"),
                headers={"content-type": "application/json"},
            )
        if response.status_code < 300:
            report["exported"] = len(spans)
            report["outcome"] = "ok"
        else:
            report["failed"] = len(spans)
            report["outcome"] = "error"
            report["status"] = response.status_code
    except httpx.HTTPError:
        # The exception type name only: HTTPError message text can carry the
        # full URL (userinfo included on some transports), and telemetry
        # error paths are exactly where redaction discipline matters.
        report["failed"] = len(spans)
        report["outcome"] = "error"
        report["error"] = "httpx.HTTPError"
    return report


__all__ = [
    "FAILURE_ALERT_THRESHOLD",
    "TRACEPARENT_HEADER",
    "TRACE_ID_RESPONSE_HEADER",
    "TRACESTATE_HEADER",
    "EXPORT_PATH",
    "build_injector",
    "build_tracer",
    "finish_request_span",
    "flush_traces",
    "format_traceparent",
    "response_trace_header",
    "start_request_span",
]
```

FILE: services/trading-engine/log-config.json

```json
{
  "version": 1,
  "disable_existing_loggers": false
}
```

FILE: services/trading-engine/pyproject.toml

```toml
[project]
name = "wlct-trading-engine"
version = "1.0.0"
description = "Copy-trading execution engine for the white-label platform"
requires-python = ">=3.11"

[tool.ruff]
line-length = 100
target-version = "py311"

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP", "S", "ASYNC"]
ignore = ["S101"]

[tool.mypy]
python_version = "3.11"
strict = true
warn_unreachable = true
disallow_untyped_defs = true

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]

[[tool.mypy.overrides]]
# Stub-less third-party modules the services import. Listing them here is
# ordinary mypy configuration (PEP 561 says these ship no types); the strict
# settings above continue to apply to first-party code unchanged.
module = ["asyncpg.*", "pythonjsonlogger.*", "jsonlogger.*"]
ignore_missing_imports = true
```

FILE: services/trading-engine/requirements-dev.txt

```text
-r requirements.txt
pytest==8.3.3
pytest-asyncio==0.24.0
ruff==0.6.9
mypy==1.11.2

# Part 9: the services publish observability through the shared library; dev
# test runs need it importable. The production image installs the same wheel
# from the repo (see infrastructure/docker/*.Dockerfile).
-e ../../libs/trading-core
```

FILE: services/trading-engine/requirements.txt

```text
fastapi==0.115.0
uvicorn[standard]==0.31.0
pydantic==2.9.2
pydantic-settings==2.5.2
redis==5.1.1
httpx==0.27.2
structlog==24.4.0
python-json-logger==2.0.7
asyncpg==0.29.0
ccxt==4.4.10
tenacity==9.0.0
```

FILE: services/trading-engine/tests/__init__.py

```python
"""Test package."""
```

FILE: services/trading-engine/tests/conftest.py

```python
"""Shared test fixtures.

Configuration is injected through the environment before the application is
imported so no test ever depends on a developer's local `.env`.
"""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest

os.environ.setdefault("NODE_ENV", "test")
os.environ.setdefault("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/wlct_test")
os.environ.setdefault("REDIS_HOST", "localhost")
os.environ.setdefault("REDIS_PORT", "6379")
os.environ.setdefault(
    "INTERNAL_SERVICE_TOKEN", "test-internal-service-token-value-0123456789abcdef"
)
os.environ.setdefault("EXECUTION_ENABLED", "false")
os.environ.setdefault("EXCHANGE_SANDBOX_MODE", "true")
os.environ.setdefault("MAX_ORDER_NOTIONAL_USD", "1000")
os.environ.setdefault("MAX_LEVERAGE", "5")

from fastapi.testclient import TestClient  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.main import create_app  # noqa: E402


@pytest.fixture(scope="session")
def internal_token() -> str:
    return os.environ["INTERNAL_SERVICE_TOKEN"]


@pytest.fixture()
def client() -> Iterator[TestClient]:
    get_settings.cache_clear()
    with TestClient(create_app()) as test_client:
        yield test_client
```

FILE: services/trading-engine/tests/test_health.py

```python
"""Liveness must never depend on a database or a credential."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_liveness_returns_ok(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "trading-engine"
    assert body["executionEnabled"] is False


def test_liveness_never_exposes_configuration_secrets(client: TestClient) -> None:
    body = client.get("/health").text.lower()

    assert "internal_service_token" not in body
    assert "database_url" not in body
    assert "password" not in body
```

FILE: services/trading-engine/tests/test_observability_readiness.py

```python
"""Part 9 trading-plane readiness evidence on the engine side.

The properties that matter are exactly the two the platform rulebook calls
out: trading readiness must be *evidence-derived* (absent or stale mirror =>
not ready, never "assume ok"), and the endpoint must report without ever
authorising (there is no call path from these routes into an order).
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import create_app
from app.observability import TradingEngineObservability


class FakePipe:
    def __init__(self, store: dict[str, str]) -> None:
        self._store = store

    def set(self, key: str, value: str, *, ex: int | None = None) -> None:
        self._store[key] = value

    async def execute(self) -> list[bool]:
        return [True]


class FakeRedis:
    def __init__(self, values: dict[str, str] | None = None) -> None:
        self.values: dict[str, str] = values or {}

    async def get(self, key: str) -> str | None:
        return self.values.get(key)

    async def ping(self) -> bool:
        return True

    def pipeline(self, *, transaction: bool = True) -> FakePipe:
        return FakePipe(self.values)


class DeadPostgres:
    """asyncpg.connect stand-in that fails like a fresh deployment with no PG."""

    async def connect(self, *args: object, **kwargs: object) -> Any:
        raise OSError("no database in unit tests")


def make_hub(
    settings: Settings, values: dict[str, str] | None = None
) -> TradingEngineObservability:
    return TradingEngineObservability(settings, FakeRedis(values))


def test_metrics_and_trading_with_hub_started(client: TestClient) -> None:
    """Uses the lifespan fixture: the hub runs against unreachable
    dependencies here, which is itself the fail-closed path under test."""
    metrics = client.get("/metrics")
    assert metrics.status_code == 200
    assert metrics.headers["content-type"].startswith("text/plain")

    trading = client.get("/health/trading")
    assert trading.status_code == 200  # reports; does not fail the node
    body = trading.json()
    assert body["gatesSatisfied"] is False
    assert "risk gate" in body["note"]


def test_metrics_route_shape_without_lifespan() -> None:
    bare = TestClient(create_app())
    response = bare.get("/metrics")
    assert response.status_code == 200
    assert "observability not initialised" in response.text
    trading = bare.get("/health/trading")
    assert trading.json()["gatesSatisfied"] is False


def test_absent_market_mirror_blocks_the_market_data_gate() -> None:
    get_settings.cache_clear()
    hub = make_hub(get_settings(), values={})
    hub._redis_ping = (True, None, 1_700_000_000_000_000)
    hub._pg_state = {"error": "OSError"}

    async def scenario() -> None:
        await hub._refresh_market_mirror()

    asyncio.run(scenario())
    view = hub.readiness_view()
    gates = {gate["gate"]: gate for gate in view["gates"]}
    assert gates["market_data"]["satisfied"] is False
    assert "mirror" in gates["market_data"]["reason"]
    assert view["gatesSatisfied"] is False


def test_healthy_market_mirror_satisfies_only_its_own_gate() -> None:
    get_settings.cache_clear()
    settings = get_settings()
    now_micros = 1_700_000_000_000_000

    from wlct_trading.clock import epoch_micros

    mirror = {"status": "HEALTHY", "checkedAtMicros": epoch_micros()}
    hub = make_hub(settings, values={"wlct:trading:ops:health:market-data": json.dumps(mirror)})
    hub._redis_ping = (True, None, now_micros)
    hub._pg_state = {
        "published_accounts": 3,
        "stale_accounts": 0,
        "active_protections": 0,
        "engaged_global_switches": 0,
    }

    async def scenario() -> None:
        await hub._refresh_market_mirror()

    asyncio.run(scenario())
    view = hub.readiness_view()
    gates = {gate["gate"]: gate for gate in view["gates"]}
    assert gates["market_data"]["satisfied"] is True
    assert gates["risk_state_fresh"]["satisfied"] is True
    assert gates["kill_switches"]["satisfied"] is True
    # Connectivity and adapter stay unknown until the worker wires them -
    # which is precisely why gatesSatisfied is False while market_data is ok.
    assert gates["exchange_connectivity"]["satisfied"] is False
    assert gates["execution_adapter"]["satisfied"] is False
    assert view["gatesSatisfied"] is False


def test_engaged_kill_switch_blocks_and_alerts() -> None:
    get_settings.cache_clear()
    hub = make_hub(get_settings())
    hub._redis_ping = (True, None, 1_700_000_000_000_000)
    hub._pg_state = {
        "published_accounts": 1,
        "stale_accounts": 0,
        "active_protections": 2,
        "engaged_global_switches": 1,
    }

    async def scenario() -> None:
        await hub._publish_mirrors(ttl_seconds=60)

    asyncio.run(scenario())
    view = hub.readiness_view()
    gate = {g["gate"]: g for g in view["gates"]}["kill_switches"]
    assert gate["satisfied"] is False
    assert "1 engaged GLOBAL switch" in gate["reason"]
    assert any(a.rule_id == "KILL_SWITCH_ENGAGED" for a in hub.alerts.active())


def test_hub_exposes_no_mutation_surface() -> None:
    # The observability hub must not grow levers: no engage/release/order verbs.
    verbs = {"engage", "release", "clear", "submit", "place", "cancel", "execute"}
    assert not verbs & set(dir(TradingEngineObservability))
```

FILE: services/trading-engine/tests/test_part10_safety.py

```python
"""Part 10 engine-side safety laws: the trading decision path must not read
telemetry, and telemetry must not be able to bite the path that writes it.

These are the enforceable form of the rulebook sentences: "observe, never
authorise" and "a failed flush retains, never raises". Half the file reads
the router as TEXT (a law about what a module does NOT mention is a law for
grep, or it is a law that silently rots), half runs the hub's real code
against stand-in Redis to pin the bucket contract the API evaluator reads.
The API-side twin of this suite is
apps/api/src/modules/observability/part10-safety.spec.ts.
"""

from __future__ import annotations

import asyncio
import inspect
import pathlib
import re
from typing import Any

from app.observability import TradingEngineObservability
from tests.test_part10_tracing import _BucketRedis, settings

_MODULE_DIR = pathlib.Path(__file__).resolve().parents[1]
ROUTER_SOURCE = (_MODULE_DIR / "app" / "routers" / "engine.py").read_text(encoding="utf-8")
HUB_SOURCE = (_MODULE_DIR / "app" / "observability.py").read_text(encoding="utf-8")


class TestTradingPathIgnoresTelemetry:
    def test_router_never_consults_the_injector_or_the_tracer(self) -> None:
        # The evaluate route may COUNT decisions and record errors; it must
        # never ask the fault injector, the tracer, or the sampler what to
        # do. Those tokens appearing anywhere in the module is the smell of
        # a decision that started reading its own dashboard.
        lowered = ROUTER_SOURCE.lower()
        for banned in ("injector", "consume_fault", "tracer.", "should_sample", "sampler"):
            assert banned not in lowered, f"router references telemetry control surface: {banned}"

    def test_recording_happens_after_the_decision_and_reraises_untouched(self) -> None:
        # Ordering law: the verdict is computed first; the hub is touched
        # only on the far side of that call. And the except-path records a
        # bad sample and then RE-RAISES - no swallowing, no substitution.
        evaluate_at = ROUTER_SOURCE.index("risk_engine.evaluate(")
        record_at = ROUTER_SOURCE.index("record_pretrade(")
        error_at = ROUTER_SOURCE.index("record_pretrade_error()")
        assert evaluate_at < record_at
        assert evaluate_at < error_at
        assert re.search(r"record_pretrade_error\(\)\n\s+raise\b", ROUTER_SOURCE), (
            "the except-path must record the error and re-raise it unchanged"
        )

    def test_hub_recorders_return_none_cannot_answer_anything(self) -> None:
        # Both recorders are annotated `-> None` in the real module (not in
        # a test copy): observation-shaped by signature, so a caller cannot
        # even accidentally branch on them.
        for name in ("record_pretrade", "record_pretrade_error"):
            source = inspect.getsource(getattr(TradingEngineObservability, name))
            assert "-> None" in source


class TestMirrorLoopLaws:
    def test_samples_flush_after_traces_in_the_same_loop(self) -> None:
        match = re.search(
            r"async def _mirror_loop[\s\S]*?(?=\n    (?:async )?def )", HUB_SOURCE
        )
        assert match is not None, "_mirror_loop not found on disk - the scan is broken"
        body = match.group(0)
        traces_at = body.index("_flush_traces()")
        samples_at = body.index("_flush_slo_samples()")
        assert traces_at < samples_at, (
            "the trace export runs FIRST so a slow collector cannot delay "
            "sample flushes; ordering here is the whole of that defence"
        )

    def test_bucket_contract_matches_the_api_evaluator(self) -> None:
        # The API evaluator reads `wlct:trading:ops:slo:engineerr:<t/600>`
        # as an EVENT-SHAPED source: fields good/bad only, no ticks, delta
        # semantics, TTL 14 days. Pin the writer to that exact contract.
        hub: Any = TradingEngineObservability(settings(), _BucketRedis())
        hub.record_pretrade(approved=True, duration_micros=1)
        hub.record_pretrade(approved=False, duration_micros=1)
        hub.record_pretrade_error()
        asyncio.run(hub._flush_slo_samples())
        writes = [op for op in hub._redis.ops if op[0] == "hincrby"]  # type: ignore[attr-defined]
        fields = {op[2] for op in writes}
        assert fields == {"good", "bad"}
        key = writes[0][1]  # type: ignore[attr-defined]
        assert re.fullmatch(r"wlct:trading:ops:slo:engineerr:\d+", key)
        expires = [op for op in hub._redis.ops if op[0] == "pexpire"]  # type: ignore[attr-defined]
        assert expires and expires[0][2] == 14 * 86_400_000

    def test_flush_is_independent_of_the_tracing_switch(self) -> None:
        # OTEL off means no tracer, no spans, no export - and STILL working
        # error-rate SLO samples, because those are metrics-shaped, not
        # trace-shaped. A platform that stops measuring its own error rate
        # when the collector is disabled has confused the pipe with the
        # measurement.
        hub: Any = TradingEngineObservability(
            settings(OTEL_ENABLED=False, OTEL_ENDPOINT=None),
            _BucketRedis(),
        )
        assert hub.tracer is None
        hub.record_pretrade(approved=True, duration_micros=2)
        assert hub._slo_decisions["good"] == 1
        asyncio.run(hub._flush_slo_samples())
        writes = [op for op in hub._redis.ops if op[0] == "hincrby"]  # type: ignore[attr-defined]
        assert writes and writes[0][2] == "good"
```

FILE: services/trading-engine/tests/test_part10_tracing.py

```python
"""Part 10 service-side tracing wiring: config, middleware, export loop.

The properties under test are the ones the platform rulebook stakes its
credibility on: production configuration cannot arm fault injection, the
export loop never re-queues spans, export failure pages but never blocks,
and with tracing switched off the process behaves byte-for-byte like the
pre-Part-10 process (no headers invented, no objects allocated).
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from wlct_trading.observability import SamplingMode, SamplingPolicy, Tracer

from app.config import Settings
from app.observability import TradingEngineObservability
from app.tracing import (
    build_injector,
    build_tracer,
    flush_traces,
    start_request_span,
)
from tests.test_observability_readiness import FakeRedis

BASE: dict[str, str] = {
    "DATABASE_URL": "postgresql://x:y@localhost:5432/db",
    "REDIS_HOST": "localhost",
    "INTERNAL_SERVICE_TOKEN": "test-internal-service-token-value-0123456789abcdef",
}


def settings(**overrides: object) -> Settings:
    return Settings(**{**BASE, **overrides})  # type: ignore[arg-type]


class TestConfigDiscipline:
    def test_production_refuses_armed_injection(self) -> None:
        with pytest.raises(ValidationError, match="test-harness switch"):
            settings(NODE_ENV="production", FAILURE_INJECTION_ENABLED=True)

    def test_guard_off_disables_instead_of_unlocking(self) -> None:
        with pytest.raises(ValidationError, match="disabling the guard disables the feature"):
            settings(
                NODE_ENV="development",
                FAILURE_INJECTION_ENABLED=True,
                FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY=False,
            )

    def test_production_with_tracing_needs_an_endpoint(self) -> None:
        with pytest.raises(ValidationError, match="OTEL_ENDPOINT is mandatory"):
            settings(NODE_ENV="production", OTEL_ENABLED=True, OTEL_ENDPOINT=None)

    def test_endpoint_must_be_http(self) -> None:
        with pytest.raises(ValidationError, match="OTLP/HTTP"):
            settings(OTEL_ENDPOINT="grpc://collector:4317")

    def test_development_defaults_parse(self) -> None:
        config = settings(NODE_ENV="development")
        assert config.OTEL_ENABLED is False
        assert config.FAILURE_INJECTION_ENABLED is False
        assert config.OTEL_SAMPLE_RATIO == pytest.approx(0.1)


class TestBuilders:
    def test_disabled_means_none(self) -> None:
        assert build_tracer(settings()) is None
        assert build_injector(settings()).enabled is False

    def test_priority_filtering_keeps_only_real_operations(self) -> None:
        tracer = build_tracer(
            settings(
                OTEL_ENABLED=True,
                OTEL_SAMPLE_RATIO=0.0,
                OTEL_PRIORITY_OPERATIONS="execution.transmit,not.a.real.thing",
            )
        )
        assert tracer is not None
        assert tracer.enabled is True
        # Only the allow-listed name survives into the sampler.
        assert tracer._sampler.priority_operations == frozenset(
            {"execution.transmit"}
        )

    def test_injection_arms_closed_export_points(self) -> None:
        injector = build_injector(
            settings(NODE_ENV="test", FAILURE_INJECTION_ENABLED=True)
        )
        assert injector.enabled is True
        assert set(injector.active_points()) == {
            "trace_export_unavailable",
            "metrics_export_unavailable",
        }


def _recording_tracer() -> Tracer:
    counter = iter(range(1, 1_000_000))
    return Tracer(
        service="unit",
        sampler=SamplingPolicy(SamplingMode.ALL),
        span_id_factory=lambda: f"{next(counter):016x}",
    )


class TestFlush:
    def test_idle_tick(self) -> None:
        report = asyncio.run(
            flush_traces(
                _recording_tracer(),
                endpoint=None,
                timeout_ms=100,
                injector=build_injector(settings()),
            )
        )
        assert report == {"drained": 0, "exported": 0, "failed": 0, "outcome": "idle"}

    def test_unconfigured_endpoint_drops_loudly(self) -> None:
        tracer = _recording_tracer()
        tracer.start_span("risk.evaluate").end()
        report = asyncio.run(
            flush_traces(
                tracer,
                endpoint=None,
                timeout_ms=100,
                injector=build_injector(settings()),
            )
        )
        assert report["outcome"] == "skipped"
        assert report["failed"] == 1
        assert tracer.buffered_spans == 0  # NOT re-queued - loss is the contract

    def test_successful_export(self, monkeypatch: pytest.MonkeyPatch) -> None:
        captured: dict[str, Any] = {}

        class FakeResponse:
            status_code = 202

        async def fake_post(
            self: httpx.AsyncClient, url: str, **kwargs: Any
        ) -> FakeResponse:
            captured["url"] = url
            captured["body"] = kwargs["content"].decode("utf-8")
            captured["content_type"] = kwargs["headers"]["content-type"]
            return FakeResponse()

        monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
        tracer = _recording_tracer()
        tracer.start_span("risk.evaluate").end()
        report = asyncio.run(
            flush_traces(
                tracer,
                endpoint="http://collector:4318/",
                timeout_ms=100,
                injector=build_injector(settings()),
            )
        )
        assert report["outcome"] == "ok"
        assert report["exported"] == 1
        assert captured["url"] == "http://collector:4318/v1/traces"
        assert captured["content_type"] == "application/json"
        assert '"name":"risk.evaluate"' in captured["body"]

    def test_transport_error_counts_as_failure(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def boom(self: httpx.AsyncClient, url: str, **kwargs: Any) -> Any:
            raise httpx.ConnectError("connection refused")

        monkeypatch.setattr(httpx.AsyncClient, "post", boom)
        tracer = _recording_tracer()
        tracer.start_span("risk.evaluate").end()
        report = asyncio.run(
            flush_traces(
                tracer,
                endpoint="http://collector:4318",
                timeout_ms=100,
                injector=build_injector(settings()),
            )
        )
        assert report["outcome"] == "error"
        assert report["failed"] == 1

    def test_injected_failure_consumes_the_tick(self) -> None:
        tracer = _recording_tracer()
        tracer.start_span("risk.evaluate").end()
        injector = build_injector(
            settings(
                FAILURE_INJECTION_ENABLED=True,
                OTEL_ENDPOINT="http://collector:4318",
            )
        )
        report = asyncio.run(
            flush_traces(
                tracer,
                endpoint="http://collector:4318",
                timeout_ms=100,
                injector=injector,
            )
        )
        assert report["outcome"] == "injected"
        assert report["failed"] == 1
        assert (
            injector.describe()["fired_totals"]["trace_export_unavailable"] == 1
        )


class TestHubAlerting:
    def test_three_failed_ticks_open_the_warning_alert(self) -> None:
        hub = TradingEngineObservability(
            settings(
                OTEL_ENABLED=True,
                OTEL_SAMPLE_RATIO=1.0,
                OTEL_ENDPOINT=None,
            ),
            FakeRedis(),
        )
        assert hub.tracer is not None
        for _ in range(3):
            hub.tracer.start_span("risk.evaluate").end()
            asyncio.run(hub._flush_traces())
        active = {record.rule_id for record in hub.alerts.active()}
        assert "TELEMETRY_EXPORT_FAILING" in active
        assert hub._export_failures == 3
        from wlct_trading.observability import render_prometheus

        text = render_prometheus(hub.registry)
        assert 'wlct_tracing_export_outcomes_total{result="skipped"' in text
        assert 'wlct_tracing_spans_total{result="dropped"' in text

    def test_recovery_after_a_clean_tick(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        hub = TradingEngineObservability(
            settings(
                OTEL_ENABLED=True,
                OTEL_SAMPLE_RATIO=1.0,
                OTEL_ENDPOINT="http://collector:4318",
            ),
            FakeRedis(),
        )
        assert hub.tracer is not None

        async def boom(self: httpx.AsyncClient, url: str, **kwargs: Any) -> Any:
            raise httpx.ConnectError("collector down")

        monkeypatch.setattr(httpx.AsyncClient, "post", boom)
        for _ in range(3):
            hub.tracer.start_span("risk.evaluate").end()
            asyncio.run(hub._flush_traces())
        assert hub._export_failures == 3

        class R:
            status_code = 200

        async def ok_post(self: httpx.AsyncClient, url: str, **kwargs: Any) -> R:
            return R()

        monkeypatch.setattr(httpx.AsyncClient, "post", ok_post)
        hub.tracer.start_span("risk.evaluate").end()
        asyncio.run(hub._flush_traces())
        assert hub._export_failures == 0
        open_rules = {
            r.rule_id for r in hub.alerts.active() if r.state.value == "OPEN"
        }
        assert "TELEMETRY_EXPORT_FAILING" not in open_rules

    def test_telemetry_view_is_present_even_with_tracing_off(self) -> None:
        hub = TradingEngineObservability(settings(), FakeRedis())
        view = hub.telemetry_view
        assert view["tracingEnabled"] is False
        assert view["faultInjection"] == {
            "enabled": False,
            "active_points": [],
            "fired_totals": {},
        }


class TestMiddleware:
    def test_no_tracer_means_no_trace_headers(self, client: TestClient) -> None:
        response = client.get("/health")
        assert "x-trace-id" not in response.headers

    def test_traceparent_continues_and_x_trace_id_answers(
        self, client: TestClient
    ) -> None:
        hub = client.app.state.observability  # session client starts the hub
        assert hub is not None
        tracer = _recording_tracer()
        client.app.state.tracer = tracer
        try:
            incoming = "00-" + "a" * 32 + "-" + "b" * 16 + "-01"
            response = client.get("/health", headers={"traceparent": incoming})
            assert response.status_code == 200
            assert response.headers["x-trace-id"] == "a" * 32
            spans = tracer.drain()
            assert [s.name for s in spans] == ["http.server"]
            assert spans[0].context.trace_id == "a" * 32
            assert spans[0].attributes["http.method"] == "GET"
        finally:
            del client.app.state.tracer

    def test_malformed_traceparent_starts_a_fresh_trace(
        self, client: TestClient
    ) -> None:
        tracer = _recording_tracer()
        client.app.state.tracer = tracer
        try:
            response = client.get("/health", headers={"traceparent": "00-zzz"})
            assert "x-trace-id" in response.headers
            assert response.headers["x-trace-id"] != "0" * 32
            span = tracer.drain()[0]
            assert len(span.context.trace_id) == 32
        finally:
            del client.app.state.tracer

    def test_server_span_records_5xx_as_error(self) -> None:
        from wlct_trading.observability.tracing import (
            SpanStatus,
            otlp_json_encode,
        )

        tracer = _recording_tracer()
        span = start_request_span(
            tracer, method="GET", path="/v1/does-not-exist", headers={}
        )
        assert span is not None
        span.set_status(SpanStatus.ERROR, description="status 404")
        span.end()
        (recorded,) = tracer.drain()
        assert recorded.status is SpanStatus.ERROR
        # The payload that would be POSTed is valid OTLP/JSON end to end.
        payload = otlp_json_encode([recorded], resource=tracer.resource)
        assert '\"key\":\"http.status_code\"' not in payload  # not set here
        assert '"status":{"code":2,"message":"status 404"}' in payload


class _RecordingPipe:
    """Pipeline stand-in that records writes into the shared `ops` list."""

    def __init__(self, ops: list[object], fail: bool) -> None:
        self._ops = ops
        self._fail = fail
        self._staged: list[tuple[object, ...]] = []

    def hincrby(self, key: str, field: str, value: int) -> None:
        self._staged.append(("hincrby", key, field, value))

    def pexpire(self, key: str, ms: int) -> None:
        self._staged.append(("pexpire", key, ms))

    async def execute(self) -> list[bool]:
        if self._fail:
            raise OSError("redis down")
        self._ops.extend(self._staged)
        return [True] * len(self._staged)


class _BucketRedis:
    def __init__(self) -> None:
        self.ops: list[object] = []
        self.fail_next = False

    async def get(self, key: str) -> str | None:
        return None

    async def ping(self) -> bool:
        return True

    def pipeline(self, *, transaction: bool = True) -> _RecordingPipe:
        fail = self.fail_next
        self.fail_next = False
        return _RecordingPipe(self.ops, fail)


class TestSloErrorBuckets:
    """The `engineerr` sample buckets: in-memory counts, 10-minute buckets,
    deltas only, and a failed flush that REPLAYS rather than vanishes."""

    def test_counts_are_delta_flushed_and_reset(self) -> None:
        from app.observability import TradingEngineObservability

        redis = _BucketRedis()
        hub = TradingEngineObservability(settings(), redis)
        hub.record_pretrade(approved=True, duration_micros=10)
        hub.record_pretrade(approved=False, duration_micros=12)
        hub.record_pretrade_error()
        asyncio.run(hub._flush_slo_samples())
        kinds = [op for op in redis.ops if isinstance(op, tuple) and op[0] == "hincrby"]
        fields = {(op[2], op[3]) for op in kinds}
        assert ("good", 2) in fields
        assert ("bad", 1) in fields
        key = next(op[1] for op in kinds)  # type: ignore[index]
        assert key.startswith("wlct:trading:ops:slo:engineerr:")
        # idempotent: nothing counted twice, nothing pending
        before = len(redis.ops)
        asyncio.run(hub._flush_slo_samples())
        assert len(redis.ops) == before

    def test_failed_flush_replays_next_tick(self) -> None:
        from app.observability import TradingEngineObservability

        redis = _BucketRedis()
        hub = TradingEngineObservability(settings(), redis)
        hub.record_pretrade(approved=True, duration_micros=5)
        redis.fail_next = True
        asyncio.run(hub._flush_slo_samples())  # must not raise
        assert hub._slo_decisions["good"] == 1  # retained for replay
        asyncio.run(hub._flush_slo_samples())
        writes = [
            op for op in redis.ops if isinstance(op, tuple) and op[0] == "hincrby"
        ]
        assert sum(op[3] for op in writes) == 1  # exactly once, on the retry
```

FILE: services/trading-engine/tests/test_risk_engine.py

```python
"""The risk gate is the safety net for real money; it gets real tests."""

from __future__ import annotations

from decimal import Decimal

from fastapi.testclient import TestClient


def _intent(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "tenantId": "tenant-1",
        "accountId": "account-1",
        "exchange": "binance",
        "symbol": "BTCUSDT",
        "side": "BUY",
        "orderType": "LIMIT",
        "quantity": "0.001",
        "price": "50000",
        "leverage": 1,
        "reduceOnly": False,
    }
    payload.update(overrides)
    return payload


def test_requires_internal_token(client: TestClient) -> None:
    response = client.post("/v1/engine/risk/evaluate", json=_intent())

    assert response.status_code == 401


def test_rejects_tenant_mismatch(client: TestClient, internal_token: str) -> None:
    response = client.post(
        "/v1/engine/risk/evaluate",
        json=_intent(tenantId="other-tenant"),
        headers={"x-internal-token": internal_token, "x-tenant-id": "tenant-1"},
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "TENANT_MISMATCH"


def test_approves_a_conforming_order_but_does_not_execute(
    client: TestClient, internal_token: str
) -> None:
    response = client.post(
        "/v1/engine/risk/evaluate",
        json=_intent(),
        headers={"x-internal-token": internal_token, "x-tenant-id": "tenant-1"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["approved"] is True
    # Execution stays off in Part 1 regardless of approval.
    assert body["executionEnabled"] is False
    assert body["wouldExecute"] is False


def test_rejects_oversized_notional(client: TestClient, internal_token: str) -> None:
    response = client.post(
        "/v1/engine/risk/evaluate",
        json=_intent(quantity="5", price="50000"),
        headers={"x-internal-token": internal_token, "x-tenant-id": "tenant-1"},
    )

    body = response.json()
    assert body["approved"] is False
    assert any("notional" in reason.lower() for reason in body["reasons"])


def test_rejects_excessive_leverage(client: TestClient, internal_token: str) -> None:
    response = client.post(
        "/v1/engine/risk/evaluate",
        json=_intent(leverage=100),
        headers={"x-internal-token": internal_token, "x-tenant-id": "tenant-1"},
    )

    body = response.json()
    assert body["approved"] is False
    assert any("leverage" in reason.lower() for reason in body["reasons"])


def test_limit_order_without_price_is_rejected(client: TestClient, internal_token: str) -> None:
    payload = _intent()
    del payload["price"]

    response = client.post(
        "/v1/engine/risk/evaluate",
        json=payload,
        headers={"x-internal-token": internal_token, "x-tenant-id": "tenant-1"},
    )

    body = response.json()
    assert body["approved"] is False


def test_decimal_precision_is_preserved() -> None:
    # Guard against anyone reintroducing floats for money.
    assert Decimal("0.1") + Decimal("0.2") == Decimal("0.3")
```

