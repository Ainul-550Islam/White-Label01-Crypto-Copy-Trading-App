"""Key-permission attestation for Binance USD-M futures placements (batch 03).

The futures review asks the SAME key the spot review asks -
``GET /sapi/v1/account/apiRestrictions`` is a SAPI endpoint and answers for
the whole key - but it reads a different field out of the payload:
``enableFutures`` rather than ``enableSpotAndMarginTrading``. A key cleared
for spot is not cleared for futures, and a gatherer that reused the spot
reading would wave futures orders through on the wrong permission line. This
module therefore exists as its own gatherer with its own evidence mapping; it
borrows the *law* from
:mod:`wlct_trading.exchanges.binance.attestation` (absence is unknown, ``0``
is not 1970, the stricter of key/account wins on withdrawals) and none of its
conclusions.

What it asks, and what each answer is for
-----------------------------------------

``GET /sapi/v1/account/apiRestrictions`` (SAPI weight 1) - through the caller
    Key restrictions are key-WIDE and the endpoint is served on Binance's spot
    host (``api.binance.com``), not on ``fapi``: this gatherer therefore never
    touches the wire itself. It receives a ``restrictions_reader`` callable -
    in production the spot stack's
    :meth:`BinanceTradingAdapter.fetch_key_restrictions`, which already rides
    the correctly-pinned transport, the deployment's credential provider and
    the shared clock. Wiring futures attestation *without* that reader leaves
    every key-level field unknown, which the review's law 5 turns into a
    refusal: missing attestation infrastructure is a refusal, never a pass.

    The fields read: ``enableFutures``, ``enableWithdrawals``,
    ``enableReading``, ``ipRestrict``, ``createTime``,
    ``tradingAuthorityExpirationTime``.

``GET /fapi/v2/account`` (weight 5), only when an account reader is wired
    The futures account-level switch (``canTrade``) plus the position-mode
    and margin posture the placement review wants recorded. Same rule as
    spot: key perfect + account closed trades nothing.

the deployment's instrument catalog
    ``exchangeInfo`` facts through the injected lookup, never a second fetch:
    the review must describe the same symbol the order path would trade.

Futures-specific differences from spot
--------------------------------------

* ``trading_permitted`` maps to ``enableFutures``; a payload that only
  asserts ``enableSpotAndMarginTrading`` yields ``None`` for the futures
  question, and law 5 of the review refuses on exactly that silence.
* Position mode matters: this platform's futures law is one-way mode only,
  so a venue answer of *hedge mode* is surfaced on the attestation's
  ``collection_extra`` for the review, and venue hedged-mode accounts are a
  refusal downstream rather than a surprise mid-fill.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, Awaitable, Final, Protocol

from wlct_trading.clock import epoch_micros
from wlct_trading.exchanges.binance.attestation import (
    _optional_flag,
    _optional_millis,
    symbol_facts_from_market,
    SymbolRegistry,
)
from wlct_trading.exchanges.binance.parsers import BinanceParseError
from wlct_trading.execution.placement_attestor import (
    AttestationFailure,
    PlacementAttestor,
    PlacementReviewRequest,
    SymbolEvidence,
    SymbolFacts,
    symbol_evidence,
)
from wlct_trading.execution.placement_review import PlacementAttestation, PlacementFacts, ReviewCode

from .parsers import FuturesParseError
from .trading import BinanceFuturesAccountAdapter, BinanceFuturesTradingAdapter

__all__ = [
    "BINANCE_FUTURES_REVIEW_SOURCE",
    "BinanceFuturesPlacementAttestor",
    "FuturesAccountFlagReader",
    "FuturesKeyEvidence",
    "FuturesVenueAccountFlags",
    "futures_key_evidence_from_restrictions",
]

logger = logging.getLogger(__name__)

#: Provenance prefix; the suffix names only endpoints this deployment wired.
BINANCE_FUTURES_REVIEW_SOURCE: Final[str] = "binance_futures:apiRestrictions"


class FuturesAccountFlagReader(Protocol):
    """The narrow read the review needs from the account surface."""

    async def fetch_account(
        self, tenant_id: str, account_id: str
    ) -> Mapping[str, Any]: ...


@dataclass(frozen=True, slots=True)
class FuturesKeyEvidence:
    """The key-level answers, futures reading. ``None`` means the venue did not say."""

    futures_trading_permitted: bool | None
    withdrawals_permitted: bool | None
    reading_permitted: bool | None
    ip_allowlist_enabled: bool | None
    created_at_millis: int | None
    trading_authority_expires_at_millis: int | None

    def to_public_dict(self) -> dict[str, object]:
        return {
            "futuresTradingPermitted": self.futures_trading_permitted,
            "withdrawalsPermitted": self.withdrawals_permitted,
            "readingPermitted": self.reading_permitted,
            "ipAllowlistEnabled": self.ip_allowlist_enabled,
            "createdAtMillis": self.created_at_millis,
            "tradingAuthorityExpiresAtMillis": self.trading_authority_expires_at_millis,
        }


@dataclass(frozen=True, slots=True)
class FuturesVenueAccountFlags:
    """Account-level switches parsed from ``/fapi/v2/account``."""

    can_trade: bool | None
    can_withdraw: bool | None
    multi_assets_margin: bool | None
    is_hedge_mode: bool | None


def futures_key_evidence_from_restrictions(
    payload: Mapping[str, object],
) -> FuturesKeyEvidence:
    """Map ``apiRestrictions`` onto the futures review's key questions.

    The one deliberate difference from the spot mapping: ``enableFutures`` is
    the trading-permission field. Consulting the spot flag here would assert a
    licence this review does not have.
    """
    if not isinstance(payload, Mapping):
        raise FuturesParseError(
            "Binance apiRestrictions did not return an object; nothing can be "
            "attested about this key."
        )
    ev = FuturesKeyEvidence(
        futures_trading_permitted=_optional_flag(payload, "enableFutures"),
        withdrawals_permitted=_optional_flag(payload, "enableWithdrawals"),
        reading_permitted=_optional_flag(payload, "enableReading"),
        ip_allowlist_enabled=_optional_flag(payload, "ipRestrict"),
        created_at_millis=_optional_millis(payload, "createTime"),
        trading_authority_expires_at_millis=_optional_millis(
            payload, "tradingAuthorityExpirationTime"
        ),
    )
    return ev


def _futures_account_flags(account: Mapping[str, Any]) -> FuturesVenueAccountFlags:
    """Project the parsed account-v2 mapping onto the review's account questions."""
    def _flag(name: str) -> bool | None:
        raw = account.get(name)
        if isinstance(raw, bool):
            return raw
        return None

    dual = account.get("dual_side_position")
    hedge: bool | None
    if isinstance(dual, bool):
        hedge = dual
    elif isinstance(dual, str):
        hedge = dual.strip().lower() == "true"
    else:
        hedge = None
    return FuturesVenueAccountFlags(
        can_trade=_flag("can_trade"),
        can_withdraw=_flag("can_withdraw"),
        multi_assets_margin=_flag("multi_assets_margin"),
        is_hedge_mode=hedge,
    )


class BinanceFuturesPlacementAttestor(PlacementAttestor):
    """Gathers the venue's futures answers for one review, about one (account, symbol).

    Rides the deployment's :class:`BinanceFuturesTradingAdapter` so the review
    shares credential provider, synchronised clock and the futures rate-limit
    registry - a second signed client would spend weight this deployment never
    accounted for, and the venue's 429 would arrive as a review failure on the
    way to an order that never went out.

    ``account_reader`` is the futures account adapter; optional, and its absence
    leaves the account-level fields unknown (a recorded degradation, not a
    silent pass). ``symbol_facts`` is the deployment instrument catalog's
    lookup, same rationale as the spot gatherer.
    """

    __slots__ = ("_adapter", "_restrictions_reader", "_account_reader", "_symbol_facts", "_clock", "_source")

    def __init__(
        self,
        *,
        adapter: BinanceFuturesTradingAdapter,
        restrictions_reader: Callable[[str, str], Awaitable[Mapping[str, object]]] | None = None,
        account_reader: FuturesAccountFlagReader | None = None,
        symbol_facts: Callable[[str], SymbolFacts | None] | None = None,
        clock: Callable[[], int] = epoch_micros,
    ) -> None:
        self._adapter = adapter
        self._restrictions_reader = restrictions_reader
        self._account_reader = account_reader
        self._symbol_facts = symbol_facts
        self._clock = clock
        parts = [BINANCE_FUTURES_REVIEW_SOURCE]
        if restrictions_reader is None:
            # Named honestly: with no SAPI reader the gatherer attests nothing
            # about the key, so the source label says so rather than claim the
            # endpoint was consulted.
            parts[0] = BINANCE_FUTURES_REVIEW_SOURCE + ":unwired"
        if account_reader is not None:
            parts.append("accountV2")
        if symbol_facts is not None:
            parts.append("exchangeInfo")
        self._source = "+".join(parts)

    @property
    def source(self) -> str:
        return self._source

    async def attest(self, request: PlacementReviewRequest) -> PlacementAttestation:
        """One review's futures calls: apiRestrictions, plus account when wired."""
        now = self._clock()
        restrictions = await self._restrictions(request)
        evidence = (
            FuturesKeyEvidence(
                futures_trading_permitted=None,
                withdrawals_permitted=None,
                reading_permitted=None,
                ip_allowlist_enabled=None,
                created_at_millis=None,
                trading_authority_expires_at_millis=None,
            )
            if restrictions is None
            else futures_key_evidence_from_restrictions(restrictions)
        )
        flags = (
            None
            if self._account_reader is None
            else await self._account_flags(request)
        )
        symbol = self._symbol_evidence(request)
        withdrawal_permitted = self._strictest_withdrawal_answer(evidence, flags)
        facts = PlacementFacts(
            venue_backed=True,
            source=self._source,
            key_created_at_millis=evidence.created_at_millis,
            key_permission_granted=evidence.futures_trading_permitted,
            withdrawal_permitted=withdrawal_permitted,
            read_permitted=evidence.reading_permitted,
            ip_allowlist_enabled=evidence.ip_allowlist_enabled,
            trading_authority_expires_at_millis=(
                evidence.trading_authority_expires_at_millis
            ),
            account_can_trade=None if flags is None else flags.can_trade,
            account_type=(
                None
                if flags is None or flags.is_hedge_mode is None
                else ("FUTURES_HEDGE" if flags.is_hedge_mode else "FUTURES_ONEWAY")
            ),
            symbol_attached=None if symbol is None else symbol.symbol_attached,
            symbol_trading=None if symbol is None else symbol.symbol_trading,
            order_type_supported=None if symbol is None else symbol.order_type_supported,
            time_in_force_supported=(
                None if symbol is None else symbol.time_in_force_supported
            ),
            clock_skew_millis=self._adapter.clock_skew_millis,
            recv_window_millis=self._adapter.recv_window_ms,
            venue_trading_permitted=self._trading_established(evidence, flags, symbol),
            no_known_withdrawal_path=withdrawal_permitted is False,
            review_required_at_micros=now,
        )
        return PlacementAttestation(facts=facts, attested_at_micros=now)

    async def _restrictions(
        self, request: PlacementReviewRequest
    ) -> Mapping[str, object] | None:
        reader = self._restrictions_reader
        if reader is None:
            return None
        try:
            payload = await reader(request.tenant_id, request.account_id)
        except (FuturesParseError, BinanceParseError) as error:
            raise _unreadable("apiRestrictions", error) from error
        if not isinstance(payload, Mapping):
            raise _unreadable(
                "apiRestrictions",
                FuturesParseError(
                    "apiRestrictions reader returned a non-object; the answer "
                    "is unreadable, not a denial"
                ),
            )
        return payload

    async def _account_flags(self, request: PlacementReviewRequest) -> FuturesVenueAccountFlags:
        assert self._account_reader is not None  # caller guarantees
        try:
            account = await self._account_reader.fetch_account(
                request.tenant_id, request.account_id
            )
        except (FuturesParseError, BinanceParseError) as error:
            raise _unreadable("accountV2", error) from error
        return _futures_account_flags(account)

    def _symbol_evidence(self, request: PlacementReviewRequest) -> SymbolEvidence | None:
        lookup = self._symbol_facts
        if lookup is None:
            return None
        try:
            found = lookup(request.symbol)
        except Exception as error:  # a catalog fault is not a refusal
            logger.warning(
                "placement.attestation.futures_symbol_lookup_failed",
                extra={
                    "event": "placement.attestation.futures_symbol_lookup_failed",
                    "symbol": request.symbol,
                    "error": f"{type(error).__name__}: {error}",
                },
            )
            return None
        if found is None:
            return None
        return symbol_evidence(
            found,
            order_type=request.order_type,
            time_in_force=request.time_in_force,
        )

    @staticmethod
    def _strictest_withdrawal_answer(
        evidence: FuturesKeyEvidence, flags: FuturesVenueAccountFlags | None
    ) -> bool | None:
        """Same union-of-sources law as spot: either switch being on means on."""
        key_answer = evidence.withdrawals_permitted
        account_answer = None if flags is None else flags.can_withdraw
        if key_answer is True or account_answer is True:
            return True
        if key_answer is False:
            return False
        return None

    @staticmethod
    def _trading_established(
        evidence: FuturesKeyEvidence,
        flags: FuturesVenueAccountFlags | None,
        symbol: SymbolEvidence | None,
    ) -> bool:
        if evidence.futures_trading_permitted is not True:
            return False
        if flags is not None and flags.can_trade is False:
            return False
        if flags is not None and flags.is_hedge_mode is True:
            # The platform's futures mandate is one-way mode; a hedged account
            # changes order semantics under the adapter's feet.
            return False
        return symbol is None or symbol.symbol_trading is not False


def _unreadable(endpoint: str, error: Exception) -> Exception:
    """A gatherer's own classification, so the review does not have to guess."""
    return AttestationFailure(
        ReviewCode.MALFORMED_VENUE_RESPONSE,
        f"Binance futures {endpoint} response could not be read as the venue's "
        f"documented shape ({type(error).__name__}); this is an unreadable "
        "answer, not a denial",
    )


# Re-export so a futures wiring imports one module for the whole surface.
__all__ += ["SymbolRegistry", "symbol_facts_from_market"]
