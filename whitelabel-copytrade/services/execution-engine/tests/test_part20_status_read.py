"""Part 20: the read scope on the one internal route that acts on nothing.

These tests exist because of a defect found by RUNNING the composition, not by reading
it. ``apps/api/src/worker.ts`` calls ``GET /internal/v1/status`` before it will forward a
single job, with the internal token and no tenant header - correctly, since a
process-level read has no tenant to name - and the engine answered
``400 TENANT_HEADER_REQUIRED``. That code is not in the worker's terminal set, so the
worker logged "execution engine gate failed" and exited 1: in the reference deployment
the worker could not start, and had not been able to since the gate shipped in Part 11.
Nine parts of green suites missed it because every test of that client stubs ``fetch``,
which is the general lesson here and the reason the tests below go through an HTTP
client and the real route table rather than a mock.

The exemption is scoped as narrowly as it can be, and each narrowing is asserted:
the token is still required; a tenant header that IS sent is still validated; the
correlation id still round-trips; the command scope's refusal text is unchanged to the
byte, because the worker matches on it; and the read scope is used by exactly one
route in the application, checked by walking the route table so the next route cannot
inherit it quietly.
"""

from __future__ import annotations

from typing import Any, cast

import pytest
from fastapi import HTTPException
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import CORRELATION_HEADER
from app.security import (
    CALLER_AUTH_HEADER,
    TENANT_HEADER,
    TENANT_REQUIRED_CODE,
    ServiceCaller,
    require_internal_auth,
    require_internal_auth_readonly,
)
from tests.conftest import BASE_ENV, auth_headers

TOKEN = BASE_ENV["EXECUTION_INTERNAL_TOKEN"]

#: The wire contract, spelled out. `app/schemas.py::StatusResponse` is the authority and
#: the TypeScript mirror in `apps/api/src/modules/worker/engine-status-contract.ts` is
#: parity-tested against that file; this literal is the third copy, deliberately, because
#: what it protects is the *published* shape - what a reader sees - and a reader's
#: contract should be tested from the reader's point of view, not only from the
#: producer's. If this list and the schema diverge, someone changed the wire.
STATUS_CONTRACT_KEYS: frozenset[str] = frozenset(
    {
        "adapter",
        "commands",
        "credentialRegistry",
        "credentialFetcher",
        "credentialSource",
        "dryRun",
        "enablementMaxAgeDays",
        "incidents",
        "instanceId",
        "distributedLockWiring",
        "keyRegistryConfigured",
        "liveEnablement",
        "locksDistributed",
        "metricsConfigured",
        "mode",
        "operatorConfirmation",
        "placement",
        "retentionEnabled",
        "retentionEventDays",
        "signedTransportWired",
        "simulated",
        "store",
        "storeBackend",
        "storeDurable",
        "venueAttestation",
    }
)


def _code_of(exc: HTTPException) -> str:
    """The `code` of a raised HTTPException, typed.

    `detail` is declared `str | None` by the framework while every raise site in
    `app/security.py` passes a dict, so an `isinstance(detail, dict)` here would be
    provably false to a type checker - and unreachable code is exactly how an assertion
    stops being one. The cast states the known shape and the runtime check below keeps
    it honest: a raise that lost its code fails here instead of comparing `None` to a
    string, and the file needs no suppression comment to type-check.
    """
    detail = cast("dict[str, Any]", exc.detail)
    code = detail["code"]
    assert isinstance(code, str)
    return code


def _token_headers() -> dict[str, str]:
    return {CALLER_AUTH_HEADER: TOKEN}


def _internal_routes(app: Any) -> list[APIRoute]:
    return [
        route
        for route in app.routes
        if isinstance(route, APIRoute) and route.path.startswith("/internal/v1")
    ]


def _dependant_calls(dependant: Any) -> set[Any]:
    found: set[Any] = {dependant.call}
    for sub in dependant.dependencies:
        found |= _dependant_calls(sub)
    return found


class TestReadScopeAnswers:
    def test_status_answers_a_tenantless_internal_caller(self, client: TestClient) -> None:
        """The defect, pinned in the direction it now points."""
        response = client.get("/internal/v1/status", headers=_token_headers())
        assert response.status_code == 200, response.text
        body = response.json()
        assert isinstance(body, dict)
        assert frozenset(body) == STATUS_CONTRACT_KEYS
        # Not "the keys are there": the values are this process's own answers, so a
        # reader that renders them cannot be rendering a default.
        assert body["instanceId"] == BASE_ENV["EXECUTION_INSTANCE_ID"]
        assert body["mode"] == "simulated"
        assert body["storeDurable"] is False
        assert body["credentialSource"] == "none"
        assert body["credentialFetcher"] is None
        assert body["simulated"] is True
        assert isinstance(body["commands"], list)
        enablement = body["liveEnablement"]
        assert enablement is not None
        assert enablement["liveRefused"] is True
        # Part 20: no hard blockers remain — signed transport is now wired
        assert enablement["hardBlockersPresent"] is False

    def test_a_caller_that_names_a_tenant_gets_the_same_bytes(self, client: TestClient) -> None:
        """Back-compatibility, asserted rather than assumed.

        The nine parts of clients that already send a tenant header must see no change
        at all: same document, same ordering, same types. Comparing the two payloads
        as text is the strict form of that claim.
        """
        tenantless = client.get("/internal/v1/status", headers=_token_headers())
        scoped = client.get("/internal/v1/status", headers=auth_headers("tenant-a"))
        assert scoped.status_code == 200
        assert tenantless.status_code == 200
        assert scoped.text == tenantless.text

    def test_correlation_still_round_trips_on_the_read_scope(self, client: TestClient) -> None:
        response = client.get(
            "/internal/v1/status",
            headers={**_token_headers(), "x-request-id": "panel-refresh-7"},
        )
        assert response.status_code == 200
        assert response.headers[CORRELATION_HEADER] == "panel-refresh-7"

    def test_empty_tenant_header_reads_as_absent_on_both_scopes(
        self, client: TestClient
    ) -> None:
        """`x-tenant-id: ""` is absence, on both sides, because one helper decides it.

        Worth pinning: a client that stamps an empty header from a missing config value
        now gets a working status read and a 400 on commands, and the difference is the
        scope's whole meaning rather than an accident of `if not x`.
        """
        read = client.get(
            "/internal/v1/status", headers={**_token_headers(), TENANT_HEADER: ""}
        )
        assert read.status_code == 200
        command = client.post(
            "/internal/v1/accounts/verify-credentials",
            headers={**_token_headers(), TENANT_HEADER: ""},
            json={"tenantId": "tenant-a", "accountId": "acct-1"},
        )
        assert command.status_code == 400
        assert command.json()["code"] == TENANT_REQUIRED_CODE


class TestReadScopeIsNotAValidationBypass:
    def test_a_sent_tenant_is_still_validated(self, client: TestClient) -> None:
        for candidate in ("../etc/passwd", "tenant a", "a" * 65, "tenant\x00a"):
            response = client.get(
                "/internal/v1/status",
                headers={**_token_headers(), TENANT_HEADER: candidate},
            )
            assert response.status_code == 400, candidate
            assert response.json()["code"] == "TENANT_HEADER_INVALID", candidate

    @pytest.mark.parametrize(
        "headers",
        [
            {},
            {TENANT_HEADER: "tenant-a"},
            {CALLER_AUTH_HEADER: ""},
            {CALLER_AUTH_HEADER: "s" * len(TOKEN)},
            {CALLER_AUTH_HEADER: TOKEN[:-1]},
        ],
        ids=[
            "no headers",
            "tenant only",
            "empty token",
            "wrong token same length",
            "token truncated by one",
        ],
    )
    def test_no_token_means_no_answer(self, client: TestClient, headers: dict[str, str]) -> None:
        """The exemption is about the tenant law and touches nothing else.

        Every one of these must be 401 rather than 400 or 200: if a missing token ever
        reached the tenant branch, a stranger could read a deployment's wiring, and the
        order of the two checks is the only thing preventing it.
        """
        response = client.get("/internal/v1/status", headers=headers)
        assert response.status_code == 401
        assert response.json()["code"] == "UNAUTHORIZED"

    def test_command_scope_refusal_text_is_unchanged_to_the_byte(
        self, client: TestClient
    ) -> None:
        """A pinned contract: the worker's client and its suite match this sentence."""
        response = client.post(
            "/internal/v1/accounts/verify-credentials",
            headers=_token_headers(),
            json={"tenantId": "tenant-a", "accountId": "acct-1"},
        )
        assert response.status_code == 400
        detail = response.json()
        assert detail["code"] == "TENANT_HEADER_REQUIRED"
        assert detail["message"] == (
            f"Every execution command must name its tenant via the "
            f"{TENANT_HEADER} header; tenantless money operations are refused."
        )


class TestScopeIsScoped:
    def test_the_read_scope_is_used_by_exactly_one_route(self, client: TestClient) -> None:
        routes = _internal_routes(client.app)
        readers = [
            route
            for route in routes
            if require_internal_auth_readonly in _dependant_calls(route.dependant)
        ]
        assert [route.path for route in readers] == ["/internal/v1/status"]
        assert [route.methods for route in readers] == [{"GET"}]

    def test_every_other_internal_route_keeps_the_command_scope(
        self, client: TestClient
    ) -> None:
        routes = _internal_routes(client.app)
        others = [route for route in routes if route.path != "/internal/v1/status"]
        assert others, "the internal plane must have routes besides the status read"
        for route in others:
            calls = _dependant_calls(route.dependant)
            assert require_internal_auth in calls, route.path
            assert require_internal_auth_readonly not in calls, route.path

    def test_no_internal_command_answers_tenantless(self, client: TestClient) -> None:
        """The same claim as the test above, made over HTTP rather than the tree.

        Both directions are pinned on purpose: the route walk catches a dependency
        swapped out of a handler, and the HTTP sweep catches a route that stopped
        depending on either scope at all. A body of `{}` is deliberate - auth is
        resolved before body validation, so a 422 here would mean the refusal moved
        behind validation, which is the ordering this part must not allow.
        """
        paths = sorted(
            {
                route.path
                for route in _internal_routes(client.app)
                if "POST" in (route.methods or set())
            }
        )
        assert paths, "the internal plane is expected to expose commands"
        for path in paths:
            response = client.post(path, headers=_token_headers(), json={})
            assert response.status_code == 400, f"{path}: {response.status_code}"
            assert response.json()["code"] == TENANT_REQUIRED_CODE, path

    def test_the_health_view_publishes_every_key_the_read_scope_does(
        self, client: TestClient
    ) -> None:
        """The disclosure argument for the exemption, as an invariant.

        `GET /health/ready` is unauthenticated by design (Part 8), and it answers with
        the same posture block. So the exemption cannot hand a caller anything a stranger
        does not already get for free - and if a later part ever restricts the readiness
        view, this test fails and the exemption's justification has to be re-argued in
        the open instead of quietly becoming false.
        """
        status_keys = frozenset(
            client.get("/internal/v1/status", headers=_token_headers()).json()
        )
        ready = client.get("/health/ready").json()
        assert status_keys <= frozenset(ready)
        assert "status" in ready  # the readiness verdict itself stays off /status


class TestScopesDirectly:
    """The two dependencies as functions, because their difference is a value.

    No HTTP here: what is under test is which caller object each scope hands back, and a
    route that never reads `tenant_id` cannot reveal the difference over the wire.
    """

    def _settings(self) -> Settings:
        get_settings.cache_clear()
        return get_settings()

    @pytest.mark.asyncio
    async def test_command_scope_refuses_and_read_scope_returns_an_empty_tenant(
        self,
    ) -> None:
        settings = self._settings()
        with pytest.raises(HTTPException) as refused:
            await require_internal_auth(settings, TOKEN, None, None)
        assert refused.value.status_code == 400
        assert _code_of(refused.value) == TENANT_REQUIRED_CODE

        caller = await require_internal_auth_readonly(settings, TOKEN, None, None)
        assert isinstance(caller, ServiceCaller)
        assert caller.tenant_id == ""
        assert caller.request_id is None

    @pytest.mark.asyncio
    async def test_read_scope_keeps_the_caller_it_is_given(self) -> None:
        caller = await require_internal_auth_readonly(
            self._settings(), TOKEN, "tenant-a", "corr-1"
        )
        assert (caller.tenant_id, caller.request_id) == ("tenant-a", "corr-1")

    @pytest.mark.asyncio
    async def test_read_scope_still_refuses_a_bad_token(self) -> None:
        with pytest.raises(HTTPException) as refused:
            await require_internal_auth_readonly(self._settings(), "nope", "tenant-a", None)
        assert refused.value.status_code == 401

    @pytest.mark.asyncio
    async def test_both_scopes_share_the_64_character_bound(self) -> None:
        long_tenant = "t" * 65
        for scope in (require_internal_auth, require_internal_auth_readonly):
            with pytest.raises(HTTPException) as refused:
                await scope(self._settings(), TOKEN, long_tenant, None)
            assert _code_of(refused.value) == "TENANT_HEADER_INVALID"
        ok = await require_internal_auth_readonly(
            self._settings(), TOKEN, "t" * 64, None
        )
        assert ok.tenant_id == "t" * 64
