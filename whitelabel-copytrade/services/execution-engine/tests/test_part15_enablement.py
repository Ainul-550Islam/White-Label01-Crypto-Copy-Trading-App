"""Part 15: the read-only enablement executor and its one route.

Three layers, and the first one is the important one because an audit's
whole value is WHAT IT REFUSES TO DO:

1. **The statement laws**, read off the module's own strings: every
   constant is a SELECT (or the read-only SET), the scoped and bare counts
   differ by exactly the tenant predicate, the existence check is spelled
   like Part 13's store-open check, and the probe table list is the engine
   plane's - no more, no less.
2. **The executor against a scripted fake pool**, which pins the one design
   fact a reviewer cannot see from a green run: the BARE count must come
   from a DIFFERENT acquisition that never ran ``set_config``, inside no
   transaction. FakeConn records per-transaction statement lists exactly as
   Part 14's does, so "the leak probe leaked the GUC" is a test failure
   rather than a false PASS in production. Absent tables, a bypassing role,
   an unreadable role, an unknown seed table, a refused bare read
   (best-case) versus a dropped one (must propagate) - all graded here,
   never in the route.
3. **The route**, booted through the real composition with the lifespan
   seam patched: the memory 409, a graded 200 body in camelCase with
   ``fullPlatform`` next to the headline grade, request-shape refusals, and
   the status surface's new field.

No suppression comments anywhere, as in Part 14: the deliberately-wrong
values are typed through ``Any`` and a ``cast``.
"""

from __future__ import annotations

import asyncio
import inspect
import re
from contextlib import ExitStack
from typing import Any, cast
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from wlct_trading.clock import epoch_micros
from wlct_trading.enablement import EnablementPolicy
from wlct_trading.execution.store import OrderStoreError

from app import rls_probe
from app.config import get_settings
from app.rls_probe import (
    BARE_COUNT_SQL,
    EVIDENCE_LEDGER_TABLE,
    POLICY_POSTURE_SQL,
    PROBE_TABLES,
    READ_ONLY_SQL,
    ROLE_ATTRS_SQL,
    SCOPED_COUNT_SQL,
    TABLE_EXISTS_SQL,
    EnablementAudit,
    ProbeRoleUnknown,
    ProbeUnknownTable,
    run_enablement_probe,
)
from app.store_sql import SET_TENANT_SQL, PostgresOrderStore

TENANT = str(uuid4())
POLICY = EnablementPolicy(max_evidence_age_days=30)
RAN_AT = 1_757_700_000_000_000

#: The four catalog/count shapes the executor issues, matched by the fake
#: with these literals so a change to the SQL is a test change, not a fake
#: that quietly stops answering anything.
ROLE_KEY = "FROM pg_roles r WHERE r.rolname = current_user"
EXISTS_KEY = "SELECT to_regclass($1) AS regclass"
POSTURE_KEY = "SELECT c.relrowsecurity, c.relforcerowsecurity"
POLICY_KEY = "FROM pg_policies p"
SCOPED_KEY = "WHERE tenant_id = $1"


class Row(dict[str, Any]):
    """A fetchrow answer that reads like a record."""


class FakeTx:
    def __init__(self, conn: FakeConn) -> None:
        self._conn = conn

    async def __aenter__(self) -> None:
        self._conn.tx_begins += 1
        self._conn.txes.append([])

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> bool:
        if exc_type is None:
            self._conn.tx_commits += 1
        else:
            self._conn.tx_rollbacks += 1
        return False


class FakeConn:
    """Answers by matching the statement against a small script, and records
    WHERE each statement ran (inside a transaction or not).

    Deliberately NOT a replay list: the audit issues a variable number of
    statements (one per table, and the table list is what the drift test
    pins), so matching by shape keeps the fakes honest about the SQL and
    silent about the count - the count is asserted separately, on purpose.
    """

    def __init__(self, *, mode: str, answers: dict[str, Any]) -> None:
        self.mode = mode  # "scoped" (inside the tenant transaction) or "bare"
        self.answers = answers
        self.statements: list[tuple[str, tuple[object, ...], str]] = []
        self.txes: list[list[str]] = [[]]
        self.tx_begins = 0
        self.tx_commits = 0
        self.tx_rollbacks = 0

    def _answer_for(self, query: str) -> Any:
        for key, value in self.answers.items():
            if key in query:
                if isinstance(value, BaseException):
                    raise value
                if callable(value):
                    return value(query)
                return value
        return None

    def _record(self, query: str, args: tuple[object, ...]) -> None:
        self.statements.append((query, args, self.mode))
        self.txes[-1].append(query)

    async def execute(self, query: str, *args: object) -> str:
        self._record(query, args)
        return "OK 1"

    async def fetchrow(self, query: str, *args: object) -> Any:
        self._record(query, args)
        return self._answer_for(query)

    async def fetch(self, query: str, *args: object) -> list[Any]:
        self._record(query, args)
        answer = self._answer_for(query)
        return list(answer) if isinstance(answer, list) else []

    def transaction(self) -> FakeTx:
        return FakeTx(self)

    def texts(self, mode: str | None = None) -> list[str]:
        return [q for q, _, m in self.statements if mode is None or m == mode]


class FakeAcquire:
    def __init__(self, conn: FakeConn) -> None:
        self._conn = conn

    async def __aenter__(self) -> FakeConn:
        return self._conn

    async def __aexit__(self, *exc: object) -> bool:
        return False


class FakePool:
    """Two connection slots, because the executor's whole trick is that it
    borrows a SECOND, GUC-less one for the bare count."""

    def __init__(self, scoped: FakeConn, *bare: FakeConn) -> None:
        self.scoped = scoped
        self.bare_conns = list(bare)
        self.acquires = 0
        self.closed = False

    def acquire(self) -> FakeAcquire:
        self.acquires += 1
        if self.acquires == 1:
            return FakeAcquire(self.scoped)
        if not self.bare_conns:
            raise AssertionError(
                "the audit borrowed more connections than this fake offers - "
                "the unfiltered phase must be ONE session for all tables"
            )
        return FakeAcquire(self.bare_conns[len(self.bare_conns) - 1])

    async def close(self) -> None:
        self.closed = True


def healthy_answers(
    *,
    scoped: int = 3,
    bare: int = 0,
    bypassrls: bool = False,
    superuser: bool = False,
    rolname: str = "wlct_app",
    exists: bool = True,
    relrowsecurity: bool = True,
    relforcerowsecurity: bool = True,
    policy_count: int = 1,
) -> tuple[dict[str, Any], dict[str, Any]]:
    scoped_answers: dict[str, Any] = {
        ROLE_KEY: Row(rolname=rolname, rolsuper=superuser, rolbypassrls=bypassrls),
        EXISTS_KEY: None if not exists else Row(regclass="public.engine_orders"),
        POSTURE_KEY: Row(relrowsecurity=relrowsecurity, relforcerowsecurity=relforcerowsecurity),
        POLICY_KEY: Row(policy_count=policy_count, scoped=True),
        SCOPED_KEY: Row(n=scoped),
    }
    # The bare session must be answered by a key the SCOPED statements do
    # not contain, and vice versa: a fake that answers everything would
    # happily let the executor read tenant-filtered numbers on the
    # unfiltered side - the exact bug this split exists to catch.
    bare_answers: dict[str, Any] = {"count(*)::bigint AS n FROM ": Row(n=bare)}
    return scoped_answers, bare_answers


def pair(**overrides: Any) -> tuple[FakePool, FakeConn, FakeConn]:
    """(pool, scoped_conn, first_bare_conn) - the bare list on the pool is
    what the assertions read, since one session now serves the whole
    unfiltered phase. A pool is SINGLE-USE in these tests on purpose: reusing
    one for a second run would silently reuse the first run's connections and
    their statement history, and "which run emitted that?" would stop being
    answerable. Call ``pair()`` again for a second audit."""
    scoped_answers, bare_answers = healthy_answers(**overrides)
    scoped = FakeConn(mode="scoped", answers=scoped_answers)
    bare = FakeConn(mode="bare", answers=bare_answers)
    return FakePool(scoped, bare), scoped, bare


def run_pool(pool: FakePool, tenant: str = TENANT, **kwargs: Any) -> EnablementAudit:
    """One audit through the pool, cast at the seam where the fake meets the
    ``PgPool`` protocol - the same single cast every Part 13/14 test uses."""
    return asyncio.run(run_enablement_probe(cast(Any, pool), tenant, POLICY, **kwargs))


def run(pool: FakePool, **kwargs: Any) -> EnablementAudit:
    options: dict[str, Any] = {
        "now_us": RAN_AT,
        "seed_counts": {name: 3 for name in PROBE_TABLES},
    }
    options.update(kwargs)
    return run_pool(pool, **options)


def tables(audit: EnablementAudit) -> dict[str, str]:
    return audit.per_table


class TestStatementLaws:
    def test_every_statement_is_a_read(self) -> None:
        statements = [
            value
            for value in vars(rls_probe).values()
            if isinstance(value, str)
            and re.match(r"^(SELECT|SET|INSERT|UPDATE|DELETE|ALTER)", value)
        ]
        assert statements, "the module should hold its SQL as constants"
        for stmt in statements:
            assert stmt.startswith("SELECT") or stmt == READ_ONLY_SQL, stmt
            assert not re.search(r"\b(INSERT|UPDATE|DELETE|ALTER|TRUNCATE|DROP|GRANT)\b", stmt)

    def test_scoped_and_bare_differ_by_exactly_the_tenant_predicate(self) -> None:
        # The one-line difference IS the finding: same table, same
        # aggregate, one has the belt and the other does not. If either
        # drifts in any other direction the two counts stop being
        # comparable and the whole grade is meaningless arithmetic.
        base = "SELECT count(*)::bigint AS n FROM {table}"
        assert SCOPED_COUNT_SQL == base + " WHERE tenant_id = $1"
        assert BARE_COUNT_SQL == base
        assert "count(*)" in SCOPED_COUNT_SQL and "count(*)" in BARE_COUNT_SQL

    def test_existence_check_is_the_store_open_spelling(self) -> None:
        assert TABLE_EXISTS_SQL == "SELECT to_regclass($1) AS regclass"

    def test_role_query_is_the_checklist_query(self) -> None:
        # enable.sql's pre-flight item 2, in SQL, verbatim in spirit: the
        # audit reads the same two flags a human is told to read by hand.
        assert "rolbypassrls" in ROLE_ATTRS_SQL and "rolsuper" in ROLE_ATTRS_SQL
        assert "pg_roles" in ROLE_ATTRS_SQL
        assert "current_user" in ROLE_ATTRS_SQL

    def test_policy_query_asks_the_named_policy_and_the_guc(self) -> None:
        assert "policyname = 'tenant_isolation'" in POLICY_POSTURE_SQL
        assert "position('app.tenant_id' in p.qual)" in POLICY_POSTURE_SQL
        assert "p.schemaname = 'public'" in POLICY_POSTURE_SQL

    def test_probe_tables_are_the_engine_plane(self) -> None:
        assert PROBE_TABLES == (
        "engine_orders",
        "engine_order_events",
        "engine_order_fills",
        # Part 17's incident table is IN the engine plane set, not an addition a
        # report can skip: an unprotected incident table is a cross-tenant
        # readable list of one tenant's failures, which is precisely the leak this
        # audit is built to find.
        "engine_incidents",
        EVIDENCE_LEDGER_TABLE,
    )

    def test_the_guc_statement_is_reused_not_restated(self) -> None:
        # The executor must borrow Part 13's exact set_config text: a second
        # spelling of the tenant contract is a second contract.
        assert "app.tenant_id" in SET_TENANT_SQL

    def test_transaction_is_forced_read_only_first(self) -> None:
        assert READ_ONLY_SQL == "SET TRANSACTION READ ONLY"
        # and the module actually SENDS it first: SET TRANSACTION is only
        # legal before the transaction touches data, so a reordering that
        # moves it after the first SELECT makes the audit error out on a
        # real server while every fake still says fine.
        executor = inspect.getsource(run_enablement_probe)
        body = executor.split("async with _TenantTransaction")[1]
        assert body.index("READ_ONLY_SQL") < body.index("fetchrow")
        assert "await conn.execute(READ_ONLY_SQL)" in body


class TestExecutorBranches:
    def test_a_healthy_database_passes_and_reads_the_way_it_must(self) -> None:
        pool, scoped, bare = pair()
        audit = run(pool)
        assert audit.grade == "pass"
        # the default run is a COMPLETE ENGINE PLANE, not a complete platform
        assert audit.full_platform is False and audit.engine_plane_complete is True
        assert tables(audit) == {name: "pass" for name in PROBE_TABLES}
        # the transaction law: the GUC is set first, once, inside the tx,
        # and everything in that connection's first transaction
        # the fake opens a statement list per transaction, and the store's
        # helper runs set_config BEFORE entering the tx: so list 0 is the
        # GUC alone and list 1 is the transaction's real conversation.
        # The transaction the audit ran inside is the second bucket (the
        # fake opens one per begin), and its first statement is the store's
        # own GUC set - then OURS. READ ONLY must be the first statement this
        # module sends: SET TRANSACTION is illegal after the transaction has
        # touched data, so a reordering that puts a SELECT first would make
        # the audit error out on a real server while every fake still says
        # fine.
        assert len(scoped.txes) == 2 and scoped.txes[0] == []
        assert scoped.txes[1][0] == SET_TENANT_SQL
        assert scoped.txes[1][1] == READ_ONLY_SQL
        assert scoped.txes[1][2] == ROLE_ATTRS_SQL
        assert scoped.tx_begins == 1 and scoped.tx_commits == 1
        # and the bare read ran OUTSIDE it, on a different connection
        assert bare.tx_begins == 0
        assert all("set_config" not in q for q, _, _ in bare.statements)
        scoped_counts = [q for q, _, m in scoped.statements if SCOPED_KEY in q and m == "scoped"]
        assert len(scoped_counts) == len(PROBE_TABLES)
        assert len(bare.statements) == len(PROBE_TABLES)
        assert pool.acquires == 2  # one transaction, one bare session
        assert [q for q, _, _ in bare.statements] == [
            rls_probe.BARE_COUNT_SQL.format(table=name) for name in PROBE_TABLES
        ]

    def test_absent_table_is_a_fail_never_a_pass_and_never_bare_counted(self) -> None:
        pool, scoped, bare = pair(exists=False)
        audit = run(pool)
        assert audit.grade == "fail"
        assert all(probe.absent for probe in audit.probes)
        # an absent table cannot be bare-counted (there is nothing to
        # count): the unfiltered phase is not even started, so the pool
        # borrowed exactly ONE connection for this whole run.
        assert bare.statements == [] and pool.acquires == 1
        assert tables(audit) == {name: "fail" for name in PROBE_TABLES}

    def test_a_bypassing_role_vetoes_the_healthiest_run(self) -> None:
        pool, _scoped, _bare = pair(bypassrls=True)
        audit = run(pool)
        assert audit.grade == "fail"
        assert "BYPASSRLS" in str(audit.summary["veto"])
        assert audit.role.bypassrls is True

    def test_superuser_without_bypass_is_still_a_veto(self) -> None:
        pool, _scoped, _bare = pair(superuser=True)
        assert run(pool).grade == "fail"

    def test_an_unreadable_role_stops_the_audit_instead_of_guessing(self) -> None:
        answers, _bare_answers = healthy_answers()
        answers[ROLE_KEY] = None  # pg_roles has no row for this role
        scoped = FakeConn(mode="scoped", answers=answers)
        bare = FakeConn(mode="bare", answers={})
        with pytest.raises(ProbeRoleUnknown, match="cannot"):
            run_pool(FakePool(scoped, bare), now_us=RAN_AT)
        # it refused BEFORE reading the tables it was going to grade
        assert [q for q, _, _ in scoped.statements].count(EXISTS_KEY) == 0

    def test_a_refused_bare_read_is_the_best_answer_not_an_error(self) -> None:
        class Denied(Exception):
            sqlstate = "42501"

        scoped_answers, _ = healthy_answers()
        bare = FakeConn(mode="bare", answers={"count(*)": Denied("permission denied")})
        scoped = FakeConn(mode="scoped", answers=scoped_answers)
        audit = run(FakePool(scoped, bare))
        assert audit.grade == "pass"
        assert all(probe.bare_rows == 0 for probe in audit.probes)

    def test_a_dropped_bare_read_propagates_and_records_nothing(self) -> None:
        scoped_answers, _ = healthy_answers()

        class Gone(Exception):
            sqlstate = "08006"

        bare = FakeConn(mode="bare", answers={"count(*)": Gone("connection gone")})
        scoped = FakeConn(mode="scoped", answers=scoped_answers)
        with pytest.raises(Gone):
            run_pool(FakePool(scoped, bare), now_us=RAN_AT)

    def test_unknown_force_or_policy_each_grade_fail(self) -> None:
        for kwargs in ({"relforcerowsecurity": False}, {"policy_count": 0}):
            pool, _scoped, _bare = pair(**kwargs)
            audit = run(pool)
            assert audit.grade == "fail", kwargs

    def test_bare_rows_that_are_not_zero_fail_a_tenant_table(self) -> None:
        pool, _scoped, _bare = pair(bare=7)
        audit = run(pool)
        assert audit.grade == "fail"
        assert audit.failed_tables == PROBE_TABLES

    def test_unknown_seed_mode_is_still_a_real_audit(self) -> None:
        # seed_counts absent: the catalogue posture carries the finding and
        # the counts cross-check each other; this is the mode a first-run
        # operator gets, and it must not silently become a skip.
        pool, _scoped, _bare = pair(scoped=0, bare=0)
        audit = run(pool, seed_counts=None)
        assert audit.grade == "pass"
        assert all(probe.seeded_expected_rows == 0 for probe in audit.probes)

    def test_a_scoped_read_that_sees_more_than_seeded_fails(self) -> None:
        pool, _scoped, _bare = pair(scoped=4, bare=4)
        audit = run(pool, seed_counts={name: 3 for name in PROBE_TABLES})
        assert audit.grade == "fail"

    def test_seed_counts_outside_the_allow_list_refuse_before_connecting(self) -> None:
        pool, scoped, _bare = pair()
        with pytest.raises(ProbeUnknownTable, match="does not probe"):
            run(pool, seed_counts={"users": 3})
        assert scoped.statements == []
        assert pool.acquires == 0

    def test_partial_coverage_reports_its_own_plane_honestly(self) -> None:
        audit = run(pair()[0], covered_expected=len(PROBE_TABLES))
        assert audit.grade == "pass" and audit.full_platform is False
        assert audit.engine_plane_complete is True
        audit = run(pair()[0])  # the default: this service's own plane
        assert audit.grade == "pass" and audit.engine_plane_complete is True
        assert audit.full_platform is False
        audit = run(pair()[0], covered_expected=43)  # the whole platform manifest
        assert audit.grade == "unverified" and audit.full_platform is True
        assert audit.engine_plane_complete is False
        assert "43 covered" in str(audit.summary["veto"])

    def test_the_audit_object_holds_the_facts_the_route_needs(self) -> None:
        pool, _scoped, _bare = pair(scoped=2, bare=0)
        audit = run(pool, seed_counts={name: 2 for name in PROBE_TABLES})
        assert audit.grade == "pass"
        assert audit.role.rolname == "wlct_app" and audit.role.bypassrls is False
        assert {probe.table for probe in audit.probes} == set(PROBE_TABLES)
        assert all(probe.scoped_rows == 2 and probe.bare_rows == 0 for probe in audit.probes)
        broken_pool, _s, _b = pair(bare=1)
        broken = run(broken_pool, seed_counts={name: 3 for name in PROBE_TABLES})
        # the per-table grades are re-derived by the core law, so they must
        # agree with the headline even when the run is broken
        assert broken.grade == "fail" and set(broken.per_table.values()) == {"fail"}
        assert broken.failed_tables == PROBE_TABLES

    def test_non_canonical_tenant_never_reaches_the_database(self) -> None:
        pool, scoped, _bare = pair()
        with pytest.raises(OrderStoreError, match="canonical UUID"):
            run_pool(pool, tenant="not-a-uuid", now_us=RAN_AT)
        assert scoped.statements == []

    def test_now_us_is_the_only_clock(self) -> None:
        audit = run(pair()[0])
        assert audit.ran_at_us == RAN_AT
        before = epoch_micros()
        auto = run(pair()[0], now_us=None)
        assert auto.ran_at_us >= before

    def test_summary_is_json_ready(self) -> None:
        import json

        pool, _scoped, _bare = pair()
        json.dumps(run(pool).summary)


def postgres_client(
    monkeypatch: pytest.MonkeyPatch,
    stack: ExitStack,
    **overrides: Any,
) -> tuple[TestClient, FakeConn, FakeConn]:
    """A booted app on the postgres backend with the probe's fakes wired at
    the lifespan seam (same technique as Part 14's route tests), so what is
    under test is the real router, deps and settings."""
    monkeypatch.setenv("EXECUTION_STORE_BACKEND", "postgres")
    monkeypatch.setenv("EXECUTION_POSTGRES_DSN", "postgresql://u:p@db:5432/wlct")
    get_settings.cache_clear()
    pool, scoped, bare = pair(**overrides)
    from app.main import create_app

    async def fake_open(settings: Any) -> tuple[FakePool, PostgresOrderStore]:
        return pool, PostgresOrderStore(cast(Any, pool))

    monkeypatch.setattr("app.main.open_durable_store", fake_open)
    client = stack.enter_context(TestClient(create_app()))
    return client, scoped, bare


def headers(tenant: str = TENANT) -> dict[str, str]:
    from tests.conftest import BASE_ENV

    return {
        "x-internal-token": BASE_ENV["EXECUTION_INTERNAL_TOKEN"],
        "x-tenant-id": tenant,
    }


class TestRoutesMemoryMode:
    def test_audit_refused_with_reason_not_fabricated_success(
        self, client: TestClient
    ) -> None:
        response = client.post(
            "/internal/v1/enablement/audit", json={"tenantId": TENANT}, headers=headers()
        )
        assert response.status_code == 409
        body = response.json()
        assert body["code"] == "RETENTION_NO_DURABLE_STORE"
        # memory has nothing to verify; the message says so and points at
        # the operator-side check that CAN run there
        assert "--check-rls" in body["message"]

    def test_status_publishes_the_shipped_evidence_window(
        self, client: TestClient
    ) -> None:
        body = client.get("/internal/v1/status", headers=headers()).json()
        assert body["enablementMaxAgeDays"] == 30

    def test_an_overridden_window_is_visible_on_the_same_surface(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("EXECUTION_ENABLEMENT_MAX_AGE_DAYS", "7")
        get_settings.cache_clear()
        with ExitStack() as stack:
            client, _a, _b = postgres_client(monkeypatch, stack)
            body = client.get("/internal/v1/status", headers=headers()).json()
            assert body["enablementMaxAgeDays"] == 7


class TestRoutesDurableMode:
    def test_healthy_cluster_answers_200_with_a_camel_case_body(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, scoped, bare = postgres_client(monkeypatch, stack, scoped=2)
            response = client.post(
                "/internal/v1/enablement/audit",
                json={"tenantId": TENANT, "seedCounts": {name: 2 for name in PROBE_TABLES}},
                headers=headers(),
            )
            assert response.status_code == 200
            body = response.json()
            assert body["grade"] == "pass"
            # five tables is not 43 - and the body says BOTH truths, so a
            # dashboard that colours "pass" green still has to explain why
            # fullPlatform is false next to it. (The count went 4 -> 5 when Part
            # 17's incident table joined the engine plane; the number is asserted
            # here rather than derived, so a sink that quietly stops being probed
            # fails this test instead of shrinking the assurance.)
            assert body["fullPlatform"] is False
            assert body["enginePlaneComplete"] is True
            assert body["probed"] == 5
            assert isinstance(body["ranAtUs"], int)
            assert body["role"]["rolname"] == "wlct_app"
            assert body["probes"][0]["policyExists"] is True
            assert body["probes"][0]["seededExpectedRows"] == 2
            assert "skipReason" in body["probes"][0]
            assert scoped.tx_commits == 1 and bare.tx_begins == 0

    def test_a_leak_is_reported_as_a_200_fail_not_a_500(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # The most important status-code decision on this surface: the audit
        # ran, the finding is the answer. Hiding evidence in a transport
        # error is how audits get disabled.
        with ExitStack() as stack:
            client, _scoped, _bare = postgres_client(monkeypatch, stack, bare=9)
            response = client.post(
                "/internal/v1/enablement/audit",
                json={"tenantId": TENANT},
                headers=headers(),
            )
            assert response.status_code == 200
            body = response.json()
            assert body["grade"] == "fail"
            assert set(body["summary"]["tables"].values()) == {"fail"}

    def test_bad_seed_shape_is_422_before_any_statement(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, scoped, _bare = postgres_client(monkeypatch, stack)
            for payload in (
                {"tenantId": TENANT, "seedCounts": {"engine_orders": -1}},
                {"tenantId": TENANT, "seedCounts": {"engine_orders": "3"}},
                {"tenantId": TENANT, "seedCounts": {"engine_orders": True}},
                {"tenantId": TENANT, "seedCounts": "engine_orders=3"},
                {"tenantId": TENANT, "extra": 1},
            ):
                response = client.post(
                    "/internal/v1/enablement/audit", json=payload, headers=headers()
                )
                assert response.status_code == 422, payload
            assert scoped.statements == []

    def test_probe_table_outside_the_allow_list_is_400(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, _scoped, _bare = postgres_client(monkeypatch, stack)
            response = client.post(
                "/internal/v1/enablement/audit",
                json={"tenantId": TENANT, "seedCounts": {"users": 3}},
                headers=headers(),
            )
            assert response.status_code == 400
            assert response.json()["code"] == "ENABLEMENT_REQUEST_REFUSED"

    def test_negative_coverage_expectation_is_refused(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # 422 because the wire model states the core's bounds for this one
        # field (0..4096, parity-pinned) and refuses before a connection is
        # borrowed; a value INSIDE those bounds that the core still dislikes
        # would come back as its own 400. Either way it is never a 5xx and
        # never a graded run built on a nonsense expectation.
        with ExitStack() as stack:
            client, scoped, bare = postgres_client(monkeypatch, stack)
            response = client.post(
                "/internal/v1/enablement/audit",
                json={"tenantId": TENANT, "coveredExpected": -1},
                headers=headers(),
            )
            assert response.status_code == 422
            # the refusal is COMPLETE: nothing was borrowed and nothing was
            # read on either connection, so "a 422 costs the database
            # nothing" is measured here rather than assumed.
            assert scoped.statements == [] and bare.statements == []

    def test_tenant_mismatch_is_refused_at_the_door(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, scoped, _bare = postgres_client(monkeypatch, stack)
            response = client.post(
                "/internal/v1/enablement/audit",
                json={"tenantId": str(uuid4())},
                headers=headers(),
            )
            assert response.status_code == 403
            assert scoped.statements == []

    def test_route_is_on_the_internal_plane_only(self, client: TestClient) -> None:
        paths = {route.path for route in getattr(client.app, "routes", [])}
        assert "/internal/v1/enablement/audit" in paths


class TestConfigLaws:
    def test_nonsense_window_refuses_boot(self, monkeypatch: pytest.MonkeyPatch) -> None:
        for value in ("0", "-1", "36501"):
            monkeypatch.setenv("EXECUTION_ENABLEMENT_MAX_AGE_DAYS", value)
            get_settings.cache_clear()
            with pytest.raises(ValidationError) as caught:
                get_settings()
            # the refusal quotes the core's own words AND names the env var,
            # so the operator never has to guess which knob to fix
            text = str(caught.value)
            assert "EXECUTION_ENABLEMENT_MAX_AGE_DAYS" in text
            assert "core law" in text
        get_settings.cache_clear()

    def test_the_window_is_public_and_secret_free(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("EXECUTION_ENABLEMENT_MAX_AGE_DAYS", "45")
        get_settings.cache_clear()
        public = get_settings().to_public_dict()
        assert public["enablementMaxAgeDays"] == 45
        assert "EXECUTION_POSTGRES_DSN" not in str(public)

    def test_the_property_rebuilds_the_core_policy(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("EXECUTION_ENABLEMENT_MAX_AGE_DAYS", "13")
        get_settings.cache_clear()
        policy = get_settings().enablement_policy
        assert policy.max_evidence_age_days == 13
        assert policy.max_evidence_age_us == 13 * 86_400 * 1_000_000
