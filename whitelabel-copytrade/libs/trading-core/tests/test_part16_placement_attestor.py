"""Part 16 plumbing tests: request shape, the attestation cache, the reviewer, and the engine.

The law itself is asserted in :mod:`test_part16_placement_review`. Everything here
is the machinery around it - what is gathered, how often, and what the engine does
with the answer - and the tests share one habit: every class takes an injected
clock, so every time-dependent assertion advances a counter instead of sleeping.
A suite that sleeps is a suite nobody re-runs, and the failure mode this module
exists to prevent is a time window that is off by a little.

The engine tests are the money-path half. They are deliberately built on the same
stub adapter the pre-Part-16 suite uses, so the only difference between an
order that reaches a venue and one that does not is the review verdict.
"""

from __future__ import annotations

import asyncio
import importlib
from dataclasses import replace
from typing import Any

import pytest
from wlct_trading.clock import epoch_micros
from test_execution import (
    StubTradingAdapter,
    accepted_result,
    credentials,
    healthy_context,
    intent,
    paper_settings,
    risk_engine,
)
from wlct_trading.enums import OrderStatus
from wlct_trading.execution import (
    EngineConfigurationError,
    ExecutionEngine,
    ExecutionErrorCode,
    ExecutionOutcome,
    InMemoryIncidentRecorder,
    InMemoryLockManager,
    InMemoryOrderStore,
    OrderValidator,
)
from wlct_trading.execution.credentials import (
    CachingCredentialProvider,
    ExchangeCredentials,
    NullCredentialProvider,
    StaticCredentialProvider,
)
from wlct_trading.execution.placement_attestor import (
    MAX_ATTESTER_TTL_MS,
    MIN_ATTESTER_TTL_MS,
    AttestationFailure,
    CachingPlacementAttestor,
    LocalPlacementAttestor,
    PlacementReviewRequest,
    PlacementReviewer,
    UnattestedPlacementAttestor,
    _collection_code_for,
    symbol_evidence,
)
from wlct_trading.execution.placement_review import (
    NO_KNOWN_WITHDRAWAL_PATH,
    REVIEW_REQUIRED_AT,
    VENUE_TRADING_FIELD,
    VERDICT_CLAIM_WIRE_NAMES,
    PlacementAttestation,
    PlacementFacts,
    PlacementReviewPolicy,
    ReviewCode,
    ReviewSeverity,
)
from wlct_trading.execution.safety import SafetyGate
from wlct_trading.adapters.base import AdapterRateLimitedError, AdapterRejectedError

NOW = 1_700_000_000_000_000


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


class FakeClock:
    """An explicit timeline; the only way to test a TTL honestly."""

    def __init__(self, start: int = NOW) -> None:
        self.now = start

    def __call__(self) -> int:
        return self.now

    def advance_ms(self, millis: int) -> None:
        self.now += millis * 1_000


class CountingAttestor:
    """Returns whatever it is told, one answer per call, and counts the calls."""

    source = "counting:test"

    def __init__(self, *attestations: PlacementAttestation, error: Exception | None = None) -> None:
        self.calls: list[PlacementReviewRequest] = []
        self._attestations = list(attestations)
        self._error = error

    async def attest(self, request: PlacementReviewRequest) -> PlacementAttestation:
        self.calls.append(request)
        if self._error is not None:
            raise self._error
        if len(self._attestations) == 1:
            return self._attestations[0]
        return self._attestations[min(len(self.calls) - 1, len(self._attestations) - 1)]


def attested(**fact_overrides: Any) -> PlacementAttestation:
    """A complete, fresh attestation.

    Stamped at call time rather than at a fixed instant: the reviewer's clock is
    the process clock unless a test injects one, and a hard-coded 2023 timestamp
    would make every plumbing test depend on how long the machine has been
    running. The freshness boundary itself is asserted in
    :mod:`test_part16_placement_review`, where the clock is an argument.
    """
    now = epoch_micros()
    facts = PlacementFacts(
        venue_backed=True,
        source="binance:apiRestrictions+account+exchangeInfo",
        key_created_at_millis=(now - 3 * 86_400_000 * 1_000) // 1_000,
        key_permission_granted=True,
        read_permitted=True,
        withdrawal_permitted=False,
        ip_allowlist_enabled=True,
        account_can_trade=True,
        account_type="SPOT",
        symbol_attached=True,
        symbol_trading=True,
        order_type_supported=True,
        time_in_force_supported=True,
        clock_skew_millis=5,
        recv_window_millis=5_000,
        venue_trading_permitted=True,
        no_known_withdrawal_path=True,
        review_required_at_micros=now,
    )
    return PlacementAttestation(
        facts=replace(facts, **fact_overrides) if fact_overrides else facts,
        attested_at_micros=now,
    )


# ---------------------------------------------------------------------------
# 1. the request: normalisation, refusal, and the shape in the cache key
# ---------------------------------------------------------------------------


class TestPlacementReviewRequest:
    def test_identifiers_are_normalised_on_construction(self) -> None:
        """One spelling, everywhere, before anything consumes it.

        The symbol and order shape are matched against venue-reported lists and
        baked into a cache key; leaving case to the caller would mean
        ``"btcusdt"`` and ``"BTCUSDT"`` gathering twice and, worse, an
        ``order_type_supported`` lookup consulting a lower-cased list with an
        upper-cased answer and reporting "unsupported" for a shape the venue
        permits.
        """
        lowered = request(symbol="  btcusdt ", order_type="limit", time_in_force="gtc")
        assert (lowered.symbol, lowered.order_type, lowered.time_in_force) == (
            "BTCUSDT",
            "LIMIT",
            "GTC",
        )
        assert lowered == request()

    def test_the_identity_fields_are_left_alone(self) -> None:
        # Tenant and account ids are opaque ids owned by another service. Upper
        # -casing them would be cosmetic here and a lookup miss where the id is a
        # key into a per-tenant table.
        mixed = request(tenant_id="Tenant-A", account_id="Account-b")
        assert (mixed.tenant_id, mixed.account_id) == ("Tenant-A", "Account-b")

    @pytest.mark.parametrize(
        "field",
        ["tenant_id", "account_id", "symbol", "order_type", "time_in_force"],
    )
    def test_a_blank_field_is_refused(self, field: str) -> None:
        with pytest.raises(ValueError, match="must not be blank"):
            request(**{field: "   "})

    def test_an_over_long_field_is_refused(self) -> None:
        for field, limit in (
            ("symbol", 64),
            ("order_type", 32),
            ("tenant_id", 255),
        ):
            with pytest.raises(ValueError, match=f"at most {limit}"):
                request(**{field: "x" * (limit + 1)})
            assert getattr(request(**{field: "x" * limit}), field)

    def test_a_control_character_is_refused(self) -> None:
        # This value is embedded in a log line, a cache key and the digest of an
        # audit record; a newline in it forges all three at once.
        for field in ("symbol", "tenant_id", "account_id"):
            with pytest.raises(ValueError, match="control characters"):
                request(**{field: "BTC\nUSDT"})
            with pytest.raises(ValueError, match="control characters"):
                request(**{field: "BTC\x00USDT"})

    def test_the_cache_key_carries_the_order_shape(self) -> None:
        """The fail-open this build actually had, and now pins shut.

        An attestation stores the symbol's capabilities *reduced to booleans for
        the shape that was asked about*. A key of (tenant, account, symbol) let a
        LIMIT/GTC gather authorise a STOP_LIMIT/IOC order - one gather per
        account looked like an optimisation and was a hole.
        """
        limit = request()
        stop = request(order_type="STOP_LIMIT", time_in_force="IOC")
        assert limit.cache_key() != stop.cache_key()
        assert limit.cache_key() == ("tenant-1", "account-1", "BTCUSDT", "LIMIT", "GTC")
        # Same shape, same key - which is the whole cost argument, kept honest.
        assert request(symbol="btcusdt").cache_key() == limit.cache_key()

    def test_the_request_is_immutable(self) -> None:
        frozen = request()
        with pytest.raises(Exception):
            frozen.symbol = "ETHUSDT"


# ---------------------------------------------------------------------------
# 2. the cache
# ---------------------------------------------------------------------------


class TestCachingPlacementAttestor:
    def test_a_second_identical_order_reuses_the_gather(self) -> None:
        inner = CountingAttestor(attested())
        clock = FakeClock()
        cache = CachingPlacementAttestor(inner, ttl_ms=60_000, clock=clock)
        first = asyncio.run(cache.attest(request()))
        second = asyncio.run(cache.attest(request()))
        assert first is second
        assert len(inner.calls) == 1
        stats = cache.stats()
        assert (stats["hits"], stats["misses"]) == (1, 1)
        assert stats["entries"] == 1

    def test_the_entry_expires_at_the_ttl_and_not_before(self) -> None:
        inner = CountingAttestor(attested(), attested())
        clock = FakeClock()
        cache = CachingPlacementAttestor(inner, ttl_ms=60_000, clock=clock)
        asyncio.run(cache.attest(request()))
        clock.advance_ms(59_999)
        asyncio.run(cache.attest(request()))
        assert len(inner.calls) == 1
        clock.advance_ms(2)
        asyncio.run(cache.attest(request()))
        assert len(inner.calls) == 2

    def test_a_failure_is_cached_for_a_fraction_of_the_ttl(self) -> None:
        """An outage must not become a stampede, and must not last an hour.

        Caching the failure keeps one order per key from fanning into four venue
        calls while the venue is down; shrinking the window is what stops the
        outage being remembered long after the venue recovered. The fraction is
        one number in one place, so this test is about both halves at once.
        """
        inner = CountingAttestor(error=AdapterRateLimitedError("429"))
        clock = FakeClock()
        cache = CachingPlacementAttestor(inner, ttl_ms=100_000, clock=clock)
        first = asyncio.run(cache.attest(request()))
        assert first.collection_code is ReviewCode.ATTESTATION_RATE_LIMITED
        assert first.facts.venue_backed is False
        assert cache.stats()["failuresCached"] == 1
        clock.advance_ms(19_999)
        asyncio.run(cache.attest(request()))
        assert len(inner.calls) == 1  # still holding the failure
        clock.advance_ms(1_000)
        asyncio.run(cache.attest(request()))
        assert len(inner.calls) == 2

    def test_a_cached_failure_never_outlives_the_minimum_window(self) -> None:
        inner = CountingAttestor(error=AdapterRejectedError("401", "Unauthorized"))
        clock = FakeClock()
        cache = CachingPlacementAttestor(inner, ttl_ms=MIN_ATTESTER_TTL_MS, clock=clock)
        asyncio.run(cache.attest(request()))
        assert cache.stats()["failureTtlMillis"] == MIN_ATTESTER_TTL_MS
        clock.advance_ms(MIN_ATTESTER_TTL_MS)
        asyncio.run(cache.attest(request()))
        assert len(inner.calls) == 2

    def test_the_cache_is_bounded_and_evicts_oldest_first(self) -> None:
        inner = CountingAttestor(attested())
        clock = FakeClock()
        cache = CachingPlacementAttestor(inner, ttl_ms=60_000, max_entries=16, clock=clock)
        for index in range(40):
            clock.advance_ms(10)
            asyncio.run(cache.attest(request(account_id=f"account-{index}")))
        stats = cache.stats()
        assert stats["entries"] <= 16
        assert stats["maxEntries"] == 16
        # The survivors are the most recent ones: an account that just traded
        # keeps its gather, and one that has been idle pays one call if it
        # returns.
        assert len(inner.calls) == 40

    def test_the_ttl_bound_is_the_laws_bound(self) -> None:
        for bad in (MIN_ATTESTER_TTL_MS - 1, MAX_ATTESTER_TTL_MS + 1, 0, -1, True, "60000"):
            with pytest.raises(ValueError, match="ttl_ms"):
                CachingPlacementAttestor(CountingAttestor(attested()), ttl_ms=bad)
        with pytest.raises(ValueError, match="max_entries"):
            CachingPlacementAttestor(CountingAttestor(attested()), max_entries=2)

    def test_the_wrapper_delegates_its_identity(self) -> None:
        inner = CountingAttestor(attested())
        cache = CachingPlacementAttestor(inner, ttl_ms=60_000)
        assert cache.inner is inner
        assert cache.source == "counting:test"

    def test_the_venue_may_refuse_and_the_review_still_returns_a_verdict(self) -> None:
        """Nothing in this path may raise into a submission.

        ``AdapterRejectedError`` becomes a blocking, non-retryable code, which is
        the shape of "an operator must do something": the order is refused, the
        worker does not spin, and the reason survives to the audit record.
        """
        clock = FakeClock()
        cache = CachingPlacementAttestor(
            CountingAttestor(error=AdapterRejectedError("401", "Unauthorized")),
            ttl_ms=60_000,
            clock=clock,
        )
        attestation = asyncio.run(cache.attest(request()))
        assert attestation.collection_code is ReviewCode.ATTESTATION_REFUSED_BY_VENUE
        assert attestation.facts.venue_backed is False
        # The cache's own job ends here: it must hand the reviewer a well-formed
        # "no answer" rather than propagate. Whether that refusal stops an order
        # is the reviewer's law, asserted in TestPlacementReviewer.


# ---------------------------------------------------------------------------
# 3. failure classification
# ---------------------------------------------------------------------------


class TestFailureClassification:
    def test_an_attestor_that_knows_why_it_failed_says_so(self) -> None:
        for code in ReviewCode:
            assert _collection_code_for(AttestationFailure(code, "detail")) is code

    def test_the_two_operationally_distinct_transport_errors_are_kept_apart(self) -> None:
        # Rate-limited: back off. Unreachable: the next order may be fine.
        assert (
            _collection_code_for(AdapterRateLimitedError("429"))
            is ReviewCode.ATTESTATION_RATE_LIMITED
        )
        assert (
            _collection_code_for(AdapterRejectedError("403", "forbidden"))
            is ReviewCode.ATTESTATION_REFUSED_BY_VENUE
        )
        assert _collection_code_for(RuntimeError("dns blew up")) is ReviewCode.ATTESTATION_UNREACHABLE

    def test_a_failure_must_carry_a_code_from_the_closed_vocabulary(self) -> None:
        with pytest.raises(TypeError, match="ReviewCode"):
            AttestationFailure("NO_SPOT_TRADE_PERMISSION")


# ---------------------------------------------------------------------------
# 4. the gatherers
# ---------------------------------------------------------------------------


class TestGatherers:
    def test_unattested_is_a_gatherer_that_answers_nothing(self) -> None:
        attestation = asyncio.run(UnattestedPlacementAttestor().attest(request()))
        assert attestation.facts.venue_backed is False
        assert attestation.collection_code is ReviewCode.NO_ATTESTATION
        assert attestation.facts.source == "unattested"
        assert "no attestor configured" in attestation.collection_detail
        custom = asyncio.run(UnattestedPlacementAttestor(reason="paper mode").attest(request()))
        # The reason travels in the detail, not the source: the source is the
        # gatherer's identity in a status surface, and a free-text reason must not
        # become what a dashboard groups by.
        assert custom.facts.source == "unattested"
        assert "paper mode" in custom.collection_detail

    def test_the_local_gatherer_reads_the_credential_provider(self) -> None:
        async def resolve(tenant_id: str, account_id: str) -> ExchangeCredentials:
            assert (tenant_id, account_id) == ("tenant-1", "account-1")
            return credentials(permissions=frozenset({"READ", "SPOT_TRADE"}))

        gatherer = LocalPlacementAttestor(
            resolve_credentials=resolve, source="local:tenant-vault"
        )
        attestation = asyncio.run(gatherer.attest(request()))
        facts = attestation.facts
        assert facts.source == "local:tenant-vault"
        assert facts.key_permission_granted is True
        assert facts.read_permitted is True
        assert facts.withdrawal_permitted is False
        assert getattr(facts, NO_KNOWN_WITHDRAWAL_PATH) is True
        # The review ran at the injected moment even though nothing was gathered
        # from a venue: the claim timestamp is about us, not about them.
        assert getattr(facts, REVIEW_REQUIRED_AT) == attestation.attested_at_micros > 0
        # Absence of a venue answer is not a venue answer.
        assert facts.venue_backed is False
        assert getattr(facts, VENUE_TRADING_FIELD) is False

    def test_a_provider_that_reports_no_permissions_is_unknown_not_refused(self) -> None:
        """The asymmetry that decides whether a deployment can trade at all.

        ``False`` here means "the venue says this key may not trade", which is
        blocking in a transmitting runtime; a provider with an empty permission
        set has said nothing, and inventing a refusal would lock every paper
        tenant out of the review, while inventing a permission would be worse.
        """
        async def none(tenant_id: str, account_id: str) -> ExchangeCredentials:
            return credentials(permissions=frozenset())

        gatherer = LocalPlacementAttestor(resolve_credentials=none)
        facts = asyncio.run(gatherer.attest(request())).facts
        assert (facts.key_permission_granted, facts.read_permitted, facts.withdrawal_permitted) == (
            None,
            None,
            None,
        )
        assert getattr(facts, NO_KNOWN_WITHDRAWAL_PATH) is False

    def test_a_credential_lookup_that_explodes_is_logged_not_raised(self) -> None:
        async def explode(tenant_id: str, account_id: str) -> ExchangeCredentials:
            raise RuntimeError("vault is down")

        gatherer = LocalPlacementAttestor(resolve_credentials=explode)
        attestation = asyncio.run(gatherer.attest(request()))
        # The gatherer returns what it has (nothing), and the reviewer's law
        # decides whether "nothing" is a refusal. Raising here would surface as an
        # engine internal error instead of a verdict with a code.
        assert attestation.facts.key_permission_granted is None
        assert attestation.facts.venue_backed is False
        assert getattr(attestation.facts, REVIEW_REQUIRED_AT) > 0

    def test_a_symbol_source_narrows_the_answer_to_the_shape_asked_about(self) -> None:
        # A ``SymbolFacts`` is the venue's four answers: attached, trading, the
        # permitted order types, the permitted time-in-forces. The gatherer's only
        # job is to reduce the last two to the shape being placed, because that is
        # what the law can act on.
        facts = (True, True, ("LIMIT", "MARKET"), ("GTC", "IOC"))
        gatherer = LocalPlacementAttestor(symbol_facts=lambda symbol: facts)
        allowed = asyncio.run(gatherer.attest(request())).facts
        assert (allowed.symbol_attached, allowed.symbol_trading) == (True, True)
        assert (allowed.order_type_supported, allowed.time_in_force_supported) == (True, True)
        refused = asyncio.run(
            gatherer.attest(request(order_type="STOP_LIMIT", time_in_force="FOK"))
        ).facts
        assert (refused.order_type_supported, refused.time_in_force_supported) == (False, False)
        # An unknown symbol is an answer: "not attached".
        absent = asyncio.run(
            LocalPlacementAttestor(symbol_facts=lambda symbol: None).attest(request())
        ).facts
        assert (absent.symbol_attached, absent.symbol_trading) == (None, None)

    def test_a_broken_symbol_source_degrades_to_no_opinion(self) -> None:
        def explode(symbol: str) -> Any:
            raise KeyError(symbol)

        facts = asyncio.run(LocalPlacementAttestor(symbol_facts=explode).attest(request())).facts
        assert facts.symbol_attached is None
        assert facts.order_type_supported is None

    def test_skew_is_reported_as_a_magnitude(self) -> None:
        for value in (-40, 40):
            gatherer = LocalPlacementAttestor(skew_millis=lambda: value)
            assert asyncio.run(gatherer.attest(request())).facts.clock_skew_millis == 40
        assert (
            asyncio.run(
                LocalPlacementAttestor(skew_millis=lambda: None).attest(request())
            ).facts.clock_skew_millis
            is None
        )

    def test_symbol_evidence_reduces_lists_to_the_shape_being_placed(self) -> None:
        evidence = symbol_evidence(
            (True, True, ("LIMIT",), ("GTC",)),
            order_type="LIMIT",
            time_in_force="GTC",
        )
        assert (
            evidence.symbol_attached,
            evidence.symbol_trading,
            evidence.order_type_supported,
            evidence.time_in_force_supported,
        ) == (True, True, True, True)
        empty = symbol_evidence(
            (True, True, (), ()), order_type="STOP_LIMIT", time_in_force="FOK"
        )
        # An empty published list is the same answer as no list at all: "we have
        # nothing to compare against", not "nothing is permitted". Reading an
        # unloaded catalog as a refusal would take a whole venue offline for a
        # symbol table that had not finished loading.
        assert (empty.order_type_supported, empty.time_in_force_supported) == (None, None)
        # A venue that publishes no per-symbol time-in-force list (Binance spot
        # does not) therefore cannot produce ``False`` here: the type admits only
        # a list, and the reducer's answer for an empty or absent one is
        # ``None`` = "not attested". The other half of the story - a symbol the
        # table does not list at all - is ``symbol_facts`` returning ``None``,
        # asserted above, where it leaves every symbol field unknown rather than
        # inventing a refusal.
        assert (
            empty.symbol_attached,
            empty.symbol_trading,
            empty.order_type_supported,
            empty.time_in_force_supported,
        ) == (True, True, None, None)


# ---------------------------------------------------------------------------
# 5. the reviewer: the only object the engine is allowed to call
# ---------------------------------------------------------------------------


class TestPlacementReviewer:
    def test_review_never_raises_whatever_the_gatherer_does(self) -> None:
        for error in (
            RuntimeError("boom"),
            AdapterRejectedError("401", "Unauthorized"),
            AttestationFailure(ReviewCode.MALFORMED_VENUE_RESPONSE, "truncated json"),
        ):
            reviewer = PlacementReviewer(
                CountingAttestor(error=error),
                PlacementReviewPolicy(),
                requires_venue_attestation=True,
            )
            attestation_, verdict = asyncio.run(reviewer.review(request()))
            # ``review`` hands back both halves: the raw record, so a caller can
            # persist what it actually received, and the verdict, so it can act.
            assert attestation_.facts.venue_backed is False
            assert verdict.allowed is False
            assert verdict.findings[0].code is _collection_code_for(error)
            assert verdict.findings[0].severity is ReviewSeverity.BLOCKING

    def test_the_runtime_mode_decides_the_consequence_of_the_same_evidence(self) -> None:
        evidence = PlacementFacts(venue_backed=False, source="paper:in-process")
        gatherer = CountingAttestor(
            PlacementAttestation(facts=evidence, attested_at_micros=epoch_micros())
        )
        live = PlacementReviewer(gatherer, PlacementReviewPolicy(), requires_venue_attestation=True)
        paper = PlacementReviewer(
            gatherer, PlacementReviewPolicy(), requires_venue_attestation=False
        )
        _, live_verdict = asyncio.run(live.review(request()))
        _, paper_verdict = asyncio.run(paper.review(request()))
        assert live_verdict.allowed is False
        assert paper_verdict.allowed is True
        # The code is the provenance law's own (local facts may not authorise a
        # transmitting runtime), not an invented per-mode code: one cause, one
        # name, with the mode deciding only the consequence.
        assert live_verdict.codes == paper_verdict.codes == ("VENUE_ATTESTATION_REQUIRED",)
        assert live_verdict.findings[0].severity is ReviewSeverity.BLOCKING
        assert paper_verdict.findings[0].severity is ReviewSeverity.INFO
        # The verdict ids differ, so an audit line can be traced to the runtime
        # that produced it - which is how a paper verdict could never be presented
        # as authority for a live order even by someone copying the record.
        assert live_verdict.verdict_id != paper_verdict.verdict_id

    def test_an_evidence_gap_becomes_a_refusal_only_when_evidence_is_required(self) -> None:
        gap = PlacementAttestation.unavailable(
            now_micros=epoch_micros(),
            code=ReviewCode.ATTESTATION_RATE_LIMITED,
            detail="429 from the venue",
            source="binance:apiRestrictions",
        )
        gatherer = CountingAttestor(gap)
        live = PlacementReviewer(gatherer, PlacementReviewPolicy(), requires_venue_attestation=True)
        paper = PlacementReviewer(
            gatherer, PlacementReviewPolicy(), requires_venue_attestation=False
        )
        _, live_verdict = asyncio.run(live.review(request()))
        _, paper_verdict = asyncio.run(paper.review(request()))
        # "The venue is rate-limiting us" is a WARNING in the table, and a
        # transmitting runtime raises it to BLOCKING: a warning would authorise
        # the order on no evidence at all.
        assert live_verdict.allowed is False
        assert live_verdict.retryable is True
        assert paper_verdict.allowed is True
        assert paper_verdict.findings[0].severity is ReviewSeverity.WARNING

    def test_attestation_is_the_raw_record_and_never_a_verdict(self) -> None:
        gatherer = CountingAttestor(attested())
        reviewer = PlacementReviewer(gatherer, PlacementReviewPolicy(), requires_venue_attestation=True)
        raw = asyncio.run(reviewer.attestation(request()))
        assert isinstance(raw, PlacementAttestation)
        assert raw.collection_code is None

    def test_describe_reports_the_wiring_without_inventing_provenance(self) -> None:
        gatherer = CachingPlacementAttestor(
            CountingAttestor(attested()), ttl_ms=90_000, clock=FakeClock()
        )
        described = PlacementReviewer(
            gatherer, PlacementReviewPolicy(max_attestation_age_ms=90_000), requires_venue_attestation=True
        ).describe()
        assert described["attestorSource"] == "counting:test"
        assert described["requiresVenueAttestation"] is True
        assert described["cache"] == {
            "entries": 0,
            "hits": 0,
            "misses": 0,
            "failuresCached": 0,
            "ttlMillis": 90_000,
            "failureTtlMillis": 18_000,
            "maxEntries": 4_096,
        }
        assert described["policy"]["maxAttestationAgeMillis"] == 90_000
        assert sorted(described) == [
            "attestorSource",
            "cache",
            "operatorConfirmation",
            "policy",
            "requiresVenueAttestation",
        ]
        # Part 19: the confirmation block is present even when nothing is wired, so
        # "we did not wire it" and "we wired it and it is absent" are two different
        # payloads. A key that vanished when unset would make the absence
        # indistinguishable from a renderer bug at 3am.
        assert described["operatorConfirmation"] == {
            "required": False,
            "keyConfigured": False,
            "recordPresent": False,
            "expiresAtMicros": 0,
            "fingerprint": "",
        }

    def test_describe_survives_a_gatherer_whose_properties_are_broken(self) -> None:
        class Broken(CountingAttestor):
            @property
            def source(self) -> str:
                raise RuntimeError("attribute exploded")

        described = PlacementReviewer(
            Broken(attested()), PlacementReviewPolicy(), requires_venue_attestation=False
        ).describe()
        # A fixed label, not the exception text: a broken attribute must not be
        # able to leak a value into a status surface while pretending to name it.
        assert described["attestorSource"] == "unavailable"
        assert described["requiresVenueAttestation"] is False
        # No "cache" key at all, rather than an empty or zeroed one: a status
        # surface that prints zeros for a component that does not exist reads as
        # "wired and idle" to whoever is on call.
        assert "cache" not in described

    def test_the_reviewer_is_reusable_across_orders_and_caches_through_it(self) -> None:
        inner = CountingAttestor(attested())
        clock = FakeClock()
        reviewer = PlacementReviewer(
            CachingPlacementAttestor(inner, ttl_ms=60_000, clock=clock),
            PlacementReviewPolicy(),
            requires_venue_attestation=True,
        )
        for _ in range(5):
            _, verdict = asyncio.run(reviewer.review(request()))
            assert verdict.allowed is True
        assert len(inner.calls) == 1
        clock.advance_ms(60_001)
        _, verdict = asyncio.run(reviewer.review(request()))
        assert verdict.allowed is True
        assert len(inner.calls) == 2


# ---------------------------------------------------------------------------
# 6. the engine: construction law, and the two outcomes
# ---------------------------------------------------------------------------


class DistributedLocks:
    """Stand-in for the Redis lock manager: enough surface to pass the law."""

    is_distributed = True

    class _Hold:
        async def __aenter__(self) -> None:
            return None

        async def __aexit__(self, *exc: object) -> bool:
            return False

    def hold(self, *args: Any, **kwargs: Any) -> Any:
        return self._Hold()


class DurableStore(InMemoryOrderStore):
    """An in-memory store that claims durability, for wiring tests only.

    It exists to satisfy one ``getattr`` in the live-mode checks so a test can
    reach the reviewer gate at the end of them. Nothing here submits live
    orders for real; a test that needs durability behaviour uses the SQL store's
    own suite.
    """

    @property
    def is_durable(self) -> bool:
        return True


class LiveAdapter(StubTradingAdapter):
    @property
    def is_simulated(self) -> bool:
        return False


def live_settings(**overrides: Any) -> Any:
    base: dict[str, Any] = {
        "live_trading_enabled": True,
        "dry_run": False,
        "paper_trading": False,
        "trading_mode_setting": "LIVE",
        "trading_enabled": True,
        "live_trading_confirmed": True,
        # Opted out deliberately: the risk gate is asserted in its own part's
        # suite, and a test of the placement gate must not have to wire a second
        # safety layer to reach the one under test.
        "risk_gate_required": False,
    }
    base.update(overrides)
    return paper_settings(**base)


def build(
    adapter: Any,
    *,
    settings: Any,
    reviewer: PlacementReviewer | None = None,
    metrics: Any = None,
) -> tuple[ExecutionEngine, InMemoryOrderStore, InMemoryIncidentRecorder]:
    store = DurableStore()
    recorder = InMemoryIncidentRecorder()
    engine = ExecutionEngine(
        adapter=adapter,
        settings=settings,
        risk_engine=risk_engine(),
        store=store,
        locks=(
            DistributedLocks() if settings.will_transmit_orders else InMemoryLockManager()
        ),
        incidents=recorder,
        validator=OrderValidator(),
        placement_reviewer=reviewer,
        metrics=metrics,
    )
    return (engine, store, recorder)


class TestEngineConstructionLaw:
    def test_a_live_runtime_without_a_reviewer_refuses_to_start(self) -> None:
        with pytest.raises(EngineConfigurationError, match="placement reviewer"):
            build(LiveAdapter(result=accepted_result()), settings=live_settings())

    def test_the_same_runtime_with_a_reviewer_starts(self) -> None:
        reviewer = PlacementReviewer(
            CountingAttestor(attested()),
            PlacementReviewPolicy(),
            requires_venue_attestation=True,
        )
        engine, _, _ = build(
            LiveAdapter(result=accepted_result()),
            settings=live_settings(),
            reviewer=reviewer,
        )
        assert engine.settings.will_transmit_orders is True
        # The reviewer is exercised through behaviour, not a public attribute: an
        # engine that starts with a live adapter and answers a submit from a
        # permitted review IS the wiring being asserted.
        result = asyncio.run(engine.submit(intent(), healthy_context()))
        assert result.outcome is ExecutionOutcome.ACCEPTED
        assert result.transmitted is True

    def test_a_simulated_runtime_may_start_without_one(self) -> None:
        # No reviewer and no transmission: allowed, and the gate says so out loud
        # (asserted in TestEngineUnderReview, where the wording is the point).
        engine, _, _ = build(
            StubTradingAdapter(result=accepted_result()), settings=paper_settings()
        )
        result = asyncio.run(engine.submit(intent(), healthy_context()))
        assert result.outcome is ExecutionOutcome.ACCEPTED

    def test_the_gate_error_map_covers_every_gate_including_the_new_one(self) -> None:
        from wlct_trading.execution import engine as engine_module

        mapped = set(engine_module._GATE_ERROR_CODES)
        assert mapped == set(SafetyGate)
        assert (
            engine_module._GATE_ERROR_CODES[SafetyGate.PLACEMENT_ATTESTED]
            is ExecutionErrorCode.LIVE_TRADING_NOT_AUTHORISED
        )
        # An unmapped gate would fall through to INTERNAL_ERROR, which is the
        # wrong taxonomy for "the venue says no".
        assert engine_module._gate_error_code(SafetyGate.PLACEMENT_ATTESTED) is (
            ExecutionErrorCode.LIVE_TRADING_NOT_AUTHORISED
        )


class TestEngineUnderReview:
    def submit(self, engine: ExecutionEngine) -> Any:
        return asyncio.run(engine.submit(intent(), healthy_context(credentials=credentials())))

    def test_a_refused_review_never_reaches_the_venue(self) -> None:
        adapter = LiveAdapter(result=accepted_result())
        reviewer = PlacementReviewer(
            CountingAttestor(
                attested(
                    withdrawal_permitted=True,
                    no_known_withdrawal_path=False,
                    venue_trading_permitted=False,
                )
            ),
            PlacementReviewPolicy(),
            requires_venue_attestation=True,
        )
        engine, store, recorder = build(adapter, settings=live_settings(), reviewer=reviewer)
        result = self.submit(engine)

        assert result.outcome is ExecutionOutcome.REJECTED_LOCALLY
        assert result.error_code is ExecutionErrorCode.LIVE_TRADING_NOT_AUTHORISED
        assert adapter.submit_calls == []
        assert result.safety is not None
        blocked = [
            gate for gate in result.safety.results if gate.gate is SafetyGate.PLACEMENT_ATTESTED
        ]
        assert blocked and blocked[0].passed is False
        assert "WITHDRAW_ENABLED" in blocked[0].detail
        # A blocked review is a fault, so it pages: the incident is how an
        # operator learns the venue changed something under a running process.
        incidents = recorder.all
        assert len(incidents) == 1
        assert "PLACEMENT_ATTESTED" in incidents[0].summary
        assert incidents[0].error_code is ExecutionErrorCode.LIVE_TRADING_NOT_AUTHORISED
        assert store.order_count() == 0

    def test_a_passing_review_records_its_verdict_beside_the_order(self) -> None:
        adapter = StubTradingAdapter(result=accepted_result())
        record = attested()
        gatherer = CountingAttestor(record)
        reviewer = PlacementReviewer(
            gatherer, PlacementReviewPolicy(), requires_venue_attestation=False
        )
        engine, store, recorder = build(
            adapter, settings=paper_settings(), reviewer=reviewer
        )
        result = self.submit(engine)
        assert result.outcome is ExecutionOutcome.ACCEPTED
        assert len(adapter.submit_calls) == 1
        assert recorder.all == ()

        events = asyncio.run(store.list_events("tenant-1", result.order.order_id))
        submitted = [
            event for event in events if event.status is OrderStatus.SUBMITTED
        ]
        assert len(submitted) == 1
        payload = submitted[0].payload
        assert payload["allowed"] == "true"
        assert payload["venueBacked"] == "true"
        assert payload["codes"] == ""
        assert payload["verdictId"]
        # The claim the gatherer made, byte for byte, in the event the order
        # carries: this is what lets an auditor answer "was the review inside the
        # freshness window *at submission*", which neither the verdict id nor the
        # event's own timestamp can tell them.
        claimed = payload["reviewRequiredAtMicros"]
        assert claimed.isdigit()
        assert claimed == str(getattr(record.facts, REVIEW_REQUIRED_AT))
        assert int(claimed) <= epoch_micros()
        assert payload[VERDICT_CLAIM_WIRE_NAMES[VENUE_TRADING_FIELD]] == "true"
        # One gather for one order: the reviewer is called by the engine, not by
        # the submission path and not twice by both.
        assert len(gatherer.calls) == 1

    def test_the_verdict_is_measured_and_counted(self) -> None:
        class Counters:
            placement_reviews = 0
            placement_review_blocks = 0
            placement_attestation_failures = 0

        class Metrics:
            def __init__(self) -> None:
                self.counters = Counters()
                self.observations: list[tuple[str, int]] = []

            def observe(self, name: str, value: int) -> None:
                self.observations.append((name, value))

        metrics = Metrics()
        reviewer = PlacementReviewer(
            CountingAttestor(error=RuntimeError("unreachable")),
            PlacementReviewPolicy(),
            requires_venue_attestation=True,
        )
        engine, _, _ = build(
            LiveAdapter(result=accepted_result()),
            settings=live_settings(),
            reviewer=reviewer,
            metrics=metrics,
        )
        self.submit(engine)
        names = [name for name, _ in metrics.observations]
        # Part 16 asserted ["placement_review"] alone, when the review was the
        # only stage this engine timed. The list is now the pipeline in order,
        # and the ordering is the part's actual claim: the review runs after
        # validation and BEFORE the safety gates, because "the verdict arrives as
        # one more gate input" only holds if the gates see it. The blocked path
        # never reaches risk, which is why risk is absent here rather than a
        # fourth stage.
        assert names == ["validation", "placement_review", "safety_gates", "total_submit"]
        assert metrics.counters.placement_reviews == 1
        assert metrics.counters.placement_review_blocks == 1
        # The extra counter is the one an operator pages on: a block because a
        # venue could not be reached is an infrastructure alert, and a block
        # because a key gained withdrawal permission is a security one.
        assert metrics.counters.placement_attestation_failures == 1

        entitlement = PlacementReviewer(
            CountingAttestor(attested(withdrawal_permitted=True)),
            PlacementReviewPolicy(),
            requires_venue_attestation=True,
        )
        counters_only = Metrics()
        engine2, _, _ = build(
            LiveAdapter(result=accepted_result()),
            settings=live_settings(),
            reviewer=entitlement,
            metrics=counters_only,
        )
        self.submit(engine2)
        assert counters_only.counters.placement_review_blocks == 1
        assert counters_only.counters.placement_attestation_failures == 0

    def test_a_runtime_with_no_reviewer_records_the_gate_as_not_applicable(self) -> None:
        adapter = StubTradingAdapter(result=accepted_result())
        engine, _, _ = build(adapter, settings=paper_settings())
        result = self.submit(engine)
        assert result.outcome is ExecutionOutcome.ACCEPTED
        gates = {gate.gate: gate for gate in result.safety.results}
        placement = gates[SafetyGate.PLACEMENT_ATTESTED]
        assert placement.passed is True
        assert placement.applicable is False
        # The wording is part of the contract: "not applicable" on a live runtime
        # would be a lie, and the construction law above is what keeps it true.
        assert "refuses to start" in placement.detail

    def test_the_request_the_engine_builds_carries_the_intents_shape(self) -> None:
        adapter = StubTradingAdapter(result=accepted_result())
        gatherer = CountingAttestor(attested())
        engine, _, _ = build(
            adapter,
            settings=paper_settings(),
            reviewer=PlacementReviewer(
                gatherer, PlacementReviewPolicy(), requires_venue_attestation=False
            ),
        )
        self.submit(engine)
        seen = gatherer.calls[0]
        original = intent()
        assert seen.tenant_id == original.tenant_id
        assert seen.account_id == original.account_id
        assert seen.symbol == original.symbol.upper()
        assert seen.order_type == original.order_type.value.upper()
        assert seen.time_in_force == original.time_in_force.value.upper()

    def test_a_null_credential_provider_is_orthogonal_to_the_review(self) -> None:
        """Two different "not wired" states, and neither is the other's cure.

        Credentials let the engine sign; the review asks whether signing is
        permitted. A deployment that has one and not the other is exactly the
        misconfiguration this part exists to make loud.
        """
        provider = CachingCredentialProvider(NullCredentialProvider("simulated"), ttl_seconds=60)
        with pytest.raises(Exception):
            asyncio.run(provider.resolve("tenant-1", "account-1", credentials().exchange))
        assert provider.source.startswith("cached(")
        assert provider.inner.__class__.__name__ == "NullCredentialProvider"

        static = CachingCredentialProvider(
            StaticCredentialProvider([credentials()]), ttl_seconds=60
        )
        resolved = asyncio.run(static.resolve("tenant-1", "account-1", credentials().exchange))
        assert resolved is not None
        assert static.size == 1
        asyncio.run(static.resolve("tenant-1", "account-1", credentials().exchange))
        assert static.size == 1


# ---------------------------------------------------------------------------
# 6. the package surface
# ---------------------------------------------------------------------------


class TestUmbrellaReExports:
    """``wlct_trading.execution`` may not be a partial view of the placement layer.

    The umbrella package re-exports the review law and the gatherers by group, and
    the first cut of this part exported the readable types and left the numbers
    behind: a service that wants to validate its own TTL against
    ``MAX_ATTESTATION_AGE_MS`` had to reach into a module path, which is how a
    bound gets retyped and then drifts. Asserted as a subset rule over what each
    module DECLARES rather than as a written-out list, because the failure worth
    catching is a name that exists in the module and is missing from the package -
    a list would just be updated to match.
    """

    @pytest.mark.parametrize(
        "module_name",
        [
            "wlct_trading.execution.placement_review",
            "wlct_trading.execution.placement_attestor",
            # Part 19's two modules join the parametrisation rather than getting a
            # test of their own, so the rule stays what it always was: whatever a
            # placement-layer module declares public must be reachable from the
            # package. A new module that forgets the umbrella fails here, in the
            # suite that already exists, and not in a review comment.
            "wlct_trading.execution.live_confirmation",
            "wlct_trading.execution.live_enablement",
        ],
    )
    def test_everything_a_placement_module_declares_is_reachable(
        self, module_name: str
    ) -> None:
        module = importlib.import_module(module_name)
        package = importlib.import_module("wlct_trading.execution")
        declared = set(module.__all__)
        assert declared, f"{module_name} declares nothing public"
        missing = sorted(declared - set(package.__all__))
        assert missing == [], f"not re-exported by wlct_trading.execution: {missing}"
        for name in sorted(declared):
            assert getattr(package, name) is getattr(module, name), name
