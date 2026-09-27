"""The execution engine.

This is the single path by which an intent becomes an order at a venue. It is
exchange-agnostic: it talks to :class:`~wlct_trading.adapters.base.TradingAdapter`
and has no idea whether the venue behind it is Binance, a simulator, or
something that has not been written yet.

The sequence, in full::

    intent
      -> deterministic clientOrderId          (idempotency key)
      -> pre-network validation               (10 checks)
      -> pre-submit safety gates              (11 gates, all required)
      -> risk engine                          (mandatory, fail-closed)
      -> execution lock                       (one worker per order)
      -> clientOrderId reservation            (cross-worker duplicate guard)
      -> durable Order record + SUBMITTED event
      -> [DRY RUN stops here]
      -> adapter.submit_order                 (signs and transmits)
      -> outcome
           accepted   -> ACKNOWLEDGED/FILLED, fills applied to positions
           rejected   -> REJECTED, terminal, no position change
           ambiguous  -> stays SUBMITTED, marked UNKNOWN, incident, reconcile

Four properties are non-negotiable and are enforced here rather than left to
callers:

**Risk is mandatory.** There is no parameter that skips it. When the risk engine
is unavailable the order is refused, not waved through.

**Ambiguity never resubmits.** An :class:`AdapterConnectionError` means the
request may have reached the venue. The engine records that it does not know,
and hands the order to reconciliation. It never retries, because a retry that
the venue deduplicates is harmless and a retry that it does not is a doubled
position.

**Fills are never invented.** Every fill the engine applies came from an adapter
that got it from a venue. There is no code path that constructs a fill from an
assumption, and simulated fills carry ``is_simulated=True`` all the way to the
database.

**Marking precedes acting.** The order is persisted, and the unknown marker is
written, *before* the network call. A process that dies mid-request leaves a
record behind; one that persists afterwards does not.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field, replace
from decimal import Decimal
from enum import Enum
from typing import Awaitable, Callable, Mapping

from wlct_trading.adapters.base import (
    AdapterConnectionError,
    AdapterError,
    AdapterRateLimitedError,
    AdapterRejectedError,
    SubmitResult,
    SymbolSpecification,
    TradingAdapter,
)
from wlct_trading.clock import epoch_micros, monotonic_nanos
from wlct_trading.enums import (
    ExchangeId,
    OrderStatus,
    TERMINAL_ORDER_STATUSES,
    TradingMode,
)
from wlct_trading.execution.config import ExecutionSettings
from wlct_trading.execution.credentials import ExchangeCredentials
from wlct_trading.execution.incidents import (
    ExecutionErrorCode,
    ExecutionIncident,
    IncidentRecorder,
    IncidentSeverity,
    IncidentType,
)
from wlct_trading.execution.locks import (
    LockManager,
    LockNotAcquired,
    account_lock_key,
    order_lock_key,
)
from wlct_trading.execution.placement_attestor import (
    PlacementReviewRequest,
    PlacementReviewer,
)
from wlct_trading.execution.placement_review import PlacementVerdict
from wlct_trading.execution.safety import (
    ComponentHealth,
    ExecutionPreconditions,
    SafetyDecision,
    SafetyGate,
    evaluate_safety_gates,
)
from wlct_trading.execution.store import (
    OrderStore,
    ReconciliationState,
)
from wlct_trading.execution.timesync import ClockSkewExceeded, ClockSyncError
from wlct_trading.execution.validation import OrderValidator, ValidationResult
from wlct_trading.idempotency import build_client_order_id
from wlct_trading.observability.tracing import SpanLike, SpanStatus, Tracer
from wlct_trading.orders import Fill, InvalidOrderTransition, Order, OrderEvent, OrderIntent
from wlct_trading.positions import PositionManager, PositionUpdate
from wlct_trading.risk import (
    GateOutcome,
    KillSwitchState,
    RiskDecision,
    RiskEngine,
    RiskGate,
    RiskSnapshot,
    RiskStateSnapshot,
)

__all__ = [
    "ExecutionOutcome",
    "ExecutionResult",
    "ExecutionContext",
    "ExecutionEngine",
    "EngineConfigurationError",
]

_LOG = logging.getLogger(__name__)


class EngineConfigurationError(RuntimeError):
    """The engine is wired in a way that is unsafe for the requested mode."""


class ExecutionOutcome(str, Enum):
    """What happened to a submission attempt."""

    #: The venue accepted the order.
    ACCEPTED = "ACCEPTED"
    #: Refused locally, before any network activity.
    REJECTED_LOCALLY = "REJECTED_LOCALLY"
    #: The venue positively refused it. The order does not exist there.
    REJECTED_BY_EXCHANGE = "REJECTED_BY_EXCHANGE"
    #: Already submitted under this idempotency key. Nothing was sent.
    DUPLICATE = "DUPLICATE"
    #: Built, validated, risk-checked and then deliberately not transmitted.
    DRY_RUN = "DRY_RUN"
    #: The request may or may not have reached the venue. Reconciliation owns it
    #: from here. **Never** retried.
    UNKNOWN = "UNKNOWN"

    @property
    def order_exists_at_venue(self) -> bool:
        """Whether an order may exist at the venue as a result of this attempt.

        ``UNKNOWN`` answers ``True`` because it might, and every caller must
        treat "might" as "does" until reconciliation says otherwise.
        """
        return self in (ExecutionOutcome.ACCEPTED, ExecutionOutcome.UNKNOWN)


@dataclass(frozen=True, slots=True)
class ExecutionResult:
    """The complete outcome of one submission attempt.

    Returned for every path including failure, rather than raising, because a
    rejected order is a normal business event that the caller must record — not
    an exception.
    """

    outcome: ExecutionOutcome
    client_order_id: str
    order: Order | None = None
    error_code: ExecutionErrorCode | None = None
    message: str = ""
    validation: ValidationResult | None = None
    safety: SafetyDecision | None = None
    risk: RiskDecision | None = None
    submit_result: SubmitResult | None = None
    fills: tuple[Fill, ...] = field(default_factory=tuple)
    position_updates: tuple[PositionUpdate, ...] = field(default_factory=tuple)
    incident: ExecutionIncident | None = None
    #: End-to-end wall time for the attempt, measured monotonically.
    latency_micros: int = 0
    #: True only when bytes actually left the process for a real venue.
    transmitted: bool = False
    is_simulated: bool = False

    @property
    def succeeded(self) -> bool:
        return self.outcome in (ExecutionOutcome.ACCEPTED, ExecutionOutcome.DRY_RUN)

    @property
    def requires_reconciliation(self) -> bool:
        return self.outcome is ExecutionOutcome.UNKNOWN

    def to_dict(self) -> dict[str, object]:
        """API-safe rendering.

        No credential material can reach this: the engine never holds a secret,
        only an :class:`ExchangeCredentials` it passes to the adapter, and
        nothing from it is copied here.
        """
        return {
            "outcome": self.outcome.value,
            "clientOrderId": self.client_order_id,
            "orderId": self.order.order_id if self.order else None,
            "exchangeOrderId": self.order.exchange_order_id if self.order else None,
            "status": self.order.status.value if self.order else None,
            "errorCode": self.error_code.value if self.error_code else None,
            "message": self.message,
            "transmitted": self.transmitted,
            "isSimulated": self.is_simulated,
            "requiresReconciliation": self.requires_reconciliation,
            "fillCount": len(self.fills),
            "latencyMicros": self.latency_micros,
            "incidentId": self.incident.incident_id if self.incident else None,
        }


@dataclass(slots=True)
class ExecutionContext:
    """Everything the engine needs that it cannot derive itself.

    Assembled fresh per submission by the caller (the strategy runner or the
    API) so that no gate reads a cached value. Every health field defaults to
    "unknown", which blocks — a caller that forgets to populate one cannot
    accidentally open a gate.
    """

    snapshot: RiskSnapshot
    kill_switches: KillSwitchState
    #: Part 8: the extended state the full risk gate reads (account health,
    # open-order reservations, day PnL, rate windows, config binding).
    # ``None`` with a wired gate is a fail-closed refusal, not a skip: the
    # engine asks the gate for a decision and the gate says it cannot make
    # one. Hosts that wire ``risk_gate`` must assemble this per submission.
    risk_state: RiskStateSnapshot | None = None
    specification: SymbolSpecification | None = None
    reference_price: Decimal | None = None
    risk_health: ComponentHealth = field(default_factory=ComponentHealth)
    market_data_health: ComponentHealth = field(default_factory=ComponentHealth)
    exchange_health: ComponentHealth = field(default_factory=ComponentHealth)
    credentials: ExchangeCredentials | None = None
    market_data_required: bool = True
    #: Overrides the engine default when a venue needs a longer lock (a slow
    #: cancel-replace, for example).
    lock_ttl_millis: int | None = None


class ExecutionEngine:
    """Turns validated intents into venue orders, safely.

    One instance per (exchange, mode) pair. It is safe to share across tenants:
    every method takes the tenant from the intent and every store and lock call
    is tenant-scoped, so there is no shared mutable state that could leak
    between them.
    """

    __slots__ = (
        "_adapter",
        "_settings",
        "_validator",
        "_risk_engine",
        "_risk_gate",
        "_store",
        "_locks",
        "_incidents",
        "_placement_reviewer",
        "_positions",
        "_publish",
        "_metrics",
        "_tracer",
        "_default_lock_ttl_millis",
    )

    def __init__(
        self,
        *,
        adapter: TradingAdapter,
        settings: ExecutionSettings,
        risk_engine: RiskEngine,
        risk_gate: RiskGate | None = None,
        store: OrderStore,
        locks: LockManager,
        incidents: IncidentRecorder,
        placement_reviewer: PlacementReviewer | None = None,
        validator: OrderValidator | None = None,
        positions: PositionManager | None = None,
        publish_event: Callable[[str, Mapping[str, object]], Awaitable[None]]
        | None = None,
        metrics: object | None = None,
        tracer: Tracer | None = None,
        default_lock_ttl_millis: int = 15_000,
    ) -> None:
        self._adapter = adapter
        self._settings = settings
        self._risk_engine = risk_engine
        self._risk_gate = risk_gate
        self._store = store
        self._locks = locks
        self._incidents = incidents
        self._placement_reviewer = placement_reviewer
        self._validator = validator or OrderValidator()
        self._positions = positions
        self._publish = publish_event
        self._metrics = metrics
        self._tracer = tracer
        self._default_lock_ttl_millis = default_lock_ttl_millis
        self._assert_wiring_is_safe()

    def _assert_wiring_is_safe(self) -> None:
        """Refuse combinations that are unsafe for the configured mode.

        Checked once at construction so a misconfigured deployment fails at
        startup rather than on its first order.
        """
        if self._settings.risk_gate_required and self._risk_gate is None:
            raise EngineConfigurationError(
                "RISK_ENGINE_ENABLED demands the Part 8 risk gate, but none "
                "is wired. This engine will not treat an unconfigured safety "
                "layer as a configured one: refusing to start. Wire "
                "RiskGate(...) or set RISK_ENGINE_ENABLED=false to opt into "
                "core-only evaluation."
            )
        if self._risk_gate is not None and self._settings.will_transmit_orders and self._risk_gate.is_simulated:
            raise EngineConfigurationError(
                "A live-transmitting engine was wired with the SIMULATED risk "
                "gate. Simulated gates read simulated state by construction; "
                "pairing one with a live venue would let paper risk verdicts "
                "authorise real orders. Refusing to start."
            )
        if not self._settings.will_transmit_orders:
            return
        if self._adapter.is_simulated:
            raise EngineConfigurationError(
                "Live trading is enabled but the wired adapter is a simulator. "
                "Refusing to start: a paper adapter presenting live results "
                "would make simulated fills indistinguishable from real ones."
            )
        if not self._locks.is_distributed:
            raise EngineConfigurationError(
                "Live trading is enabled with an in-process lock manager. "
                "Refusing to start: a second worker would be able to submit "
                "concurrently for the same order. Configure RedisLockManager."
            )
        if getattr(self._store, "is_durable", True) is False:
            raise EngineConfigurationError(
                "Live trading is enabled with a non-durable in-memory order "
                "store. Refusing to start: a restart would lose the record of "
                "live orders and positions."
            )
        if self._placement_reviewer is None:
            # Part 16. The review's verdict is a safety gate, and a gate nobody
            # runs is a gate that passes - so the requirement is enforced where
            # it can be enforced without inventing an order outcome: at
            # construction. There is no setting that removes it, because a
            # config key that lets a deployment trade without asking the venue
            # whether the key may trade is the same as no review at all.
            raise EngineConfigurationError(
                "Live trading is enabled with no placement reviewer. "
                "Refusing to start: nothing has established that this key may "
                "place this order on this symbol, which is the difference "
                "between a refusal and a surprise. Wire "
                "PlacementReviewer(venue_attestor, policy, "
                "requires_venue_attestation=True)."
            )

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------
    @property
    def exchange(self) -> ExchangeId:
        return self._adapter.exchange

    @property
    def is_simulated(self) -> bool:
        return self._adapter.is_simulated

    @property
    def settings(self) -> ExecutionSettings:
        return self._settings

    @property
    def metrics(self) -> object | None:
        """The metrics port this engine observes into, for a scrape to read.

        Read-only and never reset here: exposition is a reader, and a reader
        that can clear the counters it is reporting on is how a restart and a
        ``metrics.reset()`` become indistinguishable on a dashboard. ``None``
        means this engine was built without instrumentation - which the
        exposition layer renders as "no families", not as zeros, because zero
        orders and unmeasured orders are different facts.
        """
        return self._metrics

    # ------------------------------------------------------------------
    # Submission
    # ------------------------------------------------------------------
    async def submit(
        self, intent: OrderIntent, context: ExecutionContext
    ) -> ExecutionResult:
        """Run the full pipeline for one intent.

        Never raises for an expected failure. Validation problems, risk
        rejections, blocked gates and venue refusals all come back as an
        :class:`ExecutionResult` with an outcome and an error code.
        """
        started_nanos = monotonic_nanos()
        client_order_id = intent.client_order_id or build_client_order_id(intent)
        tracer = self._tracer
        span = (
            tracer.start_span(
                "execution.submit",
                attributes={
                    "trade.tenant_id": intent.tenant_id,
                    "trade.account_id": intent.account_id,
                    "trade.symbol": intent.symbol,
                    "trade.side": intent.side.value,
                    "trade.client_order_id": client_order_id,
                },
            )
            if tracer is not None
            else None
        )

        def finish(result: ExecutionResult) -> ExecutionResult:
            elapsed = (monotonic_nanos() - started_nanos) // 1_000
            # Every exit from submit() passes through here, which is what makes
            # ``total_submit`` exactly one sample per submission - including the
            # refusals, since "we said no in 40 micros" is a latency fact an
            # operator needs in the same histogram as "we said no in 4s".
            self._observe_stage("total_submit", started_nanos)
            if span is not None:
                span.set_attribute("outcome", result.outcome.value)
                span.set_attribute(
                    "execution.error_code",
                    "" if result.error_code is None
                    else result.error_code.value,
                )
                span.set_attribute(
                    "execution.risk_code",
                    "" if result.risk is None else result.risk.code.value,
                )
                span.set_attribute("execution.elapsed_micros", elapsed)
                span.set_status(SpanStatus.OK)
                span.end()
            return ExecutionResult(
                outcome=result.outcome,
                client_order_id=result.client_order_id,
                order=result.order,
                error_code=result.error_code,
                message=result.message,
                validation=result.validation,
                safety=result.safety,
                risk=result.risk,
                submit_result=result.submit_result,
                fills=result.fills,
                position_updates=result.position_updates,
                incident=result.incident,
                latency_micros=elapsed,
                transmitted=result.transmitted,
                is_simulated=result.is_simulated,
            )

        # --- 1. Pre-network validation --------------------------------
        validation_started = monotonic_nanos()
        validation = self._validator.validate(
            intent,
            specification=context.specification,
            reference_price=context.reference_price,
        )
        self._observe_stage("validation", validation_started)
        if not validation.valid:
            return finish(
                ExecutionResult(
                    outcome=ExecutionOutcome.REJECTED_LOCALLY,
                    client_order_id=client_order_id,
                    error_code=ExecutionErrorCode.VALIDATION_FAILED,
                    message=validation.summary,
                    validation=validation,
                )
            )

        # --- 2a. Placement review (Part 16) ----------------------------
        # Deliberately before the gates, and deliberately not a second rejection
        # path: the verdict arrives as one more gate input, so the existing
        # blocked-gate handling produces the incident, the audit event and the
        # typed result. A reviewer that cannot reach the venue returns a refusal
        # with a retryable finding, so an outage blocks one order rather than
        # raising out of the submission path.
        placement: PlacementVerdict | None = None
        if self._placement_reviewer is not None:
            review_started = monotonic_nanos()
            _, placement = await self._placement_reviewer.review(
                PlacementReviewRequest(
                    tenant_id=intent.tenant_id,
                    account_id=intent.account_id,
                    symbol=intent.symbol,
                    order_type=intent.order_type.value,
                    time_in_force=intent.time_in_force.value,
                )
            )
            self._record_placement_review(placement, review_started)
            if span is not None:
                # Attributes, not an event: ``SpanLike`` is the engine's own
                # minimal span protocol (set_attribute / end), and widening it
                # for one call site would mean every tracer in the platform
                # grows a method to satisfy a single line here.
                span.set_attribute(
                    "placement.allowed", "true" if placement.allowed else "false"
                )
                span.set_attribute("placement.verdict_id", placement.verdict_id)
                span.set_attribute("placement.codes", ",".join(placement.codes))
                span.set_attribute(
                    "placement.venue_backed",
                    "true" if placement.venue_backed else "false",
                )

        # --- 2b. Safety gates ------------------------------------------
        preconditions = ExecutionPreconditions(
            exchange=self._adapter.exchange.value,
            symbol=intent.symbol,
            strategy_id=intent.strategy_id,
            kill_switches=context.kill_switches,
            settings=self._settings,
            risk_health=context.risk_health,
            market_data_health=context.market_data_health,
            exchange_health=context.exchange_health,
            credentials=context.credentials,
            market_data_required=context.market_data_required,
            is_simulated=self._adapter.is_simulated,
            placement=placement,
        )
        safety_started = monotonic_nanos()
        safety = evaluate_safety_gates(preconditions)
        self._observe_stage("safety_gates", safety_started)
        if not safety.allowed:
            incident = await self._maybe_record_gate_incident(intent, safety)
            return finish(
                ExecutionResult(
                    outcome=ExecutionOutcome.REJECTED_LOCALLY,
                    client_order_id=client_order_id,
                    error_code=_gate_error_code(safety.blocking_gate),
                    message=safety.reason,
                    validation=validation,
                    safety=safety,
                    incident=incident,
                )
            )

        # --- 3. Risk engine -------------------------------------------
        # Mandatory. Any exception from the risk engine is a rejection, not a
        # bypass: an engine that throws is an engine whose answer is unknown,
        # and unknown means no.
        risk_started = monotonic_nanos()
        try:
            risk = self._risk_engine.evaluate(
                intent,
                snapshot=context.snapshot,
                kill_switches=context.kill_switches,
                trading_mode=self._settings.trading_mode,
                book_top=None,
                symbol_tradeable=(
                    context.specification.is_tradeable
                    if context.specification is not None
                    else True
                ),
            )
        except Exception as exc:  # noqa: BLE001 - fail closed
            incident = await self._record_incident(
                tenant_id=intent.tenant_id,
                account_id=intent.account_id,
                incident_type=IncidentType.SAFETY_GATE_BLOCK,
                severity=IncidentSeverity.CRITICAL,
                summary=(
                    f"The risk engine raised {type(exc).__name__} while "
                    f"evaluating an order; the order was refused."
                ),
                symbol=intent.symbol,
                client_order_id=client_order_id,
                error_code=ExecutionErrorCode.RISK_UNAVAILABLE,
                details={"error": str(exc)},
            )
            return finish(
                ExecutionResult(
                    outcome=ExecutionOutcome.REJECTED_LOCALLY,
                    client_order_id=client_order_id,
                    error_code=ExecutionErrorCode.RISK_UNAVAILABLE,
                    message=(
                        "The risk engine could not evaluate this order, so it "
                        "was refused. Risk checks fail closed."
                    ),
                    validation=validation,
                    safety=safety,
                    incident=incident,
                )
            )

        # Reaching here means the risk engine ANSWERED: its exception path above
        # returns. That is the line between the two - the stage that answered is
        # the stage that can be timed, and the one that threw is counted instead
        # (see _observe_stage).
        self._observe_stage("risk", risk_started)

        if not risk.approved:
            return finish(
                ExecutionResult(
                    outcome=ExecutionOutcome.REJECTED_LOCALLY,
                    client_order_id=client_order_id,
                    error_code=_risk_error_code(risk),
                    message=(
                        f"Risk rejected the order ({risk.code.value}): "
                        + "; ".join(
                            violation.message for violation in risk.violations
                        )
                    ),
                    validation=validation,
                    safety=safety,
                    risk=risk,
                )
            )

        # --- 3b. Part 8 risk gate (when wired) -------------------------
        # The core engine above is always run and its refusal is final; the
        # gate can only tighten. Both consume distributed state (rate window,
        # budget reservation) at approval, and every path on which the order
        # demonstrably never reaches the venue hands those slots back.
        gate_outcome: GateOutcome | None = None
        if self._risk_gate is not None:
            try:
                gate_outcome = self._risk_gate.evaluate(
                    intent,
                    state=context.risk_state,
                    request_id=client_order_id,
                    trading_mode=self._settings.trading_mode,
                    legacy_kill_switches=context.kill_switches,
                )
            except Exception as exc:  # noqa: BLE001 - fail closed
                incident = await self._record_incident(
                    tenant_id=intent.tenant_id,
                    account_id=intent.account_id,
                    incident_type=IncidentType.SAFETY_GATE_BLOCK,
                    severity=IncidentSeverity.CRITICAL,
                    summary=(
                        f"The risk gate raised {type(exc).__name__} while "
                        "evaluating an order; the order was refused. Risk "
                        "checks fail closed."
                    ),
                    symbol=intent.symbol,
                    client_order_id=client_order_id,
                    error_code=ExecutionErrorCode.RISK_UNAVAILABLE,
                    details={"error": str(exc)},
                )
                return finish(
                    ExecutionResult(
                        outcome=ExecutionOutcome.REJECTED_LOCALLY,
                        client_order_id=client_order_id,
                        error_code=ExecutionErrorCode.RISK_UNAVAILABLE,
                        message=(
                            "The risk gate could not evaluate this order, so "
                            "it was refused."
                        ),
                        validation=validation,
                        safety=safety,
                        risk=risk,
                        incident=incident,
                    )
                )
            if not gate_outcome.decision.approved:
                await self._release_risk_slots(gate_outcome, None)
                return finish(
                    ExecutionResult(
                        outcome=ExecutionOutcome.REJECTED_LOCALLY,
                        client_order_id=client_order_id,
                        error_code=_risk_error_code(gate_outcome.decision),
                        message=(
                            f"Risk gate rejected the order "
                            f"({gate_outcome.decision.code.value}): "
                            + "; ".join(
                                violation.message
                                for violation in gate_outcome.decision.violations
                            )
                        ),
                        validation=validation,
                        safety=safety,
                        risk=gate_outcome.decision,
                    )
                )
            # Carry the enriched decision (request id, snapshot version,
            # latency, rule provenance) forward in the result.
            risk = gate_outcome.decision

        # --- 4. Lock, reserve, persist, submit ------------------------
        lock_ttl = context.lock_ttl_millis or self._default_lock_ttl_millis
        try:
            async with self._locks.hold(
                account_lock_key(intent.tenant_id, intent.account_id),
                ttl_millis=lock_ttl,
                wait_millis=lock_ttl // 3,
            ):
                result = finish(
                    await self._submit_under_lock(
                        intent,
                        context,
                        client_order_id=client_order_id,
                        validation=validation,
                        safety=safety,
                        risk=risk,
                        placement=placement,
                        trace_span=span,
                    )
                )
                await self._release_risk_slots(gate_outcome, result)
                return result
        except LockNotAcquired as exc:
            rejection = finish(
                ExecutionResult(
                    outcome=ExecutionOutcome.REJECTED_LOCALLY,
                    client_order_id=client_order_id,
                    error_code=ExecutionErrorCode.LOCK_UNAVAILABLE,
                    message=str(exc),
                    validation=validation,
                    safety=safety,
                    risk=risk,
                )
            )
            await self._release_risk_slots(gate_outcome, rejection)
            return rejection

    async def _release_risk_slots(
        self,
        gate_outcome: GateOutcome | None,
        result: ExecutionResult | None,
    ) -> None:
        """Hand back rate-window and budget-reservation slots.

        The rule is one line, and it is the same rule reconciliation uses: a
        reservation is kept exactly when an order may exist at the venue
        (``order_exists_at_venue`` covers ACCEPTED and UNKNOWN); in every
        other case - rejected locally, duplicate, dry run, venue refusal,
        lock timeout, or a gate rejection that consumed before refusing - the
        slot is released. UNKNOWN keeps its reservation on purpose: the order
        might exist, budget might be spent, and reconciliation plus the TTL
        are the two owners of that truth. Failures in the release are
        swallowed into a debug log: a stuck slot expires, while throwing from
        a cleanup path would corrupt the result the caller already earned.
        """
        if gate_outcome is None or self._risk_gate is None:
            return
        if result is not None and result.outcome.order_exists_at_venue:
            return
        tracer = self._tracer
        release_span = (
            tracer.start_span(
                "risk.reservation_release",
                attributes={
                    "trade.tenant_id": gate_outcome.decision.tenant_id,
                    "trade.request_id": gate_outcome.decision.request_id,
                    "risk.reservation_present": (
                        "true" if gate_outcome.reservation is not None else "false"
                    ),
                },
            )
            if tracer is not None
            else None
        )
        try:
            self._risk_gate.release_reservation(gate_outcome.reservation)
            self._risk_gate.rollback_rate(gate_outcome.rate_reservation)
            if release_span is not None:
                release_span.set_attribute("released", "true")
                release_span.set_status(SpanStatus.OK)
        except Exception as exc:  # noqa: BLE001 - cleanup must not rewrite the outcome
            _LOG.warning(
                "risk reservation release failed tenant=%s client_order_id=%s "
                "(slot expires with its TTL)",
                gate_outcome.decision.tenant_id,
                gate_outcome.decision.request_id,
            )
            if release_span is not None:
                release_span.record_exception(exc)
                release_span.set_attribute("released", "false")
                release_span.set_status(SpanStatus.ERROR, description="risk release failed")
        finally:
            if release_span is not None:
                release_span.end()

    async def _submit_under_lock(
        self,
        intent: OrderIntent,
        context: ExecutionContext,
        *,
        client_order_id: str,
        validation: ValidationResult,
        safety: SafetyDecision,
        risk: RiskDecision,
        placement: PlacementVerdict | None = None,
        trace_span: SpanLike | None = None,
    ) -> ExecutionResult:
        """The critical section: reserve, persist, transmit, interpret.

        ``placement`` is the Part 16 verdict the caller already ran. It arrives
        as a parameter instead of a fresh call here for two reasons: the review
        must happen OUTSIDE the account lock (a venue round trip while holding a
        lock serialises every order for that account behind a request that can
        take seconds), and the persisted verdict has to be the SAME one the gates
        saw - re-running it inside the lock could record an answer that differs
        from the one that authorised the submission, and an audit line that
        contradicts its own gate result is worse than no audit line.

        ``trace_span`` is the caller's ``execution.submit`` span when tracing
        is on: the transmit moment is recorded as an event on it, so the span
        shows how long the pipeline waited on the venue without owning a
        second span across this method's many exit paths. It can observe,
        never decide.
        """
        order = Order.from_intent(
            intent,
            client_order_id=client_order_id,
            is_simulated=self._adapter.is_simulated,
        )

        # --- Cross-worker duplicate guard -----------------------------
        reservation = await self._store.reserve_client_order_id(
            intent.tenant_id, client_order_id, order
        )
        if reservation.is_duplicate:
            existing = reservation.existing
            return ExecutionResult(
                outcome=ExecutionOutcome.DUPLICATE,
                client_order_id=client_order_id,
                order=existing,
                error_code=ExecutionErrorCode.DUPLICATE_ORDER,
                message=(
                    f"An order with clientOrderId {client_order_id} already "
                    f"exists"
                    + (f" (order {existing.order_id}, status "
                       f"{existing.status.value})" if existing else "")
                    + ". Nothing was transmitted; the existing order stands."
                ),
                validation=validation,
                safety=safety,
                risk=risk,
                is_simulated=self._adapter.is_simulated,
            )

        await self._store.save_order(order)

        # --- Dry run: stop here ---------------------------------------
        # The order is validated, risk-approved and recorded, and its status is
        # left at PENDING. It is deliberately never marked SUBMITTED, because
        # nothing was submitted, and a dry-run order that says SUBMITTED would
        # be indistinguishable from a real one in the audit trail.
        if self._settings.dry_run and not self._adapter.is_simulated:
            event = order.transition_to(
                OrderStatus.CANCELLED,
                reason=(
                    "DRY_RUN is enabled: the order was fully built, validated "
                    "and risk-checked, then discarded without transmission."
                ),
                payload={"dryRun": "true"},
            )
            await self._store.record_event(intent.tenant_id, event)
            await self._store.save_order(order)
            await self._emit("order.dry_run", order, {"dryRun": True})
            return ExecutionResult(
                outcome=ExecutionOutcome.DRY_RUN,
                client_order_id=client_order_id,
                order=order,
                message=(
                    "DRY_RUN: the signed request was constructed and validated "
                    "but not transmitted. This order was NOT submitted."
                ),
                validation=validation,
                safety=safety,
                risk=risk,
                transmitted=False,
                is_simulated=self._adapter.is_simulated,
            )

        # --- Mark before acting ---------------------------------------
        # Written first so a crash between here and the response still leaves a
        # record saying "we may have an order at the venue".
        submitted_payload: dict[str, str] = {"clientOrderId": client_order_id}
        if placement is not None:
            # The verdict id is a digest of the evidence, so a later reader can
            # tell "this order went out on the strength of a fresh venue
            # attestation" from "this one was waved through on nothing" without
            # a second table: the durable event ledger already carries the story.
            submitted_payload.update(placement.to_event_payload())
        submitted_event = order.transition_to(
            OrderStatus.SUBMITTED,
            reason="Transmitting to the venue.",
            payload=submitted_payload,
        )
        await self._store.record_event(intent.tenant_id, submitted_event)
        await self._store.save_order(order)
        await self._store.set_reconciliation_state(
            intent.tenant_id,
            order.order_id,
            ReconciliationState.UNKNOWN,
            detail="Submission in flight; outcome not yet observed.",
        )
        await self._emit("order.submitted", order, {})

        # --- Transmit --------------------------------------------------
        if trace_span is not None:
            trace_span.add_event("transmit_started")
        try:
            submit_result = await asyncio.wait_for(
                self._adapter.submit_order(intent, client_order_id),
                timeout=self._settings.order_request_timeout_ms / 1000,
            )
        except AdapterRejectedError as exc:
            return await self._handle_rejection(
                order, intent, exc, validation, safety, risk
            )
        except AdapterRateLimitedError as exc:
            # A rate-limit response is a definitive refusal: the venue tells us
            # it did not process the request. The order does not exist.
            return await self._handle_definitive_failure(
                order,
                intent,
                ExecutionErrorCode.RATE_LIMITED,
                str(exc),
                validation,
                safety,
                risk,
            )
        except (ClockSkewExceeded, ClockSyncError) as exc:
            # Raised by the adapter before it transmits, so nothing was sent.
            return await self._handle_definitive_failure(
                order,
                intent,
                (
                    ExecutionErrorCode.CLOCK_SKEW_EXCEEDED
                    if isinstance(exc, ClockSkewExceeded)
                    else ExecutionErrorCode.CLOCK_NOT_SYNCHRONISED
                ),
                str(exc),
                validation,
                safety,
                risk,
            )
        except (AdapterConnectionError, asyncio.TimeoutError) as exc:
            return await self._handle_unknown(
                order, intent, exc, validation, safety, risk
            )
        except AdapterError as exc:
            # An adapter failure we cannot classify. Treated as ambiguous,
            # because "we do not know what this adapter did" and "we do not
            # know whether the order exists" are the same statement.
            return await self._handle_unknown(
                order, intent, exc, validation, safety, risk
            )

        return await self._handle_accepted(
            order, intent, submit_result, validation, safety, risk
        )

    # ------------------------------------------------------------------
    # Outcome handlers
    # ------------------------------------------------------------------
    async def _handle_accepted(
        self,
        order: Order,
        intent: OrderIntent,
        submit_result: SubmitResult,
        validation: ValidationResult,
        safety: SafetyDecision,
        risk: RiskDecision,
    ) -> ExecutionResult:
        """The venue answered. Its answer is authoritative."""
        if not submit_result.accepted:
            reason = submit_result.rejection_reason or "The venue refused the order."
            self._safe_transition(
                order,
                OrderStatus.REJECTED,
                reason=reason,
                payload={"code": submit_result.rejection_code or ""},
            )
            await self._store.save_order(order)
            await self._store.set_reconciliation_state(
                intent.tenant_id, order.order_id, ReconciliationState.IN_SYNC
            )
            await self._emit("order.rejected", order, {"reason": reason})
            return ExecutionResult(
                outcome=ExecutionOutcome.REJECTED_BY_EXCHANGE,
                client_order_id=order.client_order_id,
                order=order,
                error_code=ExecutionErrorCode.EXCHANGE_REJECTED,
                message=reason,
                validation=validation,
                safety=safety,
                risk=risk,
                submit_result=submit_result,
                transmitted=True,
                is_simulated=submit_result.is_simulated,
            )

        event = self._safe_transition(
            order,
            submit_result.status
            if submit_result.status is not OrderStatus.SUBMITTED
            else OrderStatus.ACKNOWLEDGED,
            reason="Accepted by the venue.",
            exchange_order_id=submit_result.exchange_order_id,
        )
        if event is None:
            # The venue reported a status our state machine says is illegal from
            # here. The venue is authoritative, so this is recorded as an
            # incident rather than silently forced or silently dropped.
            await self._record_illegal_transition(order, intent, submit_result.status)

        applied_fills: list[Fill] = []
        updates: list[PositionUpdate] = []
        for fill in submit_result.fills:
            applied, update = await self._apply_fill(order, intent, fill)
            if applied:
                applied_fills.append(fill)
            if update is not None:
                updates.append(update)

        await self._store.save_order(order)
        await self._store.set_reconciliation_state(
            intent.tenant_id, order.order_id, ReconciliationState.IN_SYNC
        )
        await self._emit(
            "order.accepted",
            order,
            {"exchangeOrderId": submit_result.exchange_order_id or ""},
        )
        return ExecutionResult(
            outcome=ExecutionOutcome.ACCEPTED,
            client_order_id=order.client_order_id,
            order=order,
            message="Accepted by the venue.",
            validation=validation,
            safety=safety,
            risk=risk,
            submit_result=submit_result,
            fills=tuple(applied_fills),
            position_updates=tuple(updates),
            transmitted=not submit_result.is_simulated,
            is_simulated=submit_result.is_simulated,
        )

    async def _handle_rejection(
        self,
        order: Order,
        intent: OrderIntent,
        exc: AdapterRejectedError,
        validation: ValidationResult,
        safety: SafetyDecision,
        risk: RiskDecision,
    ) -> ExecutionResult:
        """The venue said no, explicitly. The order does not exist there."""
        self._safe_transition(
            order,
            OrderStatus.REJECTED,
            reason=str(exc),
            payload={"venueCode": exc.code},
        )
        await self._store.save_order(order)
        await self._store.set_reconciliation_state(
            intent.tenant_id, order.order_id, ReconciliationState.IN_SYNC
        )
        await self._emit("order.rejected", order, {"venueCode": exc.code})

        code = (
            ExecutionErrorCode.INSUFFICIENT_BALANCE
            if "insufficient" in str(exc).lower()
            else ExecutionErrorCode.EXCHANGE_REJECTED
        )
        return ExecutionResult(
            outcome=ExecutionOutcome.REJECTED_BY_EXCHANGE,
            client_order_id=order.client_order_id,
            order=order,
            error_code=code,
            message=str(exc),
            validation=validation,
            safety=safety,
            risk=risk,
            transmitted=True,
            is_simulated=self._adapter.is_simulated,
        )

    async def _handle_definitive_failure(
        self,
        order: Order,
        intent: OrderIntent,
        code: ExecutionErrorCode,
        message: str,
        validation: ValidationResult,
        safety: SafetyDecision,
        risk: RiskDecision,
    ) -> ExecutionResult:
        """A failure where we know the order was not placed."""
        self._safe_transition(order, OrderStatus.FAILED, reason=message)
        await self._store.save_order(order)
        await self._store.set_reconciliation_state(
            intent.tenant_id, order.order_id, ReconciliationState.IN_SYNC
        )
        await self._emit("order.failed", order, {"errorCode": code.value})
        return ExecutionResult(
            outcome=ExecutionOutcome.REJECTED_LOCALLY,
            client_order_id=order.client_order_id,
            order=order,
            error_code=code,
            message=message,
            validation=validation,
            safety=safety,
            risk=risk,
            transmitted=False,
            is_simulated=self._adapter.is_simulated,
        )

    async def _handle_unknown(
        self,
        order: Order,
        intent: OrderIntent,
        exc: BaseException,
        validation: ValidationResult,
        safety: SafetyDecision,
        risk: RiskDecision,
    ) -> ExecutionResult:
        """The dangerous case: we do not know whether the order exists.

        The order's status stays ``SUBMITTED`` — which is true, we did submit
        it — and its reconciliation state becomes ``UNKNOWN``. An incident is
        raised at CRITICAL because an unresolved unknown order is an unhedged,
        unmonitored position waiting to happen.

        Nothing is retried. Not now, not by a caller, not by a background
        sweeper. The only permitted next action is a query by clientOrderId.
        """
        detail = f"{type(exc).__name__}: {exc}" if str(exc) else type(exc).__name__
        await self._store.set_reconciliation_state(
            intent.tenant_id,
            order.order_id,
            ReconciliationState.UNKNOWN,
            detail=detail,
        )
        event = order.transition_to(
            OrderStatus.SUBMITTED,
            reason=(
                "The submission response was lost. The order's fate is unknown "
                "and will be established by querying the venue for "
                f"clientOrderId {order.client_order_id}. It will NOT be "
                "resubmitted."
            ),
            payload={"reconciliationState": ReconciliationState.UNKNOWN.value},
        ) if order.status is not OrderStatus.SUBMITTED else None
        if event is not None:
            await self._store.record_event(intent.tenant_id, event)
        await self._store.save_order(order)

        incident = await self._record_incident(
            tenant_id=intent.tenant_id,
            account_id=intent.account_id,
            incident_type=IncidentType.UNKNOWN_ORDER_RESULT,
            severity=IncidentSeverity.CRITICAL,
            summary=(
                f"Order {order.order_id} was transmitted but no response was "
                f"received. The order may or may not exist at "
                f"{self._adapter.exchange.value}. It must be reconciled by "
                f"clientOrderId and must never be resubmitted."
            ),
            symbol=intent.symbol,
            order_id=order.order_id,
            client_order_id=order.client_order_id,
            error_code=ExecutionErrorCode.RESULT_UNKNOWN,
            details={"cause": detail},
        )
        await self._emit(
            "order.unknown",
            order,
            {"cause": detail, "requiresReconciliation": True},
        )

        return ExecutionResult(
            outcome=ExecutionOutcome.UNKNOWN,
            client_order_id=order.client_order_id,
            order=order,
            error_code=ExecutionErrorCode.RESULT_UNKNOWN,
            message=(
                "The venue's response was lost. The order's state is unknown "
                "and reconciliation has been scheduled. It has NOT been "
                "resubmitted."
            ),
            validation=validation,
            safety=safety,
            risk=risk,
            incident=incident,
            transmitted=True,
            is_simulated=self._adapter.is_simulated,
        )

    # ------------------------------------------------------------------
    # Cancellation
    # ------------------------------------------------------------------
    async def cancel(
        self, order: Order, *, reason: str = "Cancelled by request."
    ) -> ExecutionResult:
        """Cancel a resting order.

        Refuses when the order's fate is unknown: cancelling an order that may
        not exist produces a venue error that is itself ambiguous, and the
        correct first step is always to establish what the order actually is.
        """
        started_nanos = monotonic_nanos()
        state = await self._store.get_reconciliation_state(
            order.tenant_id, order.order_id
        )
        if state.blocks_further_submission:
            return ExecutionResult(
                outcome=ExecutionOutcome.REJECTED_LOCALLY,
                client_order_id=order.client_order_id,
                order=order,
                error_code=ExecutionErrorCode.RECONCILIATION_REQUIRED,
                message=(
                    f"Order {order.order_id} is in reconciliation state "
                    f"{state.value}; its true state at the venue is not known. "
                    f"Reconcile before cancelling."
                ),
                latency_micros=(monotonic_nanos() - started_nanos) // 1_000,
            )

        if order.status in TERMINAL_ORDER_STATUSES:
            return ExecutionResult(
                outcome=ExecutionOutcome.REJECTED_LOCALLY,
                client_order_id=order.client_order_id,
                order=order,
                error_code=ExecutionErrorCode.ILLEGAL_STATE_TRANSITION,
                message=(
                    f"Order {order.order_id} is already terminal "
                    f"({order.status.value}); there is nothing to cancel."
                ),
                latency_micros=(monotonic_nanos() - started_nanos) // 1_000,
            )

        async with self._locks.hold(
            order_lock_key(order.tenant_id, order.order_id),
            ttl_millis=self._default_lock_ttl_millis,
            wait_millis=self._default_lock_ttl_millis // 3,
        ):
            request_event = order.try_transition_to(
                OrderStatus.CANCEL_REQUESTED, reason=reason
            )
            if request_event is not None:
                await self._store.record_event(order.tenant_id, request_event)
                await self._store.save_order(order)

            try:
                result = await asyncio.wait_for(
                    self._adapter.cancel_order(order),
                    timeout=self._settings.order_request_timeout_ms / 1000,
                )
            except (AdapterConnectionError, asyncio.TimeoutError) as exc:
                await self._store.set_reconciliation_state(
                    order.tenant_id,
                    order.order_id,
                    ReconciliationState.UNKNOWN,
                    detail=f"Cancel response lost: {type(exc).__name__}",
                )
                incident = await self._record_incident(
                    tenant_id=order.tenant_id,
                    account_id=order.account_id,
                    incident_type=IncidentType.UNKNOWN_ORDER_RESULT,
                    severity=IncidentSeverity.WARNING,
                    summary=(
                        f"Cancellation of order {order.order_id} received no "
                        f"response; the order may or may not have been "
                        f"cancelled."
                    ),
                    order_id=order.order_id,
                    client_order_id=order.client_order_id,
                    error_code=ExecutionErrorCode.RESULT_UNKNOWN,
                )
                return ExecutionResult(
                    outcome=ExecutionOutcome.UNKNOWN,
                    client_order_id=order.client_order_id,
                    order=order,
                    error_code=ExecutionErrorCode.RESULT_UNKNOWN,
                    message="The cancellation response was lost; reconciling.",
                    incident=incident,
                    transmitted=True,
                    latency_micros=(monotonic_nanos() - started_nanos) // 1_000,
                )
            except AdapterError as exc:
                return ExecutionResult(
                    outcome=ExecutionOutcome.REJECTED_BY_EXCHANGE,
                    client_order_id=order.client_order_id,
                    order=order,
                    error_code=ExecutionErrorCode.EXCHANGE_REJECTED,
                    message=str(exc),
                    transmitted=True,
                    latency_micros=(monotonic_nanos() - started_nanos) // 1_000,
                )

            if result.accepted:
                self._safe_transition(
                    order,
                    result.status,
                    reason=result.reason or "Cancelled at the venue.",
                )
                await self._store.save_order(order)
                await self._emit("order.cancelled", order, {})

            return ExecutionResult(
                outcome=(
                    ExecutionOutcome.ACCEPTED
                    if result.accepted
                    else ExecutionOutcome.REJECTED_BY_EXCHANGE
                ),
                client_order_id=order.client_order_id,
                order=order,
                message=result.reason or "",
                transmitted=not result.is_simulated,
                is_simulated=result.is_simulated,
                latency_micros=(monotonic_nanos() - started_nanos) // 1_000,
            )

    # ------------------------------------------------------------------
    # Fills
    # ------------------------------------------------------------------
    async def apply_external_fill(
        self, order: Order, fill: Fill
    ) -> tuple[bool, PositionUpdate | None]:
        """Apply a fill that arrived outside a submission — the usual case.

        The private stream delivers most fills, and reconciliation delivers the
        rest. Both land here, and both are deduplicated by ``fill_id``, because
        the same trade legitimately arrives twice by two different routes.
        """
        intent_like = _IntentView(
            tenant_id=order.tenant_id,
            account_id=order.account_id,
            symbol=order.symbol,
            exchange=order.exchange,
        )
        return await self._apply_fill(order, intent_like, fill)

    async def _apply_fill(
        self,
        order: Order,
        intent: "OrderIntent | _IntentView",
        fill: Fill,
    ) -> tuple[bool, PositionUpdate | None]:
        """Record a fill once, and once only.

        The Part 2 ``Order.apply_fill`` already deduplicates by ``fill_id`` and
        recomputes the aggregate from scratch; the store deduplicates durably.
        Both are consulted, because either alone leaves a gap: the in-memory
        object is lost on restart and the store is not consulted on the hot
        path.
        """
        # An adapter identifies a fill by whatever the venue gave it — usually
        # the clientOrderId, because the venue has never heard of our internal
        # order id. Rebind it here, once, at the boundary, so the durable record
        # and the in-memory aggregate agree on which order the fill belongs to.
        bound = (
            fill if fill.order_id == order.order_id
            else replace(fill, order_id=order.order_id)
        )
        newly_stored = await self._store.record_fill(intent.tenant_id, bound)
        applied = order.apply_fill(bound)
        if not applied or not newly_stored:
            return (False, None)

        update: PositionUpdate | None = None
        if self._positions is not None:
            update = self._positions.apply_fill(
                order.tenant_id,
                order.account_id,
                order.exchange,
                order.symbol,
                order.side,
                bound,
            )
        await self._emit(
            "order.filled",
            order,
            {
                "fillId": bound.fill_id,
                "quantity": str(bound.quantity),
                "price": str(bound.price),
                "isSimulated": bound.is_simulated,
            },
        )
        return (True, update)

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------
    def _safe_transition(
        self,
        order: Order,
        target: OrderStatus,
        *,
        reason: str,
        exchange_order_id: str | None = None,
        payload: dict[str, str] | None = None,
    ) -> OrderEvent | None:
        """Transition, tolerating an illegal target.

        Returns the event, or ``None`` when the transition was refused. The
        caller decides what an illegal transition means; this never forces one,
        because a forced transition destroys the very audit trail that would
        explain the bug.
        """
        try:
            return order.transition_to(
                target,
                reason=reason,
                exchange_order_id=exchange_order_id,
                payload=payload,
            )
        except InvalidOrderTransition:
            return None

    async def _record_illegal_transition(
        self, order: Order, intent: "OrderIntent | _IntentView", target: OrderStatus
    ) -> None:
        await self._record_incident(
            tenant_id=order.tenant_id,
            account_id=order.account_id,
            incident_type=IncidentType.ILLEGAL_TRANSITION,
            severity=IncidentSeverity.WARNING,
            summary=(
                f"The venue reported status {target.value} for order "
                f"{order.order_id}, which is not a legal transition from "
                f"{order.status.value}. Local state was left unchanged and the "
                f"discrepancy recorded rather than forced."
            ),
            symbol=order.symbol,
            order_id=order.order_id,
            client_order_id=order.client_order_id,
            error_code=ExecutionErrorCode.ILLEGAL_STATE_TRANSITION,
            details={"from": order.status.value, "to": target.value},
        )

    async def _maybe_record_gate_incident(
        self, intent: OrderIntent, safety: SafetyDecision
    ) -> ExecutionIncident | None:
        """Record an incident only for gates that indicate a fault.

        A kill switch blocking an order is the system working exactly as
        intended and generates no incident; an unhealthy risk engine or an
        invalid credential is a fault and does.
        """
        faulty = {
            SafetyGate.RISK_ENGINE_HEALTHY,
            SafetyGate.CREDENTIALS_VALID,
            SafetyGate.EXCHANGE_HEALTHY,
            SafetyGate.MARKET_DATA_HEALTHY,
            # A blocked review is a fault precisely because it is unexpected:
            # either the venue changed the key's entitlements, or the attestor
            # could not be reached, and both mean the deployment is not in the
            # state its configuration claims.
            SafetyGate.PLACEMENT_ATTESTED,
        }
        blocking = safety.blocking_gate
        if blocking is None or blocking not in faulty:
            return None
        severity = (
            IncidentSeverity.CRITICAL
            if blocking is SafetyGate.CREDENTIALS_VALID
            else IncidentSeverity.WARNING
        )
        incident_type = (
            IncidentType.CREDENTIAL_FAILURE
            if blocking is SafetyGate.CREDENTIALS_VALID
            else IncidentType.SAFETY_GATE_BLOCK
        )
        return await self._record_incident(
            tenant_id=intent.tenant_id,
            account_id=intent.account_id,
            incident_type=incident_type,
            severity=severity,
            summary=f"Order blocked by safety gate {blocking.value}.",
            symbol=intent.symbol,
            error_code=_gate_error_code(blocking),
            details={"reason": safety.reason},
        )

    def _observe_stage(self, stage: str, started_nanos: int) -> None:
        """Record one stage span on the metrics port, if there is one.

        Same duck-typing as :meth:`_record_placement_review`, for the same
        reason: the port is optional, and a submission path must not fail
        because a deployment passed nothing. Four stages are recorded here -
        ``validation``, ``safety_gates``, ``risk`` and ``total_submit`` - and
        the rest of ``EXECUTION_STAGES`` deliberately is not, because those
        spans belong to layers this engine calls rather than contains: signing
        and network sit inside the trading adapter, ``first_fill`` and
        ``private_stream_delivery`` inside the stream, ``reconciliation_pass``
        inside :class:`ReconciliationService`'s three entry points, and
        ``persistence`` across six store writes whose aggregation (per-write or
        per-submit) is a decision the platform has not made. A histogram is a
        promise about what is being measured; the engine does not make promises
        it has not defined.

        Error paths are counted, not timed. A stage that never returned has no
        duration, and inventing one by recording in an ``except`` would put a
        number on the dashboard that means "we gave up", which is what the
        counters are for.
        """
        metrics = self._metrics
        if metrics is None:
            return
        observe = getattr(metrics, "observe", None)
        if callable(observe):
            observe(stage, (monotonic_nanos() - started_nanos) // 1_000)

    def _record_placement_review(
        self, verdict: PlacementVerdict, started_nanos: int
    ) -> None:
        """Count and time the review on the shared execution metrics port.

        The port is duck-typed because it has always been optional here
        (``metrics`` accepts any object): a submission path must not fail because
        a deployment passed nothing, and the same argument applies to a counter.
        Each update is therefore guarded on the attribute existing, which is how
        the rest of this engine treats the port.
        """
        metrics = self._metrics
        if metrics is None:
            return
        observe = getattr(metrics, "observe", None)
        if callable(observe):
            observe("placement_review", (monotonic_nanos() - started_nanos) // 1_000)
        counters = getattr(metrics, "counters", None)
        if counters is None:
            return
        deltas = {"placement_reviews": 1}
        if not verdict.allowed:
            deltas["placement_review_blocks"] = 1
            if any(
                finding.code.value.startswith("ATTESTATION_")
                or finding.code.value == "NO_ATTESTATION"
                for finding in verdict.blocking_findings
            ):
                deltas["placement_attestation_failures"] = 1
            # Per-area, read off the verdict's own classification rather than
            # re-derived here from code prefixes: an engine that recomputed areas
            # would be a second taxonomy, and the two would disagree about a new
            # code on the day it is added. The hasattr guard means an area added to
            # the enum cannot make this line raise on the reporting path - and the
            # Part 19 test pins that every area DOES have a field, so the guard
            # cannot quietly become a hole either.
            for area, count in verdict.area_counts.items():
                name = f"placement_blocks_{area.lower()}"
                if hasattr(counters, name):
                    deltas[name] = deltas.get(name, 0) + count
        for name, delta in deltas.items():
            setattr(counters, name, int(getattr(counters, name, 0)) + delta)

    async def _record_incident(
        self,
        *,
        tenant_id: str,
        incident_type: IncidentType,
        severity: IncidentSeverity,
        summary: str,
        account_id: str | None = None,
        symbol: str | None = None,
        order_id: str | None = None,
        client_order_id: str | None = None,
        error_code: ExecutionErrorCode | None = None,
        details: Mapping[str, object] | None = None,
    ) -> ExecutionIncident | None:
        """Record an incident without ever failing the caller.

        An incident store that is down must not take execution down with it.
        """
        incident = ExecutionIncident.create(
            tenant_id=tenant_id,
            account_id=account_id,
            incident_type=incident_type,
            severity=severity,
            summary=summary,
            exchange=self._adapter.exchange,
            symbol=symbol,
            order_id=order_id,
            client_order_id=client_order_id,
            error_code=error_code,
            details=details,
        )
        try:
            await self._incidents.record(incident)
        except Exception:  # noqa: BLE001 - never break execution for logging
            return incident
        return incident

    async def _emit(
        self, event_type: str, order: Order, extra: Mapping[str, object]
    ) -> None:
        """Publish a trading event, tolerating a failing publisher."""
        if self._publish is None:
            return
        payload: dict[str, object] = {
            "tenantId": order.tenant_id,
            "accountId": order.account_id,
            "orderId": order.order_id,
            "clientOrderId": order.client_order_id,
            "exchangeOrderId": order.exchange_order_id,
            "exchange": order.exchange.value,
            "symbol": order.symbol,
            "side": order.side.value,
            "status": order.status.value,
            "isSimulated": order.is_simulated,
            "filledQuantity": str(order.filled_quantity),
            "occurredAtMicros": epoch_micros(),
        }
        payload.update(extra)
        try:
            await self._publish(event_type, payload)
        except Exception:  # noqa: BLE001 - publishing is best-effort
            return


@dataclass(frozen=True, slots=True)
class _IntentView:
    """The few intent fields the fill path needs.

    Lets :meth:`ExecutionEngine.apply_external_fill` reuse ``_apply_fill``
    without fabricating a whole :class:`OrderIntent` — a fabricated intent would
    be indistinguishable from a real one to anything downstream, which is
    exactly the sort of thing that ends up in a database.
    """

    tenant_id: str
    account_id: str
    symbol: str
    exchange: ExchangeId


#: Gate → public-error taxonomy, as a table with a default rather than an
#: ``if``-chain. A chain that enumerates every current member gives the type
#: checker enough to prove its fallback dead — yet the fallback is precisely
#: the protection for the day a gate is added and forgotten here. A table
#: keeps that protection visible to callers and to mypy alike.
_GATE_ERROR_CODES: dict[SafetyGate, ExecutionErrorCode] = {
    SafetyGate.GLOBAL_KILL_SWITCH: ExecutionErrorCode.KILL_SWITCH_ENGAGED,
    SafetyGate.EXCHANGE_KILL_SWITCH: ExecutionErrorCode.KILL_SWITCH_ENGAGED,
    SafetyGate.STRATEGY_KILL_SWITCH: ExecutionErrorCode.KILL_SWITCH_ENGAGED,
    SafetyGate.SYMBOL_KILL_SWITCH: ExecutionErrorCode.KILL_SWITCH_ENGAGED,
    SafetyGate.TRADING_MODE: ExecutionErrorCode.TRADING_DISABLED,
    SafetyGate.LIVE_TRADING_AUTHORISED: ExecutionErrorCode.LIVE_TRADING_NOT_AUTHORISED,
    SafetyGate.RISK_ENGINE_HEALTHY: ExecutionErrorCode.RISK_UNAVAILABLE,
    SafetyGate.MARKET_DATA_HEALTHY: ExecutionErrorCode.MARKET_DATA_UNAVAILABLE,
    SafetyGate.CREDENTIALS_VALID: ExecutionErrorCode.CREDENTIALS_INVALID,
    # "Not authorised to place" is what a blocked review means, and reusing the
    # existing code keeps the worker's failure taxonomy unchanged: the detail of
    # WHY (key, symbol phase, clock, unreachable venue) is in the verdict codes
    # carried by the event payload and the incident, where a human reads it.
    SafetyGate.PLACEMENT_ATTESTED: ExecutionErrorCode.LIVE_TRADING_NOT_AUTHORISED,
    SafetyGate.EXCHANGE_HEALTHY: ExecutionErrorCode.EXCHANGE_UNAVAILABLE,
}


def _gate_error_code(gate: SafetyGate | None) -> ExecutionErrorCode:
    """Map a blocked gate onto the public error taxonomy."""
    if gate is None:
        return ExecutionErrorCode.INTERNAL_ERROR
    return _GATE_ERROR_CODES.get(gate, ExecutionErrorCode.INTERNAL_ERROR)


def _risk_error_code(decision: RiskDecision) -> ExecutionErrorCode:
    """Map a risk decision onto the public error taxonomy.

    Part 8 added the state-integrity codes: a stale or invalid snapshot and
    an unavailable gate are reported as ``RISK_UNAVAILABLE`` (the condition
    is "the decision could not be made", which is an operational fault, not
    a policy answer), while stale *market* data and stale risk state keep
    distinct codes because the remediations differ (feed vs. state loader).
    """
    from wlct_trading.risk import RiskDecisionCode

    if decision.code in (
        RiskDecisionCode.RISK_STATE_UNAVAILABLE,
        RiskDecisionCode.RISK_GATE_UNAVAILABLE,
        RiskDecisionCode.RISK_CONFIGURATION_INVALID,
        RiskDecisionCode.UNKNOWN_RISK_RULE,
    ):
        return ExecutionErrorCode.RISK_UNAVAILABLE
    if decision.code in (
        RiskDecisionCode.STALE_RISK_STATE,
        RiskDecisionCode.INVALID_ACCOUNT_STATE,
        RiskDecisionCode.INVALID_POSITION_STATE,
    ):
        return ExecutionErrorCode.RISK_STATE_STALE
    if decision.code is RiskDecisionCode.STALE_MARKET_DATA:
        return ExecutionErrorCode.MARKET_DATA_UNAVAILABLE
    if decision.code is RiskDecisionCode.INSUFFICIENT_BALANCE:
        return ExecutionErrorCode.INSUFFICIENT_BALANCE
    if decision.code is RiskDecisionCode.DUPLICATE_ORDER:
        return ExecutionErrorCode.DUPLICATE_ORDER
    if decision.kill_switch_scope is not None:
        return ExecutionErrorCode.KILL_SWITCH_ENGAGED
    if decision.trading_mode is TradingMode.DISABLED:
        return ExecutionErrorCode.TRADING_DISABLED
    return ExecutionErrorCode.RISK_REJECTED
