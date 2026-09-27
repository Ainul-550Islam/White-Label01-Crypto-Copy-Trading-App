"""Operational alerts: rules, dedupe, occurrence accounting, explicit states.

What an alert *is* here
----------------------
A currently-relevant operational condition, keyed by
``(rule_id, component, scope)`` - not an event log in disguise. The engine
maintains one *active* record per key:

* the first matching observation opens it (``occurrences = 1``,
  ``first_seen = last_seen = now``);
* every further matching observation folds into the same record
  (``occurrences += 1``, ``last_seen`` moves) - a thousand identical
  failures over a night are one alert with ``occurrences = 1000``, because
  the alternative is an alert storm whose only effect is to train operators
  to ignore it. The count is not hidden: it is on the record, it renders to
  metrics, and it persists;
* recovery must be *observed*: ``recover()`` closes a record with
  ``resolution="recovered"``. An operator acknowledgement never resolves
  anything - ``OPEN -> ACKNOWLEDGED`` says "a human has this", and the
  condition is still true. That separation (acknowledgement is not approval,
  and is certainly not risk clearance) is the whole point of the state
  machine.

State machine (no other transitions exist)::

    OPEN ----------acknowledge----------> ACKNOWLEDGED
      |                                       |
      | recover (observed)                    | recover (observed)
      v                                       v
    RESOLVED <--------------------------------+

``RESOLVED`` records leave the active map (history is the persistence
layer's problem); a rule firing again after resolution opens a *new* record
with a fresh ``alert_id`` - an old resolved alert must never absorb a new
outbreak and hide its duration.

The engine is pure: no timers, no I/O, no clock of its own beyond the
caller's ``at_micros``. The Redis mirror and the PostgreSQL rows are built
from :meth:`AlertRecord.to_payload` by the services; this module never
touches either, which is what keeps it testable and keeps the trading path
free of a database.
"""

from __future__ import annotations

import hashlib
import re
import time
from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from enum import Enum
from typing import Any

__all__ = [
    "AlertSeverity",
    "AlertState",
    "AlertRule",
    "ALERT_RULES",
    "AlertObservation",
    "AlertRecord",
    "AlertEngine",
]


#: Bounded identifier for whoever acknowledged an alert (a user id or a
#: service name) - validated as a wire token, same discipline as the
#: correlation fields, because the value renders on a dashboard.
_ACTOR_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,63}$")


class AlertSeverity(str, Enum):
    INFO = "INFO"
    WARNING = "WARNING"
    CRITICAL = "CRITICAL"
    EMERGENCY = "EMERGENCY"


#: Escalation order used when merging severities (max of linked evidence).
_SEVERITY_RANK: dict[AlertSeverity, int] = {
    AlertSeverity.INFO: 0,
    AlertSeverity.WARNING: 1,
    AlertSeverity.CRITICAL: 2,
    AlertSeverity.EMERGENCY: 3,
}


class AlertState(str, Enum):
    OPEN = "OPEN"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    RESOLVED = "RESOLVED"


@dataclass(frozen=True, slots=True)
class AlertRule:
    """A declared condition an engine can raise.

    ``threshold`` and ``unit`` document what the *caller* must have
    evaluated - the engine does not re-evaluate trading conditions it would
    have to reach into the trading path for. Keeping the threshold
    declarative is deliberate: an alert rule that could change a risk
    decision would be a second, competing safety system.
    """

    rule_id: str
    severity: AlertSeverity
    title: str
    #: Machine-readable condition statement; shown verbatim on dashboards.
    condition: str
    #: Numeric threshold the observation's value exceeded, when it makes
    #: sense; ratio/boolean rules carry ``None``.
    threshold: float | None = None
    unit: str | None = None
    #: Whether recovery must be explicitly observed to resolve. Every rule
    #: here says True; the field exists to document *why* the answer never
    #: varies, and to fail loudly if a future rule tries to say otherwise.
    requires_recovery: bool = True
    #: If set, a matching observation also marks trading readiness suspect
    #: (a hint for the dashboard; enforcement is still the risk gate's).
    blocks_trading: bool = False


#: The Part 9 alert catalog. Rule ids are wire-visible (Redis mirror, PG
#: rows, admin panel, metrics label) - the TS mirror in
#: ``apps/api/src/modules/observability`` is parity-tested against this
#: exact tuple via the live source scan, same discipline as Part 8 used for
#: kill-switch transitions.
ALERT_RULES: tuple[AlertRule, ...] = (
    AlertRule(
        "MARKET_DATA_STALE",
        AlertSeverity.CRITICAL,
        "Market data stale",
        "A subscribed stream has not delivered for longer than its staleness budget.",
        unit="micros_since_last_message",
        blocks_trading=True,
    ),
    AlertRule(
        "ORDERBOOK_RESYNC_STORM",
        AlertSeverity.WARNING,
        "Order-book resync storm",
        "Resync count for a venue grew faster than the configured burst allowance.",
        threshold=5.0,
        unit="resyncs_per_minute",
    ),
    AlertRule(
        "RISK_SNAPSHOT_STALE",
        AlertSeverity.CRITICAL,
        "Risk snapshots stale",
        "At least one account's hot risk snapshot exceeded MAX_RISK_STATE_AGE_MS.",
        unit="accounts_stale",
        blocks_trading=True,
    ),
    AlertRule(
        "RISK_ENGINE_UNAVAILABLE",
        AlertSeverity.EMERGENCY,
        "Risk engine unavailable",
        "The fail-closed gate cannot evaluate (state source or engine down).",
        blocks_trading=True,
    ),
    AlertRule(
        "EXECUTION_UNAVAILABLE",
        AlertSeverity.CRITICAL,
        "Execution unavailable",
        "The execution adapter is initialised but unable to operate.",
        blocks_trading=True,
    ),
    AlertRule(
        "EXCHANGE_DISCONNECTED",
        AlertSeverity.WARNING,
        "Exchange connectivity lost",
        "A configured venue connection is down or reconnecting repeatedly.",
    ),
    AlertRule(
        "RECONCILIATION_DISCREPANCY",
        AlertSeverity.EMERGENCY,
        "Reconciliation discrepancy",
        "A reconciliation pass found an unrepaired difference between ledger and venue.",
        blocks_trading=True,
    ),
    AlertRule(
        "REPEATED_ORDER_REJECTION",
        AlertSeverity.WARNING,
        "Repeated order rejections",
        "Rejections exceeded the configured rate for the window.",
        threshold=20.0,
        unit="rejections_per_minute",
    ),
    AlertRule(
        "AMBIGUOUS_EXECUTION",
        AlertSeverity.EMERGENCY,
        "Ambiguous execution outcome",
        "An order's venue state is unknown after the resolution window elapsed.",
        blocks_trading=True,
    ),
    AlertRule(
        "RATE_LIMIT_EXHAUSTION",
        AlertSeverity.WARNING,
        "Rate-limit budget exhausted",
        "Order or cancel rate windows hit their ceiling for at least one account.",
    ),
    AlertRule(
        "QUEUE_BACKLOG",
        AlertSeverity.WARNING,
        "Queue backlog",
        "A control queue's oldest pending job exceeded QUEUE_ALERT_AGE_MS.",
        unit="ms_oldest_job",
    ),
    AlertRule(
        "EXECUTION_QUEUE_BACKLOG",
        AlertSeverity.CRITICAL,
        "Execution queue backlog",
        "The trade-execution queue's oldest job exceeded QUEUE_ALERT_AGE_MS - separate, stricter policy by design.",
        unit="ms_oldest_job",
    ),
    AlertRule(
        "WORKER_FAILURE",
        AlertSeverity.CRITICAL,
        "Worker failure",
        "A queue worker reported a crash-loop condition (repeated fatal handler exits).",
    ),
    AlertRule(
        "POSTGRES_UNAVAILABLE",
        AlertSeverity.CRITICAL,
        "PostgreSQL unavailable",
        "The control-plane database failed its probe.",
    ),
    AlertRule(
        "REDIS_UNAVAILABLE",
        AlertSeverity.EMERGENCY,
        "Redis unavailable",
        "Redis - which carries risk hot state - failed its probe. Fail-closed consequences follow in the engine.",
        blocks_trading=True,
    ),
    AlertRule(
        "DATASET_VALIDATION_FAILURES",
        AlertSeverity.WARNING,
        "Dataset validation failures",
        "A dataset ingestion run recorded validation errors.",
    ),
    AlertRule(
        "STRATEGY_ERROR_SPIKE",
        AlertSeverity.WARNING,
        "Strategy error spike",
        "Strategy runtime errors exceeded the configured rate (quarantine policy may apply).",
        threshold=10.0,
        unit="errors_per_minute",
    ),
    AlertRule(
        "KILL_SWITCH_ENGAGED",
        AlertSeverity.EMERGENCY,
        "Kill switch engaged",
        "A kill switch engaged without an operator action preceding it (engine-triggered).",
        blocks_trading=True,
    ),
    AlertRule(
        "PROTECTION_TRIGGERED",
        AlertSeverity.CRITICAL,
        "Account protection triggered",
        "An automatic protection (daily-loss ceiling et al.) tripped for an account.",
        blocks_trading=True,
    ),
    # --- Part 10: SLO burn-rate and telemetry-health rules ----------------
    # None of these marks trading readiness suspect. An alert rule measures
    # and pages; it never authorises or denies, and a *telemetry* failure
    # must not look like a trading failure. The severities are the paging
    # contract: fast burn and exhaustion are CRITICAL, the slow burn and the
    # measurement problems are WARNING.
    AlertRule(
        "SLO_BURN_FAST",
        AlertSeverity.CRITICAL,
        "Error budget burning fast",
        (
            "The short SLO window's burn rate reached the fast multiplier and "
            "the long window agrees; at this rate the objective fails inside "
            "the window."
        ),
        threshold=14.4,
        unit="burn_rate_ratio",
        blocks_trading=False,
    ),
    AlertRule(
        "SLO_BURN_SLOW",
        AlertSeverity.WARNING,
        "Error budget burning steadily",
        (
            "Both evaluation windows crossed the slow burn multiplier; budget "
            "drains faster than the objective can tolerate over the window."
        ),
        threshold=6.0,
        unit="burn_rate_ratio",
        blocks_trading=False,
    ),
    AlertRule(
        "SLO_BUDGET_EXHAUSTED",
        AlertSeverity.CRITICAL,
        "Error budget exhausted",
        (
            "Remaining error budget for the window is zero; further bad "
            "events violate the objective outright."
        ),
        threshold=0.0,
        unit="remaining_budget_ppm",
        blocks_trading=False,
    ),
    AlertRule(
        "TELEMETRY_EXPORT_FAILING",
        AlertSeverity.WARNING,
        "Telemetry export failing",
        (
            "An enabled OTLP exporter failed repeatedly (traces or metrics); "
            "the platform is running darker than its configuration intends."
        ),
        threshold=3.0,
        unit="consecutive_export_failures",
        blocks_trading=False,
    ),
    AlertRule(
        "SLO_TELEMETRY_GAP",
        AlertSeverity.WARNING,
        "SLO measurement gap",
        (
            "An SLO evaluation returned UNKNOWN because its indicator signal "
            "is absent or incomplete; a gap in measurement is never recorded "
            "as a pass."
        ),
        blocks_trading=False,
    ),
)

_RULES_BY_ID: dict[str, AlertRule] = {rule.rule_id: rule for rule in ALERT_RULES}


def rule_for(rule_id: str) -> AlertRule:
    rule = _RULES_BY_ID.get(rule_id)
    if rule is None:
        raise KeyError(f"unknown alert rule {rule_id!r}")
    return rule


@dataclass(frozen=True, slots=True)
class AlertObservation:
    """One occurrence, as reported by whatever evaluated the condition.

    ``observed_value`` / ``threshold_value`` are strings on the wire
    (Decimal-as-string discipline inherited platform-wide); the engine only
    records them, never computes with them.
    """

    rule_id: str
    component: str
    scope: str | None = None
    observed_value: str | None = None
    threshold_value: str | None = None
    message: str | None = None
    at_micros: int | None = None
    links: Mapping[str, str] = field(default_factory=dict)

    def dedupe_key(self) -> str:
        return f"{self.rule_id}|{self.component}|{self.scope or 'platform'}"

    def resolved_at(self) -> int:
        return int(time.time() * 1_000_000) if self.at_micros is None else self.at_micros


@dataclass(frozen=True, slots=True)
class AlertRecord:
    """The active (or freshly resolved) state of one dedupe key."""

    alert_id: str
    rule_id: str
    severity: AlertSeverity
    state: AlertState
    component: str
    scope: str | None
    title: str
    condition: str
    first_seen_at_micros: int
    last_seen_at_micros: int
    occurrences: int
    observed_value: str | None
    threshold_value: str | None
    message: str | None
    links: Mapping[str, str]
    acknowledged_by: str | None = None
    acknowledged_at_micros: int | None = None
    resolved_at_micros: int | None = None
    resolution: str | None = None

    @property
    def rule(self) -> AlertRule:
        return rule_for(self.rule_id)

    def duration_micros(self, *, now_micros: int) -> int:
        return max(0, now_micros - self.first_seen_at_micros)

    def to_payload(self) -> dict[str, Any]:
        """Wire form for the Redis mirror / API persistence boundary.

        All primitives or string-keyed maps: anything that can round-trip
        through JSON without a custom codec is a smaller attack surface in
        tests and in production alike.
        """
        return {
            "alertId": self.alert_id,
            "ruleId": self.rule_id,
            "severity": self.severity.value,
            "state": self.state.value,
            "component": self.component,
            "scope": self.scope,
            "title": self.title,
            "condition": self.condition,
            "firstSeenAtMicros": self.first_seen_at_micros,
            "lastSeenAtMicros": self.last_seen_at_micros,
            "occurrences": self.occurrences,
            "observedValue": self.observed_value,
            "thresholdValue": self.threshold_value,
            "message": self.message,
            "links": dict(self.links),
            "acknowledgedBy": self.acknowledged_by,
            "acknowledgedAtMicros": self.acknowledged_at_micros,
            "resolvedAtMicros": self.resolved_at_micros,
            "resolution": self.resolution,
        }

    @staticmethod
    def from_payload(payload: Mapping[str, Any]) -> "AlertRecord":
        try:
            return AlertRecord(
                alert_id=str(payload["alertId"]),
                rule_id=str(payload["ruleId"]),
                severity=AlertSeverity(str(payload["severity"])),
                state=AlertState(str(payload["state"])),
                component=str(payload["component"]),
                scope=payload.get("scope"),
                title=str(payload["title"]),
                condition=str(payload["condition"]),
                first_seen_at_micros=int(payload["firstSeenAtMicros"]),
                last_seen_at_micros=int(payload["lastSeenAtMicros"]),
                occurrences=int(payload["occurrences"]),
                observed_value=payload.get("observedValue"),
                threshold_value=payload.get("thresholdValue"),
                message=payload.get("message"),
                links=dict(payload.get("links") or {}),
                acknowledged_by=payload.get("acknowledgedBy"),
                acknowledged_at_micros=(
                    int(payload["acknowledgedAtMicros"])
                    if payload.get("acknowledgedAtMicros") is not None
                    else None
                ),
                resolved_at_micros=(
                    int(payload["resolvedAtMicros"])
                    if payload.get("resolvedAtMicros") is not None
                    else None
                ),
                resolution=payload.get("resolution"),
            )
        except KeyError as error:
            raise ValueError(f"alert payload missing {error.args[0]!r}") from error


class AlertEngine:
    """In-memory alert state for one service process.

    ``observe`` returns the record after folding; ``None`` is never returned
    for a matching rule - the caller always learns the current state, which
    is what a metrics mirror needs on every tick (open gauge + occurrences),
    storm included.
    """

    def __init__(self) -> None:
        self._active: dict[str, AlertRecord] = {}
        self._counter = 0

    # ------------------------------------------------------------------
    def observe(self, observation: AlertObservation) -> AlertRecord:
        """Fold one occurrence into the active record for its dedupe key."""
        rule = rule_for(observation.rule_id)
        now = observation.resolved_at()
        key = observation.dedupe_key()
        existing = self._active.get(key)
        if existing is not None:
            updated = AlertRecord(
                alert_id=existing.alert_id,
                rule_id=existing.rule_id,
                severity=existing.severity,
                state=existing.state,
                component=existing.component,
                scope=existing.scope,
                title=existing.title,
                condition=existing.condition,
                first_seen_at_micros=existing.first_seen_at_micros,
                last_seen_at_micros=now,
                occurrences=existing.occurrences + 1,
                observed_value=observation.observed_value,
                threshold_value=observation.threshold_value,
                message=observation.message,
                links={**existing.links, **dict(observation.links)},
                acknowledged_by=existing.acknowledged_by,
                acknowledged_at_micros=existing.acknowledged_at_micros,
            )
            self._active[key] = updated
            return updated

        self._counter += 1
        ident = hashlib.sha256(
            f"{key}|{now}|{self._counter}".encode("utf-8")
        ).hexdigest()[:20]
        record = AlertRecord(
            alert_id=f"alert_{ident}",
            rule_id=rule.rule_id,
            severity=rule.severity,
            state=AlertState.OPEN,
            component=observation.component,
            scope=observation.scope,
            title=rule.title,
            condition=rule.condition,
            first_seen_at_micros=now,
            last_seen_at_micros=now,
            occurrences=1,
            observed_value=observation.observed_value,
            threshold_value=observation.threshold_value,
            message=observation.message,
            links=dict(observation.links),
        )
        self._active[key] = record
        return record

    def recover(
        self,
        *,
        rule_id: str,
        component: str,
        scope: str | None = None,
        at_micros: int | None = None,
        note: str | None = None,
    ) -> AlertRecord | None:
        """Close a record on *observed* recovery.

        Returns the resolved record (so the caller can persist/mirror it), or
        ``None`` when nothing was active - recovery for an alert that is not
        open is a no-op, not an error, because recovery observations arrive
        independently of the failure path and races are normal.
        """
        _ = rule_for(rule_id)  # the rule must exist; unknown ids are a bug.
        key = f"{rule_id}|{component}|{scope or 'platform'}"
        record = self._active.pop(key, None)
        if record is None:
            return None
        now = int(time.time() * 1_000_000) if at_micros is None else at_micros
        return AlertRecord(
            alert_id=record.alert_id,
            rule_id=record.rule_id,
            severity=record.severity,
            state=AlertState.RESOLVED,
            component=record.component,
            scope=record.scope,
            title=record.title,
            condition=record.condition,
            first_seen_at_micros=record.first_seen_at_micros,
            last_seen_at_micros=now,
            occurrences=record.occurrences,
            observed_value=record.observed_value,
            threshold_value=record.threshold_value,
            message=record.message,
            links=record.links,
            acknowledged_by=record.acknowledged_by,
            acknowledged_at_micros=record.acknowledged_at_micros,
            resolved_at_micros=now,
            # ``note`` is operator-supplied context, never a substitute for
            # the observation itself: resolution is always "recovered".
            resolution="recovered" if not note else f"recovered ({note})",
        )

    # ------------------------------------------------------------------
    def acknowledge(
        self,
        *,
        rule_id: str,
        component: str,
        scope: str | None,
        actor: str,
        at_micros: int | None = None,
    ) -> AlertRecord:
        """``OPEN -> ACKNOWLEDGED`` only. Any other source state raises.

        ``actor`` is an identifier (user id / service name), validated as a
        wire token so this API cannot be used to smuggle text into the mirror
        that dashboards render.
        """
        key = f"{rule_id}|{component}|{scope or 'platform'}"
        record = self._active.get(key)
        if record is None:
            raise LookupError(f"no active alert for {key}")
        if record.state is not AlertState.OPEN:
            raise ValueError(
                f"alert {record.alert_id} is {record.state.value}; only OPEN alerts "
                "are acknowledged, and acknowledgement is not resolution"
            )
        if not isinstance(actor, str) or not _ACTOR_PATTERN.fullmatch(actor):
            raise ValueError("actor must be a bounded wire token")
        now = int(time.time() * 1_000_000) if at_micros is None else at_micros
        acknowledged = replace(
            record,
            state=AlertState.ACKNOWLEDGED,
            acknowledged_by=actor,
            acknowledged_at_micros=now,
        )
        self._active[key] = acknowledged
        return acknowledged

    def active(self) -> tuple[AlertRecord, ...]:
        """Active records, ordered by (severity desc, first-seen asc).

        Ordering is part of the contract: the Redis mirror hashes in this
        order, so two engines with the same states serialize identically and
        a test can pin the exact payload.
        """
        return tuple(
            sorted(
                self._active.values(),
                key=lambda r: (-_SEVERITY_RANK[r.severity], r.first_seen_at_micros, r.alert_id),
            )
        )

    def get(self, *, rule_id: str, component: str, scope: str | None = None) -> AlertRecord | None:
        return self._active.get(f"{rule_id}|{component}|{scope or 'platform'}")

    def counts(self) -> dict[str, int]:
        """``{severity: open_count}`` for the dashboard header."""
        out = {severity.value: 0 for severity in AlertSeverity}
        for record in self._active.values():
            out[record.severity.value] += 1
        return out

    def mirror_payload(self) -> dict[str, Any]:
        """The document this service publishes for API-side persistence."""
        return {
            "active": [record.to_payload() for record in self.active()],
            "counts": self.counts(),
        }

    def clear(self) -> None:
        """Drop all state. Test hook, and *only* a test hook - production
        resolution goes through ``recover`` so recovery stays observed."""
        self._active.clear()
