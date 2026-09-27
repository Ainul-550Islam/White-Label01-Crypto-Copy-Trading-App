"""The durable incident sink (Part 17).

``wlct_trading.execution.incidents`` has described its records as
"deliberately rare and deliberately durable" since Part 5, while the only
implementation the platform ever shipped was ``InMemoryIncidentRecorder``. That
gap is not cosmetic: on a deployment with Part 13's Postgres store, an order
survives a restart and the incident that explains why the order was reconciled
does not. The audit trail of a failure is the one record an operator cannot
reconstruct, so the pair - durable store, memory sink - is refused at
composition rather than tolerated.

The shape of this recorder follows ``app.store_sql.PostgresOrderStore`` exactly,
and for reasons rather than taste:

* **Every statement runs inside a transaction whose first act is the tenant
  GUC.** The RLS policies of Part 11 are the layer below this code; a write that
  forgot ``set_config('app.tenant_id', …)`` would either fail closed (correct) or,
  on a role with ``BYPASSRLS``, silently land rows in the wrong tenant's result
  set. Reusing the store's ``SET_TENANT_SQL`` constant means there is one spelling
  of that law in the service, not two that can drift.
* **``record`` never raises.** The port says it: losing an incident is bad, taking
  down order flow because logging failed is worse. A failed write is counted and
  logged, and the counter is published - a sink that drops records invisibly is how
  a "durable" log becomes a rumour.
* **Insert-only.** The core's own law is that an incident is resolved by a NEW
  record, never by editing one (``ExecutionIncident.resolve`` returns a copy), so
  there is no UPDATE statement here at all. ``resolved`` is a column written once,
  which is what makes ``list_open`` a query rather than a race.
* **Reads do raise.** The asymmetry is deliberate: ``list_open`` answers an
  operator who asked a question, and "the incident store is down" is the answer
  they need. Swallowing it to return an empty list would be the most convincing
  possible lie - no open incidents looks exactly like a healthy system.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from wlct_trading.enums import ExchangeId
from wlct_trading.execution.incidents import (
    ExecutionErrorCode,
    ExecutionIncident,
    IncidentRecorder,
    IncidentSeverity,
    IncidentType,
)

from app.store_sql import SET_TENANT_SQL, PgPool

__all__ = [
    "TABLE_INCIDENTS",
    "IncidentReadError",
    "PostgresIncidentRecorder",
]

logger = logging.getLogger(__name__)

#: The table, named once. ``app.pg_store`` verifies it exists at startup with the
#: same ``to_regclass`` check the order tables use, so "the migration has not been
#: applied" is a refusal that names this string rather than a runtime error that
#: names a SQLSTATE.
TABLE_INCIDENTS = "engine_incidents"


class IncidentReadError(RuntimeError):
    """A read of the incident store failed, said plainly.

    Not a subclass of the write path's swallowed errors: the caller of
    :meth:`PostgresIncidentRecorder.list_open` asked a question and is owed an
    exception rather than an empty tuple.
    """


#: One incident, one row. The column list is the core's ``to_dict()`` field set
#: in the order that function publishes it, because the two must be readable
#: side by side by whoever is debugging a row that does not match a log line.
INSERT_SQL = f"""
INSERT INTO "{TABLE_INCIDENTS}" (
    incident_id, tenant_id, account_id, incident_type, severity, summary,
    exchange, symbol, order_id, client_order_id, error_code, details,
    occurred_at, resolved, resolution_note
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15
)
"""

#: Open incidents for one tenant, newest first. ``seq`` is the tiebreak, not
#: ``occurred_at``: two incidents recorded in the same microsecond are routine
#: (one failed command emits a pair), and "newest first" has to mean something
#: when they arrive together. The predicate on ``resolved`` is the whole of the
#: open/close law, so it is one column read rather than a join or a projection.
LIST_OPEN_SQL = f"""
SELECT incident_id, tenant_id, account_id, incident_type, severity, summary,
       exchange, symbol, order_id, client_order_id, error_code,
       details::text AS details, occurred_at, resolved, resolution_note
  FROM "{TABLE_INCIDENTS}"
 WHERE tenant_id = $2::uuid AND resolved = false
 ORDER BY seq DESC
 LIMIT $3
"""


def _row_to_incident(row: Any) -> ExecutionIncident:
    """Rebuild the immutable record from a row.

    The enums are re-derived from the stored strings and a bad value is a hard
    error: a row whose ``severity`` is not in the vocabulary means either the
    codec changed or somebody wrote to the table by hand, and "unknown" is not a
    severity an operator can act on.
    """
    details_raw = row["details"]
    details = json.loads(details_raw) if isinstance(details_raw, str) else dict(details_raw or {})
    return ExecutionIncident(
        incident_id=str(row["incident_id"]),
        tenant_id=str(row["tenant_id"]),
        account_id=row["account_id"],
        incident_type=IncidentType(row["incident_type"]),
        severity=IncidentSeverity(row["severity"]),
        summary=str(row["summary"]),
        exchange=_optional_exchange(row["exchange"]),
        symbol=row["symbol"],
        order_id=row["order_id"],
        client_order_id=row["client_order_id"],
        error_code=_optional_error_code(row["error_code"]),
        details={str(k): str(v) for k, v in details.items()},
        occurred_at_micros=int(row["occurred_at"]),
        resolved=bool(row["resolved"]),
        resolution_note=row["resolution_note"],
    )


def _optional_exchange(value: object) -> ExchangeId | None:
    """Re-derive an enum from the stored string, or say "absent".

    Both helpers treat the empty string as absent even though the writer only ever
    stores NULL: a hand-edited row (and someone, someday, will) must not become a
    crash in the read path of the tool an operator uses to find out what broke.
    """
    if value in (None, ""):
        return None
    return ExchangeId(str(value))


def _optional_error_code(value: object) -> ExecutionErrorCode | None:
    if value in (None, ""):
        return None
    return ExecutionErrorCode(str(value))


class PostgresIncidentRecorder(IncidentRecorder):
    """Incident records that outlive the process, over the store's pool.

    The pool is shared with :class:`~app.store_sql.PostgresOrderStore` on purpose:
    one connection budget against the database every other engine table uses, and
    one place where the tenant GUC law can be enforced. The recorder takes no
    transaction of its own beyond the per-statement one, because a record written
    as a side effect of a failed command must NOT be rolled back with that
    command's work - an incident that disappears because the order it describes
    was retried is worse than no incident.
    """

    __slots__ = ("_pool", "_failed_writes", "_written")

    def __init__(self, pool: PgPool) -> None:
        self._pool = pool
        self._written = 0
        self._failed_writes = 0

    @property
    def is_durable(self) -> bool:
        """The store's own flag, read the same duck-typed way everywhere else.

        Composition asks this question instead of trusting the config: the config
        says what was intended, the object says what it can do, and a durable
        claim from an in-memory sink is the failure this class exists to prevent.
        """
        return True

    @property
    def stats(self) -> dict[str, int]:
        """Write accounting, published on ``/status`` beside the sink label.

        ``failedWrites`` is the number of incidents this process was told to keep
        and could not. Non-zero with the orders table healthy is the signature of
        a missing grant or an out-of-order migration, and an operator who cannot
        see it has to guess whether an empty incident list means "nothing happened"
        or "we could not write it down".
        """
        return {"written": self._written, "failedWrites": self._failed_writes}

    async def record(self, incident: ExecutionIncident) -> None:
        """Persist one incident. Never raises into the caller."""
        try:
            async with self._pool.acquire() as conn:
                async with conn.transaction():
                    await conn.execute(SET_TENANT_SQL, incident.tenant_id)
                    await conn.execute(
                        INSERT_SQL,
                        incident.incident_id,
                        incident.tenant_id,
                        incident.account_id,
                        incident.incident_type.value,
                        incident.severity.value,
                        incident.summary,
                        incident.exchange.value if incident.exchange else None,
                        incident.symbol,
                        incident.order_id,
                        incident.client_order_id,
                        incident.error_code.value if incident.error_code else None,
                        json.dumps(dict(incident.details), sort_keys=True),
                        incident.occurred_at_micros,
                        bool(incident.resolved),
                        incident.resolution_note,
                    )
        except Exception as exc:  # the port's law: logging must not break execution
            self._failed_writes += 1
            logger.error(
                "execution_engine.incident_write_failed",
                extra={
                    "event": "execution_engine.incident_write_failed",
                    "tenant_id": incident.tenant_id,
                    "incident_id": incident.incident_id,
                    "incident_type": incident.incident_type.value,
                    "error": type(exc).__name__,
                    "failed_writes": self._failed_writes,
                },
            )
            return
        self._written += 1

    async def list_open(
        self, tenant_id: str, *, limit: int = 100
    ) -> tuple[ExecutionIncident, ...]:
        """Open incidents for one tenant, newest first. Raises on failure."""
        if not 1 <= limit <= 1_000:
            raise ValueError(
                "incident list limit must be between 1 and 1000; the bound is the "
                "store's, not the caller's, because this reads an unbounded table"
            )
        try:
            async with self._pool.acquire() as conn:
                async with conn.transaction():
                    await conn.execute(SET_TENANT_SQL, tenant_id)
                    rows = await conn.fetch(LIST_OPEN_SQL, tenant_id, tenant_id, limit)
        except Exception as exc:
            raise IncidentReadError(
                f"the incident store could not be read ({type(exc).__name__}); an "
                "empty list would not be the same answer, so none is given"
            ) from exc
        return tuple(_row_to_incident(row) for row in rows)

    async def verify_schema(self) -> None:
        """Existence check for startup, spelled the way the order store spells it."""
        async with self._pool.acquire() as conn:
            present = await conn.fetchrow(
                "SELECT to_regclass($1) AS regclass", f"public.{TABLE_INCIDENTS}"
            )
        if present is None or present["regclass"] is None:
            raise RuntimeError(
                f'table "{TABLE_INCIDENTS}" is missing; the durable incident sink '
                "cannot be built over a schema that has not been migrated"
            )
