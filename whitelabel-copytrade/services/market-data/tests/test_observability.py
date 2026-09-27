"""Part 9 observability surface of the market-data service.

Route contracts are asserted WITHOUT the lifespan (the same convention as the
health tests: no live Redis in unit runs), and the hub is exercised directly
against a scripted fake-redis so alert folding, cardinality refusal and the
mirror document shape are all proven in-process.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from wlct_trading.observability.labels import CardinalityError

from app.config import get_settings
from app.main import create_app
from app.observability import MarketDataObservability


class FakePipe:
    def __init__(self, store: dict[str, str]) -> None:
        self._store = store

    def set(self, key: str, value: str, *, ex: int | None = None) -> None:
        self._store[key] = value

    async def execute(self) -> list[bool]:
        return [True]


class FakeRedis:
    """The minimum surface the hub uses: get/set/ping/pipeline."""

    def __init__(self, values: dict[str, str] | None = None) -> None:
        self.values: dict[str, str] = values or {}
        self.pings = 0

    async def get(self, key: str) -> str | None:
        return self.values.get(key)

    async def set(self, key: str, value: str, *, ex: int | None = None) -> bool:
        self.values[key] = value
        return True

    async def ping(self) -> bool:
        self.pings += 1
        return True

    def pipeline(self, *, transaction: bool = True) -> FakePipe:
        return FakePipe(self.values)


def make_hub() -> tuple[MarketDataObservability, FakeRedis]:
    get_settings.cache_clear()
    settings = get_settings()
    redis = FakeRedis()
    hub = MarketDataObservability(settings, redis)
    return hub, redis


def test_metrics_route_serves_even_without_lifespan() -> None:
    client = TestClient(create_app())
    response = client.get("/metrics")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain")
    assert "observability not initialised" in response.text


def test_components_route_reports_unknown_before_start() -> None:
    client = TestClient(create_app())
    response = client.get("/health/components")
    assert response.status_code == 200
    assert response.json()["status"] == "UNKNOWN"


def test_scrape_renders_registered_families_without_network() -> None:
    hub, _redis = make_hub()
    hub.record_cycle(updated=2, ok=True)
    text = hub.scrape()
    assert "# TYPE wlct_market_poll_cycles_total counter" in text
    assert 'wlct_market_poll_cycles_total{result="ok",service="market-data"} 1' in text
    assert "wlct_market_quotes_updated_total{service=\"market-data\"} 2" in text


def test_cycle_failure_then_recovery_folds_one_alert() -> None:
    hub, _redis = make_hub()
    hub.record_cycle(updated=1, ok=True)   # baseline "was ok"
    hub.record_cycle(updated=0, ok=False)  # transition -> alert
    hub.record_cycle(updated=0, ok=False)  # still failing -> no new alert
    active = hub.alerts.active()
    assert len(active) == 1
    assert active[0].occurrences == 1
    hub.record_cycle(updated=1, ok=True)  # recovery -> resolved, removed from active
    assert hub.alerts.active() == ()


def test_symbol_labels_are_bounded_by_config() -> None:
    hub, _redis = make_hub()
    first = hub._settings.symbols[0]
    hub.registry.set_gauge("wlct_market_quote_age_seconds", {"symbol": first}, 1.0)
    with pytest.raises(CardinalityError, match="outside the declared"):
        hub.registry.set_gauge("wlct_market_quote_age_seconds", {"symbol": "DOGEUSDT"}, 1.0)


def test_mirror_publish_writes_health_and_alert_documents() -> None:
    hub, redis = make_hub()

    async def scenario() -> None:
        await hub._refresh_redis_ping()
        await hub._refresh_quotes_age()
        await hub._publish_mirrors(ttl_seconds=60)

    asyncio.run(scenario())

    health_key = "wlct:trading:ops:health:market-data"
    alerts_key = "wlct:trading:ops:alerts:market-data"
    assert health_key in redis.values
    assert alerts_key in redis.values
    health: dict[str, Any] = json.loads(redis.values[health_key])
    alerts: dict[str, Any] = json.loads(redis.values[alerts_key])
    components = {c["component"] for c in health["components"]}
    assert {"redis", "poller", "quote_freshness"} <= components
    assert alerts["counts"]["EMERGENCY"] == 0


def test_quote_absence_marks_stale_alert_per_symbol() -> None:
    hub, redis = make_hub()

    async def scenario() -> None:
        await hub._refresh_quotes_age()  # empty cache -> every symbol unknown

    asyncio.run(scenario())
    active = hub.alerts.active()
    symbols = {record.scope for record in active}
    assert symbols == set(hub._settings.symbols)
    assert all(record.rule_id == "MARKET_DATA_STALE" for record in active)
