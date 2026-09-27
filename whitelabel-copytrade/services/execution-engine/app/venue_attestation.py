"""Venue attestation wiring for the execution engine (Part 22).

The placement review (:mod:`wlct_trading.execution.placement_review`) refuses
every order whose venue review it cannot answer; the evidence comes from a
:class:`~wlct_trading.execution.placement_attestor.PlacementAttestor`. The
core ships the local gatherer (what this process knows) and the caching
wrapper; this module builds the venue-backed gatherer when the deployment has
real credentials to present, and refuses honestly when it does not.

``BinancePlacementAttestor`` queries the venue's authenticated endpoints:

* ``GET /sapi/v1/account/apiRestrictions`` - key permissions: spot trading
  allowed, withdrawals permitted (a refusal on principle), IP allowlist
  present, key creation time.
* ``GET /api/v3/account`` (optional, when ``include_account_flags``) - the
  account's ``canTrade`` flag and account type.
* ``GET /api/v3/exchangeInfo`` - the symbol's status and the order types and
  time-in-forces the venue actually grants for it.

Signing follows the venue's documented HMAC-SHA256 scheme: the query string is
signed, the key travels in the header, the secret never does. The gatherer
raises on transport failure - converting a raise into a finding is the
reviewer's and the cache's job, not this module's.

When credentials are ``none`` (the default for simulated mode) no attestor is
constructed: there is no key to present to the venue, and asking Binance
whether a nonexistent key may trade is a question with no honest answer. That
state is the composition root's ``venue_attestation_wiring = None``, which the
status surface reports as exactly that.
"""

from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass
from urllib.parse import urlencode

import httpx
from wlct_trading.clock import epoch_micros
from wlct_trading.execution.credentials import CredentialProvider
from wlct_trading.execution.placement_attestor import (
    CachingPlacementAttestor,
    PlacementAttestor,
    PlacementReviewRequest,
)
from wlct_trading.execution.placement_review import (
    PlacementAttestation,
    PlacementFacts,
)

__all__ = [
    "BinancePlacementAttestor",
    "VenueAttestationConfig",
    "VenueAttestationError",
    "VenueAttestationWiring",
    "build_venue_attestation",
]

#: The venue's production and testnet bases, split because a deployment must
#: be able to attest against the same environment it would trade on. A testnet
#: attestation is real evidence about the testnet key - which is exactly what
#: a rehearsal owes - and never evidence about production.
BINANCE_BASE_URL = "https://api.binance.com"
BINANCE_TESTNET_BASE_URL = "https://testnet.binance.vision"

#: Binance requires a recvWindow on authenticated calls. The attestor uses the
#: default the review policy states (5s) minus nothing: the skew check against
#: the review's budget happens in the reviewer, on the facts, not here.
_RECV_WINDOW_MS = 5_000

#: Hard timeout for every venue call. A gatherer that waits forever converts a
#: slow venue into a stuck order pipeline; the reviewer already knows how to
#: turn a raise into a finding, so raise instead.
_REQUEST_TIMEOUT_SECONDS = 10.0


class VenueAttestationError(RuntimeError):
    """Raised when venue attestation cannot be wired or gathered at all."""


@dataclass(frozen=True)
class VenueAttestationConfig:
    """What the operator configured for venue-backed attestation."""

    enabled: bool
    testnet: bool = False
    cache_ttl_ms: int = 300_000
    include_account_flags: bool = False

    def describe(self) -> dict[str, object]:
        return {
            "enabled": self.enabled,
            "testnet": self.testnet,
            "cacheTtlMs": self.cache_ttl_ms,
            "includeAccountFlags": self.include_account_flags,
        }


class VenueAttestationWiring:
    """The attestor plus the facts /status publishes about it."""

    def __init__(self, attestor: PlacementAttestor, config: VenueAttestationConfig) -> None:
        self._attestor = attestor
        self._config = config

    @property
    def attestor(self) -> PlacementAttestor:
        return self._attestor

    def describe(self) -> dict[str, object]:
        """Derived from the object that was built: the attestor's own source
        label is the fact, so a deployment that thinks it built a venue
        gatherer but built a cache around an unattested one is visible."""
        return {
            "enabled": self._config.enabled,
            "testnet": self._config.testnet,
            "cacheTtlMs": self._config.cache_ttl_ms,
            "includeAccountFlags": self._config.include_account_flags,
            "attestorSource": self._attestor.source,
            "venueBacked": "binance" in self._attestor.source,
        }


def build_venue_attestation(
    config: VenueAttestationConfig,
    *,
    credential_provider: CredentialProvider,
) -> VenueAttestationWiring:
    """Build the venue-backed attestor, wrapped in the core's TTL cache.

    ``enabled=False`` refuses rather than returning an unattested attestor:
    the caller (the composition root) only constructs wiring when credentials
    exist, so a disabled config here is a contradiction between settings that
    must be named, not absorbed.
    """
    if not isinstance(config, VenueAttestationConfig):
        raise VenueAttestationError(
            "build_venue_attestation requires a VenueAttestationConfig"
        )
    if credential_provider is None:
        raise VenueAttestationError(
            "venue attestation requires a credential provider; with no "
            "credentials there is no key to present and no call to make"
        )
    if not config.enabled:
        raise VenueAttestationError(
            "venue attestation is configured off while real credentials are "
            "present; the placement review would gather nothing venue-backed "
            "and every order would refuse on missing attestation. Set "
            "EXECUTION_VENUE_ATTESTATION to the enabled value or clear the "
            "credential source - do not run one against the other"
        )
    gatherer = BinancePlacementAttestor(
        credential_provider,
        testnet=config.testnet,
        include_account_flags=config.include_account_flags,
    )
    attestor: PlacementAttestor = CachingPlacementAttestor(
        gatherer,
        ttl_ms=config.cache_ttl_ms,
    )
    return VenueAttestationWiring(attestor, config)


class BinancePlacementAttestor(PlacementAttestor):
    """Gathers key, account and symbol facts from Binance's own endpoints.

    Every request is signed with the account's key material, resolved through
    the credential provider per (tenant, account) - the registry never holds
    venue secrets itself. Failures raise; the cache and the reviewer own the
    decision to turn them into findings.
    """

    def __init__(
        self,
        credential_provider: CredentialProvider,
        *,
        testnet: bool = False,
        include_account_flags: bool = False,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        if credential_provider is None:
            raise VenueAttestationError(
                "BinancePlacementAttestor requires a credential provider"
            )
        self._provider = credential_provider
        self._testnet = bool(testnet)
        self._include_account_flags = bool(include_account_flags)
        self._client = client

    @property
    def source(self) -> str:
        base = "binance-testnet" if self._testnet else "binance"
        return f"{base}:apiRestrictions+exchangeInfo"

    def _base_url(self) -> str:
        return BINANCE_TESTNET_BASE_URL if self._testnet else BINANCE_BASE_URL

    def _signed_headers(self, api_key: str, api_secret: str, params: dict[str, object]) -> str:
        query = urlencode(params)
        signature = hmac.new(
            api_secret.encode("utf-8"),
            query.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return f"{query}&signature={signature}"

    async def _authenticated_get(
        self,
        client: httpx.AsyncClient,
        path: str,
        api_key: str,
        api_secret: str,
        extra_params: dict[str, object] | None = None,
    ) -> dict[str, object]:
        params: dict[str, object] = {
            # One clock for the whole service: the venue millis are derived
            # from the same epoch_micros() source the review's skew checks
            # read, so the attestor and the reviewer cannot disagree about
            # what "now" is.
            "timestamp": epoch_micros() // 1000,
            "recvWindow": _RECV_WINDOW_MS,
        }
        if extra_params:
            params.update(extra_params)
        signed_query = self._signed_headers(api_key, api_secret, params)
        response = await client.get(
            f"{self._base_url()}{path}",
            params=signed_query,
            headers={"X-MBX-APIKEY": api_key},
        )
        if response.status_code != 200:
            raise VenueAttestationError(
                f"venue returned {response.status_code} for {path}"
            )
        payload = response.json()
        if not isinstance(payload, dict):
            raise VenueAttestationError(f"venue returned a non-object body for {path}")
        return payload

    async def attest(self, request: PlacementReviewRequest) -> PlacementAttestation:
        """Gather the key, account and symbol facts for one placement request."""
        now_micros = epoch_micros()
        client = self._client
        owns_client = client is None
        if client is None:
            client = httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS)
        try:
            credentials = await self._provider.resolve(
                request.tenant_id, request.account_id, self._provider.default_exchange
            )
            api_key = credentials.api_key
            api_secret = credentials.api_secret

            restrictions = await self._authenticated_get(
                client, "/sapi/v1/account/apiRestrictions", api_key, api_secret
            )
            exchange_info = await client.get(
                f"{self._base_url()}/api/v3/exchangeInfo",
                params={"symbol": request.symbol},
            )
            if exchange_info.status_code != 200:
                raise VenueAttestationError(
                    f"venue returned {exchange_info.status_code} for exchangeInfo"
                )
            symbols = exchange_info.json().get("symbols", [])
            symbol_row = next(
                (row for row in symbols if row.get("symbol") == request.symbol),
                None,
            )

            account_row: dict[str, object] | None = None
            if self._include_account_flags:
                account_row = await self._authenticated_get(
                    client, "/api/v3/account", api_key, api_secret
                )

            symbol_types = symbol_row.get("orderTypes", []) if symbol_row else []
            symbol_tifs = symbol_row.get("timeInForce", []) if symbol_row else []
            raw_created_at = restrictions.get("createTime")
            created_at_millis = raw_created_at if isinstance(raw_created_at, int) else None
            facts = PlacementFacts(
                venue_backed=True,
                source=self.source,
                key_created_at_millis=created_at_millis,
                key_permission_granted=bool(
                    restrictions.get("spotTradingEnabled", False)
                ),
                withdrawal_permitted=bool(
                    restrictions.get("withdrawalsEnabled", False)
                ),
                read_permitted=bool(restrictions.get("readingEnabled", False)),
                ip_allowlist_enabled=bool(
                    restrictions.get("ipRestrict", False)
                ),
                account_can_trade=(
                    bool(account_row.get("canTrade"))
                    if isinstance(account_row, dict) and "canTrade" in account_row
                    else None
                ),
                account_type=(
                    str(account_row.get("accountType"))
                    if isinstance(account_row, dict) and account_row.get("accountType")
                    else None
                ),
                symbol_attached=symbol_row is not None,
                symbol_trading=(
                    symbol_row.get("status") == "TRADING" if symbol_row else None
                ),
                order_type_supported=(
                    request.order_type in symbol_types if symbol_row else None
                ),
                time_in_force_supported=(
                    request.time_in_force in symbol_tifs if symbol_row else None
                ),
            )
            return PlacementAttestation(
                facts=facts,
                attested_at_micros=now_micros,
            )
        except VenueAttestationError:
            raise
        except Exception as error:  # transport failure - the reviewer's finding
            raise VenueAttestationError(
                f"venue attestation could not be gathered: {type(error).__name__}"
            ) from error
        finally:
            if owns_client and client is not None:
                await client.aclose()

    async def aclose(self) -> None:
        """Release the shared client, when one was injected."""
        if self._client is not None:
            await self._client.aclose()

