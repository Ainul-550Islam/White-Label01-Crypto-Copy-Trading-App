"""Authenticated execution: the layer that can move real money.

Everything in this package sits between the risk engine and a venue's private
API. It is deliberately separate from :mod:`wlct_trading.adapters` and
:mod:`wlct_trading.net`, which handle public data and generic contracts, so
that a service which only needs market data never imports a module capable of
signing an order.

Module map:

``credentials``
    The secret boundary. Providers for env, secret managers and tests; an
    :class:`~wlct_trading.execution.credentials.ExchangeCredentials` value that
    redacts itself in every rendering path.
``config``
    :class:`~wlct_trading.execution.config.ExecutionSettings` and the
    live-trading safety rules. Omission is never permission; contradictions are
    rejected at startup.
``timesync``
    Exchange clock offset measurement and skew refusal.
``validation``
    Ten pre-network checks against venue rules and platform policy.
``safety``
    Eleven pre-submit gates. All required, all fail-closed.
``placement_review``
    The authenticated order-placement review: what must be *attested* before an
    order is built, and the digest of that answer. Pure - no clock, no IO.
``placement_attestor``
    The gatherers that produce those facts (local, venue, TTL-cached) and the
    reviewer the engine calls.
``live_confirmation``
    The operator's scoped, expiring, HMAC-verified statement that live placement
    was authorised for this account, symbol set and window. Not a setting, and not
    a permission: the most a valid record can do is decline to refuse.
``live_enablement``
    The live-enablement checklist as data: which prerequisites a live runtime
    still lacks, and the refusal sentence rendered from that answer instead of a
    paragraph that goes stale the first time one item is satisfied.
``locks``
    Distributed execution locks with token-checked release.
``store``
    The durable order-record port, plus a faithful in-memory implementation.
``incidents``
    The normalised execution error taxonomy and durable incident records.
``engine``
    The pipeline itself. Exchange-agnostic.
``reconciliation``
    Making the local record match the venue without destroying history.
"""

from __future__ import annotations

from wlct_trading.execution.live_confirmation import (
    FINGERPRINT_LENGTH,
    MAX_CONFIRMATION_WINDOW_MS,
    MIN_NONCE_LENGTH,
    SCOPE_UNBOUNDED,
    ConfirmationOutcome,
    ConfirmationState,
    ConfirmationVerifier,
    LiveConfirmationError,
    LiveOperatorConfirmation,
    canonical_confirmation_json,
)
from wlct_trading.execution.live_enablement import (
    HARD_BLOCKERS,
    LiveEnablementInputs,
    LiveEnablementReport,
    LivePrerequisite,
    evaluate_live_enablement,
)
from wlct_trading.execution.config import (
    ExecutionSettings,
    InvalidExecutionSettings,
    UnsafeExecutionConfiguration,
)
from wlct_trading.execution.credentials import (
    REDACTED,
    CachingCredentialProvider,
    CredentialError,
    CredentialNotFound,
    CredentialPermission,
    CredentialProvider,
    EnvironmentCredentialProvider,
    ExchangeCredentials,
    NullCredentialProvider,
    ResolvedSecret,
    SecretFetcher,
    SecretManagerCredentialProvider,
    SigningContext,
    StaticCredentialProvider,
    UnsafeCredential,
    redact_secrets,
    scrub_secret_like,
)
from wlct_trading.execution.engine import (
    EngineConfigurationError,
    ExecutionContext,
    ExecutionEngine,
    ExecutionOutcome,
    ExecutionResult,
)
from wlct_trading.execution.incidents import (
    ExecutionErrorCode,
    ExecutionIncident,
    IncidentRecorder,
    IncidentSeverity,
    IncidentType,
    InMemoryIncidentRecorder,
    map_exchange_category,
)
from wlct_trading.execution.placement_attestor import (
    DEFAULT_FAILURE_CACHE_SHARE,
    MAX_ATTESTER_TTL_MS,
    MIN_ATTESTER_TTL_MS,
    AttestationFailure,
    CachingPlacementAttestor,
    LocalPlacementAttestor,
    PlacementAttestor,
    PlacementReviewRequest,
    PlacementReviewer,
    SymbolEvidence,
    SymbolFacts,
    UnattestedPlacementAttestor,
    symbol_evidence,
)
from wlct_trading.execution.placement_review import (
    ATTESTATION_WIRE_FIELDS,
    MAX_ATTESTATION_AGE_MS,
    MAX_CLOCK_SKEW_MS,
    MAX_CONFIRMATION_DETAIL_LENGTH,
    MAX_KEY_AGE_DAYS,
    MIN_ATTESTATION_AGE_MS,
    NO_KNOWN_WITHDRAWAL_PATH,
    RETRYABLE_REVIEW_CODES,
    REVIEW_AREA_BY_CODE,
    REVIEW_CODE_SEVERITY,
    REVIEW_REQUIRED_AT,
    VENUE_TRADING_FIELD,
    VERDICT_CLAIM_WIRE_NAMES,
    PlacementReviewError,
    PlacementAttestation,
    PlacementFacts,
    PlacementReviewPolicy,
    ReviewFinding,
    PlacementVerdict,
    ReviewArea,
    ReviewCode,
    ReviewSeverity,
    attestation_from_payload,
    attestation_to_payload,
    evaluate_placement_attestation,
    review_area_of,
    severity_of,
)
from wlct_trading.execution.locks import (
    InMemoryLockManager,
    LockError,
    LockHandle,
    LockManager,
    LockNotAcquired,
    RedisLockClient,
    RedisLockManager,
    account_lock_key,
    order_lock_key,
    reconciliation_lock_key,
)
from wlct_trading.execution.reconciliation import (
    Discrepancy,
    DiscrepancyType,
    ReconciliationReport,
    ReconciliationService,
)
from wlct_trading.execution.safety import (
    ComponentHealth,
    ExecutionPreconditions,
    GateResult,
    SafetyDecision,
    SafetyGate,
    evaluate_safety_gates,
)
from wlct_trading.execution.store import (
    DuplicateClientOrderId,
    InMemoryOrderStore,
    OrderNotFound,
    OrderStore,
    OrderStoreError,
    ReconciliationState,
    ReservationOutcome,
)
from wlct_trading.execution.timesync import (
    ClockNotSynchronised,
    ClockSkewExceeded,
    ClockSyncError,
    ClockSyncStatus,
    ExchangeClock,
    ServerTimeFetcher,
    TimeSample,
)
from wlct_trading.execution.validation import (
    DEFAULT_PRICE_BAND_PERCENT,
    OrderValidator,
    ValidationCode,
    ValidationIssue,
    ValidationResult,
)

__all__ = [
    # config
    "ExecutionSettings",
    "InvalidExecutionSettings",
    "UnsafeExecutionConfiguration",
    # credentials
    "REDACTED",
    "CachingCredentialProvider",
    "CredentialError",
    "CredentialNotFound",
    "CredentialPermission",
    "CredentialProvider",
    "EnvironmentCredentialProvider",
    "ExchangeCredentials",
    "NullCredentialProvider",
    "ResolvedSecret",
    "SecretFetcher",
    "SecretManagerCredentialProvider",
    "SigningContext",
    "StaticCredentialProvider",
    "UnsafeCredential",
    "redact_secrets",
    "scrub_secret_like",
    # engine
    "EngineConfigurationError",
    "ExecutionContext",
    "ExecutionEngine",
    "ExecutionOutcome",
    "ExecutionResult",
    # incidents
    "ExecutionErrorCode",
    "ExecutionIncident",
    "IncidentRecorder",
    "IncidentSeverity",
    "IncidentType",
    "InMemoryIncidentRecorder",
    "map_exchange_category",
    # locks
    "InMemoryLockManager",
    "LockError",
    "LockHandle",
    "LockManager",
    "LockNotAcquired",
    "RedisLockClient",
    "RedisLockManager",
    "account_lock_key",
    "order_lock_key",
    "reconciliation_lock_key",
    # placement (review law)
    # Every name placement_review.py declares, and nothing less: the bounds are
    # the reason a service can validate its own config against the law instead of
    # retyping numbers, and PlacementReviewError is the exception a caller has to
    # be able to catch without importing the module path it came from.
    "ATTESTATION_WIRE_FIELDS",
    "MAX_ATTESTATION_AGE_MS",
    "MAX_CLOCK_SKEW_MS",
    "MAX_CONFIRMATION_DETAIL_LENGTH",
    "MAX_KEY_AGE_DAYS",
    "MIN_ATTESTATION_AGE_MS",
    "NO_KNOWN_WITHDRAWAL_PATH",
    "RETRYABLE_REVIEW_CODES",
    "REVIEW_AREA_BY_CODE",
    "REVIEW_CODE_SEVERITY",
    "REVIEW_REQUIRED_AT",
    "ReviewArea",
    "VENUE_TRADING_FIELD",
    "PlacementReviewError",
    "PlacementReviewPolicy",
    "PlacementVerdict",
    "ReviewCode",
    "ReviewFinding",
    "ReviewSeverity",
    "PlacementAttestation",
    "PlacementFacts",
    "VERDICT_CLAIM_WIRE_NAMES",
    "attestation_from_payload",
    "attestation_to_payload",
    "evaluate_placement_attestation",
    "review_area_of",
    "severity_of",
    # placement (operator confirmation + live enablement)
    # Part 19. The confirmation types are reachable from the package for the same
    # reason the review law's bounds are: a deployment that assembles a reviewer has
    # to be able to name the states it is wiring without importing the module, and a
    # name that is only reachable by module path is a name that gets retyped as a
    # string literal somewhere downstream.
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
    "HARD_BLOCKERS",
    "LiveEnablementInputs",
    "LiveEnablementReport",
    "LivePrerequisite",
    "evaluate_live_enablement",
    # placement (attestors + reviewer)
    "AttestationFailure",
    "CachingPlacementAttestor",
    "DEFAULT_FAILURE_CACHE_SHARE",
    "MAX_ATTESTER_TTL_MS",
    "MIN_ATTESTER_TTL_MS",
    "LocalPlacementAttestor",
    "PlacementAttestor",
    "PlacementAttestation",
    "PlacementFacts",
    "PlacementReviewRequest",
    "PlacementReviewer",
    "SymbolEvidence",
    "SymbolFacts",
    "UnattestedPlacementAttestor",
    "symbol_evidence",
    # reconciliation
    "Discrepancy",
    "DiscrepancyType",
    "ReconciliationReport",
    "ReconciliationService",
    # safety
    "ComponentHealth",
    "ExecutionPreconditions",
    "GateResult",
    "SafetyDecision",
    "SafetyGate",
    "evaluate_safety_gates",
    # store
    "DuplicateClientOrderId",
    "InMemoryOrderStore",
    "OrderNotFound",
    "OrderStore",
    "OrderStoreError",
    "ReconciliationState",
    "ReservationOutcome",
    # timesync
    "ClockNotSynchronised",
    "ClockSkewExceeded",
    "ClockSyncError",
    "ClockSyncStatus",
    "ExchangeClock",
    "ServerTimeFetcher",
    "TimeSample",
    # validation
    "DEFAULT_PRICE_BAND_PERCENT",
    "OrderValidator",
    "ValidationCode",
    "ValidationIssue",
    "ValidationResult",
]
