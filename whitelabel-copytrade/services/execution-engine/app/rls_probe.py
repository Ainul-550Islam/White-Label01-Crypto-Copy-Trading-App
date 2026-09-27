"""Read-only enablement verification over the durable store (Part 15).

The judgment lives in the core (``wlct_trading.enablement``); this module is
its executor against Postgres, and every statement in it is a SELECT. That
is the design contract, and it is what makes an "audit" endpoint safe to
offer from a process that owns money rows: the worst this code can do is
read a catalogue slowly. A test asserts no write verb appears in this file.

Three rules do the rest of the work:

1. **The tenant GUC is set in exactly one place.** The catalogue reads and
   the scoped count run inside ``_TenantTransaction`` (Part 13's rhythm:
   acquire -> begin -> ``set_config('app.tenant_id', $1, true)`` -> work ->
   commit), and this module's first statement inside it is
   ``SET TRANSACTION READ ONLY`` (legal only before the transaction touches
   data, which is why it leads). Two consequences: the
   audit runs as the role THIS process actually uses (a superuser session
   could not run these commands at all, so the role-attribute veto can
   never be reading about a more privileged principal than the one serving
   traffic), and an accidental write is refused by the database as well as
   by the absence of any write statement here.

2. **The bare count runs OUTSIDE that transaction, on its own
   acquisition.** ``set_config(..., is_local => true)`` is transaction-local,
   so a freshly acquired connection has no ``app.tenant_id``: only there is
   "count this table with no tenant predicate" a leak test. Running both
   counts through the same transaction would make the bare count identical
   to the scoped one by construction - an audit that structurally cannot
   report a leak. There is nothing to "clear" on the bare connection: the
   platform has no cross-tenant GUC (the ``set_config`` call is
   transaction-local by Part 11's contract, and the docs list a platform-role
   session concept as future work, not a variable to reset), so the only
   thing that could defeat a bare read is a role privilege - which is
   precisely what ``RoleAttributes`` vetoes instead of leaving to SQL.

3. **A refused bare read is the best answer a tenant table can give.** If
   the database denies the unfiltered count (``42501`` insufficient
   privilege - what FORCE + a SELECT-only policy looks like for a role with
   no bypass), the observation is recorded as "zero rows reached" and the
   grade stands. Any OTHER failure of the bare read - a connection drop, a
   timeout - propagates: the run reports nothing rather than grading a
   broken cluster as isolated. A caller who wants to record that as a
   skipped probe does it in the CLI, where the operator is holding the
   error text, not in here where it would be silently laundered into a
   pass.

Nothing is ever seeded, so nothing has to be cleaned up afterwards and no
write path exists to audit. The seed expectations are INPUTS: the operator
(or the staging script) counts what the probe tenant should see and hands
that number over; ``seeded_expected_rows`` of 0 is the honest "unknown"
mode, in which the catalogue posture (policy exists, enabled, forced) is
the real evidence and the counts are a cross-check. Failure handling is
deliberately thin: driver errors propagate, the router answers 5xx, and no
partial evidence is recorded, because a run that could not read pg_class is
not "evidence of nothing".
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Final

from wlct_trading.clock import epoch_micros
from wlct_trading.enablement import (
    EVIDENCE_LEDGER_TABLE,
    EnablementPolicy,
    ProbeResult,
    RoleAttributes,
    grade_run,
)

from app.incidents_sql import TABLE_INCIDENTS
from app.store_sql import PgPool, _TenantTransaction

__all__ = [
    "PROBE_TABLES",
    "EnablementAudit",
    "ProbeRoleUnknown",
    "ProbeUnknownTable",
    "run_enablement_probe",
]

logger = logging.getLogger("app.rls_probe")

#: Postgres' "insufficient_privilege" SQLSTATE. Duck-typed rather than
#: imported from ``asyncpg.exceptions`` so this module stays driver-light
#: the way Part 13's store does, and so the fakes in the test suite only
#: have to carry the attribute, not the class.
INSUFFICIENT_PRIVILEGE_SQLSTATE: Final = "42501"

#: The tables this service can verify by itself: the durable engine tables
#: (Part 13's three, plus Part 17's incident table) and its own ledger (Part
#: 14). Everything else in ``rls_coverage.json`` belongs to the API plane and is
#: the operator script's job. An engine that claimed to have verified tables it
#: cannot name would be the loudest liar in the report, so the list is a module
#: constant an operator widens in a review, never in a request body - and the
#: incident table is IN it, because an unprotected incident table is a
#: cross-tenant readable list of one tenant's failures, which is exactly the
#: shape of leak the audit exists to catch.
PROBE_TABLES: Final = (
    "engine_orders",
    "engine_order_events",
    "engine_order_fills",
    TABLE_INCIDENTS,
    EVIDENCE_LEDGER_TABLE,
)

# --- catalogue and count statements (literal text; never assembled) ------

ROLE_ATTRS_SQL: Final = (
    "SELECT current_user::text AS rolname, r.rolsuper, r.rolbypassrls "
    "FROM pg_roles r WHERE r.rolname = current_user"
)

#: Existence by ``to_regclass``, the exact spelling Part 13's store-open
#: check uses: the audit and the startup gate agree on what "the table is
#: here" means, so a table neither can find is reported the same way twice.
TABLE_EXISTS_SQL: Final = "SELECT to_regclass($1) AS regclass"

TABLE_POSTURE_SQL: Final = (
    "SELECT c.relrowsecurity, c.relforcerowsecurity FROM pg_class c "
    "JOIN pg_namespace n ON n.oid = c.relnamespace "
    "WHERE n.nspname = 'public' AND c.relname = $1 AND c.relkind IN ('r', 'p')"
)

POLICY_POSTURE_SQL: Final = (
    "SELECT count(*)::bigint AS policy_count, "
    "bool_or(p.qual IS NOT NULL AND position('app.tenant_id' in p.qual) > 0) "
    "AS scoped FROM pg_policies p WHERE p.schemaname = 'public' "
    "AND p.tablename = $1 AND p.policyname = 'tenant_isolation'"
)

#: The scoped count keeps the tenant in SQL TEXT as well as in the GUC: the
#: belt-and-braces law every covered statement on this platform follows, so
#: a policy that was never enabled still cannot make the audit lie about
#: which tenant it counted.
SCOPED_COUNT_SQL: Final = "SELECT count(*)::bigint AS n FROM {table} WHERE tenant_id = $1"

BARE_COUNT_SQL: Final = "SELECT count(*)::bigint AS n FROM {table}"

#: Read-only, on purpose, and asserted as text by a test: the module that
#: audits must not be the module that changes.
READ_ONLY_SQL: Final = "SET TRANSACTION READ ONLY"


class ProbeUnknownTable(RuntimeError):
    """A caller asked about a table outside the allow-list: the name reaches
    ``{table}`` interpolation, so it is the one place a request could
    smuggle SQL into an audit. Checked against this module's own constant
    before a connection is even acquired."""


class ProbeRoleUnknown(RuntimeError):
    """``pg_roles`` had no row for the connected role.

    That happens when the login role is a member rather than the row owner,
    or when the catalog was read by something other than the serving role.
    Either way the run cannot state WHICH role it verified, and a bypass
    flag we failed to read is exactly the flag worth refusing for: the
    audit answers by not answering.
    """


@dataclass(frozen=True, slots=True)
class EnablementAudit:
    """One verification run, in the shape the wire and the evidence ledger
    both want."""

    ran_at_us: int
    #: ``RunGrade.PASS``/``FAIL``/``UNVERIFIED`` - plain strings by the
    #: core's design (Grade is a constant namespace, not an Enum), which is
    #: what keeps this report serialisable into an evidence ledger without a
    #: per-field conversion step that could drift from the law.
    grade: str
    role: RoleAttributes
    probes: tuple[ProbeResult, ...]
    summary: dict[str, Any]
    #: True when the run covered the WHOLE platform manifest (the caller
    #: graded it against ``covered_expected`` = the manifest count). A
    #: default run grades the engine plane only, so this is False there:
    #: "4 of 4 of my tables pass" and "the platform is verified" are
    #: different sentences and the body must not be able to say the second.
    full_platform: bool
    #: True when every table THIS service can see was included in the run -
    #: the engine plane's own completeness, independent of the manifest.
    engine_plane_complete: bool

    @property
    def per_table(self) -> dict[str, str]:
        tables = self.summary.get("tables")
        return dict(tables) if isinstance(tables, dict) else {}

    @property
    def failed_tables(self) -> tuple[str, ...]:
        return tuple(name for name, value in self.per_table.items() if value == "fail")


async def run_enablement_probe(
    pool: PgPool,
    tenant_id: str,
    policy: EnablementPolicy,
    *,
    now_us: int | None = None,
    seed_counts: dict[str, int] | None = None,
    covered_expected: int | None = None,
) -> EnablementAudit:
    """Verify the engine-plane tables are enabled, forced and effective.

    ``seed_counts`` maps table -> rows that tenant is expected to see (omit
    it, or pass ``{}``, for the honest unknown-seed mode).
    ``covered_expected`` is the coverage manifest's count; the default
    grades the run against THIS service's table list, because a route that
    can only see five tables must not report the platform's 43 as
    UNVERIFIED - it reports a full pass of its own plane and
    ``fullPlatform: false`` next to it.
    """
    seeds = dict(seed_counts or {})
    for name in seeds:
        if name not in PROBE_TABLES:
            raise ProbeUnknownTable(
                f"seed_counts names {name!r}, which this service does not probe "
                f"(known: {', '.join(PROBE_TABLES)})"
            )
    ran_at = now_us if now_us is not None else epoch_micros()

    async with _TenantTransaction(pool, tenant_id) as conn:
        # Ordering is a Postgres requirement, not a style choice:
        # ``SET TRANSACTION`` is only legal before the transaction has run a
        # data-touching statement, and ``set_config`` (issued by the
        # transaction helper itself) is not one. So the read-only flag is the
        # FIRST statement this module sends, and a test pins that.
        await conn.execute(READ_ONLY_SQL)
        row = await conn.fetchrow(ROLE_ATTRS_SQL)
        if row is None:
            raise ProbeRoleUnknown(
                "pg_roles has no row for the connected role: the audit cannot "
                "state which role it verified, and a BYPASSRLS flag that was "
                "never read is not a flag that was checked"
            )
        role = RoleAttributes(
            rolname=str(row["rolname"]),
            bypassrls=bool(row["rolbypassrls"]),
            superuser=bool(row["rolsuper"]),
        )
        # Phase 1: everything that is a fact about the CATALOGUE plus the
        # tenant's own count, read inside the GUC'd transaction. The table
        # names here are this module's constant, never request input:
        # `{table}` interpolation of an allow-listed literal is how Part 13
        # spells its own statements, and the existence check is spelled like
        # the store-open check on purpose (one meaning for "the table is
        # here" across the platform).
        phase_one: dict[str, tuple[bool, bool, bool, int, bool]] = {}
        for table in PROBE_TABLES:
            if await conn.fetchrow(TABLE_EXISTS_SQL, f"public.{table}") is None:
                phase_one[table] = (False, False, False, 0, True)
                continue
            posture = await conn.fetchrow(TABLE_POSTURE_SQL, table)
            policy_row = await conn.fetchrow(POLICY_POSTURE_SQL, table)
            scoped = await conn.fetchrow(SCOPED_COUNT_SQL.format(table=table), tenant_id)
            phase_one[table] = (
                bool(policy_row is not None and int(policy_row["policy_count"]) > 0),
                bool(posture is not None and posture["relrowsecurity"]),
                bool(posture is not None and posture["relforcerowsecurity"]),
                0 if scoped is None else int(scoped["n"]),
                False,
            )

    # Phase 2: the unfiltered counts, OUTSIDE the transaction (see the
    # module docstring's rule 2). One borrowed session answers them all, so
    # the audit is two pool acquisitions rather than one per table - and an
    # absent table is never counted at all, because counting a table that is
    # not there is not a finding, it is an error message.
    live = [table for table, values in phase_one.items() if not values[4]]
    bare_rows = await _bare_counts(pool, live)

    probes: list[ProbeResult] = []
    for table in PROBE_TABLES:
        policy_exists, rls_enabled, rls_forced, scoped_rows, absent = phase_one[table]
        probes.append(
            ProbeResult(
                table=table,
                policy_exists=policy_exists,
                rls_enabled=rls_enabled,
                rls_forced=rls_forced,
                scoped_rows=scoped_rows,
                bare_rows=bare_rows.get(table, 0),
                seeded_expected_rows=seeds.get(table, 0),
                absent=absent,
            )
        )

    grade, summary = grade_run(
        probes,
        role=role,
        covered_expected=len(PROBE_TABLES) if covered_expected is None else covered_expected,
    )
    audit = EnablementAudit(
        ran_at_us=ran_at,
        grade=grade,
        role=role,
        probes=tuple(probes),
        summary=summary,
        full_platform=covered_expected is not None and covered_expected != len(PROBE_TABLES),
        engine_plane_complete=(
            covered_expected is None or covered_expected == len(PROBE_TABLES)
        ),
    )
    logger.info(
        "enablement.audit",
        extra={
            "event": "enablement.audit",
            "grade": grade,
            "probed": len(audit.probes),
            "role": role.rolname,
        },
    )
    return audit


async def _bare_counts(pool: PgPool, tables: list[str]) -> dict[str, int]:
    """``count(*)`` per table on a session that never saw the tenant GUC.

    A privilege refusal is recorded as zero rows reached (the ideal answer
    for a forced tenant table); any other failure propagates so a broken
    connection can never be graded as isolation.

    This is the ONE place in the engine that deliberately reads without the
    tenant GUC, and it is a ``count(*)``: the acquisition is outside any
    transaction, so it inherits no ``app.tenant_id``, and nothing here can
    write even in principle. An ``async with`` rather than a manual
    acquire/release so the connection's return to the pool is not a
    judgement call inside an error path.
    """
    counts: dict[str, int] = {}
    if not tables:
        return counts
    async with pool.acquire() as conn:
        for table in tables:
            try:
                row = await conn.fetchrow(BARE_COUNT_SQL.format(table=table))
            except Exception as error:
                # The ONLY swallowed error on this path: Postgres saying "you
                # may not read that table without a tenant" is the finding,
                # not a failure - it is what a correctly FORCED tenant table
                # answers. Duck-typed on the SQLSTATE so this module never
                # imports the driver's exception hierarchy, and everything
                # else (connection drop, timeout, cancellation) propagates
                # rather than being laundered into a pass.
                if getattr(error, "sqlstate", None) != INSUFFICIENT_PRIVILEGE_SQLSTATE:
                    raise
                counts[table] = 0
                continue
            counts[table] = 0 if row is None else int(row["n"])
    return counts
