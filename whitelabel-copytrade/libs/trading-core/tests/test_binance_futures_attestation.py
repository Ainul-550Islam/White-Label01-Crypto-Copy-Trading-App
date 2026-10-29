"""Batch 03 futures tests: key-permission attestation for live placements.

The property that justifies this file existing separately from the trading
tests: attestation answers a *permission* question ("may this key trade
futures here?"), and a wrong answer on it is how a copy leg reaches for
leverage with a key that cannot. Pinned behaviours:

- ``enableFutures`` is the trading-permission field - spot's
  ``enableSpotAndMarginTrading`` is never consulted for the futures licence;
- withdrawals must be off (the strictest of the two sources wins);
- an unreadable venue answer is an AttestationFailure with
  MALFORMED_VENUE_RESPONSE, not a denial the reviewer could mis-read;
- an unwired restrictions reader attests NOTHING about the key and says so in
  its source label, which the placement review's law 5 then refuses on;
- hedge (dual-side) mode disqualifies the account: the platform's futures
  mandate is one-way semantics.
"""

from __future__ import annotations

import asyncio
from decimal import Decimal
from typing import Any

import pytest

from wlct_trading.enums import ExchangeId
from wlct_trading.execution.credentials import ExchangeCredentials, StaticCredentialProvider
from wlct_trading.execution.placement_attestor import (
    AttestationFailure,
    PlacementReviewRequest,
)
from wlct_trading.execution.placement_review import ReviewCode
from wlct_trading.execution.timesync import ExchangeClock
from wlct_trading.exchanges.binance_futures.attestation import (
    BINANCE_FUTURES_REVIEW_SOURCE,
    BinanceFuturesPlacementAttestor,
    futures_key_evidence_from_restrictions,
)
from wlct_trading.exchanges.binance_futures.capabilities import (
    BINANCE_FUTURES_TESTNET_REST_BASE,
)
from wlct_trading.exchanges.binance_futures.trading import (
    BinanceFuturesTradingAdapter,
    FuturesTradingParams,
)

TENANT = "tenant-attest"
ACCOUNT = "acct-attest"


def _attestor(
    *,
    restrictions: dict[str, object] | None = None,
    account: dict[str, Any] | None = None,
    restrictions_reader=None,
    raise_on_read: Exception | None = None,
) -> BinanceFuturesPlacementAttestor:
    """A REAL trading adapter (sender unused: attest() reads only its clock
    and recv-window properties), with the evidence readers injected."""

    async def send(request, timeout_ms):  # pragma: no cover - must never fire
        raise AssertionError("attestation must not transmit through the trading adapter")

    async def server_time() -> int:
        raise AssertionError("seeded clock only")

    clock = ExchangeClock(server_time)
    clock.seed(offset_millis=0)
    adapter = BinanceFuturesTradingAdapter(
        params=FuturesTradingParams(
            send=send,
            rest_base=BINANCE_FUTURES_TESTNET_REST_BASE,
            rate_limits=__import__(
                "wlct_trading.exchanges.binance_futures.adapter", fromlist=["build_futures_registry"]
            ).build_futures_registry(),
        ),
        credentials=StaticCredentialProvider(
            [
                ExchangeCredentials(
                    exchange=ExchangeId.BINANCE,
                    tenant_id=TENANT,
                    account_id=ACCOUNT,
                    api_key="attest" + "key" + "000000000000000" + "proof",
                    api_secret="attest" + "secret" + "000000000000000" + "proof",
                )
            ]
        ),
        clock=clock,
    )

    if raise_on_read is not None:

        async def failing_reader(tenant_id: str, account_id: str):
            raise raise_on_read

    else:

        async def reader(tenant_id: str, account_id: str):
            return restrictions if restrictions is not None else {}

    class AccountReader:
        async def fetch_account(self, tenant_id: str, account_id: str):
            return account

    return BinanceFuturesPlacementAttestor(
        adapter=adapter,
        restrictions_reader=(
            failing_reader if raise_on_read is not None else (restrictions_reader or reader)
        ),
        account_reader=None if account is None else AccountReader(),
    )


def _request() -> PlacementReviewRequest:
    return PlacementReviewRequest(
        tenant_id=TENANT,
        account_id=ACCOUNT,
        symbol="BTCUSDT",
        order_type="LIMIT",
        time_in_force="GTC",
    )


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


class TestRestrictionsMapping:
    def test_enable_futures_is_the_trading_licence(self) -> None:
        ev = futures_key_evidence_from_restrictions(
            {
                "enableFutures": True,
                "enableWithdrawals": False,
                "enableReading": True,
                "ipRestrict": True,
                "createTime": 1_600_000_000_000,
                # A SPOT trading flag, deliberately present and true: the
                # futures review must be proven not to read it as a licence.
                "enableSpotAndMarginTrading": True,
            }
        )
        assert ev.futures_trading_permitted is True
        assert ev.withdrawals_permitted is False
        assert ev.reading_permitted is True
        assert ev.ip_allowlist_enabled is True
        assert ev.created_at_millis == 1_600_000_000_000

    def test_spot_key_without_futures_is_not_future_licenced(self) -> None:
        # A spot-only key never enables futures: enableFutures absent.
        ev = futures_key_evidence_from_restrictions(
            {
                "enableSpotAndMarginTrading": True,
                "enableReading": True,
                "enableWithdrawals": False,
                "ipRestrict": True,
            }
        )
        assert ev.futures_trading_permitted is None

    def test_absent_fields_are_none_not_false(self) -> None:
        ev = futures_key_evidence_from_restrictions({})
        assert ev.futures_trading_permitted is None
        assert ev.withdrawals_permitted is None


class TestAttestorComposition:
    def test_source_names_every_wired_reader(self) -> None:
        attestor = _attestor(
            restrictions={"enableFutures": True, "enableWithdrawals": False},
            account={"can_trade": True, "can_withdraw": False, "dual_side_position": False},
        )
        assert attestor.source == BINANCE_FUTURES_REVIEW_SOURCE + "+accountV2"

    def test_unwired_reader_says_so_in_its_source(self) -> None:
        async def noop(tenant_id: str, account_id: str):
            return {}

        # restrictions_reader=None by construction
        attestor = BinanceFuturesPlacementAttestor(
            adapter=_attestor()._adapter,
            restrictions_reader=None,
        )
        assert attestor.source.endswith(":unwired")

    def test_full_attestation_answers_every_question(self) -> None:
        attestor = _attestor(
            restrictions={
                "enableFutures": True,
                "enableWithdrawals": False,
                "enableReading": True,
                "ipRestrict": True,
                "createTime": 1_600_000_000_000,
            },
            account={
                "can_trade": True,
                "can_withdraw": False,
                "dual_side_position": "false",
            },
        )
        attestation = run(attestor.attest(_request()))
        facts = attestation.facts
        assert facts.key_permission_granted is True
        assert facts.withdrawal_permitted is False
        assert facts.no_known_withdrawal_path is True
        assert facts.account_can_trade is True
        assert facts.account_type == "FUTURES_ONEWAY"
        assert facts.venue_trading_permitted is True

    def test_hedge_mode_accounts_disqualify(self) -> None:
        attestor = _attestor(
            restrictions={"enableFutures": True, "enableWithdrawals": False},
            account={"can_trade": True, "can_withdraw": False, "dual_side_position": True},
        )
        facts = run(attestor.attest(_request())).facts
        assert facts.account_type == "FUTURES_HEDGE"
        assert facts.venue_trading_permitted is False

    def test_no_futures_permission_is_a_negative_answer_not_a_failure(self) -> None:
        attestor = _attestor(
            restrictions={"enableFutures": False, "enableWithdrawals": False},
            account={"can_trade": True, "can_withdraw": False},
        )
        facts = run(attestor.attest(_request())).facts
        assert facts.key_permission_granted is False
        assert facts.venue_trading_permitted is False

    def test_account_cannot_trade_blocks(self) -> None:
        attestor = _attestor(
            restrictions={"enableFutures": True, "enableWithdrawals": False},
            account={"can_trade": False, "can_withdraw": False},
        )
        facts = run(attestor.attest(_request())).facts
        assert facts.venue_trading_permitted is False

    def test_unreadable_restrictions_fail_the_gather_not_the_review(self) -> None:
        from wlct_trading.exchanges.binance_futures.parsers import FuturesParseError

        attestor = _attestor(raise_on_read=FuturesParseError("schema drifted"))
        with pytest.raises(AttestationFailure) as excinfo:
            run(attestor.attest(_request()))
        assert excinfo.value.code is ReviewCode.MALFORMED_VENUE_RESPONSE
        assert "apiRestrictions" in str(excinfo.value)

    def test_withdrawal_on_either_source_is_on(self) -> None:
        # Key says withdrawals off, account says canWithdraw on: the strictest
        # reading forbids live placement.
        attestor = _attestor(
            restrictions={"enableFutures": True, "enableWithdrawals": False},
            account={"can_trade": True, "can_withdraw": True},
        )
        facts = run(attestor.attest(_request())).facts
        assert facts.withdrawal_permitted is True
        assert facts.no_known_withdrawal_path is False
