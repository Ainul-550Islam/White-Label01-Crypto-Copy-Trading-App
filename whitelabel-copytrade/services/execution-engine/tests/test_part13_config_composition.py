"""Part 13: store-backend configuration law and composition refusals.

The env matrix is the operator's only input to durability; this file pins
that every contradictory combination REFUSES at validation or at build
rather than degrading. The public-view assertions guard the one secret the
part introduces: the DSN appears nowhere a log or status endpoint can
reach.
"""

from __future__ import annotations

import json
from typing import cast

import pytest
from fastapi.testclient import TestClient

from app.composition import ExecutionUnavailable, build_runtime
from app.config import Settings
from app.incidents_sql import PostgresIncidentRecorder
from app.store_sql import PgPool, PostgresOrderStore
from tests.conftest import BASE_ENV, auth_headers
from tests.test_execution_engine import settings_for
from tests.test_part13_postgres_store import FakeConn, FakePool

#: Distinctive so the "never public" assertion below could never pass by
#: accident: if this literal ever surfaces in a response, the test says so.
_TEST_DSN = "postgresql://engine_user:s3cr3t-part13@db.internal:5432/wlct_engine"


def _fake_durable_store() -> PostgresOrderStore:
    return PostgresOrderStore(cast(PgPool, FakePool(FakeConn())))


def _fake_durable_incidents() -> PostgresIncidentRecorder:
    return PostgresIncidentRecorder(cast(PgPool, FakePool(FakeConn())))


class TestStoreBackendConfig:
    def test_memory_is_the_default_and_needs_nothing(self) -> None:
        settings = Settings.model_validate(dict(BASE_ENV))
        assert settings.EXECUTION_STORE_BACKEND == "memory"
        assert settings.EXECUTION_POSTGRES_DSN is None

    def test_postgres_without_dsn_refuses(self) -> None:
        with pytest.raises(ValueError, match="requires EXECUTION_POSTGRES_DSN"):
            settings_for(
                ("EXECUTION_STORE_BACKEND", "postgres"),
                ("EXECUTION_POSTGRES_DSN", ""),
            )

    def test_non_postgres_scheme_dsn_refuses(self) -> None:
        with pytest.raises(ValueError, match="postgresql:// connection string"):
            settings_for(
                ("EXECUTION_STORE_BACKEND", "postgres"),
                ("EXECUTION_POSTGRES_DSN", "mysql://user:pw@db/app"),
            )

    def test_dsn_under_memory_backend_refuses_the_mismatch(self) -> None:
        # Somebody meant durability and set only half of it; the config must
        # not resolve the ambiguity by silently keeping the (losing) memory
        # store.
        with pytest.raises(ValueError, match="half-configured durable store"):
            settings_for(("EXECUTION_POSTGRES_DSN", _TEST_DSN))

    def test_postgres_with_dsn_validates(self) -> None:
        settings = settings_for(
            ("EXECUTION_STORE_BACKEND", "postgres"),
            ("EXECUTION_POSTGRES_DSN", _TEST_DSN),
        )
        assert settings.EXECUTION_STORE_BACKEND == "postgres"

    def test_empty_dsn_under_memory_is_unset_not_a_mismatch(self) -> None:
        # docker-compose passes ${EXECUTION_POSTGRES_DSN:-} - an EMPTY
        # string must read as "no DSN", or every memory deployment would
        # trip the mismatch refusal on its own default.
        settings = settings_for(
            ("EXECUTION_STORE_BACKEND", "memory"),
            ("EXECUTION_POSTGRES_DSN", ""),
        )
        assert settings.to_public_dict()["postgresDsnConfigured"] is False
        runtime = build_runtime(settings)
        assert runtime.describe()["storeDurable"] is False

    def test_public_view_never_leaks_the_dsn(self) -> None:
        settings = settings_for(
            ("EXECUTION_STORE_BACKEND", "postgres"),
            ("EXECUTION_POSTGRES_DSN", _TEST_DSN),
        )
        view = settings.to_public_dict()
        assert view["storeBackend"] == "postgres"
        assert view["postgresDsnConfigured"] is True
        rendered = json.dumps(view)
        assert _TEST_DSN not in rendered
        assert "s3cr3t-part13" not in rendered  # the credential part alone


class TestCompositionRefusals:
    def test_postgres_backend_without_injected_store_refuses(self) -> None:
        settings = settings_for(
            ("EXECUTION_STORE_BACKEND", "postgres"),
            ("EXECUTION_POSTGRES_DSN", _TEST_DSN),
        )
        with pytest.raises(ExecutionUnavailable, match="lifespan-injected"):
            build_runtime(settings)

    def test_injected_store_under_memory_backend_refuses(self) -> None:
        settings = settings_for()
        with pytest.raises(ExecutionUnavailable, match="config and the wiring disagree"):
            build_runtime(settings, store=_fake_durable_store())

    def test_postgres_wiring_describes_itself_truthfully(self) -> None:
        settings = settings_for(
            ("EXECUTION_STORE_BACKEND", "postgres"),
            ("EXECUTION_POSTGRES_DSN", _TEST_DSN),
        )
        # Part 17's pairing law means a durable store arrives WITH a durable
        # incident sink (that is what app.main does at startup); passing one here
        # is the test saying "the pair, not one half of it".
        runtime = build_runtime(
            settings,
            store=_fake_durable_store(),
            incidents=_fake_durable_incidents(),
        )
        description = runtime.describe()
        assert description["store"] == "PostgresOrderStore"
        assert description["storeBackend"] == "postgres"
        # is_durable is the store's own claim, not the config's: True here
        # because the class says so (the fake pool proves the wiring, not
        # the connection - the connection-side refusal is pg_store's test).
        assert description["storeDurable"] is True

    def test_live_refusal_still_names_both_parts_honestly(self) -> None:
        settings = settings_for(("EXECUTION_MODE", "live"))
        with pytest.raises(ExecutionUnavailable, match="not wired in this build") as caught:
            build_runtime(settings)
        message = str(caught.value)
        # the stale "Part 12 will bring the durable store" claim is gone:
        # the message must say what is ACTUALLY missing now.
        assert "durable" in message and "credential" in message


class TestStatusSurface:
    def test_status_and_ready_carry_the_backend_label(self, client: TestClient) -> None:
        status = client.get("/internal/v1/status", headers=auth_headers())
        assert status.status_code == 200
        body = status.json()
        assert body["storeBackend"] == "memory"
        assert body["storeDurable"] is False
        ready = client.get("/health/ready").json()
        assert ready["storeBackend"] == "memory"

    def test_auth_uses_the_existing_internal_token_contract(self, client: TestClient) -> None:
        # Part 13 must not have moved the auth needle: missing token 401s.
        assert client.get("/internal/v1/status").status_code == 401
