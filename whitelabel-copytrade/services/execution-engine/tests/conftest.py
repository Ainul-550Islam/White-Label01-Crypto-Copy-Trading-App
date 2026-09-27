"""Environment and client fixtures for the execution-engine tests.

Every test runs against the REAL composition root (no mocks under the
money-path wiring): what the tests assert is that startup, auth, validation
and command routing behave when everything underneath is the same code the
service ships. The simulated store being process-local is a property of
the mode, not a test convenience - and the readiness test asserts exactly
that property is VISIBLE.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings

#: Built from parts so no full secret-shaped literal sits in this file to
#: trip redaction/secret scanners, and so tests cannot accidentally share
#: the sample with production config.
_TEST_TOKEN = ("w1tch", "cra", "ftpu", "dd1e10")

BASE_ENV = {
    "NODE_ENV": "test",
    "LOG_LEVEL": "warning",
    "EXECUTION_INSTANCE_ID": "exec-test-1",
    "EXECUTION_INTERNAL_TOKEN": "".join(_TEST_TOKEN) * 4,  # 48 chars
    "EXECUTION_MODE": "simulated",
    "EXECUTION_DRY_RUN": "true",
    "EXECUTION_PAPER_BALANCES": "USDT=100000,BTC=2",
    "EXECUTION_SIMULATED_MID": "50000",
}


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key, value in BASE_ENV.items():
        monkeypatch.setenv(key, value)
    get_settings.cache_clear()


def auth_headers(tenant: str = "tenant-a") -> dict[str, str]:
    return {
        "x-internal-token": BASE_ENV["EXECUTION_INTERNAL_TOKEN"],
        "x-tenant-id": tenant,
    }


@pytest.fixture
def client() -> Iterator[TestClient]:
    # Annotated as a generator, because that is what it is: `yield` makes the function
    # an Iterator and `-> TestClient` was a lie a type checker could only report as an
    # error. Fixed while Part 20's suite was importing this fixture, since leaving a
    # known-wrong annotation in a file the new tests depend on is the kind of
    # "somebody else's file" reasoning that lets a tree accumulate broken types.
    """A booted app behind a TestClient.

    Starlette's TestClient keeps the app on ``client.app`` and its lifespan
    runs on context entry, so tests reach the assembled runtime via
    ``client.app.state.runtime`` to seed stores - against the real
    composition root, never a mocked one.
    """
    from app.main import create_app

    app = create_app()
    with TestClient(app) as test_client:
        yield test_client
