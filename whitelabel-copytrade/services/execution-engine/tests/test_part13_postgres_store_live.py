"""Part 13: the durable store against a REAL Postgres - when one is provided.

Set ``EXECUTION_TEST_POSTGRES_DSN`` (a disposable CI database) and every
statement in ``app/store_sql.py`` executes against the engine's own
migrated tables: not a fake's idea of SQL, the database's. Without the
variable the module skips with a visible reason - the scripted suite proves
the contract's SHAPE, this file proves its SUBSTANCE, and CI is the only
place both run. The DDL is taken from the migration file itself, so this
test doubles as "the migration actually applies".

Table teardown is last-deletion-order (children first, CASCADE on the
parents' FKs) and the tenants stub is created only if absent: the file must
be re-runnable against the same CI database.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from decimal import Decimal
from pathlib import Path
from typing import cast

import asyncpg
import pytest
from wlct_trading.enums import ExchangeId, OrderSide, OrderStatus, OrderType, TimeInForce
from wlct_trading.execution.store import ReconciliationState
from wlct_trading.orders import Fill, Order, OrderEvent

from app.store_sql import (
    TABLE_EVENTS,
    TABLE_FILLS,
    TABLE_ORDERS,
    CrossTenantSweepUnsupported,
    PgPool,
    PostgresOrderStore,
)

pytestmark = pytest.mark.skipif(
    os.environ.get("EXECUTION_TEST_POSTGRES_DSN") is None,
    reason="EXECUTION_TEST_POSTGRES_DSN not set; real-Postgres suite skipped "
    "(the scripted suite still pins statement shapes and store semantics)",
)

ROOT = Path(__file__).resolve().parents[3]
MIGRATION = (
    ROOT
    / "apps"
    / "api"
    / "prisma"
    / "migrations"
    / "20260914120000_part13_execution_store"
    / "migration.sql"
)

# Literal statement lists, spelled per table, so this file never "builds"
# SQL (the module under test is literal; the mirror discipline lives in the
# tests too).
_TRUNCATES = (
    "DELETE FROM engine_order_fills",
    "DELETE FROM engine_order_events",
    "DELETE FROM engine_orders",
)
_POLICY_SETUP = (
    # nullif(...,'') verbatim: the expression the generated
    # wlct_current_tenant_id() uses; without it the empty-GUC case below
    # would be a cast error, not a policy refusal.
    "CREATE POLICY tenant_isolation ON \"engine_orders\" "
    "USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)",
    "ALTER TABLE \"engine_orders\" ENABLE ROW LEVEL SECURITY",
    "ALTER TABLE \"engine_orders\" FORCE ROW LEVEL SECURITY",
    "CREATE POLICY tenant_isolation ON \"engine_order_events\" "
    "USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)",
    "ALTER TABLE \"engine_order_events\" ENABLE ROW LEVEL SECURITY",
    "ALTER TABLE \"engine_order_events\" FORCE ROW LEVEL SECURITY",
    "CREATE POLICY tenant_isolation ON \"engine_order_fills\" "
    "USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)",
    "ALTER TABLE \"engine_order_fills\" ENABLE ROW LEVEL SECURITY",
    "ALTER TABLE \"engine_order_fills\" FORCE ROW LEVEL SECURITY",
)
_POLICY_TEARDOWN = (
    "ALTER TABLE \"engine_orders\" NO FORCE ROW LEVEL SECURITY",
    "ALTER TABLE \"engine_orders\" DISABLE ROW LEVEL SECURITY",
    "DROP POLICY tenant_isolation ON \"engine_orders\"",
    "ALTER TABLE \"engine_order_events\" NO FORCE ROW LEVEL SECURITY",
    "ALTER TABLE \"engine_order_events\" DISABLE ROW LEVEL SECURITY",
    "DROP POLICY tenant_isolation ON \"engine_order_events\"",
    "ALTER TABLE \"engine_order_fills\" NO FORCE ROW LEVEL SECURITY",
    "ALTER TABLE \"engine_order_fills\" DISABLE ROW LEVEL SECURITY",
    "DROP POLICY tenant_isolation ON \"engine_order_fills\"",
)

TENANT_A = "3f2a1b04-7c5d-4e6f-9a8b-0c1d2e3f4a5b"
TENANT_B = "9a8b7c6d-5e4f-4a3b-8c7d-6e5f4a3b2c1d"


def _statements() -> list[str]:
    text = MIGRATION.read_text(encoding="utf-8")
    body = "\n".join(
        line for line in text.splitlines() if not line.strip().startswith("--")
    )
    return [s.strip() for s in body.split(";") if s.strip()]


_MIGRATION_APPLIED = False


@pytest.fixture
async def conn() -> AsyncIterator[asyncpg.Connection]:
    """One session per test (function scope keeps a single event loop and
    consistent session state for GUC assertions), schema ensured once per
    process by executing the real migration file."""
    global _MIGRATION_APPLIED
    dsn = os.environ["EXECUTION_TEST_POSTGRES_DSN"]
    async with asyncpg.connect(dsn=dsn, timeout=10.0) as connection:
        if not _MIGRATION_APPLIED:
            await connection.execute(
                'CREATE TABLE IF NOT EXISTS "tenants" ("id" UUID PRIMARY KEY)'
            )
            existing = await connection.fetchval(
                "SELECT to_regclass($1)", f"public.{TABLE_ORDERS}"
            )
            if existing is None:
                for statement in _statements():
                    await connection.execute(statement)
            for table in (TABLE_EVENTS, TABLE_FILLS):
                if await connection.fetchval("SELECT to_regclass($1)", f"public.{table}") is None:
                    pytest.fail(
                        "engine_orders exists but a child table does not - the CI database "
                        "is half-migrated; drop public.engine_order* and rerun"
                    )
            _MIGRATION_APPLIED = True
        await connection.execute(
            "INSERT INTO tenants(id) VALUES ($1),($2) ON CONFLICT DO NOTHING",
            TENANT_A,
            TENANT_B,
        )
        for statement in _TRUNCATES:
            await connection.execute(statement)
        yield connection


class _SingleConnectionPool:
    """Adapts ONE connection to the store's pool protocol so rows written
    by the store are readable by the test's raw queries in the same session
    (search-path, GUC and policy state shared - which a real pool would NOT
    guarantee, and is precisely why RLS assertions need this shim)."""

    def __init__(self, connection: asyncpg.Connection) -> None:
        self._connection = connection

    def acquire(self) -> object:
        connection = self._connection

        class _Acquire:
            async def __aenter__(self) -> asyncpg.Connection:
                return connection

            async def __aexit__(self, *exc: object) -> bool:
                return False

        return _Acquire()

    async def close(self) -> None:
        return None


@pytest.fixture
async def store(conn: asyncpg.Connection) -> PostgresOrderStore:
    return PostgresOrderStore(cast(PgPool, _SingleConnectionPool(conn)))


def order_for(tenant: str, order_id: str, client_id: str) -> Order:
    return Order(
        order_id=order_id,
        client_order_id=client_id,
        tenant_id=tenant,
        account_id="acct_01",
        strategy_id=None,
        exchange=ExchangeId.BINANCE,
        symbol="BTCUSDT",
        side=OrderSide.BUY,
        order_type=OrderType.LIMIT,
        quantity=Decimal("0.10"),
        price=Decimal("50000.00"),
        time_in_force=TimeInForce.GTC,
        is_simulated=True,
        status=OrderStatus.PENDING,
        created_at=1_700_000_000_000_000,
        updated_at=1_700_000_000_000_001,
    )


class TestRealDatabaseRoundTrips:
    @pytest.mark.asyncio
    async def test_full_order_lifecycle_persists_and_reads_back(
        self, store: PostgresOrderStore
    ) -> None:
        order = order_for(TENANT_A, "ord_live_1", "wlc-live-1")
        outcome = await store.reserve_client_order_id(TENANT_A, order.client_order_id, order)
        assert outcome.reserved is True

        saved = await store.get_order(TENANT_A, order.order_id)
        assert saved is not None
        assert saved.status is OrderStatus.PENDING
        # the reservation-time durability claim, verbatim from the row
        assert (
            await store.get_reconciliation_state(TENANT_A, order.order_id)
        ) is ReconciliationState.UNKNOWN

        order.status = OrderStatus.SUBMITTED
        order.submitted_at = 1_700_000_000_000_009
        await store.save_order(order)
        await store.set_reconciliation_state(TENANT_A, order.order_id, ReconciliationState.IN_SYNC)
        back = await store.get_order(TENANT_A, order.order_id)
        assert back is not None and back.status is OrderStatus.SUBMITTED
        assert (
            await store.get_reconciliation_state(TENANT_A, order.order_id)
        ) is ReconciliationState.IN_SYNC

    @pytest.mark.asyncio
    async def test_decimal_scale_and_null_semantics_survive_the_database(
        self, store: PostgresOrderStore
    ) -> None:
        order = order_for(TENANT_A, "ord_live_2", "wlc-live-2")
        order.price = Decimal("0.100")
        order.stop_price = Decimal("49999.999999")
        order.average_fill_price = Decimal("0.100000000000000000000001")
        await store.save_order(order)
        back = await store.get_order(TENANT_A, order.order_id)
        assert back is not None
        assert str(back.price) == "0.100"
        assert str(back.stop_price) == "49999.999999"
        assert str(back.average_fill_price) == "0.100000000000000000000001"

    @pytest.mark.asyncio
    async def test_reservation_conflict_semantics(self, store: PostgresOrderStore) -> None:
        a = order_for(TENANT_A, "ord_live_3", "wlc-live-3")
        thief = order_for(TENANT_A, "ord_live_4", "wlc-live-3")
        assert (
            await store.reserve_client_order_id(TENANT_A, a.client_order_id, a)
        ).reserved is True
        lost = await store.reserve_client_order_id(TENANT_A, thief.client_order_id, thief)
        assert lost.reserved is False and lost.existing is not None
        assert lost.existing.order_id == "ord_live_3"
        # same order retrying the reservation: wins, with the stored row
        retry = await store.reserve_client_order_id(TENANT_A, a.client_order_id, a)
        assert retry.reserved is True and retry.existing is not None
        # and the SAME client id under ANOTHER tenant is a fresh reservation
        # (the unique index is (tenant_id, client_order_id)): the tenant in
        # the key is the isolation, proven by both orders existing.
        other = order_for(TENANT_B, "ord_live_3b", "wlc-live-3")
        assert (
            await store.reserve_client_order_id(TENANT_B, other.client_order_id, other)
        ).reserved is True

    @pytest.mark.asyncio
    async def test_fills_dedupe_events_append_and_order_is_insertion(
        self, store: PostgresOrderStore
    ) -> None:
        order = order_for(TENANT_A, "ord_live_5", "wlc-live-5")
        await store.save_order(order)
        fill = Fill(
            fill_id="fill_live_1", order_id="ord_live_5", trade_id="t1",
            price=Decimal("50000.5"), quantity=Decimal("0.04"), fee=Decimal("0.00060"),
            fee_currency="BNB", is_maker=True, is_simulated=True,
            exchange_timestamp=1_700_000_000_000, received_timestamp=1_700_000_000_000_020,
        )
        assert await store.record_fill(TENANT_A, fill) is True
        assert await store.record_fill(TENANT_A, fill) is False  # at-least-once replay
        for i in range(3):
            await store.record_event(TENANT_A, OrderEvent(
                event_id=f"ev_{i}", order_id="ord_live_5", previous_status=None,
                status=OrderStatus.SUBMITTED, reason=None, occurred_at=1_700_000_000_000_000,
                payload={"i": str(i)},
            ))
        events = await store.list_events(TENANT_A, "ord_live_5")
        # identical timestamps, journal insertion order still kept by seq:
        assert [e.event_id for e in events] == ["ev_0", "ev_1", "ev_2"]
        assert events[1].payload == {"i": "1"}
        fills = await store.list_fills(TENANT_A, "ord_live_5")
        assert len(fills) == 1 and str(fills[0].fee) == "0.00060"
        back = await store.get_order(TENANT_A, "ord_live_5")
        assert back is not None and [f.fill_id for f in back.fills] == ["fill_live_1"]

    @pytest.mark.asyncio
    async def test_list_open_orders_excludes_terminals_live(
        self, store: PostgresOrderStore
    ) -> None:
        open_order = order_for(TENANT_A, "ord_live_6", "wlc-live-6")
        await store.save_order(open_order)
        done = order_for(TENANT_A, "ord_live_7", "wlc-live-7")
        done.status = OrderStatus.FILLED
        await store.save_order(done)
        listed = await store.list_open_orders(TENANT_A, "acct_01")
        assert [o.order_id for o in listed] == ["ord_live_6"]
        filtered = await store.list_open_orders(TENANT_A, "acct_01", symbol="ETHUSDT")
        assert filtered == ()

    @pytest.mark.asyncio
    async def test_sweep_still_refuses_before_touching_anything(
        self, store: PostgresOrderStore
    ) -> None:
        with pytest.raises(CrossTenantSweepUnsupported):
            await store.list_orders_needing_reconciliation()


class TestRlsInteraction:
    """The GUC-first law is what lets the engine's tables sit UNDER the
    platform's generated policies the moment an operator enables them; this
    simulates one enablement (policy + ENABLE + FORCE on the three tables,
    torn down afterwards) and asserts the store's queries keep working
    while a policyless query sees nothing."""

    @pytest.mark.asyncio
    async def test_store_queries_satisfy_enforced_rls(
        self, store: PostgresOrderStore, conn: asyncpg.Connection
    ) -> None:
        order = order_for(TENANT_A, "ord_live_rls", "wlc-rls")
        other = order_for(TENANT_B, "ord_live_rls_b", "wlc-rls-b")
        await store.save_order(order)
        await store.save_order(other)
        for statement in _POLICY_SETUP:
            await conn.execute(statement)
        try:
            # the store still reads its tenant's rows: every operation set
            # the GUC first, so the policy admits exactly them.
            assert await store.get_order(TENANT_A, "ord_live_rls") is not None
            assert await store.get_order(TENANT_B, "ord_live_rls_b") is not None
            # a raw query on the same session with NO GUC sees nothing -
            # proof the policy is actually enforced against this connection,
            # not vacuously satisfied.
            await conn.execute("SELECT set_config('app.tenant_id', '', false)")
            visible = await conn.fetchval("SELECT count(*) FROM engine_orders")
            assert visible == 0
            # and a GUC for tenant A cannot reach tenant B's row even by
            # explicit id.
            await conn.execute("SELECT set_config('app.tenant_id', $1, false)", TENANT_A)
            leaked = await conn.fetchval(
                "SELECT count(*) FROM engine_orders WHERE order_id = $2", "ord_live_rls_b"
            )
            assert leaked == 0
        finally:
            await conn.execute("SELECT set_config('app.tenant_id', '', false)")
            for statement in _POLICY_TEARDOWN:
                await conn.execute(statement)
