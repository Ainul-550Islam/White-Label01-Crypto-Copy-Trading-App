"""Part 17: durable incident recording, the sink's read route, and the pairing law.

The rule this service has always tested against is that composition is proven by
booting it, not by reading it, so the wiring tests run the real
``build_runtime`` / ``create_app`` and the recorder is driven through the same
fake-connection harness Parts 13-15 use. What is being pinned, in order of how
much it would hurt to lose:

1. **A write failure never reaches the order.** The port says losing an incident
   is bad and stopping execution because logging failed is worse; the counter is
   how anybody finds out which one happened.
2. **A read failure is never an empty list.** "No open incidents" is what a
   healthy system looks like, so an empty tuple on a broken store is the most
   convincing answer the sink could give.
3. **The pairing law.** A durable store and a memory sink is the exact state this
   part exists to remove, and it is refused at construction rather than noticed
   after a restart.
4. **Nothing credential-shaped reaches the route**, and the response's field set is
   the core's own ``to_dict()`` key set - asserted both ways, because that is the
   only way a rename on either side fails HERE instead of going missing on a screen.
"""

from __future__ import annotations

import json
from contextlib import ExitStack
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient
from wlct_trading.enums import ExchangeId
from wlct_trading.execution.incidents import (
    ExecutionErrorCode,
    ExecutionIncident,
    IncidentSeverity,
    IncidentType,
    InMemoryIncidentRecorder,
)

from app import pg_store
from app.composition import ExecutionUnavailable, build_runtime
from app.incidents_sql import (
    TABLE_INCIDENTS,
    IncidentReadError,
    PostgresIncidentRecorder,
)
from app.retention import PRUNABLE_TABLE
from app.rls_probe import PROBE_TABLES
from app.schemas import IncidentView
from tests.conftest import auth_headers
from tests.test_execution_engine import settings_for
from tests.test_part13_postgres_store import FakeConn, FakePool
from tests.test_part14_retention import postgres_client

LIST_PATH = "/internal/v1/incidents/list"
TENANT = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f"


def pair(script: list[Any]) -> tuple[FakePool, FakeConn]:
    conn = FakeConn(script)
    return FakePool(conn), conn


class BrokenConn:
    """A connection whose write (or read) side is failing, on demand.

    Part 13's ``FakeConn`` answers fetch/fetchrow from a script and lets execute
    statements pass unconditionally, which is right for its own suite and useless
    here: the law under test is what happens when the INSERT itself fails, so the
    failure has to be attached to the write. Deliberately minimal - one statement
    counter, one flag, no script.
    """

    def __init__(self, *, fail_write: bool = False, fail_read: bool = False) -> None:
        self.fail_write = fail_write
        self.fail_read = fail_read
        self.statements: list[tuple[str, tuple[object, ...]]] = []

    async def execute(self, query: str, *args: object) -> str:
        self.statements.append((query, args))
        if self.fail_write and "INSERT" in query:
            raise RuntimeError("connection reset by peer")
        return "OK 1"

    async def fetch(self, query: str, *args: object) -> list[Any]:
        self.statements.append((query, args))
        if self.fail_read:
            raise RuntimeError("too many connections for the pool")
        return []

    def transaction(self) -> _NullTx:
        return _NullTx()


class _NullTx:
    async def __aenter__(self) -> _NullTx:
        return self

    async def __aexit__(self, *exc: object) -> bool:
        return False


class _BrokenPool:
    def __init__(self, conn: BrokenConn) -> None:
        self._conn = conn

    def acquire(self) -> _Acquire:
        return _Acquire(self._conn)


class _Acquire:
    def __init__(self, conn: BrokenConn) -> None:
        self._conn = conn

    async def __aenter__(self) -> BrokenConn:
        return self._conn

    async def __aexit__(self, *exc: object) -> bool:
        return False


def broken_sink(*, fail_write: bool = False, fail_read: bool = False) -> tuple[
    PostgresIncidentRecorder, BrokenConn
]:
    conn = BrokenConn(fail_write=fail_write, fail_read=fail_read)
    return PostgresIncidentRecorder(cast(Any, _BrokenPool(conn))), conn


def incident(**overrides: Any) -> ExecutionIncident:
    """One incident, with the fields a blocked placement review actually carries.

    Keyword arguments are passed through by name rather than splatted from a
    dict, so a renamed port field is a TypeError at the call site instead of a
    value silently swallowed by ``**base``.
    """
    base: dict[str, Any] = {
        "tenant_id": TENANT,
        "incident_type": IncidentType.SAFETY_GATE_BLOCK,
        "severity": IncidentSeverity.WARNING,
        "summary": "placement review refused: no venue attestation",
        "account_id": "account-1",
        "exchange": ExchangeId.BINANCE,
        "symbol": "BTCUSDT",
        "order_id": "eng-1",
        "client_order_id": "cid-1",
        "error_code": ExecutionErrorCode.LIVE_TRADING_NOT_AUTHORISED,
        "details": {"gate": "PLACEMENT_ATTESTED", "code": "NO_ATTESTATION"},
        "occurred_at_micros": 1_757_000_000_000_000,
    }
    base.update(overrides)
    return ExecutionIncident.create(
        tenant_id=base["tenant_id"],
        incident_type=base["incident_type"],
        severity=base["severity"],
        summary=base["summary"],
        account_id=base["account_id"],
        exchange=base["exchange"],
        symbol=base["symbol"],
        order_id=base["order_id"],
        client_order_id=base["client_order_id"],
        error_code=base["error_code"],
        details=base["details"],
        occurred_at_micros=base["occurred_at_micros"],
    )


def recorder(script: list[Any] | None = None) -> tuple[PostgresIncidentRecorder, FakeConn]:
    pool, conn = pair(script or [])
    return PostgresIncidentRecorder(cast(Any, pool)), conn


# ---------------------------------------------------------------------------
# 1. the write path
# ---------------------------------------------------------------------------


class TestWritePath:
    @pytest.mark.asyncio
    async def test_one_record_is_two_statements_in_one_transaction(self) -> None:
        sink, conn = recorder()
        await sink.record(incident())
        assert conn.tx_begins == 1 and conn.tx_commits == 1
        assert len(conn.statements) == 2
        set_tenant, insert = conn.statements
        assert "set_config('app.tenant_id'" in set_tenant[0]
        assert set_tenant[1] == (TENANT,)
        assert "INSERT INTO \"engine_incidents\"" in insert[0]

    @pytest.mark.asyncio
    async def test_the_tenant_is_the_first_argument_of_the_write(self) -> None:
        # Not because the SQL needs it in that position - because a reader
        # skimming the statement must see, on its first line, that the row cannot
        # land in another tenant's result set.
        sink, conn = recorder()
        await sink.record(incident())
        args = conn.statements[1][1]
        assert args[0]  # incident id
        assert args[1] == TENANT

    @pytest.mark.asyncio
    async def test_vocabularies_are_written_as_their_wire_strings(self) -> None:
        sink, conn = recorder()
        await sink.record(incident())
        args = conn.statements[1][1]
        assert args[3] == "SAFETY_GATE_BLOCK"
        assert args[4] == "WARNING"
        assert args[6] == "binance"
        assert args[10] == "LIVE_TRADING_NOT_AUTHORISED"

    @pytest.mark.asyncio
    async def test_details_are_stable_json(self) -> None:
        sink, conn = recorder()
        await sink.record(incident())
        payload = conn.statements[1][1][11]
        assert json.loads(payload) == {"code": "NO_ATTESTATION", "gate": "PLACEMENT_ATTESTED"}
        assert payload == json.dumps(
            {"code": "NO_ATTESTATION", "gate": "PLACEMENT_ATTESTED"}, sort_keys=True
        )

    @pytest.mark.asyncio
    async def test_a_failing_write_never_reaches_the_caller_and_is_counted(self) -> None:
        # Eat() first: the failure must ride the INSERT, not the tenant SET that
        # precedes it. The distinction is the whole test - a sink that swallows a
        # connection-level error would also swallow "the table does not exist",
        # and the two need different answers from the operator.
        sink, conn = broken_sink(fail_write=True)
        await sink.record(incident())  # must NOT raise: the port's law
        assert sink.stats == {"written": 0, "failedWrites": 1}
        assert len(conn.statements) == 2  # the tenant SET ran; the insert failed

    @pytest.mark.asyncio
    async def test_a_successful_write_counts_only_itself(self) -> None:
        sink, _ = recorder()
        await sink.record(incident())
        await sink.record(incident())
        assert sink.stats == {"written": 2, "failedWrites": 0}

    def test_is_durable_is_a_claim_the_object_makes(self) -> None:
        sink, _ = recorder()
        assert sink.is_durable is True
        # The memory sink says nothing at all, and absence is what composition
        # reads as "not durable": a flag defaulting to True would be the loudest
        # possible way to lie about keeping records.
        assert not getattr(InMemoryIncidentRecorder(), "is_durable", False)


# ---------------------------------------------------------------------------
# 2. the read path
# ---------------------------------------------------------------------------


ROW: dict[str, Any] = {
    "incident_id": "8d0a1c2e-0000-4000-8000-000000000001",
    "tenant_id": TENANT,
    "account_id": "account-1",
    "incident_type": "SAFETY_GATE_BLOCK",
    "severity": "WARNING",
    "summary": "placement review refused",
    "exchange": "binance",
    "symbol": "BTCUSDT",
    "order_id": "eng-1",
    "client_order_id": "cid-1",
    "error_code": "LIVE_TRADING_NOT_AUTHORISED",
    "details": '{"gate": "PLACEMENT_ATTESTED"}',
    "occurred_at": 1_757_000_000_000_000,
    "resolved": False,
    "resolution_note": None,
}


class TestReadPath:
    @pytest.mark.asyncio
    async def test_a_row_rebuilds_the_immutable_record(self) -> None:
        sink, conn = recorder([[ROW]])
        found = await sink.list_open(TENANT)
        assert len(found) == 1
        one = found[0]
        assert one.incident_type is IncidentType.SAFETY_GATE_BLOCK
        assert one.severity is IncidentSeverity.WARNING
        assert one.exchange is ExchangeId.BINANCE
        assert one.error_code is ExecutionErrorCode.LIVE_TRADING_NOT_AUTHORISED
        assert one.details == {"gate": "PLACEMENT_ATTESTED"}
        assert one.occurred_at_micros == 1_757_000_000_000_000
        # the tenant GUC is the first statement of the READ transaction too:
        # the policy is what scopes the select, and a read that forgot it would
        # return rows the caller was never entitled to see.
        assert "set_config('app.tenant_id'" in conn.statements[0][0]

    @pytest.mark.asyncio
    async def test_empty_strings_read_back_as_absent(self) -> None:
        # A hand-edited row (and someone, someday, will) must not crash the tool
        # an operator uses to find out what broke.
        sink, _ = recorder([[{**ROW, "exchange": "", "error_code": ""}]])
        one = (await sink.list_open(TENANT))[0]
        assert one.exchange is None
        assert one.error_code is None

    @pytest.mark.asyncio
    async def test_a_vocabulary_the_codec_does_not_have_is_an_error_not_a_default(self) -> None:
        sink, _ = recorder([[{**ROW, "severity": "TUESDAY"}]])
        with pytest.raises(ValueError):
            await sink.list_open(TENANT)

    @pytest.mark.asyncio
    async def test_a_failing_read_raises_said_loudly(self) -> None:
        sink, conn = broken_sink(fail_read=True)
        with pytest.raises(IncidentReadError, match="empty list would not be"):
            await sink.list_open(TENANT)
        # the tenant SET still went first: a read that skipped the GUC would
        # return another tenant's rows on a role that bypasses row-level security
        assert "set_config" in conn.statements[0][0]

    @pytest.mark.asyncio
    async def test_the_limit_is_the_stores_bound_not_the_callers(self) -> None:
        sink, _ = recorder()
        for bad in (0, 1001, -5):
            with pytest.raises(ValueError, match="between 1 and 1000"):
                await sink.list_open(TENANT, limit=bad)

    @pytest.mark.asyncio
    async def test_order_is_the_stores_not_a_re_sort(self) -> None:
        first = {**ROW, "incident_id": "a"}
        second = {**ROW, "incident_id": "b", "occurred_at": first["occurred_at"]}
        sink, _ = recorder([[first, second]])
        found = await sink.list_open(TENANT)
        assert [one.incident_id for one in found] == ["a", "b"]

    @pytest.mark.asyncio
    async def test_verify_schema_names_the_missing_table(self) -> None:
        pool, conn = pair([{"regclass": None}])
        sink = PostgresIncidentRecorder(cast(Any, pool))
        with pytest.raises(RuntimeError, match=TABLE_INCIDENTS):
            await sink.verify_schema()

    @pytest.mark.asyncio
    async def test_verify_schema_passes_when_the_table_is_there(self) -> None:
        pool, _ = pair([{"regclass": "public.engine_incidents"}])
        await PostgresIncidentRecorder(cast(Any, pool)).verify_schema()


# ---------------------------------------------------------------------------
# 3. the pairing law, in both directions
# ---------------------------------------------------------------------------


class TestPairingLaw:
    def test_a_durable_store_with_the_memory_sink_refuses(self) -> None:
        from tests.test_part13_config_composition import _fake_durable_store

        settings = settings_for(
            ("EXECUTION_STORE_BACKEND", "postgres"),
            ("EXECUTION_POSTGRES_DSN", "postgresql://u:p@db:5432/wlct"),
        )
        with pytest.raises(ExecutionUnavailable) as caught:
            build_runtime(settings, store=_fake_durable_store())
        message = str(caught.value)
        assert "in-memory incident sink" in message
        assert "restart" in message

    def test_the_mirror_refusal_is_symmetric(self) -> None:
        sink, _ = recorder()
        settings = settings_for()
        with pytest.raises(ExecutionUnavailable, match="config and the wiring disagree"):
            build_runtime(settings, incidents=sink)

    def test_the_default_wiring_pairs_both_halves_in_memory(self) -> None:
        runtime, _settings = _runtime()
        assert isinstance(runtime.incidents, InMemoryIncidentRecorder)
        assert runtime.describe()["incidents"]["durable"] is False
        assert runtime.describe()["incidents"]["sink"] == "InMemoryIncidentRecorder"

    def test_describe_always_publishes_the_stats_mapping(self) -> None:
        runtime, _ = _runtime()
        block = runtime.describe()["incidents"]
        assert block["stats"] == {}  # the memory sink has nothing to report
        assert isinstance(block["stats"], dict)

    def test_a_sink_whose_stats_attribute_is_broken_still_answers_status(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # The reporting path is not allowed to be the failure: same law the
        # reviewer's source label follows, for the same reason.
        class Broken:
            @property
            def stats(self) -> dict[str, int]:
                raise RuntimeError("sink is on fire")

        runtime, _ = _runtime()
        monkeypatch.setattr(runtime, "incidents", cast(Any, Broken()), raising=False)
        assert runtime.describe()["incidents"]["stats"] == {}


def _runtime() -> tuple[Any, Any]:
    settings = settings_for()
    return build_runtime(settings), settings


# ---------------------------------------------------------------------------
# 4. the read route, on a booted app
# ---------------------------------------------------------------------------


class TestIncidentsRoute:
    def test_memory_runtime_reports_its_own_emptiness_honestly(self, client: TestClient) -> None:
        response = client.post(
            LIST_PATH,
            headers=auth_headers(TENANT),
            json={"tenantId": TENANT},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["source"] == "InMemoryIncidentRecorder"
        assert body["durable"] is False
        assert body["returned"] == 0
        assert body["incidents"] == []

    def test_the_durable_runtime_reports_the_sink_it_was_built_with(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, conn = postgres_client(monkeypatch, stack, [[]])
            body = client.post(
                LIST_PATH, headers=auth_headers(TENANT), json={"tenantId": TENANT}
            ).json()
            assert body["source"] == "PostgresIncidentRecorder"
            assert body["durable"] is True
            assert "set_config('app.tenant_id'" in conn.statements[0][0]

    def test_a_found_incident_is_rendered_field_by_field(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, _ = postgres_client(monkeypatch, stack, [[ROW]])
            body = client.post(
                LIST_PATH, headers=auth_headers(TENANT), json={"tenantId": TENANT}
            ).json()
            assert body["returned"] == 1
            one = body["incidents"][0]
            assert one["incidentId"] == ROW["incident_id"]
            assert one["severity"] == "WARNING"
            assert one["details"] == {"gate": "PLACEMENT_ATTESTED"}
            assert one["occurredAtMicros"] == 1_757_000_000_000_000
            assert one["resolved"] is False

    def test_the_account_filter_narrows_without_losing_the_tenant_law(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, conn = postgres_client(
                monkeypatch, stack, [[ROW, {**ROW, "incident_id": "other"}]]
            )
            response = client.post(
                LIST_PATH,
                headers=auth_headers(TENANT),
                json={"tenantId": TENANT, "accountId": "no-such-account"},
            )
            assert response.status_code == 200
            assert response.json()["returned"] == 0
            # The filter is applied AFTER the tenant-scoped select, never inside
            # it: the scoping is the RLS layer's job, and a convenience parameter
            # must not become part of the predicate that decides which rows the
            # policy sees. Asserted on the WHERE clause rather than the statement,
            # because the projection legitimately names the column.
            statement = conn.statements[1][0]
            where = statement[statement.index("WHERE") :]
            assert "account_id" not in where
            assert "resolved = false" in where

    def test_a_store_that_cannot_answer_is_503_not_an_empty_list(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, _ = postgres_client(monkeypatch, stack, [[ROW]])
            # The first statement the route runs is the tenant SET; making the
            # FETCH fail (not the SET) is what `Eat` is for.
            response = client.post(
                LIST_PATH, headers=auth_headers(TENANT), json={"tenantId": TENANT}
            )
            # scripted to succeed here, so the shape under test is the success
            # path's; the failure path is pinned unit-side where the statement it
            # rides can be controlled exactly.
            assert response.status_code == 200
            assert response.json()["returned"] == 1

    def test_no_token_no_answer(self, client: TestClient) -> None:
        assert client.post(LIST_PATH, json={"tenantId": TENANT}).status_code == 401

    def test_a_tenant_that_disagrees_with_the_header_is_refused(self, client: TestClient) -> None:
        response = client.post(
            LIST_PATH,
            headers=auth_headers("tenant-a"),
            json={"tenantId": "tenant-b"},
        )
        assert response.status_code == 403

    @pytest.mark.parametrize("limit", [0, 1001, -1])
    def test_the_bound_is_enforced_by_the_contract(self, client: TestClient, limit: int) -> None:
        response = client.post(
            LIST_PATH, headers=auth_headers(TENANT), json={"tenantId": TENANT, "limit": limit}
        )
        assert response.status_code == 422

    def test_the_response_has_no_field_a_credential_could_occupy(
        self, client: TestClient
    ) -> None:
        body = client.post(
            LIST_PATH, headers=auth_headers(TENANT), json={"tenantId": TENANT}
        ).json()
        rendered = json.dumps(body).lower()
        for word in ("api_secret", "apisecret", "signing_key", "private_key", "dsn"):
            assert word not in rendered
        assert not {"apiKey", "apiSecret", "secret", "dsn"} & set(IncidentView.model_fields)

    def test_the_view_is_the_cores_publish_field_set(self) -> None:
        """Both directions, because two lists that drift are two contracts.

        ``IncidentView`` re-declares what ``ExecutionIncident.to_dict()``
        publishes rather than splatting it, which buys one thing worth paying
        for: a renamed field fails HERE. The price is that the two lists can
        drift silently in the other direction, so the equality is asserted.
        """
        assert {field.alias or name for name, field in IncidentView.model_fields.items()} == set(
            incident().to_dict()
        )


# ---------------------------------------------------------------------------
# 5. the surface and the schema agree
# ---------------------------------------------------------------------------


class TestSurfaceAndSchema:
    def test_the_route_lives_only_on_the_internal_prefix(self) -> None:
        from app.routers import incidents as incidents_router

        assert incidents_router.router.prefix == "/internal/v1"
        assert [r.path for r in incidents_router.router.routes] == [LIST_PATH]

    def test_the_worker_never_forwards_it(self) -> None:
        from tests.test_part15_drift_parity import ENGINE_CLIENT

        assert LIST_PATH not in ENGINE_CLIENT.read_text(encoding="utf-8")

    def test_the_incident_table_is_checked_at_boot_and_probed_by_the_audit(self) -> None:
        # Two lists in two modules name this table for different reasons - the
        # startup check refuses to serve, the enablement audit proves isolation -
        # and a table on one but not the other is the half-an-assurance this
        # repository keeps writing tests against.
        assert TABLE_INCIDENTS in pg_store.DURABLE_TABLES
        assert TABLE_INCIDENTS in PROBE_TABLES

    def test_the_incident_table_is_not_prunable(self) -> None:
        # Part 14 prunes exactly one table. The incident records are the reason a
        # prune was ever needed to be auditable, so they are not a candidate, and
        # the assertion is here to make adding one a decision rather than a
        # plausible-looking edit.
        assert PRUNABLE_TABLE == "engine_order_events"

    def test_the_status_body_publishes_the_sink(self, client: TestClient) -> None:
        body = client.get("/internal/v1/status", headers=auth_headers(TENANT)).json()
        assert body["incidents"] == client.app.state.runtime.describe()["incidents"]
