"""The order store port and an in-memory implementation.

``trading-core`` is a pure library: it must not import Prisma, a database
driver, or anything else that would make it impossible to unit-test without
infrastructure. So persistence is expressed as a port here, and the durable
adapter lives in the service layer.

The contract encodes three rules that the rest of the system depends on:

1. **The exchange is authoritative for execution; the store is the durable
   record.** The store never invents an order state, and
   :meth:`OrderStore.record_event` appends rather than replaces so history
   survives a correction.
2. **Idempotency is enforced at the store, not just in memory.** Part 2's
   ``DuplicateOrderGuard`` is per-process; :meth:`OrderStore.reserve_client_order_id`
   is the cross-worker one, and behind it sits the unique index on
   ``(tenant_id, client_order_id)``.
3. **Nothing is deleted.** A cancelled or rejected order stays, with its event
   trail, because an audit that can be edited is not an audit.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum

from wlct_trading.enums import ExchangeId
from wlct_trading.orders import Fill, Order, OrderEvent

__all__ = [
    "ReconciliationState",
    "OrderStoreError",
    "DuplicateClientOrderId",
    "OrderNotFound",
    "ReservationOutcome",
    "OrderStore",
    "InMemoryOrderStore",
]


class ReconciliationState(str, Enum):
    """How much the local record can be trusted for one order.

    Kept deliberately separate from :class:`~wlct_trading.enums.OrderStatus`.
    ``OrderStatus`` describes what the *venue* believes about the order and has
    a strict legal-transition table; this describes what *we* believe about our
    own knowledge. Conflating the two would mean adding an ``UNKNOWN`` member to
    the lifecycle enum and then having to decide which real statuses it may
    legally transition to — a question with no correct answer, because an
    unknown order might be in any of them.

    So an order whose submission response was lost stays ``SUBMITTED`` (which is
    true: we did submit it) and is marked ``PENDING_RECONCILIATION`` here.
    """

    #: Local state matches the last thing the venue told us.
    IN_SYNC = "IN_SYNC"
    #: The submission outcome was never observed. The order may or may not
    #: exist at the venue. It must be queried by clientOrderId, never resubmitted.
    UNKNOWN = "UNKNOWN"
    #: Known to need a venue check — a missed stream event, a restart, a
    #: scheduled sweep.
    PENDING_RECONCILIATION = "PENDING_RECONCILIATION"
    #: Reconciliation ran and found a difference that could not be repaired
    #: automatically. An incident exists and a human is required.
    DIVERGED = "DIVERGED"

    @property
    def blocks_further_submission(self) -> bool:
        """Whether this state forbids acting on the order.

        An order of unknown fate must not be cancelled, replaced or resubmitted
        until its true state is established; every one of those actions has a
        different correct form depending on whether the order exists.
        """
        return self in (ReconciliationState.UNKNOWN, ReconciliationState.DIVERGED)


class OrderStoreError(Exception):
    """Base class for persistence failures."""


class OrderNotFound(OrderStoreError):
    """No order with the given identifier exists in the store."""


class DuplicateClientOrderId(OrderStoreError):
    """A different order already owns this client order id.

    Distinct from "the same order is being retried": that case returns the
    existing order so the caller can resume, rather than raising.
    """

    def __init__(self, client_order_id: str, existing_order_id: str) -> None:
        self.client_order_id = client_order_id
        self.existing_order_id = existing_order_id
        super().__init__(
            f"clientOrderId {client_order_id!r} is already used by order "
            f"{existing_order_id}. Refusing to submit a second order under the "
            f"same idempotency key."
        )


@dataclass(frozen=True, slots=True)
class ReservationOutcome:
    """Result of claiming a client order id."""

    #: True when this caller won the race and may proceed to submit.
    reserved: bool
    #: The order already holding the id, when the caller lost the race. The
    #: caller resumes this order rather than creating a new one — that is what
    #: turns a duplicate submission into a no-op instead of a second position.
    existing: Order | None = None

    @property
    def is_duplicate(self) -> bool:
        return not self.reserved


class OrderStore(ABC):
    """Durable record of orders, their events and their fills."""

    @abstractmethod
    async def reserve_client_order_id(
        self, tenant_id: str, client_order_id: str, order: Order
    ) -> ReservationOutcome:
        """Atomically claim ``client_order_id`` for ``order``.

        Must be atomic against concurrent callers in other processes. A
        SQL implementation gets this from the unique index; a Redis one from
        ``SET NX``. Returning ``reserved=False`` with the existing order is not
        an error — it is the mechanism that makes duplicate submission
        impossible.
        """

    @abstractmethod
    async def save_order(self, order: Order) -> Order:
        """Insert or update an order. Returns the stored version."""

    @abstractmethod
    async def get_order(self, tenant_id: str, order_id: str) -> Order | None:
        ...

    @abstractmethod
    async def get_by_client_order_id(
        self, tenant_id: str, client_order_id: str
    ) -> Order | None:
        """Look up by idempotency key.

        The recovery path after an ambiguous submission: the venue knows the
        order by this id even when the local record does not know the venue's.
        """

    @abstractmethod
    async def list_open_orders(
        self,
        tenant_id: str,
        account_id: str,
        *,
        exchange: ExchangeId | None = None,
        symbol: str | None = None,
    ) -> tuple[Order, ...]:
        ...

    @abstractmethod
    async def list_orders_needing_reconciliation(
        self,
        *,
        older_than_micros: int | None = None,
        limit: int = 100,
    ) -> tuple[Order, ...]:
        """Orders whose local state may not match the venue.

        Anything in a non-terminal state, plus anything explicitly flagged
        during an ambiguous submission.
        """

    @abstractmethod
    async def set_reconciliation_state(
        self,
        tenant_id: str,
        order_id: str,
        state: ReconciliationState,
        *,
        detail: str | None = None,
    ) -> None:
        """Record how much the local view of this order can be trusted.

        Must be durable and must be written *before* the risky operation, not
        after it. An engine that submits and then marks the order unknown loses
        the marker precisely in the scenario it exists for: the process dying
        mid-request.
        """

    @abstractmethod
    async def get_reconciliation_state(
        self, tenant_id: str, order_id: str
    ) -> ReconciliationState:
        """Defaults to :attr:`ReconciliationState.IN_SYNC` for unknown orders."""

    @abstractmethod
    async def record_event(self, tenant_id: str, event: OrderEvent) -> OrderEvent:
        """Append one event. Never overwrites an earlier event.

        ``tenant_id`` is passed alongside rather than read from the event: the
        Part 2 :class:`~wlct_trading.orders.OrderEvent` is an order-scoped value
        object with no tenant field, and every store lookup in this platform is
        tenant-scoped to make cross-tenant reads structurally impossible.
        """

    @abstractmethod
    async def list_events(
        self, tenant_id: str, order_id: str
    ) -> tuple[OrderEvent, ...]:
        ...

    @abstractmethod
    async def record_fill(self, tenant_id: str, fill: Fill) -> bool:
        """Append a fill. Returns False if this fill was already recorded.

        Deduplication is by ``fill_id``, because both the private stream and the
        REST reconciliation path deliver the same trade and neither is
        suppressible.
        """

    @abstractmethod
    async def list_fills(self, tenant_id: str, order_id: str) -> tuple[Fill, ...]:
        ...


class InMemoryOrderStore(OrderStore):
    """Reference implementation.

    Used by the test-suite and by paper trading. It is a faithful model of the
    durable contract — including the uniqueness constraint and the
    append-only event log — so a behaviour that passes here is a behaviour the
    SQL adapter must also produce.

    Not a production store: it is process-local and lost on restart. The engine
    warns when it is paired with live trading.
    """

    __slots__ = (
        "_orders",
        "_by_client_order_id",
        "_events",
        "_fills",
        "_fill_ids",
        "_needs_reconciliation",
        "_reconciliation_state",
    )

    def __init__(self) -> None:
        self._orders: dict[tuple[str, str], Order] = {}
        self._by_client_order_id: dict[tuple[str, str], str] = {}
        self._events: dict[tuple[str, str], list[OrderEvent]] = {}
        self._fills: dict[tuple[str, str], list[Fill]] = {}
        self._fill_ids: set[tuple[str, str]] = set()
        self._needs_reconciliation: set[tuple[str, str]] = set()
        self._reconciliation_state: dict[tuple[str, str], ReconciliationState] = {}

    @property
    def is_durable(self) -> bool:
        """Always False. Checked at startup before live trading is permitted."""
        return False

    async def reserve_client_order_id(
        self, tenant_id: str, client_order_id: str, order: Order
    ) -> ReservationOutcome:
        key = (tenant_id, client_order_id)
        existing_id = self._by_client_order_id.get(key)
        if existing_id is not None:
            existing = self._orders.get((tenant_id, existing_id))
            if existing is not None and existing.order_id == order.order_id:
                # Same order retrying: it already owns the reservation.
                return ReservationOutcome(reserved=True, existing=existing)
            return ReservationOutcome(reserved=False, existing=existing)
        self._by_client_order_id[key] = order.order_id
        self._orders[(tenant_id, order.order_id)] = order
        return ReservationOutcome(reserved=True)

    async def save_order(self, order: Order) -> Order:
        self._orders[(order.tenant_id, order.order_id)] = order
        if order.client_order_id:
            self._by_client_order_id.setdefault(
                (order.tenant_id, order.client_order_id), order.order_id
            )
        return order

    async def get_order(self, tenant_id: str, order_id: str) -> Order | None:
        return self._orders.get((tenant_id, order_id))

    async def get_by_client_order_id(
        self, tenant_id: str, client_order_id: str
    ) -> Order | None:
        order_id = self._by_client_order_id.get((tenant_id, client_order_id))
        if order_id is None:
            return None
        return self._orders.get((tenant_id, order_id))

    async def list_open_orders(
        self,
        tenant_id: str,
        account_id: str,
        *,
        exchange: ExchangeId | None = None,
        symbol: str | None = None,
    ) -> tuple[Order, ...]:
        from wlct_trading.enums import TERMINAL_ORDER_STATUSES

        return tuple(
            order
            for (owner, _order_id), order in self._orders.items()
            if owner == tenant_id
            and order.account_id == account_id
            and order.status not in TERMINAL_ORDER_STATUSES
            and (exchange is None or order.exchange is exchange)
            and (symbol is None or order.symbol == symbol)
        )

    async def list_orders_needing_reconciliation(
        self,
        *,
        older_than_micros: int | None = None,
        limit: int = 100,
    ) -> tuple[Order, ...]:
        from wlct_trading.enums import TERMINAL_ORDER_STATUSES

        cutoff = older_than_micros
        selected: list[Order] = []
        for key, order in self._orders.items():
            flagged = key in self._needs_reconciliation
            open_state = order.status not in TERMINAL_ORDER_STATUSES
            if not (flagged or open_state):
                continue
            if cutoff is not None and order.updated_at > cutoff:
                continue
            selected.append(order)
            if len(selected) >= limit:
                break
        return tuple(selected)

    async def set_reconciliation_state(
        self,
        tenant_id: str,
        order_id: str,
        state: ReconciliationState,
        *,
        detail: str | None = None,
    ) -> None:
        if state is ReconciliationState.IN_SYNC:
            self._reconciliation_state.pop((tenant_id, order_id), None)
            self._needs_reconciliation.discard((tenant_id, order_id))
            return
        self._reconciliation_state[(tenant_id, order_id)] = state
        self._needs_reconciliation.add((tenant_id, order_id))

    async def get_reconciliation_state(
        self, tenant_id: str, order_id: str
    ) -> ReconciliationState:
        return self._reconciliation_state.get(
            (tenant_id, order_id), ReconciliationState.IN_SYNC
        )

    async def record_event(self, tenant_id: str, event: OrderEvent) -> OrderEvent:
        self._events.setdefault((tenant_id, event.order_id), []).append(event)
        return event

    async def list_events(
        self, tenant_id: str, order_id: str
    ) -> tuple[OrderEvent, ...]:
        return tuple(self._events.get((tenant_id, order_id), ()))

    async def record_fill(self, tenant_id: str, fill: Fill) -> bool:
        marker = (tenant_id, fill.fill_id)
        if marker in self._fill_ids:
            return False
        self._fill_ids.add(marker)
        self._fills.setdefault((tenant_id, fill.order_id), []).append(fill)
        return True

    async def list_fills(self, tenant_id: str, order_id: str) -> tuple[Fill, ...]:
        return tuple(self._fills.get((tenant_id, order_id), ()))

    # -- Test and diagnostic helpers -----------------------------------
    def order_count(self) -> int:
        return len(self._orders)

    def all_orders(self) -> tuple[Order, ...]:
        return tuple(self._orders.values())
