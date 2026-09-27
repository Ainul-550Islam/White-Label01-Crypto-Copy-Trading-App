"""Liveness must never depend on a database or a credential."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_liveness_returns_ok(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "trading-engine"
    assert body["executionEnabled"] is False


def test_liveness_never_exposes_configuration_secrets(client: TestClient) -> None:
    body = client.get("/health").text.lower()

    assert "internal_service_token" not in body
    assert "database_url" not in body
    assert "password" not in body
