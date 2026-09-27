"""The one module that imports the driver (Part 13).

The store itself (``app.store_sql``) speaks a two-method protocol and is
unit-testable without Postgres anywhere in sight. This module is the seam
between that protocol and ``asyncpg``: pool creation, the schema check that
keeps "migrations applied" from becoming a runtime discovery, and shutdown.
Three facts decided here, deliberately:

* **The tables must exist before the first request.** ``to_regclass`` on
  each engine table; a missing one is a startup refusal naming the
  migration. An engine that comes up ready and then fails every durable
  write with ``relation does not exist`` would report its own health as
  healthy while losing orders - strictly worse than not starting.
* **The pool is small.** max_size 5: the single-process simulated runtime
  serves short commands with one store call each; a big pool here just
  multiplies connections held against the same Postgres the API and the
  other engines use, and connection pressure on a shared database is an
  availability problem for everyone.
* **Connection failure is startup failure.** No retry-with-backoff loop at
  boot, because the platform's orchestrator (compose restart / k8s
  backoff) already retries process starts with visibility; a process that
  sleeps through retries looks alive to a supervisor and answers nothing.
"""

from __future__ import annotations

import logging
from typing import Any, Final

import asyncpg

from app.config import Settings
from app.incidents_sql import TABLE_INCIDENTS
from app.store_sql import TABLE_EVENTS, TABLE_FILLS, TABLE_ORDERS, PostgresOrderStore

__all__ = ["DURABLE_TABLES", "open_durable_store"]

#: Every table the durable plane needs, checked in one loop at startup. Part 17
#: added the fourth: an engine that came up ready to serve commands whose orders
#: would be kept and whose incidents would not is a deployment whose audit trail
#: silently stops at the last restart, so the incidents table is a STARTUP
#: requirement here rather than a runtime discovery.
DURABLE_TABLES: Final[tuple[str, ...]] = (
    TABLE_ORDERS,
    TABLE_EVENTS,
    TABLE_FILLS,
    TABLE_INCIDENTS,
)

logger = logging.getLogger(__name__)

#: Driver defaults worth pinning rather than inheriting: a 10s connect
#: timeout means a dead database is known in ten seconds, not when a
#: statement's own timeout finally fires mid-command.
_CONNECT_TIMEOUT_SECONDS = 10.0


async def open_durable_store(
    settings: Settings,
) -> tuple[Any, PostgresOrderStore]:
    """Create the pool, verify the schema, return (pool, store).

    Returns the pool as well because the lifespan owns its shutdown; the
    store must never be the only handle to it. Any failure raises through
    startup (see module docstring): the caller's contract is "either a
    working durable store or no service at all".
    """
    dsn = settings.EXECUTION_POSTGRES_DSN
    if dsn is None:  # config validator makes this unreachable; the type needs it
        raise RuntimeError("postgres store backend without a DSN cannot be opened")
    pool = await asyncpg.create_pool(
        dsn=dsn,
        min_size=1,
        max_size=5,
        timeout=_CONNECT_TIMEOUT_SECONDS,
    )
    missing: list[str] = []
    try:
        async with pool.acquire() as conn:
            for table in DURABLE_TABLES:
                present = await conn.fetchval(
                    "SELECT to_regclass($1)", f"public.{table}"
                )
                if present is None:
                    missing.append(table)
    except BaseException:
        await pool.close()
        raise
    if missing:
        await pool.close()
        raise RuntimeError(
            "EXECUTION_STORE_BACKEND=postgres but these engine tables are "
            f"missing: {', '.join(sorted(missing))}. Apply the execution-store "
            "migration (owned by apps/api/prisma) before starting a durable "
            "engine - refusing to serve commands whose records cannot be kept. "
            "The incidents table is on this list because a durable deployment "
            "that loses its incident log has the same amnesia as one that never "
            "had a store."
        )
    logger.info(
        "execution_engine.durable_store_open",
        extra={
            "event": "execution_engine.durable_store_open",
            "tables": list(DURABLE_TABLES),
        },
    )
    return pool, PostgresOrderStore(pool)
