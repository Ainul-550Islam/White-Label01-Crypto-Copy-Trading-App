"""Batch 03 futures tests: the four placement risk guards, at their boundaries.

Every guard has exactly two outcomes: a measured pass or a measured breach -
"could not evaluate" is neither; it raises ``FuturesGuardRefusal`` before a
verdict exists. The boundary cases matter more than the middle: the ceiling
value itself must pass, one tick above it must breach, and unknown evidence
(None price, no leverage) must refuse before any number is invented.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from wlct_trading.enums import OrderSide
from wlct_trading.exchanges.binance_futures.risk_guards import (
    FuturesGuardPolicy,
    FuturesGuardRefusal,
    evaluate_futures_guards,
)

POLICY = FuturesGuardPolicy()
# A less brittle customised policy for boundary maths against non-default numbers.
LOOSE = FuturesGuardPolicy(
    max_leverage=Decimal("10"),
    max_notional_usdt=Decimal("100000"),
    min_liquidation_distance_bps=Decimal("200"),
    max_funding_rate_bps=Decimal("50"),
)


def _run(**kwargs):
    base = dict(
        side=OrderSide.BUY,
        quantity=Decimal("1"),
        reference_price=Decimal("40000"),
        leverage=Decimal("3"),
        maintenance_margin_fraction=Decimal("0.05"),
        projected_funding_rate_8h_bps=Decimal("0"),
        policy=POLICY,
    )
    base.update(kwargs)
    return evaluate_futures_guards(**base)


class TestLeverageCeiling:
    def test_at_the_ceiling_passes(self) -> None:
        report = _run(leverage=Decimal("3"))
        verdict = next(v for v in report.verdicts if v.guard == "leverage-ceiling")
        assert verdict.breached is False
        assert verdict.measured == Decimal("3")
        assert verdict.limit == Decimal("3")

    def test_above_the_ceiling_breaches(self) -> None:
        report = _run(leverage=Decimal("3.00000001"))
        assert report.admitted is False
        verdict = next(v for v in report.verdicts if v.guard == "leverage-ceiling")
        assert verdict.breached is True
        assert "BREACH" in verdict.detail

    def test_custom_ceiling_respected(self) -> None:
        report = _run(leverage=Decimal("10"), policy=LOOSE)
        assert next(v for v in report.verdicts if v.guard == "leverage-ceiling").breached is False
        report = _run(leverage=Decimal("10.1"), policy=LOOSE)
        assert next(v for v in report.verdicts if v.guard == "leverage-ceiling").breached is True

    def test_zero_leverage_refuses_to_evaluate(self) -> None:
        with pytest.raises(FuturesGuardRefusal) as excinfo:
            _run(leverage=Decimal("0"))
        assert excinfo.value.code == "GUARD_INPUT"


class TestNotionalCeiling:
    def test_exactly_at_ceiling_passes(self) -> None:
        # 6.25 * 40000 = 250 000 = default ceiling.
        report = _run(quantity=Decimal("6.25"), reference_price=Decimal("40000"))
        verdict = next(v for v in report.verdicts if v.guard == "notional-ceiling")
        assert verdict.breached is False
        assert verdict.measured == Decimal("250000.00000000")

    def test_one_tick_over_breaches(self) -> None:
        report = _run(quantity=Decimal("6.25000001"), reference_price=Decimal("40000"))
        assert report.admitted is False
        assert next(v for v in report.verdicts if v.guard == "notional-ceiling").breached is True

    def test_missing_reference_price_refuses_to_price_risk(self) -> None:
        with pytest.raises(FuturesGuardRefusal) as excinfo:
            _run(reference_price=None, guards={"notional-ceiling"})
        assert excinfo.value.code == "GUARD_INPUT"


class TestLiquidationDistance:
    def test_low_leverage_long_has_room(self) -> None:
        # 1/3 - 0.05 = 0.2833 -> 2833.33 bps, well above the 250 bps floor.
        report = _run(leverage=Decimal("3"), maintenance_margin_fraction=Decimal("0.05"))
        verdict = next(v for v in report.verdicts if v.guard == "liquidation-distance")
        assert verdict.breached is False
        assert verdict.measured == Decimal("2833.33")

    def test_short_mirrors_long(self) -> None:
        report = _run(side=OrderSide.SELL, leverage=Decimal("3"),
                      maintenance_margin_fraction=Decimal("0.05"))
        verdict = next(v for v in report.verdicts if v.guard == "liquidation-distance")
        assert verdict.breached is False
        assert "250 bps" in verdict.detail

    def test_high_leverage_breaches_the_floor(self) -> None:
        # 1/40 = 250 bps, minus maintenance 500 bps -> effectively liquidated
        # at entry; the verdict must be a breach at maximum severity.
        report = _run(leverage=Decimal("40"), maintenance_margin_fraction=Decimal("0.05"))
        verdict = next(v for v in report.verdicts if v.guard == "liquidation-distance")
        assert report.admitted is False
        assert verdict.breached is True
        assert verdict.measured == Decimal("-10000")

    def test_margin_fraction_out_of_range_refuses(self) -> None:
        with pytest.raises(FuturesGuardRefusal):
            _run(maintenance_margin_fraction=Decimal("1"))
        with pytest.raises(FuturesGuardRefusal):
            _run(maintenance_margin_fraction=Decimal("-0.01"))

    def test_missing_mark_price_refuses(self) -> None:
        with pytest.raises(FuturesGuardRefusal):
            _run(reference_price=None, guards={"liquidation-distance"})


class TestFundingHeadroom:
    def test_favourable_funding_never_breaches(self) -> None:
        report = _run(projected_funding_rate_8h_bps=Decimal("-30"))
        verdict = next(v for v in report.verdicts if v.guard == "funding-rate-headroom")
        assert verdict.breached is False

    def test_at_the_cap_passes(self) -> None:
        report = _run(projected_funding_rate_8h_bps=Decimal("75"))
        verdict = next(v for v in report.verdicts if v.guard == "funding-rate-headroom")
        assert verdict.breached is False

    def test_above_cap_without_acceptance_breaches(self) -> None:
        report = _run(projected_funding_rate_8h_bps=Decimal("75.01"))
        assert report.admitted is False
        verdict = next(v for v in report.verdicts if v.guard == "funding-rate-headroom")
        assert verdict.breached is True

    def test_explicit_carry_acceptance_overrides_the_cap(self) -> None:
        report = _run(
            projected_funding_rate_8h_bps=Decimal("200"),
            carry_over_position=True,
            accepts_carry_risk=True,
        )
        verdict = next(v for v in report.verdicts if v.guard == "funding-rate-headroom")
        assert verdict.breached is False
        assert "accepted" in verdict.detail

    def test_carry_flags_individually_do_not_override(self) -> None:
        # Both flags are required; either alone must leave the cap binding.
        assert not _run(projected_funding_rate_8h_bps=Decimal("200"),
                        carry_over_position=True).admitted
        assert not _run(projected_funding_rate_8h_bps=Decimal("200"),
                        accepts_carry_risk=True).admitted


class TestAggregateEnforcement:
    def test_empty_guard_selection_refuses(self) -> None:
        # Selecting zero guards on a placement path is a configuration smell,
        # not a vacuous admission.
        with pytest.raises(FuturesGuardRefusal) as excinfo:
            _run(guards=set())
        assert excinfo.value.code == "GUARD_INPUT"

    def test_one_breach_fails_admission(self) -> None:
        report = _run(leverage=Decimal("25"))  # breaches leverage AND liq distance
        assert report.admitted is False
        assert "BREACH" in report.summary

    def test_clean_evaluation_reports_four_passes(self) -> None:
        report = _run()
        assert report.admitted is True
        assert len(report.verdicts) == 4
        assert report.summary.count("pass") == 4

    def test_guard_subset_is_the_only_subset(self) -> None:
        report = _run(guards={"leverage-ceiling"})
        assert [v.guard for v in report.verdicts] == ["leverage-ceiling"]
