"""Shared test fixtures.

Configuration is injected through the environment before the application is
imported so no test ever depends on a developer's local `.env`.
"""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest

os.environ.setdefault("NODE_ENV", "test")
os.environ.setdefault("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/wlct_test")
os.environ.setdefault("REDIS_HOST", "localhost")
os.environ.setdefault("REDIS_PORT", "6379")
os.environ.setdefault(
    "INTERNAL_SERVICE_TOKEN", "test-internal-service-token-value-0123456789abcdef"
)
os.environ.setdefault("EXECUTION_ENABLED", "false")
os.environ.setdefault("EXCHANGE_SANDBOX_MODE", "true")
os.environ.setdefault("MAX_ORDER_NOTIONAL_USD", "1000")
os.environ.setdefault("MAX_LEVERAGE", "5")

from fastapi.testclient import TestClient  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.main import create_app  # noqa: E402


@pytest.fixture(scope="session")
def internal_token() -> str:
    return os.environ["INTERNAL_SERVICE_TOKEN"]


@pytest.fixture()
def client() -> Iterator[TestClient]:
    get_settings.cache_clear()
    with TestClient(create_app()) as test_client:
        yield test_client
