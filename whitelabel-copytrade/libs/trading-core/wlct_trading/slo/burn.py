"""Multi-window burn-rate alerting conditions.

The shape is the standard SRE workbook one, kept deliberately un-clever: an
alert fires only when BOTH windows agree, which is what separates "we are
eating budget at an unsustainable rate" (short burst sustained long enough to
matter) from "one bad five minutes" (short spike the long window dilutes).
The fast path uses the fast multiplier (default 14.4x: exhaust a 30-day
budget in two days of that burn); the slow path the slow multiplier (6x: the
same budget in five days). The multipliers are configuration, the AND-of-
two-windows structure is law.

State derivation (separate from alerting): the evaluator maps burn against
the definition's warning/critical burn thresholds plus the exhaustion
condition. A window with no samples yields None burn, which raises no alert
and is reported as UNKNOWN by the caller - telemetry gaps never silence a
previously-loud alert either; they keep its last authoritative state, because
"we stopped seeing it" is not "it stopped happening" (see the gap reason the
evaluator carries).
"""

from __future__ import annotations

from dataclasses import dataclass

__all__ = ["BurnAlertKind", "BurnAlertState", "evaluate_burn"]


class BurnAlertKind:
    NONE = "none"
    FAST = "fast"
    SLOW = "slow"
    BOTH = "both"


@dataclass(frozen=True, slots=True)
class BurnAlertState:
    kind: str
    short_burn_ppm: int | None
    long_burn_ppm: int | None
    fast_threshold_ppm: int
    slow_threshold_ppm: int

    @property
    def alerting(self) -> bool:
        return self.kind != BurnAlertKind.NONE

    def to_dict(self) -> dict[str, object]:
        return {
            "kind": self.kind,
            "shortBurnPpm": self.short_burn_ppm,
            "longBurnPpm": self.long_burn_ppm,
            "fastThresholdPpm": self.fast_threshold_ppm,
            "slowThresholdPpm": self.slow_threshold_ppm,
        }


def evaluate_burn(
    *,
    short_burn_ppm: int | None,
    long_burn_ppm: int | None,
    fast_multiplier_ppm: int,
    slow_multiplier_ppm: int,
) -> BurnAlertState:
    """Both-window AND logic on integer ppm thresholds.

    ``fast_multiplier_ppm``/``slow_multiplier_ppm`` are multipliers in ppm
    (14.4x -> 14_400_000) so even the config values stay integer. A missing
    (None) burn on EITHER window can produce no alert - a one-sided spark is
    exactly the noise these windows exist to suppress.
    """
    if fast_multiplier_ppm <= 0 or slow_multiplier_ppm <= 0:
        raise ValueError("burn multipliers must be positive ppm values")
    if slow_multiplier_ppm > fast_multiplier_ppm:
        raise ValueError("slow multiplier must not exceed the fast multiplier")
    fast = short_burn_ppm is not None and long_burn_ppm is not None and short_burn_ppm >= fast_multiplier_ppm and long_burn_ppm >= fast_multiplier_ppm
    slow = (
        short_burn_ppm is not None
        and long_burn_ppm is not None
        and short_burn_ppm >= slow_multiplier_ppm
        and long_burn_ppm >= slow_multiplier_ppm
    )
    kind = (
        BurnAlertKind.BOTH if (fast and slow) else BurnAlertKind.FAST if fast else BurnAlertKind.SLOW if slow else BurnAlertKind.NONE
    )
    return BurnAlertState(
        kind=kind,
        short_burn_ppm=short_burn_ppm,
        long_burn_ppm=long_burn_ppm,
        fast_threshold_ppm=fast_multiplier_ppm,
        slow_threshold_ppm=slow_multiplier_ppm,
    )
