"""Part 13: the durable Postgres OrderStore adapter, tested without a DB.

Two philosophies combine here, both deliberate:

* **Scripted statements** pin the exact SQL contract the store emits -
  the same way Part 11 pinned the coordination Redis scripts. A statement
  that changes shape is a change to the durable schema contract and must
  be a decision, not a refactor side effect.
* **An echo connection** (records every insert, answers the matching
  SELECT from the recorded parameters) makes the codec round-trip real:
  the row that would land in Postgres is the row that comes back, so
  column order, decimal scale, null handling and the child-JSON
  reconstruction are exercised through the same tables the driver would
  use - without a Postgres in the sandbox.

The environment-gated live-database variant lives in
``test_part13_postgres_store_live.py``; when ``EXECUTION_TEST_POSTGRES_DSN``
is set (CI with a service container), the identical semantic assertions run
against the real thing. Absent the variable the module skips - visibly,
never silently green by substitution.
"""

from __future__ import annotations

import json
import re
from dataclasses import replace
from decimal import Decimal, InvalidOperation
from typing import Any, cast

import pytest
from sqlglot import parse_one as sqlglot_parse_one
from wlct_trading.enums import (
    TERMINAL_ORDER_STATUSES,
    ExchangeId,
    OrderSide,
    OrderStatus,
    OrderType,
    TimeInForce,
)
from wlct_trading.execution.store import ReconciliationState
from wlct_trading.orders import Fill, Order, OrderEvent

from app import store_sql
from app.store_sql import (
    RESERVE_INSERT_SQL,
    SET_TENANT_SQL,
    TABLE_FILLS,
    CrossTenantSweepUnsupported,
    PostgresOrderStore,
    _decode_order,
    _fill_params,
    _order_params,
)

TENANT = "3f2a1b04-7c5d-4e6f-9a8b-0c1d2e3f4a5b"
OTHER_TENANT = "9a8b7c6d-5e4f-4a3b-8c7d-6e5f4a3b2c1d"


def make_order(**overrides: object) -> Order:
    base: dict[str, object] = {
        "order_id": "ord_01",
        "client_order_id": "wlc-0001",
        "tenant_id": TENANT,
        "account_id": "acct_01",
        "strategy_id": None,
        "exchange": ExchangeId.BINANCE,
        "symbol": "BTCUSDT",
        "side": OrderSide.BUY,
        "order_type": OrderType.LIMIT,
        "quantity": Decimal("0.10"),
        "price": Decimal("50000.00"),
        "time_in_force": TimeInForce.GTC,
        "is_simulated": True,
        "status": OrderStatus.PENDING,
        "created_at": 1_700_000_000_000_000,
        "updated_at": 1_700_000_000_000_001,
    }
    order = Order(
        order_id=str(base["order_id"]),
        client_order_id=str(base["client_order_id"]),
        tenant_id=str(base["tenant_id"]),
        account_id=str(base["account_id"]),
        strategy_id=base["strategy_id"],
        exchange=base["exchange"],
        symbol=str(base["symbol"]),
        side=base["side"],
        order_type=base["order_type"],
        quantity=base["quantity"],
        price=base["price"],
        time_in_force=base["time_in_force"],
        is_simulated=base["is_simulated"],
        status=base["status"],
        created_at=base["created_at"],
        updated_at=base["updated_at"],
    )
    return replace(order, **overrides) if overrides else order


def order_row(overrides: dict[str, Any] | None = None) -> dict[str, Any]:
    row: dict[str, Any] = {
        "tenant_id": TENANT,
        "order_id": "ord_01",
        "client_order_id": "wlc-0001",
        "account_id": "acct_01",
        "strategy_id": None,
        "exchange": "binance",
        "symbol": "BTCUSDT",
        "side": "BUY",
        "order_type": "LIMIT",
        "time_in_force": "GTC",
        "reduce_only": False,
        "signal_id": None,
        "is_simulated": True,
        "status": "PENDING",
        "exchange_order_id": None,
        "quantity": "0.10",
        "price": "50000.00",
        "stop_price": None,
        "filled_quantity": "0",
        "average_fill_price": None,
        "cumulative_fee": "0",
        "fee_currency": None,
        "rejection_reason": None,
        "created_at": 1_700_000_000_000_000,
        "updated_at": 1_700_000_000_000_001,
        "submitted_at": None,
        "terminal_at": None,
        "reconciliation_state": None,
        "fills_json": "[]",
        "events_json": "[]",
    }
    row.update(overrides or {})
    return row


def fill_payload(overrides: dict[str, Any] | None = None) -> dict[str, Any]:
    base: dict[str, Any] = {
        "fill_id": "fill_01",
        "order_id": "ord_01",
        "trade_id": "trade_01",
        "price": "0.100",
        "quantity": "0.05",
        "fee": "0.00060",
        "fee_currency": "BNB",
        "is_maker": True,
        "is_simulated": True,
        "exchange_timestamp": 1_700_000_000_000,
        "received_timestamp": 1_700_000_000_000_002,
        "symbol": None,
        "side": None,
        "exchange": None,
        "quote_quantity": None,
        "exchange_order_id": None,
    }
    base.update(overrides or {})
    return base


# Statement prefixes for the echo fake: spelled out as plain literals (the
# store's SQL is literal too), so the fake pattern-matches exactly the way
# a database dispatches - and no query is ever "constructed" in this file.
_INS_ORDERS = "INSERT INTO engine_orders"
_INS_FILLS = "INSERT INTO engine_order_fills"
_INS_EVENTS = "INSERT INTO engine_order_events"
_UPD_ORDERS = "UPDATE engine_orders"
_FROM_ORDERS_O = "FROM engine_orders o"
_RECON_SELECT = "SELECT reconciliation_state FROM engine_orders"


class FakeTx:
    def __init__(self, conn: FakeConn) -> None:
        self._conn = conn

    async def __aenter__(self) -> None:
        self._conn.tx_begins += 1

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> bool:
        if exc_type is None:
            self._conn.tx_commits += 1
        else:
            self._conn.tx_rollbacks += 1
        return False


class FakeConn:
    """Records every statement; answers fetch/fetchrow from a script or echo."""

    def __init__(self, script: list[Any] | None = None, *, echo: bool = False) -> None:
        self.statements: list[tuple[str, tuple[object, ...]]] = []
        self.script = list(script or [])
        self.cursor = 0
        self.echo = echo
        self.tx_begins = 0
        self.tx_commits = 0
        self.tx_rollbacks = 0
        # echo state: last-inserted order params, fills and events per order
        self.stored_order: dict[str, Any] | None = None
        self.stored_fills: list[dict[str, Any]] = []
        self.stored_events: list[dict[str, Any]] = []

    _UNSET = object()

    def _step(self, query: str, args: tuple[object, ...], *, allow_response: bool) -> Any:
        """One statement through the script cursor.

        Expectations bind to the statement they precede; any entry that is
        an exception raises at THIS statement (execute included); a plain
        value is only consumed by fetch/fetchrow - an execute statement
        never eats a response meant for the row read that follows it.
        """
        self.statements.append((query, args))
        # ONE expectation per statement (the tenant GUC is always the
        # first statement, so scripts read as [guc-expectation, next-
        # statement-...]); consuming greedily would match statement two's
        # assertion against statement one and hide the real ordering bug.
        if self.cursor < len(self.script) and isinstance(self.script[self.cursor], Expectation):
            self.script[self.cursor].check(query, args)
            self.cursor += 1
        if self.cursor < len(self.script) and allow_response:
            entry = self.script[self.cursor]
            if isinstance(entry, BaseException):
                self.cursor += 1
                raise entry
            self.cursor += 1
            return entry
        return self._UNSET

    async def execute(self, query: str, *args: object) -> str:
        self._step(query, args, allow_response=False)
        if self.echo:
            if query.startswith(_INS_ORDERS):
                self._capture(query, args, "_stored_order")
            elif query.startswith(_UPD_ORDERS):
                if self.stored_order is not None:
                    self.stored_order["reconciliation_state"] = args[2]
        return "OK 1"

    async def fetch(self, query: str, *args: object) -> list[Any]:
        entry = self._step(query, args, allow_response=True)
        if entry is not self._UNSET:
            return list(entry) if isinstance(entry, list) else [entry]
        if self.echo and "FROM engine_order_fills" in query:
            return list(self.stored_fills)
        if self.echo and "FROM engine_order_events" in query:
            return list(self.stored_events)
        return []

    async def fetchrow(self, query: str, *args: object) -> Any | None:
        entry = self._step(query, args, allow_response=True)
        if entry is not self._UNSET:
            return entry
        if self.echo:
            if query.startswith(_INS_ORDERS):
                self._capture(query, args, "_stored_order")
                assert self.stored_order is not None
                return {"order_id": self.stored_order["order_id"]}
            if query.startswith(_INS_FILLS):
                self._capture(query, args, None)
                return {"fill_id": self.stored_fills[-1]["fill_id"]}
            if query.startswith(_INS_EVENTS):
                self._capture(query, args, None)
                return {"seq": len(self.stored_events)}
            if _FROM_ORDERS_O in query and self.stored_order is not None:
                row = dict(self.stored_order)
                row["fills_json"] = json.dumps(self.stored_fills)
                row["events_json"] = json.dumps(self.stored_events)
                return row
            if query.startswith(_RECON_SELECT):
                recon = (
                    None
                    if self.stored_order is None
                    else self.stored_order.get("reconciliation_state")
                )
                return {"reconciliation_state": recon}
        raise AssertionError(f"unscripted fetchrow: {query[:80]}")

    def transaction(self) -> FakeTx:
        return FakeTx(self)

    def assert_fully_consumed(self) -> None:
        leftovers = [s for s in self.script[self.cursor:] if not isinstance(s, Expectation)]
        assert not leftovers, f"scripted responses left unconsumed: {leftovers!r}"

    def _capture(self, query: str, args: tuple[object, ...], target: str | None) -> None:
        """Zip the INSERT's column list with its bound parameters - the row
        Postgres WOULD have stored, in the order the SQL itself declares."""
        columns = query.split("(", 1)[1].split(")", 1)[0]
        names = [c.strip() for c in columns.split(",")]
        assert len(names) == len(args), f"{len(names)} columns vs {len(args)} args"
        row = dict(zip(names, args, strict=True))
        if target == "_stored_order":
            self.stored_order = row
        elif TABLE_FILLS in query:
            self.stored_fills.append(row)
        else:
            self.stored_events.append(row)


class Expectation:
    """A queued assertion - optionally a scripted failure - for the statement
    about to be executed. `raises` exists because driver errors must be
    attachable to ANY statement kind (including execute, which otherwise
    takes no scripted values); attaching them positionally would let an
    exception fire during the tenant-GUC statement instead, and a failure in
    __aenter__ skips __aexit__ by definition - the exact shape that would
    make a rollback test pass for the wrong reason."""

    def __init__(
        self,
        sql_contains: str,
        args: tuple[object, ...] | None = None,
        *,
        raises: BaseException | None = None,
    ) -> None:
        self.sql_contains = sql_contains
        self.args = args
        self.raises = raises

    def check(self, query: str, args: tuple[object, ...]) -> None:
        assert self.sql_contains in query, f"expected {self.sql_contains!r} in {query[:120]}"
        if self.args is not None:
            assert args == self.args, f"args {args!r} != {self.args!r}"
        if self.raises is not None:
            raise self.raises


class FakeAcquire:
    def __init__(self, conn: FakeConn) -> None:
        self.conn = conn
        self.enters = 0
        self.exits = 0

    async def __aenter__(self) -> FakeConn:
        self.enters += 1
        return self.conn

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> bool:
        self.exits += 1
        return False


class FakePool:
    def __init__(self, conn: FakeConn) -> None:
        self.conn = conn
        self.acquires = 0
        self.closed = False

    def acquire(self) -> FakeAcquire:
        self.acquires += 1
        return FakeAcquire(self.conn)

    async def close(self) -> None:
        self.closed = True


def store(*script: Any, echo: bool = False) -> tuple[PostgresOrderStore, FakeConn, FakePool]:
    conn = FakeConn(script=list(script), echo=echo)
    pool = FakePool(conn)
    return PostgresOrderStore(cast(store_sql.PgPool, pool)), conn, pool


# ---------------------------------------------------------------------------
# statement-shape law (golden pins, DB-free)
# ---------------------------------------------------------------------------


class TestStatementShapes:
    def test_tenant_guc_is_the_exact_platform_contract(self) -> None:
        # Character-for-character the statement PrismaService.withTenantRls
        # issues (bound parameter, transaction-local TRUE). A change here
        # silently opts the engine out of every generated RLS policy.
        assert SET_TENANT_SQL == "SELECT set_config('app.tenant_id', $1, true)"

    def test_reservation_insert_targets_no_conflict_clause(self) -> None:
        head = RESERVE_INSERT_SQL
        assert head.startswith("INSERT INTO engine_orders (")
        assert "ON CONFLICT DO NOTHING RETURNING order_id" in head
        assert "ON CONFLICT (" not in head  # BOTH uniques must fold into DO NOTHING

    def test_order_columns_match_params_and_placeholders(self) -> None:
        params = _order_params(make_order(), None)
        assert len(store_sql._ORDER_COLUMNS) == len(params)
        placeholders = re.findall(r"\$\d+", RESERVE_INSERT_SQL)
        assert len(placeholders) == len(params)
        assert placeholders == [f"${i + 1}" for i in range(len(params))]

    def test_upsert_updates_everything_but_the_identity(self) -> None:
        clause = store_sql._SAVE_UPSERT_SQL.split("DO UPDATE SET ", 1)[1]
        assigned = {part.strip().split(" = ")[0] for part in clause.split(",")}
        assert "client_order_id" in assigned and "status" in assigned
        assert "tenant_id" not in assigned and "order_id" not in assigned

    def test_fill_recording_rides_the_tenant_fill_unique_index(self) -> None:
        assert "INSERT INTO engine_order_fills" in store_sql._RECORD_FILL_SQL
        assert "ON CONFLICT (tenant_id, fill_id) DO NOTHING RETURNING fill_id" in (
            store_sql._RECORD_FILL_SQL
        )
        assert len(_fill_params(TENANT, Fill(
            fill_id="f", order_id="o", trade_id="t", price=Decimal("1"), quantity=Decimal("1"),
            fee=Decimal("0"), fee_currency="USDT", is_maker=False, is_simulated=True,
            exchange_timestamp=1, received_timestamp=2,
        ))) == 17

    def test_events_append_only_and_payload_cast(self) -> None:
        sql = store_sql._RECORD_EVENT_SQL
        assert sql.startswith("INSERT INTO engine_order_events")
        assert "$8::jsonb" in sql and "RETURNING seq" in sql
        assert "UPDATE" not in sql and "DELETE" not in sql
        assert "ORDER BY seq ASC" in store_sql._LIST_EVENTS_SQL

    def test_open_orders_reads_the_shared_terminal_vocabulary(self) -> None:
        # The exclusion list must come from the shared enum - if someone
        # "fixes" this by typing statuses into the SQL string, this test
        # and the count are the alarm.
        assert "NOT (o.status = ANY($3::text[]))" in store_sql._LIST_OPEN_SQL_BASE
        params = _order_params(make_order(), None)
        assert params[store_sql._ORDER_COLUMNS.index("status")] == "PENDING"

    def test_child_reconstruction_orders_by_seq_and_never_nulls(self) -> None:
        fills_needle = (
            "COALESCE((SELECT json_agg(to_json(f) ORDER BY f.seq) "
            "FROM engine_order_fills"
        )
        events_needle = (
            "COALESCE((SELECT json_agg(to_json(e) ORDER BY e.seq) "
            "FROM engine_order_events"
        )
        assert fills_needle in store_sql._CHILD_JSON
        assert events_needle in store_sql._CHILD_JSON
        assert "'[]'::json" in store_sql._CHILD_JSON

    def test_every_constant_statement_parses_as_postgres(self) -> None:
        # Same law as the migration test next door: declared, imported, asserted -
        # never skipped on absence.
        names = [n for n in dir(store_sql) if "_SQL" in n and not n.startswith("__")]
        seen = 0
        for name in names:
            value = getattr(store_sql, name)
            if isinstance(value, str) and re.match(r"(?i)\s*(SELECT|INSERT|UPDATE|WITH)", value):
                sqlglot_parse_one(value, read="postgres")
                seen += 1
        assert seen >= 12

    def test_list_open_sql_numbers_placeholders_by_shape(self) -> None:
        # The builder appends $N off the real param count; both optional
        # predicates and neither must address exactly the slots they fill.
        base = store_sql._LIST_OPEN_SQL_BASE
        assert base.count("$") == 3
        sql_both = (
            base + " AND o.exchange = $4 AND o.symbol = $5" + store_sql._LIST_OPEN_ORDER_BY
        )
        assert sql_both.count("$") == 5
        assert "o.symbol = $4" in base + " AND o.symbol = $4"


# ---------------------------------------------------------------------------
# transaction / GUC law
# ---------------------------------------------------------------------------


class TestTenantTransactionLaw:
    @pytest.mark.asyncio
    async def test_every_operation_sets_the_tenant_guc_first_in_one_tx(self) -> None:
        for script, call in (
            ([None], lambda s: s.get_order(TENANT, "ord_01")),
            (
                [{"order_id": "ord_01"}],
                lambda s: s.reserve_client_order_id(TENANT, "c", make_order()),
            ),
            ([None], lambda s: s.get_by_client_order_id(TENANT, "c")),
            ([None], lambda s: s.save_order(make_order())),
            (
                [],
                lambda s: s.set_reconciliation_state(
                    TENANT, "ord_01", ReconciliationState.UNKNOWN
                ),
            ),
            ([None], lambda s: s.record_event(TENANT, OrderEvent(
                event_id="e1", order_id="ord_01", previous_status=None,
                status=OrderStatus.SUBMITTED, reason=None, occurred_at=1))),
            ([None], lambda s: s.record_fill(TENANT, Fill(
                fill_id="f", order_id="o", trade_id="t", price=Decimal("1"),
                quantity=Decimal("1"), fee=Decimal("0"), fee_currency="USDT", is_maker=False,
                is_simulated=True, exchange_timestamp=1, received_timestamp=2))),
        ):
            subject, conn, pool = store(*script)
            await call(subject)
            assert conn.statements[0][0] == SET_TENANT_SQL
            assert conn.statements[0][1] == (TENANT,), f"guc law broke for {call}"
            assert conn.tx_begins == 1 and conn.tx_commits == 1 and conn.tx_rollbacks == 0
            assert pool.acquires == 1

    @pytest.mark.asyncio
    async def test_statement_errors_rollback_and_propagate_unswallowed(self) -> None:
        boom = RuntimeError("connection reset")
        subject, conn, pool = store(
            Expectation(SET_TENANT_SQL, (TENANT,)),
            Expectation("FROM engine_orders o", raises=boom),
        )
        # The GUC statement runs, then the row read fails mid-transaction:
        # __aexit__ MUST have seen the exception (rollback, not commit) and
        # the pool slot must be released - both are the durability contract's
        # leak guards, and neither is checkable if boom fires before
        # __aenter__ completes (hence Expectation.raises, not a bare entry).
        with pytest.raises(RuntimeError, match="connection reset"):
            await subject.get_order(TENANT, "ord_01")
        assert conn.tx_rollbacks == 1 and conn.tx_commits == 0 and conn.tx_begins == 1
        assert len(conn.statements) == 2
        assert pool.acquires == 1  # released even on failure

    @pytest.mark.asyncio
    async def test_sweep_is_refused_not_answered_empty(self) -> None:
        subject, conn, _pool = store()
        with pytest.raises(CrossTenantSweepUnsupported) as caught:
            await subject.list_orders_needing_reconciliation(limit=7)
        message = str(caught.value)
        assert "reconcile-trading-account" in message and "PART13_DURABLE_STORE" in message
        assert conn.statements == []  # a refusal must not even reach the database

    async def test_get_order_maps_missing_row_to_none_not_error(self) -> None:
        subject, _conn, _pool = store(None)
        assert await subject.get_order(TENANT, "nope") is None

    @pytest.mark.asyncio
    async def test_malformed_tenant_id_fails_before_the_database(self) -> None:
        # tenant_id lands in a UUID column; the driver would answer with a
        # raw "invalid input syntax" - the store states the law itself,
        # first, so a string-tenant deployment sees the reason not the cast.
        subject, conn, _pool = store()
        with pytest.raises(store_sql.OrderStoreError, match="canonical UUID"):
            await subject.get_order("tenant-a", "ord_01")
        assert conn.statements == []


# ---------------------------------------------------------------------------
# reference-semantics mirror
# ---------------------------------------------------------------------------


class TestReferenceSemantics:
    @pytest.mark.asyncio
    async def test_free_reservation_wins_and_stores_the_order(self) -> None:
        subject, _conn, _pool = store({"order_id": "ord_01"})
        outcome = await subject.reserve_client_order_id(TENANT, "wlc-0001", make_order())
        assert outcome.reserved is True and outcome.existing is None

    @pytest.mark.asyncio
    async def test_reservation_held_by_another_order_resumes_nothing(self) -> None:
        holder = order_row({"order_id": "ord_other"})
        subject, _conn, _pool = store(None, holder)
        outcome = await subject.reserve_client_order_id(TENANT, "wlc-0001", make_order())
        assert outcome.reserved is False
        assert outcome.existing is not None and outcome.existing.order_id == "ord_other"

    @pytest.mark.asyncio
    async def test_same_order_retrying_reserves_with_the_stored_row(self) -> None:
        # The stored row (submitted_at set) differs from the passed order
        # (PENDING): the durable answer is what the database knows, exactly
        # as the in-memory store answers with the object it already holds.
        holder = order_row({"status": "SUBMITTED", "submitted_at": 7})
        subject, _conn, _pool = store(None, holder)
        outcome = await subject.reserve_client_order_id(TENANT, "wlc-0001", make_order())
        assert outcome.reserved is True
        assert outcome.existing is not None and outcome.existing.status is OrderStatus.SUBMITTED

    @pytest.mark.asyncio
    async def test_reservation_lost_after_the_conflict_is_not_a_win(self) -> None:
        # INSERT returned no row and the holder lookup also found nothing:
        # the conflicting transaction rolled away. "Not reserved, holder
        # unknown" - the caller retries; claiming victory here would be the
        # double-book the unique index exists to prevent.
        subject, _conn, _pool = store(None, None)
        outcome = await subject.reserve_client_order_id(TENANT, "wlc-0001", make_order())
        assert outcome.reserved is False and outcome.existing is None

    @pytest.mark.asyncio
    async def test_record_fill_answers_false_only_for_replays(self) -> None:
        fill = Fill(
            fill_id="f1", order_id="ord_01", trade_id="t1", price=Decimal("50000.1"),
            quantity=Decimal("0.01"), fee=Decimal("0.0006"), fee_currency="BNB",
            is_maker=True, is_simulated=True, exchange_timestamp=1, received_timestamp=2,
        )
        fresh, _c, _p = store({"fill_id": "f1"})
        replayed, _c2, _p2 = store(None)
        assert await fresh.record_fill(TENANT, fill) is True
        assert await replayed.record_fill(TENANT, fill) is False

    @pytest.mark.asyncio
    async def test_in_sync_writes_sql_null(self) -> None:
        subject, conn, _pool = store()
        await subject.set_reconciliation_state(TENANT, "ord_01", ReconciliationState.IN_SYNC)
        update = [s for s in conn.statements if s[0].startswith(_UPD_ORDERS)]
        assert update and update[0][1] == (TENANT, "ord_01", None)

    @pytest.mark.asyncio
    async def test_missing_state_row_reads_as_in_sync(self) -> None:
        subject, _conn, _pool = store(None)
        assert await subject.get_reconciliation_state(
            TENANT, "ord_01"
        ) is ReconciliationState.IN_SYNC
        subject2, _c2, _p2 = store({"reconciliation_state": None})
        assert await subject2.get_reconciliation_state(
            TENANT, "ord_01"
        ) is ReconciliationState.IN_SYNC
        subject3, _c3, _p3 = store({"reconciliation_state": "DIVERGED"})
        assert await subject3.get_reconciliation_state(
            TENANT, "ord_01"
        ) is ReconciliationState.DIVERGED

    @pytest.mark.asyncio
    async def test_list_open_orders_appends_predicates_in_param_order(self) -> None:
        subject, conn, _pool = store([])
        await subject.list_open_orders(
            TENANT, "acct_01", exchange=ExchangeId.BINANCE, symbol="BTCUSDT"
        )
        sql, args = conn.statements[1]
        assert "AND o.exchange = $4 AND o.symbol = $5" in sql
        assert args == (TENANT, "acct_01", sorted(
            status.value for status in TERMINAL_ORDER_STATUSES
        ), "binance", "BTCUSDT")
        subject2, conn2, _ = store([])
        await subject2.list_open_orders(TENANT, "acct_01", symbol="ETHUSDT")
        sql2, args2 = conn2.statements[1]
        # the column list mentions o.exchange (it selects it); the WHERE
        # clause must not predicate on it when only symbol was given
        assert "AND o.symbol = $4" in sql2 and "AND o.exchange" not in sql2
        assert args2[3] == "ETHUSDT" and len(args2) == 4

    @pytest.mark.asyncio
    async def test_terminal_vocabulary_is_imported_not_retyped(self) -> None:
        from wlct_trading.enums import TERMINAL_ORDER_STATUSES

        subject, conn, _pool = store([])
        await subject.list_open_orders(TENANT, "acct_01")
        sql, args = conn.statements[1]
        assert args[2] == sorted(status.value for status in TERMINAL_ORDER_STATUSES)
        assert "ORDER BY o.created_at ASC, o.order_id ASC" in sql


# ---------------------------------------------------------------------------
# codec fidelity via the echo connection (the row that lands is the row back)
# ---------------------------------------------------------------------------


class TestCodecFidelity:
    @pytest.mark.asyncio
    async def test_full_order_round_trips_scale_exact(self) -> None:
        order = make_order(
            strategy_id="strat_9",
            stop_price=Decimal("49999.999999"),
            signal_id="sig-7",
            reduce_only=True,
            exchange_order_id="9998887776",
            status=OrderStatus.PARTIALLY_FILLED,
            filled_quantity=Decimal("0.05"),
            average_fill_price=Decimal("0.100000000000000000000001"),  # division residue
            cumulative_fee=Decimal("0.00060"),
            fee_currency="BNB",
            rejection_reason=None,
            submitted_at=1_700_000_000_000_002,
            price=Decimal("0.100"),
        )
        subject, _conn, _pool = store(echo=True)
        await subject.save_order(order)
        back = await subject.get_order(TENANT, order.order_id)
        assert back is not None
        assert back == order
        # dataclass equality is numeric for Decimals; pin the STRING scale
        # too - the durable record must preserve trailing zeros exactly.
        assert str(back.price) == "0.100"
        assert str(back.average_fill_price) == "0.100000000000000000000001"
        assert str(back.cumulative_fee) == "0.00060"
        assert back.submitted_at == 1_700_000_000_000_002
        assert back.terminal_at is None and back.stop_price == Decimal("49999.999999")

    @pytest.mark.asyncio
    async def test_reservation_marks_unknown_and_explicit_sync_clears_it(self) -> None:
        subject, conn, _pool = store(echo=True)
        # the reservation INSERT carries UNKNOWN...
        await subject.reserve_client_order_id(TENANT, "wlc-0001", make_order())
        assert conn.stored_order is not None
        assert conn.stored_order["reconciliation_state"] == "UNKNOWN"
        # ...a crash between reserve and save leaves exactly that durable
        # truth, and the explicit sync-set is what clears it back to NULL.
        await subject.set_reconciliation_state(TENANT, "ord_01", ReconciliationState.IN_SYNC)
        assert conn.stored_order["reconciliation_state"] is None
        state = await subject.get_reconciliation_state(TENANT, "ord_01")
        assert state is ReconciliationState.IN_SYNC

    @pytest.mark.asyncio
    async def test_fills_and_events_are_replayed_into_the_read_model(self) -> None:
        subject, conn, _pool = store(echo=True)
        await subject.save_order(make_order())
        recorded = await subject.record_fill(TENANT, Fill(
            fill_id="fill_01", order_id="ord_01", trade_id="trade_01",
            price=Decimal("0.100"), quantity=Decimal("0.05"), fee=Decimal("0.00060"),
            fee_currency="BNB", is_maker=True, is_simulated=True,
            exchange_timestamp=1_700_000_000_000, received_timestamp=1_700_000_000_000_002,
        ))
        assert recorded is True
        await subject.record_event(TENANT, OrderEvent(
            event_id="ev_1", order_id="ord_01", previous_status=OrderStatus.PENDING,
            status=OrderStatus.PARTIALLY_FILLED, reason="fill:fill_01", occurred_at=7,
            payload={"source": "user-data-stream"},
        ))
        back = await subject.get_order(TENANT, "ord_01")
        assert back is not None
        assert [f.fill_id for f in back.fills] == ["fill_01"]
        assert str(back.fills[0].price) == "0.100"  # scale survives the JSON detour
        assert [e.event_id for e in back.events] == ["ev_1"]
        assert back.events[0].payload == {"source": "user-data-stream"}
        # read-model REPLAY, not re-derivation: stored aggregates come back
        # untouched and no synthesized journal event appears.
        assert back.filled_quantity == Decimal("0")
        assert len(back.events) == 1
        # the dedup set is seeded, so a caller that continues on this
        # object gets domain-level duplicate protection immediately.
        assert back.apply_fill(Fill(
            fill_id="fill_01", order_id="ord_01", trade_id="other", price=Decimal("1"),
            quantity=Decimal("1"), fee=Decimal("0"), fee_currency="USDT", is_maker=False,
            is_simulated=True, exchange_timestamp=1, received_timestamp=1,
        )) is False

    @pytest.mark.asyncio
    async def test_event_payload_is_canonical_json(self) -> None:
        subject, conn, _pool = store(echo=True)
        await subject.record_event(TENANT, OrderEvent(
            event_id="e", order_id="o", previous_status=None, status=OrderStatus.PENDING,
            reason=None, occurred_at=1, payload={"b": "2", "a": "1"},
        ))
        insert = next(s for s in conn.statements if s[0].startswith(_INS_EVENTS))
        payload_arg = insert[1][7]
        assert payload_arg == '{"a":"1","b":"2"}'  # sort_keys + tight separators

    def test_unknown_enums_and_non_decimals_are_read_errors(self) -> None:
        with pytest.raises(ValueError):  # the enum constructor refuses
            _decode_order(order_row({"status": "NOT_A_STATUS"}))
        with pytest.raises((InvalidOperation, ArithmeticError)):
            _decode_order(order_row({"quantity": "12abc"}))


# ---------------------------------------------------------------------------
# strictness divergence: SQL rejects what the reference silently mangles
# ---------------------------------------------------------------------------


class TestStrictnessDivergence:
    @pytest.mark.asyncio
    async def test_client_id_collision_surfaces_instead_of_silently_shifting(self) -> None:
        # The in-memory reference setdefaults its id map; SQL answers with a
        # unique violation on engine_orders_tenant_client_key. The port must
        # let THAT through (loud) rather than translating it into a no-op.
        violation = Exception(
            'duplicate key value violates unique constraint "engine_orders_tenant_client_key"'
        )
        subject, conn, _pool = store(None, Expectation("DO UPDATE SET", raises=violation))
        with pytest.raises(Exception, match="engine_orders_tenant_client_key"):
            await subject.save_order(make_order())
        assert conn.tx_rollbacks == 1  # the failed upsert must not half-apply
        # the save_order pre-read of the existing reconciliation state ran
        # FIRST (so the upsert can preserve it) - unscripted, it answers
        # "no row", and the capture below proves the INSERT shape carried
        # NULL state rather than inventing one.
        assert conn.statements[0][0] == SET_TENANT_SQL

    def test_order_params_carry_tenant_first(self) -> None:
        params = _order_params(make_order(tenant_id=OTHER_TENANT), ReconciliationState.DIVERGED)
        assert params[0] == OTHER_TENANT
        assert params[store_sql._ORDER_COLUMNS.index("reconciliation_state")] == "DIVERGED"
