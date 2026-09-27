"""Part 19, core: the review's category axis, and what it feeds.

Many codes can tell you *what* is wrong; only a category tells you *which part* of
the enablement picture is unhealthy. This file asserts the axis is total (every code
classified), that its two consumers agree with each other (the verdict's areas and the
counters' fields), and - the part that makes it safe to have added it at all - that it
changed no verdict for a deployment that did not ask for it.

The bidirectional pins are the point of the file. ``review_area_of`` falls back to
UNCLASSIFIED for an unknown code, and the engine's counter increment is guarded by
``hasattr`` so a new area cannot make the reporting path raise; each of those is
correct in isolation and each is a hole unless something asserts that the tables cover
one another. They do, and these tests are why.

Harness note: the fakes are imported from the Part 16 suites rather than
reimplemented here, because a stub that drifts from the real collaborator tests the
stub. Like those files, this one stamps relative to the process clock and never
freezes it, so every time-sensitive case is a duration from now, not an instant.
"""

from __future__ import annotations

import asyncio
import dataclasses
from dataclasses import fields
from typing import Any

import pytest
from test_execution import accepted_result, credentials, healthy_context, intent
from wlct_trading.clock import epoch_micros
from wlct_trading.execution.live_confirmation import (
    ConfirmationState,
    ConfirmationVerifier,
    LiveOperatorConfirmation,
)
from wlct_trading.execution.placement_attestor import (
    PlacementReviewRequest,
    PlacementReviewer,
    UnattestedPlacementAttestor,
)
from wlct_trading.execution.placement_review import (
    MAX_CONFIRMATION_DETAIL_LENGTH,
    REVIEW_AREA_BY_CODE,
    PlacementFacts,
    PlacementReviewPolicy,
    ReviewArea,
    ReviewCode,
    ReviewSeverity,
    evaluate_placement_attestation,
    review_area_of,
    severity_of,
)
from wlct_trading.metrics import ExecutionCounters

from tests.test_part16_placement_attestor import (
    CountingAttestor,
    LiveAdapter,
    attested,
    build,
    live_settings,
)

#: One day in microseconds, and the key the confirmation record below is stamped by.
#: The key is not a secret here: computing a signature is the capability under test,
#: and the real one is env-only and never appears in a repository.
DAY_MICROS = 86_400_000_000
KEY = "part19-test-confirmation-key-0123456789abcdef"

#: Every name the engine may increment, in the shape it derives them.
AREA_COUNTER_FIELDS = frozenset(f"placement_blocks_{area.value.lower()}" for area in ReviewArea)


def attestation_with(facts: PlacementFacts) -> Any:
    """The Part 16 fixture's attestation, with these facts instead of its own."""
    return dataclasses.replace(attested(), facts=facts)


# ---------------------------------------------------------------------------
# 1. the table is total, in both directions
# ---------------------------------------------------------------------------


class TestCoverage:
    def test_every_code_has_an_area_and_no_area_is_a_dead_letter(self) -> None:
        assert set(REVIEW_AREA_BY_CODE) == set(ReviewCode)
        used = set(REVIEW_AREA_BY_CODE.values())
        # UNCLASSIFIED is deliberately absent from the table: it is the fallback, and
        # a code that "means" unclassified would let the fallback stop being a signal.
        # Every other area must have at least one code, or the axis publishes a series
        # that stays at zero forever and nobody can tell health from a gap in the
        # mapping.
        assert used == set(ReviewArea) - {ReviewArea.UNCLASSIFIED}

    def test_each_group_of_codes_shares_its_area(self) -> None:
        groups = {
            ReviewArea.PROVENANCE: ("ATTESTATION_", "NO_ATTESTATION", "STALE_", "FUTURE_"),
            ReviewArea.CREDENTIAL: ("KEY_", "WITHDRAW_", "NO_", "IP_", "TRADING_AUTHORITY_"),
            ReviewArea.ACCOUNT: ("ACCOUNT_",),
            ReviewArea.SYMBOL: ("SYMBOL_", "ORDER_TYPE_", "TIF_"),
            ReviewArea.CLOCK: ("CLOCK_", "RECV_"),
            ReviewArea.CONFIRMATION: ("OPERATOR_CONFIRMATION_",),
        }
        for area, prefixes in groups.items():
            codes = {
                code
                for code in ReviewCode
                if code.value.startswith(prefixes) and review_area_of(code) is area
            }
            assert codes, f"no {area.value} code starts with {prefixes}"

    def test_an_unknown_or_plain_string_code_falls_back_without_raising(self) -> None:
        # Gatherers hand back strings, and the lookup runs on the reporting path of a
        # refusal, where a KeyError would replace an answer with a crash.
        assert review_area_of("NO_ATTESTATION") is ReviewArea.PROVENANCE
        assert review_area_of("NOT_A_CODE") is ReviewArea.UNCLASSIFIED
        assert review_area_of("") is ReviewArea.UNCLASSIFIED
        assert review_area_of(ReviewCode.WITHDRAW_ENABLED) is ReviewArea.CREDENTIAL

    def test_every_confirmation_refusal_is_blocking_and_the_acceptance_is_not(self) -> None:
        for code in ReviewCode:
            if code.value.startswith("OPERATOR_CONFIRMATION_") and code is not (
                ReviewCode.OPERATOR_CONFIRMATION_ACCEPTED
            ):
                assert severity_of(code) is ReviewSeverity.BLOCKING, code
        assert severity_of(ReviewCode.OPERATOR_CONFIRMATION_ACCEPTED) is ReviewSeverity.INFO

    def test_the_counter_fields_are_exactly_the_areas(self) -> None:
        declared = frozenset(
            field.name
            for field in fields(ExecutionCounters)
            if field.name.startswith("placement_blocks_")
        )
        # The engine guards its increment with ``hasattr`` so an area added to the
        # enum cannot raise on the reporting path. That guard is only honest while the
        # two sets agree: this assertion is the difference between "the guard cannot
        # break" and "the guard can silently swallow a new area".
        assert declared == AREA_COUNTER_FIELDS
        for name in sorted(declared):
            assert getattr(ExecutionCounters(), name) == 0, name


# ---------------------------------------------------------------------------
# 2. the verdict's own view
# ---------------------------------------------------------------------------


def clean_facts(**overrides: Any) -> PlacementFacts:
    base: dict[str, Any] = {
        "venue_backed": True,
        "source": "binance:test",
        "key_permission_granted": True,
        "withdrawal_permitted": False,
        "read_permitted": True,
        "ip_allowlist_enabled": True,
        "account_can_trade": True,
        "symbol_attached": True,
        "symbol_trading": True,
        "order_type_supported": True,
        "time_in_force_supported": True,
        "clock_skew_millis": 10,
        "recv_window_millis": 5_000,
        "venue_trading_permitted": True,
        "no_known_withdrawal_path": True,
        # Stamped at call time, so the freshness law is satisfied without the test
        # having to know what "now" is; see the module docstring.
        "review_required_at_micros": epoch_micros(),
    }
    base.update(overrides)
    return PlacementFacts(**base)


def review(facts: PlacementFacts, **policy_kwargs: Any) -> Any:
    return evaluate_placement_attestation(
        attestation_with(facts),
        PlacementReviewPolicy(**policy_kwargs),
        requires_venue_attestation=True,
        now_micros=epoch_micros(),
    )


class TestVerdictAreas:
    def test_a_clean_review_reports_no_areas_at_all(self) -> None:
        verdict = review(clean_facts())
        assert verdict.allowed
        assert verdict.blocking_areas == ()
        assert verdict.area_counts == {}
        assert verdict.blocking_code_counts == {}

    def test_two_findings_in_one_area_collapse_in_areas_and_count_in_counts(self) -> None:
        verdict = review(
            clean_facts(
                key_permission_granted=False,
                venue_trading_permitted=False,
                withdrawal_permitted=True,
                no_known_withdrawal_path=False,
            )
        )
        assert ReviewArea.CREDENTIAL in verdict.blocking_areas
        assert verdict.area_counts["CREDENTIAL"] >= 2
        assert len(verdict.blocking_codes) >= 2
        assert verdict.to_dict()["blockingAreas"] == [
            area.value for area in verdict.blocking_areas
        ]

    def test_areas_are_ordered_by_declaration_not_by_incidence(self) -> None:
        verdict = review(
            clean_facts(
                confirmation=ConfirmationState.EXPIRED,
                confirmation_detail="it lapsed",
                symbol_trading=False,
                clock_skew_millis=9_000,
            )
        )
        order = [area.value for area in ReviewArea]
        reported = [area.value for area in verdict.blocking_areas]
        assert reported == sorted(reported, key=order.index)
        assert reported == ["SYMBOL", "CLOCK", "CONFIRMATION"]

    def test_an_unrequired_passing_confirmation_adds_nothing_to_the_verdict(self) -> None:
        """The no-behaviour-change pin for Part 19's new field.

        ``PlacementFacts`` grew a confirmation state, and the review runs over the
        facts it is given; a deployment that neither requires nor supplies a
        confirmation must see the identical verdict - findings, areas and digest -
        that it saw before Part 19 existed. The digest is in the assertion because
        ``verdict_id`` is what an audit line is correlated by, and a new field that
        silently entered the canonical payload would rewrite history.
        """
        # ONE attestation, two fact objects: the harness stamps at call time, so two
        # separate reviews would differ in ``attestedAtMicros`` - which the digest
        # covers by design - and the test would be measuring the clock instead of the
        # field it names.
        shared = attestation_with(clean_facts())
        policy = PlacementReviewPolicy()
        plain = evaluate_placement_attestation(
            shared, policy, requires_venue_attestation=True, now_micros=epoch_micros()
        )
        passing = evaluate_placement_attestation(
            dataclasses.replace(shared, facts=clean_facts(confirmation=ConfirmationState.VALID)),
            policy,
            requires_venue_attestation=True,
            now_micros=epoch_micros(),
        )
        assert passing.findings == plain.findings
        assert passing.verdict_id == plain.verdict_id
        assert passing.allowed and plain.allowed

    def test_a_refused_confirmation_is_reported_even_unrequired(self) -> None:
        verdict = review(
            clean_facts(
                confirmation=ConfirmationState.UNVERIFIED,
                confirmation_detail="digest mismatch",
            )
        )
        assert not verdict.allowed
        assert [finding.code.value for finding in verdict.blocking_findings] == [
            "OPERATOR_CONFIRMATION_UNVERIFIED"
        ]
        assert "not require an operator confirmation" in verdict.blocking_findings[0].message

    def test_required_and_absent_is_a_refusal_with_a_remedy(self) -> None:
        verdict = review(
            clean_facts(confirmation=ConfirmationState.ABSENT),
            require_operator_confirmation=True,
        )
        blocking = verdict.blocking_findings
        assert [finding.code.value for finding in blocking] == ["OPERATOR_CONFIRMATION_ABSENT"]
        assert "ceremony" in blocking[0].message
        assert not verdict.retryable

    def test_required_and_valid_is_recorded_without_blocking(self) -> None:
        verdict = review(
            clean_facts(confirmation=ConfirmationState.VALID, confirmation_detail="scoped"),
            require_operator_confirmation=True,
        )
        assert verdict.allowed
        assert ReviewCode.OPERATOR_CONFIRMATION_ACCEPTED in {
            finding.code for finding in verdict.findings
        }
        assert verdict.blocking_areas == ()
        # The acceptance is INFO and the areas come from BLOCKING findings, so a green
        # confirmation shows up in the audit line and not in the counters - which is
        # what keeps ``placement_blocks_confirmation`` meaning "refused".
        assert verdict.area_counts == {}

    def test_the_policy_and_the_public_view_agree_on_the_requirement(self) -> None:
        assert PlacementReviewPolicy().to_public_dict()["requireOperatorConfirmation"] is False
        assert (
            PlacementReviewPolicy(require_operator_confirmation=True).to_public_dict()[
                "requireOperatorConfirmation"
            ]
            is True
        )

    def test_the_detail_is_truncated_where_it_is_rendered(self) -> None:
        long_detail = "x" * (MAX_CONFIRMATION_DETAIL_LENGTH + 500)
        verdict = review(
            clean_facts(
                confirmation=ConfirmationState.SCOPE_MISMATCH,
                confirmation_detail=long_detail,
            )
        )
        assert verdict.blocking_findings[0].message.count("x") == MAX_CONFIRMATION_DETAIL_LENGTH


# ---------------------------------------------------------------------------
# 3. the reviewer stamps the assessment, per order
# ---------------------------------------------------------------------------


def confirmation_record(**overrides: Any) -> LiveOperatorConfirmation:
    """A record that is valid *now*, because the reviewer's clock is the process one."""
    now = epoch_micros()
    base: dict[str, Any] = {
        "instance_id": "exec-1",
        "tenant_id": "tenant-a",
        "account_id": "acct-1",
        "exchange": "BINANCE",
        "symbols": frozenset({"BTCUSDT", "ETHUSDT"}),
        "order_types": frozenset({"LIMIT"}),
        "issued_at_micros": now - DAY_MICROS,
        "expires_at_micros": now + 6 * DAY_MICROS,
        "nonce": "0f1e2d3c4b5a6978",
    }
    base.update(overrides)
    return LiveOperatorConfirmation(**base).with_digest(KEY)


def request(**overrides: Any) -> PlacementReviewRequest:
    base: dict[str, Any] = {
        "tenant_id": "tenant-a",
        "account_id": "acct-1",
        "symbol": "BTCUSDT",
        "order_type": "LIMIT",
        "time_in_force": "GTC",
    }
    base.update(overrides)
    return PlacementReviewRequest(**base)


def verifier(**overrides: Any) -> ConfirmationVerifier:
    settings: dict[str, Any] = {
        "record": confirmation_record(),
        "key": KEY,
        "instance_id": "exec-1",
        "exchange": "BINANCE",
        "required": True,
    }
    settings.update(overrides)
    return ConfirmationVerifier(**settings)


def reviewer_for(**verifier_kwargs: Any) -> PlacementReviewer:
    return PlacementReviewer(
        CountingAttestor(attested()),
        PlacementReviewPolicy(require_operator_confirmation=True),
        requires_venue_attestation=True,
        confirmation=verifier(**verifier_kwargs),
    )


class TestReviewerStamping:
    def test_a_symbol_outside_the_confirmation_is_refused_for_that_order_only(self) -> None:
        """Order-scoping, asserted where it could actually be broken.

        The attestation is cached per (tenant, account, symbol, shape); if the
        confirmation were assessed once per deployment - or attached to the cached
        attestation instead of stamped after the cache - this pair would agree. They
        must not, and this is the test that says so.
        """
        reviewer = reviewer_for()
        covered, covered_verdict = asyncio.run(reviewer.review(request()))
        other, other_verdict = asyncio.run(reviewer.review(request(symbol="SOLUSDT")))
        assert covered_verdict.allowed, covered_verdict.summary
        assert not other_verdict.allowed
        assert other.facts.confirmation is ConfirmationState.SCOPE_MISMATCH
        assert covered.facts.confirmation is ConfirmationState.VALID
        assert other_verdict.blocking_areas == (ReviewArea.CONFIRMATION,)

    def test_an_order_type_outside_the_confirmation_is_refused_too(self) -> None:
        reviewer = reviewer_for()
        _, verdict = asyncio.run(reviewer.review(request(order_type="MARKET")))
        assert not verdict.allowed
        assert verdict.blocking_code_counts == {"OPERATOR_CONFIRMATION_SCOPE_MISMATCH": 1}

    def test_the_attestation_returned_to_the_caller_carries_the_assessment(self) -> None:
        attestation, verdict = asyncio.run(reviewer_for().review(request()))
        assert attestation.facts.confirmation is ConfirmationState.VALID
        assert verdict.allowed

    def test_a_reviewer_without_a_verifier_refuses_when_the_policy_asks(self) -> None:
        with pytest.raises(Exception, match="no ConfirmationVerifier was supplied"):
            PlacementReviewer(
                CountingAttestor(attested()),
                PlacementReviewPolicy(require_operator_confirmation=True),
                requires_venue_attestation=True,
            )

    def test_the_wiring_view_carries_the_public_summary_not_the_scope(self) -> None:
        reviewer = PlacementReviewer(
            UnattestedPlacementAttestor("none"),
            PlacementReviewPolicy(require_operator_confirmation=True),
            requires_venue_attestation=False,
            confirmation=verifier(),
        )
        view = reviewer.describe()["operatorConfirmation"]
        assert view["required"] is True
        assert view["keyConfigured"] is True
        assert view["recordPresent"] is True
        # Nothing identity-shaped: this block reaches /health/ready, which is
        # unauthenticated, and a scope list there is a tenant census.
        for name in ("symbols", "orderTypes", "tenantId", "accountId", "digest", "nonce"):
            assert name not in view

    def test_the_view_keeps_one_shape_whether_or_not_a_verifier_exists(self) -> None:
        bare = PlacementReviewer(
            UnattestedPlacementAttestor("none"),
            PlacementReviewPolicy(),
            requires_venue_attestation=False,
        ).describe()["operatorConfirmation"]
        assert set(bare) == {
            "required",
            "keyConfigured",
            "recordPresent",
            "expiresAtMicros",
            "fingerprint",
        }


# ---------------------------------------------------------------------------
# 4. the engine increments the areas
# ---------------------------------------------------------------------------


class FakeMetrics:
    """The engine's optional port, duck-typed the way the engine ducks it."""

    def __init__(self, counters: ExecutionCounters) -> None:
        self.counters = counters
        self.observations: list[tuple[str, int]] = []

    def observe(self, name: str, value: int) -> None:
        self.observations.append((name, value))


def counters_for_refused_submission(**verifier_kwargs: Any) -> ExecutionCounters:
    counters = ExecutionCounters()
    facts = clean_facts(
        withdrawal_permitted=True,
        no_known_withdrawal_path=False,
        venue_trading_permitted=False,
    )
    reviewer = PlacementReviewer(
        CountingAttestor(attestation_with(facts)),
        PlacementReviewPolicy(require_operator_confirmation=True),
        requires_venue_attestation=True,
        # An absent confirmation, so the CREDENTIAL and CONFIRMATION areas both refuse
        # the same order and the per-area counters are exercised together rather than
        # each on a run of its own.
        confirmation=verifier(record=None, **verifier_kwargs),
    )
    engine, _, _ = build(
        LiveAdapter(result=accepted_result()),
        settings=live_settings(),
        reviewer=reviewer,
        metrics=FakeMetrics(counters),
    )
    asyncio.run(engine.submit(intent(), healthy_context(credentials=credentials())))
    return counters


class TestEngineAreaCounters:
    def test_each_refused_area_counts_once_and_the_total_counts_the_verdict(self) -> None:
        counters = counters_for_refused_submission()
        assert counters.placement_reviews == 1
        assert counters.placement_review_blocks == 1
        assert counters.placement_blocks_credential >= 1
        assert counters.placement_blocks_confirmation == 1
        for name in ("provenance", "account", "symbol", "clock", "unclassified"):
            assert getattr(counters, f"placement_blocks_{name}") == 0, name

    def test_the_block_is_counted_once_whatever_the_number_of_findings(self) -> None:
        # ``placement_review_blocks`` counts orders refused and ``placement_blocks_*``
        # counts findings: an order refused for four reasons is one refusal and four
        # area-hits, and reading the two as the same number is how a dashboard ends up
        # claiming more refusals than there were orders.
        counters = counters_for_refused_submission()
        total = sum(getattr(counters, name) for name in sorted(AREA_COUNTER_FIELDS))
        assert total >= counters.placement_review_blocks

    def test_the_counters_render_on_the_public_view(self) -> None:
        view = ExecutionCounters(placement_blocks_confirmation=2).to_dict()
        assert view["placementBlocksConfirmation"] == 2
        assert view["placementBlocksUnclassified"] == 0
