# Responsibility: prove the OMS submission route refuses live money at every layer it owns.
"""The submit route's gates, one per layer that can say no.

``test_phase3_submit.py`` proves the paper path works. This file proves that the
route which moves money is *incapable* of reaching a venue in this build, and
that each layer which enforces that says so in its own vocabulary rather than
relying on a single flag:

  BOOT          ``EXECUTION_MODE=live`` refuses to construct the runtime, with a
                sentence that names what is missing. Nothing listens.
  TRANSPORT     the submit route refuses a non-simulated adapter (409
                ``SUBMISSION_REQUIRES_SIMULATED_RUNTIME``), so a future wiring
                mistake is a refusal rather than a real order.
  AUTHENTICATION the internal token is required and the tenant header must match
                the body; neither is softened for the submit route.
  SCHEMA        ``environment`` is literally ``"PAPER"`` - a LIVE submission is a
                422 before any gate runs, so there is no runtime state in which a
                live order is even *representable* on this surface.
  POSTURE       ``/internal/v1/status`` publishes ``liveEnablement`` with
                ``liveRefused`` true, so the same answer that refused a live boot
                is readable from a running one.

The engine is the real composition root in every test: no gate here is mocked,
because a mocked gate proves the mock.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from tests.conftest import BASE_ENV, auth_headers

#: A submission that is valid in every field, so a refusal can only come from the
#: layer a test is exercising.
SUBMIT_BODY: dict[str, Any] = {
    "tenantId": "tenant-a",
    "accountId": "acct-1",
    "orderId": "order-gate-1",
    "clientOrderId": "oms00000000000040008000000000000g1",
    "symbol": "BTC-USDT",
    "side": "BUY",
    "orderType": "MARKET",
    "quantity": "0.01",
    "timeInForce": "GTC",
    "riskDecisionId": "risk-decision-gate-1",
    "environment": "PAPER",
    "specification": {
        "baseAsset": "BTC",
        "quoteAsset": "USDT",
        "marketType": "SPOT",
        "priceTick": "0.01",
        "quantityStep": "0.00001",
        "minQuantity": "0.00001",
        "maxQuantity": "9000",
        "minNotional": "10",
        "isTradeable": True,
        "pricePrecision": 2,
        "quantityPrecision": 5,
    },
    "exposure": {
        "positionQuantity": "0",
        "symbolExposureNotional": "0",
        "accountExposureNotional": "0",
        "complete": True,
    },
    "metadata": {"copyExecutionId": "copy-exec-gate-1"},
}


def submit_body(**overrides: Any) -> dict[str, Any]:
    body = dict(SUBMIT_BODY)
    body.update(overrides)
    return body


def post(client: TestClient, body: dict[str, Any], tenant: str = "tenant-a"):
    return client.post("/internal/v1/orders/submit", headers=auth_headers(tenant), json=body)


# ======================================================================
# BOOT
# ======================================================================
class TestTheLiveModeRefusal:
    """``EXECUTION_MODE=live`` must refuse to boot, and say why."""

    def test_live_mode_refuses_to_construct_a_runtime(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.composition import ExecutionUnavailable, build_runtime

        monkeypatch.setenv("EXECUTION_MODE", "live")
        get_settings.cache_clear()

        with pytest.raises(ExecutionUnavailable) as excinfo:
            build_runtime(get_settings())

        message = str(excinfo.value)
        # The sentence has to be actionable: it names the refusal's source, the
        # prerequisites that are missing, and that nothing was sent.
        assert "EXECUTION_MODE=live is not wired in this build" in message
        assert "missing:" in message
        assert "No order was sent and none will be." in message
        get_settings.cache_clear()

    def test_the_refusal_names_the_wiring_rather_than_a_missing_setting(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.composition import ExecutionUnavailable, build_runtime

        monkeypatch.setenv("EXECUTION_MODE", "live")
        get_settings.cache_clear()
        try:
            with pytest.raises(ExecutionUnavailable) as excinfo:
                build_runtime(get_settings())
        finally:
            get_settings.cache_clear()

        assert "simulated mode is available now" in str(excinfo.value).lower()

    def test_a_simulated_runtime_boots_with_live_refused(
        self, client: TestClient
    ) -> None:
        status = client.get("/internal/v1/status", headers=auth_headers())
        assert status.status_code == 200
        body = status.json()
        assert body["mode"] == "simulated"
        assert body["dryRun"] is True
        assert body["liveEnablement"]["liveRefused"] is True
        assert body["liveEnablement"]["missing"], "the posture must name what is missing"

    def test_the_status_posture_offers_no_field_that_permits_live(
        self, client: TestClient
    ) -> None:
        """Nothing in the published block can be read as "set this and trade"."""
        enablement = client.get("/internal/v1/status", headers=auth_headers()).json()[
            "liveEnablement"
        ]
        assert set(enablement) == {
            "liveRefused",
            "missing",
            "satisfied",
            "missingCodes",
            "hardBlockersPresent",
            "credentialSource",
        }
        assert all(code.startswith("LIVE_") for code in enablement["missingCodes"])


# ======================================================================
# TRANSPORT
# ======================================================================
class TestTheNonSimulatedAdapterRefusal:
    """The route refuses anything but a paper adapter, even if one were wired."""

    @staticmethod
    def _runtime(client: TestClient) -> Any:
        return client.app.state.runtime

    def test_the_route_refuses_a_non_simulated_adapter(self, client: TestClient) -> None:
        runtime = self._runtime(client)

        class NotASimulator:
            """Stands in for a venue adapter: everything that matters is ``False``."""

            is_simulated = False

        original = runtime.trading_adapter
        object.__setattr__(runtime, "trading_adapter", NotASimulator())
        try:
            response = post(client, submit_body())
        finally:
            object.__setattr__(runtime, "trading_adapter", original)

        assert response.status_code == 409
        # The service's error envelope is flat (``code``/``message``), produced by
        # its own exception handler rather than FastAPI's ``detail`` wrapper - the
        # worker parses it, so the shape is the contract.
        body = response.json()
        assert body["code"] == "SUBMISSION_REQUIRES_SIMULATED_RUNTIME"
        assert "paper simulator" in body["message"]
        assert "non-simulated adapter" in body["message"]

    def test_the_refusal_happens_before_any_engine_work(self, client: TestClient) -> None:
        """No reservation, no order, no event: the refusal is the whole outcome."""
        runtime = self._runtime(client)

        class NotASimulator:
            is_simulated = False

        original = runtime.trading_adapter
        object.__setattr__(runtime, "trading_adapter", NotASimulator())
        try:
            post(client, submit_body())
        finally:
            object.__setattr__(runtime, "trading_adapter", original)

        import asyncio

        stored = asyncio.run(
            runtime.store.get_by_client_order_id("tenant-a", SUBMIT_BODY["clientOrderId"])
        )
        assert stored is None, "a refused submission must not leave an order behind"

    def test_the_paper_adapter_is_simulated_and_therefore_allowed(
        self, client: TestClient
    ) -> None:
        """The positive half: the refusal above is about the adapter, not the route."""
        assert self._runtime(client).trading_adapter.is_simulated is True
        response = post(client, submit_body(clientOrderId="oms-gate-paper-0001"))
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["isSimulated"] is True
        assert body["transmitted"] is False


# ======================================================================
# AUTHENTICATION
# ======================================================================
class TestAuthenticationGates:
    def test_the_route_requires_the_internal_token(self, client: TestClient) -> None:
        response = client.post("/internal/v1/orders/submit", json=submit_body())
        assert response.status_code == 401

    def test_a_wrong_internal_token_is_refused(self, client: TestClient) -> None:
        response = client.post(
            "/internal/v1/orders/submit",
            headers={"x-internal-token": "w" * 48, "x-tenant-id": "tenant-a"},
            json=submit_body(),
        )
        assert response.status_code == 401

    def test_a_tenant_header_that_disagrees_with_the_body_is_refused(
        self, client: TestClient
    ) -> None:
        response = post(client, submit_body(), tenant="tenant-b")
        assert response.status_code == 403

    def test_the_tenant_header_is_required(self, client: TestClient) -> None:
        response = client.post(
            "/internal/v1/orders/submit",
            headers={"x-internal-token": BASE_ENV["EXECUTION_INTERNAL_TOKEN"]},
            json=submit_body(),
        )
        # 400 TENANT_HEADER_REQUIRED: the specific refusal, not a generic 401 -
        # "every execution command must name its tenant" is the sentence an
        # operator needs when a proxy drops the header.
        assert response.status_code == 400
        assert response.json()["code"] == "TENANT_HEADER_REQUIRED"

    def test_the_status_route_requires_the_same_token(self, client: TestClient) -> None:
        assert client.get("/internal/v1/status").status_code == 401


# ======================================================================
# SCHEMA
# ======================================================================
class TestSchemaGates:
    @pytest.mark.parametrize(
        "overrides",
        [
            {"environment": "LIVE"},
            {"environment": "live"},
            {"environment": "TESTNET"},
            {"environment": ""},
        ],
    )
    def test_only_the_paper_environment_is_representable(
        self, client: TestClient, overrides: dict[str, Any]
    ) -> None:
        """``environment != PAPER`` is a 422, not a verdict.

        This is the strongest of the gates in one sense and the weakest in
        another: it means a live order cannot even be *expressed* to this
        service, which is why every other layer is still tested - a schema is one
        field away from being widened.
        """
        response = post(client, submit_body(**overrides))
        assert response.status_code == 422

    def test_a_smuggled_api_key_field_is_refused(self, client: TestClient) -> None:
        response = post(client, submit_body(apiKey="leak"))
        assert response.status_code == 422

    def test_a_missing_risk_decision_is_refused(self, client: TestClient) -> None:
        body = submit_body()
        del body["riskDecisionId"]
        assert post(client, body).status_code == 422

    def test_a_client_order_id_outside_the_venue_limit_is_refused(
        self, client: TestClient
    ) -> None:
        # 37 characters: Binance's client-order-id ceiling is 36.
        response = post(client, submit_body(clientOrderId="o" * 37))
        assert response.status_code == 422

    def test_a_float_quantity_is_refused(self, client: TestClient) -> None:
        """Money is an exact decimal string; a JSON number is not accepted."""
        response = post(client, submit_body(quantity=0.01))
        assert response.status_code == 422


# ======================================================================
# POSTURE
# ======================================================================
def test_dry_run_default_means_nothing_is_transmitted(client: TestClient) -> None:
    """The default configuration must be the one that cannot spend."""
    response = post(client, submit_body(clientOrderId="oms-gate-dryrun-0001"))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["transmitted"] is False
    assert body["outcome"] in {"ACCEPTED", "DRY_RUN"}
