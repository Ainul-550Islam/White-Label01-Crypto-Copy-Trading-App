"""Assembly of the Binance SPOT venue stack for testnet and live modes.

Responsibility: build exactly one of everything the venue is metered or
judged by, and share it across every consumer:

- one :class:`~app.venue.binance_transport.BinanceHttpTransport` (one HTTP
  pool, one observed weight budget),
- one :class:`~wlct_trading.execution.timesync.ExchangeClock` with
  ``require_sync=True`` - signing is refused until the venue offset has been
  measured and while the measurement is stale,
- one :class:`~wlct_trading.transport.ratelimit.RateLimitRegistry`, passed
  to both the trading and the account adapter so a placement review and the
  order it approves draw from the same accounted budget,
- one :class:`~wlct_trading.exchanges.binance.trading.BinanceTradingAdapter`,
  shared by the engine, the outcome resolver and the placement attestor.
  The attestor *must* ride this adapter: a second signed client would spend
  weight outside the registry and sign against a separately-drifting clock.

This module builds objects; it makes no safety decision. Whether the stack
may transmit is decided by composition from the engine settings and, for
live, by :mod:`app.venue.live_gates`. Constructing the stack performs no
network I/O and resolves no credentials - both happen on first use, under
the engine's own refusals.

User-data stream: :meth:`BinanceVenueWiring.listen_key_manager` returns a
per-account :class:`~wlct_trading.exchanges.binance.userstream.ListenKeyManager`
whose create/keepalive/close ride this transport against
``/api/v3/userDataStream``, so stream events reconcile through the same
reconciliation service the REST adapters feed.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

import httpx
from wlct_trading.enums import ExchangeId
from wlct_trading.exchanges.binance.attestation import BinancePlacementAttestor
from wlct_trading.exchanges.binance.capabilities import (
    BINANCE_SPOT_CAPABILITIES,
    BINANCE_SPOT_REST_BASE,
    BINANCE_SPOT_WS_BASE,
    BINANCE_TESTNET_REST_BASE,
    BINANCE_TESTNET_WS_BASE,
)
from wlct_trading.exchanges.binance.signing import build_keyed_request
from wlct_trading.exchanges.binance.trading import (
    BinanceAccountAdapter,
    BinanceTradingAdapter,
)
from wlct_trading.exchanges.binance.userstream import ListenKeyManager
from wlct_trading.execution.credentials import (
    CredentialProvider,
    ExchangeCredentials,
)
from wlct_trading.execution.timesync import ExchangeClock
from wlct_trading.net.config import TransportSettings
from wlct_trading.net.signed_client import HttpxSignedSender
from wlct_trading.transport.ratelimit import RateLimitRegistry

from app.config import Settings
from app.venue.binance_transport import BinanceHttpTransport, VenueTransportError
from app.venue.order_outcome import OrderOutcomeResolver

logger = logging.getLogger(__name__)

__all__ = [
    "RECV_WINDOW_MS",
    "BinanceVenueWiring",
    "build_binance_runtime",
]

#: Binance's own default and the widest this service will sign with: a
#: request older than this (by venue time) is refused by the venue, which
#: bounds how long a captured signed request stays dangerous.
RECV_WINDOW_MS = 5_000

_USER_DATA_STREAM_PATH = "/api/v3/userDataStream"


@dataclass(slots=True)
class BinanceVenueWiring:
    """The shared venue stack. One instance per process, built by composition."""

    transport: BinanceHttpTransport
    clock: ExchangeClock
    trading_adapter: BinanceTradingAdapter
    account_adapter: BinanceAccountAdapter
    attestor: BinancePlacementAttestor
    outcome_resolver: OrderOutcomeResolver
    credentials: CredentialProvider
    base_url: str
    ws_base_url: str
    testnet: bool

    async def synchronise_clock(self) -> None:
        """Measure the venue clock offset now (startup + periodic refresh)."""
        await self.clock.synchronise()

    def listen_key_manager(
        self, tenant_id: str, account_id: str
    ) -> ListenKeyManager:
        """A per-account user-data-stream key manager riding this transport."""
        transport = self.transport
        credentials = self.credentials
        base_url = self.base_url

        async def _resolve() -> ExchangeCredentials:
            return await credentials.resolve(
                tenant_id, account_id, ExchangeId.BINANCE
            )

        async def create() -> str:
            request = build_keyed_request(
                method="POST",
                base_url=base_url,
                path=_USER_DATA_STREAM_PATH,
                params=(),
                credentials=await _resolve(),
            )
            response = await transport(request, 5_000)
            if not 200 <= response.status < 300:
                raise VenueTransportError(
                    f"listen-key create refused with HTTP {response.status}"
                )
            try:
                key = json.loads(response.body)["listenKey"]
            except (ValueError, KeyError, TypeError) as exc:
                raise VenueTransportError(
                    "listen-key create returned an unparseable body"
                ) from exc
            if not isinstance(key, str) or not key:
                raise VenueTransportError("listen-key create returned no key")
            return key

        async def _keyed(method: str, listen_key: str) -> None:
            request = build_keyed_request(
                method=method,
                base_url=base_url,
                path=_USER_DATA_STREAM_PATH,
                params=(("listenKey", listen_key),),
                credentials=await _resolve(),
            )
            response = await transport(request, 5_000)
            if not 200 <= response.status < 300:
                raise VenueTransportError(
                    f"listen-key {method.lower()} refused with HTTP "
                    f"{response.status}"
                )

        async def keepalive(listen_key: str) -> None:
            await _keyed("PUT", listen_key)

        async def close(listen_key: str) -> None:
            await _keyed("DELETE", listen_key)

        return ListenKeyManager(
            create=create,
            keepalive=keepalive,
            close=close,
            testnet=self.testnet,
            ws_base=self.ws_base_url,
        )

    async def aclose(self) -> None:
        """Release the HTTP pool. Called from the FastAPI lifespan shutdown."""
        await self.transport.aclose()

    def describe(self) -> dict[str, object]:
        """Non-secret wiring facts for the status surface."""
        return {
            "exchange": "binance",
            "market": "spot",
            "testnet": self.testnet,
            "wsBaseUrl": self.ws_base_url,
            "attestorSource": self.attestor.source,
            "userStream": "listen-key per account via /api/v3/userDataStream",
            "transport": self.transport.describe(),
        }


def build_binance_runtime(
    settings: Settings,
    *,
    credential_provider: CredentialProvider,
    testnet: bool,
    transport_client: httpx.AsyncClient | None = None,
) -> BinanceVenueWiring:
    """Assemble the shared Binance SPOT stack. Pure construction; no I/O.

    ``transport_client`` exists so tests can inject an
    ``httpx.MockTransport``-backed client; production passes ``None`` and the
    core sender creates its own (TLS verification on, redirects off).
    """
    base_url = BINANCE_TESTNET_REST_BASE if testnet else BINANCE_SPOT_REST_BASE
    ws_base_url = BINANCE_TESTNET_WS_BASE if testnet else BINANCE_SPOT_WS_BASE
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
    transport = BinanceHttpTransport(
        base_url=base_url,
        sender=sender,
        recv_window_ms=RECV_WINDOW_MS,
    )
    # The clock measures the venue through this transport, and the transport
    # needs the clock to recover from -1021: build transport -> clock -> bind.
    clock = ExchangeClock(
        transport.server_time,
        max_skew_millis=1_000,
        max_age_seconds=max(30, settings.EXECUTION_CLOCK_SYNC_INTERVAL_SECONDS * 2),
        require_sync=True,
    )
    transport.bind_clock_resync(clock.synchronise)

    # ONE registry for every consumer: the venue meters the key and the IP,
    # so split accounting would under-count by construction.
    rate_limits = RateLimitRegistry.from_rules(
        BINANCE_SPOT_CAPABILITIES.rate_limit_rules
    )
    trading_adapter = BinanceTradingAdapter(
        send=transport,
        credentials=credential_provider,
        clock=clock,
        rate_limits=rate_limits,
        testnet=testnet,
        rest_base=base_url,
        recv_window_ms=RECV_WINDOW_MS,
        timeout_ms=timeout_ms,
    )
    account_adapter = BinanceAccountAdapter(
        send=transport,
        credentials=credential_provider,
        clock=clock,
        rate_limits=rate_limits,
        testnet=testnet,
        rest_base=base_url,
        recv_window_ms=RECV_WINDOW_MS,
        timeout_ms=timeout_ms,
    )
    # The attestor rides the SAME trading adapter the engine places with -
    # same credentials, same clock, same rate-limit registry.
    attestor = BinancePlacementAttestor(
        adapter=trading_adapter,
        account_reader=(
            account_adapter
            if settings.EXECUTION_VENUE_ATTESTATION_INCLUDE_ACCOUNT
            else None
        ),
    )
    return BinanceVenueWiring(
        transport=transport,
        clock=clock,
        trading_adapter=trading_adapter,
        account_adapter=account_adapter,
        attestor=attestor,
        outcome_resolver=OrderOutcomeResolver(trading_adapter),
        credentials=credential_provider,
        base_url=base_url,
        ws_base_url=ws_base_url,
        testnet=testnet,
    )
