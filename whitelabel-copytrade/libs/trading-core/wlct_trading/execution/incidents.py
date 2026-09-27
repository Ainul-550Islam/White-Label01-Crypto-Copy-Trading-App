"""Execution error taxonomy and incident records.

Two related things live here.

**The taxonomy** is a closed set of normalised failure reasons. Every execution
failure — from a malformed Decimal to a venue returning 418 — is mapped onto one
of these before it leaves the execution layer. That is what lets a dashboard
count "authentication failures across all tenants" without parsing English, and
what stops a venue-specific error string leaking into a mobile client.

**The incident record** is what gets written when something happened that a
human needs to know about. Incidents are deliberately rare and deliberately
durable: an ambiguous order result, a reconciliation discrepancy, a credential
rejection. Ordinary rejections are not incidents — a risk engine declining an
oversized order is the system working.

Note the separation from :class:`~wlct_trading.enums.ExchangeErrorCategory`,
which classifies *transport and venue* errors and already exists from Part 3.
This taxonomy is broader: it covers validation, risk, safety gates and
reconciliation too, and it maps the existing categories in rather than
replacing them.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Mapping

from wlct_trading.clock import epoch_micros
from wlct_trading.enums import ExchangeId
from wlct_trading.transport.errors import ExchangeErrorCategory
from wlct_trading.execution.credentials import scrub_secret_like

__all__ = [
    "ExecutionErrorCode",
    "IncidentSeverity",
    "IncidentType",
    "ExecutionIncident",
    "IncidentRecorder",
    "InMemoryIncidentRecorder",
    "map_exchange_category",
]


class ExecutionErrorCode(str, Enum):
    """Normalised execution failure reasons.

    Stable and public: these appear in API error payloads and audit records.
    """

    # --- Refused before any network activity --------------------------
    VALIDATION_FAILED = "VALIDATION_FAILED"
    RISK_REJECTED = "RISK_REJECTED"
    RISK_UNAVAILABLE = "RISK_UNAVAILABLE"
    KILL_SWITCH_ENGAGED = "KILL_SWITCH_ENGAGED"
    TRADING_DISABLED = "TRADING_DISABLED"
    LIVE_TRADING_NOT_AUTHORISED = "LIVE_TRADING_NOT_AUTHORISED"
    DUPLICATE_ORDER = "DUPLICATE_ORDER"
    LOCK_UNAVAILABLE = "LOCK_UNAVAILABLE"
    MARKET_DATA_UNAVAILABLE = "MARKET_DATA_UNAVAILABLE"
    # Part 8: stale risk state joined the taxonomy deliberately coarse -
    # the detailed decision code is on the RiskDecision inside the result;
    # the public error list is API surface, and every entry there is a string
    # a client can switch on forever. (INSUFFICIENT_BALANCE already existed
    # from Part 5's account section and is reused, not duplicated.)
    RISK_STATE_STALE = "RISK_STATE_STALE"

    # --- Credentials and signing --------------------------------------
    CREDENTIALS_MISSING = "CREDENTIALS_MISSING"
    CREDENTIALS_INVALID = "CREDENTIALS_INVALID"
    CREDENTIALS_EXPIRED = "CREDENTIALS_EXPIRED"
    CREDENTIALS_UNSAFE = "CREDENTIALS_UNSAFE"
    SIGNING_FAILED = "SIGNING_FAILED"
    CLOCK_NOT_SYNCHRONISED = "CLOCK_NOT_SYNCHRONISED"
    CLOCK_SKEW_EXCEEDED = "CLOCK_SKEW_EXCEEDED"

    # --- Venue responses ----------------------------------------------
    EXCHANGE_REJECTED = "EXCHANGE_REJECTED"
    EXCHANGE_UNAVAILABLE = "EXCHANGE_UNAVAILABLE"
    RATE_LIMITED = "RATE_LIMITED"
    IP_BANNED = "IP_BANNED"
    INSUFFICIENT_BALANCE = "INSUFFICIENT_BALANCE"
    UNAUTHORISED = "UNAUTHORISED"
    FORBIDDEN = "FORBIDDEN"

    # --- Ambiguity and repair -----------------------------------------
    RESULT_UNKNOWN = "RESULT_UNKNOWN"
    TIMEOUT = "TIMEOUT"
    RECONCILIATION_REQUIRED = "RECONCILIATION_REQUIRED"
    RECONCILIATION_FAILED = "RECONCILIATION_FAILED"
    STATE_MISMATCH = "STATE_MISMATCH"
    ILLEGAL_STATE_TRANSITION = "ILLEGAL_STATE_TRANSITION"

    # --- Internal ------------------------------------------------------
    INTERNAL_ERROR = "INTERNAL_ERROR"
    NOT_SUPPORTED = "NOT_SUPPORTED"

    @property
    def is_retryable(self) -> bool:
        """Whether resubmitting the same intent could succeed.

        ``RESULT_UNKNOWN`` is emphatically **not** retryable: the order may
        already be live at the venue, and a retry would double the position.
        It reconciles instead.
        """
        return self in _RETRYABLE

    @property
    def is_client_error(self) -> bool:
        """Whether the caller caused this, as opposed to the venue or platform."""
        return self in _CLIENT_ERRORS


_RETRYABLE: frozenset[ExecutionErrorCode] = frozenset(
    {
        ExecutionErrorCode.EXCHANGE_UNAVAILABLE,
        ExecutionErrorCode.RATE_LIMITED,
        ExecutionErrorCode.LOCK_UNAVAILABLE,
        ExecutionErrorCode.MARKET_DATA_UNAVAILABLE,
        ExecutionErrorCode.CLOCK_NOT_SYNCHRONISED,
    }
)

_CLIENT_ERRORS: frozenset[ExecutionErrorCode] = frozenset(
    {
        ExecutionErrorCode.VALIDATION_FAILED,
        ExecutionErrorCode.RISK_REJECTED,
        ExecutionErrorCode.DUPLICATE_ORDER,
        ExecutionErrorCode.INSUFFICIENT_BALANCE,
        ExecutionErrorCode.EXCHANGE_REJECTED,
        ExecutionErrorCode.NOT_SUPPORTED,
    }
)


def map_exchange_category(
    category: ExchangeErrorCategory,
    *,
    http_status: int | None = None,
) -> ExecutionErrorCode:
    """Map a Part 3 transport category onto an execution error code.

    HTTP status refines the mapping where the category is deliberately coarse:
    401 and 403 share ``AUTHENTICATION_ERROR``, and 418 (an IP ban) is a very
    different operational problem from a 429 (slow down).
    """
    if category is ExchangeErrorCategory.AUTHENTICATION_ERROR:
        if http_status == 403:
            return ExecutionErrorCode.FORBIDDEN
        return ExecutionErrorCode.UNAUTHORISED
    if category is ExchangeErrorCategory.RATE_LIMIT_ERROR:
        if http_status == 418:
            return ExecutionErrorCode.IP_BANNED
        return ExecutionErrorCode.RATE_LIMITED
    if category is ExchangeErrorCategory.NETWORK_ERROR:
        return ExecutionErrorCode.RESULT_UNKNOWN
    if category is ExchangeErrorCategory.TIMEOUT:
        return ExecutionErrorCode.TIMEOUT
    if category is ExchangeErrorCategory.INVALID_REQUEST:
        return ExecutionErrorCode.EXCHANGE_REJECTED
    if category is ExchangeErrorCategory.EXCHANGE_ERROR:
        return ExecutionErrorCode.EXCHANGE_UNAVAILABLE
    if category is ExchangeErrorCategory.SEQUENCE_ERROR:
        return ExecutionErrorCode.STATE_MISMATCH
    if category is ExchangeErrorCategory.SUBSCRIPTION_ERROR:
        return ExecutionErrorCode.EXCHANGE_UNAVAILABLE
    return ExecutionErrorCode.INTERNAL_ERROR


class IncidentSeverity(str, Enum):
    """How urgently a human needs to look."""

    #: Recorded for the trail; no action expected.
    INFO = "INFO"
    #: Worth a look during working hours.
    WARNING = "WARNING"
    #: Money or position integrity is at stake. Page someone.
    CRITICAL = "CRITICAL"


class IncidentType(str, Enum):
    """What kind of thing went wrong."""

    UNKNOWN_ORDER_RESULT = "UNKNOWN_ORDER_RESULT"
    ORDER_STATE_MISMATCH = "ORDER_STATE_MISMATCH"
    MISSING_FILL = "MISSING_FILL"
    UNEXPECTED_ORDER = "UNEXPECTED_ORDER"
    BALANCE_MISMATCH = "BALANCE_MISMATCH"
    POSITION_MISMATCH = "POSITION_MISMATCH"
    ILLEGAL_TRANSITION = "ILLEGAL_TRANSITION"
    CREDENTIAL_FAILURE = "CREDENTIAL_FAILURE"
    CLOCK_SKEW = "CLOCK_SKEW"
    PRIVATE_STREAM_FAILURE = "PRIVATE_STREAM_FAILURE"
    RATE_LIMIT_BREACH = "RATE_LIMIT_BREACH"
    RECONCILIATION_FAILURE = "RECONCILIATION_FAILURE"
    SAFETY_GATE_BLOCK = "SAFETY_GATE_BLOCK"


@dataclass(frozen=True, slots=True)
class ExecutionIncident:
    """A durable record of something that needs human attention.

    Immutable. An incident is resolved by recording a *new* incident or a
    resolution event, never by editing this one — the whole point is that the
    trail cannot be rewritten after the fact.

    ``details`` values are scrubbed on construction. Incident payloads are the
    single most likely place for a secret to escape, because the natural
    instinct when writing an incident is to attach the whole failing request.
    """

    incident_id: str
    tenant_id: str
    account_id: str | None
    incident_type: IncidentType
    severity: IncidentSeverity
    summary: str
    exchange: ExchangeId | None = None
    symbol: str | None = None
    order_id: str | None = None
    client_order_id: str | None = None
    error_code: ExecutionErrorCode | None = None
    details: Mapping[str, str] = field(default_factory=dict)
    occurred_at_micros: int = 0
    #: True once an operator or an automated repair has closed it out.
    resolved: bool = False
    resolution_note: str | None = None

    @classmethod
    def create(
        cls,
        *,
        tenant_id: str,
        incident_type: IncidentType,
        severity: IncidentSeverity,
        summary: str,
        account_id: str | None = None,
        exchange: ExchangeId | None = None,
        symbol: str | None = None,
        order_id: str | None = None,
        client_order_id: str | None = None,
        error_code: ExecutionErrorCode | None = None,
        details: Mapping[str, object] | None = None,
        occurred_at_micros: int | None = None,
    ) -> "ExecutionIncident":
        """Build an incident with scrubbed details and a generated id."""
        scrubbed: dict[str, str] = {}
        for key, value in (details or {}).items():
            scrubbed[str(key)] = scrub_secret_like(str(value))
        return cls(
            incident_id=str(uuid.uuid4()),
            tenant_id=tenant_id,
            account_id=account_id,
            incident_type=incident_type,
            severity=severity,
            summary=scrub_secret_like(summary),
            exchange=exchange,
            symbol=symbol,
            order_id=order_id,
            client_order_id=client_order_id,
            error_code=error_code,
            details=scrubbed,
            occurred_at_micros=(
                epoch_micros() if occurred_at_micros is None else occurred_at_micros
            ),
        )

    @property
    def requires_paging(self) -> bool:
        return self.severity is IncidentSeverity.CRITICAL and not self.resolved

    def resolve(self, note: str) -> "ExecutionIncident":
        """Return a resolved copy. The original is unchanged."""
        return ExecutionIncident(
            incident_id=self.incident_id,
            tenant_id=self.tenant_id,
            account_id=self.account_id,
            incident_type=self.incident_type,
            severity=self.severity,
            summary=self.summary,
            exchange=self.exchange,
            symbol=self.symbol,
            order_id=self.order_id,
            client_order_id=self.client_order_id,
            error_code=self.error_code,
            details=self.details,
            occurred_at_micros=self.occurred_at_micros,
            resolved=True,
            resolution_note=scrub_secret_like(note),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "incidentId": self.incident_id,
            "tenantId": self.tenant_id,
            "accountId": self.account_id,
            "type": self.incident_type.value,
            "severity": self.severity.value,
            "summary": self.summary,
            "exchange": self.exchange.value if self.exchange else None,
            "symbol": self.symbol,
            "orderId": self.order_id,
            "clientOrderId": self.client_order_id,
            "errorCode": self.error_code.value if self.error_code else None,
            "details": dict(self.details),
            "occurredAtMicros": self.occurred_at_micros,
            "resolved": self.resolved,
            "resolutionNote": self.resolution_note,
        }


class IncidentRecorder:
    """Port for incident persistence.

    Recording must never raise into the execution path. If the incident store
    is down, the order flow continues and the failure is counted — losing an
    incident record is bad, but taking down execution because logging failed is
    worse.
    """

    async def record(self, incident: ExecutionIncident) -> None:  # pragma: no cover
        raise NotImplementedError

    async def list_open(
        self, tenant_id: str, *, limit: int = 100
    ) -> tuple[ExecutionIncident, ...]:  # pragma: no cover
        raise NotImplementedError


class InMemoryIncidentRecorder(IncidentRecorder):
    """Reference implementation for tests, paper trading and local runs."""

    __slots__ = ("_incidents", "_failed_writes")

    def __init__(self) -> None:
        self._incidents: list[ExecutionIncident] = []
        self._failed_writes = 0

    async def record(self, incident: ExecutionIncident) -> None:
        self._incidents.append(incident)

    async def list_open(
        self, tenant_id: str, *, limit: int = 100
    ) -> tuple[ExecutionIncident, ...]:
        return tuple(
            incident
            for incident in reversed(self._incidents)
            if incident.tenant_id == tenant_id and not incident.resolved
        )[:limit]

    # -- Test helpers ---------------------------------------------------
    @property
    def all(self) -> tuple[ExecutionIncident, ...]:
        return tuple(self._incidents)

    def of_type(self, incident_type: IncidentType) -> tuple[ExecutionIncident, ...]:
        return tuple(
            incident
            for incident in self._incidents
            if incident.incident_type is incident_type
        )

    def clear(self) -> None:
        self._incidents.clear()
