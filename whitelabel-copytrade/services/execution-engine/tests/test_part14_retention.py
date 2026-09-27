"""Part 14: the retention executor and its HTTP surface.

Two layers, mirroring the store's test discipline (the same recording
FakeConn family, including per-transaction begin/commit counters, because
"each batch is its own transaction" is the lock-safety law the executor is
allowed to claim):

1. the executor against scripted fakes - exact statement-per-transaction
   conversation for every branch (rehearse, partial batch, full batches to
   the ceiling, empty journal, lost-race count, ledger failure, pool
   error), the shared-prune-predicate literal pins, the sqlglot parse of
   every statement, and "the only DELETE targets engine_order_events"
   scanned off the module's own strings;
2. the routes through a booted TestClient over a fake POOL (lifespan
   patched at its seam, exactly as the part-13 config tests patch the
   store) - the memory 409, the apply-disabled 409 that must not emit a
   single statement, dry run and apply answers, inspect's read, the
   ledger-lost 500 carrying counts, the tenant-match law, and the status
   surface's two new fields.
"""

from __future__ import annotations

import asyncio
from contextlib import ExitStack
from typing import Any, cast
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlglot import parse as sqlglot_parse
from wlct_trading.execution.store import OrderStoreError
from wlct_trading.retention import RetentionPolicy

from app import retention
from app.config import get_settings
from app.retention import (
    COUNT_PRUNABLE_SQL,
    DELETE_BY_SEQS_SQL,
    INSERT_RUN_SQL,
    PRUNABLE_WHERE,
    SELECT_DOOMED_SEQS_SQL,
    SELECT_RECENT_RUNS_SQL,
    RetentionLedgerLost,
    inspect_event_store,
    run_event_retention,
)
from app.store_sql import PostgresOrderStore

TENANT = str(uuid4())
POLICY = RetentionPolicy(event_retention_days=90, batch_rows=4, max_batches=3)
US_PER_DAY = 86_400 * 1_000_000


class Eat:
    """Script marker consumed by the NEXT statement of either kind without
    answering it: how a test pins WHICH statement an injected failure
    rides (the ledger INSERT, not the SET that precedes it)."""


class FakeConn:
    """Records every statement with its args; answers fetch() from a
    script; tracks transaction boundaries (begins/commits/rollbacks) and
    groups the statements by the transaction they ran inside. A script
    entry is either an Eat() marker (consumed by any statement), an
    exception (raised at the next statement), or a list (the answer for
    the next fetch; execute statements never consume answers)."""

    _UNSET = object()

    def __init__(self, script: list[Any] | None = None) -> None:
        self.statements: list[tuple[str, tuple[object, ...]]] = []
        self.txes: list[list[str]] = [[]]  # statement list per transaction
        self.script = list(script or [])
        self.cursor = 0
        self.tx_begins = 0
        self.tx_commits = 0
        self.tx_rollbacks = 0

    def _step(self, query: str, args: tuple[object, ...], *, allow_response: bool) -> Any:
        self.statements.append((query, args))
        self.txes[-1].append(query)
        if self.cursor < len(self.script):
            entry = self.script[self.cursor]
            if isinstance(entry, Eat):
                self.cursor += 1
            elif isinstance(entry, BaseException):
                self.cursor += 1
                raise entry
            if allow_response:
                self.cursor += 1
                return entry
        return self._UNSET

    async def execute(self, query: str, *args: object) -> str:
        self._step(query, args, allow_response=False)
        return "OK 1"

    async def fetch(self, query: str, *args: object) -> list[Any]:
        entry = self._step(query, args, allow_response=True)
        if entry is not self._UNSET:
            return list(entry) if isinstance(entry, list) else []
        return []

    async def fetchrow(self, query: str, *args: object) -> Any:
        entry = self._step(query, args, allow_response=True)
        return None if entry is self._UNSET else entry

    def transaction(self) -> FakeTx:
        return FakeTx(self)


class FakeTx:
    def __init__(self, conn: FakeConn) -> None:
        self._conn = conn

    async def __aenter__(self) -> None:
        self._conn.tx_begins += 1
        self._conn.txes.append([])  # statements land in THIS transaction

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> bool:
        if exc_type is None:
            self._conn.tx_commits += 1
        else:
            self._conn.tx_rollbacks += 1
        return False


class FakeAcquire:
    def __init__(self, conn: FakeConn) -> None:
        self._conn = conn

    async def __aenter__(self) -> FakeConn:
        return self._conn

    async def __aexit__(self, *exc: object) -> bool:
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
        # the lifespan closes whatever pool it was handed - the fake proves
        # the retention tests' app shuts down through the REAL path.
        self.closed = True


def pair(script: list[Any]) -> tuple[FakePool, FakeConn]:
    conn = FakeConn(script)
    return FakePool(conn), conn


def call_run(
    pool: FakePool,
    *,
    dry_run: bool,
    instance_id: str = "exec-test-1",
    now_us: int = 1_757_000_000_000_000,
    policy: RetentionPolicy = POLICY,
    tenant: str = TENANT,
) -> Any:
    return asyncio.run(
        run_event_retention(
            cast(Any, pool),
            tenant,
            policy,
            dry_run=dry_run,
            instance_id=instance_id,
            clock=lambda: now_us,
        )
    )


def queries(conn: FakeConn) -> list[str]:
    return [query for query, _ in conn.statements]


class TestStatementLaws:
    def test_shared_predicate_is_the_same_literal_in_both_reads(self) -> None:
        # Rehearsal and execution share meaning by CHARACTER identity:
        # if either statement's WHERE drifts, the dry-run answer was a lie
        # about what the apply would delete.
        assert PRUNABLE_WHERE in COUNT_PRUNABLE_SQL
        assert PRUNABLE_WHERE in SELECT_DOOMED_SEQS_SQL
        assert "o.terminal_at < $2" in COUNT_PRUNABLE_SQL
        assert "e.occurred_at < $2" in COUNT_PRUNABLE_SQL
        assert "o.terminal_at IS NOT NULL" in COUNT_PRUNABLE_SQL
        # ONE cutoff parameter serves both comparisons - a second cutoff
        # would be a second law the core never validated.
        assert COUNT_PRUNABLE_SQL.count("$2") == 2
        assert "LIMIT $3" in SELECT_DOOMED_SEQS_SQL and "ORDER BY e.seq" in SELECT_DOOMED_SEQS_SQL

    def test_only_the_journal_is_deletable(self) -> None:
        deleters = [
            value
            for value in vars(retention).values()
            if isinstance(value, str) and "DELETE FROM" in value
        ]
        assert deleters
        for stmt in deleters:
            assert "DELETE FROM engine_order_events" in stmt
            assert "DELETE FROM engine_orders " not in stmt
            assert "DELETE FROM engine_order_fills" not in stmt
            assert "DELETE FROM engine_retention_runs" not in stmt

    def test_delete_is_an_explicit_seq_list_belted_by_tenant(self) -> None:
        assert DELETE_BY_SEQS_SQL.startswith("DELETE FROM engine_order_events")
        assert "tenant_id = $1" in DELETE_BY_SEQS_SQL
        assert "seq = ANY($2::bigint[])" in DELETE_BY_SEQS_SQL
        assert "RETURNING 1" in DELETE_BY_SEQS_SQL

    def test_every_statement_parses_as_postgres(self) -> None:
        for stmt in (
            COUNT_PRUNABLE_SQL,
            SELECT_DOOMED_SEQS_SQL,
            DELETE_BY_SEQS_SQL,
            INSERT_RUN_SQL,
            SELECT_RECENT_RUNS_SQL,
        ):
            parsed = sqlglot_parse(stmt, read="postgres")
            assert parsed and parsed[0] is not None

    def test_ledger_insert_columns_match_the_migration_in_order(self) -> None:
        head = INSERT_RUN_SQL.split("(", 1)[1].split(")", 1)[0]
        assert head.split(", ") == [
            "tenant_id",
            "started_at",
            "finished_at",
            "dry_run",
            "event_cutoff_us",
            "rows_deleted",
            "batches",
            "exhausted",
            "instance_id",
        ]
        assert "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)" in INSERT_RUN_SQL


class TestDryRun:
    def test_count_then_ledger_in_two_transactions(self) -> None:
        pool, conn = pair([[{"n": 42}]])
        report = call_run(pool, dry_run=True, now_us=1_757_000_000_000_000)
        assert report.rows_reported == 42
        assert report.cutoff_us == 1_757_000_000_000_000 - 90 * US_PER_DAY
        assert report.batches_run == 0 and report.exhausted is False
        assert report.ledger_written is True
        assert conn.tx_begins == 2 and conn.tx_commits == 2 and conn.tx_rollbacks == 0
        assert queries(conn) == [
            "SELECT set_config('app.tenant_id', $1, true)",
            COUNT_PRUNABLE_SQL,
            "SELECT set_config('app.tenant_id', $1, true)",
            INSERT_RUN_SQL,
        ]
        # the count is asked under the tenant arg and the cutoff - nothing else
        assert conn.statements[1][1] == (TENANT, report.cutoff_us)

    def test_the_ledger_row_records_the_rehearsal_as_a_fact(self) -> None:
        pool, conn = pair([[{"n": 7}]])
        report = call_run(pool, dry_run=True)
        insert_args = conn.statements[3][1]
        assert insert_args[0] == TENANT
        assert insert_args[3] is True  # dry_run column
        assert insert_args[5] == 7  # rows_deleted holds the prunable count
        assert insert_args[4] == report.cutoff_us  # the cutoff is part of the fact
        assert insert_args[8] == "exec-test-1"

    def test_empty_answer_to_count_is_zero_not_absent(self) -> None:
        pool, _ = pair([[]])
        report = call_run(pool, dry_run=True)
        assert report.rows_reported == 0


class TestApplyBatches:
    def test_partial_batch_is_the_last_batch(self) -> None:
        pool, conn = pair(
            [
                [{"seq": 7}, {"seq": 9}],  # 2 < batch_rows 4 -> the end
                [{"seq": 7}, {"seq": 9}],  # delete actually removed both
            ]
        )
        report = call_run(pool, dry_run=False)
        assert (report.rows_reported, report.batches_run, report.exhausted) == (2, 1, False)
        assert conn.tx_begins == 2  # one work tx + one ledger tx
        assert conn.statements[1][1] == (TENANT, report.cutoff_us, 4)
        assert conn.statements[2][1] == (TENANT, [7, 9])  # explicit seq list

    def test_full_batches_run_until_the_ceiling_and_say_so(self) -> None:
        script: list[Any] = []
        for batch in range(3):  # max_batches = 3, every batch FULL
            rows = [{"seq": batch * 4 + i} for i in range(4)]
            script.extend([rows, rows])
        pool, conn = pair(script)
        report = call_run(pool, dry_run=False)
        assert (report.rows_reported, report.batches_run) == (12, 3)
        assert report.exhausted is True  # "more may remain" - the scheduler's cue
        # no fourth select: the ceiling stops the loop, it does not slow it
        assert queries(conn).count(SELECT_DOOMED_SEQS_SQL) == 3

    def test_batch_limit_flows_from_the_policy_not_a_hardcode(self) -> None:
        pool, conn = pair([[]])
        call_run(
            pool,
            dry_run=False,
            policy=RetentionPolicy(event_retention_days=5, batch_rows=17, max_batches=2),
        )
        assert conn.statements[1][1][2] == 17

    def test_empty_journal_still_writes_a_zero_run_row(self) -> None:
        # a recorded no-op is what proves the schedule ran at all.
        pool, conn = pair([[]])
        report = call_run(pool, dry_run=False)
        assert (report.rows_reported, report.batches_run, report.exhausted) == (0, 0, False)
        assert queries(conn)[-2] == "SELECT set_config('app.tenant_id', $1, true)"
        assert queries(conn)[-1] == INSERT_RUN_SQL
        assert conn.statements[-1][1][5] == 0

    def test_lost_races_shrink_the_count_never_the_safety(self) -> None:
        # select saw three doomed seqs; another conn deleted two first.
        # The RETURNING rowcount is the ONLY thing reported.
        pool, _ = pair(
            [[{"seq": 1}, {"seq": 2}, {"seq": 3}], [{"seq": 1}]]
        )
        report = call_run(pool, dry_run=False)
        assert report.rows_reported == 1
        assert report.batches_run == 1  # partial delete is still a complete batch

    def test_each_batch_is_its_own_transaction_each_with_a_guc(self) -> None:
        script: list[Any] = []
        for _ in range(3):
            rows = [{"seq": i} for i in range(4)]
            script.extend([rows, rows])
        pool, conn = pair(script)
        report = call_run(pool, dry_run=False)
        gucs = [q for q in queries(conn) if q.startswith("SELECT set_config")]
        assert len(gucs) == conn.tx_begins == 4  # 3 work + 1 ledger
        assert report.batches_run == 3
        for tx in conn.txes[1:4]:  # each work transaction: GUC, select, delete
            assert len(tx) == 3 and tx[0].startswith("SELECT set_config")


class TestFailurePaths:
    def test_ledger_failure_loses_the_record_not_the_truth(self) -> None:
        pool, conn = pair(
            [
                [{"seq": 1}],
                [{"seq": 1}],
                Eat(),  # the ledger transaction's SET...
                RuntimeError("disk full mid insert"),  # ...then its INSERT fails
            ]
        )
        with pytest.raises(RetentionLedgerLost) as caught:
            call_run(pool, dry_run=False)
        lost = caught.value.report
        assert lost.rows_reported == 1 and lost.batches_run == 1
        assert lost.ledger_written is False  # the field the failure FLIPS
        assert conn.tx_rollbacks == 1 and conn.tx_commits == 1  # work committed, ledger did not

    def test_pool_error_mid_batch_propagates_and_rolls_back(self) -> None:
        pool, conn = pair([Eat(), RuntimeError("connection reset")])
        with pytest.raises(RuntimeError, match="connection reset"):
            call_run(pool, dry_run=False)
        assert conn.tx_rollbacks == 1

    def test_the_tenant_guard_burns_before_the_pool_is_borrowed(self) -> None:
        conn = FakeConn([])
        pool = FakePool(conn)
        with pytest.raises(OrderStoreError, match="canonical UUID"):
            asyncio.run(
                run_event_retention(
                    cast(Any, pool),
                    "tenant-label-not-uuid",
                    POLICY,
                    dry_run=True,
                    instance_id="exec-test-1",
                )
            )
        assert pool.acquires == 0 and conn.statements == []


class TestInspect:
    def test_both_reads_share_one_transaction(self) -> None:
        row = {
            "seq": 3,
            "started_at": 100,
            "finished_at": 200,
            "dry_run": True,
            "event_cutoff_us": 99,
            "rows_deleted": 7,
            "batches": 0,
            "exhausted": False,
            "instance_id": "exec-test-1",
        }
        conn = FakeConn([[{"n": 7}], [row]])
        view = asyncio.run(
            inspect_event_store(
                cast(Any, FakePool(conn)), TENANT, POLICY, limit=5, clock=lambda: 1_000
            )
        )
        assert conn.tx_begins == 1  # ONE transaction, both reads, one GUC
        assert conn.statements[1][1] == (TENANT, 1_000 - 90 * US_PER_DAY)
        assert conn.statements[2][0] == SELECT_RECENT_RUNS_SQL
        assert conn.statements[2][1] == (TENANT, 5)
        assert view["prunableNow"] == 7
        assert view["cutoffUs"] == 1_000 - 90 * US_PER_DAY
        assert view["runs"][0]["rows_deleted"] == 7
        assert view["runs"][0]["dry_run"] is True

    def test_view_values_are_plain_ints_and_bools(self) -> None:
        # ledger bigints arrive as int already; the view must not pass a
        # Decimal through to JSON (float coercion would lie about micros).
        conn = FakeConn([[{"n": 0}], []])
        view = asyncio.run(
            inspect_event_store(cast(Any, FakePool(conn)), TENANT, POLICY, limit=5, clock=lambda: 1)
        )
        assert isinstance(view["prunableNow"], int)
        assert view["runs"] == []


class TestConfigSurface:
    def test_policy_property_constructs_the_core_value(self) -> None:
        settings = get_settings()
        assert settings.retention_policy == RetentionPolicy(
            event_retention_days=90, batch_rows=2_000, max_batches=50
        )

    def test_absurd_retention_fails_boot_naming_the_env(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("EXECUTION_RETENTION_EVENT_DAYS", "0")
        get_settings.cache_clear()
        with pytest.raises(Exception, match="EXECUTION_RETENTION_EVENT_DAYS"):
            get_settings()
        get_settings.cache_clear()

    def test_public_view_carries_retention_posture(self) -> None:
        public = get_settings().to_public_dict()
        assert public["retentionEnabled"] is False
        assert public["retentionEventDays"] == 90
        assert public["retentionBatchRows"] == 2_000
        assert public["retentionMaxBatches"] == 50


def postgres_client(
    monkeypatch: pytest.MonkeyPatch,
    stack: ExitStack,
    script: list[Any],
    *,
    enabled: str = "false",
) -> tuple[TestClient, FakeConn]:
    """A booted app with the postgres backend and FAKE pool: the lifespan
    seam (app.main.open_durable_store) is the patch point, so the app under
    test is the real composition - router, deps, config, store wiring."""
    monkeypatch.setenv("EXECUTION_STORE_BACKEND", "postgres")
    monkeypatch.setenv("EXECUTION_POSTGRES_DSN", "postgresql://u:p@db:5432/wlct")
    monkeypatch.setenv("EXECUTION_RETENTION_ENABLED", enabled)
    get_settings.cache_clear()
    pool, conn = pair(script)
    from app.main import create_app

    async def fake_open(settings: Any) -> tuple[FakePool, PostgresOrderStore]:
        return pool, PostgresOrderStore(cast(Any, pool))

    monkeypatch.setattr("app.main.open_durable_store", fake_open)
    client = stack.enter_context(TestClient(create_app()))
    return client, conn


def headers(tenant: str = TENANT) -> dict[str, str]:
    from tests.conftest import BASE_ENV

    return {
        "x-internal-token": BASE_ENV["EXECUTION_INTERNAL_TOKEN"],
        "x-tenant-id": tenant,
    }


class TestRoutesMemoryMode:
    def test_run_refused_with_reason_not_fabricated_success(self, client: TestClient) -> None:
        response = client.post(
            "/internal/v1/retention/run",
            json={"tenantId": TENANT},
            headers=headers(),
        )
        assert response.status_code == 409
        body = response.json()  # the engine's flat {code,message} envelope
        assert body["code"] == "RETENTION_NO_DURABLE_STORE"
        assert "restarts bound" in body["message"]

    def test_inspect_refused_too(self, client: TestClient) -> None:
        response = client.post(
            "/internal/v1/retention/inspect",
            json={"tenantId": TENANT},
            headers=headers(),
        )
        assert response.status_code == 409
        assert response.json()["code"] == "RETENTION_NO_DURABLE_STORE"

    def test_status_reports_the_shipped_retention_defaults(self, client: TestClient) -> None:
        body = client.get("/internal/v1/status", headers=headers()).json()
        assert body["retentionEnabled"] is False
        assert body["retentionEventDays"] == 90


class TestRoutesDurableMode:
    def test_dry_run_always_available_and_answers_camel_case(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, conn = postgres_client(monkeypatch, stack, [[{"n": 5}]])
            response = client.post(
                "/internal/v1/retention/run",
                json={"tenantId": TENANT},
                headers=headers(),
            )
            assert response.status_code == 200
            body = response.json()
            assert body["dryRun"] is True
            assert body["rowsReported"] == 5
            assert body["batchesRun"] == 0
            assert body["ledgerWritten"] is True
            assert isinstance(body["cutoffUs"], int)  # micros stay integers on the wire
            assert len(conn.statements) == 4

    def test_apply_refused_before_any_statement_when_disabled(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, conn = postgres_client(monkeypatch, stack, [])
            response = client.post(
                "/internal/v1/retention/run",
                json={"tenantId": TENANT, "dryRun": False},
                headers=headers(),
            )
            assert response.status_code == 409
            assert response.json()["code"] == "RETENTION_APPLY_DISABLED"
            assert conn.statements == []  # not even a GUC: refused at the door

    def test_apply_executes_when_enabled(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, _ = postgres_client(
                monkeypatch,
                stack,
                [[{"seq": 2}], [{"seq": 2}]],
                enabled="true",
            )
            response = client.post(
                "/internal/v1/retention/run",
                json={"tenantId": TENANT, "dryRun": False},
                headers=headers(),
            )
            body = response.json()
            assert response.status_code == 200
            assert body["dryRun"] is False
            assert body["rowsReported"] == 1

    def test_ledger_failure_surfaces_counts_in_a_500(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, _ = postgres_client(
                monkeypatch,
                stack,
                [
                    [{"seq": 2}],
                    [{"seq": 2}],
                    Eat(),
                    RuntimeError("ledger insert died"),
                ],
                enabled="true",
            )
            response = client.post(
                "/internal/v1/retention/run",
                json={"tenantId": TENANT, "dryRun": False},
                headers=headers(),
            )
            assert response.status_code == 500
            body = response.json()
            assert body["code"] == "RETENTION_LEDGER_LOST"
            assert body["rowsReported"] == 1
            assert "retention.ledger_write_failed" in body["message"]

    def test_inspect_reads_count_and_recent_runs(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        row = {
            "seq": 1,
            "started_at": 10,
            "finished_at": 11,
            "dry_run": False,
            "event_cutoff_us": 9,
            "rows_deleted": 3,
            "batches": 1,
            "exhausted": True,
            "instance_id": "exec-test-1",
        }
        with ExitStack() as stack:
            client, conn = postgres_client(monkeypatch, stack, [[{"n": 8}], [row]])
            response = client.post(
                "/internal/v1/retention/inspect",
                json={"tenantId": TENANT},
                headers=headers(),
            )
            assert response.status_code == 200
            body = response.json()
            assert body["prunableNow"] == 8
            assert body["enabled"] is False
            assert body["eventRetentionDays"] == 90
            assert body["maxBatches"] == 50
            assert body["runs"][0]["rowsDeleted"] == 3
            assert body["runs"][0]["exhausted"] is True
            assert conn.tx_begins == 1  # one read transaction, not three

    def test_body_tenant_must_match_the_header(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, conn = postgres_client(monkeypatch, stack, [])
            response = client.post(
                "/internal/v1/retention/run",
                json={"tenantId": str(uuid4())},
                headers=headers(),
            )
            assert response.status_code == 403
            assert response.json()["code"] == "TENANT_MISMATCH"
            assert conn.statements == []

    def test_no_token_no_route(self, monkeypatch: pytest.MonkeyPatch) -> None:
        with ExitStack() as stack:
            client, _ = postgres_client(monkeypatch, stack, [])
            response = client.post(
                "/internal/v1/retention/run", json={"tenantId": TENANT}
            )
            assert response.status_code == 401

    def test_unknown_fields_are_rejected_on_the_run_body(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, _ = postgres_client(monkeypatch, stack, [])
            response = client.post(
                "/internal/v1/retention/run",
                json={"tenantId": TENANT, "apiKey": "nope"},
                headers=headers(),
            )
            assert response.status_code == 422
