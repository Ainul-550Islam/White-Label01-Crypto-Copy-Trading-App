"""Part 10 SLO engine: budgets, burn windows, evaluation states, catalog.

The arithmetic contract is integer parts-per-million end to end: objective
"99.5" is 995_000 ppm, allowed error is exactly 5_000 ppm, and every derived
quantity floors toward zero. The TS replica reproduces these exact numbers
from the fixture truth tables, so any drift between the two languages shows
up as a failing vector, not a rounding argument.
"""

from __future__ import annotations

import pytest

from wlct_trading.slo import (
    COUNT_INDICATORS,
    DEFAULT_SLO_CATALOG,
    FRESHNESS_INDICATORS,
    BurnAlertKind,
    SloDefinition,
    SloIndicator,
    SloState,
    SloWindowKind,
    SloWindowSample,
    canonical_slo_json,
    compute_budget,
    default_definitions,
    evaluate_burn,
    evaluate_slo,
    objective_to_ppm,
    slo_checksum,
    validate_counts,
)

EVAL_AT = 1_700_000_000_000_000


def definition(**overrides: object) -> SloDefinition:
    base: dict[str, object] = {
        "slo_id": "test.availability",
        "service": "test",
        "description": "A test objective.",
        "owner": "sre",
        "indicator": SloIndicator.AVAILABILITY,
        "objective": "99.5",
        "window_minutes": 1_440,
        "short_window_minutes": 5,
        "good_event": "request served without a 5xx",
        "bad_event": "request failed with a 5xx",
    }
    base.update(overrides)
    return SloDefinition(**base)  # type: ignore[arg-type]


class TestObjectiveParsing:
    def test_canonical_decimal_strings(self) -> None:
        assert objective_to_ppm("99.5") == 995_000
        assert objective_to_ppm("99.9999") == 999_999
        assert objective_to_ppm("95") == 950_000

    def test_trailing_zeros_normalize_to_one_spelling(self) -> None:
        assert objective_to_ppm("99.50") == 995_000
        assert definition(objective="99.50") == definition(objective="99.500")
        assert (
            slo_checksum(definition(objective="99.50"))
            == slo_checksum(definition(objective="99.5"))
        )

    @pytest.mark.parametrize(
        "bad",
        ["", "100", "0", "-1", "abc", "1e2", "99.5%"],
    )
    def test_rejects_anything_not_a_plain_decimal_string(self, bad: str) -> None:
        with pytest.raises(ValueError):
            objective_to_ppm(bad)

    def test_rejects_non_strings_including_floats(self) -> None:
        # Floats would introduce binary rounding into the identity of an
        # objective; the type is the enforcement point.
        with pytest.raises(ValueError, match="not float"):
            definition(objective=99.5)  # type: ignore[arg-type]
        # Decimal instances are the one non-string spelling that normalizes
        # into the canonical string, not smuggled float arithmetic.
        from decimal import Decimal

        assert definition(objective=Decimal("99.50")).objective == "99.5"

    def test_five_decimal_places_rejected(self) -> None:
        with pytest.raises(ValueError):
            objective_to_ppm("99.99999")


class TestBudgetTruthTable:
    def test_exact_objective_usage(self) -> None:
        budget = compute_budget(objective="99.5", good=995, bad=5)
        assert budget.total_events == 1_000
        assert budget.failure_ppm == 5_000
        assert budget.compliance_ppm == 995_000
        assert budget.budget_total_events == 5
        assert budget.budget_consumed_events == 5
        assert budget.budget_remaining_events == 0
        assert budget.remaining_ratio_ppm == 0
        assert budget.burn_ppm == 1_000_000  # exactly the allowed rate
        assert budget.budget_zero is True

    def test_half_burn_healthy(self) -> None:
        budget = compute_budget(objective="99.5", good=999, bad=1)
        assert budget.failure_ppm == 1_000
        assert budget.burn_ppm == 200_000
        assert budget.budget_remaining_events == 4
        assert budget.budget_zero is False

    def test_floor_toward_zero_everywhere(self) -> None:
        # 1 bad in 3 total at 99.5 objective: failure ppm floors, burn floors.
        budget = compute_budget(objective="99.5", good=2, bad=1)
        assert budget.failure_ppm == 333_333
        assert budget.burn_ppm == (333_333 * 1_000_000) // 5_000
        assert budget.budget_total_events == (3 * 5_000) // 1_000_000  # 0
        assert budget.budget_remaining_events == 0
        assert budget.remaining_ratio_ppm == 0

    def test_no_samples_is_unmeasured_not_healthy(self) -> None:
        budget = compute_budget(objective="99.9", good=0, bad=0)
        assert budget.has_samples is False
        assert budget.failure_ppm is None
        assert budget.compliance_ppm is None
        assert budget.burn_ppm is None
        assert budget.remaining_ratio_ppm is None
        assert budget.budget_total_events == 0
        assert budget.budget_zero is False

    def test_negative_counts_are_a_broken_collector_not_a_clamp(self) -> None:
        with pytest.raises(ValueError):
            validate_counts(good=5, bad=-1)
        with pytest.raises(TypeError):
            validate_counts(good=1.5, bad=2)  # type: ignore[arg-type]

    def test_serialization_shape_is_stable(self) -> None:
        row = compute_budget(objective="99.5", good=995, bad=5).to_dict()
        assert row["objectivePpm"] == 995_000
        assert row["allowedPpm"] == 5_000
        assert row["failurePpm"] == 5_000
        assert row["budgetZero"] is True
        assert list(row) == [
            "objectivePpm",
            "allowedPpm",
            "totalEvents",
            "goodEvents",
            "badEvents",
            "failurePpm",
            "compliancePpm",
            "budgetTotalEvents",
            "budgetConsumedEvents",
            "budgetRemainingEvents",
            "remainingRatioPpm",
            "burnPpm",
            "budgetZero",
        ]
        empty = compute_budget(objective="99.5", good=0, bad=0).to_dict()
        assert empty["failurePpm"] is None


class TestBurnWindows:
    def test_both_window_and_logic(self) -> None:
        fast = 14_400_000
        slow = 6_000_000
        # Short window alone never fires: a one-minute spark is noise.
        one_sided = evaluate_burn(
            short_burn_ppm=20_000_000,
            long_burn_ppm=None,
            fast_multiplier_ppm=fast,
            slow_multiplier_ppm=slow,
        )
        assert one_sided.kind == BurnAlertKind.NONE
        assert one_sided.alerting is False
        both_short_only = evaluate_burn(
            short_burn_ppm=20_000_000,
            long_burn_ppm=1_000_000,
            fast_multiplier_ppm=fast,
            slow_multiplier_ppm=slow,
        )
        assert both_short_only.kind == BurnAlertKind.NONE

    def test_long_window_agreement_escalates(self) -> None:
        state = evaluate_burn(
            short_burn_ppm=15_000_000,
            long_burn_ppm=14_400_000,
            fast_multiplier_ppm=14_400_000,
            slow_multiplier_ppm=6_000_000,
        )
        # fast implies slow when fast >= slow, so a fast breach reports BOTH:
        # the documented, deliberate degeneracy of the classic 14.4x/6h+30d
        # multi-window design.
        assert state.kind == BurnAlertKind.BOTH
        assert state.alerting is True
        slow_only = evaluate_burn(
            short_burn_ppm=6_000_000,
            long_burn_ppm=7_000_000,
            fast_multiplier_ppm=14_400_000,
            slow_multiplier_ppm=6_000_000,
        )
        assert slow_only.kind == BurnAlertKind.SLOW

    def test_threshold_inputs_are_validated(self) -> None:
        with pytest.raises(ValueError):
            evaluate_burn(
                short_burn_ppm=None,
                long_burn_ppm=None,
                fast_multiplier_ppm=0,
                slow_multiplier_ppm=1,
            )
        with pytest.raises(ValueError):
            evaluate_burn(
                short_burn_ppm=None,
                long_burn_ppm=None,
                fast_multiplier_ppm=1,
                slow_multiplier_ppm=2,
            )

    def test_to_dict_shape(self) -> None:
        row = evaluate_burn(
            short_burn_ppm=6_000_000,
            long_burn_ppm=6_000_000,
            fast_multiplier_ppm=14_400_000,
            slow_multiplier_ppm=6_000_000,
        ).to_dict()
        assert row["kind"] == "slow"
        assert row["shortBurnPpm"] == 6_000_000


class TestEvaluationStates:
    def test_incomplete_collector_is_unknown_never_optimistic(self) -> None:
        evaluation = evaluate_slo(
            definition(),
            long_window=SloWindowSample(good=1_000_000, bad=0, data_complete=False),
            short_window=SloWindowSample(good=10_000, bad=0, data_complete=True),
            evaluated_at_micros=EVAL_AT,
        )
        assert evaluation.state is SloState.UNKNOWN
        assert evaluation.evidences_health is False
        assert "long-window collector incomplete" in (evaluation.reason or "")

    def test_no_samples_is_unknown_with_its_own_reason(self) -> None:
        evaluation = evaluate_slo(
            definition(),
            long_window=SloWindowSample(data_complete=True),
            short_window=SloWindowSample(data_complete=True),
            evaluated_at_micros=EVAL_AT,
        )
        assert evaluation.state is SloState.UNKNOWN
        assert evaluation.data_complete is True
        assert "absence of failures is not evidence of success" in (
            evaluation.reason or ""
        )

    def test_healthy_row(self) -> None:
        evaluation = evaluate_slo(
            definition(),
            long_window=SloWindowSample(
                good=100_000, bad=1, data_complete=True
            ),
            short_window=SloWindowSample(good=1_000, bad=0, data_complete=True),
            evaluated_at_micros=EVAL_AT,
        )
        assert evaluation.state is SloState.HEALTHY
        assert evaluation.actual_ppm == 999_991  # 1 bad in 100_001 floors to 9ppm failure
        assert evaluation.target_ppm == 995_000
        assert evaluation.budget_remaining_events > 0
        assert evaluation.alert_kind == "none"
        assert evaluation.evidences_health is True

    def test_warning_and_critical_use_long_window_burn(self) -> None:
        # burn 1.0x (5000ppm failure on 99.5) -> >= warning 1.0x; below
        # critical 2.0x. The row is the exact-objective boundary.
        warning = evaluate_slo(
            definition(),
            long_window=SloWindowSample(good=995, bad=5, data_complete=True),
            short_window=SloWindowSample(good=995, bad=5, data_complete=True),
            evaluated_at_micros=EVAL_AT,
        )
        assert warning.long_burn_ppm == 1_000_000
        # 1.0x >= warning (1.0x default) and >= critical (2.0x)? no: < 2x.
        # Budget is also exactly zero with bad>0, which outranks burn.
        assert warning.state is SloState.EXHAUSTED

    def test_exhausted_outranks_burn_states(self) -> None:
        evaluation = evaluate_slo(
            definition(warning_burn_ppm=9_000_000, critical_burn_ppm=9_000_000),
            long_window=SloWindowSample(good=990, bad=10, data_complete=True),
            short_window=SloWindowSample(good=990, bad=10, data_complete=True),
            evaluated_at_micros=EVAL_AT,
        )
        assert evaluation.state is SloState.EXHAUSTED

    def test_critical_when_burns_exceed_and_the_window_is_too_small_to_exhaust(self) -> None:
        # Reachable band, and only here: with a 99.95 objective (500ppm
        # allowed) over 1_000 events the budget floors to ZERO events, so
        # "exhausted" cannot be claimed (no budget ever existed to burn),
        # while a single bad request is 2.0x the allowed pace. A window too
        # small to prove exhaustion is exactly when the state ladder, not the
        # exhaust rule, carries the signal.
        common = {
            "objective": "99.95",
            "warning_burn_ppm": 1_000_000,
            "critical_burn_ppm": 2_000_000,
        }
        critical = evaluate_slo(
            definition(**common),
            long_window=SloWindowSample(good=999, bad=1, data_complete=True),
            short_window=SloWindowSample(good=999, bad=1, data_complete=True),
            evaluated_at_micros=EVAL_AT,
        )
        assert critical.long_burn_ppm == 2_000_000
        assert critical.state is SloState.CRITICAL
        assert critical.budget_total_events == 0
        warning = evaluate_slo(
            definition(**{**common, "critical_burn_ppm": 2_000_001}),
            long_window=SloWindowSample(good=999, bad=1, data_complete=True),
            short_window=SloWindowSample(good=999, bad=1, data_complete=True),
            evaluated_at_micros=EVAL_AT,
        )
        assert warning.state is SloState.WARNING

    def test_evaluation_to_dict_pins_wire_names(self) -> None:
        evaluation = evaluate_slo(
            definition(),
            long_window=SloWindowSample(good=995, bad=5, data_complete=True),
            short_window=SloWindowSample(good=99, bad=1, data_complete=True),
            evaluated_at_micros=EVAL_AT,
        )
        row = evaluation.to_dict()
        assert row["sloId"] == "test.availability"
        assert row["evaluatedAtMicros"] == str(EVAL_AT)
        assert row["state"] == "EXHAUSTED"
        assert row["targetPpm"] == 995_000
        assert row["reason"]

    def test_alert_kind_is_none_without_both_windows(self) -> None:
        evaluation = evaluate_slo(
            definition(),
            long_window=SloWindowSample(good=998, bad=2, data_complete=True),
            short_window=SloWindowSample(good=1_000, bad=90, data_complete=True),
            evaluated_at_micros=EVAL_AT,
        )
        # short window burns wildly; long window at 20% of allowed pace
        # -> no alert from the AND logic even though the state ladder sees
        # nothing alarming either.
        assert evaluation.alert_kind == "none"


class TestCanonicalizationAndChecksum:
    def test_canonical_json_is_compact_sorted_and_ascii(self) -> None:
        text = canonical_slo_json({"b": 1, "a": {"d": "é", "c": [1, 2]}})
        assert text == '{"a":{"c":[1,2],"d":"\\u00e9"},"b":1}'

    def test_checksum_is_stable_and_content_bound(self) -> None:
        first = slo_checksum(definition())
        again = slo_checksum(definition())
        assert first == again
        assert len(first) == 64
        moved = slo_checksum(definition(objective="99.9"))
        assert moved != first
        prose = slo_checksum(definition(good_event="request served OK"))
        assert prose != first  # human counting rule is part of the identity

    def test_version_and_enabled_do_not_move_the_digest(self) -> None:
        base = slo_checksum(definition())
        assert slo_checksum(definition(version=7)) == base
        assert slo_checksum(definition(enabled=False)) == base

    def test_definition_rejects_invalid_constructions(self) -> None:
        with pytest.raises(ValueError, match="window_minutes out of bounds"):
            definition(window_minutes=4)
        with pytest.raises(ValueError, match="window_minutes out of bounds"):
            definition(window_minutes=10_081)
        with pytest.raises(ValueError, match="short_window_minutes"):
            definition(short_window_minutes=2_000)
        with pytest.raises(ValueError, match="critical burn threshold"):
            definition(warning_burn_ppm=5_000_000, critical_burn_ppm=1)
        with pytest.raises(ValueError, match="requires max_age_micros"):
            definition(indicator=SloIndicator.MARKET_DATA_FRESHNESS)
        with pytest.raises(
            ValueError, match="must not carry latency_threshold_micros"
        ):
            definition(
                indicator=SloIndicator.QUEUE_FRESHNESS,
                max_age_micros=1,
                latency_threshold_micros=1,
            )
        with pytest.raises(
            ValueError, match="latency compliance requires"
        ):
            definition(indicator=SloIndicator.LATENCY_THRESHOLD_COMPLIANCE)
        with pytest.raises(ValueError, match="count indicators carry no"):
            definition(max_age_micros=5)
        with pytest.raises(ValueError, match="bounded lowercase identifier"):
            definition(slo_id="Uppercase")

    def test_validate_surfaces_every_problem(self) -> None:
        broken = definition()
        object.__setattr__(broken, "slo_id", "X")
        object.__setattr__(broken, "owner", "!!!")
        errors = broken.validate()
        assert len(errors) >= 2


class TestDefaultCatalog:
    EXPECTED = {
        "api.availability",
        "api.request-success",
        "queues.processing-success",
        "queues.freshness",
        "market-data.freshness",
        "risk-state.freshness",
        "execution.reconciliation-freshness",
        "api.latency-compliance",
        "trading-engine.error-rate",
    }

    def test_nine_objectives_all_validate(self) -> None:
        assert {d.slo_id for d in DEFAULT_SLO_CATALOG} == self.EXPECTED
        for d in DEFAULT_SLO_CATALOG:
            assert d.validate() == []
            assert d.enabled is True

    def test_indicator_families_covered(self) -> None:
        kinds = {d.indicator for d in DEFAULT_SLO_CATALOG}
        assert SloIndicator.AVAILABILITY in kinds
        assert SloIndicator.RISK_STATE_FRESHNESS in kinds
        assert len(COUNT_INDICATORS) == 5
        assert len(FRESHNESS_INDICATORS) == 4

    def test_thresholds_tie_to_freshness_budgets(self) -> None:
        risk = next(d for d in DEFAULT_SLO_CATALOG if d.slo_id == "risk-state.freshness")
        assert risk.max_age_micros is not None
        # The Part 8 hard deny is at 2_000_000us for the live gate; the SLO
        # budget is the doubled operational target.
        assert risk.max_age_micros >= 4_000_000
        latency = next(
            d for d in DEFAULT_SLO_CATALOG if d.slo_id == "api.latency-compliance"
        )
        assert latency.latency_threshold_micros is not None
        assert latency.latency_threshold_micros > 0

    def test_windows_are_within_bounds(self) -> None:
        for d in DEFAULT_SLO_CATALOG:
            assert 5 <= d.short_window_minutes <= d.window_minutes <= 10_080

    def test_default_definitions_returns_catalog(self) -> None:
        assert default_definitions() == DEFAULT_SLO_CATALOG

    def test_window_kind_enum(self) -> None:
        assert [k.value for k in SloWindowKind] == ["short", "long"]


class TestSampleDefaults:
    def test_completeness_must_be_claimed(self) -> None:
        sample = SloWindowSample(good=10, bad=0)
        assert sample.data_complete is False
        assert sample.counts() == (10, 0, 10)
