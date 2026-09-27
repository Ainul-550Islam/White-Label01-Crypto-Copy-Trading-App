"""Kill-switch lifecycle and automatic protection.

Two objects, one mechanism. A *kill switch* is the halt; an *automatic
protection* is a halt the engine imposes on itself after a breach. Part 8
unifies them on purpose: if protections wrote a parallel "blocked" flag,
every consumer (execution engine, admin UI, mobile badge) would have to
remember to check two sources, and the gap between the two is where a
runaway strategy lives. A triggered protection therefore appears as a
kill-switch record with ``status=TRIGGERED`` — blocking on exactly the same
path a human-engaged switch uses.

The asymmetry is the point:

* a **manual** switch (``ACTIVE``) halts everything, including closing
  orders. Stopping trading means stopping trading; an operator who wants to
  also unwind positions does it through the explicitly authorised execution
  path, not through a loophole in the halt;
* a **triggered** switch (``TRIGGERED``/``ACKNOWLEDGED``) may, according to
  the configured policy, let *risk-reducing* orders through — closing or
  reducing exposure while a daily-loss guard runs is how a position gets
  smaller safely. The classification of "risk-reducing" is computed from
  the projected position, never from a flag on the request;
* a triggered switch is **never auto-cleared** by improving PnL or fresher
  data. It requires an operator acknowledgement and then an explicit clear,
  following ``RISK_SWITCH_TRANSITIONS``.

Evaluation order is the fixed breadth priority in
:data:`wlct_trading.enums.KILL_SWITCH_SCOPE_PRIORITY`: GLOBAL first, SYMBOL
last. A narrow scope can never release a broad one, because the scan
returns the *broadest* blocking record it finds, and lower scopes are only
consulted when higher ones are clear.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from decimal import Decimal
from typing import Any, Final, Mapping

from wlct_trading.enums import (
    KILL_SWITCH_SCOPE_PRIORITY,
    RISK_SWITCH_TRANSITIONS,
    KillSwitchScope,
    ProtectionAction,
    RiskEventSeverity,
    RiskRuleId,
    RiskSwitchStatus,
)

__all__ = [
    "KillSwitchRecord",
    "KillSwitchLedger",
    "AutomaticProtectionPolicy",
    "ProtectionOccurrence",
    "ProtectionTransitionError",
    "SwitchTransition",
    "BlockingSwitch",
    "classify_risk_direction",
]


class ProtectionTransitionError(ValueError):
    """A switch lifecycle transition the transition table forbids."""


@dataclass(slots=True, frozen=True)
class SwitchTransition:
    """An operator- or protection-initiated lifecycle command on a switch."""

    scope: KillSwitchScope
    target: str | None
    #: One of ENGAGE | RELEASE | ACKNOWLEDGE | CLEAR | TRIGGER. Stringly
    #: typed because the same vocabulary crosses the Redis/HTTP boundary; the
    #: ledger validates it, and every unknown verb is refused.
    action: str


@dataclass(slots=True, frozen=True)
class BlockingSwitch:
    """The blocking record the gate found, with everything needed to report it."""

    record: "KillSwitchRecord"
    scope: KillSwitchScope

    @property
    def is_manual(self) -> bool:
        return self.record.status is RiskSwitchStatus.ACTIVE


@dataclass(slots=True, frozen=True)
class KillSwitchRecord:
    """One switch's durable lifecycle record (the Redis/Prisma mirror shape)."""

    scope: KillSwitchScope
    target: str | None
    status: RiskSwitchStatus
    reason: str | None = None
    #: For TRIGGERED records: which rule fired it. A triggered switch without
    #: provenance could not be honestly cleared.
    triggered_by_rule: RiskRuleId | None = None
    severity: RiskEventSeverity = RiskEventSeverity.CRITICAL
    #: A severe trigger must be acknowledged before it can be cleared. Fixed
    #: at trigger time; it is not operator-editable afterwards.
    requires_explicit_clear: bool = False
    engaged_at_micros: int | None = None
    acknowledged_at_micros: int | None = None
    cleared_at_micros: int | None = None
    #: Statuses this record passed through, oldest first. The event bus
    #: carries the human trail; this lets the ledger answer "was this ever
    #: triggered?" without an event query.
    history: tuple[tuple[RiskSwitchStatus, int], ...] = ()

    def __post_init__(self) -> None:
        # Invariants a directly-constructed record must not be able to
        # violate: an automatic trigger (1) carries its reason-for-clearing
        # obligation and (2) opens its history with the status it bears.
        # Without the seeding, a ledger adopted from an external store could
        # "forget" the trigger between processes, and the acknowledge gate
        # would be asking about an event nobody recorded.
        if self.status in (
            RiskSwitchStatus.TRIGGERED,
            RiskSwitchStatus.ACKNOWLEDGED,
        ):
            if not self.requires_explicit_clear:
                object.__setattr__(self, "requires_explicit_clear", True)
            if not self.history:
                object.__setattr__(
                    self,
                    "history",
                    ((self.status, self.engaged_at_micros or 0),),
                )
        if self.scope is not KillSwitchScope.GLOBAL and not self.target:
            raise ProtectionTransitionError(
                f"{self.scope.value} scope requires a target."
            )
        if self.scope is KillSwitchScope.GLOBAL and self.target is not None:
            raise ProtectionTransitionError(
                "The GLOBAL scope must not carry a target; the target is the "
                "platform itself."
            )
        if self.status is RiskSwitchStatus.TRIGGERED and self.triggered_by_rule is None:
            raise ProtectionTransitionError(
                "A TRIGGERED switch must name the rule that triggered it; "
                "an unattributed automatic halt cannot be honestly cleared."
            )

    @property
    def is_blocking(self) -> bool:
        return self.status in (
            RiskSwitchStatus.ACTIVE,
            RiskSwitchStatus.TRIGGERED,
            RiskSwitchStatus.ACKNOWLEDGED,
        )

    @property
    def was_triggered(self) -> bool:
        return any(status is RiskSwitchStatus.TRIGGERED for status, _ in self.history)

    def key(self) -> tuple[str, str]:
        return (self.scope.value, self.target or "")

    def to_payload(self) -> dict[str, Any]:
        return {
            "scope": self.scope.value,
            "target": self.target,
            "status": self.status.value,
            "reason": self.reason,
            "triggeredByRule": (
                None if self.triggered_by_rule is None else self.triggered_by_rule.value
            ),
            "severity": self.severity.value,
            "requiresExplicitClear": self.requires_explicit_clear,
            "engagedAtMicros": self.engaged_at_micros,
            "acknowledgedAtMicros": self.acknowledged_at_micros,
            "clearedAtMicros": self.cleared_at_micros,
            "history": [(status.value, at) for status, at in self.history],
        }


class KillSwitchLedger:
    """Immutable ledger of switch records, keyed by ``(scope, target)``.

    Every mutating method returns a *new* ledger; the transition table plus
    the per-scope sanity rules below is the only way state changes. The gate
    only ever reads :meth:`blocking_for`; transitions happen in the control
    plane (API) or in the worker applying a protection the gate proposed.
    """

    __slots__ = ("_records",)

    def __init__(self, records: tuple[KillSwitchRecord, ...] = ()) -> None:
        by_key: dict[tuple[str, str], KillSwitchRecord] = {}
        for record in records:
            if record.key() in by_key:
                raise ProtectionTransitionError(
                    f"Duplicate switch record for {record.key()}."
                )
            by_key[record.key()] = record
        self._records = tuple(by_key[key] for key in sorted(by_key))

    @property
    def records(self) -> tuple[KillSwitchRecord, ...]:
        return self._records

    def get(
        self, scope: KillSwitchScope, target: str | None = None
    ) -> KillSwitchRecord | None:
        key = (scope.value, target or "")
        for record in self._records:
            if record.key() == key:
                return record
        return None

    def blocking_for(
        self,
        *,
        exchange: str,
        account_id: str,
        strategy_id: str | None,
        symbol: str,
    ) -> BlockingSwitch | None:
        """The broadest blocking switch applicable to this order context.

        Scans in ``KILL_SWITCH_SCOPE_PRIORITY`` order and returns on the
        first hit — which is what makes "a lower-level setting can never
        override an active higher-level switch" a property of the algorithm,
        not of the data.
        """
        for scope in KILL_SWITCH_SCOPE_PRIORITY:
            record = self._blocking_record_for(
                scope, exchange, account_id, strategy_id, symbol
            )
            if record is not None:
                return BlockingSwitch(record=record, scope=scope)
        return None

    def _blocking_record_for(
        self,
        scope: KillSwitchScope,
        exchange: str,
        account_id: str,
        strategy_id: str | None,
        symbol: str,
    ) -> KillSwitchRecord | None:
        for record in self._records:
            if not record.is_blocking or record.scope is not scope:
                continue
            match scope:
                case KillSwitchScope.GLOBAL:
                    return record
                case KillSwitchScope.EXCHANGE:
                    if record.target == exchange:
                        return record
                case KillSwitchScope.ACCOUNT:
                    if record.target == account_id:
                        return record
                case KillSwitchScope.RISK:
                    if record.target == f"account:{account_id}":
                        return record
                case KillSwitchScope.STRATEGY:
                    if strategy_id is not None and record.target == strategy_id:
                        return record
                case KillSwitchScope.SYMBOL:
                    if record.target == symbol:
                        return record
        return None

    # -- transitions ------------------------------------------------------
    def with_transition(
        self,
        transition: SwitchTransition,
        *,
        now_micros: int,
        triggered_by_rule: RiskRuleId | None = None,
        severity: RiskEventSeverity = RiskEventSeverity.CRITICAL,
        reason: str | None = None,
    ) -> "KillSwitchLedger":
        """Apply one lifecycle command, or raise ``ProtectionTransitionError``.

        Rules, in order of consequence:

        * the transition must be legal under ``RISK_SWITCH_TRANSITIONS``;
        * ``TRIGGER`` may only come from a rule (never from an operator —
          operators ENGAGE);
        * releasing a record that was triggered with
          ``requires_explicit_clear`` is refused until it has been
          acknowledged — PnL recovering is not the clear;
        * ``ACKNOWLEDGE`` keeps the record blocking; it changes the paper
          trail, not the halt.
        """
        existing = self.get(transition.scope, transition.target)
        current_status = (
            existing.status if existing is not None else RiskSwitchStatus.INACTIVE
        )
        if transition.action == "TRIGGER" and triggered_by_rule is None:
            raise ProtectionTransitionError(
                "An automatic trigger must name its rule; 'TRIGGER' without "
                "a rule is an operator ENGAGE wearing its clothes."
            )
        # The explicit-clear gate runs BEFORE generic legality so the
        # message names the actual obstacle. (Generic legality would also
        # refuse TRIGGERED -> INACTIVE; an operator told "not legal" goes
        # looking for a bug, one told "acknowledge first" fixes the process.)
        if transition.action in ("RELEASE", "CLEAR") and existing is not None:
            if (
                existing.requires_explicit_clear
                and existing.status is RiskSwitchStatus.TRIGGERED
            ):
                raise ProtectionTransitionError(
                    "This switch was triggered by automatic protection and "
                    "requires explicit acknowledgement before release. "
                    "Acknowledge it first, then clear it."
                )
        target_status = self._target_status(transition.action, current_status)
        base = existing or KillSwitchRecord(
            scope=transition.scope,
            target=transition.target,
            status=RiskSwitchStatus.INACTIVE,
        )
        record = replace(
            base,
            status=target_status,
            reason=reason if reason is not None else base.reason,
            triggered_by_rule=(
                triggered_by_rule
                if transition.action == "TRIGGER"
                else base.triggered_by_rule
            ),
            severity=severity if transition.action == "TRIGGER" else base.severity,
            requires_explicit_clear=(
                True if transition.action == "TRIGGER" else base.requires_explicit_clear
            ),
            engaged_at_micros=(
                now_micros
                if transition.action in ("ENGAGE", "TRIGGER")
                else base.engaged_at_micros
            ),
            acknowledged_at_micros=(
                now_micros
                if transition.action == "ACKNOWLEDGE"
                else base.acknowledged_at_micros
            ),
            cleared_at_micros=(
                now_micros
                if transition.action in ("RELEASE", "CLEAR")
                else base.cleared_at_micros
            ),
            history=base.history + ((target_status, now_micros),),
        )
        found = any(r.key() == record.key() for r in self._records)
        records = [
            record if r.key() == record.key() else r for r in self._records
        ]
        if not found:
            records.append(record)
        return KillSwitchLedger(tuple(records))

    @staticmethod
    def _target_status(action: str, current: RiskSwitchStatus) -> RiskSwitchStatus:
        target: RiskSwitchStatus
        match action:
            case "ENGAGE":
                target = RiskSwitchStatus.ACTIVE
            case "TRIGGER":
                target = RiskSwitchStatus.TRIGGERED
            case "ACKNOWLEDGE":
                target = RiskSwitchStatus.ACKNOWLEDGED
            case "CLEAR":
                target = RiskSwitchStatus.CLEARED
            case "RELEASE":
                target = RiskSwitchStatus.INACTIVE
            case _:
                raise ProtectionTransitionError(f"Unknown switch action {action!r}.")
        if current is target:
            raise ProtectionTransitionError(
                f"Switch is already {current.value}; refusing a no-op "
                "transition so double-clicks cannot fabricate lifecycle "
                "history."
            )
        if target not in RISK_SWITCH_TRANSITIONS.get(current, frozenset()):
            raise ProtectionTransitionError(
                f"Transition {current.value} -> {target.value} is not legal "
                "for a risk switch."
            )
        return target


#: Protection actions map to the switch scope that expresses them.
#: ``BLOCK_NEW_RISK`` is the odd one: it is not a scope halt at all, it is
#: recorded at RISK scope keyed by the account and blocks only
#: risk-increasing orders, which is why a "close-only" recovery mode and a
#: full account halt remain different things.
_ACTION_SCOPES: Final[Mapping[ProtectionAction, KillSwitchScope]] = {
    ProtectionAction.BLOCK_NEW_RISK: KillSwitchScope.RISK,
    ProtectionAction.BLOCK_SYMBOL: KillSwitchScope.SYMBOL,
    ProtectionAction.BLOCK_STRATEGY: KillSwitchScope.STRATEGY,
    ProtectionAction.BLOCK_ACCOUNT: KillSwitchScope.ACCOUNT,
    ProtectionAction.BLOCK_EXCHANGE: KillSwitchScope.EXCHANGE,
    ProtectionAction.GLOBAL_TRADING_STOP: KillSwitchScope.GLOBAL,
}


@dataclass(slots=True, frozen=True)
class AutomaticProtectionPolicy:
    """What happens *automatically* when a limit is breached.

    Defaults are the conservative reading of the Part 8 brief: a breach
    blocks *new risk* at the narrowest credible scope and never closes a
    position. Every action is a capability removal; the policy has no knob
    that adds capability, and the enum it draws on (``ProtectionAction``)
    deliberately has no liquidation member.

    ``allow_risk_reducing_orders`` applies to protection-triggered switches
    only — a manual kill switch halts everything, by design, so it cannot be
    "configured open" from here.
    """

    daily_loss_action: ProtectionAction = ProtectionAction.BLOCK_NEW_RISK
    strategy_daily_loss_action: ProtectionAction = ProtectionAction.BLOCK_STRATEGY
    drawdown_action: ProtectionAction = ProtectionAction.BLOCK_ACCOUNT
    consecutive_losses_action: ProtectionAction = ProtectionAction.BLOCK_STRATEGY
    order_rate_action: ProtectionAction = ProtectionAction.BLOCK_STRATEGY
    cancel_rate_action: ProtectionAction = ProtectionAction.BLOCK_STRATEGY
    stale_risk_state_action: ProtectionAction = ProtectionAction.BLOCK_NEW_RISK
    allow_risk_reducing_orders: bool = True

    @staticmethod
    def scope_for(action: ProtectionAction) -> KillSwitchScope:
        return _ACTION_SCOPES[action]

    def to_payload(self) -> dict[str, Any]:
        return {
            "dailyLossAction": self.daily_loss_action.value,
            "strategyDailyLossAction": self.strategy_daily_loss_action.value,
            "drawdownAction": self.drawdown_action.value,
            "consecutiveLossesAction": self.consecutive_losses_action.value,
            "orderRateAction": self.order_rate_action.value,
            "cancelRateAction": self.cancel_rate_action.value,
            "staleRiskStateAction": self.stale_risk_state_action.value,
            "allowRiskReducingOrders": self.allow_risk_reducing_orders,
        }

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> "AutomaticProtectionPolicy":
        keys = set(payload)
        expected = {
            "dailyLossAction",
            "strategyDailyLossAction",
            "drawdownAction",
            "consecutiveLossesAction",
            "orderRateAction",
            "cancelRateAction",
            "staleRiskStateAction",
            "allowRiskReducingOrders",
        }
        if keys - expected or expected - keys:
            raise ProtectionTransitionError(
                "Protection policy payload keys must be exactly "
                f"{sorted(expected)}; got {sorted(keys)}."
            )
        values: dict[str, ProtectionAction] = {}
        for name, field in (
            ("dailyLossAction", "daily_loss_action"),
            ("strategyDailyLossAction", "strategy_daily_loss_action"),
            ("drawdownAction", "drawdown_action"),
            ("consecutiveLossesAction", "consecutive_losses_action"),
            ("orderRateAction", "order_rate_action"),
            ("cancelRateAction", "cancel_rate_action"),
            ("staleRiskStateAction", "stale_risk_state_action"),
        ):
            raw = payload[name]
            try:
                values[field] = ProtectionAction(raw)
            except ValueError as exc:
                raise ProtectionTransitionError(
                    f"Unknown protection action {raw!r} for {name}."
                ) from exc
        reduce_raw = payload["allowRiskReducingOrders"]
        if not isinstance(reduce_raw, bool):
            raise ProtectionTransitionError(
                "allowRiskReducingOrders must be a boolean."
            )
        return cls(**values, allow_risk_reducing_orders=reduce_raw)


@dataclass(slots=True, frozen=True)
class ProtectionOccurrence:
    """One breach severe enough to consider automatic protection.

    Produced by the gate; *applied* by the control plane. Keeping it as a
    returned value rather than a side effect is what lets the gate stay pure
    and lets replay reproduce history without ever re-triggering the world.
    """

    rule_id: RiskRuleId
    action: ProtectionAction
    account_id: str
    strategy_id: str | None
    symbol: str | None
    exchange: str
    reason: str
    severity: RiskEventSeverity
    occurred_at_micros: int

    @property
    def switch_scope(self) -> KillSwitchScope:
        return _ACTION_SCOPES[self.action]

    @property
    def switch_target(self) -> str | None:
        scope = self.switch_scope
        match scope:
            case KillSwitchScope.GLOBAL:
                return None
            case KillSwitchScope.EXCHANGE:
                return self.exchange
            case KillSwitchScope.ACCOUNT:
                return self.account_id
            case KillSwitchScope.RISK:
                return f"account:{self.account_id}"
            case KillSwitchScope.STRATEGY:
                if self.strategy_id is None:
                    # A per-strategy action without a strategy is an account
                    # problem wearing a strategy label; escalate to RISK
                    # scope for the account rather than inventing a target.
                    return f"account:{self.account_id}"
                return self.strategy_id
            case KillSwitchScope.SYMBOL:
                return self.symbol
        raise ProtectionTransitionError(
            f"No switch target for action {self.action.value}."
        )

    def to_payload(self) -> dict[str, Any]:
        return {
            "ruleId": self.rule_id.value,
            "action": self.action.value,
            "accountId": self.account_id,
            "strategyId": self.strategy_id,
            "symbol": self.symbol,
            "exchange": self.exchange,
            "reason": self.reason,
            "severity": self.severity.value,
            "occurredAtMicros": self.occurred_at_micros,
        }


def classify_risk_direction(
    *,
    reduce_only: bool,
    current_signed: Decimal,
    projected_signed: Decimal,
) -> bool:
    """``True`` when the order increases absolute exposure.

    The gate computes ``projected_signed`` from the authoritative position
    state plus all open-order reservations plus this order — never from the
    order alone — so "risk-reducing" is a statement about the *projected*
    book. Equal magnitude (a full close) is not risk-increasing; a flip
    through zero into a larger absolute position is, and classifying that as
    a close is precisely how a "close-only mode" leaks a brand-new
    position. There is therefore no close-only mode: the arithmetic is the
    gate.
    """
    if reduce_only:
        return False
    return abs(projected_signed) > abs(current_signed)
