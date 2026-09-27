"""Event-journal pruning over the durable store (Part 14).

The judgment lives in the core (``wlct_trading.retention``); this module is
its only executor against Postgres, and it is deliberately small. Four
rules make "a DELETE statement near money data" survivable:

1. **One target, three guards.** Events older than the cutoff under orders
   that were settled before the cutoff: that is the whole deletion set,
   spelled once in two statements (count and batch-select) that share the
   predicate text-by-text so no drift can make the rehearsal lie about the
   execution. Every statement carries the tenant id in its WHERE clause
   (the belt), runs inside ``_TenantTransaction`` (the GUC, so RLS means
   what it says the moment policies are enabled, and the canonical-UUID
   guard fires before the pool is touched), and the deletes are by
   explicit seq list - never by a predicate the database evaluates alone.

2. **Batched to a stop, never to a drain.** A run is at most
   ``max_batches`` batches of at most ``batch_rows`` rows, each batch its
   own transaction. A run that hits the ceiling reports ``exhausted`` and
   leaves the rest for the next scheduled run: retention competes with the
   command path for locks, and the command path must win. The batch loop
   deliberately does not retry races: a seq that another conn deleted
   first simply isn't in the RETURNING count.

3. **Dry-run is the default and is also recorded.** Inspect (count +
   recent runs) is available with the feature disabled; an APPLY requires
   ``EXECUTION_RETENTION_ENABLED=true`` and the refusal to say so is the
   point of the default. Dry runs write a ledger row too - the rehearsal's
   answer is evidence for the execution.

4. **The ledger is written after the deletes, and its failure is loud.**
   Rows are already gone when the record-writing transaction runs, so a
   ledger failure cannot roll back a lie - it surfaces as
   ``RetentionLedgerLost`` (HTTP 500 to the operator, ERROR line in the
   log with every count the ledger would have held). Ordering the ledger
   FIRST would instead record deletions that then failed; between an
   under-record and an over-record, the platform under-records loudly and
   never over-records quietly.

Refusals (memory backend, apply disabled) happen where the request stands
- in the router, before this module is reached - because both are about
CONFIGURATION, and this module takes configuration as given: a pool it did
not create, a policy the settings validator already admitted to exist.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, replace
from typing import Any, Final

from wlct_trading.clock import epoch_micros
from wlct_trading.retention import PRUNABLE_JOURNAL, RetentionPolicy

from app.store_sql import PgPool, _TenantTransaction

__all__ = [
    "TABLE_RETENTION_RUNS",
    "RetentionLedgerLost",
    "RetentionRunReport",
    "inspect_event_store",
    "run_event_retention",
]

logger = logging.getLogger("app.retention")

#: Named for the drift tests and the docs; the statements below carry the
#: same literal text on purpose (Part 13's law: SQL constants are literal,
#: not assembled from names).
TABLE_RETENTION_RUNS = "engine_retention_runs"

#: The pruneable predicate, written out (never concatenated - Part 13's
#: literal law) in both statements that use it. The name exists for the
#: test that pins the two spellings are the SAME text: rehearsal and
#: execution share their meaning by identity of characters, verified - not
#: by a helper both call, which is only one careless edit from not shared.
PRUNABLE_WHERE: Final = (
    "WHERE e.tenant_id = $1 AND o.terminal_at IS NOT NULL AND o.terminal_at < $2 "
    "AND e.occurred_at < $2"
)

COUNT_PRUNABLE_SQL: Final = (
    "SELECT count(*)::bigint AS n FROM engine_order_events e "
    "JOIN engine_orders o ON o.tenant_id = e.tenant_id AND o.order_id = e.order_id "
    "WHERE e.tenant_id = $1 AND o.terminal_at IS NOT NULL AND o.terminal_at < $2 "
    "AND e.occurred_at < $2"
)

SELECT_DOOMED_SEQS_SQL: Final = (
    "SELECT e.seq FROM engine_order_events e "
    "JOIN engine_orders o ON o.tenant_id = e.tenant_id AND o.order_id = e.order_id "
    "WHERE e.tenant_id = $1 AND o.terminal_at IS NOT NULL AND o.terminal_at < $2 "
    "AND e.occurred_at < $2 ORDER BY e.seq LIMIT $3"
)

#: Explicit-seq delete: the WHERE a single-row predicate would need twice
#: the thought ("what is still prunable when this statement runs?") - the
#: seq list came from the same transaction, so this can only delete what
#: the count rehearsal counted. RETURNING 1 lets the rowcount come back as
#: actual rows, not as a status-string parse.
DELETE_BY_SEQS_SQL: Final = (
    "DELETE FROM engine_order_events WHERE tenant_id = $1 AND seq = ANY($2::bigint[]) "
    "RETURNING 1"
)

INSERT_RUN_SQL: Final = (
    "INSERT INTO engine_retention_runs (tenant_id, started_at, finished_at, dry_run, "
    "event_cutoff_us, rows_deleted, batches, exhausted, instance_id) "
    "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)"
)

SELECT_RECENT_RUNS_SQL: Final = (
    "SELECT seq, started_at, finished_at, dry_run, event_cutoff_us, rows_deleted, "
    "batches, exhausted, instance_id FROM engine_retention_runs WHERE tenant_id = $1 "
    "ORDER BY seq DESC LIMIT $2"
)


class RetentionLedgerLost(RuntimeError):
    """The prune happened; its RECORD did not. Carrying the full report on
    the exception is what lets the operator (and the 500 body) still see
    the counts the ledger row failed to reach."""

    def __init__(self, report: RetentionRunReport) -> None:
        super().__init__(
            "retention run completed but its ledger row failed to write; the "
            "log line 'retention.ledger_write_failed' carries the counts"
        )
        self.report = report


@dataclass(frozen=True, slots=True)
class RetentionRunReport:
    """One run's outcome as the ledger row will state it."""

    dry_run: bool
    cutoff_us: int
    rows_reported: int
    batches_run: int
    exhausted: bool
    ledger_written: bool


async def run_event_retention(
    pool: PgPool,
    tenant_id: str,
    policy: RetentionPolicy,
    *,
    dry_run: bool,
    instance_id: str,
    clock: Callable[[], int] = epoch_micros,
) -> RetentionRunReport:
    """Prune the journal (or rehearse it) for ONE tenant.

    The pool is the store's pool - the same one ``PostgresOrderStore`` uses,
    because the same connection law (per-transaction GUC, tenant in every
    WHERE) must hold for deletions that for inserts. ``clock`` is a test
    seam: every timestamp here is the caller's clock, never a hidden one.
    """
    started_at = clock()
    cutoff = policy.event_cutoff_us(started_at)
    deleted = 0
    batches = 0
    exhausted = False

    if dry_run:
        async with _TenantTransaction(pool, tenant_id) as conn:
            rows = await conn.fetch(COUNT_PRUNABLE_SQL, tenant_id, cutoff)
        deleted = int(rows[0]["n"]) if rows else 0
    else:
        while True:
            async with _TenantTransaction(pool, tenant_id) as conn:
                seq_rows = await conn.fetch(
                    SELECT_DOOMED_SEQS_SQL, tenant_id, cutoff, policy.batch_rows
                )
                seqs = [int(r["seq"]) for r in seq_rows]
                if seqs:
                    doomed = await conn.fetch(DELETE_BY_SEQS_SQL, tenant_id, seqs)
                    deleted += len(doomed)
                    batches += 1
            if not seqs:
                break  # journal fully considered; nothing left THIS cutoff
            if len(seqs) < policy.batch_rows:
                break  # partial batch: the end of the work, not the ceiling
            if batches >= policy.max_batches:
                exhausted = True
                break

    report = RetentionRunReport(
        dry_run=dry_run,
        cutoff_us=cutoff,
        rows_reported=deleted,
        batches_run=batches,
        exhausted=exhausted,
        ledger_written=True,
    )
    try:
        async with _TenantTransaction(pool, tenant_id) as conn:
            await conn.execute(
                INSERT_RUN_SQL,
                tenant_id,
                started_at,
                clock(),
                dry_run,
                cutoff,
                deleted,
                batches,
                exhausted,
                instance_id,
            )
    except Exception as error:
        logger.error(
            "retention.ledger_write_failed",
            extra={
                "event": "retention.ledger_write_failed",
                "tenant_id": tenant_id,
                "dry_run": dry_run,
                "cutoff_us": cutoff,
                "rows_reported": deleted,
                "batches_run": batches,
                "exhausted": exhausted,
                "error_type": type(error).__name__,
            },
        )
        # The report an operator receives must not claim a ledger row that
        # failed to write: replace() re-states the one field that changed.
        raise RetentionLedgerLost(replace(report, ledger_written=False)) from error

    logger.info(
        "retention.run.completed",
        extra={
            "event": "retention.run.completed",
            "tenant_id": tenant_id,
            "instance_id": instance_id,
            "dry_run": dry_run,
            "cutoff_us": cutoff,
            "rows_reported": deleted,
            "batches_run": batches,
            "exhausted": exhausted,
        },
    )
    return report


async def inspect_event_store(
    pool: PgPool,
    tenant_id: str,
    policy: RetentionPolicy,
    *,
    limit: int,
    clock: Callable[[], int] = epoch_micros,
) -> dict[str, Any]:
    """One transaction holding both reads: the count NOW and the last few
    ledger rows, consistent with each other (a run completing between the
    two queries is exactly the race that makes an inspect answer lie)."""
    cutoff = policy.event_cutoff_us(clock())
    async with _TenantTransaction(pool, tenant_id) as conn:
        count_rows = await conn.fetch(COUNT_PRUNABLE_SQL, tenant_id, cutoff)
        run_rows = await conn.fetch(SELECT_RECENT_RUNS_SQL, tenant_id, limit)
    prunable = int(count_rows[0]["n"]) if count_rows else 0
    runs = [
        {
            "seq": int(r["seq"]),
            "started_at": int(r["started_at"]),
            "finished_at": int(r["finished_at"]),
            "dry_run": bool(r["dry_run"]),
            "event_cutoff_us": int(r["event_cutoff_us"]),
            "rows_deleted": int(r["rows_deleted"]),
            "batches": int(r["batches"]),
            "exhausted": bool(r["exhausted"]),
            "instance_id": str(r["instance_id"]),
        }
        for r in run_rows
    ]
    return {"cutoffUs": cutoff, "prunableNow": prunable, "runs": runs}


#: Re-exported for the test that pins "this module deletes from exactly one
#: table" - the core's PRUNABLE_JOURNAL constant, reachable from here so the
#: executor's law and the law's name are shown to be the same object.
PRUNABLE_TABLE = PRUNABLE_JOURNAL
