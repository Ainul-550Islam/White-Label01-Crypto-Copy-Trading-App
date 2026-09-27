"""Normalised risk events: the auditable trail, deduplicated by construction.

A risk event is *what the system observed and decided*, recorded so an
operator reading the trail tomorrow needs nothing else: severity, the rule,
the observed value against the threshold, the scope it acted on, the
snapshot version the decision was made from, and where the observation came
from. PII and credentials are structurally absent - the record carries ids,
numbers and enum values, and the sanitising sink keeps it that way.

Idempotency: every event carries a content-derived ``dedupe_key`` (sha256
over the fields that make it the *same* event: kind, scope, rule, account,
strategy, symbol, threshold, trading day). A strategy hammering a breached
limit produces thousands of decisions and exactly one event per day per
(scope, rule, threshold) - the count belongs to metrics and the decision
records, the trail belongs to state changes. The key is deliberately *not*
hashing the observed value: "loss 501 vs limit 500" and "loss 900 vs limit
500" are the same breach, and an event stream that spams a new row per tick
of the same breach is an event stream nobody reads.

This module emits; it never persists and never triggers. Durability (DB
rows) and enforcement (protection triggers) belong to the sinks and to the
gate, in that order, so replay can attach a different sink without dragging
the production one along.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Iterable, Mapping, Protocol

from wlct_trading.enums import (
    ExchangeId,
    KillSwitchScope,
    ProtectionAction,
    RiskDecisionCode,
    RiskEventKind,
    RiskEventSeverity,
    RiskLimitScope,
    RiskRuleId,
    TradingEventType,
)
from wlct_trading.events import TradingEvent

__all__ = [
    "RiskEvent",
    "RiskEventSink",
    "InMemoryRiskEventSink",
    "severity_for_breach",
    "KIND_TO_TRADING_EVENT",
]


@dataclass(slots=True, frozen=True)
class RiskEvent:
    """One entry in the risk trail. Immutable, wire-shaped, hashable."""

    event_id: str
    occurred_at_micros: int
    severity: RiskEventSeverity
    kind: RiskEventKind
    tenant_id: str | None
    account_id: str | None
    strategy_id: str | None
    symbol: str | None
    exchange: ExchangeId | None
    rule_id: RiskRuleId | None
    limit_scope: RiskLimitScope | None
    limit_target: str | None
    #: Observed value and threshold as exact strings (``Decimal`` stringified
    #: at the source); float reprs would put a different number in the audit
    #: trail than the one the decision compared.
    observed: str | None
    threshold: str | None
    action: ProtectionAction | None
    #: Which component produced the observation ("risk-gate", "api",
    #: "trading-worker", "replay"), so replayed events are visibly replayed.
    source: str
    snapshot_version: int | None
    message: str
    #: Set on events produced against simulated state. The event is real -
    #: it did happen to the paper engine - but what it threatens is not, and
    #: an alert channel must be able to route on exactly that.
    is_simulated: bool
    #: The kill-switch scope a protection touched, when this event describes
    #: a switch transition. Kept separate from ``limit_scope`` because a
    #: GLOBAL switch engagement is not a limit having a global scope.
    switch_scope: KillSwitchScope | None = None
    switch_target: str | None = None
    decision_id: str | None = None
    request_id: str | None = None
    correlation_id: str | None = None

    def dedupe_key(self) -> str:
        """Content-addressed identity of the *condition* this event reports.

        Excludes the event id, the timestamp and the observed value; see the
        module docstring for why those exclusions are the feature.
        """
        identity = {
            "kind": self.kind.value,
            "tenant": self.tenant_id,
            "account": self.account_id,
            "strategy": self.strategy_id,
            "symbol": self.symbol,
            "exchange": None if self.exchange is None else self.exchange.value,
            "rule": None if self.rule_id is None else self.rule_id.value,
            "scope": None if self.limit_scope is None else self.limit_scope.value,
            "target": self.limit_target,
            "threshold": self.threshold,
            "action": None if self.action is None else self.action.value,
            "simulated": self.is_simulated,
        }
        payload = json.dumps(identity, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]

    def to_payload(self) -> dict[str, Any]:
        return {
            "eventId": self.event_id,
            "occurredAtMicros": self.occurred_at_micros,
            "severity": self.severity.value,
            "kind": self.kind.value,
            "tenantId": self.tenant_id,
            "accountId": self.account_id,
            "strategyId": self.strategy_id,
            "symbol": self.symbol,
            "exchange": None if self.exchange is None else self.exchange.value,
            "ruleId": None if self.rule_id is None else self.rule_id.value,
            "limitScope": None if self.limit_scope is None else self.limit_scope.value,
            "limitTarget": self.limit_target,
            "observed": self.observed,
            "threshold": self.threshold,
            "action": None if self.action is None else self.action.value,
            "source": self.source,
            "snapshotVersion": self.snapshot_version,
            "message": self.message,
            "isSimulated": self.is_simulated,
            "switchScope": None if self.switch_scope is None else self.switch_scope.value,
            "switchTarget": self.switch_target,
            "decisionId": self.decision_id,
            "requestId": self.request_id,
            "correlationId": self.correlation_id,
            "dedupeKey": self.dedupe_key(),
        }

    def to_trading_event(self) -> TradingEvent:
        """Project onto the existing bus so one timeline holds everything."""
        kind = KIND_TO_TRADING_EVENT.get(self.kind)
        if kind is None:
            # Every RiskEventKind must name its bus event; an unmapped kind
            # would silently vanish from the shared timeline, which is the
            # one thing the "one bus" rule is against.
            raise ValueError(f"No TradingEventType mapping for {self.kind.value}.")
        return TradingEvent(
            event_id=self.event_id,
            event_type=kind,
            tenant_id=self.tenant_id,
            correlation_id=self.correlation_id or self.event_id,
            causation_id=self.decision_id,
            source=f"risk:{self.source}",
            occurred_at=self.occurred_at_micros,
            payload=self.to_payload(),
        )


#: Which bus event each risk event surfaces as. Daily-loss and order-rate
#: breaches also exist as their own bus types (the spec's event list);
#: everything else about decisions and switches rides the closest existing
#: type rather than inventing a new one per spelling.
KIND_TO_TRADING_EVENT: Mapping[RiskEventKind, TradingEventType] = {
    RiskEventKind.LIMIT_BREACHED: TradingEventType.RISK_LIMIT_BREACHED,
    RiskEventKind.ORDER_REJECTED: TradingEventType.RISK_DECISION_REJECTED,
    RiskEventKind.KILL_SWITCH_ENGAGED: TradingEventType.KILL_SWITCH_ACTIVATED,
    RiskEventKind.KILL_SWITCH_RELEASED: TradingEventType.KILL_SWITCH_CLEARED,
    RiskEventKind.KILL_SWITCH_TRIGGERED: TradingEventType.PROTECTION_TRIGGERED,
    RiskEventKind.KILL_SWITCH_ACKNOWLEDGED: TradingEventType.KILL_SWITCH_ACKNOWLEDGED,
    RiskEventKind.KILL_SWITCH_CLEARED: TradingEventType.KILL_SWITCH_CLEARED,
    RiskEventKind.STALE_MARKET_DATA: TradingEventType.MARKET_DATA_STALE,
    RiskEventKind.STALE_RISK_STATE: TradingEventType.RISK_STATE_STALE,
    RiskEventKind.RISK_STATE_UNAVAILABLE: TradingEventType.RISK_STATE_STALE,
    RiskEventKind.DUPLICATE_ORDER_BLOCKED: TradingEventType.RISK_DECISION_REJECTED,
    RiskEventKind.ORDER_BOOK_RESYNC: TradingEventType.ORDER_BOOK_RESYNC_STARTED,
    RiskEventKind.PROTECTION_TRIGGERED: TradingEventType.PROTECTION_TRIGGERED,
    RiskEventKind.PROTECTION_CLEARED: TradingEventType.PROTECTION_CLEARED,
    RiskEventKind.PROTECTION_EXEMPTED: TradingEventType.RISK_DECISION_EXEMPTED,
    RiskEventKind.DAILY_LOSS_BREACHED: TradingEventType.DAILY_LOSS_LIMIT_BREACHED,
    RiskEventKind.ORDER_RATE_BREACHED: TradingEventType.ORDER_RATE_LIMIT_BREACHED,
    RiskEventKind.CANCEL_RATE_BREACHED: TradingEventType.CANCEL_RATE_LIMIT_BREACHED,
    RiskEventKind.CONSECUTIVE_LOSSES_BREACHED: TradingEventType.RISK_LIMIT_BREACHED,
    RiskEventKind.CONFIG_CHANGED: TradingEventType.RISK_LIMIT_CHANGED,
}


def severity_for_breach(
    *,
    observed: Decimal | None,
    limit: Decimal,
    code: RiskDecisionCode | None = None,
    state_corruption: bool = False,
) -> RiskEventSeverity:
    """How loud this breach is, per the spec's ladder.

    Approaching (>= 80% of the ceiling) is a WARNING so an operator can act
    while acting is cheap; an actual breach is CRITICAL; anything involving
    the safety system being unable to see (a corrupted snapshot, an unreadable
    config) is EMERGENCY, because "we may be trading blind" outranks any
    single number that turned out too large. The 0.8 threshold is a constant
    of this module, not a config value: an operator-tunable "approach" knob
    always ends up tuned until the warning never fires.
    """
    if state_corruption:
        return RiskEventSeverity.EMERGENCY
    if code in (
        RiskDecisionCode.RISK_STATE_UNAVAILABLE,
        RiskDecisionCode.RISK_GATE_UNAVAILABLE,
        RiskDecisionCode.RISK_CONFIGURATION_INVALID,
        RiskDecisionCode.UNKNOWN_RISK_RULE,
    ):
        return RiskEventSeverity.EMERGENCY
    if observed is None:
        return RiskEventSeverity.CRITICAL
    if limit > 0 and observed >= limit:
        return RiskEventSeverity.CRITICAL
    if limit > 0 and observed >= limit * Decimal("0.8"):
        return RiskEventSeverity.WARNING
    return RiskEventSeverity.INFO


class RiskEventSink(Protocol):
    """Where events go. ``emit`` returns ``False`` when the event was deduped.

    The boolean is part of the contract because dedup is the point of the
    key: a production sink enforces uniqueness (Redis SETNX then durable
    write), an in-memory one tracks seen keys, and the gate counts both so
    "we emitted 40 000 events today" is measurable *as* 1.
    """

    def emit(self, event: RiskEvent) -> bool: ...


class InMemoryRiskEventSink:
    """Deterministic collector for tests, replay and the paper engine."""

    __slots__ = ("_events", "_seen")

    def __init__(self) -> None:
        self._events: list[RiskEvent] = []
        self._seen: set[str] = set()

    def emit(self, event: RiskEvent) -> bool:
        key = event.dedupe_key()
        if key in self._seen:
            return False
        self._seen.add(key)
        self._events.append(event)
        return True

    @property
    def events(self) -> tuple[RiskEvent, ...]:
        return tuple(self._events)

    def by_kind(self, kind: RiskEventKind) -> tuple[RiskEvent, ...]:
        return tuple(event for event in self._events if event.kind is kind)

    def clear(self) -> None:
        self._events.clear()
        self._seen.clear()


def events_for_replay_digest(events: Iterable[RiskEvent]) -> str:
    """Stable hash over an event sequence, for replay result verification.

    Replay asserts "same inputs -> same events" by digesting the ordered
    payload list; if two runs of identical history disagree here, the
    divergence is a real behavioural difference and the whole point of the
    audit tool is to surface it.
    """
    hasher = hashlib.sha256()
    for event in events:
        payload = event.to_payload()
        payload.pop("eventId", None)
        payload.pop("occurredAtMicros", None)
        hasher.update(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        )
    return hasher.hexdigest()
