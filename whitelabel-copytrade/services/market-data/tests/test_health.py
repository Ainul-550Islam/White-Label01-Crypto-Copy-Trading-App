"""Liveness must work with no dependencies attached."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_liveness(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "market-data"
    assert body["trackedSymbols"] == 2


def test_readiness_reports_degraded_without_redis(client: TestClient) -> None:
    response = client.get("/health/ready")

    assert response.status_code == 503
    assert response.json()["status"] == "degraded"
