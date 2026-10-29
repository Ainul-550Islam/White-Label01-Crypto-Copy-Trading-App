"""Assembly of the Binance USD-M FUTURES venue stack (batch 03, item B).

Responsibility: mirror :mod:`app.venue.binance_runtime`'s law on the futures
surface - one shared transport, one clock, one rate-limit registry across
every consumer - while delegating *what may trade* to composition and the
placement review. Nothing here makes a safety decision; this module builds
objects and performs no I/O on construction.

Two deliberate asymmetries with the spot stack:

1. **No SAPI traffic on this transport.** The futures allowlist pins
   ``fapi.binance.com`` / ``testnet.binancefuture.com`` exactly, and the
   key-permission endpoint (``/sapi/v1/account/apiRestrictions``) is served
   on the spot host. The placement attestor therefore receives the caller's
   ``restrictions_reader`` - in production the spot stack's
   ``fetch_key_restrictions`` - instead of its own channel. Futures without
   a wired reader attests nothing about the key, and the review refuses on
   exactly that absence.

2. **Margin and leverage posture are inputs, not outcomes.** The runtime
   carries the deployment's futures policy (isolated-only, leverage cap,
   notional cap, liquidation-distance floor, funding cap) as
   :class:`wlct_trading.exchanges.binance_futures.risk_guards.FuturesGuardPolicy`
   so the pre-sign evaluation can run against the same numbers the settings
   validated.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

import httpx
from wlct_trading.exchanges.binance_futures.attestation import (
    BinanceFuturesPlacementAttestor,
)
from wlct_trading.exchanges.binance_futures.capabilities import (
    BINANCE_FUTURES_CAPABILITIES,
    BINANCE_FUTURES_REST_BASE,
    BINANCE_FUTURES_TESTNET_REST_BASE,
    BINANCE_FUTURES_TESTNET_WS_BASE,
    BINANCE_FUTURES_WS_BASE,
)
from wlct_trading.exchanges.binance_futures.risk_guards import FuturesGuardPolicy
from wlct_trading.exchanges.binance_futures.trading import (
    BinanceFuturesAccountAdapter,
    BinanceFuturesTradingAdapter,
    FuturesTradingParams,
)
from wlct_trading.exchanges.binance_futures.userstream import FuturesListenKeyClient
from wlct_trading.execution.credentials import CredentialProvider
from wlct_trading.execution.timesync import ExchangeClock
from wlct_trading.net.config import TransportSettings
from wlct_trading.net.signed_client import HttpxSignedSender
from wlct_trading.transport.ratelimit import RateLimitRegistry

from app.config import Settings
from app.venue.binance_futures_transport import BinanceFuturesHttpTransport
from app.venue.order_outcome import OrderOutcomeResolver

#: Binance's own default and the widest this service signs with; kept as a
#: local constant rather than imported from the spot runtime so the two venue
#: stacks never share module state (the batches' spot-parity contract).
RECV_WINDOW_MS = 5_000

logger = logging.getLogger(__name__)

__all__ = [
    "BinanceFuturesVenueWiring",
    "build_binance_futures_runtime",
]

@dataclass(slots=True)
class BinanceFuturesVenueWiring:
    """The shared futures venue stack. One instance per process, built by composition."""

    transport: BinanceFuturesHttpTransport
    clock: ExchangeClock
    trading_adapter: BinanceFuturesTradingAdapter
    account_adapter: BinanceFuturesAccountAdapter
    attestor: BinanceFuturesPlacementAttestor
    outcome_resolver: OrderOutcomeResolver
    credentials: CredentialProvider
    guard_policy: FuturesGuardPolicy
    margin_mode: str
    base_url: str
    ws_base_url: str
    testnet: bool

    async def synchronise_clock(self) -> None:
        await self.clock.synchronise()

    def listen_key_manager(
        self, tenant_id: str, account_id: str
    ) -> FuturesListenKeyClient:
        """A per-account futures user-stream key client riding this transport.

        The keyed verb is the trading adapter's own ``_client.keyed``: the
        listen-key endpoints are key-authenticated (never signed), so the
        manager must NOT build requests itself - the adapter's client already
        resolves credentials, counts them against the shared weight budget and
        transmits through the one futures transport this process owns.
        """
        # Same-harness access, mirroring trading.py's exchange_time proxy.
        keyed = self.trading_adapter._client.keyed  # noqa: SLF001
        void = (tenant_id, account_id)  # resolved per-call by the client itself
        del void
        return FuturesListenKeyClient(keyed=keyed)

    async def aclose(self) -> None:
        await self.transport.aclose()

    def describe(self) -> dict[str, object]:
        return {
            "exchange": "binance",
            "market": "usdm_futures",
            "testnet": self.testnet,
            "wsBaseUrl": self.ws_base_url,
            "attestorSource": self.attestor.source,
            "userStream": "listen-key per account via /fapi/v1/listenKey",
            "guardPolicy": {
                # The margin mandate is a mode-not-data fact: it is read off
                # the settings at composition and enforced by the isolated-only
                # gate; the policy itself carries no such field.
                "marginMode": self.margin_mode,
                "maxLeverage": str(self.guard_policy.max_leverage),
                "maxNotionalUsdt": str(self.guard_policy.max_notional_usdt),
                "minLiquidationDistanceBps": self.guard_policy.min_liquidation_distance_bps,
                "maxFundingRateBps": self.guard_policy.max_funding_rate_bps,
            },
            "transport": self.transport.describe(),
        }


def build_binance_futures_runtime(
    settings: Settings,
    *,
    credential_provider: CredentialProvider,
    testnet: bool,
    restrictions_reader: Callable[[str, str], Awaitable[Mapping[str, object]]] | None = None,
    transport_client: httpx.AsyncClient | None = None,
) -> BinanceFuturesVenueWiring:
    """Assemble the shared Binance USD-M stack. Pure construction; no I/O.

    ``restrictions_reader`` is the shared SAPI key-permission probe - the spot
    runtime's ``fetch_key_restrictions`` when the spot stack is alive, and
    deliberately nullable: futures placement review refuses when key evidence
    cannot be gathered, it does not guess.
    """
    base_url = (
        BINANCE_FUTURES_TESTNET_REST_BASE if testnet else BINANCE_FUTURES_REST_BASE
    )
    ws_base_url = (
        BINANCE_FUTURES_TESTNET_WS_BASE if testnet else BINANCE_FUTURES_WS_BASE
    )
    timeout_ms = settings.EXECUTION_REQUEST_TIMEOUT_MS

    sender = HttpxSignedSender(
        TransportSettings(
            binance_rest_url=base_url,
            binance_ws_url=ws_base_url,
            use_testnet=testnet,
            http_connect_timeout_ms=min(timeout_ms, 5_000),
            http_read_timeout_ms=timeout_ms,
            http_total_timeout_ms=timeout_ms + 5_000,
        ),
        client=transport_client,
    )
    transport = BinanceFuturesHttpTransport(
        base_url=base_url,
        sender=sender,
        recv_window_ms=RECV_WINDOW_MS,
    )
    clock = ExchangeClock(
        transport.server_time,
        max_skew_millis=1_000,
        max_age_seconds=max(30, settings.EXECUTION_CLOCK_SYNC_INTERVAL_SECONDS * 2),
        require_sync=True,
    )
    transport.bind_clock_resync(clock.synchronise)

    # ONE registry for every futures consumer: the venue meters key and IP,
    # so split accounting would under-count by construction.
    rate_limits = RateLimitRegistry.from_rules(
        BINANCE_FUTURES_CAPABILITIES.rate_limit_rules
    )
    params = FuturesTradingParams(
        send=transport,
        rest_base=base_url,
        rate_limits=rate_limits,
        recv_window_ms=RECV_WINDOW_MS,
        timeout_ms=timeout_ms,
    )
    trading_adapter = BinanceFuturesTradingAdapter(
        params=params,
        credentials=credential_provider,
        clock=clock,
    )
    account_adapter = BinanceFuturesAccountAdapter(
        params=params,
        credentials=credential_provider,
        clock=clock,
    )
    attestor = BinanceFuturesPlacementAttestor(
        adapter=trading_adapter,
        restrictions_reader=restrictions_reader,
        account_reader=(
            account_adapter
            if settings.EXECUTION_VENUE_ATTESTATION_INCLUDE_ACCOUNT
            else None
        ),
    )
    guard_policy = FuturesGuardPolicy(
        max_leverage=Decimal(settings.EXECUTION_FUTURES_MAX_LEVERAGE),
        max_notional_usdt=Decimal(settings.EXECUTION_FUTURES_MAX_NOTIONAL_USDT),
        min_liquidation_distance_bps=Decimal(
            settings.EXECUTION_FUTURES_MIN_LIQUIDATION_DISTANCE_BPS
        ),
        max_funding_rate_bps=Decimal(settings.EXECUTION_FUTURES_MAX_FUNDING_RATE_BPS),
    )
    return BinanceFuturesVenueWiring(
        transport=transport,
        clock=clock,
        trading_adapter=trading_adapter,
        account_adapter=account_adapter,
        attestor=attestor,
        outcome_resolver=OrderOutcomeResolver(trading_adapter),
        credentials=credential_provider,
        guard_policy=guard_policy,
        margin_mode=settings.EXECUTION_FUTURES_MARGIN_MODE,
        base_url=base_url,
        ws_base_url=ws_base_url,
        testnet=testnet,
    )
