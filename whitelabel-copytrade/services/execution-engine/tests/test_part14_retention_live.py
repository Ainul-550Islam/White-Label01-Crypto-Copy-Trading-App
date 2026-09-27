"""Part 14: retention against a REAL Postgres - when one is provided.

Same law as the part-13 live suite: without ``EXECUTION_TEST_POSTGRES_DSN``
the module skips with a visible reason; with it, the deletion executes
against the migrated tables and the assertions are the database's answer,
not a fake's. What a fake cannot certify and this file can:

- the JOINed prune predicate actually MATCHES the rows the prose says it
  matches (settled-old under settled-old, keeps recent under settled,
  keeps everything under open) - an executor whose fake scripts its own
  answers can never discover that its SQL selects the wrong rows;
- ``seq = ANY(...)`` deletes exactly the selected rows and RETURNING
  counts exactly those;
- the batch ceiling interrupts a big prune with the remainder INTACT, and
  the next run resumes - "exhausted means run again" is load-bearing;
- a second tenant's identical-looking rows survive a first tenant's run;
- under real ENABLE/FORCE ROW LEVEL SECURITY on the ledger table, the
  executor's own transaction (GUC set) writes and reads its rows while a
  bare session sees nothing - the RLS argument, executed for the newest
  table too.

Ages are anchored to the real clock (the cutoffs are relative): a live
suite that freezes "now" would be testing a fantasy calendar.
"""

from __future__ import annotations

import os
import time
from collections.abc import AsyncIterator
from pathlib import Path
from typing import cast

import asyncpg
import pytest
from wlct_trading.retention import RetentionPolicy

from app.retention import inspect_event_store, run_event_retention
from app.store_sql import PgPool

pytestmark = pytest.mark.skipif(
    os.environ.get("EXECUTION_TEST_POSTGRES_DSN") is None,
    reason="EXECUTION_TEST_POSTGRES_DSN not set; real-Postgres retention suite "
    "skipped (the scripted suite pins statements and conversations instead)",
)

ROOT = Path(__file__).resolve().parents[3]
MIGRATIONS = (
    ROOT
    / "apps"
    / "api"
    / "prisma"
    / "migrations"
    / "20260914120000_part13_execution_store"
    / "migration.sql",
    ROOT
    / "apps"
    / "api"
    / "prisma"
    / "migrations"
    / "20260914160000_part14_retention_ledger"
    / "migration.sql",
)

DAY_US = 86_400 * 1_000_000
TENANT_A = "4a1b2c3d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"
TENANT_B = "5b2c3d4e-6f70-4b8c-9d0e-1f2a3b4c5d6e"

_TRUNCATES = (
    # Literal table names throughout (S608-clean by construction: no
    # f-strings near SQL, even a constant-fed one).
    "DELETE FROM engine_retention_runs",
    "DELETE FROM engine_order_fills",
    "DELETE FROM engine_order_events",
    "DELETE FROM engine_orders",
)

_LEDGER_POLICY_SETUP = (
    'CREATE POLICY tenant_isolation ON "engine_retention_runs" '
    "USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)",
    'ALTER TABLE "engine_retention_runs" ENABLE ROW LEVEL SECURITY',
    'ALTER TABLE "engine_retention_runs" FORCE ROW LEVEL SECURITY',
)
_LEDGER_POLICY_TEARDOWN = (
    'ALTER TABLE "engine_retention_runs" NO FORCE ROW LEVEL SECURITY',
    'ALTER TABLE "engine_retention_runs" DISABLE ROW LEVEL SECURITY',
    'DROP POLICY tenant_isolation ON "engine_retention_runs"',
)


_MIGRATIONS_APPLIED = False


def _statements_for(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    body = "\n".join(
        line for line in text.splitlines() if not line.strip().startswith("--")
    )
    return [s.strip() for s in body.split(";") if s.strip()]


@pytest.fixture
async def conn() -> AsyncIterator[asyncpg.Connection]:
    """One session per test; the migration files themselves are the DDL
    (a fresh CI database gets part-13 THEN part-14 applied here, a
    fully-migrated one is left alone, and a half-migrated one - orders
    without the ledger, or the reverse - is refused as the broken state
    it is, rather than silently patched)."""
    global _MIGRATIONS_APPLIED
    dsn = os.environ["EXECUTION_TEST_POSTGRES_DSN"]
    async with asyncpg.connect(dsn=dsn, timeout=10.0) as connection:
        if not _MIGRATIONS_APPLIED:
            await connection.execute(
                'CREATE TABLE IF NOT EXISTS "tenants" ("id" UUID PRIMARY KEY)'
            )
            have_orders = (
                await connection.fetchval("SELECT to_regclass('public.engine_orders')")
                is not None
            )
            have_ledger = (
                await connection.fetchval(
                    "SELECT to_regclass('public.engine_retention_runs')"
                )
                is not None
            )
            if not have_orders and not have_ledger:
                for path in MIGRATIONS:
                    for statement in _statements_for(path):
                        await connection.execute(statement)
            elif have_orders and not have_ledger:
                for statement in _statements_for(MIGRATIONS[1]):
                    await connection.execute(statement)
            else:
                pytest.fail(
                    "half-migrated CI database (engine_retention_runs without "
                    "engine_orders); drop public.engine_* and the tenants stub "
                    "and rerun - this suite refuses to guess the missing half"
                )
            _MIGRATIONS_APPLIED = True
        await connection.execute(
            "INSERT INTO tenants(id) VALUES ($1),($2) ON CONFLICT DO NOTHING",
            TENANT_A,
            TENANT_B,
        )
        for statement in _TRUNCATES:
            await connection.execute(statement)
        yield connection


class _SingleConnectionPool:
    """One shared session for pool + raw queries (see part-13 live suite for
    why the shim, not a real pool, is what makes GUC assertions possible)."""

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


def now_us() -> int:
    return int(time.time() * 1_000_000)


async def seed_order(
    conn: asyncpg.Connection,
    tenant: str,
    order_id: str,
    *,
    terminal_at_us: int | None,
) -> None:
    """One minimal real order row (status is irrelevant to the prune -
    terminality is the timestamp, per the core law; the row carries
    FILLED-style values anyway because the schema's NOT NULLs earned them)."""
    await conn.execute(
        "INSERT INTO engine_orders (tenant_id, order_id, client_order_id, account_id, "
        "exchange, symbol, side, order_type, time_in_force, is_simulated, status, "
        "quantity, filled_quantity, cumulative_fee, created_at, updated_at, terminal_at) "
        "VALUES ($1, $2, $2, 'acct-1', 'binance', 'BTCUSDT', 'BUY', 'LIMIT', 'GTC', "
        "true, 'FILLED', '1', '1', '0', $3, $3, $4)",
        tenant,
        order_id,
        (terminal_at_us or now_us()) - 400 * DAY_US,
        terminal_at_us,
    )


async def seed_event(
    conn: asyncpg.Connection,
    tenant: str,
    order_id: str,
    event_id: str,
    *,
    occurred_at_us: int,
) -> None:
    await conn.execute(
        "INSERT INTO engine_order_events (tenant_id, order_id, event_id, status, "
        "occurred_at, payload) VALUES ($1, $2, $3, 'ACCEPTED', $4, '{}'::jsonb)",
        tenant,
        order_id,
        event_id,
        occurred_at_us,
    )


async def event_ids(conn: asyncpg.Connection, tenant: str) -> list[str]:
    rows = await conn.fetch(
        "SELECT event_id FROM engine_order_events WHERE tenant_id = $1 ORDER BY seq",
        tenant,
    )
    return [row["event_id"] for row in rows]


async def ledger_rows(conn: asyncpg.Connection, tenant: str) -> list[asyncpg.Record]:
    return await conn.fetch(
        "SELECT dry_run, rows_deleted, batches, exhausted FROM engine_retention_runs "
        "WHERE tenant_id = $1 ORDER BY seq",
        tenant,
    )


async def seed_fill(conn: asyncpg.Connection, tenant: str, order_id: str) -> None:
    await conn.execute(
        "INSERT INTO engine_order_fills (tenant_id, order_id, fill_id, trade_id, price, "
        "quantity, fee, fee_currency, is_maker, is_simulated, exchange_timestamp, "
        "received_timestamp) VALUES ($1, $2, 'fill-1', 'trade-1', '1000', '1', '0.1', "
        "'USDT', true, true, 1, 1)",
        tenant,
        order_id,
    )


class TestRealPrune:
    async def test_the_predicate_selects_exactly_the_prose_rows(
        self, conn: asyncpg.Connection
    ) -> None:
        now = now_us()
        cutoff = now - 90 * DAY_US
        # A: settled long ago. Old event under it is the ONLY pruneable row.
        await seed_order(conn, TENANT_A, "ord-a", terminal_at_us=cutoff - DAY_US)
        await seed_event(conn, TENANT_A, "ord-a", "a-old", occurred_at_us=cutoff - DAY_US)
        await seed_event(conn, TENANT_A, "ord-a", "a-new", occurred_at_us=cutoff + DAY_US)
        # B: settled RECENTLY, event OLD - law 2 keeps the whole journal.
        await seed_order(conn, TENANT_A, "ord-b", terminal_at_us=cutoff + DAY_US)
        await seed_event(conn, TENANT_A, "ord-b", "b-old", occurred_at_us=cutoff - DAY_US)
        # C: open, ancient events - nothing settled, nothing goes.
        await seed_order(conn, TENANT_A, "ord-c", terminal_at_us=None)
        await seed_event(conn, TENANT_A, "ord-c", "c-ancient", occurred_at_us=now - 999 * DAY_US)
        await seed_fill(conn, TENANT_A, "ord-a")

        pool = _SingleConnectionPool(conn)
        report = await run_event_retention(
            cast(PgPool, pool),
            TENANT_A,
            RetentionPolicy(event_retention_days=90, batch_rows=4, max_batches=3),
            dry_run=False,
            instance_id="exec-live-1",
        )
        assert report.rows_reported == 1
        assert await event_ids(conn, TENANT_A) == ["a-new", "b-old", "c-ancient"]
        orders = await conn.fetch("SELECT order_id FROM engine_orders ORDER BY order_id")
        assert [r["order_id"] for r in orders] == ["ord-a", "ord-b", "ord-c"]
        fills = await conn.fetch("SELECT fill_id FROM engine_order_fills")
        assert [r["fill_id"] for r in fills] == ["fill-1"]  # money survives everything
        ledger = await ledger_rows(conn, TENANT_A)
        truth = [(r["dry_run"], r["rows_deleted"], r["batches"], r["exhausted"]) for r in ledger]
        assert truth == [(False, 1, 1, False)]

    async def test_dry_run_changes_nothing_yet_records_itself(
        self, conn: asyncpg.Connection
    ) -> None:
        now = now_us()
        cutoff = now - 90 * DAY_US
        await seed_order(conn, TENANT_A, "ord-a", terminal_at_us=cutoff - DAY_US)
        await seed_event(conn, TENANT_A, "ord-a", "a-old", occurred_at_us=cutoff - DAY_US)
        report = await run_event_retention(
            cast(PgPool, _SingleConnectionPool(conn)),
            TENANT_A,
            RetentionPolicy(event_retention_days=90, batch_rows=4, max_batches=3),
            dry_run=True,
            instance_id="exec-live-1",
        )
        assert report.rows_reported == 1
        assert await event_ids(conn, TENANT_A) == ["a-old"]  # untouched
        ledger = await ledger_rows(conn, TENANT_A)
        assert (ledger[0]["dry_run"], ledger[0]["rows_deleted"]) == (True, 1)

    async def test_the_ceiling_stops_mid_prune_and_the_next_run_resumes(
        self, conn: asyncpg.Connection
    ) -> None:
        now = now_us()
        cutoff = now - 90 * DAY_US
        await seed_order(conn, TENANT_A, "ord-a", terminal_at_us=cutoff - DAY_US)
        for i in range(10):  # 10 prunable, one run can eat 4 x 2 = 8
            await seed_event(conn, TENANT_A, "ord-a", f"e{i:02d}", occurred_at_us=cutoff - DAY_US)
        policy = RetentionPolicy(event_retention_days=90, batch_rows=4, max_batches=2)
        first = await run_event_retention(
            cast(PgPool, _SingleConnectionPool(conn)),
            TENANT_A,
            policy,
            dry_run=False,
            instance_id="exec-live-1",
        )
        assert (first.rows_reported, first.exhausted) == (8, True)
        assert len(await event_ids(conn, TENANT_A)) == 2
        second = await run_event_retention(
            cast(PgPool, _SingleConnectionPool(conn)),
            TENANT_A,
            policy,
            dry_run=False,
            instance_id="exec-live-1",
        )
        assert (second.rows_reported, second.exhausted) == (2, False)
        assert await event_ids(conn, TENANT_A) == []
        ledger = await ledger_rows(conn, TENANT_A)
        assert [(r["rows_deleted"], r["exhausted"]) for r in ledger] == [(8, True), (2, False)]

    async def test_a_prune_never_breaches_another_tenant(
        self, conn: asyncpg.Connection
    ) -> None:
        now = now_us()
        cutoff = now - 90 * DAY_US
        for tenant in (TENANT_A, TENANT_B):
            await seed_order(conn, tenant, "ord-a", terminal_at_us=cutoff - DAY_US)
            await seed_event(conn, tenant, "ord-a", "old", occurred_at_us=cutoff - DAY_US)
        await run_event_retention(
            cast(PgPool, _SingleConnectionPool(conn)),
            TENANT_A,
            RetentionPolicy(event_retention_days=90, batch_rows=8, max_batches=1),
            dry_run=False,
            instance_id="exec-live-1",
        )
        assert await event_ids(conn, TENANT_A) == []
        assert await event_ids(conn, TENANT_B) == ["old"]  # untouched, same shape
        assert await ledger_rows(conn, TENANT_B) == []  # not even a record for them


class TestLedgerUnderRls:
    async def test_enabled_policies_see_the_run_through_the_guc_only(
        self, conn: asyncpg.Connection
    ) -> None:
        now = now_us()
        cutoff = now - 90 * DAY_US
        await seed_order(conn, TENANT_A, "ord-a", terminal_at_us=cutoff - DAY_US)
        await seed_event(conn, TENANT_A, "ord-a", "a-old", occurred_at_us=cutoff - DAY_US)
        for statement in _LEDGER_POLICY_SETUP:
            await conn.execute(statement)
        try:
            await run_event_retention(
                cast(PgPool, _SingleConnectionPool(conn)),
                TENANT_A,
                RetentionPolicy(event_retention_days=90, batch_rows=4, max_batches=3),
                dry_run=False,
                instance_id="exec-live-1",
            )
            # the tx-local GUC is gone post-commit: a bare session (what a
            # leaked read or a future cron without the contract looks like)
            # sees NOTHING - not an error, nothing.
            bare = await conn.fetchval(
                "SELECT count(*) FROM engine_retention_runs WHERE tenant_id = $1",
                TENANT_A,
            )
            assert int(bare) == 0
            async with conn.transaction():
                await conn.execute("SELECT set_config('app.tenant_id', $1, true)", TENANT_A)
                seen = await conn.fetchval(
                    "SELECT count(*) FROM engine_retention_runs WHERE tenant_id = $1",
                    TENANT_A,
                )
            assert int(seen) == 1  # the store's own contract reads it back
            view = await inspect_event_store(
                cast(PgPool, _SingleConnectionPool(conn)),
                TENANT_A,
                RetentionPolicy(event_retention_days=90, batch_rows=4, max_batches=3),
                limit=5,
            )
            assert view["runs"][0]["rows_deleted"] == 1  # inspect works under policies too
        finally:
            for statement in _LEDGER_POLICY_TEARDOWN:
                await conn.execute(statement)
