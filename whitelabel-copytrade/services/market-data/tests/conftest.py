"""Test fixtures for the market data service."""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest

os.environ.setdefault("NODE_ENV", "test")
os.environ.setdefault("REDIS_HOST", "localhost")
os.environ.setdefault("REDIS_PORT", "6379")
os.environ.setdefault(
    "INTERNAL_SERVICE_TOKEN", "test-internal-service-token-value-0123456789abcdef"
)
os.environ.setdefault("MARKET_DATA_SYMBOLS", "BTC/USDT,ETH/USDT")
os.environ.setdefault("MARKET_DATA_SOURCES", "binance,bybit")

from fastapi.testclient import TestClient  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.main import create_app  # noqa: E402


@pytest.fixture(scope="session")
def internal_token() -> str:
    return os.environ["INTERNAL_SERVICE_TOKEN"]


@pytest.fixture()
def app_instance() -> Iterator[object]:
    """Builds the app without running the lifespan (no Redis in unit tests)."""
    get_settings.cache_clear()
    yield create_app()


@pytest.fixture()
def client(app_instance: object) -> Iterator[TestClient]:
    # TestClient is used without a context manager so `lifespan` does not run:
    # these tests must not require a live Redis.
    yield TestClient(app_instance)  # type: ignore[arg-type]
