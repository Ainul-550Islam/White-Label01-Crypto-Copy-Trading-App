"""Part 13: the lifespan seam - pool creation, schema preflight, refusal.

The module under test is the only file allowed to import asyncpg, so these
tests substitute the MODULE ATTRIBUTE (``app.pg_store.asyncpg``), never the
driver's behaviour: what is pinned is the startup decision - connect with a
timeout, verify all three tables or die, hand the pool back to the caller
that owns shutdown, and CLOSE the pool on every failure path so a refused
startup leaks no connections.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

import app.pg_store as pg_store
from app.config import Settings
from app.incidents_sql import TABLE_INCIDENTS
from app.store_sql import TABLE_EVENTS, TABLE_FILLS, TABLE_ORDERS
from tests.test_execution_engine import settings_for

_TEST_DSN = "postgresql://engine_user:another-s3cr3t-p13@db.internal:5432/wlct_engine"


class FakeAcquire:
    def __init__(self, conn: Any) -> None:
        self._conn = conn

    async def __aenter__(self) -> Any:
        return self._conn

    async def __aexit__(self, *_exc: object) -> bool:
        return False


class FakeDriverConn:
    def __init__(self, present: set[str], error: BaseException | None = None) -> None:
        self.present = present
        self.error = error
        self.queries: list[tuple[str, tuple[object, ...]]] = []

    async def fetchval(self, query: str, *args: object) -> Any | None:
        if self.error is not None:
            raise self.error
        self.queries.append((query, args))
        assert query == "SELECT to_regclass($1)"
        name = str(args[0])
        return name if name.removeprefix("public.") in self.present else None


class FakeDriverPool:
    def __init__(self, conn: FakeDriverConn) -> None:
        self._conn = conn
        self.close_calls = 0

    def acquire(self) -> FakeAcquire:
        return FakeAcquire(self._conn)

    async def close(self) -> None:
        self.close_calls += 1


ALL_TABLES = {TABLE_ORDERS, TABLE_EVENTS, TABLE_FILLS, TABLE_INCIDENTS}


def install_fake_asyncpg(
    monkeypatch: pytest.MonkeyPatch,
    *,
    present: set[str] = ALL_TABLES,
    create_error: BaseException | None = None,
    conn_error: BaseException | None = None,
) -> dict[str, Any]:
    created: dict[str, Any] = {}

    async def create_pool(**kwargs: Any) -> FakeDriverPool:
        created.update(kwargs)
        if create_error is not None:
            raise create_error
        conn = FakeDriverConn(present, error=conn_error)
        pool = FakeDriverPool(conn)
        created["pool"] = pool
        created["conn"] = conn
        return pool

    monkeypatch.setattr(pg_store, "asyncpg", SimpleNamespace(create_pool=create_pool))
    return created


class TestOpenDurableStore:
    @pytest.mark.asyncio
    async def test_happy_path_opens_checks_every_table_and_hands_back_both(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        created = install_fake_asyncpg(monkeypatch)
        settings = settings_for(
            ("EXECUTION_STORE_BACKEND", "postgres"),
            ("EXECUTION_POSTGRES_DSN", _TEST_DSN),
        )
        pool, store = await pg_store.open_durable_store(settings)
        assert created["dsn"] == _TEST_DSN
        assert created["timeout"] == pg_store._CONNECT_TIMEOUT_SECONDS
        assert created["max_size"] == 5 and created["min_size"] == 1
        checked = [q[1][0] for q in created["conn"].queries]
        # Named one by one rather than derived from pg_store.DURABLE_TABLES, so a
        # table quietly leaving the startup check is a failing assertion here.
        # Part 17 added the incident table: a durable deployment that loses its
        # incident log has the same amnesia as one that never had a store, so its
        # absence is a refusal to boot, not a runtime discovery.
        assert checked == [
            f"public.{t}"
            for t in (TABLE_ORDERS, TABLE_EVENTS, TABLE_FILLS, TABLE_INCIDENTS)
        ]
        assert store.is_durable is True
        assert pool is not None

    @pytest.mark.asyncio
    async def test_missing_tables_refuse_by_name_and_close_the_pool(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        created = install_fake_asyncpg(monkeypatch, present={TABLE_ORDERS})
        settings = settings_for(
            ("EXECUTION_STORE_BACKEND", "postgres"),
            ("EXECUTION_POSTGRES_DSN", _TEST_DSN),
        )
        with pytest.raises(RuntimeError) as caught:
            await pg_store.open_durable_store(settings)
        message = str(caught.value)
        assert TABLE_EVENTS in message and TABLE_FILLS in message and TABLE_ORDERS not in message
        assert "migration" in message
        assert created["pool"].close_calls == 1  # refused startup leaks nothing

    @pytest.mark.asyncio
    async def test_schema_check_failure_closes_the_pool(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # The pool object exists while the schema check is mid-flight when
        # the connection dies - the check's except path must close it.
        created = install_fake_asyncpg(
            monkeypatch, conn_error=OSError("connection reset by peer")
        )
        settings = settings_for(
            ("EXECUTION_STORE_BACKEND", "postgres"),
            ("EXECUTION_POSTGRES_DSN", _TEST_DSN),
        )
        with pytest.raises(OSError, match="connection reset"):
            await pg_store.open_durable_store(settings)
        assert created["pool"].close_calls == 1

    @pytest.mark.asyncio
    async def test_connect_failure_propagates_untouched(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # create_pool itself failing: nothing to close, the error surfaces
        # verbatim through startup (no swallowed-then-generic-500).
        install_fake_asyncpg(monkeypatch, create_error=OSError("could not translate host name"))
        settings = settings_for(
            ("EXECUTION_STORE_BACKEND", "postgres"),
            ("EXECUTION_POSTGRES_DSN", _TEST_DSN),
        )
        with pytest.raises(OSError, match="could not translate host name"):
            await pg_store.open_durable_store(settings)

    @pytest.mark.asyncio
    async def test_absent_dsn_is_unreachable_but_guarded(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Settings validation forbids postgres-without-dsn (tested in
        # test_part13_config_composition), so this path is defence-in-depth
        # for programmatic misuse. model_construct skips validation
        # precisely so the test can build the state the validator forbids.
        install_fake_asyncpg(monkeypatch)
        settings = Settings.model_construct(EXECUTION_STORE_BACKEND="postgres")
        assert settings.EXECUTION_POSTGRES_DSN is None
        with pytest.raises(RuntimeError, match="without a DSN"):
            await pg_store.open_durable_store(settings)
