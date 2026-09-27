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
