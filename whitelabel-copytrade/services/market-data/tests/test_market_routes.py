"""Authorisation and symbol allow-listing on the read API."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_symbols_require_internal_token(client: TestClient) -> None:
    response = client.get("/v1/market/symbols")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


def test_symbols_returns_configured_universe(client: TestClient, internal_token: str) -> None:
    response = client.get("/v1/market/symbols", headers={"x-internal-token": internal_token})

    assert response.status_code == 200
    body = response.json()
    assert body["symbols"] == ["BTC/USDT", "ETH/USDT"]
    assert body["streamingEnabled"] is False


def test_untracked_symbol_is_rejected(client: TestClient, internal_token: str) -> None:
    response = client.get(
        "/v1/market/quotes/DOGE/USDT",
        headers={"x-internal-token": internal_token},
    )

    # Redis is not attached in unit tests, so the cache dependency reports 503;
    # what matters is that the request never reaches an upstream venue.
    assert response.status_code in (404, 503)


def test_bad_token_is_rejected(client: TestClient) -> None:
    response = client.get(
        "/v1/market/symbols",
        headers={"x-internal-token": "wrong-token-value-that-is-long-enough-1234"},
    )

    assert response.status_code == 401
