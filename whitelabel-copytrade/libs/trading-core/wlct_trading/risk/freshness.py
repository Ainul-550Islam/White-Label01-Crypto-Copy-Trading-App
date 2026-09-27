"""Freshness: the boundary between *current* state and *uncertain* state.

The rule set is boring on purpose and the policy is absolute:

* a timestamp in the future beyond the configured skew tolerance is stale;
  a clock that runs ahead of the snapshot it reads is exactly as dangerous
  as one that runs behind, and treating it as fresh lets a worker with a
  skewed clock silently age its own inputs;
* a timestamp that is missing is stale - not skipped. "We do not know when
  this was written" and "this was written very long ago" produce the same
  risk, so they get the same verdict;
* a timestamp that is present but the snapshot it lives in is older than
  ``max_snapshot_age_micros`` fails the whole snapshot: no per-source budget
  rescues a stale container, because the version counter and the
  configuration digest come from the same read.

Trading-day arithmetic lives here too, in one function, because "daily loss"
is only well-defined if "daily" means the same thing in the engine, the API
and the replay; a second definition of the day boundary somewhere else is
how a loss limit quietly resets early. The day rolls in UTC per the risk
configuration; a project-wide configurable timezone exists for *reporting*,
and the engine refuses to inherit it: a risk day that shifts with a DST
transition is a day that silently extends the loss window twice a year.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Final

__all__ = [
    "FreshnessBudget",
    "SourceFreshness",
    "FreshnessReport",
    "trading_day_utc",
    "is_fresh",
]

#: Maximum accepted future-dated skew before a timestamp is "impossible".
#: Half a second of NTP wander is normal and must not fail the feed; the
#: number exists to catch a clock that is minutes off in either direction.
DEFAULT_MAX_FUTURE_SKEW_MICROS: Final[int] = 500_000


def trading_day_utc(now_micros: int) -> str:
    """The UTC trading-day label (``YYYY-MM-DD``) owning ``now_micros``.

    Epoch microseconds are UTC-referenced, so this is pure arithmetic - no
    ``astimezone`` of a local wall clock can leak in and create a day whose
    length depends on where the process was started.
    """
    dt = datetime.fromtimestamp(now_micros / 1_000_000, tz=timezone.utc)
    return dt.date().isoformat()


def trading_day_bounds_utc(day: str) -> tuple[int, int]:
    """Inclusive-exclusive ``[start, end)`` microsecond bounds for one day label.

    Used by PnL bucket validation and by the API's day-scoped queries; lives
    here so the same parser that produced the label bounds it, keeping the
    two definitions of a day from diverging across a daylight-saving border
    that the UTC day does not even have.
    """
    date = datetime.strptime(day, "%Y-%m-%d").date()
    start = datetime(date.year, date.month, date.day, tzinfo=timezone.utc)
    end = start + timedelta(days=1)
    # Both bounds are exact whole seconds by construction (UTC midnight),
    # so the conversion is integer arithmetic and never inherits float
    # rounding from the datetime -> timestamp hop.
    return int(start.timestamp()) * 1_000_000, int(end.timestamp()) * 1_000_000 - 1


@dataclass(slots=True, frozen=True)
class FreshnessBudget:
    """How old each source may be before a decision must refuse.

    ``max_snapshot_age_micros`` is the ceiling the deployment's
    ``MAX_RISK_STATE_AGE_MS`` maps onto (milliseconds x 1000); the per-source
    budgets tighten it where a source is more perishable than the container
    (a quote, an account balance) and can never be looser - ``__post_init__``
    enforces that, so a typo like a 60-second quote budget against a 5-second
    snapshot ceiling is a startup error, not a wider gate.
    """

    max_snapshot_age_micros: int
    #: None = "no separate budget; the snapshot ceiling governs".
    account_age_micros: int | None = None
    positions_age_micros: int | None = None
    open_orders_age_micros: int | None = None
    market_quote_age_micros: int | None = None
    strategy_pnl_age_micros: int | None = None
    max_future_skew_micros: int = DEFAULT_MAX_FUTURE_SKEW_MICROS

    def __post_init__(self) -> None:
        if self.max_snapshot_age_micros <= 0:
            raise ValueError("max_snapshot_age_micros must be positive.")
        if self.max_future_skew_micros < 0:
            raise ValueError("max_future_skew_micros must be non-negative.")
        for name in (
            "account_age_micros",
            "positions_age_micros",
            "open_orders_age_micros",
            "market_quote_age_micros",
            "strategy_pnl_age_micros",
        ):
            value = getattr(self, name)
            if value is not None and not 0 < value <= self.max_snapshot_age_micros:
                raise ValueError(
                    f"{name} must be positive and no larger than the snapshot "
                    "ceiling; per-source budgets tighten, they do not relax."
                )

    def budget_for(self, source: str) -> int:
        """The governing ceiling for one named source (never looser than the snapshot)."""
        mapped: int | None
        match source:
            case "account":
                mapped = self.account_age_micros
            case "positions":
                mapped = self.positions_age_micros
            case "open_orders":
                mapped = self.open_orders_age_micros
            case "market":
                mapped = self.market_quote_age_micros
            case "strategy_pnl":
                mapped = self.strategy_pnl_age_micros
            case "snapshot":
                mapped = None
            case _:
                raise KeyError(f"No freshness budget defined for source {source!r}.")
        return self.max_snapshot_age_micros if mapped is None else mapped


@dataclass(slots=True, frozen=True)
class SourceFreshness:
    """Verdict for one source: age (or its absence) and the budget it failed."""

    source: str
    age_micros: int | None
    budget_micros: int
    fresh: bool
    reason: str


@dataclass(slots=True, frozen=True)
class FreshnessReport:
    """The aggregate freshness verdict for one snapshot read."""

    evaluated_at_micros: int
    sources: tuple[SourceFreshness, ...]

    @property
    def is_fresh(self) -> bool:
        return all(item.fresh for item in self.sources)

    @property
    def stale_sources(self) -> tuple[str, ...]:
        return tuple(item.source for item in self.sources if not item.fresh)


def is_fresh(
    timestamp_micros: int | None,
    *,
    now_micros: int,
    budget_micros: int,
    max_future_skew_micros: int = DEFAULT_MAX_FUTURE_SKEW_MICROS,
) -> tuple[bool, int | None, str]:
    """The primitive everything else composes: (fresh, age_micros, reason).

    Age is reported as an observable even when the verdict is "stale" -
    events, metrics and replay all want the number, and recomputing it later
    against a later clock would report a different age than the one the
    decision actually saw.
    """
    if timestamp_micros is None:
        return False, None, "source reported no timestamp; unknown is unsafe"
    age = now_micros - timestamp_micros
    if age < 0:
        if -age > max_future_skew_micros:
            return (
                False,
                age,
                f"timestamp is {-age} micros in the future, beyond the "
                f"{max_future_skew_micros} micros skew tolerance; clock state "
                "cannot be trusted for an order decision",
            )
        return True, 0, "within forward skew tolerance"
    if age > budget_micros:
        return (
            False,
            age,
            f"age {age} micros exceeds the {budget_micros} micros budget",
        )
    return True, age, ""
