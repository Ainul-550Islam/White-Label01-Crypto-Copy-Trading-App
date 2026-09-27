"""Part 9 trading-plane readiness evidence on the engine side.

The properties that matter are exactly the two the platform rulebook calls
out: trading readiness must be *evidence-derived* (absent or stale mirror =>
not ready, never "assume ok"), and the endpoint must report without ever
authorising (there is no call path from these routes into an order).
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import create_app
from app.observability import TradingEngineObservability


class FakePipe:
    def __init__(self, store: dict[str, str]) -> None:
        self._store = store

    def set(self, key: str, value: str, *, ex: int | None = None) -> None:
        self._store[key] = value

    async def execute(self) -> list[bool]:
        return [True]


class FakeRedis:
    def __init__(self, values: dict[str, str] | None = None) -> None:
        self.values: dict[str, str] = values or {}

    async def get(self, key: str) -> str | None:
        return self.values.get(key)

    async def ping(self) -> bool:
        return True

    def pipeline(self, *, transaction: bool = True) -> FakePipe:
        return FakePipe(self.values)


class DeadPostgres:
    """asyncpg.connect stand-in that fails like a fresh deployment with no PG."""

    async def connect(self, *args: object, **kwargs: object) -> Any:
        raise OSError("no database in unit tests")


def make_hub(
    settings: Settings, values: dict[str, str] | None = None
) -> TradingEngineObservability:
    return TradingEngineObservability(settings, FakeRedis(values))


def test_metrics_and_trading_with_hub_started(client: TestClient) -> None:
    """Uses the lifespan fixture: the hub runs against unreachable
    dependencies here, which is itself the fail-closed path under test."""
    metrics = client.get("/metrics")
    assert metrics.status_code == 200
    assert metrics.headers["content-type"].startswith("text/plain")

    trading = client.get("/health/trading")
    assert trading.status_code == 200  # reports; does not fail the node
    body = trading.json()
    assert body["gatesSatisfied"] is False
    assert "risk gate" in body["note"]


def test_metrics_route_shape_without_lifespan() -> None:
    bare = TestClient(create_app())
    response = bare.get("/metrics")
    assert response.status_code == 200
    assert "observability not initialised" in response.text
    trading = bare.get("/health/trading")
    assert trading.json()["gatesSatisfied"] is False


def test_absent_market_mirror_blocks_the_market_data_gate() -> None:
    get_settings.cache_clear()
    hub = make_hub(get_settings(), values={})
    hub._redis_ping = (True, None, 1_700_000_000_000_000)
    hub._pg_state = {"error": "OSError"}

    async def scenario() -> None:
        await hub._refresh_market_mirror()

    asyncio.run(scenario())
    view = hub.readiness_view()
    gates = {gate["gate"]: gate for gate in view["gates"]}
    assert gates["market_data"]["satisfied"] is False
    assert "mirror" in gates["market_data"]["reason"]
    assert view["gatesSatisfied"] is False


def test_healthy_market_mirror_satisfies_only_its_own_gate() -> None:
    get_settings.cache_clear()
    settings = get_settings()
    now_micros = 1_700_000_000_000_000

    from wlct_trading.clock import epoch_micros

    mirror = {"status": "HEALTHY", "checkedAtMicros": epoch_micros()}
    hub = make_hub(settings, values={"wlct:trading:ops:health:market-data": json.dumps(mirror)})
    hub._redis_ping = (True, None, now_micros)
    hub._pg_state = {
        "published_accounts": 3,
        "stale_accounts": 0,
        "active_protections": 0,
        "engaged_global_switches": 0,
    }

    async def scenario() -> None:
        await hub._refresh_market_mirror()

    asyncio.run(scenario())
    view = hub.readiness_view()
    gates = {gate["gate"]: gate for gate in view["gates"]}
    assert gates["market_data"]["satisfied"] is True
    assert gates["risk_state_fresh"]["satisfied"] is True
    assert gates["kill_switches"]["satisfied"] is True
    # Connectivity and adapter stay unknown until the worker wires them -
    # which is precisely why gatesSatisfied is False while market_data is ok.
    assert gates["exchange_connectivity"]["satisfied"] is False
    assert gates["execution_adapter"]["satisfied"] is False
    assert view["gatesSatisfied"] is False


def test_engaged_kill_switch_blocks_and_alerts() -> None:
    get_settings.cache_clear()
    hub = make_hub(get_settings())
    hub._redis_ping = (True, None, 1_700_000_000_000_000)
    hub._pg_state = {
        "published_accounts": 1,
        "stale_accounts": 0,
        "active_protections": 2,
        "engaged_global_switches": 1,
    }

    async def scenario() -> None:
        await hub._publish_mirrors(ttl_seconds=60)

    asyncio.run(scenario())
    view = hub.readiness_view()
    gate = {g["gate"]: g for g in view["gates"]}["kill_switches"]
    assert gate["satisfied"] is False
    assert "1 engaged GLOBAL switch" in gate["reason"]
    assert any(a.rule_id == "KILL_SWITCH_ENGAGED" for a in hub.alerts.active())


def test_hub_exposes_no_mutation_surface() -> None:
    # The observability hub must not grow levers: no engage/release/order verbs.
    verbs = {"engage", "release", "clear", "submit", "place", "cancel", "execute"}
    assert not verbs & set(dir(TradingEngineObservability))
