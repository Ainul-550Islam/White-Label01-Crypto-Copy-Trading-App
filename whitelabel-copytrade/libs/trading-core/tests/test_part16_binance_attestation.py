"""Part 16 venue tests: the Binance placement gatherer.

Two layers are asserted here, and the split is the point. The pure readers
(``key_evidence_from_restrictions``, ``exchange_info_symbol_facts``, ...) are
tested against payloads copied from Binance's documented responses, because a
misread field is a wrong answer to a permission question. The gatherer itself is
tested against the REAL signed client with a fake transport, because the property
that matters there is not parsing but provenance: the review must ride the same
adapter as the orders - same signing, same clock, same weight budget - and a test
against a hand-rolled double could not tell that from a second client that
quietly spends weight nobody accounted for.

Binance's own error messages are the reason several codes exist ("This symbol is
restricted for this account", "This account may not place or cancel orders"). The
review names the *cause*, not the message, so these tests pin the cause the
gatherer must establish for each of those refusals to be reachable locally.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest
from test_execution import credentials
from wlct_trading.adapters.base import AdapterRateLimitedError, AdapterRejectedError
from wlct_trading.execution import ExchangeClock
from wlct_trading.execution.credentials import StaticCredentialProvider
from wlct_trading.execution.placement_attestor import (
    AttestationFailure,
    PlacementReviewRequest,
    PlacementReviewer,
    SymbolEvidence,
    UnattestedPlacementAttestor,
)
from wlct_trading.execution.placement_review import (
    PlacementReviewPolicy,
    ReviewCode,
    ReviewSeverity,
)
from wlct_trading.exchanges.binance.attestation import (
    BINANCE_REVIEW_SOURCE,
    BinancePlacementAttestor,
    KeyEvidence,
    VenueAccountFlags,
    exchange_info_symbol_facts,
    key_evidence_from_restrictions,
    symbol_facts_from_market,
)
from wlct_trading.exchanges.binance.capabilities import BINANCE_REST_WEIGHTS
from wlct_trading.exchanges.binance.parsers import BinanceParseError
from wlct_trading.exchanges.binance.trading import HttpResponse, BinanceTradingAdapter

NOW = 1_700_000_000_000_000
DAY_MILLIS = 86_400_000

#: ``/sapi/v1/account/apiRestrictions``, as documented: every field a spot key
#: can be configured with, all present, all permissive except withdrawals.
FULL_RESTRICTIONS = {
    "ipRestrict": True,
    "createTime": NOW // 1_000 - 30 * DAY_MILLIS,
    "enableWithdrawals": False,
    "enableInternalTransfer": False,
    "permitsUniversalTransfer": False,
    "enableVanillaOptions": False,
    "enableReading": True,
    "enableFutures": False,
    "enableMargin": False,
    "enableSpotAndMarginTrading": True,
    "tradingAuthorityExpirationTime": 0,
}


def request(**overrides: Any) -> PlacementReviewRequest:
    base: dict[str, Any] = {
        "tenant_id": "tenant-1",
        "account_id": "account-1",
        "symbol": "BTCUSDT",
        "order_type": "LIMIT",
        "time_in_force": "GTC",
    }
    base.update(overrides)
    return PlacementReviewRequest(**base)


class FakeAdapter:
    """Only the three members the gatherer touches, with the calls recorded.

    Deliberately not the real adapter: these tests are about the mapping from a
    venue answer to a review fact. The real client is exercised by
    :class:`TestThroughTheSignedClient`, where the fake would prove nothing.
    """

    def __init__(
        self,
        payload: Any = None,
        *,
        error: Exception | None = None,
        skew: int | None = 12,
        recv_window: int = 5_000,
    ) -> None:
        self._payload = payload
        self._error = error
        self.clock_skew_millis = skew
        self.recv_window_ms = recv_window
        self.calls: list[tuple[str, str]] = []

    async def fetch_key_restrictions(
        self, tenant_id: str, account_id: str
    ) -> Any:
        self.calls.append((tenant_id, account_id))
        if self._error is not None:
            raise self._error
        return self._payload


class FakeReader:
    def __init__(self, account: Any = None, *, error: Exception | None = None) -> None:
        self._account = account
        self._error = error
        self.calls: list[tuple[str, str]] = []

    async def fetch_account(self, tenant_id: str, account_id: str) -> Any:
        self.calls.append((tenant_id, account_id))
        if self._error is not None:
            raise self._error
        return self._account


class Account:
    """The three flags the review reads, and nothing else - like ``VenueAccount``."""

    def __init__(
        self,
        *,
        can_trade: Any = True,
        can_withdraw: Any = False,
        account_type: Any = "SPOT",
    ) -> None:
        self.can_trade = can_trade
        self.can_withdraw = can_withdraw
        self.account_type = account_type


def gather(
    payload: Any = FULL_RESTRICTIONS,
    *,
    account: Any = None,
    symbol_facts: Any = None,
    error: Exception | None = None,
) -> Any:
    gatherer = BinancePlacementAttestor(
        adapter=FakeAdapter(payload, error=error),
        account_reader=None if account is None else FakeReader(account),
        symbol_facts=symbol_facts,
        clock=lambda: NOW,
    )
    return asyncio.run(gatherer.attest(request()))


# ---------------------------------------------------------------------------
# 1. the key's own answer
# ---------------------------------------------------------------------------


class TestKeyEvidence:
    def test_a_complete_response_maps_field_by_field(self) -> None:
        evidence = key_evidence_from_restrictions(FULL_RESTRICTIONS)
        assert evidence.trading_permitted is True
        assert evidence.withdrawals_permitted is False
        assert evidence.reading_permitted is True
        assert evidence.ip_allowlist_enabled is True
        assert evidence.created_at_millis == FULL_RESTRICTIONS["createTime"]
        # ``0`` means "no expiry", NOT "expired in 1970". This single line is the
        # difference between a working deployment and one that refuses every
        # order on a perfectly good key.
        assert evidence.trading_authority_expires_at_millis is None

    def test_an_absent_field_is_unknown_rather_than_off(self) -> None:
        evidence = key_evidence_from_restrictions({"ipRestrict": True})
        assert (
            evidence.trading_permitted,
            evidence.withdrawals_permitted,
            evidence.reading_permitted,
        ) == (None, None, None)
        assert evidence.created_at_millis is None
        # ``ipRestrict`` is the one that was present, so it must not be dropped
        # into the same unknown bucket as the fields nobody sent.
        assert evidence.ip_allowlist_enabled is True

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [(True, True), (False, False), (1, True), (0, False), ("yes", None), (None, None)],
    )
    def test_a_flag_is_read_as_a_flag(self, raw: Any, expected: Any) -> None:
        evidence = key_evidence_from_restrictions({"enableWithdrawals": raw})
        assert evidence.withdrawals_permitted is expected

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            (0, None),
            (-5, None),
            ("1700000000000", 1_700_000_000_000),
            ("not a number", None),
            (True, None),
            (None, None),
        ],
    )
    def test_a_millis_field_tolerates_the_venues_quirks(self, raw: Any, expected: Any) -> None:
        # Strings because the transport decodes JSON numbers as strings to keep
        # precision; a bool because ``True`` is ``1`` in Python and must not
        # become "expired in 1970" either.
        evidence = key_evidence_from_restrictions({"tradingAuthorityExpirationTime": raw})
        # ``==`` for the numeric case: ``is`` on a 13-digit int would compare
        # identities that no interning guarantees, and a test that passes only
        # because CPython caches small integers is a test that fails elsewhere.
        if expected is None or isinstance(expected, bool):
            assert evidence.trading_authority_expires_at_millis is expected
        else:
            assert evidence.trading_authority_expires_at_millis == expected

    def test_a_non_object_answer_refuses_to_be_interpreted(self) -> None:
        for payload in ([], "ok", None, 7):
            with pytest.raises(BinanceParseError):
                key_evidence_from_restrictions(payload)

    def test_the_public_view_names_the_concepts_not_the_venue_fields(self) -> None:
        view = KeyEvidence(
            trading_permitted=True,
            withdrawals_permitted=False,
            reading_permitted=True,
            ip_allowlist_enabled=True,
            created_at_millis=1,
            trading_authority_expires_at_millis=None,
        ).to_public_dict()
        assert set(view) == {
            "tradingPermitted",
            "withdrawalsPermitted",
            "readingPermitted",
            "ipAllowlistEnabled",
            "createdAtMillis",
            "tradingAuthorityExpiresAtMillis",
        }
        # Nothing key-shaped, and the naming is the review's vocabulary so a
        # console does not have to know Binance's field spellings to render it.
        assert not any("key" in name.lower() or "secret" in name.lower() for name in view)


class TestAccountFlags:
    def test_the_projection_keeps_only_what_the_review_asks(self) -> None:
        flags = VenueAccountFlags(can_trade=False, can_withdraw=True, account_type="SPOT")
        assert (flags.can_trade, flags.can_withdraw, flags.account_type) == (
            False,
            True,
            "SPOT",
        )

    def test_a_non_boolean_answer_from_a_wrapper_is_unknown(self) -> None:
        # ``getattr``-based reading plus an isinstance gate: a cached copy that
        # stores "true" as a string must not become a permission.
        account = Account(can_trade="true", can_withdraw=None, account_type="margin")
        gatherer = BinancePlacementAttestor(
            adapter=FakeAdapter(FULL_RESTRICTIONS),
            account_reader=FakeReader(account),
            clock=lambda: NOW,
        )
        facts = asyncio.run(gatherer.attest(request())).facts
        assert facts.account_can_trade is None
        assert facts.account_type == "MARGIN"
        # The account's "cannot withdraw" does not outvote a key that is silent
        # about withdrawals - only the key can answer for the key.
        assert facts.withdrawal_permitted is False


# ---------------------------------------------------------------------------
# 2. the symbol catalog, and the two kinds of "we do not know"
# ---------------------------------------------------------------------------


class TestSymbolSources:
    def catalog(self, *entries: Any) -> dict[str, Any]:
        return {"symbols": list(entries)}

    def test_a_listed_trading_symbol_answers_for_the_shape_being_placed(self) -> None:
        lookup = exchange_info_symbol_facts(
            self.catalog(
                {
                    "symbol": "BTCUSDT",
                    "status": "TRADING",
                    "isSpotTradingAllowed": True,
                    "orderTypes": ["LIMIT", "MARKET", "LIMIT_MAKER"],
                }
            )
        )
        assert lookup("BTCUSDT") == (True, True, ("LIMIT", "MARKET", "LIMIT_MAKER"), ())
        # The venue's own symbol form, so a platform symbol needs no translation
        # at this layer.
        assert lookup("btcusdt") == lookup("BTCUSDT")

    def test_time_in_force_is_always_unanswered_because_binance_does_not_publish_it(self) -> None:
        """The empty fourth slot, and why it must stay empty.

        Spot ``exchangeInfo`` has per-symbol ``orderTypes`` and no per-symbol
        time-in-force list; a disallowed ``timeInForce`` is rejected per order with
        ``-2010``. Inventing a rule here ("LIMIT implies GTC") would let the
        review assert something the venue never said - and the audit record would
        carry that invention as a venue answer.
        """
        lookup = exchange_info_symbol_facts(
            self.catalog({"symbol": "BTCUSDT", "status": "TRADING", "orderTypes": ["LIMIT"]})
        )
        assert lookup("BTCUSDT")[3] == ()

    def test_a_halted_or_spot_disabled_symbol_is_not_trading(self) -> None:
        for entry, expected in (
            ({"symbol": "BTCUSDT", "status": "HALT"}, False),
            ({"symbol": "BTCUSDT", "status": "BREAK"}, False),
            ({"symbol": "BTCUSDT", "status": "TRADING", "isSpotTradingAllowed": False}, False),
            ({"symbol": "BTCUSDT", "status": "TRADING"}, True),
        ):
            lookup = exchange_info_symbol_facts(self.catalog(entry))
            assert lookup("BTCUSDT")[1] is expected, entry

    def test_an_unloaded_catalog_and_an_unlisted_symbol_are_different_answers(self) -> None:
        # Not loaded: no claims, so the review asserts nothing about the symbol.
        unloaded = exchange_info_symbol_facts({})
        assert unloaded("BTCUSDT") is None
        assert exchange_info_symbol_facts({"symbols": []})("BTCUSDT") is None
        # Loaded and the symbol is absent: that IS an answer, and it refuses.
        loaded = exchange_info_symbol_facts(
            self.catalog({"symbol": "ETHUSDT", "status": "TRADING"})
        )
        assert loaded("BTCUSDT") == (False, False, (), ())

    def test_garbage_entries_are_skipped_rather_than_trusted(self) -> None:
        lookup = exchange_info_symbol_facts(
            self.catalog("not-an-object", {"status": "TRADING"}, {"symbol": "  ", "status": "TRADING"})
        )
        assert lookup("BTCUSDT") is None  # nothing loaded at all

    def test_the_market_registry_answers_listed_but_not_capabilities(self) -> None:
        class Specification:
            def __init__(self, tradeable: bool) -> None:
                self.is_tradeable = tradeable

        class Market:
            def __init__(self, known: dict[str, Any]) -> None:
                self._known = known

            def specification(self, symbol: str) -> Any:
                return self._known.get(symbol)

        lookup = symbol_facts_from_market(
            Market({"BTC/USDT": Specification(True), "ETH/USDT": Specification(False)})
        )
        assert lookup("BTC/USDT") == (True, True, (), ())
        assert lookup("ETH/USDT") == (True, False, (), ())
        # An unknown instrument is "not attached", which refuses: a registry that
        # has not loaded would then refuse everything, which is loud
        # (SYMBOL_UNATTACHED) and self-limiting, versus a silent pass.
        assert lookup("DOGEUSDT") == (False, False, (), ())

    def test_a_market_object_without_a_registry_degrades_to_no_opinion(self) -> None:
        gatherer = BinancePlacementAttestor(
            adapter=FakeAdapter(FULL_RESTRICTIONS),
            symbol_facts=symbol_facts_from_market(object()),
            clock=lambda: NOW,
        )
        facts = asyncio.run(gatherer.attest(request())).facts
        assert (facts.symbol_attached, facts.symbol_trading) == (None, None)
        # Still venue-backed: the key's own answer came from the venue, and the
        # review's law 5 needs that distinction to decide what the silence means.
        assert facts.venue_backed is True


# ---------------------------------------------------------------------------
# 3. the gatherer
# ---------------------------------------------------------------------------


class TestGatherer:
    def test_the_source_label_names_only_what_was_consulted(self) -> None:
        assert BINANCE_REVIEW_SOURCE == "binance:apiRestrictions"
        bare = BinancePlacementAttestor(adapter=FakeAdapter(FULL_RESTRICTIONS))
        assert bare.source == "binance:apiRestrictions"
        both = BinancePlacementAttestor(
            adapter=FakeAdapter(FULL_RESTRICTIONS),
            account_reader=FakeReader(Account()),
            symbol_facts=lambda symbol: (True, True, ("LIMIT",), ()),
        )
        assert both.source == "binance:apiRestrictions+account+exchangeInfo"
        # The audit record claims provenance; a label that named an endpoint this
        # deployment never wired would be a false statement in a durable record.
        assert "account" not in bare.source

    def test_a_permissive_key_still_reports_the_withdrawal_cap(self) -> None:
        facts = gather().facts
        assert facts.venue_backed is True
        assert facts.key_permission_granted is True
        assert facts.withdrawal_permitted is False
        assert facts.no_known_withdrawal_path is True
        assert facts.ip_allowlist_enabled is True
        assert facts.account_can_trade is None
        assert facts.clock_skew_millis == 12
        assert facts.recv_window_millis == 5_000
        assert facts.review_required_at_micros == NOW
        assert facts.key_created_at_millis == FULL_RESTRICTIONS["createTime"]

    def test_the_review_it_produces_passes(self) -> None:
        adapter = FakeAdapter(FULL_RESTRICTIONS)
        gatherer = BinancePlacementAttestor(
            adapter=adapter,
            account_reader=FakeReader(Account()),
            symbol_facts=lambda symbol: (True, True, ("LIMIT", "MARKET"), ()),
            clock=lambda: NOW,
        )
        reviewer = PlacementReviewer(
            gatherer, PlacementReviewPolicy(), requires_venue_attestation=True, clock=lambda: NOW
        )
        attestation, verdict = asyncio.run(reviewer.review(request()))
        assert verdict.allowed is True, verdict.summary
        assert verdict.venue_backed is True
        # Exactly one authenticated call per review, no fan-out. Every weight
        # figure a review spends is weight an order could have used, so the
        # gatherer must not ask the same endpoint twice to be "sure".
        assert adapter.calls == [("tenant-1", "account-1")]

    def test_a_withdrawal_capable_key_is_refused_from_the_venue_answer_alone(self) -> None:
        facts = gather({**FULL_RESTRICTIONS, "enableWithdrawals": True}).facts
        assert facts.withdrawal_permitted is True
        assert facts.no_known_withdrawal_path is False
        # The gatherer and the reviewer must be told to agree on the moment, or
        # the fixture is a time machine rather than a test.
        venue_says_yes_but_withdraws = BinancePlacementAttestor(
            adapter=FakeAdapter({**FULL_RESTRICTIONS, "enableWithdrawals": True}),
            clock=lambda: NOW,
        )
        reviewer = PlacementReviewer(
            venue_says_yes_but_withdraws,
            PlacementReviewPolicy(),
            requires_venue_attestation=True,
            clock=lambda: NOW,
        )
        _, review_verdict = asyncio.run(reviewer.review(request()))
        assert review_verdict.allowed is False
        assert review_verdict.codes == ("WITHDRAW_ENABLED",)
        assert review_verdict.retryable is False

    def test_the_account_switch_can_veto_a_key_that_may_trade(self) -> None:
        allowed = gather(FULL_RESTRICTIONS, account=Account(can_trade=True))
        refused = gather(FULL_RESTRICTIONS, account=Account(can_trade=False))
        assert allowed.facts.venue_trading_permitted is True
        assert refused.facts.venue_trading_permitted is False
        # Not a claim, and therefore the review's own note rather than a lie in
        # the audit payload.
        assert refused.facts.account_can_trade is False
        assert gather(FULL_RESTRICTIONS, account=Account(account_type="MARGIN")).facts.account_type == "MARGIN"

    def test_withdrawals_are_answered_by_the_strictest_source(self) -> None:
        for key_answer, account_answer, expected in (
            (True, False, True),
            (False, True, True),
            (False, False, False),
            (None, True, True),
            (None, False, None),
            (True, None, True),
            (None, None, None),
        ):
            evidence = KeyEvidence(
                trading_permitted=True,
                withdrawals_permitted=key_answer,
                reading_permitted=True,
                ip_allowlist_enabled=True,
                created_at_millis=NOW // 1_000,
                trading_authority_expires_at_millis=None,
            )
            flags = (
                None
                if account_answer is None
                else VenueAccountFlags(
                    can_trade=True, can_withdraw=account_answer, account_type="SPOT"
                )
            )
            assert (
                BinancePlacementAttestor._strictest_withdrawal_answer(evidence, flags)
                is expected
            ), (key_answer, account_answer)

    def test_trading_is_established_only_by_the_conjunction_that_was_checked(self) -> None:
        key_yes = KeyEvidence(
            trading_permitted=True,
            withdrawals_permitted=False,
            reading_permitted=True,
            ip_allowlist_enabled=True,
            created_at_millis=None,
            trading_authority_expires_at_millis=None,
        )
        key_no = KeyEvidence(
            trading_permitted=False,
            withdrawals_permitted=False,
            reading_permitted=True,
            ip_allowlist_enabled=True,
            created_at_millis=None,
            trading_authority_expires_at_millis=None,
        )
        open_account = VenueAccountFlags(can_trade=True, can_withdraw=False, account_type="SPOT")
        halted_account = VenueAccountFlags(can_trade=False, can_withdraw=False, account_type="SPOT")
        listed = SymbolEvidence(
            symbol_attached=True,
            symbol_trading=True,
            order_type_supported=True,
            time_in_force_supported=None,
        )
        halted_symbol = SymbolEvidence(
            symbol_attached=True,
            symbol_trading=False,
            order_type_supported=True,
            time_in_force_supported=None,
        )
        established = BinancePlacementAttestor._trading_established
        assert established(key_yes, open_account, listed) is True
        # Each veto alone is enough, and an unconsulted source is not a veto - it
        # is a missing half of the conjunction, which the review reads as "not
        # asserted" via the venue_backed flag rather than as a permission.
        assert established(key_no, open_account, listed) is False
        assert established(key_yes, halted_account, listed) is False
        assert established(key_yes, open_account, halted_symbol) is False
        assert established(key_yes, None, None) is True
        assert established(key_yes, open_account, None) is True

    def test_an_unreadable_answer_is_reported_as_unreadable_not_as_a_refusal(self) -> None:
        """The code decides who gets paged, so the gatherer must not guess.

        ``ATTESTATION_REFUSED_BY_VENUE`` means "an operator must change a key" and
        is not retryable; ``MALFORMED_VENUE_RESPONSE`` means "we could not read the
        answer" and is. A truncated body mapped to the first would page a
        security on-call for a JSON problem.
        """
        gatherer = BinancePlacementAttestor(
            adapter=FakeAdapter(
                None, error=BinanceParseError("truncated body")
            ),
            clock=lambda: NOW,
        )
        with pytest.raises(AttestationFailure) as caught:
            asyncio.run(gatherer.attest(request()))
        assert caught.value.code is ReviewCode.MALFORMED_VENUE_RESPONSE
        assert "apiRestrictions" in caught.value.detail

        reviewer = PlacementReviewer(
            gatherer, PlacementReviewPolicy(), requires_venue_attestation=True
        )
        _, verdict = asyncio.run(reviewer.review(request()))
        assert verdict.allowed is False
        assert verdict.findings[0].code is ReviewCode.MALFORMED_VENUE_RESPONSE
        assert verdict.retryable is True

    def test_an_account_read_that_cannot_be_parsed_also_degrades_to_unreadable(self) -> None:
        gatherer = BinancePlacementAttestor(
            adapter=FakeAdapter(FULL_RESTRICTIONS),
            account_reader=FakeReader(
                None, error=BinanceParseError("account body missing")
            ),
            clock=lambda: NOW,
        )
        with pytest.raises(AttestationFailure) as caught:
            asyncio.run(gatherer.attest(request()))
        assert "account" in caught.value.detail

    def test_a_symbol_catalog_that_throws_is_not_a_refusal(self) -> None:
        def explode(symbol: str) -> Any:
            raise RuntimeError("registry lock timed out")

        facts = gather(FULL_RESTRICTIONS, symbol_facts=explode).facts
        assert (facts.symbol_attached, facts.symbol_trading) == (None, None)
        assert facts.venue_backed is True
        assert facts.key_permission_granted is True

    def test_the_gatherer_has_no_opinion_about_retryability(self) -> None:
        """It answers questions; it does not classify its own failures as safe.

        ``UnattestedPlacementAttestor`` and this class are the two ends of the
        wiring spectrum, and both must leave the severity decision to the law -
        otherwise a gatherer could authorise its own outage by returning facts it
        never received.
        """
        unattested = asyncio.run(UnattestedPlacementAttestor().attest(request()))
        assert unattested.collection_code is ReviewCode.NO_ATTESTATION
        assert unattested.facts.venue_backed is False
        reviewer = PlacementReviewer(
            UnattestedPlacementAttestor(),
            PlacementReviewPolicy(),
            requires_venue_attestation=True,
        )
        _, verdict = asyncio.run(reviewer.review(request()))
        assert verdict.allowed is False
        assert verdict.findings[0].severity is ReviewSeverity.BLOCKING


class TestPackageSurface:
    """The venue package's export rule, pinned so it stays a rule.

    A name is exported when a deployment needs it to CONFIGURE this venue, and
    stays module-path-local when importing it from the package root would drag
    the transport vocabulary along. The gatherer and its evidence types are
    therefore public; ``SignedRequestSender``, ``ExchangeClock``,
    ``RateLimitRegistry`` and ``HttpResponse`` are not - a venue-agnostic
    component that imported them from ``exchanges.binance`` would acquire a
    Binance dependency without anyone noticing in review, which is the same
    failure the review itself exists to make impossible for an order.
    """

    def test_the_gatherer_is_reachable_from_the_package_root(self) -> None:
        import wlct_trading.exchanges.binance as pkg
        from wlct_trading.exchanges.binance import attestation as module

        for name in module.__all__:
            assert getattr(pkg, name) is getattr(module, name), name
        assert set(module.__all__) <= set(pkg.__all__)

    def test_the_export_list_is_sorted_and_holds_no_transport_type(self) -> None:
        import wlct_trading.exchanges.binance as pkg

        assert pkg.__all__ == sorted(pkg.__all__)
        for leaked in (
            "SignedRequestSender",
            "ExchangeClock",
            "RateLimitRegistry",
            "HttpResponse",
            "BinanceTradingAdapter",
        ):
            assert not hasattr(pkg, leaked), leaked

    def test_everything_the_module_defines_is_declared(self) -> None:
        """``__all__`` must be the whole surface, not a subset of it.

        Asserted structurally - by asking which public names the module itself
        defines - rather than against a written-out list, because the failure this
        catches is a name that exists and is NOT declared: ``AccountFlagReader``
        was exactly that, a protocol every deployment implementing an account
        reader has to satisfy, reachable only by reaching into the module. An
        allow-list test would have been updated to match; this one cannot be.
        """
        from wlct_trading.exchanges.binance import attestation as module

        own = {
            name
            for name, value in vars(module).items()
            if not name.startswith("_")
            and getattr(value, "__module__", None) == module.__name__
        }
        # ``BINANCE_REVIEW_SOURCE`` is a string constant and carries no __module__.
        assert set(module.__all__) == own | {"BINANCE_REVIEW_SOURCE"}

# ---------------------------------------------------------------------------
# 4. the real signed client: one adapter, one budget
# ---------------------------------------------------------------------------


class TestThroughTheSignedClient:
    @staticmethod
    def _adapter(responses: list[HttpResponse]) -> tuple[BinanceTradingAdapter, list[Any]]:
        sent: list[Any] = []

        async def send(request: Any, timeout_ms: int) -> HttpResponse:
            # Answers by position, then repeats the last one: a review is read
            # twice in some tests (once by the gatherer, once by the reviewer),
            # and a transport that consumes its script turns the second call into
            # an IndexError that the client reports as a connection failure - a
            # fake that invents an outage is how a suite lies.
            sent.append(request)
            return responses[min(len(sent) - 1, len(responses) - 1)]

        clock = ExchangeClock(lambda: asyncio.sleep(0, result=0))
        clock.seed(offset_millis=0)
        adapter = BinanceTradingAdapter(
            send=send,
            credentials=StaticCredentialProvider([credentials()]),
            clock=clock,
            testnet=True,
        )
        return (adapter, sent)

    def test_the_review_shares_the_adapters_signing_and_weight_table(self) -> None:
        body = json.dumps({key: value for key, value in FULL_RESTRICTIONS.items()})
        adapter, sent = self._adapter([HttpResponse(status=200, headers={}, body=body)])
        gatherer = BinancePlacementAttestor(adapter=adapter, clock=lambda: NOW)
        facts = asyncio.run(gatherer.attest(request())).facts

        assert facts.key_permission_granted is True
        assert facts.withdrawal_permitted is False
        assert facts.venue_backed is True
        assert len(sent) == 1
        request_record = sent[0]
        assert request_record.method == "GET"
        assert request_record.url.endswith("/sapi/v1/account/apiRestrictions")
        # Signed and authenticated like an order request, because it IS one
        # adapter's request: a separate client here would be a second place keys
        # are used and a second budget to audit.
        assert "signature=" in request_record.query
        assert request_record.headers["X-MBX-APIKEY"] == credentials().api_key
        # The weight is declared, not improvised: an unweighted SAPI call is how a
        # deployment gets 429s on the order path it was trying to protect.
        assert BINANCE_REST_WEIGHTS["api_restrictions"] == 1

    def test_two_reviews_are_two_calls_because_the_gatherer_caches_nothing(self) -> None:
        """Deduplication belongs to the cache wrapper, and nowhere else.

        A gatherer with a private cache would make the TTL a secret of this
        module: ``/status`` could not report it, the service could not tune it,
        and two runtimes with different views of freshness would disagree about
        the same order. One call per review is the design, stated where a reader
        can see it.
        """
        body = json.dumps(FULL_RESTRICTIONS)
        adapter, sent = self._adapter(
            [
                HttpResponse(status=200, headers={}, body=body),
                HttpResponse(status=200, headers={}, body=body),
            ]
        )
        gatherer = BinancePlacementAttestor(adapter=adapter, clock=lambda: NOW)
        first = asyncio.run(gatherer.attest(request()))
        second = asyncio.run(gatherer.attest(request()))
        assert len(sent) == 2
        assert first.facts.review_required_at_micros == second.facts.review_required_at_micros
        # The method is GET on a read endpoint: a review must never be able to
        # mutate anything at the venue, whatever the caller asks it to check.
        assert {record.method for record in sent} == {"GET"}

    def test_a_refusal_from_the_venue_reaches_the_review_as_a_refusal(self) -> None:
        refused = ReviewCode.ATTESTATION_REFUSED_BY_VENUE
        for status, code in ((401, refused), (403, refused)):
            adapter, _ = self._adapter(
                [
                    HttpResponse(
                        status=status,
                        headers={},
                        body=json.dumps(
                            {
                                "code": -2015,
                                "msg": "Invalid API-key, IP, or permissions",
                            }
                        ),
                    )
                ]
            )
            gatherer = BinancePlacementAttestor(adapter=adapter, clock=lambda: NOW)
            reviewer = PlacementReviewer(
                gatherer, PlacementReviewPolicy(), requires_venue_attestation=True
            )
            with pytest.raises(AdapterRejectedError):
                asyncio.run(gatherer.attest(request()))
            _, verdict = asyncio.run(reviewer.review(request()))
            assert verdict.allowed is False
            assert verdict.findings[0].code is code
            assert verdict.retryable is False

    def test_rate_limiting_blocks_the_order_and_asks_for_a_retry(self) -> None:
        adapter, _ = self._adapter(
            [HttpResponse(status=429, headers={}, body=json.dumps({"code": -1003, "msg": "Too many requests"}))]
        )
        gatherer = BinancePlacementAttestor(adapter=adapter, clock=lambda: NOW)
        reviewer = PlacementReviewer(
            gatherer, PlacementReviewPolicy(), requires_venue_attestation=True
        )
        with pytest.raises(AdapterRateLimitedError):
            asyncio.run(gatherer.attest(request()))
        _, verdict = asyncio.run(reviewer.review(request()))
        # Blocking AND retryable: the order is refused, and the worker may try
        # again - the pair the review exists to make legal for a transport
        # failure and illegal for an entitlement one.
        assert verdict.allowed is False
        assert verdict.findings[0].code is ReviewCode.ATTESTATION_RATE_LIMITED
        assert verdict.retryable is True

    def test_a_body_that_is_not_the_documented_shape_is_not_a_permission(self) -> None:
        adapter, _ = self._adapter(
            [HttpResponse(status=200, headers={}, body=json.dumps([{"unexpected": True}]))]
        )
        gatherer = BinancePlacementAttestor(adapter=adapter, clock=lambda: NOW)
        with pytest.raises(AttestationFailure) as caught:
            asyncio.run(gatherer.attest(request()))
        assert caught.value.code is ReviewCode.MALFORMED_VENUE_RESPONSE
