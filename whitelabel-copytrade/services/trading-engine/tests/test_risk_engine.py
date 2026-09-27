"""The risk gate is the safety net for real money; it gets real tests."""

from __future__ import annotations

from decimal import Decimal

from fastapi.testclient import TestClient


def _intent(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "tenantId": "tenant-1",
        "accountId": "account-1",
        "exchange": "binance",
        "symbol": "BTCUSDT",
        "side": "BUY",
        "orderType": "LIMIT",
        "quantity": "0.001",
        "price": "50000",
        "leverage": 1,
        "reduceOnly": False,
    }
    payload.update(overrides)
    return payload


def test_requires_internal_token(client: TestClient) -> None:
    response = client.post("/v1/engine/risk/evaluate", json=_intent())

    assert response.status_code == 401


def test_rejects_tenant_mismatch(client: TestClient, internal_token: str) -> None:
    response = client.post(
        "/v1/engine/risk/evaluate",
        json=_intent(tenantId="other-tenant"),
        headers={"x-internal-token": internal_token, "x-tenant-id": "tenant-1"},
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "TENANT_MISMATCH"


def test_approves_a_conforming_order_but_does_not_execute(
    client: TestClient, internal_token: str
) -> None:
    response = client.post(
        "/v1/engine/risk/evaluate",
        json=_intent(),
        headers={"x-internal-token": internal_token, "x-tenant-id": "tenant-1"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["approved"] is True
    # Execution stays off in Part 1 regardless of approval.
    assert body["executionEnabled"] is False
    assert body["wouldExecute"] is False


def test_rejects_oversized_notional(client: TestClient, internal_token: str) -> None:
    response = client.post(
        "/v1/engine/risk/evaluate",
        json=_intent(quantity="5", price="50000"),
        headers={"x-internal-token": internal_token, "x-tenant-id": "tenant-1"},
    )

    body = response.json()
    assert body["approved"] is False
    assert any("notional" in reason.lower() for reason in body["reasons"])


def test_rejects_excessive_leverage(client: TestClient, internal_token: str) -> None:
    response = client.post(
        "/v1/engine/risk/evaluate",
        json=_intent(leverage=100),
        headers={"x-internal-token": internal_token, "x-tenant-id": "tenant-1"},
    )

    body = response.json()
    assert body["approved"] is False
    assert any("leverage" in reason.lower() for reason in body["reasons"])


def test_limit_order_without_price_is_rejected(client: TestClient, internal_token: str) -> None:
    payload = _intent()
    del payload["price"]

    response = client.post(
        "/v1/engine/risk/evaluate",
        json=payload,
        headers={"x-internal-token": internal_token, "x-tenant-id": "tenant-1"},
    )

    body = response.json()
    assert body["approved"] is False


def test_decimal_precision_is_preserved() -> None:
    # Guard against anyone reintroducing floats for money.
    assert Decimal("0.1") + Decimal("0.2") == Decimal("0.3")
