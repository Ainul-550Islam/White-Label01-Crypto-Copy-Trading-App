"""Phase 3: the OMS/copy-trading submission route, against the real composition.

What these tests pin:

* the route exists, is authenticated, tenant-matched and schema-strict;
* the context is assembled server-side and fails closed - no reference price,
  an incomplete exposure ledger or a non-PAPER environment never produce an
  accepted order;
* unsupported caller-supplied exposure/PnL claims cannot produce a fill;
* the outcome rides in a 200 body, exactly as the cancel route's does.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from tests.conftest import auth_headers


def submit_body(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "tenantId": "tenant-a",
        "accountId": "acct-1",
        "orderId": "order-1",
        "clientOrderId": "oms0000000000004000800000000000001",
        "symbol": "BTC-USDT",
        "side": "BUY",
        "orderType": "MARKET",
        "quantity": "0.01",
        "timeInForce": "GTC",
        "riskDecisionId": "risk-decision-1",
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
            "realisedPnlToday": "0",
            "complete": True,
        },
        "metadata": {"copyExecutionId": "copy-exec-1"},
    }
    body.update(overrides)
    return body


def post(client: TestClient, body: dict[str, Any], tenant: str = "tenant-a"):
    return client.post("/internal/v1/orders/submit", headers=auth_headers(tenant), json=body)


@pytest.fixture
def live_paper_client(monkeypatch: pytest.MonkeyPatch):
    """A runtime that actually fills against the paper book (dry run off)."""
    monkeypatch.setenv("EXECUTION_DRY_RUN", "false")
    get_settings.cache_clear()
    from app.main import create_app

    with TestClient(create_app()) as test_client:
        yield test_client


class TestSubmitRoute:
    def test_status_advertises_submit_order(self, client: TestClient) -> None:
        body = client.get("/internal/v1/status", headers=auth_headers()).json()
        assert "submit-order" in body["commands"]

    def test_default_runtime_simulates_and_transmits_nothing(
        self, client: TestClient
    ) -> None:
        response = post(client, submit_body())
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["outcome"] == "REJECTED_LOCALLY"
        assert body["transmitted"] is False
        assert body["fillCount"] == 0

    def test_forged_complete_exposure_and_zero_pnl_cannot_fill(
        self, live_paper_client: TestClient
    ) -> None:
        response = post(live_paper_client, submit_body())
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["outcome"] == "REJECTED_LOCALLY"
        assert body["transmitted"] is False
        assert body["fillCount"] == 0
        assert body["filledQuantity"] == "0"

    def test_redelivery_never_creates_a_fill_without_verified_evidence(
        self, live_paper_client: TestClient
    ) -> None:
        first = post(live_paper_client, submit_body()).json()
        second = post(live_paper_client, submit_body()).json()
        assert first["outcome"] == "REJECTED_LOCALLY"
        assert second["outcome"] == "REJECTED_LOCALLY"
        assert first["fillCount"] == second["fillCount"] == 0

    def test_incomplete_exposure_is_refused_locally(self, live_paper_client: TestClient) -> None:
        body = submit_body(
            clientOrderId="oms-incomplete",
            exposure={
                "positionQuantity": "0",
                "symbolExposureNotional": "0",
                "accountExposureNotional": "0",
                "complete": False,
            },
        )
        response = post(live_paper_client, body)
        assert response.status_code == 200
        assert response.json()["outcome"] == "REJECTED_LOCALLY"

    def test_missing_daily_pnl_is_not_treated_as_zero(self, live_paper_client: TestClient) -> None:
        body = submit_body(clientOrderId="oms-missing-pnl")
        del body["exposure"]["realisedPnlToday"]
        response = post(live_paper_client, body)
        assert response.status_code == 200
        result = response.json()
        assert result["outcome"] == "REJECTED_LOCALLY"
        assert result["transmitted"] is False
        assert result["fillCount"] == 0

    def test_known_daily_loss_at_limit_is_refused(self, live_paper_client: TestClient) -> None:
        body = submit_body(clientOrderId="oms-loss-limit")
        body["exposure"]["realisedPnlToday"] = "-1000000"
        response = post(live_paper_client, body)
        assert response.status_code == 200
        result = response.json()
        assert result["outcome"] == "REJECTED_LOCALLY"
        assert result["transmitted"] is False
        assert result["fillCount"] == 0

    def test_no_reference_price_is_refused_locally(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("EXECUTION_DRY_RUN", "false")
        monkeypatch.delenv("EXECUTION_SIMULATED_MID", raising=False)
        get_settings.cache_clear()
        from app.main import create_app

        with TestClient(create_app()) as test_client:
            response = post(test_client, submit_body(clientOrderId="oms-no-mid"))
        assert response.status_code == 200
        body = response.json()
        assert body["outcome"] == "REJECTED_LOCALLY"
        assert body["transmitted"] is False

    def test_tenant_header_mismatch_is_refused(self, client: TestClient) -> None:
        response = post(client, submit_body(), tenant="tenant-b")
        assert response.status_code == 403

    @pytest.mark.parametrize(
        "patch",
        [
            {"environment": "LIVE"},
            {"riskDecisionId": ""},
            {"quantity": "0"},
            {"quantity": "1e"},
            {"orderType": "STOP"},
            {"side": "HOLD"},
            {"clientOrderId": "oms-00000000-0000-4000-8000-000000000001"},
            {"apiKey": "smuggled"},
        ],
    )
    def test_schema_refusals_are_422(self, client: TestClient, patch: dict[str, Any]) -> None:
        response = post(client, submit_body(**patch))
        assert response.status_code == 422

    def test_missing_risk_decision_is_422(self, client: TestClient) -> None:
        body = submit_body()
        del body["riskDecisionId"]
        assert post(client, body).status_code == 422
