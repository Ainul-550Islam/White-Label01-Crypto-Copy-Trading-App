"""Mode × market wiring matrix (batch 03).

What composition builds is the contract: the futures stack exists exactly for
``(testnet|live) × usdm_futures``, never for simulated, and the spot market
keeps its pre-batch wiring byte-identical (futures field present but None).
"""

from __future__ import annotations

from typing import Any

import pytest

import os
from contextlib import contextmanager

from app.composition import build_runtime
from app.config import Settings
from app.venue.binance_futures_runtime import BinanceFuturesVenueWiring
from app.venue.binance_runtime import BinanceVenueWiring
from wlct_trading.adapters.paper import PaperAccountAdapter, PaperTradingAdapter
from wlct_trading.exchanges.binance_futures.trading import (
    BinanceFuturesAccountAdapter,
    BinanceFuturesTradingAdapter,
)
from wlct_trading.exchanges.binance.trading import (
    BinanceAccountAdapter,
    BinanceTradingAdapter,
)
from tests.conftest import BASE_ENV

_VAULT = {
    "EXECUTION_CREDENTIAL_SOURCE": "secret-manager",
    "EXECUTION_CREDENTIAL_FETCHER": "vault-kv2",
    "EXECUTION_VAULT_ADDR": "https://vault.internal:8200",
}


_TEST_ENV_KEYS = {
    "WLCT_BINANCE_TESTNET_API_KEY": "ak_test_" + "1" * 32,
    "WLCT_BINANCE_TESTNET_API_SECRET": "sk_test_" + "2" * 32,
}


def _settings(**overrides: Any) -> Settings:
    merged: dict[str, Any] = {**BASE_ENV}
    merged.update(overrides)
    return Settings.model_validate(merged)


@contextmanager
def _env_keys():
    # Environment-sourced credentials for the construction path. Composition
    # performs no I/O and resolves nothing, but the settings validator
    # (correctly) demands the named variables exist before it will believe an
    # "environment" credential source is real.
    previous = {k: os.environ.get(k) for k in _TEST_ENV_KEYS}
    os.environ.update(_TEST_ENV_KEYS)
    try:
        yield
    finally:
        for key, old in previous.items():
            if old is None:
                os.environ.pop(key, None)
            else:  # pragma: no cover
                os.environ[key] = old


def _testnet_futures(**overrides: Any) -> Settings:
    merged: dict[str, Any] = {
        **BASE_ENV,
        "EXECUTION_MODE": "testnet",
        "EXECUTION_DRY_RUN": "true",
        "EXECUTION_VENUE_MARKET": "usdm_futures",
        "EXECUTION_CREDENTIAL_SOURCE": "environment",
        "EXECUTION_CREDENTIAL_ENV_PREFIX": "WLCT_BINANCE_TESTNET",
        # environment-carried keys are a development/testing surface; the
        # composition tests never read them - construction performs no I/O.
    }
    merged.update(overrides)
    return Settings.model_validate(merged)


class TestMarketMatrix:
    def test_simulated_market_spot_is_byte_identical_shape(self):
        runtime = build_runtime(_settings())
        assert runtime.venue_wiring is None
        assert runtime.futures_venue_wiring is None
        assert isinstance(runtime.trading_adapter, PaperTradingAdapter)
        assert isinstance(runtime.account_adapter, PaperAccountAdapter)

    def test_simulated_market_futures_refused_at_settings(self):
        with pytest.raises(Exception) as excinfo:
            _testnet_futures(EXECUTION_MODE="simulated")
        assert "simulated" in str(excinfo.value)

    def test_testnet_spot_wires_spot_only(self):
        with _env_keys():
            runtime = build_runtime(
                _settings(
                    EXECUTION_MODE="testnet",
                    EXECUTION_DRY_RUN="true",
                    EXECUTION_CREDENTIAL_SOURCE="environment",
                    EXECUTION_CREDENTIAL_ENV_PREFIX="WLCT_BINANCE_TESTNET",
                    EXECUTION_VENUE_MARKET="spot",
                )
            )
        assert isinstance(runtime.venue_wiring, BinanceVenueWiring)
        assert runtime.venue_wiring.testnet is True
        assert runtime.futures_venue_wiring is None
        assert isinstance(runtime.trading_adapter, BinanceTradingAdapter)
        assert isinstance(runtime.account_adapter, BinanceAccountAdapter)

    def test_testnet_futures_wires_futures_plus_spot_reader(self):
        with _env_keys():
            runtime = build_runtime(_testnet_futures())
        wiring = runtime.futures_venue_wiring
        assert isinstance(wiring, BinanceFuturesVenueWiring)
        assert wiring.testnet is True
        assert "testnet.binancefuture.com" in wiring.base_url
        assert isinstance(runtime.trading_adapter, BinanceFuturesTradingAdapter)
        assert isinstance(runtime.account_adapter, BinanceFuturesAccountAdapter)
        # The spot stack is present too, read-only, to serve the SAPI
        # key-permission probe the futures attestor consumes.
        assert isinstance(runtime.venue_wiring, BinanceVenueWiring)

    def test_futures_attestor_uses_shared_restrictions_reader(self):
        with _env_keys():
            runtime = build_runtime(_testnet_futures())
        attestor = runtime.futures_venue_wiring.attestor  # type: ignore[union-attr]
        # Source naming must claim apiRestrictions evidence - proof the shared
        # SAPI reader got wired rather than the silent "unwired" label.
        assert attestor.source.startswith("binance_futures:apiRestrictions")
        assert ":unwired" not in attestor.source

    def test_futures_guard_policy_propagates_settings(self):
        with _env_keys():
            runtime = build_runtime(
                _testnet_futures(
                    EXECUTION_FUTURES_MAX_LEVERAGE="5",
                    EXECUTION_FUTURES_MAX_NOTIONAL_USDT="1000.5",
                )
            )
        policy = runtime.futures_venue_wiring.guard_policy  # type: ignore[union-attr]
        assert policy.max_leverage == 5
        assert str(policy.max_notional_usdt) == "1000.5"

    def test_status_surface_contains_futures_section_only_when_wired(self):
        with _env_keys():
            spot_runtime = build_runtime(
                _settings(
                    EXECUTION_MODE="testnet",
                    EXECUTION_DRY_RUN="true",
                    EXECUTION_CREDENTIAL_SOURCE="environment",
                    EXECUTION_CREDENTIAL_ENV_PREFIX="WLCT_BINANCE_TESTNET",
                )
            )
        spot_view = spot_runtime.describe()
        assert spot_view.get("venueFutures") is None

        with _env_keys():
            fut_runtime = build_runtime(_testnet_futures())
        fut_view = fut_runtime.describe()
        market = fut_view["venueFutures"]
        assert isinstance(market, dict)
        assert market["market"] == "usdm_futures"
        assert market["testnet"] is True
        assert market["guardPolicy"]["marginMode"] == "isolated"

    def test_futures_transport_is_the_only_futures_egress(self):
        # Host pinning is tested in test_futures_transport; here the wiring's
        # transport type proves composition did not hand the futures adapters
        # a spot transport.
        from app.venue.binance_futures_transport import BinanceFuturesHttpTransport

        with _env_keys():
            runtime = build_runtime(_testnet_futures())
        assert isinstance(
            runtime.futures_venue_wiring.transport,  # type: ignore[union-attr]
            BinanceFuturesHttpTransport,
        )
