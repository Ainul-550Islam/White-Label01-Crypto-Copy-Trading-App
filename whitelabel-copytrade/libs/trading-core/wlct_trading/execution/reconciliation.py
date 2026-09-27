"""Reconciliation: making the local record match the venue.

The exchange is authoritative for execution. The local database is the durable
record. When they disagree, the venue is right and the local record is wrong —
but "wrong" is not the same as "worthless", so this service never silently
overwrites history. It appends a correction, records what changed, and raises
an incident when the change is material.

Four kinds of divergence are detected:

``Unknown order``
    A submission whose response was lost. Queried by clientOrderId; if the
    venue has it, the local record catches up, and if it does not, the order is
    marked failed — the one case where "the venue has never heard of it" is a
    definitive answer.
``Missed lifecycle event``
    The private stream dropped a message or the process was down. The venue's
    status wins.
``Missed fill``
    A trade the platform never saw. Applied through the same path as a live
    fill, so positions and PnL are computed identically no matter how the fill
    arrived.
``Unexpected order``
    An order at the venue that this platform did not place — placed by hand, by
    another system, or by a compromised key. Never adopted, always escalated.

Balances and positions are compared but treated differently: a balance mismatch
is reported, never corrected, because balances are derived from fills and a
"corrected" balance would hide the missing fill that caused it.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from decimal import Decimal
from enum import Enum
from typing import Mapping, cast

from wlct_trading.adapters.base import (
    AccountAdapter,
    AccountBalance,
    AdapterError,
    TradingAdapter,
)
from wlct_trading.clock import epoch_micros
from wlct_trading.enums import ExchangeId, OrderStatus
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
    reconciliation_lock_key,
)
from wlct_trading.execution.store import OrderStore, ReconciliationState
from wlct_trading.orders import Order
from wlct_trading.positions import PositionManager

__all__ = [
    "DiscrepancyType",
    "Discrepancy",
    "ReconciliationReport",
    "ReconciliationService",
]


class DiscrepancyType(str, Enum):
    """What kind of disagreement was found."""

    ORDER_STATUS_MISMATCH = "ORDER_STATUS_MISMATCH"
    ORDER_MISSING_LOCALLY = "ORDER_MISSING_LOCALLY"
    ORDER_MISSING_AT_VENUE = "ORDER_MISSING_AT_VENUE"
    MISSED_FILL = "MISSED_FILL"
    QUANTITY_MISMATCH = "QUANTITY_MISMATCH"
    BALANCE_MISMATCH = "BALANCE_MISMATCH"
    POSITION_MISMATCH = "POSITION_MISMATCH"
    UNKNOWN_ORDER_RESOLVED = "UNKNOWN_ORDER_RESOLVED"
    UNKNOWN_ORDER_NEVER_PLACED = "UNKNOWN_ORDER_NEVER_PLACED"


@dataclass(frozen=True, slots=True)
class Discrepancy:
    """One difference between local state and the venue."""

    discrepancy_type: DiscrepancyType
    tenant_id: str
    account_id: str
    exchange: ExchangeId
    summary: str
    order_id: str | None = None
    client_order_id: str | None = None
    symbol: str | None = None
    local_value: str | None = None
    venue_value: str | None = None
    #: Whether the local record was changed to match. False for anything the
    #: service refuses to auto-correct.
    repaired: bool = False
    detected_at_micros: int = field(default_factory=epoch_micros)

    @property
    def is_material(self) -> bool:
        """Whether this needs a human even after automatic repair.

        An unexpected order and a position mismatch always do: one means
        something else is trading the account, the other means the platform's
        own arithmetic disagrees with the venue's.
        """
        return self.discrepancy_type in (
            DiscrepancyType.ORDER_MISSING_LOCALLY,
            DiscrepancyType.POSITION_MISMATCH,
            DiscrepancyType.QUANTITY_MISMATCH,
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "type": self.discrepancy_type.value,
            "tenantId": self.tenant_id,
            "accountId": self.account_id,
            "exchange": self.exchange.value,
            "summary": self.summary,
            "orderId": self.order_id,
            "clientOrderId": self.client_order_id,
            "symbol": self.symbol,
            "localValue": self.local_value,
            "venueValue": self.venue_value,
            "repaired": self.repaired,
            "detectedAtMicros": self.detected_at_micros,
        }


@dataclass(frozen=True, slots=True)
class ReconciliationReport:
    """Outcome of one reconciliation pass."""

    tenant_id: str
    account_id: str
    exchange: ExchangeId
    started_at_micros: int
    finished_at_micros: int
    orders_checked: int
    fills_recovered: int
    discrepancies: tuple[Discrepancy, ...]
    incidents: tuple[ExecutionIncident, ...]
    #: Set when the pass could not complete — a venue error, a lock held
    #: elsewhere. A failed pass is reported, never silently swallowed, because
    #: "reconciliation has not run for an hour" is itself an alertable state.
    error: str | None = None

    @property
    def succeeded(self) -> bool:
        return self.error is None

    @property
    def duration_micros(self) -> int:
        return self.finished_at_micros - self.started_at_micros

    @property
    def material_discrepancies(self) -> tuple[Discrepancy, ...]:
        return tuple(item for item in self.discrepancies if item.is_material)

    def to_dict(self) -> dict[str, object]:
        return {
            "tenantId": self.tenant_id,
            "accountId": self.account_id,
            "exchange": self.exchange.value,
            "startedAtMicros": self.started_at_micros,
            "finishedAtMicros": self.finished_at_micros,
            "durationMicros": self.duration_micros,
            "ordersChecked": self.orders_checked,
            "fillsRecovered": self.fills_recovered,
            "discrepancyCount": len(self.discrepancies),
            "materialDiscrepancyCount": len(self.material_discrepancies),
            "discrepancies": [item.to_dict() for item in self.discrepancies],
            "incidentIds": [item.incident_id for item in self.incidents],
            "succeeded": self.succeeded,
            "error": self.error,
        }


class ReconciliationService:
    """Compares local execution state against the venue and repairs the gap.

    Runs on a timer, after every private-stream reconnect, and on demand for a
    single order after an ambiguous submission.
    """

    __slots__ = (
        "_trading",
        "_account",
        "_store",
        "_incidents",
        "_locks",
        "_positions",
        "_balance_tolerance",
        "_lock_ttl_millis",
    )

    def __init__(
        self,
        *,
        trading: TradingAdapter,
        account: AccountAdapter,
        store: OrderStore,
        incidents: IncidentRecorder,
        locks: LockManager,
        positions: PositionManager | None = None,
        balance_tolerance: Decimal = Decimal("0.00000001"),
        lock_ttl_millis: int = 60_000,
    ) -> None:
        self._trading = trading
        self._account = account
        self._store = store
        self._incidents = incidents
        self._locks = locks
        self._positions = positions
        self._balance_tolerance = balance_tolerance
        self._lock_ttl_millis = lock_ttl_millis

    @property
    def exchange(self) -> ExchangeId:
        return self._trading.exchange

    # ------------------------------------------------------------------
    # Single order
    # ------------------------------------------------------------------
    async def resolve_unknown_order(
        self, order: Order
    ) -> tuple[Order, Discrepancy | None]:
        """Establish the true state of an order whose fate is unknown.

        This is the *only* correct response to an ambiguous submission. It asks
        the venue about the clientOrderId and takes whatever answer it gets:

        * **The venue has it** — the local record catches up, including any
          fills that happened while we were blind.
        * **The venue has never heard of it** — the order was never placed, and
          is marked ``FAILED``. Safe to conclude because clientOrderId lookup is
          exact: there is no partial match and no ambiguity in a 404.
        * **The venue cannot be reached** — nothing changes. The order stays
          unknown and the next pass tries again. Guessing here would be the one
          thing worse than not knowing.
        """
        try:
            venue_order = await self._fetch_venue_order(order)
        except AdapterError as exc:
            await self._record(
                order.tenant_id,
                IncidentType.RECONCILIATION_FAILURE,
                IncidentSeverity.WARNING,
                summary=(
                    f"Could not query the venue for unknown order "
                    f"{order.order_id}: {type(exc).__name__}. The order remains "
                    f"unknown and will be retried."
                ),
                account_id=order.account_id,
                order_id=order.order_id,
                client_order_id=order.client_order_id,
                error_code=ExecutionErrorCode.RECONCILIATION_FAILED,
            )
            return (order, None)

        if venue_order is None:
            # Definitive: the order never reached the matching engine.
            event = order.try_transition_to(
                OrderStatus.FAILED,
                reason=(
                    "Reconciliation queried the venue by clientOrderId and the "
                    "order does not exist there. It was never placed."
                ),
            )
            if event is not None:
                await self._store.record_event(order.tenant_id, event)
            await self._store.save_order(order)
            await self._store.set_reconciliation_state(
                order.tenant_id, order.order_id, ReconciliationState.IN_SYNC
            )
            return (
                order,
                Discrepancy(
                    discrepancy_type=DiscrepancyType.UNKNOWN_ORDER_NEVER_PLACED,
                    tenant_id=order.tenant_id,
                    account_id=order.account_id,
                    exchange=self.exchange,
                    summary=(
                        f"Order {order.order_id} was never placed; the venue has "
                        f"no record of clientOrderId {order.client_order_id}."
                    ),
                    order_id=order.order_id,
                    client_order_id=order.client_order_id,
                    symbol=order.symbol,
                    local_value=OrderStatus.SUBMITTED.value,
                    venue_value="ABSENT",
                    repaired=True,
                ),
            )

        discrepancy = await self._adopt_venue_state(order, venue_order)
        await self._store.set_reconciliation_state(
            order.tenant_id, order.order_id, ReconciliationState.IN_SYNC
        )
        return (
            order,
            discrepancy
            or Discrepancy(
                discrepancy_type=DiscrepancyType.UNKNOWN_ORDER_RESOLVED,
                tenant_id=order.tenant_id,
                account_id=order.account_id,
                exchange=self.exchange,
                summary=(
                    f"Order {order.order_id} was found at the venue with status "
                    f"{venue_order.status.value}; local state now matches."
                ),
                order_id=order.order_id,
                client_order_id=order.client_order_id,
                symbol=order.symbol,
                venue_value=venue_order.status.value,
                repaired=True,
            ),
        )

    # ------------------------------------------------------------------
    # Full account pass
    # ------------------------------------------------------------------
    async def reconcile_account(
        self,
        tenant_id: str,
        account_id: str,
        *,
        check_balances: bool = True,
        check_positions: bool = True,
    ) -> ReconciliationReport:
        """One full pass over an account's orders, balances and positions.

        Serialised by a distributed lock: two overlapping passes would both see
        the same missing fill and both apply it, and only the ``fill_id``
        dedupe would stop the position doubling. Better not to rely on the last
        line of defence.
        """
        started = epoch_micros()
        discrepancies: list[Discrepancy] = []
        incidents: list[ExecutionIncident] = []
        orders_checked = 0
        fills_recovered = 0

        try:
            async with self._locks.hold(
                reconciliation_lock_key(tenant_id, account_id, self.exchange),
                ttl_millis=self._lock_ttl_millis,
                wait_millis=0,
            ):
                (
                    orders_checked,
                    fills_recovered,
                    order_discrepancies,
                ) = await self._reconcile_orders(tenant_id, account_id)
                discrepancies.extend(order_discrepancies)

                if check_balances:
                    discrepancies.extend(
                        await self._reconcile_balances(tenant_id, account_id)
                    )
                if check_positions:
                    discrepancies.extend(
                        await self._reconcile_positions(tenant_id, account_id)
                    )
        except LockNotAcquired:
            return ReconciliationReport(
                tenant_id=tenant_id,
                account_id=account_id,
                exchange=self.exchange,
                started_at_micros=started,
                finished_at_micros=epoch_micros(),
                orders_checked=0,
                fills_recovered=0,
                discrepancies=(),
                incidents=(),
                error=(
                    "Another reconciliation pass is already running for this "
                    "account; skipped."
                ),
            )
        except AdapterError as exc:
            incident = await self._record(
                tenant_id,
                IncidentType.RECONCILIATION_FAILURE,
                IncidentSeverity.WARNING,
                summary=(
                    f"Reconciliation for account {account_id} failed: "
                    f"{type(exc).__name__}."
                ),
                account_id=account_id,
                error_code=ExecutionErrorCode.RECONCILIATION_FAILED,
                details={"error": str(exc)},
            )
            return ReconciliationReport(
                tenant_id=tenant_id,
                account_id=account_id,
                exchange=self.exchange,
                started_at_micros=started,
                finished_at_micros=epoch_micros(),
                orders_checked=0,
                fills_recovered=0,
                discrepancies=(),
                incidents=(incident,) if incident else (),
                error=f"{type(exc).__name__}: {exc}",
            )

        for discrepancy in discrepancies:
            if not discrepancy.is_material:
                continue
            incident = await self._record(
                tenant_id,
                _incident_type_for(discrepancy.discrepancy_type),
                IncidentSeverity.CRITICAL
                if discrepancy.discrepancy_type
                is DiscrepancyType.ORDER_MISSING_LOCALLY
                else IncidentSeverity.WARNING,
                summary=discrepancy.summary,
                account_id=account_id,
                symbol=discrepancy.symbol,
                order_id=discrepancy.order_id,
                client_order_id=discrepancy.client_order_id,
                error_code=ExecutionErrorCode.STATE_MISMATCH,
                details={
                    "local": discrepancy.local_value or "",
                    "venue": discrepancy.venue_value or "",
                },
            )
            if incident is not None:
                incidents.append(incident)

        return ReconciliationReport(
            tenant_id=tenant_id,
            account_id=account_id,
            exchange=self.exchange,
            started_at_micros=started,
            finished_at_micros=epoch_micros(),
            orders_checked=orders_checked,
            fills_recovered=fills_recovered,
            discrepancies=tuple(discrepancies),
            incidents=tuple(incidents),
        )

    # ------------------------------------------------------------------
    # Orders
    # ------------------------------------------------------------------
    async def _reconcile_orders(
        self, tenant_id: str, account_id: str
    ) -> tuple[int, int, list[Discrepancy]]:
        discrepancies: list[Discrepancy] = []
        fills_recovered = 0

        local_open = await self._store.list_open_orders(
            tenant_id, account_id, exchange=self.exchange
        )
        venue_open = await self._trading.fetch_open_orders(tenant_id, account_id)
        venue_by_coid = {
            order.client_order_id: order for order in venue_open if order.client_order_id
        }

        # 1. Orders we think are open.
        for local in local_open:
            venue = venue_by_coid.get(local.client_order_id)
            if venue is not None:
                before = local.filled_quantity
                discrepancy = await self._adopt_venue_state(local, venue)
                if local.filled_quantity != before:
                    fills_recovered += 1
                if discrepancy is not None:
                    discrepancies.append(discrepancy)
                continue

            # Open locally, absent from the venue's open list: it reached a
            # terminal state and we missed the event. Ask directly rather than
            # assuming which terminal state.
            resolved = await self._fetch_venue_order(local)
            if resolved is None:
                discrepancies.append(
                    Discrepancy(
                        discrepancy_type=DiscrepancyType.ORDER_MISSING_AT_VENUE,
                        tenant_id=tenant_id,
                        account_id=account_id,
                        exchange=self.exchange,
                        summary=(
                            f"Order {local.order_id} is open locally but the "
                            f"venue has no record of it. Marked failed."
                        ),
                        order_id=local.order_id,
                        client_order_id=local.client_order_id,
                        symbol=local.symbol,
                        local_value=local.status.value,
                        venue_value="ABSENT",
                        repaired=True,
                    )
                )
                event = local.try_transition_to(
                    OrderStatus.FAILED,
                    reason="Reconciliation found no record of this order at the venue.",
                )
                if event is not None:
                    await self._store.record_event(tenant_id, event)
                await self._store.save_order(local)
            else:
                discrepancy = await self._adopt_venue_state(local, resolved)
                if discrepancy is not None:
                    discrepancies.append(discrepancy)

        # 2. Orders the venue has that we do not. Never adopted.
        local_coids = {order.client_order_id for order in local_open}
        for coid, venue in venue_by_coid.items():
            if coid in local_coids:
                continue
            known = await self._store.get_by_client_order_id(tenant_id, coid)
            if known is not None:
                continue
            discrepancies.append(
                Discrepancy(
                    discrepancy_type=DiscrepancyType.ORDER_MISSING_LOCALLY,
                    tenant_id=tenant_id,
                    account_id=account_id,
                    exchange=self.exchange,
                    summary=(
                        f"The venue reports an open order ({coid}) that this "
                        f"platform did not place. It has NOT been adopted. This "
                        f"means the account is being traded by something else, "
                        f"or the API key is in use elsewhere."
                    ),
                    client_order_id=coid,
                    symbol=venue.symbol,
                    local_value="ABSENT",
                    venue_value=venue.status.value,
                    repaired=False,
                )
            )

        # 3. Orders explicitly flagged unknown.
        flagged = await self._store.list_orders_needing_reconciliation(limit=200)
        for order in flagged:
            if order.tenant_id != tenant_id or order.account_id != account_id:
                continue
            state = await self._store.get_reconciliation_state(
                tenant_id, order.order_id
            )
            if state is not ReconciliationState.UNKNOWN:
                continue
            _resolved, discrepancy = await self.resolve_unknown_order(order)
            if discrepancy is not None:
                discrepancies.append(discrepancy)

        return (len(local_open), fills_recovered, discrepancies)

    async def _fetch_venue_order(self, local: Order) -> Order | None:
        """Ask the venue about one order, using the richest lookup available.

        Some venues can resolve a clientOrderId on its own; Binance additionally
        needs the symbol. Rather than pushing that quirk up into the
        reconciliation logic, adapters may expose ``fetch_order_for(order)``,
        which receives the whole local record. This prefers it when present and
        falls back to the interface method otherwise, so an adapter that does
        not need the extra context is not forced to implement anything.
        """
        richer = getattr(self._trading, "fetch_order_for", None)
        if callable(richer):
            # ``getattr`` erases the attribute's type, so the recovered call is
            # ``Any``. The cast restates the protocol's promise at the seam
            # rather than letting ``Any`` leak out of this function.
            return cast("Order | None", await richer(local))
        return await self._trading.fetch_order(
            local.tenant_id, local.account_id, local.client_order_id
        )

    async def _adopt_venue_state(
        self, local: Order, venue: Order
    ) -> Discrepancy | None:
        """Bring the local order into line with the venue's view.

        Fills first, then status. That order matters: applying a status of
        ``FILLED`` before the fills exist would leave an order that claims to be
        filled with nothing to show for it, and any consumer reading in between
        sees an inconsistent record.
        """
        recovered = 0
        for fill in venue.fills:
            # The venue view is a freshly built Order with its own internal id,
            # so its fills point at that id rather than the local record's.
            # Rebind before applying; the fill_id is unchanged, so dedupe against
            # a fill we already have still works.
            bound = (
                fill if fill.order_id == local.order_id
                else replace(fill, order_id=local.order_id)
            )
            stored = await self._store.record_fill(local.tenant_id, bound)
            applied = local.apply_fill(bound)
            if stored and applied:
                recovered += 1
                if self._positions is not None:
                    self._positions.apply_fill(
                        local.tenant_id,
                        local.account_id,
                        local.exchange,
                        local.symbol,
                        local.side,
                        bound,
                    )

        if venue.exchange_order_id and not local.exchange_order_id:
            local.exchange_order_id = venue.exchange_order_id

        previous = local.status
        changed = False
        if venue.status is not local.status:
            event = local.try_transition_to(
                venue.status,
                reason="Reconciliation: adopting the venue's authoritative status.",
                exchange_order_id=venue.exchange_order_id,
            )
            if event is not None:
                await self._store.record_event(local.tenant_id, event)
                changed = True
            else:
                # The venue's status is not reachable from ours. History is not
                # rewritten; the disagreement is reported.
                await self._store.set_reconciliation_state(
                    local.tenant_id,
                    local.order_id,
                    ReconciliationState.DIVERGED,
                    detail=(
                        f"Venue status {venue.status.value} is not a legal "
                        f"transition from {local.status.value}."
                    ),
                )
                await self._store.save_order(local)
                return Discrepancy(
                    discrepancy_type=DiscrepancyType.ORDER_STATUS_MISMATCH,
                    tenant_id=local.tenant_id,
                    account_id=local.account_id,
                    exchange=self.exchange,
                    summary=(
                        f"The venue reports {venue.status.value} for order "
                        f"{local.order_id} but that is not a legal transition "
                        f"from {local.status.value}. Local state was left "
                        f"unchanged and flagged as diverged."
                    ),
                    order_id=local.order_id,
                    client_order_id=local.client_order_id,
                    symbol=local.symbol,
                    local_value=local.status.value,
                    venue_value=venue.status.value,
                    repaired=False,
                )

        await self._store.save_order(local)

        if recovered:
            return Discrepancy(
                discrepancy_type=DiscrepancyType.MISSED_FILL,
                tenant_id=local.tenant_id,
                account_id=local.account_id,
                exchange=self.exchange,
                summary=(
                    f"Recovered {recovered} fill(s) for order {local.order_id} "
                    f"that the platform had not seen."
                ),
                order_id=local.order_id,
                client_order_id=local.client_order_id,
                symbol=local.symbol,
                local_value=str(local.filled_quantity),
                venue_value=str(venue.filled_quantity),
                repaired=True,
            )
        if changed:
            return Discrepancy(
                discrepancy_type=DiscrepancyType.ORDER_STATUS_MISMATCH,
                tenant_id=local.tenant_id,
                account_id=local.account_id,
                exchange=self.exchange,
                summary=(
                    f"Order {local.order_id} moved from {previous.value} to "
                    f"{venue.status.value} to match the venue."
                ),
                order_id=local.order_id,
                client_order_id=local.client_order_id,
                symbol=local.symbol,
                local_value=previous.value,
                venue_value=venue.status.value,
                repaired=True,
            )
        return None

    # ------------------------------------------------------------------
    # Balances and positions
    # ------------------------------------------------------------------
    async def _reconcile_balances(
        self, tenant_id: str, account_id: str
    ) -> list[Discrepancy]:
        """Compare venue balances against the platform's expectation.

        Reported, never corrected. A balance difference is a *symptom*; the
        cause is a missing fill, a fee model that is wrong, or a transfer made
        outside the platform. Overwriting the balance treats the symptom and
        destroys the evidence.
        """
        venue_balances = await self._account.fetch_balances(tenant_id, account_id)
        discrepancies: list[Discrepancy] = []
        for balance in venue_balances:
            if balance.total == 0:
                continue
            discrepancies.extend(
                self._compare_balance(tenant_id, account_id, balance)
            )
        return discrepancies

    def _compare_balance(
        self, tenant_id: str, account_id: str, balance: AccountBalance
    ) -> list[Discrepancy]:
        """Sanity-check one balance.

        With no independent local ledger of free/locked amounts, the only
        internally-checkable invariant is that the venue's own numbers are
        coherent. That is worth checking: a negative free balance or a locked
        amount exceeding the total means the response was misparsed, and acting
        on a misparsed balance is how a platform submits an order it cannot
        afford.
        """
        problems: list[Discrepancy] = []
        if balance.free < 0 or balance.locked < 0:
            problems.append(
                Discrepancy(
                    discrepancy_type=DiscrepancyType.BALANCE_MISMATCH,
                    tenant_id=tenant_id,
                    account_id=account_id,
                    exchange=self.exchange,
                    summary=(
                        f"Venue reported a negative component for "
                        f"{balance.asset}: free={balance.free}, "
                        f"locked={balance.locked}. The response is not "
                        f"trustworthy."
                    ),
                    symbol=balance.asset,
                    venue_value=str(balance.total),
                    repaired=False,
                )
            )
        return problems

    async def _reconcile_positions(
        self, tenant_id: str, account_id: str
    ) -> list[Discrepancy]:
        """Compare venue positions against fill-derived positions.

        The platform's positions are derived from fills, which is the only way
        to get a cost basis the venue does not provide. When the two quantities
        disagree the difference is reported and **not** overwritten: the local
        figure carries the entry price and realised PnL, and replacing it with a
        bare venue quantity would silently destroy the cost basis.
        """
        if self._positions is None:
            return []
        try:
            venue_positions = await self._account.fetch_positions(
                tenant_id, account_id
            )
        except AdapterError:
            return []

        discrepancies: list[Discrepancy] = []
        for venue in venue_positions:
            local = self._positions.get(account_id, self.exchange, venue.symbol)
            local_quantity = local.quantity if local is not None else Decimal(0)
            if local_quantity == venue.quantity:
                continue
            discrepancies.append(
                Discrepancy(
                    discrepancy_type=DiscrepancyType.POSITION_MISMATCH,
                    tenant_id=tenant_id,
                    account_id=account_id,
                    exchange=self.exchange,
                    summary=(
                        f"Position quantity for {venue.symbol} disagrees with "
                        f"the venue: local {local_quantity}, venue "
                        f"{venue.quantity}. Local state was NOT overwritten — "
                        f"it carries the cost basis. Investigate for a missed "
                        f"fill."
                    ),
                    symbol=venue.symbol,
                    local_value=str(local_quantity),
                    venue_value=str(venue.quantity),
                    repaired=False,
                )
            )
        return discrepancies

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------
    async def _record(
        self,
        tenant_id: str,
        incident_type: IncidentType,
        severity: IncidentSeverity,
        *,
        summary: str,
        account_id: str | None = None,
        symbol: str | None = None,
        order_id: str | None = None,
        client_order_id: str | None = None,
        error_code: ExecutionErrorCode | None = None,
        details: Mapping[str, object] | None = None,
    ) -> ExecutionIncident | None:
        incident = ExecutionIncident.create(
            tenant_id=tenant_id,
            account_id=account_id,
            incident_type=incident_type,
            severity=severity,
            summary=summary,
            exchange=self.exchange,
            symbol=symbol,
            order_id=order_id,
            client_order_id=client_order_id,
            error_code=error_code,
            details=details,
        )
        try:
            await self._incidents.record(incident)
        except Exception:  # noqa: BLE001 - reconciliation must not die on logging
            return incident
        return incident


def _incident_type_for(discrepancy: DiscrepancyType) -> IncidentType:
    """Map a discrepancy onto the incident taxonomy."""
    mapping = {
        DiscrepancyType.ORDER_STATUS_MISMATCH: IncidentType.ORDER_STATE_MISMATCH,
        DiscrepancyType.ORDER_MISSING_LOCALLY: IncidentType.UNEXPECTED_ORDER,
        DiscrepancyType.ORDER_MISSING_AT_VENUE: IncidentType.ORDER_STATE_MISMATCH,
        DiscrepancyType.MISSED_FILL: IncidentType.MISSING_FILL,
        DiscrepancyType.QUANTITY_MISMATCH: IncidentType.ORDER_STATE_MISMATCH,
        DiscrepancyType.BALANCE_MISMATCH: IncidentType.BALANCE_MISMATCH,
        DiscrepancyType.POSITION_MISMATCH: IncidentType.POSITION_MISMATCH,
        DiscrepancyType.UNKNOWN_ORDER_RESOLVED: IncidentType.UNKNOWN_ORDER_RESULT,
        DiscrepancyType.UNKNOWN_ORDER_NEVER_PLACED: IncidentType.UNKNOWN_ORDER_RESULT,
    }
    return mapping.get(discrepancy, IncidentType.RECONCILIATION_FAILURE)
