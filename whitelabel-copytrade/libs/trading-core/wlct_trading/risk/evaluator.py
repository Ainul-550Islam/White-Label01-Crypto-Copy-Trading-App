"""``RiskGate`` - the authoritative decision between order intent and execution.

Flow, exactly as numbered, with nothing skipped and nothing reordered at
call sites (the order *is* the policy: cheap catastrophic states first, so a
kill switch costs no arithmetic and a corrupt snapshot never reaches the rule
engine that would evaluate against it):

::

    0. wiring          gate constructed with a configuration; a missing or
                       invalid one is itself a refusal (RISK_CONFIGURATION_INVALID)
    1. request shape   non-empty request id; intent structural validity
    2. core engine     Part 2/5 evaluation via composition - kill switches
                       (legacy four scopes), completeness, duplicate ids,
                       enablement, pricing, base limits. A core rejection is
                       final; the gate can only tighten, never overturn.
    3. binding         snapshot <-> tenant/account, simulated/live pairing,
                       configuration digest match, snapshot self-consistency
    4. freshness       snapshot age + per-source budgets (freshness.py)
    5. account state   presence, sign, self-consistency; and - for
                       balance-governed buying - sufficient available
    6. position state  projection integrity over positions + open orders
    7. kill switches   the six-scope ledger in KILL_SWITCH_SCOPE_PRIORITY
                       order; protection-triggered switches may admit
                       risk-reducing orders per policy; manual switches admit
                       nothing
    8. projection      open-order reservations + candidate -> projected state
    9. rules           the catalog (rules.py); UNVERIFIABLE is a refusal
   10. consumption     distributed rate window + budget reservation for
                       risk-increasing approvals, when wired
   11. decision        enriched RiskDecision + outcomes + proposed
                       protections + events

Two structural guarantees this file owns:

* **No bypass.** ``evaluate`` returns a decision for every input, including
  the ones that would raise inside a lesser engine - each stage's exception
  is caught *at that stage* and converted into a refusal with an EMERGENCY
  event. There is no branch in this file, and none in the execution bridge,
  in which "could not decide" reaches a caller as an approval.
* **Computation, not persistence.** The gate writes nothing durable:
  protections it proposes and events it emits are values in the outcome;
  applying them (Redis ledgers, DB rows, bus publishes) is the host's job,
  which is what lets replay run the identical pipeline over history without
  side effects, and lets the API expose "what the gate proposed" without
  the API becoming a trading engine.

The risk-reducing exemption under a *triggered* protection is computed from
the projected position (stage 8 before stage 7b), never from ``reduce_only``
alone: an order flagged reduce-only whose projection would flip the position
increases risk and is refused by the switch like any other order. That is
the difference between a close-only allowance with arithmetic behind it and
a checkbox with a bug behind it.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, replace
from decimal import Decimal
from typing import Mapping

from wlct_trading.clock import epoch_micros
from wlct_trading.enums import (
    KillSwitchScope,
    OrderSide,
    ProtectionAction,
    RiskDecisionCode,
    RiskEventKind,
    RiskEventSeverity,
    RiskLimitScope,
    RiskRuleId,
    RiskSwitchStatus,
    TradingMode,
)
from wlct_trading.market_data import BookTop
from wlct_trading.observability.tracing import SpanStatus, Tracer
from wlct_trading.orders import OrderIntent
from wlct_trading.risk.codes import RULE_TO_DECISION_CODE
from wlct_trading.risk.configuration import (
    RATE_WINDOW_ONE_MINUTE_MICROS,
    RATE_WINDOW_ONE_SECOND_MICROS,
    ResolvedLimit,
    RiskConfiguration,
    ScopeContext,
)
from wlct_trading.risk.core import (
    KillSwitchState,
    RiskDecision,
    RiskEngine,
    RiskLimits,
    RiskViolation,
)
from wlct_trading.risk.decisions import LatencyBreakdown, LatencyStopwatch
from wlct_trading.risk.events import (
    InMemoryRiskEventSink,
    RiskEvent,
    RiskEventSink,
)
from wlct_trading.risk.exposure import (
    ExposureBreakdown,
    ExposureDimension,
    build_breakdown,
    orders_for,
    project_position,
)
from wlct_trading.risk.freshness import (
    FreshnessBudget,
    FreshnessReport,
    SourceFreshness,
    is_fresh,
)
from wlct_trading.risk.ledger import (
    ReservationRequest,
    ReservationResult,
    ReservationTicket,
    RiskReservationLedger,
)
from wlct_trading.risk.protections import (
    AutomaticProtectionPolicy,
    KillSwitchLedger,
    ProtectionOccurrence,
    SwitchTransition,
    classify_risk_direction,
)
from wlct_trading.risk.rate_limits import (
    RateCoordinator,
    RateReservation,
    RateWindowCounters,
    RiskRateKind,
)
from wlct_trading.risk.rules import (
    ProjectionResult,
    RuleInputs,
    RuleOutcome,
    RuleStatus,
    assert_catalog_coherence,
    evaluate_rules,
)
from wlct_trading.risk.snapshot import (
    RiskAccountState,
    RiskStateSnapshot,
)

__all__ = ["RiskGate", "GateOutcome", "GateError"]

_ZERO = Decimal(0)


class GateError(Exception):
    """Gate wiring failure at construction (never a decision outcome)."""


@dataclass(slots=True, frozen=True)
class GateOutcome:
    """Everything one gate evaluation produced.

    The decision is the verdict; the rest is the evidence. They are kept in
    separate objects so the hot path can persist only the decision (already
    the type ``ExecutionResult``, incidents and the API consume) while
    workers that write event rows and replay comparisons read the rest.
    """

    decision: RiskDecision
    outcomes: tuple[RuleOutcome, ...]
    events: tuple[RiskEvent, ...]
    #: Protections this evaluation says *should* be triggered. The gate does
    # not apply them (see module docstring); the host writes the switch
    # ledger and persists the events.
    proposed_protections: tuple[ProtectionOccurrence, ...]
    #: A consumed budget reservation, present exactly when the order was
    # approved *and* a ledger is wired *and* the order increases risk. The
    # caller must release it if the order never reaches the venue.
    reservation: ReservationTicket | None
    latency: LatencyBreakdown
    exposure: ExposureBreakdown | None
    #: The snapshot version the decision was taken at - callers persist it,
    # and ``decisions.decision_is_current`` compares against it. There is no
    # decision cache in this package to consult, by design.
    snapshot_version: int | None
    #: A consumed order-rate window slot at approval. The caller must roll it
    # back if the order never reaches the venue (same contract as the budget
    # reservation; None when no coordinator is wired). Last because frozen
    # dataclass defaults must trail the required fields.
    rate_reservation: RateReservation | None = None

    @property
    def blocking_rules(self) -> tuple[RiskRuleId, ...]:
        return tuple(
            outcome.rule_id for outcome in self.outcomes if outcome.blocks
        )


class RiskGate:
    """The composed engine: Part 2/5 core evaluation + the Part 8 catalog."""

    __slots__ = (
        "_core",
        "_config",
        "_kill_switches",
        "_events",
        "_reservations",
        "_rates",
        "_freshness",
        "_simulated",
        "_tracer",
    )

    def __init__(
        self,
        *,
        configuration: RiskConfiguration | None,
        core: RiskEngine | None = None,
        kill_switches: KillSwitchLedger | None = None,
        events: RiskEventSink | None = None,
        reservations: RiskReservationLedger | None = None,
        rate_coordinator: RateCoordinator | None = None,
        freshness: FreshnessBudget | None = None,
        simulated: bool = False,
        tracer: Tracer | None = None,
    ) -> None:
        # The catalog's own invariants run first: a gate built from a source
        # tree where a rule lost its evaluator must die at wiring, not trade.
        assert_catalog_coherence()
        if configuration is not None:
            errors = configuration.validate()
            if errors:
                raise GateError("; ".join(errors))
        self._config = configuration
        if core is not None:
            self._core = core
        else:
            # The gate's own core instance runs state-consistency only: the
            # catalog owns every numeric ceiling (with reservation-aware
            # projection and protection proposals), and letting a second
            # numeric layer shadow it would lose precisely those. A host
            # that *wants* dual numeric enforcement passes its configured
            # core explicitly - the wiring then says what governs.
            self._core = RiskEngine(
                platform_limits=RiskLimits(),
                evaluate_numeric_limits=False,
            )
        self._kill_switches = (
            kill_switches if kill_switches is not None else KillSwitchLedger()
        )
        self._events = events if events is not None else InMemoryRiskEventSink()
        self._reservations = reservations
        self._rates = rate_coordinator
        self._freshness = (
            freshness
            if freshness is not None
            else FreshnessBudget(max_snapshot_age_micros=5_000_000)
        )
        self._simulated = simulated
        self._tracer = tracer

    # -- accessor + control-plane-adjacent state ----------------------------
    @property
    def configuration(self) -> RiskConfiguration | None:
        return self._config

    @property
    def kill_switches(self) -> KillSwitchLedger:
        return self._kill_switches

    @property
    def is_simulated(self) -> bool:
        return self._simulated

    @property
    def events(self) -> RiskEventSink:
        return self._events

    def update_configuration(self, configuration: RiskConfiguration) -> None:
        """Replace the governing document (the configuration-change path).

        Snapshots assembled against the previous digest become stale by the
        binding check inside ``evaluate`` - there is no ``invalidate()`` to
        call and no cache to purge, because there is no cache. Deployment
        coordination bumps the Redis config-version key as well; that key
        tells *other* workers' loaders to rebuild, while this call stops the
        current worker from using the old document.
        """
        errors = configuration.validate()
        if errors:
            raise GateError("; ".join(errors))
        self._config = configuration

    def update_kill_switches(self, ledger: KillSwitchLedger) -> None:
        self._kill_switches = ledger

    def apply_protections(
        self, occurrences: tuple[ProtectionOccurrence, ...], *, now_micros: int
    ) -> KillSwitchLedger:
        """Trigger the switch ledger for the protections an outcome proposed.

        This is the host's "apply" step kept here only because the ledger is
        the gate's own read model; the durable copies (Prisma rows, Redis
        keys) are the API/worker's job. Calling it on a replayed outcome is
        harmless *to the world* and wrong for the audit, so replay builds its
        own gate and never calls this - the separation is by instance, which
        is the only kind of separation that survives a code edit.
        """
        ledger = self._kill_switches
        for occurrence in occurrences:
            ledger = ledger.with_transition(
                _transition_for(occurrence),
                now_micros=now_micros,
                triggered_by_rule=occurrence.rule_id,
                severity=occurrence.severity,
                reason=occurrence.reason,
            )
        self._kill_switches = ledger
        return ledger

    def rollback_rate(self, reservation: RateReservation | None) -> None:
        """Return an order-rate slot consumed by an approval that died.

        Same non-raising posture as the cancel-path helper: a rate rollback
        that fails means a slot stays held until the bucket expires - the
        conservative direction - and the caller's order is already being
        rejected, so an exception here would only lose the rejection.
        """
        if reservation is None:
            return
        self._rates_rollback(reservation)

    def release_reservation(self, ticket: ReservationTicket | None) -> None:
        """Hand a consumed budget reservation back (order died pre-venue).

        Public so the execution bridge can call it on its own failure paths.
        A double release raises (see the local ledger) - silently absorbing
        it would hide the same class of bug an unreleased ticket hides, in
        the opposite direction.
        """
        if ticket is not None and self._reservations is not None:
            self._reservations.release(ticket)

    def consume_cancel_rate(
        self,
        *,
        tenant_id: str,
        account_id: str,
        strategy_id: str | None,
        now_micros: int | None = None,
    ) -> RateReservation | None:
        """Distributed cancel-window consume for the host's cancel path.

        Cancellations never flow through :meth:`evaluate` (they reduce
        exposure; there is nothing to gate), but they *do* have a rate
        ceiling - the accidental cancel loop is the canonical runaway. The
        host that executes cancels calls this before the venue call and
        rolls back when the cancel fails; the coordinator is optional, so
        single-process deployments simply have no distributed window and the
        snapshot-based rule still applies. Returns ``None`` when no
        coordinator is wired.
        """
        if self._rates is None:
            return None
        now = epoch_micros() if now_micros is None else now_micros
        _ = strategy_id  # kept in the signature for per-strategy windows later
        limits = self._cancel_rate_ceilings(tenant_id, account_id, now)
        return self._rates.try_consume(
            tenant_id,
            account_id,
            RiskRateKind.CANCELS,
            now,
            max_per_second=limits[0],
            max_per_minute=limits[1],
        )

    def rollback_cancel_rate(self, reservation: RateReservation | None) -> None:
        if reservation is not None and self._rates is not None:
            self._rates.rollback(reservation)

    # -- the gate ------------------------------------------------------------
    def evaluate(
        self,
        intent: OrderIntent,
        *,
        state: RiskStateSnapshot | None,
        request_id: str,
        trading_mode: TradingMode,
        legacy_kill_switches: KillSwitchState | None = None,
        now_micros: int | None = None,
        book_top: BookTop | None = None,
        requested_leverage: Decimal | None = None,
        snapshot_latency_micros: int | None = None,
        decision_id: str | None = None,
    ) -> GateOutcome:
        """The public gate entry: one authoritative decision, optionally
        observed as a ``risk.evaluate`` span.

        The tracer only *records*. Nothing set here can change a verdict, and
        with no tracer configured the call is passed through verbatim - the
        decision-equivalence contract of Part 10 (tests run every Part 8
        scenario with a recording tracer and with none and compare the full
        decision tuples). The span names each boundary the gate owns: state
        freshness, kill-switch evaluation, reservation admission, and rule
        outcomes are all encoded in the decision attributes below.
        """
        tracer = self._tracer
        if tracer is None:
            return self._evaluate_inner(
                intent,
                state=state,
                request_id=request_id,
                trading_mode=trading_mode,
                legacy_kill_switches=legacy_kill_switches,
                now_micros=now_micros,
                book_top=book_top,
                requested_leverage=requested_leverage,
                snapshot_latency_micros=snapshot_latency_micros,
                decision_id=decision_id,
            )
        span = tracer.start_span(
            "risk.evaluate",
            attributes={
                "trade.tenant_id": state.tenant_id if state is not None else "",
                "trade.account_id": (
                    state.account_id if state is not None else ""
                ),
                "trade.symbol": intent.symbol,
                "trade.trading_mode": trading_mode.value,
                "risk.simulated": "true" if self._simulated else "false",
                "risk.state_present": "true" if state is not None else "false",
            },
        )
        try:
            outcome = self._evaluate_inner(
                intent,
                state=state,
                request_id=request_id,
                trading_mode=trading_mode,
                legacy_kill_switches=legacy_kill_switches,
                now_micros=now_micros,
                book_top=book_top,
                requested_leverage=requested_leverage,
                snapshot_latency_micros=snapshot_latency_micros,
                decision_id=decision_id,
            )
        except Exception as exc:
            span.record_exception(exc)
            span.set_attribute("outcome", "error")
            span.set_status(SpanStatus.ERROR, description="risk evaluation raised")
            raise
        decision = outcome.decision
        span.set_attribute("approved", "true" if decision.approved else "false")
        span.set_attribute("risk.decision_code", decision.code.value)
        span.set_attribute(
            "risk.snapshot_version",
            "" if decision.snapshot_version is None
            else str(decision.snapshot_version),
        )
        if decision.kill_switch_scope is not None:
            span.set_attribute(
                "risk.kill_switch_scope", decision.kill_switch_scope.value
            )
        span.set_attribute("risk.event_count", len(outcome.events))
        span.set_attribute(
            "outcome", "approved" if decision.approved else "denied"
        )
        span.set_status(SpanStatus.OK)
        span.end()
        return outcome

    def _evaluate_inner(
        self,
        intent: OrderIntent,
        *,
        state: RiskStateSnapshot | None,
        request_id: str,
        trading_mode: TradingMode,
        legacy_kill_switches: KillSwitchState | None = None,
        now_micros: int | None = None,
        book_top: BookTop | None = None,
        requested_leverage: Decimal | None = None,
        snapshot_latency_micros: int | None = None,
        decision_id: str | None = None,
    ) -> GateOutcome:
        """One authoritative decision. Never raises for a risk condition;
        anything the gate cannot prove is a refusal.

        ``decision_id`` may be supplied by deterministic callers (replay
        stamps decisions with the step that produced them, so the whole
        verdict history reproduces byte-for-byte); production leaves it
        ``None`` and receives a fresh uuid4.
        """
        now = epoch_micros() if now_micros is None else now_micros
        watch = LatencyStopwatch()
        decision_id = decision_id or str(uuid.uuid4())
        events: list[RiskEvent] = []
        config = self._config

        def build(
            *,
            approved: bool,
            code: RiskDecisionCode,
            violations: tuple[RiskViolation, ...],
            kill_switch_scope: KillSwitchScope | None = None,
        ) -> RiskDecision:
            return self._decision(
                decision_id,
                intent,
                approved=approved,
                code=code,
                violations=violations,
                trading_mode=trading_mode,
                state=state,
                request_id=request_id,
                now=now,
                watch=watch,
                kill_switch_scope=kill_switch_scope,
                snapshot_latency_micros=snapshot_latency_micros,
            )

        def refuse(
            code: RiskDecisionCode,
            message: str,
            *,
            rule: RiskRuleId | None = None,
            severity: RiskEventSeverity = RiskEventSeverity.CRITICAL,
            observed: str | None = None,
            threshold: str | None = None,
            kind: RiskEventKind = RiskEventKind.ORDER_REJECTED,
            state_corruption: bool = False,
        ) -> GateOutcome:
            violation = RiskViolation(
                code=code,
                message=message,
                rule=rule,
                observed=observed,
                limit=threshold,
            )
            decision = build(
                approved=False,
                code=code,
                violations=(violation,),
            )
            events.append(
                self._event(
                    kind=kind,
                    severity=(
                        RiskEventSeverity.EMERGENCY
                        if state_corruption
                        else severity
                    ),
                    state=state,
                    intent=intent,
                    rule=rule,
                    message=message,
                    observed=observed,
                    threshold=threshold,
                    now=now,
                    decision_id=decision_id,
                    request_id=request_id,
                )
            )
            self._emit(events)
            return GateOutcome(
                decision=decision,
                outcomes=(),
                events=tuple(events),
                proposed_protections=(),
                reservation=None,
                latency=decision.latency
                if decision.latency is not None
                else watch.breakdown(),
                exposure=None,
                snapshot_version=None if state is None else state.version,
            )

        # -- 0. configuration wiring ------------------------------------------
        if config is None:
            return refuse(
                RiskDecisionCode.RISK_CONFIGURATION_INVALID,
                "The risk gate has no active configuration; orders are not "
                "evaluated against an absent limits document. This is a "
                "wiring fault, not a market condition.",
                state_corruption=True,
            )

        # -- 1. request shape ----------------------------------------------------
        if not request_id.strip():
            return refuse(
                RiskDecisionCode.INVALID_INTENT,
                "A risk evaluation requires a non-empty request id; without "
                "one, decisions cannot be correlated to orders and the audit "
                "trail cannot close.",
            )

        # -- 2. core engine (composition, never replacement) ---------------------
        try:
            core_decision, state_gap = self._run_core(
                intent,
                state=state,
                trading_mode=trading_mode,
                legacy_kill_switches=legacy_kill_switches,
                book_top=book_top,
                now=now,
                config=config,
            )
        except Exception as exc:  # fail closed at the stage boundary
            return refuse(
                RiskDecisionCode.RISK_GATE_UNAVAILABLE,
                f"The core evaluation stage raised {type(exc).__name__}; the "
                "decision it could not complete denies the order.",
                state_corruption=True,
            )
        watch.mark("core")
        if core_decision is None:
            return refuse(
                RiskDecisionCode.RISK_STATE_UNAVAILABLE,
                f"Core risk state is incomplete ({state_gap})",
            )
        if not core_decision.approved:
            for violation in core_decision.violations:
                events.append(
                    self._event(
                        kind=(
                            RiskEventKind.DUPLICATE_ORDER_BLOCKED
                            if core_decision.code
                            is RiskDecisionCode.DUPLICATE_ORDER
                            else RiskEventKind.LIMIT_BREACHED
                        ),
                        severity=RiskEventSeverity.CRITICAL,
                        state=state,
                        intent=intent,
                        rule=violation.rule,
                        message=violation.message,
                        observed=violation.observed,
                        threshold=violation.limit,
                        now=now,
                        decision_id=decision_id,
                        request_id=request_id,
                    )
                )
            decision = build(
                approved=False,
                code=core_decision.code,
                violations=core_decision.violations,
                kill_switch_scope=core_decision.kill_switch_scope,
            )
            self._emit(events)
            return GateOutcome(
                decision=decision,
                outcomes=(),
                events=tuple(events),
                proposed_protections=(),
                reservation=None,
                latency=decision.latency
                if decision.latency is not None
                else watch.breakdown(),
                exposure=None,
                snapshot_version=decision.snapshot_version,
            )
        assert state is not None  # the bridge in _run_core returns None with no state

        # -- 3. binding & consistency ----------------------------------------------
        if state.tenant_id != intent.tenant_id or state.account_id != intent.account_id:
            return refuse(
                RiskDecisionCode.RISK_STATE_UNAVAILABLE,
                "The snapshot belongs to a different tenant/account than the "
                "intent; refusing to evaluate one account's state for another.",
                state_corruption=True,
            )
        if self._simulated != state.is_simulated:
            return refuse(
                RiskDecisionCode.RISK_STATE_UNAVAILABLE,
                "Simulated and live state must not cross gates: a live gate "
                "refuses simulated state, and a paper gate refuses live "
                "balances. Both directions are refusals; neither is a "
                "warning.",
                state_corruption=True,
            )
        if state.config_digest is not None and state.config_digest != config.digest:
            return refuse(
                RiskDecisionCode.STALE_RISK_STATE,
                "The snapshot was assembled against a different risk "
                "configuration digest than the governing one; risk "
                "configuration changes invalidate stale snapshots by this "
                "check, not by trust.",
                kind=RiskEventKind.STALE_RISK_STATE,
            )
        consistency = state.is_consistent()
        if consistency:
            return refuse(
                RiskDecisionCode.RISK_STATE_UNAVAILABLE,
                "The risk snapshot contradicts itself: " + "; ".join(consistency),
                state_corruption=True,
            )
        watch.mark("validation")

        # -- 4a. account state (identity first: staleness of a *wrong*
        # account is still the wrong account) ----------------------------------------
        account = state.account
        if account is None:
            return refuse(
                RiskDecisionCode.INVALID_ACCOUNT_STATE,
                "No account state in the snapshot. Unavailable state is "
                "unsafe state.",
                kind=RiskEventKind.RISK_STATE_UNAVAILABLE,
                state_corruption=True,
            )
        account_errors = account.consistency_errors()
        if account_errors:
            return refuse(
                RiskDecisionCode.INVALID_ACCOUNT_STATE,
                "Account state contradicts itself: " + "; ".join(account_errors),
                state_corruption=True,
            )

        # -- 4b. position / reservation integrity --------------------------------------
        # Before freshness on purpose: a row with no timestamp at all is a
        # state-integrity failure (INVALID_POSITION_STATE), while a row that
        # has one and is too old is a timing failure (STALE_RISK_STATE).
        # Collapsing the first into the second would point operators at the
        # clock when they should be looking at the loader.
        context = state.projecting_context()
        projection_errors = context.integrity_errors()
        if projection_errors:
            return refuse(
                RiskDecisionCode.INVALID_POSITION_STATE,
                "Position/open-order state cannot be projected: "
                + "; ".join(projection_errors),
                state_corruption=True,
            )
        for position in state.positions:
            if position.source_timestamp_micros is None:
                return refuse(
                    RiskDecisionCode.INVALID_POSITION_STATE,
                    f"Position on {position.symbol} carries no source timestamp.",
                )

        # -- 4c. freshness ---------------------------------------------------------------
        report = self._freshness_report(state, now)
        if not report.is_fresh:
            return refuse(
                RiskDecisionCode.STALE_RISK_STATE,
                "Stale risk state: "
                + "; ".join(
                    f"{item.source}: {item.reason}"
                    for item in report.sources
                    if not item.fresh
                ),
                kind=RiskEventKind.STALE_RISK_STATE,
            )
        watch.mark("freshness")

        # -- 7a. kill switch scan (blocking record; decision deferred to 7b) -----------
        blocking = self._kill_switches.blocking_for(
            exchange=intent.exchange.value,
            account_id=intent.account_id,
            strategy_id=intent.strategy_id,
            symbol=intent.symbol,
        )
        watch.mark("kill_switch")

        # -- 8. projection: position and exposures after reservations + candidate -------
        market = state.market_for(intent.exchange.value, intent.symbol)
        valuation_price: Decimal | None = None
        if market is not None:
            valuation_price = market.mid_price
            if valuation_price is None:
                valuation_price = market.last_trade_price
        if valuation_price is None:
            for reference in context.references:
                if (
                    reference.exchange == intent.exchange.value
                    and reference.symbol == intent.symbol
                ):
                    valuation_price = reference.price
                    break
        try:
            breakdown = build_breakdown(context)
        except NotImplementedError as exc:
            return refuse(
                RiskDecisionCode.RISK_STATE_UNAVAILABLE,
                f"Exposure valuation unavailable: {exc}",
                state_corruption=True,
            )

        new_delta = intent.quantity * Decimal(intent.side.sign)
        current_signed = state.net_position(intent.exchange.value, intent.symbol)
        symbol_orders = orders_for(
            context.open_orders, intent.exchange.value, intent.symbol
        )
        projected_after_orders = project_position(current_signed, symbol_orders)
        projected_signed = project_position(
            current_signed,
            symbol_orders,
            new_delta=new_delta,
            new_is_reduce_only=intent.reduce_only,
        )
        is_increasing = classify_risk_direction(
            reduce_only=intent.reduce_only,
            current_signed=projected_after_orders,
            projected_signed=projected_signed,
        )
        add_notional = (
            intent.quantity * valuation_price
            if valuation_price is not None
            else _ZERO
        )
        # Signed change in absolute gross exposure at this symbol, measured
        # from the post-reservation position. Increasing adds, reducing
        # subtracts; the gross buckets carry the signed figure so an account
        # over cap can always trade its way back.
        exposure_delta = (
            (abs(projected_signed) - abs(projected_after_orders)) * valuation_price
            if valuation_price is not None
            else None
        )
        symbol_gross_now = _symbol_gross(breakdown, intent.symbol)
        exchange_gross_now = _exchange_gross(breakdown, intent.exchange.value)
        strategy_bucket = breakdown.bucket(
            ExposureDimension.STRATEGY, intent.strategy_id or ""
        )
        valuation_known = valuation_price is not None
        assert exposure_delta is not None or not valuation_known
        projection = ProjectionResult(
            current_signed=current_signed,
            projected_signed=projected_signed,
            new_delta=new_delta,
            is_risk_increasing=is_increasing,
            valuation_price=valuation_price,
            symbol_gross_after=(
                max(symbol_gross_now + (exposure_delta or _ZERO), _ZERO)
                if valuation_known
                else None
            ),
            account_gross_after=(
                max(
                    breakdown.account_gross_notional + (exposure_delta or _ZERO),
                    _ZERO,
                )
                if valuation_known
                else None
            ),
            exchange_gross_after=(
                max(exchange_gross_now + (exposure_delta or _ZERO), _ZERO)
                if valuation_known
                else None
            ),
            strategy_exposure_after=(
                (
                    strategy_bucket.gross_notional
                    if strategy_bucket is not None
                    else _ZERO
                )
                + (
                    add_notional
                    if is_increasing and intent.strategy_id is not None
                    else _ZERO
                )
                if valuation_known
                else None
            ),
            exposure_delta=exposure_delta,
            after_reservations_abs=abs(projected_after_orders),
            symbol_gross_current=symbol_gross_now,
            account_gross_current=breakdown.account_gross_notional,
            exchange_gross_current=exchange_gross_now,
            strategy_exposure_current=(
                strategy_bucket.gross_notional
                if strategy_bucket is not None
                else _ZERO
            ),
        )
        watch.mark("exposure")

        # -- 7b. switch verdict, now that risk direction is *computed* -------------------
        if blocking is not None:
            policy = config.protection_policy
            record = blocking.record
            under_protection = record.status in (
                RiskSwitchStatus.TRIGGERED,
                RiskSwitchStatus.ACKNOWLEDGED,
            )
            admits_reduction = (
                under_protection
                and policy.allow_risk_reducing_orders
                and not is_increasing
            )
            if not admits_reduction:
                origin = (
                    f"triggered by {record.triggered_by_rule.value}"
                    if record.triggered_by_rule is not None
                    and record.status is not RiskSwitchStatus.ACTIVE
                    else "manual"
                )
                decision = build(
                    approved=False,
                    code=RiskDecisionCode.KILL_SWITCH_ENGAGED,
                    violations=(
                        RiskViolation(
                            code=RiskDecisionCode.KILL_SWITCH_ENGAGED,
                            message=(
                                f"{blocking.scope.value} kill switch ({origin}) "
                                "is engaged"
                                f"{f': {record.reason}' if record.reason else ''}."
                            ),
                        ),
                    ),
                    kill_switch_scope=blocking.scope,
                )
                events.append(
                    self._event(
                        kind=RiskEventKind.KILL_SWITCH_ENGAGED,
                        severity=RiskEventSeverity.CRITICAL,
                        state=state,
                        intent=intent,
                        rule=None,
                        message=f"Order refused by {blocking.scope.value} kill switch.",
                        observed=None,
                        threshold=None,
                        now=now,
                        decision_id=decision_id,
                        request_id=request_id,
                    )
                )
                self._emit(events)
                return GateOutcome(
                    decision=decision,
                    outcomes=(),
                    events=tuple(events),
                    proposed_protections=(),
                    reservation=None,
                    latency=decision.latency
                    if decision.latency is not None
                    else watch.breakdown(),
                    exposure=breakdown,
                    snapshot_version=state.version,
                )
            events.append(
                self._event(
                    kind=RiskEventKind.PROTECTION_EXEMPTED,
                    severity=RiskEventSeverity.INFO,
                    state=state,
                    intent=intent,
                    rule=record.triggered_by_rule,
                    message=(
                        "Risk-reducing order admitted under a triggered "
                        f"protection at {blocking.scope.value} scope "
                        "(policy allowRiskReducingOrders); the exemption is "
                        "recorded here so the trail shows the policy "
                        "opening, never a rule failing to fire."
                    ),
                    observed=None,
                    threshold=None,
                    now=now,
                    decision_id=decision_id,
                    request_id=request_id,
                )
            )

        # -- 5b. balance sufficiency (needs the valuation price, precedes rules) ---------
        if is_increasing and valuation_known:
            balance_verdict = self._check_balance(
                intent=intent, account=account, add_notional=add_notional
            )
            if balance_verdict is not None:
                code, detail = balance_verdict
                return refuse(
                    code, detail, kind=RiskEventKind.LIMIT_BREACHED
                )

        # -- 9. rule catalog ----------------------------------------------------------------
        resolved = config.resolve_all(
            ScopeContext(
                exchange=intent.exchange.value,
                account_id=intent.account_id,
                strategy_id=intent.strategy_id,
                symbol=intent.symbol,
                now_micros=now,
            )
        )
        rule_inputs = RuleInputs(
            intent=intent,
            now_micros=now,
            snapshot=state,
            config=config,
            resolved=resolved,
            projection=projection,
            market=market,
            strategy=state.strategy_for(intent.strategy_id),
            rates=RateWindowCounters.from_state(state.rate),
            book_top=book_top,
            requested_leverage=requested_leverage,
        )

        def rule_failure(rule: RiskRuleId, exc: Exception) -> RuleOutcome:
            return RuleOutcome(
                rule_id=rule,
                status=RuleStatus.UNVERIFIABLE,
                detail=f"evaluator raised {type(exc).__name__}: {exc}",
            )

        outcomes = evaluate_rules(rule_inputs, on_error=rule_failure)
        watch.mark("rules")
        blocking_outcomes = tuple(
            outcome
            for outcome in outcomes
            if outcome.status in (RuleStatus.BREACH, RuleStatus.UNVERIFIABLE)
        )

        proposed: list[ProtectionOccurrence] = []
        violations: list[RiskViolation] = []
        for outcome in blocking_outcomes:
            is_breach = outcome.status is RuleStatus.BREACH
            severity = (
                RiskEventSeverity.CRITICAL
                if is_breach
                else RiskEventSeverity.EMERGENCY
            )
            violations.append(
                RiskViolation(
                    code=RULE_TO_DECISION_CODE[outcome.rule_id],
                    message=f"{outcome.rule_id.value}: {outcome.detail}",
                    rule=outcome.rule_id,
                    limit=None if outcome.limit is None else str(outcome.limit),
                    observed=None if outcome.observed is None else str(outcome.observed),
                )
            )
            events.append(
                self._event(
                    kind=(
                        RiskEventKind.LIMIT_BREACHED
                        if is_breach
                        else RiskEventKind.RISK_STATE_UNAVAILABLE
                    ),
                    severity=severity,
                    state=state,
                    intent=intent,
                    rule=outcome.rule_id,
                    message=outcome.detail,
                    observed=None if outcome.observed is None else str(outcome.observed),
                    threshold=None if outcome.limit is None else str(outcome.limit),
                    now=now,
                    decision_id=decision_id,
                    request_id=request_id,
                )
            )
            if is_breach:
                action = _action_for(config.protection_policy, outcome.rule_id)
                if action is not None:
                    proposed.append(
                        ProtectionOccurrence(
                            rule_id=outcome.rule_id,
                            action=action,
                            account_id=intent.account_id,
                            strategy_id=intent.strategy_id,
                            symbol=intent.symbol,
                            exchange=intent.exchange.value,
                            reason=(
                                f"{outcome.rule_id.value} breached at "
                                f"{outcome.observed} against {outcome.limit}."
                            ),
                            severity=severity,
                            occurred_at_micros=now,
                        )
                    )
        if blocking_outcomes:
            decision = build(
                approved=False,
                code=violations[0].code,
                violations=tuple(violations),
            )
            self._emit(events)
            return GateOutcome(
                decision=decision,
                outcomes=outcomes,
                events=tuple(events),
                proposed_protections=tuple(proposed),
                reservation=None,
                latency=decision.latency
                if decision.latency is not None
                else watch.breakdown(),
                exposure=breakdown,
                snapshot_version=state.version,
            )

        # -- 10. distributed consumption ------------------------------------------------------
        rate_reservation: RateReservation | None = None
        if is_increasing and self._rates is not None:
            second_limit, minute_limit = self._order_rate_ceilings(
                resolved
            )
            try:
                rate_reservation = self._rates.try_consume(
                    intent.tenant_id,
                    intent.account_id,
                    RiskRateKind.ORDERS,
                    now,
                    max_per_second=second_limit,
                    max_per_minute=minute_limit,
                )
            except Exception as exc:  # fail closed: an unreachable window is no window
                return refuse(
                    RiskDecisionCode.RISK_STATE_UNAVAILABLE,
                    f"Rate coordinator raised {type(exc).__name__}; the "
                    "shared windows could not be consulted, and an "
                    "uncoordinated approval is exactly what they exist to "
                    "prevent.",
                    state_corruption=True,
                )
            if not rate_reservation.granted:
                return self._reject_rate(
                    rate_reservation=rate_reservation,
                    events=events,
                    state=state,
                    intent=intent,
                    decision_id=decision_id,
                    request_id=request_id,
                    trading_mode=trading_mode,
                    now=now,
                    watch=watch,
                    snapshot_latency_micros=snapshot_latency_micros,
                )

        reservation: ReservationTicket | None = None
        if is_increasing and self._reservations is not None:
            try:
                reservation_request = self._build_reservation(
                    intent=intent,
                    config=config,
                    breakdown=breakdown,
                    add_notional=add_notional,
                    exposure_delta=exposure_delta,
                    is_increasing=is_increasing,
                    now=now,
                )
                reservation_result: ReservationResult = (
                    self._reservations.try_reserve(reservation_request)
                )
            except Exception as exc:
                if rate_reservation is not None:
                    self._rates_rollback(rate_reservation)
                return refuse(
                    RiskDecisionCode.RISK_STATE_UNAVAILABLE,
                    f"Reservation ledger raised {type(exc).__name__}; budget "
                    "state unknown, order denied.",
                    state_corruption=True,
                )
            if not reservation_result.granted:
                if rate_reservation is not None:
                    self._rates_rollback(rate_reservation)
                code = (
                    RiskDecisionCode.RISK_STATE_UNAVAILABLE
                    if reservation_result.reason.startswith("ledger-error")
                    else RiskDecisionCode.MAX_ACCOUNT_EXPOSURE_EXCEEDED
                )
                return self._refuse_reservation(
                    code=code,
                    result=reservation_result,
                    events=events,
                    state=state,
                    intent=intent,
                    decision_id=decision_id,
                    request_id=request_id,
                    trading_mode=trading_mode,
                    now=now,
                    watch=watch,
                    snapshot_latency_micros=snapshot_latency_micros,
                )
            reservation = reservation_result.ticket

        # -- 11. approval ---------------------------------------------------------------------
        decision = build(
            approved=True,
            code=RiskDecisionCode.APPROVED,
            violations=(),
        )
        self._emit(events)
        return GateOutcome(
            decision=decision,
            outcomes=outcomes,
            events=tuple(events),
            proposed_protections=(),
            reservation=reservation,
            rate_reservation=rate_reservation,
            latency=decision.latency
            if decision.latency is not None
            else watch.breakdown(),
            exposure=breakdown,
            snapshot_version=state.version,
        )

    # -- stage helpers -----------------------------------------------------------------------
    def _rates_rollback(self, reservation: RateReservation) -> None:
        if self._rates is not None:
            self._rates.rollback(reservation)

    def _run_core(
        self,
        intent: OrderIntent,
        *,
        state: RiskStateSnapshot | None,
        trading_mode: TradingMode,
        legacy_kill_switches: KillSwitchState | None,
        book_top: BookTop | None,
        now: int,
        config: RiskConfiguration,
    ) -> tuple[RiskDecision | None, str]:
        """Call the Part 2/5 engine on a bridge snapshot built from ``state``.

        Returns ``(decision, gap)``. A ``None`` decision means the bridge
        could not honestly construct the core's input; the caller refuses.
        There is no path where a failed bridge skips the core checks, because
        the checks *are* the approval - an approval without them would be
        the bypass this whole layer exists to make impossible.
        """
        if state is None:
            return None, "no snapshot was provided"
        core_snapshot, shortfalls = state.to_core_snapshot(intent, now_micros=now)
        if shortfalls:
            return None, "; ".join(shortfalls)
        limits = _core_limits(config, intent, now)
        decision = self._core.evaluate(
            intent,
            snapshot=core_snapshot,
            kill_switches=legacy_kill_switches or KillSwitchState(),
            trading_mode=trading_mode,
            account_limits=limits,
            strategy_limits=None,
            book_top=book_top,
        )
        return decision, ""

    def _freshness_report(self, state: RiskStateSnapshot, now: int) -> FreshnessReport:
        budget = self._freshness
        entries: list[SourceFreshness] = []

        def check(name: str, base_source: str, timestamp: int | None) -> None:
            limit = budget.budget_for(base_source)
            fresh, age, reason = is_fresh(
                timestamp,
                now_micros=now,
                budget_micros=limit,
                max_future_skew_micros=budget.max_future_skew_micros,
            )
            entries.append(SourceFreshness(name, age, limit, fresh, reason))

        check("snapshot", "snapshot", state.created_at_micros)
        check(
            "account",
            "account",
            None if state.account is None else state.account.source_timestamp_micros,
        )
        check("open_orders", "open_orders", _oldest_order_timestamp(state))
        for position in state.positions:
            check(
                f"positions:{position.symbol}",
                "positions",
                position.source_timestamp_micros,
            )
        for strategy in state.strategies:
            check(
                f"strategy_pnl:{strategy.strategy_id}",
                "strategy_pnl",
                strategy.source_timestamp_micros,
            )
        return FreshnessReport(evaluated_at_micros=now, sources=tuple(entries))

    def _check_balance(
        self,
        *,
        intent: OrderIntent,
        account: RiskAccountState,
        add_notional: Decimal,
    ) -> tuple[RiskDecisionCode, str] | None:
        """Spot buying against the account layer's own ``available`` figure.

        The gate never maintains a shadow ledger; it compares what the
        account source said against what this order would spend. SELLs
        convert base into quote and are governed by the position and
        exposure rules; an *unavailable* "available" on a buy is a refusal
        (unverifiable is unsafe), not a pass.
        """
        if intent.side is not OrderSide.BUY:
            return None
        if account.available is None:
            return (
                RiskDecisionCode.INVALID_ACCOUNT_STATE,
                "The account layer reports no available balance; an "
                "unverifiable balance cannot authorise a buy.",
            )
        if account.available < add_notional:
            return (
                RiskDecisionCode.INSUFFICIENT_BALANCE,
                f"Insufficient available balance: {account.available} < "
                f"required notional {add_notional}.",
            )
        return None

    def _order_rate_ceilings(
        self, resolved: Mapping[RiskRuleId, ResolvedLimit]
    ) -> tuple[int, int]:
        limit = resolved.get(RiskRuleId.MAX_ORDER_RATE)
        return (
            _rate_ceiling(limit, RATE_WINDOW_ONE_SECOND_MICROS),
            _rate_ceiling(limit, RATE_WINDOW_ONE_MINUTE_MICROS),
        )

    def _cancel_rate_ceilings(
        self, tenant_id: str, account_id: str, now: int
    ) -> tuple[int, int]:
        config = self._config
        if config is None:
            return (0, 0)
        scope = ScopeContext(
            exchange=None,
            account_id=account_id,
            strategy_id=None,
            symbol=None,
            now_micros=now,
        )
        limit = config.resolve(RiskRuleId.MAX_CANCEL_RATE, scope)
        _ = tenant_id  # account ids are tenant-unique in this platform; kept for the Redis key
        return (
            _rate_ceiling(limit, RATE_WINDOW_ONE_SECOND_MICROS),
            _rate_ceiling(limit, RATE_WINDOW_ONE_MINUTE_MICROS),
        )

    def _build_reservation(
        self,
        *,
        intent: OrderIntent,
        config: RiskConfiguration,
        breakdown: ExposureBreakdown,
        add_notional: Decimal,
        exposure_delta: Decimal | None,
        is_increasing: bool,
        now: int,
    ) -> ReservationRequest:
        scope = ScopeContext(
            exchange=intent.exchange.value,
            account_id=intent.account_id,
            strategy_id=intent.strategy_id,
            symbol=intent.symbol,
            now_micros=now,
        )
        additions: dict[str, Decimal] = {}
        ceilings: dict[str, Decimal] = {}
        plan: tuple[tuple[str, RiskRuleId], ...] = (
            (f"symbol:{intent.symbol}", RiskRuleId.MAX_SYMBOL_EXPOSURE),
            ("account", RiskRuleId.MAX_ACCOUNT_EXPOSURE),
            (f"exchange:{intent.exchange.value}", RiskRuleId.MAX_EXCHANGE_EXPOSURE),
        )
        for bucket, rule in plan:
            limit = config.resolve(rule, scope)
            if limit is not None:
                ceilings[bucket] = limit.value
        if is_increasing:
            # The ledger bounds *increases*; the signed reduction a
            # risk-reducing order makes is not its business (the next
            # snapshot folds it back in through real exposure).
            increase = max(exposure_delta or add_notional, _ZERO)
            for bucket, _rule in plan:
                additions[bucket] = increase
            if intent.strategy_id is not None:
                strategy_bucket = f"strategy:{intent.strategy_id}"
                additions[strategy_bucket] = add_notional
                strategy_limit = config.resolve(
                    RiskRuleId.MAX_STRATEGY_EXPOSURE, scope
                )
                if strategy_limit is not None:
                    ceilings[strategy_bucket] = strategy_limit.value
        for group in config.group_registry.groups_for(
            intent.exchange.value, intent.symbol
        ):
            if group.max_notional is None:
                continue
            bucket = f"group:{group.name}"
            ceilings[bucket] = group.max_notional
            if is_increasing:
                additions[bucket] = max(exposure_delta or add_notional, _ZERO)
        open_limit = config.resolve(RiskRuleId.MAX_OPEN_ORDERS, scope)
        return ReservationRequest(
            tenant_id=intent.tenant_id,
            account_id=intent.account_id,
            add_notional=additions,
            # Every order - reducing included - occupies a venue order
            # slot; the ledger short-circuits risk-reducing requests before
            # consuming, so the field only matters when something was added.
            add_open_orders=1,
            ceilings_notional=ceilings,
            open_orders_ceiling=None if open_limit is None else int(open_limit.value),
            request_id="",
            risk_reducing=not is_increasing,
        )

    # -- shared constructors -------------------------------------------------------------
    def _decision(
        self,
        decision_id: str,
        intent: OrderIntent,
        *,
        approved: bool,
        code: RiskDecisionCode,
        violations: tuple[RiskViolation, ...],
        trading_mode: TradingMode,
        state: RiskStateSnapshot | None,
        request_id: str,
        now: int,
        watch: LatencyStopwatch,
        kill_switch_scope: KillSwitchScope | None = None,
        snapshot_latency_micros: int | None = None,
    ) -> RiskDecision:
        latency = watch.breakdown()
        if snapshot_latency_micros is not None:
            latency = replace(
                latency,
                snapshot_retrieval_micros=max(snapshot_latency_micros, 0),
            )
        return RiskDecision(
            decision_id=decision_id,
            approved=approved,
            code=code,
            violations=violations,
            trading_mode=trading_mode,
            would_route=approved,
            evaluated_at=now,
            kill_switch_scope=kill_switch_scope,
            request_id=request_id,
            tenant_id=intent.tenant_id,
            account_id=intent.account_id,
            strategy_id=intent.strategy_id,
            exchange=intent.exchange,
            symbol=intent.symbol,
            snapshot_version=None if state is None else state.version,
            snapshot_created_at=None if state is None else state.created_at_micros,
            latency=latency,
        )

    def _event(
        self,
        *,
        kind: RiskEventKind,
        severity: RiskEventSeverity,
        state: RiskStateSnapshot | None,
        intent: OrderIntent | None,
        rule: RiskRuleId | None,
        message: str,
        observed: str | None,
        threshold: str | None,
        now: int,
        decision_id: str | None = None,
        request_id: str | None = None,
        action: ProtectionAction | None = None,
        switch_scope: KillSwitchScope | None = None,
        switch_target: str | None = None,
    ) -> RiskEvent:
        return RiskEvent(
            event_id=str(uuid.uuid4()),
            occurred_at_micros=now,
            severity=severity,
            kind=kind,
            tenant_id=None if state is None else state.tenant_id,
            account_id=None if state is None else state.account_id,
            strategy_id=None if intent is None else intent.strategy_id,
            symbol=None if intent is None else intent.symbol,
            exchange=None if intent is None else intent.exchange,
            rule_id=rule,
            limit_scope=_limit_scope_for(rule, intent),
            limit_target=None if intent is None else intent.symbol,
            observed=observed,
            threshold=threshold,
            action=action,
            source="risk-gate",
            snapshot_version=None if state is None else state.version,
            message=message,
            is_simulated=self._simulated or (state is not None and state.is_simulated),
            switch_scope=switch_scope,
            switch_target=switch_target,
            decision_id=decision_id,
            request_id=request_id,
            correlation_id=None,
        )

    def _emit(self, events: list[RiskEvent]) -> None:
        for event in events:
            self._events.emit(event)

    # -- specialised rejections (methods so the flow above reads as stages) ----------------
    def _reject_rate(
        self,
        *,
        rate_reservation: RateReservation,
        events: list[RiskEvent],
        state: RiskStateSnapshot,
        intent: OrderIntent,
        decision_id: str,
        request_id: str,
        trading_mode: TradingMode,
        now: int,
        watch: LatencyStopwatch,
        snapshot_latency_micros: int | None,
    ) -> GateOutcome:
        code = (
            RiskDecisionCode.ORDER_RATE_EXCEEDED
            if rate_reservation.kind == RiskRateKind.ORDERS
            else RiskDecisionCode.CANCEL_RATE_EXCEEDED
        )
        violation = RiskViolation(
            code=code,
            message=(
                "Rate window saturated at atomic consumption "
                f"({rate_reservation.second_count}/s, "
                f"{rate_reservation.minute_count}/m already used for "
                f"{rate_reservation.kind} activity); the shared windows - "
                "not just this process's view - have no room."
            ),
            rule=RiskRuleId.MAX_ORDER_RATE
            if rate_reservation.kind == RiskRateKind.ORDERS
            else RiskRuleId.MAX_CANCEL_RATE,
            observed=str(rate_reservation.minute_count),
        )
        decision = self._decision(
            decision_id,
            intent,
            approved=False,
            code=code,
            violations=(violation,),
            trading_mode=trading_mode,
            state=state,
            request_id=request_id,
            now=now,
            watch=watch,
            snapshot_latency_micros=snapshot_latency_micros,
        )
        events.append(
            self._event(
                kind=(
                    RiskEventKind.ORDER_RATE_BREACHED
                    if rate_reservation.kind == RiskRateKind.ORDERS
                    else RiskEventKind.CANCEL_RATE_BREACHED
                ),
                severity=RiskEventSeverity.CRITICAL,
                state=state,
                intent=intent,
                rule=violation.rule,
                message=violation.message,
                observed=violation.observed,
                threshold=None,
                now=now,
                decision_id=decision_id,
                request_id=request_id,
            )
        )
        self._emit(events)
        return GateOutcome(
            decision=decision,
            outcomes=(),
            events=tuple(events),
            proposed_protections=(),
            reservation=None,
            latency=decision.latency
            if decision.latency is not None
            else watch.breakdown(),
            exposure=None,
            snapshot_version=state.version,
        )

    def _refuse_reservation(
        self,
        *,
        code: RiskDecisionCode,
        result: ReservationResult,
        events: list[RiskEvent],
        state: RiskStateSnapshot,
        intent: OrderIntent,
        decision_id: str,
        request_id: str,
        trading_mode: TradingMode,
        now: int,
        watch: LatencyStopwatch,
        snapshot_latency_micros: int | None,
    ) -> GateOutcome:
        violation = RiskViolation(
            code=code,
            message=(
                f"Reservation ledger refused bucket "
                f"{result.denied_bucket!r}: {result.reason}"
            ),
            observed=result.denied_bucket,
        )
        decision = self._decision(
            decision_id,
            intent,
            approved=False,
            code=code,
            violations=(violation,),
            trading_mode=trading_mode,
            state=state,
            request_id=request_id,
            now=now,
            watch=watch,
            snapshot_latency_micros=snapshot_latency_micros,
        )
        ledger_error = result.reason.startswith("ledger-error")
        events.append(
            self._event(
                kind=(
                    RiskEventKind.RISK_STATE_UNAVAILABLE
                    if ledger_error
                    else RiskEventKind.LIMIT_BREACHED
                ),
                severity=(
                    RiskEventSeverity.EMERGENCY
                    if ledger_error
                    else RiskEventSeverity.CRITICAL
                ),
                state=state,
                intent=intent,
                rule=None,
                message=violation.message,
                observed=None,
                threshold=None,
                now=now,
                decision_id=decision_id,
                request_id=request_id,
            )
        )
        self._emit(events)
        return GateOutcome(
            decision=decision,
            outcomes=(),
            events=tuple(events),
            proposed_protections=(),
            reservation=None,
            latency=decision.latency
            if decision.latency is not None
            else watch.breakdown(),
            exposure=None,
            snapshot_version=state.version,
        )


# ---------------------------------------------------------------------------
# Module-level pure helpers
# ---------------------------------------------------------------------------


def _symbol_gross(breakdown: ExposureBreakdown, symbol: str) -> Decimal:
    bucket = breakdown.bucket(ExposureDimension.SYMBOL, symbol)
    return _ZERO if bucket is None else bucket.gross_notional


def _exchange_gross(breakdown: ExposureBreakdown, exchange: str) -> Decimal:
    bucket = breakdown.bucket(ExposureDimension.EXCHANGE, exchange)
    return _ZERO if bucket is None else bucket.gross_notional


def _oldest_order_timestamp(state: RiskStateSnapshot) -> int | None:
    """The oldest source timestamp among open orders; ``None`` when any lacks one.

    Empty open-order set reports the snapshot's own creation time (a real
    "nothing open, measured now"), while *any* order missing its timestamp
    makes the whole source unverifiable. "The freshest order is fine" must
    not paper over one order the OMS never dated: min(), then None on any
    gap, in that order, is the whole rule.
    """
    if not state.open_orders:
        return state.created_at_micros
    stamps = [order.source_timestamp_micros for order in state.open_orders]
    if any(stamp is None for stamp in stamps):
        return None
    concrete = [stamp for stamp in stamps if stamp is not None]
    return min(concrete)


def _rate_ceiling(limit: ResolvedLimit | None, window_micros: int) -> int:
    """Ceiling for one window; an absent or mismatched window rule = deny (0).

    Deny-by-default is not over-caution here: the atomic consume is the
    *distributed* enforcement of the ceiling the snapshot showed; if a rate
    rule vanished from configuration mid-flight while a worker still wires
    the coordinator, "unlimited" would silently become policy for exactly the
    window in which configuration is incoherent - which is the moment a
    runaway strategy is best at trading.
    """
    if limit is None or limit.window_micros != window_micros:
        return 0
    return int(limit.value)


def _core_limits(
    config: RiskConfiguration, intent: OrderIntent, now_micros: int
) -> RiskLimits:
    """Translate the hierarchy-resolved document into the core's layering.

    The core combines platform/account/strategy layers by taking the
    *tightest*; feeding it the resolved (already tightest-of-all) values as
    its account layer makes core and catalog agree on every field they share,
    while fields the core never learned (drawdown, cancel rate, fees, ...)
    remain the catalog's alone. The mapping is explicit per field, no dict
    splat, because silent field-matching is how a renamed limit stops being
    enforced without a single test noticing.
    """
    scope = ScopeContext(
        exchange=intent.exchange.value,
        account_id=intent.account_id,
        strategy_id=intent.strategy_id,
        symbol=intent.symbol,
        now_micros=now_micros,
    )

    def value(rule: RiskRuleId) -> Decimal | None:
        resolved = config.resolve(rule, scope)
        return None if resolved is None else resolved.value

    open_orders = value(RiskRuleId.MAX_OPEN_ORDERS)
    stale_age = value(RiskRuleId.MAX_STALE_DATA_AGE)
    deviation_bps = value(RiskRuleId.MAX_PRICE_DEVIATION)
    return RiskLimits(
        max_order_quantity=value(RiskRuleId.MAX_ORDER_QUANTITY),
        max_order_notional=value(RiskRuleId.MAX_ORDER_NOTIONAL),
        max_position_quantity=value(RiskRuleId.MAX_POSITION_QUANTITY),
        max_symbol_exposure_notional=value(RiskRuleId.MAX_SYMBOL_EXPOSURE),
        max_account_exposure_notional=value(RiskRuleId.MAX_ACCOUNT_EXPOSURE),
        max_open_orders=None if open_orders is None else int(open_orders),
        max_orders_per_minute=_rate_value_int(
            config, scope, RATE_WINDOW_ONE_MINUTE_MICROS
        ),
        max_daily_loss=value(RiskRuleId.MAX_DAILY_LOSS),
        max_strategy_loss=value(RiskRuleId.MAX_STRATEGY_DAILY_LOSS),
        max_price_deviation_percent=None
        if deviation_bps is None
        else deviation_bps / Decimal(100),
        max_market_data_age_micros=None if stale_age is None else int(stale_age),
    )


def _rate_value_int(
    config: RiskConfiguration, scope: ScopeContext, window_micros: int
) -> int | None:
    resolved = config.resolve(RiskRuleId.MAX_ORDER_RATE, scope)
    if resolved is None or resolved.window_micros != window_micros:
        return None
    return int(resolved.value)


def _action_for(
    policy: AutomaticProtectionPolicy, rule: RiskRuleId
) -> ProtectionAction | None:
    match rule:
        case RiskRuleId.MAX_DAILY_LOSS:
            return policy.daily_loss_action
        case RiskRuleId.MAX_STRATEGY_DAILY_LOSS:
            return policy.strategy_daily_loss_action
        case RiskRuleId.MAX_DRAWDOWN:
            return policy.drawdown_action
        case RiskRuleId.MAX_CONSECUTIVE_LOSSES:
            return policy.consecutive_losses_action
        case RiskRuleId.MAX_ORDER_RATE:
            return policy.order_rate_action
        case RiskRuleId.MAX_CANCEL_RATE:
            return policy.cancel_rate_action
    return None


def _limit_scope_for(rule: RiskRuleId | None, intent: OrderIntent | None) -> RiskLimitScope | None:
    """Which hierarchy level a breach *was configured at* for the event row.

    Symbol-shaped rules report SYMBOL scope, account/exchange-shaped report
    ACCOUNT, and rule-less events (state integrity) report None: the scope
    says "where the governing entry lived", which is exactly the field the
    admin uses to decide which edit to make, and it is only knowable when a
    rule was resolved at all.
    """
    if rule is None or intent is None:
        return None
    match rule:
        case (
            RiskRuleId.MAX_ORDER_QUANTITY
            | RiskRuleId.MAX_ORDER_NOTIONAL
            | RiskRuleId.MAX_POSITION_QUANTITY
            | RiskRuleId.MAX_POSITION_NOTIONAL
            | RiskRuleId.MAX_SYMBOL_EXPOSURE
            | RiskRuleId.MAX_STALE_DATA_AGE
            | RiskRuleId.MAX_PRICE_DEVIATION
        ):
            return RiskLimitScope.SYMBOL
        case (
            RiskRuleId.MAX_STRATEGY_EXPOSURE
            | RiskRuleId.MAX_STRATEGY_DAILY_LOSS
            | RiskRuleId.MAX_CONSECUTIVE_LOSSES
            | RiskRuleId.MAX_ACTIVE_STRATEGIES
        ):
            return RiskLimitScope.STRATEGY
        case RiskRuleId.MAX_CORRELATION_GROUP_EXPOSURE:
            return RiskLimitScope.GLOBAL
        case _:
            return RiskLimitScope.ACCOUNT


def _transition_for(occurrence: ProtectionOccurrence) -> SwitchTransition:
    """The ledger command that expresses an occurrence as a switch trigger."""
    return SwitchTransition(
        scope=occurrence.switch_scope,
        target=occurrence.switch_target,
        action="TRIGGER",
    )
